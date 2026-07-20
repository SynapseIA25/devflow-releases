import { DEFAULT_AGENTS } from "./providers";
import { runAgentTurn } from "./teamDelegate";
import { parseSkillMd } from "./skills";
import { checkCli } from "./tauriApi";
import { useSkillsStore } from "../store/skillsStore";
import { useProjectStore } from "../store/projectStore";
import { useWorkspaceStore, type Workspace } from "../store/workspaceStore";

// ── Minería de skills desde la actividad (el "background self-improvement review" de Hermes) ──
// Tras un turno de chat, si el workspace acumuló suficientes tool calls nuevos, un one-shot en
// background (perfil "fast" del router → modelo GRATIS, cuota-consciente) analiza el transcript
// compactado y decide si hay un procedimiento reutilizable. Si lo hay, produce un SKILL.md que
// entra como SUGERENCIA — el usuario aprueba o descarta en la vista Skills (gate siempre activo).

const MIN_NEW_TOOL_BLOCKS = 5; // umbral de Hermes: "tarea compleja" = 5+ tool calls
const COOLDOWN_MS = 15 * 60 * 1000; // por workspace, para no re-analizar cada turno
const MAX_TRANSCRIPT_CHARS = 12_000;

const lastMineAttempt = new Map<string, number>();
let mining = false; // un solo análisis concurrente en toda la app

// El minero corre en el agente más barato disponible: OpenCode (modelos gratis + router) si su CLI
// está instalado, si no MiMo. Claude Code queda excluido a propósito (tokens pagos para una tarea
// de fondo). Cacheado: el set de CLIs instalados no cambia durante la sesión.
let minerAgentP: Promise<(typeof DEFAULT_AGENTS)[number] | null> | null = null;
const pickMinerAgent = () => {
  minerAgentP ??= (async () => {
    try {
      const cli = await checkCli(["opencode", "mimo"]);
      const providerId = cli.opencode ? "opencode" : cli.mimo ? "mimo" : null;
      if (!providerId) return null;
      const base = DEFAULT_AGENTS.find((a) => a.providerId === providerId && !a.expertArea);
      if (!base) return null;
      // systemPrompt vacío: el prompt del minero es autocontenido. Perfil "fast": es clasificación
      // + síntesis corta, no hace falta un modelo caro.
      return { ...base, systemPrompt: "", taskProfile: "fast" as const };
    } catch {
      return null;
    }
  })();
  return minerAgentP;
};

// Transcript compactado: texto de usuario/agente truncado + una línea por tool call. Suficiente
// para detectar un procedimiento sin volcar diffs enteros (economía de prompts).
function compactTranscript(ws: Workspace): string {
  const lines: string[] = [];
  for (const b of ws.blocks) {
    if (b.type === "user") lines.push(`USER: ${b.content.slice(0, 500)}`);
    else if (b.type === "ai" && b.content.trim()) lines.push(`AGENT: ${b.content.slice(0, 800)}`);
    else if (b.type === "tool" && b.tool) {
      const cmd = b.tool.command ? ` :: ${b.tool.command.slice(0, 200)}` : "";
      lines.push(`TOOL[${b.tool.status}]: ${b.tool.title}${cmd}`);
    }
  }
  let out = lines.join("\n");
  if (out.length > MAX_TRANSCRIPT_CHARS) out = `…\n${out.slice(-MAX_TRANSCRIPT_CHARS)}`;
  return out;
}

const MINER_PROMPT_HEADER =
  `You are a skill curator for a development environment. Below is a compacted transcript of a working session between a user and a coding agent.\n\n` +
  `Decide if the session contains ONE reusable, non-trivial procedure worth saving as a "skill" (a recipe another agent could follow later). Good candidates: a multi-step workflow that succeeded after trial and error, a non-obvious fix with a clear recipe, a repeatable setup/deploy/debug procedure. Bad candidates: one-liner answers, pure Q&A, anything project-trivial or already obvious to a competent agent.\n\n` +
  `If there is NO good candidate, reply with exactly: NO_SKILL\n\n` +
  `If there IS one, reply ONLY with a SKILL.md document (no extra prose) in this exact format:\n` +
  "```markdown\n---\nname: kebab-case-name\ndescription: One line saying when to use this skill.\ncategory: optional-category\n---\n\n" +
  "## Steps\n1. …concise, actionable steps with the exact commands/paths that worked…\n```\n\n" +
  `Write the skill in English. Keep it under 60 lines. Generalize project-specific paths where sensible, but keep exact commands that matter.\n\n──── TRANSCRIPT ────\n`;

// Analiza el workspace y, si hay procedimiento, agrega una sugerencia. force = pedido manual
// (botón "Mine current session"): saltea umbral y cooldown. Devuelve un mensaje de resultado
// para la UI manual; el camino automático lo ignora.
export async function mineWorkspace(wsId: string, opts?: { force?: boolean }): Promise<string> {
  const store = useSkillsStore.getState();
  if (!opts?.force && !store.miningEnabled) return "Mining is disabled.";
  const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId);
  if (!ws) return "Workspace not found.";

  const toolBlocks = ws.blocks.filter((b) => b.type === "tool").length;
  const newBlocks = toolBlocks - (store.minedAt[wsId] ?? 0);
  if (!opts?.force) {
    if (newBlocks < MIN_NEW_TOOL_BLOCKS) return "Not enough new activity.";
    const last = lastMineAttempt.get(wsId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return "Cooldown.";
  } else if (ws.blocks.length < 2) {
    return "This session has no activity to mine yet.";
  }
  if (mining) return "Another analysis is already running.";

  const agent = await pickMinerAgent();
  if (!agent) return "No agent CLI available for mining (install mimo or opencode).";

  mining = true;
  lastMineAttempt.set(wsId, Date.now());
  useSkillsStore.getState().setMinedAt(wsId, toolBlocks);
  try {
    const pstate = useProjectStore.getState();
    const cwd = ws.cwd ?? pstate.projects[ws.projectId]?.path ?? pstate.projectPath;
    const reply = await runAgentTurn(agent, MINER_PROMPT_HEADER + compactTranscript(ws), cwd, 120_000);
    if (/^\s*NO_SKILL\s*$/m.test(reply) || !reply.includes("---")) return "No reusable procedure found in this session.";
    const fence = reply.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
    const parsed = parseSkillMd((fence ? fence[1] : reply).trim());
    if (!parsed) return "The miner replied with an invalid skill format.";
    useSkillsStore.getState().addSuggestion({ ...parsed, fromWsTitle: ws.title });
    return `Suggested skill "${parsed.name}" — review it in the Skills view.`;
  } catch (e) {
    return `Mining failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    mining = false;
  }
}

// Hook automático post-turno (lo llama ChatView tras cada turno ACP): fire-and-forget.
export function maybeMineWorkspace(wsId: string): void {
  void mineWorkspace(wsId).catch(() => {});
}

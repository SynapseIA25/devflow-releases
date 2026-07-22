// Registra los expertos de DevFlow (ver EXPERT_AGENTS en providers.ts) como agentes REALES de
// OpenCode — archivos .md en ~/.config/opencode/agent/, el mecanismo nativo de agentes custom
// (opencode.ai/docs/agents/). A diferencia del campo `system` (ver opencodeClient.prompt), un
// agente nativo trae su propio permission-scoping por herramienta: un experto sin "terminal" en
// sus skills queda con bash en modo "ask" de verdad, algo que DevFlow no puede hacer por sí solo.
//
// OJO — verificado empíricamente (dos rondas, la primera con una conclusión errónea): un `opencode
// serve` recién arrancado SÍ levanta un .md escrito antes de su primera consulta a /agent, pero un
// proceso YA CORRIENDO (el caso real: DevFlow lo tiene arriba desde que arrancó la app) **no
// re-escanea `agent/` durante su vida** — ni por watcher ni por polling, confirmado escribiendo un
// archivo nuevo y esperando: nunca apareció en GET /agent sin reiniciar el proceso. La única forma
// confirmada de que un server YA corriendo reconozca un agente nuevo/cambiado es reiniciarlo (ver
// opencodeClient.ensureExpertAgent, que hace ese restart cuando hace falta).
//
// Mismo patrón read-modify-write seguro que ya usa modelCatalog.ts (addModelToOpencodeConfig) para
// el config global de OpenCode, pero acá el archivo entero es propiedad de DevFlow (no hay nada de
// contenido del usuario que preservar) — se puede simplemente reescribir entero si cambió.
import { readTextFile, writeTextFile, createDir, homeDir } from "./tauriApi";
import type { AgentConfig } from "./providers";

async function agentsDir(): Promise<string> {
  return `${await homeDir()}/.config/opencode/agent`;
}

// Prefijo devflow- para no chocar con agentes propios del usuario ni con los built-in de OpenCode
// (build/plan/general/explore/scout/summary/title/compaction, ver GET /agent).
export function nativeAgentName(expertArea: string): string {
  return `devflow-${expertArea}`;
}

function buildAgentFile(agent: AgentConfig): string {
  const hasTerminal = agent.skills.includes("terminal");
  const hasFileEdit = agent.skills.includes("file-edit");
  const lines = ["---", `description: ${JSON.stringify(agent.description)}`, "mode: primary"];
  if (!hasTerminal || !hasFileEdit) {
    lines.push("permission:");
    if (!hasTerminal) lines.push("  bash: ask");
    if (!hasFileEdit) lines.push("  edit: ask");
  }
  lines.push("---", "", agent.systemPrompt.trim(), "");
  return lines.join("\n");
}

// Idempotente: se llama antes de cada turno nativo de un experto (mismo espíritu "ensure" que
// opencodeServeEnsure). Si el system prompt no cambió desde la última vez, no reescribe el archivo
// (evita I/O innecesaria en cada mensaje) y devuelve changed:false — el caller (ensureExpertAgent)
// lo usa para saber si además hace falta forzar un restart del server. Si el usuario editó el
// experto en AgentsView, el próximo turno lo actualiza solo, sin mecanismo de sync aparte.
export async function ensureNativeExpertAgent(agent: AgentConfig): Promise<{ name: string; changed: boolean }> {
  const area = agent.expertArea;
  if (!area) throw new Error("ensureNativeExpertAgent requiere un agente con expertArea");
  const name = nativeAgentName(area);
  const dir = await agentsDir();
  const path = `${dir}/${name}.md`;
  const content = buildAgentFile(agent);
  try {
    const existing = await readTextFile(path);
    if (existing === content) return { name, changed: false };
  } catch {
    // no existe todavía — createDir de abajo es recursivo, cubre este caso también
  }
  await createDir(dir);
  await writeTextFile(path, content);
  return { name, changed: true };
}

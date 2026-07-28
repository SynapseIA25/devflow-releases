// Orquestación de las 4 fases de Spec-Driven Development (Specify → Plan → Tasks → Implement).
// Reusa la infraestructura multi-agente que ya existe (teamDelegate.ts) en vez de inventar un motor
// nuevo: cada fase de un solo agente es un runAgentTurn; Implement decide por tarea entre un solo
// experto (runAgentTurn) o el equipo completo (autoDelegate), usando el mismo router determinista
// (expertRouter.suggestExperts) que ya usa Team. Este módulo NO toca ningún store — como
// teamDelegate.ts, solo orquesta y devuelve resultados; el caller (la vista) persiste en
// projectStore.updateSpec después de cada fase (mismo límite de responsabilidad que autoDelegate/
// TeamView.tsx).
import { isExpertAgent, type AgentConfig } from "./providers";
import { runAgentTurn, withProfile, autoDelegate, type DelegateStep } from "./teamDelegate";
import { suggestExperts } from "./expertRouter";
import type { TaskProfile } from "./modelRouter";
import { readSpecArtifact, writeSpecArtifact, parseTasksMarkdown, serializeTasksMarkdown, type SpecTaskState } from "./specFiles";
import { buildMemoryPreamble } from "./projectMemory";
import * as ragEngine from "./ragEngine";
import { runShellCommand } from "./tauriApi";
import { DESIGN_PATTERNS } from "./specTemplates";
import type { Spec, SpecPhase } from "../store/projectStore";

// Specify/Plan SIEMPRE buscan código relacionado (sin toggle — a diferencia del chat, grounding real
// es el objetivo de estas fases). Sin índice construido (o sin Ollama corriendo), falla en silencio
// — mismo criterio que el toggle del chat: RAG mejora el resultado, nunca bloquea el turno.
async function relatedCodeBlock(projectRoot: string, query: string): Promise<string> {
  try {
    const matches = await ragEngine.search(projectRoot, query, 6);
    return await ragEngine.formatChunksForPrompt(matches);
  } catch {
    return "";
  }
}

// Mismo valor que DEFAULT_TURN_TIMEOUT_MS en teamDelegate.ts (no exportado ahí, se duplica el
// número — cada fase de spec es, en esencia, el mismo tipo de turno largo que un experto de Team).
const DEFAULT_TIMEOUT_MS = 240_000;

export type NonDonePhase = Exclude<SpecPhase, "done">;

export const PHASE_ORDER: NonDonePhase[] = ["specify", "plan", "tasks", "implement"];

export const PHASE_LABEL: Record<NonDonePhase, { label: string; desc: string }> = {
  specify: { label: "Specify", desc: "EARS requirements — what has to happen." },
  plan: { label: "Plan", desc: "Architecture and technical decisions." },
  tasks: { label: "Tasks", desc: "Executable checklist, one commit-sized task at a time." },
  implement: { label: "Implement", desc: "The agent executes each task and checks it off." },
};

export const PHASE_PROFILE: Record<NonDonePhase, TaskProfile> = {
  specify: "reasoning", // arquitectura/alcance — mismo perfil que el experto Architect
  plan: "reasoning",
  tasks: "fast", // transformación corta y estructurada — mismo perfil que el paso de plan de autoDelegate
  implement: "code",
};

// Agente+perfil efectivos para una fase: override de la spec > default de la spec > lead del equipo.
// Esto ES la respuesta a "definir qué modelo usa cada agente y en qué momento" — no una regla global,
// sino un override por spec/fase resuelto acá en runtime.
export function resolvePhaseAgent(
  spec: Spec,
  phase: NonDonePhase,
  agents: AgentConfig[],
  lead: AgentConfig
): { agent: AgentConfig; profile: TaskProfile } {
  const override = spec.phaseAgents[phase];
  const agentId = override?.agentId ?? spec.defaultAgentId;
  const agent = (agentId && agents.find((a) => a.id === agentId)) || lead;
  const profile = override?.profile ?? PHASE_PROFILE[phase];
  return { agent, profile };
}

function buildSpecifyPrompt(specName: string, memory: string, relatedCode: string): string {
  return (
    `You are writing the REQUIREMENTS document for a feature, using EARS syntax (Easy Approach to ` +
    `Requirements Syntax: WHEN/WHILE/IF...THEN clauses ending in "THE SYSTEM SHALL/MUST ...").\n\n` +
    (memory ? `${memory}\n\n` : "") +
    (relatedCode ? `${relatedCode}\n\n` : "") +
    `Feature: "${specName}"\n\n` +
    `Write a complete requirements.md: a short intro paragraph, then a bullet list of EARS-style ` +
    `requirements covering the feature's expected behavior, edge cases, and error handling. Ground ` +
    `it in the related code above where relevant instead of assuming a greenfield feature. Respond ` +
    `ONLY with the Markdown content of the file, as your message text — no extra commentary, no ` +
    `fences around the whole file. Do NOT use any file-write/edit tool for this: the caller saves ` +
    `your response to disk, writing a file yourself would create a stray duplicate.`
  );
}

// Catálogo curado de patrones conocidos, listado en el prompt para que el agente elija y JUSTIFIQUE
// uno (o explícitamente diga que ninguno aplica y por qué) en vez de inventar la estructura desde
// cero cada vez — ver specTemplates.ts. No es una elección aparte en la UI a propósito: el agente
// propone, grounded en el código real (relatedCode), y el usuario revisa/ajusta en el panel editable
// de design.md — mismo checkpoint humano que ya existe, sin sumar un selector nuevo.
function patternCatalogBlock(): string {
  const lines = DESIGN_PATTERNS.map((p) => `- ${p.name} — ${p.hint}`).join("\n");
  return `[Known architecture/design patterns]\n${lines}`;
}

function buildPlanPrompt(specName: string, requirements: string, memory: string, relatedCode: string): string {
  return (
    `You are writing the DESIGN document for a feature, given its approved requirements.\n\n` +
    (memory ? `${memory}\n\n` : "") +
    (relatedCode ? `${relatedCode}\n\n` : "") +
    `${patternCatalogBlock()}\n\n` +
    `Feature: "${specName}"\n\nRequirements (requirements.md):\n${requirements}\n\n` +
    `Write a complete design.md: architecture and technical decisions to satisfy the requirements ` +
    `above — name the actual files/modules to touch, reusing existing project code and patterns ` +
    `from the related code above where they already exist instead of inventing new ones. Explicitly ` +
    `name which pattern from the list above best fits (or say none of them do, and why) and justify ` +
    `it against the actual codebase — don't force a pattern that doesn't fit just to name one. Respond ` +
    `ONLY with the Markdown content of the file, as your message text. Do NOT use any file-write/edit ` +
    `tool for this: the caller saves your response to disk, writing a file yourself would create a ` +
    `stray duplicate. It's fine (encouraged) to use read-only tools to explore the actual code first.`
  );
}

function buildTasksPrompt(specName: string, requirements: string, design: string, areaIds: string[]): string {
  return (
    `You are breaking a DESIGN document down into an executable task checklist.\n\n` +
    `Feature: "${specName}"\n\nRequirements:\n${requirements}\n\nDesign:\n${design}\n\n` +
    `Respond ONLY with a Markdown checklist, as your message text, one task per line, in this EXACT ` +
    `format:\n` +
    `- [ ] <concrete, one-commit-sized task> (area: <one of: ${areaIds.join(", ")}>)\n` +
    `Order tasks so earlier ones unblock later ones. No extra text, no headings, no fences. Do NOT ` +
    `use any file-write tool for this: the caller saves your response to disk.`
  );
}

function buildImplementTaskPrompt(specName: string, requirements: string, design: string, task: SpecTaskState): string {
  return (
    `You're implementing ONE task from an approved spec. Read the actual project files as needed — ` +
    `the requirements/design below are context, not a substitute for looking at the real code.\n\n` +
    `Feature: "${specName}"\n\nRequirements:\n${requirements}\n\nDesign:\n${design}\n\n` +
    `Your task: ${task.text}\n\n` +
    `Implement exactly this task — don't do more, don't do less. Make real edits to the project's files.`
  );
}

export async function runSpecifyPhase(
  spec: Spec,
  projectRoot: string,
  agents: AgentConfig[],
  lead: AgentConfig,
  onModel?: (model: string) => void
): Promise<string> {
  const { agent, profile } = resolvePhaseAgent(spec, "specify", agents, lead);
  const [memory, relatedCode] = await Promise.all([
    buildMemoryPreamble(projectRoot),
    relatedCodeBlock(projectRoot, spec.name),
  ]);
  const text = await runAgentTurn(
    withProfile(agent, profile),
    buildSpecifyPrompt(spec.name, memory, relatedCode),
    projectRoot,
    DEFAULT_TIMEOUT_MS,
    onModel
  );
  await writeSpecArtifact(projectRoot, spec.slug, "requirements", text);
  return text;
}

export async function runPlanPhase(
  spec: Spec,
  projectRoot: string,
  agents: AgentConfig[],
  lead: AgentConfig,
  onModel?: (model: string) => void
): Promise<string> {
  const { agent, profile } = resolvePhaseAgent(spec, "plan", agents, lead);
  const requirements = await readSpecArtifact(projectRoot, spec.slug, "requirements");
  const [memory, relatedCode] = await Promise.all([
    buildMemoryPreamble(projectRoot),
    relatedCodeBlock(projectRoot, requirements || spec.name),
  ]);
  const text = await runAgentTurn(
    withProfile(agent, profile),
    buildPlanPrompt(spec.name, requirements, memory, relatedCode),
    projectRoot,
    DEFAULT_TIMEOUT_MS,
    onModel
  );
  await writeSpecArtifact(projectRoot, spec.slug, "design", text);
  return text;
}

export async function runTasksPhase(
  spec: Spec,
  projectRoot: string,
  agents: AgentConfig[],
  lead: AgentConfig,
  onModel?: (model: string) => void
): Promise<SpecTaskState[]> {
  const { agent, profile } = resolvePhaseAgent(spec, "tasks", agents, lead);
  const [requirements, design] = await Promise.all([
    readSpecArtifact(projectRoot, spec.slug, "requirements"),
    readSpecArtifact(projectRoot, spec.slug, "design"),
  ]);
  const areaIds = agents
    .filter(isExpertAgent)
    .map((a) => a.expertArea)
    .filter((a): a is string => !!a);
  const raw = await runAgentTurn(
    withProfile(agent, profile),
    buildTasksPrompt(spec.name, requirements, design, areaIds),
    projectRoot,
    DEFAULT_TIMEOUT_MS,
    onModel
  );
  const tasks = parseTasksMarkdown(raw);
  await writeSpecArtifact(projectRoot, spec.slug, "tasks", serializeTasksMarkdown(tasks));
  return tasks;
}

// ── Implement ──
// Progreso streamed vía SpecStep (calca DelegateStep de teamDelegate.ts) — el caso "task-delegate"
// envuelve un DelegateStep real para que la UI reuse el render de Team sin duplicar nada.
export type SpecStep =
  | { kind: "phase-start" }
  | { kind: "task-start"; index: number; text: string }
  | { kind: "task-mode"; index: number; mode: "single" | "team"; agentName?: string }
  | { kind: "task-delegate"; index: number; step: DelegateStep }
  // `changed`: si el proyecto realmente tiene cambios reales después del turno (comparación de
  // `git status --porcelain` antes/después — mide el resultado real, no infiere de eventos del
  // protocolo). undefined = no se pudo chequear (no es un repo git). false = el turno terminó sin
  // errores pero SIN cambios reales en disco — encontrado en la práctica probando esto: un modelo
  // gratis puede reportar "listo" en su texto (e incluso invocar su herramienta de edición) sin que
  // el archivo termine realmente distinto (ej. un patrón de búsqueda que no matcheó, no-op
  // silencioso). No es un fallo — la tarea igual queda tildada (puede ser un false negative real,
  // una tarea que de verdad no tocaba código), pero se marca distinto para revisar sin ir al diff a mano.
  | { kind: "task-done"; index: number; changed?: boolean }
  | { kind: "task-error"; index: number; message: string }
  | { kind: "phase-done" };

// Snapshot de git status (porcelain, una línea por archivo tocado) — comparar antes/después de un
// turno es la única forma confiable de saber si el agente REALMENTE cambió algo (probado en la
// práctica: trackear el `kind` de los tool-calls del turno da falsos positivos — un tool-call de
// tipo "edit" puede no persistir nada si el patrón de búsqueda no matcheó). null = no se pudo (no es
// un repo git, o el comando falló) — en ese caso no se reporta señal, no se bloquea nada.
async function gitSnapshot(cwd: string): Promise<string | null> {
  try {
    // --untracked-files=all (no el default "normal"): sin esto, un directorio no trackeado entero
    // (ej. .devflow/, que ya existía por specs previas) colapsa a UNA línea ("?? .devflow/") — un
    // archivo nuevo/modificado ADENTRO de esa carpeta no cambia esa línea, así que un cambio real
    // quedaba invisible para esta comparación (encontrado en la práctica: comparación antes/después
    // idéntica pese a que la spec sí había escrito requirements.md nuevo adentro de .devflow/specs/).
    const res = await runShellCommand("git status --porcelain --untracked-files=all", cwd);
    return res.exitCode === 0 ? res.output : null;
  } catch {
    return null;
  }
}

// Si el 2do mejor experto queda a menos de este margen del 1ro, la tarea se considera "cruza áreas"
// y se reparte en equipo en vez de ir a un solo experto.
const TEAM_SCORE_MARGIN = 2;

function pickImplementMode(
  taskText: string,
  experts: AgentConfig[],
  lead: AgentConfig
): { mode: "single"; agent: AgentConfig } | { mode: "team" } {
  const matches = suggestExperts(taskText, experts);
  // Sin ningún match: la tarea no encaja en ningún área conocida — el lead la hace solo. Mandarla a
  // "team" acá sería pedirle al lead que DESCOMPONGA algo que no tiene por qué descomponerse, y en la
  // práctica eso hace que el paso de plan de autoDelegate falle ("no devolvió un plan válido") porque
  // no hay ninguna sub-tarea real que asignar. Team queda solo para ambigüedad genuina (2+ expertos
  // con score parejo), no para "nadie matcheó nada".
  if (matches.length === 0) return { mode: "single", agent: lead };
  if (matches.length === 1) return { mode: "single", agent: matches[0].agent };
  const [best, second] = matches;
  if (best.score - second.score >= TEAM_SCORE_MARGIN) return { mode: "single", agent: best.agent };
  return { mode: "team" };
}

// Itera las tareas SIN tildar, una por vez (nunca en paralelo entre tareas — evita sesiones ACP
// concurrentes tocando los mismos archivos; el paralelismo real solo pasa ADENTRO de una tarea, vía
// autoDelegate). Para en la primera tarea que falla (checkpoint humano: no sigue de largo pisando
// errores) — las tareas ya completadas quedan tildadas en disco.
// `opts.cwd`: dónde EJECUTA el agente (puede ser un worktree aislado, distinto de `projectRoot`) —
// los artefactos de la spec (requirements/design/tasks.md) siempre se leen/escriben contra
// `projectRoot`, la spec vive con el proyecto real aunque el código se edite aislado. `opts.timeoutMs`
// y el remapeo de provider (si corresponde) los resuelve el CALLER pasando agentes ya mapeados —
// mismo criterio de no tocar stores acá adentro (ver comentario de arriba del archivo).
export async function runImplementPhase(
  spec: Spec,
  projectRoot: string,
  agents: AgentConfig[],
  lead: AgentConfig,
  emit: (step: SpecStep) => void,
  isCancelled: () => boolean,
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<SpecTaskState[]> {
  const cwd = opts?.cwd ?? projectRoot;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const experts = agents.filter(isExpertAgent);
  const tasks = [...spec.tasks];
  const [requirements, design] = await Promise.all([
    readSpecArtifact(projectRoot, spec.slug, "requirements"),
    readSpecArtifact(projectRoot, spec.slug, "design"),
  ]);
  const { profile: implementProfile } = resolvePhaseAgent(spec, "implement", agents, lead);

  emit({ kind: "phase-start" });
  for (let i = 0; i < tasks.length; i++) {
    if (isCancelled()) break;
    const task = tasks[i];
    if (task.done) continue;
    emit({ kind: "task-start", index: i, text: task.text });
    const decision = pickImplementMode(task.text, experts, lead);
    const prompt = buildImplementTaskPrompt(spec.name, requirements, design, task);
    const before = await gitSnapshot(cwd);
    try {
      if (decision.mode === "single") {
        emit({ kind: "task-mode", index: i, mode: "single", agentName: decision.agent.name });
        await runAgentTurn(withProfile(decision.agent, implementProfile), prompt, cwd, timeoutMs);
      } else {
        emit({ kind: "task-mode", index: i, mode: "team" });
        let hadError = false;
        await autoDelegate(
          prompt,
          experts,
          lead,
          cwd,
          (step) => {
            if (step.kind === "error") hadError = true;
            emit({ kind: "task-delegate", index: i, step });
          },
          isCancelled,
          timeoutMs
        );
        if (hadError) throw new Error("The team could not complete this task (see detail above).");
      }
    } catch (e) {
      emit({ kind: "task-error", index: i, message: e instanceof Error ? e.message : String(e) });
      break; // no sigue con las siguientes tareas si esta falló — el usuario revisa antes de reintentar
    }
    const after = before !== null ? await gitSnapshot(cwd) : null;
    const changed = before !== null && after !== null ? after !== before : undefined;
    tasks[i] = { ...task, done: true };
    await writeSpecArtifact(projectRoot, spec.slug, "tasks", serializeTasksMarkdown(tasks));
    emit({ kind: "task-done", index: i, changed });
  }
  emit({ kind: "phase-done" });
  return tasks;
}

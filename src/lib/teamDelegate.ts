import { DEFAULT_PROVIDERS, type AgentConfig } from "./providers";
import * as acpClient from "./acpClient";

// Auto-delegación (pilar 1, etapa 2): un agente LÍDER descompone la tarea en sub-tareas por área,
// delega cada una a su experto (sesión ACP propia con el system prompt del experto), y sintetiza los
// aportes en una respuesta final. Reusa el patrón de execMimo del motor de workflows (newSession →
// onUpdate junta agent_message_chunk → prompt → unsub). Todos corren sobre MiMo (mismo proceso ACP,
// sesiones distintas). Los expertos corren EN PARALELO (Promise.all) con un TIMEOUT por turno: si uno
// se cuelga (mimo lento/wedgeado), se aborta ESE turno (acpClient.cancel de su sesión, que gracias al
// cancel selectivo del Frente 1 no toca las otras) y se sigue con los demás, marcándolo "sin respuesta".
export type DelegateStep =
  | { kind: "stage"; label: string }
  | { kind: "plan"; items: { area: string; subtask: string }[] }
  | { kind: "expert-start"; index: number; area: string; name: string; icon: string; color: string; subtask: string }
  | { kind: "expert-done"; index: number; area: string; name: string; text: string; timedOut?: boolean }
  | { kind: "synthesis"; text: string }
  | { kind: "error"; message: string };

// Timeout por turno (ms). Generoso: la latencia normal es ~40-60s/experto y en paralelo hay contención
// sobre el proceso mimo compartido, así que apuntamos a cortar solo turnos genuinamente colgados.
const DEFAULT_TURN_TIMEOUT_MS = 240_000;

// Error específico de timeout de turno, para distinguirlo de un error real del agente.
class TurnTimeoutError extends Error {
  constructor(ms: number) {
    super(`sin respuesta: se agotó el tiempo de ${Math.round(ms / 1000)}s`);
    this.name = "TurnTimeoutError";
  }
}

// Corre UN turno con un agente en una sesión ACP fresca y devuelve el texto completo de la respuesta.
// Si timeoutMs > 0 y el turno no termina a tiempo, cancela la sesión y lanza TurnTimeoutError.
async function runAgentTurn(agent: AgentConfig, promptText: string, cwd: string, timeoutMs = 0): Promise<string> {
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === agent.providerId);
  if (!provider?.acp) throw new Error(`El agente ${agent.name} no tiene ACP configurado`);
  const sessionId = await acpClient.newSession(agent.providerId, provider.acp, cwd);
  let text = "";
  const unsub = acpClient.onUpdate((prov, sid, update) => {
    if (prov !== agent.providerId || sid !== sessionId) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | string | undefined;
      if (typeof content === "string") text += content;
      else if (content?.type === "text" && content.text) text += content.text;
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sys = agent.systemPrompt?.trim();
    const promptP = acpClient.prompt(agent.providerId, sessionId, sys ? `[System]\n${sys}\n\n${promptText}` : promptText);
    if (timeoutMs > 0) {
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Cancelar SOLO esta sesión (el cancel del Frente 1 es selectivo) → los otros expertos siguen.
          acpClient.cancel(agent.providerId, sessionId);
          reject(new TurnTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      await Promise.race([promptP, timeoutP]);
    } else {
      await promptP;
    }
  } finally {
    if (timer) clearTimeout(timer);
    unsub();
  }
  return text.trim();
}

// Extrae el primer array JSON de una respuesta (tolera ```json ... ``` y texto alrededor).
function extractJsonArray(s: string): { area: string; subtask: string }[] | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function autoDelegate(
  task: string,
  experts: AgentConfig[],
  lead: AgentConfig,
  cwd: string, // dónde corren los expertos: projectPath normalmente, o el worktree de un ambiente (aislado)
  emit: (step: DelegateStep) => void,
  isCancelled: () => boolean,
  timeoutMs: number = DEFAULT_TURN_TIMEOUT_MS
): Promise<void> {
  const areaList = experts.map((e) => `- ${e.expertArea}: ${e.name} (${e.description})`).join("\n");

  // 1. Descomponer (el líder arma el plan)
  emit({ kind: "stage", label: "El líder descompone la tarea…" });
  const planPrompt =
    `Sos el líder de un equipo de expertos. Descomponé la siguiente tarea en sub-tareas, cada una asignada al área de UN experto de esta lista (usá EXACTAMENTE el identificador de área de la izquierda):\n${areaList}\n\n` +
    `Tarea: "${task}"\n\n` +
    `Respondé SOLO con un array JSON, sin texto extra ni explicación, con la forma: [{"area":"<area>","subtask":"<sub-tarea concreta>"}]. Máximo 4 items, un área por item (no repitas áreas), solo las realmente relevantes.`;
  let planRaw: string;
  try {
    planRaw = await runAgentTurn(lead, planPrompt, cwd, timeoutMs);
  } catch (e) {
    emit({ kind: "error", message: e instanceof TurnTimeoutError ? `El líder no respondió a tiempo al armar el plan (${Math.round(timeoutMs / 1000)}s).` : (e instanceof Error ? e.message : String(e)) });
    return;
  }
  if (isCancelled()) return;

  const parsed = extractJsonArray(planRaw);
  const plan = (parsed ?? [])
    .map((it) => ({ ...it, expert: experts.find((e) => e.expertArea === it.area) }))
    .filter((it): it is typeof it & { expert: AgentConfig } => !!it.expert);
  if (plan.length === 0) {
    emit({ kind: "error", message: `El líder no devolvió un plan válido:\n${planRaw.slice(0, 400)}` });
    return;
  }
  emit({ kind: "plan", items: plan.map((p) => ({ area: p.area, subtask: p.subtask })) });

  // 2. Delegar a cada experto EN PARALELO, con timeout por turno. Emitimos todos los expert-start (en
  // orden del plan) y luego cada expert-done APENAS termina su experto (la vista los paea por `index`,
  // no por orden de llegada). Un timeout/error de un experto no frena a los demás (Promise.all sobre
  // sub-promesas que ya capturan su propio error → nunca rechaza). Los results quedan en orden del plan.
  if (isCancelled()) return;
  plan.forEach((item, i) =>
    emit({ kind: "expert-start", index: i, area: item.area, name: item.expert.name, icon: item.expert.icon, color: item.expert.color, subtask: item.subtask })
  );
  const results = await Promise.all(
    plan.map(async (item, i) => {
      let text: string;
      let timedOut = false;
      try {
        text = await runAgentTurn(item.expert, `Tarea general: ${task}\n\nTu sub-tarea (${item.expert.name}): ${item.subtask}`, cwd, timeoutMs);
      } catch (e) {
        timedOut = e instanceof TurnTimeoutError;
        text = timedOut ? `⏱ ${e instanceof Error ? e.message : ""}` : `(error del experto: ${e instanceof Error ? e.message : String(e)})`;
      }
      emit({ kind: "expert-done", index: i, area: item.area, name: item.expert.name, text, timedOut });
      return { name: item.expert.name, text };
    })
  );
  if (isCancelled()) return;

  // 3. Sintetizar (el líder consolida). Truncamos cada aporte para acotar el contexto del turno de
  // síntesis: sin cap, juntar varias respuestas largas hace el prompt enorme (lento y caro).
  emit({ kind: "stage", label: "El líder consolida los aportes…" });
  const CAP = 1200;
  const synthPrompt =
    `Sos el líder del equipo. La tarea era: "${task}".\n\nCada experto aportó lo suyo (resumido):\n\n` +
    results.map((r) => `### ${r.name}\n${r.text.length > CAP ? r.text.slice(0, CAP) + "…" : r.text}`).join("\n\n") +
    `\n\nConsolidá todo en una respuesta final coherente y accionable para el usuario, en español. Sé conciso.`;
  let final: string;
  try {
    final = await runAgentTurn(lead, synthPrompt, cwd, timeoutMs);
  } catch (e) {
    emit({ kind: "error", message: e instanceof TurnTimeoutError ? `El líder no pudo sintetizar a tiempo (${Math.round(timeoutMs / 1000)}s); arriba quedan los aportes de cada experto.` : (e instanceof Error ? e.message : String(e)) });
    return;
  }
  emit({ kind: "synthesis", text: final });
}

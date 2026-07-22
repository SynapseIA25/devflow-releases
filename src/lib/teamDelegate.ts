import { DEFAULT_PROVIDERS, isExpertAgent, type AgentConfig } from "./providers";
import * as acpClient from "./acpClient";
import * as opencodeClient from "./opencodeClient";
import { isQuotaError, reportQuotaError, type TaskProfile } from "./modelRouter";
import { useSettingsStore } from "../store/settingsStore";

// Auto-delegación (pilar 1, etapa 2): un agente LÍDER descompone la tarea en sub-tareas por área,
// delega cada una a su experto (sesión ACP propia con el system prompt del experto), y sintetiza los
// aportes en una respuesta final. Reusa el patrón de execMimo del motor de workflows (newSession →
// onUpdate junta agent_message_chunk → prompt → unsub). Todos corren sobre MiMo (mismo proceso ACP,
// sesiones distintas). Los expertos corren EN PARALELO (Promise.all) con un TIMEOUT por turno: si uno
// se cuelga (mimo lento/wedgeado), se aborta ESE turno (acpClient.cancel de su sesión, que gracias al
// cancel selectivo del Frente 1 no toca las otras) y se sigue con los demás, marcándolo "sin respuesta".
export type DelegateStep =
  | { kind: "stage"; label: string }
  | { kind: "plan"; items: { area: string; subtask: string }[]; model?: string }
  | { kind: "expert-start"; index: number; area: string; name: string; icon: string; color: string; subtask: string }
  // Modelo real de la sesión del experto (se conoce al abrirla, antes de que termine el turno; un
  // reintento por rate-limit puede re-emitirlo con otro modelo — vale el último).
  | { kind: "expert-model"; index: number; model: string }
  | { kind: "expert-done"; index: number; area: string; name: string; text: string; timedOut?: boolean }
  | { kind: "synthesis"; text: string; model?: string }
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
// La sesión se abre con el taskProfile del agente: sobre un provider multi-modelo (OpenCode) el router
// elige el mejor modelo GRATIS para el rol (cuota-consciente). Si el turno muere por rate-limit, se
// marca el provider de inferencia en cooldown y se REINTENTA UNA VEZ en sesión nueva — el router ya
// saltea al agotado y cae al siguiente candidato del perfil.
export async function runAgentTurn(agent: AgentConfig, promptText: string, cwd: string, timeoutMs = 0, onModel?: (model: string) => void, retried = false): Promise<string> {
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === agent.providerId);
  const isNative = !!provider?.nativeHttp;
  if (!provider?.acp && !isNative) throw new Error(`El agente ${agent.name} no tiene ACP ni servidor nativo configurado`);
  // opencodeClient emite el mismo shape de SessionUpdate que acpClient (ver opencodeClient.ts) —
  // getSessionModel/onUpdate/cancel comparten firma entre los dos, así que se puede delegar a uno u
  // otro según el transporte del provider sin duplicar el resto de esta función.
  const client = isNative ? opencodeClient : acpClient;
  const sys = agent.systemPrompt?.trim();
  // Path nativo: el system prompt va por el campo real de OpenCode, no prepend de texto — los
  // expertos (isExpertAgent) corren como agente REAL registrado (permission-scoping por skills
  // incluido), el resto usa el campo `system` simple. El path ACP sigue con el prepend (no tiene
  // campo de sistema propio). OJO orden: ensureExpertAgent puede reiniciar el server de OpenCode
  // (invalida TODAS las sesiones nativas) — tiene que correr ANTES de abrir la sesión de este
  // turno, si no la dejaría colgando de un sessionId que ya no existe.
  let nativeOpts: { system?: string; agent?: string } = {};
  if (isNative) {
    nativeOpts = isExpertAgent(agent)
      ? { agent: await opencodeClient.ensureExpertAgent(agent.providerId, agent) }
      : sys
      ? { system: sys }
      : {};
  }
  const sessionId = isNative
    ? await opencodeClient.newSession(agent.providerId, cwd, agent.model || undefined, agent.taskProfile)
    : await acpClient.newSession(agent.providerId, provider!.acp!, cwd, agent.model || undefined, agent.taskProfile);
  const sessionModel = client.getSessionModel(agent.providerId, sessionId);
  if (sessionModel && onModel) onModel(sessionModel);
  let text = "";
  const unsub = client.onUpdate((prov, sid, update) => {
    if (prov !== agent.providerId || sid !== sessionId) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | string | undefined;
      if (typeof content === "string") text += content;
      else if (content?.type === "text" && content.text) text += content.text;
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let promptP: Promise<{ stopReason: string }>;
    if (isNative) {
      promptP = opencodeClient.prompt(agent.providerId, sessionId, cwd, promptText, nativeOpts);
    } else {
      const fullText = sys ? `[System]\n${sys}\n\n${promptText}` : promptText;
      promptP = acpClient.prompt(agent.providerId, sessionId, fullText);
    }
    if (timeoutMs > 0) {
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Cancelar SOLO esta sesión (el cancel del Frente 1 es selectivo) → los otros expertos siguen.
          client.cancel(agent.providerId, sessionId);
          reject(new TurnTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      await Promise.race([promptP, timeoutP]);
    } else {
      await promptP;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!retried && !(e instanceof TurnTimeoutError) && isQuotaError(msg)) {
      const model = client.getSessionModel(agent.providerId, sessionId);
      if (model) reportQuotaError(model, msg);
      if (timer) clearTimeout(timer);
      unsub();
      return runAgentTurn(agent, promptText, cwd, timeoutMs, onModel, true);
    }
    throw e;
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

  // El líder (mimo-coder) no trae taskProfile: overrideado a un provider multi-modelo (OpenCode) sin
  // perfil, newSession no rutea y cae al modelo DEFAULT del agente — que con key de OpenRouter es PAGO.
  // Le damos perfil por turno: el plan es corto y estructurado (fast), la síntesis pide criterio (reasoning).
  const withProfile = (a: AgentConfig, p: TaskProfile): AgentConfig => (a.taskProfile ? a : { ...a, taskProfile: p });

  // 1. Descomponer (el líder arma el plan)
  emit({ kind: "stage", label: "El líder descompone la tarea…" });
  const planPrompt =
    `Sos el líder de un equipo de expertos. Descomponé la siguiente tarea en sub-tareas, cada una asignada al área de UN experto de esta lista (usá EXACTAMENTE el identificador de área de la izquierda):\n${areaList}\n\n` +
    `Tarea: "${task}"\n\n` +
    `Respondé SOLO con un array JSON, sin texto extra ni explicación, con la forma: [{"area":"<area>","subtask":"<sub-tarea concreta>"}]. Máximo 4 items, un área por item (no repitas áreas), solo las realmente relevantes.`;
  let planRaw: string;
  let planModel: string | undefined;
  try {
    planRaw = await runAgentTurn(withProfile(lead, "fast"), planPrompt, cwd, timeoutMs, (m) => { planModel = m; });
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
  emit({ kind: "plan", items: plan.map((p) => ({ area: p.area, subtask: p.subtask })), model: planModel });

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
        text = await runAgentTurn(
          item.expert,
          `Tarea general: ${task}\n\nTu sub-tarea (${item.expert.name}): ${item.subtask}`,
          cwd,
          timeoutMs,
          (m) => emit({ kind: "expert-model", index: i, model: m })
        );
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
  // síntesis: sin cap, juntar varias respuestas largas hace el prompt enorme (lento y caro). Con la
  // economía de prompts apagada en Settings el cap se relaja (el usuario prefirió fidelidad a tokens).
  emit({ kind: "stage", label: "El líder consolida los aportes…" });
  const CAP = useSettingsStore.getState().promptEconomy === "off" ? 3000 : 1200;
  const synthPrompt =
    `Sos el líder del equipo. La tarea era: "${task}".\n\nCada experto aportó lo suyo (resumido):\n\n` +
    results.map((r) => `### ${r.name}\n${r.text.length > CAP ? r.text.slice(0, CAP) + "…" : r.text}`).join("\n\n") +
    `\n\nConsolidá todo en una respuesta final coherente y accionable para el usuario, en español. Sé conciso.`;
  let final: string;
  let synthModel: string | undefined;
  try {
    final = await runAgentTurn(withProfile(lead, "reasoning"), synthPrompt, cwd, timeoutMs, (m) => { synthModel = m; });
  } catch (e) {
    emit({ kind: "error", message: e instanceof TurnTimeoutError ? `El líder no pudo sintetizar a tiempo (${Math.round(timeoutMs / 1000)}s); arriba quedan los aportes de cada experto.` : (e instanceof Error ? e.message : String(e)) });
    return;
  }
  emit({ kind: "synthesis", text: final, model: synthModel });
}

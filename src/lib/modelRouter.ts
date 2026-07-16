import type { ModelOption } from "./acpClient";
import { useQuotaStore } from "../store/quotaStore";

// ── Router de modelos por perfil de tarea ──
// Objetivo: aprovechar al máximo los tiers GRATUITOS cruzando providers de inferencia (cada uno tiene
// su cuota independiente: OpenRouter 50/día por cuenta, Gemini/Groq/Mistral las suyas, OpenCode Zen y
// locales sin límite conocido). Dado un perfil de tarea y la lista de modelos que el agente ACP expone
// en runtime (configOptions de session/new), elige el primer candidato disponible cuyo provider no esté
// agotado (ver quotaStore). Si nada matchea (ej. el agente es MiMo, que solo expone mimo/*), devuelve
// null y el caller sigue con su default — el router nunca rompe un flujo existente.
//
// La tabla usa PATTERNS (no ids exactos) contra los ids reales que expone OpenCode
// ("<provider>/<vendor>/<modelo>[:free]", ej. "openrouter/qwen/qwen3-coder:free",
// "opencode/nemotron-3-ultra-free", "google/gemini-2.5-flash", "groq/llama-3.3-70b-versatile"):
// el catálogo de modelos gratis rota seguido y los patterns degradan con gracia.

export type TaskProfile = "reasoning" | "code" | "fast" | "long-context";

export const TASK_PROFILES: { id: TaskProfile; label: string; hint: string }[] = [
  { id: "reasoning", label: "Reasoning", hint: "architecture, planning, review, security" },
  { id: "code", label: "Code", hint: "edit, refactor, tests, queries" },
  { id: "fast", label: "Fast", hint: "classify, summarize, small tasks" },
  { id: "long-context", label: "Long context", hint: "big files or docs" },
];

// Prefijos de providers locales: gratis e ilimitados → siempre elegibles, primeros para "fast".
const LOCAL_PREFIXES = /^(ollama|lmstudio|llamacpp|local)\//;

// Candidatos por perfil, en orden de preferencia. Criterio: calidad para el perfil primero, y entre
// comparables, el provider con la cuota gratis más holgada antes (OpenRouter al final: 50/día por
// cuenta es lo más escaso; opencode Zen y Groq son los más generosos).
const PROFILE_CANDIDATES: Record<TaskProfile, RegExp[]> = {
  reasoning: [
    /^opencode\/nemotron-3-ultra-free/,
    /^groq\/.*(deepseek|r1|reasoning|qwen3-32b)/,
    /^google\/gemini-.*(pro|thinking)/,
    /^google\/gemini-.*flash(?!-lite)/,
    /^openrouter\/nvidia\/nemotron-3-ultra.*:free$/,
    /^openrouter\/nvidia\/nemotron-3-super.*:free$/,
    /^openrouter\/nousresearch\/hermes-3.*405b.*:free$/,
    /^openrouter\/qwen\/qwen3-next-80b.*:free$/,
  ],
  code: [
    /^opencode\/big-pickle/,
    /^opencode\/north-mini-code-free/,
    /^groq\/.*(coder|qwen|kimi)/,
    /^mistral\/devstral/,
    /^google\/gemini-.*flash(?!-lite)/,
    /^openrouter\/qwen\/qwen3-coder:free$/,
    /^openrouter\/poolside\/laguna-m\.1:free$/,
    /^openrouter\/cohere\/north-mini-code:free$/,
    /^opencode\/deepseek-v4-flash-free/,
  ],
  fast: [
    LOCAL_PREFIXES,
    /^opencode\/(deepseek-v4-flash-free|hy3-free)/,
    /^groq\/.*llama-3\.3-70b/,
    /^groq\//,
    /^google\/gemini-.*flash-lite/,
    /^google\/gemini-.*flash/,
    /^mistral\/mistral-small/,
    /^openrouter\/.*(nemotron-nano-9b|llama-3\.2-3b|gpt-oss-20b|hy3).*:free$/,
    /^openrouter\/.*gemma.*:free$/,
  ],
  "long-context": [
    /^google\/gemini-.*flash(?!-lite)/, // 1M ctx y tier gratis generoso
    /^openrouter\/qwen\/qwen3-next-80b.*:free$/, // 256k
    /^openrouter\/meta-llama\/llama-3\.3-70b.*:free$/,
    /^opencode\/nemotron-3-ultra-free/,
    /^groq\//,
  ],
};

// Red de seguridad al final de todo perfil: cualquier gratis de Zen, cualquier :free de OpenRouter.
const GENERIC_FREE: RegExp[] = [/^opencode\//, /:free$/];

// Provider de inferencia de un model id = primer segmento ("openrouter/x/y" → "openrouter").
// Los locales colapsan a "local" (sin budget). Para ids sin "/" (ej. modelos de mimo) devuelve el id.
export function inferenceProviderOf(modelId: string): string {
  if (LOCAL_PREFIXES.test(modelId)) return "local";
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

// True si el modelo corre local (sin costo de tokens) — lo usa la economía de prompts (etapa 2).
export function isLocalModel(modelId: string): boolean {
  return LOCAL_PREFIXES.test(modelId);
}

// ── Modo Auto del chat ──
// Valor sentinela para modelByProvider: "que el router elija por turno". No es un model id real (el
// has() de newSession lo ignora); ChatView lo detecta antes de cada prompt, clasifica el mensaje con
// classifyTask y cambia el modelo de la sesión en vivo si conviene.
export const AUTO_MODEL = "__auto__";

// Heurística barata para clasificar un turno de chat en un perfil. Sesgada a "code" (DevFlow es un
// IDE); "reasoning" solo si hay señales de diseño/análisis SIN señales de edición de código.
export function classifyTask(text: string): TaskProfile {
  if (text.length > 24_000) return "long-context"; // mucho contexto inyectado (~6k tokens)
  const t = text.toLowerCase();
  const reasoning = /(arquitect|architect|diseñ|design|planif|plan\b|review|revis|analiz|analy|estrategi|strategy|por qué|why\b|trade-?off|evalu|compar|decidi|decision|audit|segur|security)/;
  const code = /(bug|fix|error|implement|refactor|test|funci[oó]n|function|clase|class|m[eé]todo|method|c[oó]digo|code\b|escrib|write|cre[aá]|agreg|add\b|endpoint|component|migra|query|sql|css|render|compil|build|type(script)?|import|deploy)/;
  if (reasoning.test(t) && !code.test(t)) return "reasoning";
  if (code.test(t)) return "code";
  return t.length < 240 ? "fast" : "code";
}

// ── Economía de prompts ──
// Decide si aplicar los recortes de ahorro de tokens (cap del buffer del editor, síntesis corta) según
// el modo elegido en Settings: "auto" recorta solo con modelos REMOTOS (local no cuesta tokens; un
// modelo desconocido/null se asume remoto — mimo, claude y opencode siempre lo son), "always"/"off"
// fuerzan la decisión a mano.
export type PromptEconomyMode = "auto" | "always" | "off";

export function economyActive(mode: PromptEconomyMode, modelId: string | null): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;
  return !(modelId && isLocalModel(modelId));
}

// Cap de líneas para el archivo del editor inyectado al prompt (los adjuntos ya van capados a 400
// vía readTextFile). Sin economía se manda completo.
export const ECONOMY_EDITOR_MAX_LINES = 400;

// Elige el mejor modelo disponible para el perfil, salteando providers agotados (cuota/cooldown).
// `exclude`: providers a saltear además (ej. reintento tras un rate limit recién detectado).
export function pickModel(
  profile: TaskProfile,
  available: ModelOption[],
  exclude: Set<string> = new Set()
): string | null {
  const { isExhausted } = useQuotaStore.getState();
  const usable = available.filter((m) => {
    const p = inferenceProviderOf(m.value);
    return !exclude.has(p) && !isExhausted(p);
  });
  for (const pattern of [...PROFILE_CANDIDATES[profile], ...GENERIC_FREE]) {
    const hit = usable.find((m) => pattern.test(m.value));
    if (hit) return hit.value;
  }
  return null;
}

// Un request más contra la cuota de hoy del provider de este modelo.
export function recordModelUse(modelId: string): void {
  useQuotaStore.getState().recordUse(inferenceProviderOf(modelId));
}

// Heurística para reconocer errores de rate-limit/cuota en el mensaje de error que burbujea del agente
// ACP (DevFlow no ve el HTTP; el 429 llega como texto). Conservadora: ante la duda NO es cuota.
export function isQuotaError(message: string): boolean {
  return /(429|rate.?limit|quota|too many requests|resource.?exhausted|requests per (minute|day)|daily limit)/i.test(message);
}

// Marca el provider del modelo en cooldown: 10 min por default (límites por minuto), hasta la
// medianoche local si el error menciona límite diario.
export function reportQuotaError(modelId: string, message: string): void {
  const p = inferenceProviderOf(modelId);
  const daily = /(per day|daily|día|free-models-per-day)/i.test(message);
  const until = daily ? new Date(new Date().setHours(24, 0, 0, 0)).getTime() : Date.now() + 10 * 60_000;
  useQuotaStore.getState().setCooldown(p, until);
}

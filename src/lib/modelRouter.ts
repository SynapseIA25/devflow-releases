import type { ModelOption } from "./acpClient";
import { useQuotaStore } from "../store/quotaStore";
import { useSettingsStore } from "../store/settingsStore";
import type { StackFingerprint } from "./stackDetect";
import { fetchModelCatalog, findCatalogModel } from "./modelCatalog";

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

export type TaskKind = "plan" | "execute" | "research" | "fast" | "long-context";

export const TASK_PROFILES: { id: TaskKind; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "architecture, planning, review, security" },
  { id: "execute", label: "Execute", hint: "edit, refactor, tests, queries" },
  { id: "research", label: "Research", hint: "investigate, compare, explain, docs" },
  { id: "fast", label: "Fast", hint: "classify, summarize, small tasks" },
  { id: "long-context", label: "Long context", hint: "big files or docs" },
];

// Prefijos de providers locales: gratis e ilimitados → siempre elegibles, primeros para "fast".
const LOCAL_PREFIXES = /^(ollama|lmstudio|llamacpp|local)\//;

// Candidatos por perfil, en orden de preferencia. Criterio: calidad para el perfil primero, y entre
// comparables, el provider con la cuota gratis más holgada antes (OpenRouter al final: 50/día por
// cuenta es lo más escaso; opencode Zen y Groq son los más generosos).
const PROFILE_CANDIDATES: Record<TaskKind, RegExp[]> = {
  plan: [
    /^opencode\/nemotron-3-ultra-free/,
    /^groq\/.*(deepseek|r1|reasoning|qwen3-32b)/,
    /^google\/gemini-.*(pro|thinking)/,
    /^google\/gemini-.*flash(?!-lite)/,
    /^openrouter\/nvidia\/nemotron-3-ultra.*:free$/,
    /^openrouter\/nvidia\/nemotron-3-super.*:free$/,
    /^openrouter\/nousresearch\/hermes-3.*405b.*:free$/,
    /^openrouter\/qwen\/qwen3-next-80b.*:free$/,
  ],
  execute: [
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
  research: [
    /^opencode\/nemotron-3-ultra-free/,
    /^google\/gemini-.*flash(?!-lite)/,
    /^groq\/.*(deepseek|r1|qwen3-32b)/,
    /^openrouter\/nousresearch\/hermes-3.*405b.*:free$/,
    /^openrouter\/qwen\/qwen3-next-80b.*:free$/,
    /^openrouter\/nvidia\/nemotron-3-(ultra|super).*:free$/,
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

// Providers multi-modelo donde Auto es un default razonable sin que el usuario lo elija a mano
// (Fase 4): tienen candidatos reales en PROFILE_CANDIDATES/GENERIC_FREE, así que el router siempre
// puede elegir algo. Un provider pago de un solo modelo (ej. "anthropic") NUNCA matchea ningún
// pattern — dejarlo en Auto por default sería un accidente silencioso, no una red de seguridad real.
const AUTO_DEFAULT_PROVIDERS = new Set(["opencode"]);

// Preferencia efectiva de modelo para un provider: la elección explícita del usuario si existe (se
// respeta tal cual, sea la que sea), o Auto por default para los providers de AUTO_DEFAULT_PROVIDERS
// si nunca tocó el selector. Usuarios que nunca abrieron el dropdown quedan en Auto sin ninguna
// migración de estado — es una función de LECTURA, no algo que se escriba en modelByProvider.
export function effectiveModelPreference(modelByProvider: Record<string, string>, provider: string): string | undefined {
  const explicit = modelByProvider[provider];
  if (explicit !== undefined) return explicit;
  return AUTO_DEFAULT_PROVIDERS.has(provider) ? AUTO_MODEL : undefined;
}

// Heurística barata para clasificar un turno de chat en un perfil. Sesgada a "execute" (DevFlow es un
// IDE); "plan" solo si hay señales de diseño/análisis SIN señales de edición de código; "research" para
// preguntas de "cómo funciona esto"/comparación de tecnologías sin ninguna de las dos señales anteriores.
// `fingerprint`: señal opcional del stack del proyecto (ver stackDetect.ts, cacheado por el Test
// Strategy Advisor) — hoy solo se usa para desempatar mensajes ambiguos y cortos hacia "execute" en vez
// de "fast" (ver Fase 1 en memoria del proyecto); nunca cambia una clasificación con match de keyword.
export function classifyTask(text: string, fingerprint?: StackFingerprint): TaskKind {
  if (text.length > 24_000) return "long-context"; // mucho contexto inyectado (~6k tokens)
  const t = text.toLowerCase();
  const plan = /(arquitect|architect|diseñ|design|planif|plan\b|review|revis|analiz|analy|estrategi|strategy|por qué|why\b|trade-?off|evalu|compar|decidi|decision|audit|segur|security)/;
  const execute = /(bug|fix|error|implement|refactor|test|funci[oó]n|function|clase|class|m[eé]todo|method|c[oó]digo|code\b|escrib|write|cre[aá]|agreg|add\b|endpoint|component|migra|query|sql|css|render|compil|build|type(script)?|import|deploy)/;
  const research = /(investig|explor|documentaci[oó]n|documentation|how does|c[oó]mo funciona|qu[eé] es\b|what is\b|tutorial|explica|explain|entend|understand|research\b|look ?up|averigu|informate)/;
  if (execute.test(t)) return "execute";
  if (plan.test(t)) return "plan";
  if (research.test(t)) return "research";
  if (fingerprint?.isMobile && t.length < 240) return "execute";
  return t.length < 240 ? "fast" : "execute";
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

// Elige el mejor modelo disponible para el perfil, salteando providers agotados (cuota/cooldown),
// aplicando el techo de costo si hay uno configurado (Fase 2), y respetando un pin del usuario para
// este TaskKind si sigue disponible (Fase 5). `exclude`: providers a saltear además (ej. reintento
// tras un rate limit recién detectado). Async por el catálogo de precios (Fase 2) — solo se busca
// cuando hay un ceiling configurado, así que sin ceiling el costo real es idéntico al de antes (ningún
// await extra en el camino feliz de siempre).
export async function pickModel(
  kind: TaskKind,
  available: ModelOption[],
  exclude: Set<string> = new Set()
): Promise<string | null> {
  const { isExhausted } = useQuotaStore.getState();
  const usable = available.filter((m) => {
    const p = inferenceProviderOf(m.value);
    return !exclude.has(p) && !isExhausted(p);
  });

  const ceiling = useSettingsStore.getState().costCeilingUsdPerMTok;
  let filtered = usable;
  if (ceiling != null) {
    const catalog = await fetchModelCatalog().catch(() => []);
    if (catalog.length) {
      filtered = usable.filter((m) => {
        const pid = inferenceProviderOf(m.value);
        const c = findCatalogModel(catalog, pid, m.value.slice(pid.length + 1));
        if (!c || (c.costInput == null && c.costOutput == null)) return true; // gratis/desconocido nunca se penaliza
        return Math.max(c.costInput ?? 0, c.costOutput ?? 0) <= ceiling;
      });
    }
  }

  const pin = useSettingsStore.getState().pinnedModelByTaskKind[kind];
  if (pin) {
    const hit = filtered.find((m) => m.value === pin);
    if (hit) return hit.value;
    // pinneado pero agotado/fuera del ceiling/no disponible en esta sesión: seguimos con gracia abajo
  }

  for (const pattern of [...PROFILE_CANDIDATES[kind], ...GENERIC_FREE]) {
    const hit = filtered.find((m) => pattern.test(m.value));
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

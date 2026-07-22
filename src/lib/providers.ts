import type { TaskProfile } from "./modelRouter";

// DevFlow es un HOST de agentes ACP: no hace inferencia ni guarda credenciales de modelos. Por eso un
// provider ya NO tiene apiKey/models/defaultModel/enabled (eso lo gestiona el CLI del agente). Si tiene
// `acp`, ChatView lo spawnea como proceso hijo y habla ACP; los modelos se descubren en runtime
// (ver acpClient.newSession → onModelOptions) y se eligen en el selector de modelo del chat.
export type ProviderConfig = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  docsUrl?: string;
  // Comando del agente ACP. Su ausencia = provider "directo" aún NO implementado (requiere adaptador).
  // sidecar: true = "command" es un nombre lógico bundleado por Tauri (externalBin), no algo en PATH;
  // se resuelve a una ruta absoluta en runtime (ver acpClient.ensureStarted).
  acp?: { command: string; args: string[]; sidecar?: boolean };
  // true = este provider se habla por el servidor HTTP+SSE nativo de OpenCode (opencodeClient.ts,
  // `opencode serve`) en vez de ACP-por-stdio — mutuamente excluyente con `acp` para un mismo
  // provider (hoy solo "opencode" lo usa; es el primer paso hacia una herramienta de codificación
  // propia de DevFlow, ver docs/o el roadmap en memoria del proyecto).
  nativeHttp?: boolean;
};

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    // Claude Code vía el adaptador ACP oficial de Zed (@zed-industries/claude-code-acp): envuelve el
    // Claude Code SDK y habla ACP protocolVersion 1 (verificado por handshake). Auth: usa la sesión del
    // CLI `claude` (correr `claude /login` una vez). En Windows, acp_start lo spawnea vía `cmd /C npx …`.
    // npx -y baja el paquete la primera vez (cacheado después) — la primera sesión puede tardar unos seg.
    id: "anthropic",
    name: "Claude Code",
    description: "Agente de Anthropic vía adaptador ACP. Requiere el CLI `claude` logueado (`claude /login`).",
    color: "#d4a574",
    icon: "◈",
    docsUrl: "https://docs.anthropic.com",
    acp: { command: "npx", args: ["-y", "@zed-industries/claude-code-acp"] },
  },
  {
    // Rebrandeado de cara al usuario como "DevFlow Code" (id interno sigue siendo "opencode" —
    // cambiarlo tocaría decenas de archivos sin ningún beneficio para el usuario, ver memoria del
    // proyecto). Por dentro sigue siendo OpenCode upstream (el mismo proyecto del que MiMo es fork,
    // pero moderno: v1.x). Es la vía multi-LLM de DevFlow: sin configurar nada trae los modelos
    // gratuitos de OpenCode Zen, y con las API keys de Settings (OpenRouter/Google/Groq/Mistral, ver
    // PROVIDER_KEY_SPECS) expone los modelos de esos providers en el selector del chat. Bundleado
    // como sidecar de Tauri (binario nativo de `opencode-ai`, ver scripts/fetch-opencode-sidecar.mjs)
    // — no requiere instalación aparte, DevFlow lo trae adentro. `nativeHttp: true`: se habla por el
    // servidor HTTP+SSE propio del binario (opencodeClient.ts, `opencode serve`), no por
    // ACP-sobre-stdio como el resto.
    id: "opencode",
    name: "DevFlow Code",
    description: "DevFlow's built-in multi-LLM coding agent — free models out of the box; add API keys in Settings for OpenRouter, Gemini, Groq and more.",
    color: "#7c3aed",
    icon: "◆",
    docsUrl: "https://opencode.ai/docs",
    nativeHttp: true,
  },
];

// Providers de inferencia cuya API key se carga en Settings y se inyecta como env var al proceso
// del agente OpenCode (acp_start → envs). OpenCode los detecta solo por la presencia de la var
// (verificado con `opencode acp` 1.18.3: los modelos del provider aparecen en configOptions).
// keyed por id estable — settingsStore.providerKeys usa estos ids.
export type ProviderKeySpec = {
  id: string;
  label: string;
  envVar: string;
  placeholder: string;
  // Dónde conseguir la key (y si tiene tier gratuito, mencionarlo en el label de la UI).
  keyUrl: string;
  freeTier: string;
};

export const PROVIDER_KEY_SPECS: ProviderKeySpec[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    placeholder: "sk-or-v1-…",
    keyUrl: "https://openrouter.ai/keys",
    freeTier: "One key, 300+ models — includes free models (\":free\" and the Free Models Router).",
  },
  {
    id: "google",
    label: "Google Gemini",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    placeholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    freeTier: "Free tier available (Gemini Flash) with generous daily quota.",
  },
  {
    id: "groq",
    label: "Groq",
    envVar: "GROQ_API_KEY",
    placeholder: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    freeTier: "Free tier available — very fast Llama/Qwen inference.",
  },
  {
    id: "mistral",
    label: "Mistral",
    envVar: "MISTRAL_API_KEY",
    placeholder: "…",
    keyUrl: "https://console.mistral.ai/api-keys",
    freeTier: "Free tier available (La Plateforme experiment plan).",
  },
];

export type AgentConfig = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  skills: string[];
  status: "active" | "inactive" | "error";
  // Agentes expertos por área (pilar 1): si expertArea está presente, el agente es un experto
  // preconfigurado. areaKeywords alimenta el router determinista (expertRouter.ts). Los expertos NO
  // se muestran en el selector del chat por defecto (se usan desde la vista Equipo o asociándolos a
  // un proyecto) para no saturarlo.
  expertArea?: string;
  areaKeywords?: string[];
  // Perfil de tarea para el router de modelos (modelRouter.ts): cuando el agente corre sobre un
  // provider multi-modelo (OpenCode), la sesión elige el mejor modelo GRATIS disponible para este
  // perfil (cuota-consciente). Sin perfil (o sin match) → el default del agente, como siempre.
  taskProfile?: TaskProfile;
};

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Agente de Anthropic. Razonamiento avanzado para tareas complejas de desarrollo.",
    icon: "◈",
    color: "#d4a574",
    providerId: "anthropic",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are Claude, an AI assistant made by Anthropic.",
    skills: ["file-edit", "terminal", "search", "analysis"],
    status: "inactive",
  },
  {
    id: "opencode-agent",
    name: "DevFlow Code",
    description: "DevFlow's built-in multi-LLM agent: free models included, plus any provider you add a key for (OpenRouter, Gemini, Groq…).",
    icon: "◆",
    color: "#7c3aed",
    providerId: "opencode",
    model: "",
    systemPrompt: "",
    skills: ["file-edit", "terminal", "git", "search"],
    status: "inactive",
  },
];

// ── Agentes expertos por área (pilar 1) ──
// 9 roles preconfigurados, todos sobre DevFlow Code (nativo — gana permission-scoping real y memoria
// persistente por proyecto, ver Fases 2-3 en memoria del proyecto). Cada uno con un system prompt de
// especialidad (se inyecta al abrir la sesión) y keywords para el router determinista.
const mkExpert = (
  id: string, name: string, icon: string, color: string, area: string,
  description: string, systemPrompt: string, skills: string[], areaKeywords: string[],
  taskProfile: TaskProfile
): AgentConfig => ({
  id, name, icon, color, providerId: "opencode", model: "",
  description, systemPrompt: `${systemPrompt}\n\nRespondé siempre en español, de forma concreta y accionable.`,
  skills, expertArea: area, areaKeywords, taskProfile, status: "inactive",
});

export const EXPERT_AGENTS: AgentConfig[] = [
  mkExpert("expert-arquitecto", "Arquitecto", "🏛️", "#7c3aed", "arquitectura",
    "Diseño de arquitectura, patrones, refactor y deuda técnica.",
    "Sos un arquitecto de software senior. Te enfocás en arquitectura, separación de responsabilidades, patrones de diseño, refactorización, escalabilidad y reducción de deuda técnica. Pensás en módulos, acoplamiento y dependencias antes de escribir código.",
    ["analysis", "refactor", "search"],
    ["arquitectura", "patron", "patrones", "refactor", "diseño", "deuda", "escalabilidad", "modulo", "acoplamiento", "dependencias", "estructura", "solid"], "reasoning"),
  mkExpert("expert-frontend", "Frontend / UI", "🎨", "#38bdf8", "frontend",
    "Interfaces, UX, componentes, accesibilidad y estado del cliente.",
    "Sos un experto en frontend. Te enfocás en UI/UX, componentes (React/Vue/Svelte), accesibilidad, manejo de estado, estilos y performance de render en el cliente.",
    ["file-edit", "search"],
    ["frontend", "ui", "ux", "react", "vue", "svelte", "componente", "css", "estilos", "accesibilidad", "estado", "render", "browser", "cliente", "responsive"], "code"),
  mkExpert("expert-backend", "Backend / APIs", "🔌", "#22c55e", "backend",
    "APIs, contratos, autenticación e integraciones del servidor.",
    "Sos un experto en backend y APIs. Te enfocás en diseño de APIs (REST/GraphQL), contratos, autenticación/autorización, integraciones, validación y lógica de servidor.",
    ["file-edit", "terminal", "search"],
    ["backend", "api", "apis", "rest", "graphql", "endpoint", "servidor", "auth", "autenticacion", "integracion", "contrato", "servicio", "middleware"], "code"),
  mkExpert("expert-db", "Base de Datos", "🗄️", "#f59e0b", "base-de-datos",
    "Esquema, migraciones, queries e índices.",
    "Sos un experto en bases de datos. Te enfocás en diseño de esquema, migraciones, optimización de queries, índices, modelado de datos y ORMs (SQL y NoSQL).",
    ["file-edit", "terminal"],
    ["base de datos", "bd", "sql", "query", "consulta", "migracion", "esquema", "indice", "tabla", "orm", "postgres", "sqlite", "mysql", "mongo", "join"], "code"),
  mkExpert("expert-devops", "DevOps / Infra", "⚙️", "#06b6d4", "devops",
    "CI/CD, IaC, contenedores, cloud y despliegue.",
    "Sos un experto en DevOps e infraestructura. Te enfocás en CI/CD, infraestructura como código, contenedores (Docker/Kubernetes), cloud, automatización de despliegues y pipelines.",
    ["terminal", "file-edit"],
    ["devops", "ci", "cd", "pipeline", "docker", "contenedor", "kubernetes", "k8s", "deploy", "despliegue", "infra", "infraestructura", "terraform", "cloud", "aws", "gcp"], "code"),
  mkExpert("expert-sre", "SRE / Observabilidad", "📡", "#ef4444", "sre",
    "Confiabilidad, monitoreo, incidentes y performance.",
    "Sos un Site Reliability Engineer. Te enfocás en confiabilidad, observabilidad (métricas/logs/traces), monitoreo, alertas, manejo de incidentes, performance, latencia y SLOs.",
    ["terminal", "analysis"],
    ["sre", "observabilidad", "monitoreo", "metricas", "logs", "trace", "incidente", "performance", "latencia", "disponibilidad", "slo", "alerta", "confiabilidad", "uptime"], "reasoning"),
  mkExpert("expert-seguridad", "Seguridad", "🔒", "#dc2626", "seguridad",
    "Vulnerabilidades, authz, secrets y dependencias.",
    "Sos un experto en seguridad de aplicaciones. Te enfocás en vulnerabilidades (OWASP), autenticación/autorización, manejo de secretos, inyección, XSS/CSRF, cifrado y seguridad de dependencias.",
    ["analysis", "search"],
    ["seguridad", "vulnerabilidad", "vuln", "autorizacion", "secreto", "secrets", "xss", "csrf", "inyeccion", "cifrado", "dependencia", "cve", "owasp", "token", "permiso"], "reasoning"),
  mkExpert("expert-qa", "QA / Testing", "🧪", "#a3e635", "qa",
    "Tests, cobertura y casos borde.",
    "Sos un experto en QA y testing. Te enfocás en tests unitarios/integración/e2e, cobertura, casos borde, mocks/fixtures, y detección de regresiones. Priorizás la robustez.",
    ["file-edit", "terminal"],
    ["test", "tests", "testing", "prueba", "cobertura", "qa", "unitario", "e2e", "integracion", "caso borde", "mock", "fixture", "regresion", "vitest", "jest"], "code"),
  mkExpert("expert-producto", "Producto / Negocio", "📋", "#ec4899", "producto",
    "Requisitos, historias, dominio y prioridad.",
    "Sos un experto en producto y modelo de negocio. Te enfocás en requisitos, historias de usuario, modelado del dominio, priorización, alcance de MVP y traducir necesidades de negocio a features.",
    ["analysis", "search"],
    ["producto", "negocio", "requisito", "historia", "usuario", "prioridad", "roadmap", "feature", "dominio", "stakeholder", "alcance", "mvp", "backlog"], "fast"),
];

// Los expertos se agregan a DEFAULT_AGENTS tras su definición (evita el TDZ de referenciarlos en el
// literal de DEFAULT_AGENTS, que se evalúa antes que este const). Quedan como agentes "default"
// (seedeados/persistidos/editables por agentsStore), tag `expertArea` los distingue.
DEFAULT_AGENTS.push(...EXPERT_AGENTS);

// True si el agente es un experto por área (pilar 1).
export const isExpertAgent = (agent: Pick<AgentConfig, "expertArea">) => !!agent.expertArea;

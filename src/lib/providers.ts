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
    // Claude Agent SDK (dependencia propia del paquete, no requiere el CLI `claude` instalado aparte) y
    // habla ACP protocolVersion 1 (verificado por handshake). Auth: API key (ANTHROPIC_API_KEY, ver
    // PROVIDER_KEY_SPECS) en vez de la sesión OAuth de `claude /login` — evita rutear por credenciales
    // de suscripción Pro/Max en un producto de terceros (no permitido por los términos de Anthropic).
    // En Windows, acp_start lo spawnea vía `cmd /C npx …`. npx -y baja el paquete la primera vez
    // (cacheado después) — la primera sesión puede tardar unos seg.
    id: "anthropic",
    name: "Claude Code",
    description: "Anthropic's agent via the ACP adapter. Add an API key in Settings to enable it.",
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

// Keys que se cargan en Settings y se inyectan como env var a TODOS los procesos ACP al spawnearlos
// (acpClient.providerKeysEnv → acp_start → envs). OpenCode detecta los suyos solo por la presencia
// de la var (verificado con `opencode acp` 1.18.3: los modelos del provider aparecen en
// configOptions); el adaptador claude-code-acp lee ANTHROPIC_API_KEY vía el Claude Agent SDK.
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
    id: "anthropic",
    label: "Anthropic (Claude Code)",
    envVar: "ANTHROPIC_API_KEY",
    placeholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    freeTier: "Pay-as-you-go via Anthropic Console — no subscription needed, billed per token.",
  },
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
    description: "Anthropic's agent. Advanced reasoning for complex development tasks.",
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
  description, systemPrompt: `${systemPrompt}\n\nIMPORTANT: always reply in the SAME language as the user's most recent message — never default to any other language. Be concrete and actionable.`,
  skills, expertArea: area, areaKeywords, taskProfile, status: "inactive",
});

// Keywords en español e inglés a propósito: el router determinista (expertRouter.ts) hace substring/
// word-boundary matching contra lo que el usuario escribe, y la herramienta es de uso global — un
// usuario hispanohablante y uno angloparlante tienen que poder disparar la misma sugerencia de experto.
export const EXPERT_AGENTS: AgentConfig[] = [
  mkExpert("expert-arquitecto", "Architect", "🏛️", "#7c3aed", "architecture",
    "Architecture design, patterns, refactoring and technical debt.",
    "You are a senior software architect. You focus on architecture, separation of concerns, design patterns, refactoring, scalability and reducing technical debt. You think in terms of modules, coupling and dependencies before writing code.",
    ["analysis", "refactor", "search"],
    ["architecture", "pattern", "patterns", "refactor", "design", "debt", "scalability", "module", "coupling", "dependencies", "structure", "solid",
     "arquitectura", "patron", "patrones", "diseño", "deuda", "escalabilidad", "modulo", "acoplamiento", "dependencias", "estructura"], "reasoning"),
  mkExpert("expert-frontend", "Frontend / UI", "🎨", "#38bdf8", "frontend",
    "Interfaces, UX, components, accessibility and client-side state.",
    "You are a frontend expert. You focus on UI/UX, components (React/Vue/Svelte), accessibility, state management, styling and client-side render performance.",
    ["file-edit", "search"],
    ["frontend", "ui", "ux", "react", "vue", "svelte", "component", "css", "styles", "accessibility", "state", "render", "browser", "client", "responsive",
     "componente", "estilos", "accesibilidad", "estado", "cliente"], "code"),
  mkExpert("expert-backend", "Backend / APIs", "🔌", "#22c55e", "backend",
    "APIs, contracts, authentication and server-side integrations.",
    "You are a backend and APIs expert. You focus on API design (REST/GraphQL), contracts, authentication/authorization, integrations, validation and server-side logic.",
    ["file-edit", "terminal", "search"],
    ["backend", "api", "apis", "rest", "graphql", "endpoint", "server", "auth", "authentication", "integration", "contract", "service", "middleware",
     "servidor", "autenticacion", "integracion", "contrato", "servicio"], "code"),
  mkExpert("expert-db", "Database", "🗄️", "#f59e0b", "database",
    "Schema, migrations, queries and indexes.",
    "You are a database expert. You focus on schema design, migrations, query optimization, indexes, data modeling and ORMs (SQL and NoSQL).",
    ["file-edit", "terminal"],
    ["database", "db", "sql", "query", "migration", "schema", "index", "table", "orm", "postgres", "sqlite", "mysql", "mongo", "join",
     "base de datos", "bd", "consulta", "migracion", "esquema", "indice", "tabla"], "code"),
  mkExpert("expert-devops", "DevOps / Infra", "⚙️", "#06b6d4", "devops",
    "CI/CD, IaC, containers, cloud and deployment.",
    "You are a DevOps and infrastructure expert. You focus on CI/CD, infrastructure as code, containers (Docker/Kubernetes), cloud, deployment automation and pipelines.",
    ["terminal", "file-edit"],
    ["devops", "ci", "cd", "pipeline", "docker", "container", "kubernetes", "k8s", "deploy", "deployment", "infra", "infrastructure", "terraform", "cloud", "aws", "gcp",
     "contenedor", "despliegue", "infraestructura"], "code"),
  mkExpert("expert-sre", "SRE / Observability", "📡", "#ef4444", "sre",
    "Reliability, monitoring, incidents and performance.",
    "You are a Site Reliability Engineer. You focus on reliability, observability (metrics/logs/traces), monitoring, alerting, incident response, performance, latency and SLOs.",
    ["terminal", "analysis"],
    ["sre", "observability", "monitoring", "metrics", "logs", "trace", "incident", "performance", "latency", "availability", "slo", "alert", "reliability", "uptime",
     "observabilidad", "monitoreo", "metricas", "incidente", "latencia", "disponibilidad", "alerta", "confiabilidad"], "reasoning"),
  mkExpert("expert-seguridad", "Security", "🔒", "#dc2626", "security",
    "Vulnerabilities, authz, secrets and dependencies.",
    "You are an application security expert. You focus on vulnerabilities (OWASP), authentication/authorization, secrets management, injection, XSS/CSRF, encryption and dependency security.",
    ["analysis", "search"],
    ["security", "vulnerability", "vuln", "authorization", "secret", "secrets", "xss", "csrf", "injection", "encryption", "dependency", "cve", "owasp", "token", "permission",
     "seguridad", "vulnerabilidad", "autorizacion", "secreto", "inyeccion", "cifrado", "dependencia", "permiso"], "reasoning"),
  mkExpert("expert-qa", "QA / Testing", "🧪", "#a3e635", "qa",
    "Tests, coverage and edge cases.",
    "You are a QA and testing expert. You focus on unit/integration/e2e tests, coverage, edge cases, mocks/fixtures, and regression detection. You prioritize robustness.",
    ["file-edit", "terminal"],
    ["test", "tests", "testing", "coverage", "qa", "unit", "e2e", "integration", "edge case", "mock", "fixture", "regression", "vitest", "jest",
     "prueba", "cobertura", "unitario", "integracion", "caso borde", "regresion"], "code"),
  mkExpert("expert-producto", "Product / Business", "📋", "#ec4899", "product",
    "Requirements, stories, domain and prioritization.",
    "You are a product and business-model expert. You focus on requirements, user stories, domain modeling, prioritization, MVP scope and translating business needs into features.",
    ["analysis", "search"],
    ["product", "business", "requirement", "story", "user", "priority", "roadmap", "feature", "domain", "stakeholder", "scope", "mvp", "backlog",
     "producto", "negocio", "requisito", "historia", "usuario", "prioridad", "dominio", "alcance"], "fast"),
];

// Los expertos se agregan a DEFAULT_AGENTS tras su definición (evita el TDZ de referenciarlos en el
// literal de DEFAULT_AGENTS, que se evalúa antes que este const). Quedan como agentes "default"
// (seedeados/persistidos/editables por agentsStore), tag `expertArea` los distingue.
DEFAULT_AGENTS.push(...EXPERT_AGENTS);

// True si el agente es un experto por área (pilar 1).
export const isExpertAgent = (agent: Pick<AgentConfig, "expertArea">) => !!agent.expertArea;

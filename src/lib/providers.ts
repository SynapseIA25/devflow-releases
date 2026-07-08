export type ProviderConfig = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
  isLocal?: boolean;
  docsUrl?: string;
  // Si está presente, este provider habla el Agent Client Protocol — ChatView lo enruta por
  // acpClient en vez del mock, spawneando este comando como proceso hijo (ver acp_start en Rust).
  acp?: { command: string; args: string[] };
};

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4 Turbo y más",
    color: "#10a37f",
    icon: "⬡",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    defaultModel: "gpt-4o",
    enabled: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet, Haiku, Opus",
    color: "#d4a574",
    icon: "◈",
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    defaultModel: "claude-sonnet-4-6",
    enabled: false,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Modelos locales — sin internet",
    color: "#4ade80",
    icon: "◉",
    apiKey: "",
    baseUrl: "http://localhost:11434",
    models: ["llama3", "codellama", "mistral", "phi3", "gemma2"],
    defaultModel: "llama3",
    enabled: false,
    isLocal: true,
  },
  {
    id: "mimo",
    name: "MiMo Code",
    description: "Agente de código de Xiaomi",
    color: "#f97316",
    icon: "⬡",
    apiKey: "",
    baseUrl: "https://mimo.xiaomi.com",
    models: ["mimo-coder"],
    defaultModel: "mimo-coder",
    enabled: false,
    docsUrl: "https://mimo.xiaomi.com/coder",
    acp: { command: "mimo", args: ["acp", "--print-logs", "--log-level", "ERROR"] },
  },
  {
    // INTEGRACIÓN DE REFERENCIA, NO PRODUCTIVA (decisión Fase 3, 2026-06-26).
    // Hermes habla ACP de verdad y la integración funciona end-to-end, pero corre sobre
    // Ollama local con llama3.2:3b — un modelo de 3B cuyo system prompt casi llena el
    // contexto (4096 tok), así que nunca emite tool calls confiables y es lento (~40s).
    // Sirve como prueba de que DevFlow soporta múltiples agentes ACP simultáneos, no como
    // agente de trabajo real. Para volverlo productivo: apuntar `model.base_url`/`model.default`
    // de Hermes (vía `hermes config set`) a un modelo más grande con buen function-calling.
    // Los campos models/baseUrl/defaultModel de abajo son cosméticos para Settings (el modelo
    // real lo fija la config global de Hermes, no estos valores).
    id: "hermes",
    name: "Nous Hermes",
    description: "Agente multi-plataforma con memoria (referencia, no productivo)",
    color: "#a78bfa",
    icon: "⬡",
    apiKey: "",
    baseUrl: "https://hermes-agent.nousresearch.com",
    models: ["hermes-3", "hermes-2-pro"],
    defaultModel: "hermes-3",
    enabled: false,
    docsUrl: "https://hermes-agent.nousresearch.com",
    // Ruta absoluta en vez de confiar en PATH: el venv recién se creó y el proceso de Tauri
    // ya corriendo no tiene el PATH actualizado por el instalador hasta que se reinicie.
    // Mismo criterio que PROJECT_CWD — hardcodeado a esta máquina, no hay UI de config real todavía.
    acp: { command: "C:\\Users\\MSI\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe", args: ["acp"] },
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
  platforms?: string[];
  executionBackend?: "local" | "docker" | "ssh";
  memoryEnabled?: boolean;
  status: "active" | "inactive" | "error";
  // Agentes expertos por área (pilar 1): si expertArea está presente, el agente es un experto
  // preconfigurado. areaKeywords alimenta el router determinista (expertRouter.ts). Los expertos NO
  // se muestran en el selector del chat por defecto (se usan desde la vista Equipo o asociándolos a
  // un proyecto) para no saturarlo.
  expertArea?: string;
  areaKeywords?: string[];
};

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: "mimo-coder",
    name: "MiMo Code",
    description: "Agente especializado en programación. Edita archivos, ejecuta tests y refactoriza código.",
    icon: "⬡",
    color: "#f97316",
    providerId: "mimo",
    model: "mimo-coder",
    systemPrompt: "You are MiMo Code, an expert coding assistant. Help with code editing, refactoring, and debugging.",
    skills: ["file-edit", "terminal", "git", "search"],
    status: "inactive",
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    description: "Agente multi-plataforma de Nous Research. Memoria persistente, subagentes y automatización.",
    icon: "⬡",
    color: "#a78bfa",
    providerId: "hermes",
    model: "hermes-3",
    systemPrompt: "You are Hermes, a powerful multi-platform agent with persistent memory.",
    skills: ["web-search", "browser", "file-edit", "terminal", "scheduling"],
    platforms: ["telegram", "discord", "slack", "email", "cli"],
    executionBackend: "local",
    memoryEnabled: true,
    status: "inactive",
  },
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
];

// ── Agentes expertos por área (pilar 1) ──
// 9 roles preconfigurados, todos sobre MiMo (el único agente capaz). Cada uno con un system prompt de
// especialidad (se inyecta al abrir la sesión ACP) y keywords para el router determinista.
const mkExpert = (
  id: string, name: string, icon: string, color: string, area: string,
  description: string, systemPrompt: string, skills: string[], areaKeywords: string[]
): AgentConfig => ({
  id, name, icon, color, providerId: "mimo", model: "mimo-coder",
  description, systemPrompt: `${systemPrompt}\n\nRespondé siempre en español, de forma concreta y accionable.`,
  skills, expertArea: area, areaKeywords, status: "inactive",
});

export const EXPERT_AGENTS: AgentConfig[] = [
  mkExpert("expert-arquitecto", "Arquitecto", "🏛️", "#7c3aed", "arquitectura",
    "Diseño de arquitectura, patrones, refactor y deuda técnica.",
    "Sos un arquitecto de software senior. Te enfocás en arquitectura, separación de responsabilidades, patrones de diseño, refactorización, escalabilidad y reducción de deuda técnica. Pensás en módulos, acoplamiento y dependencias antes de escribir código.",
    ["analysis", "refactor", "search"],
    ["arquitectura", "patron", "patrones", "refactor", "diseño", "deuda", "escalabilidad", "modulo", "acoplamiento", "dependencias", "estructura", "solid"]),
  mkExpert("expert-frontend", "Frontend / UI", "🎨", "#38bdf8", "frontend",
    "Interfaces, UX, componentes, accesibilidad y estado del cliente.",
    "Sos un experto en frontend. Te enfocás en UI/UX, componentes (React/Vue/Svelte), accesibilidad, manejo de estado, estilos y performance de render en el cliente.",
    ["file-edit", "search"],
    ["frontend", "ui", "ux", "react", "vue", "svelte", "componente", "css", "estilos", "accesibilidad", "estado", "render", "browser", "cliente", "responsive"]),
  mkExpert("expert-backend", "Backend / APIs", "🔌", "#22c55e", "backend",
    "APIs, contratos, autenticación e integraciones del servidor.",
    "Sos un experto en backend y APIs. Te enfocás en diseño de APIs (REST/GraphQL), contratos, autenticación/autorización, integraciones, validación y lógica de servidor.",
    ["file-edit", "terminal", "search"],
    ["backend", "api", "apis", "rest", "graphql", "endpoint", "servidor", "auth", "autenticacion", "integracion", "contrato", "servicio", "middleware"]),
  mkExpert("expert-db", "Base de Datos", "🗄️", "#f59e0b", "base-de-datos",
    "Esquema, migraciones, queries e índices.",
    "Sos un experto en bases de datos. Te enfocás en diseño de esquema, migraciones, optimización de queries, índices, modelado de datos y ORMs (SQL y NoSQL).",
    ["file-edit", "terminal"],
    ["base de datos", "bd", "sql", "query", "consulta", "migracion", "esquema", "indice", "tabla", "orm", "postgres", "sqlite", "mysql", "mongo", "join"]),
  mkExpert("expert-devops", "DevOps / Infra", "⚙️", "#06b6d4", "devops",
    "CI/CD, IaC, contenedores, cloud y despliegue.",
    "Sos un experto en DevOps e infraestructura. Te enfocás en CI/CD, infraestructura como código, contenedores (Docker/Kubernetes), cloud, automatización de despliegues y pipelines.",
    ["terminal", "file-edit"],
    ["devops", "ci", "cd", "pipeline", "docker", "contenedor", "kubernetes", "k8s", "deploy", "despliegue", "infra", "infraestructura", "terraform", "cloud", "aws", "gcp"]),
  mkExpert("expert-sre", "SRE / Observabilidad", "📡", "#ef4444", "sre",
    "Confiabilidad, monitoreo, incidentes y performance.",
    "Sos un Site Reliability Engineer. Te enfocás en confiabilidad, observabilidad (métricas/logs/traces), monitoreo, alertas, manejo de incidentes, performance, latencia y SLOs.",
    ["terminal", "analysis"],
    ["sre", "observabilidad", "monitoreo", "metricas", "logs", "trace", "incidente", "performance", "latencia", "disponibilidad", "slo", "alerta", "confiabilidad", "uptime"]),
  mkExpert("expert-seguridad", "Seguridad", "🔒", "#dc2626", "seguridad",
    "Vulnerabilidades, authz, secrets y dependencias.",
    "Sos un experto en seguridad de aplicaciones. Te enfocás en vulnerabilidades (OWASP), autenticación/autorización, manejo de secretos, inyección, XSS/CSRF, cifrado y seguridad de dependencias.",
    ["analysis", "search"],
    ["seguridad", "vulnerabilidad", "vuln", "autorizacion", "secreto", "secrets", "xss", "csrf", "inyeccion", "cifrado", "dependencia", "cve", "owasp", "token", "permiso"]),
  mkExpert("expert-qa", "QA / Testing", "🧪", "#a3e635", "qa",
    "Tests, cobertura y casos borde.",
    "Sos un experto en QA y testing. Te enfocás en tests unitarios/integración/e2e, cobertura, casos borde, mocks/fixtures, y detección de regresiones. Priorizás la robustez.",
    ["file-edit", "terminal"],
    ["test", "tests", "testing", "prueba", "cobertura", "qa", "unitario", "e2e", "integracion", "caso borde", "mock", "fixture", "regresion", "vitest", "jest"]),
  mkExpert("expert-producto", "Producto / Negocio", "📋", "#ec4899", "producto",
    "Requisitos, historias, dominio y prioridad.",
    "Sos un experto en producto y modelo de negocio. Te enfocás en requisitos, historias de usuario, modelado del dominio, priorización, alcance de MVP y traducir necesidades de negocio a features.",
    ["analysis", "search"],
    ["producto", "negocio", "requisito", "historia", "usuario", "prioridad", "roadmap", "feature", "dominio", "stakeholder", "alcance", "mvp", "backlog"]),
];

// Los expertos se agregan a DEFAULT_AGENTS tras su definición (evita el TDZ de referenciarlos en el
// literal de DEFAULT_AGENTS, que se evalúa antes que este const). Quedan como agentes "default"
// (seedeados/persistidos/editables por agentsStore), tag `expertArea` los distingue.
DEFAULT_AGENTS.push(...EXPERT_AGENTS);

// True si el agente es un experto por área (pilar 1).
export const isExpertAgent = (agent: Pick<AgentConfig, "expertArea">) => !!agent.expertArea;

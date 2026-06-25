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
    id: "hermes",
    name: "Nous Hermes",
    description: "Agente multi-plataforma con memoria",
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

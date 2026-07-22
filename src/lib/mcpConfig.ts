// Gestión del `opencode.json` de la carpeta de proyecto — OpenCode mergea config de proyecto (esta)
// con la global (~/.config/opencode/opencode.jsonc), con la de proyecto ganando (confirmado en los
// docs oficiales: opencode.ai/docs/config). Soporta una clave `mcp` nativa (McpLocalConfig en el SDK:
// {type:"local", command, environment?, enabled?}) — mismo shape que ya usábamos acá, no hace falta
// transformar nada. Reemplaza el mecanismo viejo (`mimocode.json`, específico del fork MiMo) tras el
// retiro del provider MiMo (Fase 4).
//
// A diferencia de spawnear algo nosotros: no lanzamos ningún proceso acá. El propio servidor de
// OpenCode (`opencode serve`) lee esta config y levanta el MCP server como proceso hijo suyo al abrir
// una sesión con esta carpeta como directory.
import { readTextFile, writeTextFile } from "./tauriApi";

export type McpConfigEntry = {
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  enabled: boolean;
};

type OpencodeProjectConfig = {
  $schema?: string;
  mcp?: Record<string, McpConfigEntry>;
  [key: string]: unknown;
};

function configPath(projectPath: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  return projectPath.endsWith(sep) ? `${projectPath}opencode.json` : `${projectPath}${sep}opencode.json`;
}

// Lee y parsea el config actual. Si no existe o está corrupto, devuelve una base vacía (nunca tira)
// — así podemos hacer merge sin pisar otras claves del usuario (agents, providers, etc.).
async function readConfig(projectPath: string): Promise<OpencodeProjectConfig> {
  try {
    return JSON.parse(await readTextFile(configPath(projectPath))) as OpencodeProjectConfig;
  } catch {
    return {};
  }
}

export async function readMcpServers(projectPath: string): Promise<Record<string, McpConfigEntry>> {
  return (await readConfig(projectPath)).mcp ?? {};
}

// Agrega o actualiza un MCP server en `opencode.json` (merge, preservando el resto del archivo).
export async function setMcpServer(
  projectPath: string,
  id: string,
  command: string[],
  environment: Record<string, string> | undefined,
  enabled: boolean
): Promise<void> {
  const cfg = await readConfig(projectPath);
  cfg.$schema = cfg.$schema ?? "https://opencode.ai/config.json";
  cfg.mcp = cfg.mcp ?? {};
  const entry: McpConfigEntry = { type: "local", command, enabled };
  const env = environment && Object.fromEntries(Object.entries(environment).filter(([, v]) => v.trim() !== ""));
  if (env && Object.keys(env).length > 0) entry.environment = env;
  cfg.mcp[id] = entry;
  await writeTextFile(configPath(projectPath), JSON.stringify(cfg, null, 2));
}

// Quita un MCP server del config (no-op si no estaba).
export async function removeMcpServer(projectPath: string, id: string): Promise<void> {
  const cfg = await readConfig(projectPath);
  if (cfg.mcp && id in cfg.mcp) {
    delete cfg.mcp[id];
    await writeTextFile(configPath(projectPath), JSON.stringify(cfg, null, 2));
  }
}

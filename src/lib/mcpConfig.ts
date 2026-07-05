// Gestión del archivo `mimocode.json` de la carpeta de proyecto — la config que lee el agente MiMo
// (fork de OpenCode) para descubrir y conectarse a MCP servers. Verificado empíricamente: escribir
// un bloque `mcp` acá y correr `mimo mcp list` muestra el server como "connected". Este es el camino
// REAL para darle tools al agente; el viejo start_mcp_server (proceso suelto) no llegaba a MiMo.
//
// A diferencia de ese enfoque, acá no spawneamos nada: el propio `mimo acp` lanza el server MCP como
// proceso hijo suyo cuando arranca una sesión con esta carpeta como cwd.
import { readTextFile, writeTextFile } from "./tauriApi";

export type McpConfigEntry = {
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  enabled: boolean;
};

type MimoConfig = {
  $schema?: string;
  mcp?: Record<string, McpConfigEntry>;
  [key: string]: unknown;
};

function configPath(projectPath: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  return projectPath.endsWith(sep) ? `${projectPath}mimocode.json` : `${projectPath}${sep}mimocode.json`;
}

// Lee y parsea el config actual. Si no existe o está corrupto, devuelve una base vacía (nunca tira)
// — así podemos hacer merge sin pisar otras claves del usuario (agents, providers, etc.).
async function readConfig(projectPath: string): Promise<MimoConfig> {
  try {
    return JSON.parse(await readTextFile(configPath(projectPath))) as MimoConfig;
  } catch {
    return {};
  }
}

export async function readMcpServers(projectPath: string): Promise<Record<string, McpConfigEntry>> {
  return (await readConfig(projectPath)).mcp ?? {};
}

// Agrega o actualiza un MCP server en `mimocode.json` (merge, preservando el resto del archivo).
export async function setMcpServer(
  projectPath: string,
  id: string,
  command: string[],
  environment: Record<string, string> | undefined,
  enabled: boolean
): Promise<void> {
  const cfg = await readConfig(projectPath);
  cfg.$schema = cfg.$schema ?? "https://mimo.xiaomi.com/config.json";
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

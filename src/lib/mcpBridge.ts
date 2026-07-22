// Arranca el MCP bridge de DevFlow (ver mcpBridgeScript.ts para el porqué/diseño completo) y lo
// registra como MCP server en el `opencode.json` de cada proyecto que se abre — así cualquier agente
// (DevFlow Code nativo, y Claude Code una vez resuelto el gap de acpClient.ts) puede crear/correr
// Workflows hablando, sin config manual.
//
// Un solo bridge para toda la app (no uno por proyecto): DevFlow es una sola ventana/proceso a la vez
// — mismo criterio que el único `opencode serve` global. El projectPath viaja en cada request HTTP
// (header X-Devflow-Project, puesto por el propio script) para que las tools sepan de qué proyecto
// vino el pedido; el descubrimiento de puerto/token es un único archivo, no uno por proyecto.
import { readTextFile, writeTextFile, createDir, homeDir, mcpBridgeStart } from "./tauriApi";
import { MCP_BRIDGE_SCRIPT_SOURCE } from "./mcpBridgeScript";
import * as mcpConfig from "./mcpConfig";
import { useWorkspaceStore } from "../store/workspaceStore";

async function bridgeDir(): Promise<string> {
  return `${await homeDir()}/.devflow`;
}

async function scriptPath(): Promise<string> {
  return `${await bridgeDir()}/mcp-bridge.js`;
}

async function discoveryPath(): Promise<string> {
  return `${await bridgeDir()}/mcp-bridge.json`;
}

let startPromise: Promise<void> | null = null;

// Idempotente (una sola vez por vida de la app, cachea la promesa igual que ensureServer de
// opencodeClient): escribe el script a disco (dedup por contenido, mismo patrón que
// ensureNativeExpertAgent) y arranca el servidor HTTP en Rust. El token se regenera en cada boot de
// la app — no hace falta persistirlo: el script lee el archivo de descubrimiento fresco en CADA
// tools/call, nunca lo cachea, y la entrada de opencode.json nunca embebe puerto/token (solo la ruta
// del script) así que no hay que reescribirla cuando el token cambia.
export function ensureBridgeStarted(): Promise<void> {
  if (!startPromise) {
    startPromise = (async () => {
      const dir = await bridgeDir();
      await createDir(dir);
      const path = await scriptPath();
      try {
        const existing = await readTextFile(path);
        if (existing !== MCP_BRIDGE_SCRIPT_SOURCE) await writeTextFile(path, MCP_BRIDGE_SCRIPT_SOURCE);
      } catch {
        await writeTextFile(path, MCP_BRIDGE_SCRIPT_SOURCE);
      }
      const token = crypto.randomUUID();
      const port = await mcpBridgeStart(token);
      await writeTextFile(await discoveryPath(), JSON.stringify({ port, token }));
    })();
  }
  return startPromise;
}

// Escribe (si hace falta) la entrada "devflow" en el `opencode.json` de `projectPath` — SIEMPRE
// compara contra el disco (sin cachear el resultado entre los dos call sites de abajo: cada uno
// necesita saber, de forma independiente, si a ÉL le tocó escribir algo nuevo desde su última
// verificación — ver comentario de ensureDevflowBridgeRegistered). Devuelve si tuvo que escribir.
async function writeBridgeEntryIfNeeded(projectPath: string): Promise<boolean> {
  await ensureBridgeStarted();
  const script = await scriptPath();
  const desired = { command: ["node", script, projectPath], enabled: true };
  const existing = (await mcpConfig.readMcpServers(projectPath))["devflow"];
  const matches = existing && existing.enabled === desired.enabled && JSON.stringify(existing.command) === JSON.stringify(desired.command);
  if (matches) return false;
  await mcpConfig.setMcpServer(projectPath, "devflow", desired.command, undefined, true);
  return true;
}

const ensuredForAcp = new Set<string>();

// Se llama antes de armar `mcpServers` de una sesión ACP (Claude Code) para `projectPath` — ver
// acpClient.buildAcpMcpServers. Solo necesita el ARCHIVO correcto: cada `session/new` arma su
// `mcpServers` inline leyendo `opencode.json` en el momento, no hay proceso de larga vida que se
// entere tarde de un cambio. Fast-path por Set, mismo criterio que registeredAgents.
export async function ensureBridgeEntryWritten(projectPath: string): Promise<void> {
  if (ensuredForAcp.has(projectPath)) return;
  await writeBridgeEntryIfNeeded(projectPath);
  ensuredForAcp.add(projectPath);
}

const ensuredForOpencode = new Set<string>();

// Se llama antes de abrir una sesión nativa de OpenCode para `projectPath` (ver
// opencodeClient.newSession). A diferencia de ACP, acá SÍ hace falta reiniciar `opencode serve` si la
// entrada se acaba de escribir/cambiar — igual costo/motivo que ya paga McpView al togglear un MCP
// server: un proceso `opencode serve` ya corriendo no re-lee opencode.json solo. Set INDEPENDIENTE del
// de ensureBridgeEntryWritten a propósito: si el path ACP ya escribió el archivo para este proyecto,
// este call site igual necesita saberlo (para decidir si SU proceso opencode serve necesita reiniciar)
// — compartir el fast-path escondería ese "sí cambió" y dejaría el server nativo desactualizado.
export async function ensureDevflowBridgeRegistered(projectPath: string): Promise<void> {
  if (ensuredForOpencode.has(projectPath)) return;
  const changed = await writeBridgeEntryIfNeeded(projectPath);
  ensuredForOpencode.add(projectPath);
  if (changed) {
    // Import dinámico: opencodeClient importa mcpBridge (llamado desde newSession) — un import
    // estático acá crearía un ciclo entre los dos módulos.
    const { restart } = await import("./opencodeClient");
    await restart("opencode");
    useWorkspaceStore.getState().resetSessions("opencode");
  }
}

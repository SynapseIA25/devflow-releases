// Detects if running inside Tauri desktop app
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Prereqs = { node: boolean; npx: boolean; uvx: boolean; uv: boolean };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function startMcpServer(
  id: string,
  command: string,
  envVars: Record<string, string>
): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("start_mcp_server", { id, command, envVars });
}

export async function stopMcpServer(id: string): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("stop_mcp_server", { id });
}

export async function getRunningServers(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("get_running_servers");
}

export async function checkPrerequisites(): Promise<Prereqs> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri).");
  return invoke<Prereqs>("check_prerequisites");
}

export async function acpStart(
  provider: string,
  command: string,
  args: string[],
  env?: Record<string, string>
): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("acp_start", { provider, command, args, env: env ?? null });
}

// Detección de CLIs de agentes instalados (onboarding): { mimo: true, opencode: false, ... }
export async function checkCli(names: string[]): Promise<Record<string, boolean>> {
  if (!isTauri()) return Object.fromEntries(names.map((n) => [n, false]));
  return invoke<Record<string, boolean>>("check_cli", { names });
}

// Ruta absoluta de un sidecar bundleado (externalBin) por su nombre lógico, ej. "opencode".
export async function resolveSidecarPath(name: string): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("resolve_sidecar_path", { name });
}

// Instala un CLI de agente globalmente vía npm (onboarding, botón "Install"). Tira si npm falla
// o no está disponible — el caller debe ofrecer el comando manual como fallback.
export async function installCli(pkg: string): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("install_cli", { package: pkg });
}

export async function acpSend(provider: string, line: string): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri).");
  return invoke<void>("acp_send", { provider, line });
}

export async function acpStop(provider: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("acp_stop", { provider });
}

export async function readTextFile(path: string, line?: number, limit?: number): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri).");
  return invoke<string>("read_text_file", { path, line, limit });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri).");
  return invoke<void>("write_text_file", { path, content });
}

export type HttpResponse = { status: number; body: string };

// Request HTTP corrido en Rust (reqwest) — sin CORS, para el nodo "http" de los workflows.
export async function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<HttpResponse> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<HttpResponse>("http_request", { method, url, headers, body });
}

// Trigger webhook: arranca el servidor HTTP local (idempotente) y devuelve el puerto.
export async function webhookStart(port: number): Promise<number> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<number>("webhook_start", { port });
}

// Trigger on-file-change: empieza/actualiza el watcher del path para un trigger.
export async function watchStart(id: string, path: string): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("watch_start", { id, path });
}

export async function watchStop(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("watch_stop", { id });
}

// Cliente MCP one-shot: spawnea el server, hace el handshake y ejecuta una tool. Devuelve el texto
// del resultado. Para el nodo "mcp" de los workflows.
export async function mcpCallTool(
  command: string,
  envVars: Record<string, string>,
  tool: string,
  args: unknown
): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("mcp_call_tool", { command, envVars, tool, arguments: args });
}

// command: si se pasa, el PTY corre ese comando (server/proceso de un Servicio) y termina al terminar
// el comando; si se omite, abre un shell interactivo (terminal por-workspace del chat).
// env: variables de ambiente del proyecto (Frente 4) que se inyectan al proceso.
export async function ptySpawn(
  id: string,
  cwd: string,
  rows: number,
  cols: number,
  command?: string,
  env?: Record<string, string>
): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("pty_spawn", { id, cwd, rows, cols, command: command ?? null, env: env ?? null });
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_write", { id, data });
}

export async function ptyResize(id: string, rows: number, cols: number): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_resize", { id, rows, cols });
}

export async function ptyKill(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_kill", { id });
}

export type FsEntry = { name: string; path: string; isDir: boolean };

export async function readDir(path: string): Promise<FsEntry[]> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<FsEntry[]>("read_dir", { path });
}

export async function createDir(path: string): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("create_dir", { path });
}

// Abre el diálogo nativo del SO para elegir una carpeta. Devuelve la ruta elegida o null si
// el usuario canceló. Usado por el selector de carpeta de proyecto del File Explorer.
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string | null>("pick_folder");
}

// Home del usuario (USERPROFILE/HOME) — para semillar el proyecto default sin hardcodear una ruta.
export async function homeDir(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("home_dir");
}

// Ruta detectada del binario de Hermes, o null si no está instalado.
export async function hermesPath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("hermes_path");
}

export type ShellResult = { output: string; exitCode: number };

// One-shot: ejecuta un comando y devuelve stdout+stderr + exit code (no es la PTY interactiva).
// Lo usa el motor de workflows para el nodo terminal.
export async function runShellCommand(command: string, cwd: string): Promise<ShellResult> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<ShellResult>("run_shell_command", { command, cwd });
}

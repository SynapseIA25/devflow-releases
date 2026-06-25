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

export async function acpStart(provider: string, command: string, args: string[]): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("acp_start", { provider, command, args });
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

export async function ptySpawn(id: string, cwd: string, rows: number, cols: number): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("pty_spawn", { id, cwd, rows, cols });
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

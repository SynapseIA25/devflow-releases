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

// Arranca (o reusa, si ya está vivo) un `opencode serve` — servidor HTTP+SSE nativo, no
// ACP-por-stdio — y devuelve el puerto local para hablarle con @opencode-ai/sdk. Un solo proceso
// para toda la app (el directory/cwd se elige por sesión, ver opencodeClient.ts).
export async function opencodeServeEnsure(
  provider: string,
  env?: Record<string, string>
): Promise<number> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<number>("opencode_serve_ensure", { provider, env: env ?? null });
}

export async function opencodeServeStop(provider: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("opencode_serve_stop", { provider });
}

// Puente SSE→evento de Tauri para /event de opencode serve — WebView2 no entrega bien un
// fetch()/EventSource de streaming (verificado empíricamente), así que Rust lee el stream con un
// cliente HTTP bloqueante y reenvía cada evento por el canal `opencode-event:{provider}`. `directory`
// es obligatorio: /event sin directory queda scopeado al cwd del proceso, no del proyecto en uso
// (verificado empíricamente — ver comentario en opencode_events_start del lado de Rust).
export async function opencodeEventsStart(provider: string, directory: string, port: number): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("opencode_events_start", { provider, directory, port });
}

export async function opencodeEventsStop(provider: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("opencode_events_stop", { provider });
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

export type LoadTestResult = {
  completed: number;
  errors: number;
  requestsPerSec: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
};

// Load test HTTP real (concurrencia vía tokio en Rust) para el nodo perf, modo "http" — ver
// http_load_test en lib.rs para el porqué de no orquestar esto desde el webview.
export async function httpLoadTest(
  url: string,
  method: string,
  concurrency: number,
  totalRequests: number
): Promise<LoadTestResult> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<LoadTestResult>("http_load_test", { url, method, concurrency, totalRequests });
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

// Introspecta las tools de un MCP server (mismo handshake que mcpCallTool, pero tools/list). Devuelve
// el JSON crudo del result (`{tools: [...]}`) — para devflow_list_mcp_tools del MCP bridge.
export async function mcpListTools(command: string, envVars: Record<string, string>): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("mcp_list_tools", { command, envVars });
}

// MCP bridge de DevFlow: arranca (idempotente) el servidor HTTP local que le da a cualquier agente de
// chat acceso al motor de Workflows real de la app. Devuelve el puerto asignado.
export async function mcpBridgeStart(token: string): Promise<number> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<number>("devflow_mcp_bridge_start", { token });
}

// Resuelve (con éxito o error) una tool call del MCP bridge que está bloqueada esperando respuesta.
export async function mcpRespond(id: number, result?: unknown, error?: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("devflow_mcp_respond", { id, result: result ?? null, error: error ?? null });
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

// ── LSP (Language Server Protocol) — puente JSON-RPC-sobre-stdio con language servers reales
// (typescript-language-server, rust-analyzer), tercera instancia del patrón acp_start/acp_send/
// acp_stop. `id` lo compone el caller como "{kind}:{root}" (ver lspClient.ts) — un proceso por
// combinación (lenguaje, raíz de proyecto).

export async function lspStart(
  id: string,
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<void>("lsp_start", { id, command, args, cwd: cwd ?? null, env: env ?? null });
}

// `message` debe venir ya enmarcado (`Content-Length: N\r\n\r\n<json>`, sin newline final) — Rust
// escribe los bytes tal cual, no reconstruye el framing (a diferencia de acp_send, que sí agrega
// el "\n" porque ACP es newline-delimited).
export async function lspSend(id: string, message: string): Promise<void> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri).");
  return invoke<void>("lsp_send", { id, message });
}

export async function lspStop(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("lsp_stop", { id });
}

// Ruta detectada de rust-analyzer (vía `rustup which rust-analyzer`), o null si no está instalado.
export async function rustAnalyzerPath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("rust_analyzer_path");
}

// Instala rust-analyzer como componente de rustup. Tira si rustup falla o no está disponible.
export async function installRustAnalyzer(): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("rust_analyzer_install");
}

// ── RAG (retrieval-augmented generation) — ver ragIndex.ts/ragEngine.ts y rag.rs.

export async function ollamaCheck(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("ollama_check");
}

export async function ollamaPullModel(model: string): Promise<string> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<string>("ollama_pull_model", { model });
}

export type RagMatch = { path: string; startLine: number; endLine: number; score: number };

// Coseno por fuerza bruta sobre el índice ya construido (.devflow/rag-index.json) — corre en Rust
// para no tener que mandar el índice completo (puede ser de varios MB) por IPC en cada búsqueda,
// solo el embedding de la query cruza el límite JS→Rust.
export async function ragSearch(indexPath: string, queryEmbedding: number[], topK: number): Promise<RagMatch[]> {
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  return invoke<RagMatch[]>("rag_search", { indexPath, queryEmbedding, topK });
}

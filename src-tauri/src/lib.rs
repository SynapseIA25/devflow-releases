use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

// Tauri es una app GUI (subsistema Windows, no consola). Cualquier hijo de subsistema consola
// (cmd.exe, los shims .cmd de npm que se spawnean vía `cmd /C`, el sidecar opencode.exe) se abre con
// su propia ventana de consola visible si no se pasa este flag — reportado en máquinas reales: se
// veía una terminal cmd independiente por sesión (el sidecar de opencode serve se reinicia por
// sesión, ver ensureExpertAgent/Gotcha 3 en memoria). CREATE_NO_WINDOW = 0x08000000.
#[cfg(windows)]
pub(crate) fn no_window(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}
#[cfg(not(windows))]
pub(crate) fn no_window(cmd: &mut Command) -> &mut Command {
    cmd
}

mod lsp;
mod rag;

pub struct McpProcesses(pub Mutex<HashMap<String, Child>>);
// Keyed por provider ("mimo", "hermes", ...) — cada agente ACP corre en su propio proceso hijo,
// así DevFlow puede tener una sesión de MiMo y una de Hermes activas al mismo tiempo.
pub struct AcpProcesses(pub Mutex<HashMap<String, Child>>);
// Trigger webhook: puerto del servidor HTTP si está corriendo (se arranca una sola vez).
pub struct WebhookState(pub Mutex<Option<u16>>);
// Trigger on-file-change: un watcher de notify por trigger, keyed por su id.
pub struct WatchState(pub Mutex<HashMap<String, notify::RecommendedWatcher>>);
// Un `opencode serve` (servidor HTTP+SSE nativo, no ACP-por-stdio) — un solo proceso por provider,
// igual que AcpProcesses. El cwd/directory se elige por sesión desde el frontend (ver comentario
// en opencode_serve_ensure), no queda atado al proceso. Valor = (proceso, puerto asignado).
pub struct HttpServeProcesses(pub Mutex<HashMap<String, (Child, u16)>>);
// Hilos que leen el SSE /event de un `opencode serve` y lo reenvían como evento de Tauri — ver
// opencode_events_start. Key = "{provider}:{directory}" (el stream de eventos está scopeado por
// directory, igual que /session — un proceso puede tener sesiones de varios directorios activos).
// Valor = flag para pedirle al hilo que corte en el próximo chequeo (el read() bloqueante en curso
// puede tardar hasta el próximo heartbeat/dato en notarlo).
pub struct OpenCodeEventStreams(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
fn start_mcp_server(
    id: String,
    command: String,
    env_vars: HashMap<String, String>,
    state: State<McpProcesses>,
) -> Result<String, String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;

    if processes.contains_key(&id) {
        return Err(format!("El servidor '{}' ya está corriendo", id));
    }

    let filtered_env: HashMap<_, _> = env_vars
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .collect();

    let child = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &command])
            .envs(&filtered_env)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd).spawn()
    } else {
        let mut parts = command.split_whitespace();
        let prog = parts.next().unwrap_or("");
        let mut cmd = Command::new(prog);
        cmd.args(parts)
            .envs(&filtered_env)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    };

    match child {
        Ok(c) => {
            let pid = c.id();
            processes.insert(id.clone(), c);
            Ok(format!("Servidor '{}' iniciado — PID {}", id, pid))
        }
        Err(e) => Err(format!("Error al iniciar '{}': {}", id, e)),
    }
}

#[tauri::command]
fn stop_mcp_server(id: String, state: State<McpProcesses>) -> Result<String, String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    match processes.remove(&id) {
        Some(mut child) => {
            child.kill().map_err(|e| e.to_string())?;
            Ok(format!("Servidor '{}' detenido", id))
        }
        None => Err(format!("El servidor '{}' no estaba corriendo", id)),
    }
}

// Returns ids of currently running servers (also cleans up dead processes)
#[tauri::command]
fn get_running_servers(state: State<McpProcesses>) -> Vec<String> {
    let mut processes = state.0.lock().expect("lock poisoned");
    let ids: Vec<String> = processes.keys().cloned().collect();
    let mut dead = vec![];
    for id in &ids {
        if let Some(child) = processes.get_mut(id) {
            if let Ok(Some(_)) = child.try_wait() {
                dead.push(id.clone());
            }
        }
    }
    for id in &dead {
        processes.remove(id);
    }
    processes.keys().cloned().collect()
}

// Check which runtime dependencies are available
#[tauri::command]
fn check_prerequisites() -> serde_json::Value {
    let check = |prog: &str, arg: &str| -> bool {
        if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &format!("{} {}", prog, arg)])
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            no_window(&mut cmd)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        } else {
            Command::new(prog)
                .arg(arg)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    };

    serde_json::json!({
        "node": check("node", "--version"),
        "npx":  check("npx",  "--version"),
        "uvx":  check("uvx",  "--version"),
        "uv":   check("uv",   "--version"),
    })
}

// Detecta qué CLIs de agentes están instalados (onboarding). Cada nombre se prueba con
// `<cli> --version` — mismo mecanismo que check_prerequisites (cmd /C resuelve shims .cmd de npm).
// Nota: `--version` puede tardar ~1-2s por CLI de Node; el frontend lo llama async y muestra spinner.
#[tauri::command]
async fn check_cli(names: Vec<String>) -> HashMap<String, bool> {
    let check = |prog: &str| -> bool {
        if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &format!("{} --version", prog)])
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            no_window(&mut cmd)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        } else {
            Command::new(prog)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    };
    names.into_iter().map(|n| { let ok = check(&n); (n, ok) }).collect()
}

// Resuelve la ruta absoluta de un sidecar bundleado por Tauri (externalBin) — hoy solo "opencode",
// empaquetado en el instalador para que el agente ande sin instalación aparte. El binario FUENTE en
// src-tauri/binaries/ lleva el target triple en el nombre (así el bundler distingue qué archivo usar
// por plataforma al buildear), pero Tauri lo copia junto al ejecutable con el triple YA STRIPEADO
// (verificado corriendo `npm run tauri dev`: aparece como target\debug\opencode.exe, no
// opencode-<triple>.exe) — no hace falta calcular el triple en runtime. Se resuelve vía
// current_exe(), no depende de PATH.
#[tauri::command]
fn resolve_sidecar_path(name: String) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or_else(|| "no parent dir".to_string())?;
    let filename = if cfg!(windows) { format!("{name}.exe") } else { name };
    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("Sidecar not found: {}", path.display()));
    }
    Ok(path.to_string_lossy().to_string())
}

// Instala un CLI de agente globalmente vía npm (onboarding: botón "Install" en vez de solo mostrar
// el comando). Requiere que el usuario ya tenga Node/npm — si falta, el stderr de npm lo explica y
// el frontend cae al comando copiable existente como fallback.
#[tauri::command]
fn install_cli(package: String) -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "npm", "install", "-g", &package]);
        no_window(&mut cmd).output()
    } else {
        Command::new("npm").args(["install", "-g", &package]).output()
    }
    .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ── ACP (Agent Client Protocol) — spawns an agent CLI (mimo, hermes, ...) as a
// JSON-RPC-over-stdio peer. Un proceso hijo por provider, así se puede tener más de un
// agente ACP corriendo a la vez (ej. una pestaña con MiMo y otra con Hermes).

#[tauri::command]
fn acp_start(
    app: AppHandle,
    provider: String,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    state: State<AcpProcesses>,
) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if processes.contains_key(&provider) {
        return Ok(());
    }

    // API keys de providers de inferencia (OpenRouter/Google/Groq/...) cargadas en Settings: se
    // inyectan como env vars y el agente ACP las detecta solo (mismo patrón que filtered_env de
    // start_mcp_server). Las vacías se omiten — una var vacía pisa la del sistema.
    let extra_env: HashMap<String, String> = env
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .collect();

    let spawn_result = if cfg!(target_os = "windows") {
        // Muchos CLIs de agentes (ej. `mimo`) se instalan como shim .cmd de npm en Windows;
        // Command::new(command) no los resuelve directamente. Pasar por `cmd /C` funciona
        // igual para esos shims que para un .exe con ruta absoluta (caso de Hermes).
        let mut full_args = vec!["/C".to_string(), command.clone()];
        full_args.extend(args.iter().cloned());
        let mut cmd = Command::new("cmd");
        cmd.args(&full_args)
            // El adaptador claude-code-acp se niega a arrancar si CLAUDECODE está seteado (guard de
            // "sesión anidada"). DevFlow puede haber heredado esa var si se lo lanzó desde una sesión
            // de Claude Code; la quitamos del hijo para que el adaptador funcione igual. Inofensivo
            // para mimo/hermes (no la usan).
            .env_remove("CLAUDECODE")
            .envs(&extra_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd).spawn()
    } else {
        Command::new(&command)
            .args(&args)
            .env_remove("CLAUDECODE")
            .envs(&extra_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    };
    let mut child = spawn_result.map_err(|e| format!("No se pudo iniciar '{} {}': {}", command, args.join(" "), e))?;

    let stdout = child.stdout.take().ok_or("No se pudo capturar stdout del agente ACP")?;
    let stderr = child.stderr.take().ok_or("No se pudo capturar stderr del agente ACP")?;

    let app_for_stdout = app.clone();
    let event_name = format!("acp-message:{}", provider);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    let _ = app_for_stdout.emit(&event_name, l);
                }
                Err(_) => break,
            }
        }
    });

    let log_provider = provider.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[{} acp] {}", log_provider, line);
        }
    });

    processes.insert(provider, child);
    Ok(())
}

#[tauri::command]
fn acp_send(provider: String, line: String, state: State<AcpProcesses>) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    let child = processes.get_mut(&provider).ok_or_else(|| format!("El agente '{}' no está corriendo", provider))?;
    let stdin = child.stdin.as_mut().ok_or("stdin del agente ACP no disponible")?;
    stdin
        .write_all(format!("{}\n", line).as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn acp_stop(provider: String, state: State<AcpProcesses>) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = processes.remove(&provider) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── OpenCode nativo — spawnea `opencode serve` (servidor HTTP+SSE propio del binario, no ACP) y
// devuelve el puerto para que el frontend le hable directo con el SDK oficial (@opencode-ai/sdk).
// UN SOLO proceso por provider (igual que AcpProcesses hoy) — a diferencia de lo que parecía por la
// doc pública, el cwd NO queda atado al proceso: `SessionCreateData.query.directory` (verificado
// leyendo node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts) deja elegir el directory por
// sesión al crearla, así que un solo servidor sirve todos los proyectos/worktrees de la app.

fn pick_free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

#[tauri::command]
fn opencode_serve_ensure(
    provider: String,
    env: Option<HashMap<String, String>>,
    state: State<HttpServeProcesses>,
) -> Result<u16, String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;

    if let Some((child, port)) = processes.get_mut(&provider) {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(*port);
        }
    }
    processes.remove(&provider);

    let sidecar = resolve_sidecar_path("opencode".to_string())?;
    let port = pick_free_port()?;

    // Mismo filtrado que acp_start: las API keys de Settings (OpenRouter/Google/Groq/...) se
    // inyectan como env vars y opencode las detecta solo.
    let extra_env: HashMap<String, String> = env
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .collect();

    let mut serve_cmd = Command::new(&sidecar);
    serve_cmd
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--hostname",
            "127.0.0.1",
            // Orígenes del webview de Tauri: dev (Vite) + prod (custom protocol, distinto entre
            // Windows/WebView2 y macOS-Linux/wry) — se pasan los tres, de más no molesta.
            "--cors",
            "http://localhost:1420",
            "--cors",
            "tauri://localhost",
            "--cors",
            "http://tauri.localhost",
        ])
        .envs(&extra_env)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = no_window(&mut serve_cmd)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar 'opencode serve': {}", e))?;

    // No hay framing JSON-RPC que leer acá (la comunicación real es HTTP/SSE desde el frontend) —
    // el stderr solo se drena a log de debug, mismo patrón que acp_start.
    let stderr = child.stderr.take().ok_or("No se pudo capturar stderr de opencode serve")?;
    let log_provider = provider.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[opencode serve {}] {}", log_provider, line);
        }
    });

    // `opencode serve` tarda un rato en bindear el puerto tras spawnear — sin esto, el primer fetch
    // real del frontend (justo después de que esta función resuelve) puede llegar antes de que el
    // socket esté escuchando y fallar con "Failed to fetch" (visto en la práctica: pasa seguido en
    // el primer prompt justo tras abrir la app, un reintento después ya anda porque el proceso tuvo
    // tiempo de arrancar). Se espera activamente a que el puerto acepte conexiones TCP antes de
    // devolverlo, en vez de devolverlo a ciegas.
    let ready_deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    loop {
        let addr = format!("127.0.0.1:{}", port).parse().map_err(|e| format!("{}", e))?;
        if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok() {
            break;
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("'opencode serve' terminó antes de levantar (status: {})", status));
        }
        if std::time::Instant::now() >= ready_deadline {
            return Err("'opencode serve' no levantó el puerto a tiempo (25s)".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    processes.insert(provider, (child, port));
    Ok(port)
}

#[tauri::command]
fn opencode_serve_stop(provider: String, state: State<HttpServeProcesses>) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if let Some((mut child, _)) = processes.remove(&provider) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Puente SSE → evento de Tauri para /event de opencode serve. Verificado empíricamente que
// WebView2 NO entrega el body de un fetch()/EventSource de streaming de forma incremental (con
// fetch()+reader manual y con EventSource nativo, disparando el turno desde un proceso externo:
// solo llegaba el primer evento "server.connected", nunca los de mensajes/tool-calls, aunque el
// server sí los emitía — confirmado con curl concurrente). El cliente bloqueante de reqwest no
// tiene ese problema (no pasa por el stack de red del webview), así que Rust lee la línea "data: "
// de cada evento SSE en un hilo aparte (mismo idiom que el resto del archivo: BufReader sobre un
// stream) y lo reenvía tal cual (el JSON crudo) al canal `opencode-event:{provider}`.
//
// `directory` es OBLIGATORIO acá y no es cosmético: /event sin `directory` queda scopeado al cwd
// con el que arrancó el proceso opencode serve (en este caso el cwd de `cargo run`, casi nunca el
// proyecto real que se está usando) y NUNCA emite eventos de sesiones de otro directorio — verificado
// empíricamente (sesiones creadas y prompteadas con éxito en un directory distinto, pero /event sin
// directory solo entregaba server.connected/heartbeat; con ?directory=<mismo path> sí llegó todo:
// message.part.delta, tool calls, etc.). Como una sola app puede tener sesiones en varios directorios
// (distintos proyectos, worktrees de Ambientes), hace falta un hilo/conexión por (provider, directory)
// — todos reenvían al MISMO canal `opencode-event:{provider}` (los eventos ya traen sessionID, que es
// global y suficiente para rutear del lado del frontend).
#[tauri::command]
fn opencode_events_start(
    app: AppHandle,
    provider: String,
    directory: String,
    port: u16,
    state: State<OpenCodeEventStreams>,
) -> Result<(), String> {
    let key = format!("{}:{}", provider, directory);
    let mut streams = state.0.lock().map_err(|e| e.to_string())?;
    if streams.contains_key(&key) {
        return Ok(());
    }
    let running = Arc::new(AtomicBool::new(true));
    let running_for_thread = running.clone();
    let event_name = format!("opencode-event:{}", provider);
    let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{}/event", port))
        .map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("directory", &directory);
    std::thread::spawn(move || {
        while running_for_thread.load(Ordering::Relaxed) {
            let resp = match reqwest::blocking::get(url.clone()) {
                Ok(r) => r,
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    continue;
                }
            };
            let reader = BufReader::new(resp);
            for line in reader.lines().flatten() {
                if !running_for_thread.load(Ordering::Relaxed) {
                    break;
                }
                if let Some(data) = line.strip_prefix("data:") {
                    let _ = app.emit(&event_name, data.trim().to_string());
                }
            }
            if !running_for_thread.load(Ordering::Relaxed) {
                break;
            }
            // el server cerró la conexión (ej. se reinició) — reintenta tras una pausa breve.
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
    });
    streams.insert(key, running);
    Ok(())
}

// Corta TODOS los hilos de eventos de un provider (todos los directorios) — se usa en restart().
#[tauri::command]
fn opencode_events_stop(provider: String, state: State<OpenCodeEventStreams>) -> Result<(), String> {
    let prefix = format!("{}:", provider);
    let mut streams = state.0.lock().map_err(|e| e.to_string())?;
    let keys: Vec<String> = streams.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
    for key in keys {
        if let Some(flag) = streams.remove(&key) {
            flag.store(false, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String, line: Option<u32>, limit: Option<u32>) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if line.is_none() && limit.is_none() {
        return Ok(content);
    }
    let start = line.unwrap_or(1).saturating_sub(1) as usize;
    let lines: Vec<&str> = content.lines().collect();
    let end = match limit {
        Some(l) => (start + l as usize).min(lines.len()),
        None => lines.len(),
    };
    Ok(lines.get(start..end).unwrap_or(&[]).join("\n"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
// Borra un archivo (ej. una entrada de memoria individual, ver memoryFiles.ts). No falla si ya no
// existe — un remove sobre algo ya borrado no debería tumbar el flujo que lo llama.
fn remove_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
    status: u16,
    body: String,
}

// Request HTTP genérico para el nodo "http" del motor de workflows. Corre en Rust (reqwest) en vez
// del webview para evitar CORS y poder llamar cualquier API (Telegram, email, deploy webhooks…).
#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<HttpResponse, String> {
    let m = reqwest::Method::from_bytes(method.trim().to_uppercase().as_bytes())
        .map_err(|e| format!("Método HTTP inválido: {e}"))?;
    let client = reqwest::Client::new();
    let mut req = client.request(m, url.trim());
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if !body.is_empty() {
        req = req.body(body);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadTestResult {
    completed: u32,
    errors: u32,
    requests_per_sec: f64,
    min_ms: u64,
    max_ms: u64,
    avg_ms: u64,
    p50_ms: u64,
    p95_ms: u64,
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = (((sorted.len() - 1) as f64) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

// Load test HTTP real para el nodo perf (modo "http"): concurrencia real vía tokio (declarado directo
// en Cargo.toml, ver comentario ahí), no orquestada desde el webview — evita pagar un round-trip de
// IPC Tauri por cada request individual, que sería el costo de loopear http_request desde TS. Un
// status no-2xx cuenta como error igual que una falla de red (ambos son "no completó bien"); las
// latencias agregadas (min/max/avg/p50/p95) solo consideran requests exitosos.
#[tauri::command]
async fn http_load_test(
    url: String,
    method: String,
    concurrency: u32,
    total_requests: u32,
) -> Result<LoadTestResult, String> {
    let m = reqwest::Method::from_bytes(method.trim().to_uppercase().as_bytes())
        .map_err(|e| format!("Método HTTP inválido: {e}"))?;
    let client = reqwest::Client::new();
    let next = Arc::new(AtomicU32::new(0));
    let durations: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(AtomicU32::new(0));
    let started = std::time::Instant::now();

    let mut handles = Vec::new();
    for _ in 0..concurrency.max(1) {
        let client = client.clone();
        let m = m.clone();
        let url = url.clone();
        let next = next.clone();
        let durations = durations.clone();
        let errors = errors.clone();
        let total = total_requests;
        handles.push(tokio::spawn(async move {
            loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= total {
                    break;
                }
                let t0 = std::time::Instant::now();
                match client.request(m.clone(), &url).send().await {
                    Ok(resp) => {
                        let ok = resp.status().is_success();
                        let _ = resp.bytes().await;
                        if ok {
                            durations.lock().unwrap().push(t0.elapsed().as_millis() as u64);
                        } else {
                            errors.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                    Err(_) => {
                        errors.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
        }));
    }
    for h in handles {
        let _ = h.await;
    }

    let wall_sec = started.elapsed().as_secs_f64().max(0.001);
    let mut durs = durations.lock().unwrap().clone();
    durs.sort_unstable();
    let completed = durs.len() as u32;
    let (min_ms, max_ms, avg_ms) = if durs.is_empty() {
        (0, 0, 0)
    } else {
        let sum: u64 = durs.iter().sum();
        (durs[0], durs[durs.len() - 1], sum / durs.len() as u64)
    };
    Ok(LoadTestResult {
        completed,
        errors: errors.load(Ordering::SeqCst),
        requests_per_sec: (completed as f64 / wall_sec * 100.0).round() / 100.0,
        min_ms,
        max_ms,
        avg_ms,
        p50_ms: percentile(&durs, 0.50),
        p95_ms: percentile(&durs, 0.95),
    })
}

// Extrae el texto de un `result` de tools/call: concatena los items {type:"text", text}. Si no hay
// texto, cae a serializar el result crudo (para tools que devuelven structured content).
fn extract_mcp_text(result: &serde_json::Value) -> String {
    let mut out = String::new();
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        for item in content {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        out = serde_json::to_string(result).unwrap_or_default();
    }
    out
}

// Versión del protocolo MCP que anunciamos en el handshake. Fija por ahora; si en el futuro algún
// server exige negociar otra, habría que leer la que devuelve su `initialize` y reintentar con esa.
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

fn mcp_send_msg(stdin: &mut std::process::ChildStdin, v: &serde_json::Value) -> Result<(), String> {
    let line = serde_json::to_string(v).map_err(|e| e.to_string())?;
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

fn mcp_recv_id(rx: &std::sync::mpsc::Receiver<serde_json::Value>, id: i64, timeout: std::time::Duration) -> Result<serde_json::Value, String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or("timeout esperando respuesta del MCP server")?;
        match rx.recv_timeout(remaining) {
            Ok(msg) => {
                if msg.get("id").and_then(|v| v.as_i64()) == Some(id) {
                    return Ok(msg);
                }
            }
            Err(_) => return Err("timeout esperando respuesta del MCP server".into()),
        }
    }
}

// Spawnea un MCP server one-shot y hace la mitad común del handshake (initialize →
// notifications/initialized). Devuelve el child (para matarlo al terminar) + su stdin (para mandar
// el siguiente request, tools/call o tools/list) + el receiver del hilo lector de stdout. En Windows
// va por `cmd /C` (igual que start_mcp_server) para resolver shims de npx/uvx.
fn mcp_spawn_and_handshake(
    command: &str,
    env_vars: &HashMap<String, String>,
) -> Result<(Child, std::process::ChildStdin, std::sync::mpsc::Receiver<serde_json::Value>), String> {
    let filtered_env: HashMap<_, _> = env_vars.iter().filter(|(_, v)| !v.is_empty()).collect();

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        no_window(&mut c);
        c
    } else {
        let mut parts = command.split_whitespace();
        let prog = parts.next().unwrap_or("").to_string();
        let rest: Vec<String> = parts.map(|s| s.to_string()).collect();
        let mut c = Command::new(prog);
        c.args(rest);
        c
    };

    let mut child = cmd
        .envs(&filtered_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("no se pudo iniciar el MCP server '{command}': {e}"))?;

    let mut stdin = child.stdin.take().ok_or("sin stdin del MCP server")?;
    let stdout = child.stdout.take().ok_or("sin stdout del MCP server")?;

    // Hilo lector: parsea cada línea JSON-RPC y la manda por el channel.
    let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let t = line.trim();
                    if t.is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
                        if tx.send(v).is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    let timeout = std::time::Duration::from_secs(30);
    let mut handshake = || -> Result<(), String> {
        mcp_send_msg(&mut stdin, &serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": MCP_PROTOCOL_VERSION, "capabilities": {}, "clientInfo": { "name": "DevFlow", "version": "0.1" } }
        }))?;
        let init = mcp_recv_id(&rx, 1, timeout)?;
        if let Some(err) = init.get("error") {
            return Err(format!("initialize falló: {err}"));
        }
        mcp_send_msg(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        Ok(())
    };
    if let Err(e) = handshake() {
        let _ = child.kill();
        return Err(e);
    }
    Ok((child, stdin, rx))
}

// Cliente MCP one-shot para el nodo "mcp" de los workflows: spawnea el server, hace el handshake
// JSON-RPC y llama tools/call. No mantiene el server vivo entre llamadas (cold start por ejecución)
// — simple y determinista para un nodo. Timeout de 30s por respuesta vía un hilo lector + channel,
// así un server colgado no bloquea para siempre.
#[tauri::command]
fn mcp_call_tool(
    command: String,
    env_vars: HashMap<String, String>,
    tool: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let (mut child, mut stdin, rx) = mcp_spawn_and_handshake(&command, &env_vars)?;
    let timeout = std::time::Duration::from_secs(30);
    let mut run = || -> Result<String, String> {
        mcp_send_msg(&mut stdin, &serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        }))?;
        let resp = mcp_recv_id(&rx, 2, timeout)?;
        if let Some(err) = resp.get("error") {
            return Err(format!("tools/call falló: {err}"));
        }
        let result = resp.get("result").ok_or("respuesta del MCP server sin 'result'")?;
        let text = extract_mcp_text(result);
        if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
            return Err(format!("la tool devolvió un error: {text}"));
        }
        Ok(text)
    };
    let out = run();
    let _ = child.kill();
    out
}

// Introspecta las tools que expone un MCP server (para que el bridge de DevFlow — ver
// devflow_mcp_bridge_start — no tenga que adivinar nombres). Mismo handshake one-shot que
// mcp_call_tool, pero manda tools/list y devuelve el JSON crudo del result (array `tools`).
#[tauri::command]
fn mcp_list_tools(command: String, env_vars: HashMap<String, String>) -> Result<String, String> {
    let (mut child, mut stdin, rx) = mcp_spawn_and_handshake(&command, &env_vars)?;
    let timeout = std::time::Duration::from_secs(30);
    let mut run = || -> Result<String, String> {
        mcp_send_msg(&mut stdin, &serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
        }))?;
        let resp = mcp_recv_id(&rx, 2, timeout)?;
        if let Some(err) = resp.get("error") {
            return Err(format!("tools/list falló: {err}"));
        }
        let result = resp.get("result").ok_or("respuesta del MCP server sin 'result'")?;
        serde_json::to_string(result).map_err(|e| e.to_string())
    };
    let out = run();
    let _ = child.kill();
    out
}

// Arranca (una sola vez) un servidor HTTP local para el trigger webhook. Cada request a
// /hook/<token> emite el evento "webhook-fired" {token, body} al frontend (el TriggerRunner dispara
// el workflow cuyo trigger tiene ese id, usando el body como {{input}}). Escucha en 127.0.0.1 (local).
#[tauri::command]
fn webhook_start(app: AppHandle, port: u16, state: State<WebhookState>) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(p) = *guard {
        return Ok(p);
    }
    let server = tiny_http::Server::http(format!("127.0.0.1:{port}")).map_err(|e| e.to_string())?;
    *guard = Some(port);
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let token = req
                .url()
                .strip_prefix("/hook/")
                .map(|rest| rest.split(|c| c == '?' || c == '/').next().unwrap_or("").to_string())
                .filter(|s| !s.is_empty());
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            if let Some(token) = token {
                let _ = app.emit("webhook-fired", serde_json::json!({ "token": token, "body": body }));
            }
            let _ = req.respond(tiny_http::Response::from_string("ok"));
        }
    });
    Ok(port)
}

// Empieza a vigilar `path` (archivo o carpeta) para el trigger `id`. Ante cualquier cambio emite
// "file-changed" con el id (el TriggerRunner dispara el workflow, con debounce del lado del cliente).
#[tauri::command]
fn watch_start(app: AppHandle, id: String, path: String, state: State<WatchState>) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.remove(&id); // reemplaza un watcher previo del mismo trigger si lo había
    let app_cloned = app.clone();
    let id_cloned = id.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if matches!(
                event.kind,
                notify::EventKind::Modify(_) | notify::EventKind::Create(_) | notify::EventKind::Remove(_)
            ) {
                let _ = app_cloned.emit("file-changed", &id_cloned);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let p = std::path::Path::new(&path);
    let mode = if p.is_dir() {
        notify::RecursiveMode::Recursive
    } else {
        notify::RecursiveMode::NonRecursive
    };
    notify::Watcher::watch(&mut watcher, p, mode).map_err(|e| e.to_string())?;
    map.insert(id, watcher);
    Ok(())
}

#[tauri::command]
fn watch_stop(id: String, state: State<WatchState>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    Ok(())
}

// Respuesta que el frontend manda de vuelta para una tool call del MCP bridge en curso — ver
// devflow_mcp_bridge_start/devflow_mcp_respond.
struct BridgeReply {
    result: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Default)]
pub struct BridgeState {
    port: Mutex<Option<u16>>,
    token: Mutex<Option<String>>,
    pending: Mutex<HashMap<u64, std::sync::mpsc::Sender<BridgeReply>>>,
    next_id: std::sync::atomic::AtomicU64,
}

// Arranca (una sola vez por proceso) el servidor HTTP local del MCP bridge de DevFlow: el canal por
// el que devflow-mcp-bridge.js (proceso Node stdio, registrado como MCP server en opencode.json de
// cada proyecto — ver mcpBridge.ts) le habla al motor de Workflows REAL de esta app viva. A
// diferencia de webhook_start (fire-and-forget), acá cada request ESPERA una respuesta real: bloquea
// el hilo hasta que el frontend resuelva la tool (devflow_mcp_respond) o hasta el timeout.
// Idempotente: si ya está arriba, devuelve el mismo puerto (mismo criterio que webhook_start).
#[tauri::command]
fn devflow_mcp_bridge_start(app: AppHandle, token: String, state: State<BridgeState>) -> Result<u16, String> {
    {
        let port_guard = state.port.lock().map_err(|e| e.to_string())?;
        if let Some(p) = *port_guard {
            return Ok(p);
        }
    }
    // Rango chico de reintento por si el puerto preferido está ocupado (mismo espíritu que el resto
    // del archivo prefiere fallar rápido y claro antes que un puerto mágico sin fallback).
    let mut server = None;
    let mut bound_port = 0u16;
    for candidate in 8790..8800u16 {
        if let Ok(s) = tiny_http::Server::http(format!("127.0.0.1:{candidate}")) {
            server = Some(s);
            bound_port = candidate;
            break;
        }
    }
    let server = server.ok_or("no se pudo bindear el MCP bridge de DevFlow (puertos 8790-8799 ocupados)")?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(bound_port);
    *state.token.lock().map_err(|e| e.to_string())? = Some(token.clone());

    // El estado gestionado por Tauri (BridgeState.pending) ya es compartible entre hilos vía
    // `app.state::<BridgeState>()` — no hace falta un Arc propio, cada hilo de request accede al
    // mismo Mutex a través del AppHandle clonado.
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let app = app_for_thread.clone();
            std::thread::spawn(move || {
                let state = app.state::<BridgeState>();
                let expected_token = state.token.lock().ok().and_then(|g| g.clone());

                let auth_ok = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("authorization"))
                    .map(|h| h.value.as_str())
                    .map(|v| Some(v.trim_start_matches("Bearer ").trim().to_string()) == expected_token)
                    .unwrap_or(false);
                if !auth_ok {
                    let _ = req.respond(tiny_http::Response::from_string("unauthorized").with_status_code(401));
                    return;
                }
                let project_path = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("x-devflow-project"))
                    .map(|h| h.value.as_str().to_string())
                    .unwrap_or_default();

                let mut body = String::new();
                if req.as_reader().read_to_string(&mut body).is_err() {
                    let _ = req.respond(tiny_http::Response::from_string("bad request").with_status_code(400));
                    return;
                }
                let parsed: serde_json::Value = match serde_json::from_str(&body) {
                    Ok(v) => v,
                    Err(_) => {
                        let _ = req.respond(tiny_http::Response::from_string("invalid json").with_status_code(400));
                        return;
                    }
                };
                let tool = parsed.get("tool").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let arguments = parsed.get("arguments").cloned().unwrap_or(serde_json::json!({}));

                let id = state.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let (tx, rx) = std::sync::mpsc::channel::<BridgeReply>();
                if let Ok(mut p) = state.pending.lock() {
                    p.insert(id, tx);
                }
                let _ = app.emit("devflow-bridge-call", serde_json::json!({
                    "id": id, "tool": tool, "arguments": arguments, "projectPath": project_path
                }));

                // Timeout largo: nodos "agent"/loops de un workflow pueden tardar minutos; casi todas
                // las demás tools (listar/definir/validar) responden en milisegundos.
                match rx.recv_timeout(std::time::Duration::from_secs(600)) {
                    Ok(reply) => {
                        if let Some(err) = reply.error {
                            let body = serde_json::json!({ "error": err }).to_string();
                            let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(500));
                        } else {
                            let body = serde_json::json!({ "result": reply.result.unwrap_or(serde_json::Value::Null) }).to_string();
                            let _ = req.respond(tiny_http::Response::from_string(body));
                        }
                    }
                    Err(_) => {
                        if let Ok(mut p) = state.pending.lock() {
                            p.remove(&id);
                        }
                        let body = serde_json::json!({ "error": "timeout esperando a DevFlow" }).to_string();
                        let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(504));
                    }
                }
            });
        }
    });

    Ok(bound_port)
}

// El frontend llama esto para resolver (con éxito o error) una tool call del MCP bridge que está
// bloqueada esperando en devflow_mcp_bridge_start. No-op silencioso si el id ya no existe (ya expiró
// por timeout) — mismo criterio best-effort que el resto de los comandos fire-and-forget del archivo.
#[tauri::command]
fn devflow_mcp_respond(
    id: u64,
    result: Option<serde_json::Value>,
    error: Option<String>,
    state: State<BridgeState>,
) -> Result<(), String> {
    let sender = state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(tx) = sender {
        let _ = tx.send(BridgeReply { result, error });
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

// Carpetas pesadas/ruidosas que no aportan nada al explorer y harían el árbol inmanejable.
const IGNORED_DIR_NAMES: &[&str] = &["node_modules", "target", ".git", "dist", "build", ".next", ".turbo"];

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut dirs = vec![];
    let mut files = vec![];
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if IGNORED_DIR_NAMES.contains(&name.as_str()) {
            continue;
        }
        let is_dir = entry.path().is_dir();
        let path = entry.path().to_string_lossy().to_string();
        let fs_entry = FsEntry { name, path, is_dir };
        if is_dir { dirs.push(fs_entry) } else { files.push(fs_entry) }
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    // create_dir_all: crea padres intermedios (p.ej. ~/.devflow/skills/<name> en un perfil nuevo)
    // y no falla si el directorio ya existe.
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

// Abre el diálogo nativo del SO para elegir una carpeta de proyecto (estilo "Abrir carpeta"
// de VS Code). Devuelve la ruta absoluta elegida, o None si el usuario canceló. Usa rfd
// (Rust File Dialog) en vez del plugin de diálogo de Tauri para mantenerlo como comando
// propio de la app (sin tener que tocar capabilities). En Windows rfd inicializa COM por su
// cuenta y el diálogo Win32 corre bien desde el hilo del comando; en macOS el panel nativo
// debe correr en el main thread (a tener en cuenta cuando se porte a Mac).
#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Elegí la carpeta del proyecto")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellResult {
    output: String,
    exit_code: i32,
}

// One-shot: ejecuta un comando, espera a que termine y devuelve stdout+stderr combinados +
// el exit code estructurado. Distinto de la PTY (pty_spawn): aquella es interactiva/persistente
// por pestaña; esto es "correr y devolver el resultado", justo lo que necesita el motor de
// workflows (nodo terminal). En Windows usa Git Bash (mismo windows_bash_path() que la PTY) para
// que la sintaxis (ls/cat/pipes) sea igual que en Linux/Mac; fallback a sh en Unix.
#[tauri::command]
fn run_shell_command(command: String, cwd: String) -> Result<ShellResult, String> {
    let mut cmd = if cfg!(target_os = "windows") {
        match windows_bash_path() {
            Some(bash) => {
                let mut c = Command::new(bash);
                c.args(["-c", &command]);
                no_window(&mut c);
                c
            }
            None => {
                let mut c = Command::new("powershell.exe");
                c.args(["-NoProfile", "-Command", &command]);
                no_window(&mut c);
                c
            }
        }
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };
    let out = cmd
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("No se pudo ejecutar '{}': {}", command, e))?;
    let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stderr.is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&stderr);
    }
    Ok(ShellResult {
        output,
        exit_code: out.status.code().unwrap_or(-1),
    })
}

// Home del usuario — para semillar el proyecto default en un fresh install sin clavar una ruta a una
// máquina concreta (antes se hardcodeaba en constants.ts). USERPROFILE en Windows, HOME en Unix.
#[tauri::command]
fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default()
}

// Detecta el binario de Hermes en ubicaciones conocidas (mismo patrón que windows_bash_path). Devuelve
// None si no está instalado → la UI no ofrece la entrada MCP de Hermes. Evita hardcodear la ruta.
#[tauri::command]
fn hermes_path() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!(r"{}\hermes\hermes-agent\venv\Scripts\hermes.exe", local));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{}/.local/share/hermes/hermes-agent/venv/bin/hermes", home));
    }
    candidates.into_iter().find(|p| std::path::Path::new(p).exists())
}

// En Windows, `bash` en el PATH resuelve al stub de System32 que lanza WSL (lento en frío
// y requiere traducir cwd a /mnt/...). Usamos Git Bash directo si está instalado, así la
// sintaxis de comandos (ls, cat, grep, pipes) es la misma que en Linux/Mac sin esa fricción.
#[cfg(target_os = "windows")]
fn windows_bash_path() -> Option<&'static str> {
    const CANDIDATES: &[&str] = &[
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    CANDIDATES.iter().find(|p| std::path::Path::new(p).exists()).copied()
}

// En Unix la rama de Git Bash es código muerto (el `if cfg!(target_os = "windows")` es false en
// runtime) pero igual se compila → necesita que el nombre resuelva. Stub que siempre devuelve None.
#[cfg(not(target_os = "windows"))]
fn windows_bash_path() -> Option<&'static str> {
    None
}

// ── Terminal real con PTY ── reemplaza el viejo modelo "ejecutar y devolver el resultado
// final" por un pseudo-terminal real (ConPTY en Windows, pty nativo en Unix) que soporta
// streaming en vivo, colores ANSI y programas interactivos (vim, prompts, contraseñas).
// Una sesión por workspace, keyed por id — mismo patrón que McpProcesses/AcpProcesses.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    // Killer clonado del child (el child real vive en el hilo waiter, bloqueado en wait()). Permite
    // matar el proceso desde pty_kill sin quitárselo al waiter.
    killer: Box<dyn ChildKiller + Send + Sync>,
}
pub struct PtySessions(pub Mutex<HashMap<String, PtySession>>);

// Resuelve el shell a lanzar DENTRO del pty. En Windows, Git Bash directo (no como wrapper
// de cmd.exe: a diferencia de los shims .cmd de npm que resuelve acp_start, bash.exe es un
// binario nativo win32 invocable directo dentro del ConPTY). Fallback a powershell.exe si no
// está instalado Git Bash — más capaz que cmd.exe puro y Win11 siempre lo trae.
//
// `command`: si es Some, el pty corre ESE comando (shell -lc "<command>") y termina cuando el
// comando termina (usado por el panel de Servicios para correr servers de larga duración de forma
// aislada). Si es None, abre un shell interactivo (el terminal por-workspace del chat).
fn build_shell_command(cwd: &str, command: Option<&str>, env: Option<&HashMap<String, String>>) -> CommandBuilder {
    let mut cmd = if cfg!(target_os = "windows") {
        match windows_bash_path() {
            Some(bash) => {
                let mut c = CommandBuilder::new(bash);
                if let Some(run) = command {
                    c.args(["-lc", run]);
                }
                c
            }
            None => {
                let mut c = CommandBuilder::new("powershell.exe");
                if let Some(run) = command {
                    c.args(["-NoProfile", "-Command", run]);
                }
                c
            }
        }
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut c = CommandBuilder::new(shell);
        if let Some(run) = command {
            c.args(["-lc", run]);
        }
        c
    };
    cmd.cwd(cwd);
    // Ambiente del proyecto (Frente 4): se inyecta a servicios y terminales del proyecto activo.
    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }
    cmd
}

// El hilo lector solo emite la salida (pty-output). Nunca toca el Mutex<PtySessions> mientras
// está bloqueado en read() — el reader clonado es un descriptor independiente, así que no hay
// deadlock con pty_write/pty_resize. La detección de salida del proceso NO va acá: en Windows el
// EOF del reader del ConPTY no llega de forma fiable cuando el hijo termina (con el master vivo);
// eso lo maneja el hilo waiter (child.wait()) que arma pty_spawn.
fn spawn_pty_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let event_out = format!("pty-output:{}", id);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(&event_out, chunk);
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
    command: Option<String>,
    env: Option<HashMap<String, String>>,
    state: State<PtySessions>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if sessions.contains_key(&id) {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("No se pudo abrir PTY: {e}"))?;

    let cmd = build_shell_command(&cwd, command.as_deref(), env.as_ref());
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("No se pudo iniciar el shell: {e}"))?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("No se pudo clonar el reader del PTY: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("No se pudo obtener el writer del PTY: {e}"))?;

    sessions.insert(id.clone(), PtySession { master: pair.master, writer, killer });
    drop(sessions);

    spawn_pty_reader(app.clone(), id.clone(), reader);

    // Hilo waiter: bloquea en child.wait() y detecta la salida del proceso de forma confiable
    // (el EOF del reader del ConPTY no es fiable en Windows). Al terminar, emite pty-exit con el
    // exit code real y limpia la sesión (droppear el master hace que el reader corte por EOF).
    let app_wait = app;
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = app_wait.emit(&format!("pty-exit:{}", id), code);
        if let Ok(mut sessions) = app_wait.state::<PtySessions>().0.lock() {
            sessions.remove(&id);
        }
    });
    Ok(())
}

#[tauri::command]
fn pty_write(id: String, data: String, state: State<PtySessions>) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or_else(|| format!("Sesión '{}' no existe", id))?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(id: String, rows: u16, cols: u16, state: State<PtySessions>) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or_else(|| format!("Sesión '{}' no existe", id))?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(id: String, state: State<PtySessions>) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        // Mata vía el killer clonado; el hilo waiter (con el child real) verá terminar wait()
        // y emitirá pty-exit + limpieza. No emitimos pty-exit acá para no duplicarlo.
        let _ = session.killer.kill();
    }
    Ok(())
}

// Design Mode: abre la URL del usuario (su propio dev server) en una ventana secundaria de Tauri
// CON remote debugging habilitado solo para ESA ventana — formaliza como feature del producto la
// misma técnica que se usa a mano para verificar DevFlow por CDP (helper cdp.mjs, ver memoria
// devflow-cdp-verificacion): additional_browser_args es Windows/WebView2-only (no soportado en
// macOS/Linux/mobile, ver docs de wry) así que esta feature por ahora solo funciona en Windows —
// en otras plataformas open_design_mode_window abre la ventana igual pero sin CDP disponible.
#[tauri::command]
async fn open_design_mode_window(app: AppHandle, url: String, debug_port: u16) -> Result<(), String> {
    // Dos cosas hacían falta más allá de additional_browser_args para que esto no cuelgue en
    // Windows: 1) la creación de ventana/webview tiene afinidad de hilo (tiene que correr en el
    // hilo principal — run_on_main_thread), invocar WebviewWindowBuilder::build() directo desde el
    // hilo del comando (no necesariamente el principal) se quedaba esperando para siempre; 2) un
    // data_directory propio, porque todos los webviews de la app comparten el mismo entorno de
    // WebView2 (mismo user-data-folder) por default, y additional_browser_args distintos entre
    // ventanas del MISMO entorno ya inicializado no se aplican — hace falta un entorno separado.
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("design-mode-webview");
    let app2 = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            if let Some(w) = app2.get_webview_window("design-mode") {
                let _ = w.close();
            }
            let parsed = tauri::Url::parse(&url).map_err(|e| format!("URL inválida: {e}"))?;
            tauri::WebviewWindowBuilder::new(&app2, "design-mode", tauri::WebviewUrl::External(parsed))
                .title("DevFlow — Design Mode")
                .additional_browser_args(&format!("--remote-debugging-port={debug_port}"))
                .data_directory(data_dir)
                .inner_size(1000.0, 750.0)
                .build()
                .map(|_| ())
                .map_err(|e| e.to_string())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "La ventana de Design Mode no respondió.".to_string())?
}

#[tauri::command]
fn close_design_mode_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("design-mode") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(McpProcesses(Mutex::new(HashMap::new())))
        .manage(AcpProcesses(Mutex::new(HashMap::new())))
        .manage(HttpServeProcesses(Mutex::new(HashMap::new())))
        .manage(OpenCodeEventStreams(Mutex::new(HashMap::new())))
        .manage(PtySessions(Mutex::new(HashMap::new())))
        .manage(WebhookState(Mutex::new(None)))
        .manage(WatchState(Mutex::new(HashMap::new())))
        .manage(BridgeState::default())
        .manage(lsp::LspProcesses(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            start_mcp_server,
            stop_mcp_server,
            get_running_servers,
            check_prerequisites,
            check_cli,
            resolve_sidecar_path,
            install_cli,
            acp_start,
            acp_send,
            acp_stop,
            opencode_serve_ensure,
            opencode_serve_stop,
            opencode_events_start,
            opencode_events_stop,
            read_text_file,
            write_text_file,
            remove_file,
            http_request,
            http_load_test,
            mcp_call_tool,
            mcp_list_tools,
            devflow_mcp_bridge_start,
            devflow_mcp_respond,
            webhook_start,
            watch_start,
            watch_stop,
            read_dir,
            create_dir,
            pick_folder,
            home_dir,
            hermes_path,
            run_shell_command,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            open_design_mode_window,
            close_design_mode_window,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            lsp::rust_analyzer_path,
            lsp::rust_analyzer_install,
            rag::ollama_check,
            rag::ollama_pull_model,
            rag::rag_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

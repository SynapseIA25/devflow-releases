use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct McpProcesses(pub Mutex<HashMap<String, Child>>);
// Keyed por provider ("mimo", "hermes", ...) — cada agente ACP corre en su propio proceso hijo,
// así DevFlow puede tener una sesión de MiMo y una de Hermes activas al mismo tiempo.
pub struct AcpProcesses(pub Mutex<HashMap<String, Child>>);
// Trigger webhook: puerto del servidor HTTP si está corriendo (se arranca una sola vez).
pub struct WebhookState(pub Mutex<Option<u16>>);
// Trigger on-file-change: un watcher de notify por trigger, keyed por su id.
pub struct WatchState(pub Mutex<HashMap<String, notify::RecommendedWatcher>>);

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
        Command::new("cmd")
            .args(["/C", &command])
            .envs(&filtered_env)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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
            Command::new("cmd")
                .args(["/C", &format!("{} {}", prog, arg)])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
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
            Command::new("cmd")
                .args(["/C", &format!("{} --version", prog)])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
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
        Command::new("cmd")
            .args(&full_args)
            // El adaptador claude-code-acp se niega a arrancar si CLAUDECODE está seteado (guard de
            // "sesión anidada"). DevFlow puede haber heredado esa var si se lo lanzó desde una sesión
            // de Claude Code; la quitamos del hijo para que el adaptador funcione igual. Inofensivo
            // para mimo/hermes (no la usan).
            .env_remove("CLAUDECODE")
            .envs(&extra_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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

// Cliente MCP one-shot para el nodo "mcp" de los workflows: spawnea el server, hace el handshake
// JSON-RPC (initialize → notifications/initialized → tools/call) y devuelve el texto del resultado.
// No mantiene el server vivo entre llamadas (cold start por ejecución) — simple y determinista para
// un nodo. Timeout de 30s por respuesta vía un hilo lector + channel, así un server colgado no bloquea
// para siempre. En Windows va por `cmd /C` (igual que start_mcp_server) para resolver shims de npx/uvx.
#[tauri::command]
fn mcp_call_tool(
    command: String,
    env_vars: HashMap<String, String>,
    tool: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let filtered_env: HashMap<_, _> = env_vars.iter().filter(|(_, v)| !v.is_empty()).collect();

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
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

    fn send_msg(stdin: &mut std::process::ChildStdin, v: &serde_json::Value) -> Result<(), String> {
        let line = serde_json::to_string(v).map_err(|e| e.to_string())?;
        stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }
    fn recv_id(rx: &std::sync::mpsc::Receiver<serde_json::Value>, id: i64) -> Result<serde_json::Value, String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
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

    // Envuelto para poder matar el child pase lo que pase (éxito, error o timeout).
    let mut run = || -> Result<String, String> {
        send_msg(&mut stdin, &serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": MCP_PROTOCOL_VERSION, "capabilities": {}, "clientInfo": { "name": "DevFlow", "version": "0.1" } }
        }))?;
        let init = recv_id(&rx, 1)?;
        if let Some(err) = init.get("error") {
            return Err(format!("initialize falló: {err}"));
        }
        send_msg(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        send_msg(&mut stdin, &serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        }))?;
        let resp = recv_id(&rx, 2)?;
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
                c
            }
            None => {
                let mut c = Command::new("powershell.exe");
                c.args(["-NoProfile", "-Command", &command]);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(McpProcesses(Mutex::new(HashMap::new())))
        .manage(AcpProcesses(Mutex::new(HashMap::new())))
        .manage(PtySessions(Mutex::new(HashMap::new())))
        .manage(WebhookState(Mutex::new(None)))
        .manage(WatchState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            start_mcp_server,
            stop_mcp_server,
            get_running_servers,
            check_prerequisites,
            check_cli,
            acp_start,
            acp_send,
            acp_stop,
            read_text_file,
            write_text_file,
            http_request,
            mcp_call_tool,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

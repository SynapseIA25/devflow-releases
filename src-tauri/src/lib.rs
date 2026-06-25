use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct McpProcesses(pub Mutex<HashMap<String, Child>>);
// Keyed por provider ("mimo", "hermes", ...) — cada agente ACP corre en su propio proceso hijo,
// así DevFlow puede tener una sesión de MiMo y una de Hermes activas al mismo tiempo.
pub struct AcpProcesses(pub Mutex<HashMap<String, Child>>);

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

// ── ACP (Agent Client Protocol) — spawns an agent CLI (mimo, hermes, ...) as a
// JSON-RPC-over-stdio peer. Un proceso hijo por provider, así se puede tener más de un
// agente ACP corriendo a la vez (ej. una pestaña con MiMo y otra con Hermes).

#[tauri::command]
fn acp_start(
    app: AppHandle,
    provider: String,
    command: String,
    args: Vec<String>,
    state: State<AcpProcesses>,
) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if processes.contains_key(&provider) {
        return Ok(());
    }

    let spawn_result = if cfg!(target_os = "windows") {
        // Muchos CLIs de agentes (ej. `mimo`) se instalan como shim .cmd de npm en Windows;
        // Command::new(command) no los resuelve directamente. Pasar por `cmd /C` funciona
        // igual para esos shims que para un .exe con ruta absoluta (caso de Hermes).
        let mut full_args = vec!["/C".to_string(), command.clone()];
        full_args.extend(args.iter().cloned());
        Command::new("cmd")
            .args(&full_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    } else {
        Command::new(&command)
            .args(&args)
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
    std::fs::create_dir(&path).map_err(|e| e.to_string())
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

// ── Terminal real con PTY ── reemplaza el viejo modelo "ejecutar y devolver el resultado
// final" por un pseudo-terminal real (ConPTY en Windows, pty nativo en Unix) que soporta
// streaming en vivo, colores ANSI y programas interactivos (vim, prompts, contraseñas).
// Una sesión por workspace, keyed por id — mismo patrón que McpProcesses/AcpProcesses.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn PtyChild + Send + Sync>,
}
pub struct PtySessions(pub Mutex<HashMap<String, PtySession>>);

// Resuelve el shell a lanzar DENTRO del pty. En Windows, Git Bash directo (no como wrapper
// de cmd.exe: a diferencia de los shims .cmd de npm que resuelve acp_start, bash.exe es un
// binario nativo win32 invocable directo dentro del ConPTY). Fallback a powershell.exe si no
// está instalado Git Bash — más capaz que cmd.exe puro y Win11 siempre lo trae.
fn build_shell_command(cwd: &str) -> CommandBuilder {
    let mut cmd = if cfg!(target_os = "windows") {
        match windows_bash_path() {
            Some(bash) => CommandBuilder::new(bash),
            None => CommandBuilder::new("powershell.exe"),
        }
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        CommandBuilder::new(shell)
    };
    cmd.cwd(cwd);
    cmd
}

// El hilo lector nunca toca el Mutex<PtySessions> mientras está bloqueado en read() —
// el reader clonado es un descriptor independiente del estado compartido, así que no hay
// riesgo de deadlock con pty_write/pty_resize (que sí lockean, pero brevemente y sin
// depender de que este hilo libere nada). El único lock que toma ocurre DESPUÉS de salir
// del loop (EOF/error), para reportar el exit code real y limpiar el HashMap.
fn spawn_pty_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let event_out = format!("pty-output:{}", id);
    let event_exit = format!("pty-exit:{}", id);
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
        if let Ok(mut sessions) = app.state::<PtySessions>().0.lock() {
            if let Some(session) = sessions.get_mut(&id) {
                let code = session.child.try_wait().ok().flatten().map(|s| s.exit_code());
                let _ = app.emit(&event_exit, code);
            }
            sessions.remove(&id);
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

    let cmd = build_shell_command(&cwd);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("No se pudo iniciar el shell: {e}"))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("No se pudo clonar el reader del PTY: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("No se pudo obtener el writer del PTY: {e}"))?;

    sessions.insert(id.clone(), PtySession { master: pair.master, writer, child });
    drop(sessions);

    spawn_pty_reader(app, id, reader);
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
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(McpProcesses(Mutex::new(HashMap::new())))
        .manage(AcpProcesses(Mutex::new(HashMap::new())))
        .manage(PtySessions(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            start_mcp_server,
            stop_mcp_server,
            get_running_servers,
            check_prerequisites,
            acp_start,
            acp_send,
            acp_stop,
            read_text_file,
            write_text_file,
            read_dir,
            create_dir,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

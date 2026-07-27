// Puente JSON-RPC-sobre-stdio para servidores de Language Server Protocol reales
// (typescript-language-server, rust-analyzer) — tercera instancia del mismo patrón que ya usan
// AcpProcesses (agentes) y el spawn de MCP en lib.rs, con una diferencia importante: LSP no usa
// framing newline-delimited, usa headers estilo HTTP (`Content-Length: N\r\n\r\n<json>`). Por eso
// el lector no puede reusar `BufReader::lines()` como ACP — hay que parsear el header a mano y
// leer exactamente N bytes de cuerpo.
//
// El envelope (construir/parsear el JSON-RPC en sí) sigue viviendo en TypeScript, igual que ACP:
// acá solo se resuelve el transporte (spawn, framing, escritura/lectura de bytes).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::no_window;

// Keyed por un id que arma el frontend (ej. "ts:F:\proyecto" / "rust:F:\proyecto") — un proceso
// por combinación (lenguaje, raíz de proyecto), igual criterio que HttpServeProcesses/
// OpenCodeEventStreams (keyed por directory): puede haber varios proyectos/worktrees abiertos a
// la vez, cada uno con su propio language server.
pub struct LspProcesses(pub Mutex<HashMap<String, Child>>);

// Lee un mensaje LSP completo (headers + cuerpo) de un stream ya envuelto en BufReader. Devuelve
// None en EOF limpio (proceso cerrado) para que el hilo lector termine sin loggear error.
fn read_lsp_message<R: BufRead>(reader: &mut R) -> std::io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Ok(None); // EOF antes de terminar los headers
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // línea en blanco = fin de headers
        }
        if let Some(v) = trimmed
            .split_once(':')
            .filter(|(k, _)| k.eq_ignore_ascii_case("Content-Length"))
        {
            content_length = v.1.trim().parse::<usize>().ok();
        }
        // Otros headers (Content-Type, etc.) se ignoran — no hace falta ningún otro para hablar
        // con typescript-language-server/rust-analyzer.
    }
    let len = match content_length {
        Some(l) => l,
        None => return Ok(Some(String::new())), // header malformado: no debería pasar, no aborta el hilo
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    state: State<LspProcesses>,
) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if processes.contains_key(&id) {
        return Ok(());
    }

    let extra_env: HashMap<String, String> = env
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .collect();

    let spawn_result = if cfg!(target_os = "windows") {
        // Mismo truco que acp_start: typescript-language-server se instala como shim .cmd de npm,
        // así que hay que resolverlo vía `cmd /C` (funciona igual para un .exe con ruta absoluta,
        // caso de rust-analyzer).
        let mut full_args = vec!["/C".to_string(), command.clone()];
        full_args.extend(args.iter().cloned());
        let mut cmd = Command::new("cmd");
        cmd.args(&full_args)
            .envs(&extra_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &cwd {
            cmd.current_dir(dir);
        }
        no_window(&mut cmd).spawn()
    } else {
        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .envs(&extra_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &cwd {
            cmd.current_dir(dir);
        }
        cmd.spawn()
    };
    let mut child = spawn_result
        .map_err(|e| format!("No se pudo iniciar el language server '{} {}': {}", command, args.join(" "), e))?;

    let stdout = child.stdout.take().ok_or("No se pudo capturar stdout del language server")?;
    let stderr = child.stderr.take().ok_or("No se pudo capturar stderr del language server")?;

    let app_for_stdout = app.clone();
    let event_name = format!("lsp-message:{}", id);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_lsp_message(&mut reader) {
                Ok(Some(body)) => {
                    let _ = app_for_stdout.emit(&event_name, body);
                }
                Ok(None) => break, // EOF: el proceso cerró stdout
                Err(_) => break,
            }
        }
    });

    let log_id = id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[{} lsp] {}", log_id, line);
        }
    });

    processes.insert(id, child);
    Ok(())
}

// `message` ya viene completamente enmarcado desde TS (`Content-Length: N\r\n\r\n<json>`, sin
// newline final) — Rust no toca el contenido JSON-RPC, solo escribe los bytes tal cual, mismo
// espíritu que acp_send (que agrega un "\n" porque ACP SÍ es newline-delimited; acá no hace falta).
#[tauri::command]
pub fn lsp_send(id: String, message: String, state: State<LspProcesses>) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    let child = processes
        .get_mut(&id)
        .ok_or_else(|| format!("El language server '{}' no está corriendo", id))?;
    let stdin = child.stdin.as_mut().ok_or("stdin del language server no disponible")?;
    stdin.write_all(message.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lsp_stop(id: String, state: State<LspProcesses>) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = processes.remove(&id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── rust-analyzer: a diferencia de typescript-language-server (paquete npm, cubierto por los
// check_cli/install_cli genéricos ya existentes), rust-analyzer se instala como componente de
// rustup — este es un proyecto Rust/Tauri, así que asumimos rustup ya presente (mismo criterio
// que el resto del backend asume Node para las herramientas de agentes).

#[tauri::command]
pub fn rust_analyzer_path() -> Option<String> {
    let output = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "rustup which rust-analyzer"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        no_window(&mut cmd).output()
    } else {
        Command::new("rustup")
            .args(["which", "rust-analyzer"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
    };
    let output = output.ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[tauri::command]
pub fn rust_analyzer_install() -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "rustup", "component", "add", "rust-analyzer"]);
        no_window(&mut cmd).output()
    } else {
        Command::new("rustup")
            .args(["component", "add", "rust-analyzer"])
            .output()
    }
    .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

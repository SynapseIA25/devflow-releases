// RAG (retrieval-augmented generation) sobre el código del proyecto — sin dependencias pesadas: sin
// vector DB, sin librería ANN. A la escala de un repo típico (miles de chunks, no millones), coseno
// por fuerza bruta en un loop simple es rápido y no necesita nada más. La parte cara (embeddings) la
// hace un modelo local de Ollama, llamado desde el frontend vía `httpRequest` (ya existente) — acá
// solo se resuelve: detectar/instalar Ollama, y buscar en el índice ya construido.
use std::process::{Command, Stdio};

use crate::no_window;

// Detección de Ollama — mismo patrón que check_cli, especializado (Ollama no es un paquete npm, no
// corresponde reusar check_cli/install_cli que asumen ese shape).
#[tauri::command]
pub fn ollama_check() -> bool {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ollama --version"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        no_window(&mut cmd).status().map(|s| s.success()).unwrap_or(false)
    } else {
        Command::new("ollama")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

// Descarga un modelo de Ollama (ej. "nomic-embed-text", el embedder que usa ragIndex.ts). Mismo
// patrón que install_cli, pero `ollama pull` en vez de `npm install -g`.
#[tauri::command]
pub fn ollama_pull_model(model: String) -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ollama", "pull", &model]);
        no_window(&mut cmd).output()
    } else {
        Command::new("ollama").args(["pull", &model]).output()
    }
    .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ── Búsqueda sobre el índice (.devflow/rag-index.json, escrito por ragIndex.ts) ──

#[derive(serde::Deserialize)]
struct RagChunk {
    path: String,
    #[serde(rename = "startLine")]
    start_line: u32,
    #[serde(rename = "endLine")]
    end_line: u32,
    embedding: Vec<f32>,
}

// El índice trae más campos (model/dim/builtAt) que acá no hacen falta — serde ignora los que no
// están declarados en el struct, no hace falta declararlos solo para deserializar.
#[derive(serde::Deserialize)]
struct RagIndexFile {
    chunks: Vec<RagChunk>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagMatch {
    path: String,
    start_line: u32,
    end_line: u32,
    score: f32,
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

#[tauri::command]
pub fn rag_search(index_path: String, query_embedding: Vec<f32>, top_k: usize) -> Result<Vec<RagMatch>, String> {
    let content = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let index: RagIndexFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut scored: Vec<RagMatch> = index
        .chunks
        .iter()
        .map(|c| RagMatch {
            path: c.path.clone(),
            start_line: c.start_line,
            end_line: c.end_line,
            score: cosine(&c.embedding, &query_embedding),
        })
        .collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    Ok(scored)
}

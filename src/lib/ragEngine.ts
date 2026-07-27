// RAG (retrieval-augmented generation) — lado de consulta + la primitiva de embeddings compartida
// con ragIndex.ts (construcción). Embeddings vía un modelo LOCAL de Ollama (nomic-embed-text) —
// encaja con el resto de DevFlow (BYO-key / local-first) y no depende de ninguna API paga. La
// búsqueda en sí (coseno) corre en Rust (rag.rs) sobre el índice ya construido en disco.
import { httpRequest, ragSearch, readTextFile, type RagMatch } from "./tauriApi";

export const OLLAMA_BASE_URL = "http://localhost:11434";
export const EMBED_MODEL = "nomic-embed-text";

export function indexPath(projectRoot: string): string {
  return `${projectRoot}/.devflow/rag-index.json`;
}

// Ollama's /api/embeddings — un texto por llamada (no todas las versiones de Ollama tienen el
// endpoint /api/embed con batch). Vía httpRequest (Rust), no fetch() crudo: mismo motivo que ya
// documenta localProviders.ts — no se puede asumir CORS permisivo de un server local de terceros.
export async function embedText(text: string): Promise<number[]> {
  const res = await httpRequest(
    "POST",
    `${OLLAMA_BASE_URL}/api/embeddings`,
    { "Content-Type": "application/json" },
    JSON.stringify({ model: EMBED_MODEL, prompt: text })
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Ollama (embeddings) respondió ${res.status}: ${res.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(res.body) as { embedding?: number[] };
  if (!parsed.embedding) throw new Error("Ollama no devolvió un embedding");
  return parsed.embedding;
}

export async function search(projectRoot: string, query: string, topK = 6): Promise<RagMatch[]> {
  const embedding = await embedText(query);
  return ragSearch(indexPath(projectRoot), embedding, topK);
}

// Arma el bloque `[Related code]` para inyectar en un prompt — lee cada chunk REAL de disco (el
// índice solo guarda rango de líneas + embedding, no el texto, para no duplicar el contenido dos
// veces). readTextFile ya soporta rangos (line, limit).
export async function formatChunksForPrompt(matches: RagMatch[]): Promise<string> {
  if (matches.length === 0) return "";
  const blocks = await Promise.all(
    matches.map(async (m) => {
      let text: string;
      try {
        text = await readTextFile(m.path, m.startLine, m.endLine - m.startLine + 1);
      } catch {
        return null;
      }
      return `### ${m.path}:L${m.startLine}-${m.endLine}\n\`\`\`\n${text}\n\`\`\``;
    })
  );
  const valid = blocks.filter((b): b is string => !!b);
  if (valid.length === 0) return "";
  return `[Related code]\nMost relevant existing code for this task (semantic search over the project):\n\n${valid.join("\n\n")}`;
}

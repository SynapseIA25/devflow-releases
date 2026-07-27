// Construcción del índice RAG (.devflow/rag-index.json) — chunking por ventana de líneas de tamaño
// fijo (agnóstico de lenguaje, sin AST/tree-sitter: mismo criterio que ya eligió este proyecto para
// el LSP —evitar dependencias pesadas— y que ya usa codebaseMap.ts, que también es regex/estructural
// en vez de parsear de verdad). Reconstrucción MANUAL (botón "Reconstruir índice"), no automática en
// cada guardado — ver alcance de la spec.
import { readDir, readTextFile, writeTextFile, createDir } from "./tauriApi";
import { embedText, indexPath, EMBED_MODEL } from "./ragEngine";

const RAG_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "md"];
const MAX_RAG_FILES = 2000; // techo generoso — a diferencia del mapa visual (codebaseMap, 250), acá no hay que renderizar nada
const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 15;
// Defensa extra además del try/catch de más abajo: un archivo con líneas muy largas (ej. un .md
// generado con texto de licencias sin wrap) puede hacer que una ventana de 60 líneas sea enorme en
// caracteres aunque sean pocas líneas — se trunca antes de mandarlo a embeber, no cambia el rango de
// líneas reportado (sigue siendo útil para ubicar el chunk real en el archivo).
const MAX_CHUNK_CHARS = 4000;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

// Mismo recorrido BFS que collectFiles en codebaseMap.ts (read_dir de Rust ya omite node_modules/
// target/.git/dist/build/.next/.turbo) — no se reusa esa función porque no está exportada y difiere
// en la extensión que acepta (acá suma .rs/.py/.md, no solo JS/TS).
async function collectRagFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDir) queue.push(e.path);
      else if (RAG_EXTENSIONS.includes(extOf(e.name))) {
        out.push(e.path);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

type RagChunkInput = { path: string; startLine: number; endLine: number; text: string };

function chunkFile(path: string, content: string): RagChunkInput[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [];
  const chunks: RagChunkInput[] = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const text = lines.slice(start, end).join("\n").slice(0, MAX_CHUNK_CHARS);
    chunks.push({ path, startLine: start + 1, endLine: end, text });
    if (end >= lines.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

export type BuildProgress = { stage: "scanning" | "chunking" | "embedding"; done: number; total: number };

export async function buildIndex(
  projectRoot: string,
  onProgress?: (p: BuildProgress) => void
): Promise<{ chunkCount: number; fileCount: number }> {
  onProgress?.({ stage: "scanning", done: 0, total: 0 });
  const files = await collectRagFiles(projectRoot, MAX_RAG_FILES);

  const allChunks: RagChunkInput[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.({ stage: "chunking", done: i, total: files.length });
    let content: string;
    try {
      content = await readTextFile(files[i]);
    } catch {
      continue;
    }
    allChunks.push(...chunkFile(files[i], content));
  }

  const embedded: { path: string; startLine: number; endLine: number; embedding: number[] }[] = [];
  let skipped = 0;
  for (let i = 0; i < allChunks.length; i++) {
    onProgress?.({ stage: "embedding", done: i, total: allChunks.length });
    const c = allChunks[i];
    try {
      // Un chunk puntual puede exceder el context length del embedder (visto en la práctica: un
      // archivo con líneas muy largas hace que una ventana de 60 líneas sea "demasiado texto" para
      // nomic-embed-text) — sin este catch, UN chunk problemático abortaba el índice ENTERO y
      // tiraba todos los embeddings ya calculados. Se salta el chunk, no el build completo.
      const embedding = await embedText(c.text);
      embedded.push({ path: c.path, startLine: c.startLine, endLine: c.endLine, embedding });
    } catch {
      skipped++;
    }
  }
  onProgress?.({ stage: "embedding", done: allChunks.length, total: allChunks.length });
  if (skipped > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[rag] ${skipped} chunk(s) de ${allChunks.length} no se pudieron embeber (se saltearon)`);
  }

  const index = {
    model: EMBED_MODEL,
    dim: embedded[0]?.embedding.length ?? 0,
    builtAt: Date.now(),
    chunks: embedded,
  };
  await createDir(`${projectRoot}/.devflow`);
  await writeTextFile(indexPath(projectRoot), JSON.stringify(index));
  return { chunkCount: embedded.length, fileCount: files.length };
}

export type RagIndexStatus = { exists: boolean; model?: string; chunkCount?: number; builtAt?: number };

export async function readIndexStatus(projectRoot: string): Promise<RagIndexStatus> {
  try {
    const raw = await readTextFile(indexPath(projectRoot));
    const parsed = JSON.parse(raw) as { model?: string; builtAt?: number; chunks?: unknown[] };
    return { exists: true, model: parsed.model, chunkCount: parsed.chunks?.length ?? 0, builtAt: parsed.builtAt };
  } catch {
    return { exists: false };
  }
}

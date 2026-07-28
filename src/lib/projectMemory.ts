// Memoria persistente de proyecto — capa de prompts sobre memoryFiles.ts (la capa de archivos:
// entradas individuales + índice regenerado). Funciona igual para agentes ACP (Claude Code) y para
// el path nativo de OpenCode, porque no depende de nada del motor — solo lee/escribe archivos y arma
// texto para el prompt, igual que antes.
import { readTextFile } from "./tauriApi";
import {
  listMemoryEntries,
  memoryIndexPath,
  buildIndexContent,
  MEMORY_CATEGORIES,
  type MemoryEntry,
} from "./memoryFiles";
import type { DocBlockData } from "../store/workspaceStore";

export function memoryPath(projectRoot: string): string {
  return memoryIndexPath(projectRoot);
}

// Contenido crudo de MEMORY.md tal cual está en disco. Con la arquitectura por entradas esto es
// normalmente el índice regenerado — pero también es cómo se detecta memoria VIEJA sin migrar (un
// proyecto con MEMORY.md en formato prosa de antes de este rediseño, sin .devflow/memory/ todavía):
// buildDistillationPrompt se la manda al agente para que la divida en entradas la primera vez.
export async function readProjectMemory(projectRoot: string): Promise<string> {
  try {
    return await readTextFile(memoryIndexPath(projectRoot));
  } catch {
    return ""; // no existe todavía — el proyecto simplemente no tiene memoria aún
  }
}

// [Memory]: el índice completo (compacto — una línea por entrada, no crece con el CONTENIDO de cada
// memoria) más el cuerpo ENTERO de las entradas "pinned" inline, para que nada marcado como crítico
// dependa de que el agente decida leer un archivo aparte. El resto lo lee bajo demanda con su propia
// herramienta de lectura — mismo mecanismo ya probado por buildSkillsPreamble (skills.ts) para el
// mismo problema (un índice que no crece sin límite, en vez de inyectar todo siempre).
export async function buildMemoryPreamble(projectRoot: string): Promise<string> {
  const entries = await listMemoryEntries(projectRoot);
  if (entries.length === 0) return "";
  const index = buildIndexContent(entries);
  const pinned = entries.filter((e) => e.pinned);
  const pinnedBlock = pinned.length
    ? `\n\n[Pinned memory — always relevant, full content]\n${pinned.map((e) => `### ${e.hook || e.slug}\n${e.body}`).join("\n\n")}`
    : "";
  return (
    `[Memory]\nProject memory from previous sessions. READ a file below (path relative to the ` +
    `project root) if it looks relevant to the current task.\n\n${index}${pinnedBlock}`
  );
}

// Transcript acotado de los bloques recientes del workspace para el turno de destilación (/remember)
// — solo user/ai (se saltea tool/thought, son ruido para "qué aprendimos"), capado en cantidad y en
// largo por bloque para no volar el contexto del modelo que arma la memoria.
export function summarizeWorkspaceBlocks(blocks: DocBlockData[], maxBlocks = 40, maxCharsPerBlock = 800): string {
  const relevant = blocks.filter((b) => b.type === "user" || b.type === "ai").slice(-maxBlocks);
  const lines = relevant.map((b) => {
    const who = b.type === "user" ? "Usuario" : "Agente";
    const text = b.content.length > maxCharsPerBlock ? `${b.content.slice(0, maxCharsPerBlock)}…` : b.content;
    return `${who}: ${text}`;
  });
  return lines.join("\n\n");
}

// legacyRaw: contenido crudo de un MEMORY.md viejo (formato prosa) sin migrar todavía — se le pasa
// al agente SOLO si no hay entradas estructuradas aún, pidiéndole que también lo divida en entradas
// en la misma pasada (evita necesitar un comando/migración aparte: /remember migra sola la primera
// vez que corre sobre un proyecto viejo).
export function buildDistillationPrompt(entries: MemoryEntry[], legacyRaw: string, transcript: string): string {
  const categories = MEMORY_CATEGORIES.join(" | ");
  const existingBlock = entries.length
    ? entries
        .map((e) => `- slug: ${e.slug} | category: ${e.category} | tags: [${e.tags.join(", ")}] | pinned: ${e.pinned}\n  ${e.hook}`)
        .join("\n")
    : "(none yet)";
  const legacyBlock =
    entries.length === 0 && legacyRaw.trim()
      ? `\n\nThis project has OLD unstructured memory that hasn't been migrated to entries yet — split ` +
        `it into proper entries too, don't discard it:\n${legacyRaw.trim()}`
      : "";
  return (
    `You maintain this project's persistent memory as structured entries (not one prose file) — each ` +
    `entry is its own file, injected compactly into future sessions: always as one index line, and in ` +
    `full ONLY if marked "pinned".\n\n` +
    `Existing entries:\n${existingBlock}${legacyBlock}\n\n` +
    `Recent conversation:\n${transcript || "(no user/agent messages to summarize)"}\n\n` +
    `Decide what's worth remembering long-term from this conversation: decisions, conventions, gotchas, ` +
    `business context, or preferences that would help a future session avoid starting from scratch. ` +
    `Reuse an existing slug to UPDATE an entry instead of duplicating it. Mark "pinned": true ONLY for ` +
    `something that must never be missed (e.g. a hard rule) — most entries should NOT be pinned, since ` +
    `pinned entries are always injected in full, defeating the point of keeping the rest compact. Remove ` +
    `entries that are now wrong or obsolete.\n\n` +
    `Respond ONLY with a JSON array of operations, as your message text — no extra commentary, no fences ` +
    `around the whole response. Each item is one of:\n` +
    `{"op": "upsert", "slug": "kebab-case-id", "category": "${categories}", "tags": ["short","tags"], ` +
    `"pinned": false, "hook": "one-line summary for the index", "body": "full Markdown content"}\n` +
    `{"op": "remove", "slug": "kebab-case-id"}\n` +
    `If there's nothing worth remembering from this conversation, respond with an empty array: []`
  );
}

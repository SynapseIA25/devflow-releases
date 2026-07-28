// Memoria persistente de proyecto — capa de archivos (Fase 2 del rediseño, ver conversación: el
// MEMORY.md original era un solo blob de prosa re-resumido en cada /remember, que con el tiempo
// pierde matices o crece sin límite si se deja de resumir). Ahora cada memoria vive en su propio
// archivo bajo .devflow/memory/<slug>.md (mismo criterio que .devflow/specs/<slug>/ en
// specFiles.ts), con frontmatter de categoría/tags/pinned. MEMORY.md en la raíz pasa a ser el
// ÍNDICE — liviano, una línea por entrada, regenerado siempre a partir de los archivos reales en
// disco (nunca escrito a mano, para que no se desincronice) — sigue siendo el archivo visible en la
// pestaña Documentación de Project Hub, ahora compacto de verdad sin importar cuánto crezca el
// CONTENIDO de cada memoria. La capa de prompts (qué se inyecta, cómo se pide la actualización) vive
// en projectMemory.ts, que usa este módulo — mismo split que specFiles.ts/specOrchestrator.ts.
import { readDir, readTextFile, writeTextFile, removeFile, createDir } from "./tauriApi";
import { slugify } from "./specFiles";

export type MemoryCategory = "decision" | "convention" | "gotcha" | "context" | "preference";
export const MEMORY_CATEGORIES: MemoryCategory[] = ["decision", "convention", "gotcha", "context", "preference"];

export type MemoryEntry = {
  slug: string;
  category: MemoryCategory;
  tags: string[];
  pinned: boolean; // true = cuerpo completo siempre inline en el prompt, no solo indexado
  hook: string; // resumen de una línea para el índice — mismo rol que "description" en Skill
  body: string;
  updatedAt: number;
};

export function memoryDir(projectRoot: string): string {
  return `${projectRoot}/.devflow/memory`;
}
export function memoryEntryPath(projectRoot: string, slug: string): string {
  return `${memoryDir(projectRoot)}/${slug}.md`;
}
export function memoryIndexPath(projectRoot: string): string {
  return `${projectRoot}/MEMORY.md`;
}

// ── Frontmatter chico ("key: value" plano, sin YAML real — no vale la pena una dependencia de
// parser para 5 campos) ──
const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseEntry(slug: string, raw: string): MemoryEntry | null {
  const m = raw.match(FM_RE);
  if (!m) return null;
  const [, fm, body] = m;
  const fields: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const category = (MEMORY_CATEGORIES as string[]).includes(fields.category) ? (fields.category as MemoryCategory) : "context";
  const tags = fields.tags
    ? fields.tags.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  return { slug, category, tags, pinned: fields.pinned === "true", hook: fields.hook ?? "", body: body.trim(), updatedAt: Number(fields.updatedAt) || 0 };
}

function serializeEntry(e: MemoryEntry): string {
  return (
    `---\ncategory: ${e.category}\ntags: [${e.tags.join(", ")}]\npinned: ${e.pinned}\n` +
    `hook: ${e.hook}\nupdatedAt: ${e.updatedAt}\n---\n\n${e.body.trim()}\n`
  );
}

export async function listMemoryEntries(projectRoot: string): Promise<MemoryEntry[]> {
  let files;
  try {
    files = await readDir(memoryDir(projectRoot));
  } catch {
    return []; // no existe todavía — proyecto sin memoria estructurada aún (o recién migrando)
  }
  const entries: MemoryEntry[] = [];
  for (const f of files) {
    if (f.isDir || !f.name.toLowerCase().endsWith(".md")) continue;
    try {
      const raw = await readTextFile(f.path);
      const entry = parseEntry(f.name.replace(/\.md$/i, ""), raw);
      if (entry) entries.push(entry);
    } catch {
      /* un archivo individual ilegible no tumba el resto */
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries;
}

export async function writeMemoryEntry(projectRoot: string, entry: MemoryEntry): Promise<void> {
  await createDir(memoryDir(projectRoot));
  await writeTextFile(memoryEntryPath(projectRoot, entry.slug), serializeEntry(entry));
}

export async function removeMemoryEntry(projectRoot: string, slug: string): Promise<void> {
  await removeFile(memoryEntryPath(projectRoot, slug));
}

// ── Índice (MEMORY.md) ──
const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  decision: "Decision",
  convention: "Convention",
  gotcha: "Gotcha",
  context: "Context",
  preference: "Preference",
};

export function buildIndexContent(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return `# Project Memory\n\nNo memory yet — use \`/remember\` in chat after a session worth remembering.\n`;
  }
  const lines = entries.map((e) => {
    const tags = e.tags.length ? ` (${e.tags.join(", ")})` : "";
    const pin = e.pinned ? " 📌" : "";
    return `- **${CATEGORY_LABEL[e.category]}**${pin} [${e.hook || e.slug}](.devflow/memory/${e.slug}.md)${tags}`;
  });
  return `# Project Memory\n\nIndex of persistent memory for this project — full content lives under \`.devflow/memory/\`.\n\n${lines.join("\n")}\n`;
}

export async function rebuildIndex(projectRoot: string): Promise<MemoryEntry[]> {
  const entries = await listMemoryEntries(projectRoot);
  await writeTextFile(memoryIndexPath(projectRoot), buildIndexContent(entries));
  return entries;
}

// ── Ops estructuradas — la forma en la que /remember pide la actualización (ver
// projectMemory.buildDistillationPrompt). "upsert" en vez de "add"/"update" separados: el slug ya
// dice si es nuevo o existente, no hace falta que el LLM lo determine él mismo. ──
export type MemoryOp =
  | { op: "upsert"; slug: string; category: MemoryCategory; tags?: string[]; pinned?: boolean; hook: string; body: string }
  | { op: "remove"; slug: string };

// Extrae el primer array JSON de una respuesta (tolera fences ```json ... ``` y texto alrededor).
// Mismo patrón que extractJsonArray en teamDelegate.ts, duplicado a propósito — cada parser de
// salida de LLM en este proyecto es chico y específico a su forma (ver specFiles.ts/stripFence).
export function extractMemoryOps(raw: string): MemoryOp[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((o) => o && typeof o === "object" && "op" in o) : [];
  } catch {
    return [];
  }
}

export async function applyMemoryOps(
  projectRoot: string,
  ops: MemoryOp[]
): Promise<{ added: number; updated: number; removed: number }> {
  const existingSlugs = new Set((await listMemoryEntries(projectRoot)).map((e) => e.slug));
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const raw of ops) {
    if (raw.op === "remove") {
      await removeMemoryEntry(projectRoot, raw.slug);
      if (existingSlugs.has(raw.slug)) removed++;
      continue;
    }
    const slug = slugify(raw.slug);
    const category = (MEMORY_CATEGORIES as string[]).includes(raw.category) ? raw.category : "context";
    const entry: MemoryEntry = {
      slug,
      category,
      tags: raw.tags ?? [],
      pinned: raw.pinned ?? false,
      hook: raw.hook,
      body: raw.body,
      updatedAt: Date.now(),
    };
    await writeMemoryEntry(projectRoot, entry);
    if (existingSlugs.has(slug)) updated++;
    else added++;
  }
  await rebuildIndex(projectRoot);
  return { added, updated, removed };
}

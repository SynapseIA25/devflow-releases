import { homeDir, createDir, writeTextFile } from "./tauriApi";

// ── Skills de DevFlow (memoria procedural compartible) ──
// Una skill es un procedimiento reutilizable en formato SKILL.md (frontmatter name/description +
// cuerpo markdown), el mismo formato de Claude Code / Hermes / agentskills.io → interoperable.
// El flujo completo (inspirado en el skill_manage + curator de Hermes, adaptado a un host ACP):
//   1. Minería: tras un turno con suficientes tool calls, un one-shot barato (perfil "fast" del
//      router) destila la sesión en una skill SUGERIDA (skillMiner.ts). Nunca se auto-aprueba.
//   2. Inyección por divulgación progresiva: al abrir una sesión ACP se inyecta solo un ÍNDICE
//      (nombre — descripción → path). El agente lee el SKILL.md con su PROPIO tool de lectura
//      cuando la tarea matchea — cero costo de tokens para skills irrelevantes.
//   3. Uso: ChatView detecta lecturas de paths de skills en los tool calls → uses/lastUsedAt.
//   4. Curator-lite (skillsStore.curatorPass): pasada determinista que marca "stale" lo no usado
//      en 30 días. Sin LLM, nunca borra ni archiva solo (el archivado es manual y reversible).
//   5. Compartir: export/import de archivos .skill.md + "taps" (repos de GitHub como fuentes).

export type SkillSource = "user" | "mined" | "imported" | "tap";

export type Skill = {
  id: string;
  name: string; // slug kebab-case, único; también es el nombre de la carpeta en disco
  description: string; // una línea — es lo que ve el agente en el índice para decidir si leerla
  category?: string;
  content: string; // cuerpo markdown (sin frontmatter)
  source: SkillSource;
  tapRepo?: string; // "owner/repo" si vino de un tap
  enabled: boolean;
  pinned: boolean; // pinneada = el curator nunca la marca stale
  archived: boolean; // fuera del índice pero recuperable (nunca se borra sola)
  stale: boolean; // marcada por el curator: 30 días sin uso
  uses: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
};

// Sugerencia minada de una sesión, pendiente de aprobación del usuario (gate SIEMPRE activo).
export type SkillSuggestion = {
  id: string;
  name: string;
  description: string;
  category?: string;
  content: string;
  fromWsTitle?: string;
  createdAt: number;
};

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";

// ── SKILL.md: parseo/serialización del frontmatter (subset YAML plano key: value) ──

export function parseSkillMd(text: string): { name: string; description: string; category?: string; content: string } | null {
  const m = text.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!fields.name || !fields.description) return null;
  return {
    name: slugify(fields.name),
    description: fields.description,
    category: fields.category || undefined,
    content: m[2].trim(),
  };
}

export function serializeSkillMd(s: Pick<Skill, "name" | "description" | "category" | "content">): string {
  const cat = s.category ? `category: ${s.category}\n` : "";
  return `---\nname: ${s.name}\ndescription: ${s.description}\n${cat}---\n\n${s.content.trim()}\n`;
}

// ── Disco: ~/.devflow/skills/<name>/SKILL.md ──
// Paths con "/" (Windows los acepta y evita el infierno de escapes en el prompt inyectado).

let cachedRoot: string | null = null;

export async function skillsRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
  cachedRoot = `${home}/.devflow/skills`;
  return cachedRoot;
}

export const skillDiskPath = (root: string, name: string) => `${root}/${name}/SKILL.md`;

// Sincroniza las skills activas al disco (mejor esfuerzo: sin API de borrado en tauriApi, un
// archivo huérfano de una skill eliminada queda inerte — no está en el índice, nadie lo lee).
export async function syncSkillsToDisk(skills: Skill[]): Promise<void> {
  const root = await skillsRoot();
  for (const s of skills) {
    if (s.archived) continue;
    try {
      await createDir(`${root}/${s.name}`);
      await writeTextFile(skillDiskPath(root, s.name), serializeSkillMd(s));
    } catch {
      // sin disco no hay índice para esta skill; el resto sigue
    }
  }
}

// ── Índice inyectado en el preámbulo [System] de una sesión nueva ──

const MAX_INDEXED_SKILLS = 30;

export function buildSkillsPreamble(skills: Skill[], root: string): string {
  const active = skills.filter((s) => s.enabled && !s.archived).slice(0, MAX_INDEXED_SKILLS);
  if (active.length === 0) return "";
  const lines = active.map((s) => `- ${s.name} — ${s.description} → ${skillDiskPath(root, s.name)}`);
  return (
    `[Skills]\nYou have a library of reusable skills: procedures distilled from past work in this environment. ` +
    `When the current task matches one, READ its SKILL.md file first and follow it.\n${lines.join("\n")}`
  );
}

// Detecta el nombre de la skill referida en un tool call (lectura de su SKILL.md) → tracking de uso.
const USE_RE = /[\\/]\.devflow[\\/]skills[\\/]([a-z0-9][a-z0-9-]*)/i;

export function detectSkillUse(haystack: string): string | null {
  const m = haystack.match(USE_RE);
  return m ? m[1].toLowerCase() : null;
}

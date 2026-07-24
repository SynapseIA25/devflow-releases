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

// "global" vive en ~/.devflow/skills (visible en todos los proyectos); "project" vive en
// <projectRoot>/.devflow/skills (visible solo en ese proyecto) — ver skillRoot()/projectSkillsRoot().
export type SkillScope = "global" | "project";

export type Skill = {
  id: string;
  name: string; // slug kebab-case, único DENTRO de su (scope, projectId); también el nombre de la carpeta en disco
  description: string; // una línea — es lo que ve el agente en el índice para decidir si leerla
  category?: string;
  content: string; // cuerpo markdown (sin frontmatter)
  source: SkillSource;
  tapRepo?: string; // "owner/repo" si vino de un tap
  scope: SkillScope;
  projectId?: string; // set sii scope === "project" — id de projectStore, NO el path (puede cambiar/borrarse)
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
  scope: SkillScope;
  projectId?: string;
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

// Raíz de disco de las skills de UN proyecto — mismo patrón que <project>/.devflow/scripts/ (ver
// verifyScript.ts) y <project>/MEMORY.md: un archivo/carpeta más en la raíz del proyecto, keyed por
// el path REGISTRADO del proyecto (projects[id].path), NO por sessionCwd — sessionCwd puede ser un
// worktree/Ambiente distinto, y syncSkillsToDisk corre en background sin noción de sesión activa.
export const projectSkillsRoot = (projectRoot: string): string =>
  `${projectRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/.devflow/skills`;

// Resuelve la raíz de disco de una skill según su scope. null = skill de proyecto "huérfana" (su
// projectId ya no resuelve a un proyecto real — borrado/renombrado): el caller la saltea, mejor
// esfuerzo, nunca tira error.
export function skillRoot(skill: Skill, globalRoot: string, projectRoots: Record<string, string>): string | null {
  if (skill.scope === "global") return globalRoot;
  const root = skill.projectId ? projectRoots[skill.projectId] : undefined;
  return root ? projectSkillsRoot(root) : null;
}

// Sincroniza las skills activas al disco (mejor esfuerzo: sin API de borrado en tauriApi, un
// archivo huérfano de una skill eliminada queda inerte — no está en el índice, nadie lo lee).
// projectRoots: id de proyecto → path registrado (skillsStore.ts lo arma desde projectStore).
export async function syncSkillsToDisk(skills: Skill[], projectRoots: Record<string, string>): Promise<void> {
  const globalRoot = await skillsRoot();
  for (const s of skills) {
    if (s.archived) continue;
    const root = skillRoot(s, globalRoot, projectRoots);
    if (!root) continue; // huérfana: nada a donde sincronizar
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

// project: el proyecto de la sesión que se está abriendo (id + path REGISTRADO, no sessionCwd) —
// sin esto solo se ve el índice global, igual que antes de que existiera scope de proyecto.
export function buildSkillsPreamble(skills: Skill[], globalRoot: string, project?: { id: string; root: string }): string {
  const visible = skills.filter(
    (s) => s.enabled && !s.archived && (s.scope === "global" || (project !== undefined && s.projectId === project.id))
  );
  // Skills de este proyecto primero: si hay 30+ skills entre global y proyecto, las más relevantes
  // para la sesión actual no deben quedar afuera del cap por venir después alfabéticamente/por id.
  visible.sort((a, b) => (a.scope === "project" ? 0 : 1) - (b.scope === "project" ? 0 : 1));
  const active = visible.slice(0, MAX_INDEXED_SKILLS);
  if (active.length === 0) return "";
  const lines = active.map((s) => {
    const root = s.scope === "project" && project ? projectSkillsRoot(project.root) : globalRoot;
    return `- ${s.name} — ${s.description} → ${skillDiskPath(root, s.name)}`;
  });
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

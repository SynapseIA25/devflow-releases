// Artefactos de Spec-Driven Development (requirements.md/design.md/tasks.md) — fuente de verdad en
// disco, mismo criterio que MEMORY.md (projectMemory.ts): editable/versionable fuera de DevFlow, el
// store (projectStore.ts) solo guarda metadata liviana (fase, estado, el checklist parseado).
import { createDir, readTextFile, writeTextFile } from "./tauriApi";

export type SpecArtifactKind = "requirements" | "design" | "tasks";

// "Agregar health-check endpoint" -> "agregar-health-check-endpoint". Colisiones (mismo slug ya
// usado en el proyecto) se resuelven en projectStore.createSpec agregando un sufijo numérico.
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "") // saca acentos (marcas combinantes tras NFD)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "spec"
  );
}

export function specDir(projectRoot: string, slug: string): string {
  return `${projectRoot}/.devflow/specs/${slug}`;
}

export function specArtifactPath(projectRoot: string, slug: string, kind: SpecArtifactKind): string {
  return `${specDir(projectRoot, slug)}/${kind}.md`;
}

export async function readSpecArtifact(projectRoot: string, slug: string, kind: SpecArtifactKind): Promise<string> {
  try {
    return await readTextFile(specArtifactPath(projectRoot, slug, kind));
  } catch {
    return ""; // no existe todavía (fase no corrida aún) — no es un error
  }
}

export async function writeSpecArtifact(
  projectRoot: string,
  slug: string,
  kind: SpecArtifactKind,
  content: string
): Promise<void> {
  await createDir(specDir(projectRoot, slug));
  await writeTextFile(specArtifactPath(projectRoot, slug, kind), content);
}

// ── tasks.md ──────────────────────────────────────────────────────────────────────────────────

export type SpecTaskState = { id: string; text: string; done: boolean; area?: string };

const TASK_LINE_RE = /^[-*]\s*\[([ xX])\]\s*(.+)$/;
const AREA_TAG_RE = /\(area:\s*([a-z-]+)\)\s*$/i;

// Tolera que el modelo haya envuelto la respuesta en un fence ```md ... ``` (mismo espíritu que
// extractJsonArray en teamDelegate.ts, pero para una lista de checkboxes en vez de JSON).
function stripFence(s: string): string {
  const fence = s.match(/```(?:md|markdown)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

// Parsea un tasks.md real (o la respuesta cruda del agente) a la forma que usa projectStore.Spec.
// Cada línea "- [ ] Texto (area: backend)" -> {text: "Texto", area: "backend", done: false}. Líneas
// que no matchean el patrón de checkbox se ignoran (texto suelto que el modelo haya agregado).
export function parseTasksMarkdown(raw: string): SpecTaskState[] {
  const lines = stripFence(raw).split("\n");
  const tasks: SpecTaskState[] = [];
  let n = 0;
  for (const line of lines) {
    const m = line.match(TASK_LINE_RE);
    if (!m) continue;
    const done = m[1].toLowerCase() === "x";
    let text = m[2].trim();
    const areaMatch = text.match(AREA_TAG_RE);
    const area = areaMatch?.[1]?.toLowerCase();
    if (areaMatch) text = text.slice(0, areaMatch.index).trim();
    n += 1;
    tasks.push({ id: `t${n}`, text, done, area });
  }
  return tasks;
}

// Inverso de parseTasksMarkdown — regenera el markdown con el estado actual (usado tras tildar una
// tarea en Implement, para que el archivo en disco quede sincronizado con projectStore.Spec.tasks).
export function serializeTasksMarkdown(tasks: SpecTaskState[]): string {
  return tasks
    .map((t) => {
      const box = t.done ? "[x]" : "[ ]";
      const areaTag = t.area ? ` (area: ${t.area})` : "";
      return `- ${box} ${t.text}${areaTag}`;
    })
    .join("\n");
}

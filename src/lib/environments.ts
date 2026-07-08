import { runShellCommand, createDir } from "./tauriApi";
import { baseName } from "../store/projectStore";

// Helpers de ambientes de prueba (git worktree efímero), compartidos entre la vista Ambientes y la
// auto-delegación del Equipo (que corre a los expertos AISLADOS en un worktree). Todo git vía
// runShellCommand (Git Bash), mismo patrón que git init/clone del hub — sin Rust.
const toPosix = (p: string) => p.replace(/\\/g, "/");
export const safeEnvName = (s: string) => s.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "env";
function parentDir(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  return i >= 0 ? t.slice(0, i) : t;
}

export type CreatedWorktree = { name: string; branch: string; path: string; baseBranch: string };

// Crea un git worktree con rama env/<name> desde la rama base del proyecto, en un sibling
// .devflow-envs/ fuera del árbol del proyecto. Lanza con mensaje claro si el proyecto no es repo git.
export async function createWorktree(projectPath: string, name: string): Promise<CreatedWorktree> {
  const base = await runShellCommand("git rev-parse --abbrev-ref HEAD", projectPath);
  if (base.exitCode !== 0) throw new Error("El proyecto no es un repositorio git (o no tiene commits). Los ambientes usan git worktree.");
  const baseBranch = base.output.trim();
  const branch = `env/${safeEnvName(name)}`;
  const envsRoot = `${toPosix(parentDir(projectPath))}/.devflow-envs`;
  const wtPath = `${envsRoot}/${safeEnvName(baseName(projectPath))}__${safeEnvName(name)}`;
  try { await createDir(envsRoot); } catch { /* ya existe */ }
  const res = await runShellCommand(`git worktree add "${wtPath}" -b "${branch}"`, projectPath);
  if (res.exitCode !== 0) throw new Error(`No se pudo crear el ambiente:\n${res.output.slice(-500)}`);
  return { name, branch, path: wtPath, baseBranch };
}

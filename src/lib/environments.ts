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

// GitHub nativo ("Open as environment" de un PR): a diferencia de createWorktree (rama NUEVA desde
// la base), acá el worktree tiene que terminar en la rama DEL PR — que puede venir de un fork, así
// que en vez de armar el nombre de rama remota a mano se reusa `gh pr checkout` (ya maneja forks,
// fetch, tracking) corriéndolo DENTRO del worktree recién creado. El worktree arranca en una rama
// descartable desde la base; gh pr checkout lo reapunta al branch real, que leemos de vuelta para
// que `TestEnv.branch` quede correcto (lo necesita el promote/diff de más arriba).
export async function createWorktreeFromPr(projectPath: string, prNumber: number, name: string): Promise<CreatedWorktree> {
  const base = await runShellCommand("git rev-parse --abbrev-ref HEAD", projectPath);
  if (base.exitCode !== 0) throw new Error("El proyecto no es un repositorio git (o no tiene commits). Los ambientes usan git worktree.");
  const baseBranch = base.output.trim();
  const envsRoot = `${toPosix(parentDir(projectPath))}/.devflow-envs`;
  const wtPath = `${envsRoot}/${safeEnvName(baseName(projectPath))}__pr-${prNumber}`;
  try { await createDir(envsRoot); } catch { /* ya existe */ }
  const placeholder = `pr-${prNumber}-tmp`;
  const add = await runShellCommand(`git worktree add "${wtPath}" -b "${placeholder}" "${baseBranch}"`, projectPath);
  if (add.exitCode !== 0) throw new Error(`No se pudo crear el worktree:\n${add.output.slice(-500)}`);
  const checkout = await runShellCommand(`gh pr checkout ${prNumber}`, wtPath);
  if (checkout.exitCode !== 0) {
    await runShellCommand(`git worktree remove --force "${wtPath}"`, projectPath).catch(() => undefined);
    throw new Error(`No se pudo hacer checkout del PR #${prNumber} (¿"gh" está instalado y autenticado?):\n${checkout.output.slice(-500)}`);
  }
  const branchRes = await runShellCommand("git rev-parse --abbrev-ref HEAD", wtPath);
  const branch = branchRes.output.trim() || placeholder;
  return { name, branch, path: wtPath, baseBranch };
}

export type CreatedSshWorktree = { name: string; branch: string; remotePath: string; remoteProjectPath: string; baseBranch: string };

// SSH Worktrees (base, Orca backlog): crea el worktree DEL LADO REMOTO — todo corre vía `ssh
// <host> "<comando>"` ejecutado localmente con runShellCommand (Git Bash), mismo criterio de
// "reusar la CLI del sistema" que el resto del proyecto usa para git; sin librería SSH nueva, sin
// credenciales manejadas acá (asume claves ya cargadas o un alias en ~/.ssh/config, como cualquier
// `ssh` de terminal). El terminal interactivo del ambiente reusa pty_spawn tal cual, pasándole
// `ssh -t <host> "cd '<path>' && exec $SHELL -l"` como comando — no hizo falta Rust nuevo para eso.
export async function createSshWorktree(sshHost: string, remotePath: string, name: string): Promise<CreatedSshWorktree> {
  const safeName = safeEnvName(name);
  const remoteTrim = remotePath.replace(/\/+$/, "");
  const slashIdx = remoteTrim.lastIndexOf("/");
  const parent = slashIdx >= 0 ? remoteTrim.slice(0, slashIdx) : remoteTrim;
  const projectBase = slashIdx >= 0 ? remoteTrim.slice(slashIdx + 1) : remoteTrim;
  const envsRoot = `${parent}/.devflow-envs`;
  const wtPath = `${envsRoot}/${safeEnvName(projectBase)}__${safeName}`;
  const branch = `env/${safeName}`;

  const base = await runShellCommand(`ssh "${sshHost}" "git -C '${remoteTrim}' rev-parse --abbrev-ref HEAD"`, ".");
  if (base.exitCode !== 0) {
    throw new Error(`No se pudo conectar a "${sshHost}" o "${remoteTrim}" no es un repo git ahí:\n${base.output.slice(-500)}`);
  }
  const baseBranch = base.output.trim();

  const add = await runShellCommand(
    `ssh "${sshHost}" "mkdir -p '${envsRoot}' && git -C '${remoteTrim}' worktree add '${wtPath}' -b '${branch}'"`,
    "."
  );
  if (add.exitCode !== 0) throw new Error(`No se pudo crear el worktree remoto:\n${add.output.slice(-500)}`);

  return { name, branch, remotePath: wtPath, remoteProjectPath: remoteTrim, baseBranch };
}

// Comando de PTY para una terminal interactiva DENTRO del worktree remoto — pty_spawn (Rust) ya
// acepta un comando arbitrario, así que no hace falta ningún cambio de Rust para esto.
export function sshTerminalCommand(sshHost: string, remoteWorktreePath: string): string {
  return `ssh -t "${sshHost}" "cd '${remoteWorktreePath}' && exec \\$SHELL -l"`;
}

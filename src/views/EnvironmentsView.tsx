import { useMemo, useState } from "react";
import { Boxes, Plus, Loader, GitBranch, RefreshCw, Check, Trash2, X, ArrowUpFromLine, MessageSquare } from "lucide-react";
import { useProjectStore, baseName, type TestEnv } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { TerminalPane } from "../components/TerminalPane";
import { runShellCommand, createDir, ptyKill, isTauri } from "../lib/tauriApi";

// Vista de Ambientes de prueba. Cada ambiente es un git worktree efímero con su rama propia
// (env/<name>), creado desde la rama base del proyecto activo. El agente/terminal trabajan AISLADOS
// ahí; al terminar se revisa el diff y se promueve (merge a la base) o se descarta (worktree remove).
// Todo git se hace con runShellCommand (Git Bash), mismo patrón que git init/clone del hub — sin Rust.

const git = (cmd: string, cwd: string) => runShellCommand(cmd, cwd);
const toPosix = (p: string) => p.replace(/\\/g, "/");
const safeName = (s: string) => s.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "env";
function parentDir(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  return i >= 0 ? t.slice(0, i) : t;
}

export function EnvironmentsView() {
  const activeId = useProjectStore((s) => s.activeId);
  const project = useProjectStore((s) => s.projects[s.activeId]);
  const projectPath = useProjectStore((s) => s.projectPath);
  const projectEnv = useProjectStore((s) => s.projects[s.activeId]?.env ?? {});
  const addEnvironment = useProjectStore((s) => s.addEnvironment);
  const updateEnvironment = useProjectStore((s) => s.updateEnvironment);
  const removeEnvironment = useProjectStore((s) => s.removeEnvironment);
  const agents = useAgentsStore((s) => s.agents);

  const environments = useMemo(() => project?.environments ?? [], [project]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // acción en curso sobre el env seleccionado
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ envId: string; text: string } | null>(null);

  const selectedEnv = environments.find((e) => e.id === selected) ?? null;

  // Abre una pestaña de chat ATADA al ambiente: la sesión ACP y la terminal del workspace se rootean
  // en el worktree, así el agente trabaja aislado ahí. Si el ambiente tiene un agente asignado, lo deja
  // activo. Reusa un workspace ya abierto para el mismo ambiente en vez de duplicarlo.
  const openInChat = (env: TestEnv) => {
    const wsStore = useWorkspaceStore.getState();
    const existing = wsStore.workspaces.find((w) => w.envId === env.id);
    if (existing) {
      wsStore.setActiveWs(existing.id);
    } else {
      const agentId = env.agentId ?? useChatStore.getState().activeAgentId;
      wsStore.newWorkspace(agentId, { title: env.name, cwd: env.path, envId: env.id, envName: env.name });
    }
    if (env.agentId) useChatStore.getState().setActiveAgent(env.agentId);
    useUiStore.getState().setView("chat");
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !isTauri()) return;
    setCreating(true); setError(null);
    try {
      const base = await git("git rev-parse --abbrev-ref HEAD", projectPath);
      if (base.exitCode !== 0) {
        setError("El proyecto no es un repositorio git (o no tiene commits). Los ambientes usan git worktree.");
        return;
      }
      const baseBranch = base.output.trim();
      const branch = `env/${safeName(name)}`;
      const envsRoot = `${toPosix(parentDir(projectPath))}/.devflow-envs`;
      const wtPath = `${envsRoot}/${safeName(baseName(projectPath))}__${safeName(name)}`;
      try { await createDir(envsRoot); } catch { /* ya existe */ }
      const res = await git(`git worktree add "${wtPath}" -b "${branch}"`, projectPath);
      if (res.exitCode !== 0) {
        setError(`No se pudo crear el ambiente:\n${res.output.slice(-500)}`);
        return;
      }
      const id = addEnvironment({ name, branch, path: wtPath, baseBranch });
      setSelected(id);
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const loadDiff = async (env: TestEnv) => {
    setBusy("diff"); setError(null);
    try {
      // intent-to-add hace que los archivos nuevos aparezcan en el diff sin quedar realmente staged.
      await git("git add -A -N", env.path);
      const d = await git("git diff", env.path);
      setDiff({ envId: env.id, text: d.output });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const promote = async (env: TestEnv) => {
    if (!confirm(`¿Promover el ambiente "${env.name}"?\nSe commitean sus cambios y se hace merge de ${env.branch} a ${env.baseBranch}, y luego se descarta el ambiente.`)) return;
    setBusy("promote"); setError(null);
    try {
      await git("git add -A", env.path);
      // Si no hay cambios, el commit falla con exit≠0 — no es error fatal, seguimos al merge.
      await git(`git commit -m "devflow: cambios del ambiente ${env.name}"`, env.path);
      const m = await git(`git merge --no-ff "${env.branch}" -m "devflow: promover ambiente ${env.name}"`, projectPath);
      if (m.exitCode !== 0) {
        setError(`El merge a ${env.baseBranch} falló (¿conflictos o working tree sucio?). El ambiente NO se descartó.\n${m.output.slice(-500)}`);
        return;
      }
      // merge ok → descartar el worktree y la rama
      await discardWorktree(env);
      useWorkspaceStore.getState().unbindEnv(env.id);
      removeEnvironment(env.id);
      if (selected === env.id) { setSelected(null); setDiff(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const discardWorktree = async (env: TestEnv) => {
    // Matamos las terminales que tienen el worktree como cwd antes de removerlo: la de la vista
    // Ambientes (PTY id = env.id) Y las de los workspaces del chat atados a este ambiente (PTY id =
    // workspace id). En Windows, un proceso con esa carpeta abierta impide que `git worktree remove`
    // borre el directorio (queda vacío pero huérfano). Con los PTYs muertos, git la elimina del todo.
    await ptyKill(env.id).catch(() => {});
    for (const w of useWorkspaceStore.getState().workspaces.filter((w) => w.envId === env.id)) {
      await ptyKill(w.id).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
    await git(`git worktree remove --force "${env.path}"`, projectPath);
    await git(`git branch -D "${env.branch}"`, projectPath);
  };

  const discard = async (env: TestEnv) => {
    if (!confirm(`¿Descartar el ambiente "${env.name}"?\nSe borra el worktree y la rama ${env.branch} (se pierden los cambios no promovidos).`)) return;
    setBusy("discard"); setError(null);
    try {
      await discardWorktree(env);
      useWorkspaceStore.getState().unbindEnv(env.id);
      removeEnvironment(env.id);
      if (selected === env.id) { setSelected(null); setDiff(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!project) return null;

  return (
    <div className="env-view">
      <div className="env-sidebar">
        <div className="env-header">
          <span className="env-title"><Boxes size={14} /> Ambientes</span>
        </div>
        <div className="env-create">
          <input
            className="env-input"
            placeholder="Nombre (ej. exp-auth)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <button className="env-add-btn" title="Crear ambiente (worktree)" onClick={() => void create()} disabled={creating || !newName.trim()}>
            {creating ? <Loader size={13} className="spin" /> : <Plus size={14} />}
          </button>
        </div>
        <p className="env-hint">Cada ambiente es un git worktree aislado con su rama. El agente/terminal trabajan ahí sin tocar el proyecto real.</p>

        <div className="env-list">
          {environments.length === 0 && <div className="env-empty">Sin ambientes. Creá uno para que el agente pruebe cambios sin riesgo.</div>}
          {environments.map((env) => (
            <div key={env.id} className={`env-row${selected === env.id ? " selected" : ""}`} onClick={() => setSelected(env.id)}>
              <GitBranch size={13} className="env-row-icon" />
              <div className="env-row-info">
                <div className="env-row-name">{env.name}</div>
                <div className="env-row-branch">{env.branch} ← {env.baseBranch}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="env-main">
        {error && <div className="env-error"><pre>{error}</pre><button onClick={() => setError(null)}><X size={12} /></button></div>}
        {!selectedEnv ? (
          <div className="env-placeholder">
            {isTauri() ? "Seleccioná o creá un ambiente." : "Los ambientes requieren la app desktop (Tauri)."}
          </div>
        ) : (
          <>
            <div className="env-detail-bar">
              <GitBranch size={13} />
              <span className="env-detail-name">{selectedEnv.name}</span>
              <span className="env-detail-branch">{selectedEnv.branch}</span>
              <code className="env-detail-path" title={selectedEnv.path}>{selectedEnv.path}</code>
              <select
                className="env-agent-select"
                value={selectedEnv.agentId ?? ""}
                title="Agente asignado a este ambiente"
                onChange={(e) => updateEnvironment(selectedEnv.id, { agentId: e.target.value || undefined })}
              >
                <option value="">Sin agente</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="env-actions">
                <button className="env-btn env-btn--chat" onClick={() => openInChat(selectedEnv)} disabled={busy !== null}>
                  <MessageSquare size={12} /> Abrir en chat
                </button>
                <button className="env-btn" onClick={() => void loadDiff(selectedEnv)} disabled={busy !== null}>
                  {busy === "diff" ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} Ver diff
                </button>
                <button className="env-btn env-btn--promote" onClick={() => void promote(selectedEnv)} disabled={busy !== null}>
                  {busy === "promote" ? <Loader size={12} className="spin" /> : <ArrowUpFromLine size={12} />} Promover
                </button>
                <button className="env-btn env-btn--discard" onClick={() => void discard(selectedEnv)} disabled={busy !== null}>
                  {busy === "discard" ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} Descartar
                </button>
              </div>
            </div>

            {diff && diff.envId === selectedEnv.id && (
              <div className="env-diff">
                <div className="env-diff-head">
                  <span>Diff del ambiente</span>
                  <button onClick={() => setDiff(null)} title="Cerrar diff"><X size={12} /></button>
                </div>
                {diff.text.trim() ? <DiffBody text={diff.text} /> : <div className="env-diff-empty"><Check size={13} color="#3fb950" /> Sin cambios respecto de la base.</div>}
              </div>
            )}

            <div className="env-term">
              {/* Una terminal por ambiente, rooteada en el worktree. Mantenemos montadas todas las del
                  proyecto (display:none inactivas) para no perder el estado al cambiar de selección. */}
              {environments.map((env) => (
                <TerminalPane
                  key={`${activeId}:${env.id}`}
                  workspaceId={env.id}
                  cwd={env.path}
                  env={projectEnv}
                  active={env.id === selected}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Render simple de un diff unificado con coloreado por línea (+ verde, - rojo, @@ cyan).
function DiffBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="env-diff-body">
      {lines.map((l, i) => {
        let cls = "";
        if (l.startsWith("+") && !l.startsWith("+++")) cls = "env-diff--add";
        else if (l.startsWith("-") && !l.startsWith("---")) cls = "env-diff--del";
        else if (l.startsWith("@@")) cls = "env-diff--hunk";
        else if (l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("+++") || l.startsWith("---")) cls = "env-diff--meta";
        return <div key={i} className={cls}>{l || " "}</div>;
      })}
    </pre>
  );
}

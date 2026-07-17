import { useMemo, useState } from "react";
import { Boxes, Plus, Loader, GitBranch, RefreshCw, Check, Trash2, X, ArrowUpFromLine, MessageSquare, ShieldAlert, FileWarning } from "lucide-react";
import { useProjectStore, type TestEnv } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { TerminalPane } from "../components/TerminalPane";
import { runShellCommand, ptyKill, isTauri } from "../lib/tauriApi";
import { createWorktree } from "../lib/environments";

// Vista de Ambientes de prueba. Cada ambiente es un git worktree efímero con su rama propia
// (env/<name>), creado desde la rama base del proyecto activo. El agente/terminal trabajan AISLADOS
// ahí; al terminar se revisa el diff y se promueve (merge a la base) o se descarta (worktree remove).
// Todo git se hace con runShellCommand (Git Bash), mismo patrón que git init/clone del hub — sin Rust.

const git = (cmd: string, cwd: string) => runShellCommand(cmd, cwd);

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
  // Conflictos de merge al promover: si el merge falla por conflictos, listamos los archivos afectados
  // para resolverlos en el editor o abortar el merge (en vez de solo avisar). El ambiente NO se descarta.
  const [conflict, setConflict] = useState<{ envId: string; files: string[] } | null>(null);

  const selectedEnv = environments.find((e) => e.id === selected) ?? null;
  // Une la raíz del proyecto con una ruta relativa que devuelve git (forward-slashes, que Tauri acepta en Windows).
  const projectFile = (rel: string) => `${projectPath.replace(/[\\/]+$/, "")}/${rel}`;

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
      wsStore.newWorkspace(agentId, activeId, { title: env.name, cwd: env.path, envId: env.id, envName: env.name });
    }
    if (env.agentId) useChatStore.getState().setActiveAgent(env.agentId);
    useUiStore.getState().setView("chat");
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !isTauri()) return;
    setCreating(true); setError(null);
    try {
      const wt = await createWorktree(projectPath, name);
      const id = addEnvironment(wt);
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
    if (!confirm(`Promote environment "${env.name}"?\nIts changes are committed and ${env.branch} is merged into ${env.baseBranch}, then the environment is discarded.`)) return;
    setBusy("promote"); setError(null); setConflict(null);
    try {
      await git("git add -A", env.path);
      // Si no hay cambios, el commit falla con exit≠0 — no es error fatal, seguimos al merge.
      const c = await git(`git commit -m "devflow: changes from environment ${env.name}"`, env.path);
      if (c.exitCode !== 0) {
        // Pero si falló CON cambios pendientes (p.ej. sin identidad git configurada, o un hook),
        // seguir sería fatal: el merge daría "already up to date" con exit 0 y el descarte de abajo
        // borraría el trabajo sin mergear. Abortamos y el ambiente queda intacto.
        const pending = await git("git status --porcelain", env.path);
        if (pending.output.trim().length > 0) {
          setError(`Committing the environment's changes failed — nothing was merged and the environment was NOT discarded.\n${c.output.slice(-500)}`);
          return;
        }
      }
      const m = await git(`git merge --no-ff "${env.branch}" -m "devflow: promote environment ${env.name}"`, projectPath);
      if (m.exitCode !== 0) {
        // ¿Falló por conflictos? Listamos los archivos en conflicto (diff-filter=U) para resolverlos.
        const u = await git("git diff --name-only --diff-filter=U", projectPath);
        const files = u.output.split("\n").map((s) => s.trim()).filter(Boolean);
        if (files.length > 0) {
          setConflict({ envId: env.id, files });
        } else {
          setError(`Merge into ${env.baseBranch} failed (dirty working tree or outdated base). The environment was NOT discarded.\n${m.output.slice(-500)}`);
        }
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

  // Aborta un merge con conflictos (git merge --abort) → la base vuelve a su estado previo y el ambiente
  // queda intacto para seguir trabajando.
  const abortMerge = async () => {
    setBusy("promote"); setError(null);
    try {
      await git("git merge --abort", projectPath);
      setConflict(null);
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
    if (!confirm(`Discard environment "${env.name}"?\nThe worktree and branch ${env.branch} are deleted (unpromoted changes are lost).`)) return;
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
          <span className="env-title"><Boxes size={14} /> Environments</span>
        </div>
        <div className="env-create">
          <input
            className="env-input"
            placeholder="Name (e.g. exp-auth)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <button className="env-add-btn" title="Create environment (worktree)" onClick={() => void create()} disabled={creating || !newName.trim()}>
            {creating ? <Loader size={13} className="spin" /> : <Plus size={14} />}
          </button>
        </div>
        <p className="env-hint">Each environment is an isolated git worktree with its own branch. The agent/terminal work there without touching the real project.</p>

        <div className="env-list">
          {environments.length === 0 && <div className="env-empty">No environments. Create one so the agent can test changes safely.</div>}
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
            {isTauri() ? "Select or create an environment." : "Environments require the desktop app (Tauri)."}
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
                title="Agent assigned to this environment"
                onChange={(e) => updateEnvironment(selectedEnv.id, { agentId: e.target.value || undefined })}
              >
                <option value="">No agent</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="env-actions">
                <button className="env-btn env-btn--chat" onClick={() => openInChat(selectedEnv)} disabled={busy !== null}>
                  <MessageSquare size={12} /> Open in chat
                </button>
                <button className="env-btn" onClick={() => void loadDiff(selectedEnv)} disabled={busy !== null}>
                  {busy === "diff" ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} View diff
                </button>
                <button className="env-btn env-btn--promote" onClick={() => void promote(selectedEnv)} disabled={busy !== null}>
                  {busy === "promote" ? <Loader size={12} className="spin" /> : <ArrowUpFromLine size={12} />} Promote
                </button>
                <button className="env-btn env-btn--discard" onClick={() => void discard(selectedEnv)} disabled={busy !== null}>
                  {busy === "discard" ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} Discard
                </button>
              </div>
            </div>

            {diff && diff.envId === selectedEnv.id && (
              <div className="env-diff">
                <div className="env-diff-head">
                  <span>Environment diff</span>
                  <button onClick={() => setDiff(null)} title="Close diff"><X size={12} /></button>
                </div>
                {diff.text.trim() ? <DiffBody text={diff.text} /> : <div className="env-diff-empty"><Check size={13} color="#3fb950" /> No changes vs. the base.</div>}
              </div>
            )}

            {conflict && conflict.envId === selectedEnv.id && (
              <div className="env-conflict">
                <div className="env-conflict-head"><ShieldAlert size={14} color="#d29922" /> Merge conflicts — {conflict.files.length} file(s)</div>
                <p className="env-conflict-hint">
                  Merging <code>{selectedEnv.branch}</code> into <code>{selectedEnv.baseBranch}</code> has conflicts. Resolve them in the editor
                  (look for the <code>{"<<<<<<<"}</code> markers) and hit <strong>Promote</strong> again, or <strong>abort the merge</strong> to leave the base as it was.
                </p>
                <ul className="env-conflict-list">
                  {conflict.files.map((f) => (
                    <li key={f}>
                      <FileWarning size={12} color="#d29922" />
                      <code className="env-conflict-file">{f}</code>
                      <button className="env-btn" onClick={() => useUiStore.getState().openInEditor(projectFile(f))}>Open in editor</button>
                    </li>
                  ))}
                </ul>
                <button className="env-btn env-btn--discard" onClick={() => void abortMerge()} disabled={busy !== null}>
                  {busy === "promote" ? <Loader size={12} className="spin" /> : <X size={12} />} Abort merge
                </button>
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

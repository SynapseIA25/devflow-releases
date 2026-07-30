import { useMemo, useState } from "react";
import { Boxes, Plus, Loader, GitBranch, RefreshCw, Check, Trash2, X, ArrowUpFromLine, MessageSquare, ShieldAlert, FileWarning, Rows3, Columns3 } from "lucide-react";
import { useProjectStore, type TestEnv } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { TerminalPane } from "../components/TerminalPane";
import { runShellCommand, ptyKill, isTauri } from "../lib/tauriApi";
import { createWorktree, createSshWorktree, sshTerminalCommand } from "../lib/environments";

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
  // SSH Worktrees (base): toggle Local/SSH del form de creación.
  const [envKind, setEnvKind] = useState<"local" | "ssh">("local");
  const [sshHost, setSshHost] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // acción en curso sobre el env seleccionado
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ envId: string; text: string } | null>(null);
  // Conflictos de merge al promover: si el merge falla por conflictos, listamos los archivos afectados
  // para resolverlos en el editor o abortar el merge (en vez de solo avisar). El ambiente NO se descarta.
  const [conflict, setConflict] = useState<{ envId: string; files: string[] } | null>(null);

  // Fan-out: un mismo prompt a N agentes en paralelo, cada uno en su propio worktree (estilo Orca).
  const [showFanout, setShowFanout] = useState(false);
  const [fanoutPrompt, setFanoutPrompt] = useState("");
  const [fanoutAgentIds, setFanoutAgentIds] = useState<Set<string>>(new Set());
  const [fanning, setFanning] = useState(false);

  // Comparar: selección múltiple de ambientes → diffs lado a lado, con la opción de promover uno y
  // descartar el resto en un solo paso (sin re-confirmar variante por variante).
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [compareDiffs, setCompareDiffs] = useState<{ envId: string; name: string; text: string }[] | null>(null);
  const [comparing, setComparing] = useState(false);

  // Annotate AI Diffs: comentarios por línea, acumulados hasta que se mandan al agente del
  // ambiente (ver sendDiffComments). Keyed por envId — cada ambiente tiene su propio set.
  const [diffComments, setDiffComments] = useState<Record<string, DiffComment[]>>({});
  const addDiffComment = (envId: string, line: number, code: string, text: string) => {
    setDiffComments((prev) => {
      const existing = (prev[envId] ?? []).filter((c) => c.line !== line);
      return { ...prev, [envId]: [...existing, { line, code, text }].sort((a, b) => a.line - b.line) };
    });
  };

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

  // Manda los comentarios acumulados de un diff como un follow-up al workspace del ambiente (lo crea
  // si no existe, mismo criterio que openInChat) vía pendingInitialPrompt — el mismo mecanismo del
  // fan-out, reusado acá para "responder" en vez de "arrancar".
  const sendDiffComments = (env: TestEnv) => {
    const comments = diffComments[env.id];
    if (!comments?.length) return;
    const wsStore = useWorkspaceStore.getState();
    let ws = wsStore.workspaces.find((w) => w.envId === env.id);
    if (!ws) {
      const agentId = env.agentId ?? useChatStore.getState().activeAgentId;
      const id = wsStore.newWorkspace(agentId, activeId, { title: env.name, cwd: env.path, envId: env.id, envName: env.name });
      ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
    }
    if (!ws) return;
    const composed = `Feedback on the diff for "${env.name}" (${env.branch}):\n\n${comments
      .map((c) => `- Line: \`${c.code.trim()}\`\n  → ${c.text}`)
      .join("\n\n")}`;
    wsStore.setPendingInitialPrompt(ws.id, composed);
    wsStore.setActiveWs(ws.id);
    if (env.agentId) useChatStore.getState().setActiveAgent(env.agentId);
    useUiStore.getState().setView("chat");
    setDiffComments((prev) => {
      const next = { ...prev };
      delete next[env.id];
      return next;
    });
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !isTauri()) return;
    if (envKind === "ssh" && (!sshHost.trim() || !remotePath.trim())) return;
    setCreating(true); setError(null);
    try {
      if (envKind === "ssh") {
        const wt = await createSshWorktree(sshHost.trim(), remotePath.trim(), name);
        const id = addEnvironment({
          name: wt.name, branch: wt.branch, baseBranch: wt.baseBranch,
          path: wt.remotePath, kind: "ssh", sshHost: sshHost.trim(),
          remotePath: wt.remotePath, remoteProjectPath: wt.remoteProjectPath,
        });
        setSelected(id);
      } else {
        const wt = await createWorktree(projectPath, name);
        const id = addEnvironment({ ...wt, kind: "local" });
        setSelected(id);
      }
      setNewName("");
      setSshHost("");
      setRemotePath("");
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
    await promoteCore(env);
  };

  // Sin confirm() propio — usado por `promote` (con su confirm de a uno) y por el fan-out
  // (una sola confirmación para promover el ganador + descartar el resto del lote).
  const promoteCore = async (env: TestEnv) => {
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
    const killPtys = async () => {
      await ptyKill(env.id).catch(() => {});
      for (const w of useWorkspaceStore.getState().workspaces.filter((w) => w.envId === env.id)) {
        await ptyKill(w.id).catch(() => {});
      }
    };
    await killPtys();
    if (env.kind === "ssh") {
      // Remoto: no hay lock local de Windows que reintentar — un solo intento vía ssh alcanza.
      const rm = await runShellCommand(
        `ssh "${env.sshHost}" "git -C '${env.remoteProjectPath}' worktree remove --force '${env.path}' && git -C '${env.remoteProjectPath}' branch -D '${env.branch}'"`,
        "."
      );
      if (rm.exitCode !== 0) throw new Error(`No se pudo borrar el worktree remoto:\n${rm.output.slice(-400)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
    let res = await git(`git worktree remove --force "${env.path}"`, projectPath);
    if (res.exitCode !== 0) {
      // Reintento: visto en el fan-out (varios ambientes con terminal montada a la vez) que 400ms no
      // alcanza siempre para que Windows libere el handle. Antes esto se ignoraba en silencio y el
      // ambiente se sacaba de la lista igual, dejando el worktree huérfano en disco.
      await killPtys();
      await new Promise((r) => setTimeout(r, 1200));
      res = await git(`git worktree remove --force "${env.path}"`, projectPath);
      if (res.exitCode !== 0) {
        throw new Error(`No se pudo borrar el worktree (¿una terminal sigue con la carpeta abierta?):\n${res.output.slice(-400)}`);
      }
    }
    await git(`git branch -D "${env.branch}"`, projectPath);
  };

  const discard = async (env: TestEnv) => {
    if (!confirm(`Discard environment "${env.name}"?\nThe worktree and branch ${env.branch} are deleted (unpromoted changes are lost).`)) return;
    await discardCore(env);
  };

  // Sin confirm() propio — mismo motivo que promoteCore.
  const discardCore = async (env: TestEnv) => {
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

  // Fan-out: crea un worktree + workspace de chat por cada agente elegido, todos con el MISMO prompt
  // ya cargado (ChatView lo auto-envía, ver pendingInitialPrompt). Errores parciales (ej. un worktree
  // que falla) no abortan el resto — se acumulan y se muestran juntos.
  const runFanout = async () => {
    const prompt = fanoutPrompt.trim();
    if (!prompt || fanoutAgentIds.size === 0 || !isTauri()) return;
    setFanning(true); setError(null);
    const fanoutGroupId = crypto.randomUUID();
    const errors: string[] = [];
    for (const agentId of fanoutAgentIds) {
      const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;
      const name = `fanout-${fanoutGroupId.slice(0, 6)}-${agentName}`.replace(/\s+/g, "-").toLowerCase();
      try {
        const wt = await createWorktree(projectPath, name);
        const envId = addEnvironment({ ...wt, agentId, fanoutGroupId });
        useWorkspaceStore.getState().newWorkspace(agentId, activeId, {
          title: name,
          cwd: wt.path,
          envId,
          envName: name,
          pendingInitialPrompt: prompt,
        });
      } catch (e) {
        errors.push(`${agentName}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length) setError(`Some variants failed to start:\n${errors.join("\n")}`);
    setFanning(false);
    setShowFanout(false);
    setFanoutPrompt("");
    setFanoutAgentIds(new Set());
  };

  const toggleCompare = (envId: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(envId)) next.delete(envId);
      else next.add(envId);
      return next;
    });
  };

  const runCompare = async () => {
    setComparing(true); setError(null);
    try {
      const diffs = await Promise.all(
        [...compareIds].map(async (id) => {
          const env = environments.find((e) => e.id === id)!;
          await git("git add -A -N", env.path);
          const d = await git("git diff", env.path);
          return { envId: id, name: env.name, text: d.output };
        })
      );
      setCompareDiffs(diffs);
      setCompareMode(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  };

  const promoteWinnerDiscardRest = async (winner: TestEnv) => {
    const others = [...compareIds].filter((id) => id !== winner.id).map((id) => environments.find((e) => e.id === id)).filter((e): e is TestEnv => !!e);
    if (!confirm(`Promote "${winner.name}" and discard the other ${others.length} variant(s)?\nThis can't be undone.`)) return;
    setBusy("promote"); setError(null);
    try {
      await promoteCore(winner);
      for (const env of others) await discardCore(env);
      setCompareIds(new Set());
      setCompareDiffs(null);
      setCompareMode(false);
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
          <button className="env-fanout-btn" title="Fan out a prompt to several agents in parallel" onClick={() => setShowFanout((v) => !v)}>
            <Rows3 size={13} /> Fan out
          </button>
        </div>
        <div className="env-kind-toggle">
          <button className={`env-kind-btn${envKind === "local" ? " active" : ""}`} onClick={() => setEnvKind("local")}>Local</button>
          <button className={`env-kind-btn${envKind === "ssh" ? " active" : ""}`} onClick={() => setEnvKind("ssh")}>SSH</button>
        </div>
        <div className="env-create">
          <input
            className="env-input"
            placeholder="Name (e.g. exp-auth)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <button className="env-add-btn" title="Create environment (worktree)" onClick={() => void create()} disabled={creating || !newName.trim() || (envKind === "ssh" && (!sshHost.trim() || !remotePath.trim()))}>
            {creating ? <Loader size={13} className="spin" /> : <Plus size={14} />}
          </button>
        </div>
        {envKind === "ssh" && (
          <div className="env-create env-create--ssh">
            <input className="env-input" placeholder="user@host[:port]" value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
            <input className="env-input" placeholder="/remote/path/to/repo" value={remotePath} onChange={(e) => setRemotePath(e.target.value)} />
          </div>
        )}
        <p className="env-hint">
          {envKind === "ssh"
            ? "Runs on a remote box over SSH (needs the repo already there and your SSH keys/config set up). Base only: no live remote file editing, diff, or promote yet — terminal and discard work."
            : "Each environment is an isolated git worktree with its own branch. The agent/terminal work there without touching the real project."}
        </p>

        {showFanout && (
          <div className="env-fanout-form">
            <textarea
              className="env-fanout-prompt"
              placeholder="Prompt to send to every variant, e.g. Add input validation to the signup form"
              value={fanoutPrompt}
              onChange={(e) => setFanoutPrompt(e.target.value)}
              rows={3}
            />
            <div className="env-fanout-agents">
              {agents.map((a) => (
                <label key={a.id} className="env-fanout-agent">
                  <input
                    type="checkbox"
                    checked={fanoutAgentIds.has(a.id)}
                    onChange={() => setFanoutAgentIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                      return next;
                    })}
                  />
                  {a.name}
                </label>
              ))}
            </div>
            <button
              className="env-btn env-btn--promote"
              onClick={() => void runFanout()}
              disabled={fanning || !fanoutPrompt.trim() || fanoutAgentIds.size === 0}
            >
              {fanning ? <Loader size={12} className="spin" /> : <Rows3 size={12} />} Run {fanoutAgentIds.size || ""} variant(s) in parallel
            </button>
          </div>
        )}

        {compareIds.size >= 2 && (
          <button className="env-compare-btn" onClick={() => void runCompare()} disabled={comparing}>
            {comparing ? <Loader size={12} className="spin" /> : <Columns3 size={12} />} Compare {compareIds.size} selected
          </button>
        )}

        <div className="env-list">
          {environments.length === 0 && <div className="env-empty">No environments. Create one so the agent can test changes safely.</div>}
          {environments.map((env) => (
            <div key={env.id} className={`env-row${selected === env.id ? " selected" : ""}`} onClick={() => setSelected(env.id)}>
              <input
                type="checkbox"
                className="env-row-compare"
                checked={compareIds.has(env.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleCompare(env.id)}
                title="Select for comparison"
              />
              <GitBranch size={13} className="env-row-icon" />
              <div className="env-row-info">
                <div className="env-row-name">
                  {env.kind === "ssh" && <span className="env-ssh-badge">SSH</span>}
                  {env.name}
                </div>
                <div className="env-row-branch">{env.branch} ← {env.baseBranch}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="env-main">
        {error && <div className="env-error"><pre>{error}</pre><button onClick={() => setError(null)}><X size={12} /></button></div>}

        {compareMode && compareDiffs && (
          <div className="env-compare-grid">
            <div className="env-compare-head">
              <span>Comparing {compareDiffs.length} variants</span>
              <button onClick={() => { setCompareMode(false); setCompareDiffs(null); }} title="Close comparison"><X size={12} /></button>
            </div>
            <div className="env-compare-cols">
              {compareDiffs.map((d) => {
                const env = environments.find((e) => e.id === d.envId);
                return (
                  <div key={d.envId} className="env-compare-col">
                    <div className="env-compare-col-head">
                      <span className="env-compare-col-name">{d.name}</span>
                      {env && (diffComments[env.id]?.length ?? 0) > 0 && (
                        <button className="env-btn" onClick={() => sendDiffComments(env)}>
                          <MessageSquare size={11} /> Send {diffComments[env.id].length} comment(s)
                        </button>
                      )}
                      {env && (
                        <button className="env-btn env-btn--promote" onClick={() => void promoteWinnerDiscardRest(env)} disabled={busy !== null}>
                          <ArrowUpFromLine size={11} /> Promote this, discard rest
                        </button>
                      )}
                    </div>
                    {d.text.trim() ? (
                      <DiffBody
                        text={d.text}
                        comments={env ? diffComments[env.id] : undefined}
                        onAddComment={env ? (line, code, text) => addDiffComment(env.id, line, code, text) : undefined}
                      />
                    ) : (
                      <div className="env-diff-empty"><Check size={13} color="#3fb950" /> No changes vs. the base.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!compareMode && (!selectedEnv ? (
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
                {selectedEnv.kind !== "ssh" && (
                  <button className="env-btn env-btn--chat" onClick={() => openInChat(selectedEnv)} disabled={busy !== null}>
                    <MessageSquare size={12} /> Open in chat
                  </button>
                )}
                {selectedEnv.kind !== "ssh" && (
                  <button className="env-btn" onClick={() => void loadDiff(selectedEnv)} disabled={busy !== null}>
                    {busy === "diff" ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} View diff
                  </button>
                )}
                {selectedEnv.kind !== "ssh" && (
                  <button className="env-btn env-btn--promote" onClick={() => void promote(selectedEnv)} disabled={busy !== null}>
                    {busy === "promote" ? <Loader size={12} className="spin" /> : <ArrowUpFromLine size={12} />} Promote
                  </button>
                )}
                <button className="env-btn env-btn--discard" onClick={() => void discard(selectedEnv)} disabled={busy !== null}>
                  {busy === "discard" ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} Discard
                </button>
              </div>
              {selectedEnv.kind === "ssh" && (
                <div className="env-ssh-note">SSH environment — chat/diff/promote not available yet, only the terminal below (and discard).</div>
              )}
            </div>

            {diff && diff.envId === selectedEnv.id && (
              <div className="env-diff">
                <div className="env-diff-head">
                  <span>Environment diff</span>
                  {(diffComments[selectedEnv.id]?.length ?? 0) > 0 && (
                    <button className="env-btn" onClick={() => sendDiffComments(selectedEnv)}>
                      <MessageSquare size={11} /> Send {diffComments[selectedEnv.id].length} comment(s)
                    </button>
                  )}
                  <button onClick={() => setDiff(null)} title="Close diff"><X size={12} /></button>
                </div>
                {diff.text.trim() ? (
                  <DiffBody
                    text={diff.text}
                    comments={diffComments[selectedEnv.id]}
                    onAddComment={(line, code, text) => addDiffComment(selectedEnv.id, line, code, text)}
                  />
                ) : (
                  <div className="env-diff-empty"><Check size={13} color="#3fb950" /> No changes vs. the base.</div>
                )}
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
                  cwd={env.kind === "ssh" ? projectPath : env.path}
                  env={projectEnv}
                  active={env.id === selected}
                  command={env.kind === "ssh" && env.sshHost && env.remotePath ? sshTerminalCommand(env.sshHost, env.remotePath) : undefined}
                />
              ))}
            </div>
          </>
        ))}
      </div>
    </div>
  );
}

// Render simple de un diff unificado con coloreado por línea (+ verde, - rojo, @@ cyan).
export type DiffComment = { line: number; code: string; text: string };

function DiffBody({
  text,
  comments,
  onAddComment,
}: {
  text: string;
  comments?: DiffComment[];
  onAddComment?: (line: number, code: string, text: string) => void;
}) {
  const lines = text.split("\n");
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const byLine = new Map((comments ?? []).map((c) => [c.line, c]));
  const submit = (line: number, code: string) => {
    const t = draft.trim();
    if (t) onAddComment?.(line, code, t);
    setOpenLine(null);
    setDraft("");
  };
  return (
    <pre className="env-diff-body">
      {lines.map((l, i) => {
        let cls = "";
        if (l.startsWith("+") && !l.startsWith("+++")) cls = "env-diff--add";
        else if (l.startsWith("-") && !l.startsWith("---")) cls = "env-diff--del";
        else if (l.startsWith("@@")) cls = "env-diff--hunk";
        else if (l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("+++") || l.startsWith("---")) cls = "env-diff--meta";
        const existing = byLine.get(i);
        return (
          <div key={i} className="env-diff-line-wrap">
            <div className={`env-diff-line ${cls}`}>
              <span className="env-diff-line-text">{l || " "}</span>
              {onAddComment && (
                <button
                  className="env-diff-comment-btn"
                  title="Comment this line"
                  onClick={() => { setOpenLine(i); setDraft(existing?.text ?? ""); }}
                >
                  <MessageSquare size={10} />
                </button>
              )}
            </div>
            {existing && openLine !== i && (
              <div className="env-diff-comment-pill" onClick={() => { setOpenLine(i); setDraft(existing.text); }}>
                {"\u{1F4AC}"} {existing.text}
              </div>
            )}
            {openLine === i && (
              <div className="env-diff-comment-form">
                <input
                  className="env-diff-comment-input"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit(i, l);
                    if (e.key === "Escape") { setOpenLine(null); setDraft(""); }
                  }}
                  placeholder="Comment for the agent…"
                />
                <button className="env-btn" onClick={() => submit(i, l)}>Save</button>
              </div>
            )}
          </div>
        );
      })}
    </pre>
  );
}

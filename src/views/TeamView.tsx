import { useMemo, useRef, useState } from "react";
import { Users, MessageSquare, Sparkles, Play, Square, Loader, Network, Boxes } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAgentsStore } from "../store/agentsStore";
import { isExpertAgent, type AgentConfig } from "../lib/providers";
import { suggestExperts } from "../lib/expertRouter";
import { autoDelegate, type DelegateStep } from "../lib/teamDelegate";
import { createWorktree } from "../lib/environments";
import * as acpClient from "../lib/acpClient";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useProjectStore } from "../store/projectStore";
import { useUiStore } from "../store/uiStore";

// Vista Equipo (pilar 1): agentes expertos por área. Dos modos:
// - Router: recomienda el experto para una tarea y la abre en el chat.
// - Auto-delegar: un líder descompone la tarea, delega a los expertos (ACP) y sintetiza (teamDelegate).
export function TeamView() {
  const agents = useAgentsStore((s) => s.agents);
  const experts = useMemo(() => agents.filter(isExpertAgent), [agents]);
  const lead = useMemo(() => agents.find((a) => a.id === "mimo-coder") ?? agents[0], [agents]);

  const [mode, setMode] = useState<"router" | "delegate">("router");
  const [task, setTask] = useState("");
  const matches = useMemo(() => (task.trim() ? suggestExperts(task, experts) : []), [task, experts]);
  const top = matches.slice(0, 3);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<DelegateStep[]>([]);
  const [isolate, setIsolate] = useState(true); // aislar en un ambiente (worktree) por defecto — más seguro
  const [envName, setEnvName] = useState<string | null>(null); // ambiente creado para esta corrida
  const cancelRef = useRef(false);

  const openInChat = (agent: AgentConfig, withTask: boolean) => {
    useChatStore.getState().setActiveAgent(agent.id);
    useWorkspaceStore.getState().newWorkspace(agent.id, useProjectStore.getState().activeId, { title: agent.name });
    if (withTask && task.trim()) useUiStore.getState().setPendingPrompt(task.trim());
    useUiStore.getState().setView("chat");
  };

  const runDelegate = async () => {
    if (!task.trim() || running || !lead) return;
    setRunning(true); setSteps([]); setEnvName(null); cancelRef.current = false;
    let cwd = useProjectStore.getState().projectPath;
    try {
      // Reiniciamos el/los proceso(s) ACP de los agentes ANTES de cada corrida: abrir muchas sesiones
      // seguidas puede wedgear el proceso mimo compartido (un turno colgado lo deja sin responder).
      // Arrancar fresco lo evita. Invalida sesiones abiertas de ese provider → resetSessions las limpia.
      const providers = [...new Set([lead, ...experts].map((a) => a.providerId))];
      setSteps([{ kind: "stage", label: "Restarting the agent to start fresh…" }]);
      for (const p of providers) {
        await acpClient.restart(p);
        useWorkspaceStore.getState().resetSessions(p);
      }
      if (isolate) {
        // Ambiente efímero: los expertos escriben AISLADOS en el worktree, no en el proyecto real.
        const name = `equipo-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
        setSteps([{ kind: "stage", label: `Creating isolated environment “${name}” (worktree)…` }]);
        const wt = await createWorktree(cwd, name);
        useProjectStore.getState().addEnvironment(wt);
        cwd = wt.path;
        setEnvName(wt.name);
      }
      await autoDelegate(task, experts, lead, cwd, (step) => setSteps((prev) => [...prev, step]), () => cancelRef.current);
    } catch (e) {
      setSteps((prev) => [...prev, { kind: "error", message: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
    }
  };
  const stopDelegate = () => { cancelRef.current = true; };

  return (
    <div className="team-view">
      <div className="team-header">
        <h2 className="team-title"><Users size={18} /> Expert team</h2>
        <p className="team-sub">Describe a task and choose how to work it: I recommend the expert to open it in the chat, or the team solves it together (lead + experts).</p>
      </div>

      <div className="team-modes">
        <button className={`team-mode${mode === "router" ? " active" : ""}`} onClick={() => setMode("router")}><Sparkles size={13} /> Router</button>
        <button className={`team-mode${mode === "delegate" ? " active" : ""}`} onClick={() => setMode("delegate")}><Network size={13} /> Auto-delegate</button>
      </div>

      <div className="team-router">
        <textarea
          className="team-task-input"
          placeholder={mode === "router" ? "e.g. Optimize the report queries and add a schema migration…" : "e.g. Design the checkout flow: payments API, orders schema, cart UI and tests…"}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
        />

        {mode === "router" && task.trim() && (
          <div className="team-reco">
            {top.length === 0 ? (
              <div className="team-reco-empty">No clear matches — pick an expert from the team below.</div>
            ) : (
              top.map((m, i) => (
                <div key={m.agent.id} className={`team-reco-row${i === 0 ? " team-reco-row--top" : ""}`}>
                  <span className="team-reco-icon" style={{ color: m.agent.color }}>{m.agent.icon}</span>
                  <div className="team-reco-info">
                    <div className="team-reco-name">
                      {i === 0 && <Sparkles size={12} className="team-reco-star" />}
                      {m.agent.name}
                      <span className="team-reco-score">{m.score} match{m.score === 1 ? "" : "es"}</span>
                    </div>
                    <div className="team-reco-hits">{m.hits.slice(0, 6).map((h) => <span key={h} className="team-hit">{h}</span>)}</div>
                  </div>
                  <button className="team-btn team-btn--primary" onClick={() => openInChat(m.agent, true)}>
                    <MessageSquare size={13} /> Open in chat
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {mode === "delegate" && (
          <div className="team-delegate">
            <label className="team-isolate">
              <input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} disabled={running} />
              <Boxes size={13} /> Isolate in an environment (worktree) — experts don't touch the real project
            </label>
            <div className="team-delegate-actions">
              {running ? (
                <button className="team-btn team-btn--stop" onClick={stopDelegate}><Square size={13} /> Stop</button>
              ) : (
                <button className="team-btn team-btn--primary" onClick={() => void runDelegate()} disabled={!task.trim() || !lead}><Play size={13} /> Run with the team</button>
              )}
              <span className="team-delegate-hint">
                The lead ({lead?.name}) breaks it down, the experts solve it and it's synthesized. May take several turns.
                {!isolate && <> ⚠ Without isolation, the experts <strong>edit the active project</strong>.</>}
              </span>
            </div>
            {envName && !running && (
              <div className="team-env-banner">
                <Boxes size={14} />
                <span>The experts' changes were isolated in the <strong>{envName}</strong> environment. Review the diff and promote or discard from Environments.</span>
                <button className="team-btn" onClick={() => useUiStore.getState().setView("environments")}>Go to Environments →</button>
              </div>
            )}
            {steps.length > 0 && <DelegateResults steps={steps} running={running} />}
          </div>
        )}
      </div>

      <div className="team-roster">
        <div className="team-roster-title">The team ({experts.length})</div>
        <div className="team-grid">
          {experts.map((a) => (
            <div key={a.id} className="team-card">
              <div className="team-card-head">
                <span className="team-card-icon" style={{ background: `${a.color}22`, color: a.color }}>{a.icon}</span>
                <span className="team-card-name">{a.name}</span>
              </div>
              <p className="team-card-desc">{a.description}</p>
              <button className="team-btn" onClick={() => openInChat(a, mode === "router")}>
                <MessageSquare size={12} /> Open in chat{mode === "router" && task.trim() ? " with the task" : ""}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DelegateResults({ steps, running }: { steps: DelegateStep[]; running: boolean }) {
  const plan = steps.find((s) => s.kind === "plan") as Extract<DelegateStep, { kind: "plan" }> | undefined;
  const done = steps.filter((s): s is Extract<DelegateStep, { kind: "expert-done" }> => s.kind === "expert-done");
  const starts = steps.filter((s): s is Extract<DelegateStep, { kind: "expert-start" }> => s.kind === "expert-start");
  const synthesis = steps.find((s) => s.kind === "synthesis") as Extract<DelegateStep, { kind: "synthesis" }> | undefined;
  const error = steps.find((s) => s.kind === "error") as Extract<DelegateStep, { kind: "error" }> | undefined;
  const stage = [...steps].reverse().find((s) => s.kind === "stage") as Extract<DelegateStep, { kind: "stage" }> | undefined;

  return (
    <div className="team-results">
      {running && stage && !synthesis && <div className="team-stage"><Loader size={12} className="spin" /> {stage.label}</div>}

      {plan && (
        <div className="team-plan">
          <div className="team-plan-title">Lead's plan ({plan.items.length} sub-task{plan.items.length === 1 ? "" : "s"})</div>
          {plan.items.map((it, i) => (
            <div key={i} className="team-plan-item"><span className="team-plan-area">{it.area}</span> {it.subtask}</div>
          ))}
        </div>
      )}

      {starts.map((st) => {
        // Pareamos por `index` (no por orden de llegada): en paralelo los expert-done llegan en cualquier
        // orden, pero cada uno trae el índice de su expert-start → se paean sin ambigüedad aunque el líder
        // asigne dos sub-tareas al mismo experto.
        const result = done.find((d) => d.index === st.index);
        return (
          <div key={st.index} className="team-expert-block">
            <div className="team-expert-head">
              <span style={{ color: st.color }}>{st.icon}</span>
              <span className="team-expert-name">{st.name}</span>
              {!result && running
                ? <Loader size={11} className="spin" />
                : result?.timedOut
                  ? <span className="team-expert-timeout" title="No response in time">⏱</span>
                  : <span className="team-expert-ok">✓</span>}
            </div>
            {result && <div className="team-expert-body proj-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.text}</ReactMarkdown></div>}
          </div>
        );
      })}

      {synthesis && (
        <div className="team-synthesis">
          <div className="team-synthesis-title">🧩 Lead's synthesis</div>
          <div className="team-synthesis-body proj-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{synthesis.text}</ReactMarkdown></div>
        </div>
      )}

      {error && <div className="team-error">{error.message}</div>}
    </div>
  );
}

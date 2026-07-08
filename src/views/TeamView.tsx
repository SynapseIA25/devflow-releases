import { useMemo, useState } from "react";
import { Users, MessageSquare, Sparkles } from "lucide-react";
import { useAgentsStore } from "../store/agentsStore";
import { isExpertAgent, type AgentConfig } from "../lib/providers";
import { suggestExperts } from "../lib/expertRouter";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";

// Vista Equipo (pilar 1): los agentes expertos por área. Router determinista tarea→experto + "abrir
// en chat" con la tarea precargada. (La auto-delegación llega en la etapa 2.)
export function TeamView() {
  const agents = useAgentsStore((s) => s.agents);
  const experts = useMemo(() => agents.filter(isExpertAgent), [agents]);

  const [task, setTask] = useState("");
  const matches = useMemo(() => (task.trim() ? suggestExperts(task, experts) : []), [task, experts]);
  const top = matches.slice(0, 3);

  const openInChat = (agent: AgentConfig, withTask: boolean) => {
    useChatStore.getState().setActiveAgent(agent.id);
    useWorkspaceStore.getState().newWorkspace(agent.id, { title: agent.name });
    if (withTask && task.trim()) useUiStore.getState().setPendingPrompt(task.trim());
    useUiStore.getState().setView("chat");
  };

  return (
    <div className="team-view">
      <div className="team-header">
        <h2 className="team-title"><Users size={18} /> Equipo de expertos</h2>
        <p className="team-sub">Describí una tarea y te recomiendo el experto para abrirla en el chat. También podés elegir cualquiera del equipo directamente.</p>
      </div>

      <div className="team-router">
        <textarea
          className="team-task-input"
          placeholder="Ej: Optimizar las queries del reporte y agregar una migración de esquema…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
        />
        {task.trim() && (
          <div className="team-reco">
            {top.length === 0 ? (
              <div className="team-reco-empty">Sin coincidencias claras — elegí un experto del equipo abajo.</div>
            ) : (
              top.map((m, i) => (
                <div key={m.agent.id} className={`team-reco-row${i === 0 ? " team-reco-row--top" : ""}`}>
                  <span className="team-reco-icon" style={{ color: m.agent.color }}>{m.agent.icon}</span>
                  <div className="team-reco-info">
                    <div className="team-reco-name">
                      {i === 0 && <Sparkles size={12} className="team-reco-star" />}
                      {m.agent.name}
                      <span className="team-reco-score">{m.score} coincidencia{m.score === 1 ? "" : "s"}</span>
                    </div>
                    <div className="team-reco-hits">{m.hits.slice(0, 6).map((h) => <span key={h} className="team-hit">{h}</span>)}</div>
                  </div>
                  <button className="team-btn team-btn--primary" onClick={() => openInChat(m.agent, true)}>
                    <MessageSquare size={13} /> Abrir en chat
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="team-roster">
        <div className="team-roster-title">El equipo ({experts.length})</div>
        <div className="team-grid">
          {experts.map((a) => (
            <div key={a.id} className="team-card">
              <div className="team-card-head">
                <span className="team-card-icon" style={{ background: `${a.color}22`, color: a.color }}>{a.icon}</span>
                <span className="team-card-name">{a.name}</span>
              </div>
              <p className="team-card-desc">{a.description}</p>
              <button className="team-btn" onClick={() => openInChat(a, true)}>
                <MessageSquare size={12} /> Abrir en chat{task.trim() ? " con la tarea" : ""}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

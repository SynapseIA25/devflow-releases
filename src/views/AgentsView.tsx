import { useState } from "react";
import { CheckCircle, Circle, Plus, Zap, Globe, Database } from "lucide-react";
import { DEFAULT_AGENTS, AgentConfig } from "../lib/providers";

const PLATFORM_ICONS: Record<string, string> = {
  telegram: "✈", discord: "◈", slack: "◆", email: "✉", cli: "⬡",
  whatsapp: "◉", signal: "◎",
};

const BACKEND_INFO = {
  local: { label: "Local", color: "#4ade80" },
  docker: { label: "Docker", color: "#38bdf8" },
  ssh: { label: "SSH", color: "#fbbf24" },
};

function AgentCard({ agent, selected, onSelect }: { agent: AgentConfig; selected: boolean; onSelect: () => void }) {
  return (
    <div className={`agent-card${selected ? " selected" : ""}`} onClick={onSelect}>
      <div className="agent-card-header">
        <div className="agent-card-icon" style={{ background: `${agent.color}22`, color: agent.color }}>
          {agent.icon}
        </div>
        <div className="agent-card-info">
          <div className="agent-card-name">{agent.name}</div>
          <div className={`agent-card-status agent-card-status--${agent.status}`}>
            {agent.status === "active" ? <CheckCircle size={10} /> : <Circle size={10} />}
            {agent.status}
          </div>
        </div>
      </div>
      <p className="agent-card-desc">{agent.description}</p>
      {agent.platforms && (
        <div className="agent-card-platforms">
          {agent.platforms.map((p) => (
            <span key={p} className="platform-badge" title={p}>
              {PLATFORM_ICONS[p] ?? p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentDetail({ agent }: { agent: AgentConfig }) {
  const backend = agent.executionBackend ? BACKEND_INFO[agent.executionBackend] : null;

  return (
    <div className="agent-detail">
      <div className="agent-detail-header">
        <div className="agent-detail-icon" style={{ background: `${agent.color}22`, color: agent.color }}>
          {agent.icon}
        </div>
        <div>
          <h2 className="agent-detail-name">{agent.name}</h2>
          <p className="agent-detail-desc">{agent.description}</p>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-label"><Zap size={12} /> Skills disponibles</div>
        <div className="skills-grid">
          {agent.skills.map((s) => (
            <div key={s} className="skill-item">
              <CheckCircle size={11} color="#4ade80" /> {s}
            </div>
          ))}
        </div>
      </div>

      {agent.platforms && (
        <div className="detail-section">
          <div className="detail-label"><Globe size={12} /> Plataformas</div>
          <div className="skills-grid">
            {agent.platforms.map((p) => (
              <div key={p} className="skill-item">
                {PLATFORM_ICONS[p]} {p}
              </div>
            ))}
          </div>
        </div>
      )}

      {backend && (
        <div className="detail-section">
          <div className="detail-label">Execution backend</div>
          <span className="backend-badge" style={{ background: `${backend.color}22`, color: backend.color }}>
            {backend.label}
          </span>
        </div>
      )}

      {agent.memoryEnabled && (
        <div className="detail-section">
          <div className="detail-label"><Database size={12} /> Memoria</div>
          <div className="memory-badge">
            <CheckCircle size={11} color="#4ade80" /> Memoria persistente activada
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-label">System prompt</div>
        <textarea
          className="system-prompt-input"
          defaultValue={agent.systemPrompt}
          rows={4}
        />
      </div>

      <button className="activate-btn" style={{ borderColor: agent.color, color: agent.color }}>
        Activar agente
      </button>
    </div>
  );
}

export function AgentsView() {
  const [selected, setSelected] = useState<string>(DEFAULT_AGENTS[0].id);
  const selectedAgent = DEFAULT_AGENTS.find((a) => a.id === selected);

  return (
    <div className="agents-view">
      <div className="agents-list">
        <div className="agents-list-header">
          <span>Agentes</span>
          <button className="icon-btn"><Plus size={14} /></button>
        </div>
        {DEFAULT_AGENTS.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            selected={selected === a.id}
            onSelect={() => setSelected(a.id)}
          />
        ))}
        <div className="add-agent-card">
          <Plus size={16} />
          <span>Agregar agente custom</span>
        </div>
      </div>

      <div className="agents-detail-panel">
        {selectedAgent && <AgentDetail agent={selectedAgent} />}
      </div>
    </div>
  );
}

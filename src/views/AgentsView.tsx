import { useState } from "react";
import { CheckCircle, Circle, Plus, Zap, Trash2, RotateCcw, Power } from "lucide-react";
import { AgentConfig } from "../lib/providers";
import { useAgentsStore, isDefaultAgent } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSettingsStore } from "../store/settingsStore";

function AgentCard({ agent, selected, active, onSelect }: { agent: AgentConfig; selected: boolean; active: boolean; onSelect: () => void }) {
  return (
    <div className={`agent-card${selected ? " selected" : ""}`} onClick={onSelect}>
      <div className="agent-card-header">
        <div className="agent-card-icon" style={{ background: `${agent.color}22`, color: agent.color }}>
          {agent.icon}
        </div>
        <div className="agent-card-info">
          <div className="agent-card-name">
            {agent.name}
            {active && <span className="agent-active-tag">activo</span>}
          </div>
          <div className={`agent-card-status agent-card-status--${active ? "active" : "inactive"}`}>
            {active ? <CheckCircle size={10} /> : <Circle size={10} />}
            {active ? "en uso en el chat" : "inactivo"}
          </div>
        </div>
      </div>
      <p className="agent-card-desc">{agent.description}</p>
    </div>
  );
}

export function AgentDetail({ agent }: { agent: AgentConfig }) {
  const updateAgent = useAgentsStore((s) => s.updateAgent);
  const removeAgent = useAgentsStore((s) => s.removeAgent);
  const resetAgent = useAgentsStore((s) => s.resetAgent);
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const setActiveAgent = useChatStore((s) => s.setActiveAgent);
  const providers = useSettingsStore((s) => s.providers);

  const isActive = activeAgentId === agent.id;
  const isDefault = isDefaultAgent(agent.id);
  const provider = providers.find((p) => p.id === agent.providerId);

  return (
    <div className="agent-detail">
      <div className="agent-detail-header">
        <div className="agent-detail-icon" style={{ background: `${agent.color}22`, color: agent.color }}>
          {agent.icon}
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="agent-detail-name">{agent.name}</h2>
          <p className="agent-detail-desc">{agent.description}</p>
        </div>
        {isDefault ? (
          <button className="agent-icon-action" title="Restaurar valores por defecto" onClick={() => resetAgent(agent.id)}>
            <RotateCcw size={14} />
          </button>
        ) : (
          <button className="agent-icon-action" title="Eliminar agente custom" onClick={() => removeAgent(agent.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-label">Proveedor</div>
        <div className="agent-provider-row">
          <span className="agent-provider-pill" style={{ borderColor: provider?.color ?? "#666" }}>
            <span className="provider-dot" style={{ background: provider?.color ?? "#666" }} />
            {provider?.name ?? agent.providerId}
          </span>
          {!provider?.acp && (
            <span className="agent-provider-warn">Proveedor sin adaptador ACP — no ejecutable todavía</span>
          )}
        </div>
      </div>

      {agent.skills.length > 0 && (
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
      )}

      <div className="detail-section">
        <div className="detail-label">System prompt</div>
        <textarea
          className="system-prompt-input"
          value={agent.systemPrompt}
          onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
          rows={4}
          placeholder="Instrucciones que se anteponen al iniciar una conversación nueva con este agente…"
        />
        <p className="detail-hint">Se inyecta al inicio de cada sesión ACP nueva en el chat.</p>
      </div>

      <button
        className="activate-btn"
        style={isActive
          ? { borderColor: agent.color, color: "#0a0a0a", background: agent.color }
          : { borderColor: agent.color, color: agent.color }}
        onClick={() => setActiveAgent(agent.id)}
        disabled={isActive}
      >
        <Power size={13} />
        {isActive ? "Agente activo" : "Activar agente"}
      </button>
    </div>
  );
}

export function NewAgentForm({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
  const addAgent = useAgentsStore((s) => s.addAgent);
  const providers = useSettingsStore((s) => s.providers);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [providerId, setProviderId] = useState(providers.find((p) => p.acp)?.id ?? providers[0]?.id ?? "mimo");
  const [systemPrompt, setSystemPrompt] = useState("");

  const save = () => {
    if (!name.trim()) return;
    const id = addAgent({ name, description, providerId, systemPrompt });
    onCreated?.(id);
    onClose();
  };

  return (
    <div className="agent-detail">
      <div className="agent-detail-header">
        <div className="agent-detail-icon" style={{ background: "#a78bfa22", color: "#a78bfa" }}>✦</div>
        <div><h2 className="agent-detail-name">Nuevo agente custom</h2></div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Nombre</div>
        <input className="provider-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi agente" />
      </div>
      <div className="detail-section">
        <div className="detail-label">Descripción</div>
        <input className="provider-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve" />
      </div>
      <div className="detail-section">
        <div className="detail-label">Proveedor</div>
        <select className="provider-input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="detail-section">
        <div className="detail-label">System prompt</div>
        <textarea className="system-prompt-input" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} placeholder="Instrucciones del agente…" />
      </div>

      <div className="agent-form-actions">
        <button className="save-btn" onClick={save} disabled={!name.trim()}>Crear agente</button>
        <button className="agent-cancel-btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}

export function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const [selected, setSelected] = useState<string>(agents[0]?.id ?? "");
  const [creating, setCreating] = useState(false);

  const selectedAgent = agents.find((a) => a.id === selected) ?? agents[0];

  return (
    <div className="agents-view">
      <div className="agents-list">
        <div className="agents-list-header">
          <span>Agentes</span>
          <button className="icon-btn" title="Agregar agente custom" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        </div>
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            selected={!creating && selected === a.id}
            active={activeAgentId === a.id}
            onSelect={() => { setCreating(false); setSelected(a.id); }}
          />
        ))}
        <div className="add-agent-card" onClick={() => setCreating(true)}>
          <Plus size={16} />
          <span>Agregar agente custom</span>
        </div>
      </div>

      <div className="agents-detail-panel">
        {creating
          ? <NewAgentForm onClose={() => setCreating(false)} />
          : selectedAgent && <AgentDetail agent={selectedAgent} />}
      </div>
    </div>
  );
}

import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";
import { useAgentsStore } from "../store/agentsStore";
import { DEFAULT_PROVIDERS } from "../lib/providers";

export type AgentNodeData = {
  label: string;
  agentId: string;
  prompt: string;
  status?: NodeStatus;
};

// Nodo agente genérico: se elige el agente por nodo. Solo listamos los que tienen backend ACP real
// (provider con config `acp`) — el resto no ejecuta nada. La config fina (prompt largo) va al inspector.
export function AgentNode({ id, data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const agents = useAgentsStore((s) => s.agents);
  const status = d.status ?? "idle";
  const acpAgents = agents.filter((a) => {
    const p = DEFAULT_PROVIDERS.find((p) => p.id === a.providerId);
    return !!p?.acp || !!p?.nativeHttp;
  });

  return (
    <div className={`rf-node agent-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#a78bfa" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🤖</div>
        <span className="rf-node-title">{d.label || "Agente"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">AI</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Agente</div>
          <select
            className="rf-node-op"
            value={d.agentId || ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { agentId: e.target.value })}
          >
            <option value="">—</option>
            {acpAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="rf-node-field">
          <div className="rf-field-label">Prompt</div>
          <textarea
            className="rf-field-input"
            rows={3}
            value={d.prompt || ""}
            placeholder="Describí qué debe hacer…"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#a78bfa" }} />
    </div>
  );
}

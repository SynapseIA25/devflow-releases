import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";
import { useAgentsStore } from "../store/agentsStore";
import { DEFAULT_PROVIDERS } from "../lib/providers";

export type VerifyNodeData = {
  label: string;
  agentId: string;
  prompt: string;
  status?: NodeStatus;
};

// Nodo verify: como AgentNode, pero su salida es un veredicto (exitCode 0/1) en vez de texto libre —
// ver execVerify en workflowEngine.ts. El agente resuelve la verificación con lo que tenga disponible
// en su sesión (terminal, MCP de mobile-mcp/Desktop CDP/Puppeteer si están habilitados).
export function VerifyNode({ id, data, selected }: NodeProps) {
  const d = data as VerifyNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const agents = useAgentsStore((s) => s.agents);
  const status = d.status ?? "idle";
  const acpAgents = agents.filter((a) => {
    const p = DEFAULT_PROVIDERS.find((p) => p.id === a.providerId);
    return !!p?.acp || !!p?.nativeHttp;
  });

  return (
    <div className={`rf-node verify-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#2dd4bf" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">✅</div>
        <span className="rf-node-title">{d.label || "Verificar"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">QA</span>
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
          <div className="rf-field-label">Qué verificar</div>
          <textarea
            className="rf-field-input"
            rows={3}
            value={d.prompt || ""}
            placeholder="Describí qué debe confirmar…"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#2dd4bf" }} />
    </div>
  );
}

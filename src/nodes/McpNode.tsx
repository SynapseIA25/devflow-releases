import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type McpNodeData = {
  label: string;
  command: string;
  tool: string;
  arguments?: string;
  status?: NodeStatus;
};

// Tarjeta compacta: nombre de la tool inline. El comando del server y los argumentos van en el inspector.
export function McpNode({ id, data, selected }: NodeProps) {
  const d = data as McpNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node mcp-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#38bdf8" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🧩</div>
        <span className="rf-node-title">{d.label || "MCP Tool"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">MCP</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Tool</div>
          <input
            className="rf-field-input"
            value={d.tool || ""}
            placeholder="search_code"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { tool: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#38bdf8" }} />
    </div>
  );
}

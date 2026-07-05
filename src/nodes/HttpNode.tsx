import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type HttpNodeData = {
  label: string;
  method: string;
  url: string;
  headers?: string;
  body?: string;
  status?: NodeStatus;
};

// Tarjeta compacta: método + URL inline. La config completa (headers/body) va en el inspector.
export function HttpNode({ id, data, selected }: NodeProps) {
  const d = data as HttpNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node http-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#22d3ee" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🌐</div>
        <span className="rf-node-title">{d.label || "HTTP"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">{d.method || "GET"}</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">URL</div>
          <input
            className="rf-field-input"
            value={d.url || ""}
            placeholder="https://api…"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { url: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#22d3ee" }} />
    </div>
  );
}

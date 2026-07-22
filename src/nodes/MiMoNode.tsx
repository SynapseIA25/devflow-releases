import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type MiMoNodeData = {
  label: string;
  prompt: string;
  status?: NodeStatus;
};

export function MiMoNode({ id, data, selected }: NodeProps) {
  const d = data as MiMoNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node mimo-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#7c3aed" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🤖</div>
        <span className="rf-node-title">{d.label || "DevFlow Code"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">AI</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Prompt</div>
          <textarea
            className="rf-field-input"
            rows={3}
            value={d.prompt || ""}
            placeholder="Describe what DevFlow Code should do..."
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#7c3aed" }} />
    </div>
  );
}

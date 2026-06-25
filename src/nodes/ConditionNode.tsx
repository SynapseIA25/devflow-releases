import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type ConditionNodeData = {
  label: string;
  condition: string;
  status?: NodeStatus;
};

export function ConditionNode({ id, data, selected }: NodeProps) {
  const d = data as ConditionNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node condition-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#0ea5e9" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🔀</div>
        <span className="rf-node-title">{d.label || "Condition"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">IF</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Condition</div>
          <input
            className="rf-field-input"
            value={d.condition || ""}
            placeholder="{{3.exitCode}} === 0"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { condition: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ background: "#4ade80", top: "35%" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ background: "#f85149", top: "65%" }} />
    </div>
  );
}

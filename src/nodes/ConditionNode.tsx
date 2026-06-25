import { Handle, Position, NodeProps } from "@xyflow/react";

export type ConditionNodeData = {
  label: string;
  condition: string;
};

export function ConditionNode({ data, selected }: NodeProps) {
  const d = data as ConditionNodeData;
  return (
    <div className={`rf-node condition-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#0ea5e9" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🔀</div>
        <span className="rf-node-title">{d.label || "Condition"}</span>
        <span className="rf-node-badge">IF</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Condition</div>
          <input
            className="rf-field-input"
            defaultValue={d.condition || ""}
            placeholder="exit_code === 0"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ background: "#4ade80", top: "35%" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ background: "#f85149", top: "65%" }} />
    </div>
  );
}

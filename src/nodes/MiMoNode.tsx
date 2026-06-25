import { Handle, Position, NodeProps } from "@xyflow/react";

export type MiMoNodeData = {
  label: string;
  prompt: string;
};

export function MiMoNode({ data, selected }: NodeProps) {
  const d = data as MiMoNodeData;
  return (
    <div className={`rf-node mimo-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#7c3aed" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🤖</div>
        <span className="rf-node-title">{d.label || "MiMo Agent"}</span>
        <span className="rf-node-badge">AI</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Prompt</div>
          <textarea
            className="rf-field-input"
            rows={3}
            defaultValue={d.prompt || ""}
            placeholder="Describe what MiMo should do..."
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#7c3aed" }} />
    </div>
  );
}

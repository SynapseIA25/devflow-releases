import { Handle, Position, NodeProps } from "@xyflow/react";

export type FileNodeData = {
  label: string;
  path: string;
  operation: "read" | "write";
};

export function FileNode({ data, selected }: NodeProps) {
  const d = data as FileNodeData;
  return (
    <div className={`rf-node file-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#d97706" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">📄</div>
        <span className="rf-node-title">{d.label || "File"}</span>
        <span className="rf-node-badge">{d.operation || "read"}</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Path</div>
          <input
            className="rf-field-input"
            defaultValue={d.path || ""}
            placeholder="./src/main.ts"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#d97706" }} />
    </div>
  );
}

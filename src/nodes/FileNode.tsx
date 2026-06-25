import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type FileNodeData = {
  label: string;
  path: string;
  operation: "read" | "write";
  status?: NodeStatus;
};

export function FileNode({ id, data, selected }: NodeProps) {
  const d = data as FileNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node file-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#d97706" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">📄</div>
        <span className="rf-node-title">{d.label || "File"}</span>
        <span className="rf-node-id">{id}</span>
        <select
          className="rf-node-op"
          value={d.operation || "read"}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeData(id, { operation: e.target.value as "read" | "write" })}
        >
          <option value="read">read</option>
          <option value="write">write</option>
        </select>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Path</div>
          <input
            className="rf-field-input"
            value={d.path || ""}
            placeholder="./src/main.ts"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { path: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#d97706" }} />
    </div>
  );
}

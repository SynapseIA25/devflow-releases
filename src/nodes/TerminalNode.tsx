import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type TerminalNodeData = {
  label: string;
  command: string;
  status?: NodeStatus;
};

export function TerminalNode({ id, data, selected }: NodeProps) {
  const d = data as TerminalNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  return (
    <div className={`rf-node terminal-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#16a34a" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">⚡</div>
        <span className="rf-node-title">{d.label || "Terminal"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">CMD</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Command</div>
          <input
            className="rf-field-input"
            value={d.command || ""}
            placeholder="npm run build"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { command: e.target.value })}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#16a34a" }} />
    </div>
  );
}

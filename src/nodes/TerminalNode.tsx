import { Handle, Position, NodeProps } from "@xyflow/react";

export type TerminalNodeData = {
  label: string;
  command: string;
};

export function TerminalNode({ data, selected }: NodeProps) {
  const d = data as TerminalNodeData;
  return (
    <div className={`rf-node terminal-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#16a34a" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">⚡</div>
        <span className="rf-node-title">{d.label || "Terminal"}</span>
        <span className="rf-node-badge">CMD</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Command</div>
          <input
            className="rf-field-input"
            defaultValue={d.command || ""}
            placeholder="npm run build"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#16a34a" }} />
    </div>
  );
}

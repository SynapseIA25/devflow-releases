import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, useProjectWorkflowIds, type NodeStatus } from "../store/workflowStore";

export type LoopNodeData = {
  label?: string;
  list?: string;
  flowId?: string;
  parallel?: string;
  status?: NodeStatus;
};

// Tarjeta del nodo loop/foreach: elegís el sub-flujo a repetir por item. La lista y el modo
// (secuencial/paralelo) se editan en el inspector. El motor lo corre por dentro (ver execLoop).
export function LoopNode({ id, data, selected }: NodeProps) {
  const d = data as LoopNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const activeId = useWorkflowStore((s) => s.activeId);
  const order = useProjectWorkflowIds();
  const workflows = useWorkflowStore((s) => s.workflows);
  const status = d.status ?? "idle";

  const options = order.filter((fid) => fid !== activeId);
  const current = d.flowId ? workflows[d.flowId] : undefined;

  return (
    <div className={`rf-node loop-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#f59e0b" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🔁</div>
        <span className="rf-node-title">{d.label || "Loop"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">{d.parallel === "parallel" ? "PAR" : "FOR"}</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Sub-flujo por item</div>
          <select
            className="rf-field-input"
            value={d.flowId || ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { flowId: e.target.value })}
          >
            <option value="">— elegir flujo —</option>
            {options.map((fid) => (
              <option key={fid} value={fid}>
                {workflows[fid]?.name ?? fid}
              </option>
            ))}
          </select>
          {current ? (
            <div className="subflow-meta">{current.nodes.length} nodos · por cada item</div>
          ) : (
            <div className="subflow-meta subflow-meta--warn">sin flujo asignado</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#f59e0b" }} />
    </div>
  );
}

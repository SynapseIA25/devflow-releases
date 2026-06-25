import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type SubflowNodeData = {
  label?: string;
  flowId?: string;
  flowName?: string;
  status?: NodeStatus;
};

// Tarjeta que referencia a otro flujo guardado. Al ejecutarse, el motor corre el flujo entero
// por dentro (ver execSubflow en workflowEngine). El <select> deja reapuntar a otro flujo;
// se excluye el flujo activo para evitar que un flujo se incluya a sí mismo.
export function SubflowNode({ id, data, selected }: NodeProps) {
  const d = data as SubflowNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const activeId = useWorkflowStore((s) => s.activeId);
  const order = useWorkflowStore((s) => s.order);
  const workflows = useWorkflowStore((s) => s.workflows);
  const status = d.status ?? "idle";

  const options = order.filter((fid) => fid !== activeId);
  const current = d.flowId ? workflows[d.flowId] : undefined;

  return (
    <div className={`rf-node subflow-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#0ea5e9" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">🧩</div>
        <span className="rf-node-title">{current?.name || d.flowName || "Sub-flujo"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">FLOW</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Flujo referenciado</div>
          <select
            className="rf-field-input"
            value={d.flowId || ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const fid = e.target.value;
              updateNodeData(id, { flowId: fid, flowName: workflows[fid]?.name ?? "" });
            }}
          >
            <option value="">— elegir flujo —</option>
            {options.map((fid) => (
              <option key={fid} value={fid}>
                {workflows[fid]?.name ?? fid}
              </option>
            ))}
          </select>
          {current ? (
            <div className="subflow-meta">{current.nodes.length} nodos internos</div>
          ) : (
            <div className="subflow-meta subflow-meta--warn">sin flujo asignado</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#0ea5e9" }} />
    </div>
  );
}

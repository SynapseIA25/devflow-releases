import { Handle, Position, NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeStatus } from "../store/workflowStore";

export type PerfNodeData = {
  label: string;
  mode: "resource" | "http";
  processMatch?: string;
  durationSec?: string;
  intervalMs?: string;
  url?: string;
  method?: string;
  concurrency?: string;
  requests?: string;
  status?: NodeStatus;
};

// Nodo perf: mide propiedades no funcionales (no pasa/falla por lógica de negocio) — ver execPerf en
// workflowEngine.ts. Modo "resource" polea CPU/RAM de un proceso; modo "http" hace load testing de un
// endpoint. El resumen numérico queda en la salida del nodo (JSON), no hay chart acá — ver el output
// panel para el detalle completo de una corrida.
export function PerfNode({ id, data, selected }: NodeProps) {
  const d = data as PerfNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = d.status ?? "idle";
  const mode = d.mode ?? "resource";

  return (
    <div className={`rf-node perf-node rf-node--${status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ background: "#f472b6" }} />
      <div className="rf-node-header">
        <div className="rf-node-icon">📊</div>
        <span className="rf-node-title">{d.label || "Perf"}</span>
        <span className="rf-node-id">{id}</span>
        <span className="rf-node-badge">{mode === "http" ? "HTTP" : "CPU/RAM"}</span>
      </div>
      <div className="rf-node-body">
        <div className="rf-node-field">
          <div className="rf-field-label">Modo</div>
          <select
            className="rf-node-op"
            value={mode}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { mode: e.target.value })}
          >
            <option value="resource">Consumo de recursos</option>
            <option value="http">Load test HTTP</option>
          </select>
        </div>
        {mode === "resource" ? (
          <div className="rf-node-field">
            <div className="rf-field-label">Proceso</div>
            <input
              className="rf-field-input"
              value={d.processMatch || ""}
              placeholder="mimo-agent"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => updateNodeData(id, { processMatch: e.target.value })}
            />
          </div>
        ) : (
          <div className="rf-node-field">
            <div className="rf-field-label">URL</div>
            <input
              className="rf-field-input"
              value={d.url || ""}
              placeholder="http://127.0.0.1:3000/health"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => updateNodeData(id, { url: e.target.value })}
            />
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#f472b6" }} />
    </div>
  );
}

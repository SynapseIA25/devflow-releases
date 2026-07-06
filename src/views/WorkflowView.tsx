import { useState, useCallback, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Play, Square, Plus, Trash2, Clock, FileCode } from "lucide-react";
import { Canvas } from "../components/Canvas";
import { Sidebar } from "../components/Sidebar";
import { NodeInspector } from "../components/workflow/NodeInspector";
import { TriggersModal } from "../components/workflow/TriggersModal";
import { OutputPanel, LogEntry } from "../components/OutputPanel";
import { useWorkflowStore } from "../store/workflowStore";
import { useUiStore } from "../store/uiStore";
import { useMetricsStore } from "../store/metricsStore";
import { runWorkflow } from "../lib/workflowEngine";

export function WorkflowView() {
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: new Date().toLocaleTimeString(), level: "info", message: "Editor de workflows listo. Arrastrá nodos desde el panel izquierdo y dale Run." },
  ]);
  const [running, setRunning] = useState(false);
  const [showTriggers, setShowTriggers] = useState(false);
  const [writtenFiles, setWrittenFiles] = useState<string[]>([]);
  const cancelRef = useRef(false);
  const openInEditor = useUiStore((s) => s.openInEditor);

  const order = useWorkflowStore((s) => s.order);
  const activeId = useWorkflowStore((s) => s.activeId);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);
  const createWorkflow = useWorkflowStore((s) => s.createWorkflow);
  const renameWorkflow = useWorkflowStore((s) => s.renameWorkflow);
  const deleteWorkflow = useWorkflowStore((s) => s.deleteWorkflow);
  const activeName = workflows[activeId]?.name ?? "";

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((l) => [...l, entry]);
  }, []);

  const log = useCallback(
    (level: LogEntry["level"], message: string) =>
      addLog({ time: new Date().toLocaleTimeString(), level, message }),
    [addLog]
  );

  const handleRun = useCallback(async () => {
    const st = useWorkflowStore.getState();
    const w = st.workflows[st.activeId];
    if (!w) return;
    cancelRef.current = false;
    setRunning(true);
    setWrittenFiles([]);
    st.resetStatuses();
    log("info", `▶ Ejecutando "${w.name}" (${w.nodes.length} nodos)…`);
    const startedAt = performance.now();
    try {
      await runWorkflow(w.nodes, w.edges, {
        onLog: log,
        setNodeStatus: st.setNodeStatus,
        isCancelled: () => cancelRef.current,
        // El motor resuelve los nodos sub-flujo contra los flujos guardados (referencia viva).
        resolveFlow: (flowId) => {
          const f = useWorkflowStore.getState().workflows[flowId];
          return f ? { name: f.name, nodes: f.nodes, edges: f.edges } : undefined;
        },
        onFileWritten: (path) => setWrittenFiles((prev) => (prev.includes(path) ? prev : [...prev, path])),
      });
    } catch (e) {
      log("error", `Error inesperado: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useMetricsStore.getState().recordWorkflowRun({ latencyMs: performance.now() - startedAt });
      setRunning(false);
    }
  }, [log]);

  const handleStop = useCallback(() => {
    cancelRef.current = true;
    log("warn", "Cancelando… (se detiene al terminar el nodo actual)");
  }, [log]);

  return (
    <div className="workflow-view">
      <ReactFlowProvider>
        <Sidebar />
        <div className="workflow-canvas-area">
          <div className="workflow-toolbar">
            <select
              className="wf-flow-select"
              value={activeId}
              onChange={(e) => setActiveWorkflow(e.target.value)}
              disabled={running}
              title="Cambiar de flujo"
            >
              {order.map((id) => (
                <option key={id} value={id}>
                  {workflows[id].name}
                </option>
              ))}
            </select>
            <input
              className="wf-flow-name"
              value={activeName}
              onChange={(e) => renameWorkflow(activeId, e.target.value)}
              disabled={running}
              title="Renombrar flujo activo"
              placeholder="Nombre del flujo"
            />
            <button
              className="wf-icon-btn"
              onClick={() => createWorkflow()}
              disabled={running}
              title="Nuevo flujo"
            >
              <Plus size={14} />
            </button>
            <button
              className="wf-icon-btn wf-icon-btn--danger"
              onClick={() => deleteWorkflow(activeId)}
              disabled={running || order.length <= 1}
              title={order.length <= 1 ? "No podés borrar el último flujo" : "Borrar flujo activo"}
            >
              <Trash2 size={14} />
            </button>

            <div className="wf-toolbar-spacer" />

            <button
              className="wf-icon-btn"
              onClick={() => setShowTriggers(true)}
              title="Triggers / programar este flujo"
            >
              <Clock size={14} />
            </button>

            <button
              className={`wf-run-btn${running ? " running" : ""}`}
              onClick={running ? handleStop : handleRun}
            >
              {running ? <Square size={13} /> : <Play size={13} />}
              {running ? "Stop" : "Run"}
            </button>
            <span className="wf-toolbar-hint">
              {running ? "Ejecutando…" : "Ejecuta el grafo de izquierda a derecha"}
            </span>
          </div>
          <Canvas onLog={addLog} />
          {writtenFiles.length > 0 && (
            <div className="wf-written">
              <span className="wf-written-label">Archivos generados:</span>
              {writtenFiles.map((p) => (
                <button
                  key={p}
                  className="wf-written-chip"
                  onClick={() => openInEditor(p)}
                  title={`Abrir ${p} en el editor`}
                >
                  <FileCode size={11} /> {p.split(/[\\/]/).pop()}
                </button>
              ))}
            </div>
          )}
          <OutputPanel logs={logs} onClear={() => setLogs([])} />
        </div>
        <NodeInspector />
      </ReactFlowProvider>

      {showTriggers && (
        <TriggersModal workflowId={activeId} workflowName={activeName} onClose={() => setShowTriggers(false)} />
      )}
    </div>
  );
}

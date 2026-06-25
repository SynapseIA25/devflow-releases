import { useState, useCallback, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Play, Square } from "lucide-react";
import { Canvas } from "../components/Canvas";
import { Sidebar } from "../components/Sidebar";
import { OutputPanel, LogEntry } from "../components/OutputPanel";
import { useWorkflowStore } from "../store/workflowStore";
import { runWorkflow } from "../lib/workflowEngine";

export function WorkflowView() {
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: new Date().toLocaleTimeString(), level: "info", message: "Editor de workflows listo. Arrastrá nodos desde el panel izquierdo y dale Run." },
  ]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((l) => [...l, entry]);
  }, []);

  const log = useCallback(
    (level: LogEntry["level"], message: string) =>
      addLog({ time: new Date().toLocaleTimeString(), level, message }),
    [addLog]
  );

  const handleRun = useCallback(async () => {
    const { nodes, edges, resetStatuses, setNodeStatus } = useWorkflowStore.getState();
    cancelRef.current = false;
    setRunning(true);
    resetStatuses();
    log("info", `▶ Ejecutando workflow (${nodes.length} nodos)…`);
    try {
      await runWorkflow(nodes, edges, {
        onLog: log,
        setNodeStatus,
        isCancelled: () => cancelRef.current,
      });
    } catch (e) {
      log("error", `Error inesperado: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
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
          <OutputPanel logs={logs} onClear={() => setLogs([])} />
        </div>
      </ReactFlowProvider>
    </div>
  );
}

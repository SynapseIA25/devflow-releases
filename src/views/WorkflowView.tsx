import { useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "../components/Canvas";
import { Sidebar } from "../components/Sidebar";
import { OutputPanel, LogEntry } from "../components/OutputPanel";

export function WorkflowView() {
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: new Date().toLocaleTimeString(), level: "info", message: "Editor de workflows listo. Arrastrá nodos desde el panel izquierdo." },
  ]);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((l) => [...l, entry]);
  }, []);

  return (
    <div className="workflow-view">
      <ReactFlowProvider>
        <Sidebar />
        <div className="workflow-canvas-area">
          <Canvas onLog={addLog} />
          <OutputPanel logs={logs} onClear={() => setLogs([])} />
        </div>
      </ReactFlowProvider>
    </div>
  );
}

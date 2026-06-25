import { useState } from "react";
import { type ReactElement } from "react";
import "./App.css";
import { NavBar, ViewId } from "./components/NavBar";
import { RightPanel } from "./components/RightPanel";
import { FloatingWindow } from "./components/FloatingWindow";
import { CodeFlowPanel } from "./components/panel/CodeFlowPanel";
import { ChatView } from "./views/ChatView";
import { WorkflowView } from "./views/WorkflowView";
import { AgentsView } from "./views/AgentsView";
import { McpView } from "./views/McpView";
import { SettingsView } from "./views/SettingsView";
import { GitBranch, Activity } from "lucide-react";

const VIEWS: Record<ViewId, ReactElement> = {
  chat:     <ChatView />,
  workflow: <WorkflowView />,
  agents:   <AgentsView />,
  mcp:      <McpView />,
  settings: <SettingsView />,
};

const SHOW_RIGHT_PANEL: ViewId[] = ["chat", "workflow", "agents"];

export default function App() {
  const [view, setView]                 = useState<ViewId>("chat");
  const [showCodeFlow, setShowCodeFlow] = useState(false);
  const [showDataFlow, setShowDataFlow] = useState(false);

  return (
    <div className="app">
      <NavBar active={view} onChange={setView} />
      <div className="app-content">
        <div className="view-area">{VIEWS[view]}</div>
        {SHOW_RIGHT_PANEL.includes(view) && (
          <RightPanel
            onOpenCodeFlow={() => setShowCodeFlow(true)}
            onOpenDataFlow={() => setShowDataFlow(true)}
          />
        )}
      </div>

      {showCodeFlow && (
        <FloatingWindow
          title="Code Flow"
          icon={<GitBranch size={13} />}
          onClose={() => setShowCodeFlow(false)}
          initialPos={{ x: 100, y: 60 }}
          initialSize={{ w: 580, h: 420 }}
        >
          <CodeFlowPanel />
        </FloatingWindow>
      )}

      {showDataFlow && (
        <FloatingWindow
          title="Data Flow"
          icon={<Activity size={13} />}
          onClose={() => setShowDataFlow(false)}
          initialPos={{ x: 160, y: 100 }}
          initialSize={{ w: 520, h: 380 }}
        >
          <div className="rp-data-placeholder" style={{ height: "100%" }}>
            <Activity size={36} opacity={0.2} />
            <p>Seleccioná un archivo en el explorador para visualizar el flujo de datos entre sus funciones.</p>
          </div>
        </FloatingWindow>
      )}
    </div>
  );
}

import { useState } from "react";
import { type ReactElement } from "react";
import "./App.css";
import { NavBar, ViewId } from "./components/NavBar";
import { RightPanel } from "./components/RightPanel";
import { TriggerRunner } from "./components/TriggerRunner";
import { EditorWatcher } from "./components/EditorWatcher";
import { FloatingWindow } from "./components/FloatingWindow";
import { CodeFlowPanel } from "./components/panel/CodeFlowPanel";
import { ChatView } from "./views/ChatView";
import { WorkflowView } from "./views/WorkflowView";
import { EditorView } from "./views/EditorView";
import { CodebaseMapView } from "./views/CodebaseMapView";
import { AgentsView } from "./views/AgentsView";
import { McpView } from "./views/McpView";
import { ServicesView } from "./views/ServicesView";
import { ProjectsView } from "./views/ProjectsView";
import { EnvironmentsView } from "./views/EnvironmentsView";
import { TerminalsView } from "./views/TerminalsView";
import { TeamView } from "./views/TeamView";
import { SettingsView } from "./views/SettingsView";
import { GitBranch, Activity } from "lucide-react";
import { useUiStore } from "./store/uiStore";

// El chat NO es una vista más: es un panel único (ChatView) montado UNA sola vez y siempre presente
// en el árbol, para preservar sus sesiones ACP y sus PTYs al cambiar de vista. Se reposiciona por
// CSS según el modo: "full" (pantalla completa cuando la vista activa es Chat), "side" (dock lateral
// toggleable sobre editor/workflows/etc.) u "hidden". Nunca hay dos instancias → sin PTYs duplicadas.
const VIEWS: Partial<Record<ViewId, ReactElement>> = {
  workflow: <WorkflowView />,
  editor:   <EditorView />,
  map:      <CodebaseMapView />,
  projects: <ProjectsView />,
  environments: <EnvironmentsView />,
  terminals: <TerminalsView />,
  team: <TeamView />,
  services: <ServicesView />,
  agents:   <AgentsView />,
  mcp:      <McpView />,
  settings: <SettingsView />,
};

// Vistas que muestran el panel derecho (archivos/contexto) además del chat a pantalla completa.
// Workflows ya no lo usa: tiene su propio panel derecho (NodeInspector para configurar el nodo).
const SHOW_RIGHT_PANEL: ViewId[] = ["agents"];

export default function App() {
  const view                            = useUiStore((s) => s.view);
  const setView                         = useUiStore((s) => s.setView);
  const [chatDock, setChatDock]         = useState(false);
  const [dockWidth, setDockWidth]       = useState(420);
  const [showCodeFlow, setShowCodeFlow] = useState(false);
  const [showDataFlow, setShowDataFlow] = useState(false);

  const isChatFull = view === "chat";
  const chatMode: "full" | "side" | "hidden" = isChatFull ? "full" : chatDock ? "side" : "hidden";
  const showRightPanel = isChatFull || SHOW_RIGHT_PANEL.includes(view);

  const onDockResize = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = dockWidth;
    const onMove = (ev: MouseEvent) =>
      setDockWidth(Math.max(300, Math.min(760, startW + (startX - ev.clientX))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="app">
      {/* Scheduler global de triggers + watcher del editor (no renderizan UI). */}
      <TriggerRunner />
      <EditorWatcher />
      <NavBar
        active={view}
        onChange={setView}
        chatDockOpen={chatDock}
        onToggleChatDock={() => setChatDock((v) => !v)}
      />
      <div className="app-content">
        {!isChatFull && <div className="view-area">{VIEWS[view]}</div>}

        {/* Chat: siempre montado, reposicionado por la clase de modo (order en CSS). */}
        <div
          className={`chat-dock chat-dock--${chatMode}`}
          style={chatMode === "side" ? { width: dockWidth } : undefined}
        >
          {chatMode === "side" && <div className="chat-dock-resize" onMouseDown={onDockResize} />}
          <ChatView />
        </div>

        {showRightPanel && (
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

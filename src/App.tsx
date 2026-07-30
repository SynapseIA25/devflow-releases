import { useState, useEffect } from "react";
import { type ReactElement } from "react";
import "./App.css";
import { useProjectStore } from "./store/projectStore";
import { useWorkflowStore } from "./store/workflowStore";
import { PROJECT_CWD } from "./lib/constants";
import { homeDir } from "./lib/tauriApi";
import { NavBar, ViewId } from "./components/NavBar";
import { RightPanel } from "./components/RightPanel";
import { TriggerRunner } from "./components/TriggerRunner";
import { PlannerRunner } from "./components/PlannerRunner";
import { CommandPalette } from "./components/CommandPalette";
import { MobileCompanionRunner } from "./components/MobileCompanionRunner";
import { EditorWatcher } from "./components/EditorWatcher";
import { McpBridgeRunner } from "./components/McpBridgeRunner";
import { UpdateBanner } from "./components/UpdateBanner";
import { OnboardingModal } from "./components/OnboardingModal";
import { useSettingsStore } from "./store/settingsStore";
import { ChatView } from "./views/ChatView";
import { WorkflowView } from "./views/WorkflowView";
import { EditorView } from "./views/EditorView";
import { CodebaseMapView } from "./views/CodebaseMapView";
import { AgentsView } from "./views/AgentsView";
import { McpView } from "./views/McpView";
import { ServicesView } from "./views/ServicesView";
import { TestsView } from "./views/TestsView";
import { ProjectsView } from "./views/ProjectsView";
import { EnvironmentsView } from "./views/EnvironmentsView";
import { TerminalsView } from "./views/TerminalsView";
import { SpecsView } from "./views/SpecsView";
import { PlannerView } from "./views/PlannerView";
import { GitHubView } from "./views/GitHubView";
import { SkillsView } from "./views/SkillsView";
import { SettingsView } from "./views/SettingsView";
import { useSkillsStore } from "./store/skillsStore";
import { syncSkillsToDisk } from "./lib/skills";
import { useUiStore } from "./store/uiStore";

// El chat NO es una vista más: es un panel único (ChatView) montado UNA sola vez y siempre presente
// en el árbol, para preservar sus sesiones ACP y sus PTYs al cambiar de vista. Se reposiciona por
// CSS según el modo: "full" (pantalla completa cuando la vista activa es Chat), "side" (dock lateral
// toggleable sobre editor/workflows/etc.) u "hidden". Nunca hay dos instancias → sin PTYs duplicadas.
const VIEWS: Partial<Record<ViewId, ReactElement>> = {
  workflow: <WorkflowView />,
  editor:   <EditorView />,
  specs:    <SpecsView />,
  map:      <CodebaseMapView />,
  planner:  <PlannerView />,
  github:   <GitHubView />,
  projects: <ProjectsView />,
  environments: <EnvironmentsView />,
  terminals: <TerminalsView />,
  skills: <SkillsView />,
  services: <ServicesView />,
  tests: <TestsView />,
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
  const onboardingDone                  = useSettingsStore((s) => s.onboardingDone);
  const [chatDock, setChatDock]         = useState(false);
  const [dockWidth, setDockWidth]       = useState(420);

  // Fresh install: si el único proyecto sigue siendo la semilla hardcodeada (PROJECT_CWD), lo re-apuntamos
  // al home real del usuario — así DevFlow no arranca clavado a la ruta del repo de otra máquina.
  useEffect(() => {
    const ps = useProjectStore.getState();
    const active = ps.projects[ps.activeId];
    if (ps.order.length === 1 && active && active.path === PROJECT_CWD) {
      homeDir().then((home) => {
        if (home && home !== PROJECT_CWD) {
          const name = home.split(/[\\/]/).filter(Boolean).pop() || "Proyecto";
          useProjectStore.getState().updateProject(ps.activeId, { path: home, name });
        }
      });
    }
  }, []);

  // Backfill único: los workflows pasaron de globales a scopeados por proyecto (project.workflowIds,
  // ver workflowStore.useProjectWorkflowIds). Instalaciones existentes tenían flujos que se veían
  // en todos los proyectos por igual — para que no "desaparezcan" al actualizar, los asociamos TODOS
  // a TODOS los proyectos existentes una sola vez. De acá en más, un flujo nuevo solo se asocia al
  // proyecto en el que se creó (ver createWorkflow en workflowStore.ts).
  useEffect(() => {
    if (useSettingsStore.getState().workflowAssociationMigrated) return;
    const allWorkflowIds = useWorkflowStore.getState().order;
    const ps = useProjectStore.getState();
    for (const [id, p] of Object.entries(ps.projects)) {
      const merged = [...new Set([...p.workflowIds, ...allWorkflowIds])];
      if (merged.length !== p.workflowIds.length) ps.updateProject(id, { workflowIds: merged });
    }
    useSettingsStore.getState().setWorkflowAssociationMigrated(true);
  }, []);

  // Skills: pasada del curator-lite (marca stale, 1 vez/día máx.) + proyección al disco para que
  // los agentes puedan leer los SKILL.md referenciados en el índice inyectado.
  useEffect(() => {
    const st = useSkillsStore.getState();
    st.curatorPass();
    const projectRoots: Record<string, string> = {};
    for (const [id, p] of Object.entries(useProjectStore.getState().projects)) projectRoots[id] = p.path;
    void syncSkillsToDisk(Object.values(st.skills), projectRoots);
  }, []);

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
      <PlannerRunner />
      <CommandPalette />
      <MobileCompanionRunner />
      <EditorWatcher />
      <McpBridgeRunner />
      <UpdateBanner />
      {!onboardingDone && <OnboardingModal />}
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

        {showRightPanel && <RightPanel />}
      </div>
    </div>
  );
}

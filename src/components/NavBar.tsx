import { useEffect, useRef, useState } from "react";
import { MessageSquare, GitBranch, Bot, Server, Settings, FileCode, PanelRight, Network, TerminalSquare, FolderKanban, Boxes, SquareTerminal, Users, ChevronsUpDown, Check, Plus } from "lucide-react";
import { useProjectStore } from "../store/projectStore";

export type ViewId = "chat" | "workflow" | "editor" | "map" | "projects" | "environments" | "terminals" | "team" | "agents" | "mcp" | "services" | "settings";

type NavItem = { id: ViewId; icon: typeof MessageSquare; label: string };

// El NavBar es project-centric: arriba un selector del proyecto activo, y debajo dos tiers.
// ── Tier "Proyecto": todo lo que opera sobre el proyecto activo y retargetea al cambiarlo
//    (código/mapa/servicios/ambientes ya siguen a projectPath; chat/terminales por ahora siguen el
//    cwd del proyecto activo). Cambiar el proyecto arriba cambia el contexto de todos estos.
const PROJECT_ITEMS: NavItem[] = [
  { id: "chat",         icon: MessageSquare,  label: "Chat" },
  { id: "editor",       icon: FileCode,       label: "Code" },
  { id: "terminals",    icon: SquareTerminal, label: "Terminals" },
  { id: "map",          icon: Network,        label: "Map" },
  { id: "services",     icon: TerminalSquare, label: "Services" },
  { id: "environments", icon: Boxes,          label: "Environments" },
];
// ── Tier "General": herramientas/bibliotecas transversales, no atadas a un proyecto (catálogo de
//    agentes, equipo de expertos, biblioteca de workflows, servidores MCP, ajustes de la app).
const GENERAL_ITEMS: NavItem[] = [
  { id: "team",     icon: Users,     label: "Team" },
  { id: "workflow", icon: GitBranch, label: "Workflows" },
  { id: "agents",   icon: Bot,       label: "Agents" },
  { id: "mcp",      icon: Server,    label: "MCP" },
  { id: "settings", icon: Settings,  label: "Settings" },
];

type Props = {
  active: ViewId;
  onChange: (v: ViewId) => void;
  chatDockOpen: boolean;
  onToggleChatDock: () => void;
};

export function NavBar({ active, onChange, chatDockOpen, onToggleChatDock }: Props) {
  const projects        = useProjectStore((s) => s.projects);
  const order           = useProjectStore((s) => s.order);
  const activeId        = useProjectStore((s) => s.activeId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const activeProject   = projects[activeId];

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar el popover de proyectos al clickear afuera.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const renderItem = ({ id, icon: Icon, label }: NavItem) => (
    <button
      key={id}
      className={`navbar-item${active === id ? " active" : ""}`}
      onClick={() => onChange(id)}
      title={label}
    >
      <Icon size={18} />
      <span className="navbar-label">{label}</span>
    </button>
  );

  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <span className="navbar-logo-icon">⬡</span>
      </div>

      {/* Selector de proyecto activo: es el "dónde estoy parado". Cambiarlo retargetea el tier Proyecto. */}
      <div className="navbar-project-wrap" ref={menuRef}>
        <button
          className={`navbar-project${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          title={activeProject ? `Project: ${activeProject.name}` : "Project"}
        >
          <FolderKanban size={16} />
          <span className="navbar-project-name">{activeProject?.name ?? "Project"}</span>
          <ChevronsUpDown size={11} className="navbar-project-caret" />
        </button>

        {menuOpen && (
          <div className="navbar-projmenu">
            <div className="navbar-projmenu-head">Projects</div>
            {order.map((id) => {
              const p = projects[id];
              if (!p) return null;
              return (
                <button
                  key={id}
                  className={`navbar-projmenu-item${id === activeId ? " active" : ""}`}
                  onClick={() => { setActiveProject(id); setMenuOpen(false); }}
                  title={p.path}
                >
                  <span className="navbar-projmenu-check">{id === activeId && <Check size={12} />}</span>
                  <span className="navbar-projmenu-info">
                    <span className="navbar-projmenu-name">{p.name}</span>
                    <span className="navbar-projmenu-path">{p.path}</span>
                  </span>
                </button>
              );
            })}
            <div className="navbar-projmenu-sep" />
            <button
              className="navbar-projmenu-manage"
              onClick={() => { onChange("projects"); setMenuOpen(false); }}
            >
              <Plus size={12} /> Manage projects…
            </button>
          </div>
        )}
      </div>

      <div className="navbar-items">
        <div className="navbar-section-label">Project</div>
        {PROJECT_ITEMS.map(renderItem)}

        <div className="navbar-section-label navbar-section-label--gap">General</div>
        {GENERAL_ITEMS.map(renderItem)}
      </div>

      {/* Toggle del chat lateral (dock). Solo tiene sentido fuera de la vista Chat, que ya es el
          chat a pantalla completa — es la MISMA instancia de ChatView reposicionada por CSS. */}
      {active !== "chat" && (
        <button
          className={`navbar-item navbar-chat-toggle${chatDockOpen ? " active" : ""}`}
          onClick={onToggleChatDock}
          title="Side chat"
        >
          <PanelRight size={18} />
          <span className="navbar-label">Chat</span>
        </button>
      )}
    </nav>
  );
}

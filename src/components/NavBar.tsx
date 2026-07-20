import { useEffect, useRef, useState } from "react";
import { MessageSquare, GitBranch, Bot, Server, Settings, FileCode, PanelRight, Network, TerminalSquare, FolderKanban, Boxes, SquareTerminal, Users, ChevronsUpDown, Check, Plus, Sparkles } from "lucide-react";
import { useProjectStore } from "../store/projectStore";

export type ViewId = "chat" | "workflow" | "editor" | "map" | "projects" | "environments" | "terminals" | "team" | "skills" | "agents" | "mcp" | "services" | "settings";

type NavItem = { id: ViewId; icon: typeof MessageSquare; label: string; hint?: string };
type NavGroup = { key: string; icon: typeof MessageSquare; label: string; items: NavItem[] };

// El NavBar es project-centric: arriba un selector del proyecto activo, debajo el rail.
// Solo dos vistas quedan pineadas sueltas (Chat: la que se abre primero siempre; Settings: convención
// universal, siempre última y sola). El resto se agrupa en 3 categorías por propósito, cada una
// desplegada como flyout — mismo popover ya usado para el selector de proyecto (navbar-projmenu).
const CHAT_ITEM: NavItem = { id: "chat", icon: MessageSquare, label: "Chat" };
const SETTINGS_ITEM: NavItem = { id: "settings", icon: Settings, label: "Settings" };

const GROUPS: NavGroup[] = [
  {
    key: "build", icon: FileCode, label: "Build",
    items: [
      { id: "editor",   icon: FileCode, label: "Code",      hint: "editor" },
      { id: "map",      icon: Network,  label: "Map",       hint: "codebase" },
      { id: "workflow", icon: GitBranch, label: "Workflows", hint: "automation" },
    ],
  },
  {
    key: "run", icon: SquareTerminal, label: "Run",
    items: [
      { id: "terminals",    icon: SquareTerminal, label: "Terminals",    hint: "shells" },
      { id: "services",     icon: TerminalSquare, label: "Services",     hint: "processes" },
      { id: "environments", icon: Boxes,          label: "Environments", hint: "worktrees" },
    ],
  },
  {
    key: "agents", icon: Users, label: "Agents",
    items: [
      { id: "team",   icon: Users,    label: "Team",          hint: "experts" },
      { id: "agents", icon: Bot,      label: "Agent catalog", hint: "config" },
      { id: "skills", icon: Sparkles, label: "Skills",        hint: "library" },
      { id: "mcp",    icon: Server,   label: "MCP servers",   hint: "tools" },
    ],
  },
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // Cerrar el popover de proyectos al clickear afuera.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Cerrar el flyout de categoría al clickear afuera de su botón+panel.
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".navbar-rail-group")) setOpenGroup(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openGroup]);

  const renderItem = ({ id, icon: Icon, label }: NavItem, extraClass = "") => (
    <button
      key={id}
      className={`navbar-item${active === id ? " active" : ""}${extraClass ? ` ${extraClass}` : ""}`}
      onClick={() => onChange(id)}
      title={label}
    >
      <Icon size={18} />
      <span className="navbar-label">{label}</span>
    </button>
  );

  const renderGroup = (g: NavGroup) => {
    const hasActive = g.items.some((it) => it.id === active);
    const isOpen = openGroup === g.key;
    return (
      <div className="navbar-rail-group" key={g.key}>
        <button
          className={`navbar-item navbar-item--group${isOpen ? " open" : ""}${hasActive ? " has-active" : ""}`}
          onClick={() => setOpenGroup((k) => (k === g.key ? null : g.key))}
          title={g.label}
        >
          <g.icon size={18} />
          <span className="navbar-label">{g.label}</span>
        </button>
        {isOpen && (
          <div className="navbar-flyout">
            <div className="navbar-flyout-head">{g.label}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                className={`navbar-flyout-item${active === it.id ? " active" : ""}`}
                onClick={() => { onChange(it.id); setOpenGroup(null); }}
              >
                <it.icon size={15} />
                <span className="fi-label">{it.label}</span>
                {it.hint && <span className="fi-hint">{it.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

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
        {renderItem(CHAT_ITEM)}
        {GROUPS.map(renderGroup)}
        {renderItem(SETTINGS_ITEM, "navbar-item--pinned-end")}
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

import { MessageSquare, GitBranch, Bot, Server, Settings, FileCode, PanelRight, Network, TerminalSquare, FolderKanban, Boxes } from "lucide-react";

export type ViewId = "chat" | "workflow" | "editor" | "map" | "projects" | "environments" | "agents" | "mcp" | "services" | "settings";

const NAV_ITEMS: { id: ViewId; icon: typeof MessageSquare; label: string }[] = [
  { id: "chat",     icon: MessageSquare,  label: "Chat" },
  { id: "workflow", icon: GitBranch,      label: "Workflows" },
  { id: "editor",   icon: FileCode,       label: "Código" },
  { id: "map",      icon: Network,        label: "Mapa" },
  { id: "projects", icon: FolderKanban,   label: "Proyectos" },
  { id: "environments", icon: Boxes,      label: "Ambientes" },
  { id: "services", icon: TerminalSquare, label: "Servicios" },
  { id: "agents",   icon: Bot,            label: "Agents" },
  { id: "mcp",      icon: Server,         label: "MCP" },
  { id: "settings", icon: Settings,       label: "Settings" },
];

type Props = {
  active: ViewId;
  onChange: (v: ViewId) => void;
  chatDockOpen: boolean;
  onToggleChatDock: () => void;
};

export function NavBar({ active, onChange, chatDockOpen, onToggleChatDock }: Props) {
  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <span className="navbar-logo-icon">⬡</span>
      </div>
      <div className="navbar-items">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`navbar-item${active === id ? " active" : ""}`}
            onClick={() => onChange(id)}
            title={label}
          >
            <Icon size={18} />
            <span className="navbar-label">{label}</span>
          </button>
        ))}
      </div>
      {/* Toggle del chat lateral (dock). Solo tiene sentido fuera de la vista Chat, que ya es el
          chat a pantalla completa — es la MISMA instancia de ChatView reposicionada por CSS. */}
      {active !== "chat" && (
        <button
          className={`navbar-item navbar-chat-toggle${chatDockOpen ? " active" : ""}`}
          onClick={onToggleChatDock}
          title="Chat lateral"
        >
          <PanelRight size={18} />
          <span className="navbar-label">Chat</span>
        </button>
      )}
    </nav>
  );
}

import { MessageSquare, GitBranch, Bot, Server, Settings } from "lucide-react";

export type ViewId = "chat" | "workflow" | "agents" | "mcp" | "settings";

const NAV_ITEMS: { id: ViewId; icon: typeof MessageSquare; label: string }[] = [
  { id: "chat",     icon: MessageSquare, label: "Chat" },
  { id: "workflow", icon: GitBranch,     label: "Workflows" },
  { id: "agents",   icon: Bot,           label: "Agents" },
  { id: "mcp",      icon: Server,        label: "MCP" },
  { id: "settings", icon: Settings,      label: "Settings" },
];

type Props = { active: ViewId; onChange: (v: ViewId) => void };

export function NavBar({ active, onChange }: Props) {
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
    </nav>
  );
}

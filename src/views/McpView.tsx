import { useState, useEffect, useCallback } from "react";
import {
  Server, Plus, Play, Square, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Circle, Terminal, Globe,
  Database, Search, GitBranch, FileCode, Globe2, Hash,
  ChevronRight, ChevronDown, Copy, ExternalLink, MonitorDot, ScanSearch, MessagesSquare,
} from "lucide-react";
import { isTauri, checkPrerequisites, hermesPath } from "../lib/tauriApi";
import { readMcpServers, setMcpServer, removeMcpServer } from "../lib/mcpConfig";
import { useProjectStore } from "../store/projectStore";
import * as opencodeClient from "../lib/opencodeClient";

/* ── Types ─────────────────────────────────────────────── */
type McpTool     = { name: string; description: string };
type McpResource = { uri: string; name: string };

type McpServer = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  transport: "stdio" | "http" | "sse";
  command?: string;
  url?: string;
  env?: Record<string, string>;
  status: "running" | "stopped" | "error" | "connecting";
  lastError?: string;
  tools: McpTool[];
  resources?: McpResource[];
  version?: string;
  official?: boolean;
};

type Prereqs = { node: boolean; npx: boolean; uvx: boolean; uv: boolean };

/* ── Catalog ────────────────────────────────────────────── */
const CATALOG: McpServer[] = [
  {
    id: "filesystem", name: "Filesystem", transport: "stdio", official: true, version: "1.0.4",
    description: "Reads and writes files on the system. Lets the agent access, create and modify local files.",
    icon: <FileCode size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-filesystem .",
    tools: [
      { name: "read_file",       description: "Reads the full content of a file" },
      { name: "write_file",      description: "Creates or overwrites a file" },
      { name: "list_directory",  description: "Lists the contents of a directory" },
      { name: "search_files",    description: "Searches files by glob pattern" },
      { name: "get_file_info",   description: "Gets a file's metadata" },
    ],
    resources: [{ uri: "file://.", name: "Current directory" }],
  },
  {
    id: "code-index", name: "Code Index", transport: "stdio", official: false, version: "0.6.0",
    description: "Indexes the project's code structurally (symbols, functions, imports — no embeddings or external API) and lets the agent search code and files in natural language. Ideal for large projects.",
    icon: <ScanSearch size={16} />, status: "stopped",
    command: "uvx code-index-mcp",
    tools: [
      { name: "set_project_path",  description: "Sets the base folder to index" },
      { name: "search_code",       description: "Searches patterns/symbols in the indexed code" },
      { name: "find_files",        description: "Finds files by glob pattern" },
      { name: "get_file_summary",  description: "Summarizes a file: functions, imports, lines" },
      { name: "refresh_index",     description: "Rebuilds the project index" },
    ],
  },
  {
    id: "git", name: "Git", transport: "stdio", official: true, version: "0.6.2",
    description: "Commits, branches, diffs, logs. Lets the agent manage the repository.",
    icon: <GitBranch size={16} />, status: "stopped",
    command: "uvx mcp-server-git --repository .",
    tools: [
      { name: "git_status",  description: "Shows the repository status" },
      { name: "git_diff",    description: "Shows differences between commits" },
      { name: "git_commit",  description: "Creates a commit with a message" },
      { name: "git_log",     description: "Lists the commit history" },
      { name: "git_branch",  description: "Lists, creates or switches branches" },
      { name: "git_add",     description: "Stages files" },
    ],
  },
  {
    id: "brave-search", name: "Brave Search", transport: "stdio", official: true, version: "0.6.2",
    description: "Real-time web search using the Brave API. No tracking.",
    icon: <Search size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-brave-search",
    env: { BRAVE_API_KEY: "" },
    tools: [
      { name: "brave_web_search",   description: "Web search with paginated results" },
      { name: "brave_local_search", description: "Search for local businesses and places" },
    ],
  },
  {
    id: "puppeteer", name: "Puppeteer", transport: "stdio", official: true, version: "0.6.2",
    description: "Browser automation: navigate URLs, take screenshots, extract content.",
    icon: <Globe2 size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-puppeteer",
    tools: [
      { name: "puppeteer_navigate",   description: "Navigates to a URL" },
      { name: "puppeteer_screenshot", description: "Captures a screenshot of the page" },
      { name: "puppeteer_click",      description: "Clicks an element" },
      { name: "puppeteer_fill",       description: "Fills a form field" },
      { name: "puppeteer_evaluate",   description: "Runs JavaScript in the browser" },
    ],
  },
  {
    id: "postgres", name: "PostgreSQL", transport: "stdio", official: true, version: "0.6.2",
    description: "Read-only access to PostgreSQL databases.",
    icon: <Database size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-postgres",
    env: { POSTGRES_CONNECTION_STRING: "postgresql://user:pass@localhost/db" },
    tools: [
      { name: "query",          description: "Runs a read-only SQL query" },
      { name: "list_tables",    description: "Lists all tables in the schema" },
      { name: "describe_table", description: "Shows a table's structure" },
    ],
  },
  {
    id: "fetch", name: "Fetch", transport: "stdio", official: true, version: "1.1.6",
    description: "Makes HTTP requests and converts web pages to markdown.",
    icon: <Globe size={16} />, status: "stopped",
    command: "uvx mcp-server-fetch",
    tools: [{ name: "fetch", description: "Fetches a URL and returns its content as markdown" }],
  },
  {
    id: "slack", name: "Slack", transport: "stdio", official: true, version: "0.6.2",
    description: "Reads messages, lists channels and sends notifications to Slack.",
    icon: <Hash size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-slack",
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    tools: [
      { name: "slack_list_channels",       description: "Lists workspace channels" },
      { name: "slack_post_message",        description: "Sends a message to a channel" },
      { name: "slack_get_channel_history", description: "Reads a channel's history" },
    ],
  },
  {
    id: "warp", name: "Warp Terminal", transport: "stdio", official: false,
    description: "Warp integration — run commands with an AI-powered terminal.",
    icon: <Terminal size={16} />, status: "stopped",
    command: "warp-mcp-server",
    tools: [
      { name: "run_command", description: "Runs a command in the Warp terminal" },
      { name: "get_output",  description: "Gets the output of the last command" },
    ],
  },
  {
    // Hermes reubicado como INFRAESTRUCTURA (no como agente de chat, ver investigación MiMo×Hermes):
    // `hermes mcp serve` expone las conversaciones/inbox multi-plataforma de Hermes como tools MCP, así
    // el agente de código puede leer/responder mensajes de WhatsApp/Slack/Telegram/etc. Requiere
    // Hermes instalado (ruta absoluta a esta máquina, mismo criterio que providers.ts). Sus tools de
    // browser/visión/computer-use NO se exponen por acá (viven dentro del agent loop de Hermes).
    id: "hermes-messaging", name: "Hermes · Messaging", transport: "stdio", official: false, version: "0.17",
    description: "Gives your coding agent access to Hermes' multi-platform inbox (WhatsApp, Slack, Telegram…): list conversations, read/send messages, attachments and events. Requires Hermes installed.",
    icon: <MessagesSquare size={16} />, status: "stopped",
    // Ruta resuelta en runtime (ver efecto en McpView: hermes_path detecta el binario). Fallback por PATH.
    command: "hermes mcp serve",
    tools: [
      { name: "conversations_list", description: "Lists active conversations across all connected platforms" },
      { name: "conversation_get",   description: "Details of a conversation by its session key" },
      { name: "messages_read",      description: "Reads the recent messages of a conversation" },
      { name: "messages_send",      description: "Sends a message to a conversation (platform:chat_id)" },
      { name: "channels_list",      description: "Lists available channels/targets on each platform" },
      { name: "attachments_fetch",  description: "Gets the attachments (images/media) of a message" },
      { name: "events_poll",        description: "Polls for new conversation events since a cursor" },
    ],
  },
];

/* ── Status badge ───────────────────────────────────────── */
function StatusBadge({ status }: { status: McpServer["status"] }) {
  const map = {
    running:    { icon: <CheckCircle size={10} />, label: "Running",     cls: "status-running" },
    stopped:    { icon: <Circle      size={10} />, label: "Stopped",     cls: "status-stopped" },
    error:      { icon: <AlertCircle size={10} />, label: "Error",       cls: "status-error"   },
    connecting: { icon: <RefreshCw   size={10} className="spin" />, label: "Connecting", cls: "status-connecting" },
  };
  const { icon, label, cls } = map[status];
  return <span className={`mcp-status-badge ${cls}`}>{icon}{label}</span>;
}

/* ── Prereqs banner ─────────────────────────────────────── */
function PrereqsBanner({ prereqs }: { prereqs: Prereqs | null }) {
  if (!prereqs) return null;
  const missing = Object.entries(prereqs).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length === 0) return null;
  return (
    <div className="mcp-prereqs-banner">
      <AlertCircle size={13} />
      <span>
        Missing dependencies: <strong>{missing.join(", ")}</strong>.
        Install Node.js and/or <code>uv</code> to run the servers.
      </span>
    </div>
  );
}

/* ── Tool row ───────────────────────────────────────────── */
function ToolRow({ tool }: { tool: McpTool }) {
  return (
    <div className="mcp-tool-row">
      <code className="mcp-tool-name">{tool.name}</code>
      <span className="mcp-tool-desc">{tool.description}</span>
    </div>
  );
}

/* ── Server detail ──────────────────────────────────────── */
function ServerDetail({ server, onToggle, onRemove }: {
  server: McpServer;
  onToggle: (envVals: Record<string, string>) => void;
  onRemove: () => void;
}) {
  const [showEnv, setShowEnv] = useState(false);
  const [envVals, setEnvVals] = useState<Record<string, string>>(server.env ?? {});
  const [copied, setCopied]   = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mcp-detail">
      <div className="mcp-detail-header">
        <div className="mcp-detail-icon">{server.icon}</div>
        <div className="mcp-detail-info">
          <div className="mcp-detail-name">
            {server.name}
            {server.official && <span className="mcp-official-badge">official</span>}
          </div>
          <StatusBadge status={server.status} />
        </div>
        <div className="mcp-detail-actions">
          <button
            className={`mcp-action-btn ${server.status === "running" ? "stop" : "start"}`}
            onClick={() => onToggle(envVals)}
            disabled={server.status === "connecting"}
          >
            {server.status === "connecting" ? <><RefreshCw size={12} className="spin" /> Connecting...</> :
             server.status === "running"     ? <><Square size={12} /> Stop</> :
                                              <><Play size={12} /> Start</>}
          </button>
          <button className="mcp-action-btn danger" onClick={onRemove}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {server.lastError && (
        <div className="mcp-error-box">
          <AlertCircle size={12} />
          <span>{server.lastError}</span>
        </div>
      )}

      <p className="mcp-detail-desc">{server.description}</p>

      <div className="mcp-section">
        <div className="mcp-section-label">Transport</div>
        <code className="mcp-transport-badge">{server.transport}</code>
        {server.version && <code className="mcp-transport-badge">v{server.version}</code>}
      </div>

      {server.command && (
        <div className="mcp-section">
          <div className="mcp-section-label">Command</div>
          <div className="mcp-command-row">
            <code className="mcp-command">{server.command}</code>
            <button className="mcp-copy-btn" onClick={() => copy(server.command!)}>
              {copied ? <CheckCircle size={11} color="#4ade80" /> : <Copy size={11} />}
            </button>
          </div>
        </div>
      )}

      {server.env && Object.keys(server.env).length > 0 && (
        <div className="mcp-section">
          <button className="mcp-env-toggle" onClick={() => setShowEnv((v) => !v)}>
            {showEnv ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Environment variables ({Object.keys(server.env).length})
          </button>
          {showEnv && (
            <div className="mcp-env-list">
              {Object.entries(envVals).map(([k, v]) => (
                <div key={k} className="mcp-env-row">
                  <code className="mcp-env-key">{k}</code>
                  <input
                    type="password"
                    className="mcp-env-input"
                    value={v}
                    placeholder="value..."
                    onChange={(e) => setEnvVals((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mcp-section">
        <div className="mcp-section-label">Tools ({server.tools.length})</div>
        <div className="mcp-tools-list">
          {server.tools.map((t) => <ToolRow key={t.name} tool={t} />)}
        </div>
      </div>

      {server.resources && server.resources.length > 0 && (
        <div className="mcp-section">
          <div className="mcp-section-label">Resources</div>
          <div className="mcp-tools-list">
            {server.resources.map((r) => (
              <div key={r.uri} className="mcp-tool-row">
                <code className="mcp-tool-name">{r.name}</code>
                <span className="mcp-tool-desc">{r.uri}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add server modal ───────────────────────────────────── */
function AddServerModal({ onClose, onAdd }: { onClose: () => void; onAdd: (s: McpServer) => void }) {
  const [name, setName]           = useState("");
  const [command, setCommand]     = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: Math.random().toString(36).slice(2),
      name: name.trim(),
      description: "Custom MCP server",
      icon: <Server size={16} />,
      transport,
      command: command.trim() || undefined,
      status: "stopped",
      tools: [],
      official: false,
    });
    onClose();
  };

  return (
    <div className="mcp-modal-overlay" onClick={onClose}>
      <div className="mcp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-modal-header">
          <span className="mcp-modal-title">Add MCP server</span>
          <button className="fw-btn" onClick={onClose}>
            <Plus size={13} style={{ transform: "rotate(45deg)" }} />
          </button>
        </div>
        <div className="mcp-modal-body">
          <div className="mcp-field">
            <label className="mcp-field-label">Name</label>
            <input className="mcp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My MCP server" autoFocus />
          </div>
          <div className="mcp-field">
            <label className="mcp-field-label">Transport</label>
            <div className="mcp-radio-group">
              {(["stdio", "http"] as const).map((t) => (
                <label key={t} className={`mcp-radio${transport === t ? " active" : ""}`}>
                  <input type="radio" value={t} checked={transport === t} onChange={() => setTransport(t)} />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="mcp-field">
            <label className="mcp-field-label">{transport === "stdio" ? "Command" : "URL"}</label>
            <input
              className="mcp-input mcp-input-mono"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={transport === "stdio" ? "npx -y @modelcontextprotocol/server-..." : "http://localhost:3000"}
            />
          </div>
        </div>
        <div className="mcp-modal-footer">
          <button className="mcp-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="mcp-btn-add" onClick={handleAdd} disabled={!name.trim()}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main view ──────────────────────────────────────────── */
export function McpView() {
  const [servers, setServers]   = useState<McpServer[]>(CATALOG);
  const [selected, setSelected] = useState<string>(CATALOG[0].id);
  const [showAdd, setShowAdd]   = useState(false);
  const [prereqs, setPrereqs]   = useState<Prereqs | null>(null);
  const inTauri = isTauri();
  const projectPath = useProjectStore((s) => s.projectPath);

  // On mount / cambio de proyecto: refleja qué servers están habilitados en opencode.json (la fuente
  // de verdad que lee DevFlow Code) + chequea prereqs. "running" acá = habilitado en la config del
  // agente, no un proceso que spawnee DevFlow (el propio server de OpenCode lo lanza al abrir sesión).
  useEffect(() => {
    if (!inTauri) return;
    readMcpServers(projectPath).then((cfg) => {
      setServers((prev) => prev.map((s) => ({
        ...s,
        status: cfg[s.id]?.enabled ? "running" : "stopped",
      })));
    }).catch(() => {});
    checkPrerequisites().then(setPrereqs).catch(() => {});
    // Hermes: resolver la ruta del binario en runtime. Si está instalado, completar el command con la
    // ruta absoluta detectada; si no, quitar la entrada (no ofrecer un server que no puede arrancar).
    hermesPath().then((hp) => {
      setServers((prev) =>
        hp
          ? prev.map((s) => (s.id === "hermes-messaging" ? { ...s, command: `${hp} mcp serve` } : s))
          : prev.filter((s) => s.id !== "hermes-messaging")
      );
    }).catch(() => {});
  }, [inTauri, projectPath]);

  const setServerStatus = useCallback((id: string, status: McpServer["status"], err?: string) => {
    setServers((prev) => prev.map((s) =>
      s.id === id ? { ...s, status, lastError: err } : s
    ));
  }, []);

  const toggleServer = useCallback(async (id: string, envVals: Record<string, string>) => {
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    if (!inTauri) {
      // Browser mode: just toggle UI and show hint
      setServerStatus(id, server.status === "running" ? "stopped" : "running",
        server.status === "stopped"
          ? "Simulated — run 'npm run tauri dev' to write a real opencode.json"
          : undefined
      );
      return;
    }
    if (!server.command) {
      setServerStatus(id, "error", "This server has no command configured");
      return;
    }

    const enabling = server.status !== "running";
    setServerStatus(id, "connecting");
    try {
      // Escribe/actualiza la entrada en opencode.json (habilitada o no). El comando del catálogo es
      // un string tipo "uvx code-index-mcp" → lo pasamos como array de argumentos.
      await setMcpServer(projectPath, id, server.command.split(/\s+/).filter(Boolean), envVals, enabling);
      // DevFlow Code lee opencode.json al arrancar su server; lo reiniciamos (best-effort, mismo
      // patrón que AddModelModal/opencodeAgents) para que la próxima sesión tome el cambio.
      await opencodeClient.restart("opencode").catch(() => {});
      setServerStatus(id, enabling ? "running" : "stopped");
    } catch (e) {
      setServerStatus(id, "error", String(e));
    }
  }, [servers, inTauri, projectPath, setServerStatus]);

  const removeServer = (id: string) => {
    removeMcpServer(projectPath, id).catch(() => {});
    opencodeClient.restart("opencode").catch(() => {});
    setServers((prev) => prev.filter((s) => s.id !== id));
    if (selected === id) setSelected(servers.find((s) => s.id !== id)?.id ?? "");
  };

  const addServer = (s: McpServer) => {
    setServers((prev) => [...prev, s]);
    setSelected(s.id);
  };

  const selectedServer = servers.find((s) => s.id === selected);
  const running = servers.filter((s) => s.status === "running").length;

  return (
    <div className="mcp-view">
      <aside className="mcp-list">
        <div className="mcp-list-header">
          <div className="mcp-list-title">
            <Server size={13} /> MCP Servers
            {running > 0 && <span className="mcp-run-count">{running} active</span>}
          </div>
          <button className="mcp-add-btn" onClick={() => setShowAdd(true)} title="Add">
            <Plus size={14} />
          </button>
        </div>

        {/* Tauri mode banner */}
        {!inTauri && (
          <div className="mcp-mode-banner">
            <MonitorDot size={11} />
            <span>Preview mode. Run <code>npm run tauri dev</code> for real processes.</span>
          </div>
        )}

        <PrereqsBanner prereqs={prereqs} />

        <div className="mcp-list-items">
          {servers.map((s) => (
            <div
              key={s.id}
              className={`mcp-list-item${s.id === selected ? " active" : ""}`}
              onClick={() => setSelected(s.id)}
            >
              <div className={`mcp-list-indicator ${s.status === "running" ? "on" : s.status === "error" ? "err" : "off"}`} />
              <div className="mcp-list-icon">{s.icon}</div>
              <div className="mcp-list-info">
                <div className="mcp-list-name">{s.name}</div>
                <div className="mcp-list-meta">{s.tools.length} tools · {s.transport}</div>
              </div>
              <button
                className={`mcp-list-toggle ${s.status === "running" ? "stop" : "start"}`}
                onClick={(e) => { e.stopPropagation(); toggleServer(s.id, s.env ?? {}); }}
                disabled={s.status === "connecting"}
                title={s.status === "running" ? "Stop" : "Start"}
              >
                {s.status === "connecting" ? <RefreshCw size={10} className="spin" /> :
                 s.status === "running"    ? <Square size={10} /> : <Play size={10} />}
              </button>
            </div>
          ))}
        </div>

        <div className="mcp-docs-link">
          <ExternalLink size={11} />
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">
            MCP docs
          </a>
        </div>
      </aside>

      <div className="mcp-detail-area">
        {selectedServer ? (
          <ServerDetail
            server={selectedServer}
            onToggle={(envVals) => toggleServer(selectedServer.id, envVals)}
            onRemove={() => removeServer(selectedServer.id)}
          />
        ) : (
          <div className="mcp-empty">
            <Server size={40} opacity={0.15} />
            <p>Select a server to see its configuration.</p>
          </div>
        )}
      </div>

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} onAdd={addServer} />}
    </div>
  );
}

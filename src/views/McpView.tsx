import { useState, useEffect, useCallback } from "react";
import {
  Server, Plus, Play, Square, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Circle, Terminal, Globe,
  Database, Search, GitBranch, FileCode, Globe2, Hash,
  ChevronRight, ChevronDown, Copy, ExternalLink, MonitorDot,
} from "lucide-react";
import {
  isTauri, startMcpServer, stopMcpServer,
  getRunningServers, checkPrerequisites,
} from "../lib/tauriApi";

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
    description: "Lee y escribe archivos del sistema. Permite al agente acceder, crear y modificar archivos locales.",
    icon: <FileCode size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-filesystem .",
    tools: [
      { name: "read_file",       description: "Lee el contenido completo de un archivo" },
      { name: "write_file",      description: "Crea o sobreescribe un archivo" },
      { name: "list_directory",  description: "Lista el contenido de un directorio" },
      { name: "search_files",    description: "Busca archivos por patrón glob" },
      { name: "get_file_info",   description: "Obtiene metadata de un archivo" },
    ],
    resources: [{ uri: "file://.", name: "Directorio actual" }],
  },
  {
    id: "git", name: "Git", transport: "stdio", official: true, version: "0.6.2",
    description: "Commits, branches, diffs, logs. Permite al agente gestionar el repositorio.",
    icon: <GitBranch size={16} />, status: "stopped",
    command: "uvx mcp-server-git --repository .",
    tools: [
      { name: "git_status",  description: "Muestra el estado del repositorio" },
      { name: "git_diff",    description: "Muestra diferencias entre commits" },
      { name: "git_commit",  description: "Crea un commit con mensaje" },
      { name: "git_log",     description: "Lista el historial de commits" },
      { name: "git_branch",  description: "Lista, crea o cambia de branch" },
      { name: "git_add",     description: "Agrega archivos al staging" },
    ],
  },
  {
    id: "brave-search", name: "Brave Search", transport: "stdio", official: true, version: "0.6.2",
    description: "Búsqueda web en tiempo real usando la API de Brave. Sin rastreo.",
    icon: <Search size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-brave-search",
    env: { BRAVE_API_KEY: "" },
    tools: [
      { name: "brave_web_search",   description: "Búsqueda web con resultados paginados" },
      { name: "brave_local_search", description: "Búsqueda de negocios y lugares locales" },
    ],
  },
  {
    id: "puppeteer", name: "Puppeteer", transport: "stdio", official: true, version: "0.6.2",
    description: "Automatización de navegador: navega URLs, hace screenshots, extrae contenido.",
    icon: <Globe2 size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-puppeteer",
    tools: [
      { name: "puppeteer_navigate",   description: "Navega a una URL" },
      { name: "puppeteer_screenshot", description: "Captura pantalla de la página" },
      { name: "puppeteer_click",      description: "Hace click en un elemento" },
      { name: "puppeteer_fill",       description: "Rellena un campo de formulario" },
      { name: "puppeteer_evaluate",   description: "Ejecuta JavaScript en el navegador" },
    ],
  },
  {
    id: "postgres", name: "PostgreSQL", transport: "stdio", official: true, version: "0.6.2",
    description: "Acceso de solo lectura a bases de datos PostgreSQL.",
    icon: <Database size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-postgres",
    env: { POSTGRES_CONNECTION_STRING: "postgresql://user:pass@localhost/db" },
    tools: [
      { name: "query",          description: "Ejecuta un query SQL de solo lectura" },
      { name: "list_tables",    description: "Lista todas las tablas del schema" },
      { name: "describe_table", description: "Muestra la estructura de una tabla" },
    ],
  },
  {
    id: "fetch", name: "Fetch", transport: "stdio", official: true, version: "1.1.6",
    description: "Hace requests HTTP y convierte páginas web a markdown.",
    icon: <Globe size={16} />, status: "stopped",
    command: "uvx mcp-server-fetch",
    tools: [{ name: "fetch", description: "Obtiene una URL y devuelve su contenido en markdown" }],
  },
  {
    id: "slack", name: "Slack", transport: "stdio", official: true, version: "0.6.2",
    description: "Lee mensajes, lista canales y envía notificaciones a Slack.",
    icon: <Hash size={16} />, status: "stopped",
    command: "npx -y @modelcontextprotocol/server-slack",
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    tools: [
      { name: "slack_list_channels",       description: "Lista canales del workspace" },
      { name: "slack_post_message",        description: "Envía un mensaje a un canal" },
      { name: "slack_get_channel_history", description: "Lee el historial de un canal" },
    ],
  },
  {
    id: "warp", name: "Warp Terminal", transport: "stdio", official: false,
    description: "Integración con Warp — ejecuta comandos con terminal potenciado por IA.",
    icon: <Terminal size={16} />, status: "stopped",
    command: "warp-mcp-server",
    tools: [
      { name: "run_command", description: "Ejecuta un comando en Warp terminal" },
      { name: "get_output",  description: "Obtiene el output del último comando" },
    ],
  },
];

/* ── Status badge ───────────────────────────────────────── */
function StatusBadge({ status }: { status: McpServer["status"] }) {
  const map = {
    running:    { icon: <CheckCircle size={10} />, label: "Running",     cls: "status-running" },
    stopped:    { icon: <Circle      size={10} />, label: "Stopped",     cls: "status-stopped" },
    error:      { icon: <AlertCircle size={10} />, label: "Error",       cls: "status-error"   },
    connecting: { icon: <RefreshCw   size={10} className="spin" />, label: "Conectando", cls: "status-connecting" },
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
        Faltan dependencias: <strong>{missing.join(", ")}</strong>.
        Instalá Node.js y/o <code>uv</code> para poder ejecutar los servidores.
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
            {server.official && <span className="mcp-official-badge">oficial</span>}
          </div>
          <StatusBadge status={server.status} />
        </div>
        <div className="mcp-detail-actions">
          <button
            className={`mcp-action-btn ${server.status === "running" ? "stop" : "start"}`}
            onClick={() => onToggle(envVals)}
            disabled={server.status === "connecting"}
          >
            {server.status === "connecting" ? <><RefreshCw size={12} className="spin" /> Conectando...</> :
             server.status === "running"     ? <><Square size={12} /> Detener</> :
                                              <><Play size={12} /> Iniciar</>}
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
          <div className="mcp-section-label">Comando</div>
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
            Variables de entorno ({Object.keys(server.env).length})
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
                    placeholder="valor..."
                    onChange={(e) => setEnvVals((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mcp-section">
        <div className="mcp-section-label">Herramientas ({server.tools.length})</div>
        <div className="mcp-tools-list">
          {server.tools.map((t) => <ToolRow key={t.name} tool={t} />)}
        </div>
      </div>

      {server.resources && server.resources.length > 0 && (
        <div className="mcp-section">
          <div className="mcp-section-label">Recursos</div>
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
      description: "Servidor MCP personalizado",
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
          <span className="mcp-modal-title">Agregar servidor MCP</span>
          <button className="fw-btn" onClick={onClose}>
            <Plus size={13} style={{ transform: "rotate(45deg)" }} />
          </button>
        </div>
        <div className="mcp-modal-body">
          <div className="mcp-field">
            <label className="mcp-field-label">Nombre</label>
            <input className="mcp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi servidor MCP" autoFocus />
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
            <label className="mcp-field-label">{transport === "stdio" ? "Comando" : "URL"}</label>
            <input
              className="mcp-input mcp-input-mono"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={transport === "stdio" ? "npx -y @modelcontextprotocol/server-..." : "http://localhost:3000"}
            />
          </div>
        </div>
        <div className="mcp-modal-footer">
          <button className="mcp-btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="mcp-btn-add" onClick={handleAdd} disabled={!name.trim()}>
            <Plus size={13} /> Agregar
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

  // On mount: sync running servers from Tauri backend + check prereqs
  useEffect(() => {
    if (!inTauri) return;
    getRunningServers().then((running) => {
      setServers((prev) => prev.map((s) => ({
        ...s,
        status: running.includes(s.id) ? "running" : "stopped",
      })));
    });
    checkPrerequisites().then(setPrereqs).catch(() => {});
  }, [inTauri]);

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
          ? "Simulado — ejecutá 'npm run tauri dev' para iniciar procesos reales"
          : undefined
      );
      return;
    }

    if (server.status === "running") {
      setServerStatus(id, "connecting");
      try {
        await stopMcpServer(id);
        setServerStatus(id, "stopped");
      } catch (e) {
        setServerStatus(id, "error", String(e));
      }
    } else {
      if (!server.command) return;
      setServerStatus(id, "connecting");
      try {
        await startMcpServer(id, server.command, envVals);
        setServerStatus(id, "running");
      } catch (e) {
        setServerStatus(id, "error", String(e));
      }
    }
  }, [servers, inTauri, setServerStatus]);

  const removeServer = (id: string) => {
    if (servers.find((s) => s.id === id)?.status === "running") {
      stopMcpServer(id).catch(() => {});
    }
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
            {running > 0 && <span className="mcp-run-count">{running} activos</span>}
          </div>
          <button className="mcp-add-btn" onClick={() => setShowAdd(true)} title="Agregar">
            <Plus size={14} />
          </button>
        </div>

        {/* Tauri mode banner */}
        {!inTauri && (
          <div className="mcp-mode-banner">
            <MonitorDot size={11} />
            <span>Modo preview. Ejecutá <code>npm run tauri dev</code> para procesos reales.</span>
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
                title={s.status === "running" ? "Detener" : "Iniciar"}
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
            Docs MCP
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
            <p>Seleccioná un servidor para ver su configuración.</p>
          </div>
        )}
      </div>

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} onAdd={addServer} />}
    </div>
  );
}

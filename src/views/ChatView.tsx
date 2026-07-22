import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, X, Send, Square, Terminal, ChevronDown, CheckCircle, Loader, Circle, ShieldAlert, XCircle, Mic, FileText, Folder, FileCode, GitBranch } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useEditorStore } from "../store/editorStore";
import { useAgentsStore, isDefaultAgent } from "../store/agentsStore";
import { useMetricsStore } from "../store/metricsStore";
import { useWorkspaceStore, type DocBlockData, type Step, type ToolContentItem, type ToolBlockData } from "../store/workspaceStore";
import { DEFAULT_PROVIDERS, isExpertAgent } from "../lib/providers";
import * as acpClient from "../lib/acpClient";
import * as opencodeClient from "../lib/opencodeClient";
import { economyActive, ECONOMY_EDITOR_MAX_LINES, AUTO_MODEL, classifyTask, pickModel } from "../lib/modelRouter";
import { readTextFile } from "../lib/tauriApi";
import { useProjectStore } from "../store/projectStore";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";

// Referencia estable para el selector de settingsStore (evita re-render por array nuevo en cada llamada).
const EMPTY_MODELS: acpClient.ModelOption[] = [];
import { useWorkflowStore } from "../store/workflowStore";
import { runWorkflow } from "../lib/workflowEngine";
import { TerminalPane } from "../components/TerminalPane";
import { AddModelModal } from "../components/AddModelModal";
import { useSkillsStore } from "../store/skillsStore";
import { buildSkillsPreamble, detectSkillUse, skillsRoot } from "../lib/skills";
import { maybeMineWorkspace } from "../lib/skillMiner";

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const makeId = () => Math.random().toString(36).slice(2);

function extractChunkText(update: Record<string, unknown>): string {
  const content = update.content as any;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text" && typeof content.text === "string") return content.text;
  return "";
}

function mapToolStatus(status?: string): Step["status"] {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  if (status === "in_progress") return "running";
  return "pending";
}

function mapContentItem(c: any): ToolContentItem {
  if (c?.type === "diff") return { type: "diff", path: c.path, oldText: c.oldText, newText: c.newText };
  if (c?.type === "content" && c.content?.type === "text") return { type: "text", text: c.content.text };
  if (typeof c === "string") return { type: "text", text: c };
  return { type: "raw", data: c };
}

/* ── Step icon ──────────────────────────────────────────── */
function StepIcon({ status }: { status: Step["status"] }) {
  if (status === "done")    return <CheckCircle size={11} color="#4ade80" />;
  if (status === "failed")  return <XCircle     size={11} color="#f85149" />;
  if (status === "running") return <Loader      size={11} color="#38bdf8" className="spin" />;
  return <Circle size={11} color="#3d4451" />;
}

/* ── Permission prompt ───────────────────────────────────── */
function PermissionPrompt({
  request,
  onResolve,
}: {
  request: acpClient.PermissionRequest;
  onResolve: (optionId: string) => void;
}) {
  const tc = request.toolCall ?? {};
  const title = (tc.title as string) ?? (tc.kind as string) ?? "Agent action";
  const content = Array.isArray(tc.content) ? (tc.content as any[]) : [];

  return (
    <div className="permission-overlay">
      <div className="permission-card">
        <div className="permission-card-title">
          <ShieldAlert size={14} color="#fbbf24" />
          <span>The agent is asking for permission to continue</span>
        </div>
        <div className="permission-card-tool">{title}</div>
        {content.map((c, i) => (
          <div key={i} className="permission-card-content">
            {c?.type === "diff" ? (
              <>
                {c.path && <div className="permission-card-path">{c.path}</div>}
                <pre>{c.newText ?? c.content ?? ""}</pre>
              </>
            ) : (
              <pre>{typeof c === "string" ? c : JSON.stringify(c, null, 2)}</pre>
            )}
          </div>
        ))}
        <div className="permission-card-actions">
          {request.options.map((o) => (
            <button
              key={o.optionId}
              className={`permission-btn${o.kind?.startsWith("allow") ? " permission-btn--allow" : o.kind?.startsWith("reject") ? " permission-btn--reject" : ""}`}
              onClick={() => onResolve(o.optionId)}
            >
              {o.name ?? o.optionId}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Tool call card (diff / output real de una acción del agente) ──── */
function DiffView({ path, oldText, newText }: { path?: string; oldText?: string; newText?: string }) {
  const isNewFile = !oldText;
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = (newText ?? "").split("\n");
  return (
    <div className="tool-diff">
      {path && <div className="tool-diff-path">{path}</div>}
      <pre className="tool-diff-body">
        {!isNewFile && oldLines.map((l, i) => <div key={"o" + i} className="diff-line diff-line--del">- {l}</div>)}
        {newLines.map((l, i) => <div key={"n" + i} className="diff-line diff-line--add">+ {l}</div>)}
      </pre>
    </div>
  );
}

// Comandos shell que el agente corre por su cuenta: mismo estilo "$ comando / output" que la
// terminal real, así se ven igual sin importar quién los ejecutó.
function ExecToolBlock({ tool }: { tool: ToolBlockData }) {
  const output = tool.items.find((i) => i.type === "text") as { type: "text"; text: string } | undefined;
  const hasExitCode = tool.exitCode !== undefined && tool.exitCode !== 0;
  return (
    <>
      <div className="doc-cmd">
        <span className="doc-cmd-prompt">$</span>
        <span className="doc-cmd-text">{tool.command ?? tool.title}</span>
      </div>
      {tool.status !== "pending" && (
        <div className={`doc-out${tool.status === "failed" ? " doc-out--failed" : ""}`}>
          <pre>
            {output?.text.trim() || (tool.status === "running" ? "..." : "(no output)")}
            {hasExitCode && `\n[exit code ${tool.exitCode}]`}
          </pre>
        </div>
      )}
    </>
  );
}

// Resto de acciones (escribir/editar archivo, leer, etc.): línea compacta tipo
// "← Write archivo.txt — Wrote file successfully", con el diff oculto en un <details>.
function ToolCard({ tool }: { tool: ToolBlockData }) {
  if (tool.kind === "execute") return <ExecToolBlock tool={tool} />;

  const summary = tool.items.find((i) => i.type === "text") as { type: "text"; text: string } | undefined;
  const diffs = tool.items.filter((i): i is { type: "diff"; path?: string; oldText?: string; newText?: string } => i.type === "diff");
  const raws = tool.items.filter((i): i is { type: "raw"; data: unknown } => i.type === "raw");

  return (
    <details className="tool-line">
      <summary className="tool-line-summary">
        <StepIcon status={tool.status} />
        <span className="tool-line-arrow">←</span>
        <span className="tool-line-title">{tool.title}</span>
        {summary && <span className="tool-line-result">{summary.text}</span>}
      </summary>
      {diffs.map((item, i) => <DiffView key={i} path={item.path} oldText={item.oldText} newText={item.newText} />)}
      {raws.map((item, i) => <pre key={i} className="tool-card-text">{JSON.stringify(item.data, null, 2)}</pre>)}
    </details>
  );
}

/* ── Doc block renderer ─────────────────────────────────── */
function DocBlock({ block }: { block: DocBlockData }) {
  if (block.type === "tool") {
    return block.tool ? <ToolCard tool={block.tool} /> : null;
  }
  if (block.type === "thought") {
    return <div className="doc-thought">{block.content}</div>;
  }
  if (block.type === "user") {
    return <div className="doc-user">{block.content}</div>;
  }
  return (
    <div className="doc-ai">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */
export function ChatView() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWs = useWorkspaceStore((s) => s.activeWs);
  const setActiveWs = useWorkspaceStore((s) => s.setActiveWs);
  const storeNewWorkspace = useWorkspaceStore((s) => s.newWorkspace);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const addBlockToWs = useWorkspaceStore((s) => s.addBlock);
  const appendTextChunkToWs = useWorkspaceStore((s) => s.appendTextChunk);
  const updateWsSteps = useWorkspaceStore((s) => s.updateSteps);
  const upsertToolBlock = useWorkspaceStore((s) => s.upsertToolBlock);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const setRunning = useWorkspaceStore((s) => s.setRunning);
  const enqueue = useWorkspaceStore((s) => s.enqueue);
  const shiftQueue = useWorkspaceStore((s) => s.shiftQueue);
  const removeFromQueue = useWorkspaceStore((s) => s.removeFromQueue);
  const [termHeight, setTermHeight] = useState(180);
  const [input, setInput]           = useState("");
  // Tarea precargada desde la vista Equipo ("abrir en chat"): se vuelca en el input una vez y se limpia.
  const pendingPrompt = useUiStore((s) => s.pendingPrompt);
  const setPendingPrompt = useUiStore((s) => s.setPendingPrompt);
  useEffect(() => {
    if (pendingPrompt) { setInput(pendingPrompt); setPendingPrompt(undefined); }
  }, [pendingPrompt, setPendingPrompt]);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<acpClient.PermissionRequest | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const docEndRef  = useRef<HTMLDivElement>(null);
  const textRef    = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const resizing   = useRef(false);
  const startY     = useRef(0);
  const startH     = useRef(0);
  // Turnos ACP en vuelo, keyed por `${provider}:${sessionId}`. Antes era un único ref global
  // (solo un turno a la vez en TODA la app); ahora es un Map → varios workspaces pueden streamear
  // en paralelo (cada uno con su sesión distinta). El handler de session/update busca acá por sesión.
  const activeTurnsRef = useRef(new Map<string, { wsId: string; aiBlockId: string; outChars: number }>());
  // Señal de cancelación POR workspace (antes era un bool global que un ws pisaba a otro). El /run
  // desde el chat la consulta para cortar entre nodos; cada turno la resetea al arrancar.
  const cancelledRef = useRef(new Map<string, boolean>());

  // activeAgentId (chatStore) ya no es la fuente de verdad del turno: pasó a ser el DEFAULT global con el
  // que se siembran las pestañas nuevas (tracks tu última elección). El turno usa ws.agentId (por-pestaña).
  const { activeAgentId, setActiveAgent } = useChatStore();
  const agents = useAgentsStore((s) => s.agents);
  const recordChat = useMetricsStore((s) => s.recordChat);
  const projectAgentIds = useProjectStore((s) => s.projects[s.activeId]?.agentIds ?? []);
  const activeProjectId = useProjectStore((s) => s.activeId);
  const setWorkspaceAgent = useWorkspaceStore((s) => s.setWorkspaceAgent);

  // Workspaces del PROYECTO ACTIVO (scope por proyecto). La pestaña activa efectiva es siempre una del
  // proyecto: si activeWs quedó apuntando a otro proyecto (durante la transición de switch), caemos a la
  // primera del proyecto. activateProject (efecto abajo) corrige activeWs al cambiar de proyecto.
  const projectWorkspaces = useMemo(() => workspaces.filter((w) => w.projectId === activeProjectId), [workspaces, activeProjectId]);
  const ws = projectWorkspaces.find((w) => w.id === activeWs) ?? projectWorkspaces[0];
  const curWsId = ws?.id ?? "";
  const steps = ws?.steps ?? [];

  // Agente del turno = el del workspace activo (por-pestaña, no global). Habilita MiMo en una pestaña y
  // un experto en otra al mismo tiempo. El selector muestra los agentes globales base (MiMo/Hermes/Claude,
  // defaults NO expertos) + los asociados al proyecto activo (+ el del ws activo, para que nunca desaparezca).
  const activeAgent = agents.find((a) => a.id === ws?.agentId);
  // Selección de modelo (por provider ACP del agente activo). availableModels se descubre al abrir
  // sesión; currentModel es el activo; la elección del usuario (modelByProvider) se persiste.
  const activeProviderId = activeAgent?.providerId ?? "";
  const activeAcp = activeAgent ? DEFAULT_PROVIDERS.find((p) => p.id === activeProviderId)?.acp : undefined;
  // OpenCode se habla por su servidor HTTP+SSE nativo (opencodeClient.ts), no por ACP-sobre-stdio —
  // ver los puntos donde se despacha a uno u otro cliente según cuál de los dos esté seteado.
  const activeNativeHttp = activeAgent ? DEFAULT_PROVIDERS.find((p) => p.id === activeProviderId)?.nativeHttp : undefined;
  const availableModels = useSettingsStore((s) => s.availableModelsByProvider[activeProviderId] ?? EMPTY_MODELS);
  const currentModel = useSettingsStore((s) => s.currentModelByProvider[activeProviderId]);
  const setModelForProvider = useSettingsStore((s) => s.setModelForProvider);
  const preferredIsAuto = useSettingsStore((s) => s.modelByProvider[activeProviderId] === AUTO_MODEL);
  const visibleAgents = useMemo(
    () => agents.filter((a) => (isDefaultAgent(a.id) && !isExpertAgent(a)) || projectAgentIds.includes(a.id) || a.id === ws?.agentId),
    [agents, projectAgentIds, ws?.agentId]
  );

  // Al cambiar de proyecto activo: adoptar workspaces huérfanos, garantizar ≥1 pestaña, y activar la
  // pestaña recordada del proyecto. Corre también en el primer montaje (migra los ws viejos sin projectId).
  useEffect(() => {
    useWorkspaceStore.getState().activateProject(activeProjectId, useChatStore.getState().activeAgentId || "mimo-coder");
  }, [activeProjectId]);

  // Reconcilia workspaces que apunten a un agente que ya no existe (ej. "hermes", retirado del chat →
  // ahora es infra MCP): los reasigna a mimo-coder para que sigan funcionando en vez de caer al mock.
  useEffect(() => {
    const valid = new Set(agents.map((a) => a.id));
    for (const w of useWorkspaceStore.getState().workspaces) {
      if (!valid.has(w.agentId)) setWorkspaceAgent(w.id, "mimo-coder");
    }
  }, [agents, setWorkspaceAgent]);

  // Resuelve el agente de un workspace por su id, leyendo estado FRESCO (turnos concurrentes de distintas
  // pestañas pueden usar agentes distintos → no sirve el activeAgent del closure).
  const agentForWs = useCallback((wsId: string) => {
    const w = useWorkspaceStore.getState().workspaces.find((x) => x.id === wsId);
    return useAgentsStore.getState().agents.find((a) => a.id === w?.agentId);
  }, []);
  const contextItems = useProjectStore((s) => s.projects[s.activeId]?.contextItems ?? []);
  const removeContextItem = useProjectStore((s) => s.removeContextItem);
  // Archivo activo del editor de código DEL PROYECTO ACTIVO — se inyecta como contexto del agente (ver
  // buildPromptWithContext). El editor está scopeado por proyecto, así que este chip solo muestra un
  // archivo del proyecto activo (nunca uno de otro proyecto abierto en otra pestaña del editor).
  const editorActivePath = useEditorStore((s) => s.activePathByProject[activeProjectId] ?? null);
  const projectPath = useProjectStore((s) => s.projectPath);
  const projectEnv = useProjectStore((s) => s.projects[s.activeId]?.env ?? {});

  useEffect(() => { docEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ws?.blocks, ws?.running]);

  /* drag to resize terminal */
  const onResizeDown = useCallback((e: React.MouseEvent) => {
    resizing.current = true;
    startY.current = e.clientY;
    startH.current = termHeight;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setTermHeight(Math.max(80, Math.min(400, startH.current + (startY.current - ev.clientY))));
    };
    const onUp = () => { resizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  }, [termHeight]);

  // Crea (en el primer chunk) o concatena texto (en los siguientes) a un bloque de streaming
  // ("ai" para la respuesta final, "thought" para el razonamiento del agente).
  const appendTextChunk = useCallback((wsId: string, blockId: string, delta: string, type: "ai" | "thought") => {
    const w = useWorkspaceStore.getState().workspaces.find((x) => x.id === wsId);
    appendTextChunkToWs(wsId, blockId, delta, type, w?.agentId);
  }, [appendTextChunkToWs]);
  const appendAiChunk = useCallback((wsId: string, blockId: string, delta: string) => appendTextChunk(wsId, blockId, delta, "ai"), [appendTextChunk]);

  // session/update no manda un blockId propio para "agent_thought_chunk", pero sí messageId —
  // lo usamos para agrupar los chunks de un mismo pensamiento en un solo bloque.
  const thoughtBlockIdsRef = useRef(new Map<string, string>());

  // Contenido de archivos de contexto ya mandado en la sesión ACP actual de cada workspace
  // (wsId:sessionId -> path -> último contenido enviado), para no re-mandar el archivo completo
  // en cada turno si no cambió desde la última vez (ver buildPromptWithContext más abajo).
  const sentContextRef = useRef(new Map<string, Map<string, string>>());

  // Suscripción única a las notificaciones de turno de cualquier agente — tanto ACP (mimo, hermes,
  // claude...) como el path nativo de OpenCode (opencodeClient emite el mismo shape de SessionUpdate,
  // ver su comentario de cabecera), así este handler no necesita saber de cuál vino cada evento.
  useEffect(() => {
    const handleUpdate = (provider: string, sessionId: string, update: acpClient.SessionUpdate) => {
      const turn = activeTurnsRef.current.get(`${provider}:${sessionId}`);
      if (!turn) return;
      const kind = update.sessionUpdate;
      if (kind === "agent_message_chunk") {
        const text = extractChunkText(update);
        if (text) { appendAiChunk(turn.wsId, turn.aiBlockId, text); turn.outChars += text.length; }
      } else if (kind === "agent_thought_chunk") {
        const text = extractChunkText(update);
        if (!text) return;
        const messageId = (update as any).messageId as string | undefined;
        const key = `${turn.wsId}:${messageId ?? "default"}`;
        let blockId = thoughtBlockIdsRef.current.get(key);
        if (!blockId) {
          blockId = makeId();
          thoughtBlockIdsRef.current.set(key, blockId);
        }
        appendTextChunk(turn.wsId, blockId, text, "thought");
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const toolCallId = (update as any).toolCallId as string | undefined;
        if (!toolCallId) return;
        const title = (update as any).title ?? (update as any).kind ?? "Tool call";
        const toolKind = (update as any).kind as string | undefined;
        const command = toolKind === "execute" ? ((update as any).rawInput?.command as string | undefined) : undefined;
        const exitCode = toolKind === "execute" ? ((update as any).rawOutput?.metadata?.exit as number | undefined) : undefined;
        // ACP marca el tool call como "completed" si el shell pudo correr, aunque el comando
        // en sí haya devuelto un exit code distinto de 0 — para el usuario eso es una falla real.
        let status = mapToolStatus((update as any).status);
        if (status === "done" && exitCode !== undefined && exitCode !== 0) status = "failed";
        const rawContent = (update as any).content;
        const items = Array.isArray(rawContent) ? rawContent.map(mapContentItem) : undefined;
        // Tracking de uso de skills: si el tool call refiere al SKILL.md de una skill (el agente
        // la está leyendo/siguiendo), contabilizamos el uso — alimenta el curator (stale/stats).
        if (kind === "tool_call") {
          const rawInput = (update as any).rawInput;
          const used = detectSkillUse(`${title} ${command ?? ""} ${rawInput ? JSON.stringify(rawInput) : ""}`);
          if (used) useSkillsStore.getState().recordUse(used);
        }
        updateWsSteps(turn.wsId, (prev) => {
          const idx = prev.findIndex((s) => s.id === toolCallId);
          if (idx === -1) return [...prev, { id: toolCallId, label: title, status }];
          const next = [...prev];
          next[idx] = { ...next[idx], label: title, status };
          return next;
        });
        upsertToolBlock(turn.wsId, toolCallId, { title, kind: toolKind, command, exitCode, status, items });
      }
      // otras variantes (plan, etc.): sin UI todavía, no-op explícito.
    };
    const unsub1 = acpClient.onUpdate(handleUpdate);
    const unsub2 = opencodeClient.onUpdate(handleUpdate);
    return () => { unsub1(); unsub2(); };
  }, [appendAiChunk, appendTextChunk, updateWsSteps, upsertToolBlock]);

  // Suscripción a las solicitudes de permiso (ACP session/request_permission u OpenCode
  // permission.asked, ver arriba): muestra el modal y deja la decisión al usuario.
  const pendingPermissionRef = useRef<acpClient.PermissionRequest | null>(null);
  useEffect(() => {
    const onReq = (req: acpClient.PermissionRequest) => {
      pendingPermissionRef.current = req;
      setPendingPermission(req);
    };
    const unsub1 = acpClient.onPermissionRequest(onReq);
    const unsub2 = opencodeClient.onPermissionRequest(onReq);
    return () => {
      unsub1();
      unsub2();
      // si el componente se desmonta con un permiso sin resolver, no dejamos al agente colgado.
      if (pendingPermissionRef.current) {
        const p = pendingPermissionRef.current;
        const client = p.provider === "opencode" ? opencodeClient : acpClient;
        client.cancelPermission(p.provider, p.id, p.sessionId);
      }
    };
  }, []);

  // Suscripción a los modelos que el agente ofrece al abrir sesión → los volcamos al settingsStore
  // para poblar el selector de modelo (ver acpClient.newSession / opencodeClient.newSession).
  useEffect(() => {
    const onOptions = (provider: string, _sid: string, info: acpClient.ModelInfo) => {
      useSettingsStore.getState().reportModelOptions(provider, info.available, info.current);
    };
    const unsub1 = acpClient.onModelOptions(onOptions);
    const unsub2 = opencodeClient.onModelOptions(onOptions);
    return () => { unsub1(); unsub2(); };
  }, []);

  // Cambia el modelo del agente activo: persiste la elección y, si ya hay sesión abierta en esta
  // pestaña, la aplica en vivo (si no, se aplica al abrir la próxima sesión). "Auto" no es un modelo
  // real: se persiste como preferencia y el router elige por turno (ver runAcp → classifyTask).
  const selectModel = (value: string) => {
    setModelForProvider(activeProviderId, value);
    setShowModelMenu(false);
    if (value === AUTO_MODEL) return;
    const w = useWorkspaceStore.getState().workspaces.find((x) => x.id === curWsId);
    if (w?.sessionId && w.sessionProvider === activeProviderId) {
      const client = activeNativeHttp ? opencodeClient : acpClient;
      client.setSessionModel(activeProviderId, w.sessionId, value).catch(() => {});
    }
  };

  const resolvePermission = (optionId: string) => {
    if (!pendingPermission) return;
    const client = pendingPermission.provider === "opencode" ? opencodeClient : acpClient;
    client.resolvePermission(pendingPermission.provider, pendingPermission.id, optionId, pendingPermission.sessionId);
    pendingPermissionRef.current = null;
    setPendingPermission(null);
  };

  // Pestaña nueva en el proyecto activo, sembrada con el agente de la pestaña actual (o el default global).
  const newWorkspace = () => storeNewWorkspace(ws?.agentId ?? activeAgentId, activeProjectId);

  // Fallback cuando el agente activo NO tiene un adaptador ACP configurado. No debería pasar con los
  // agentes default (todos son ACP: MiMo, Claude Code, expertos), pero un agente custom podría apuntar
  // a un provider sin `acp`. En vez de simular una respuesta falsa, avisamos claro qué hacer.
  const runNoAdapter = async (wsId: string) => {
    try {
      const name = agentForWs(wsId)?.name ?? "This agent";
      addBlockToWs(wsId, {
        type: "ai", agentId: agentForWs(wsId)?.id,
        content: `**${name}** has no ACP adapter configured, so it can't run the turn.\n\nPick an agent connected over ACP (e.g. **MiMo Code** or **Claude Code**) in the selector above.`,
      });
    } finally {
      finishTurn(wsId);
    }
  };

  // Los archivos agregados al contexto (panel "Contexto" / explorador) no quedan implícitos
  // en la sesión ACP — se vuelcan como texto al principio del prompt para que el agente los
  // tenga disponibles. Una sesión ACP es una conversación continua del lado del agente: lo que
  // se mandó en un turno anterior ya queda en su historial, así que solo re-mandamos un archivo
  // si todavía no se mandó en esta sesión o si su contenido cambió desde la última vez — evita
  // re-pagar en tokens el contenido completo de cada archivo adjunto en cada mensaje.
  const buildPromptWithContext = async (wsId: string, sessionId: string, text: string): Promise<string> => {
    const sessionKey = `${wsId}:${sessionId}`;
    let sent = sentContextRef.current.get(sessionKey);
    if (!sent) {
      sent = new Map();
      sentContextRef.current.set(sessionKey, sent);
    }
    const parts: string[] = [];

    // Raíz del proyecto AL QUE PERTENECE este workspace (o su ambiente/worktree), para no filtrar
    // contexto de otro proyecto: el editor es global (puede tener abiertos archivos de otro proyecto)
    // y si inyectáramos ese archivo como "el usuario lo está editando ahora", el agente investigaría
    // el proyecto equivocado (bug: parado en un proyecto, describía el del archivo abierto del editor).
    const wsForCtx = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId);
    const pstateCtx = useProjectStore.getState();
    const projectRoot = wsForCtx?.cwd ?? pstateCtx.projects[wsForCtx?.projectId ?? ""]?.path ?? pstateCtx.projectPath;
    const normPath = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
    const isInsideProject = (p: string) => {
      const c = normPath(p), r = normPath(projectRoot);
      return c === r || c.startsWith(r + "\\") || c.startsWith(r + "/");
    };

    // Archivo activo del editor de código DEL PROYECTO de este workspace: el agente "ve" lo que estás
    // editando ahora mismo, incluidos los cambios SIN guardar (usamos el buffer del editor, no el disco).
    // Mismo dedup por sesión que los adjuntos: solo se re-manda si su contenido cambió desde el último
    // turno. El editor está scopeado por proyecto (activePathByProject), y además chequeamos isInsideProject
    // como red de seguridad para nunca filtrar un archivo de otro proyecto al prompt.
    const ed = useEditorStore.getState();
    const activePathForWs = ed.activePathByProject[wsForCtx?.projectId ?? ""] ?? null;
    const activeTab = ed.tabs.find((t) => t.path === activePathForWs);
    const editorPath = activeTab && !activeTab.loading && !activeTab.error && isInsideProject(activeTab.path) ? activeTab.path : null;
    if (activeTab && editorPath) {
      // Economía de prompts: con un modelo remoto (o modo "always"), el buffer del editor se capa a
      // ECONOMY_EDITOR_MAX_LINES — un archivo grande inyectado entero quema tokens en cada cambio.
      // Los adjuntos del Contexto ya van capados a 400 líneas vía readTextFile.
      const wsAgent = useAgentsStore.getState().agents.find((a) => a.id === wsForCtx?.agentId);
      const wsProvider = wsAgent ? DEFAULT_PROVIDERS.find((p) => p.id === wsAgent.providerId) : undefined;
      const sessionModel = wsAgent
        ? (wsProvider?.nativeHttp ? opencodeClient : acpClient).getSessionModel(wsAgent.providerId, sessionId)
        : null;
      const economy = economyActive(useSettingsStore.getState().promptEconomy, sessionModel);
      let editorContent = activeTab.content;
      if (economy) {
        const lines = editorContent.split("\n");
        if (lines.length > ECONOMY_EDITOR_MAX_LINES) {
          editorContent =
            lines.slice(0, ECONOMY_EDITOR_MAX_LINES).join("\n") +
            `\n… (truncated for token economy: first ${ECONOMY_EDITOR_MAX_LINES} of ${lines.length} lines; ask to read the file for the rest)`;
        }
      }
      const key = `@editor:${editorPath}`;
      const block = `Open file in the editor (the user is editing it right now): ${editorPath}\n\`\`\`\n${editorContent}\n\`\`\``;
      if (sent.get(key) !== block) {
        sent.set(key, block);
        parts.push(block);
      }
    }

    // Adjuntos del panel Contexto (excluimos el que ya va como archivo del editor, para no duplicar).
    const fileItems = contextItems.filter((i) => !i.isDir && i.path !== editorPath);
    for (const item of fileItems) {
      let content: string;
      try {
        content = await readTextFile(item.path, 1, 400);
      } catch (e) {
        const errMsg = `Attached file: ${item.path}\n(could not read: ${e instanceof Error ? e.message : String(e)})`;
        if (sent.get(item.path) !== errMsg) {
          parts.push(errMsg);
          sent.set(item.path, errMsg);
        }
        continue;
      }
      if (sent.get(item.path) === content) continue;
      sent.set(item.path, content);
      parts.push(`Attached file: ${item.path}\n\`\`\`\n${content}\n\`\`\``);
    }
    if (parts.length === 0) return text;
    return `${parts.join("\n\n")}\n\n${text}`;
  };

  const runAcp = async (wsId: string, text: string, provider: string, spawn: acpClient.AcpSpawnConfig) => {
    const aiBlockId = makeId();
    updateWsSteps(wsId, () => []);
    for (const key of thoughtBlockIdsRef.current.keys()) {
      if (key.startsWith(`${wsId}:`)) thoughtBlockIdsRef.current.delete(key);
    }
    const startedAt = performance.now();
    let inChars = text.length;
    let turnKey: string | null = null;
    try {
      // Leemos el workspace fresco del store (no del closure): con turnos concurrentes el closure
      // puede estar desactualizado. Si el ws ya tenía sesión pero de OTRO provider (cambiaste de
      // agente a mitad de conversación), esa session id no existe en el proceso nuevo — abrimos una.
      const wsNow = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId);
      let sid = wsNow?.sessionProvider === provider ? wsNow?.sessionId : undefined;
      const isNewSession = !sid;
      if (!sid) {
        // Si el workspace está atado a un ambiente, la sesión ACP se abre en el worktree (cwd override)
        // → el agente lee/escribe/ejecuta AISLADO ahí, sin tocar el proyecto real.
        // Si no, el cwd sale del proyecto AL QUE PERTENECE el workspace (projectId), NO del proyecto
        // global activo: como la sesión se crea una sola vez (lazy) y nunca se re-rootea, tomar el
        // projectPath global la dejaba pinneada al proyecto equivocado de forma permanente si el global
        // estaba desincronizado en ese instante (bug: chat de un proyecto describiendo otro).
        const pstate = useProjectStore.getState();
        const sessionCwd = wsNow?.cwd ?? pstate.projects[wsNow?.projectId ?? ""]?.path ?? pstate.projectPath;
        // Modelo elegido por el usuario para este provider (si hay); si no, acpClient usa el default.
        const preferredModel = useSettingsStore.getState().modelByProvider[provider];
        sid = await acpClient.newSession(provider, spawn, sessionCwd, preferredModel);
        setSession(wsId, sid, provider);
      }
      // Registramos el turno keyed por sesión: el handler de session/update lo encuentra por acá,
      // y cancel() puede destrabarlo selectivamente sin tocar turnos de otros workspaces.
      turnKey = `${provider}:${sid}`;
      activeTurnsRef.current.set(turnKey, { wsId, aiBlockId, outChars: 0 });
      let fullPrompt = await buildPromptWithContext(wsId, sid, text);
      // El system prompt del agente se inyecta una sola vez, al abrir la sesión ACP: una sesión es
      // una conversación continua del lado del agente, así que alcanza con mandarlo en el primer turno.
      const systemPrompt = agentForWs(wsId)?.systemPrompt?.trim();
      if (isNewSession && systemPrompt) {
        fullPrompt = `[System]\n${systemPrompt}\n\n${fullPrompt}`;
      }
      // Índice de skills (divulgación progresiva): en la sesión nueva va solo nombre+descripción+path
      // de cada skill habilitada; el agente lee el SKILL.md con su propio tool si la tarea matchea.
      if (isNewSession) {
        try {
          const sstate = useSkillsStore.getState();
          const skillsList = sstate.order.map((id) => sstate.skills[id]).filter(Boolean);
          const preamble = buildSkillsPreamble(skillsList, await skillsRoot());
          if (preamble) fullPrompt = `${preamble}\n\n${fullPrompt}`;
        } catch { /* sin índice el turno sigue igual */ }
      }
      inChars = fullPrompt.length;
      // Modo Auto del router: si el usuario eligió "Auto" en el selector de modelo, clasificamos el
      // turno (classifyTask) y elegimos el mejor modelo GRATIS disponible para ese perfil
      // (cuota-consciente). Solo cambia el modelo de la sesión si difiere del activo; si el router no
      // encuentra candidato (catálogo sin matches / todo agotado) el turno sigue con el modelo actual.
      if (useSettingsStore.getState().modelByProvider[provider] === AUTO_MODEL) {
        const avail = useSettingsStore.getState().availableModelsByProvider[provider] ?? [];
        const target = pickModel(classifyTask(fullPrompt), avail);
        const active = acpClient.getSessionModel(provider, sid);
        if (target && target !== active) {
          try {
            await acpClient.setSessionModel(provider, sid, target);
            useSettingsStore.getState().reportModelOptions(provider, avail, target);
          } catch { /* si falla el cambio, el turno sigue con el modelo actual */ }
        }
      }
      // Si detuvieron el turno mientras se creaba la sesión, no arranquemos el prompt.
      if (cancelledRef.current.get(wsId)) throw new Error("__turn_cancelled__");
      await acpClient.prompt(provider, sid, fullPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // __turn_cancelled__ = el usuario detuvo el turno (acpClient.cancel); no es un error real.
      if (msg !== "__turn_cancelled__") {
        appendAiChunk(wsId, aiBlockId, `\n\n**Error:** ${msg}`);
      }
    } finally {
      recordChat({
        provider,
        latencyMs: performance.now() - startedAt,
        inChars,
        outChars: turnKey ? (activeTurnsRef.current.get(turnKey)?.outChars ?? 0) : 0,
      });
      if (turnKey) activeTurnsRef.current.delete(turnKey);
      finishTurn(wsId);
      // Minería de skills post-turno (background, gratis vía router, sugerencia con aprobación):
      // solo para turnos ACP reales — los turnos de workflow/equipo tienen su propio flujo.
      maybeMineWorkspace(wsId);
    }
  };

  // Mismo flujo que runAcp (sesión reusada por workspace, contexto, system prompt, índice de skills,
  // router "Auto", cancelación) pero contra el servidor HTTP+SSE nativo de OpenCode en vez de ACP. Se
  // separó de runAcp en vez de generalizarla porque newSession/prompt tienen firmas distintas (acá
  // hace falta pasar cwd explícito en cada prompt — el server no es stateful por proceso como ACP).
  const runOpenCodeHttp = async (wsId: string, text: string, provider: string) => {
    const aiBlockId = makeId();
    updateWsSteps(wsId, () => []);
    for (const key of thoughtBlockIdsRef.current.keys()) {
      if (key.startsWith(`${wsId}:`)) thoughtBlockIdsRef.current.delete(key);
    }
    const startedAt = performance.now();
    let inChars = text.length;
    let turnKey: string | null = null;
    try {
      // El system prompt del agente va por el campo nativo de OpenCode, no como texto prepend (eso
      // sigue siendo cosa de ACP, ver runAcp): si el agente es un experto (isExpertAgent), corre
      // como agente REAL de OpenCode (permission-scoping por skills incluido, ver
      // opencodeClient.ensureExpertAgent); si no, pero tiene systemPrompt propio, va por `system`.
      // OJO orden: ensureExpertAgent puede reiniciar el server de OpenCode si el agente es nuevo/
      // cambió (invalida TODAS las sesiones nativas, no solo la de este workspace) — tiene que
      // correr ANTES de leer/crear la sesión de este turno, si no la dejaría colgando de un
      // sessionId que ya no existe.
      const agentCfg = agentForWs(wsId);
      let promptOpts: { system?: string; agent?: string } | undefined;
      if (agentCfg && isExpertAgent(agentCfg)) {
        promptOpts = { agent: await opencodeClient.ensureExpertAgent(provider, agentCfg) };
      } else if (agentCfg?.systemPrompt?.trim()) {
        promptOpts = { system: agentCfg.systemPrompt.trim() };
      }

      const wsNow = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId);
      let sid = wsNow?.sessionProvider === provider ? wsNow?.sessionId : undefined;
      const isNewSession = !sid;
      const pstate = useProjectStore.getState();
      const sessionCwd = wsNow?.cwd ?? pstate.projects[wsNow?.projectId ?? ""]?.path ?? pstate.projectPath;
      if (!sid) {
        const preferredModel = useSettingsStore.getState().modelByProvider[provider];
        sid = await opencodeClient.newSession(provider, sessionCwd, preferredModel);
        setSession(wsId, sid, provider);
      }
      turnKey = `${provider}:${sid}`;
      activeTurnsRef.current.set(turnKey, { wsId, aiBlockId, outChars: 0 });
      let fullPrompt = await buildPromptWithContext(wsId, sid, text);
      if (isNewSession) {
        try {
          const sstate = useSkillsStore.getState();
          const skillsList = sstate.order.map((id) => sstate.skills[id]).filter(Boolean);
          const preamble = buildSkillsPreamble(skillsList, await skillsRoot());
          if (preamble) fullPrompt = `${preamble}\n\n${fullPrompt}`;
        } catch { /* sin índice el turno sigue igual */ }
      }
      inChars = fullPrompt.length;
      if (useSettingsStore.getState().modelByProvider[provider] === AUTO_MODEL) {
        const avail = useSettingsStore.getState().availableModelsByProvider[provider] ?? [];
        const target = pickModel(classifyTask(fullPrompt), avail);
        const active = opencodeClient.getSessionModel(provider, sid);
        if (target && target !== active) {
          try {
            await opencodeClient.setSessionModel(provider, sid, target);
            useSettingsStore.getState().reportModelOptions(provider, avail, target);
          } catch { /* si falla el cambio, el turno sigue con el modelo actual */ }
        }
      }
      if (cancelledRef.current.get(wsId)) throw new Error("__turn_cancelled__");
      await opencodeClient.prompt(provider, sid, sessionCwd, fullPrompt, promptOpts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "__turn_cancelled__") {
        appendAiChunk(wsId, aiBlockId, `\n\n**Error:** ${msg}`);
      }
    } finally {
      recordChat({
        provider,
        latencyMs: performance.now() - startedAt,
        inChars,
        outChars: turnKey ? (activeTurnsRef.current.get(turnKey)?.outChars ?? 0) : 0,
      });
      if (turnKey) activeTurnsRef.current.delete(turnKey);
      finishTurn(wsId);
      maybeMineWorkspace(wsId);
    }
  };

  const runAI = (wsId: string, text: string) => {
    const provider = DEFAULT_PROVIDERS.find((p) => p.id === agentForWs(wsId)?.providerId);
    if (provider?.nativeHttp) return runOpenCodeHttp(wsId, text, provider.id);
    return provider?.acp ? runAcp(wsId, text, provider.id, provider.acp) : runNoAdapter(wsId);
  };

  // Comando /run [nombre]: ejecuta un workflow desde el chat (sin nombre → el flujo activo; con
  // nombre → el primero que lo contenga) y vuelca sus logs como un bloque del chat.
  const runWorkflowFromChat = async (wsId: string, arg: string) => {
    const st = useWorkflowStore.getState();
    const flows = st.order.map((fid) => st.workflows[fid]);
    const query = arg.trim().toLowerCase();
    const w = query ? flows.find((f) => f.name.toLowerCase().includes(query)) : st.workflows[st.activeId];
    if (!w) {
      addBlockToWs(wsId, { type: "ai", agentId: agentForWs(wsId)?.id, content: `No flow found for **${arg.trim()}**.\n\nAvailable flows: ${flows.map((f) => `\`${f.name}\``).join(", ")}` });
      finishTurn(wsId);
      return;
    }
    const lines: string[] = [];
    try {
      await runWorkflow(w.nodes, w.edges, {
        onLog: (lvl, msg) => lines.push(`${lvl === "error" ? "✖" : lvl === "success" ? "✓" : lvl === "warn" ? "!" : "·"} ${msg}`),
        setNodeStatus: (id, status) => {
          if (useWorkflowStore.getState().activeId === w.id) useWorkflowStore.getState().setNodeStatus(id, status);
        },
        isCancelled: () => cancelledRef.current.get(wsId) ?? false,
        resolveFlow: (fid) => {
          const f = useWorkflowStore.getState().workflows[fid];
          return f ? { name: f.name, nodes: f.nodes, edges: f.edges } : undefined;
        },
      });
    } catch (e) {
      lines.push(`✖ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      addBlockToWs(wsId, { type: "ai", agentId: agentForWs(wsId)?.id, content: `### ▶ Flow: ${w.name}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`` });
      finishTurn(wsId);
    }
  };

  // Cierra un turno: re-habilita el input del workspace y, si hay mensajes encolados, arranca el
  // siguiente automáticamente. Único lugar que baja `running` → todos los runners lo llaman en su finally.
  const finishTurn = (wsId: string) => {
    setRunning(wsId, false);
    const w = useWorkspaceStore.getState().workspaces.find((x) => x.id === wsId);
    const next = w?.queue?.[0];
    if (next !== undefined) {
      shiftQueue(wsId);
      startMessage(wsId, next);
    }
  };

  // Arranca un mensaje del usuario en un workspace: pinta el bloque, marca el turno como corriendo,
  // resetea la señal de cancelación y despacha al runner correcto (workflow /run o agente).
  const startMessage = (wsId: string, text: string) => {
    addBlockToWs(wsId, { type: "user", content: text });
    setRunning(wsId, true);
    cancelledRef.current.set(wsId, false);
    if (text === "/run" || text.startsWith("/run ")) {
      void runWorkflowFromChat(wsId, text.slice(4));
    } else {
      void runAI(wsId, text);
    }
  };

  // Detener el turno en curso del workspace activo: avisa al agente ACP (session/cancel, selectivo por
  // sesión) y marca la señal de cancelación. No baja `running` directamente: el runner cae a su finally
  // → finishTurn (re-habilita el input y sigue con la cola). Para el mock/workflow (sin pending ACP que
  // rechazar) la señal cancelledRef corta el loop y su finally también llama finishTurn.
  const stopTurn = () => {
    const wsId = curWsId;
    if (!wsId) return;
    const w = ws;
    if (w?.sessionProvider && w?.sessionId) {
      const client = w.sessionProvider === "opencode" ? opencodeClient : acpClient;
      client.cancel(w.sessionProvider, w.sessionId);
      activeTurnsRef.current.delete(`${w.sessionProvider}:${w.sessionId}`);
    }
    cancelledRef.current.set(wsId, true);
    updateWsSteps(wsId, (prev) => prev.map((s) => (s.status === "running" || s.status === "pending") ? { ...s, status: "failed" } : s));
    addBlockToWs(wsId, { type: "ai", agentId: agentForWs(wsId)?.id, content: "_⏹ Turn stopped by the user._" });
  };

  const handleSend = () => {
    const t = input.trim();
    if (!t || !curWsId) return;
    setInput("");
    // Si ya hay un turno en curso en este workspace, encolamos: el chat sigue usable y el mensaje
    // se manda solo cuando termina el turno actual (cola transitoria por-workspace).
    if (ws?.running) {
      enqueue(curWsId, t);
      return;
    }
    startMessage(curWsId, t);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const toggleVoice = () => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceError("Speech recognition not supported in this environment.");
      return;
    }
    setVoiceError(null);
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (finalText.trim()) setInput((prev) => (prev ? `${prev} ${finalText.trim()}` : finalText.trim()));
    };
    rec.onerror = (e: any) => {
      setVoiceError(e?.error === "not-allowed" ? "Microphone permission denied." : `Voice error: ${e?.error ?? "unknown"}`);
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const docBlocks = ws?.blocks ?? [];

  return (
    <div className="chat-view">
      {pendingPermission && <PermissionPrompt request={pendingPermission} onResolve={resolvePermission} />}
      <div className="hterm-main">
        {/* Workspace tabs — solo las del proyecto activo (scope por proyecto) */}
        <div className="ws-tabs">
          <div className="ws-tabs-scroll">
            {projectWorkspaces.map((w) => (
              <div key={w.id} className={`ws-tab${w.id === curWsId ? " active" : ""}`} onClick={() => setActiveWs(w.id)} title={w.envName ? `Isolated environment: ${w.envName}` : undefined}>
                <span className="ws-tab-dot" style={{ background: agents.find((a) => a.id === w.agentId)?.color ?? "#a78bfa" }} />
                {w.envName && <GitBranch size={10} className="ws-tab-env" />}
                <span className="ws-tab-title">{w.title}</span>
                {projectWorkspaces.length > 1 && (
                  <button className="ws-tab-close" onClick={(e) => { e.stopPropagation(); closeWorkspace(w.id); }}>
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            <button className="ws-tab-add" onClick={newWorkspace}><Plus size={13} /></button>
          </div>

          {/* Agent selector — cambia el agente de la PESTAÑA activa (por-workspace) y el default global */}
          <div className="ws-agent-selector" onClick={() => setShowAgentMenu((v) => !v)}>
            <span className="ws-agent-dot" style={{ background: activeAgent?.color ?? "#a78bfa" }} />
            <span className="ws-agent-name">{activeAgent?.name ?? "Agent"}</span>
            <ChevronDown size={11} />
            {showAgentMenu && (
              <div className="agent-dropdown ws-dropdown">
                {visibleAgents.map((a) => (
                  <div key={a.id} className={`agent-option${a.id === ws?.agentId ? " active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); if (curWsId) setWorkspaceAgent(curWsId, a.id); setActiveAgent(a.id); setShowAgentMenu(false); }}>
                    <span style={{ color: a.color, fontSize: 15 }}>{a.icon}</span>
                    <div>
                      <div className="agent-option-name">{a.name}</div>
                      <div className="agent-option-desc">{a.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Model selector — solo para agentes ACP con modelos descubiertos. Cambia el modelo del
              agente activo (persistido por provider), en vivo si ya hay sesión abierta. */}
          {(activeAcp || activeNativeHttp) && availableModels.length > 0 && (
            <div className="ws-model-selector" onClick={() => setShowModelMenu((v) => !v)} title="Agent model">
              <span className="ws-model-name">
                {(() => {
                  // Con Auto, currentModel puede ser el sentinela "__auto__" hasta el primer turno
                  // ruteado (setModelForProvider lo setea optimista) — en ese caso mostramos solo "Auto".
                  const label = availableModels.find((m) => m.value === currentModel)?.label
                    ?? (currentModel && currentModel !== AUTO_MODEL ? currentModel : null);
                  if (preferredIsAuto) return `✨ Auto${label ? ` · ${label}` : ""}`;
                  return label ?? "model";
                })()}
              </span>
              <ChevronDown size={10} />
              {showModelMenu && (
                <div className="agent-dropdown ws-dropdown ws-model-dropdown">
                  <div className={`agent-option${preferredIsAuto ? " active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); selectModel(AUTO_MODEL); }}>
                    <div className="agent-option-name">✨ Auto — free model per task</div>
                  </div>
                  {availableModels.map((m) => (
                    <div key={m.value} className={`agent-option${!preferredIsAuto && m.value === currentModel ? " active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); selectModel(m.value); }}>
                      <div className="agent-option-name">{m.label}</div>
                    </div>
                  ))}
                  {activeProviderId === "opencode" && (
                    <div className="agent-option agent-option--action"
                      onClick={(e) => { e.stopPropagation(); setShowModelMenu(false); setShowAddModelModal(true); }}>
                      <div className="agent-option-name">🔍 Buscar más modelos…</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {showAddModelModal && (
          <AddModelModal
            onClose={() => setShowAddModelModal(false)}
            onAdded={() => {}}
          />
        )}

        {/* Steps bar */}
        {steps.length > 0 && (
          <div className="hterm-steps">
            {steps.map((s) => (
              <div key={s.id} className={`hterm-step hterm-step--${s.status}`}>
                <StepIcon status={s.status} /><span>{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Document area */}
        <div className="doc-area">
          {docBlocks.map((b) => (
            <DocBlock key={b.id} block={b} />
          ))}
          {ws?.running && steps.length > 0 && (
            <div className="doc-ai doc-ai-loading">
              <span className="typing-indicator"><span /><span /><span /></span>
            </div>
          )}
          <div ref={docEndRef} />
        </div>

        {/* Resize handle */}
        <div className="term-resize-handle" onMouseDown={onResizeDown}>
          <div className="term-resize-grip">
            <Terminal size={11} />
            <span>Terminal</span>
          </div>
        </div>

        {/* Terminal pane */}
        <div className="term-pane" style={{ height: termHeight }}>
          <div className="term-output">
            {projectWorkspaces.map((w) => (
              <TerminalPane key={w.id} workspaceId={w.id} cwd={w.cwd ?? projectPath} env={projectEnv} active={w.id === curWsId} />
            ))}
          </div>

          {/* Status bar */}
          <div className="term-statusbar">
            <span className="term-path">{ws?.cwd ?? projectPath}{ws?.envName ? ` · environment: ${ws.envName}` : ""}</span>
            <span className="term-model">{activeAgent?.name ?? "MiMo"} · devflow v0.1</span>
          </div>
        </div>

        {/* Unified input */}
        <div className="hterm-input-area">
          {(ws?.queue?.length ?? 0) > 0 && (
            <div className="queue-chip-row">
              <span className="queue-chip-label">Queued:</span>
              {ws!.queue!.map((q, i) => (
                <div key={i} className="queue-chip" title={q}>
                  <span className="queue-chip-idx">{i + 1}</span>
                  <span className="queue-chip-text">{q}</span>
                  <button onClick={() => removeFromQueue(curWsId, i)} title="Remove from queue"><X size={9} /></button>
                </div>
              ))}
            </div>
          )}
          {(editorActivePath || contextItems.length > 0) && (
            <div className="ctx-chip-row">
              {editorActivePath && (
                <div className="ctx-chip ctx-chip--editor" title={`The agent sees this editor file: ${editorActivePath}`}>
                  <FileCode size={10} />
                  <span>editing: {editorActivePath.split(/[\\/]/).pop()}</span>
                </div>
              )}
              {contextItems.map((item) => (
                <div key={item.path} className="ctx-chip" title={item.path}>
                  {item.isDir ? <Folder size={10} /> : <FileText size={10} />}
                  <span>{item.path.split(/[\\/]/).pop()}</span>
                  <button onClick={() => removeContextItem(item.path)} title="Remove from context"><X size={9} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="hterm-input-box">
            <div className="hterm-input-row">
              <textarea
                ref={textRef}
                className="hterm-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={ws?.running
                  ? "Type to queue the next message… (Enter queues)"
                  : "Ask the agent something… (or /run [flow] to run a workflow)"}
                rows={2}
              />
              <button
                className={`hterm-mic-btn${recording ? " recording" : ""}`}
                onClick={toggleVoice}
                title={recording ? "Stop dictation" : "Dictate by voice"}
              >
                <Mic size={13} />
              </button>
              {/* Input nunca deshabilitado: durante un turno se puede seguir escribiendo (encola).
                  Stop aparece cuando hay un turno en curso; Send siempre (encola si corre). */}
              {ws?.running && (
                <button className="hterm-stop-btn" onClick={stopTurn} title="Stop turn">
                  <Square size={12} />
                </button>
              )}
              <button
                className="hterm-send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                title={ws?.running ? "Queue message" : "Send"}
              >
                <Send size={13} />
              </button>
            </div>
            <div className="hterm-input-hint">
              {voiceError
                ? <span className="hterm-voice-error">{voiceError}</span>
                : ws?.running
                  ? <>Generating… · ⏹ to stop · Enter queues{(ws?.queue?.length ?? 0) > 0 ? ` · ${ws!.queue!.length} queued` : ""}</>
                  : <>AI · Enter sends{recording ? " · listening..." : ""}</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

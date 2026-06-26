import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, X, Send, Terminal, ChevronDown, CheckCircle, Loader, Circle, ShieldAlert, XCircle, Mic, FileText, Folder } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useContextStore } from "../store/contextStore";
import { useAgentsStore } from "../store/agentsStore";
import { useMetricsStore } from "../store/metricsStore";
import { useWorkspaceStore, type DocBlockData, type Step, type ToolContentItem, type ToolBlockData } from "../store/workspaceStore";
import { DEFAULT_PROVIDERS } from "../lib/providers";
import * as acpClient from "../lib/acpClient";
import { readTextFile } from "../lib/tauriApi";
import { useProjectStore } from "../store/projectStore";
import { TerminalPane } from "../components/TerminalPane";

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
  const title = (tc.title as string) ?? (tc.kind as string) ?? "Acción del agente";
  const content = Array.isArray(tc.content) ? (tc.content as any[]) : [];

  return (
    <div className="permission-overlay">
      <div className="permission-card">
        <div className="permission-card-title">
          <ShieldAlert size={14} color="#fbbf24" />
          <span>El agente pide permiso para continuar</span>
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
            {output?.text.trim() || (tool.status === "running" ? "..." : "(sin salida)")}
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
  const [termHeight, setTermHeight] = useState(180);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<acpClient.PermissionRequest | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const docEndRef  = useRef<HTMLDivElement>(null);
  const textRef    = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const resizing   = useRef(false);
  const startY     = useRef(0);
  const startH     = useRef(0);
  const currentTurnRef = useRef<{ wsId: string; aiBlockId: string; outChars: number } | null>(null);

  const { activeAgentId, setActiveAgent } = useChatStore();
  const agents = useAgentsStore((s) => s.agents);
  const recordChat = useMetricsStore((s) => s.recordChat);
  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const ws = workspaces.find((w) => w.id === activeWs)!;
  const steps = ws?.steps ?? [];
  const contextItems = useContextStore((s) => s.items);
  const removeContextItem = useContextStore((s) => s.removeItem);
  const projectPath = useProjectStore((s) => s.projectPath);

  useEffect(() => { docEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ws?.blocks, loading]);

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

  const addBlock = useCallback((block: Omit<DocBlockData, "id" | "ts">) => {
    addBlockToWs(activeWs, block);
  }, [activeWs, addBlockToWs]);

  // Crea (en el primer chunk) o concatena texto (en los siguientes) a un bloque de streaming
  // ("ai" para la respuesta final, "thought" para el razonamiento del agente).
  const appendTextChunk = useCallback((wsId: string, blockId: string, delta: string, type: "ai" | "thought") => {
    appendTextChunkToWs(wsId, blockId, delta, type, activeAgentId);
  }, [activeAgentId, appendTextChunkToWs]);
  const appendAiChunk = useCallback((wsId: string, blockId: string, delta: string) => appendTextChunk(wsId, blockId, delta, "ai"), [appendTextChunk]);

  // session/update no manda un blockId propio para "agent_thought_chunk", pero sí messageId —
  // lo usamos para agrupar los chunks de un mismo pensamiento en un solo bloque.
  const thoughtBlockIdsRef = useRef(new Map<string, string>());

  // Contenido de archivos de contexto ya mandado en la sesión ACP actual de cada workspace
  // (wsId:sessionId -> path -> último contenido enviado), para no re-mandar el archivo completo
  // en cada turno si no cambió desde la última vez (ver buildPromptWithContext más abajo).
  const sentContextRef = useRef(new Map<string, Map<string, string>>());

  // Suscripción única a las notificaciones session/update de cualquier agente ACP (mimo, hermes, ...).
  useEffect(() => {
    const unsub = acpClient.onUpdate((_provider, _sessionId, update) => {
      const turn = currentTurnRef.current;
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
    });
    return unsub;
  }, [appendAiChunk, appendTextChunk, updateWsSteps, upsertToolBlock]);

  // Suscripción a session/request_permission: muestra el modal y deja la decisión al usuario.
  const pendingPermissionRef = useRef<acpClient.PermissionRequest | null>(null);
  useEffect(() => {
    const unsub = acpClient.onPermissionRequest((req) => {
      pendingPermissionRef.current = req;
      setPendingPermission(req);
    });
    return () => {
      unsub();
      // si el componente se desmonta con un permiso sin resolver, no dejamos al agente colgado.
      if (pendingPermissionRef.current) {
        const p = pendingPermissionRef.current;
        acpClient.cancelPermission(p.provider, p.id);
      }
    };
  }, []);

  const resolvePermission = (optionId: string) => {
    if (!pendingPermission) return;
    acpClient.resolvePermission(pendingPermission.provider, pendingPermission.id, optionId);
    pendingPermissionRef.current = null;
    setPendingPermission(null);
  };

  const newWorkspace = () => storeNewWorkspace(activeAgentId);

  const runMockAI = async (text: string) => {
    const wsId = activeWs;
    const taskSteps: Step[] = [
      { id: "1", label: "Analizando solicitud", status: "pending" },
      { id: "2", label: "Leyendo contexto",     status: "pending" },
      { id: "3", label: "Generando respuesta",  status: "pending" },
    ];
    updateWsSteps(wsId, () => taskSteps);
    setLoading(true);

    for (let i = 0; i < taskSteps.length; i++) {
      await new Promise((r) => setTimeout(r, 500));
      updateWsSteps(wsId, (p) => p.map((s, idx) => idx === i ? { ...s, status: "running" } : s));
      await new Promise((r) => setTimeout(r, 600));
      updateWsSteps(wsId, (p) => p.map((s, idx) => idx === i ? { ...s, status: "done" } : idx === i+1 ? { ...s, status: "running" } : s));
    }

    await new Promise((r) => setTimeout(r, 300));
    addBlock({
      type: "ai", agentId: activeAgentId,
      content: `## Respuesta: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}\n\nRecibí tu solicitud. Una vez que configures un proveedor en **⚙️ Settings**, procesaré la tarea y mostraré:\n\n### Plan de ejecución\n1. Leer archivos relevantes del proyecto\n2. Analizar estructura y dependencias\n3. Generar los cambios propuestos\n4. Ejecutar tests y validar\n\n### Archivos que se modificarían\n\`\`\`\nsrc/views/ChatView.tsx\nsrc/App.css\n\`\`\`\n\n> Configurá tu proveedor de IA en Settings para activar la ejecución real.`,
    });
    setLoading(false);
  };

  // Los archivos agregados al contexto (panel "Contexto" / explorador) no quedan implícitos
  // en la sesión ACP — se vuelcan como texto al principio del prompt para que el agente los
  // tenga disponibles. Una sesión ACP es una conversación continua del lado del agente: lo que
  // se mandó en un turno anterior ya queda en su historial, así que solo re-mandamos un archivo
  // si todavía no se mandó en esta sesión o si su contenido cambió desde la última vez — evita
  // re-pagar en tokens el contenido completo de cada archivo adjunto en cada mensaje.
  const buildPromptWithContext = async (wsId: string, sessionId: string, text: string): Promise<string> => {
    const fileItems = contextItems.filter((i) => !i.isDir);
    if (fileItems.length === 0) return text;
    const sessionKey = `${wsId}:${sessionId}`;
    let sent = sentContextRef.current.get(sessionKey);
    if (!sent) {
      sent = new Map();
      sentContextRef.current.set(sessionKey, sent);
    }
    const parts: string[] = [];
    for (const item of fileItems) {
      let content: string;
      try {
        content = await readTextFile(item.path, 1, 400);
      } catch (e) {
        const errMsg = `Archivo adjunto: ${item.path}\n(no se pudo leer: ${e instanceof Error ? e.message : String(e)})`;
        if (sent.get(item.path) !== errMsg) {
          parts.push(errMsg);
          sent.set(item.path, errMsg);
        }
        continue;
      }
      if (sent.get(item.path) === content) continue;
      sent.set(item.path, content);
      parts.push(`Archivo adjunto: ${item.path}\n\`\`\`\n${content}\n\`\`\``);
    }
    if (parts.length === 0) return text;
    return `${parts.join("\n\n")}\n\n${text}`;
  };

  const runAcp = async (text: string, provider: string, spawn: acpClient.AcpSpawnConfig) => {
    const wsId = activeWs;
    const aiBlockId = makeId();
    currentTurnRef.current = { wsId, aiBlockId, outChars: 0 };
    updateWsSteps(wsId, () => []);
    for (const key of thoughtBlockIdsRef.current.keys()) {
      if (key.startsWith(`${wsId}:`)) thoughtBlockIdsRef.current.delete(key);
    }
    setLoading(true);
    const startedAt = performance.now();
    let inChars = text.length;
    try {
      const ws = workspaces.find((w) => w.id === wsId);
      // Si el workspace ya tenía sesión pero de OTRO provider (ej. cambiaste de agente a
      // mitad de conversación), esa session id no existe en el proceso nuevo — hay que abrir una.
      let sid = ws?.sessionProvider === provider ? ws?.sessionId : undefined;
      const isNewSession = !sid;
      if (!sid) {
        sid = await acpClient.newSession(provider, spawn, useProjectStore.getState().projectPath);
        setSession(wsId, sid, provider);
      }
      let fullPrompt = await buildPromptWithContext(wsId, sid, text);
      // El system prompt del agente se inyecta una sola vez, al abrir la sesión ACP: una sesión es
      // una conversación continua del lado del agente, así que alcanza con mandarlo en el primer turno.
      const systemPrompt = activeAgent?.systemPrompt?.trim();
      if (isNewSession && systemPrompt) {
        fullPrompt = `[System]\n${systemPrompt}\n\n${fullPrompt}`;
      }
      inChars = fullPrompt.length;
      await acpClient.prompt(provider, sid, fullPrompt);
    } catch (e) {
      appendAiChunk(wsId, aiBlockId, `\n\n**Error:** ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      recordChat({
        provider,
        latencyMs: performance.now() - startedAt,
        inChars,
        outChars: currentTurnRef.current?.outChars ?? 0,
      });
      currentTurnRef.current = null;
      setLoading(false);
    }
  };

  const runAI = (text: string) => {
    const provider = DEFAULT_PROVIDERS.find((p) => p.id === activeAgent?.providerId);
    return provider?.acp ? runAcp(text, provider.id, provider.acp) : runMockAI(text);
  };

  const handleSend = () => {
    const t = input.trim();
    if (!t || loading) return;
    setInput("");
    addBlock({ type: "user", content: t });
    runAI(t);
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
      setVoiceError("Reconocimiento de voz no soportado en este entorno.");
      return;
    }
    setVoiceError(null);
    const rec = new SR();
    rec.lang = "es-AR";
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
      setVoiceError(e?.error === "not-allowed" ? "Permiso de micrófono denegado." : `Error de voz: ${e?.error ?? "desconocido"}`);
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
        {/* Workspace tabs */}
        <div className="ws-tabs">
          {workspaces.map((w) => (
            <div key={w.id} className={`ws-tab${w.id === activeWs ? " active" : ""}`} onClick={() => setActiveWs(w.id)}>
              <span className="ws-tab-dot" style={{ background: agents.find((a) => a.id === w.agentId)?.color ?? "#a78bfa" }} />
              <span className="ws-tab-title">{w.title}</span>
              {workspaces.length > 1 && (
                <button className="ws-tab-close" onClick={(e) => { e.stopPropagation(); closeWorkspace(w.id); }}>
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
          <button className="ws-tab-add" onClick={newWorkspace}><Plus size={13} /></button>

          {/* Agent selector */}
          <div className="ws-agent-selector" onClick={() => setShowAgentMenu((v) => !v)}>
            <span className="ws-agent-dot" style={{ background: activeAgent?.color ?? "#a78bfa" }} />
            <span className="ws-agent-name">{activeAgent?.name ?? "Agente"}</span>
            <ChevronDown size={11} />
            {showAgentMenu && (
              <div className="agent-dropdown ws-dropdown">
                {agents.map((a) => (
                  <div key={a.id} className={`agent-option${a.id === activeAgentId ? " active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setActiveAgent(a.id); setShowAgentMenu(false); }}>
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
        </div>

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
          {loading && steps.length > 0 && (
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
            {workspaces.map((w) => (
              <TerminalPane key={w.id} workspaceId={w.id} cwd={projectPath} active={w.id === activeWs} />
            ))}
          </div>

          {/* Status bar */}
          <div className="term-statusbar">
            <span className="term-path">{projectPath}</span>
            <span className="term-model">{activeAgent?.name ?? "MiMo"} · devflow v0.1</span>
          </div>
        </div>

        {/* Unified input */}
        <div className="hterm-input-area">
          {contextItems.length > 0 && (
            <div className="ctx-chip-row">
              {contextItems.map((item) => (
                <div key={item.path} className="ctx-chip" title={item.path}>
                  {item.isDir ? <Folder size={10} /> : <FileText size={10} />}
                  <span>{item.path.split(/[\\/]/).pop()}</span>
                  <button onClick={() => removeContextItem(item.path)} title="Quitar del contexto"><X size={9} /></button>
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
                placeholder="Pedile algo al agente... (Enter para enviar)"
                rows={2}
                disabled={loading}
              />
              <button
                className={`hterm-mic-btn${recording ? " recording" : ""}`}
                onClick={toggleVoice}
                title={recording ? "Detener dictado" : "Dictar por voz"}
              >
                <Mic size={13} />
              </button>
              <button className="hterm-send-btn" onClick={handleSend} disabled={!input.trim() || loading}>
                <Send size={13} />
              </button>
            </div>
            <div className="hterm-input-hint">
              {voiceError
                ? <span className="hterm-voice-error">{voiceError}</span>
                : <>IA · Enter envía{recording ? " · escuchando..." : ""}</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

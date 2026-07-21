// Cliente nativo para OpenCode: en vez de hablarle por ACP-sobre-stdio (como al resto de los
// agentes, ver acpClient.ts), spawnea `opencode serve` (servidor HTTP+SSE propio del binario) y le
// habla directo con el SDK oficial generado (@opencode-ai/sdk). Es el primer paso hacia una
// herramienta de codificación nativa de DevFlow: mismo motor que usa OpenCode (multi-LLM, incluye
// modelos locales), pero integrado por su API real en vez de tratarlo como una CLI externa genérica.
//
// Diseño verificado contra un `opencode serve` real (no solo la doc pública) antes de escribir esto:
// - UN SOLO proceso alcanza para toda la app — `session.create`/`session.prompt` aceptan un
//   `directory` por request (query param), no hace falta un proceso por proyecto/worktree.
// - El vocabulario de eventos realmente emitido es `message.part.delta` (streaming token a token,
//   con `field:"text"`) + `message.part.updated` (estado completo de una part — texto final, o un
//   tool call con `state.status: pending|running|completed|error`) + `permission.asked`/`.replied`.
//   La familia "session.next.*" del OpenAPI (más granular) NO se vio disparar en la práctica.
// - `permission.asked` es real: a diferencia de MiMo (nunca pide permiso), OpenCode sí lo hace por
//   herramienta/acción (ej. escribir fuera de ciertos paths) — verificado con un tool call real.
// - El reply de permisos (`postSessionIdPermissionsPermissionId`) es el único método que expone esta
//   versión del SDK para eso (aunque el endpoint REST está marcado deprecated en favor de uno sin
//   scope de sesión que el SDK 1.18.3 todavía no envuelve) — funciona, se revisará si el SDK agrega
//   un wrapper más nuevo en una actualización futura.
// Subpath "/client" a propósito (no el root "."): el root re-exporta también server.js, que trae
// cross-spawn/which (Node-only, referencian `process` global) para SU función createOpencode() que
// spawnea el proceso — nosotros ya spawneamos desde Rust y solo necesitamos el cliente HTTP puro.
// Importar el root rompía el mount de React en el webview (ReferenceError: process is not defined),
// verificado con Vite dep pre-bundling + CDP antes de este fix.
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { opencodeServeEnsure, opencodeServeStop, opencodeEventsStart, opencodeEventsStop, isTauri } from "./tauriApi";
import { useSettingsStore } from "../store/settingsStore";
import { PROVIDER_KEY_SPECS } from "./providers";
import { pickModel, recordModelUse, type TaskProfile } from "./modelRouter";
import { providerKeysEnv } from "./acpClient";
import type { SessionUpdate, PermissionRequest, PermissionOption, ModelOption, ModelInfo } from "./acpClient";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;
type UpdateListener = (provider: string, sessionId: string, update: SessionUpdate) => void;
type PermissionListener = (req: PermissionRequest) => void;
type ModelOptionsListener = (provider: string, sessionId: string, info: ModelInfo) => void;

const updateListeners = new Set<UpdateListener>();
const permissionListeners = new Set<PermissionListener>();
const modelOptionsListeners = new Set<ModelOptionsListener>();

// Modelo elegido por sesión (`provider:sessionId` → "providerID/modelID"). A diferencia de ACP, acá
// no hay un "session/set_config_option" que persista server-side: el modelo se manda en CADA
// session.prompt, así que "cambiar el modelo de la sesión" es simplemente actualizar este mapa local.
const modelBySession = new Map<string, string>();
// partID → "text"|"reasoning", poblado por el primer message.part.updated de esa part (llega vacía,
// antes de que empiecen los deltas) — así los deltas (que no llevan el type) saben a qué bloque van.
const partTypeCache = new Map<string, "text" | "reasoning">();
// callID ya visto una vez → los eventos siguientes son "tool_call_update", no "tool_call" (mismo
// criterio que ACP: la detección de uso de skill en ChatView solo corre en la creación).
const toolSeenCache = new Set<string>();

let clientPromise: Promise<{ client: OpencodeClient; port: number }> | null = null;
// El listen(opencode-event:...) del frontend se registra UNA sola vez y sobrevive a restart() —
// mismo criterio que acpClient.listenerAttached (ver su comentario). El hilo de Rust que lee el SSE
// (opencode_events_start), en cambio, SÍ hay que re-arrancarlo después de cada restart (otro puerto,
// otro proceso) — por eso está desacoplado de este flag y se llama en cada ensureServer/ensureEventBridge
// (opencode_events_start es idempotente del lado de Rust si ya está corriendo para ese provider).
let frontendListenerAttached = false;
let providersCache: Promise<any> | null = null;

// `cwd`: si se pasa, además garantiza el puente de eventos para ESE directory (ver
// ensureEventBridge) — pasarlo desde cualquier llamada que vaya a crear una sesión o mandar un
// prompt en ese directory. Las llamadas que no tocan sesiones (ej. listAvailableModels) lo omiten.
async function ensureServer(provider: string, cwd?: string): Promise<OpencodeClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
      const port = await opencodeServeEnsure(provider, providerKeysEnv());
      const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${port}` });
      return { client, port };
    })();
  }
  const { client, port } = await clientPromise;
  if (cwd) await ensureEventBridge(provider, cwd, port);
  return client;
}

// El streaming real de /event lo hace Rust (opencode_events_start), no el webview: verificado
// empíricamente que WebView2 no entrega el body de un fetch()/EventSource de streaming de forma
// incremental (con fetch()+reader manual Y con EventSource nativo, disparando el turno desde un
// proceso EXTERNO vía curl para descartar contención de conexiones del propio navegador: en ambos
// casos solo llegaba el primer evento "server.connected", nunca los de mensajes/tool-calls, aunque
// el server sí los emitía). Además, /event sin `directory` queda scopeado al cwd del PROCESO
// opencode serve (casi nunca el del proyecto real en uso) — verificado empíricamente: sesiones
// creadas y prompteadas con éxito en otro directory nunca emitían eventos hasta pasar
// `?directory=<mismo path>` explícito. Por eso el hilo de Rust es por (provider, directory) — una
// app puede tener sesiones abiertas en varios proyectos/worktrees a la vez. Todos reenvían al MISMO
// canal `opencode-event:{provider}` (los eventos ya traen sessionID, global y suficiente para rutear).
const bridgedDirectories = new Set<string>();
async function ensureEventBridge(provider: string, cwd: string, port: number): Promise<void> {
  if (!frontendListenerAttached) {
    frontendListenerAttached = true;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>(`opencode-event:${provider}`, (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.payload);
      } catch {
        return;
      }
      handleEvent(provider, msg);
    });
  }
  const key = `${provider}:${cwd}`;
  if (bridgedDirectories.has(key)) return;
  bridgedDirectories.add(key);
  await opencodeEventsStart(provider, cwd, port);
}

function mapOpenCodeStatus(status?: string): string {
  if (status === "completed") return "completed";
  if (status === "error") return "failed";
  if (status === "running") return "in_progress";
  return "pending";
}

function handleEvent(provider: string, event: any) {
  const type = event?.type as string | undefined;
  const props = event?.properties ?? event?.data;
  if (!type || !props) return;

  if (type === "message.part.delta" && props.field === "text") {
    const partId = props.partID as string;
    const sessionId = props.sessionID as string;
    const partKind = partTypeCache.get(partId) ?? "text";
    const update: SessionUpdate =
      partKind === "reasoning"
        ? { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: props.delta }, messageId: props.messageID }
        : { sessionUpdate: "agent_message_chunk", content: { type: "text", text: props.delta } };
    for (const l of updateListeners) l(provider, sessionId, update);
    return;
  }

  if (type === "message.part.updated") {
    const part = props.part;
    const sessionId = props.sessionID as string;
    if (!part) return;

    if (part.type === "text" || part.type === "reasoning") {
      // El contenido incremental ya viaja por message.part.delta — acá solo registramos el tipo
      // para que los deltas de esta part sepan si van a "ai" o a "thought".
      partTypeCache.set(part.id, part.type);
      return;
    }

    if (part.type === "tool") {
      const callId = part.callID as string;
      const state = part.state ?? {};
      const isExecute = part.tool === "bash";
      const title = state.title ?? part.tool ?? "Tool call";
      const output: string | undefined =
        typeof state.output === "string" ? state.output : typeof state.metadata?.output === "string" ? state.metadata.output : undefined;
      const kind = toolSeenCache.has(callId) ? "tool_call_update" : "tool_call";
      toolSeenCache.add(callId);
      const update: SessionUpdate = {
        sessionUpdate: kind,
        toolCallId: callId,
        title,
        kind: isExecute ? "execute" : part.tool,
        status: mapOpenCodeStatus(state.status),
        rawInput: isExecute ? { command: state.input?.command } : undefined,
        rawOutput: isExecute ? { metadata: { exit: state.metadata?.exit } } : undefined,
        content: output !== undefined ? [{ type: "content", content: { type: "text", text: output } }] : undefined,
      };
      for (const l of updateListeners) l(provider, sessionId, update);
      return;
    }
    return;
  }

  if (type === "permission.asked") {
    void handlePermissionAsked(provider, props);
    return;
  }
}

async function replyPermission(sessionId: string, permissionId: string, response: "once" | "always" | "reject") {
  const { client } = await clientPromise!;
  await client
    .postSessionIdPermissionsPermissionId({ path: { id: sessionId, permissionID: permissionId }, body: { response } })
    .catch(() => {});
}

async function handlePermissionAsked(provider: string, props: any) {
  const permId = props.id as string;
  const sessionId = props.sessionID as string;
  const toolCall = {
    title: (props.permission as string) ?? "acción",
    kind: props.permission,
    content: Array.isArray(props.patterns) && props.patterns.length
      ? [{ type: "content", content: { type: "text", text: props.patterns.join("\n") } }]
      : [],
  };
  const options: PermissionOption[] = [
    { optionId: "once", name: "Allow once", kind: "allow-once" },
    { optionId: "always", name: "Always allow", kind: "allow-always" },
    { optionId: "reject", name: "Deny", kind: "reject" },
  ];

  if (permissionListeners.size === 0) {
    // Mismo criterio que acpClient.handleClientRequest: sin UI montada, se respeta la postura
    // configurada en Settings en vez de aprobar en silencio.
    const { autoApprovePermissions, logPermission } = useSettingsStore.getState();
    if (autoApprovePermissions) {
      logPermission({ provider, tool: toolCall.title, decision: "auto-allow" });
      await replyPermission(sessionId, permId, "once");
    } else {
      logPermission({ provider, tool: toolCall.title, decision: "auto-deny" });
      await replyPermission(sessionId, permId, "reject");
    }
    return;
  }
  const req: PermissionRequest = { provider, id: permId, sessionId, toolCall, options };
  for (const l of permissionListeners) l(req);
  // no reply acá: la UI decide y llama resolvePermission/cancelPermission
}

// Catálogo de modelos disponibles: TODOS los del provider "opencode" (gratis, sin key — OpenCode
// Zen) más los de cualquier provider con una API key cargada en Settings (mismo criterio que ACP:
// providerKeysEnv() define qué está "disponible"). El catálogo completo tiene cientos de providers
// sin key configurada — listarlos todos sería ruido inútil en el selector.
async function listAvailableModels(provider: string): Promise<ModelOption[]> {
  const client = await ensureServer(provider);
  if (!providersCache) providersCache = client.provider.list().catch(() => ({ data: { all: [] } }));
  const res = await providersCache;
  const keys = providerKeysEnv();
  const keyedIds = new Set(PROVIDER_KEY_SPECS.filter((s) => keys[s.envVar]).map((s) => s.id));
  const out: ModelOption[] = [];
  for (const p of res?.data?.all ?? []) {
    if (p.id !== "opencode" && !keyedIds.has(p.id)) continue;
    for (const m of Object.values(p.models ?? {}) as any[]) {
      out.push({ value: `${p.id}/${m.id}`, label: `${p.name ?? p.id} · ${m.name ?? m.id}` });
    }
  }
  return out;
}

export function onModelOptions(cb: ModelOptionsListener): () => void {
  modelOptionsListeners.add(cb);
  return () => modelOptionsListeners.delete(cb);
}

// A diferencia de ACP, no hay un request de red para "cambiar el modelo de la sesión" — el modelo
// se manda en cada session.prompt, así que esto solo actualiza el mapa local que prompt() lee.
export async function setSessionModel(provider: string, sessionId: string, value: string): Promise<void> {
  modelBySession.set(`${provider}:${sessionId}`, value);
}

export function getSessionModel(provider: string, sessionId: string): string | null {
  return modelBySession.get(`${provider}:${sessionId}`) ?? null;
}

export async function newSession(provider: string, cwd: string, preferredModel?: string, taskProfile?: TaskProfile): Promise<string> {
  const client = await ensureServer(provider, cwd);
  const session = await client.session.create({ body: {}, query: { directory: cwd } });
  const sessionId = (session.data as any).id as string;

  const available = await listAvailableModels(provider);
  const has = (v?: string | null): v is string => !!v && available.some((o) => o.value === v);
  let target: string | null = null;
  if (has(preferredModel)) target = preferredModel;
  else if (taskProfile) target = pickModel(taskProfile, available);
  if (!target) {
    // Sin preferencia: preferimos un modelo gratis de OpenCode Zen (siempre "andando", sin
    // depender de que el usuario haya cargado una key) sobre dejar que el server elija su propio
    // default de cuenta — mismo espíritu que el fallback anti-modelo-deprecado que ya existe para MiMo.
    const zen = available.find((o) => o.value.startsWith("opencode/"));
    if (zen) target = zen.value;
  }
  const current = target ?? available[0]?.value ?? null;
  if (current) modelBySession.set(`${provider}:${sessionId}`, current);
  for (const l of modelOptionsListeners) l(provider, sessionId, { available, current });
  return sessionId;
}

export async function prompt(provider: string, sessionId: string, cwd: string, text: string): Promise<{ stopReason: string }> {
  const client = await ensureServer(provider, cwd);
  const modelValue = modelBySession.get(`${provider}:${sessionId}`);
  if (modelValue) recordModelUse(modelValue);
  let model: { providerID: string; modelID: string } | undefined;
  if (modelValue) {
    const [providerID, ...rest] = modelValue.split("/");
    if (providerID && rest.length) model = { providerID, modelID: rest.join("/") };
  }
  const result = await client.session.prompt({
    path: { id: sessionId },
    query: { directory: cwd },
    body: { parts: [{ type: "text", text }], ...(model ? { model } : {}) },
  });
  const info = (result.data as any)?.info;
  if (info?.error) {
    const msg = info.error.data?.message ?? info.error.name ?? "OpenCode error";
    throw new Error(msg);
  }
  return { stopReason: info?.finish ?? "stop" };
}

export function onUpdate(cb: UpdateListener): () => void {
  updateListeners.add(cb);
  return () => updateListeners.delete(cb);
}

export function onPermissionRequest(cb: PermissionListener): () => void {
  permissionListeners.add(cb);
  return () => permissionListeners.delete(cb);
}

// provider: sin uso acá (el reply solo necesita sessionId+permissionID) — se mantiene en la firma
// para que ChatView pueda llamar a este cliente y a acpClient de forma uniforme.
export function resolvePermission(_provider: string, id: number | string, optionId: string, sessionId?: string): void {
  void replyPermission(sessionId ?? "", String(id), optionId as "once" | "always" | "reject");
}

export function cancelPermission(_provider: string, id: number | string, sessionId?: string): void {
  void replyPermission(sessionId ?? "", String(id), "reject");
}

// Aborta el turno en curso de una sesión (equivalente a acpClient.cancel). A diferencia de ACP, acá
// no hay pending requests locales que destrabar a mano: session.abort hace que la llamada HTTP en
// vuelo de session.prompt resuelva/falle del lado del servidor.
export function cancel(provider: string, sessionId: string): void {
  void (async () => {
    try {
      const client = await ensureServer(provider);
      await client.session.abort({ path: { id: sessionId } });
    } catch {
      // best-effort
    }
  })();
}

// Mata el proceso `opencode serve` y resetea el estado del cliente — se usa tras cambiar API keys
// (mismo call site que acpClient.restart: AddModelModal/SettingsView/TeamView), así el próximo
// ensureServer() spawnea un proceso fresco con las keys nuevas.
export async function restart(provider: string): Promise<void> {
  try {
    await opencodeEventsStop(provider);
  } catch {
    // best-effort
  }
  try {
    await opencodeServeStop(provider);
  } catch {
    // best-effort
  }
  clientPromise = null;
  // frontendListenerAttached se mantiene en true a propósito (mismo criterio que acpClient.restart):
  // el listen(opencode-event:...) del frontend sobrevive al reinicio del proceso — Rust vuelve a
  // llamar opencode_events_start (mismo nombre de canal) la próxima vez que ensureServer lo pida,
  // re-attachar acá duplicaría el handler. bridgedDirectories SÍ se limpia: opencodeEventsStop mató
  // los hilos de Rust de todos los directorios, hay que re-pedirlos con el proceso/puerto nuevo.
  bridgedDirectories.clear();
  providersCache = null;
  modelBySession.clear();
  partTypeCache.clear();
  toolSeenCache.clear();
}

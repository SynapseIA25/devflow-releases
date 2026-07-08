// JSON-RPC 2.0 client for the Agent Client Protocol (ACP). Habla con uno o más procesos
// agente (mimo, hermes, ...) spawneados por Rust (acp_start/acp_send), uno por provider —
// cada provider tiene su propio child process, su propio espacio de ids JSON-RPC y su
// propio listener de eventos. Rust solo pipea líneas crudas — toda la lógica de framing,
// correlación de ids y protocolo vive acá.
import { acpStart, acpStop, acpSend, readTextFile, writeTextFile, isTauri } from "./tauriApi";
import { useSettingsStore } from "../store/settingsStore";

export type AcpSpawnConfig = { command: string; args: string[] };

export type SessionUpdate = { sessionUpdate: string } & Record<string, unknown>;
type UpdateListener = (provider: string, sessionId: string, update: SessionUpdate) => void;

export type PermissionOption = { optionId: string; name?: string; kind?: string };
export type PermissionRequest = {
  provider: string;
  id: number;
  sessionId: string;
  toolCall?: Record<string, unknown>;
  options: PermissionOption[];
};
type PermissionListener = (req: PermissionRequest) => void;

// sessionId: qué sesión originó la request (solo lo llevan las requests largas como session/prompt).
// Permite que cancel() rechace SOLO los pending de la sesión que se detiene, sin matar prompts en
// vuelo de otros workspaces que comparten el mismo proceso agente (mimo/hermes = un proceso por provider).
type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void; sessionId?: string };

type ProviderState = {
  started: boolean;
  listenerAttached: boolean;
  nextId: number;
  pending: Map<number, PendingRequest>;
  initPromise: Promise<unknown> | null;
};

const providerStates = new Map<string, ProviderState>();
const updateListeners = new Set<UpdateListener>();
const permissionListeners = new Set<PermissionListener>();

function stateFor(provider: string): ProviderState {
  let s = providerStates.get(provider);
  if (!s) {
    s = { started: false, listenerAttached: false, nextId: 1, pending: new Map(), initPromise: null };
    providerStates.set(provider, s);
  }
  return s;
}

async function attachListener(provider: string) {
  const s = stateFor(provider);
  if (s.listenerAttached) return;
  s.listenerAttached = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>(`acp-message:${provider}`, (event) => {
    let msg: any;
    try {
      msg = JSON.parse(event.payload);
    } catch {
      return;
    }
    handleMessage(provider, msg);
  });
}

async function ensureStarted(provider: string, spawn: AcpSpawnConfig): Promise<void> {
  const s = stateFor(provider);
  if (s.started) return;
  if (!isTauri()) throw new Error("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
  await attachListener(provider);
  await acpStart(provider, spawn.command, spawn.args);
  s.started = true;
}

function send(provider: string, payload: Record<string, unknown>) {
  return acpSend(provider, JSON.stringify(payload));
}

function sendRequest<T = unknown>(provider: string, method: string, params?: unknown, sessionId?: string): Promise<T> {
  const s = stateFor(provider);
  const id = s.nextId++;
  return new Promise<T>((resolve, reject) => {
    s.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, sessionId });
    send(provider, { jsonrpc: "2.0", id, method, params }).catch((e) => {
      s.pending.delete(id);
      reject(e);
    });
  });
}

function respond(provider: string, id: number, result: unknown) {
  send(provider, { jsonrpc: "2.0", id, result }).catch(() => {});
}

function respondError(provider: string, id: number, code: number, message: string) {
  send(provider, { jsonrpc: "2.0", id, error: { code, message } }).catch(() => {});
}

async function handleClientRequest(provider: string, id: number, method: string, params: any) {
  try {
    if (method === "fs/read_text_file") {
      const content = await readTextFile(params?.path, params?.line, params?.limit);
      respond(provider, id, { content });
      return;
    }
    if (method === "fs/write_text_file") {
      await writeTextFile(params?.path, params?.content ?? "");
      respond(provider, id, {});
      return;
    }
    if (method === "session/request_permission") {
      const options: PermissionOption[] = params?.options ?? [];
      if (!options.length) {
        respondError(provider, id, -32603, "No hay opciones de permiso disponibles");
        return;
      }
      if (permissionListeners.size === 0) {
        // Sin UI montada para aprobar (ej. workflow headless). Antes se auto-aprobaba en silencio la
        // primera opción "allow*" → un agente en un workflow aprobaba TODOS sus permisos solo. Ahora
        // la postura por defecto es DENEGAR (cancelled): más seguro. El usuario puede habilitar el
        // auto-approve explícitamente en Settings (autoApprovePermissions). Toda decisión se loguea.
        const { autoApprovePermissions, logPermission } = useSettingsStore.getState();
        const toolName = (params?.toolCall?.title as string) ?? (params?.toolCall?.kind as string) ?? "acción";
        if (autoApprovePermissions) {
          const allowOption = options.find((o) => o.kind?.startsWith("allow")) ?? options[0];
          logPermission({ provider, tool: toolName, decision: "auto-allow" });
          respond(provider, id, { outcome: { outcome: "selected", optionId: allowOption.optionId } });
        } else {
          logPermission({ provider, tool: toolName, decision: "auto-deny" });
          respond(provider, id, { outcome: { outcome: "cancelled" } });
        }
        return;
      }
      const req: PermissionRequest = { provider, id, sessionId: params?.sessionId, toolCall: params?.toolCall, options };
      for (const l of permissionListeners) l(req);
      // no respond() acá: la UI decide y llama resolvePermission/cancelPermission
      return;
    }
    // terminal/* and anything else: not implemented client-side (agent should exec locally)
    respondError(provider, id, -32601, `Method not found: ${method}`);
  } catch (e) {
    respondError(provider, id, -32603, e instanceof Error ? e.message : String(e));
  }
}

function handleMessage(provider: string, msg: any) {
  const s = stateFor(provider);
  if (msg.id !== undefined && msg.method === undefined) {
    // response to one of our requests
    const p = s.pending.get(msg.id);
    if (!p) return;
    s.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "ACP error"));
    else p.resolve(msg.result);
    return;
  }
  if (msg.id !== undefined && msg.method !== undefined) {
    // request from the agent to us
    void handleClientRequest(provider, msg.id, msg.method, msg.params);
    return;
  }
  if (msg.method === "session/update") {
    const sessionId = msg.params?.sessionId;
    const update = msg.params?.update;
    if (sessionId && update) {
      for (const l of updateListeners) l(provider, sessionId, update);
    }
  }
  // other notifications: no-op for now
}

export async function initialize(provider: string, spawn: AcpSpawnConfig): Promise<unknown> {
  const s = stateFor(provider);
  if (!s.initPromise) {
    s.initPromise = (async () => {
      await ensureStarted(provider, spawn);
      return sendRequest(provider, "initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
        clientInfo: { name: "devflow", title: "DevFlow", version: "0.1.0" },
      });
    })();
  }
  return s.initPromise;
}

type ConfigOption = { id: string; options?: Array<{ value: string }> };

// MiMo: modelo conocido y siempre disponible (canal gratuito MiMo Auto). El default que trae
// la cuenta puede quedar apuntando a un modelo deprecado/no soportado (visto en la práctica:
// "xiaomi/mimo-v2.5-pro-ultraspeed"), así que cada sesión nueva lo fija explícitamente.
// Otros providers (ej. Hermes) no tienen este problema — usan el modelo que ya quedó
// configurado globalmente (hermes config set model.default ...).
const MIMO_PREFERRED_MODEL = "mimo/mimo-auto";

export async function newSession(provider: string, spawn: AcpSpawnConfig, cwd: string): Promise<string> {
  await initialize(provider, spawn);
  const result = await sendRequest<{ sessionId: string; configOptions?: ConfigOption[] }>(provider, "session/new", {
    cwd,
    mcpServers: [],
  });
  if (provider === "mimo") {
    const modelOption = result.configOptions?.find((o) => o.id === "model");
    if (modelOption?.options?.some((o) => o.value === MIMO_PREFERRED_MODEL)) {
      try {
        await sendRequest(provider, "session/set_config_option", {
          sessionId: result.sessionId,
          configId: "model",
          value: MIMO_PREFERRED_MODEL,
        });
      } catch {
        // si falla, seguimos con el modelo default de la sesión en vez de bloquear el chat
      }
    }
  }
  return result.sessionId;
}

export async function prompt(provider: string, sessionId: string, text: string): Promise<{ stopReason: string }> {
  return sendRequest(provider, "session/prompt", {
    sessionId,
    prompt: [{ type: "text", text }],
  }, sessionId);
}

export function onUpdate(cb: UpdateListener): () => void {
  updateListeners.add(cb);
  return () => updateListeners.delete(cb);
}

export function onPermissionRequest(cb: PermissionListener): () => void {
  permissionListeners.add(cb);
  return () => permissionListeners.delete(cb);
}

export function resolvePermission(provider: string, id: number, optionId: string) {
  respond(provider, id, { outcome: { outcome: "selected", optionId } });
}

export function cancelPermission(provider: string, id: number) {
  respond(provider, id, { outcome: { outcome: "cancelled" } });
}

// Detener el turno en curso de una sesión. Manda la notificación ACP `session/cancel` (best-effort:
// el agente debería abortar y cerrar el turno) y, además, destraba localmente cualquier request que
// estemos esperando —típicamente `session/prompt`—. Esto último es clave: si el agente quedó colgado
// (ej. ejecutando un proceso de larga duración que no termina), nunca va a responder al cancel, así
// que no podemos depender de su respuesta para re-habilitar el chat. `__turn_cancelled__` es un
// sentinel que el llamador (runAcp) reconoce para no mostrarlo como error.
export function cancel(provider: string, sessionId: string): void {
  const s = stateFor(provider);
  send(provider, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }).catch(() => {});
  // Solo destrabamos los pending de ESTA sesión: cancelar un turno no debe matar prompts en vuelo
  // de otros workspaces que corren sobre el mismo proceso agente (misma provider, sesión distinta).
  for (const [id, p] of s.pending) {
    if (p.sessionId !== sessionId) continue;
    s.pending.delete(id);
    p.reject(new Error("__turn_cancelled__"));
  }
}

// Reinicia el proceso agente de un provider desde cero: mata el proceso hijo (acp_stop) y resetea el
// estado del cliente (started/initPromise/nextId/pending) para que el próximo newSession spawnee un
// proceso FRESCO y re-haga el handshake initialize. Se usa antes de cada corrida de auto-delegación:
// abrir muchas sesiones seguidas puede "wedgear" el proceso mimo compartido (un turno colgado deja al
// proceso sin responder los siguientes) — arrancar fresco lo evita. IMPORTANTE: invalida las sesiones
// abiertas de ese provider (sus sessionId dejan de existir en el proceso nuevo); el llamador debe
// limpiar esos sessionId (ej. workspaceStore.resetSessions) para que se recreen solos.
export async function restart(provider: string): Promise<void> {
  const s = stateFor(provider);
  // Destrabamos cualquier request en vuelo (no van a responder — el proceso se va a matar).
  for (const [id, p] of s.pending) {
    s.pending.delete(id);
    p.reject(new Error("__acp_restarted__"));
  }
  try {
    await acpStop(provider);
  } catch {
    // best-effort: aunque falle el stop, reseteamos el estado para forzar un start nuevo
  }
  s.started = false;
  s.initPromise = null;
  s.nextId = 1;
  s.pending.clear();
  // listenerAttached se mantiene: el `listen(acp-message:<provider>)` del frontend sobrevive al
  // reinicio del proceso (Rust re-emite en el mismo canal), y re-attachar duplicaría el handler.
}

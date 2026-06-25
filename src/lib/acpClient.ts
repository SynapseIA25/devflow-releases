// JSON-RPC 2.0 client for the Agent Client Protocol (ACP). Habla con uno o más procesos
// agente (mimo, hermes, ...) spawneados por Rust (acp_start/acp_send), uno por provider —
// cada provider tiene su propio child process, su propio espacio de ids JSON-RPC y su
// propio listener de eventos. Rust solo pipea líneas crudas — toda la lógica de framing,
// correlación de ids y protocolo vive acá.
import { acpStart, acpSend, readTextFile, writeTextFile, isTauri } from "./tauriApi";

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

type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void };

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

function sendRequest<T = unknown>(provider: string, method: string, params?: unknown): Promise<T> {
  const s = stateFor(provider);
  const id = s.nextId++;
  return new Promise<T>((resolve, reject) => {
    s.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
        // sin UI montada para aprobar (ej. uso headless): fail-safe a la primera opción "allow*"
        // para no dejar al agente colgado esperando una respuesta que nunca llega.
        const allowOption = options.find((o) => o.kind?.startsWith("allow")) ?? options[0];
        respond(provider, id, { outcome: { outcome: "selected", optionId: allowOption.optionId } });
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
  });
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

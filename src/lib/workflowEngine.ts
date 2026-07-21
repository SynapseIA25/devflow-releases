// Motor de ejecución de workflows. Recorre el grafo en orden topológico, ejecuta cada nodo
// según su tipo reusando la infraestructura ya existente (readTextFile/writeTextFile,
// runShellCommand, acpClient) y maneja branching condicional + stop-on-error.
//
// Diseño acordado (ver memoria devflow-fase1-design):
// - Variables nombradas: cada nodo registra su resultado bajo su id; cualquier campo de texto
//   puede referenciar {{<id>.output|exitCode|branch}} de cualquier nodo aguas arriba. {{input}}
//   es azúcar = concatenación de los predecesores directos activos.
// - Condición: misma sustitución de templating + new Function (input del propio usuario en una
//   herramienta local de dev, no input no confiable).
// - mimo/agent: sesión ACP REUSADA por corrida (una por agente, keyed en SessionCache) → el contexto
//   se acumula entre nodos del mismo agente y se paga un solo session/new. Los loops aíslan una caché
//   por item (en paralelo no se puede compartir una sesión). Permisos: WorkflowView no monta el
//   listener → acpClient cae al fail-safe allow-first-option ya existente.
import { runShellCommand, readTextFile, writeTextFile, httpRequest, mcpCallTool } from "./tauriApi";
import * as acpClient from "./acpClient";
import * as opencodeClient from "./opencodeClient";
import { DEFAULT_PROVIDERS, type ProviderConfig } from "./providers";
import { TASK_PROFILES, type TaskProfile } from "./modelRouter";
import { useProjectStore } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useSettingsStore } from "../store/settingsStore";
import type { Edge } from "@xyflow/react";
import type { WorkflowNode, NodeStatus } from "../store/workflowStore";
import type { LogEntry } from "../components/OutputPanel";
import { resolveTemplate, parseList, type NodeResult } from "./workflowTemplate";

export type { NodeResult };

export type EngineCallbacks = {
  onLog: (level: LogEntry["level"], message: string) => void;
  setNodeStatus: (id: string, status: NodeStatus) => void;
  isCancelled: () => boolean;
  // Resuelve un nodo "subflow" a su flujo referenciado (referencia viva, no copia). Si falta,
  // los nodos subflow fallan con un error claro.
  resolveFlow?: (flowId: string) => { name: string; nodes: WorkflowNode[]; edges: Edge[] } | undefined;
  // Se llama cuando un nodo file escribe un archivo — la UI lo ofrece para abrir en el editor.
  onFileWritten?: (path: string) => void;
};

// ── Orden topológico (Kahn) ─────────────────────────────────────────────────
// Devuelve los ids en orden topológico, o null si hay un ciclo.
function topoSort(nodes: WorkflowNode[], edges: Edge[]): string[] | null {
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    successors.set(n.id, []);
  }
  for (const e of edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue; // edge colgante
    successors.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of successors.get(id) ?? []) {
      const d = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return order.length === nodes.length ? order : null;
}

// ── Ejecutores por tipo ─────────────────────────────────────────────────────
async function execFile(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const path = resolveTemplate(String(node.data.path ?? ""), results, input);
  const op = node.data.operation === "write" ? "write" : "read";
  if (!path) throw new Error("Path vacío");
  if (op === "read") {
    const content = await readTextFile(path);
    cb.onLog("info", `📄 Read ${path} (${content.length} chars)`);
    return { output: content };
  }
  await writeTextFile(path, input);
  cb.onLog("success", `📄 Wrote ${input.length} chars to ${path}`);
  cb.onFileWritten?.(path);
  return { output: "" };
}

async function execTerminal(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const command = resolveTemplate(String(node.data.command ?? ""), results, input);
  if (!command.trim()) throw new Error("Comando vacío");
  cb.onLog("info", `$ ${command}`);
  const res = await runShellCommand(command, useProjectStore.getState().projectPath);
  if (res.output.trim()) cb.onLog(res.exitCode === 0 ? "info" : "error", res.output.trimEnd());
  cb.onLog(res.exitCode === 0 ? "success" : "error", `[exit code ${res.exitCode}]`);
  return { output: res.output, exitCode: res.exitCode };
}

function execCondition(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): NodeResult {
  const raw = String(node.data.condition ?? "");
  const resolved = resolveTemplate(raw, results, input);
  let truthy: boolean;
  try {
    // eslint-disable-next-line no-new-func
    truthy = Boolean(new Function(`return (${resolved});`)());
  } catch (e) {
    throw new Error(`Condición inválida "${resolved}": ${e instanceof Error ? e.message : String(e)}`);
  }
  const branch: "true" | "false" = truthy ? "true" : "false";
  cb.onLog("info", `🔀 ${resolved || "(vacío)"} → ${branch}`);
  return { output: String(truthy), branch };
}

// Caché de sesiones ACP de UNA corrida de workflow (keyed por identidad de agente). Los nodos del
// mismo agente comparten sesión → el contexto se acumula entre nodos (el agente "recuerda" lo anterior)
// y se paga un solo initialize/session/new en vez de uno por nodo. Se descarta al terminar la corrida
// (cada runWorkflow arranca con una caché nueva; una corrida no hereda el contexto de la anterior).
type SessionCache = Map<string, string>; // key -> sessionId

async function acquireSession(
  sessions: SessionCache,
  key: string,
  provider: ProviderConfig,
  taskProfile?: TaskProfile
): Promise<{ sessionId: string; isNew: boolean }> {
  const existing = sessions.get(key);
  if (existing) return { sessionId: existing, isNew: false };
  const preferredModel = useSettingsStore.getState().modelByProvider[provider.id];
  const cwd = useProjectStore.getState().projectPath;
  const sessionId = provider.nativeHttp
    ? await opencodeClient.newSession(provider.id, cwd, preferredModel, taskProfile)
    : await acpClient.newSession(provider.id, provider.acp!, cwd, preferredModel, taskProfile);
  sessions.set(key, sessionId);
  return { sessionId, isNew: true };
}

// Perfil de tarea de un nodo agente/mimo: el del nodo si se eligió en el inspector, si no el del
// agente. Solo tiene efecto sobre providers multi-modelo (OpenCode): la sesión se abre con el mejor
// modelo GRATIS para el perfil (modelRouter, cuota-consciente). Nota: la preferencia global de modelo
// del usuario (modelByProvider) sigue teniendo prioridad sobre el perfil en newSession.
function nodeTaskProfile(node: WorkflowNode, agentProfile?: TaskProfile): TaskProfile | undefined {
  const raw = node.data.taskProfile;
  const valid = TASK_PROFILES.some((p) => p.id === raw);
  return valid ? (raw as TaskProfile) : agentProfile;
}

// Manda un prompt a una sesión (ACP o el servidor nativo de OpenCode) y acumula el texto de la
// respuesta de ese turno. opencodeClient emite el mismo shape de SessionUpdate que acpClient.
async function promptAndCollect(provider: ProviderConfig, sessionId: string, promptText: string): Promise<string> {
  let text = "";
  const client = provider.nativeHttp ? opencodeClient : acpClient;
  const unsub = client.onUpdate((prov, sid, update) => {
    if (prov !== provider.id || sid !== sessionId) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | string | undefined;
      if (typeof content === "string") text += content;
      else if (content?.type === "text" && typeof content.text === "string") text += content.text;
    }
  });
  try {
    if (provider.nativeHttp) {
      await opencodeClient.prompt(provider.id, sessionId, useProjectStore.getState().projectPath, promptText);
    } else {
      await acpClient.prompt(provider.id, sessionId, promptText);
    }
  } finally {
    unsub();
  }
  return text;
}

async function execMimo(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, sessions: SessionCache): Promise<NodeResult> {
  const mimo = DEFAULT_PROVIDERS.find((p) => p.id === "mimo");
  if (!mimo?.acp) throw new Error("Provider 'mimo' sin configuración ACP");
  const promptText = resolveTemplate(String(node.data.prompt ?? ""), results, input);
  if (!promptText.trim()) throw new Error("Prompt vacío");
  cb.onLog("info", `🤖 MiMo: ${promptText.slice(0, 80)}${promptText.length > 80 ? "…" : ""}`);
  const profile = nodeTaskProfile(node);
  const { sessionId } = await acquireSession(sessions, `mimo:${profile ?? ""}`, mimo, profile);
  const text = await promptAndCollect(mimo, sessionId, promptText);
  cb.onLog("success", `🤖 MiMo respondió (${text.length} chars)`);
  return { output: text };
}

// Nodo agente genérico: como execMimo pero el agente se elige por nodo (data.agentId → agentsStore).
// Solo funcionan los agentes cuyo provider tiene config ACP; el resto tira error claro.
async function execAgent(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, sessions: SessionCache): Promise<NodeResult> {
  const agentId = String(node.data.agentId ?? "");
  const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Nodo agente sin agente seleccionado (o el agente ya no existe)");
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === agent.providerId);
  if (!provider?.acp && !provider?.nativeHttp) throw new Error(`El agente "${agent.name}" no tiene backend ACP ni nativo — elegí uno con motor real (ej. MiMo)`);
  let promptText = resolveTemplate(String(node.data.prompt ?? ""), results, input);
  if (!promptText.trim()) throw new Error("Prompt vacío");
  cb.onLog("info", `🤖 ${agent.name}: ${promptText.slice(0, 80)}${promptText.length > 80 ? "…" : ""}`);
  // Sesión propia por agente (distintos agentes = distinto system prompt/persona = distinta sesión).
  // El perfil entra en la key: dos nodos del mismo agente con perfil distinto usan modelos distintos.
  const profile = nodeTaskProfile(node, agent.taskProfile);
  const { sessionId, isNew } = await acquireSession(sessions, `agent:${agent.id}:${profile ?? ""}`, provider, profile);
  // El system prompt del agente se inyecta una sola vez, en el primer turno de su sesión.
  const systemPrompt = agent.systemPrompt?.trim();
  if (isNew && systemPrompt) promptText = `[System]\n${systemPrompt}\n\n${promptText}`;
  const text = await promptAndCollect(provider, sessionId, promptText);
  cb.onLog("success", `🤖 ${agent.name} respondió (${text.length} chars)`);
  return { output: text };
}

// Nodo HTTP: request genérico vía Rust (sin CORS). Los campos url/headers/body admiten templating.
// exitCode = 0 si la respuesta es 2xx, si no el código HTTP (así un condition puede ramificar sobre
// {{id.exitCode}} y un no-2xx se marca "warn" ámbar, igual que un comando con exit ≠ 0).
async function execHttp(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const method = String(node.data.method ?? "GET");
  const url = resolveTemplate(String(node.data.url ?? ""), results, input);
  if (!url.trim()) throw new Error("URL vacía");
  const headersRaw = resolveTemplate(String(node.data.headers ?? ""), results, input).trim();
  let headers: Record<string, string> = {};
  if (headersRaw) {
    try {
      headers = JSON.parse(headersRaw);
    } catch {
      throw new Error("Los headers deben ser un objeto JSON válido (ej. {\"Authorization\":\"Bearer …\"})");
    }
  }
  const body = resolveTemplate(String(node.data.body ?? ""), results, input);
  cb.onLog("info", `🌐 ${method.toUpperCase()} ${url}`);
  const res = await httpRequest(method, url, headers, body);
  const ok = res.status >= 200 && res.status < 300;
  const preview = res.body.trim().slice(0, 200);
  cb.onLog(ok ? "success" : "error", `↳ ${res.status}${preview ? ` · ${preview}` : ""}`);
  return { output: res.body, exitCode: ok ? 0 : res.status };
}

// Nodo MCP: llama una tool de un MCP server (one-shot: DevFlow spawnea el server, hace el handshake y
// ejecuta tools/call vía el comando Rust mcp_call_tool). Los argumentos admiten templating.
async function execMcp(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const command = String(node.data.command ?? "").trim();
  if (!command) throw new Error("Comando del MCP server vacío (ej. 'uvx code-index-mcp')");
  const tool = String(node.data.tool ?? "").trim();
  if (!tool) throw new Error("Nombre de la tool vacío");
  const argsRaw = resolveTemplate(String(node.data.arguments ?? ""), results, input).trim();
  let args: unknown = {};
  if (argsRaw) {
    try {
      args = JSON.parse(argsRaw);
    } catch {
      throw new Error("Los argumentos deben ser un objeto JSON válido");
    }
  }
  cb.onLog("info", `🧩 MCP ${tool} (${command})`);
  const out = await mcpCallTool(command, {}, tool, args);
  cb.onLog("success", `🧩 ${tool} → ${out.slice(0, 200)}${out.length > 200 ? "…" : ""}`);
  return { output: out };
}

// Nodo loop/foreach: corre el sub-flujo referenciado una vez por cada item de la lista, inyectando el
// item como {{input}} (accesible por campos con {{input.campo}} si es objeto). Secuencial o paralelo
// (Promise.all). Salida = array JSON con la salida de cada iteración. Reusa runGraph + guarda anti-recursión.
async function execLoop(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, stack: Set<string>): Promise<NodeResult> {
  const flowId = String(node.data.flowId ?? "");
  if (!flowId) throw new Error("Loop sin sub-flujo asignado");
  const flow = cb.resolveFlow?.(flowId);
  if (!flow) throw new Error(`Loop: sub-flujo no encontrado (${flowId})`);
  if (stack.has(flowId)) throw new Error(`Recursión de flujos en el loop: "${flow.name}" se incluye a sí mismo`);

  const items = parseList(resolveTemplate(String(node.data.list ?? ""), results, input).trim());
  if (items.length === 0) {
    cb.onLog("warn", `🔁 Loop "${flow.name}": lista vacía, nada que iterar`);
    return { output: "[]" };
  }
  const parallel = node.data.parallel === "parallel";
  cb.onLog("info", `🔁 Loop "${flow.name}" × ${items.length} (${parallel ? "paralelo" : "secuencial"})…`);
  const childStack = new Set(stack).add(flowId);

  const runItem = async (item: unknown, idx: number): Promise<string> => {
    const itemInput = typeof item === "string" ? item : JSON.stringify(item);
    const childCb: EngineCallbacks = {
      onLog: (lvl, msg) => cb.onLog(lvl, `  ↳[${idx + 1}] ${msg}`),
      setNodeStatus: () => {}, // los nodos internos no están en el canvas activo
      isCancelled: cb.isCancelled,
      resolveFlow: cb.resolveFlow,
    };
    // Cada iteración del loop es independiente → caché de sesiones ACP PROPIA (no la del padre).
    // Clave en paralelo: iteraciones concurrentes NO pueden compartir una sesión (los turnos chocarían).
    const r = await runGraph(flow.nodes, flow.edges, childCb, itemInput, childStack, new Map());
    if (r.cancelled) throw new Error("Cancelado");
    if (r.errored) throw new Error(`La iteración ${idx + 1} falló`);
    return r.output;
  };

  let outputs: string[];
  if (parallel) {
    // allSettled (no Promise.all): si una iteración falla, no perdemos las demás. Agregamos los
    // errores por-item en el log; solo propagamos si fallaron TODAS (si algunas anduvieron, seguimos).
    const settled = await Promise.allSettled(items.map((it, i) => runItem(it, i)));
    const errors: string[] = [];
    outputs = settled.map((res, i) => {
      if (res.status === "fulfilled") return res.value;
      errors.push(`#${i + 1}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
      return ""; // placeholder para preservar el orden/índice de las iteraciones
    });
    if (errors.length) {
      cb.onLog("warn", `🔁 Loop "${flow.name}": ${errors.length}/${items.length} iteraciones fallaron → ${errors.join(" · ")}`);
      if (errors.length === items.length) throw new Error(`Todas las iteraciones del loop fallaron: ${errors.join(" · ")}`);
    }
  } else {
    outputs = [];
    for (let i = 0; i < items.length; i++) {
      if (cb.isCancelled()) throw new Error("Cancelado");
      outputs.push(await runItem(items[i], i));
    }
  }
  cb.onLog("success", `🔁 Loop "${flow.name}" completado (${outputs.length} iteraciones)`);
  return { output: JSON.stringify(outputs) };
}

// Ejecuta un nodo sub-flujo corriendo el flujo referenciado entero por dentro. El input del padre
// se inyecta como {{input}} de los nodos de entrada del sub-flujo; el output del sub-flujo es la
// concatenación de las salidas de sus nodos hoja. `stack` evita recursión infinita (un flujo que se
// incluye a sí mismo, directa o indirectamente).
async function execSubflow(node: WorkflowNode, input: string, cb: EngineCallbacks, stack: Set<string>, sessions: SessionCache): Promise<NodeResult> {
  const flowId = String(node.data.flowId ?? "");
  if (!flowId) throw new Error("Sub-flujo sin flujo asignado");
  const flow = cb.resolveFlow?.(flowId);
  if (!flow) throw new Error(`Sub-flujo no encontrado (${flowId})`);
  if (stack.has(flowId)) throw new Error(`Recursión de sub-flujos: "${flow.name}" se incluye a sí mismo`);
  cb.onLog("info", `🧩 Sub-flujo "${flow.name}" (${flow.nodes.length} nodos)…`);
  const childCb: EngineCallbacks = {
    onLog: (lvl, msg) => cb.onLog(lvl, `  ↳ [${flow.name}] ${msg}`),
    setNodeStatus: () => {}, // los nodos internos no están en el canvas activo
    isCancelled: cb.isCancelled,
    resolveFlow: cb.resolveFlow,
  };
  // El sub-flujo comparte la caché de sesiones del padre → un mismo agente sigue la conversación
  // a través del límite del sub-flujo (no re-inicializa ni pierde contexto).
  const sub = await runGraph(flow.nodes, flow.edges, childCb, input, new Set(stack).add(flowId), sessions);
  if (sub.cancelled) throw new Error("Cancelado");
  if (sub.errored) throw new Error(`El sub-flujo "${flow.name}" falló`);
  cb.onLog("success", `🧩 Sub-flujo "${flow.name}" completado (${sub.output.length} chars)`);
  return { output: sub.output };
}

async function execNode(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, stack: Set<string>, sessions: SessionCache): Promise<NodeResult> {
  switch (node.type) {
    case "file": return execFile(node, results, input, cb);
    case "terminal": return execTerminal(node, results, input, cb);
    case "condition": return execCondition(node, results, input, cb);
    case "mimo": return execMimo(node, results, input, cb, sessions);
    case "agent": return execAgent(node, results, input, cb, sessions);
    case "http": return execHttp(node, results, input, cb);
    case "mcp": return execMcp(node, results, input, cb);
    case "loop": return execLoop(node, results, input, cb, stack);
    case "subflow": return execSubflow(node, input, cb, stack, sessions);
    default: throw new Error(`Tipo de nodo desconocido: ${node.type}`);
  }
}

// ── Motor ───────────────────────────────────────────────────────────────────
type GraphRun = { errored: boolean; cancelled: boolean; output: string };

// Recorre y ejecuta un grafo. `initialInput` alimenta el {{input}} de los nodos de entrada (lo usa
// el sub-flujo para pasar el input del padre). `stack` lleva la cadena de flujos en ejecución para
// detectar recursión. Devuelve el resultado agregado (output = salidas de los nodos hoja).
async function runGraph(
  nodes: WorkflowNode[],
  edges: Edge[],
  cb: EngineCallbacks,
  initialInput: string,
  stack: Set<string>,
  sessions: SessionCache
): Promise<GraphRun> {
  if (nodes.length === 0) return { errored: false, cancelled: false, output: "" };

  const order = topoSort(nodes, edges);
  if (!order) {
    cb.onLog("error", "El grafo tiene un ciclo — no se puede ejecutar. Revisá las conexiones.");
    return { errored: true, cancelled: false, output: "" };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, Edge[]>();
  const hasOutgoing = new Set<string>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (incoming.has(e.target)) incoming.get(e.target)!.push(e);
    hasOutgoing.add(e.source);
  }

  const results = new Map<string, NodeResult>(); // solo nodos ejecutados con éxito

  // Una edge entrante está "activa" si su origen corrió con éxito y, si el origen es un
  // condition, el handle de la edge coincide con la rama elegida.
  const isEdgeActive = (e: Edge): boolean => {
    const src = results.get(e.source);
    if (!src) return false;
    const srcNode = nodeById.get(e.source);
    if (srcNode?.type === "condition") return e.sourceHandle === src.branch;
    return true;
  };

  let errored = false;
  for (const id of order) {
    if (cb.isCancelled()) {
      cb.onLog("warn", "Ejecución cancelada.");
      return { errored: false, cancelled: true, output: "" };
    }
    const node = nodeById.get(id)!;
    const inEdges = incoming.get(id) ?? [];
    const active = inEdges.length === 0 || inEdges.some(isEdgeActive);
    if (!active) {
      cb.setNodeStatus(id, "skipped");
      continue;
    }
    const activeIn = inEdges.filter(isEdgeActive);
    // Nodo de entrada (sin edges entrantes) → recibe el input inicial del grafo.
    const input = inEdges.length === 0 ? initialInput : activeIn.map((e) => results.get(e.source)?.output ?? "").join("\n");

    cb.setNodeStatus(id, "running");
    const title = String(node.data.label ?? node.type ?? id);
    // Config genérica de manejo de errores (cualquier nodo, editable en el inspector):
    const retries = Math.max(0, Math.floor(Number(node.data.retries ?? 0)) || 0);
    const onError = node.data.onError === "continue" ? "continue" : "stop";

    let result: NodeResult | undefined;
    let err: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (cb.isCancelled()) { err = new Error("Cancelado"); break; }
      if (attempt > 0) cb.onLog("warn", `↻ Reintento ${attempt}/${retries} de "${title}" (${id})…`);
      try {
        result = await execNode(node, results, input, cb, stack, sessions);
        err = undefined;
        break;
      } catch (e) {
        err = e;
      }
    }

    if (err !== undefined) {
      cb.onLog("error", `✖ "${title}" (${id}) falló: ${err instanceof Error ? err.message : String(err)}`);
      cb.setNodeStatus(id, "error");
      // "Continuar (capturar error)": el nodo queda rojo pero el flujo sigue con salida vacía aguas
      // abajo (try-catch). "Detener": stop-on-error, corta todo el run.
      if (onError === "continue") {
        results.set(id, { output: "", exitCode: 1 });
        continue;
      }
      errored = true;
      break;
    }

    results.set(id, result!);
    // Un comando que corrió pero terminó con exit ≠ 0 NO detiene el flujo (un condition aguas abajo
    // puede ramificar sobre {{id.exitCode}}), pero se marca "warn" (ámbar) vs. un success limpio.
    const ranButNonZero = result!.exitCode !== undefined && result!.exitCode !== 0;
    cb.setNodeStatus(id, ranButNonZero ? "warn" : "success");
  }

  // Output del grafo = salidas de los nodos hoja (sin edges salientes) que corrieron.
  const output = nodes
    .filter((n) => !hasOutgoing.has(n.id))
    .map((n) => results.get(n.id)?.output ?? "")
    .filter((o) => o !== "")
    .join("\n");

  return { errored, cancelled: false, output };
}

export async function runWorkflow(nodes: WorkflowNode[], edges: Edge[], cb: EngineCallbacks, initialInput = ""): Promise<void> {
  if (nodes.length === 0) {
    cb.onLog("warn", "El canvas está vacío — nada que ejecutar.");
    return;
  }
  // Caché de sesiones ACP compartida por toda la corrida (excepto loops, que aíslan por item). Nace
  // vacía en cada runWorkflow → una corrida no hereda contexto de la anterior.
  const sessions: SessionCache = new Map();
  const r = await runGraph(nodes, edges, cb, initialInput, new Set(), sessions);
  if (r.cancelled) return; // ya logueó "Ejecución cancelada."
  if (!r.errored) cb.onLog("success", "✓ Workflow completado.");
  else cb.onLog("error", "Workflow detenido por un error.");
}

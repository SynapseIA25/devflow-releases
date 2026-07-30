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
import { runShellCommand, readTextFile, writeTextFile, httpRequest, httpLoadTest, mcpCallTool } from "./tauriApi";
import * as acpClient from "./acpClient";
import * as opencodeClient from "./opencodeClient";
import { DEFAULT_PROVIDERS, type ProviderConfig } from "./providers";
import { TASK_PROFILES, type TaskProfile } from "./modelRouter";
import { useProjectStore } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useSettingsStore } from "../store/settingsStore";
import type { Edge } from "@xyflow/react";
import { useWorkflowStore, type WorkflowNode, type NodeStatus } from "../store/workflowStore";
import type { LogEntry } from "../components/OutputPanel";
import { resolveTemplate, parseList, type NodeResult } from "./workflowTemplate";
import { NODE_SCHEMAS } from "../nodes/nodeSchema";

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
  // Gate para nodos "file" (escritura) y "terminal": a diferencia de las tool-calls del agente (que
  // ya pasan por el permission_request de acpClient.ts), estos nodos nativos del workflow llamaban a
  // Tauri directo, sin ningún permiso — un trigger/planner headless podía correr shell arbitrario sin
  // que nadie lo viera. Si falta (WorkflowView/ChatView, donde el usuario ya está mirando y disparó
  // la corrida a mano), se comporta como antes: sin gate.
  confirmAction?: (kind: "file-write" | "shell", detail: string) => Promise<boolean>;
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

// Valida un grafo ANTES de guardarlo (usado por devflow_define_workflow del MCP bridge — un agente
// de chat autorando un workflow entero de una tiene más chances de mandar algo roto que la UI, que ya
// previene esto por construcción: el schema de nodos, el picker de conexiones, etc.). No ejecuta nada.
const VAR_REF = /\{\{\s*([a-zA-Z0-9_]+)\.(output|exitCode|branch)\s*\}\}/g;

export function validateWorkflowGraph(nodes: WorkflowNode[], edges: Edge[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(nodes.map((n) => n.id));

  if (ids.size !== nodes.length) errors.push("Hay ids de nodo repetidos.");
  for (const n of nodes) {
    if (!NODE_SCHEMAS[n.type ?? ""]) errors.push(`Nodo "${n.id}": tipo de nodo desconocido "${n.type}".`);
  }
  for (const e of edges) {
    if (!ids.has(e.source)) errors.push(`Edge "${e.id ?? `${e.source}->${e.target}`}": el nodo origen "${e.source}" no existe.`);
    if (!ids.has(e.target)) errors.push(`Edge "${e.id ?? `${e.source}->${e.target}`}": el nodo destino "${e.target}" no existe.`);
  }
  if (edges.every((e) => ids.has(e.source) && ids.has(e.target)) && topoSort(nodes, edges) === null) {
    errors.push("El grafo tiene un ciclo.");
  }
  for (const n of nodes) {
    const schema = NODE_SCHEMAS[n.type ?? ""];
    if (!schema) continue;
    for (const field of schema.fields) {
      if (!field.vars) continue;
      const raw = n.data?.[field.key];
      if (typeof raw !== "string") continue;
      for (const match of raw.matchAll(VAR_REF)) {
        const refId = match[1];
        if (refId !== "input" && !ids.has(refId)) {
          errors.push(`Nodo "${n.id}", campo "${field.key}": referencia "{{${refId}.${match[2]}}}" a un nodo que no existe.`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
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
  if (cb.confirmAction && !(await cb.confirmAction("file-write", path))) {
    throw new Error(`Permiso denegado: escritura de archivo bloqueada (${path})`);
  }
  await writeTextFile(path, input);
  cb.onLog("success", `📄 Wrote ${input.length} chars to ${path}`);
  cb.onFileWritten?.(path);
  return { output: "" };
}

async function execTerminal(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const command = resolveTemplate(String(node.data.command ?? ""), results, input);
  if (!command.trim()) throw new Error("Comando vacío");
  if (cb.confirmAction && !(await cb.confirmAction("shell", command))) {
    throw new Error(`Permiso denegado: comando de shell bloqueado (${command})`);
  }
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

// Traza de tool calls de un turno — capturada solo por verify (ver promptAndCollectWithTrace) para
// poder generar un script determinístico a partir de una exploración exitosa (ver verifyScript.ts).
// No se usa en mimo/agent: agregar esto a TODOS los turnos sería costo de memoria sin beneficio hoy.
export type TraceEntry = { tool: string; input: unknown; output: unknown };
const MAX_TRACE_CHARS = 50_000; // igual criterio que MAX_OUTPUT de testRunner.ts — acotar lo persistido.

// Como promptAndCollect, pero además junta cada tool_call/tool_call_update del turno en un array.
// Seguro por la misma razón que promptAndCollect: tanto acpClient.prompt() como opencodeClient.prompt()
// solo resuelven cuando el turno completo (con todos sus tool calls) terminó — así que todo lo que se
// junte entre el subscribe y el await está garantizado completo antes de leer `trace`.
async function promptAndCollectWithTrace(
  provider: ProviderConfig, sessionId: string, promptText: string
): Promise<{ text: string; trace: TraceEntry[] }> {
  let text = "";
  // Por toolCallId, no un array plano: un tool call real llega como VARIOS eventos para el mismo id
  // (tool_call al arrancar, con input/output todavía vacíos — recién tool_call_update trae el input
  // completo y, más tarde, el output real al terminar) — quedarse solo con "tool_call" (como se hizo
  // en un primer intento) capturaba objetos vacíos. Cada update pisa al anterior; el último gana.
  const byId = new Map<string, TraceEntry>();
  const client = provider.nativeHttp ? opencodeClient : acpClient;
  const unsub = client.onUpdate((prov, sid, update) => {
    if (prov !== provider.id || sid !== sessionId) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | string | undefined;
      if (typeof content === "string") text += content;
      else if (content?.type === "text" && typeof content.text === "string") text += content.text;
    } else if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const u = update as unknown as { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown; rawOutput?: unknown; content?: unknown };
      // rawOutput SIEMPRE viene definido (opencodeClient.ts arma {metadata:...} incondicional, aunque
      // metadata esté vacío) — un `??` contra u.content nunca caía al content real. Se combinan los
      // dos: metadata (ej. exit code) + content (el resultado real, texto/estructura del tool call).
      const id = u.toolCallId ?? `${byId.size}`;
      const meta = (u.rawOutput as { metadata?: unknown } | undefined)?.metadata;
      byId.set(id, { tool: u.title || u.kind || "tool", input: u.rawInput, output: { metadata: meta, result: u.content } });
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
  return { text, trace: [...byId.values()] };
}

// Nodo "mimo" (nombre interno histórico, no renombrado para no romper flujos guardados): corre sobre
// DevFlow Code (nativo) desde la Fase 4, cuando el provider "mimo" se retiró.
async function execMimo(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, sessions: SessionCache): Promise<NodeResult> {
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === "opencode");
  if (!provider?.nativeHttp) throw new Error("Provider 'opencode' sin configuración");
  const promptText = resolveTemplate(String(node.data.prompt ?? ""), results, input);
  if (!promptText.trim()) throw new Error("Prompt vacío");
  cb.onLog("info", `🤖 DevFlow Code: ${promptText.slice(0, 80)}${promptText.length > 80 ? "…" : ""}`);
  const profile = nodeTaskProfile(node);
  const { sessionId } = await acquireSession(sessions, `mimo:${profile ?? ""}`, provider, profile);
  const text = await promptAndCollect(provider, sessionId, promptText);
  cb.onLog("success", `🤖 DevFlow Code respondió (${text.length} chars)`);
  return { output: text };
}

// Nodo agente genérico: como execMimo pero el agente se elige por nodo (data.agentId → agentsStore).
// Solo funcionan los agentes cuyo provider tiene config ACP o nativa; el resto tira error claro.
async function execAgent(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, sessions: SessionCache): Promise<NodeResult> {
  const agentId = String(node.data.agentId ?? "");
  const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Nodo agente sin agente seleccionado (o el agente ya no existe)");
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === agent.providerId);
  if (!provider?.acp && !provider?.nativeHttp) throw new Error(`El agente "${agent.name}" no tiene backend ACP ni nativo — elegí uno con motor real (ej. DevFlow Code)`);
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

// Nodo verify: como execAgent, pero le exige al agente terminar con un veredicto en un formato fijo
// y lo traduce a exitCode (0/1) — el mismo campo que ya usan terminal/http para que un nodo condition
// aguas abajo pueda ramificar sobre {{id.exitCode}}. Si el agente no devuelve el sentinel reconocible,
// tira un error: cae en el mecanismo de reintentos genérico por nodo que YA tiene runGraph (no hace
// falta un retry propio para "el agente no formateó bien"). El agente resuelve el verify usando lo que
// tenga disponible en su sesión (terminal, MCP de mobile-mcp/Desktop CDP/Puppeteer si están habilitados
// para el proyecto) — el motor no orquesta ningún backend específico, solo interpreta la respuesta.
const VERIFY_SENTINEL = /VERIFY_RESULT:\s*(PASS|FAIL)/i;
const VERIFY_REASON = /VERIFY_REASON:\s*(.+)/i;
const VERIFY_INSTRUCTION =
  "\n\nWhen you're done verifying, your last paragraph must have EXACTLY these two lines " +
  "(nothing else on those lines):\nVERIFY_RESULT: PASS  (or FAIL)\nVERIFY_REASON: <one sentence with the concrete evidence you saw>";

async function execVerify(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks, sessions: SessionCache): Promise<NodeResult> {
  // Modo "script": ya se generó un script determinístico de una exploración anterior (ver
  // verifyScript.ts) — se corre directo, igual que execTerminal, SIN agente/LLM de por medio. Es
  // el punto de esta feature: pagar el turno de agente solo una vez, no en cada corrida.
  if (node.data.mode === "script") {
    const scriptPath = String(node.data.scriptPath ?? "").trim();
    if (!scriptPath) {
      throw new Error('Modo script sin script generado — generá uno primero (botón "Generar script" en el inspector) o volvé a modo Exploración.');
    }
    const cwd = useProjectStore.getState().projectPath;
    const runner = /\.mjs$/i.test(scriptPath) ? "node" : "bash";
    cb.onLog("info", `✅ Script (${runner}): ${scriptPath}`);
    const res = await runShellCommand(`${runner} "${scriptPath}"`, cwd);
    if (res.output.trim()) cb.onLog(res.exitCode === 0 ? "info" : "error", res.output.trimEnd());
    cb.onLog(res.exitCode === 0 ? "success" : "error", `✅ Veredicto (script): ${res.exitCode === 0 ? "PASS" : "FAIL"} [exit code ${res.exitCode}]`);
    return { output: res.output, exitCode: res.exitCode === 0 ? 0 : 1 };
  }

  const agentId = String(node.data.agentId ?? "");
  const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Nodo verify sin agente seleccionado (o el agente ya no existe)");
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === agent.providerId);
  if (!provider?.acp && !provider?.nativeHttp) throw new Error(`El agente "${agent.name}" no tiene backend ACP ni nativo — elegí uno con motor real (ej. DevFlow Code)`);
  const basePrompt = resolveTemplate(String(node.data.prompt ?? ""), results, input);
  if (!basePrompt.trim()) throw new Error("Prompt vacío");
  let promptText = basePrompt + VERIFY_INSTRUCTION;
  cb.onLog("info", `✅ ${agent.name} verificando: ${basePrompt.slice(0, 80)}${basePrompt.length > 80 ? "…" : ""}`);
  const profile = nodeTaskProfile(node, agent.taskProfile);
  const { sessionId, isNew } = await acquireSession(sessions, `verify:${agent.id}:${profile ?? ""}`, provider, profile);
  const systemPrompt = agent.systemPrompt?.trim();
  if (isNew && systemPrompt) promptText = `[System]\n${systemPrompt}\n\n${promptText}`;
  const { text, trace } = await promptAndCollectWithTrace(provider, sessionId, promptText);
  const match = text.match(VERIFY_SENTINEL);
  if (!match) {
    throw new Error(`El agente no devolvió un veredicto reconocible (esperaba "VERIFY_RESULT: PASS" o "FAIL"). Respuesta: ${text.slice(-300)}`);
  }
  const passed = match[1].toUpperCase() === "PASS";
  const reason = text.match(VERIFY_REASON)?.[1]?.trim();
  cb.onLog(passed ? "success" : "error", `✅ Veredicto: ${passed ? "PASS" : "FAIL"}${reason ? ` — ${reason}` : ""}`);
  // Traza persistida SOLO en PASS (no tiene sentido generar un script desde una exploración que
  // falló) — habilita el botón "Generar script" en el inspector para la próxima vez que se abra este
  // nodo, incluso en otra sesión de la app (WorkflowNodeData es free-form, sobrevive al persist).
  if (passed) {
    useWorkflowStore.getState().updateNodeData(node.id, {
      lastVerifyTrace: JSON.stringify(trace).slice(0, MAX_TRACE_CHARS),
      lastVerifyPrompt: basePrompt,
    });
  }
  return { output: text, exitCode: passed ? 0 : 1 };
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

// Nodo perf, modo "resource": polea CPU/RAM de un proceso por nombre durante durationSec, cada
// intervalMs, vía Get-Process (Windows only en v1 — mismo criterio de scoping que otros gaps de
// plataforma ya documentados en este proyecto). Cada tick es un `runShellCommand` propio (no hay
// primitiva de polling nativo) — simple y suficiente para intervalos de ≥ ~500ms.
type PerfResourceSample = { t: number; workingSetBytes: number; cpuSeconds: number };

async function execPerfResource(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const processMatch = resolveTemplate(String(node.data.processMatch ?? ""), results, input).trim().replace(/\.exe$/i, "");
  if (!processMatch) throw new Error("Nombre de proceso vacío");
  const durationSec = Math.max(1, Number(node.data.durationSec) || 10);
  const intervalMs = Math.max(200, Number(node.data.intervalMs) || 1000);
  const cwd = useProjectStore.getState().projectPath;
  cb.onLog("info", `📊 Midiendo "${processMatch}" por ${durationSec}s cada ${intervalMs}ms…`);

  const psCmd = `powershell.exe -NoProfile -Command "Get-Process -Name '${processMatch}' -ErrorAction SilentlyContinue | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress"`;
  const samples: PerfResourceSample[] = [];
  const deadline = Date.now() + durationSec * 1000;
  while (Date.now() < deadline) {
    if (cb.isCancelled()) break;
    const res = await runShellCommand(psCmd, cwd);
    const raw = res.output.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        let ws = 0, cpu = 0;
        for (const r of rows) { ws += Number(r.WorkingSet64) || 0; cpu += Number(r.CPU) || 0; }
        samples.push({ t: Date.now(), workingSetBytes: ws, cpuSeconds: cpu });
      } catch {
        // línea no-JSON (proceso no encontrado esa vuelta, etc.) — se ignora, no corta la corrida.
      }
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }

  if (samples.length === 0) {
    const summary = { processMatch, samples: 0 };
    cb.onLog("error", `📊 No se encontró ningún proceso "${processMatch}" durante la medición.`);
    return { output: JSON.stringify(summary), exitCode: 1 };
  }
  const ramValues = samples.map((s) => s.workingSetBytes);
  const avgRamMB = ramValues.reduce((a, b) => a + b, 0) / ramValues.length / 1_048_576;
  const peakRamMB = Math.max(...ramValues) / 1_048_576;
  const first = samples[0], last = samples[samples.length - 1];
  const wallSec = Math.max(0.001, (last.t - first.t) / 1000);
  // Núcleos usados en promedio (delta de CPU-segundos acumulados / segundos reales transcurridos) — NO
  // es un porcentaje de un core, es "cuántos cores equivalentes" consumió en promedio en la ventana.
  const avgCores = samples.length > 1 ? (last.cpuSeconds - first.cpuSeconds) / wallSec : null;
  const summary = {
    processMatch, samples: samples.length, durationSec,
    ramAvgMB: Math.round(avgRamMB * 10) / 10,
    ramPeakMB: Math.round(peakRamMB * 10) / 10,
    avgCoresUsed: avgCores !== null ? Math.round(avgCores * 100) / 100 : null,
  };
  cb.onLog("success", `📊 RAM avg ${summary.ramAvgMB}MB / peak ${summary.ramPeakMB}MB${avgCores !== null ? ` · ~${summary.avgCoresUsed} cores` : ""} (${samples.length} muestras)`);
  return { output: JSON.stringify(summary), exitCode: 0 };
}

// Nodo perf, modo "http": load test real vía Rust (concurrencia real con reqwest+tokio, sin pagar N
// round-trips de IPC Tauri por request — ver http_load_test en lib.rs). exitCode = 0 si no hubo
// errores de red/protocolo (4xx/5xx cuentan como "requests con error" en el resumen, no fallan el nodo
// por sí solos — el usuario decide el umbral aguas abajo con un Condición sobre {{id.output}}).
async function execPerfHttp(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const url = resolveTemplate(String(node.data.url ?? ""), results, input).trim();
  if (!url) throw new Error("URL vacía");
  const method = String(node.data.method ?? "GET");
  const concurrency = Math.max(1, Number(node.data.concurrency) || 10);
  const requests = Math.max(1, Number(node.data.requests) || 200);
  cb.onLog("info", `📊 Load test ${method} ${url} — ${requests} requests, concurrencia ${concurrency}…`);
  const result = await httpLoadTest(url, method, concurrency, requests);
  cb.onLog(
    result.errors > 0 ? "warn" : "success",
    `📊 ${result.completed} completados, ${result.errors} errores · p50 ${result.p50Ms}ms p95 ${result.p95Ms}ms · ${result.requestsPerSec} req/s`
  );
  return { output: JSON.stringify(result), exitCode: result.completed > 0 ? 0 : 1 };
}

async function execPerf(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  return node.data.mode === "http" ? execPerfHttp(node, results, input, cb) : execPerfResource(node, results, input, cb);
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
    case "verify": return execVerify(node, results, input, cb, sessions);
    case "http": return execHttp(node, results, input, cb);
    case "perf": return execPerf(node, results, input, cb);
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

// errored = true si algún nodo terminó en estado "error" (stop-on-error). Los llamadores que solo
// hacen `await runWorkflow(...)` sin mirar el resultado (ChatView, WorkflowView, mcpBridgeHandlers)
// siguen andando igual; TriggerRunner/PlannerRunner lo usan para no reportar "success" en un run que
// en realidad se detuvo por un nodo fallido.
export async function runWorkflow(nodes: WorkflowNode[], edges: Edge[], cb: EngineCallbacks, initialInput = ""): Promise<{ errored: boolean }> {
  if (nodes.length === 0) {
    cb.onLog("warn", "El canvas está vacío — nada que ejecutar.");
    return { errored: false };
  }
  // Caché de sesiones ACP compartida por toda la corrida (excepto loops, que aíslan por item). Nace
  // vacía en cada runWorkflow → una corrida no hereda contexto de la anterior.
  const sessions: SessionCache = new Map();
  const r = await runGraph(nodes, edges, cb, initialInput, new Set(), sessions);
  if (r.cancelled) return { errored: false }; // ya logueó "Ejecución cancelada."
  if (!r.errored) cb.onLog("success", "✓ Workflow completado.");
  else cb.onLog("error", "Workflow detenido por un error.");
  return { errored: r.errored };
}

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
// - mimo: sesión ACP por nodo; los permisos se auto-aprueban (WorkflowView no monta el listener
//   de permisos → acpClient cae al fail-safe allow-first-option ya existente).
import { runShellCommand, readTextFile, writeTextFile } from "./tauriApi";
import * as acpClient from "./acpClient";
import { DEFAULT_PROVIDERS } from "./providers";
import { PROJECT_CWD } from "./constants";
import type { Edge } from "@xyflow/react";
import type { WorkflowNode, NodeStatus } from "../store/workflowStore";
import type { LogEntry } from "../components/OutputPanel";

export type NodeResult = { output: string; exitCode?: number; branch?: "true" | "false" };

export type EngineCallbacks = {
  onLog: (level: LogEntry["level"], message: string) => void;
  setNodeStatus: (id: string, status: NodeStatus) => void;
  isCancelled: () => boolean;
};

// ── Templating ──────────────────────────────────────────────────────────────
// Reemplaza {{input}} y {{<id>.<field>}} contra los resultados acumulados.
function resolveTemplate(str: string, results: Map<string, NodeResult>, input: string): string {
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    const e = String(expr).trim();
    if (e === "input") return input;
    const dot = e.indexOf(".");
    if (dot === -1) return "";
    const id = e.slice(0, dot);
    const field = e.slice(dot + 1).trim();
    const r = results.get(id);
    if (!r) return "";
    if (field === "output") return r.output;
    if (field === "exitCode") return r.exitCode === undefined ? "" : String(r.exitCode);
    if (field === "branch") return r.branch ?? "";
    return "";
  });
}

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
  return { output: "" };
}

async function execTerminal(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const command = resolveTemplate(String(node.data.command ?? ""), results, input);
  if (!command.trim()) throw new Error("Comando vacío");
  cb.onLog("info", `$ ${command}`);
  const res = await runShellCommand(command, PROJECT_CWD);
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

async function execMimo(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  const mimo = DEFAULT_PROVIDERS.find((p) => p.id === "mimo");
  if (!mimo?.acp) throw new Error("Provider 'mimo' sin configuración ACP");
  const promptText = resolveTemplate(String(node.data.prompt ?? ""), results, input);
  if (!promptText.trim()) throw new Error("Prompt vacío");
  cb.onLog("info", `🤖 MiMo: ${promptText.slice(0, 80)}${promptText.length > 80 ? "…" : ""}`);
  const sessionId = await acpClient.newSession("mimo", mimo.acp, PROJECT_CWD);
  let text = "";
  const unsub = acpClient.onUpdate((provider, sid, update) => {
    if (provider !== "mimo" || sid !== sessionId) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type?: string; text?: string } | string | undefined;
      if (typeof content === "string") text += content;
      else if (content?.type === "text" && typeof content.text === "string") text += content.text;
    }
  });
  try {
    await acpClient.prompt("mimo", sessionId, promptText);
  } finally {
    unsub();
  }
  cb.onLog("success", `🤖 MiMo respondió (${text.length} chars)`);
  return { output: text };
}

async function execNode(node: WorkflowNode, results: Map<string, NodeResult>, input: string, cb: EngineCallbacks): Promise<NodeResult> {
  switch (node.type) {
    case "file": return execFile(node, results, input, cb);
    case "terminal": return execTerminal(node, results, input, cb);
    case "condition": return execCondition(node, results, input, cb);
    case "mimo": return execMimo(node, results, input, cb);
    default: throw new Error(`Tipo de nodo desconocido: ${node.type}`);
  }
}

// ── Motor ───────────────────────────────────────────────────────────────────
export async function runWorkflow(nodes: WorkflowNode[], edges: Edge[], cb: EngineCallbacks): Promise<void> {
  if (nodes.length === 0) {
    cb.onLog("warn", "El canvas está vacío — nada que ejecutar.");
    return;
  }

  const order = topoSort(nodes, edges);
  if (!order) {
    cb.onLog("error", "El grafo tiene un ciclo — no se puede ejecutar. Revisá las conexiones.");
    return;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, Edge[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) if (incoming.has(e.target)) incoming.get(e.target)!.push(e);

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
      return;
    }
    const node = nodeById.get(id)!;
    const inEdges = incoming.get(id) ?? [];
    const active = inEdges.length === 0 || inEdges.some(isEdgeActive);
    if (!active) {
      cb.setNodeStatus(id, "skipped");
      continue;
    }
    const activeIn = inEdges.filter(isEdgeActive);
    const input = activeIn.map((e) => results.get(e.source)?.output ?? "").join("\n");

    cb.setNodeStatus(id, "running");
    const title = String(node.data.label ?? node.type ?? id);
    try {
      const result = await execNode(node, results, input, cb);
      results.set(id, result);
      // Un comando que corrió pero terminó con exit ≠ 0 NO detiene el flujo (un condition
      // aguas abajo puede ramificar sobre {{id.exitCode}}), pero se marca "warn" (ámbar) para
      // distinguirlo visualmente de un success limpio.
      const ranButNonZero = result.exitCode !== undefined && result.exitCode !== 0;
      cb.setNodeStatus(id, ranButNonZero ? "warn" : "success");
    } catch (e) {
      cb.setNodeStatus(id, "error");
      cb.onLog("error", `✖ "${title}" (${id}) falló: ${e instanceof Error ? e.message : String(e)}`);
      errored = true;
      break; // stop-on-error: paramos el run completo
    }
  }

  if (!errored) cb.onLog("success", "✓ Workflow completado.");
  else cb.onLog("error", "Workflow detenido por un error.");
}

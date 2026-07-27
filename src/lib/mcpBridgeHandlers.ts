// Implementación de las tools del MCP bridge de DevFlow (ver mcpBridge.ts/mcpBridgeScript.ts para el
// transporte). Cada handler usa el store/motor REAL de la app viva — nada de esto duplica estado, es
// exactamente lo mismo que ve/toca la UI de Workflows.
import { useWorkflowStore, type WorkflowNode } from "../store/workflowStore";
import { useAgentsStore } from "../store/agentsStore";
import { NODE_SCHEMAS } from "../nodes/nodeSchema";
import { runWorkflow, validateWorkflowGraph, type EngineCallbacks } from "./workflowEngine";
import * as mcpConfig from "./mcpConfig";
import { mcpListTools as mcpListToolsRust } from "./tauriApi";
import { runTestsForPath, findProjectByPath } from "./testRunner";
import { suggestTestStrategy } from "./testStrategy";
import { generateAndInsertCase } from "./testCaseInsert";
import { useProjectStore } from "../store/projectStore";
import type { Edge } from "@xyflow/react";

function requireWorkflow(id: unknown): { id: string; name: string; nodes: WorkflowNode[]; edges: Edge[] } {
  const workflowId = String(id ?? "");
  const w = useWorkflowStore.getState().workflows[workflowId];
  if (!w) throw new Error(`No existe un workflow con id "${workflowId}".`);
  return w;
}

function summarizeWorkflow(w: { id: string; name: string; nodes: WorkflowNode[]; edges: Edge[] }) {
  return { id: w.id, name: w.name, nodeCount: w.nodes.length, edgeCount: w.edges.length };
}

// ── Descubrimiento ──────────────────────────────────────────────────────────
function listNodeTypes() {
  return Object.values(NODE_SCHEMAS).map((s) => ({
    type: s.type,
    title: s.title,
    description: s.description,
    fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, vars: !!f.vars, options: f.options })),
  }));
}

function listWorkflows() {
  const { workflows, order } = useWorkflowStore.getState();
  return order.map((id) => summarizeWorkflow(workflows[id]));
}

function getWorkflow(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  return w;
}

function listAgents() {
  return useAgentsStore
    .getState()
    .agents.map((a) => ({ id: a.id, name: a.name, description: a.description, providerId: a.providerId }));
}

async function listMcpServers(projectPath: string) {
  const servers = await mcpConfig.readMcpServers(projectPath);
  return Object.entries(servers).map(([id, e]) => ({ id, command: e.command, enabled: e.enabled }));
}

async function listMcpTools(projectPath: string, args: Record<string, unknown>) {
  const serverId = String(args.serverId ?? "");
  const servers = await mcpConfig.readMcpServers(projectPath);
  const entry = servers[serverId];
  if (!entry) throw new Error(`No hay un MCP server "${serverId}" configurado en este proyecto.`);
  const raw = await mcpListToolsRust(entry.command.join(" "), entry.environment ?? {});
  const parsed = JSON.parse(raw) as { tools?: unknown[] };
  return parsed.tools ?? [];
}

// ── Autoría ──────────────────────────────────────────────────────────────────
function createWorkflow(args: Record<string, unknown>) {
  const name = typeof args.name === "string" ? args.name : undefined;
  const id = useWorkflowStore.getState().createWorkflow(name);
  return summarizeWorkflow(useWorkflowStore.getState().workflows[id]);
}

function defineWorkflow(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const nodes = (args.nodes ?? []) as WorkflowNode[];
  const edges = (args.edges ?? []) as Edge[];
  const check = validateWorkflowGraph(nodes, edges);
  if (!check.valid) throw new Error(`Grafo inválido:\n- ${check.errors.join("\n- ")}`);
  useWorkflowStore.getState().setWorkflowGraph(w.id, nodes, edges);
  return summarizeWorkflow(useWorkflowStore.getState().workflows[w.id]);
}

let nodeCounter = 0;
function addNode(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const type = String(args.type ?? "");
  if (!NODE_SCHEMAS[type]) throw new Error(`Tipo de nodo desconocido: "${type}".`);
  const position = (args.position as { x: number; y: number } | undefined) ?? { x: 80 + w.nodes.length * 40, y: 80 + w.nodes.length * 40 };
  const data = (args.data as Record<string, unknown> | undefined) ?? {};
  const label = typeof data.label === "string" ? data.label : type;
  const id = `bridge_${Date.now().toString(36)}_${nodeCounter++}`;
  const node: WorkflowNode = { id, type, position, data: { ...data, label } };
  useWorkflowStore.getState().setWorkflowGraph(w.id, [...w.nodes, node], w.edges);
  return { nodeId: id };
}

function updateNode(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const nodeId = String(args.nodeId ?? "");
  if (!w.nodes.some((n) => n.id === nodeId)) throw new Error(`No existe el nodo "${nodeId}" en este workflow.`);
  const patch = (args.data as Record<string, unknown> | undefined) ?? {};
  const nodes = w.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
  useWorkflowStore.getState().setWorkflowGraph(w.id, nodes, w.edges);
  return { ok: true };
}

function deleteNode(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const nodeId = String(args.nodeId ?? "");
  const nodes = w.nodes.filter((n) => n.id !== nodeId);
  const edges = w.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  useWorkflowStore.getState().setWorkflowGraph(w.id, nodes, edges);
  return { ok: true };
}

function connectNodes(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const source = String(args.source ?? "");
  const target = String(args.target ?? "");
  const sourceHandle = typeof args.sourceHandle === "string" ? args.sourceHandle : undefined;
  if (!w.nodes.some((n) => n.id === source)) throw new Error(`No existe el nodo origen "${source}".`);
  if (!w.nodes.some((n) => n.id === target)) throw new Error(`No existe el nodo destino "${target}".`);
  const id = `bridge_e_${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`;
  const edge: Edge = { id, source, target, ...(sourceHandle ? { sourceHandle } : {}), animated: true };
  useWorkflowStore.getState().setWorkflowGraph(w.id, w.nodes, [...w.edges.filter((e) => e.id !== id), edge]);
  return { edgeId: id };
}

function disconnectNodes(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  const source = String(args.source ?? "");
  const target = String(args.target ?? "");
  const edges = w.edges.filter((e) => !(e.source === source && e.target === target));
  useWorkflowStore.getState().setWorkflowGraph(w.id, w.nodes, edges);
  return { ok: true };
}

function renameWorkflow(args: Record<string, unknown>) {
  requireWorkflow(args.workflowId);
  useWorkflowStore.getState().renameWorkflow(String(args.workflowId), String(args.name ?? ""));
  return { ok: true };
}

function deleteWorkflow(args: Record<string, unknown>) {
  requireWorkflow(args.workflowId);
  const before = useWorkflowStore.getState().order.length;
  useWorkflowStore.getState().deleteWorkflow(String(args.workflowId));
  if (useWorkflowStore.getState().order.length === before) {
    throw new Error("No se puede borrar: es el único workflow que queda.");
  }
  return { ok: true };
}

function validateWorkflowTool(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  return validateWorkflowGraph(w.nodes, w.edges);
}

// ── Ejecución ────────────────────────────────────────────────────────────────
// Un workflowId solo puede tener UNA corrida-vía-bridge en curso a la vez: además de evitar dos
// corridas concurrentes pisándose los logs, esto es el guard de recursión — un nodo "agent" que le
// pida al bridge correr el MISMO workflow que lo contiene (directa o indirectamente, mientras la
// corrida de más afuera siga en curso) lo encuentra en el set y se rechaza en vez de colgar la app.
const runningViaBridge = new Set<string>();
const cancelFlags = new Map<string, { cancelled: boolean }>();

async function runWorkflowTool(args: Record<string, unknown>) {
  const w = requireWorkflow(args.workflowId);
  if (runningViaBridge.has(w.id)) {
    throw new Error(`El workflow "${w.name}" ya está corriendo (o hay una recursión: un nodo de este workflow está pidiendo correrlo de nuevo).`);
  }
  const input = typeof args.input === "string" ? args.input : "";
  const logs: string[] = [];
  const flag = { cancelled: false };
  cancelFlags.set(w.id, flag);
  runningViaBridge.add(w.id);
  const setStatus = useWorkflowStore.getState().setNodeStatus;
  const isActiveFlow = () => useWorkflowStore.getState().activeId === w.id;
  const cb: EngineCallbacks = {
    onLog: (level, msg) => logs.push(`[${level}] ${msg}`),
    setNodeStatus: (id, status) => {
      if (isActiveFlow()) setStatus(id, status); // solo pinta el canvas si es el flujo que se está viendo
    },
    isCancelled: () => flag.cancelled,
    resolveFlow: (flowId) => useWorkflowStore.getState().workflows[flowId],
  };
  try {
    await runWorkflow(w.nodes, w.edges, cb, input);
  } finally {
    runningViaBridge.delete(w.id);
    cancelFlags.delete(w.id);
  }
  return { log: logs.join("\n") };
}

function stopRun(args: Record<string, unknown>) {
  const id = String(args.workflowId ?? "");
  const flag = cancelFlags.get(id);
  if (!flag) return { ok: false, message: "Ese workflow no está corriendo vía el bridge." };
  flag.cancelled = true;
  return { ok: true };
}

// ── Tests (Fase 1 de la herramienta de testing nativa) ────────────────────────
async function runTestsTool(projectPath: string) {
  const run = await runTestsForPath(projectPath);
  return { status: run.status, exitCode: run.exitCode, output: run.output };
}

// ── Test Strategy Advisor (Fases 5-7) ─────────────────────────────────────────
// Persiste la sugerencia en el store del proyecto (no solo la devuelve) — así queda disponible para
// devflow_insert_test_case sin tener que re-detectar (y sin pagar de nuevo un turno de agente si cayó
// en el fallback), y la UI (TestStrategyPanel.tsx) la ve actualizada si el usuario la mira después.
async function suggestTestStrategyTool(projectPath: string) {
  const project = findProjectByPath(projectPath);
  if (!project) throw new Error(`DevFlow doesn't have any project open at "${projectPath}".`);
  const { fingerprint, strategy } = await suggestTestStrategy(projectPath);
  useProjectStore.getState().setTestStrategy(project.id, { fingerprint, strategy, detectedAt: Date.now() });
  return { fingerprint, strategy };
}

async function insertTestCaseTool(projectPath: string, args: Record<string, unknown>) {
  const project = findProjectByPath(projectPath);
  if (!project) throw new Error(`DevFlow doesn't have any project open at "${projectPath}".`);
  const cached = project.testStrategy;
  if (!cached) {
    throw new Error('No strategy detected for this project yet — call "devflow_suggest_test_strategy" first.');
  }
  const patternId = String(args.patternId ?? "");
  const pattern = cached.strategy.casePatterns.find((p) => p.id === patternId);
  if (!pattern) {
    const available = cached.strategy.casePatterns.map((p) => p.id).join(", ") || "(none)";
    throw new Error(`patternId "${patternId}" not recognized. Available patterns: ${available}.`);
  }
  const targetHint = String(args.targetHint ?? "");
  return generateAndInsertCase(projectPath, pattern, cached.fingerprint, targetHint);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
export async function handleBridgeTool(tool: string, args: unknown, projectPath: string): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (tool) {
    case "devflow_list_node_types":
      return listNodeTypes();
    case "devflow_list_workflows":
      return listWorkflows();
    case "devflow_get_workflow":
      return getWorkflow(a);
    case "devflow_list_agents":
      return listAgents();
    case "devflow_list_mcp_servers":
      return listMcpServers(projectPath);
    case "devflow_list_mcp_tools":
      return listMcpTools(projectPath, a);
    case "devflow_create_workflow":
      return createWorkflow(a);
    case "devflow_define_workflow":
      return defineWorkflow(a);
    case "devflow_add_node":
      return addNode(a);
    case "devflow_update_node":
      return updateNode(a);
    case "devflow_delete_node":
      return deleteNode(a);
    case "devflow_connect_nodes":
      return connectNodes(a);
    case "devflow_disconnect_nodes":
      return disconnectNodes(a);
    case "devflow_rename_workflow":
      return renameWorkflow(a);
    case "devflow_delete_workflow":
      return deleteWorkflow(a);
    case "devflow_validate_workflow":
      return validateWorkflowTool(a);
    case "devflow_run_workflow":
      return runWorkflowTool(a);
    case "devflow_stop_run":
      return stopRun(a);
    case "devflow_run_tests":
      return runTestsTool(projectPath);
    case "devflow_suggest_test_strategy":
      return suggestTestStrategyTool(projectPath);
    case "devflow_insert_test_case":
      return insertTestCaseTool(projectPath, a);
    default:
      throw new Error(`Tool desconocida: "${tool}".`);
  }
}

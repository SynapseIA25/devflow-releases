import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import { useProjectStore } from "./projectStore";

// Estado de ejecución de un nodo. TRANSITORIO: se resetea en cada Run y NO se persiste
// (partialize lo borra de la data antes de guardar), así un reload siempre muestra "idle".
// "warn" = corrió pero exit code ≠ 0 (terminal): visualmente distinto del verde, pero el flujo
// continúa (un condition puede ramificar sobre {{id.exitCode}}). "error" = falla de ejecución
// real → detiene el run.
export type NodeStatus = "idle" | "running" | "success" | "warn" | "error" | "skipped";

export type WorkflowNodeData = {
  label?: string;
  status?: NodeStatus;
  [key: string]: unknown;
};

export type WorkflowNode = Node<WorkflowNodeData>;

// Un flujo de trabajo independiente: su propio grafo (nodes/edges) y un nombre. El store guarda
// varios; el nodo "subflow" referencia a otro flujo por id (ver workflowEngine).
export type Workflow = { id: string; name: string; nodes: WorkflowNode[]; edges: Edge[] };

// Forma persistida en localStorage (solo datos, sin las acciones del store). Tenerla nombrada evita
// la inferencia demasiado rígida de zustand/persist entre partialize y migrate.
type PersistedState = {
  workflows: Record<string, Workflow>;
  order: string[];
  activeId: string;
  nodeSeq: number;
  flowSeq: number;
};

// Grafo semilla (antes vivía hardcodeado en Canvas.tsx). Es el contenido del flujo inicial.
const seedNodes: WorkflowNode[] = [
  { id: "1", type: "file", position: { x: 80, y: 200 }, data: { label: "Read Codebase", path: "./src", operation: "read" } },
  { id: "2", type: "mimo", position: { x: 360, y: 150 }, data: { label: "DevFlow Code Refactor", prompt: "Refactor the code following best practices and improve readability." } },
  { id: "3", type: "terminal", position: { x: 640, y: 150 }, data: { label: "Run Tests", command: "npm test" } },
  // Condición referencia el exitCode del nodo de tests por id, vía templating (ver workflowEngine).
  { id: "4", type: "condition", position: { x: 900, y: 150 }, data: { label: "Tests passed?", condition: "{{3.exitCode}} === 0" } },
  { id: "5", type: "terminal", position: { x: 1160, y: 80 }, data: { label: "Git Commit", command: "git commit -am 'refactor: apply DevFlow Code suggestions'" } },
];

const seedEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "#7c3aed" } },
  { id: "e2-3", source: "2", target: "3", animated: true, style: { stroke: "#16a34a" } },
  { id: "e3-4", source: "3", target: "4", style: { stroke: "#0ea5e9" } },
  { id: "e4-5", source: "4", sourceHandle: "true", target: "5", style: { stroke: "#4ade80" } },
];

const defaultsByType: Record<string, WorkflowNodeData> = {
  mimo: { label: "DevFlow Code", prompt: "" },
  agent: { label: "Agente", agentId: "opencode-agent", prompt: "" },
  verify: { label: "Verificar", agentId: "expert-qa", prompt: "", mode: "explore" },
  http: { label: "HTTP Request", method: "GET", url: "", headers: "", body: "" },
  mcp: { label: "MCP Tool", command: "", tool: "", arguments: "" },
  terminal: { label: "Terminal", command: "" },
  file: { label: "File", path: "", operation: "read" },
  condition: { label: "Condition", condition: "" },
  loop: { label: "Loop", list: "", flowId: "", parallel: "sequential" },
  subflow: { label: "Sub-flujo", flowId: "", flowName: "" },
  perf: { label: "Perf", mode: "resource", processMatch: "", durationSec: "10", intervalMs: "1000", url: "", method: "GET", concurrency: "10", requests: "200" },
};

const FIRST_FLOW_ID = "flow_0";

type WorkflowStore = {
  workflows: Record<string, Workflow>;
  order: string[]; // orden de visualización de los flujos
  activeId: string; // flujo que se está editando/ejecutando
  nodeSeq: number; // contador global para ids únicos de nodos
  flowSeq: number; // contador para ids únicos de flujos

  // ── Edición del flujo activo ──
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, position: { x: number; y: number }, initData?: Partial<WorkflowNodeData>) => string;
  updateNodeData: (id: string, patch: Partial<WorkflowNodeData>) => void;
  setNodeStatus: (id: string, status: NodeStatus) => void;
  resetStatuses: () => void;

  // ── Gestión de flujos ──
  // projectId opcional: por default asocia el flujo nuevo al proyecto ACTIVO (project.workflowIds,
  // ver projectStore.ts) — cubre el botón "+" de WorkflowView y la creación vía chat/MCP bridge.
  // ProjectsView's FlujosTab pasa el projectId explícito de la fila que se está editando (puede no
  // ser el proyecto activo).
  createWorkflow: (name?: string, projectId?: string) => string;
  deleteWorkflow: (id: string) => void;
  renameWorkflow: (id: string, name: string) => void;
  setActiveWorkflow: (id: string) => void;
  // Reemplaza nodes/edges de UN flujo por id explícito — a diferencia de onNodesChange/addNode/etc.
  // (que operan sobre `activeId` vía patchActive), esto no requiere que sea el flujo que se está
  // viendo. Primitiva de bajo nivel para autoría programática (ver mcpBridgeHandlers.ts): el bridge
  // MCP deja que un agente de chat edite cualquier workflow sin forzar un cambio de flujo activo en
  // la UI del usuario.
  setWorkflowGraph: (id: string, nodes: WorkflowNode[], edges: Edge[]) => void;
};

// Aplica un cambio a los nodes/edges del flujo activo de forma inmutable.
function patchActive(s: WorkflowStore, fn: (w: Workflow) => Partial<Workflow>): Partial<WorkflowStore> {
  const w = s.workflows[s.activeId];
  if (!w) return {};
  return { workflows: { ...s.workflows, [s.activeId]: { ...w, ...fn(w) } } };
}

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      workflows: { [FIRST_FLOW_ID]: { id: FIRST_FLOW_ID, name: "Mi primer flujo", nodes: seedNodes, edges: seedEdges } },
      order: [FIRST_FLOW_ID],
      activeId: FIRST_FLOW_ID,
      nodeSeq: 10,
      flowSeq: 1,

      onNodesChange: (changes) =>
        set((s) => patchActive(s, (w) => ({ nodes: applyNodeChanges(changes, w.nodes) }))),

      onEdgesChange: (changes) =>
        set((s) => patchActive(s, (w) => ({ edges: applyEdgeChanges(changes, w.edges) }))),

      onConnect: (connection) =>
        set((s) => patchActive(s, (w) => ({ edges: addEdge({ ...connection, animated: true }, w.edges) }))),

      addNode: (type, position, initData) => {
        const id = `node_${get().nodeSeq}`;
        set((s) => ({
          nodeSeq: s.nodeSeq + 1,
          ...patchActive(s, (w) => ({
            nodes: [
              ...w.nodes,
              { id, type, position, data: { ...(defaultsByType[type] ?? { label: type }), ...initData } },
            ],
          })),
        }));
        return id;
      },

      updateNodeData: (id, patch) =>
        set((s) =>
          patchActive(s, (w) => ({
            nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
          }))
        ),

      setNodeStatus: (id, status) =>
        set((s) =>
          patchActive(s, (w) => ({
            nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n)),
          }))
        ),

      resetStatuses: () =>
        set((s) =>
          patchActive(s, (w) => ({
            nodes: w.nodes.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeStatus } })),
          }))
        ),

      createWorkflow: (name, projectId) => {
        const id = `flow_${get().flowSeq}`;
        set((s) => ({
          flowSeq: s.flowSeq + 1,
          workflows: { ...s.workflows, [id]: { id, name: name || `Flujo ${s.order.length + 1}`, nodes: [], edges: [] } },
          order: [...s.order, id],
          activeId: id,
        }));
        const pid = projectId ?? useProjectStore.getState().activeId;
        const proj = useProjectStore.getState().projects[pid];
        if (proj && !proj.workflowIds.includes(id)) {
          useProjectStore.getState().updateProject(pid, { workflowIds: [...proj.workflowIds, id] });
        }
        return id;
      },

      deleteWorkflow: (id) =>
        set((s) => {
          if (s.order.length <= 1) return {}; // siempre queda al menos un flujo
          const { [id]: _removed, ...rest } = s.workflows;
          const order = s.order.filter((x) => x !== id);
          // Sacarlo de project.workflowIds de cualquier proyecto que lo tuviera asociado — si no,
          // queda un id huérfano acumulado ahí (inofensivo pero sucio) referenciando un flujo borrado.
          const ps = useProjectStore.getState();
          for (const [pid, p] of Object.entries(ps.projects)) {
            if (p.workflowIds.includes(id)) ps.updateProject(pid, { workflowIds: p.workflowIds.filter((x) => x !== id) });
          }
          return { workflows: rest, order, activeId: s.activeId === id ? order[0] : s.activeId };
        }),

      renameWorkflow: (id, name) =>
        set((s) => {
          const w = s.workflows[id];
          if (!w) return {};
          return { workflows: { ...s.workflows, [id]: { ...w, name } } };
        }),

      setActiveWorkflow: (id) =>
        set((s) => (s.workflows[id] ? { activeId: id } : {})),

      setWorkflowGraph: (id, nodes, edges) =>
        set((s) => {
          const w = s.workflows[id];
          if (!w) return {};
          return { workflows: { ...s.workflows, [id]: { ...w, nodes, edges } } };
        }),
    }),
    {
      name: "devflow-workflow",
      version: 2,
      // No persistimos el status transitorio de ejecución: tras un reload los nodos arrancan
      // en idle, no congelados en running/success de un run anterior.
      partialize: (state): PersistedState => ({
        activeId: state.activeId,
        order: state.order,
        nodeSeq: state.nodeSeq,
        flowSeq: state.flowSeq,
        workflows: Object.fromEntries(
          Object.entries(state.workflows).map(([id, w]) => [
            id,
            { ...w, nodes: w.nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } })) },
          ])
        ),
      }),
      // v0 era un único flujo plano { nodes, edges, nodeSeq }. Lo envolvemos en un flujo nombrado.
      // v1→v2: retiro del provider "mimo" (Fase 4) — cualquier nodo tipo "agent" que apuntaba al
      // agente retirado "mimo-coder" se reasigna a "opencode-agent" (DevFlow Code), si no el nodo
      // revienta en runtime ("el agente ya no existe").
      migrate: (persisted, version): PersistedState => {
        const p = persisted as Record<string, unknown> | undefined;
        let result = persisted as PersistedState;
        if (version < 1 && p && Array.isArray(p.nodes)) {
          result = {
            workflows: {
              [FIRST_FLOW_ID]: {
                id: FIRST_FLOW_ID,
                name: "Mi primer flujo",
                nodes: p.nodes as WorkflowNode[],
                edges: (p.edges as Edge[]) ?? [],
              },
            },
            order: [FIRST_FLOW_ID],
            activeId: FIRST_FLOW_ID,
            nodeSeq: (p.nodeSeq as number) ?? 10,
            flowSeq: 1,
          };
        }
        if (version < 2 && result?.workflows) {
          for (const w of Object.values(result.workflows)) {
            for (const n of w.nodes) {
              if (n.type === "agent" && n.data?.agentId === "mimo-coder") n.data.agentId = "opencode-agent";
            }
          }
        }
        return result;
      },
    }
  )
);

// Ids de flujos asociados al proyecto ACTIVO (project.workflowIds), en el mismo orden que `order` —
// úsalo en cualquier lugar que hoy liste "todos los flujos" (selector de Workflows, dropdown del
// Planner, `/run` del chat, referencias de subflow/loop): antes de la asociación por proyecto, todos
// esos lugares mostraban los flujos de TODOS los proyectos mezclados.
export function useProjectWorkflowIds(): string[] {
  const order = useWorkflowStore((s) => s.order);
  const workflowIds = useProjectStore((s) => s.projects[s.activeId]?.workflowIds);
  return order.filter((id) => workflowIds?.includes(id));
}

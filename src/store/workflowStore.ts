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
  { id: "2", type: "mimo", position: { x: 360, y: 150 }, data: { label: "MiMo Refactor", prompt: "Refactor the code following best practices and improve readability." } },
  { id: "3", type: "terminal", position: { x: 640, y: 150 }, data: { label: "Run Tests", command: "npm test" } },
  // Condición referencia el exitCode del nodo de tests por id, vía templating (ver workflowEngine).
  { id: "4", type: "condition", position: { x: 900, y: 150 }, data: { label: "Tests passed?", condition: "{{3.exitCode}} === 0" } },
  { id: "5", type: "terminal", position: { x: 1160, y: 80 }, data: { label: "Git Commit", command: "git commit -am 'refactor: apply MiMo suggestions'" } },
];

const seedEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "#7c3aed" } },
  { id: "e2-3", source: "2", target: "3", animated: true, style: { stroke: "#16a34a" } },
  { id: "e3-4", source: "3", target: "4", style: { stroke: "#0ea5e9" } },
  { id: "e4-5", source: "4", sourceHandle: "true", target: "5", style: { stroke: "#4ade80" } },
];

const defaultsByType: Record<string, WorkflowNodeData> = {
  mimo: { label: "MiMo Agent", prompt: "" },
  terminal: { label: "Terminal", command: "" },
  file: { label: "File", path: "", operation: "read" },
  condition: { label: "Condition", condition: "" },
  subflow: { label: "Sub-flujo", flowId: "", flowName: "" },
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
  createWorkflow: (name?: string) => string;
  deleteWorkflow: (id: string) => void;
  renameWorkflow: (id: string, name: string) => void;
  setActiveWorkflow: (id: string) => void;
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

      createWorkflow: (name) => {
        const id = `flow_${get().flowSeq}`;
        set((s) => ({
          flowSeq: s.flowSeq + 1,
          workflows: { ...s.workflows, [id]: { id, name: name || `Flujo ${s.order.length + 1}`, nodes: [], edges: [] } },
          order: [...s.order, id],
          activeId: id,
        }));
        return id;
      },

      deleteWorkflow: (id) =>
        set((s) => {
          if (s.order.length <= 1) return {}; // siempre queda al menos un flujo
          const { [id]: _removed, ...rest } = s.workflows;
          const order = s.order.filter((x) => x !== id);
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
    }),
    {
      name: "devflow-workflow",
      version: 1,
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
      migrate: (persisted, version): PersistedState => {
        const p = persisted as Record<string, unknown> | undefined;
        if (version < 1 && p && Array.isArray(p.nodes)) {
          return {
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
        return persisted as PersistedState;
      },
    }
  )
);

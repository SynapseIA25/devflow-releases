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

// Grafo semilla (antes vivía hardcodeado en Canvas.tsx). Ahora es el estado inicial del
// persist: editable y persistido — recargar respeta lo guardado, no vuelve a este demo.
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
};

type WorkflowStore = {
  nodes: WorkflowNode[];
  edges: Edge[];
  nodeSeq: number; // contador para ids únicos de nodos creados por drag&drop
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, position: { x: number; y: number }) => string;
  updateNodeData: (id: string, patch: Partial<WorkflowNodeData>) => void;
  setNodeStatus: (id: string, status: NodeStatus) => void;
  resetStatuses: () => void;
};

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      nodes: seedNodes,
      edges: seedEdges,
      nodeSeq: 10,

      onNodesChange: (changes) =>
        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

      onEdgesChange: (changes) =>
        set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

      onConnect: (connection) =>
        set((s) => ({ edges: addEdge({ ...connection, animated: true }, s.edges) })),

      addNode: (type, position) => {
        const id = `node_${get().nodeSeq}`;
        set((s) => ({
          nodeSeq: s.nodeSeq + 1,
          nodes: [
            ...s.nodes,
            { id, type, position, data: { ...(defaultsByType[type] ?? { label: type }) } },
          ],
        }));
        return id;
      },

      updateNodeData: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        })),

      setNodeStatus: (id, status) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n)),
        })),

      resetStatuses: () =>
        set((s) => ({
          nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeStatus } })),
        })),
    }),
    {
      name: "devflow-workflow",
      // No persistimos el status transitorio de ejecución: tras un reload los nodos arrancan
      // en idle, no congelados en running/success de un run anterior.
      partialize: (state) => ({
        nodeSeq: state.nodeSeq,
        edges: state.edges,
        nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } })),
      }),
    }
  )
);

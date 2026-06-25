import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "../nodes";
import type { LogEntry } from "./OutputPanel";

type NodeData = Record<string, unknown>;

const initialNodes: Node<NodeData>[] = [
  {
    id: "1",
    type: "file",
    position: { x: 80, y: 200 },
    data: { label: "Read Codebase", path: "./src", operation: "read" },
  },
  {
    id: "2",
    type: "mimo",
    position: { x: 360, y: 150 },
    data: { label: "MiMo Refactor", prompt: "Refactor the code following best practices and improve readability." },
  },
  {
    id: "3",
    type: "terminal",
    position: { x: 640, y: 150 },
    data: { label: "Run Tests", command: "npm test" },
  },
  {
    id: "4",
    type: "condition",
    position: { x: 900, y: 150 },
    data: { label: "Tests passed?", condition: "exit_code === 0" },
  },
  {
    id: "5",
    type: "terminal",
    position: { x: 1160, y: 80 },
    data: { label: "Git Commit", command: "git commit -am 'refactor: apply MiMo suggestions'" },
  },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "#7c3aed" } },
  { id: "e2-3", source: "2", target: "3", animated: true, style: { stroke: "#16a34a" } },
  { id: "e3-4", source: "3", target: "4", style: { stroke: "#0ea5e9" } },
  { id: "e4-5", source: "4", sourceHandle: "true", target: "5", style: { stroke: "#4ade80" } },
];

let nodeId = 10;

const defaultsByType: Record<string, NodeData> = {
  mimo: { label: "MiMo Agent", prompt: "" },
  terminal: { label: "Terminal", command: "" },
  file: { label: "File", path: "", operation: "read" },
  condition: { label: "Condition", condition: "" },
};

type Props = {
  onLog: (entry: LogEntry) => void;
};

export function Canvas({ onLog }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow");
      if (!type || !rfRef.current || !wrapperRef.current) return;

      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      const newNode: Node<NodeData> = {
        id: `node_${nodeId++}`,
        type,
        position,
        data: defaultsByType[type] ?? { label: type },
      };

      setNodes((nds) => [...nds, newNode]);
      onLog({ time: new Date().toLocaleTimeString(), level: "info", message: `Added node: ${type}` });
    },
    [setNodes, onLog]
  );

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { rfRef.current = instance; }}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#21262d" />
        <Controls />
        <MiniMap nodeStrokeWidth={3} pannable zoomable />
      </ReactFlow>
    </div>
  );
}

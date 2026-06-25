import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "../nodes";
import type { LogEntry } from "./OutputPanel";
import { useWorkflowStore, type WorkflowNodeData } from "../store/workflowStore";

type Props = {
  onLog: (entry: LogEntry) => void;
};

export function Canvas({ onLog }: Props) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);

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

      addNode(type, position);
      onLog({ time: new Date().toLocaleTimeString(), level: "info", message: `Added node: ${type}` });
    },
    [addNode, onLog]
  );

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes as Node<WorkflowNodeData>[]}
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

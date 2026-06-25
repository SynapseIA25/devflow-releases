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
import type { Edge } from "@xyflow/react";
import { nodeTypes } from "../nodes";
import type { LogEntry } from "./OutputPanel";
import { useWorkflowStore, type WorkflowNodeData, type WorkflowNode } from "../store/workflowStore";

type Props = {
  onLog: (entry: LogEntry) => void;
};

const EMPTY_NODES: WorkflowNode[] = [];
const EMPTY_EDGES: Edge[] = [];

export function Canvas({ onLog }: Props) {
  const nodes = useWorkflowStore((s) => s.workflows[s.activeId]?.nodes ?? EMPTY_NODES);
  const edges = useWorkflowStore((s) => s.workflows[s.activeId]?.edges ?? EMPTY_EDGES);
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
      if (!type || !rfRef.current) return;

      // screenToFlowPosition espera coordenadas de pantalla crudas (ya descuenta pan/zoom y el
      // offset del panel internamente). Restar los bounds del wrapper desubicaba el nodo.
      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      // Un nodo "subflow" se arrastra desde la sección Flujos del sidebar y trae consigo el id
      // del flujo referenciado.
      let initData: Partial<WorkflowNodeData> | undefined;
      if (type === "subflow") {
        const flowId = e.dataTransfer.getData("application/devflow-flowid");
        const flowName = flowId ? useWorkflowStore.getState().workflows[flowId]?.name ?? "" : "";
        initData = { flowId, flowName };
      }

      addNode(type, position, initData);
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

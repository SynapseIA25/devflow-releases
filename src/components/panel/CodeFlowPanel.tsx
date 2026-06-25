import { useCallback } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  Node, Edge, Handle, Position, NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type FlowNodeData = { label: string; type: "class" | "function" | "data"; color: string };

function FlowNode({ data }: NodeProps) {
  const d = data as FlowNodeData;
  const isClass = d.type === "class";
  const isData = d.type === "data";
  return (
    <div className={`flow-node flow-node--${d.type}`} style={{ borderColor: d.color }}>
      <Handle type="target" position={Position.Left} style={{ background: d.color, width: 7, height: 7 }} />
      <div className="flow-node-label" style={{ color: isClass ? d.color : isData ? "#fbbf24" : "var(--text)" }}>
        {isClass ? "C" : isData ? "D" : "f"}
      </div>
      <span className="flow-node-name">{d.label}</span>
      <Handle type="source" position={Position.Right} style={{ background: d.color, width: 7, height: 7 }} />
    </div>
  );
}

const nodeTypes = { flownode: FlowNode };

const CLASS_NODES: Node[] = [
  { id: "app",      type: "flownode", position: { x: 10,  y: 60  }, data: { label: "App",          type: "class",    color: "#a78bfa" } },
  { id: "chatview", type: "flownode", position: { x: 160, y: 10  }, data: { label: "ChatView",     type: "class",    color: "#a78bfa" } },
  { id: "agview",   type: "flownode", position: { x: 160, y: 80  }, data: { label: "AgentsView",   type: "class",    color: "#a78bfa" } },
  { id: "settings", type: "flownode", position: { x: 160, y: 150 }, data: { label: "SettingsView", type: "class",    color: "#a78bfa" } },
  { id: "store",    type: "flownode", position: { x: 310, y: 40  }, data: { label: "chatStore",    type: "data",     color: "#fbbf24" } },
  { id: "msgs",     type: "flownode", position: { x: 310, y: 120 }, data: { label: "useMsgs",      type: "function", color: "#38bdf8" } },
  { id: "send",     type: "flownode", position: { x: 460, y: 40  }, data: { label: "handleSend",   type: "function", color: "#4ade80" } },
  { id: "provider", type: "flownode", position: { x: 460, y: 130 }, data: { label: "providers",    type: "data",     color: "#fbbf24" } },
];

const CLASS_EDGES: Edge[] = [
  { id: "e1", source: "app",      target: "chatview", style: { stroke: "#a78bfa", strokeWidth: 1.5 }, animated: false },
  { id: "e2", source: "app",      target: "agview",   style: { stroke: "#a78bfa", strokeWidth: 1.5 } },
  { id: "e3", source: "app",      target: "settings", style: { stroke: "#a78bfa", strokeWidth: 1.5 } },
  { id: "e4", source: "chatview", target: "store",    style: { stroke: "#fbbf24", strokeWidth: 1.5 }, animated: true, label: "reads" },
  { id: "e5", source: "chatview", target: "msgs",     style: { stroke: "#38bdf8", strokeWidth: 1.5 } },
  { id: "e6", source: "msgs",     target: "send",     style: { stroke: "#4ade80", strokeWidth: 1.5 }, animated: true, label: "calls" },
  { id: "e7", source: "send",     target: "provider", style: { stroke: "#fbbf24", strokeWidth: 1.5 }, animated: true, label: "data" },
  { id: "e8", source: "agview",   target: "provider", style: { stroke: "#fbbf24", strokeWidth: 1.5 } },
];

export function CodeFlowPanel() {
  const onInit = useCallback(() => {}, []);

  return (
    <div style={{ flex: 1, height: "100%" }}>
      <ReactFlow
        nodes={CLASS_NODES}
        edges={CLASS_EDGES}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.8} color="#21262d" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

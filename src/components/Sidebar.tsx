import { useWorkflowStore } from "../store/workflowStore";

const NODE_PALETTE = [
  {
    type: "mimo",
    icon: "🤖",
    name: "DevFlow Code",
    desc: "AI task",
    color: "rgba(124,58,237,0.2)",
  },
  {
    type: "agent",
    icon: "🤖",
    name: "Agente",
    desc: "IA (elegible)",
    color: "rgba(167,139,250,0.2)",
  },
  {
    type: "verify",
    icon: "✅",
    name: "Verificar",
    desc: "QA con veredicto",
    color: "rgba(45,212,191,0.2)",
  },
  {
    type: "http",
    icon: "🌐",
    name: "HTTP",
    desc: "Llamar una API",
    color: "rgba(34,211,238,0.2)",
  },
  {
    type: "mcp",
    icon: "🧩",
    name: "MCP Tool",
    desc: "Tool de un MCP",
    color: "rgba(56,189,248,0.2)",
  },
  {
    type: "terminal",
    icon: "⚡",
    name: "Terminal",
    desc: "Run command",
    color: "rgba(22,163,74,0.2)",
  },
  {
    type: "file",
    icon: "📄",
    name: "File",
    desc: "Read / Write",
    color: "rgba(217,119,6,0.2)",
  },
  {
    type: "condition",
    icon: "🔀",
    name: "Condition",
    desc: "Branch logic",
    color: "rgba(14,165,233,0.2)",
  },
  {
    type: "loop",
    icon: "🔁",
    name: "Loop / ForEach",
    desc: "Iterar una lista",
    color: "rgba(245,158,11,0.2)",
  },
];

export function Sidebar() {
  const order = useWorkflowStore((s) => s.order);
  const activeId = useWorkflowStore((s) => s.activeId);
  const workflows = useWorkflowStore((s) => s.workflows);
  const otherFlows = order.filter((id) => id !== activeId);

  const onDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
    e.dataTransfer.effectAllowed = "move";
  };

  // Arrastrar un flujo guardado crea un nodo "subflow" que lo referencia (lleva el flowId aparte).
  const onFlowDragStart = (e: React.DragEvent, flowId: string) => {
    e.dataTransfer.setData("application/reactflow", "subflow");
    e.dataTransfer.setData("application/devflow-flowid", flowId);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-label">Nodes</div>
        {NODE_PALETTE.map((n) => (
          <div
            key={n.type}
            className="node-item"
            draggable
            onDragStart={(e) => onDragStart(e, n.type)}
          >
            <div className="node-item-icon" style={{ background: n.color }}>
              {n.icon}
            </div>
            <div className="node-item-info">
              <div className="node-item-name">{n.name}</div>
              <div className="node-item-desc">{n.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {otherFlows.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-label">Flujos (sub-flujo)</div>
          {otherFlows.map((fid) => (
            <div
              key={fid}
              className="node-item"
              draggable
              onDragStart={(e) => onFlowDragStart(e, fid)}
              title={`Insertar "${workflows[fid].name}" como sub-flujo`}
            >
              <div className="node-item-icon" style={{ background: "rgba(14,165,233,0.2)" }}>
                🧩
              </div>
              <div className="node-item-info">
                <div className="node-item-name">{workflows[fid].name}</div>
                <div className="node-item-desc">{workflows[fid].nodes.length} nodos</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

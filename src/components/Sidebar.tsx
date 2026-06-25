const NODE_PALETTE = [
  {
    type: "mimo",
    icon: "🤖",
    name: "MiMo Agent",
    desc: "AI task",
    color: "rgba(124,58,237,0.2)",
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
];

export function Sidebar() {
  const onDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
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
    </aside>
  );
}

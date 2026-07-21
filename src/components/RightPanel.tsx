import { useState, useRef, useCallback } from "react";
import { FolderOpen, Info, ChevronRight } from "lucide-react";
import { FileExplorer } from "./panel/FileExplorer";
import { ContextPanel } from "./panel/ContextPanel";

type Tab = "files" | "context";

export function RightPanel() {
  const [tab, setTab]           = useState<Tab>("context");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth]        = useState(268);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.max(200, Math.min(480, startW.current + (startX.current - ev.clientX))));
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  if (collapsed) {
    return (
      <div className="right-panel-collapsed">
        <button className="rp-icon-btn" onClick={() => setCollapsed(false)} title="Expandir">
          <ChevronRight size={14} />
        </button>
        <button className="rp-icon-btn" title="Files" onClick={() => { setTab("files"); setCollapsed(false); }}>
          <FolderOpen size={14} />
        </button>
        <button className="rp-icon-btn" title="Contexto" onClick={() => { setTab("context"); setCollapsed(false); }}>
          <Info size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="right-panel" style={{ width }}>
      <div className="rp-resize-handle" onMouseDown={onMouseDown} />
      <div className="rp-header">
        <div className="rp-tabs">
          <button className={`rp-tab${tab === "files" ? " active" : ""}`} onClick={() => setTab("files")}>
            <FolderOpen size={11} /><span>Archivos</span>
          </button>
          <button className={`rp-tab${tab === "context" ? " active" : ""}`} onClick={() => setTab("context")}>
            <Info size={11} /><span>Contexto</span>
          </button>
        </div>
        <button className="rp-collapse-btn" onClick={() => setCollapsed(true)} title="Colapsar">
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="rp-body">
        {tab === "files"   && <FileExplorer />}
        {tab === "context" && <ContextPanel />}
      </div>
    </div>
  );
}

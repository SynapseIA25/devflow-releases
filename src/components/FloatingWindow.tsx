import { useRef, useState, useCallback, useEffect } from "react";
import { X, Minus } from "lucide-react";

type Props = {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  initialPos?: { x: number; y: number };
  initialSize?: { w: number; h: number };
};

export function FloatingWindow({ title, icon, children, onClose, initialPos, initialSize }: Props) {
  const [pos, setPos]   = useState(initialPos  ?? { x: 120, y: 80 });
  const [size, setSize] = useState(initialSize ?? { w: 560, h: 420 });
  const [minimized, setMinimized] = useState(false);

  const dragging  = useRef(false);
  const resizing  = useRef(false);
  const startRef  = useRef({ mx: 0, my: 0, ox: 0, oy: 0, ow: 0, oh: 0 });

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    startRef.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y, ow: size.w, oh: size.h };
    e.preventDefault();
  }, [pos, size]);

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    resizing.current = true;
    startRef.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y, ow: size.w, oh: size.h };
    e.preventDefault();
    e.stopPropagation();
  }, [pos, size]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startRef.current.mx;
      const dy = e.clientY - startRef.current.my;
      if (dragging.current)  setPos({ x: startRef.current.ox + dx, y: startRef.current.oy + dy });
      if (resizing.current)  setSize({ w: Math.max(300, startRef.current.ow + dx), h: Math.max(200, startRef.current.oh + dy) });
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  return (
    <div
      className="floating-window"
      style={{ left: pos.x, top: pos.y, width: size.w, height: minimized ? "auto" : size.h }}
    >
      <div className="fw-header" onMouseDown={onHeaderDown}>
        <div className="fw-title">
          {icon && <span className="fw-icon">{icon}</span>}
          {title}
        </div>
        <div className="fw-actions">
          <button className="fw-btn" onClick={() => setMinimized((v) => !v)} title="Minimizar">
            <Minus size={12} />
          </button>
          <button className="fw-btn fw-btn-close" onClick={onClose} title="Cerrar">
            <X size={12} />
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          <div className="fw-body">{children}</div>
          <div className="fw-resize-handle" onMouseDown={onResizeDown} />
        </>
      )}
    </div>
  );
}

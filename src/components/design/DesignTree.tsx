import { useState } from "react";
import { ChevronUp, ChevronDown, Trash2, Image as ImageIcon } from "lucide-react";
import { useDesignCanvasStore } from "../../store/designCanvasStore";
import { PALETTE_ENTRIES } from "../../lib/designCanvas/palette";
import type { CanvasNode } from "../../lib/designCanvas/types";
import { DESIGN_PALETTE_MIME } from "./DesignPalette";

// Canvas "wireframe": los nodos se dibujan como CAJAS anidadas de verdad (contenedores envuelven a
// sus hijos en el DOM, no una lista indentada) con un tratamiento visual básico por tipo de tag —
// botón parece botón, imagen es un placeholder gris, heading es texto grande. NO es un render fiel a
// CSS del proyecto real (esto sigue editando estructura, no píxeles — el preview visual real es la
// ventana de Design Mode contra el dev server, ver DesignPreviewControls) pero comunica la forma y
// jerarquía de un vistazo en vez de una lista plana de "<tag>".
type WireKind = "container" | "button" | "input" | "image" | "link" | "heading" | "paragraph" | "generic";

const CONTAINER_TAGS = new Set(["div", "section", "article", "main", "header", "footer", "nav", "ul", "ol", "li", "form", "fragment"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const INPUT_TAGS = new Set(["input", "textarea", "select"]);

function wireKindOf(node: CanvasNode): WireKind {
  const tag = node.tag.toLowerCase();
  if (tag === "button") return "button";
  if (INPUT_TAGS.has(tag)) return "input";
  if (tag === "img" || tag === "svg" || tag === "picture") return "image";
  if (tag === "a") return "link";
  if (HEADING_TAGS.has(tag)) return "heading";
  if (tag === "p" || tag === "span" || tag === "label") return "paragraph";
  if (CONTAINER_TAGS.has(tag) || node.children.length > 0) return "container";
  return "generic";
}

// Árbol estructural del canvas de Design (ver plan — el árbol ES la estructura real que termina en el
// archivo). Soltar una entrada de la paleta sobre una caja la agrega como hijo; reordenar entre
// hermanos es por botones (no drag-de-cajas) para mantener el alcance de v1 chico y confiable.
//
// Modo "new": las operaciones son un reducer puro en memoria (applyOp). Modo "edit": cada operación
// hace un splice real contra el archivo en disco (applyStructuralEdit) — puede negarse (archivo
// cambió, estructura no soportada) y ahí se muestra el motivo en vez de aplicar nada.
export function DesignTree() {
  const mode = useDesignCanvasStore((s) => s.mode);
  const tree = useDesignCanvasStore((s) => s.tree);
  const selectedId = useDesignCanvasStore((s) => s.selectedId);
  const selectNode = useDesignCanvasStore((s) => s.selectNode);
  const applyOp = useDesignCanvasStore((s) => s.applyOp);
  const applyStructuralEdit = useDesignCanvasStore((s) => s.applyStructuralEdit);
  const [editError, setEditError] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const runOp = async (op: Parameters<typeof applyOp>[0], entry?: (typeof PALETTE_ENTRIES)[number]) => {
    setEditError(null);
    if (mode === "new") {
      applyOp(op);
      return;
    }
    const reason = await applyStructuralEdit(op, entry);
    if (reason) setEditError(reason);
  };

  const dropEntry = (e: React.DragEvent) => {
    const entryId = e.dataTransfer.getData(DESIGN_PALETTE_MIME);
    return PALETTE_ENTRIES.find((p) => p.id === entryId);
  };

  const onDrop = (e: React.DragEvent, parentId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const entry = dropEntry(e);
    if (!entry) return;
    void runOp({ kind: "insert", parentId, index, node: entry.build() }, entry);
  };

  // Fallback sobre el CONTENEDOR entero: si el árbol tiene poco contenido, las cajas ocupan poco
  // espacio arriba del panel — el resto del área visible necesita aceptar el drop igual (inserta
  // como último hijo de la raíz). El de cada caja (con stopPropagation) sigue ganando cuando el
  // drop es preciso sobre un nodo específico, para poder anidar en cualquier nivel.
  const onContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    const entry = dropEntry(e);
    if (!entry) return;
    void runOp({ kind: "insert", parentId: tree.id, index: tree.children.length, node: entry.build() }, entry);
  };

  const renderControls = (node: CanvasNode, parentId: string, index: number) => (
    <span className="design-wire-controls" onClick={(e) => e.stopPropagation()}>
      <button
        className="design-tree-actionbtn"
        title="Move up"
        onClick={() => void runOp({ kind: "reorder", parentId, nodeId: node.id, toIndex: index - 1 })}
      >
        <ChevronUp size={11} />
      </button>
      <button
        className="design-tree-actionbtn"
        title="Move down"
        onClick={() => void runOp({ kind: "reorder", parentId, nodeId: node.id, toIndex: index + 1 })}
      >
        <ChevronDown size={11} />
      </button>
      <button
        className="design-tree-actionbtn design-tree-actionbtn--danger"
        title="Delete"
        onClick={() => { void runOp({ kind: "delete", nodeId: node.id }); if (selectedId === node.id) selectNode(null); }}
      >
        <Trash2 size={11} />
      </button>
    </span>
  );

  const renderNode = (node: CanvasNode, parentId: string | null, index: number): React.ReactNode => {
    const kind = wireKindOf(node);
    const isSelected = selectedId === node.id;
    const isDragOver = dragOverId === node.id;
    const common = {
      key: node.id,
      className: `design-wire design-wire--${kind}${isSelected ? " selected" : ""}${isDragOver ? " drag-over" : ""}`,
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); selectNode(node.id); },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOverId(node.id); },
      onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); setDragOverId((id) => (id === node.id ? null : id)); },
      onDrop: (e: React.DragEvent) => onDrop(e, node.id, node.children.length),
    };
    const label = <span className="design-wire-label">&lt;{node.tag}&gt;</span>;
    const controls = node.id !== "root" && parentId ? renderControls(node, parentId, index) : null;

    if (kind === "button") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-button">{node.textContent || "Button"}</span>
        </div>
      );
    }
    if (kind === "input") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-input">
            {(node.props.placeholder && node.props.placeholder.kind === "string" ? node.props.placeholder.value : "") || "Input"}
          </span>
        </div>
      );
    }
    if (kind === "image") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-image"><ImageIcon size={18} /></span>
        </div>
      );
    }
    if (kind === "link") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-linktext">{node.textContent || "Link"}</span>
        </div>
      );
    }
    if (kind === "heading") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-heading">{node.textContent || "Heading"}</span>
        </div>
      );
    }
    if (kind === "paragraph") {
      return (
        <div {...common}>
          {label}{controls}
          <span className="design-wire-paragraph">{node.textContent || "Text"}</span>
        </div>
      );
    }
    // container / generic: caja que envuelve a sus hijos de verdad (nesting real, no indentación).
    return (
      <div {...common}>
        <div className="design-wire-containerhead">{label}{controls}</div>
        <div className="design-wire-children">
          {node.children.length === 0 && <div className="design-wire-empty">Drop components here</div>}
          {node.children.map((child, i) => renderNode(child, node.id, i))}
        </div>
      </div>
    );
  };

  return (
    <div className="design-tree" onDragOver={(e) => e.preventDefault()} onDrop={onContainerDrop}>
      <div className="design-tree-hint">Drag components from the palette anywhere here — drop on a box to nest inside it.</div>
      {editError && <div className="design-save-status design-save-status--error">{editError}</div>}
      {renderNode(tree, null, 0)}
    </div>
  );
}

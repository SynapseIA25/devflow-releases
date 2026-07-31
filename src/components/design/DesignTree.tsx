import { useState } from "react";
import { ChevronUp, ChevronDown, Trash2, Image as ImageIcon } from "lucide-react";
import { useDesignCanvasStore } from "../../store/designCanvasStore";
import { isDescendantOf } from "../../lib/designCanvas/operations";
import { PALETTE_ENTRIES } from "../../lib/designCanvas/palette";
import type { CanvasNode } from "../../lib/designCanvas/types";
import { DESIGN_PALETTE_MIME } from "./DesignPalette";

// MIME propio para arrastrar un nodo YA EXISTENTE del canvas (mover/reparentar) — distinto del MIME
// de la paleta (que siempre CREA un nodo nuevo), mismo criterio de "un MIME por tipo de payload" que
// ya usa el resto del repo (application/reactflow vs application/devflow-flowid en Sidebar.tsx).
const DESIGN_NODE_MIME = "application/x-devflow-design-node";

// Aplica el "style" del nodo (texto CSS crudo del inspector) como estilo inline REAL sobre la caja
// del wireframe — a diferencia de cualquier otro prop (className, href...), que son solo metadata
// estructural, esto le da feedback visual inmediato al control de estilo del inspector, sin dejar de
// ser el mismo texto que después se serializa como objeto en el JSX real (ver
// serializeJsx.cssTextToObjectLiteral). Parseo tolerante: una declaración rota no rompe el resto.
function cssTextToStyleObject(cssText: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of cssText.split(";")) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const value = decl.slice(colonIdx + 1).trim();
    if (prop && value) style[prop] = value; // kebab-case anda perfecto en el atributo style del DOM
  }
  return style as React.CSSProperties;
}

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

  // Un drop puede ser (a) una entrada de la paleta → crea un nodo nuevo, o (b) un nodo YA existente
  // del canvas (arrastrado con el mouse) → lo mueve/reparenta. `move` en modo "edit" se niega con
  // gracia si el destino es un contenedor distinto al actual (ver applyStructuralEdit) — acá solo se
  // guarda contra el caso trivial de soltar un nodo adentro de su propio subárbol (ciclo).
  const onDrop = (e: React.DragEvent, parentId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const entry = dropEntry(e);
    if (entry) {
      void runOp({ kind: "insert", parentId, index, node: entry.build() }, entry);
      return;
    }
    const movedId = e.dataTransfer.getData(DESIGN_NODE_MIME);
    if (!movedId || movedId === parentId || isDescendantOf(tree, movedId, parentId)) return;
    void runOp({ kind: "move", nodeId: movedId, toParentId: parentId, toIndex: index });
  };

  // Soltar sobre un elemento de CONTENIDO (botón, heading, imagen...) no puede "anidar adentro" — ese
  // tipo de caja no dibuja hijos (ver renderNode), así que el nodo soltado quedaría en el árbol pero
  // invisible. En vez de eso, el drop se interpreta como "insertar como HERMANO, justo después de
  // este elemento" — mismo padre, index+1. Solo los contenedores (container/generic) reciben el drop
  // como "nest inside".
  const onDropAsSibling = (e: React.DragEvent, siblingParentId: string, afterIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const entry = dropEntry(e);
    if (entry) {
      void runOp({ kind: "insert", parentId: siblingParentId, index: afterIndex + 1, node: entry.build() }, entry);
      return;
    }
    const movedId = e.dataTransfer.getData(DESIGN_NODE_MIME);
    if (!movedId || movedId === siblingParentId || isDescendantOf(tree, movedId, siblingParentId)) return;
    void runOp({ kind: "move", nodeId: movedId, toParentId: siblingParentId, toIndex: afterIndex + 1 });
  };

  // Fallback sobre el CONTENEDOR entero: si el árbol tiene poco contenido, las cajas ocupan poco
  // espacio arriba del panel — el resto del área visible necesita aceptar el drop igual (inserta
  // como último hijo de la raíz). El de cada caja (con stopPropagation) sigue ganando cuando el
  // drop es preciso sobre un nodo específico, para poder anidar en cualquier nivel.
  const onContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    const entry = dropEntry(e);
    if (entry) {
      void runOp({ kind: "insert", parentId: tree.id, index: tree.children.length, node: entry.build() }, entry);
      return;
    }
    const movedId = e.dataTransfer.getData(DESIGN_NODE_MIME);
    if (!movedId || movedId === tree.id) return;
    void runOp({ kind: "move", nodeId: movedId, toParentId: tree.id, toIndex: tree.children.length });
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
    const isContainerKind = kind === "container" || kind === "generic";
    const isSelected = selectedId === node.id;
    const isDragOver = dragOverId === node.id;
    const styleProp = node.props.style;
    const common = {
      key: node.id,
      className: `design-wire design-wire--${kind}${isSelected ? " selected" : ""}${isDragOver ? " drag-over" : ""}`,
      style: styleProp && styleProp.kind === "string" ? cssTextToStyleObject(styleProp.value) : undefined,
      // La raíz no se puede arrastrar (no tiene padre al que volver) — el resto sí, para reordenar/
      // reparentar con el mouse en vez de solo los botones ↑/↓.
      draggable: node.id !== "root",
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.setData(DESIGN_NODE_MIME, node.id);
        e.dataTransfer.effectAllowed = "move";
      },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); selectNode(node.id); },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOverId(node.id); },
      onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); setDragOverId((id) => (id === node.id ? null : id)); },
      // Contenedores: anida adentro. Elementos de contenido (botón, heading...): insertar adentro no
      // tiene dónde dibujarse (ver renderNode más abajo), así que el drop ahí inserta como hermano
      // justo después — necesita el padre y el índice DE ESTE nodo, no los suyos propios.
      onDrop: isContainerKind
        ? (e: React.DragEvent) => onDrop(e, node.id, node.children.length)
        : (e: React.DragEvent) => { if (parentId) onDropAsSibling(e, parentId, index); },
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
      <div className="design-tree-hint">
        Drag components from the palette to add them. Drag an existing box to move/reorder it — drop
        on another box to nest inside it.
      </div>
      {editError && <div className="design-save-status design-save-status--error">{editError}</div>}
      {renderNode(tree, null, 0)}
    </div>
  );
}

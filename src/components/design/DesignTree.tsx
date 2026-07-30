import { useState } from "react";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { useDesignCanvasStore } from "../../store/designCanvasStore";
import { PALETTE_ENTRIES } from "../../lib/designCanvas/palette";
import type { CanvasNode } from "../../lib/designCanvas/types";
import { DESIGN_PALETTE_MIME } from "./DesignPalette";

// Árbol estructural del canvas: lista indentada, no un canvas de píxeles (ver plan — el árbol ES la
// estructura real, el preview visual vive en la ventana de Design Mode apuntando al dev server real).
// Soltar una entrada de la paleta sobre una fila la agrega como hijo de esa fila; reordenar entre
// hermanos es por botones (no drag-de-filas) para mantener el alcance de v1 chico y confiable.
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

  const runOp = async (op: Parameters<typeof applyOp>[0], entry?: (typeof PALETTE_ENTRIES)[number]) => {
    setEditError(null);
    if (mode === "new") {
      applyOp(op);
      return;
    }
    const reason = await applyStructuralEdit(op, entry);
    if (reason) setEditError(reason);
  };

  const onDrop = (e: React.DragEvent, parentId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const entryId = e.dataTransfer.getData(DESIGN_PALETTE_MIME);
    const entry = PALETTE_ENTRIES.find((p) => p.id === entryId);
    if (!entry) return;
    void runOp({ kind: "insert", parentId, index, node: entry.build() }, entry);
  };

  const renderRow = (node: CanvasNode, depth: number, parentId: string | null, index: number): React.ReactNode => (
    <div key={node.id}>
      <div
        className={`design-tree-row${selectedId === node.id ? " selected" : ""}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => selectNode(node.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, node.id, node.children.length)}
      >
        <span className="design-tree-tag">&lt;{node.tag}&gt;</span>
        {node.textContent !== undefined && <span className="design-tree-text">{node.textContent}</span>}
        {node.id !== "root" && parentId && (
          <span className="design-tree-actions">
            <button
              className="design-tree-actionbtn"
              title="Move up"
              onClick={(e) => { e.stopPropagation(); void runOp({ kind: "reorder", parentId, nodeId: node.id, toIndex: index - 1 }); }}
            >
              <ChevronUp size={11} />
            </button>
            <button
              className="design-tree-actionbtn"
              title="Move down"
              onClick={(e) => { e.stopPropagation(); void runOp({ kind: "reorder", parentId, nodeId: node.id, toIndex: index + 1 }); }}
            >
              <ChevronDown size={11} />
            </button>
            <button
              className="design-tree-actionbtn design-tree-actionbtn--danger"
              title="Delete"
              onClick={(e) => { e.stopPropagation(); void runOp({ kind: "delete", nodeId: node.id }); if (selectedId === node.id) selectNode(null); }}
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>
      {node.children.map((child, i) => renderRow(child, depth + 1, node.id, i))}
    </div>
  );

  return (
    <div className="design-tree">
      <div className="design-tree-hint">Drag components from the palette onto a row to nest them inside.</div>
      {editError && <div className="design-save-status design-save-status--error">{editError}</div>}
      {renderRow(tree, 0, null, 0)}
    </div>
  );
}

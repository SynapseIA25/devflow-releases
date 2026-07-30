import { useDesignCanvasStore } from "../../store/designCanvasStore";
import { TEXT_CONTENT_PROP } from "../../lib/designCanvas/operations";

// Set curado de props comunes editables desde el canvas — a propósito, no props/expresiones libres
// (eso sigue siendo trabajo del editor de Código). Solo se ofrecen las que tienen sentido según el
// tag del nodo seleccionado.
const COMMON_PROPS_BY_TAG: Record<string, string[]> = {
  a: ["href", "className"],
  img: ["src", "alt", "className"],
  input: ["placeholder", "className"],
  default: ["className"],
};

function findNode(node: ReturnType<typeof useDesignCanvasStore.getState>["tree"], id: string): typeof node | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function DesignPropsInspector() {
  const mode = useDesignCanvasStore((s) => s.mode);
  const tree = useDesignCanvasStore((s) => s.tree);
  const selectedId = useDesignCanvasStore((s) => s.selectedId);
  const applyOp = useDesignCanvasStore((s) => s.applyOp);
  const applyStructuralEdit = useDesignCanvasStore((s) => s.applyStructuralEdit);

  const node = selectedId ? findNode(tree, selectedId) : null;

  const editProp = (propName: string, value: string | null) => {
    if (!node) return;
    if (mode === "new") { applyOp({ kind: "editProp", nodeId: node.id, propName, value }); return; }
    void applyStructuralEdit({ kind: "editProp", nodeId: node.id, propName, value });
  };

  if (!node) {
    return (
      <aside className="design-props">
        <div className="sidebar-label">Properties</div>
        <div className="design-props-empty">Select a component in the tree to edit its properties.</div>
      </aside>
    );
  }

  const propNames = COMMON_PROPS_BY_TAG[node.tag] ?? COMMON_PROPS_BY_TAG.default;

  return (
    <aside className="design-props">
      <div className="sidebar-label">Properties — &lt;{node.tag}&gt;</div>
      {node.textContent !== undefined && (
        <div className="design-props-row">
          <label className="design-props-label">Text</label>
          <textarea
            className="design-props-input"
            rows={2}
            value={node.textContent}
            onChange={(e) => editProp(TEXT_CONTENT_PROP, e.target.value)}
          />
        </div>
      )}
      {propNames.map((name) => {
        const prop = node.props[name];
        const value = prop && prop.kind === "string" ? prop.value : "";
        const readOnly = prop !== undefined && prop.kind === "expression";
        return (
          <div className="design-props-row" key={name}>
            <label className="design-props-label">{name}</label>
            <input
              className="design-props-input"
              value={readOnly ? (prop as { raw: string }).raw : value}
              disabled={readOnly}
              title={readOnly ? "Expression — edit in the Code editor" : undefined}
              onChange={(e) => editProp(name, e.target.value || null)}
            />
          </div>
        );
      })}
    </aside>
  );
}

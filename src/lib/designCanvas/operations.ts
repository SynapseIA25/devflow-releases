// Reducer puro sobre el árbol en memoria del canvas. Sin I/O, sin conocimiento de archivos — usado
// tanto para construir un componente nuevo desde cero (función a) como espejo en memoria antes de
// spliciar un archivo existente (función b, ver jsxSplicer.ts).
import type { CanvasNode, CanvasNodeId, PropValue } from "./types";

export type CanvasOp =
  | { kind: "insert"; parentId: CanvasNodeId; index: number; node: CanvasNode }
  | { kind: "delete"; nodeId: CanvasNodeId }
  | { kind: "reorder"; parentId: CanvasNodeId; nodeId: CanvasNodeId; toIndex: number }
  | { kind: "editProp"; nodeId: CanvasNodeId; propName: string; value: string | null }; // null = sacar la prop

function mapChildren(node: CanvasNode, fn: (child: CanvasNode) => CanvasNode | null): CanvasNode {
  const children = node.children.map(fn).filter((c): c is CanvasNode => c !== null);
  return children === node.children ? node : { ...node, children };
}

function insertInto(tree: CanvasNode, parentId: CanvasNodeId, index: number, newNode: CanvasNode): CanvasNode {
  if (tree.id === parentId) {
    const children = [...tree.children];
    const clamped = Math.max(0, Math.min(index, children.length));
    children.splice(clamped, 0, newNode);
    return { ...tree, children };
  }
  return mapChildren(tree, (child) => insertInto(child, parentId, index, newNode));
}

function deleteFrom(tree: CanvasNode, nodeId: CanvasNodeId): CanvasNode {
  return mapChildren(tree, (child) => (child.id === nodeId ? null : deleteFrom(child, nodeId)));
}

function reorderWithin(tree: CanvasNode, parentId: CanvasNodeId, nodeId: CanvasNodeId, toIndex: number): CanvasNode {
  if (tree.id === parentId) {
    const fromIndex = tree.children.findIndex((c) => c.id === nodeId);
    if (fromIndex === -1) return tree;
    const children = [...tree.children];
    const [moved] = children.splice(fromIndex, 1);
    const clamped = Math.max(0, Math.min(toIndex, children.length));
    children.splice(clamped, 0, moved);
    return { ...tree, children };
  }
  return mapChildren(tree, (child) => reorderWithin(child, parentId, nodeId, toIndex));
}

// Sentinela para editar el textContent de un nodo por la misma operación "editProp" en vez de sumar
// un kind nuevo al union — el texto de un nodo es, conceptualmente, otro atributo editable del canvas.
export const TEXT_CONTENT_PROP = "__text__";

function editPropOf(tree: CanvasNode, nodeId: CanvasNodeId, propName: string, value: string | null): CanvasNode {
  if (tree.id === nodeId) {
    if (propName === TEXT_CONTENT_PROP) {
      return { ...tree, textContent: value ?? undefined };
    }
    const props = { ...tree.props };
    if (value === null) delete props[propName];
    else props[propName] = { kind: "string", value } satisfies PropValue;
    return { ...tree, props };
  }
  return mapChildren(tree, (child) => editPropOf(child, nodeId, propName, value));
}

export function applyOpToTree(tree: CanvasNode, op: CanvasOp): CanvasNode {
  switch (op.kind) {
    case "insert":
      return insertInto(tree, op.parentId, op.index, op.node);
    case "delete":
      // El nodo raíz nunca se borra a sí mismo por esta vía — borrar la raíz no tiene un padre al
      // que devolver, el caller (la UI) no debería ofrecer esa acción sobre el nodo raíz.
      return tree.id === op.nodeId ? tree : deleteFrom(tree, op.nodeId);
    case "reorder":
      return reorderWithin(tree, op.parentId, op.nodeId, op.toIndex);
    case "editProp":
      return editPropOf(tree, op.nodeId, op.propName, op.value);
  }
}

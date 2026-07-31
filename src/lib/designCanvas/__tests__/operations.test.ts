import { describe, it, expect } from "vitest";
import { applyOpToTree, isDescendantOf } from "../operations";
import type { CanvasNode } from "../types";

const node = (id: string, tag: string, children: CanvasNode[] = []): CanvasNode => ({
  id,
  tag,
  props: {},
  children,
});

describe("applyOpToTree — insert", () => {
  it("inserta un hijo nuevo en el índice pedido", () => {
    const tree = node("root", "div", [node("a", "p"), node("b", "p")]);
    const result = applyOpToTree(tree, { kind: "insert", parentId: "root", index: 1, node: node("new", "span") });
    expect(result.children.map((c) => c.id)).toEqual(["a", "new", "b"]);
  });

  it("clampea un índice fuera de rango al final", () => {
    const tree = node("root", "div", [node("a", "p")]);
    const result = applyOpToTree(tree, { kind: "insert", parentId: "root", index: 99, node: node("new", "span") });
    expect(result.children.map((c) => c.id)).toEqual(["a", "new"]);
  });

  it("inserta en un nodo anidado, no solo en la raíz", () => {
    const tree = node("root", "div", [node("mid", "section", [node("a", "p")])]);
    const result = applyOpToTree(tree, { kind: "insert", parentId: "mid", index: 0, node: node("new", "span") });
    expect(result.children[0].children.map((c) => c.id)).toEqual(["new", "a"]);
  });
});

describe("applyOpToTree — delete", () => {
  it("borra el único hijo de la raíz sin romper el árbol", () => {
    const tree = node("root", "div", [node("only", "p")]);
    const result = applyOpToTree(tree, { kind: "delete", nodeId: "only" });
    expect(result.children).toEqual([]);
  });

  it("no borra la raíz a sí misma", () => {
    const tree = node("root", "div", [node("a", "p")]);
    const result = applyOpToTree(tree, { kind: "delete", nodeId: "root" });
    expect(result.id).toBe("root");
    expect(result.children).toHaveLength(1);
  });

  it("borrar un id inexistente no cambia el árbol", () => {
    const tree = node("root", "div", [node("a", "p")]);
    const result = applyOpToTree(tree, { kind: "delete", nodeId: "nope" });
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("applyOpToTree — reorder", () => {
  it("mueve un hijo a un índice nuevo dentro del mismo padre", () => {
    const tree = node("root", "div", [node("a", "p"), node("b", "p"), node("c", "p")]);
    const result = applyOpToTree(tree, { kind: "reorder", parentId: "root", nodeId: "a", toIndex: 2 });
    expect(result.children.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("reordenar al mismo índice deja el árbol equivalente", () => {
    const tree = node("root", "div", [node("a", "p"), node("b", "p")]);
    const result = applyOpToTree(tree, { kind: "reorder", parentId: "root", nodeId: "a", toIndex: 0 });
    expect(result.children.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("nodeId inexistente en ese padre no cambia nada", () => {
    const tree = node("root", "div", [node("a", "p")]);
    const result = applyOpToTree(tree, { kind: "reorder", parentId: "root", nodeId: "nope", toIndex: 0 });
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("applyOpToTree — editProp", () => {
  it("agrega una prop nueva", () => {
    const tree = node("root", "div");
    const result = applyOpToTree(tree, { kind: "editProp", nodeId: "root", propName: "className", value: "card" });
    expect(result.props.className).toEqual({ kind: "string", value: "card" });
  });

  it("edita una prop existente", () => {
    const tree: CanvasNode = { ...node("root", "div"), props: { className: { kind: "string", value: "old" } } };
    const result = applyOpToTree(tree, { kind: "editProp", nodeId: "root", propName: "className", value: "new" });
    expect(result.props.className).toEqual({ kind: "string", value: "new" });
  });

  it("value null saca la prop", () => {
    const tree: CanvasNode = { ...node("root", "div"), props: { className: { kind: "string", value: "x" } } };
    const result = applyOpToTree(tree, { kind: "editProp", nodeId: "root", propName: "className", value: null });
    expect(result.props.className).toBeUndefined();
  });

  it("editar una prop que no existe y sacarla (value null) no rompe nada", () => {
    const tree = node("root", "div");
    const result = applyOpToTree(tree, { kind: "editProp", nodeId: "root", propName: "nope", value: null });
    expect(result.props.nope).toBeUndefined();
  });

  it("edita una prop en un nodo anidado", () => {
    const tree = node("root", "div", [node("child", "button")]);
    const result = applyOpToTree(tree, { kind: "editProp", nodeId: "child", propName: "disabled", value: "true" });
    expect(result.children[0].props.disabled).toEqual({ kind: "string", value: "true" });
  });
});

describe("applyOpToTree — move (drag entre contenedores)", () => {
  it("reparenta un nodo a otro contenedor", () => {
    const tree = node("root", "div", [
      node("a", "section", [node("x", "p")]),
      node("b", "section", []),
    ]);
    const result = applyOpToTree(tree, { kind: "move", nodeId: "x", toParentId: "b", toIndex: 0 });
    expect(result.children[0].children).toHaveLength(0);
    expect(result.children[1].children.map((c) => c.id)).toEqual(["x"]);
  });

  it("reordena dentro del mismo padre (mover al final)", () => {
    const tree = node("root", "div", [node("a", "p"), node("b", "p"), node("c", "p")]);
    const result = applyOpToTree(tree, { kind: "move", nodeId: "a", toParentId: "root", toIndex: 2 });
    expect(result.children.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("no mueve la raíz", () => {
    const tree = node("root", "div", [node("a", "section", [])]);
    const result = applyOpToTree(tree, { kind: "move", nodeId: "root", toParentId: "a", toIndex: 0 });
    expect(result.id).toBe("root");
    expect(result.children).toHaveLength(1);
  });

  it("no mueve un nodo adentro de su propio subárbol (ciclo)", () => {
    const tree = node("root", "div", [node("a", "section", [node("x", "p")])]);
    const result = applyOpToTree(tree, { kind: "move", nodeId: "a", toParentId: "x", toIndex: 0 });
    // El árbol queda intacto: "a" sigue siendo hijo de "root", no de su propio hijo "x".
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
    expect(result.children[0].children.map((c) => c.id)).toEqual(["x"]);
  });

  it("moverse a sí mismo como padre es un no-op seguro", () => {
    const tree = node("root", "div", [node("a", "section", [])]);
    const result = applyOpToTree(tree, { kind: "move", nodeId: "a", toParentId: "a", toIndex: 0 });
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("isDescendantOf", () => {
  it("detecta un descendiente directo e indirecto", () => {
    const tree = node("root", "div", [node("a", "section", [node("x", "p")])]);
    expect(isDescendantOf(tree, "a", "x")).toBe(true);
    expect(isDescendantOf(tree, "root", "x")).toBe(true);
  });

  it("un nodo es descendiente de sí mismo (caso borde: no dejar moverlo a sí mismo)", () => {
    const tree = node("root", "div", [node("a", "section", [])]);
    expect(isDescendantOf(tree, "a", "a")).toBe(true);
  });

  it("false si no hay relación de ancestro", () => {
    const tree = node("root", "div", [node("a", "section", []), node("b", "section", [])]);
    expect(isDescendantOf(tree, "a", "b")).toBe(false);
  });
});

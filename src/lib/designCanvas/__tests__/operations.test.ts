import { describe, it, expect } from "vitest";
import { applyOpToTree } from "../operations";
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

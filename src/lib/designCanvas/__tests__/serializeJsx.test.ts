import { describe, it, expect } from "vitest";
import { emitJsx, emitComponentFile } from "../serializeJsx";
import type { CanvasNode } from "../types";

const node = (partial: Partial<CanvasNode>): CanvasNode => ({
  id: "x",
  tag: "div",
  props: {},
  children: [],
  ...partial,
});

describe("emitJsx", () => {
  it("auto-cierra un nodo sin hijos ni texto", () => {
    expect(emitJsx(node({ tag: "img" }))).toBe("<img />");
  });

  it("serializa props string y de expresión", () => {
    const n = node({
      tag: "input",
      props: {
        placeholder: { kind: "string", value: "Name" },
        onChange: { kind: "expression", raw: "handleChange", editable: false },
      },
    });
    expect(emitJsx(n)).toBe('<input placeholder="Name" onChange={handleChange} />');
  });

  it("escapa comillas dobles en un valor string", () => {
    const n = node({ tag: "div", props: { title: { kind: "string", value: 'a "quote"' } } });
    expect(emitJsx(n)).toBe('<div title="a &quot;quote&quot;" />');
  });

  it("nodo con solo texto: abre, texto, cierra en una línea", () => {
    const n = node({ tag: "button", textContent: "Click me" });
    expect(emitJsx(n)).toBe("<button>Click me</button>");
  });

  it("nodo con hijos: anida con 2 espacios por nivel", () => {
    const n = node({
      tag: "div",
      children: [node({ tag: "h2", textContent: "Title" }), node({ tag: "p", textContent: "Body" })],
    });
    expect(emitJsx(n)).toBe(["<div>", "  <h2>Title</h2>", "  <p>Body</p>", "</div>"].join("\n"));
  });

  it("respeta el indent inicial pasado", () => {
    const n = node({ tag: "span", textContent: "hi" });
    expect(emitJsx(n, 2)).toBe("    <span>hi</span>");
  });

  it("anidamiento profundo mantiene la indentación en cada nivel", () => {
    const n = node({
      tag: "div",
      children: [
        node({
          tag: "section",
          children: [node({ tag: "p", textContent: "deep" })],
        }),
      ],
    });
    expect(emitJsx(n)).toBe(
      ["<div>", "  <section>", "    <p>deep</p>", "  </section>", "</div>"].join("\n")
    );
  });
});

describe("emitComponentFile", () => {
  it("envuelve el árbol en un componente función exportado", () => {
    const n = node({ tag: "div", textContent: "hi" });
    expect(emitComponentFile("Greeting", n)).toBe(
      ["export function Greeting() {", "  return (", '    <div>hi</div>', "  );", "}", ""].join("\n")
    );
  });
});

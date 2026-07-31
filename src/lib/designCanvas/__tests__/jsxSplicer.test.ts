import { describe, it, expect } from "vitest";
import {
  spliceInsertChild,
  spliceDelete,
  spliceSwapSibling,
  spliceEditProp,
  spliceReorderChildren,
  loadCanvasFromFile,
} from "../jsxSplicer";
import { TEXT_CONTENT_PROP } from "../operations";
import type { CanvasNode } from "../types";

const leaf = (tag: string): CanvasNode => ({ id: "new", tag, props: {}, children: [] });

describe("spliceInsertChild", () => {
  it("inserta un hijo nuevo antes del cierre de un elemento con hijos existentes", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>hi</p>\n    </div>\n  );\n}\n";
    const divFrom = source.indexOf("<div>");
    const divTo = source.indexOf("</div>") + "</div>".length;
    const result = spliceInsertChild(source, { from: divFrom, to: divTo }, "div", leaf("button"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSource).toContain("<button />");
      expect(result.newSource).toContain("<p>hi</p>");
      // El archivo sigue siendo JSX válido: se puede volver a cargar sin bail-out.
      const reloaded = loadCanvasFromFile(result.newSource);
      expect(reloaded.unsupported).toBe(false);
    }
  });

  it("convierte un elemento auto-cerrado a apertura+cierre antes de insertar el primer hijo", () => {
    const source = 'function App() {\n  return <div className="box" />;\n}\n';
    const divFrom = source.indexOf("<div");
    const divTo = source.indexOf("/>") + 2;
    const result = spliceInsertChild(source, { from: divFrom, to: divTo }, "div", leaf("span"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSource).toContain('<div className="box">');
      expect(result.newSource).toContain("</div>");
      expect(result.newSource).toContain("<span />");
      expect(result.newSource).not.toContain('className="box" />'); // ya no queda auto-cerrado
    }
  });

  it("se niega si el rango ya no coincide con el tag esperado (archivo cambió)", () => {
    const source = "function App() {\n  return <div>hi</div>;\n}\n";
    const result = spliceInsertChild(source, { from: 0, to: 5 }, "div", leaf("span"));
    expect(result.ok).toBe(false);
  });
});

describe("spliceDelete", () => {
  it("borra un elemento y su whitespace líder, no deja línea vacía", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  );\n}\n";
    const pFrom = source.indexOf("<p>b</p>");
    const pTo = pFrom + "<p>b</p>".length;
    const result = spliceDelete(source, { from: pFrom, to: pTo }, "p");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSource).not.toContain("<p>b</p>");
      expect(result.newSource).toContain("<p>a</p>");
      expect(result.newSource).not.toMatch(/\n\s*\n\s*<\/div>/); // sin línea vacía antes del cierre
    }
  });
});

describe("spliceSwapSibling", () => {
  it("intercambia con el hermano siguiente (direction down)", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  );\n}\n";
    const aFrom = source.indexOf("<p>a</p>");
    const aTo = aFrom + "<p>a</p>".length;
    const result = spliceSwapSibling(source, { from: aFrom, to: aTo }, "p", "down");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const iA = result.newSource.indexOf("<p>a</p>");
      const iB = result.newSource.indexOf("<p>b</p>");
      expect(iB).toBeLessThan(iA);
    }
  });

  it("se niega si no hay hermano en esa dirección", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>only</p>\n    </div>\n  );\n}\n";
    const from = source.indexOf("<p>only</p>");
    const to = from + "<p>only</p>".length;
    const result = spliceSwapSibling(source, { from, to }, "p", "up");
    expect(result.ok).toBe(false);
  });
});

describe("spliceReorderChildren", () => {
  it("reordena 3 hijos a un orden arbitrario en un solo shot", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>a</p>\n      <p>b</p>\n      <p>c</p>\n    </div>\n  );\n}\n";
    const divFrom = source.indexOf("<div>");
    const divTo = source.indexOf("</div>") + "</div>".length;
    const aFrom = source.indexOf("<p>a</p>");
    const bFrom = source.indexOf("<p>b</p>");
    const cFrom = source.indexOf("<p>c</p>");
    const ranges = [
      { from: aFrom, to: aFrom + "<p>a</p>".length },
      { from: bFrom, to: bFrom + "<p>b</p>".length },
      { from: cFrom, to: cFrom + "<p>c</p>".length },
    ];
    // c, a, b
    const result = spliceReorderChildren(source, { from: divFrom, to: divTo }, "div", ranges, [2, 0, 1]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const iA = result.newSource.indexOf("<p>a</p>");
      const iB = result.newSource.indexOf("<p>b</p>");
      const iC = result.newSource.indexOf("<p>c</p>");
      expect(iC).toBeLessThan(iA);
      expect(iA).toBeLessThan(iB);
      // Sigue siendo JSX válido con la misma cantidad de hijos.
      const reloaded = loadCanvasFromFile(result.newSource);
      expect(reloaded.unsupported).toBe(false);
      if (!reloaded.unsupported) expect(reloaded.tree.children).toHaveLength(3);
    }
  });

  it("no toca nada si el orden nuevo es igual al viejo", () => {
    const source = "function App() {\n  return (\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  );\n}\n";
    const divFrom = source.indexOf("<div>");
    const divTo = source.indexOf("</div>") + "</div>".length;
    const aFrom = source.indexOf("<p>a</p>");
    const bFrom = source.indexOf("<p>b</p>");
    const ranges = [
      { from: aFrom, to: aFrom + "<p>a</p>".length },
      { from: bFrom, to: bFrom + "<p>b</p>".length },
    ];
    const result = spliceReorderChildren(source, { from: divFrom, to: divTo }, "div", ranges, [0, 1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toBe(source);
  });
});

describe("spliceEditProp", () => {
  it("edita el valor de una prop string existente", () => {
    const source = 'function App() {\n  return <button className="old">Go</button>;\n}\n';
    const from = source.indexOf("<button");
    const to = source.indexOf("</button>") + "</button>".length;
    const result = spliceEditProp(source, { from, to }, "button", "className", "new");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toContain('className="new"');
  });

  it("agrega una prop nueva que no existía", () => {
    const source = "function App() {\n  return <button>Go</button>;\n}\n";
    const from = source.indexOf("<button");
    const to = source.indexOf("</button>") + "</button>".length;
    const result = spliceEditProp(source, { from, to }, "button", "disabled", "true");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toContain('disabled="true"');
  });

  it("agregar 'style' emite un objeto, no un string plano como en HTML", () => {
    const source = "function App() {\n  return <div>hi</div>;\n}\n";
    const from = source.indexOf("<div");
    const to = source.indexOf("</div>") + "</div>".length;
    const result = spliceEditProp(source, { from, to }, "div", "style", "width: 100px;");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSource).toContain('style={{width: "100px"}}');
      const reloaded = loadCanvasFromFile(result.newSource);
      expect(reloaded.unsupported).toBe(false);
    }
  });

  it("saca una prop existente con value null", () => {
    const source = 'function App() {\n  return <button className="x">Go</button>;\n}\n';
    const from = source.indexOf("<button");
    const to = source.indexOf("</button>") + "</button>".length;
    const result = spliceEditProp(source, { from, to }, "button", "className", null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).not.toContain("className");
  });

  it("se niega a editar una prop que es una expresión", () => {
    const source = "function App() {\n  return <button onClick={handleClick}>Go</button>;\n}\n";
    const from = source.indexOf("<button");
    const to = source.indexOf("</button>") + "</button>".length;
    const result = spliceEditProp(source, { from, to }, "button", "onClick", "nope");
    expect(result.ok).toBe(false);
  });

  it("edita el texto de un elemento con TEXT_CONTENT_PROP", () => {
    const source = "function App() {\n  return <button>Go</button>;\n}\n";
    const from = source.indexOf("<button");
    const to = source.indexOf("</button>") + "</button>".length;
    const result = spliceEditProp(source, { from, to }, "button", TEXT_CONTENT_PROP, "Submit");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toContain("<button>Submit</button>");
  });

  it("se niega a editar el texto si el elemento tiene hijos más complejos", () => {
    const source = "function App() {\n  return <div><span>a</span></div>;\n}\n";
    const from = source.indexOf("<div");
    const to = source.indexOf("</div>") + "</div>".length;
    const result = spliceEditProp(source, { from, to }, "div", TEXT_CONTENT_PROP, "x");
    expect(result.ok).toBe(false);
  });
});

describe("loadCanvasFromFile", () => {
  it("carga un árbol simple correctamente, con sourceRange", () => {
    const source = 'function App() {\n  return (\n    <div className="root">\n      <p>hi</p>\n    </div>\n  );\n}\n';
    const result = loadCanvasFromFile(source);
    expect(result.unsupported).toBe(false);
    if (!result.unsupported) {
      expect(result.tree.tag).toBe("div");
      expect(result.tree.props.className).toEqual({ kind: "string", value: "root" });
      expect(result.tree.children).toHaveLength(1);
      expect(result.tree.children[0].tag).toBe("p");
      expect(result.tree.children[0].textContent).toBe("hi");
      expect(result.tree.sourceRange).toBeDefined();
    }
  });

  it("hace bail-out en un archivo con .map()", () => {
    const source = "function App() {\n  return <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>;\n}\n";
    const result = loadCanvasFromFile(source);
    expect(result.unsupported).toBe(true);
  });

  it("hace bail-out en renderizado condicional con &&", () => {
    const source = "function App() {\n  return <div>{loading && <Spinner />}</div>;\n}\n";
    const result = loadCanvasFromFile(source);
    expect(result.unsupported).toBe(true);
  });

  it("hace bail-out en un archivo sin JSX", () => {
    const source = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const result = loadCanvasFromFile(source);
    expect(result.unsupported).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { resolveTemplate, getPath, parseList, type NodeResult } from "../workflowTemplate";

const R = (entries: Record<string, NodeResult>) => new Map(Object.entries(entries));

describe("resolveTemplate — variables básicas", () => {
  it("{{input}} se reemplaza por el input", () => {
    expect(resolveTemplate("hola {{input}}", R({}), "mundo")).toBe("hola mundo");
  });
  it("{{id.output}} toma la salida del nodo", () => {
    expect(resolveTemplate("[{{a.output}}]", R({ a: { output: "42" } }), "")).toBe("[42]");
  });
  it("{{id.exitCode}} y {{id.branch}}", () => {
    const r = R({ n: { output: "x", exitCode: 3, branch: "true" } });
    expect(resolveTemplate("{{n.exitCode}}/{{n.branch}}", r, "")).toBe("3/true");
  });
  it("exitCode ausente resuelve a cadena vacía", () => {
    expect(resolveTemplate("[{{n.exitCode}}]", R({ n: { output: "x" } }), "")).toBe("[]");
  });
  it("nodo inexistente resuelve a vacío", () => {
    expect(resolveTemplate("[{{ghost.output}}]", R({}), "")).toBe("[]");
  });
  it("tolera espacios dentro de las llaves", () => {
    expect(resolveTemplate("{{  input  }}", R({}), "z")).toBe("z");
  });
  it("múltiples reemplazos en un mismo string", () => {
    const r = R({ a: { output: "1" }, b: { output: "2" } });
    expect(resolveTemplate("{{a.output}}+{{b.output}}={{input}}", r, "3")).toBe("1+2=3");
  });
});

describe("resolveTemplate — rutas JSON (tipos ricos)", () => {
  it("{{input.campo}} navega un objeto JSON en el input", () => {
    expect(resolveTemplate("{{input.email}}", R({}), '{"email":"a@b.com"}')).toBe("a@b.com");
  });
  it("{{id.output.a.0.id}} navega objeto + array", () => {
    const r = R({ http: { output: '{"data":[{"id":7},{"id":9}]}' } });
    expect(resolveTemplate("{{http.output.data.0.id}}", r, "")).toBe("7");
    expect(resolveTemplate("{{http.output.data.1.id}}", r, "")).toBe("9");
  });
  it("ruta inexistente resuelve a vacío", () => {
    expect(resolveTemplate("[{{input.nope.deep}}]", R({}), '{"x":1}')).toBe("[]");
  });
  it("objeto/array intermedio se serializa como JSON", () => {
    const r = R({ n: { output: '{"list":[1,2]}' } });
    expect(resolveTemplate("{{n.output.list}}", r, "")).toBe("[1,2]");
  });
  it("input no-JSON con ruta resuelve a vacío (no rompe)", () => {
    expect(resolveTemplate("[{{input.x}}]", R({}), "texto plano")).toBe("[]");
  });
});

describe("getPath", () => {
  it("navega objetos y arrays", () => {
    expect(getPath({ a: { b: [10, 20] } }, ["a", "b", "1"])).toBe(20);
  });
  it("devuelve undefined en tramos no navegables", () => {
    expect(getPath({ a: 5 }, ["a", "b"])).toBeUndefined();
    expect(getPath(null, ["a"])).toBeUndefined();
  });
});

describe("parseList", () => {
  it("array JSON", () => {
    expect(parseList('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });
  it("valor JSON no-array se envuelve en array", () => {
    expect(parseList('{"x":1}')).toEqual([{ x: 1 }]);
  });
  it("texto por líneas cuando no es JSON", () => {
    expect(parseList("uno\n dos \n\ntres")).toEqual(["uno", "dos", "tres"]);
  });
  it("cadena vacía → lista vacía", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   \n  ")).toEqual([]);
  });
});

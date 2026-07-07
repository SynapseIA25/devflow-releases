// Lógica pura del motor de workflows: templating de variables (con rutas JSON) y parseo de listas.
// Aislada acá, SIN imports con side-effects (nada de stores/tauriApi), para poder testearla en Node
// (vitest) y reusarla desde workflowEngine.ts. No tocar el runtime del navegador desde este módulo.

export type NodeResult = { output: string; exitCode?: number; branch?: "true" | "false" };

// Navega una ruta de campos/índices dentro de un valor (objeto/array). Devuelve undefined si no
// existe o si un tramo intermedio no es navegable.
export function getPath(value: unknown, path: string[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(key);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Convierte un valor resuelto a string para insertarlo en el template (los objetos/arrays van como JSON).
function stringifyValue(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

// Reemplaza {{input}}, {{<id>.output|exitCode|branch}} y sus rutas JSON contra los resultados.
// Rutas JSON: {{input.email}}, {{http.output.data.0.id}} — parsean el valor y navegan (tipos ricos).
export function resolveTemplate(str: string, results: Map<string, NodeResult>, input: string): string {
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    const segs = String(expr).trim().split(".");
    const head = segs[0];
    if (head === "input") {
      if (segs.length === 1) return input;
      try {
        return stringifyValue(getPath(JSON.parse(input), segs.slice(1)));
      } catch {
        return "";
      }
    }
    const r = results.get(head);
    if (!r) return "";
    const field = segs[1];
    if (field === "exitCode") return r.exitCode === undefined ? "" : String(r.exitCode);
    if (field === "branch") return r.branch ?? "";
    if (field === "output") {
      if (segs.length === 2) return r.output;
      try {
        return stringifyValue(getPath(JSON.parse(r.output), segs.slice(2)));
      } catch {
        return "";
      }
    }
    return "";
  });
}

// Parsea la lista del nodo loop: un array JSON, o (si no parsea) líneas separadas por \n.
export function parseList(raw: string): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [v];
  } catch {
    return raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  }
}

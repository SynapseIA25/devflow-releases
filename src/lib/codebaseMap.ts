// Construye un "mapa del codebase": escanea los archivos de código del proyecto y arma un grafo de
// dependencias por imports (quién importa a quién). Todo en el frontend con readDir/readTextFile — no
// necesita backend nuevo. read_dir (Rust) ya omite node_modules/target/.git/dist/build/.next/.turbo,
// así que el recorrido no explota. Es estructural (parseo de imports por regex, sin type-checking).
import { readDir, readTextFile } from "./tauriApi";

export type MapNode = { id: string; path: string; name: string; folder: string };
export type MapEdge = { id: string; source: string; target: string };
export type CodebaseGraph = { nodes: MapNode[]; edges: MapEdge[]; truncated: boolean };

const CODE_EXT = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const MAX_FILES = 250; // techo para que el grafo siga siendo legible/manejable

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
function dirOf(posixPath: string): string {
  const i = posixPath.lastIndexOf("/");
  return i >= 0 ? posixPath.slice(0, i) : "";
}
// Colapsa "." y ".." (para resolver rutas relativas de imports). Trabaja siempre en posix.
function normalize(posixPath: string): string {
  const stack: string[] = [];
  for (const part of posixPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

// Recorrido BFS del árbol de directorios juntando archivos de código, hasta MAX_FILES.
async function collectFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDir) queue.push(e.path);
      else if (CODE_EXT.includes(extOf(e.name))) {
        out.push(e.path);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

// import/export ... from '...'  |  import '...'  |  require('...')
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

// Resuelve un especificador RELATIVO a uno de los archivos conocidos (probando extensiones e index).
// Los imports bare (paquetes de node_modules) se ignoran — el mapa es de código propio.
function resolveImport(fromPosix: string, spec: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(`${dirOf(fromPosix)}/${spec}`);
  const candidates = [
    base,
    ...CODE_EXT.map((e) => `${base}.${e}`),
    ...CODE_EXT.map((e) => `${base}/index.${e}`),
  ];
  return candidates.find((c) => fileSet.has(c)) ?? null;
}

export async function buildCodebaseGraph(projectPath: string): Promise<CodebaseGraph> {
  const files = await collectFiles(projectPath, MAX_FILES + 1);
  const truncated = files.length > MAX_FILES;
  const used = files.slice(0, MAX_FILES);

  const rootPosix = normalize(toPosix(projectPath));
  const norm = (p: string) => normalize(toPosix(p));
  const fileSet = new Set(used.map(norm));
  const idByPath = new Map<string, string>();

  const nodes: MapNode[] = used.map((abs, i) => {
    const n = norm(abs);
    const id = `f${i}`;
    idByPath.set(n, id);
    const rel = n.startsWith(`${rootPosix}/`) ? n.slice(rootPosix.length + 1) : n;
    const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "(raíz)";
    const name = rel.split("/").pop() ?? rel;
    return { id, path: abs, name, folder };
  });

  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  for (const abs of used) {
    let content: string;
    try {
      content = await readTextFile(abs);
    } catch {
      continue;
    }
    const fromId = idByPath.get(norm(abs))!;
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const targetPosix = resolveImport(norm(abs), spec, fileSet);
      if (!targetPosix) continue;
      const toId = idByPath.get(targetPosix);
      if (!toId || toId === fromId) continue;
      const key = `${fromId}->${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: key, source: fromId, target: toId });
    }
  }

  return { nodes, edges, truncated };
}

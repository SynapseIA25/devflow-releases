// Emisor de JSX puro (sin I/O, sin dependencias externas): convierte un CanvasNode en el texto que
// va a un archivo. Usado tanto para generar un componente NUEVO entero (función a) como para el
// texto de un solo nodo nuevo insertado en un archivo existente (función b, ver jsxSplicer.ts).
//
// Sin pretty-printer/Prettier: 2 espacios por nivel de anidamiento, elección deliberada de v1 (ver
// plan). Auto-cierra cuando no hay hijos ni texto.
import type { CanvasNode, PropValue } from "./types";

function serializeProp(name: string, value: PropValue): string {
  if (value.kind === "expression") return `${name}={${value.raw}}`;
  return `${name}="${value.value.replace(/"/g, "&quot;")}"`;
}

function serializeProps(node: CanvasNode): string {
  const entries = Object.entries(node.props);
  if (entries.length === 0) return "";
  return " " + entries.map(([name, value]) => serializeProp(name, value)).join(" ");
}

export function emitJsx(node: CanvasNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const propsStr = serializeProps(node);
  const isLeaf = node.children.length === 0 && node.textContent === undefined;

  if (isLeaf) {
    return `${pad}<${node.tag}${propsStr} />`;
  }

  const openTag = `${pad}<${node.tag}${propsStr}>`;
  const bareCloseTag = `</${node.tag}>`;

  if (node.textContent !== undefined && node.children.length === 0) {
    // Contenido de texto simple en una sola línea si es corto, sin forzar salto de línea extra —
    // el cierre va pegado, sin el padding de una nueva línea (eso es solo para el caso con hijos).
    return `${openTag}${node.textContent}${bareCloseTag}`;
  }

  const childLines = node.children.map((child) => emitJsx(child, indent + 1));
  return [openTag, ...childLines, `${pad}${bareCloseTag}`].join("\n");
}

// Envuelve el árbol en un componente función mínimo (export nombrado) para el flujo de "guardar como
// archivo nuevo". Las entradas de paleta de v1 son tags HTML planos → cero imports extra necesarios;
// si en el futuro una entrada de paleta necesita un import, este es el punto de extensión.
export function emitComponentFile(componentName: string, root: CanvasNode): string {
  const body = emitJsx(root, 2);
  return [
    `export function ${componentName}() {`,
    "  return (",
    body,
    "  );",
    "}",
    "",
  ].join("\n");
}

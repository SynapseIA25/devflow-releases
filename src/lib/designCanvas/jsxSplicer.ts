// La pieza de mayor riesgo del canvas de Design: lee/edita un .tsx EXISTENTE por splices de texto
// puntuales sobre el árbol de Lezer que ya trae @codemirror/lang-javascript (dependencia YA presente
// — tsxLanguage.parser funciona standalone, sin EditorState/DOM). Nunca se regenera el archivo entero
// ni se usa un formateador — cada operación toca solo el rango de texto que le corresponde, preserva
// el resto del archivo tal cual estaba.
//
// Nunca confía en offsets viejos: cada función re-parsea el `source` que recibe y vuelve a ubicar el
// nodo objetivo por su rango exacto + nombre de tag antes de tocar nada. Si el rango ya no existe tal
// cual, o cae dentro de un nodo de error de Lezer (árbol tolerante a errores — puede pasar en código
// con .map()/renderizado condicional/JSX roto), la operación se niega en vez de arriesgar un splice
// incorrecto — ese es el mecanismo real para el fallback "no se puede editar esto estructuralmente".
import { tsxLanguage } from "@codemirror/lang-javascript";
import type { SyntaxNode, Tree } from "@lezer/common";
import type { CanvasNode, PropValue } from "./types";
import { emitJsx, cssTextToObjectLiteral } from "./serializeJsx";
import { TEXT_CONTENT_PROP } from "./operations";

export type SpliceResult = { ok: true; newSource: string } | { ok: false; reason: string };

export function parseSource(source: string): Tree {
  return tsxLanguage.parser.parse(source);
}

function hasErrorInRange(tree: Tree, from: number, to: number): boolean {
  let found = false;
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.type.isError) {
        found = true;
        return false;
      }
    },
  });
  return found;
}

// Tags HTML nativos (div, button, p...) quedan envueltos en JSXBuiltin > JSXIdentifier; componentes
// custom (Custom, MyButton...) tienen JSXIdentifier directo, sin ese wrapper — confirmado inspeccionando
// el árbol real de @lezer/javascript (no asumido de la documentación).
function tagNameOf(openOrSelfClosing: SyntaxNode, source: string): string {
  const builtin = openOrSelfClosing.getChild("JSXBuiltin");
  const idNode =
    (builtin ? builtin.getChild("JSXIdentifier") : null) ??
    openOrSelfClosing.getChild("JSXIdentifier") ??
    openOrSelfClosing.getChild("JSXMemberExpression");
  return idNode ? source.slice(idNode.from, idNode.to) : "";
}

// Re-ubica un JSXElement por rango exacto + nombre de tag después de un re-parse. undefined si ya no
// existe tal cual (el archivo cambió) o si cae dentro de un nodo de error.
function relocate(tree: Tree, source: string, from: number, to: number, expectedTag: string): SyntaxNode | undefined {
  if (hasErrorInRange(tree, from, to)) return undefined;
  let found: SyntaxNode | undefined;
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "JSXElement" && node.from === from && node.to === to) {
        const inner = node.node.firstChild;
        if (inner && (inner.name === "JSXOpenTag" || inner.name === "JSXSelfClosingTag")) {
          if (tagNameOf(inner, source) === expectedTag) found = node.node;
        }
      }
    },
  });
  return found;
}

function tagShape(elNode: SyntaxNode): { isSelfClosing: boolean; openOrSelf: SyntaxNode; closeTag: SyntaxNode | null } {
  const first = elNode.firstChild!;
  if (first.name === "JSXSelfClosingTag") return { isSelfClosing: true, openOrSelf: first, closeTag: null };
  const closeTag = elNode.getChild("JSXCloseTag");
  return { isSelfClosing: false, openOrSelf: first, closeTag };
}

function indentOf(source: string, pos: number): string {
  let lineStart = source.lastIndexOf("\n", pos - 1) + 1;
  let i = lineStart;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(lineStart, i);
}

// Convierte un <Tag ... /> en <Tag ...></Tag> in-place (mismo rango de atributos, solo cambia el
// cierre) — paso previo obligatorio antes de insertar el primer hijo de un elemento auto-cerrado.
function expandSelfClosing(source: string, elNode: SyntaxNode): string {
  const self = elNode.firstChild!; // JSXSelfClosingTag
  const closeEndTag = self.getChild("JSXSelfCloseEndTag")!;
  const tag = tagNameOf(self, source);
  // Todo lo del tag de apertura MENOS el "/>" final, más ">" — conserva atributos y su formato tal cual.
  const attrsPart = source.slice(self.from, closeEndTag.from).replace(/\s*$/, "");
  const openReplacement = `${attrsPart}>`;
  const closeReplacement = `</${tag}>`;
  return source.slice(0, self.from) + openReplacement + closeReplacement + source.slice(self.to);
}

// Inserta el JSX de un CanvasNode nuevo como último hijo del elemento en [from,to] (matcheado por tag
// también, defensivo). Maneja la conversión auto-cerrado→abierto+cerrado como paso previo.
export function spliceInsertChild(
  source: string,
  parentRange: { from: number; to: number },
  parentTag: string,
  newChild: CanvasNode
): SpliceResult {
  let tree = parseSource(source);
  let target = relocate(tree, source, parentRange.from, parentRange.to, parentTag);
  if (!target) return { ok: false, reason: "El elemento ya no está en la posición esperada — el archivo cambió." };

  let working = source;
  const shape = tagShape(target);
  if (shape.isSelfClosing) {
    working = expandSelfClosing(working, target);
    // El archivo cambió de longitud: re-parseamos y re-ubicamos por tag antes de seguir (nunca offsets viejos).
    tree = parseSource(working);
    // Después de expandir, el elemento sigue empezando en el mismo `from` (solo se alargó el `to`).
    let found: SyntaxNode | undefined;
    tree.iterate({
      from: parentRange.from,
      enter: (node) => {
        if (!found && node.name === "JSXElement" && node.from === parentRange.from) found = node.node;
      },
    });
    target = found;
    if (!target) return { ok: false, reason: "No se pudo re-ubicar el elemento después de expandir el auto-cierre." };
  }

  const shape2 = tagShape(target);
  if (!shape2.closeTag) return { ok: false, reason: "El elemento no tiene tag de cierre después de expandir." };
  const insertAt = shape2.closeTag.from;
  const indent = indentOf(working, target.from) + "  ";
  const childText = emitJsx(newChild, 0).split("\n").map((l, i) => (i === 0 ? indent + l : indent + l)).join("\n");
  const before = working.slice(0, insertAt);
  const needsNewlineBefore = !before.endsWith("\n");
  const insertion = `${needsNewlineBefore ? "\n" : ""}${childText}\n${indentOf(working, target.from)}`;
  return { ok: true, newSource: before + insertion + working.slice(insertAt) };
}

// Borra el elemento en [from,to] (matcheado por tag). Se traga UNA línea de whitespace-only JSXText
// vecina (si existe) para no dejar una línea vacía.
export function spliceDelete(source: string, range: { from: number; to: number }, tag: string): SpliceResult {
  const tree = parseSource(source);
  const target = relocate(tree, source, range.from, range.to, tag);
  if (!target) return { ok: false, reason: "El elemento ya no está en la posición esperada — el archivo cambió." };

  let delFrom = target.from;
  let delTo = target.to;
  // Si el nodo previo es puro whitespace (indentación + salto de línea), se lo lleva puesto.
  const prevSibling = target.prevSibling;
  if (prevSibling && prevSibling.name === "JSXText" && /^\s*$/.test(source.slice(prevSibling.from, prevSibling.to))) {
    delFrom = prevSibling.from;
  }
  return { ok: true, newSource: source.slice(0, delFrom) + source.slice(delTo) };
}

// Intercambia el elemento en [from,to] con su sibling inmediato anterior (direction "up") o
// siguiente (direction "down") DENTRO DEL MISMO PADRE — mapea directo a los botones ↑/↓ del árbol.
// Mueve el whitespace líder de cada elemento junto con él (si no, arruina la indentación al reordenar).
export function spliceSwapSibling(
  source: string,
  range: { from: number; to: number },
  tag: string,
  direction: "up" | "down"
): SpliceResult {
  const tree = parseSource(source);
  const target = relocate(tree, source, range.from, range.to, tag);
  if (!target) return { ok: false, reason: "El elemento ya no está en la posición esperada — el archivo cambió." };

  const findNextElementSibling = (node: SyntaxNode, dir: "up" | "down"): SyntaxNode | null => {
    let cur = dir === "up" ? node.prevSibling : node.nextSibling;
    while (cur && cur.name !== "JSXElement") cur = dir === "up" ? cur.prevSibling : cur.nextSibling;
    return cur;
  };
  const neighbor = findNextElementSibling(target, direction);
  if (!neighbor) return { ok: false, reason: "No hay un hermano en esa dirección." };

  // Rango de cada elemento INCLUYENDO su whitespace líder inmediato (mismo criterio que en delete).
  const withLeadingWs = (n: SyntaxNode): { from: number; to: number } => {
    const prev = n.prevSibling;
    const from = prev && prev.name === "JSXText" && /^\s*$/.test(source.slice(prev.from, prev.to)) ? prev.from : n.from;
    return { from, to: n.to };
  };

  const [first, second] = direction === "up" ? [neighbor, target] : [target, neighbor];
  const firstRange = withLeadingWs(first);
  const secondRange = withLeadingWs(second);
  if (firstRange.to > secondRange.from) {
    return { ok: false, reason: "Rangos de hermanos superpuestos — no se puede reordenar con seguridad." };
  }
  const firstText = source.slice(firstRange.from, firstRange.to);
  const secondText = source.slice(secondRange.from, secondRange.to);
  const between = source.slice(firstRange.to, secondRange.from);
  const newSource =
    source.slice(0, firstRange.from) + secondText + between + firstText + source.slice(secondRange.to);
  return { ok: true, newSource };
}

// Reordena TODOS los hijos de un elemento de una sola vez, dado el orden nuevo deseado (arrastrar y
// soltar en cualquier posición, no solo el vecino inmediato — a diferencia de spliceSwapSibling, que
// solo intercambia con un vecino). `oldOrderRanges` son los sourceRange reales de cada hijo EN SU
// ORDEN ACTUAL (los que ya trae el árbol cargado en memoria — válidos porque nada más tocó el archivo
// entre la carga y esta operación, mismo supuesto que ya vale para el resto del splicer); `newOrder`
// es una permutación de esos mismos índices. Reconstituye la región de hijos en un solo shot en vez
// de N swaps adyacentes — evita tener que re-ubicar el nodo movido paso a paso.
export function spliceReorderChildren(
  source: string,
  parentRange: { from: number; to: number },
  parentTag: string,
  oldOrderRanges: { from: number; to: number }[],
  newOrder: number[] // permutación de [0..oldOrderRanges.length)
): SpliceResult {
  const tree = parseSource(source);
  const target = relocate(tree, source, parentRange.from, parentRange.to, parentTag);
  if (!target) return { ok: false, reason: "El elemento ya no está en la posición esperada — el archivo cambió." };
  const shape = tagShape(target);
  if (!shape.closeTag) return { ok: false, reason: "Este elemento no tiene hijos (está auto-cerrado)." };
  if (oldOrderRanges.length !== newOrder.length) return { ok: false, reason: "Orden inconsistente." };
  if (oldOrderRanges.length < 2) return { ok: true, newSource: source }; // nada que reordenar

  // Cada tramo va DESDE el fin del hijo anterior (arrastra su propio whitespace líder) HASTA su fin —
  // mismo criterio "whitespace se mueve con el elemento" que spliceSwapSibling, generalizado a N.
  const openTo = shape.openOrSelf.to;
  const closeFrom = shape.closeTag.from;
  const segments: { from: number; to: number }[] = oldOrderRanges.map((r, i) => ({
    from: i === 0 ? openTo : oldOrderRanges[i - 1].to,
    to: r.to,
  }));
  // Ajuste del último tramo: el whitespace ENTRE el último hijo y el cierre no pertenece a ningún
  // hijo — se preserva tal cual, pegado al final, para no comerse la indentación del tag de cierre.
  const tailWs = source.slice(oldOrderRanges[oldOrderRanges.length - 1].to, closeFrom);

  const reordered = newOrder.map((i) => source.slice(segments[i].from, segments[i].to)).join("");
  const before = source.slice(0, openTo);
  const after = source.slice(closeFrom);
  return { ok: true, newSource: before + reordered + tailWs + after };
}

function findAttribute(tagNode: SyntaxNode, source: string, name: string): SyntaxNode | undefined {
  let found: SyntaxNode | undefined;
  for (let c = tagNode.firstChild; c; c = c.nextSibling) {
    if (c.name === "JSXAttribute") {
      const idNode = c.getChild("JSXIdentifier");
      if (idNode && source.slice(idNode.from, idNode.to) === name) { found = c; break; }
    }
  }
  return found;
}

// Edita (o agrega, o saca) una prop del elemento en [from,to]. Solo props de valor string simple —
// una JSXAttribute con JSXEscape (expresión) se deja de solo lectura, mismo criterio que el inspector.
export function spliceEditProp(
  source: string,
  range: { from: number; to: number },
  tag: string,
  propName: string,
  value: string | null
): SpliceResult {
  const tree = parseSource(source);
  const target = relocate(tree, source, range.from, range.to, tag);
  if (!target) return { ok: false, reason: "El elemento ya no está en la posición esperada — el archivo cambió." };

  const shape = tagShape(target);

  if (propName === TEXT_CONTENT_PROP) {
    if (!shape.closeTag) return { ok: false, reason: "Este elemento no tiene contenido de texto (está auto-cerrado)." };
    // Contenido simple: exactamente un hijo JSXText entre apertura y cierre (o ninguno). Si hay
    // elementos u otras expresiones adentro, no es un caso de "texto simple" — se niega.
    let textNode: SyntaxNode | undefined;
    let hasOtherChildren = false;
    const closeFrom = shape.closeTag.from;
    for (let c = shape.openOrSelf.nextSibling; c && c.from < closeFrom; c = c.nextSibling) {
      if (c.name === "JSXText") textNode = c;
      else hasOtherChildren = true;
    }
    if (hasOtherChildren) return { ok: false, reason: "Este elemento tiene contenido más complejo que texto simple." };
    const newText = value ?? "";
    if (textNode) {
      return { ok: true, newSource: source.slice(0, textNode.from) + newText + source.slice(textNode.to) };
    }
    return { ok: true, newSource: source.slice(0, shape.openOrSelf.to) + newText + source.slice(shape.openOrSelf.to) };
  }

  const tagNode = shape.openOrSelf;
  const existing = findAttribute(tagNode, source, propName);

  if (existing) {
    const valueNode = existing.getChild("JSXAttributeValue");
    if (!valueNode) {
      return { ok: false, reason: `"${propName}" es una expresión — editala en el editor de Código.` };
    }
    if (value === null) {
      // Saca el atributo entero, incluyendo un espacio líder si lo precede uno.
      const before = source.slice(0, existing.from);
      const hasLeadingSpace = before.endsWith(" ");
      const from = hasLeadingSpace ? existing.from - 1 : existing.from;
      return { ok: true, newSource: source.slice(0, from) + source.slice(existing.to) };
    }
    const escaped = value.replace(/"/g, "&quot;");
    return { ok: true, newSource: source.slice(0, valueNode.from) + `"${escaped}"` + source.slice(valueNode.to) };
  }

  if (value === null) return { ok: true, newSource: source }; // nada que sacar, no-op

  // Agregar un atributo nuevo: justo antes del cierre del tag de apertura/auto-cerrado. "style" es
  // especial en JSX — espera un OBJETO (style={{...}}), nunca un string plano como en HTML.
  const insertAt = shape.isSelfClosing ? shape.openOrSelf.getChild("JSXSelfCloseEndTag")!.from : tagNode.getChild("JSXEndTag")!.from;
  const insertion =
    propName === "style"
      ? ` style={${cssTextToObjectLiteral(value)}}`
      : ` ${propName}="${value.replace(/"/g, "&quot;")}"`;
  const before = source.slice(0, insertAt).replace(/\s+$/, "");
  return { ok: true, newSource: source.slice(0, before.length) + insertion + source.slice(insertAt) };
}

// ── Carga inicial: mapea un archivo .tsx existente a un CanvasNode raíz ──
// Camina el JSXElement de más afuera del primer `return (...)` / arrow-JSX que encuentra. `unsupported:
// true` con `reason` si no hay un único JSX raíz claro, o si el subárbol tiene .map()/renderizado
// condicional/nodos de error — el canvas no intenta interpretar eso, ofrece abrir en el editor de Código.
export type LoadResult =
  | { unsupported: false; tree: CanvasNode }
  | { unsupported: true; reason: string };

function findRootJsxElement(tree: Tree): SyntaxNode | undefined {
  let root: SyntaxNode | undefined;
  tree.iterate({
    enter: (node) => {
      if (root) return false;
      if (node.name === "JSXElement") {
        root = node.node;
        return false;
      }
    },
  });
  return root;
}

const UNSUPPORTED_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\.map\s*\(/, reason: "El archivo usa .map() para renderizar una lista." },
  { re: /\{[^}]*\?[^}]*:[^}]*\}/, reason: "El archivo tiene una expresión ternaria dentro de JSX." },
  { re: /&&\s*</, reason: "El archivo tiene renderizado condicional (&&) dentro de JSX." },
];

function propValueFromAttr(attr: SyntaxNode, source: string): [string, PropValue] | null {
  const idNode = attr.getChild("JSXIdentifier");
  if (!idNode) return null;
  const name = source.slice(idNode.from, idNode.to);
  const valueNode = attr.getChild("JSXAttributeValue");
  if (valueNode) {
    const raw = source.slice(valueNode.from, valueNode.to);
    return [name, { kind: "string", value: raw.slice(1, -1) }];
  }
  const escapeNode = attr.getChild("JSXEscape");
  if (escapeNode) return [name, { kind: "expression", raw: source.slice(escapeNode.from, escapeNode.to), editable: false }];
  return [name, { kind: "string", value: "" }];
}

function toCanvasNode(elNode: SyntaxNode, source: string): CanvasNode {
  const shape = tagShape(elNode);
  const tag = tagNameOf(shape.openOrSelf, source);
  const props: Record<string, PropValue> = {};
  for (let c = shape.openOrSelf.firstChild; c; c = c.nextSibling) {
    if (c.name === "JSXAttribute") {
      const entry = propValueFromAttr(c, source);
      if (entry) props[entry[0]] = entry[1];
    }
  }
  const children: CanvasNode[] = [];
  let textContent: string | undefined;
  if (shape.closeTag) {
    const closeFrom = shape.closeTag.from;
    for (let c = shape.openOrSelf.nextSibling; c && c.from < closeFrom; c = c.nextSibling) {
      if (c.name === "JSXElement") children.push(toCanvasNode(c, source));
      else if (c.name === "JSXText") {
        const t = source.slice(c.from, c.to).trim();
        if (t) textContent = textContent ? textContent + t : t;
      }
    }
  }
  return {
    id: `src-${elNode.from}-${elNode.to}`,
    tag,
    props,
    children: textContent !== undefined && children.length === 0 ? [] : children,
    textContent: children.length === 0 ? textContent : undefined,
    sourceRange: {
      from: elNode.from,
      to: elNode.to,
      openTagTo: shape.openOrSelf.to,
      closeTagFrom: shape.closeTag ? shape.closeTag.from : null,
    },
  };
}

export function loadCanvasFromFile(source: string): LoadResult {
  const tree = parseSource(source);
  const root = findRootJsxElement(tree);
  if (!root) return { unsupported: true, reason: "No se encontró JSX en este archivo." };
  if (hasErrorInRange(tree, root.from, root.to)) {
    return { unsupported: true, reason: "El JSX de este archivo no se pudo interpretar sin errores." };
  }
  const snippet = source.slice(root.from, root.to);
  for (const p of UNSUPPORTED_PATTERNS) {
    if (p.re.test(snippet)) return { unsupported: true, reason: p.reason };
  }
  return { unsupported: false, tree: toCanvasNode(root, source) };
}

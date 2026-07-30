// Paleta de componentes v1: tags HTML planos (sin librería de componentes de terceros), suficiente
// para armar layouts básicos con el canvas estructural. Cada entrada es un factory (build) para que
// cada instancia arrastrada tenga su propio id — mismo criterio que NODE_PALETTE en Sidebar.tsx pero
// con datos generados en vez de estáticos.
import type { CanvasNode, PaletteEntry } from "./types";

const newId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const leaf = (tag: string, props: CanvasNode["props"] = {}): CanvasNode => ({
  id: newId(),
  tag,
  props,
  children: [],
});

const withText = (tag: string, text: string, props: CanvasNode["props"] = {}): CanvasNode => ({
  id: newId(),
  tag,
  props,
  children: [],
  textContent: text,
});

const container = (tag: string, props: CanvasNode["props"] = {}, children: CanvasNode[] = []): CanvasNode => ({
  id: newId(),
  tag,
  props,
  children,
});

export const PALETTE_ENTRIES: PaletteEntry[] = [
  {
    id: "container",
    category: "layout",
    label: "Container",
    icon: "Square",
    uiFramework: "react",
    desc: "Empty <div> — drop other components inside.",
    build: () => container("div", { className: { kind: "string", value: "container" } }),
  },
  {
    id: "row",
    category: "layout",
    label: "Row",
    icon: "Columns",
    uiFramework: "react",
    desc: "Horizontal flex container.",
    build: () => container("div", { className: { kind: "string", value: "row" } }),
  },
  {
    id: "column",
    category: "layout",
    label: "Column",
    icon: "Rows",
    uiFramework: "react",
    desc: "Vertical flex container.",
    build: () => container("div", { className: { kind: "string", value: "column" } }),
  },
  {
    id: "section",
    category: "layout",
    label: "Section",
    icon: "PanelTop",
    uiFramework: "react",
    desc: "Semantic <section>.",
    build: () => container("section"),
  },
  {
    id: "heading",
    category: "typography",
    label: "Heading",
    icon: "Heading",
    uiFramework: "react",
    desc: "<h2> title text.",
    build: () => withText("h2", "Heading"),
  },
  {
    id: "paragraph",
    category: "typography",
    label: "Paragraph",
    icon: "Pilcrow",
    uiFramework: "react",
    desc: "<p> body text.",
    build: () => withText("p", "Paragraph text."),
  },
  {
    id: "button",
    category: "form",
    label: "Button",
    icon: "RectangleEllipsis",
    uiFramework: "react",
    desc: "<button> element.",
    build: () => withText("button", "Button"),
  },
  {
    id: "input",
    category: "form",
    label: "Input",
    icon: "TextCursorInput",
    uiFramework: "react",
    desc: "Text <input>.",
    build: () => leaf("input", { placeholder: { kind: "string", value: "Placeholder" } }),
  },
  {
    id: "link",
    category: "content",
    label: "Link",
    icon: "Link",
    uiFramework: "react",
    desc: "<a> anchor.",
    build: () => withText("a", "Link", { href: { kind: "string", value: "#" } }),
  },
  {
    id: "image",
    category: "media",
    label: "Image",
    icon: "Image",
    uiFramework: "react",
    desc: "<img> element.",
    build: () => leaf("img", { src: { kind: "string", value: "" }, alt: { kind: "string", value: "" } }),
  },
  {
    id: "card",
    category: "layout",
    label: "Card",
    icon: "CreditCard",
    uiFramework: "react",
    desc: "Container with a heading + paragraph inside.",
    build: () =>
      container("div", { className: { kind: "string", value: "card" } }, [
        withText("h3", "Card title"),
        withText("p", "Card body."),
      ]),
  },
];

// Modelo de datos del canvas de Design (paleta de componentes + árbol estructural). Ver plan en
// memoria del proyecto (devflow-design-canvas) para el contexto completo.
//
// Un CanvasNode es un nodo de árbol tipado, no un elemento del DOM real: DevFlow nunca re-renderiza
// la UI del proyecto del usuario dentro de su propia ventana (no puede ser fiel a CSS/framework
// arbitrarios) — el canvas edita este modelo, y el preview visual real corre en la ventana de Design
// Mode apuntando al dev server del propio proyecto (ver designCanvas más abajo en el módulo).

export type CanvasNodeId = string;

// Solo props de texto simple (className, href, src, placeholder, alt...) son editables desde el
// inspector del canvas. Cualquier otra cosa (expresiones, handlers, spreads) se preserva tal cual al
// leer un archivo existente pero queda de solo-lectura — el editor de Código sigue siendo el lugar
// para eso, misma filosofía que ya usa Specs ("el código es la fuente de verdad").
export type PropValue =
  | { kind: "string"; value: string }
  | { kind: "expression"; raw: string; editable: false };

export type CanvasNode = {
  id: CanvasNodeId;
  tag: string; // "div", "button", "img", "Fragment", ...
  props: Record<string, PropValue>;
  children: CanvasNode[];
  // Nodo de texto simple (ej. contenido de un <p> o <button>). Un CanvasNode con textContent no
  // debería tener children a la vez en v1 — mantiene el modelo simple.
  textContent?: string;
  // Presente SOLO si este nodo se cargó desde un archivo .tsx existente (modo "editar página") — le
  // dice al splicer dónde está en el archivo sin tener que re-caminar todo el árbol en cada operación.
  // closeTagFrom es null para un tag auto-cerrado (<Tag ... />); el splicer lo convierte a
  // apertura+cierre antes de insertarle el primer hijo.
  sourceRange?: {
    from: number;
    to: number;
    openTagTo: number;
    closeTagFrom: number | null;
  };
};

export type PaletteCategory = "layout" | "content" | "form" | "media" | "typography";

export type PaletteEntry = {
  id: string;
  category: PaletteCategory;
  label: string;
  icon: string; // nombre de ícono lucide-react, mismo criterio que NavBar/Sidebar
  // v1 es React/TSX únicamente (gateado por stackDetect.uiFramework) — el campo queda explícito acá
  // para cuando se agreguen otros frameworks, en vez de asumirlo implícito en todos lados.
  uiFramework: "react";
  desc: string;
  // Factory, no datos estáticos: cada instancia arrastrada al canvas necesita su propio id.
  build: () => CanvasNode;
};

import { create } from "zustand";
import type { CanvasNode, CanvasNodeId, PaletteEntry } from "../lib/designCanvas/types";
import { applyOpToTree, type CanvasOp } from "../lib/designCanvas/operations";
import {
  loadCanvasFromFile,
  spliceInsertChild,
  spliceDelete,
  spliceSwapSibling,
  spliceEditProp,
} from "../lib/designCanvas/jsxSplicer";
import { readTextFile, writeTextFile } from "../lib/tauriApi";

// Estado de trabajo del canvas de Design — deliberadamente NO persistido (es un borrador de trabajo,
// como el árbol de un workflow a medio armar; se persiste recién al guardar, ver serializeJsx.ts +
// jsxSplicer.ts). Mismo criterio de "borrador en memoria, guardado explícito" que ya usa editorStore.
//
// Modo "new" (función a): las operaciones son puro reducer en memoria (applyOpToTree), sin tocar
// disco hasta "Save as new component". Modo "edit" (función b): cada operación estructural se aplica
// DIRECTO contra el archivo real vía un splice de jsxSplicer.ts (read-modify-write-reload) — nunca se
// acumulan varias operaciones en memoria antes de escribir, así el árbol en memoria nunca se desincroniza
// de lo que hay en disco (más simple y más seguro que trackear offsets a través de un lote de cambios).
export type DesignMode = "new" | "edit";

const emptyRoot: CanvasNode = { id: "root", tag: "div", props: {}, children: [] };

type DesignCanvasState = {
  mode: DesignMode;
  tree: CanvasNode;
  selectedId: CanvasNodeId | null;
  // Ruta del archivo en edición (modo "edit"); null en modo "new" hasta guardar.
  filePath: string | null;
  unsupportedReason: string | null;
  loadError: string | null;
  setMode: (m: DesignMode) => void;
  resetToEmpty: () => void;
  selectNode: (id: CanvasNodeId | null) => void;
  applyOp: (op: CanvasOp) => void;
  loadFromExistingFile: (path: string) => Promise<void>;
  // Aplica una operación estructural en modo "edit": splice al archivo real + recarga desde disco.
  // Devuelve el motivo de error si el splice se negó (nunca lanza — el caller decide cómo mostrarlo).
  applyStructuralEdit: (op: CanvasOp, entry?: PaletteEntry) => Promise<string | null>;
};

function findById(node: CanvasNode, id: CanvasNodeId): CanvasNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

export const useDesignCanvasStore = create<DesignCanvasState>()((set, get) => ({
  mode: "new",
  tree: emptyRoot,
  selectedId: null,
  filePath: null,
  unsupportedReason: null,
  loadError: null,

  setMode: (m) => set({ mode: m, tree: emptyRoot, selectedId: null, filePath: null, unsupportedReason: null, loadError: null }),

  resetToEmpty: () => set({ tree: emptyRoot, selectedId: null, filePath: null, unsupportedReason: null, loadError: null }),

  selectNode: (id) => set({ selectedId: id }),

  applyOp: (op) => set((s) => ({ tree: applyOpToTree(s.tree, op) })),

  loadFromExistingFile: async (path) => {
    set({ loadError: null, unsupportedReason: null });
    try {
      const source = await readTextFile(path);
      const result = loadCanvasFromFile(source);
      if (result.unsupported) {
        set({ unsupportedReason: result.reason, tree: emptyRoot, filePath: path, selectedId: null });
        return;
      }
      set({ tree: result.tree, filePath: path, selectedId: null, unsupportedReason: null });
    } catch (e: any) {
      set({ loadError: String(e?.message ?? e) });
    }
  },

  applyStructuralEdit: async (op, entry) => {
    const { tree, filePath } = get();
    if (!filePath) return "No hay un archivo cargado.";
    let source: string;
    try {
      source = await readTextFile(filePath);
    } catch (e: any) {
      return String(e?.message ?? e);
    }

    let result: { ok: true; newSource: string } | { ok: false; reason: string };
    if (op.kind === "insert") {
      const parent = findById(tree, op.parentId);
      if (!parent || !parent.sourceRange || !entry) return "No se pudo ubicar el elemento padre.";
      result = spliceInsertChild(source, parent.sourceRange, parent.tag, entry.build());
    } else if (op.kind === "delete") {
      const node = findById(tree, op.nodeId);
      if (!node || !node.sourceRange) return "No se pudo ubicar el elemento a borrar.";
      result = spliceDelete(source, node.sourceRange, node.tag);
    } else if (op.kind === "reorder") {
      const node = findById(tree, op.nodeId);
      const parent = findById(tree, op.parentId);
      if (!node || !node.sourceRange || !parent) return "No se pudo ubicar el elemento a reordenar.";
      const siblingIds = parent.children.map((c) => c.id);
      const fromIndex = siblingIds.indexOf(op.nodeId);
      const direction = op.toIndex < fromIndex ? "up" : "down";
      result = spliceSwapSibling(source, node.sourceRange, node.tag, direction);
    } else {
      const node = findById(tree, op.nodeId);
      if (!node || !node.sourceRange) return "No se pudo ubicar el elemento a editar.";
      result = spliceEditProp(source, node.sourceRange, node.tag, op.propName, op.value);
    }

    if (!result.ok) return result.reason;
    try {
      await writeTextFile(filePath, result.newSource);
    } catch (e: any) {
      return String(e?.message ?? e);
    }
    // Recarga desde el archivo recién escrito: el árbol en memoria nunca queda desincronizado de disco.
    await get().loadFromExistingFile(filePath);
    return null;
  },
}));

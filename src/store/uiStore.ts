import { create } from "zustand";
import { useEditorStore } from "./editorStore";
import type { ViewId } from "../components/NavBar";

// Estado de UI compartido: la vista activa. Antes vivía en useState local de App; moverlo a un store
// permite que cualquier parte (mapa, output de workflows, chat) navegue entre vistas y abra archivos
// en el editor — la integración "IDE" de la Fase E.
type UiStore = {
  view: ViewId;
  setView: (v: ViewId) => void;
  // Abre un archivo como pestaña del editor Y navega a la vista Código.
  openInEditor: (path: string) => void;
  // Texto a precargar en el input del chat (ej. la tarea al "abrir en chat" desde Equipo). ChatView lo
  // consume una vez y lo limpia.
  pendingPrompt?: string;
  setPendingPrompt: (t?: string) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),
  openInEditor: (path) => {
    void useEditorStore.getState().openFile(path);
    set({ view: "editor" });
  },
  setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),
}));

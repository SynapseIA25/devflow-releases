import { create } from "zustand";
import { persist } from "zustand/middleware";
import { readTextFile, writeTextFile } from "../lib/tauriApi";

// Una pestaña del editor de código. `content` es el buffer editable en vivo; `savedContent` es
// lo último que hay en disco — la pestaña está "sucia" (cambios sin guardar) cuando difieren.
export type EditorTab = {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  loading: boolean;
  error: string | null;
  // El archivo cambió en disco (ej. lo escribió el agente) mientras la pestaña tenía cambios sin
  // guardar → no se auto-recarga (no pisar tus ediciones); se muestra un aviso para recargar a mano.
  externalChanged?: boolean;
};

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

type EditorStore = {
  tabs: EditorTab[];
  activePath: string | null;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  setContent: (path: string, content: string) => void;
  save: (path: string) => Promise<void>;
  reload: (path: string) => Promise<void>;
  load: (path: string) => Promise<void>;
  markExternalChanged: (path: string) => void;
};

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activePath: null,

      // Lee el contenido real (completo, sin cap de líneas) del archivo hacia su pestaña.
      // Usado tanto al abrir como al recargar desde disco.
      load: async (path) => {
        try {
          const content = await readTextFile(path);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.path === path ? { ...t, content, savedContent: content, loading: false, error: null, externalChanged: false } : t
            ),
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set((s) => ({
            tabs: s.tabs.map((t) => (t.path === path ? { ...t, loading: false, error: msg } : t)),
          }));
        }
      },

      openFile: async (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set({ activePath: path });
          return;
        }
        set((s) => ({
          tabs: [...s.tabs, { path, name: nameOf(path), content: "", savedContent: "", loading: true, error: null }],
          activePath: path,
        }));
        await get().load(path);
      },

      closeTab: (path) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.path === path);
          const tabs = s.tabs.filter((t) => t.path !== path);
          let activePath = s.activePath;
          if (s.activePath === path) {
            activePath = tabs.length ? tabs[Math.min(idx, tabs.length - 1)].path : null;
          }
          return { tabs, activePath };
        }),

      setActive: (path) => set({ activePath: path }),

      setContent: (path, content) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)),
        })),

      save: async (path) => {
        const tab = get().tabs.find((t) => t.path === path);
        if (!tab) return;
        try {
          await writeTextFile(path, tab.content);
          set((s) => ({
            tabs: s.tabs.map((t) => (t.path === path ? { ...t, savedContent: t.content, error: null } : t)),
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, error: msg } : t)) }));
        }
      },

      reload: async (path) => {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, loading: true, error: null } : t)),
        }));
        await get().load(path);
      },

      markExternalChanged: (path) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, externalChanged: true } : t)),
        })),
    }),
    {
      name: "devflow-editor",
      // Solo persistimos qué archivos estaban abiertos (path/name) y cuál era el activo — NO el
      // contenido ni el estado sucio: al reabrir la app cada pestaña recarga su contenido real de
      // disco (mismo criterio que VS Code para archivos guardados). Las ediciones sin guardar se
      // pierden al cerrar la app — limitación conocida del v1.
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({
          path: t.path,
          name: t.name,
          content: "",
          savedContent: "",
          loading: false,
          error: null,
        })),
        activePath: s.activePath,
      }),
      // Tras rehidratar, traer de disco el contenido real de cada pestaña persistida.
      onRehydrateStorage: () => (state) => {
        state?.tabs.forEach((t) => {
          void useEditorStore.getState().reload(t.path);
        });
      },
    }
  )
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { readTextFile, writeTextFile } from "../lib/tauriApi";
import { useProjectStore } from "./projectStore";

// Una pestaña del editor de código. `content` es el buffer editable en vivo; `savedContent` es
// lo último que hay en disco — la pestaña está "sucia" (cambios sin guardar) cuando difieren.
export type EditorTab = {
  path: string;
  name: string;
  // Proyecto al que pertenece la pestaña (scope por proyecto): el editor solo muestra las del
  // proyecto activo. Se infiere del path (qué raíz de proyecto lo contiene) al abrir.
  projectId: string;
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

const normPath = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

// Proyecto (id) al que pertenece un archivo: el que tiene la raíz más larga que lo contiene. "" si
// ninguno lo contiene (archivo fuera de todos los proyectos registrados).
function projectIdForPath(path: string): string {
  const projects = useProjectStore.getState().projects;
  const c = normPath(path);
  let best = "";
  let bestLen = -1;
  for (const [id, p] of Object.entries(projects)) {
    const r = normPath(p.path);
    if ((c === r || c.startsWith(r + "\\") || c.startsWith(r + "/")) && r.length > bestLen) {
      best = id;
      bestLen = r.length;
    }
  }
  return best;
}

type EditorStore = {
  tabs: EditorTab[];
  // Pestaña activa POR proyecto (el editor muestra la del proyecto activo).
  activePathByProject: Record<string, string | null>;
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
      activePathByProject: {},

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
          set((s) => ({ activePathByProject: { ...s.activePathByProject, [existing.projectId]: path } }));
          return;
        }
        const projectId = projectIdForPath(path) || useProjectStore.getState().activeId;
        set((s) => ({
          tabs: [...s.tabs, { path, name: nameOf(path), projectId, content: "", savedContent: "", loading: true, error: null }],
          activePathByProject: { ...s.activePathByProject, [projectId]: path },
        }));
        await get().load(path);
      },

      closeTab: (path) =>
        set((s) => {
          const closing = s.tabs.find((t) => t.path === path);
          const idx = s.tabs.findIndex((t) => t.path === path);
          const tabs = s.tabs.filter((t) => t.path !== path);
          const activePathByProject = { ...s.activePathByProject };
          if (closing && s.activePathByProject[closing.projectId] === path) {
            // Caemos a un hermano DEL MISMO proyecto (no a cualquiera), o null si no queda ninguno.
            const siblings = tabs.filter((t) => t.projectId === closing.projectId);
            const fallback = siblings[Math.min(idx, siblings.length - 1)] ?? siblings[siblings.length - 1] ?? null;
            activePathByProject[closing.projectId] = fallback ? fallback.path : null;
          }
          return { tabs, activePathByProject };
        }),

      setActive: (path) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.path === path);
          if (!tab) return {};
          return { activePathByProject: { ...s.activePathByProject, [tab.projectId]: path } };
        }),

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
      version: 1,
      // v0 tenía tabs sin projectId y un solo activePath global. Migramos infiriendo el proyecto de
      // cada pestaña por su path, y colgando el activePath viejo del proyecto que le corresponde.
      migrate: (persisted: any, version) => {
        if (version < 1 && persisted && Array.isArray(persisted.tabs)) {
          const tabs = persisted.tabs.map((t: any) => ({ ...t, projectId: projectIdForPath(t.path) }));
          const activePathByProject: Record<string, string | null> = {};
          if (persisted.activePath) {
            const owner = projectIdForPath(persisted.activePath);
            activePathByProject[owner] = persisted.activePath;
          }
          return { tabs, activePathByProject };
        }
        return persisted;
      },
      // Solo persistimos qué archivos estaban abiertos (path/name/projectId) y cuál era el activo por
      // proyecto — NO el contenido ni el estado sucio: al reabrir la app cada pestaña recarga su
      // contenido real de disco (mismo criterio que VS Code para archivos guardados). Las ediciones
      // sin guardar se pierden al cerrar la app — limitación conocida del v1.
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({
          path: t.path,
          name: t.name,
          projectId: t.projectId,
          content: "",
          savedContent: "",
          loading: false,
          error: null,
        })),
        activePathByProject: s.activePathByProject,
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

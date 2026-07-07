import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PROJECT_CWD } from "../lib/constants";

// ── Servicios (Frente 3, ahora scopeados por proyecto — Frente 4) ──
// Un servicio es un proceso de larga duración (dev server, API, worker) que corre en una terminal
// AISLADA gestionada, no dentro de un turno del agente (que es lo que hoy lo cuelga). El proceso vive
// en un PTY propio (pty_spawn con command) keyed por el id del servicio, separado de los ids de
// workspace del chat → un server colgado nunca afecta el ciclo de turno del agente. Cada servicio
// vive DENTRO de su proyecto (scope duro): al cambiar de proyecto activo, la vista de Servicios solo
// muestra los del proyecto actual, y borrar un proyecto se lleva sus servicios.
export type ServiceStatus = "stopped" | "running" | "exited";

export type Service = {
  id: string;
  name: string;
  command: string; // ej. "npm run dev"
  cwd?: string; // vacío = usar la carpeta (path) del proyecto
  // Transitorios (no se persisten): al reiniciar la app nada está corriendo.
  status: ServiceStatus;
  exitCode?: number;
};

// ── Proyecto ──
// El contenedor natural de todo lo que es "por proyecto": su carpeta raíz, ambiente (env vars que se
// inyectan a servicios y terminales), integración git, tracking de issues, y las asociaciones a
// agentes/workflows/servicios (scope duro). Reemplaza el viejo projectStore de una-sola-ruta.
export type Project = {
  id: string;
  name: string;
  path: string; // carpeta raíz (reemplaza el viejo projectPath único)
  env: Record<string, string>; // ambiente → se inyecta a service_spawn y a las terminales del proyecto
  git?: { enabled: boolean }; // integración git (branch/status read-only; acciones en fase posterior)
  tracking?: { type: "github" | "url" | "none"; url?: string }; // issues (v1 liviano: link/estado)
  workflowIds: string[]; // workflows scopeados al proyecto (vacío = ninguno asociado explícito)
  agentIds: string[]; // agentes expertos scopeados al proyecto (los globales mimo/hermes se ven siempre)
  services: Service[]; // servicios del proyecto (scope duro, Frente 3)
};

// Forma persistida (solo datos; projectPath es derivado, no se persiste — se recalcula del activo).
type PersistedState = {
  projects: Record<string, Project>;
  order: string[];
  activeId: string;
};

const makeProjectId = () => `proj_${Math.random().toString(36).slice(2, 9)}`;
const makeServiceId = () => `svc_${Math.random().toString(36).slice(2, 9)}`;

// basename de una ruta Windows o POSIX (para nombrar un proyecto nuevo por su carpeta).
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed || "Proyecto";
}

function makeProject(path: string, name?: string): Project {
  return {
    id: makeProjectId(),
    name: name?.trim() || baseName(path),
    path,
    env: {},
    git: { enabled: false },
    tracking: { type: "none" },
    workflowIds: [],
    agentIds: [],
    services: [],
  };
}

type ProjectStore = {
  projects: Record<string, Project>;
  order: string[]; // orden de visualización de los proyectos
  activeId: string; // proyecto activo (raíz del chat/terminal/explorer/etc.)

  // ── Compat: campo derivado = projects[activeId].path ──
  // Los 7 consumidores existentes (ChatView, workflowEngine, FileExplorer, McpView, ContextPanel,
  // ServicesView, CodebaseMapView) leen `projectPath` sin cambios. Se mantiene sincronizado en cada
  // acción que cambia el proyecto activo o su ruta, y se recalcula al hidratar (ver merge).
  projectPath: string;
  setProjectPath: (path: string) => void; // compat: cambia la ruta del proyecto activo

  // ── Gestión de proyectos ──
  createProject: (path: string, name?: string) => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  setActiveProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Omit<Project, "id" | "services">>) => void;

  // ── Ambiente (env vars del proyecto activo) ──
  setEnvVar: (key: string, value: string) => void;
  removeEnvVar: (key: string) => void;

  // ── Servicios del proyecto activo (scope duro) ──
  addService: (name: string, command: string, cwd?: string) => string;
  updateService: (id: string, patch: Partial<Pick<Service, "name" | "command" | "cwd">>) => void;
  removeService: (id: string) => void;
  setServiceStatus: (id: string, status: ServiceStatus, exitCode?: number) => void;
};

// Aplica un cambio inmutable al proyecto activo.
function patchActive(s: ProjectStore, fn: (p: Project) => Partial<Project>): Partial<ProjectStore> {
  const p = s.projects[s.activeId];
  if (!p) return {};
  const next = { ...p, ...fn(p) };
  return {
    projects: { ...s.projects, [s.activeId]: next },
    projectPath: next.path, // mantener el compat sincronizado si cambió la ruta
  };
}

// Proyecto default de arranque (fresh install, sin nada persistido).
const FIRST_PROJECT = makeProject(PROJECT_CWD);

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: { [FIRST_PROJECT.id]: FIRST_PROJECT },
      order: [FIRST_PROJECT.id],
      activeId: FIRST_PROJECT.id,
      projectPath: FIRST_PROJECT.path,

      setProjectPath: (path) => set((s) => patchActive(s, () => ({ path }))),

      createProject: (path, name) => {
        const p = makeProject(path, name);
        set((s) => ({
          projects: { ...s.projects, [p.id]: p },
          order: [...s.order, p.id],
          activeId: p.id,
          projectPath: p.path,
        }));
        return p.id;
      },

      deleteProject: (id) =>
        set((s) => {
          if (s.order.length <= 1) return {}; // siempre queda al menos un proyecto
          const { [id]: _removed, ...rest } = s.projects;
          const order = s.order.filter((x) => x !== id);
          const activeId = s.activeId === id ? order[0] : s.activeId;
          return { projects: rest, order, activeId, projectPath: rest[activeId].path };
        }),

      renameProject: (id, name) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return { projects: { ...s.projects, [id]: { ...p, name: name.trim() || p.name } } };
        }),

      setActiveProject: (id) =>
        set((s) => (s.projects[id] ? { activeId: id, projectPath: s.projects[id].path } : {})),

      updateProject: (id, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          const next = { ...p, ...patch };
          return {
            projects: { ...s.projects, [id]: next },
            ...(id === s.activeId ? { projectPath: next.path } : {}),
          };
        }),

      setEnvVar: (key, value) =>
        set((s) => patchActive(s, (p) => ({ env: { ...p.env, [key]: value } }))),

      removeEnvVar: (key) =>
        set((s) =>
          patchActive(s, (p) => {
            const { [key]: _drop, ...env } = p.env;
            return { env };
          })
        ),

      addService: (name, command, cwd) => {
        const id = makeServiceId();
        set((s) => patchActive(s, (p) => ({ services: [...p.services, { id, name, command, cwd, status: "stopped" }] })));
        return id;
      },

      updateService: (id, patch) =>
        set((s) => patchActive(s, (p) => ({ services: p.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))),

      removeService: (id) =>
        set((s) => patchActive(s, (p) => ({ services: p.services.filter((x) => x.id !== id) }))),

      setServiceStatus: (id, status, exitCode) =>
        set((s) => patchActive(s, (p) => ({ services: p.services.map((x) => (x.id === id ? { ...x, status, exitCode } : x)) }))),
    }),
    {
      name: "devflow-project",
      version: 1,
      // Persistimos solo la definición. status/exitCode de cada servicio se resetean a "stopped":
      // tras un restart de la app ningún PTY sigue vivo. projectPath no se persiste (es derivado).
      partialize: (s): PersistedState => ({
        activeId: s.activeId,
        order: s.order,
        projects: Object.fromEntries(
          Object.entries(s.projects).map(([id, p]) => [
            id,
            { ...p, services: p.services.map((svc) => ({ ...svc, status: "stopped" as ServiceStatus, exitCode: undefined })) },
          ])
        ),
      }),
      // v0 era { projectPath: string } (una sola ruta). Lo envolvemos en un proyecto default.
      migrate: (persisted, version): PersistedState => {
        const p = persisted as Record<string, unknown> | undefined;
        if (version < 1 && p && typeof p.projectPath === "string") {
          const proj = makeProject(p.projectPath);
          return { projects: { [proj.id]: proj }, order: [proj.id], activeId: proj.id };
        }
        return persisted as PersistedState;
      },
      // Recalcula el campo derivado projectPath a partir del proyecto activo al hidratar.
      merge: (persisted, current) => {
        const p = persisted as PersistedState | undefined;
        if (!p || !p.projects || !p.projects[p.activeId]) return current;
        return { ...current, ...p, projectPath: p.projects[p.activeId].path };
      },
    }
  )
);

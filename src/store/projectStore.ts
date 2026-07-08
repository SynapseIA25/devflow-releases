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

// ── Items de contexto (Tanda C: scopeados por proyecto) ──
// Antes vivían en un contextStore GLOBAL (no persistido). Ahora cada proyecto tiene sus propios
// archivos/carpetas de contexto: se agregan desde el File Explorer (botón bookmark) o la tab Contexto
// del hub, y ChatView los antepone al prompt del agente (buildPromptWithContext). Al cambiar de
// proyecto activo, el chat ve solo los del proyecto actual.
export type ContextItem = { path: string; isDir: boolean };

// ── Deuda técnica (Tanda D: tablero por proyecto) ──
// Registro de deuda técnica del proyecto: se puede cargar a mano o pegando los hallazgos de un
// /code-review (uno por línea). Cada item tiene severidad y estado, y opcionalmente se asigna a un
// agente experto para resolverlo. Scope duro por proyecto (igual que servicios/contexto).
export type DebtSeverity = "low" | "medium" | "high";
export type DebtStatus = "open" | "resolved";
export type DebtItem = {
  id: string;
  title: string;
  note?: string;
  severity: DebtSeverity;
  status: DebtStatus;
  agentId?: string; // experto asignado para resolverlo (opcional)
  createdAt: number;
};

// ── Ambientes de prueba (worktree efímero) ──
// Cada ambiente es un git worktree con su propia rama (env/<name>), creado desde la rama base del
// proyecto. El agente/terminal trabajan AISLADOS ahí sin tocar el árbol real; al terminar se revisa
// el diff y se promueve (merge a la base) o se descarta (worktree remove + branch -D). El worktree
// vive en un sibling `.devflow-envs/` fuera del árbol del proyecto (no lo scanea el file explorer).
// Scope duro por proyecto (igual que servicios/contexto/deuda).
export type TestEnv = {
  id: string;
  name: string;
  branch: string; // rama del worktree, ej. "env/exp1"
  path: string; // carpeta del worktree (posix)
  baseBranch: string; // rama base desde la que se creó
  agentId?: string; // agente experto asignado (opcional)
  createdAt: number;
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
  contextItems: ContextItem[]; // archivos/carpetas de contexto del proyecto (Tanda C)
  debt: DebtItem[]; // tablero de deuda técnica del proyecto (Tanda D)
  environments: TestEnv[]; // ambientes de prueba (worktrees efímeros)
};

// Forma persistida (solo datos; projectPath es derivado, no se persiste — se recalcula del activo).
type PersistedState = {
  projects: Record<string, Project>;
  order: string[];
  activeId: string;
};

const makeProjectId = () => `proj_${Math.random().toString(36).slice(2, 9)}`;
const makeServiceId = () => `svc_${Math.random().toString(36).slice(2, 9)}`;
const makeDebtId = () => `debt_${Math.random().toString(36).slice(2, 9)}`;
const makeEnvId = () => `env_${Math.random().toString(36).slice(2, 9)}`;

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
    contextItems: [],
    debt: [],
    environments: [],
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

  // ── Items de contexto del proyecto activo (scope duro, Tanda C) ──
  addContextItem: (item: ContextItem) => void;
  removeContextItem: (path: string) => void;
  clearContext: () => void;

  // ── Deuda técnica del proyecto activo (scope duro, Tanda D) ──
  addDebt: (title: string, severity: DebtSeverity, note?: string) => void;
  addDebtBulk: (titles: string[], severity: DebtSeverity) => void; // ej. hallazgos de /code-review, uno por línea
  updateDebt: (id: string, patch: Partial<Pick<DebtItem, "title" | "note" | "severity" | "status" | "agentId">>) => void;
  removeDebt: (id: string) => void;

  // ── Ambientes de prueba del proyecto activo (scope duro) ──
  addEnvironment: (env: Omit<TestEnv, "id" | "createdAt">) => string;
  updateEnvironment: (id: string, patch: Partial<Pick<TestEnv, "agentId">>) => void;
  removeEnvironment: (id: string) => void;
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

      addContextItem: (item) =>
        set((s) =>
          patchActive(s, (p) =>
            p.contextItems.some((i) => i.path === item.path) ? {} : { contextItems: [...p.contextItems, item] }
          )
        ),

      removeContextItem: (path) =>
        set((s) => patchActive(s, (p) => ({ contextItems: p.contextItems.filter((i) => i.path !== path) }))),

      clearContext: () => set((s) => patchActive(s, () => ({ contextItems: [] }))),

      addDebt: (title, severity, note) =>
        set((s) =>
          patchActive(s, (p) => ({
            debt: [{ id: makeDebtId(), title: title.trim(), note, severity, status: "open", createdAt: Date.now() }, ...p.debt],
          }))
        ),

      addDebtBulk: (titles, severity) =>
        set((s) =>
          patchActive(s, (p) => {
            const now = Date.now();
            const items: DebtItem[] = titles
              .map((t) => t.trim())
              .filter(Boolean)
              .map((title, i) => ({ id: makeDebtId(), title, severity, status: "open" as DebtStatus, createdAt: now - i }));
            return { debt: [...items, ...p.debt] };
          })
        ),

      updateDebt: (id, patch) =>
        set((s) => patchActive(s, (p) => ({ debt: p.debt.map((d) => (d.id === id ? { ...d, ...patch } : d)) }))),

      removeDebt: (id) =>
        set((s) => patchActive(s, (p) => ({ debt: p.debt.filter((d) => d.id !== id) }))),

      addEnvironment: (env) => {
        const id = makeEnvId();
        set((s) => patchActive(s, (p) => ({ environments: [{ ...env, id, createdAt: Date.now() }, ...p.environments] })));
        return id;
      },

      updateEnvironment: (id, patch) =>
        set((s) => patchActive(s, (p) => ({ environments: p.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))),

      removeEnvironment: (id) =>
        set((s) => patchActive(s, (p) => ({ environments: p.environments.filter((e) => e.id !== id) }))),
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
      // Recalcula el campo derivado projectPath a partir del proyecto activo al hidratar, y normaliza
      // los proyectos persistidos con versiones viejas del tipo (contextItems se agregó en la Tanda C:
      // los proyectos guardados antes no lo tienen → default []).
      merge: (persisted, current) => {
        const p = persisted as PersistedState | undefined;
        if (!p || !p.projects || !p.projects[p.activeId]) return current;
        const projects = Object.fromEntries(
          Object.entries(p.projects).map(([id, proj]) => [
            id,
            { ...proj, services: proj.services ?? [], contextItems: proj.contextItems ?? [], debt: proj.debt ?? [], environments: proj.environments ?? [] },
          ])
        );
        return { ...current, ...p, projects, projectPath: p.projects[p.activeId].path };
      },
    }
  )
);

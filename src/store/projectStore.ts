import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PROJECT_CWD } from "../lib/constants";
import type { StackFingerprint } from "../lib/stackDetect";
import type { TestStrategy } from "../lib/testStrategyCatalog";
import { slugify, type SpecArtifactKind, type SpecTaskState } from "../lib/specFiles";
import type { TaskProfile } from "../lib/modelRouter";

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

// ── Tests (herramienta nativa de testing, Fase 1: runner tradicional) ──
// Un proyecto puede tener un comando de test configurado (a mano o auto-detectado por testRunner.ts
// mirando package.json/Cargo.toml/go.mod/pytest.ini de su raíz) y un historial acotado de corridas.
// Igual que Servicios/Deuda/Ambientes: scope duro por proyecto. A diferencia de esos, las acciones que
// lo mutan reciben un `projectId` explícito (no "el activo"): el MCP bridge corre tests de un proyecto
// que puede no ser el que el usuario tiene abierto en la UI en ese momento (ver mcpBridgeHandlers.ts).
export type TestFramework = "npm" | "pytest" | "cargo" | "go" | "custom";
export type TestConfig = { command: string; cwd?: string; framework: TestFramework };
export type TestRunStatus = "running" | "passed" | "failed";
export type TestRun = {
  id: string;
  status: TestRunStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  output: string;
};

// ── Terminales independientes (antes global, ahora scopeadas por proyecto) ──
// Un shell interactivo con su propio cwd, desacoplado del chat y de los servicios. Antes vivían en un
// terminalsStore GLOBAL; ahora cada proyecto tiene sus propias terminales (scope duro): al cambiar de
// proyecto activo, la vista Terminales solo muestra las suyas. La definición (name/cwd) se persiste; el
// proceso PTY es transitorio (se respawnea al reabrir). Reusa la PTY real vía TerminalPane.
export type AppTerminal = { id: string; name: string; cwd: string; createdAt: number };

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
  terminals: AppTerminal[]; // terminales independientes del proyecto (scope duro)
  testConfig?: TestConfig; // comando de test (a mano o auto-detectado) — ver testRunner.ts
  testRuns: TestRun[]; // historial de corridas (más reciente primero, acotado — ver MAX_TEST_RUNS)
  testStrategy?: TestStrategyState; // última sugerencia de estrategia de testing — ver testStrategy.ts
  specs: Spec[]; // Spec-Driven Development: specs del proyecto — ver specOrchestrator.ts
};

// ── Spec-Driven Development ──
// Los artefactos (requirements.md/design.md/tasks.md) son la fuente de verdad en disco, bajo
// .devflow/specs/<slug>/ (ver specFiles.ts) — mismo criterio que MEMORY.md: editable/versionable
// fuera de DevFlow. Acá solo se guarda metadata liviana: fase actual, estado de cada artefacto, el
// checklist de tareas ya parseado (para no releer el archivo en cada render), y qué agente+perfil
// de modelo corre cada fase.
export type SpecPhase = "specify" | "plan" | "tasks" | "implement" | "done";
export type SpecArtifactStatus = "missing" | "draft" | "ready";
// Override de agente+modelo por fase — esto reemplaza a "una regla global de qué modelo usa cada
// agente": la regla vive por spec/fase, resuelta en runtime por specOrchestrator (ver PHASE_PROFILE).
export type SpecPhaseAgent = { agentId: string; profile?: TaskProfile };
export type Spec = {
  id: string;
  slug: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  phase: SpecPhase;
  artifacts: Record<SpecArtifactKind, { status: SpecArtifactStatus; updatedAt?: number }>;
  tasks: SpecTaskState[];
  phaseAgents: Partial<Record<Exclude<SpecPhase, "done">, SpecPhaseAgent>>;
  defaultAgentId?: string; // agente por defecto si una fase no tiene override propio (cae al lead si tampoco hay esto)
  lastActivity?: string; // etiqueta corta para la barra de estado, ej. "Tasks: 3/10"
};

// Fase 5 de la herramienta de testing nativa: sugerencia cacheada de estrategia (backend de
// automatización + patrones de caso) para el stack detectado del proyecto. Es un único objeto (no una
// lista acotada como testRuns) — una sugerencia vieja sobreviviendo un restart no es un problema, el
// usuario la refresca con "Re-detectar".
export type TestStrategyState = {
  fingerprint: StackFingerprint;
  strategy: TestStrategy;
  detectedAt: number;
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
const makeTerminalId = () => `term_${Math.random().toString(36).slice(2, 9)}`;
const makeTestRunId = () => `trun_${Math.random().toString(36).slice(2, 9)}`;
const makeSpecId = () => `spec_${Math.random().toString(36).slice(2, 9)}`;
const MAX_TEST_RUNS = 15; // los outputs pueden ser grandes — acotar el historial persistido

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
    terminals: [],
    testRuns: [],
    specs: [],
  };
}

function emptySpecArtifacts(): Spec["artifacts"] {
  return {
    requirements: { status: "missing" },
    design: { status: "missing" },
    tasks: { status: "missing" },
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

  // ── Terminales del proyecto activo (scope duro) ──
  addTerminal: (cwd: string, name?: string) => string;
  removeTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;

  // ── Tests: a diferencia de lo anterior, reciben projectId explícito (ver comentario del tipo Project) ──
  setTestConfig: (projectId: string, config: TestConfig | undefined) => void;
  addTestRun: (projectId: string, run: Omit<TestRun, "id">) => string;
  updateTestRun: (projectId: string, runId: string, patch: Partial<Omit<TestRun, "id">>) => void;
  clearTestRuns: (projectId: string) => void;
  setTestStrategy: (projectId: string, state: TestStrategyState | undefined) => void;

  // ── Specs (Spec-Driven Development) — projectId explícito, mismo criterio que Tests: un futuro
  // tool del MCP bridge podría correr una fase para un proyecto que no es el visible en la UI. ──
  createSpec: (projectId: string, name: string) => string;
  updateSpec: (projectId: string, specId: string, patch: Partial<Omit<Spec, "id" | "slug">>) => void;
  deleteSpec: (projectId: string, specId: string) => void;
};

// Aplica un cambio inmutable al proyecto activo.
function patchActive(s: ProjectStore, fn: (p: Project) => Partial<Project>): Partial<ProjectStore> {
  return patchProject(s, s.activeId, fn);
}

// Igual que patchActive pero por id explícito — lo necesitan las acciones de Tests, que el MCP bridge
// puede invocar para un proyecto distinto del que el usuario tiene abierto en la UI en ese momento.
function patchProject(s: ProjectStore, id: string, fn: (p: Project) => Partial<Project>): Partial<ProjectStore> {
  const p = s.projects[id];
  if (!p) return {};
  const next = { ...p, ...fn(p) };
  return {
    projects: { ...s.projects, [id]: next },
    ...(id === s.activeId ? { projectPath: next.path } : {}), // compat solo si es el activo
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

      addTerminal: (cwd, name) => {
        const id = makeTerminalId();
        set((s) =>
          patchActive(s, (p) => ({
            terminals: [...p.terminals, { id, name: name?.trim() || `Terminal ${p.terminals.length + 1}`, cwd, createdAt: Date.now() }],
          }))
        );
        return id;
      },

      removeTerminal: (id) =>
        set((s) => patchActive(s, (p) => ({ terminals: p.terminals.filter((t) => t.id !== id) }))),

      renameTerminal: (id, name) =>
        set((s) => patchActive(s, (p) => ({ terminals: p.terminals.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t)) }))),

      setTestConfig: (projectId, config) =>
        set((s) => patchProject(s, projectId, () => ({ testConfig: config }))),

      addTestRun: (projectId, run) => {
        const id = makeTestRunId();
        set((s) =>
          patchProject(s, projectId, (p) => ({
            testRuns: [{ ...run, id }, ...p.testRuns].slice(0, MAX_TEST_RUNS),
          }))
        );
        return id;
      },

      updateTestRun: (projectId, runId, patch) =>
        set((s) =>
          patchProject(s, projectId, (p) => ({
            testRuns: p.testRuns.map((r) => (r.id === runId ? { ...r, ...patch } : r)),
          }))
        ),

      clearTestRuns: (projectId) => set((s) => patchProject(s, projectId, () => ({ testRuns: [] }))),

      setTestStrategy: (projectId, state) =>
        set((s) => patchProject(s, projectId, () => ({ testStrategy: state }))),

      createSpec: (projectId, name) => {
        const id = makeSpecId();
        const now = Date.now();
        set((s) => {
          const proj = s.projects[projectId];
          const base = slugify(name);
          const existing = new Set((proj?.specs ?? []).map((sp) => sp.slug));
          let slug = base;
          let n = 2;
          while (existing.has(slug)) slug = `${base}-${n++}`;
          const spec: Spec = {
            id,
            slug,
            name: name.trim() || "Untitled spec",
            createdAt: now,
            updatedAt: now,
            phase: "specify",
            artifacts: emptySpecArtifacts(),
            tasks: [],
            phaseAgents: {},
          };
          return patchProject(s, projectId, (p) => ({ specs: [spec, ...p.specs] }));
        });
        return id;
      },

      updateSpec: (projectId, specId, patch) =>
        set((s) =>
          patchProject(s, projectId, (p) => ({
            specs: p.specs.map((sp) => (sp.id === specId ? { ...sp, ...patch, updatedAt: Date.now() } : sp)),
          }))
        ),

      deleteSpec: (projectId, specId) =>
        set((s) => patchProject(s, projectId, (p) => ({ specs: p.specs.filter((sp) => sp.id !== specId) }))),
    }),
    {
      name: "devflow-project",
      version: 1,
      // Persistimos solo la definición. status/exitCode de cada servicio se resetean a "stopped":
      // tras un restart de la app ningún PTY sigue vivo. Un test run que quedó "running" tampoco puede
      // seguir corriendo tras un restart — se marca "failed" (interrumpido) en vez de quedar colgado
      // para siempre en la UI. projectPath no se persiste (es derivado).
      partialize: (s): PersistedState => ({
        activeId: s.activeId,
        order: s.order,
        projects: Object.fromEntries(
          Object.entries(s.projects).map(([id, p]) => [
            id,
            {
              ...p,
              services: p.services.map((svc) => ({ ...svc, status: "stopped" as ServiceStatus, exitCode: undefined })),
              testRuns: p.testRuns.map((r) =>
                r.status === "running" ? { ...r, status: "failed" as TestRunStatus, output: r.output + "\n[interrupted: app closed]" } : r
              ),
            },
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
            { ...proj, services: proj.services ?? [], contextItems: proj.contextItems ?? [], debt: proj.debt ?? [], environments: proj.environments ?? [], terminals: proj.terminals ?? [], testRuns: proj.testRuns ?? [], specs: proj.specs ?? [] },
          ])
        );
        return { ...current, ...p, projects, projectPath: p.projects[p.activeId].path };
      },
    }
  )
);

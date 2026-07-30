import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StepStatus = "done" | "running" | "pending" | "failed";
export type Step = { id: string; label: string; status: StepStatus };

export type ToolContentItem =
  | { type: "diff"; path?: string; oldText?: string; newText?: string }
  | { type: "text"; text: string }
  | { type: "raw"; data: unknown };

export type ToolBlockData = {
  toolCallId: string;
  title: string;
  kind?: string;
  command?: string;
  exitCode?: number;
  status: StepStatus;
  items: ToolContentItem[];
};

export type DocBlockData = {
  id: string;
  type: "ai" | "user" | "tool" | "thought";
  content: string;
  agentId?: string;
  ts: number;
  tool?: ToolBlockData;
  // Thumbnail de una imagen adjunta (paste/drag en el chat, ver ChatView) — solo en bloques "user".
  imageDataUrl?: string;
};

export type Workspace = {
  id: string;
  projectId: string; // proyecto al que pertenece (scope por proyecto): el chat filtra por el activo
  title: string;
  agentId: string; // agente de ESTE workspace (fuente de verdad del turno; puede diferir entre pestañas)
  blocks: DocBlockData[];
  sessionId?: string;
  sessionProvider?: string;
  // Binding opcional a un ambiente de prueba (worktree). Si cwd está seteado, la sesión ACP y la
  // terminal de este workspace se rootean ahí (no en projectPath) → el agente trabaja AISLADO en el
  // worktree del ambiente. envId/envName son informativos (badge de la pestaña).
  cwd?: string;
  envId?: string;
  envName?: string;
  steps: Step[];
  // Transitorios (no se persisten): estado de ejecución por-workspace. Reemplazan a los singletons
  // globales que antes vivían en ChatView (loading/turnCancelledRef) y que rompían el multi-workspace.
  running?: boolean;   // hay un turno en curso en este workspace
  queue?: string[];    // mensajes del usuario encolados mientras el turno corre (cola transitoria)
  // Prompt a auto-enviar apenas se monta ChatView (ver el useEffect ahí) — usado por el fan-out de
  // Ambientes para arrancar N workspaces con el mismo prompt sin que el usuario tenga que tipearlo
  // en cada pestaña. Se limpia solo una vez enviado.
  pendingInitialPrompt?: string;
};

const makeId = () => Math.random().toString(36).slice(2);

const INITIAL_WORKSPACE: Workspace = {
  id: "ws1",
  projectId: "", // sentinela: se adopta al proyecto activo en el primer activateProject (ver merge)
  title: "DevFlow-app",
  agentId: "opencode-agent",
  steps: [],
  blocks: [
    {
      id: "b1",
      type: "ai",
      agentId: "opencode-agent",
      ts: Date.now(),
      content: `## Bienvenido a DevFlow

Soy tu agente de desarrollo. Puedo ayudarte con:

- **Análisis de código** — Revisión de arquitectura, patrones y mejoras
- **Edición de archivos** — Refactorización, nuevas features, bug fixes
- **Ejecución de comandos** — Build, tests, git, deploy
- **Diseño de flujos** — Workflows visuales y automatización

Escribí tu solicitud abajo, o usá la terminal real del panel inferior para ejecutar comandos directamente.`,
    },
  ],
};

type ToolBlockPatch = {
  title: string;
  kind?: string;
  command?: string;
  exitCode?: number;
  status: StepStatus;
  items?: ToolContentItem[];
};

type WorkspaceStore = {
  workspaces: Workspace[];
  activeWs: string;
  // Recuerda la pestaña activa por proyecto → al volver a un proyecto se restaura su última pestaña.
  activeWsByProject: Record<string, string>;
  setActiveWs: (id: string) => void;
  newWorkspace: (agentId: string, projectId: string, opts?: { title?: string; cwd?: string; envId?: string; envName?: string; pendingInitialPrompt?: string }) => string;
  clearPendingInitialPrompt: (wsId: string) => void;
  // Manda un follow-up a un workspace YA EXISTENTE (a diferencia de newWorkspace's opt, que solo
  // aplica al crear uno) — usado por Annotate Diffs para responder al agente de un Ambiente sin
  // abrir una pestaña nueva. El mismo efecto de ChatView que auto-envía pendingInitialPrompt lo
  // recoge sin cambios.
  setPendingInitialPrompt: (wsId: string, text: string) => void;
  closeWorkspace: (id: string) => void;
  // Cambia el agente de UN workspace (el turno usa ws.agentId, no un global). Habilita tener MiMo en
  // una pestaña y un experto en otra a la vez.
  setWorkspaceAgent: (wsId: string, agentId: string) => void;
  // Se llama al cambiar de proyecto activo: adopta workspaces huérfanos (sin projectId, de versiones
  // viejas) al proyecto dado, garantiza que el proyecto tenga ≥1 workspace (crea uno si no), y setea
  // activeWs a la pestaña recordada del proyecto (o la primera).
  activateProject: (projectId: string, seedAgentId: string) => void;
  // Desata los workspaces de un ambiente que se promovió/descartó: su worktree ya no existe, así que
  // vuelven a rootear en projectPath y se descarta su sesión ACP (el próximo prompt abre una nueva).
  unbindEnv: (envId: string) => void;
  // Descarta el sessionId de los workspaces de un provider cuyo proceso ACP se reinició (sus sesiones
  // ya no existen en el proceso nuevo). El próximo prompt en cada uno abre una sesión fresca.
  resetSessions: (provider: string) => void;
  addBlock: (wsId: string, block: Omit<DocBlockData, "id" | "ts">) => string;
  appendTextChunk: (wsId: string, blockId: string, delta: string, type: "ai" | "thought", agentId?: string) => void;
  updateSteps: (wsId: string, updater: (prev: Step[]) => Step[]) => void;
  upsertToolBlock: (wsId: string, toolCallId: string, patch: ToolBlockPatch) => void;
  setSession: (wsId: string, sessionId: string, sessionProvider: string) => void;
  setRunning: (wsId: string, running: boolean) => void;
  enqueue: (wsId: string, text: string) => void;
  shiftQueue: (wsId: string) => void;
  removeFromQueue: (wsId: string, index: number) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      workspaces: [INITIAL_WORKSPACE],
      activeWs: "ws1",
      activeWsByProject: {},

      setActiveWs: (id) =>
        set((s) => {
          const w = s.workspaces.find((x) => x.id === id);
          if (!w) return { activeWs: id };
          return { activeWs: id, activeWsByProject: { ...s.activeWsByProject, [w.projectId]: id } };
        }),

      newWorkspace: (agentId, projectId, opts) => {
        const id = makeId();
        set((s) => ({
          workspaces: [...s.workspaces, {
            id,
            projectId,
            title: opts?.title ?? `Sesión ${s.workspaces.filter((w) => w.projectId === projectId).length + 1}`,
            agentId,
            blocks: [],
            steps: [],
            cwd: opts?.cwd,
            envId: opts?.envId,
            envName: opts?.envName,
            pendingInitialPrompt: opts?.pendingInitialPrompt,
          }],
          activeWs: id,
          activeWsByProject: { ...s.activeWsByProject, [projectId]: id },
        }));
        return id;
      },

      clearPendingInitialPrompt: (wsId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, pendingInitialPrompt: undefined } : w)),
        })),

      setPendingInitialPrompt: (wsId, text) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, pendingInitialPrompt: text } : w)),
        })),

      closeWorkspace: (id) =>
        set((s) => {
          const closing = s.workspaces.find((w) => w.id === id);
          const workspaces = s.workspaces.filter((w) => w.id !== id);
          if (s.activeWs !== id || !closing) return { workspaces };
          // Al cerrar la pestaña activa, caemos a un hermano DEL MISMO proyecto (no a cualquiera).
          const sibling = workspaces.find((w) => w.projectId === closing.projectId);
          const activeWs = sibling?.id ?? workspaces[0]?.id ?? "";
          return { workspaces, activeWs, activeWsByProject: { ...s.activeWsByProject, [closing.projectId]: sibling?.id ?? "" } };
        }),

      setWorkspaceAgent: (wsId, agentId) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, agentId } : w)) })),

      activateProject: (projectId, seedAgentId) =>
        set((s) => {
          // 1. Adoptar huérfanos (workspaces sin projectId, persistidos antes del scope por proyecto).
          let workspaces = s.workspaces.some((w) => !w.projectId)
            ? s.workspaces.map((w) => (w.projectId ? w : { ...w, projectId }))
            : s.workspaces;
          // 2. Garantizar ≥1 workspace para el proyecto.
          let projWs = workspaces.filter((w) => w.projectId === projectId);
          if (projWs.length === 0) {
            const nw: Workspace = { id: makeId(), projectId, title: "Sesión 1", agentId: seedAgentId, blocks: [], steps: [] };
            workspaces = [...workspaces, nw];
            projWs = [nw];
          }
          // 3. activeWs → la recordada del proyecto (si sigue perteneciéndole) o la primera.
          const remembered = s.activeWsByProject[projectId];
          const pick = projWs.find((w) => w.id === remembered)?.id ?? projWs[0].id;
          return { workspaces, activeWs: pick, activeWsByProject: { ...s.activeWsByProject, [projectId]: pick } };
        }),

      unbindEnv: (envId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.envId === envId
              ? { ...w, cwd: undefined, envId: undefined, envName: undefined, sessionId: undefined, sessionProvider: undefined }
              : w
          ),
        })),

      resetSessions: (provider) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.sessionProvider === provider ? { ...w, sessionId: undefined, sessionProvider: undefined } : w
          ),
        })),

      addBlock: (wsId, block) => {
        const id = makeId();
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === wsId ? { ...w, blocks: [...w.blocks, { ...block, id, ts: Date.now() }] } : w
          ),
        }));
        return id;
      },

      appendTextChunk: (wsId, blockId, delta, type, agentId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== wsId) return w;
            const exists = w.blocks.some((b) => b.id === blockId);
            if (exists) {
              return { ...w, blocks: w.blocks.map((b) => (b.id === blockId ? { ...b, content: b.content + delta } : b)) };
            }
            return { ...w, blocks: [...w.blocks, { id: blockId, type, agentId, content: delta, ts: Date.now() }] };
          }),
        })),

      updateSteps: (wsId, updater) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, steps: updater(w.steps) } : w)),
        })),

      upsertToolBlock: (wsId, toolCallId, patch) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== wsId) return w;
            const idx = w.blocks.findIndex((b) => b.type === "tool" && b.tool?.toolCallId === toolCallId);
            if (idx === -1) {
              const block: DocBlockData = {
                id: makeId(),
                type: "tool",
                content: "",
                ts: Date.now(),
                tool: { toolCallId, title: patch.title, kind: patch.kind, command: patch.command, exitCode: patch.exitCode, status: patch.status, items: patch.items ?? [] },
              };
              return { ...w, blocks: [...w.blocks, block] };
            }
            const blocks = [...w.blocks];
            const existing = blocks[idx].tool!;
            blocks[idx] = {
              ...blocks[idx],
              tool: {
                toolCallId,
                title: patch.title,
                kind: patch.kind ?? existing.kind,
                command: patch.command ?? existing.command,
                exitCode: patch.exitCode ?? existing.exitCode,
                status: patch.status,
                items: patch.items ?? existing.items,
              },
            };
            return { ...w, blocks };
          }),
        })),

      setSession: (wsId, sessionId, sessionProvider) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, sessionId, sessionProvider } : w)),
        })),

      setRunning: (wsId, running) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, running } : w)),
        })),

      enqueue: (wsId, text) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, queue: [...(w.queue ?? []), text] } : w)),
        })),

      shiftQueue: (wsId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, queue: (w.queue ?? []).slice(1) } : w)),
        })),

      removeFromQueue: (wsId, index) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, queue: (w.queue ?? []).filter((_, i) => i !== index) } : w)),
        })),
    }),
    {
      name: "devflow-chat-history",
      // No persistimos sessionId/sessionProvider: tras un restart de la app el proceso hijo
      // del agente (mimo/hermes) ya no existe, así que ese session id quedaría inválido. Sin
      // persistirlo, el próximo prompt en cada workspace simplemente abre una sesión nueva
      // (mismo camino que ya existe para "cambiaste de agente a mitad de conversación").
      partialize: (state) => ({
        activeWs: state.activeWs,
        activeWsByProject: state.activeWsByProject,
        // running/queue son transitorios: al reiniciar la app no hay ningún turno en curso ni
        // sesión ACP viva, así que se resetean (no se persisten) igual que sessionId/sessionProvider.
        // pendingInitialPrompt tampoco: si se cerró la app antes de mandarlo, no queremos que se
        // auto-envíe solo al reabrir sin que el usuario lo vea venir.
        workspaces: state.workspaces.map((w) => ({ ...w, sessionId: undefined, sessionProvider: undefined, running: false, queue: [], pendingInitialPrompt: undefined })),
      }),
    }
  )
);

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
};

export type Workspace = {
  id: string;
  title: string;
  agentId: string;
  blocks: DocBlockData[];
  sessionId?: string;
  sessionProvider?: string;
  steps: Step[];
  // Transitorios (no se persisten): estado de ejecución por-workspace. Reemplazan a los singletons
  // globales que antes vivían en ChatView (loading/turnCancelledRef) y que rompían el multi-workspace.
  running?: boolean;   // hay un turno en curso en este workspace
  queue?: string[];    // mensajes del usuario encolados mientras el turno corre (cola transitoria)
};

const makeId = () => Math.random().toString(36).slice(2);

const INITIAL_WORKSPACE: Workspace = {
  id: "ws1",
  title: "MiMo-app",
  agentId: "mimo-coder",
  steps: [],
  blocks: [
    {
      id: "b1",
      type: "ai",
      agentId: "mimo-coder",
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
  setActiveWs: (id: string) => void;
  newWorkspace: (agentId: string) => string;
  closeWorkspace: (id: string) => void;
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

      setActiveWs: (id) => set({ activeWs: id }),

      newWorkspace: (agentId) => {
        const id = makeId();
        set((s) => ({
          workspaces: [...s.workspaces, { id, title: `Sesión ${s.workspaces.length + 1}`, agentId, blocks: [], steps: [] }],
          activeWs: id,
        }));
        return id;
      },

      closeWorkspace: (id) =>
        set((s) => {
          const workspaces = s.workspaces.filter((w) => w.id !== id);
          const activeWs = s.activeWs === id ? (workspaces[0]?.id ?? "") : s.activeWs;
          return { workspaces, activeWs };
        }),

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
        // running/queue son transitorios: al reiniciar la app no hay ningún turno en curso ni
        // sesión ACP viva, así que se resetean (no se persisten) igual que sessionId/sessionProvider.
        workspaces: state.workspaces.map((w) => ({ ...w, sessionId: undefined, sessionProvider: undefined, running: false, queue: [] })),
      }),
    }
  )
);

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Terminales independientes a nivel App (pilar 4 del roadmap): un panel propio de terminales
// interactivas, DESACOPLADAS del chat (no atadas a un workspace) y de los servicios (no corren un
// comando, son shells interactivos). Cada una tiene su nombre y su cwd propio. Reusa la PTY real
// (pty_spawn/write/resize/kill) vía TerminalPane. La definición (name/cwd) se persiste; el proceso
// PTY es transitorio (se respawnea al reabrir la app).
export type AppTerminal = { id: string; name: string; cwd: string; createdAt: number };

type TerminalsStore = {
  terminals: AppTerminal[];
  activeId: string | null;
  addTerminal: (cwd: string, name?: string) => string;
  removeTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;
  setActive: (id: string) => void;
};

const makeId = () => `term_${Math.random().toString(36).slice(2, 9)}`;

export const useTerminalsStore = create<TerminalsStore>()(
  persist(
    (set, get) => ({
      terminals: [],
      activeId: null,

      addTerminal: (cwd, name) => {
        const id = makeId();
        const n = get().terminals.length + 1;
        set((s) => ({
          terminals: [...s.terminals, { id, name: name?.trim() || `Terminal ${n}`, cwd, createdAt: Date.now() }],
          activeId: id,
        }));
        return id;
      },

      removeTerminal: (id) =>
        set((s) => {
          const terminals = s.terminals.filter((t) => t.id !== id);
          const activeId = s.activeId === id ? (terminals[terminals.length - 1]?.id ?? null) : s.activeId;
          return { terminals, activeId };
        }),

      renameTerminal: (id, name) =>
        set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t)) })),

      setActive: (id) => set({ activeId: id }),
    }),
    { name: "devflow-terminals" }
  )
);

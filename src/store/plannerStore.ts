import { create } from "zustand";
import { persist } from "zustand/middleware";

// Tarea del planner: por proyecto, con fecha de vencimiento. Si tiene workflowId, PlannerRunner
// dispara ese flujo una vez al llegar dueDate (incluida la detección de catch-up si la app estaba
// cerrada) — mismo motor de ejecución que los triggers (ver TriggerRunner.tsx), pero de una sola vez
// en vez de recurrente.
export type PlannerTask = {
  id: string;
  projectId: string;
  title: string;
  dueDate: number; // timestamp (ms)
  done: boolean;
  workflowId?: string;
  firedAt?: number; // cuándo se disparó el workflow vinculado (evita re-disparar)
  firedReason?: "schedule" | "catchup";
  lastStatus?: "success" | "error";
  lastMessage?: string;
};

function makeTaskId(): string {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `task_${uuid}`;
}

type PlannerStore = {
  tasks: PlannerTask[];
  addTask: (projectId: string, title: string, dueDate: number, workflowId?: string) => string;
  updateTask: (id: string, patch: Partial<PlannerTask>) => void;
  removeTask: (id: string) => void;
  toggleDone: (id: string) => void;
  recordFire: (id: string, status: "success" | "error", message: string, reason: "schedule" | "catchup") => void;
};

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (projectId, title, dueDate, workflowId) => {
        const id = makeTaskId();
        set((s) => ({
          tasks: [...s.tasks, { id, projectId, title, dueDate, done: false, workflowId: workflowId || undefined }],
        }));
        return id;
      },

      updateTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      toggleDone: (id) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),

      recordFire: (id, status, message, reason) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, firedAt: Date.now(), firedReason: reason, lastStatus: status, lastMessage: message } : t
          ),
        })),
    }),
    { name: "devflow-planner" }
  )
);

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Un trigger dispara un workflow automáticamente. interval/cron = scheduler frontend (solo con la app
// abierta). webhook = servidor HTTP en Rust (POST a /hook/<id>). file = watcher de archivos en Rust.
export type TriggerType = "interval" | "cron" | "webhook" | "file";

export type Trigger = {
  id: string;
  workflowId: string;
  type: TriggerType;
  enabled: boolean;
  intervalMinutes: number; // si type === "interval"
  cron: string; // si type === "cron" (5 campos)
  path: string; // si type === "file" (archivo o carpeta a vigilar)
  lastRun?: number; // timestamp del último disparo (para no re-disparar y para mostrar estado)
  lastStatus?: "success" | "error";
  lastMessage?: string;
};

type TriggersStore = {
  triggers: Trigger[];
  addTrigger: (workflowId: string) => string;
  updateTrigger: (id: string, patch: Partial<Trigger>) => void;
  removeTrigger: (id: string) => void;
  recordRun: (id: string, status: "success" | "error", message: string) => void;
};

export const useTriggersStore = create<TriggersStore>()(
  persist(
    (set) => ({
      triggers: [],

      addTrigger: (workflowId) => {
        const id = `trg_${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({
          triggers: [
            ...s.triggers,
            {
              id,
              workflowId,
              type: "interval",
              enabled: false,
              intervalMinutes: 60,
              cron: "0 9 * * 1", // lunes 9:00 por defecto
              path: "",
              lastRun: Date.now(),
            },
          ],
        }));
        return id;
      },

      updateTrigger: (id, patch) =>
        set((s) => ({ triggers: s.triggers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      removeTrigger: (id) => set((s) => ({ triggers: s.triggers.filter((t) => t.id !== id) })),

      recordRun: (id, status, message) =>
        set((s) => ({
          triggers: s.triggers.map((t) =>
            t.id === id ? { ...t, lastRun: Date.now(), lastStatus: status, lastMessage: message } : t
          ),
        })),
    }),
    { name: "devflow-triggers" }
  )
);

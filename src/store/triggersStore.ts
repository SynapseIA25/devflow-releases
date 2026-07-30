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
  // Solo webhook: si false (default), el body de la request NO entra como {{input}} al flujo. El body
  // es entrada externa no confiable y el flujo puede pasarlo a `new Function` (condition) o a shell —
  // habilitarlo es opt-in explícito. La URL del webhook ya usa un token no adivinable (el id, un uuid).
  allowExternalInput?: boolean;
  lastRun?: number; // timestamp del último disparo (para no re-disparar y para mostrar estado)
  lastStatus?: "success" | "error";
  lastMessage?: string;
  lastRunReason?: "schedule" | "catchup"; // "catchup" = se disparó al abrir la app porque se perdió mientras estaba cerrada
};

// Token/id no adivinable para el trigger. Como el id del webhook ES el token de la URL pública
// (/hook/<id>), tiene que ser criptográficamente aleatorio, no un Math.random() corto y brute-forceable.
function makeTriggerId(): string {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `trg_${uuid}`;
}

type TriggersStore = {
  triggers: Trigger[];
  addTrigger: (workflowId: string) => string;
  updateTrigger: (id: string, patch: Partial<Trigger>) => void;
  removeTrigger: (id: string) => void;
  recordRun: (id: string, status: "success" | "error", message: string, reason?: "schedule" | "catchup") => void;
};

export const useTriggersStore = create<TriggersStore>()(
  persist(
    (set) => ({
      triggers: [],

      addTrigger: (workflowId) => {
        const id = makeTriggerId();
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
              allowExternalInput: false,
              lastRun: Date.now(),
            },
          ],
        }));
        return id;
      },

      updateTrigger: (id, patch) =>
        set((s) => ({ triggers: s.triggers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      removeTrigger: (id) => set((s) => ({ triggers: s.triggers.filter((t) => t.id !== id) })),

      recordRun: (id, status, message, reason) =>
        set((s) => ({
          triggers: s.triggers.map((t) =>
            t.id === id
              ? { ...t, lastRun: Date.now(), lastStatus: status, lastMessage: message, lastRunReason: reason ?? "schedule" }
              : t
          ),
        })),
    }),
    { name: "devflow-triggers" }
  )
);

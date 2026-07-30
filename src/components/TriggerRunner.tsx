import { useEffect, useRef } from "react";
import { useTriggersStore, type Trigger } from "../store/triggersStore";
import { useWorkflowStore } from "../store/workflowStore";
import { runWorkflow } from "../lib/workflowEngine";
import { cronMatches, hasMissedCronRun } from "../lib/cron";
import { isTauri, webhookStart, watchStart, watchStop } from "../lib/tauriApi";

// Scheduler + puente de triggers, montado UNA vez a nivel App (no renderiza nada).
// - interval/cron: tick local cada 20s (solo corre con la app abierta).
// - webhook/file: los dispara Rust (servidor HTTP / watcher notify) vía eventos Tauri; acá se
//   registran/desregistran los watchers y el servidor según los triggers habilitados, y se escuchan
//   los eventos para correr el workflow.
const TICK_MS = 20000;
export const WEBHOOK_PORT = 8787;
const minuteKey = (ts: number) => Math.floor(ts / 60000);

async function fire(t: Trigger, running: Set<string>, input = "", reason: "schedule" | "catchup" = "schedule") {
  running.add(t.id);
  useTriggersStore.getState().updateTrigger(t.id, { lastRun: Date.now() });
  const st = useWorkflowStore.getState();
  const w = st.workflows[t.workflowId];
  if (!w) {
    useTriggersStore.getState().recordRun(t.id, "error", "El flujo ya no existe", reason);
    running.delete(t.id);
    return;
  }
  if (st.activeId === t.workflowId) st.resetStatuses();
  const logs: string[] = [];
  try {
    const { errored } = await runWorkflow(
      w.nodes,
      w.edges,
      {
        onLog: (_lvl, msg) => logs.push(msg),
        setNodeStatus: (id, status) => {
          if (useWorkflowStore.getState().activeId === t.workflowId) {
            useWorkflowStore.getState().setNodeStatus(id, status);
          }
        },
        isCancelled: () => false,
        resolveFlow: (flowId) => {
          const f = useWorkflowStore.getState().workflows[flowId];
          return f ? { name: f.name, nodes: f.nodes, edges: f.edges } : undefined;
        },
      },
      input
    );
    useTriggersStore.getState().recordRun(t.id, errored ? "error" : "success", logs.slice(-3).join(" · ") || "OK", reason);
  } catch (e) {
    useTriggersStore.getState().recordRun(t.id, "error", e instanceof Error ? e.message : String(e), reason);
  } finally {
    running.delete(t.id);
  }
}

export function TriggerRunner() {
  const runningRef = useRef<Set<string>>(new Set());
  const triggers = useTriggersStore((s) => s.triggers);
  const webhookStartedRef = useRef(false);
  const watchedRef = useRef<Map<string, string>>(new Map()); // id → path que se está vigilando

  // Catch-up al montar: si la app estuvo cerrada y un trigger interval/cron debería haber disparado
  // mientras tanto, lo corremos una vez ahora (no hay confirmación — es la conducta elegida: más
  // práctico que dejarlo perdido, a costa de que un workflow con efectos secundarios corra "tarde").
  // webhook/file no aplican: son event-driven, no tienen "horario perdido" que evaluar.
  useEffect(() => {
    const now = Date.now();
    for (const t of useTriggersStore.getState().triggers) {
      if (!t.enabled || runningRef.current.has(t.id)) continue;
      const last = t.lastRun ?? 0;
      if (t.type === "interval") {
        if (last > 0 && now - last >= Math.max(1, t.intervalMinutes) * 60000) {
          void fire(t, runningRef.current, "", "catchup");
        }
      } else if (t.type === "cron") {
        if (last > 0 && hasMissedCronRun(t.cron, last, now)) {
          void fire(t, runningRef.current, "", "catchup");
        }
      }
    }
  }, []);

  // interval/cron: tick local.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const nowDate = new Date(now);
      for (const t of useTriggersStore.getState().triggers) {
        if (!t.enabled || runningRef.current.has(t.id)) continue;
        if (t.type === "interval") {
          if (now - (t.lastRun ?? 0) >= Math.max(1, t.intervalMinutes) * 60000) void fire(t, runningRef.current);
        } else if (t.type === "cron") {
          if (cronMatches(t.cron, nowDate) && minuteKey(now) !== minuteKey(t.lastRun ?? 0)) void fire(t, runningRef.current);
        }
      }
    };
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, []);

  // webhook/file: escuchar los eventos que emite Rust y disparar el trigger correspondiente.
  useEffect(() => {
    if (!isTauri()) return;
    let unWebhook: (() => void) | undefined;
    let unFile: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unWebhook = await listen<{ token: string; body: string }>("webhook-fired", (e) => {
        const t = useTriggersStore.getState().triggers.find((x) => x.id === e.payload.token);
        if (t && t.enabled && t.type === "webhook" && !runningRef.current.has(t.id)) {
          // El body es entrada externa no confiable: solo se pasa como {{input}} si el trigger lo
          // habilitó explícitamente (allowExternalInput). Si no, corre el flujo sin ese input.
          const input = t.allowExternalInput && typeof e.payload.body === "string" ? e.payload.body : "";
          void fire(t, runningRef.current, input);
        }
      });
      unFile = await listen<string>("file-changed", (e) => {
        const t = useTriggersStore.getState().triggers.find((x) => x.id === e.payload);
        if (!t || !t.enabled || t.type !== "file" || runningRef.current.has(t.id)) return;
        // Debounce: notify puede emitir varios eventos por un cambio. Ignoramos si disparó hace < 2s.
        if (Date.now() - (t.lastRun ?? 0) < 2000) return;
        void fire(t, runningRef.current);
      });
    })();
    return () => {
      unWebhook?.();
      unFile?.();
    };
  }, []);

  // Reconcilia el servidor de webhooks y los watchers de archivos con los triggers habilitados.
  useEffect(() => {
    if (!isTauri()) return;
    if (triggers.some((t) => t.enabled && t.type === "webhook") && !webhookStartedRef.current) {
      webhookStartedRef.current = true;
      webhookStart(WEBHOOK_PORT).catch(() => { webhookStartedRef.current = false; });
    }
    const desired = new Map<string, string>();
    for (const t of triggers) if (t.enabled && t.type === "file" && t.path.trim()) desired.set(t.id, t.path.trim());
    for (const [id, path] of desired) {
      if (watchedRef.current.get(id) !== path) {
        watchStart(id, path).then(() => watchedRef.current.set(id, path)).catch(() => {});
      }
    }
    for (const id of [...watchedRef.current.keys()]) {
      if (!desired.has(id)) {
        void watchStop(id);
        watchedRef.current.delete(id);
      }
    }
  }, [triggers]);

  return null;
}

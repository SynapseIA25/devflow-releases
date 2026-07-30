import { useEffect, useRef } from "react";
import { usePlannerStore, type PlannerTask } from "../store/plannerStore";
import { useWorkflowStore } from "../store/workflowStore";
import { runWorkflow } from "../lib/workflowEngine";
import { confirmHeadlessAction } from "../lib/headlessPermission";

// Scheduler de tareas del planner con workflow vinculado, montado UNA vez a nivel App (no renderiza
// nada) — hermano de TriggerRunner pero para disparos DE UNA SOLA VEZ en vez de recurrentes: no hace
// falta distinguir "perdido mientras la app estaba cerrada" con lógica de cron/interval, alcanza con
// "¿dueDate ya pasó y todavía no se disparó?" tanto al montar (catch-up) como en cada tick.
const TICK_MS = 20000;

async function fireTask(t: PlannerTask, running: Set<string>, reason: "schedule" | "catchup") {
  running.add(t.id);
  const st = useWorkflowStore.getState();
  const w = t.workflowId ? st.workflows[t.workflowId] : undefined;
  if (!w) {
    usePlannerStore.getState().recordFire(t.id, "error", "El flujo ya no existe", reason);
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
        confirmAction: confirmHeadlessAction,
      },
      ""
    );
    usePlannerStore.getState().recordFire(t.id, errored ? "error" : "success", logs.slice(-3).join(" · ") || "OK", reason);
  } catch (e) {
    usePlannerStore.getState().recordFire(t.id, "error", e instanceof Error ? e.message : String(e), reason);
  } finally {
    running.delete(t.id);
  }
}

function dueUnfired(t: PlannerTask, now: number): boolean {
  return !t.done && !!t.workflowId && !t.firedAt && t.dueDate <= now;
}

export function PlannerRunner() {
  const runningRef = useRef<Set<string>>(new Set());

  // Catch-up al montar: tareas vencidas mientras la app estaba cerrada.
  useEffect(() => {
    const now = Date.now();
    for (const t of usePlannerStore.getState().tasks) {
      if (!runningRef.current.has(t.id) && dueUnfired(t, now)) void fireTask(t, runningRef.current, "catchup");
    }
  }, []);

  // Tick: dispara tareas cuya fecha llega mientras la app está abierta.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const t of usePlannerStore.getState().tasks) {
        if (!runningRef.current.has(t.id) && dueUnfired(t, now)) void fireTask(t, runningRef.current, "schedule");
      }
    };
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, []);

  return null;
}

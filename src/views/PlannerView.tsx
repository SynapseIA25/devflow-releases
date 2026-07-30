import { useState } from "react";
import { CalendarClock, Plus, Trash2, RotateCcw } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { usePlannerStore } from "../store/plannerStore";
import { useWorkflowStore, useProjectWorkflowIds } from "../store/workflowStore";

// Fecha local en formato aceptado por <input type="datetime-local"> (sin timezone, minuto exacto).
function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlannerView() {
  const projectId = useProjectStore((s) => s.activeId);
  const allTasks = usePlannerStore((s) => s.tasks);
  const addTask = usePlannerStore((s) => s.addTask);
  const updateTask = usePlannerStore((s) => s.updateTask);
  const removeTask = usePlannerStore((s) => s.removeTask);
  const toggleDone = usePlannerStore((s) => s.toggleDone);
  const workflows = useWorkflowStore((s) => s.workflows);
  const workflowOrder = useProjectWorkflowIds();

  const tasks = allTasks
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => a.dueDate - b.dueDate);

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => toLocalInputValue(Date.now() + 60 * 60000));
  const [workflowId, setWorkflowId] = useState("");

  const addNew = () => {
    const t = title.trim();
    if (!t || !due) return;
    const ts = new Date(due).getTime();
    if (Number.isNaN(ts)) return;
    addTask(projectId, t, ts, workflowId || undefined);
    setTitle("");
    setDue(toLocalInputValue(Date.now() + 60 * 60000));
    setWorkflowId("");
    setShowAdd(false);
  };

  const statusFor = (t: (typeof tasks)[number]) => {
    if (t.done) return null;
    if (!t.workflowId) return null;
    if (t.firedAt) {
      return t.lastStatus === "error"
        ? `error · ${t.lastMessage ?? ""}`
        : `disparado${t.firedReason === "catchup" ? " (recuperado)" : ""}`;
    }
    return t.dueDate <= Date.now() ? "disparando…" : "programado";
  };

  return (
    <div className="planner-view">
      <div className="planner-header">
        <span className="planner-title"><CalendarClock size={14} /> Planner</span>
        <button className="svc-add-btn" onClick={() => setShowAdd((v) => !v)} title="Add task"><Plus size={14} /></button>
      </div>

      {showAdd && (
        <div className="planner-add-form">
          <input
            className="svc-input"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNew(); }}
          />
          <input
            className="svc-input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <select className="trg-type" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
            <option value="">No workflow — just a reminder</option>
            {workflowOrder.map((id) => (
              <option key={id} value={id}>Run: {workflows[id]?.name ?? id}</option>
            ))}
          </select>
          <div className="svc-add-actions">
            <button className="svc-btn svc-btn--primary" onClick={addNew} disabled={!title.trim()}>Add</button>
            <button className="svc-btn" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="planner-list">
        {tasks.length === 0 && !showAdd && (
          <div className="svc-empty">No tasks yet. Add one with ＋ — optionally link a workflow to run automatically on its due date.</div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className={`planner-row${t.done ? " planner-row--done" : ""}`}>
            <input type="checkbox" checked={t.done} onChange={() => toggleDone(t.id)} />
            <div className="planner-row-info">
              <div className="planner-row-title">{t.title}</div>
              <div className="planner-row-meta">
                {new Date(t.dueDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                {t.workflowId && ` · ${workflows[t.workflowId]?.name ?? "flujo borrado"}`}
              </div>
            </div>
            {statusFor(t) && <span className="planner-status">{statusFor(t)}</span>}
            {t.firedAt && t.workflowId && (
              <button
                className="proj-icon"
                title="Allow this task to fire the workflow again"
                onClick={() => updateTask(t.id, { firedAt: undefined, firedReason: undefined })}
              >
                <RotateCcw size={11} />
              </button>
            )}
            <button className="trg-del" title="Delete task" onClick={() => removeTask(t.id)}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

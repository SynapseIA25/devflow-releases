import { useState } from "react";
import { ExternalLink, MessageSquare, Plus, X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { suggestExperts } from "../../lib/expertRouter";
import type { AgentConfig } from "../../lib/providers";
import type { SpecTaskState } from "../../lib/specFiles";

// Mismo "ventana en vivo" que SpecArtifactPreview, pero renderiza tasks.md como checklist real (no
// texto crudo) y lo deja editar directo: tildar/destildar, cambiar el texto de una tarea, borrarla,
// agregar una nueva a mano — sin depender de correr Tasks de nuevo para ajustar algo chico. Cada
// tarea también sugiere el experto que le corresponde (reemplaza el modo "Router" que tenía Team) con
// un botón para abrir esa charla directo en el chat sin pasar por Implement.
export function SpecTasksPreview({
  path,
  tasks,
  experts,
  onChange,
  onOpenChat,
}: {
  path: string;
  tasks: SpecTaskState[];
  experts: AgentConfig[];
  onChange: (tasks: SpecTaskState[]) => void | Promise<void>;
  onOpenChat: (task: SpecTaskState, agent: AgentConfig) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newTaskDraft, setNewTaskDraft] = useState("");

  const toggle = (id: string) => void onChange(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const startEdit = (t: SpecTaskState) => {
    setEditingId(t.id);
    setDraft(t.text);
  };
  const commitEdit = () => {
    if (editingId && draft.trim()) void onChange(tasks.map((t) => (t.id === editingId ? { ...t, text: draft.trim() } : t)));
    setEditingId(null);
  };
  const remove = (id: string) => void onChange(tasks.filter((t) => t.id !== id));
  const addTask = () => {
    if (!newTaskDraft.trim()) return;
    void onChange([...tasks, { id: `t${Date.now()}`, text: newTaskDraft.trim(), done: false }]);
    setNewTaskDraft("");
  };

  return (
    <div className="specs-live-panel">
      <div className="specs-winbar">
        <span className="specs-dot specs-dot--r" />
        <span className="specs-dot specs-dot--y" />
        <span className="specs-dot specs-dot--g" />
        <span className="specs-wintitle">tasks.md</span>
        <div className="specs-winbar-actions">
          <button className="specs-winbar-btn" onClick={() => useUiStore.getState().openInEditor(path)} title="Open in editor">
            <ExternalLink size={11} />
          </button>
        </div>
      </div>
      <div className="specs-winbody">
        {tasks.length === 0 && <div className="specs-artifact-empty">Run Tasks to generate the checklist, or add one below.</div>}
        {tasks.map((t) => {
          const suggested = experts.length > 0 ? suggestExperts(t.text, experts)[0]?.agent : undefined;
          return (
            <div key={t.id} className={`specs-task-line${t.done ? " done" : ""}`}>
              <button className="specs-task-box" onClick={() => toggle(t.id)} title={t.done ? "Mark as not done" : "Mark as done"}>
                {t.done ? "✓" : ""}
              </button>
              {editingId === t.id ? (
                <input
                  className="specs-task-edit-input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                />
              ) : (
                <span className="specs-task-text" onClick={() => startEdit(t)} title="Click to edit">
                  {t.text}
                  {t.area && <span className="specs-task-area"> ({t.area})</span>}
                </span>
              )}
              {suggested && (
                <button
                  className="specs-task-suggest"
                  style={{ color: suggested.color }}
                  onClick={() => onOpenChat(t, suggested)}
                  title={`Open in chat with ${suggested.name}`}
                >
                  <MessageSquare size={10} /> {suggested.name}
                </button>
              )}
              <button className="specs-task-remove" onClick={() => remove(t.id)} title="Remove task">
                <X size={10} />
              </button>
            </div>
          );
        })}
        <div className="specs-task-add-row">
          <input
            className="specs-task-add-input"
            placeholder="Add a task…"
            value={newTaskDraft}
            onChange={(e) => setNewTaskDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />
          <button className="specs-task-add-btn" onClick={addTask} disabled={!newTaskDraft.trim()} title="Add task">
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

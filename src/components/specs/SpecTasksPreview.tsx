import type { SpecTaskState } from "../../lib/specFiles";

// Mismo "ventana en vivo" que SpecArtifactPreview, pero renderiza tasks.md como checklist real (no
// como texto crudo) — es la forma que ya vive parseada en spec.tasks (ver projectStore.ts).
export function SpecTasksPreview({ tasks }: { tasks: SpecTaskState[] }) {
  return (
    <div className="specs-live-panel">
      <div className="specs-winbar">
        <span className="specs-dot specs-dot--r" />
        <span className="specs-dot specs-dot--y" />
        <span className="specs-dot specs-dot--g" />
        <span className="specs-wintitle">tasks.md</span>
      </div>
      <div className="specs-winbody">
        {tasks.length === 0 ? (
          <div className="specs-artifact-empty">Run Tasks to generate the checklist.</div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className={`specs-task-line${t.done ? " done" : ""}`}>
              <span className="specs-task-box">{t.done ? "✓" : ""}</span>
              <span className="specs-task-text">
                {t.text}
                {t.area && <span className="specs-task-area"> ({t.area})</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

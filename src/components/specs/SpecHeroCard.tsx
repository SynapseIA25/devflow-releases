import { FileText } from "lucide-react";
import type { Spec } from "../../store/projectStore";
import type { SpecArtifactKind } from "../../lib/specFiles";
import { PHASE_LABEL } from "../../lib/specOrchestrator";

const ARTIFACT_ROWS: { key: SpecArtifactKind; label: string }[] = [
  { key: "requirements", label: "requirements.md" },
  { key: "design", label: "design.md" },
  { key: "tasks", label: "tasks.md" },
];

export function SpecHeroCard({ spec }: { spec: Spec }) {
  const phaseLabel = spec.phase === "done" ? "Done" : PHASE_LABEL[spec.phase].label;
  return (
    <div className="specs-hero">
      <div className="specs-hero-top">
        <div className="specs-hero-icon"><FileText size={22} /></div>
        <div>
          <div className="specs-hero-title">{spec.name}</div>
          <div className="specs-hero-phase-pill">
            <span className={`specs-hero-dot${spec.phase === "done" ? " done" : ""}`} />
            Phase: <b>{phaseLabel}</b>
          </div>
        </div>
      </div>
      <div className="specs-artifact-row">
        {ARTIFACT_ROWS.map((r) => (
          <div key={r.key} className="specs-artifact-card">
            <span className="specs-artifact-fname">{r.label}</span>
            <span className={`specs-artifact-status specs-artifact-status--${spec.artifacts[r.key].status}`}>
              {spec.artifacts[r.key].status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

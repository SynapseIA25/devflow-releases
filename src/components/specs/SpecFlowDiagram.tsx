import { Check, Play, RotateCw } from "lucide-react";
import { isExpertAgent, type AgentConfig } from "../../lib/providers";
import { TASK_PROFILES, type TaskKind } from "../../lib/modelRouter";
import type { Spec, SpecPhase } from "../../store/projectStore";
import { PHASE_ORDER, PHASE_LABEL, PHASE_PROFILE } from "../../lib/specOrchestrator";

type NonDonePhase = Exclude<SpecPhase, "done">;

// Selector de agente+perfil por fase — esto ES la respuesta a "definir qué modelo usa cada agente y
// en qué momento": un override por spec/fase (persistido en spec.phaseAgents), no una regla global.
export function SpecFlowDiagram({
  spec,
  agents,
  lead,
  running,
  onRun,
  onPhaseAgentChange,
}: {
  spec: Spec;
  agents: AgentConfig[];
  lead: AgentConfig;
  running: NonDonePhase | null;
  onRun: (phase: NonDonePhase) => void;
  onPhaseAgentChange: (phase: NonDonePhase, patch: { agentId?: string; profile?: TaskKind }) => void;
}) {
  const experts = agents.filter(isExpertAgent);
  const pickable = [lead, ...experts];
  const currentIndex = spec.phase === "done" ? PHASE_ORDER.length : PHASE_ORDER.indexOf(spec.phase as NonDonePhase);

  return (
    <div className="specs-panel">
      <div className="specs-panel-label">Spec flow — who runs what, and with which model</div>
      <div className="specs-flow">
        {PHASE_ORDER.map((phase, i) => {
          const meta = PHASE_LABEL[phase];
          const override = spec.phaseAgents[phase];
          const agentId = override?.agentId ?? spec.defaultAgentId ?? lead.id;
          const profile = override?.profile ?? PHASE_PROFILE[phase];
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div key={phase} className={`specs-flow-step${active ? " active" : ""}${done ? " done" : ""}`}>
              <div className="specs-flow-head">
                <span className="specs-flow-num">0{i + 1}</span>
                {done && <Check size={12} />}
              </div>
              <div className="specs-flow-title">{meta.label}</div>
              <div className="specs-flow-desc">{meta.desc}</div>
              <select
                className="specs-flow-select"
                value={agentId}
                disabled={!!running}
                onChange={(e) => onPhaseAgentChange(phase, { agentId: e.target.value })}
                title="Agent that runs this phase"
              >
                {pickable.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <select
                className="specs-flow-select"
                value={profile}
                disabled={!!running}
                onChange={(e) => onPhaseAgentChange(phase, { profile: e.target.value as TaskKind })}
                title="Model profile for this phase"
              >
                {TASK_PROFILES.map((p) => (
                  <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>
                ))}
              </select>
              <button className="specs-flow-run" disabled={!!running} onClick={() => onRun(phase)}>
                {running === phase ? <RotateCw size={11} className="spin" /> : <Play size={11} />}
                {running === phase ? "Running…" : "Run"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

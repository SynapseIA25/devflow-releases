import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, FileText } from "lucide-react";
import { useProjectStore, type Spec, type SpecPhase } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { isExpertAgent } from "../lib/providers";
import type { TaskProfile } from "../lib/modelRouter";
import { readSpecArtifact } from "../lib/specFiles";
import {
  runSpecifyPhase,
  runPlanPhase,
  runTasksPhase,
  runImplementPhase,
  type SpecStep,
} from "../lib/specOrchestrator";
import { SpecHeroCard } from "../components/specs/SpecHeroCard";
import { SpecFlowDiagram } from "../components/specs/SpecFlowDiagram";
import { SpecArtifactPreview } from "../components/specs/SpecArtifactPreview";
import { SpecTasksPreview } from "../components/specs/SpecTasksPreview";
import { SpecProgressLog } from "../components/specs/SpecProgressLog";
import { SpecContextStrip } from "../components/specs/SpecContextStrip";
import { SpecStatusBar } from "../components/specs/SpecStatusBar";

type NonDonePhase = Exclude<SpecPhase, "done">;
const NEXT_PHASE: Record<NonDonePhase, SpecPhase> = {
  specify: "plan",
  plan: "tasks",
  tasks: "implement",
  implement: "done", // se corrige a "implement" si quedan tareas sin tildar (ver runPhase)
};

export function SpecsView() {
  const activeId = useProjectStore((s) => s.activeId);
  const project = useProjectStore((s) => s.projects[s.activeId]);
  const createSpec = useProjectStore((s) => s.createSpec);
  const specs = project?.specs ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(specs[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const spec = specs.find((s) => s.id === selectedId) ?? null;

  const handleCreate = () => {
    if (!newName.trim() || !project) return;
    const id = createSpec(activeId, newName.trim());
    setNewName("");
    setSelectedId(id);
  };

  return (
    <div className="specs-view">
      <div className="specs-sidebar">
        <div className="specs-sidebar-head">Specs</div>
        <div className="specs-new-row">
          <input
            className="specs-new-input"
            placeholder="New spec name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="specs-new-btn" onClick={handleCreate} disabled={!newName.trim()} title="Create spec">
            <Plus size={13} />
          </button>
        </div>
        <div className="specs-list">
          {specs.map((s) => (
            <button
              key={s.id}
              className={`specs-list-item${s.id === selectedId ? " active" : ""}`}
              onClick={() => setSelectedId(s.id)}
              title={s.slug}
            >
              <FileText size={13} />
              <span>{s.name}</span>
            </button>
          ))}
          {specs.length === 0 && <div className="specs-empty-hint">No specs yet — create one above.</div>}
        </div>
      </div>

      <div className="specs-main">
        {spec && project ? (
          <SpecDetail key={spec.id} spec={spec} projectId={activeId} projectRoot={project.path} specCount={specs.length} />
        ) : (
          <div className="specs-empty">
            <FileText size={40} opacity={0.2} />
            <p>Create a spec to start Specify → Plan → Tasks → Implement.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SpecDetail({
  spec,
  projectId,
  projectRoot,
  specCount,
}: {
  spec: Spec;
  projectId: string;
  projectRoot: string;
  specCount: number;
}) {
  const agents = useAgentsStore((s) => s.agents);
  const updateSpec = useProjectStore((s) => s.updateSpec);
  const lead = useMemo(() => agents.find((a) => a.id === "opencode-agent") ?? agents[0], [agents]);

  const [artifacts, setArtifacts] = useState({ requirements: "", design: "" });
  const [running, setRunning] = useState<NonDonePhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<SpecStep[]>([]);
  const cancelRef = useRef(false);

  // Releer los artefactos de disco cuando cambia la spec seleccionada o alguno se acaba de escribir.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readSpecArtifact(projectRoot, spec.slug, "requirements"),
      readSpecArtifact(projectRoot, spec.slug, "design"),
    ]).then(([requirements, design]) => {
      if (!cancelled) setArtifacts({ requirements, design });
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, spec.slug, spec.artifacts.requirements.updatedAt, spec.artifacts.design.updatedAt]);

  const onPhaseAgentChange = (phase: NonDonePhase, patch: { agentId?: string; profile?: TaskProfile }) => {
    updateSpec(projectId, spec.id, {
      phaseAgents: { ...spec.phaseAgents, [phase]: { ...spec.phaseAgents[phase], ...patch } },
    });
  };

  const runPhase = async (phase: NonDonePhase) => {
    if (running || !lead) return;
    setRunning(phase);
    setError(null);
    try {
      if (phase === "specify") {
        await runSpecifyPhase(spec, projectRoot, agents, lead);
        updateSpec(projectId, spec.id, {
          artifacts: { ...spec.artifacts, requirements: { status: "ready", updatedAt: Date.now() } },
          phase: NEXT_PHASE.specify,
        });
      } else if (phase === "plan") {
        await runPlanPhase(spec, projectRoot, agents, lead);
        updateSpec(projectId, spec.id, {
          artifacts: { ...spec.artifacts, design: { status: "ready", updatedAt: Date.now() } },
          phase: NEXT_PHASE.plan,
        });
      } else if (phase === "tasks") {
        const tasks = await runTasksPhase(spec, projectRoot, agents, lead);
        updateSpec(projectId, spec.id, {
          tasks,
          artifacts: { ...spec.artifacts, tasks: { status: "ready", updatedAt: Date.now() } },
          phase: NEXT_PHASE.tasks,
        });
      } else {
        setSteps([]);
        cancelRef.current = false;
        const tasks = await runImplementPhase(
          spec,
          projectRoot,
          agents,
          lead,
          (step) => setSteps((prev) => [...prev, step]),
          () => cancelRef.current
        );
        const allDone = tasks.length > 0 && tasks.every((t) => t.done);
        updateSpec(projectId, spec.id, { tasks, phase: allDone ? "done" : "implement" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <>
      <div className="specs-header">
        <h2 className="specs-title">{spec.name}</h2>
        <p className="specs-sub">
          The spec is the source of truth — code is a generated artifact. Four phases, one human checkpoint each.
        </p>
        {error && <div className="specs-error">{error}</div>}
      </div>

      <div className="specs-body-grid">
        <div className="specs-col">
          <SpecHeroCard spec={spec} />
          <SpecFlowDiagram
            spec={spec}
            agents={agents.filter(isExpertAgent)}
            lead={lead}
            running={running}
            onRun={(p) => void runPhase(p)}
            onPhaseAgentChange={onPhaseAgentChange}
          />
          <SpecContextStrip projectRoot={projectRoot} />
        </div>
        <div className="specs-col">
          <SpecArtifactPreview title="requirements.md" content={artifacts.requirements} emptyHint="Run Specify to generate this." />
          <SpecTasksPreview tasks={spec.tasks} />
          <SpecProgressLog steps={steps} running={running === "implement"} />
        </div>
      </div>

      <SpecStatusBar spec={spec} projectName={projectRoot.split(/[\\/]/).pop() ?? projectRoot} leadName={lead?.name ?? "—"} specCount={specCount} />
    </>
  );
}

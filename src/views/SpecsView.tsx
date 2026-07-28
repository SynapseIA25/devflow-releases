import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, FileText, Zap, Boxes, Cpu, Timer } from "lucide-react";
import { useProjectStore, type Spec, type SpecPhase } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useSettingsStore } from "../store/settingsStore";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { DEFAULT_PROVIDERS, isExpertAgent, type AgentConfig } from "../lib/providers";
import type { TaskProfile } from "../lib/modelRouter";
import { createWorktree } from "../lib/environments";
import * as acpClient from "../lib/acpClient";
import * as opencodeClient from "../lib/opencodeClient";
import { readSpecArtifact, writeSpecArtifact, serializeTasksMarkdown, specArtifactPath, type SpecTaskState } from "../lib/specFiles";
import { SPEC_TEMPLATES } from "../lib/specTemplates";
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

// Spec-Driven Development unifica lo que antes era la vista Equipo separada: "Auto-delegar" ahora es
// una tarea rápida (crea una spec real de un solo paso, salta directo a Implement — a diferencia de
// Team, que no dejaba rastro de nada) y "Router" ahora es el chip de experto sugerido + "abrir en
// chat" en cada tarea del checklist (ver SpecTasksPreview). Mismo motor (autoDelegate/runAgentTurn),
// una sola entrada en vez de dos.
export function SpecsView() {
  const activeId = useProjectStore((s) => s.activeId);
  const project = useProjectStore((s) => s.projects[s.activeId]);
  const createSpec = useProjectStore((s) => s.createSpec);
  const updateSpec = useProjectStore((s) => s.updateSpec);
  const specs = project?.specs ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(specs[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [templateId, setTemplateId] = useState(SPEC_TEMPLATES[0].id);
  const [quickTask, setQuickTask] = useState("");
  const [autoRunId, setAutoRunId] = useState<string | null>(null);
  const spec = specs.find((s) => s.id === selectedId) ?? null;

  // La plantilla solo precarga requirements.md (un punto de partida editable, no algo definitivo) —
  // el usuario la ajusta con el lápiz de SpecArtifactPreview o corriendo Specify igual después.
  const handleCreate = async () => {
    if (!newName.trim() || !project) return;
    const id = createSpec(activeId, newName.trim());
    const template = SPEC_TEMPLATES.find((t) => t.id === templateId);
    if (template?.requirements) {
      const created = useProjectStore.getState().projects[activeId]?.specs.find((s) => s.id === id);
      if (created) {
        await writeSpecArtifact(project.path, created.slug, "requirements", template.requirements);
        updateSpec(activeId, id, {
          artifacts: { ...created.artifacts, requirements: { status: "ready", updatedAt: Date.now() } },
        });
      }
    }
    setNewName("");
    setSelectedId(id);
  };

  // "Tarea rápida" = lo que antes era Team en modo Auto-delegar: crea una spec real (con historial,
  // a diferencia de antes) con UNA tarea ya cargada, salta directo a Implement, y la corre sola.
  const handleQuickTask = async () => {
    const text = quickTask.trim();
    if (!text || !project) return;
    const id = createSpec(activeId, text);
    const created = useProjectStore.getState().projects[activeId]?.specs.find((s) => s.id === id);
    if (!created) return;
    const tasks: SpecTaskState[] = [{ id: "t1", text, done: false }];
    await writeSpecArtifact(project.path, created.slug, "tasks", serializeTasksMarkdown(tasks));
    updateSpec(activeId, id, {
      tasks,
      phase: "implement",
      artifacts: { ...created.artifacts, tasks: { status: "ready", updatedAt: Date.now() } },
    });
    setQuickTask("");
    setSelectedId(id);
    setAutoRunId(id);
  };

  return (
    <div className="specs-view">
      <div className="specs-sidebar">
        <div className="specs-sidebar-head">Specs</div>

        <div className="specs-quick-task">
          <label className="specs-quick-task-label"><Zap size={11} /> Quick task</label>
          <textarea
            className="specs-quick-task-input"
            placeholder="e.g. Add input validation to the login form…"
            value={quickTask}
            onChange={(e) => setQuickTask(e.target.value)}
            rows={2}
          />
          <button className="specs-quick-task-btn" onClick={() => void handleQuickTask()} disabled={!quickTask.trim()}>
            <Zap size={11} /> Run now
          </button>
        </div>

        <div className="specs-template-row">
          <select className="specs-template-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {SPEC_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="specs-template-hint">{SPEC_TEMPLATES.find((t) => t.id === templateId)?.description}</p>
        </div>
        <div className="specs-new-row">
          <input
            className="specs-new-input"
            placeholder="New spec name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
          <button className="specs-new-btn" onClick={() => void handleCreate()} disabled={!newName.trim()} title="Create spec">
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
          {specs.length === 0 && <div className="specs-empty-hint">No specs yet — create one above, or run a quick task.</div>}
        </div>
      </div>

      <div className="specs-main">
        {spec && project ? (
          <SpecDetail
            key={spec.id}
            spec={spec}
            projectId={activeId}
            projectRoot={project.path}
            specCount={specs.length}
            autoRun={autoRunId === spec.id}
            onAutoRunConsumed={() => setAutoRunId(null)}
          />
        ) : (
          <div className="specs-empty">
            <FileText size={40} opacity={0.2} />
            <p>Create a spec to start Specify → Plan → Tasks → Implement, or run a quick task.</p>
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
  autoRun,
  onAutoRunConsumed,
}: {
  spec: Spec;
  projectId: string;
  projectRoot: string;
  specCount: number;
  autoRun: boolean;
  onAutoRunConsumed: () => void;
}) {
  const agents = useAgentsStore((s) => s.agents);
  const updateSpec = useProjectStore((s) => s.updateSpec);
  const lead = useMemo(() => agents.find((a) => a.id === "opencode-agent") ?? agents[0], [agents]);
  const experts = useMemo(() => agents.filter(isExpertAgent), [agents]);

  // Config de ejecución de Implement — mismo rol que tenían los controles de Team: sobre qué provider
  // corre el equipo (cuota-consciente si es "opencode"), timeout por turno, y si aísla en un ambiente
  // (worktree) para no tocar el proyecto real. Persistidos (menos isolate, por-corrida).
  const teamProviderId = useSettingsStore((s) => s.teamProviderId);
  const setTeamProviderId = useSettingsStore((s) => s.setTeamProviderId);
  const teamTurnTimeoutSecs = useSettingsStore((s) => s.teamTurnTimeoutSecs);
  const setTeamTurnTimeoutSecs = useSettingsStore((s) => s.setTeamTurnTimeoutSecs);
  const [isolate, setIsolate] = useState(true);
  const [envName, setEnvName] = useState<string | null>(null);
  const onTeamProvider = (a: AgentConfig): AgentConfig =>
    a.providerId === teamProviderId ? a : { ...a, providerId: teamProviderId, model: "" };

  const [artifacts, setArtifacts] = useState({ requirements: "", design: "" });
  const [running, setRunning] = useState<NonDonePhase | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<SpecStep[]>([]);
  const cancelRef = useRef(false);
  const autoRanRef = useRef(false);

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

  // Checkpoint humano real: revisar Y AJUSTAR un artefacto, no solo re-generarlo entero. Escribe al
  // mismo archivo real que lee/escribe la fase correspondiente — editar acá y correr la fase de
  // nuevo después son la misma fuente de verdad, no dos caminos separados.
  const saveArtifact = async (kind: "requirements" | "design", text: string) => {
    await writeSpecArtifact(projectRoot, spec.slug, kind, text);
    setArtifacts((a) => ({ ...a, [kind]: text }));
    updateSpec(projectId, spec.id, {
      artifacts: { ...spec.artifacts, [kind]: { status: text.trim() ? "ready" : "missing", updatedAt: Date.now() } },
    });
  };

  const saveTasks = async (tasks: SpecTaskState[]) => {
    await writeSpecArtifact(projectRoot, spec.slug, "tasks", serializeTasksMarkdown(tasks));
    updateSpec(projectId, spec.id, {
      tasks,
      artifacts: { ...spec.artifacts, tasks: { status: tasks.length ? "ready" : "missing", updatedAt: Date.now() } },
    });
  };

  // Reemplaza el modo "Router" de Team: en vez de una vista aparte, cada tarea del checklist ya
  // sugiere el experto que le corresponde (ver SpecTasksPreview) — este botón abre esa charla directo
  // sin pasar por Implement, para cuando alcanza con una respuesta rápida en el chat.
  const openTaskInChat = (task: SpecTaskState, agent: AgentConfig) => {
    useChatStore.getState().setActiveAgent(agent.id);
    useWorkspaceStore.getState().newWorkspace(agent.id, projectId, { title: agent.name });
    useUiStore.getState().setPendingPrompt(task.text);
    useUiStore.getState().setView("chat");
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
        setEnvName(null);
        cancelRef.current = false;
        let cwd = projectRoot;
        const mappedLead = onTeamProvider(lead);
        const mappedAgents = agents.map(onTeamProvider);

        // Reinicia los procesos ACP/OpenCode involucrados ANTES de correr: un turno colgado previo
        // puede dejar el proceso compartido wedgeado — arrancar fresco lo evita (mismo criterio que
        // ya usaba Team).
        setNote("Restarting the agent to start fresh…");
        const providers = [...new Set([mappedLead, ...mappedAgents].map((a) => a.providerId))];
        for (const p of providers) {
          await (p === "opencode" ? opencodeClient.restart(p) : acpClient.restart(p));
          useWorkspaceStore.getState().resetSessions(p);
        }

        if (isolate) {
          const wtName = `spec-${spec.slug.slice(0, 24)}-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
          setNote(`Creating isolated environment "${wtName}" (worktree)…`);
          const wt = await createWorktree(projectRoot, wtName);
          useProjectStore.getState().addEnvironment(wt);
          cwd = wt.path;
          setEnvName(wt.name);
        }
        setNote(null);

        const tasks = await runImplementPhase(
          spec,
          projectRoot,
          mappedAgents,
          mappedLead,
          (step) => setSteps((prev) => [...prev, step]),
          () => cancelRef.current,
          { cwd, timeoutMs: teamTurnTimeoutSecs * 1000 }
        );
        const allDone = tasks.length > 0 && tasks.every((t) => t.done);
        updateSpec(projectId, spec.id, { tasks, phase: allDone ? "done" : "implement" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNote(null);
      setRunning(null);
    }
  };

  // Dispara Implement solo (no las otras fases) para una tarea rápida recién creada — una sola vez.
  useEffect(() => {
    if (autoRun && !autoRanRef.current && spec.phase === "implement" && spec.tasks.some((t) => !t.done)) {
      autoRanRef.current = true;
      onAutoRunConsumed();
      void runPhase("implement");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <>
      <div className="specs-header">
        <h2 className="specs-title">{spec.name}</h2>
        <p className="specs-sub">
          The spec is the source of truth — code is a generated artifact. Four phases, one human checkpoint each.
        </p>
        {note && <div className="specs-note">{note}</div>}
        {error && <div className="specs-error">{error}</div>}
        {envName && !running && (
          <div className="specs-env-banner">
            <Boxes size={13} />
            <span>Changes were isolated in the <strong>{envName}</strong> environment. Review the diff and promote or discard from Environments.</span>
            <button className="specs-env-banner-btn" onClick={() => useUiStore.getState().setView("environments")}>
              Go to Environments →
            </button>
          </div>
        )}
      </div>

      <div className="specs-body-grid">
        <div className="specs-col">
          <SpecHeroCard spec={spec} />
          <SpecFlowDiagram
            spec={spec}
            agents={experts}
            lead={lead}
            running={running}
            onRun={(p) => void runPhase(p)}
            onPhaseAgentChange={onPhaseAgentChange}
          />
          <div className="specs-panel">
            <div className="specs-panel-label">Implement run settings</div>
            <div className="specs-run-settings">
              <label className="specs-run-setting">
                <Cpu size={12} /> Provider:
                <select value={teamProviderId} onChange={(e) => setTeamProviderId(e.target.value)} disabled={!!running}>
                  {DEFAULT_PROVIDERS.filter((p) => p.acp || p.nativeHttp).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.id === "opencode" ? " — free model per task" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="specs-run-setting" title="Per-turn time limit. Raise it if experts get cut off mid-work.">
                <Timer size={12} /> Timeout:
                <input
                  type="number"
                  className="specs-run-timeout-input"
                  min={30}
                  max={1800}
                  step={30}
                  value={teamTurnTimeoutSecs}
                  onChange={(e) => setTeamTurnTimeoutSecs(e.target.valueAsNumber)}
                  disabled={!!running}
                />
                s
              </label>
              <label className="specs-run-setting specs-run-setting--checkbox">
                <input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} disabled={!!running} />
                <Boxes size={12} /> Isolate in an environment (worktree)
              </label>
            </div>
          </div>
          <SpecContextStrip projectRoot={projectRoot} />
        </div>
        <div className="specs-col">
          <SpecArtifactPreview
            title="requirements.md"
            path={specArtifactPath(projectRoot, spec.slug, "requirements")}
            content={artifacts.requirements}
            emptyHint="Run Specify to generate this, or write it yourself."
            onSave={(text) => saveArtifact("requirements", text)}
          />
          <SpecArtifactPreview
            title="design.md"
            path={specArtifactPath(projectRoot, spec.slug, "design")}
            content={artifacts.design}
            emptyHint="Run Plan to generate this, or write it yourself."
            onSave={(text) => saveArtifact("design", text)}
          />
          <SpecTasksPreview
            path={specArtifactPath(projectRoot, spec.slug, "tasks")}
            tasks={spec.tasks}
            experts={experts}
            onChange={saveTasks}
            onOpenChat={openTaskInChat}
          />
          <SpecProgressLog steps={steps} running={running === "implement"} />
        </div>
      </div>

      <SpecStatusBar spec={spec} projectName={projectRoot.split(/[\\/]/).pop() ?? projectRoot} leadName={lead?.name ?? "—"} specCount={specCount} />
    </>
  );
}

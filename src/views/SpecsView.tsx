import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, FileText, Zap, Boxes, Cpu, Timer, RotateCw } from "lucide-react";
import { useProjectStore, type Spec } from "../store/projectStore";
import { useAgentsStore } from "../store/agentsStore";
import { useSettingsStore } from "../store/settingsStore";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { useSpecRunStore } from "../store/specRunStore";
import { isExpertAgent, DEFAULT_PROVIDERS, type AgentConfig } from "../lib/providers";
import type { TaskKind } from "../lib/modelRouter";
import { readSpecArtifact, writeSpecArtifact, serializeTasksMarkdown, specArtifactPath, type SpecTaskState } from "../lib/specFiles";
import { SPEC_TEMPLATES } from "../lib/specTemplates";
import { runSpecPhase } from "../lib/specRuns";
import type { NonDonePhase } from "../lib/specOrchestrator";
import { SpecHeroCard } from "../components/specs/SpecHeroCard";
import { SpecFlowDiagram } from "../components/specs/SpecFlowDiagram";
import { SpecArtifactPreview } from "../components/specs/SpecArtifactPreview";
import { SpecTasksPreview } from "../components/specs/SpecTasksPreview";
import { SpecProgressLog } from "../components/specs/SpecProgressLog";
import { SpecContextStrip } from "../components/specs/SpecContextStrip";
import { SpecStatusBar } from "../components/specs/SpecStatusBar";

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
            <SpecListItem key={s.id} spec={s} active={s.id === selectedId} onClick={() => setSelectedId(s.id)} />
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

// Fila del sidebar como componente propio: se suscribe SOLO a si ESTA spec está corriendo, para que
// el progreso de una corrida (que actualiza el store en cada paso) no re-renderice la lista entera —
// y, más importante, para que quede visible cuál spec está corriendo aunque no sea la seleccionada:
// la prueba visual de que dos specs pueden correr a la vez (ver specRunStore.ts).
function SpecListItem({ spec, active, onClick }: { spec: Spec; active: boolean; onClick: () => void }) {
  const running = useSpecRunStore((s) => s.runs[spec.id]?.running ?? null);
  return (
    <button className={`specs-list-item${active ? " active" : ""}`} onClick={onClick} title={spec.slug}>
      {running ? <RotateCw size={13} className="spin" /> : <FileText size={13} />}
      <span>{spec.name}</span>
      {running && <span className="specs-list-item-running">{running}</span>}
    </button>
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

  // Estado de la corrida — vive en useSpecRunStore (keyed por spec.id), NO en useState local: así
  // arrancar Implement en otra spec no depende de que ESTA siga siendo la seleccionada, y esta spec
  // sigue mostrando su progreso si sigue corriendo cuando volvés a seleccionarla (ver specRunStore.ts).
  const run = useSpecRunStore((s) => s.getRun(spec.id));
  const { running, note, error, envName, steps } = run;

  const [artifacts, setArtifacts] = useState({ requirements: "", design: "" });
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

  const onPhaseAgentChange = (phase: NonDonePhase, patch: { agentId?: string; profile?: TaskKind }) => {
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

  // La ejecución real vive en runSpecPhase (specRuns.ts), desacoplada de este componente — escribe el
  // progreso en useSpecRunStore por spec.id en vez de useState local, así sigue corriendo (y siendo
  // visible al volver) aunque cambies de spec seleccionada mientras tanto. Acá solo se arma la config
  // de la corrida con lo que este componente ya tiene a mano.
  const runPhase = (phase: NonDonePhase) => {
    if (!lead) return;
    void runSpecPhase(spec, projectId, projectRoot, phase, {
      agents,
      lead,
      teamProviderId,
      teamTurnTimeoutSecs,
      isolate,
    });
  };

  // Dispara Implement solo (no las otras fases) para una tarea rápida recién creada — una sola vez.
  useEffect(() => {
    if (autoRun && !autoRanRef.current && spec.phase === "implement" && spec.tasks.some((t) => !t.done)) {
      autoRanRef.current = true;
      onAutoRunConsumed();
      runPhase("implement");
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
            onRun={runPhase}
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

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Play, CheckCircle2, XCircle, Loader2, Pencil, Search } from "lucide-react";
import { useProjectStore, type TestFramework, type TestRun } from "../store/projectStore";
import { detectTestCommand, runProjectTests } from "../lib/testRunner";

const FRAMEWORK_LABEL: Record<TestFramework, string> = {
  npm: "npm", pytest: "pytest", cargo: "cargo", go: "go", custom: "custom",
};

function durationLabel(run: TestRun): string {
  if (!run.finishedAt) return "";
  const ms = run.finishedAt - run.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusIcon({ status }: { status: TestRun["status"] }) {
  if (status === "running") return <Loader2 size={13} className="spin" />;
  if (status === "passed") return <CheckCircle2 size={13} className="tests-icon-pass" />;
  return <XCircle size={13} className="tests-icon-fail" />;
}

// Panel de Tests: runner tradicional (Fase 1 de la herramienta de testing nativa — ver memoria
// devflow-testing-tool-design). Corre el comando de test del proyecto (configurado a mano o
// auto-detectado) vía runShellCommand y guarda un historial acotado de corridas con su output.
export function TestsView() {
  const activeId = useProjectStore((s) => s.activeId);
  const project = useProjectStore((s) => s.projects[s.activeId]);
  const setTestConfig = useProjectStore((s) => s.setTestConfig);

  const [editing, setEditing] = useState(false);
  const [cmdDraft, setCmdDraft] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const config = project?.testConfig;
  const runs = useMemo(() => project?.testRuns ?? [], [project?.testRuns]);
  const selectedRun = runs.find((r) => r.id === selected) ?? runs[0];

  // Al cambiar de proyecto activo, la selección de corrida del proyecto anterior deja de ser válida.
  useEffect(() => { setSelected(null); setEditing(false); setRunError(null); }, [activeId]);

  const runNow = async () => {
    if (!project || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const run = await runProjectTests(project.id);
      setSelected(run.id);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const detect = async () => {
    if (!project) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const found = await detectTestCommand(project.path);
      if (!found) {
        setDetectError("No se detectó un comando de test (sin package.json con script \"test\", Cargo.toml, go.mod ni pytest.ini/pyproject.toml/setup.py). Configurá uno manualmente.");
        setEditing(true);
        setCmdDraft("");
      } else {
        setTestConfig(project.id, found);
      }
    } finally {
      setDetecting(false);
    }
  };

  const startEdit = () => {
    setCmdDraft(config?.command ?? "");
    setEditing(true);
  };

  const saveEdit = () => {
    if (!project) return;
    const command = cmdDraft.trim();
    if (!command) return;
    setTestConfig(project.id, { command, framework: config?.framework ?? "custom", cwd: config?.cwd });
    setEditing(false);
  };

  if (!project) return null;

  return (
    <div className="tests-view">
      <div className="tests-sidebar">
        <div className="tests-header">
          <span className="tests-title"><FlaskConical size={14} /> Tests</span>
        </div>

        <div className="tests-config">
          {editing ? (
            <div className="svc-add-form">
              <input
                className="svc-input"
                placeholder="Comando de test (ej. npm test, pytest, cargo test)"
                value={cmdDraft}
                onChange={(e) => setCmdDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
                autoFocus
              />
              <div className="svc-add-actions">
                <button className="svc-btn svc-btn--primary" onClick={saveEdit} disabled={!cmdDraft.trim()}>Guardar</button>
                <button className="svc-btn" onClick={() => setEditing(false)}>Cancelar</button>
              </div>
            </div>
          ) : config ? (
            <div className="tests-config-row">
              <div className="tests-config-info">
                <span className="tests-config-badge">{FRAMEWORK_LABEL[config.framework]}</span>
                <span className="tests-config-cmd">{config.command}</span>
              </div>
              <button className="svc-icon" onClick={startEdit} title="Editar comando"><Pencil size={12} /></button>
            </div>
          ) : (
            <div className="tests-empty-config">
              <p>Sin comando de test configurado para este proyecto.</p>
              <div className="svc-add-actions">
                <button className="svc-btn svc-btn--primary" onClick={detect} disabled={detecting}>
                  <Search size={12} /> {detecting ? "Detectando…" : "Auto-detectar"}
                </button>
                <button className="svc-btn" onClick={startEdit}>Configurar a mano</button>
              </div>
              {detectError && <p className="tests-error">{detectError}</p>}
            </div>
          )}

          <button className="tests-run-btn" onClick={runNow} disabled={running || !config && !editing}>
            {running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            {running ? "Corriendo…" : "Correr tests"}
          </button>
          {runError && <p className="tests-error">{runError}</p>}
        </div>

        <div className="svc-list tests-runs-list">
          {runs.length === 0 && (
            <div className="svc-empty">Sin corridas todavía. Tocá "Correr tests" para la primera.</div>
          )}
          {runs.map((run) => (
            <div
              key={run.id}
              className={`svc-row${(selectedRun?.id === run.id) ? " selected" : ""}`}
              onClick={() => setSelected(run.id)}
            >
              <StatusIcon status={run.status} />
              <div className="svc-row-info">
                <div className="svc-row-name">
                  {run.status === "running" ? "Corriendo…" : run.status === "passed" ? "Pasó" : "Falló"}
                  {run.exitCode != null && ` (exit ${run.exitCode})`}
                </div>
                <div className="svc-row-cmd">{timeLabel(run.startedAt)}{run.finishedAt ? ` · ${durationLabel(run)}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="tests-main">
        {selectedRun ? (
          <>
            <div className="svc-detail-bar">
              <StatusIcon status={selectedRun.status} />
              <span className="svc-detail-name">{config?.command}</span>
              <span className="svc-detail-status">
                {selectedRun.status === "running" ? "corriendo…" : `${timeLabel(selectedRun.startedAt)} · ${durationLabel(selectedRun)}`}
              </span>
            </div>
            <pre className="tests-output">{selectedRun.output || (selectedRun.status === "running" ? "…" : "(sin output)")}</pre>
          </>
        ) : (
          <div className="svc-logs-empty">Corré los tests para ver el output acá.</div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useProjectStore, type Project } from "../store/projectStore";
import { suggestTestStrategy } from "../lib/testStrategy";
import { generateAndInsertCase, type InsertCaseResult } from "../lib/testCaseInsert";
import type { TestCasePattern } from "../lib/testStrategyCatalog";
import type { StackFingerprint } from "../lib/stackDetect";

const RENDER_ENGINE_LABEL: Record<string, string> = {
  chromium: "Chromium",
  webkit: "WebKit",
  "native-skia": "Native (Skia)",
  "qt-gtk-swing": "Native (Qt/GTK/Swing)",
  "none-cli": "CLI / shell",
  unknown: "Unknown",
};

type CaseGenState = { open: boolean; hint: string; generating: boolean; result?: InsertCaseResult; error?: string };

// Fase 5-7 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Detecta el stack del proyecto, muestra la estrategia sugerida
// (backend de automatización + patrones de caso) y permite generar+insertar un caso real para cada
// patrón (Fase 7) — determinístico para smoke/cli-smoke, un turno de agente para el resto.
export function TestStrategyPanel({ project }: { project: Project }) {
  const setTestStrategy = useProjectStore((s) => s.setTestStrategy);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);
  const [caseGen, setCaseGen] = useState<Record<string, CaseGenState>>({});

  const cached = project.testStrategy;

  const detect = async () => {
    setDetecting(true);
    setError(null);
    try {
      const { fingerprint, strategy } = await suggestTestStrategy(project.path);
      setTestStrategy(project.id, { fingerprint, strategy, detectedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };

  const toggleCase = (id: string) =>
    setCaseGen((prev) => {
      const existing = prev[id] ?? { open: false, hint: "", generating: false };
      return { ...prev, [id]: { ...existing, open: !existing.open } };
    });

  const setHint = (id: string, hint: string) =>
    setCaseGen((prev) => {
      const existing = prev[id] ?? { open: true, hint: "", generating: false };
      return { ...prev, [id]: { ...existing, open: true, hint } };
    });

  const generateCase = async (pattern: TestCasePattern, fingerprint: StackFingerprint) => {
    const hint = caseGen[pattern.id]?.hint ?? "";
    setCaseGen((prev) => ({ ...prev, [pattern.id]: { open: true, hint, generating: true, error: undefined, result: undefined } }));
    try {
      const result = await generateAndInsertCase(project.path, pattern, fingerprint, hint);
      setCaseGen((prev) => ({ ...prev, [pattern.id]: { ...prev[pattern.id], generating: false, result } }));
    } catch (e) {
      setCaseGen((prev) => ({ ...prev, [pattern.id]: { ...prev[pattern.id], generating: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  return (
    <div className="strategy-panel">
      <div className="strategy-toolbar">
        <button className="svc-btn svc-btn--primary" onClick={detect} disabled={detecting}>
          <RefreshCw size={12} className={detecting ? "spin" : ""} />
          {detecting ? "Detecting…" : cached ? "Re-detect" : "Detect stack"}
        </button>
        {cached && <span className="strategy-detected-at">detected {new Date(cached.detectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      {error && <p className="tests-error">{error}</p>}

      {!cached && !error && (
        <div className="svc-empty">This project's stack hasn't been detected yet. Tap "Detect stack" to get started.</div>
      )}

      {cached && (
        <>
          <div className="strategy-section">
            <div className="strategy-badges">
              <span className="tests-config-badge">{cached.fingerprint.language}</span>
              {cached.fingerprint.uiFramework && <span className="tests-config-badge">{cached.fingerprint.uiFramework}</span>}
              <span className="tests-config-badge">{RENDER_ENGINE_LABEL[cached.fingerprint.renderEngine] ?? cached.fingerprint.renderEngine}</span>
              {cached.fingerprint.isMobile && <span className="tests-config-badge">mobile</span>}
              {cached.fingerprint.existingTestFrameworks.map((fw) => (
                <span key={fw} className="tests-config-badge">{fw}</span>
              ))}
            </div>
            {cached.fingerprint.markers.length > 0 && (
              <div className="strategy-collapsible">
                <button className="strategy-collapsible-toggle" onClick={() => setMarkersOpen((v) => !v)}>
                  {markersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} why? ({cached.fingerprint.markers.length} signals)
                </button>
                {markersOpen && (
                  <ul className="strategy-markers">
                    {cached.fingerprint.markers.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="strategy-section">
            <div className="strategy-section-title">
              Suggested backend
              <span className={`strategy-source-badge strategy-source-badge--${cached.strategy.source}`}>
                {cached.strategy.source === "catalog" ? "catalog" : "QA agent"}
              </span>
            </div>
            <p className="strategy-backend">{cached.strategy.backend}</p>
            {cached.strategy.rationale && (
              <div className="strategy-collapsible">
                <button className="strategy-collapsible-toggle" onClick={() => setRationaleOpen((v) => !v)}>
                  {rationaleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} see reasoning
                </button>
                {rationaleOpen && <p className="strategy-rationale">{cached.strategy.rationale}</p>}
              </div>
            )}
            {cached.strategy.mcpServerIds.length > 0 && (
              <p className="strategy-hint">
                Recommended MCP servers: {cached.strategy.mcpServerIds.join(", ")} — enable them in the MCP tab.
              </p>
            )}
          </div>

          <div className="strategy-section">
            <div className="strategy-section-title">Suggested case patterns</div>
            {cached.strategy.casePatterns.length === 0 ? (
              <p className="strategy-hint">No patterns suggested for this stack yet.</p>
            ) : (
              <div className="strategy-patterns">
                {cached.strategy.casePatterns.map((pattern) => {
                  const gen = caseGen[pattern.id];
                  return (
                    <div key={pattern.id} className="strategy-pattern">
                      <div className="strategy-pattern-label">{pattern.label}</div>
                      <div className="strategy-pattern-desc">{pattern.description}</div>
                      <div className="strategy-pattern-actions">
                        <button className="svc-btn" onClick={() => toggleCase(pattern.id)}>
                          {gen?.open ? "Cancel" : "Generate and insert"}
                        </button>
                      </div>
                      {gen?.open && (
                        <div className="strategy-case-form">
                          <input
                            className="svc-input"
                            placeholder="What to test specifically (module, component, endpoint)…"
                            value={gen.hint}
                            onChange={(e) => setHint(pattern.id, e.target.value)}
                            disabled={gen.generating}
                            onKeyDown={(e) => { if (e.key === "Enter") generateCase(pattern, cached.fingerprint); }}
                            autoFocus
                          />
                          <button
                            className="svc-btn svc-btn--primary"
                            onClick={() => generateCase(pattern, cached.fingerprint)}
                            disabled={gen.generating}
                          >
                            {gen.generating ? "Generating…" : "Confirm"}
                          </button>
                          {gen.error && <p className="tests-error">{gen.error}</p>}
                          {gen.result && (
                            gen.result.inserted ? (
                              <p className="strategy-case-ok">✓ Inserted into {gen.result.filePath}</p>
                            ) : (
                              <p className="tests-error">Couldn't insert: {gen.result.warning}</p>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

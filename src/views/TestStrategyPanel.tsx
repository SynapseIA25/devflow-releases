import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useProjectStore, type Project } from "../store/projectStore";
import { suggestTestStrategy } from "../lib/testStrategy";

const RENDER_ENGINE_LABEL: Record<string, string> = {
  chromium: "Chromium",
  webkit: "WebKit",
  "native-skia": "Nativo (Skia)",
  "qt-gtk-swing": "Nativo (Qt/GTK/Swing)",
  "none-cli": "CLI / shell",
  unknown: "Desconocido",
};

// Fase 5 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Panel de solo lectura: detecta el stack del proyecto y muestra la
// estrategia sugerida (backend de automatización + patrones de caso). La generación/inserción de
// casos (Fase 7) y el fallback real al agente QA (Fase 6) llegan después — acá solo se muestra lo que
// el catálogo estático ya sabe resolver.
export function TestStrategyPanel({ project }: { project: Project }) {
  const setTestStrategy = useProjectStore((s) => s.setTestStrategy);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);

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

  return (
    <div className="strategy-panel">
      <div className="strategy-toolbar">
        <button className="svc-btn svc-btn--primary" onClick={detect} disabled={detecting}>
          <RefreshCw size={12} className={detecting ? "spin" : ""} />
          {detecting ? "Detectando…" : cached ? "Re-detectar" : "Detectar stack"}
        </button>
        {cached && <span className="strategy-detected-at">detectado {new Date(cached.detectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      {error && <p className="tests-error">{error}</p>}

      {!cached && !error && (
        <div className="svc-empty">Todavía no se detectó el stack de este proyecto. Tocá "Detectar stack" para empezar.</div>
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
                  {markersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} ¿por qué? ({cached.fingerprint.markers.length} señales)
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
              Backend sugerido
              <span className={`strategy-source-badge strategy-source-badge--${cached.strategy.source}`}>
                {cached.strategy.source === "catalog" ? "catálogo" : "agente QA"}
              </span>
            </div>
            <p className="strategy-backend">{cached.strategy.backend}</p>
            {cached.strategy.rationale && (
              <div className="strategy-collapsible">
                <button className="strategy-collapsible-toggle" onClick={() => setRationaleOpen((v) => !v)}>
                  {rationaleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} ver razonamiento
                </button>
                {rationaleOpen && <p className="strategy-rationale">{cached.strategy.rationale}</p>}
              </div>
            )}
            {cached.strategy.mcpServerIds.length > 0 && (
              <p className="strategy-hint">
                MCP servers recomendados: {cached.strategy.mcpServerIds.join(", ")} — habilitalos en la pestaña MCP.
              </p>
            )}
          </div>

          <div className="strategy-section">
            <div className="strategy-section-title">Patrones de caso sugeridos</div>
            {cached.strategy.casePatterns.length === 0 ? (
              <p className="strategy-hint">Sin patrones sugeridos para este stack todavía.</p>
            ) : (
              <div className="strategy-patterns">
                {cached.strategy.casePatterns.map((pattern) => (
                  <div key={pattern.id} className="strategy-pattern">
                    <div className="strategy-pattern-label">{pattern.label}</div>
                    <div className="strategy-pattern-desc">{pattern.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

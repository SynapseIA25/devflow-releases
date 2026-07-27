// Panel "ventana en vivo" (header con puntos estilo mac) que previsualiza un artefacto de texto
// (requirements.md/design.md) — reusado tal cual para ambos, dos instancias en SpecsView.
export function SpecArtifactPreview({ title, content, emptyHint }: { title: string; content: string; emptyHint: string }) {
  return (
    <div className="specs-live-panel">
      <div className="specs-winbar">
        <span className="specs-dot specs-dot--r" />
        <span className="specs-dot specs-dot--y" />
        <span className="specs-dot specs-dot--g" />
        <span className="specs-wintitle">{title}</span>
      </div>
      <div className="specs-winbody">
        {content.trim() ? (
          <pre className="specs-artifact-text">{content}</pre>
        ) : (
          <div className="specs-artifact-empty">{emptyHint}</div>
        )}
      </div>
    </div>
  );
}

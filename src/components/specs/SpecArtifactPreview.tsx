import { useState } from "react";
import { Pencil, ExternalLink, Check, X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { CodeEditor } from "../editor/CodeEditor";

// Panel "ventana en vivo" (header con puntos estilo mac) que previsualiza un artefacto de texto
// (requirements.md/design.md) — reusado tal cual para ambos, dos instancias en SpecsView. Editable
// en línea (checkpoint humano real: revisar Y ajustar, no solo regenerar entero) + botón para abrir
// el archivo real en la vista Editor completa (con LSP/guardado) si hace falta algo más a fondo.
export function SpecArtifactPreview({
  title,
  path,
  content,
  emptyHint,
  onSave,
}: {
  title: string;
  path: string;
  content: string;
  emptyHint: string;
  onSave: (text: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="specs-live-panel">
      <div className="specs-winbar">
        <span className="specs-dot specs-dot--r" />
        <span className="specs-dot specs-dot--y" />
        <span className="specs-dot specs-dot--g" />
        <span className="specs-wintitle">{title}</span>
        <div className="specs-winbar-actions">
          {editing ? (
            <>
              <button className="specs-winbar-btn" onClick={() => void save()} disabled={saving} title="Save">
                <Check size={11} />
              </button>
              <button className="specs-winbar-btn" onClick={() => setEditing(false)} disabled={saving} title="Cancel">
                <X size={11} />
              </button>
            </>
          ) : (
            <>
              <button className="specs-winbar-btn" onClick={startEdit} title="Edit">
                <Pencil size={11} />
              </button>
              <button className="specs-winbar-btn" onClick={() => useUiStore.getState().openInEditor(path)} title="Open in editor">
                <ExternalLink size={11} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className={`specs-winbody${editing ? " specs-winbody--editing" : ""}`}>
        {editing ? (
          <CodeEditor path={path} value={draft} onChange={setDraft} onSave={() => void save()} />
        ) : content.trim() ? (
          <pre className="specs-artifact-text">{content}</pre>
        ) : (
          <div className="specs-artifact-empty">{emptyHint}</div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { LayoutTemplate, Save, CheckCircle2, AlertCircle, FolderOpen } from "lucide-react";
import { DesignPalette } from "../components/design/DesignPalette";
import { DesignTree } from "../components/design/DesignTree";
import { DesignPropsInspector } from "../components/design/DesignPropsInspector";
import { DesignPreviewControls } from "../components/design/DesignPreviewControls";
import { useDesignCanvasStore, type DesignMode } from "../store/designCanvasStore";
import { emitComponentFile } from "../lib/designCanvas/serializeJsx";
import { pickFolder, writeTextFile } from "../lib/tauriApi";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";

// Nombre de componente válido: PascalCase, primer char letra. Mismo criterio simple que ya usa
// slugify() en AddModelModal.tsx para nombres de provider, pero acá no se normaliza — se rechaza y se
// le pide al usuario que corrija, porque esto termina siendo el nombre real de una función exportada.
function isValidComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name.trim());
}

// Vista "Design": paleta de componentes + árbol estructural real + inspector de props. El canvas
// edita un MODELO estructural, no píxeles — el preview visual real corre en la ventana de Design Mode
// apuntando al dev server del propio proyecto (ver plan en memoria del proyecto,
// devflow-design-canvas). Modo "componente nuevo" únicamente por ahora; "editar página existente" se
// suma sobre esta misma UI en un paso posterior.
export function DesignView() {
  // v1 es React/TSX únicamente. Si el proyecto ya corrió el Test Strategy Advisor alguna vez (mismo
  // fingerplant cacheado que usa el router de modelos, ver [[devflow-model-router]] Fase 1) y da un
  // framework != react, se degrada con un mensaje claro en vez de dejar operar sobre algo que la
  // paleta/splicer no van a poder interpretar. Sin fingerprint todavía (nunca se corrió el Advisor) no
  // bloquea — deja intentar, el splicer igual se niega con gracia ante JSX que no entiende.
  const activeProject = useProjectStore((s) => s.projects[s.activeId]);
  const uiFramework = activeProject?.testStrategy?.fingerprint?.uiFramework;
  const unsupportedStack = uiFramework !== undefined && uiFramework !== "react";

  const mode = useDesignCanvasStore((s) => s.mode);
  const setMode = useDesignCanvasStore((s) => s.setMode);
  const tree = useDesignCanvasStore((s) => s.tree);
  const filePath = useDesignCanvasStore((s) => s.filePath);
  const unsupportedReason = useDesignCanvasStore((s) => s.unsupportedReason);
  const loadError = useDesignCanvasStore((s) => s.loadError);
  const loadFromExistingFile = useDesignCanvasStore((s) => s.loadFromExistingFile);
  const editorTabs = useEditorStore((s) => s.tabs);
  const [name, setName] = useState("NewComponent");
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState("");
  const [openBlocked, setOpenBlocked] = useState<string | null>(null);

  const switchMode = (m: DesignMode) => { setMode(m); setError(null); setSavedPath(null); setOpenBlocked(null); };

  const openExistingFile = () => {
    setOpenBlocked(null);
    const trimmed = openPath.trim();
    if (!trimmed) return;
    // Un archivo abierto con cambios sin guardar en el editor de Código no se toca: un splice a nivel
    // disco los ignoraría, o un "Guardar" posterior los pisaría a ellos.
    const dirtyTab = editorTabs.find((t) => t.path === trimmed && t.content !== t.savedContent);
    if (dirtyTab) {
      setOpenBlocked("This file has unsaved changes in the Code editor — save or close it there first.");
      return;
    }
    void loadFromExistingFile(trimmed);
  };

  const saveAsNewFile = async () => {
    setError(null);
    setSavedPath(null);
    const trimmed = name.trim();
    if (!isValidComponentName(trimmed)) {
      setError("Component name must be PascalCase (e.g. LoginCard) — it becomes a real exported function name.");
      return;
    }
    setSaving(true);
    try {
      const folder = await pickFolder();
      if (!folder) { setSaving(false); return; } // el usuario canceló el picker
      const path = `${folder}/${trimmed}.tsx`;
      await writeTextFile(path, emitComponentFile(trimmed, tree));
      setSavedPath(path);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  if (unsupportedStack) {
    return (
      <div className="design-view">
        <div className="design-view-header">
          <h2 className="design-view-title"><LayoutTemplate size={16} /> Design</h2>
        </div>
        <div className="design-view-unsupported">
          Design isn't available for this project's stack yet (detected: {uiFramework}) — v1 only
          supports React/TSX projects. Use the Code editor for this project instead.
        </div>
      </div>
    );
  }

  return (
    <div className="design-view">
      <div className="design-view-header">
        <h2 className="design-view-title"><LayoutTemplate size={16} /> Design</h2>
        <p className="design-view-subtitle">
          Drag components onto the tree to build a new one. The visual preview runs in a real browser
          window pointed at your project's dev server — this canvas edits structure, not pixels.
        </p>
        <div className="design-mode-toggle">
          <button className={`design-mode-btn${mode === "new" ? " active" : ""}`} onClick={() => switchMode("new")}>
            New component
          </button>
          <button className={`design-mode-btn${mode === "edit" ? " active" : ""}`} onClick={() => switchMode("edit")}>
            Edit existing page
          </button>
        </div>
        {mode === "new" ? (
          <div className="design-save-row">
            <input
              className="design-save-input"
              value={name}
              onChange={(e) => { setName(e.target.value); setSavedPath(null); setError(null); }}
              placeholder="ComponentName"
            />
            <button className="design-save-btn" disabled={saving} onClick={() => void saveAsNewFile()}>
              <Save size={12} /> {saving ? "Saving…" : "Save as new component…"}
            </button>
            {savedPath && (
              <span className="design-save-status design-save-status--ok"><CheckCircle2 size={12} /> Saved to {savedPath}</span>
            )}
            {error && (
              <span className="design-save-status design-save-status--error"><AlertCircle size={12} /> {error}</span>
            )}
          </div>
        ) : (
          <div className="design-save-row">
            <input
              className="design-save-input"
              value={openPath}
              onChange={(e) => setOpenPath(e.target.value)}
              placeholder="/absolute/path/to/Page.tsx"
              onKeyDown={(e) => { if (e.key === "Enter") openExistingFile(); }}
            />
            <button className="design-save-btn" onClick={openExistingFile}>
              <FolderOpen size={12} /> Open
            </button>
            {filePath && !unsupportedReason && !loadError && (
              <span className="design-save-status design-save-status--ok"><CheckCircle2 size={12} /> Editing {filePath}</span>
            )}
            {unsupportedReason && (
              <span className="design-save-status design-save-status--error">
                <AlertCircle size={12} /> Can't structurally edit this file — {unsupportedReason} Open it in the Code editor instead.
              </span>
            )}
            {(loadError || openBlocked) && (
              <span className="design-save-status design-save-status--error"><AlertCircle size={12} /> {loadError ?? openBlocked}</span>
            )}
          </div>
        )}
        <DesignPreviewControls />
      </div>
      <div className="design-view-body">
        <DesignPalette />
        <DesignTree />
        <DesignPropsInspector />
      </div>
    </div>
  );
}

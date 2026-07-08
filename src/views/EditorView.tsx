import { useMemo } from "react";
import { FileCode, X, Save, RotateCw } from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { CodeEditor } from "../components/editor/CodeEditor";
import { FileExplorer } from "../components/panel/FileExplorer";

// Vista de editor de código autocontenida (estilo VS Code): explorador de archivos propio a la
// izquierda + barra de pestañas + editor CodeMirror. Al clickear un archivo en el explorador se
// abre como pestaña editable (no el preview de solo lectura del panel derecho del chat).
export function EditorView() {
  const activeProjectId = useProjectStore((s) => s.activeId);
  const allTabs = useEditorStore((s) => s.tabs);
  // Solo las pestañas del proyecto activo (scope por proyecto): al cambiar de proyecto se muestran
  // sus propios archivos abiertos, no los del anterior.
  const tabs = useMemo(() => allTabs.filter((t) => t.projectId === activeProjectId), [allTabs, activeProjectId]);
  const activePath = useEditorStore((s) => s.activePathByProject[activeProjectId] ?? null);
  const openFile = useEditorStore((s) => s.openFile);
  const closeTab = useEditorStore((s) => s.closeTab);
  const setActive = useEditorStore((s) => s.setActive);
  const setContent = useEditorStore((s) => s.setContent);
  const save = useEditorStore((s) => s.save);
  const reload = useEditorStore((s) => s.reload);

  const active = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = active ? active.content !== active.savedContent : false;

  return (
    <div className="editor-view">
      <div className="editor-sidebar">
        <FileExplorer onOpenFile={openFile} />
      </div>

      <div className="editor-main">
        {tabs.length > 0 && (
          <div className="editor-tabs">
            {tabs.map((t) => (
              <div
                key={t.path}
                className={`editor-tab${t.path === activePath ? " active" : ""}`}
                onClick={() => setActive(t.path)}
                title={t.path}
              >
                {t.content !== t.savedContent && <span className="editor-tab-dirty" />}
                <span className="editor-tab-name">{t.name}</span>
                <button
                  className="editor-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.path);
                  }}
                  title="Cerrar"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {active ? (
          <>
            <div className="editor-toolbar">
              <span className="editor-path">{active.path}</span>
              <div className="editor-toolbar-actions">
                <button className="editor-tb-btn" onClick={() => reload(active.path)} title="Recargar desde disco">
                  <RotateCw size={12} />
                </button>
                <button
                  className="editor-tb-btn editor-tb-save"
                  onClick={() => save(active.path)}
                  disabled={!dirty}
                  title="Guardar (Ctrl+S)"
                >
                  <Save size={12} />
                  <span>{dirty ? "Guardar" : "Guardado"}</span>
                </button>
              </div>
            </div>
            {active.externalChanged && (
              <div className="editor-conflict">
                <span>⚠ El archivo cambió en disco (afuera del editor) y tenés cambios sin guardar.</span>
                <button onClick={() => reload(active.path)}>Recargar desde disco</button>
              </div>
            )}
            <div className="editor-body">
              {active.error ? (
                <div className="editor-error">No se puede abrir: {active.error}</div>
              ) : active.loading ? (
                <div className="editor-loading">Cargando...</div>
              ) : (
                <CodeEditor
                  key={active.path}
                  path={active.path}
                  value={active.content}
                  onChange={(v) => setContent(active.path, v)}
                  onSave={() => save(active.path)}
                />
              )}
            </div>
          </>
        ) : (
          <div className="editor-empty">
            <FileCode size={40} opacity={0.2} />
            <p>Seleccioná un archivo en el explorador para editarlo.</p>
          </div>
        )}
      </div>
    </div>
  );
}

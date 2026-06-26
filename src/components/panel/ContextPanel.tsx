import { FolderOpen, FileText, Folder, Info, BookOpen, Paperclip, X } from "lucide-react";
import { useContextStore } from "../../store/contextStore";
import { useProjectStore } from "../../store/projectStore";

type ContextPanelProps = {
  task?: string;
  context?: string;
  instructions?: string;
};

const DEFAULT: Required<ContextPanelProps> = {
  task: "Analizar repo actual",
  context: "Proyecto TypeScript con Tauri + React. Stack: Vite, React Flow, Zustand. El agente tiene acceso al sistema de archivos local y puede ejecutar comandos de terminal.",
  instructions: "Leer la estructura del proyecto, identificar patrones y sugerir mejoras de arquitectura.",
};

export function ContextPanel(props: ContextPanelProps) {
  const d = { ...DEFAULT, ...props };
  const items = useContextStore((s) => s.items);
  const removeItem = useContextStore((s) => s.removeItem);
  const projectPath = useProjectStore((s) => s.projectPath);

  return (
    <div className="context-panel">
      <div className="ctx-task">{d.task}</div>

      <div className="ctx-section">
        <div className="ctx-section-title"><Info size={11} /> Contexto</div>
        <p className="ctx-text">{d.context}</p>
      </div>

      <div className="ctx-section">
        <div className="ctx-section-title"><FolderOpen size={11} /> Directorio de trabajo</div>
        <code className="ctx-path">{projectPath}</code>
      </div>

      <div className="ctx-section">
        <div className="ctx-section-title"><BookOpen size={11} /> Instrucciones</div>
        <p className="ctx-text">{d.instructions}</p>
      </div>

      <div className="ctx-section">
        <div className="ctx-section-title"><Paperclip size={11} /> Archivos en contexto ({items.length})</div>
        {items.length === 0 ? (
          <p className="ctx-text ctx-text--muted">Sin archivos agregados. Usá el explorador (pestaña Archivos) para adjuntar archivos o carpetas al agente.</p>
        ) : (
          <div className="ctx-files">
            {items.map((item) => (
              <div key={item.path} className="ctx-file">
                {item.isDir ? <Folder size={10} /> : <FileText size={10} />}
                <span title={item.path}>{item.path.split(/[\\/]/).pop()}</span>
                <button className="ctx-file-remove" onClick={() => removeItem(item.path)} title="Quitar del contexto">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

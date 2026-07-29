import { useEffect, useState } from "react";
import { FolderOpen, FileText, Folder, Info, Paperclip, X } from "lucide-react";
import { useProjectStore } from "../../store/projectStore";
import { detectStackFingerprint, type StackFingerprint } from "../../lib/stackDetect";

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript", javascript: "JavaScript", dart: "Dart", rust: "Rust",
  go: "Go", python: "Python", csharp: "C#", cpp: "C++", c: "C", java: "Java/Kotlin", swift: "Swift",
};

// Reusa el mismo fingerprint que el Test Strategy Advisor (stackDetect.ts) en vez de un texto fijo:
// antes esta descripción era un string hardcodeado (siempre el de mimo-agent, sin importar el
// proyecto activo). "Tarea"/"Instrucciones" (también hardcodeadas antes) se sacaron directamente —
// no había ningún campo en Project que las respaldara, eran decorativas.
function describeStack(fp: StackFingerprint): string {
  if (fp.language === "unknown") {
    return "No se pudo detectar el stack de este proyecto — el agente igual tiene acceso a sus archivos y puede ejecutar comandos de terminal.";
  }
  const lang = LANGUAGE_LABELS[fp.language] ?? fp.language;
  const label = fp.uiFramework ? `${lang} + ${fp.uiFramework}` : lang;
  const testing = fp.existingTestFrameworks.length ? ` · tests: ${fp.existingTestFrameworks.join(", ")}` : "";
  return `Proyecto ${label}${testing} — el agente tiene acceso a los archivos de este proyecto y puede ejecutar comandos de terminal.`;
}

export function ContextPanel() {
  const items = useProjectStore((s) => s.projects[s.activeId]?.contextItems ?? []);
  const removeItem = useProjectStore((s) => s.removeContextItem);
  const projectPath = useProjectStore((s) => s.projectPath);
  const [stackDesc, setStackDesc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStackDesc(null); // limpiar ya: evita mostrar la descripción del proyecto anterior mientras detecta
    detectStackFingerprint(projectPath).then((fp) => {
      if (!cancelled) setStackDesc(describeStack(fp));
    });
    return () => { cancelled = true; };
  }, [projectPath]);

  return (
    <div className="context-panel">
      <div className="ctx-section">
        <div className="ctx-section-title"><Info size={11} /> Contexto</div>
        <p className="ctx-text">{stackDesc ?? "Detectando…"}</p>
      </div>

      <div className="ctx-section">
        <div className="ctx-section-title"><FolderOpen size={11} /> Directorio de trabajo</div>
        <code className="ctx-path">{projectPath}</code>
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

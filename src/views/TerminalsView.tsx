import { useEffect, useMemo, useState } from "react";
import { SquareTerminal, Plus, Trash2, Pencil, Check, FolderOpen } from "lucide-react";
import { useTerminalsStore } from "../store/terminalsStore";
import { useProjectStore } from "../store/projectStore";
import { TerminalPane } from "../components/TerminalPane";
import { pickFolder } from "../lib/tauriApi";

// Panel de terminales independientes a nivel App. Cada terminal es un shell interactivo con su cwd
// propio, desacoplado del chat. Reusa TerminalPane (PTY real). Todas las terminales se montan a la vez
// (display:none las inactivas) para no perder el proceso ni el scrollback al cambiar de una a otra.
export function TerminalsView() {
  const terminals = useTerminalsStore((s) => s.terminals);
  const storedActiveId = useTerminalsStore((s) => s.activeId);
  const addTerminal = useTerminalsStore((s) => s.addTerminal);
  const removeTerminal = useTerminalsStore((s) => s.removeTerminal);
  const renameTerminal = useTerminalsStore((s) => s.renameTerminal);
  const setActive = useTerminalsStore((s) => s.setActive);

  const projectPath = useProjectStore((s) => s.projectPath);
  const projectEnv = useProjectStore((s) => s.projects[s.activeId]?.env ?? {});

  // Active efectivo: si el guardado ya no existe (o es null), cae al primero.
  const activeId = useMemo(
    () => (storedActiveId && terminals.some((t) => t.id === storedActiveId) ? storedActiveId : terminals[0]?.id ?? null),
    [storedActiveId, terminals]
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCwd, setNewCwd] = useState(projectPath);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // Al cambiar de proyecto activo, prellenar el cwd de una terminal nueva con el path del proyecto.
  useEffect(() => { setNewCwd(projectPath); }, [projectPath]);

  const openAdd = () => { setNewName(""); setNewCwd(projectPath); setShowAdd(true); };
  const create = () => {
    const cwd = newCwd.trim() || projectPath;
    addTerminal(cwd, newName);
    setShowAdd(false);
  };
  const pickCwd = async () => { try { const p = await pickFolder(); if (p) setNewCwd(p); } catch { /* cancelado */ } };

  const startRename = (id: string, current: string) => { setRenaming(id); setRenameText(current); };
  const commitRename = () => { if (renaming) renameTerminal(renaming, renameText); setRenaming(null); };

  return (
    <div className="terms-view">
      <div className="terms-sidebar">
        <div className="terms-header">
          <span className="terms-title"><SquareTerminal size={14} /> Terminales</span>
          <button className="terms-add-btn" onClick={openAdd} title="Nueva terminal"><Plus size={14} /></button>
        </div>

        {showAdd && (
          <div className="terms-add-form">
            <input className="terms-input" placeholder="Nombre (opcional)" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setShowAdd(false); }} />
            <div className="terms-cwd-row">
              <input className="terms-input" placeholder="Carpeta (cwd)" value={newCwd} onChange={(e) => setNewCwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setShowAdd(false); }} />
              <button className="terms-icon" title="Elegir carpeta…" onClick={() => void pickCwd()}><FolderOpen size={13} /></button>
            </div>
            <div className="terms-add-actions">
              <button className="terms-btn terms-btn--primary" onClick={create}>Crear</button>
              <button className="terms-btn" onClick={() => setShowAdd(false)}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="terms-list">
          {terminals.length === 0 && !showAdd && (
            <div className="terms-empty">Sin terminales. Creá una con ＋ para tener un shell interactivo con su propio cwd, independiente del chat.</div>
          )}
          {terminals.map((t) => (
            <div key={t.id} className={`terms-row${activeId === t.id ? " selected" : ""}`} onClick={() => setActive(t.id)}>
              <SquareTerminal size={13} className="terms-row-icon" />
              <div className="terms-row-info">
                {renaming === t.id ? (
                  <input className="terms-rename" autoFocus value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={commitRename} />
                ) : (
                  <>
                    <div className="terms-row-name">{t.name}</div>
                    <div className="terms-row-cwd" title={t.cwd}>{t.cwd}</div>
                  </>
                )}
              </div>
              <div className="terms-row-actions">
                <button className="terms-icon" title="Renombrar" onClick={(e) => { e.stopPropagation(); startRename(t.id, t.name); }}><Pencil size={11} /></button>
                <button className="terms-icon terms-icon--del" title="Cerrar terminal" onClick={(e) => { e.stopPropagation(); removeTerminal(t.id); }}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="terms-main">
        {terminals.length === 0 ? (
          <div className="terms-placeholder">
            <SquareTerminal size={34} />
            <div>Terminales independientes<br /><span className="terms-placeholder-sub">Shells interactivos con su propio cwd, desacoplados del chat.</span></div>
            <button className="terms-btn terms-btn--primary" onClick={openAdd}><Plus size={13} /> Nueva terminal</button>
          </div>
        ) : (
          <>
            <div className="terms-detail-bar">
              <Check size={12} color="#3fb950" />
              <span className="terms-detail-name">{terminals.find((t) => t.id === activeId)?.name}</span>
              <code className="terms-detail-cwd">{terminals.find((t) => t.id === activeId)?.cwd}</code>
            </div>
            <div className="terms-panes">
              {terminals.map((t) => (
                <TerminalPane key={t.id} workspaceId={t.id} cwd={t.cwd} env={projectEnv} active={t.id === activeId} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

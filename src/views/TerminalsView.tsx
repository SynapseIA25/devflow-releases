import { useEffect, useMemo, useState } from "react";
import { SquareTerminal, Plus, Trash2, Pencil, Check, FolderOpen, Columns3 } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { TerminalPane } from "../components/TerminalPane";
import { pickFolder } from "../lib/tauriApi";

// Panel de terminales independientes, scopeadas por proyecto (scope duro). Cada terminal es un shell
// interactivo con su cwd propio, desacoplado del chat, y vive DENTRO del proyecto activo: al cambiar de
// proyecto solo se ven las suyas. Reusa TerminalPane (PTY real). Todas las terminales del proyecto se
// montan a la vez (display:none las inactivas) para no perder el proceso ni el scrollback al cambiar.
export function TerminalsView() {
  const activeProjectId = useProjectStore((s) => s.activeId);
  const terminals = useProjectStore((s) => s.projects[s.activeId]?.terminals ?? []);
  const addTerminal = useProjectStore((s) => s.addTerminal);
  const removeTerminal = useProjectStore((s) => s.removeTerminal);
  const renameTerminal = useProjectStore((s) => s.renameTerminal);

  const projectPath = useProjectStore((s) => s.projectPath);
  const projectEnv = useProjectStore((s) => s.projects[s.activeId]?.env ?? {});

  // Selección activa: estado local (como en ServicesView). Se resetea al cambiar de proyecto.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setSelectedId(null); }, [activeProjectId]);
  const setActive = (id: string) => setSelectedId(id);

  // Split view: en vez de una sola terminal activa, mostrar varias a la vez en un grid.
  const [splitMode, setSplitMode] = useState(false);
  const [splitIds, setSplitIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSplitMode(false); setSplitIds(new Set()); }, [activeProjectId]);
  const toggleSplitId = (id: string) => {
    setSplitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Active efectivo: si el seleccionado ya no existe (o es null), cae a la primera del proyecto.
  const activeId = useMemo(
    () => (selectedId && terminals.some((t) => t.id === selectedId) ? selectedId : terminals[0]?.id ?? null),
    [selectedId, terminals]
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
    const id = addTerminal(cwd, newName);
    setSelectedId(id);
    setShowAdd(false);
  };
  const pickCwd = async () => { try { const p = await pickFolder(); if (p) setNewCwd(p); } catch { /* cancelado */ } };

  const startRename = (id: string, current: string) => { setRenaming(id); setRenameText(current); };
  const commitRename = () => { if (renaming) renameTerminal(renaming, renameText); setRenaming(null); };

  return (
    <div className="terms-view">
      <div className="terms-sidebar">
        <div className="terms-header">
          <span className="terms-title"><SquareTerminal size={14} /> Terminals</span>
          <button
            className={`terms-split-btn${splitMode ? " active" : ""}`}
            onClick={() => setSplitMode((v) => !v)}
            disabled={terminals.length < 2}
            title="Show several terminals side by side"
          >
            <Columns3 size={13} />
          </button>
          <button className="terms-add-btn" onClick={openAdd} title="New terminal"><Plus size={14} /></button>
        </div>
        {splitMode && <div className="terms-split-hint">Pick which terminals to show together.</div>}

        {showAdd && (
          <div className="terms-add-form">
            <input className="terms-input" placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setShowAdd(false); }} />
            <div className="terms-cwd-row">
              <input className="terms-input" placeholder="Folder (cwd)" value={newCwd} onChange={(e) => setNewCwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setShowAdd(false); }} />
              <button className="terms-icon" title="Choose folder…" onClick={() => void pickCwd()}><FolderOpen size={13} /></button>
            </div>
            <div className="terms-add-actions">
              <button className="terms-btn terms-btn--primary" onClick={create}>Create</button>
              <button className="terms-btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="terms-list">
          {terminals.length === 0 && !showAdd && (
            <div className="terms-empty">No terminals. Create one with ＋ for an interactive shell with its own cwd, independent of the chat.</div>
          )}
          {terminals.map((t) => (
            <div
              key={t.id}
              className={`terms-row${!splitMode && activeId === t.id ? " selected" : ""}`}
              onClick={() => (splitMode ? toggleSplitId(t.id) : setActive(t.id))}
            >
              {splitMode && (
                <input
                  type="checkbox"
                  className="terms-row-split"
                  checked={splitIds.has(t.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSplitId(t.id)}
                />
              )}
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
                <button className="terms-icon" title="Rename" onClick={(e) => { e.stopPropagation(); startRename(t.id, t.name); }}><Pencil size={11} /></button>
                <button className="terms-icon terms-icon--del" title="Close terminal" onClick={(e) => { e.stopPropagation(); removeTerminal(t.id); }}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="terms-main">
        {terminals.length === 0 ? (
          <div className="terms-placeholder">
            <SquareTerminal size={34} />
            <div>Independent terminals<br /><span className="terms-placeholder-sub">Interactive shells with their own cwd, decoupled from the chat.</span></div>
            <button className="terms-btn terms-btn--primary" onClick={openAdd}><Plus size={13} /> New terminal</button>
          </div>
        ) : (
          <>
            {!splitMode && (
              <div className="terms-detail-bar">
                <Check size={12} color="#3fb950" />
                <span className="terms-detail-name">{terminals.find((t) => t.id === activeId)?.name}</span>
                <code className="terms-detail-cwd">{terminals.find((t) => t.id === activeId)?.cwd}</code>
              </div>
            )}
            <div
              className={splitMode ? "terms-panes terms-panes--split" : "terms-panes"}
              style={splitMode && splitIds.size > 0 ? { gridTemplateColumns: `repeat(${Math.min(splitIds.size, 3)}, 1fr)` } : undefined}
            >
              {terminals.map((t) => (
                <TerminalPane
                  key={t.id}
                  workspaceId={t.id}
                  cwd={t.cwd}
                  env={projectEnv}
                  active={splitMode ? splitIds.has(t.id) : t.id === activeId}
                />
              ))}
            </div>
            {splitMode && splitIds.size === 0 && (
              <div className="terms-split-empty">Check terminals on the left to show them here.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

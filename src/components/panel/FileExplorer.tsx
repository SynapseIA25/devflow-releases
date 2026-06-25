import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react";
import {
  Folder, FolderOpen, FileText, FileCode, File as FileIconBase,
  ChevronRight, ChevronDown, Loader2, X, ArrowUp, FilePlus, FolderPlus,
  BookmarkPlus, BookmarkCheck,
} from "lucide-react";
import { readDir, readTextFile, createDir, writeTextFile, isTauri, type FsEntry } from "../../lib/tauriApi";
import { PROJECT_CWD } from "../../lib/constants";
import { useContextStore } from "../../store/contextStore";

const EXT_COLORS: Record<string, string> = {
  tsx: "#38bdf8", ts: "#38bdf8", js: "#fbbf24", jsx: "#fbbf24",
  rs: "#f97316", css: "#a78bfa", json: "#4ade80", toml: "#f97316",
  md: "#8b949e",
};

function extOf(name: string): string | undefined {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : undefined;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const sep = trimmed.includes("\\") ? "\\" : "/";
  const idx = trimmed.lastIndexOf(sep);
  // Sin separador: ya estamos en la raíz de la unidad ("F:") o en "/" — no hay padre.
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  // "F:" sin barra no es una ruta válida para read_dir — la raíz de la unidad es "F:\\".
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}${sep}`;
  return parent === "" ? sep : parent;
}

function FileIcon({ ext }: { ext?: string }) {
  if (!ext) return <FileIconBase size={13} />;
  if (["tsx", "jsx", "ts", "js", "rs"].includes(ext)) return <FileCode size={13} color={EXT_COLORS[ext]} />;
  return <FileText size={13} color={EXT_COLORS[ext] ?? "#8b949e"} />;
}

function CreateRow({ depth, onSubmit, onCancel }: { depth: number; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    if (/[\\/]/.test(trimmed)) { setError("El nombre no puede contener \\ o /"); return; }
    onSubmit(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="fe-create-row" style={{ paddingLeft: 6 + depth * 12 + 14 }}>
      <input
        ref={ref}
        className="fe-create-input"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={onKeyDown}
        onBlur={() => { if (!name.trim()) onCancel(); }}
        placeholder="nombre..."
      />
      {error && <span className="fe-error fe-error--inline">{error}</span>}
    </div>
  );
}

type TreeNodeProps = {
  entry: FsEntry;
  depth: number;
  selected: string;
  onSelectFile: (path: string) => void;
};

function TreeNode({ entry, depth, selected, onSelectFile }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const busyRef = useRef(false);
  const isSelected = selected === entry.path;
  const contextItems = useContextStore((s) => s.items);
  const addItem = useContextStore((s) => s.addItem);
  const removeItem = useContextStore((s) => s.removeItem);
  const inContext = contextItems.some((i) => i.path === entry.path);

  const ensureChildrenLoaded = useCallback(async (): Promise<FsEntry[]> => {
    if (children !== null) return children;
    setLoading(true);
    setError(null);
    try {
      const list = await readDir(entry.path);
      setChildren(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [entry.path, children]);

  const toggle = useCallback(async () => {
    // Sin este guard, un doble click (gesto natural para "entrar" a una carpeta) dispara
    // dos toggles casi simultáneos: el segundo arranca mientras el primero todavía está
    // esperando el readDir, y los dos setOpen(v => !v) acaban cancelándose entre sí.
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!open) await ensureChildrenLoaded();
      setOpen((v) => !v);
    } finally {
      busyRef.current = false;
    }
  }, [open, ensureChildrenLoaded]);

  const startCreate = async (kind: "file" | "dir", e: React.MouseEvent) => {
    e.stopPropagation();
    await ensureChildrenLoaded();
    setOpen(true);
    setCreating(kind);
  };

  const submitCreate = async (name: string) => {
    if (!creating) return;
    const fullPath = joinPath(entry.path, name);
    const existing = children ?? [];
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`Ya existe "${name}" en esta carpeta`);
      setCreating(null);
      return;
    }
    try {
      if (creating === "file") await writeTextFile(fullPath, "");
      else await createDir(fullPath);
      const refreshed = await readDir(entry.path);
      setChildren(refreshed);
      addItem({ path: fullPath, isDir: creating === "dir" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(null);
    }
  };

  const toggleContext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inContext) removeItem(entry.path);
    else addItem({ path: entry.path, isDir: entry.isDir });
  };

  if (entry.isDir) {
    return (
      <div>
        <div
          className={`fe-row fe-dir${isSelected ? " fe-selected" : ""}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={toggle}
        >
          <span className="fe-chevron">
            {loading ? <Loader2 size={11} className="spin" /> : open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
          {open ? <FolderOpen size={13} color="#fbbf24" /> : <Folder size={13} color="#fbbf24" />}
          <span className="fe-name">{entry.name}</span>
          <span className="fe-actions">
            <button className="fe-action-btn" onClick={(e) => startCreate("file", e)} title="Nuevo archivo aquí"><FilePlus size={11} /></button>
            <button className="fe-action-btn" onClick={(e) => startCreate("dir", e)} title="Nueva carpeta aquí"><FolderPlus size={11} /></button>
            <button className="fe-action-btn" onClick={toggleContext} title={inContext ? "Quitar del contexto" : "Agregar al contexto"}>
              {inContext ? <BookmarkCheck size={11} color="#4ade80" /> : <BookmarkPlus size={11} />}
            </button>
          </span>
        </div>
        {open && error && (
          <div className="fe-error" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>{error}</div>
        )}
        {open && creating && (
          <CreateRow depth={depth + 1} onSubmit={submitCreate} onCancel={() => setCreating(null)} />
        )}
        {open && children?.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} selected={selected} onSelectFile={onSelectFile} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`fe-row fe-file${isSelected ? " fe-selected" : ""}`}
      style={{ paddingLeft: 6 + depth * 12 + 14 }}
      onClick={() => onSelectFile(entry.path)}
    >
      <FileIcon ext={extOf(entry.name)} />
      <span className="fe-name" style={{ color: EXT_COLORS[extOf(entry.name) ?? ""] ?? "var(--text-2)" }}>
        {entry.name}
      </span>
      <span className="fe-actions">
        <button className="fe-action-btn" onClick={toggleContext} title={inContext ? "Quitar del contexto" : "Agregar al contexto"}>
          {inContext ? <BookmarkCheck size={11} color="#4ade80" /> : <BookmarkPlus size={11} />}
        </button>
      </span>
    </div>
  );
}

export function FileExplorer() {
  const [root, setRoot] = useState(PROJECT_CWD);
  const [pathInput, setPathInput] = useState(PROJECT_CWD);
  const [rootEntries, setRootEntries] = useState<FsEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [creatingRoot, setCreatingRoot] = useState<"file" | "dir" | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const addItem = useContextStore((s) => s.addItem);

  const load = useCallback((path: string) => {
    if (!isTauri()) {
      setRootError("Requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
      return;
    }
    readDir(path)
      .then((list) => { setRootEntries(list); setRootError(null); setRoot(path); setPathInput(path); })
      .catch((e) => setRootError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => { load(PROJECT_CWD); }, [load]);

  const navigateUp = () => {
    const parent = parentOf(root);
    if (parent) load(parent);
  };

  const onPathKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") load(pathInput.trim());
    if (e.key === "Escape") setPathInput(root);
  };

  const submitCreateRoot = async (name: string) => {
    if (!creatingRoot) return;
    const fullPath = joinPath(root, name);
    if (rootEntries?.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setRootError(`Ya existe "${name}" en esta carpeta`);
      setCreatingRoot(null);
      return;
    }
    try {
      if (creatingRoot === "file") await writeTextFile(fullPath, "");
      else await createDir(fullPath);
      const refreshed = await readDir(root);
      setRootEntries(refreshed);
      addItem({ path: fullPath, isDir: creatingRoot === "dir" });
    } catch (e) {
      setRootError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingRoot(null);
    }
  };

  const onSelectFile = useCallback(async (path: string) => {
    setSelected(path);
    setPreview("");
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      setPreview(await readTextFile(path, 1, 300));
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  return (
    <div className="file-explorer">
      <div className="fe-toolbar">
        <button className="fe-action-btn" onClick={navigateUp} disabled={!parentOf(root)} title="Subir un nivel">
          <ArrowUp size={12} />
        </button>
        <input
          className="fe-path-input"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={onPathKeyDown}
          onBlur={() => setPathInput(root)}
          title="Escribí una ruta absoluta y presioná Enter para navegar"
        />
        <button className="fe-action-btn" onClick={() => setCreatingRoot("file")} title="Nuevo archivo en la raíz"><FilePlus size={12} /></button>
        <button className="fe-action-btn" onClick={() => setCreatingRoot("dir")} title="Nueva carpeta en la raíz"><FolderPlus size={12} /></button>
      </div>
      <div className="fe-tree">
        {rootError && <div className="fe-error">{rootError}</div>}
        {creatingRoot && <CreateRow depth={0} onSubmit={submitCreateRoot} onCancel={() => setCreatingRoot(null)} />}
        {rootEntries?.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} selected={selected} onSelectFile={onSelectFile} />
        ))}
      </div>
      {selected && (
        <div className="fe-preview">
          <div className="fe-preview-header">
            <span className="fe-preview-name">{selected.split(/[\\/]/).pop()}</span>
            <button className="fe-preview-close" onClick={() => setSelected("")} title="Cerrar preview">
              <X size={12} />
            </button>
          </div>
          <div className="fe-preview-body">
            {previewLoading && <span className="fe-preview-loading">Cargando...</span>}
            {previewError && <span className="fe-error">No se puede previsualizar: {previewError}</span>}
            {!previewLoading && !previewError && <pre className="fe-preview-pre">{preview}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

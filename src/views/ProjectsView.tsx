import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FolderKanban, FolderPlus, Trash2, Pencil, Check, RefreshCw,
  GitBranch, Server, Bot, Workflow as WorkflowIcon, Plus,
  FolderInput, FilePlus2, GitFork, ChevronDown, Loader,
  FileText, Eye, Save, Folder, X, Paperclip, AlertTriangle, Circle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useProjectStore, type DebtItem, type DebtSeverity } from "../store/projectStore";
import { useAgentsStore, isDefaultAgent } from "../store/agentsStore";
import { useWorkflowStore } from "../store/workflowStore";
import { useUiStore } from "../store/uiStore";
import { FileExplorer } from "../components/panel/FileExplorer";
import { CodeEditor } from "../components/editor/CodeEditor";
import { ServicesView } from "./ServicesView";
import { AgentDetail, NewAgentForm } from "./AgentsView";
import { pickFolder, runShellCommand, createDir, writeTextFile, readDir, readTextFile, isTauri } from "../lib/tauriApi";

// Vista de Administración de Proyectos = "Project Hub" (Frente 4 + pilar 2 del roadmap). El Proyecto
// es el contenedor de todo lo que es "por proyecto": carpeta raíz, ambiente (env → servicios/terminales),
// git, tracking, y las asociaciones de agentes/workflows/servicios (scope duro). Cambiar el proyecto
// activo re-rootea el chat, terminal, file explorer, motor de workflows, etc. El panel del proyecto se
// organiza en TABS (Tanda A: Overview + config en Ajustes + crear en 3 formas; el resto llega por tandas).

const TABS = [
  { id: "overview",   label: "Overview" },
  { id: "estructura", label: "Structure" },
  { id: "docs",       label: "Documentation" },
  { id: "contexto",   label: "Context" },
  { id: "agentes",    label: "Agents" },
  { id: "flujos",     label: "Flows" },
  { id: "servicios",  label: "Services" },
  { id: "ajustes",    label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Une un directorio con un nombre infiriendo el separador del padre (no asume Windows).
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

// Nombre de repo desde una URL de git (último segmento sin .git).
function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/:]/);
  return parts[parts.length - 1] || "repo";
}

export function ProjectsView() {
  const projects = useProjectStore((s) => s.projects);
  const order = useProjectStore((s) => s.order);
  const activeId = useProjectStore((s) => s.activeId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const renameProject = useProjectStore((s) => s.renameProject);

  const active = projects[activeId];
  const [tab, setTab] = useState<TabId>("overview");

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const startRename = (id: string, current: string) => { setRenaming(id); setRenameText(current); };
  const commitRename = () => {
    if (renaming) renameProject(renaming, renameText);
    setRenaming(null);
  };

  return (
    <div className="proj-view">
      <div className="proj-sidebar">
        <div className="proj-side-header">
          <span className="proj-side-title"><FolderKanban size={14} /> Projects</span>
          <CreateProjectMenu onCreated={(path, name) => { createProject(path, name); setTab("overview"); }} />
        </div>
        <div className="proj-list">
          {order.map((id) => {
            const p = projects[id];
            if (!p) return null;
            return (
              <div
                key={id}
                className={`proj-row${id === activeId ? " active" : ""}`}
                onClick={() => setActiveProject(id)}
              >
                <span className={`proj-dot${id === activeId ? " on" : ""}`} />
                <div className="proj-row-info">
                  {renaming === id ? (
                    <input
                      className="proj-rename-input"
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <>
                      <div className="proj-row-name">{p.name}</div>
                      <div className="proj-row-path" title={p.path}>{p.path}</div>
                    </>
                  )}
                </div>
                <div className="proj-row-actions">
                  <button className="proj-icon" title="Rename" onClick={(e) => { e.stopPropagation(); startRename(id, p.name); }}>
                    <Pencil size={12} />
                  </button>
                  <button
                    className="proj-icon proj-icon--del"
                    title={order.length <= 1 ? "Can't delete the only project" : "Delete project"}
                    disabled={order.length <= 1}
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete project "${p.name}"? (doesn't delete the folder on disk)`)) deleteProject(id); }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="proj-main">
        {!active ? (
          <div className="proj-empty">Select or create a project.</div>
        ) : (
          <>
            <div className="proj-tabbar">
              {TABS.map((t) => (
                <button key={t.id} className={`proj-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="proj-tab-content">
              <ProjectTab key={active.id} projectId={active.id} tab={tab} onDeleted={() => {}} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Menú de creación (3 formas: existente / nuevo scaffold / clonar) ──
function CreateProjectMenu({ onCreated }: { onCreated: (path: string, name?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "scaffold" | "clone">(null);

  const pickExisting = async () => {
    setOpen(false);
    try { const p = await pickFolder(); if (p) onCreated(p); } catch { /* cancelado */ }
  };

  return (
    <div className="proj-create-wrap">
      <button className="proj-add-btn" onClick={() => setOpen((v) => !v)} title="Create project">
        <FolderPlus size={15} /><ChevronDown size={11} />
      </button>
      {open && (
        <div className="proj-create-menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={pickExisting}><FolderInput size={13} /> Existing folder…</button>
          <button onClick={() => { setOpen(false); setModal("scaffold"); }}><FilePlus2 size={13} /> New project…</button>
          <button onClick={() => { setOpen(false); setModal("clone"); }}><GitFork size={13} /> Clone from git…</button>
        </div>
      )}
      {modal === "scaffold" && <ScaffoldModal onClose={() => setModal(null)} onCreated={(p, n) => { setModal(null); onCreated(p, n); }} />}
      {modal === "clone" && <CloneModal onClose={() => setModal(null)} onCreated={(p, n) => { setModal(null); onCreated(p, n); }} />}
    </div>
  );
}

function ScaffoldModal({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string, name: string) => void }) {
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [gitInit, setGitInit] = useState(true);
  const [readme, setReadme] = useState(true);
  const [gitignore, setGitignore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickParent = async () => { try { const p = await pickFolder(); if (p) setParent(p); } catch { /* */ } };

  const create = async () => {
    const nm = name.trim();
    if (!parent || !nm) { setError("Choose a parent folder and name."); return; }
    setBusy(true); setError("");
    try {
      const path = joinPath(parent, nm);
      await createDir(path);
      if (readme) await writeTextFile(joinPath(path, "README.md"), `# ${nm}\n`);
      if (gitignore) await writeTextFile(joinPath(path, ".gitignore"), "node_modules/\ndist/\nbuild/\n.env\n");
      if (gitInit) await runShellCommand("git init", path);
      onCreated(path, nm);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="New project" onClose={onClose}>
      <label className="proj-modal-label">Parent folder</label>
      <div className="proj-modal-pick">
        <input className="proj-modal-input" placeholder="Choose where to create the folder…" value={parent} readOnly />
        <button className="proj-btn" onClick={pickParent}>Choose…</button>
      </div>
      <label className="proj-modal-label">Project name</label>
      <input className="proj-modal-input" placeholder="my-project" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {parent && name.trim() && <div className="proj-modal-hint">Will create: <code>{joinPath(parent, name.trim())}</code></div>}
      <div className="proj-modal-checks">
        <label><input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} /> git init</label>
        <label><input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> README.md</label>
        <label><input type="checkbox" checked={gitignore} onChange={(e) => setGitignore(e.target.checked)} /> .gitignore</label>
      </div>
      {error && <div className="proj-modal-error">{error}</div>}
      <div className="proj-modal-actions">
        <button className="proj-btn proj-btn--primary" onClick={create} disabled={busy || !parent || !name.trim()}>
          {busy ? <Loader size={13} className="spin" /> : null} Create
        </button>
        <button className="proj-btn" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </ModalShell>
  );
}

function CloneModal({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string, name: string) => void }) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickParent = async () => { try { const p = await pickFolder(); if (p) setParent(p); } catch { /* */ } };
  const name = url ? repoNameFromUrl(url) : "";

  const clone = async () => {
    if (!url.trim() || !parent) { setError("Enter the repo URL and choose a destination folder."); return; }
    setBusy(true); setError("");
    try {
      const res = await runShellCommand(`git clone ${url.trim()}`, parent);
      if (res.exitCode !== 0) { setError(`git clone failed (exit ${res.exitCode}):\n${res.output.slice(-400)}`); setBusy(false); return; }
      onCreated(joinPath(parent, name), name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Clone from git" onClose={onClose}>
      <label className="proj-modal-label">Repository URL</label>
      <input className="proj-modal-input" placeholder="https://github.com/owner/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
      <label className="proj-modal-label">Destination folder (parent)</label>
      <div className="proj-modal-pick">
        <input className="proj-modal-input" placeholder="Where to clone…" value={parent} readOnly />
        <button className="proj-btn" onClick={pickParent}>Choose…</button>
      </div>
      {parent && name && <div className="proj-modal-hint">Will clone into: <code>{joinPath(parent, name)}</code></div>}
      {busy && <div className="proj-modal-hint">Cloning… (may take a while depending on repo size)</div>}
      {error && <div className="proj-modal-error">{error}</div>}
      <div className="proj-modal-actions">
        <button className="proj-btn proj-btn--primary" onClick={clone} disabled={busy || !url.trim() || !parent}>
          {busy ? <Loader size={13} className="spin" /> : null} Clone
        </button>
        <button className="proj-btn" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="proj-modal-overlay" onClick={onClose}>
      <div className="proj-modal" onClick={(e) => e.stopPropagation()}>
        <div className="proj-modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ── Contenido del tab activo ──
function ProjectTab({ projectId, tab }: { projectId: string; tab: TabId; onDeleted: () => void }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const setEnvVar = useProjectStore((s) => s.setEnvVar);
  const removeEnvVar = useProjectStore((s) => s.removeEnvVar);
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const order = useProjectStore((s) => s.order);

  if (!project) return null;

  switch (tab) {
    case "overview":
      return <OverviewTab projectId={projectId} />;
    case "estructura":
      return <EstructuraTab />;
    case "docs":
      return <DocsTab projectId={projectId} />;
    case "contexto":
      return <ContextoTab projectId={projectId} />;
    case "agentes":
      return <AgentesTab projectId={projectId} />;
    case "flujos":
      return <FlujosTab projectId={projectId} />;
    case "servicios":
      return <div className="proj-services-embed"><ServicesView /></div>;
    case "ajustes":
      return (
        <div className="proj-config">
          <EnvSection env={project.env} setEnvVar={setEnvVar} removeEnvVar={removeEnvVar} />
          <GitSection projectId={projectId} path={project.path} enabled={project.git?.enabled ?? false} updateProject={updateProject} />
          <TrackingSection projectId={projectId} tracking={project.tracking} updateProject={updateProject} />
          <DangerZone
            projectId={projectId}
            name={project.name}
            canDelete={order.length > 1}
            renameProject={renameProject}
            deleteProject={deleteProject}
          />
        </div>
      );
  }
}

// ── Estructura: árbol de archivos del proyecto (reusa el File Explorer) ──
// El File Explorer ya sigue a projectPath (= proyecto activo), así que muestra el árbol correcto.
// Clic en un archivo lo abre como pestaña editable del editor (integración IDE, igual que el mapa).
function EstructuraTab() {
  const openInEditor = useUiStore((s) => s.openInEditor);
  return (
    <div className="proj-estructura">
      <FileExplorer onOpenFile={openInEditor} />
    </div>
  );
}

// Recorrido BFS del proyecto juntando archivos .md (read_dir ya omite node_modules/target/.git/dist/etc.).
// Carpetas que nunca tienen documentación relevante y pueden tener miles de archivos (node_modules
// trae un README.md por paquete) — sin esto, el BFS agota el límite con ruido antes de llegar a la
// documentación real del proyecto. .devflow SÍ se recorre a propósito: ahí viven la memoria
// (.devflow/memory/*.md) y las specs (.devflow/specs/**/*.md), que son justamente "documentación del
// proyecto" para este tab.
const MARKDOWN_SCAN_SKIP = new Set(["node_modules", ".git", "target", "dist", "build", ".venv", "__pycache__"]);

async function collectMarkdownFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try { entries = await readDir(dir); } catch { continue; }
    for (const e of entries) {
      if (e.isDir) {
        if (!MARKDOWN_SCAN_SKIP.has(e.name)) queue.push(e.path);
      } else if (e.name.toLowerCase().endsWith(".md")) {
        out.push(e.path);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

// ── Documentación: ver/editar los .md del proyecto con render markdown ──
function DocsTab({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const path = project?.path;

  const [files, setFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [newDocName, setNewDocName] = useState("");
  const [creating, setCreating] = useState(false);

  const scan = useCallback(async () => {
    if (!path || !isTauri()) { setFiles([]); return; }
    setScanning(true); setScanError(null);
    try {
      setFiles(await collectMarkdownFiles(path, 200));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [path]);

  useEffect(() => { void scan(); }, [scan]);

  const rel = (p: string) => (path && p.startsWith(path) ? p.slice(path.length).replace(/^[\\/]+/, "") : p);

  const open = async (p: string) => {
    setSelected(p); setMode("view"); setLoading(true); setFileError(null);
    try {
      const text = await readTextFile(p);
      setContent(text); setSaved(text);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true); setFileError(null);
    try {
      await writeTextFile(selected, content);
      setSaved(content);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== saved;

  // Crea un .md nuevo (subcarpetas permitidas, ej. "docs/architecture.md" o
  // ".devflow/memory/my-note.md") y lo abre en modo edición. Precarga un título derivado del nombre
  // en vez de dejarlo vacío — un documento nuevo sin nada adentro es más difícil de arrancar.
  const createDoc = async () => {
    if (!path || !newDocName.trim()) return;
    setCreating(true); setFileError(null);
    try {
      const cleaned = newDocName.trim().replace(/^[\\/]+/, "");
      const withExt = cleaned.toLowerCase().endsWith(".md") ? cleaned : `${cleaned}.md`;
      const segments = withExt.split(/[\\/]/).filter(Boolean);
      const fileName = segments.pop()!;
      const dirPart = segments.length ? `${path}/${segments.join("/")}` : path;
      const full = `${dirPart}/${fileName}`;
      const title = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
      await createDir(dirPart);
      await writeTextFile(full, `# ${title}\n\n`);
      setNewDocName("");
      await scan();
      await open(full);
      setMode("edit");
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (!isTauri()) {
    return <div className="proj-placeholder"><span className="proj-placeholder-icon">🖥️</span><div>Documentation requires the desktop app.</div></div>;
  }

  return (
    <div className="proj-docs">
      <div className="proj-docs-list">
        <div className="proj-docs-list-head">
          <span>{scanning ? "scanning…" : `${files.length} doc(s)`}</span>
          <button className="proj-icon" onClick={() => void scan()} disabled={scanning} title="Rescan">
            <RefreshCw size={12} className={scanning ? "spin" : ""} />
          </button>
        </div>
        <div className="proj-docs-new">
          <input
            className="proj-docs-new-input"
            placeholder="new-doc.md or docs/notes.md…"
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createDoc()}
          />
          <button className="proj-icon" onClick={() => void createDoc()} disabled={creating || !newDocName.trim()} title="Create document">
            {creating ? <Loader size={12} className="spin" /> : <FilePlus2 size={12} />}
          </button>
        </div>
        {scanError && <div className="proj-modal-error">{scanError}</div>}
        {!scanning && files.length === 0 && <div className="proj-hint proj-docs-none">No .md files in the project.</div>}
        {files.map((f) => (
          <button key={f} className={`proj-docs-item${selected === f ? " active" : ""}`} onClick={() => void open(f)} title={f}>
            <FileText size={12} /><span className="proj-docs-item-name">{rel(f)}</span>
          </button>
        ))}
      </div>

      <div className="proj-docs-main">
        {!selected ? (
          <div className="proj-docs-empty">Pick a document on the left to view or edit.</div>
        ) : (
          <>
            <div className="proj-docs-toolbar">
              <span className="proj-docs-name">{rel(selected)}{dirty ? " ●" : ""}</span>
              <div className="proj-docs-actions">
                <button className={`proj-btn${mode === "view" ? " proj-btn--primary" : ""}`} onClick={() => setMode("view")}><Eye size={13} /> View</button>
                <button className={`proj-btn${mode === "edit" ? " proj-btn--primary" : ""}`} onClick={() => setMode("edit")}><Pencil size={13} /> Edit</button>
                {mode === "edit" && (
                  <>
                    <button className="proj-btn proj-btn--primary" onClick={() => void save()} disabled={!dirty || saving}>
                      {saving ? <Loader size={13} className="spin" /> : <Save size={13} />} Save
                    </button>
                    <button className="proj-btn" onClick={() => setContent(saved)} disabled={!dirty}>Discard</button>
                  </>
                )}
              </div>
            </div>
            {fileError && <div className="proj-modal-error">{fileError}</div>}
            <div className="proj-docs-body">
              {loading ? (
                <span className="proj-hint"><Loader size={12} className="spin" /> Loading…</span>
              ) : mode === "view" ? (
                <div className="proj-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
              ) : (
                <CodeEditor path={selected} value={content} onChange={setContent} onSave={() => void save()} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Overview (stack detectado + contadores) ──
function OverviewTab({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const [stack, setStack] = useState<string[]>([]);
  const [docsCount, setDocsCount] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);

  const path = project?.path;
  useEffect(() => {
    if (!path || !isTauri()) { setStack([]); setDocsCount(null); return; }
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        const entries = await readDir(path);
        const names = new Set(entries.map((e) => e.name));
        const tags: string[] = [];
        if (names.has("package.json")) {
          tags.push("Node.js");
          try {
            const pkg = JSON.parse(await readTextFile(joinPath(path, "package.json"))) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.react) tags.push("React");
            if (deps.vue) tags.push("Vue");
            if (deps.svelte) tags.push("Svelte");
            if (deps.next) tags.push("Next.js");
            if (deps.express) tags.push("Express");
            if (deps["@tauri-apps/api"] || names.has("src-tauri")) tags.push("Tauri");
            if (deps.typescript || names.has("tsconfig.json")) tags.push("TypeScript");
          } catch { /* package.json ilegible */ }
        }
        if (names.has("Cargo.toml")) tags.push("Rust");
        if (names.has("requirements.txt") || names.has("pyproject.toml") || names.has("setup.py")) tags.push("Python");
        if (names.has("go.mod")) tags.push("Go");
        if (names.has("composer.json")) tags.push("PHP");
        if (names.has("Gemfile")) tags.push("Ruby");
        if (names.has("pom.xml") || names.has("build.gradle")) tags.push("Java");
        if (names.has("Dockerfile") || names.has("docker-compose.yml")) tags.push("Docker");
        const docs = entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith(".md")).length;
        if (!cancelled) { setStack([...new Set(tags)]); setDocsCount(docs); }
      } catch {
        if (!cancelled) { setStack([]); setDocsCount(null); }
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (!project) return null;

  return (
    <div className="proj-config">
      <div className="proj-config-header">
        <h2 className="proj-config-name">{project.name}</h2>
        <code className="proj-config-path">{project.path}</code>
      </div>

      <section className="proj-section">
        <div className="proj-section-title">🧱 Detected stack</div>
        <div className="proj-section-body">
          {detecting ? (
            <span className="proj-hint"><Loader size={12} className="spin" /> Detecting…</span>
          ) : stack.length > 0 ? (
            <div className="proj-stack">{stack.map((s) => <span key={s} className="proj-stack-tag">{s}</span>)}</div>
          ) : (
            <span className="proj-hint">{isTauri() ? "No known stack detected at the root." : "Requires the desktop app."}</span>
          )}
        </div>
      </section>

      <div className="proj-counters">
        <Counter icon={<Server size={16} />} label="Services" value={project.services.length} />
        <Counter icon={<Bot size={16} />} label="Agents" value={project.agentIds.length} />
        <Counter icon={<WorkflowIcon size={16} />} label="Flows" value={project.workflowIds.length} />
        <Counter icon={<AlertTriangle size={16} />} label="Open debt" value={project.debt.filter((d) => d.status === "open").length} />
        <Counter icon={<FilePlus2 size={16} />} label="Docs (.md)" value={docsCount ?? "—"} />
      </div>

      <DebtSection projectId={projectId} />
    </div>
  );
}

// ── Tablero de deuda técnica (Tanda D) ──
// Registro por proyecto: alta manual (título + severidad) o en lote pegando hallazgos de un /code-review
// (uno por línea). Cada item se resuelve (toggle), se asigna a un agente experto, o se borra.
const SEV_META: Record<DebtSeverity, { label: string; color: string }> = {
  high: { label: "High", color: "#f85149" },
  medium: { label: "Medium", color: "#d29922" },
  low: { label: "Low", color: "#3fb950" },
};

function DebtSection({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const addDebt = useProjectStore((s) => s.addDebt);
  const addDebtBulk = useProjectStore((s) => s.addDebtBulk);
  const updateDebt = useProjectStore((s) => s.updateDebt);
  const removeDebt = useProjectStore((s) => s.removeDebt);
  const agents = useAgentsStore((s) => s.agents);

  const [title, setTitle] = useState("");
  const [sev, setSev] = useState<DebtSeverity>("medium");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  if (!project) return null;
  const debt = project.debt;
  const open = debt.filter((d) => d.status === "open");
  const resolved = debt.filter((d) => d.status === "resolved");
  const shown = showResolved ? debt : open;

  const add = () => {
    if (!title.trim()) return;
    addDebt(title, sev);
    setTitle("");
  };
  const importBulk = () => {
    const lines = bulkText.split("\n");
    if (lines.some((l) => l.trim())) addDebtBulk(lines, sev);
    setBulkText(""); setBulkOpen(false);
  };

  return (
    <section className="proj-section">
      <div className="proj-section-title">
        <AlertTriangle size={14} /> Tech debt ({open.length} open)
      </div>
      <div className="proj-section-body">
        <p className="proj-hint">
          Project debt log. Add items by hand or paste the findings from a <code>/code-review</code>
          (one per line) with “Import”. Assign them to an expert agent to resolve them.
        </p>

        <div className="proj-debt-add">
          <input
            className="proj-debt-input"
            placeholder="New debt (e.g. Missing auth test)…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <select className="proj-select" value={sev} onChange={(e) => setSev(e.target.value as DebtSeverity)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="proj-icon proj-icon--add" title="Add" onClick={add} disabled={!title.trim()}><Plus size={13} /></button>
          <button className="proj-btn" onClick={() => setBulkOpen((v) => !v)}>Import…</button>
        </div>

        {bulkOpen && (
          <div className="proj-debt-bulk">
            <textarea
              className="proj-debt-bulk-input"
              placeholder={"Paste /code-review findings, one per line…"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={5}
            />
            <div className="proj-debt-bulk-actions">
              <button className="proj-btn proj-btn--primary" onClick={importBulk} disabled={!bulkText.trim()}>Import as “{SEV_META[sev].label}”</button>
              <button className="proj-btn" onClick={() => { setBulkOpen(false); setBulkText(""); }}>Cancel</button>
            </div>
          </div>
        )}

        {debt.length === 0 ? (
          <div className="proj-env-empty">No debt recorded. 🎉</div>
        ) : (
          <>
            <div className="proj-debt-list">
              {shown.map((d) => (
                <DebtRow key={d.id} item={d} agents={agents} updateDebt={updateDebt} removeDebt={removeDebt} />
              ))}
            </div>
            {resolved.length > 0 && (
              <button className="proj-debt-toggle" onClick={() => setShowResolved((v) => !v)}>
                {showResolved ? "Hide resolved" : `Show ${resolved.length} resolved`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DebtRow({ item, agents, updateDebt, removeDebt }: {
  item: DebtItem;
  agents: ReturnType<typeof useAgentsStore.getState>["agents"];
  updateDebt: ReturnType<typeof useProjectStore.getState>["updateDebt"];
  removeDebt: ReturnType<typeof useProjectStore.getState>["removeDebt"];
}) {
  const sev = SEV_META[item.severity];
  const resolved = item.status === "resolved";
  return (
    <div className={`proj-debt-item${resolved ? " resolved" : ""}`}>
      <button
        className="proj-debt-check"
        title={resolved ? "Reopen" : "Mark resolved"}
        onClick={() => updateDebt(item.id, { status: resolved ? "open" : "resolved" })}
      >
        {resolved ? <Check size={13} color="#3fb950" /> : <Circle size={13} />}
      </button>
      <span className="proj-debt-sev" style={{ background: `${sev.color}22`, color: sev.color }}>{sev.label}</span>
      <span className="proj-debt-title">{item.title}</span>
      <select
        className="proj-debt-assign"
        value={item.agentId ?? ""}
        title="Assign to an expert agent"
        onChange={(e) => updateDebt(item.id, { agentId: e.target.value || undefined })}
      >
        <option value="">Unassigned</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button className="proj-icon proj-icon--del" title="Remove" onClick={() => removeDebt(item.id)}><X size={12} /></button>
    </div>
  );
}

function Counter({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div className="proj-counter">
      <div className="proj-counter-icon">{icon}</div>
      <div className="proj-counter-num">{value}</div>
      <div className="proj-counter-label">{label}</div>
    </div>
  );
}

// ── Contexto: archivos/carpetas de contexto del proyecto (Tanda C, scopeados por proyecto) ──
// La lista se alimenta desde el File Explorer (botón bookmark) o la tab Estructura; acá se ve/gestiona.
// ChatView antepone estos archivos al prompt del agente (buildPromptWithContext).
function ContextoTab({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const removeContextItem = useProjectStore((s) => s.removeContextItem);
  const clearContext = useProjectStore((s) => s.clearContext);
  if (!project) return null;
  const items = project.contextItems;
  const baseNameOf = (p: string) => p.split(/[\\/]/).pop() || p;

  return (
    <div className="proj-config">
      <section className="proj-section">
        <div className="proj-section-title"><Paperclip size={14} /> Files in context ({items.length})</div>
        <div className="proj-section-body">
          <p className="proj-hint">
            Files and folders the agent receives with every message in this project. Add them from the
            <strong> Structure</strong> tab (or the chat explorer) with the bookmark button. Context is
            per project: switching projects, the chat only sees its own.
          </p>
          {items.length === 0 ? (
            <div className="proj-env-empty">No files in context.</div>
          ) : (
            <div className="proj-ctx-list">
              {items.map((item) => (
                <div key={item.path} className="proj-ctx-item">
                  {item.isDir ? <Folder size={13} color="#fbbf24" /> : <FileText size={13} color="#8b949e" />}
                  <span className="proj-ctx-name">{baseNameOf(item.path)}</span>
                  <span className="proj-ctx-path" title={item.path}>{item.path}</span>
                  <button className="proj-icon proj-icon--del" title="Remove from context" onClick={() => removeContextItem(item.path)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <button className="proj-btn" onClick={clearContext}><Trash2 size={13} /> Clear context</button>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Agentes: CRUD completo de expertos (reusa el editor de AgentsView) + asociación al proyecto ──
function AgentesTab({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const updateProject = useProjectStore((s) => s.updateProject);
  const agents = useAgentsStore((s) => s.agents);
  const [selected, setSelected] = useState<string>(agents[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  if (!project) return null;

  const selectedAgent = agents.find((a) => a.id === selected) ?? agents[0];
  const toggleAssoc = (id: string, checked: boolean) => {
    const next = checked ? [...project.agentIds, id] : project.agentIds.filter((x) => x !== id);
    updateProject(projectId, { agentIds: next });
  };

  return (
    <div className="proj-agents">
      <div className="proj-agents-list">
        <div className="proj-agents-list-head">
          <span>Agents ({agents.length})</span>
          <button className="proj-icon" title="New custom agent" onClick={() => setCreating(true)}><Plus size={13} /></button>
        </div>
        {agents.map((a) => {
          const isGlobal = isDefaultAgent(a.id);
          // Los globales están siempre disponibles en el chat (checkbox marcado y bloqueado); los custom
          // se asocian/desasocian del proyecto.
          const checked = isGlobal || project.agentIds.includes(a.id);
          return (
            <div
              key={a.id}
              className={`proj-agent-row${!creating && selected === a.id ? " active" : ""}`}
              onClick={() => { setCreating(false); setSelected(a.id); }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isGlobal}
                title={isGlobal ? "Global agent (always available in the chat)" : "Associate with the project"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleAssoc(a.id, e.target.checked)}
              />
              <span className="proj-agent-icon" style={{ color: a.color }}>{a.icon}</span>
              <span className="proj-agent-name">{a.name}</span>
              {isGlobal && <span className="proj-badge">global</span>}
            </div>
          );
        })}
      </div>
      <div className="proj-agents-detail">
        {creating ? (
          <NewAgentForm
            onClose={() => setCreating(false)}
            onCreated={(id) => { updateProject(projectId, { agentIds: [...project.agentIds, id] }); setSelected(id); }}
          />
        ) : (
          selectedAgent && <AgentDetail agent={selectedAgent} />
        )}
      </div>
    </div>
  );
}

// ── Flujos: asociar + crear + editar workflows del proyecto (Tanda D) ──
// Reusa el workflowStore (múltiples flujos nombrados) y navega a la vista Workflows para editarlos en
// el canvas de React Flow. La asociación (project.workflowIds) determina qué flujos son "del proyecto".
function FlujosTab({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const updateProject = useProjectStore((s) => s.updateProject);
  const workflows = useWorkflowStore((s) => s.workflows);
  const workflowOrder = useWorkflowStore((s) => s.order);
  const createWorkflow = useWorkflowStore((s) => s.createWorkflow);
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);
  const setView = useUiStore((s) => s.setView);
  if (!project) return null;

  const editFlow = (id: string) => { setActiveWorkflow(id); setView("workflow"); };
  const newFlow = () => {
    const id = createWorkflow(`${project.name} flow`);
    updateProject(projectId, { workflowIds: [...project.workflowIds, id] });
    setView("workflow"); // createWorkflow ya lo deja activo
  };

  return (
    <div className="proj-config">
      <section className="proj-section">
        <div className="proj-section-title"><WorkflowIcon size={14} /> Workflows</div>
        <div className="proj-section-body">
          <p className="proj-hint">
            Flows associated with this project (checkbox). Edit them on the canvas with ✎ or create a new
            one already associated. Flows run from the Workflows view or with <code>/run</code> in the chat.
          </p>
          {workflowOrder.map((id) => {
            const w = workflows[id];
            if (!w) return null;
            const checked = project.workflowIds.includes(id);
            return (
              <div key={id} className="proj-flow-row">
                <label className="proj-flow-assoc">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked ? [...project.workflowIds, id] : project.workflowIds.filter((x) => x !== id);
                      updateProject(projectId, { workflowIds: next });
                    }}
                  />
                  <span className="proj-check-name">{w.name}</span>
                  <span className="proj-flow-count">{w.nodes.length} node(s)</span>
                </label>
                <button className="proj-icon" title="Edit on the canvas" onClick={() => editFlow(id)}><Pencil size={12} /></button>
              </div>
            );
          })}
          <button className="proj-btn" onClick={newFlow}><Plus size={13} /> New flow</button>
        </div>
      </section>
    </div>
  );
}

// ── Ajustes: Ambiente / Git / Tracking / Danger zone ──
type UpdateProjectFn = ReturnType<typeof useProjectStore.getState>["updateProject"];

function EnvSection({ env, setEnvVar, removeEnvVar }: { env: Record<string, string>; setEnvVar: (k: string, v: string) => void; removeEnvVar: (k: string) => void }) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = useMemo(() => Object.entries(env), [env]);

  const add = () => {
    const k = newKey.trim();
    if (!k) return;
    setEnvVar(k, newVal);
    setNewKey(""); setNewVal("");
  };

  return (
    <section className="proj-section">
      <div className="proj-section-title">⚙ Environment (env vars)</div>
      <div className="proj-section-body">
        <p className="proj-hint">Injected into the project's services and terminals.</p>
        {entries.length === 0 && <div className="proj-env-empty">No environment variables.</div>}
        {entries.map(([k, v]) => (
          <div key={k} className="proj-env-row">
            <input className="proj-env-key" value={k} readOnly />
            <span className="proj-env-eq">=</span>
            <input className="proj-env-val" value={v} onChange={(e) => setEnvVar(k, e.target.value)} />
            <button className="proj-icon proj-icon--del" title="Remove" onClick={() => removeEnvVar(k)}><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="proj-env-row proj-env-new">
          <input className="proj-env-key" placeholder="KEY" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <span className="proj-env-eq">=</span>
          <input className="proj-env-val" placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="proj-icon proj-icon--add" title="Add" onClick={add} disabled={!newKey.trim()}><Plus size={12} /></button>
        </div>
      </div>
    </section>
  );
}

function GitSection({ projectId, path, enabled, updateProject }: { projectId: string; path: string; enabled: boolean; updateProject: UpdateProjectFn }) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const refresh = useMemo(() => async () => {
    if (!isTauri()) { setStatus("(requires the desktop app)"); return; }
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const res = await runShellCommand("git rev-parse --abbrev-ref HEAD && echo '===GITSPLIT===' && git status --short", path);
      if (req !== reqRef.current) return;
      setStatus(res.exitCode === 0 ? res.output.trim() : "Not a git repository.");
    } catch (e) {
      if (req === reqRef.current) setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { if (enabled) void refresh(); else setStatus(""); }, [enabled, refresh]);

  const [branchRaw, changesRaw = ""] = status.split(/\s*===GITSPLIT===\s*/);
  const branch = branchRaw.trim();
  const changes = changesRaw.trim();

  return (
    <section className="proj-section">
      <div className="proj-section-title"><GitBranch size={14} /> Git</div>
      <div className="proj-section-body">
        <label className="proj-check-row">
          <input type="checkbox" checked={enabled} onChange={(e) => updateProject(projectId, { git: { enabled: e.target.checked } })} />
          <span className="proj-check-name">Git integration enabled</span>
        </label>
        {enabled && (
          <>
            <div className="proj-git-bar">
              <span className="proj-git-branch">{branch || (loading ? "loading…" : "—")}</span>
              <button className="proj-icon" title="Refresh" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw size={12} className={loading ? "spin" : ""} />
              </button>
            </div>
            <pre className="proj-git-status">{changes || (branch ? "Working tree clean." : "")}</pre>
          </>
        )}
      </div>
    </section>
  );
}

function TrackingSection({ projectId, tracking, updateProject }: { projectId: string; tracking: { type: "github" | "url" | "none"; url?: string } | undefined; updateProject: UpdateProjectFn }) {
  const type = tracking?.type ?? "none";
  const url = tracking?.url ?? "";
  return (
    <section className="proj-section">
      <div className="proj-section-title"><Check size={14} /> Issue tracking</div>
      <div className="proj-section-body">
        <div className="proj-track-row">
          <select className="proj-select" value={type} onChange={(e) => updateProject(projectId, { tracking: { type: e.target.value as "github" | "url" | "none", url } })}>
            <option value="none">None</option>
            <option value="github">GitHub</option>
            <option value="url">URL</option>
          </select>
          {type !== "none" && (
            <input className="proj-track-url" placeholder={type === "github" ? "owner/repo or repo URL" : "https://…"} value={url} onChange={(e) => updateProject(projectId, { tracking: { type, url: e.target.value } })} />
          )}
        </div>
        {type !== "none" && url && (
          <a className="proj-track-link" href={type === "github" && !url.startsWith("http") ? `https://github.com/${url}` : url} target="_blank" rel="noreferrer">Open ↗</a>
        )}
      </div>
    </section>
  );
}

function DangerZone({ projectId, name, canDelete, renameProject, deleteProject }: { projectId: string; name: string; canDelete: boolean; renameProject: (id: string, name: string) => void; deleteProject: (id: string) => void }) {
  const [nm, setNm] = useState(name);
  useEffect(() => { setNm(name); }, [name]);
  return (
    <section className="proj-section">
      <div className="proj-section-title">🧩 Project</div>
      <div className="proj-section-body">
        <label className="proj-modal-label">Name</label>
        <div className="proj-track-row">
          <input className="proj-track-url" value={nm} onChange={(e) => setNm(e.target.value)} onBlur={() => nm.trim() && renameProject(projectId, nm.trim())} />
        </div>
        <button
          className="proj-btn proj-btn--danger"
          disabled={!canDelete}
          title={canDelete ? "Remove from the registry (doesn't delete the folder on disk)" : "Can't delete the only project"}
          onClick={() => { if (confirm(`Delete project "${name}"? (doesn't delete the folder on disk)`)) deleteProject(projectId); }}
        >
          <Trash2 size={13} /> Delete project
        </button>
      </div>
    </section>
  );
}

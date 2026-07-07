import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FolderKanban, FolderPlus, Trash2, Pencil, Check, RefreshCw,
  GitBranch, Server, Bot, Workflow as WorkflowIcon, Plus,
  FolderInput, FilePlus2, GitFork, ChevronDown, Loader,
} from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { useAgentsStore, isDefaultAgent } from "../store/agentsStore";
import { useWorkflowStore } from "../store/workflowStore";
import { useUiStore } from "../store/uiStore";
import { pickFolder, runShellCommand, createDir, writeTextFile, readDir, readTextFile, isTauri } from "../lib/tauriApi";

// Vista de Administración de Proyectos = "Project Hub" (Frente 4 + pilar 2 del roadmap). El Proyecto
// es el contenedor de todo lo que es "por proyecto": carpeta raíz, ambiente (env → servicios/terminales),
// git, tracking, y las asociaciones de agentes/workflows/servicios (scope duro). Cambiar el proyecto
// activo re-rootea el chat, terminal, file explorer, motor de workflows, etc. El panel del proyecto se
// organiza en TABS (Tanda A: Overview + config en Ajustes + crear en 3 formas; el resto llega por tandas).

const TABS = [
  { id: "overview",   label: "Overview" },
  { id: "estructura", label: "Estructura" },
  { id: "docs",       label: "Documentación" },
  { id: "contexto",   label: "Contexto" },
  { id: "agentes",    label: "Agentes" },
  { id: "flujos",     label: "Flujos" },
  { id: "servicios",  label: "Servicios" },
  { id: "ajustes",    label: "Ajustes" },
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
          <span className="proj-side-title"><FolderKanban size={14} /> Proyectos</span>
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
                  <button className="proj-icon" title="Renombrar" onClick={(e) => { e.stopPropagation(); startRename(id, p.name); }}>
                    <Pencil size={12} />
                  </button>
                  <button
                    className="proj-icon proj-icon--del"
                    title={order.length <= 1 ? "No se puede borrar el único proyecto" : "Borrar proyecto"}
                    disabled={order.length <= 1}
                    onClick={(e) => { e.stopPropagation(); if (confirm(`¿Borrar el proyecto "${p.name}"? (no borra la carpeta del disco)`)) deleteProject(id); }}
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
          <div className="proj-empty">Seleccioná o creá un proyecto.</div>
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
      <button className="proj-add-btn" onClick={() => setOpen((v) => !v)} title="Crear proyecto">
        <FolderPlus size={15} /><ChevronDown size={11} />
      </button>
      {open && (
        <div className="proj-create-menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={pickExisting}><FolderInput size={13} /> Carpeta existente…</button>
          <button onClick={() => { setOpen(false); setModal("scaffold"); }}><FilePlus2 size={13} /> Proyecto nuevo…</button>
          <button onClick={() => { setOpen(false); setModal("clone"); }}><GitFork size={13} /> Clonar de git…</button>
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
    if (!parent || !nm) { setError("Elegí carpeta padre y nombre."); return; }
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
    <ModalShell title="Proyecto nuevo" onClose={onClose}>
      <label className="proj-modal-label">Carpeta padre</label>
      <div className="proj-modal-pick">
        <input className="proj-modal-input" placeholder="Elegí dónde crear la carpeta…" value={parent} readOnly />
        <button className="proj-btn" onClick={pickParent}>Elegir…</button>
      </div>
      <label className="proj-modal-label">Nombre del proyecto</label>
      <input className="proj-modal-input" placeholder="mi-proyecto" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {parent && name.trim() && <div className="proj-modal-hint">Se creará: <code>{joinPath(parent, name.trim())}</code></div>}
      <div className="proj-modal-checks">
        <label><input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} /> git init</label>
        <label><input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> README.md</label>
        <label><input type="checkbox" checked={gitignore} onChange={(e) => setGitignore(e.target.checked)} /> .gitignore</label>
      </div>
      {error && <div className="proj-modal-error">{error}</div>}
      <div className="proj-modal-actions">
        <button className="proj-btn proj-btn--primary" onClick={create} disabled={busy || !parent || !name.trim()}>
          {busy ? <Loader size={13} className="spin" /> : null} Crear
        </button>
        <button className="proj-btn" onClick={onClose} disabled={busy}>Cancelar</button>
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
    if (!url.trim() || !parent) { setError("Poné la URL del repo y elegí carpeta destino."); return; }
    setBusy(true); setError("");
    try {
      const res = await runShellCommand(`git clone ${url.trim()}`, parent);
      if (res.exitCode !== 0) { setError(`git clone falló (exit ${res.exitCode}):\n${res.output.slice(-400)}`); setBusy(false); return; }
      onCreated(joinPath(parent, name), name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Clonar de git" onClose={onClose}>
      <label className="proj-modal-label">URL del repositorio</label>
      <input className="proj-modal-input" placeholder="https://github.com/owner/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
      <label className="proj-modal-label">Carpeta destino (padre)</label>
      <div className="proj-modal-pick">
        <input className="proj-modal-input" placeholder="Dónde clonar…" value={parent} readOnly />
        <button className="proj-btn" onClick={pickParent}>Elegir…</button>
      </div>
      {parent && name && <div className="proj-modal-hint">Se clonará en: <code>{joinPath(parent, name)}</code></div>}
      {busy && <div className="proj-modal-hint">Clonando… (puede tardar según el tamaño del repo)</div>}
      {error && <div className="proj-modal-error">{error}</div>}
      <div className="proj-modal-actions">
        <button className="proj-btn proj-btn--primary" onClick={clone} disabled={busy || !url.trim() || !parent}>
          {busy ? <Loader size={13} className="spin" /> : null} Clonar
        </button>
        <button className="proj-btn" onClick={onClose} disabled={busy}>Cancelar</button>
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
  const setView = useUiStore((s) => s.setView);

  if (!project) return null;

  switch (tab) {
    case "overview":
      return <OverviewTab projectId={projectId} />;
    case "estructura":
      return <Placeholder tanda="Tanda B — árbol de archivos del proyecto (reusa el File Explorer)." />;
    case "docs":
      return <Placeholder tanda="Tanda B — ver/editar los .md del proyecto con render markdown." />;
    case "contexto":
      return <Placeholder tanda="Tanda C — items de contexto por proyecto que se inyectan al agente." />;
    case "agentes":
      return <AgentsAssocSection projectId={projectId} />;
    case "flujos":
      return <WorkflowsAssocSection projectId={projectId} />;
    case "servicios":
      return <ServicesSummarySection project={project} setView={setView} />;
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

function Placeholder({ tanda }: { tanda: string }) {
  return <div className="proj-placeholder"><span className="proj-placeholder-icon">🚧</span><div>En construcción<br /><span className="proj-placeholder-sub">{tanda}</span></div></div>;
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
        <div className="proj-section-title">🧱 Stack detectado</div>
        <div className="proj-section-body">
          {detecting ? (
            <span className="proj-hint"><Loader size={12} className="spin" /> Detectando…</span>
          ) : stack.length > 0 ? (
            <div className="proj-stack">{stack.map((s) => <span key={s} className="proj-stack-tag">{s}</span>)}</div>
          ) : (
            <span className="proj-hint">{isTauri() ? "No se detectó un stack conocido en la raíz." : "Requiere la app desktop."}</span>
          )}
        </div>
      </section>

      <div className="proj-counters">
        <Counter icon={<Server size={16} />} label="Servicios" value={project.services.length} />
        <Counter icon={<Bot size={16} />} label="Agentes" value={project.agentIds.length} />
        <Counter icon={<WorkflowIcon size={16} />} label="Flujos" value={project.workflowIds.length} />
        <Counter icon={<FilePlus2 size={16} />} label="Docs (.md)" value={docsCount ?? "—"} />
      </div>
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

// ── Secciones reusadas (asociación de agentes / workflows / servicios) ──
function AgentsAssocSection({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const updateProject = useProjectStore((s) => s.updateProject);
  const agents = useAgentsStore((s) => s.agents);
  if (!project) return null;
  return (
    <div className="proj-config">
      <section className="proj-section">
        <div className="proj-section-title"><Bot size={14} /> Agentes expertos</div>
        <div className="proj-section-body">
          <p className="proj-hint">Agentes asociados a este proyecto. Los globales (MiMo, Hermes, Claude Code) están siempre disponibles en el chat. El CRUD completo de expertos llega en la Tanda C.</p>
          {agents.map((a) => {
            const checked = project.agentIds.includes(a.id);
            const isGlobal = isDefaultAgent(a.id);
            return (
              <label key={a.id} className="proj-check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isGlobal}
                  onChange={(e) => {
                    const next = e.target.checked ? [...project.agentIds, a.id] : project.agentIds.filter((x) => x !== a.id);
                    updateProject(projectId, { agentIds: next });
                  }}
                />
                <span className="proj-check-icon" style={{ color: a.color }}>{a.icon}</span>
                <span className="proj-check-name">{a.name}</span>
                {isGlobal && <span className="proj-badge">global</span>}
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function WorkflowsAssocSection({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const updateProject = useProjectStore((s) => s.updateProject);
  const workflows = useWorkflowStore((s) => s.workflows);
  const workflowOrder = useWorkflowStore((s) => s.order);
  if (!project) return null;
  return (
    <div className="proj-config">
      <section className="proj-section">
        <div className="proj-section-title"><WorkflowIcon size={14} /> Workflows</div>
        <div className="proj-section-body">
          <p className="proj-hint">Flujos asociados a este proyecto. Crear/editar desde el hub llega en la Tanda D.</p>
          {workflowOrder.map((id) => {
            const w = workflows[id];
            if (!w) return null;
            const checked = project.workflowIds.includes(id);
            return (
              <label key={id} className="proj-check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked ? [...project.workflowIds, id] : project.workflowIds.filter((x) => x !== id);
                    updateProject(projectId, { workflowIds: next });
                  }}
                />
                <span className="proj-check-name">{w.name}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ServicesSummarySection({ project, setView }: { project: NonNullable<ReturnType<typeof useProjectStore.getState>["projects"][string]>; setView: (v: "services") => void }) {
  return (
    <div className="proj-config">
      <section className="proj-section">
        <div className="proj-section-title"><Server size={14} /> Servicios</div>
        <div className="proj-section-body">
          <p className="proj-hint">
            {project.services.length === 0 ? "Sin servicios en este proyecto." : `${project.services.length} servicio(s) definido(s).`}
          </p>
          <button className="proj-btn" onClick={() => setView("services")}>Abrir panel de Servicios →</button>
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
      <div className="proj-section-title">⚙ Ambiente (env vars)</div>
      <div className="proj-section-body">
        <p className="proj-hint">Se inyectan a los servicios y a las terminales del proyecto.</p>
        {entries.length === 0 && <div className="proj-env-empty">Sin variables de ambiente.</div>}
        {entries.map(([k, v]) => (
          <div key={k} className="proj-env-row">
            <input className="proj-env-key" value={k} readOnly />
            <span className="proj-env-eq">=</span>
            <input className="proj-env-val" value={v} onChange={(e) => setEnvVar(k, e.target.value)} />
            <button className="proj-icon proj-icon--del" title="Quitar" onClick={() => removeEnvVar(k)}><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="proj-env-row proj-env-new">
          <input className="proj-env-key" placeholder="CLAVE" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <span className="proj-env-eq">=</span>
          <input className="proj-env-val" placeholder="valor" value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="proj-icon proj-icon--add" title="Agregar" onClick={add} disabled={!newKey.trim()}><Plus size={12} /></button>
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
    if (!isTauri()) { setStatus("(requiere la app desktop)"); return; }
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const res = await runShellCommand("git rev-parse --abbrev-ref HEAD && echo '===GITSPLIT===' && git status --short", path);
      if (req !== reqRef.current) return;
      setStatus(res.exitCode === 0 ? res.output.trim() : "No es un repositorio git.");
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
          <span className="proj-check-name">Integración git habilitada</span>
        </label>
        {enabled && (
          <>
            <div className="proj-git-bar">
              <span className="proj-git-branch">{branch || (loading ? "cargando…" : "—")}</span>
              <button className="proj-icon" title="Refrescar" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw size={12} className={loading ? "spin" : ""} />
              </button>
            </div>
            <pre className="proj-git-status">{changes || (branch ? "Working tree limpio." : "")}</pre>
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
      <div className="proj-section-title"><Check size={14} /> Tracking de issues</div>
      <div className="proj-section-body">
        <div className="proj-track-row">
          <select className="proj-select" value={type} onChange={(e) => updateProject(projectId, { tracking: { type: e.target.value as "github" | "url" | "none", url } })}>
            <option value="none">Ninguno</option>
            <option value="github">GitHub</option>
            <option value="url">URL</option>
          </select>
          {type !== "none" && (
            <input className="proj-track-url" placeholder={type === "github" ? "owner/repo o URL del repo" : "https://…"} value={url} onChange={(e) => updateProject(projectId, { tracking: { type, url: e.target.value } })} />
          )}
        </div>
        {type !== "none" && url && (
          <a className="proj-track-link" href={type === "github" && !url.startsWith("http") ? `https://github.com/${url}` : url} target="_blank" rel="noreferrer">Abrir ↗</a>
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
      <div className="proj-section-title">🧩 Proyecto</div>
      <div className="proj-section-body">
        <label className="proj-modal-label">Nombre</label>
        <div className="proj-track-row">
          <input className="proj-track-url" value={nm} onChange={(e) => setNm(e.target.value)} onBlur={() => nm.trim() && renameProject(projectId, nm.trim())} />
        </div>
        <button
          className="proj-btn proj-btn--danger"
          disabled={!canDelete}
          title={canDelete ? "Borrar del registro (no borra la carpeta del disco)" : "No se puede borrar el único proyecto"}
          onClick={() => { if (confirm(`¿Borrar el proyecto "${name}"? (no borra la carpeta del disco)`)) deleteProject(projectId); }}
        >
          <Trash2 size={13} /> Borrar proyecto
        </button>
      </div>
    </section>
  );
}

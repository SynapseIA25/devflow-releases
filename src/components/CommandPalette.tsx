import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, FileCode, GitBranch, Bot, FolderKanban, Compass, Loader2 } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { useWorkflowStore, useProjectWorkflowIds } from "../store/workflowStore";
import { useAgentsStore } from "../store/agentsStore";
import { useUiStore } from "../store/uiStore";
import { ALL_NAV_ITEMS } from "./NavBar";
import { readDir, isTauri } from "../lib/tauriApi";

const MAX_FILES = 3000;

// Recorrido BFS de archivos del proyecto, SIN filtro de extensión (a diferencia de collectFiles en
// codebaseMap.ts y collectRagFiles en ragIndex.ts, que sí filtran) — acá se busca cualquier archivo
// por nombre, no solo código. read_dir (Rust) ya omite node_modules/target/.git/dist/build/.next/.turbo.
async function collectAllFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDir) queue.push(e.path);
      else {
        out.push(e.path);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

type Result = {
  id: string;
  section: string;
  icon: typeof FileCode;
  label: string;
  sublabel?: string;
  onSelect: () => void;
};

// Paleta de comandos global (Ctrl+K / Cmd+K): busca archivos del proyecto activo, workflows,
// agentes, proyectos y vistas de navegación, todo en un único listado. Montado una vez en App.tsx,
// no renderiza nada mientras está cerrada.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const projectPath = useProjectStore((s) => s.projectPath);
  const projects = useProjectStore((s) => s.projects);
  const projectOrder = useProjectStore((s) => s.order);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);

  const workflows = useWorkflowStore((s) => s.workflows);
  const workflowIds = useProjectWorkflowIds();
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);

  const agents = useAgentsStore((s) => s.agents);
  const setView = useUiStore((s) => s.setView);
  const openInEditor = useUiStore((s) => s.openInEditor);

  // Ctrl+K / Cmd+K abre; Escape cierra. Único listener global de teclado de la app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Recorre el árbol de archivos UNA vez por apertura (no en cada tecla) — filtrado es client-side.
  useEffect(() => {
    if (!open || !isTauri()) return;
    setQuery("");
    setActiveIdx(0);
    setLoadingFiles(true);
    collectAllFiles(projectPath, MAX_FILES)
      .then(setFiles)
      .finally(() => setLoadingFiles(false));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, projectPath]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Result[] = [];

    for (const path of files ?? []) {
      const name = path.split(/[\\/]/).pop() ?? path;
      if (matches(name) || matches(path)) {
        out.push({ id: `file:${path}`, section: "Files", icon: FileCode, label: name, sublabel: path, onSelect: () => openInEditor(path) });
      }
      if (out.filter((r) => r.section === "Files").length >= 30) break;
    }

    for (const id of workflowIds) {
      const w = workflows[id];
      if (w && matches(w.name)) {
        out.push({
          id: `workflow:${id}`, section: "Workflows", icon: GitBranch, label: w.name,
          onSelect: () => { setActiveWorkflow(id); setView("workflow"); },
        });
      }
    }

    for (const a of agents) {
      if (matches(a.name)) {
        out.push({ id: `agent:${a.id}`, section: "Agents", icon: Bot, label: a.name, sublabel: a.description, onSelect: () => setView("agents") });
      }
    }

    for (const id of projectOrder) {
      const p = projects[id];
      if (p && matches(p.name)) {
        out.push({ id: `project:${id}`, section: "Projects", icon: FolderKanban, label: p.name, sublabel: p.path, onSelect: () => setActiveProject(id) });
      }
    }

    for (const item of ALL_NAV_ITEMS) {
      if (matches(item.label)) {
        out.push({ id: `view:${item.id}`, section: "Go to", icon: Compass, label: item.label, sublabel: item.hint, onSelect: () => setView(item.id) });
      }
    }

    return out;
  }, [query, files, workflowIds, workflows, agents, projectOrder, projects]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const activate = (r: Result) => {
    r.onSelect();
    setOpen(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[activeIdx]) activate(results[activeIdx]); }
  };

  if (!open) return null;

  let lastSection = "";
  return (
    <div className="cmdp-overlay" onClick={() => setOpen(false)}>
      <div className="cmdp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdp-inputrow">
          <Search size={14} className="cmdp-search-icon" />
          <input
            ref={inputRef}
            className="cmdp-input"
            placeholder="Search files, workflows, agents, projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {loadingFiles && <Loader2 size={13} className="spin cmdp-loading" />}
        </div>
        <div className="cmdp-results">
          {results.length === 0 && !loadingFiles && <div className="cmdp-empty">No results.</div>}
          {results.map((r, i) => {
            const showHeader = r.section !== lastSection;
            lastSection = r.section;
            return (
              <div key={r.id}>
                {showHeader && <div className="cmdp-section">{r.section}</div>}
                <div
                  className={`cmdp-row${i === activeIdx ? " active" : ""}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => activate(r)}
                >
                  <r.icon size={13} className="cmdp-row-icon" />
                  <div className="cmdp-row-info">
                    <span className="cmdp-row-label">{r.label}</span>
                    {r.sublabel && <span className="cmdp-row-sublabel">{r.sublabel}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

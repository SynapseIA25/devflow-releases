import { useRef, useState } from "react";
import {
  Sparkles, Plus, Upload, Download, Pin, PinOff, Archive, ArchiveRestore, Trash2, Pencil,
  Check, X, ChevronDown, ChevronRight, GitBranch, RefreshCw, Wand2, Lightbulb, Clock,
} from "lucide-react";
import { useSkillsStore } from "../store/skillsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { parseSkillMd, serializeSkillMd, slugify, type Skill } from "../lib/skills";
import { pickFolder, writeTextFile, httpRequest } from "../lib/tauriApi";
import { mineWorkspace } from "../lib/skillMiner";

// Vista Skills: la memoria procedural COMPARTIBLE de DevFlow. Sugerencias minadas de la actividad
// (con gate de aprobación), biblioteca con stats de uso + curator-lite, y compartir por archivo
// .skill.md o taps (repos GitHub como fuentes). Formato SKILL.md — interoperable con Claude Code,
// Hermes y agentskills.io.

const timeAgo = (ts?: number): string => {
  if (!ts) return "never";
  const d = Date.now() - ts;
  const days = Math.floor(d / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(d / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return "recently";
};

const SOURCE_LABEL: Record<Skill["source"], string> = {
  user: "manual", mined: "mined", imported: "imported", tap: "community",
};

type EditorState = { id?: string; name: string; description: string; category: string; content: string };

export function SkillsView() {
  const skills        = useSkillsStore((s) => s.skills);
  const order         = useSkillsStore((s) => s.order);
  const suggestions   = useSkillsStore((s) => s.suggestions);
  const taps          = useSkillsStore((s) => s.taps);
  const miningEnabled = useSkillsStore((s) => s.miningEnabled);
  const store         = useSkillsStore;

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [miningNow, setMiningNow] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = order.map((id) => skills[id]).filter(Boolean);
  const active = list.filter((s) => !s.archived);
  const archived = list.filter((s) => s.archived);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 6000);
  };

  const saveEditor = () => {
    if (!editor) return;
    const name = slugify(editor.name);
    if (!name || !editor.description.trim() || !editor.content.trim()) {
      flash("Name, description and content are required.");
      return;
    }
    const fields = { name, description: editor.description.trim(), category: editor.category.trim() || undefined, content: editor.content.trim() };
    if (editor.id) store.getState().updateSkill(editor.id, fields);
    else store.getState().addSkill({ ...fields, source: "user" });
    setEditor(null);
  };

  const exportSkill = async (s: Skill) => {
    try {
      const folder = await pickFolder();
      if (!folder) return;
      const path = `${folder.replace(/\\/g, "/")}/${s.name}.skill.md`;
      await writeTextFile(path, serializeSkillMd(s));
      flash(`Exported to ${path} — share this file, or open a PR to a skills repo (taps below).`);
    } catch (e) {
      flash(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSkillMd(String(reader.result ?? ""));
      if (!parsed) {
        flash("Not a valid skill file: expected SKILL.md frontmatter with name and description.");
        return;
      }
      store.getState().addSkill({ ...parsed, source: "imported" });
      flash(`Imported "${parsed.name}".`);
    };
    reader.readAsText(file);
  };

  const mineNow = async () => {
    setMiningNow(true);
    try {
      flash(await mineWorkspace(useWorkspaceStore.getState().activeWs, { force: true }));
    } finally {
      setMiningNow(false);
    }
  };

  return (
    <div className="skills-view">
      <div className="skills-header">
        <div>
          <div className="skills-title"><Sparkles size={18} /> Skills</div>
          <div className="skills-subtitle">
            Reusable procedures your agents learn from your activity and load on demand. Approve mined
            suggestions, share skills as files, or install them from community GitHub repos.
          </div>
        </div>
        <div className="skills-header-actions">
          <label className="skills-mining-toggle" title="After busy chat turns, a free background model looks for reusable procedures and suggests skills. Suggestions always require your approval.">
            <input type="checkbox" checked={miningEnabled} onChange={(e) => store.getState().setMiningEnabled(e.target.checked)} />
            Auto-mine sessions
          </label>
          <button className="skills-btn" onClick={mineNow} disabled={miningNow}>
            {miningNow ? <RefreshCw size={13} className="spin" /> : <Wand2 size={13} />} Mine current session
          </button>
          <button className="skills-btn" onClick={() => fileInputRef.current?.click()}><Upload size={13} /> Import</button>
          <button className="skills-btn primary" onClick={() => setEditor({ name: "", description: "", category: "", content: "## Steps\n1. " })}>
            <Plus size={13} /> New skill
          </button>
          <input
            ref={fileInputRef} type="file" accept=".md,.markdown" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }}
          />
        </div>
      </div>

      {status && <div className="skills-status">{status}</div>}

      {suggestions.length > 0 && (
        <div className="skills-section">
          <div className="skills-section-label"><Lightbulb size={13} /> Suggested from your activity ({suggestions.length})</div>
          {suggestions.map((sug) => (
            <SuggestionCard
              key={sug.id}
              name={sug.name} description={sug.description} content={sug.content} fromWsTitle={sug.fromWsTitle}
              onAccept={() => store.getState().acceptSuggestion(sug.id)}
              onReject={() => store.getState().rejectSuggestion(sug.id)}
            />
          ))}
        </div>
      )}

      <div className="skills-section">
        <div className="skills-section-label">Library ({active.length})</div>
        {active.length === 0 && (
          <div className="skills-empty">
            No skills yet. Work in the chat and approve mined suggestions, create one manually, or install from a community repo below.
          </div>
        )}
        {active.map((s) => (
          <SkillRow
            key={s.id} skill={s}
            onEdit={() => setEditor({ id: s.id, name: s.name, description: s.description, category: s.category ?? "", content: s.content })}
            onExport={() => exportSkill(s)}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="skills-section">
          <button className="skills-collapse" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Archived ({archived.length})
          </button>
          {showArchived && archived.map((s) => (
            <div key={s.id} className="skills-row archived">
              <div className="skills-row-main">
                <span className="skills-row-name">{s.name}</span>
                <span className="skills-row-desc">{s.description}</span>
              </div>
              <div className="skills-row-actions">
                <button className="skills-icon-btn" title="Restore" onClick={() => store.getState().restoreSkill(s.id)}><ArchiveRestore size={13} /></button>
                <button className="skills-icon-btn danger" title="Delete permanently" onClick={() => { if (confirm(`Delete skill "${s.name}" permanently?`)) store.getState().removeSkill(s.id); }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TapsSection taps={taps} onFlash={flash} />

      {editor && (
        <div className="skills-editor-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditor(null); }}>
          <div className="skills-editor">
            <div className="skills-editor-title">{editor.id ? "Edit skill" : "New skill"}</div>
            <div className="skills-editor-grid">
              <input className="skills-input" placeholder="name (kebab-case)" value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
              <input className="skills-input" placeholder="category (optional)" value={editor.category}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })} />
            </div>
            <input className="skills-input" placeholder="One-line description — this is what the agent sees to decide when to use it" value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
            <textarea className="skills-textarea" rows={14} placeholder="Markdown body: concise steps, exact commands and paths…" value={editor.content}
              onChange={(e) => setEditor({ ...editor, content: e.target.value })} />
            <div className="skills-editor-actions">
              <button className="skills-btn" onClick={() => setEditor(null)}>Cancel</button>
              <button className="skills-btn primary" onClick={saveEditor}><Check size={13} /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Fila de skill ─────────────────────────────────────── */
function SkillRow({ skill: s, onEdit, onExport }: { skill: Skill; onEdit: () => void; onExport: () => void }) {
  const store = useSkillsStore;
  const [open, setOpen] = useState(false);
  return (
    <div className={`skills-row${s.enabled ? "" : " disabled"}`}>
      <div className="skills-row-main" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="skills-row-name">{s.name}</span>
        <span className={`skills-badge src-${s.source}`}>{SOURCE_LABEL[s.source]}</span>
        {s.pinned && <span className="skills-badge pinned"><Pin size={9} /> pinned</span>}
        {s.stale && <span className="skills-badge stale"><Clock size={9} /> stale</span>}
        <span className="skills-row-desc">{s.description}</span>
        <span className="skills-row-stats">{s.uses} uses · {timeAgo(s.lastUsedAt)}</span>
      </div>
      <div className="skills-row-actions">
        <label className="skills-switch" title={s.enabled ? "Enabled: listed in the agent's skill index" : "Disabled: hidden from agents"}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => store.getState().updateSkill(s.id, { enabled: e.target.checked })} />
          <span className="skills-switch-slider" />
        </label>
        <button className="skills-icon-btn" title={s.pinned ? "Unpin" : "Pin (curator never marks it stale)"}
          onClick={() => store.getState().updateSkill(s.id, { pinned: !s.pinned })}>
          {s.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button className="skills-icon-btn" title="Edit" onClick={onEdit}><Pencil size={13} /></button>
        <button className="skills-icon-btn" title="Export as .skill.md (share it)" onClick={onExport}><Download size={13} /></button>
        <button className="skills-icon-btn" title="Archive (recoverable)" onClick={() => store.getState().archiveSkill(s.id)}><Archive size={13} /></button>
      </div>
      {open && <pre className="skills-row-content">{s.content}</pre>}
    </div>
  );
}

/* ── Sugerencia minada ─────────────────────────────────── */
function SuggestionCard({ name, description, content, fromWsTitle, onAccept, onReject }: {
  name: string; description: string; content: string; fromWsTitle?: string;
  onAccept: () => void; onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="skills-suggestion">
      <div className="skills-suggestion-head">
        <button className="skills-collapse" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className="skills-suggestion-info">
          <span className="skills-row-name">{name}</span>
          <span className="skills-row-desc">{description}</span>
          {fromWsTitle && <span className="skills-suggestion-src">from “{fromWsTitle}”</span>}
        </div>
        <div className="skills-row-actions">
          <button className="skills-btn primary" onClick={onAccept}><Check size={13} /> Approve</button>
          <button className="skills-btn" onClick={onReject}><X size={13} /> Dismiss</button>
        </div>
      </div>
      {open && <pre className="skills-row-content">{content}</pre>}
    </div>
  );
}

/* ── Taps: repos GitHub como fuentes de skills ─────────── */
type RemoteSkill = { name: string; path: string; installed: boolean };

function TapsSection({ taps, onFlash }: { taps: string[]; onFlash: (msg: string) => void }) {
  const store = useSkillsStore;
  const [repoInput, setRepoInput] = useState("");
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteSkill[] | null>(null);
  const [busy, setBusy] = useState(false);
  const branchRef = useRef<string>("main");

  const gh = async (url: string): Promise<any> => {
    const res = await httpRequest("GET", url, { "User-Agent": "DevFlow", Accept: "application/vnd.github+json" }, "");
    if (res.status !== 200) throw new Error(`GitHub replied ${res.status} for ${url}`);
    return JSON.parse(res.body);
  };

  const browse = async (repo: string) => {
    setBusy(true);
    setBrowsing(repo);
    setRemote(null);
    try {
      const info = await gh(`https://api.github.com/repos/${repo}`);
      branchRef.current = info.default_branch ?? "main";
      const tree = await gh(`https://api.github.com/repos/${repo}/git/trees/${branchRef.current}?recursive=1`);
      const installed = new Set(Object.values(store.getState().skills).map((s) => s.name));
      const found: RemoteSkill[] = (tree.tree as { path: string; type: string }[])
        .filter((e) => e.type === "blob" && (/(^|\/)SKILL\.md$/.test(e.path) || e.path.endsWith(".skill.md")))
        .map((e) => {
          const name = e.path.endsWith(".skill.md")
            ? slugify(e.path.split("/").pop()!.replace(/\.skill\.md$/, ""))
            : slugify(e.path.split("/").slice(-2, -1)[0] ?? repo.split("/")[1]);
          return { name, path: e.path, installed: installed.has(name) };
        });
      setRemote(found);
      if (found.length === 0) onFlash("No SKILL.md files found in that repo.");
    } catch (e) {
      onFlash(`Browse failed: ${e instanceof Error ? e.message : String(e)}`);
      setBrowsing(null);
    } finally {
      setBusy(false);
    }
  };

  const install = async (repo: string, r: RemoteSkill) => {
    setBusy(true);
    try {
      const res = await httpRequest("GET", `https://raw.githubusercontent.com/${repo}/${branchRef.current}/${r.path}`, { "User-Agent": "DevFlow" }, "");
      if (res.status !== 200) throw new Error(`GitHub replied ${res.status}`);
      const parsed = parseSkillMd(res.body);
      if (!parsed) throw new Error("file is not a valid SKILL.md (missing frontmatter)");
      store.getState().addSkill({ ...parsed, source: "tap", tapRepo: repo });
      setRemote((prev) => prev?.map((x) => (x.path === r.path ? { ...x, installed: true } : x)) ?? null);
      onFlash(`Installed "${parsed.name}" from ${repo}. Review its content before enabling it in sensitive projects.`);
    } catch (e) {
      onFlash(`Install failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skills-section">
      <div className="skills-section-label"><GitBranch size={13} /> Community sources (taps)</div>
      <div className="skills-tap-add">
        <input
          className="skills-input" placeholder="owner/repo — a GitHub repo with SKILL.md files (e.g. your team's skills repo)"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && repoInput.trim()) { store.getState().addTap(repoInput); setRepoInput(""); } }}
        />
        <button className="skills-btn" onClick={() => { if (repoInput.trim()) { store.getState().addTap(repoInput); setRepoInput(""); } }}>
          <Plus size={13} /> Add tap
        </button>
      </div>
      {taps.length === 0 && (
        <div className="skills-empty">
          Add a GitHub repo as a skill source to install skills your team or the community shared. To share yours: export a skill and push it to a repo with one folder per skill containing its <code>SKILL.md</code>.
        </div>
      )}
      {taps.map((repo) => (
        <div key={repo} className="skills-tap">
          <div className="skills-tap-head">
            <GitBranch size={13} />
            <span className="skills-tap-repo">{repo}</span>
            <div className="skills-row-actions">
              <button className="skills-btn" disabled={busy} onClick={() => browse(repo)}>
                {busy && browsing === repo ? <RefreshCw size={13} className="spin" /> : null} Browse
              </button>
              <button className="skills-icon-btn danger" title="Remove tap" onClick={() => { store.getState().removeTap(repo); if (browsing === repo) { setBrowsing(null); setRemote(null); } }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {browsing === repo && remote && remote.length > 0 && (
            <div className="skills-tap-list">
              {remote.map((r) => (
                <div key={r.path} className="skills-tap-item">
                  <span className="skills-row-name">{r.name}</span>
                  <span className="skills-row-desc">{r.path}</span>
                  <button className="skills-btn" disabled={busy || r.installed} onClick={() => install(repo, r)}>
                    {r.installed ? <><Check size={13} /> Installed</> : <><Download size={13} /> Install</>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

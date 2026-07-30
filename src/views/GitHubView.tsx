import { useEffect, useState } from "react";
import { GitPullRequest, CircleDot, ExternalLink, Boxes, Loader, RotateCw } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { runShellCommand, isTauri } from "../lib/tauriApi";
import { createWorktreeFromPr } from "../lib/environments";

type Pr = { number: number; title: string; author: { login: string }; headRefName: string; url: string; isDraft: boolean };
type Issue = { number: number; title: string; author: { login: string }; url: string; labels: { name: string }[] };

// Browse GitHub PRs/issues del repo del proyecto activo (Orca "GitHub & Linear, Native" — sin
// Linear, no se usa en este proyecto). Mismo criterio que el resto de la app para git: shell-out a
// una CLI ya instalada/autenticada (`gh`, ver memoria devflow-gh-cli) vía runShellCommand, parseando
// JSON — nada de tokens/API manejados a mano.
export function GitHubView() {
  const activeId = useProjectStore((s) => s.activeId);
  const projectPath = useProjectStore((s) => s.projectPath);
  const addEnvironment = useProjectStore((s) => s.addEnvironment);

  const [tab, setTab] = useState<"prs" | "issues">("prs");
  const [prs, setPrs] = useState<Pr[] | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingPr, setOpeningPr] = useState<number | null>(null);

  const load = async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const [prRes, issueRes] = await Promise.all([
        runShellCommand("gh pr list --json number,title,author,headRefName,url,isDraft", projectPath),
        runShellCommand("gh issue list --json number,title,author,url,labels", projectPath),
      ]);
      if (prRes.exitCode !== 0) throw new Error(prRes.output.slice(-500));
      if (issueRes.exitCode !== 0) throw new Error(issueRes.output.slice(-500));
      setPrs(JSON.parse(prRes.output));
      setIssues(JSON.parse(issueRes.output));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [activeId]);

  const openAsEnvironment = async (pr: Pr) => {
    setOpeningPr(pr.number);
    setError(null);
    try {
      const wt = await createWorktreeFromPr(projectPath, pr.number, `pr-${pr.number}`);
      addEnvironment(wt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningPr(null);
    }
  };

  return (
    <div className="gh-view">
      <div className="gh-header">
        <span className="gh-title"><GitPullRequest size={14} /> GitHub</span>
        <div className="gh-tabs">
          <button className={`gh-tab${tab === "prs" ? " active" : ""}`} onClick={() => setTab("prs")}>
            <GitPullRequest size={12} /> Pull requests {prs ? `(${prs.length})` : ""}
          </button>
          <button className={`gh-tab${tab === "issues" ? " active" : ""}`} onClick={() => setTab("issues")}>
            <CircleDot size={12} /> Issues {issues ? `(${issues.length})` : ""}
          </button>
        </div>
        <button className="gh-refresh-btn" onClick={() => void load()} disabled={loading} title="Refresh">
          {loading ? <Loader size={13} className="spin" /> : <RotateCw size={13} />}
        </button>
      </div>

      {error && <div className="gh-error"><pre>{error}</pre></div>}
      {!isTauri() && <div className="gh-empty">Requires the desktop app (Tauri).</div>}

      {isTauri() && tab === "prs" && (
        <div className="gh-list">
          {prs?.length === 0 && <div className="gh-empty">No open pull requests.</div>}
          {prs?.map((pr) => (
            <div key={pr.number} className="gh-row">
              <div className="gh-row-info">
                <div className="gh-row-title">
                  {pr.isDraft && <span className="gh-draft-badge">draft</span>}
                  #{pr.number} {pr.title}
                </div>
                <div className="gh-row-meta">{pr.headRefName} · @{pr.author.login}</div>
              </div>
              <div className="gh-row-actions">
                <button
                  className="gh-btn"
                  onClick={() => void openAsEnvironment(pr)}
                  disabled={openingPr !== null}
                  title="Create an environment (worktree) checked out to this PR's branch"
                >
                  {openingPr === pr.number ? <Loader size={12} className="spin" /> : <Boxes size={12} />} Open as environment
                </button>
                <a className="gh-btn" href={pr.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /></a>
              </div>
            </div>
          ))}
        </div>
      )}

      {isTauri() && tab === "issues" && (
        <div className="gh-list">
          {issues?.length === 0 && <div className="gh-empty">No open issues.</div>}
          {issues?.map((issue) => (
            <div key={issue.number} className="gh-row">
              <div className="gh-row-info">
                <div className="gh-row-title">#{issue.number} {issue.title}</div>
                <div className="gh-row-meta">
                  @{issue.author.login}
                  {issue.labels.length > 0 && ` · ${issue.labels.map((l) => l.name).join(", ")}`}
                </div>
              </div>
              <div className="gh-row-actions">
                <a className="gh-btn" href={issue.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /></a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

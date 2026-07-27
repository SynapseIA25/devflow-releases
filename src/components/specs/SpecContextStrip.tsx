import { useEffect, useState } from "react";
import { FileText, Code2, Sparkles, Network, Bot, GitBranch } from "lucide-react";
import { readIndexStatus } from "../../lib/ragIndex";

// Qué alimenta a Specify/Plan además del pedido del usuario — memoria, código real (vía RAG, si el
// índice está construido), skills, workflows, agentes expertos, historial de git.
export function SpecContextStrip({ projectRoot }: { projectRoot: string }) {
  const [ragChunks, setRagChunks] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readIndexStatus(projectRoot).then((s) => {
      if (!cancelled) setRagChunks(s.exists ? s.chunkCount ?? 0 : null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  const items = [
    { icon: FileText, label: "MEMORY.md" },
    { icon: Code2, label: ragChunks !== null ? `Existing code (${ragChunks} chunks)` : "Existing code (no RAG index)" },
    { icon: Sparkles, label: "Skills" },
    { icon: Network, label: "Workflows" },
    { icon: Bot, label: "Expert agents" },
    { icon: GitBranch, label: "Git history" },
  ];

  return (
    <div className="specs-panel">
      <div className="specs-panel-label">Project context</div>
      <div className="specs-ctx-grid">
        {items.map((it) => (
          <div key={it.label} className="specs-ctx-item">
            <div className="specs-ctx-icon"><it.icon size={16} /></div>
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

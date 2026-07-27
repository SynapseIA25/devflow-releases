import { FolderKanban, Bot, CheckCircle, Clock, FileText } from "lucide-react";
import type { Spec } from "../../store/projectStore";

export function SpecStatusBar({ spec, projectName, leadName, specCount }: { spec: Spec; projectName: string; leadName: string; specCount: number }) {
  const done = spec.tasks.filter((t) => t.done).length;
  return (
    <div className="specs-statusbar">
      <span className="specs-stat"><FolderKanban size={13} /> Project: <b>{projectName}</b></span>
      <span className="specs-stat"><Bot size={13} /> Agent: <b>{leadName}</b></span>
      <span className="specs-stat specs-stat--ok"><CheckCircle size={13} /> Tasks: <b>{done}/{spec.tasks.length}</b></span>
      <span className="specs-stat"><Clock size={13} /> Updated: <b>{new Date(spec.updatedAt).toLocaleTimeString()}</b></span>
      <span className="specs-stat"><FileText size={13} /> Specs: <b>{specCount}</b></span>
    </div>
  );
}

import { Loader } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DelegateStep } from "../lib/teamDelegate";

// Render de un stream de DelegateStep[] (plan del lead → expertos en paralelo → síntesis) — extraído
// de TeamView.tsx para que también lo use SpecProgressLog (Implement de una spec, cuando una tarea
// cruza áreas y se resuelve en equipo vía autoDelegate) sin duplicar esta lógica.

// Chip con el modelo real de la sesión (id sin el segmento del provider ACP; el id completo va en title).
// Hace visible qué modelo eligió el router para cada rol — y delata si alguno cayó en uno pago.
function ModelChip({ model }: { model?: string }) {
  if (!model) return null;
  const short = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return <span className="team-model-chip" title={model}>{short}</span>;
}

export function DelegateStepList({ steps, running }: { steps: DelegateStep[]; running: boolean }) {
  const plan = steps.find((s) => s.kind === "plan") as Extract<DelegateStep, { kind: "plan" }> | undefined;
  const done = steps.filter((s): s is Extract<DelegateStep, { kind: "expert-done" }> => s.kind === "expert-done");
  const starts = steps.filter((s): s is Extract<DelegateStep, { kind: "expert-start" }> => s.kind === "expert-start");
  // Modelo por experto (por index): el último expert-model gana (un reintento por cuota puede cambiarlo).
  const modelByIndex = new Map<number, string>();
  for (const s of steps) if (s.kind === "expert-model") modelByIndex.set(s.index, s.model);
  const synthesis = steps.find((s) => s.kind === "synthesis") as Extract<DelegateStep, { kind: "synthesis" }> | undefined;
  const error = steps.find((s) => s.kind === "error") as Extract<DelegateStep, { kind: "error" }> | undefined;
  const stage = [...steps].reverse().find((s) => s.kind === "stage") as Extract<DelegateStep, { kind: "stage" }> | undefined;

  return (
    <div className="team-results">
      {running && stage && !synthesis && <div className="team-stage"><Loader size={12} className="spin" /> {stage.label}</div>}

      {plan && (
        <div className="team-plan">
          <div className="team-plan-title">Lead's plan ({plan.items.length} sub-task{plan.items.length === 1 ? "" : "s"}) <ModelChip model={plan.model} /></div>
          {plan.items.map((it, i) => (
            <div key={i} className="team-plan-item"><span className="team-plan-area">{it.area}</span> {it.subtask}</div>
          ))}
        </div>
      )}

      {starts.map((st) => {
        // Pareamos por `index` (no por orden de llegada): en paralelo los expert-done llegan en cualquier
        // orden, pero cada uno trae el índice de su expert-start → se paean sin ambigüedad aunque el líder
        // asigne dos sub-tareas al mismo experto.
        const result = done.find((d) => d.index === st.index);
        return (
          <div key={st.index} className="team-expert-block">
            <div className="team-expert-head">
              <span style={{ color: st.color }}>{st.icon}</span>
              <span className="team-expert-name">{st.name}</span>
              <ModelChip model={modelByIndex.get(st.index)} />
              {!result && running
                ? <Loader size={11} className="spin" />
                : result?.timedOut
                  ? <span className="team-expert-timeout" title="No response in time">⏱</span>
                  : <span className="team-expert-ok">✓</span>}
            </div>
            {result && <div className="team-expert-body proj-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.text}</ReactMarkdown></div>}
          </div>
        );
      })}

      {synthesis && (
        <div className="team-synthesis">
          <div className="team-synthesis-title">🧩 Lead's synthesis <ModelChip model={synthesis.model} /></div>
          <div className="team-synthesis-body proj-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{synthesis.text}</ReactMarkdown></div>
        </div>
      )}

      {error && <div className="team-error">{error.message}</div>}
    </div>
  );
}

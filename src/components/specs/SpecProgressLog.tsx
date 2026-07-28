import { DelegateStepList } from "../DelegateStepList";
import type { SpecStep } from "../../lib/specOrchestrator";

// Renderiza el stream de Implement — el caso "task-delegate" envuelve un DelegateStep real, así se
// reusa el render de Team (DelegateStepList) sin duplicar esa lógica para tareas que cruzan áreas.
export function SpecProgressLog({ steps, running }: { steps: SpecStep[]; running: boolean }) {
  return (
    <div className="specs-live-panel">
      <div className="specs-winbar">
        <span className="specs-dot specs-dot--r" />
        <span className="specs-dot specs-dot--y" />
        <span className="specs-dot specs-dot--g" />
        <span className="specs-wintitle">implement</span>
      </div>
      <div className="specs-winbody specs-progress-log">
        {steps.length === 0 && <div className="specs-artifact-empty">Run Implement to see progress here.</div>}
        {steps.map((s, i) => {
          switch (s.kind) {
            case "task-start":
              return <div key={i} className="specs-log-line">▶ Task {s.index + 1}: {s.text}</div>;
            case "task-mode":
              return (
                <div key={i} className="specs-log-line specs-log-line--dim">
                  {s.mode === "single" ? `→ ${s.agentName}` : "→ team (crosses expert areas)"}
                </div>
              );
            case "task-delegate":
              return <DelegateStepList key={i} steps={[s.step]} running={running} />;
            case "task-done":
              // changed === false: el turno terminó sin errores pero SIN llamar ninguna herramienta
              // de escritura — el agente puede haber dicho "listo" sin haber tocado nada. No es un
              // fallo (puede ser un false negative real, ej. una tarea que de verdad no tocaba
              // código), pero se marca distinto para que se note sin ir al diff a mano.
              return s.changed === false ? (
                <div key={i} className="specs-log-line specs-log-line--warn">
                  ⚠ Task {s.index + 1} finished, but the agent doesn't seem to have written/edited any file — review it.
                </div>
              ) : (
                <div key={i} className="specs-log-line specs-log-line--ok">✓ Task {s.index + 1} done</div>
              );
            case "task-error":
              return <div key={i} className="specs-log-line specs-log-line--err">✖ {s.message}</div>;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

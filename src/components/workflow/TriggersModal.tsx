import { Plus, X } from "lucide-react";
import { useTriggersStore } from "../../store/triggersStore";
import { TriggerRow } from "./TriggerRow";

// Gestiona los triggers del flujo activo: agregar por intervalo o cron, habilitar/pausar, ver último
// disparo. El scheduler real vive en TriggerRunner (global). Modal abierto desde la toolbar de Workflows.
export function TriggersModal({ workflowId, workflowName, onClose }: {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const allTriggers = useTriggersStore((s) => s.triggers);
  const triggers = allTriggers.filter((t) => t.workflowId === workflowId);
  const addTrigger = useTriggersStore((s) => s.addTrigger);
  const updateTrigger = useTriggersStore((s) => s.updateTrigger);
  const removeTrigger = useTriggersStore((s) => s.removeTrigger);

  return (
    <div className="mcp-modal-overlay" onClick={onClose}>
      <div className="mcp-modal trg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-modal-header">
          <span className="mcp-modal-title">⏰ Triggers · {workflowName}</span>
          <button className="fw-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="trg-note">
          Los triggers disparan este flujo automáticamente <strong>mientras DevFlow esté abierto</strong>.
          El webhook escucha en <code>127.0.0.1</code> (solo local) con un token no adivinable.
        </div>

        <div className="trg-list">
          {triggers.length === 0 && <div className="trg-empty">Sin triggers todavía. Agregá uno abajo.</div>}
          {triggers.map((t) => (
            <TriggerRow key={t.id} trigger={t} updateTrigger={updateTrigger} removeTrigger={removeTrigger} />
          ))}
        </div>

        <button className="mcp-btn-add trg-add" onClick={() => addTrigger(workflowId)}>
          <Plus size={13} /> Agregar trigger
        </button>
      </div>
    </div>
  );
}

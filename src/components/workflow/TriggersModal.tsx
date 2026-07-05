import { Plus, Trash2, X, Clock, CalendarClock, CheckCircle, AlertCircle, Webhook, Eye } from "lucide-react";
import { useTriggersStore, type TriggerType } from "../../store/triggersStore";
import { describeCron, isValidCron } from "../../lib/cron";
import { WEBHOOK_PORT } from "../TriggerRunner";

// Gestiona los triggers del flujo activo: agregar por intervalo o cron, habilitar/pausar, ver último
// disparo. El scheduler real vive en TriggerRunner (global). Modal abierto desde la toolbar de Workflows.
export function TriggersModal({ workflowId, workflowName, onClose }: {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const triggers = useTriggersStore((s) => s.triggers.filter((t) => t.workflowId === workflowId));
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
          (Webhooks y disparo por cambio de archivo llegan pronto.)
        </div>

        <div className="trg-list">
          {triggers.length === 0 && <div className="trg-empty">Sin triggers todavía. Agregá uno abajo.</div>}
          {triggers.map((t) => {
            const cronOk = t.type !== "cron" || isValidCron(t.cron);
            return (
              <div key={t.id} className={`trg-row${t.enabled ? " trg-row--on" : ""}`}>
                <button
                  className={`trg-toggle${t.enabled ? " on" : ""}`}
                  onClick={() => updateTrigger(t.id, { enabled: !t.enabled, lastRun: Date.now() })}
                  title={t.enabled ? "Pausar" : "Activar"}
                >
                  <span className="trg-toggle-dot" />
                </button>

                <select
                  className="trg-type"
                  value={t.type}
                  onChange={(e) => updateTrigger(t.id, { type: e.target.value as TriggerType })}
                >
                  <option value="interval">Cada</option>
                  <option value="cron">Cron</option>
                  <option value="webhook">Webhook</option>
                  <option value="file">Archivo</option>
                </select>

                {t.type === "interval" && (
                  <div className="trg-config">
                    <Clock size={12} />
                    <input
                      type="number"
                      min={1}
                      className="trg-input trg-input--num"
                      value={t.intervalMinutes}
                      onChange={(e) => updateTrigger(t.id, { intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <span className="trg-unit">min</span>
                  </div>
                )}
                {t.type === "cron" && (
                  <div className="trg-config">
                    <CalendarClock size={12} />
                    <input
                      className={`trg-input trg-input--cron${cronOk ? "" : " invalid"}`}
                      value={t.cron}
                      placeholder="0 9 * * 1"
                      onChange={(e) => updateTrigger(t.id, { cron: e.target.value })}
                      title={cronOk ? describeCron(t.cron) : "Cron inválido (5 campos)"}
                    />
                    <span className="trg-cron-desc">{cronOk ? describeCron(t.cron) : "inválido"}</span>
                  </div>
                )}
                {t.type === "webhook" && (
                  <div className="trg-config">
                    <Webhook size={12} />
                    <input
                      className="trg-input trg-input--url"
                      readOnly
                      value={`http://127.0.0.1:${WEBHOOK_PORT}/hook/${t.id}`}
                      onFocus={(e) => e.target.select()}
                      title="POST acá (el body va como {{input}}). Activá el trigger para levantar el servidor."
                    />
                  </div>
                )}
                {t.type === "file" && (
                  <div className="trg-config">
                    <Eye size={12} />
                    <input
                      className="trg-input trg-input--path"
                      value={t.path}
                      placeholder="F:\\mi-proyecto\\archivo.txt (o una carpeta)"
                      onChange={(e) => updateTrigger(t.id, { path: e.target.value })}
                    />
                  </div>
                )}

                <div className="trg-status">
                  {t.lastStatus === "success" && <CheckCircle size={12} color="#4ade80" />}
                  {t.lastStatus === "error" && <AlertCircle size={12} color="#f85149" />}
                  <span title={t.lastMessage}>
                    {t.lastRun && t.lastStatus ? new Date(t.lastRun).toLocaleTimeString() : "nunca corrió"}
                  </span>
                </div>

                <button className="trg-del" onClick={() => removeTrigger(t.id)} title="Borrar trigger">
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <button className="mcp-btn-add trg-add" onClick={() => addTrigger(workflowId)}>
          <Plus size={13} /> Agregar trigger
        </button>
      </div>
    </div>
  );
}

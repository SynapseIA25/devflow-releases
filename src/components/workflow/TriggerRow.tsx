import { Trash2, Clock, CalendarClock, CheckCircle, AlertCircle, Webhook, Eye, RotateCcw } from "lucide-react";
import { type Trigger, type TriggerType } from "../../store/triggersStore";
import { describeCron, isValidCron } from "../../lib/cron";
import { WEBHOOK_PORT } from "../TriggerRunner";

// Fila de un trigger: toggle, selector de tipo, config por tipo, estado del último disparo, borrar.
// Compartida entre TriggersModal (por workflow) y TriggersView (todos los workflows).
export function TriggerRow({ trigger: t, updateTrigger, removeTrigger }: {
  trigger: Trigger;
  updateTrigger: (id: string, patch: Partial<Trigger>) => void;
  removeTrigger: (id: string) => void;
}) {
  const cronOk = t.type !== "cron" || isValidCron(t.cron);

  return (
    <div className={`trg-row${t.enabled ? " trg-row--on" : ""}`}>
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
        <div className="trg-config trg-config--webhook">
          <Webhook size={12} />
          <input
            className="trg-input trg-input--url"
            readOnly
            value={`http://127.0.0.1:${WEBHOOK_PORT}/hook/${t.id}`}
            onFocus={(e) => e.target.select()}
            title="POST acá. Activá el trigger para levantar el servidor."
          />
          <label
            className="trg-ext-input"
            title="Pasar el body de la request como {{input}} al flujo. El body es entrada externa no confiable (puede terminar en shell o new Function). Dejalo apagado salvo que confíes en quien llama el webhook."
          >
            <input
              type="checkbox"
              checked={!!t.allowExternalInput}
              onChange={(e) => updateTrigger(t.id, { allowExternalInput: e.target.checked })}
            />
            <span>usar body como input</span>
          </label>
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
        {t.lastRunReason === "catchup" && (
          <span className="trg-catchup-badge" title="Se ejecutó al abrir DevFlow porque se perdió mientras estaba cerrada">
            <RotateCcw size={11} /> recuperado
          </span>
        )}
        <span title={t.lastMessage}>
          {t.lastRun && t.lastStatus ? new Date(t.lastRun).toLocaleTimeString() : "nunca corrió"}
        </span>
      </div>

      <button className="trg-del" onClick={() => removeTrigger(t.id)} title="Borrar trigger">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

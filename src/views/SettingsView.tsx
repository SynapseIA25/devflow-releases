import { useState } from "react";
import { CheckCircle, AlertCircle, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { ProviderConfig } from "../lib/providers";

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const { updateProvider, setSelectedModel, selectedProviderId, selectedModel } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState(provider.apiKey);

  const isSelected = selectedProviderId === provider.id;

  const handleSave = () => {
    updateProvider(provider.id, { apiKey: key, enabled: key.length > 0 || provider.isLocal });
  };

  return (
    <div className={`provider-card${isSelected ? " selected" : ""}`}>
      <div className="provider-card-header">
        <div className="provider-dot" style={{ background: provider.color }} />
        <div className="provider-card-info">
          <div className="provider-card-name">{provider.name}</div>
          <div className="provider-card-desc">{provider.description}</div>
        </div>
        <div className={`provider-status ${provider.enabled ? "enabled" : "disabled"}`}>
          {provider.enabled
            ? <><CheckCircle size={12} /> Activo</>
            : <><AlertCircle size={12} /> Inactivo</>}
        </div>
      </div>

      {!provider.isLocal && (
        <div className="provider-field">
          <label className="provider-label">API Key</label>
          <div className="api-key-row">
            <input
              type={showKey ? "text" : "password"}
              className="provider-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
            />
            <button className="icon-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      )}

      <div className="provider-field">
        <label className="provider-label">Base URL</label>
        <input
          className="provider-input"
          defaultValue={provider.baseUrl}
          onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
        />
      </div>

      <div className="provider-field">
        <label className="provider-label">Modelo por defecto</label>
        <div className="model-grid">
          {provider.models.map((m) => (
            <button
              key={m}
              className={`model-chip${isSelected && selectedModel === m ? " active" : ""}`}
              onClick={() => setSelectedModel(provider.id, m)}
              style={isSelected && selectedModel === m ? { borderColor: provider.color, color: provider.color } : {}}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <button className="save-btn" onClick={handleSave}>
        Guardar
      </button>
    </div>
  );
}

function SecuritySection() {
  const autoApprove = useSettingsStore((s) => s.autoApprovePermissions);
  const setAutoApprove = useSettingsStore((s) => s.setAutoApprovePermissions);
  const permissionLog = useSettingsStore((s) => s.permissionLog);

  return (
    <div className="settings-security">
      <h3 className="settings-section-title"><ShieldAlert size={14} /> Seguridad · Permisos del agente</h3>
      <div className="security-row">
        <label className={`security-toggle${autoApprove ? " on" : ""}`} onClick={() => setAutoApprove(!autoApprove)}>
          <span className="security-toggle-dot" />
        </label>
        <div className="security-row-text">
          <div className="security-row-title">Auto-aprobar permisos en workflows</div>
          <div className="security-row-desc">
            {autoApprove
              ? "⚠️ Activo: cuando un workflow corre sin interfaz para aprobar, el agente aprueba solo sus acciones (escribir archivos, ejecutar shell). Cómodo pero riesgoso."
              : "Seguro (recomendado): sin interfaz para aprobar, las solicitudes de permiso se deniegan. En el chat siempre se te pregunta con un modal."}
          </div>
        </div>
      </div>
      {permissionLog.length > 0 && (
        <div className="security-log">
          <div className="security-log-title">Decisiones automáticas recientes</div>
          {permissionLog.slice(0, 8).map((e, i) => (
            <div key={i} className={`security-log-row security-log-row--${e.decision}`}>
              <span className="security-log-decision">{e.decision === "auto-allow" ? "✔ aprobado" : "✖ denegado"}</span>
              <span className="security-log-tool">{e.tool}</span>
              <span className="security-log-provider">{e.provider}</span>
              <span className="security-log-time">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const providers = useSettingsStore((s) => s.providers);
  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const active = providers.find((p) => p.id === selectedProviderId);

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2 className="settings-title">Proveedores de IA</h2>
        <p className="settings-subtitle">
          Configurá los proveedores y modelos que los agentes usarán para procesar tus solicitudes.
        </p>
        {active && (
          <div className="settings-active-summary">
            <span className="provider-dot" style={{ background: active.color }} />
            Activo: <strong>{active.name}</strong>
            <span className="settings-active-model">{selectedModel}</span>
            <span className={`provider-status ${active.enabled ? "enabled" : "disabled"}`}>
              {active.enabled ? <><CheckCircle size={12} /> listo</> : <><AlertCircle size={12} /> sin configurar</>}
            </span>
          </div>
        )}
      </div>
      <SecuritySection />
      <div className="providers-grid">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

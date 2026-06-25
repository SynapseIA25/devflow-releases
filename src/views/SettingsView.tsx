import { useState } from "react";
import { CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
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

export function SettingsView() {
  const { providers } = useSettingsStore();

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2 className="settings-title">Proveedores de IA</h2>
        <p className="settings-subtitle">
          Configurá los proveedores y modelos que los agentes usarán para procesar tus solicitudes.
        </p>
      </div>
      <div className="providers-grid">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

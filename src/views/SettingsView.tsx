import { CheckCircle, AlertCircle, ShieldAlert } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { ProviderConfig } from "../lib/providers";

// DevFlow es un host de agentes ACP: no guarda API keys ni elige el modelo por acá (eso lo hace el CLI
// del agente, y el modelo se elige en el selector del chat). Esta tarjeta solo informa el estado real.
function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const currentModel = useSettingsStore((s) => s.currentModelByProvider[provider.id]);
  const connected = !!provider.acp;
  const cliName = provider.acp?.command.split(/[\\/]/).pop();

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <div className="provider-dot" style={{ background: provider.color }} />
        <div className="provider-card-info">
          <div className="provider-card-name">{provider.name}</div>
          <div className="provider-card-desc">{provider.description}</div>
        </div>
        <div className={`provider-status ${connected ? "enabled" : "disabled"}`}>
          {connected ? <><CheckCircle size={12} /> ACP</> : <><AlertCircle size={12} /> Not connected</>}
        </div>
      </div>

      {connected ? (
        <div className="provider-meta">
          <div className="provider-meta-row">
            <span className="provider-label">Active model</span>
            <span className="provider-meta-val">{currentModel ?? "— (set in the chat)"}</span>
          </div>
          <div className="provider-note">
            Authentication and models are managed by the <code>{cliName}</code> CLI. The model is
            switched from the chat selector.
          </div>
        </div>
      ) : (
        <div className="provider-meta">
          <div className="provider-note">Requires an ACP adapter to connect (not implemented yet).</div>
        </div>
      )}
    </div>
  );
}

function SecuritySection() {
  const autoApprove = useSettingsStore((s) => s.autoApprovePermissions);
  const setAutoApprove = useSettingsStore((s) => s.setAutoApprovePermissions);
  const permissionLog = useSettingsStore((s) => s.permissionLog);

  return (
    <div className="settings-security">
      <h3 className="settings-section-title"><ShieldAlert size={14} /> Security · Agent permissions</h3>
      <div className="security-row">
        <label className={`security-toggle${autoApprove ? " on" : ""}`} onClick={() => setAutoApprove(!autoApprove)}>
          <span className="security-toggle-dot" />
        </label>
        <div className="security-row-text">
          <div className="security-row-title">Auto-approve permissions in workflows</div>
          <div className="security-row-desc">
            {autoApprove
              ? "⚠️ On: when a workflow runs with no UI to approve, the agent auto-approves its own actions (writing files, running shell). Convenient but risky."
              : "Safe (recommended): with no UI to approve, permission requests are denied. In the chat you're always asked with a modal."}
          </div>
        </div>
      </div>
      {permissionLog.length > 0 && (
        <div className="security-log">
          <div className="security-log-title">Recent automatic decisions</div>
          {permissionLog.slice(0, 8).map((e, i) => (
            <div key={i} className={`security-log-row security-log-row--${e.decision}`}>
              <span className="security-log-decision">{e.decision === "auto-allow" ? "✔ allowed" : "✖ denied"}</span>
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

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2 className="settings-title">AI agents</h2>
        <p className="settings-subtitle">
          DevFlow embeds agents over ACP: authentication and models are managed by each CLI. The active
          model is chosen from the chat.
        </p>
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

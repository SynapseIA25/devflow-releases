import { useState } from "react";
import { CheckCircle, AlertCircle, ShieldAlert, KeyRound, ExternalLink, RotateCw, Leaf } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { ProviderConfig, PROVIDER_KEY_SPECS } from "../lib/providers";
import { ECONOMY_EDITOR_MAX_LINES, type PromptEconomyMode } from "../lib/modelRouter";
import * as acpClient from "../lib/acpClient";

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

// API keys de providers de inferencia: se inyectan como env vars al agente OpenCode al spawnearlo
// (acpClient.providerKeysEnv). Guardar reinicia el proceso de OpenCode para que los modelos del
// provider nuevo aparezcan en el selector del chat en la próxima sesión.
function ApiKeysSection() {
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const setProviderKey = useSettingsStore((s) => s.setProviderKey);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const dirty = PROVIDER_KEY_SPECS.some(
    (spec) => drafts[spec.id] !== undefined && drafts[spec.id] !== (providerKeys[spec.id] ?? "")
  );

  const apply = async () => {
    setApplying(true);
    try {
      for (const spec of PROVIDER_KEY_SPECS) {
        if (drafts[spec.id] !== undefined) setProviderKey(spec.id, drafts[spec.id]);
      }
      setDrafts({});
      // El proceso de OpenCode captura el env al spawnear: lo reiniciamos para que tome las keys
      // nuevas. Las sesiones de chat viejas de ese provider quedan huérfanas → se recrean solas.
      await acpClient.restart("opencode");
      useWorkspaceStore.getState().resetSessions("opencode");
      setAppliedAt(Date.now());
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="settings-apikeys">
      <h3 className="settings-section-title"><KeyRound size={14} /> Inference providers · API keys</h3>
      <p className="apikeys-subtitle">
        Add a key to unlock that provider's models in the OpenCode agent (chat model selector).
        No key at all? OpenCode still includes free models out of the box. Keys are stored locally
        on this machine.
      </p>
      {PROVIDER_KEY_SPECS.map((spec) => {
        const saved = providerKeys[spec.id] ?? "";
        const value = drafts[spec.id] ?? saved;
        return (
          <div key={spec.id} className="apikeys-row">
            <div className="apikeys-info">
              <span className="apikeys-label">{spec.label}</span>
              <a className="apikeys-link" href={spec.keyUrl} target="_blank" rel="noreferrer">
                Get a key <ExternalLink size={10} />
              </a>
              <div className="apikeys-free">{spec.freeTier}</div>
            </div>
            <input
              type="password"
              className="apikeys-input"
              placeholder={spec.placeholder}
              value={value}
              autoComplete="off"
              onChange={(e) => setDrafts((d) => ({ ...d, [spec.id]: e.target.value }))}
            />
            <span className={`apikeys-status ${saved ? "on" : ""}`}>
              {saved ? "configured" : "not set"}
            </span>
          </div>
        );
      })}
      <div className="apikeys-actions">
        <button className="apikeys-save" disabled={!dirty || applying} onClick={apply}>
          {applying ? <RotateCw size={12} className="spin" /> : null}
          {applying ? "Applying…" : "Save & restart OpenCode"}
        </button>
        {appliedAt && !dirty && (
          <span className="apikeys-applied">✓ Applied — new models appear on the next chat session.</span>
        )}
      </div>
    </div>
  );
}

// Economía de prompts: cuándo aplicar los recortes de ahorro de tokens (cap del archivo del editor
// inyectado al prompt, síntesis del equipo más corta). "auto" = solo con modelos remotos.
function EconomySection() {
  const mode = useSettingsStore((s) => s.promptEconomy);
  const setMode = useSettingsStore((s) => s.setPromptEconomy);
  const OPTIONS: { id: PromptEconomyMode; label: string; desc: string }[] = [
    { id: "auto", label: "Auto", desc: "Trim only for remote models — local models cost nothing." },
    { id: "always", label: "Always", desc: "Trim for every model, local included." },
    { id: "off", label: "Off", desc: "Never trim. Full context every turn (more tokens)." },
  ];
  return (
    <div className="settings-economy">
      <h3 className="settings-section-title"><Leaf size={14} /> Token economy</h3>
      <p className="apikeys-subtitle">
        Saves tokens on metered models: caps the editor file injected into the prompt at {ECONOMY_EDITOR_MAX_LINES} lines
        and keeps team synthesis prompts short. Attachments are always capped.
      </p>
      <div className="economy-options">
        {OPTIONS.map((o) => (
          <label key={o.id} className={`economy-option${mode === o.id ? " on" : ""}`}>
            <input type="radio" name="prompt-economy" checked={mode === o.id} onChange={() => setMode(o.id)} />
            <span className="economy-option-label">{o.label}</span>
            <span className="economy-option-desc">{o.desc}</span>
          </label>
        ))}
      </div>
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
      <ApiKeysSection />
      <EconomySection />
      <SecuritySection />
      <div className="providers-grid">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

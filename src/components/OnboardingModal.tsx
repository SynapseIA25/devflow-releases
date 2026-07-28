import { useState } from "react";
import { KeyRound, ExternalLink } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { PROVIDER_KEY_SPECS } from "../lib/providers";

// Wizard de primer arranque (se muestra hasta que settingsStore.onboardingDone). OpenCode viene
// bundleado como sidecar de Tauri (ver providers.ts, scripts/fetch-opencode-sidecar.mjs) — siempre
// disponible, no se detecta ni se lista acá. Claude Code también corre sin instalación aparte (el
// adaptador claude-code-acp trae su propio Claude Agent SDK vía npx) — es 100% opcional y se activa
// pegando una API key acá, igual que OpenRouter (se guarda en providerKeys y se inyecta al proceso
// ACP correspondiente, ver PROVIDER_KEY_SPECS).

function ApiKeyRow({
  specId,
  value,
  onChange,
  note,
}: {
  specId: string;
  value: string;
  onChange: (v: string) => void;
  note: string;
}) {
  const spec = PROVIDER_KEY_SPECS.find((s) => s.id === specId)!;
  return (
    <div className="onb-key">
      <div className="onb-key-title">
        <KeyRound size={13} /> {spec.label} API key <span className="onb-optional">optional</span>
      </div>
      <p className="onb-key-note">
        {note}{" "}
        <a href={spec.keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={9} /></a>
      </p>
      <input
        type="password"
        className="apikeys-input"
        placeholder={spec.placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function OnboardingModal() {
  const setOnboardingDone = useSettingsStore((s) => s.setOnboardingDone);
  const setProviderKey = useSettingsStore((s) => s.setProviderKey);
  const [claudeKey, setClaudeKey] = useState("");
  const [orKey, setOrKey] = useState("");

  const finish = () => {
    if (claudeKey.trim()) setProviderKey("anthropic", claudeKey);
    if (orKey.trim()) setProviderKey("openrouter", orKey);
    setOnboardingDone(true);
  };

  return (
    <div className="onb-overlay">
      <div className="onb-modal">
        <h2 className="onb-title">Welcome to DevFlow</h2>
        <p className="onb-sub">
          DevFlow comes with a coding agent, DevFlow Code, built in — nothing to install, just
          start chatting. Optionally, paste API keys below to unlock more agents/models. You can
          also do this later in Settings.
        </p>

        <ApiKeyRow
          specId="anthropic"
          value={claudeKey}
          onChange={setClaudeKey}
          note="Paste a key to enable the Claude Code agent."
        />
        <ApiKeyRow
          specId="openrouter"
          value={orKey}
          onChange={setOrKey}
          note="Paste a key and DevFlow Code will list those models in the chat."
        />

        <div className="onb-actions">
          <button className="onb-start" onClick={finish}>
            Start using DevFlow
          </button>
        </div>
      </div>
    </div>
  );
}

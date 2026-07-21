import { useEffect, useState } from "react";
import { CheckCircle, XCircle, RotateCw, KeyRound, ExternalLink, Copy, Check, Download } from "lucide-react";
import { checkCli, installCli } from "../lib/tauriApi";
import { useSettingsStore } from "../store/settingsStore";
import { PROVIDER_KEY_SPECS } from "../lib/providers";

// Wizard de primer arranque (se muestra hasta que settingsStore.onboardingDone). OpenCode viene
// bundleado como sidecar de Tauri (ver providers.ts, scripts/fetch-opencode-sidecar.mjs) — siempre
// disponible, no se detecta ni se lista acá. Este wizard solo cubre los agentes OPCIONALES que
// requieren cuenta propia (Claude Code, MiMo): detecta qué hay instalado (check_cli, `<cli>
// --version`), y deja instalar Claude Code con un click (install_cli → `npm install -g <pkg>`) o
// copiar el comando a mano; MiMo no tiene instalador npm, solo link a docs. También deja pegar una
// API key de OpenRouter (se guarda en providerKeys y se inyecta a OpenCode al spawnearlo).
type AgentRow = {
  cli: string;
  name: string;
  icon: string;
  color: string;
  note: string;
  install?: string; // comando de instalación copiable; ausente = solo link a docs
  npmPackage?: string; // nombre de paquete npm para el botón "Install"; ausente = sin auto-install
  docsUrl: string;
};

const AGENT_ROWS: AgentRow[] = [
  {
    cli: "claude",
    name: "Claude Code",
    icon: "◈",
    color: "#d4a574",
    note: "Anthropic's agent. After installing, sign in once with `claude /login`.",
    install: "npm install -g @anthropic-ai/claude-code",
    npmPackage: "@anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com",
  },
  {
    cli: "mimo",
    name: "MiMo Code",
    icon: "⬡",
    color: "#f97316",
    note: "Xiaomi's coding agent — requires a Xiaomi account. See the docs for installation.",
    docsUrl: "https://mimo.xiaomi.com/coder",
  },
];

function InstallCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <code className="onb-install">
      {cmd}
      <button className="onb-copy" onClick={copy} title="Copy">
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </code>
  );
}

export function OnboardingModal() {
  const setOnboardingDone = useSettingsStore((s) => s.setOnboardingDone);
  const setProviderKey = useSettingsStore((s) => s.setProviderKey);
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [checking, setChecking] = useState(false);
  const [orKey, setOrKey] = useState("");
  const [installing, setInstalling] = useState<string | null>(null); // cli en curso de instalación
  const [installError, setInstallError] = useState<Record<string, string>>({});

  const runDetection = async () => {
    setChecking(true);
    try {
      setStatus(await checkCli(AGENT_ROWS.map((a) => a.cli)));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    runDetection();
  }, []);

  const openrouter = PROVIDER_KEY_SPECS.find((s) => s.id === "openrouter")!;

  const doInstall = async (a: AgentRow) => {
    if (!a.npmPackage) return;
    setInstalling(a.cli);
    setInstallError((e) => ({ ...e, [a.cli]: "" }));
    try {
      await installCli(a.npmPackage);
      await runDetection();
    } catch (err) {
      setInstallError((e) => ({ ...e, [a.cli]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setInstalling(null);
    }
  };

  const finish = () => {
    if (orKey.trim()) setProviderKey("openrouter", orKey);
    setOnboardingDone(true);
  };

  return (
    <div className="onb-overlay">
      <div className="onb-modal">
        <h2 className="onb-title">Welcome to DevFlow</h2>
        <p className="onb-sub">
          DevFlow comes with a coding agent (OpenCode) built in — nothing to install, just start
          chatting. Optionally, add these agents too if you have your own account:
        </p>

        <div className="onb-agents">
          {AGENT_ROWS.map((a) => {
            const found = status?.[a.cli];
            const isInstalling = installing === a.cli;
            return (
              <div key={a.cli} className="onb-agent">
                <span className="onb-agent-icon" style={{ color: a.color }}>{a.icon}</span>
                <div className="onb-agent-info">
                  <div className="onb-agent-name">
                    {a.name}
                    <a className="onb-agent-docs" href={a.docsUrl} target="_blank" rel="noreferrer">
                      docs <ExternalLink size={9} />
                    </a>
                  </div>
                  <div className="onb-agent-note">{a.note}</div>
                  {status !== null && !found && a.install && (
                    <div className="onb-install-row">
                      <InstallCmd cmd={a.install} />
                      {a.npmPackage && (
                        <button className="onb-install-btn" disabled={isInstalling} onClick={() => doInstall(a)}>
                          {isInstalling ? <RotateCw size={11} className="spin" /> : <Download size={11} />}
                          {isInstalling ? "Installing…" : "Install"}
                        </button>
                      )}
                    </div>
                  )}
                  {installError[a.cli] && <div className="onb-install-error">{installError[a.cli]}</div>}
                </div>
                <span className={`onb-agent-status ${found ? "ok" : ""}`}>
                  {status === null ? (
                    <RotateCw size={13} className="spin" />
                  ) : found ? (
                    <><CheckCircle size={13} /> installed</>
                  ) : (
                    <><XCircle size={13} /> not found</>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="onb-key">
          <div className="onb-key-title"><KeyRound size={13} /> OpenRouter API key <span className="onb-optional">optional</span></div>
          <p className="onb-key-note">
            {openrouter.freeTier} Paste a key and the OpenCode agent will list those models in the
            chat. You can also do this later in Settings.{" "}
            <a href={openrouter.keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={9} /></a>
          </p>
          <input
            type="password"
            className="apikeys-input"
            placeholder={openrouter.placeholder}
            value={orKey}
            autoComplete="off"
            onChange={(e) => setOrKey(e.target.value)}
          />
        </div>

        <div className="onb-actions">
          <button className="onb-recheck" disabled={checking} onClick={runDetection}>
            <RotateCw size={12} className={checking ? "spin" : ""} /> Re-check
          </button>
          <button className="onb-start" onClick={finish}>
            Start using DevFlow
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, RotateCw, KeyRound, ExternalLink, Copy, Check } from "lucide-react";
import { checkCli } from "../lib/tauriApi";
import { useSettingsStore } from "../store/settingsStore";
import { PROVIDER_KEY_SPECS } from "../lib/providers";

// Wizard de primer arranque (se muestra hasta que settingsStore.onboardingDone). DevFlow es un host
// de agentes ACP: sin al menos un CLI de agente instalado el chat no funciona. El wizard detecta qué
// CLIs hay (check_cli en Rust, `<cli> --version`), muestra cómo instalar los que faltan, y deja pegar
// una API key de OpenRouter (se guarda en providerKeys y se inyecta a OpenCode al spawnearlo).
type AgentRow = {
  cli: string;
  name: string;
  icon: string;
  color: string;
  note: string;
  install?: string; // comando de instalación copiable; ausente = solo link a docs
  docsUrl: string;
};

const AGENT_ROWS: AgentRow[] = [
  {
    cli: "opencode",
    name: "OpenCode",
    icon: "◎",
    color: "#10b981",
    note: "Recommended to start — free models out of the box, and multi-LLM with an API key (OpenRouter, Gemini, Groq…).",
    install: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai/docs",
  },
  {
    cli: "claude",
    name: "Claude Code",
    icon: "◈",
    color: "#d4a574",
    note: "Anthropic's agent. After installing, sign in once with `claude /login`.",
    install: "npm install -g @anthropic-ai/claude-code",
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
  const anyAgent = status !== null && AGENT_ROWS.some((a) => status[a.cli]);

  const finish = () => {
    if (orKey.trim()) setProviderKey("openrouter", orKey);
    setOnboardingDone(true);
  };

  return (
    <div className="onb-overlay">
      <div className="onb-modal">
        <h2 className="onb-title">Welcome to DevFlow</h2>
        <p className="onb-sub">
          DevFlow orchestrates coding agents (chat, workflows, expert team). It needs at least one
          agent CLI installed on this machine — here's what we found:
        </p>

        <div className="onb-agents">
          {AGENT_ROWS.map((a) => {
            const found = status?.[a.cli];
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
                  {status !== null && !found && a.install && <InstallCmd cmd={a.install} />}
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
            {anyAgent ? "Start using DevFlow" : "Continue anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}

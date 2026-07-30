import { useEffect, useState } from "react";
import { CheckCircle, AlertCircle, ShieldAlert, KeyRound, ExternalLink, RotateCw, Leaf, Gauge, Code2, Download, Search, Sparkles, HardDrive, Cloud, Info } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pkg from "../../package.json";
import thirdPartyNotices from "../../NOTICE.md?raw";
import { AddModelModal } from "../components/AddModelModal";
import { useSettingsStore } from "../store/settingsStore";
import { useQuotaStore, DAILY_BUDGETS } from "../store/quotaStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useProjectStore } from "../store/projectStore";
import { ProviderConfig, PROVIDER_KEY_SPECS } from "../lib/providers";
import { ECONOMY_EDITOR_MAX_LINES, AUTO_MODEL, type PromptEconomyMode } from "../lib/modelRouter";
import * as opencodeClient from "../lib/opencodeClient";
import * as acpClient from "../lib/acpClient";
import type { ModelOption } from "../lib/acpClient";
import { checkCli, installCli, rustAnalyzerPath, installRustAnalyzer, ollamaCheck, ollamaPullModel } from "../lib/tauriApi";
import { buildIndex, readIndexStatus, type BuildProgress } from "../lib/ragIndex";
import { EMBED_MODEL } from "../lib/ragEngine";

// Elegir el modelo por default de un provider desde Settings, en vez de solo poder hacerlo ad-hoc
// en el selector del chat (mismo modelByProvider que lee ese selector — ver ChatView.tsx). Solo
// OpenCode tiene un endpoint liviano para listar modelos SIN abrir sesión (opencodeClient.
// listAvailableModels, ~50ms contra /config/providers); Claude Code (ACP) solo expone su catálogo
// dentro de la respuesta de session/new, así que para ese provider no hay nada barato que listar
// acá — se deja como texto libre (el usuario escribe el model id de Claude que quiera, o lo deja
// vacío para el default del agente).
function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const modelByProvider = useSettingsStore((s) => s.modelByProvider);
  const setModelForProvider = useSettingsStore((s) => s.setModelForProvider);
  const currentModel = useSettingsStore((s) => s.currentModelByProvider[provider.id]);
  const connected = !!provider.acp || !!provider.nativeHttp;
  // "npx" en sí no dice nada (es el wrapper, no el adaptador real) — mostrar el último arg, que es
  // el paquete que npx efectivamente corre (ej. "@zed-industries/claude-code-acp").
  const cliName =
    provider.acp?.command === "npx" ? provider.acp.args[provider.acp.args.length - 1] : provider.acp?.command.split(/[\\/]/).pop();
  const canListModels = !!provider.nativeHttp;

  const [catalog, setCatalog] = useState<ModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const preferred = modelByProvider[provider.id] ?? "";

  const fetchModels = async () => {
    if (!canListModels) return;
    setLoadingModels(true);
    try {
      setCatalog(await opencodeClient.listAvailableModels(provider.id));
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => { if (canListModels) void fetchModels(); }, [canListModels, provider.id]);

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <div className="provider-dot" style={{ background: provider.color }} />
        <div className="provider-card-info">
          <div className="provider-card-name">{provider.name}</div>
          <div className="provider-card-desc">{provider.description}</div>
        </div>
        <div className={`provider-status ${connected ? "enabled" : "disabled"}`}>
          {connected ? <><CheckCircle size={12} /> {provider.nativeHttp ? "Native" : "ACP"}</> : <><AlertCircle size={12} /> Not connected</>}
        </div>
      </div>

      {connected ? (
        <div className="provider-meta">
          <div className="provider-meta-row">
            <span className="provider-label">Default model</span>
            <div className="provider-model-control">
              {canListModels ? (
                <select
                  className="provider-model-select"
                  value={preferred || AUTO_MODEL}
                  onChange={(e) => setModelForProvider(provider.id, e.target.value)}
                >
                  <option value={AUTO_MODEL}>✨ Auto — free model per task</option>
                  {(catalog ?? []).map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="provider-model-input"
                  placeholder="e.g. claude-sonnet-4-6 — empty uses the agent's own default"
                  value={preferred}
                  onChange={(e) => setModelForProvider(provider.id, e.target.value)}
                />
              )}
              {canListModels && (
                <button className="proj-icon" onClick={() => void fetchModels()} disabled={loadingModels} title="Refresh model list">
                  <RotateCw size={11} className={loadingModels ? "spin" : ""} />
                </button>
              )}
            </div>
          </div>
          {canListModels && (
            <div className="provider-note">
              {loadingModels ? "Loading models…" : `${(catalog ?? []).length} model(s) available with your current keys.`}
            </div>
          )}
          <div className="provider-meta-row">
            <span className="provider-label">Currently running</span>
            <span className="provider-meta-val">{currentModel ?? "— (starts on the first chat message)"}</span>
          </div>
          {!provider.nativeHttp && (
            <div className="provider-note">Authentication is managed by the <code>{cliName}</code> adapter (API key, see Cloud API keys below).</div>
          )}
        </div>
      ) : (
        <div className="provider-meta">
          <div className="provider-note">Requires an ACP adapter to connect (not implemented yet).</div>
        </div>
      )}
    </div>
  );
}

// Punto único de "cómo conecto un modelo" en Settings: hoy estaba repartido en 3 lugares sin
// relación entre sí (esta sección solo mostraba las cloud keys; conectar un server local o buscar
// en el catálogo de models.dev solo era alcanzable escondido en "Buscar más modelos…" del selector
// de modelo del chat, ver AddModelModal). Acá se explican los 3 niveles juntos y se reusa el mismo
// AddModelModal para local/catálogo en vez de duplicar esa lógica.
//
// API keys de providers de inferencia: se inyectan como env vars al agente OpenCode al spawnearlo
// (acpClient.providerKeysEnv). Guardar reinicia el proceso de OpenCode para que los modelos del
// provider nuevo aparezcan en el selector del chat en la próxima sesión.
function ModelsSection() {
  const providers = useSettingsStore((s) => s.providers);
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const setProviderKey = useSettingsStore((s) => s.setProviderKey);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);
  const [showAddModelModal, setShowAddModelModal] = useState(false);

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
      // Los procesos agente capturan el env al spawnear: reiniciamos ambos para que tomen las keys
      // nuevas (OpenCode vía su servidor HTTP+SSE, Claude Code vía ACP genérico). Las sesiones de
      // chat viejas de esos providers quedan huérfanas → se recrean solas.
      await opencodeClient.restart("opencode");
      await acpClient.restart("anthropic");
      useWorkspaceStore.getState().resetSessions("opencode");
      useWorkspaceStore.getState().resetSessions("anthropic");
      setAppliedAt(Date.now());
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="settings-apikeys">
      <h3 className="settings-section-title"><KeyRound size={14} /> Models</h3>
      <p className="apikeys-subtitle">
        Three ways to bring a model into DevFlow — from zero setup to full control. They're not
        exclusive: use as many as you want at once.
      </p>
      <div className="models-tiers">
        <div className="models-tier">
          <div className="models-tier-head"><Sparkles size={13} /> Free &amp; built-in</div>
          <p className="models-tier-desc">
            DevFlow Code works right away with free models — nothing to configure, nothing to pay.
          </p>
        </div>
        <div className="models-tier">
          <div className="models-tier-head"><HardDrive size={13} /> Local (free, on your machine)</div>
          <p className="models-tier-desc">
            Ollama, LM Studio, or any OpenAI-compatible server — DevFlow finds the models it serves.
          </p>
        </div>
        <div className="models-tier">
          <div className="models-tier-head"><Cloud size={13} /> Cloud API keys</div>
          <p className="models-tier-desc">
            Pay-as-you-go with a provider of your own — more models, or the Claude Code agent.
          </p>
        </div>
      </div>
      <button className="apikeys-save apikeys-save--ghost" onClick={() => setShowAddModelModal(true)}>
        <Search size={12} /> Connect a local model or browse the full catalog…
      </button>
      {showAddModelModal && (
        <AddModelModal onClose={() => setShowAddModelModal(false)} onAdded={() => {}} />
      )}

      <h4 className="settings-subsection-title">Cloud API keys</h4>
      <p className="apikeys-subtitle">
        Add a key to enable that provider — Anthropic unlocks the Claude Code agent, the rest add
        models to DevFlow Code's chat model selector. Keys are stored locally on this machine.
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
          {applying ? "Applying…" : "Save & restart agents"}
        </button>
        {appliedAt && !dirty && (
          <span className="apikeys-applied">✓ Applied — new models appear on the next chat session.</span>
        )}
      </div>

      <h4 className="settings-subsection-title">Default model per agent</h4>
      <p className="apikeys-subtitle">
        Set which model each agent starts with — the same choice you'd otherwise only make ad-hoc
        from the chat's model selector. Takes effect on the next new chat session for that agent.
      </p>
      <div className="providers-grid">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>

      <QuotaSection />
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

// Uso de hoy contra los tiers gratis + budgets diarios editables. Los contadores son la aproximación
// LOCAL del quotaStore (los providers no exponen la cuota restante por ACP): se resetean a medianoche
// y el router deja de elegir un provider cuando llega a su budget. Budget vacío = default; sin default
// (zen/local) = sin límite.
function QuotaSection() {
  const day = useQuotaStore((s) => s.day);
  const counts = useQuotaStore((s) => s.counts);
  const overrides = useQuotaStore((s) => s.budgetOverrides);
  const cooldownUntil = useQuotaStore((s) => s.cooldownUntil);
  const setBudgetOverride = useQuotaStore((s) => s.setBudgetOverride);
  const resetToday = useQuotaStore((s) => s.resetToday);

  const isToday = day === new Date().toISOString().slice(0, 10);
  const known = Object.keys(DAILY_BUDGETS);
  const extras = [...new Set([...Object.keys(counts), ...Object.keys(overrides)])]
    .filter((p) => !known.includes(p))
    .sort();
  const rows = [...known, ...extras];
  const anyUse = rows.some((p) => isToday && (counts[p] ?? 0) > 0);

  return (
    <div className="settings-quota settings-quota--nested">
      <h4 className="settings-subsection-title"><Gauge size={14} /> Free-tier quotas · today's usage & budgets</h4>
      <p className="apikeys-subtitle">
        Requests counted locally per inference provider (providers don't expose remaining quota over ACP).
        The model router skips a provider once it hits its daily budget. Counters reset at local midnight.
        Leave a budget empty to use the default — no default means no limit.
      </p>
      {rows.map((p) => {
        const used = isToday ? counts[p] ?? 0 : 0;
        const budget = overrides[p] ?? DAILY_BUDGETS[p];
        const pct = budget ? Math.min(100, (used / budget) * 100) : 0;
        const cooling = (cooldownUntil[p] ?? 0) > Date.now();
        return (
          <div key={p} className="quota-row">
            <span className="quota-name">{p}</span>
            <div className="quota-bar" title={budget !== undefined ? `${used} / ${budget} requests today` : `${used} requests today (no limit)`}>
              {budget !== undefined && (
                <div
                  className={`quota-bar-fill${pct >= 100 ? " full" : pct >= 80 ? " warn" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            <span className="quota-used">{used}{budget !== undefined ? ` / ${budget}` : " · no limit"}</span>
            <input
              type="number"
              min={0}
              className="quota-input"
              placeholder={DAILY_BUDGETS[p] !== undefined ? String(DAILY_BUDGETS[p]) : "∞"}
              value={overrides[p] ?? ""}
              onChange={(e) => setBudgetOverride(p, e.target.value === "" ? null : Number(e.target.value))}
              title="Daily request budget for this provider (empty = default)"
            />
            {cooling && (
              <span className="quota-cooldown" title="Rate-limited recently — the router skips it until then">
                cooldown · {new Date(cooldownUntil[p]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {p === "openrouter" && overrides[p] === undefined && (
              <button
                className="quota-hint-btn"
                title="If your OpenRouter account ever bought $10 in credits, the free tier is 1000 req/day — raise the budget to 900."
                onClick={() => setBudgetOverride(p, 900)}
              >
                paid tier? → 900
              </button>
            )}
          </div>
        );
      })}
      <div className="quota-actions">
        <button className="quota-reset" disabled={!anyUse} onClick={resetToday}>
          Reset today's counters
        </button>
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
              ? "⚠️ On: when a workflow runs unattended (a trigger or a Planner task, no UI open on it), the agent's own actions AND the workflow's own file-write/terminal nodes auto-approve. Convenient but risky."
              : "Safe (recommended): unattended runs (triggers, Planner) deny agent actions and the workflow's file-write/terminal nodes. In the chat, or running a workflow yourself from its canvas, you're always asked with a modal (or it's already you who pressed Run)."}
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

// RAG (retrieval-augmented generation) sobre el proyecto activo — embeddings locales vía Ollama,
// índice plano en .devflow/rag-index.json, búsqueda por coseno en Rust (ver ragEngine.ts/ragIndex.ts
// /rag.rs). Reconstrucción manual acá; el toggle de uso en el chat vive en el mismo lugar porque son
// la misma feature, no dos.
function RagSection() {
  const ragEnabled = useSettingsStore((s) => s.ragEnabled);
  const setRagEnabled = useSettingsStore((s) => s.setRagEnabled);
  const projectPath = useProjectStore((s) => s.projects[s.activeId]?.path);

  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState<{ exists: boolean; chunkCount?: number; builtAt?: number } | null>(null);
  const [building, setBuilding] = useState<BuildProgress | null>(null);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!projectPath) return;
    setOllamaOk(await ollamaCheck());
    setStatus(await readIndexStatus(projectPath));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const doBuild = async () => {
    if (!projectPath) return;
    setError(null);
    setBuilding({ stage: "scanning", done: 0, total: 0 });
    try {
      await buildIndex(projectPath, setBuilding);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(null);
    }
  };

  const doPull = async () => {
    setPulling(true);
    setError(null);
    try {
      await ollamaPullModel(EMBED_MODEL);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="settings-security">
      <h3 className="settings-section-title"><Search size={14} /> RAG · search over the project's code</h3>
      <p className="apikeys-subtitle">
        Grounds chat and Specs in the project's actual code via local embeddings (Ollama, {EMBED_MODEL}) — no
        cloud API involved. Build the index once, rebuild after big changes.
      </p>
      <div className="security-row">
        <label className={`security-toggle${ragEnabled ? " on" : ""}`} onClick={() => setRagEnabled(!ragEnabled)}>
          <span className="security-toggle-dot" />
        </label>
        <div className="security-row-text">
          <div className="security-row-title">Use RAG in the chat</div>
          <div className="security-row-desc">
            {ragEnabled
              ? "On: every message includes the most relevant existing code found by semantic search."
              : "Off: only manually attached files/folders are sent as context (as before)."}
          </div>
        </div>
      </div>
      <div className="apikeys-row">
        <div className="apikeys-info">
          <span className="apikeys-label">Ollama</span>
          <div className="apikeys-free">
            {ollamaOk === null ? "checking…" : ollamaOk ? "detected" : "not found — install Ollama first"}
          </div>
        </div>
        {ollamaOk && (
          <button className="onb-install-btn" disabled={pulling} onClick={doPull}>
            {pulling ? <RotateCw size={11} className="spin" /> : <Download size={11} />}
            {pulling ? "Pulling…" : `Pull ${EMBED_MODEL}`}
          </button>
        )}
      </div>
      <div className="apikeys-row">
        <div className="apikeys-info">
          <span className="apikeys-label">Index — {projectPath ?? "no project"}</span>
          <div className="apikeys-free">
            {building
              ? `${building.stage} · ${building.done}/${building.total || "?"}`
              : status?.exists
              ? `${status.chunkCount} chunks · built ${status.builtAt ? new Date(status.builtAt).toLocaleString() : "?"}`
              : "not built yet"}
          </div>
          {error && <div className="onb-install-error">{error}</div>}
        </div>
        <button className="onb-install-btn" disabled={!!building || !ollamaOk} onClick={doBuild}>
          {building ? <RotateCw size={11} className="spin" /> : <Search size={11} />}
          {building ? "Building…" : status?.exists ? "Rebuild index" : "Build index"}
        </button>
      </div>
    </div>
  );
}

// Detección/instalación de los language servers reales que potencian hover/autocompletado/find-
// references en el editor de código (ver lspClient.ts) — no tiene nada que ver con los agentes de
// chat de arriba. typescript-language-server es un paquete npm (reusa check_cli/install_cli tal
// cual); rust-analyzer se instala vía rustup component, así que tiene su propio par de comandos.
type LspRowId = "ts" | "rust";
const LSP_ROWS: { id: LspRowId; label: string; note: string }[] = [
  {
    id: "ts",
    label: "TypeScript / JavaScript",
    note: "typescript-language-server (npm) — hover, autocomplete and find-references for .ts/.tsx/.js/.jsx in the editor.",
  },
  {
    id: "rust",
    label: "Rust",
    note: "rust-analyzer (rustup component) — hover, autocomplete and find-references for .rs in the editor.",
  },
];

function LanguageServersSection() {
  const [status, setStatus] = useState<Record<LspRowId, boolean> | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<LspRowId | null>(null);
  const [installError, setInstallError] = useState<Record<string, string>>({});

  const runDetection = async () => {
    setChecking(true);
    try {
      const [tsFound, rustPath] = await Promise.all([
        checkCli(["typescript-language-server"]),
        rustAnalyzerPath(),
      ]);
      setStatus({ ts: !!tsFound["typescript-language-server"], rust: !!rustPath });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runDetection();
  }, []);

  const doInstall = async (id: LspRowId) => {
    setInstalling(id);
    setInstallError((e) => ({ ...e, [id]: "" }));
    try {
      if (id === "ts") await installCli("typescript-language-server");
      else await installRustAnalyzer();
      await runDetection();
    } catch (err) {
      setInstallError((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="settings-apikeys">
      <h3 className="settings-section-title"><Code2 size={14} /> Language servers · editor intelligence</h3>
      <p className="apikeys-subtitle">
        Powers real hover tooltips, autocomplete, and find-references in the code editor (separate from the chat
        agents above). Detected on load — install a missing one with one click, or re-check after installing it
        yourself.
      </p>
      {LSP_ROWS.map((row) => {
        const found = status?.[row.id];
        return (
          <div key={row.id} className="apikeys-row">
            <div className="apikeys-info">
              <span className="apikeys-label">{row.label}</span>
              <div className="apikeys-free">{row.note}</div>
              {installError[row.id] && <div className="onb-install-error">{installError[row.id]}</div>}
            </div>
            <span className={`apikeys-status ${found ? "on" : ""}`}>
              {checking ? "checking…" : found ? "installed" : "not found"}
            </span>
            {!checking && !found && (
              <button className="onb-install-btn" disabled={installing === row.id} onClick={() => doInstall(row.id)}>
                {installing === row.id ? <RotateCw size={11} className="spin" /> : <Download size={11} />}
                {installing === row.id ? "Installing…" : "Install"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AboutSection() {
  const [showNotices, setShowNotices] = useState(false);
  return (
    <div className="settings-apikeys">
      <h3 className="settings-section-title"><Info size={14} /> About</h3>
      <p className="apikeys-subtitle">DevFlow v{pkg.version}</p>
      <button className="apikeys-save apikeys-save--ghost" onClick={() => setShowNotices((v) => !v)}>
        {showNotices ? "Hide" : "Show"} third-party notices
      </button>
      {showNotices && (
        <div className="proj-md about-notices">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{thirdPartyNotices}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2 className="settings-title">AI agents</h2>
        <p className="settings-subtitle">
          DevFlow embeds agents over ACP: authentication is managed by each provider. Set a default
          model per agent below, or override it ad-hoc from the chat's model selector.
        </p>
      </div>
      <ModelsSection />
      <EconomySection />
      <SecuritySection />
      <RagSection />
      <LanguageServersSection />
      <AboutSection />
    </div>
  );
}

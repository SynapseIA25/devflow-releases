import { useEffect, useMemo, useState } from "react";
import { Search, Plus, RotateCw, AlertCircle, CheckCircle2, Server } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { PROVIDER_KEY_SPECS } from "../lib/providers";
import * as opencodeClient from "../lib/opencodeClient";
import {
  type CatalogModel,
  fetchModelCatalog,
  searchCatalog,
  addModelToOpencodeConfig,
} from "../lib/modelCatalog";
import {
  type LocalModel,
  LOCAL_PROVIDER_PRESETS,
  discoverLocalModels,
  addLocalProviderToOpencodeConfig,
} from "../lib/localProviders";

function fmtCost(m: CatalogModel): string {
  if (m.costInput == null && m.costOutput == null) return "free / n.d.";
  const parts: string[] = [];
  if (m.costInput != null) parts.push(`$${m.costInput}/M in`);
  if (m.costOutput != null) parts.push(`$${m.costOutput}/M out`);
  return parts.join(" · ");
}

function fmtContext(m: CatalogModel): string {
  if (!m.context) return "";
  if (m.context >= 1_000_000) return `${(m.context / 1_000_000).toFixed(1)}M ctx`;
  return `${Math.round(m.context / 1000)}K ctx`;
}

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "local";
}

const DEFAULT_CUSTOM_LABEL = "Local server";

type Mode = "catalog" | "local";

// Buscador de modelos: agrega cualquier modelo de models.dev al config de OpenCode sin editar JSON a
// mano (ver lib/modelCatalog.ts), o conecta un motor de inferencia local (Ollama, LM Studio, u otro
// server OpenAI-compatible) vía lib/localProviders.ts. Solo aplica al provider "opencode" —
// MiMo/Claude Code gestionan su propio modelo desde su CLI.
export function AddModelModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded?: () => void;
}) {
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const [mode, setMode] = useState<Mode>("catalog");

  // Modo catálogo
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modo server local
  const [presetId, setPresetId] = useState<string>(LOCAL_PROVIDER_PRESETS[0].id);
  const [baseUrl, setBaseUrl] = useState(LOCAL_PROVIDER_PRESETS[0].defaultBaseUrl);
  const [customLabel, setCustomLabel] = useState("");
  const [localModels, setLocalModels] = useState<LocalModel[] | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Compartido: agregar un modelo al config y reiniciar
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchModelCatalog()
      .then((c) => { if (!cancelled) setCatalog(c); })
      .catch((e) => { if (!cancelled) setLoadError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(() => (catalog ? searchCatalog(catalog, query) : []), [catalog, query]);
  const keyLabel = (providerId: string) => PROVIDER_KEY_SPECS.find((s) => s.id === providerId)?.label ?? providerId;
  const hasKey = (providerId: string) => !!providerKeys[providerId];

  const selectPreset = (id: string) => {
    setPresetId(id);
    setLocalModels(null);
    setLocalError(null);
    const preset = LOCAL_PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset) setBaseUrl(preset.defaultBaseUrl);
  };

  const localProviderId = presetId === "custom" ? slugify(customLabel) : presetId;
  const localProviderLabel =
    presetId === "custom" ? customLabel.trim() || DEFAULT_CUSTOM_LABEL : LOCAL_PROVIDER_PRESETS.find((p) => p.id === presetId)?.label ?? presetId;

  const scanLocal = async () => {
    setLocalLoading(true);
    setLocalError(null);
    setLocalModels(null);
    try {
      setLocalModels(await discoverLocalModels(baseUrl));
    } catch (e: any) {
      setLocalError(String(e?.message ?? e));
    } finally {
      setLocalLoading(false);
    }
  };

  const commit = async (providerId: string, modelId: string, write: () => Promise<void>) => {
    const key = `${providerId}/${modelId}`;
    setAddingKey(key);
    setAddError(null);
    try {
      await write();
      setRestarting(true);
      // Reiniciamos OpenCode para que la próxima sesión lea el config nuevo (mismo patrón que
      // "Save & restart" al guardar API keys) y dejamos ese modelo pre-elegido para esa sesión.
      useSettingsStore.getState().setModelForProvider("opencode", key);
      await opencodeClient.restart("opencode");
      useWorkspaceStore.getState().resetSessions("opencode");
      setAddedKey(key);
      onAdded?.();
    } catch (e: any) {
      setAddError(String(e?.message ?? e));
    } finally {
      setRestarting(false);
      setAddingKey(null);
    }
  };

  const addCatalogModel = (m: CatalogModel) =>
    commit(m.providerId, m.modelId, () => addModelToOpencodeConfig(m));

  const addLocalModel = (m: LocalModel) =>
    commit(localProviderId, m.id, () =>
      addLocalProviderToOpencodeConfig(localProviderId, localProviderLabel, baseUrl, [m])
    );

  return (
    <div className="model-search-overlay" onClick={onClose}>
      <div className="model-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-search-header">
          <span className="model-search-title">Search models</span>
          <button className="model-search-close" onClick={onClose}>×</button>
        </div>
        <div className="model-search-body">
          <div className="model-search-modetoggle">
            <button
              className={`model-search-modebtn ${mode === "catalog" ? "active" : ""}`}
              onClick={() => setMode("catalog")}
            >
              <Search size={12} /> Catalog
            </button>
            <button
              className={`model-search-modebtn ${mode === "local" ? "active" : ""}`}
              onClick={() => setMode("local")}
            >
              <Server size={12} /> Local server
            </button>
          </div>

          {addError && (
            <div className="model-search-status model-search-status--error">
              <AlertCircle size={12} /> {addError}
            </div>
          )}

          {mode === "catalog" ? (
            <>
              <p className="model-search-hint">
                Full catalog from OpenRouter, Google, Groq and Mistral (models.dev) — not just DevFlow
                Code's curated list. Adding a model edits your config for you and restarts DevFlow
                Code.
              </p>
              <div className="model-search-inputrow">
                <Search size={13} />
                <input
                  autoFocus
                  className="model-search-input"
                  placeholder="e.g. kimi, gemini flash, deepseek…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {loading && <div className="model-search-status">Loading catalog…</div>}
              {loadError && (
                <div className="model-search-status model-search-status--error">
                  <AlertCircle size={12} /> Couldn't load the catalog: {loadError}
                </div>
              )}
              {!loading && !loadError && (
                <div className="model-search-results">
                  {results.length === 0 && <div className="model-search-empty">No results.</div>}
                  {results.map((m) => {
                    const key = `${m.providerId}/${m.modelId}`;
                    return (
                      <div key={key} className="model-search-row">
                        <div className="model-search-row-info">
                          <span className="model-search-row-name">{m.name}</span>
                          <span className="model-search-row-meta">
                            {keyLabel(m.providerId)} · {fmtCost(m)}{fmtContext(m) ? ` · ${fmtContext(m)}` : ""}
                            {!hasKey(m.providerId) && <span className="model-search-nokey"> · no key configured</span>}
                          </span>
                        </div>
                        {addedKey === key ? (
                          <span className="model-search-added"><CheckCircle2 size={13} /> Added</span>
                        ) : (
                          <button
                            className="model-search-add"
                            disabled={addingKey === key}
                            onClick={() => addCatalogModel(m)}
                          >
                            {addingKey === key
                              ? <RotateCw size={12} className="spin" />
                              : <Plus size={12} />}
                            {addingKey === key ? (restarting ? "Restarting…" : "Adding…") : "Add"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="model-search-hint">
                Connect a local inference engine (Ollama, LM Studio, or any OpenAI-compatible
                server) — DevFlow Code adds it as a provider and makes it selectable from the
                model selector.
              </p>
              <div className="model-search-presets">
                {LOCAL_PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`model-search-modebtn ${presetId === p.id ? "active" : ""}`}
                    onClick={() => selectPreset(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  className={`model-search-modebtn ${presetId === "custom" ? "active" : ""}`}
                  onClick={() => selectPreset("custom")}
                >
                  Custom
                </button>
              </div>
              {presetId === "custom" && (
                <div className="model-search-inputrow">
                  <input
                    className="model-search-input"
                    placeholder={`Name (e.g. My ${DEFAULT_CUSTOM_LABEL.toLowerCase()})`}
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                  />
                </div>
              )}
              <div className="model-search-inputrow">
                <input
                  className="model-search-input"
                  placeholder="http://localhost:11434/v1"
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setLocalModels(null); setLocalError(null); }}
                />
                <button className="model-search-add" disabled={localLoading || !baseUrl.trim()} onClick={scanLocal}>
                  {localLoading ? <RotateCw size={12} className="spin" /> : <Search size={12} />}
                  {localLoading ? "Searching…" : "Search models"}
                </button>
              </div>
              {localError && (
                <div className="model-search-status model-search-status--error">
                  <AlertCircle size={12} /> {localError}
                </div>
              )}
              {localModels && (
                <div className="model-search-results">
                  {localModels.length === 0 && <div className="model-search-empty">The server didn't return any models.</div>}
                  {localModels.map((m) => {
                    const key = `${localProviderId}/${m.id}`;
                    return (
                      <div key={key} className="model-search-row">
                        <div className="model-search-row-info">
                          <span className="model-search-row-name">{m.name || m.id}</span>
                          <span className="model-search-row-meta">{localProviderLabel} · {baseUrl}</span>
                        </div>
                        {addedKey === key ? (
                          <span className="model-search-added"><CheckCircle2 size={13} /> Added</span>
                        ) : (
                          <button
                            className="model-search-add"
                            disabled={addingKey === key}
                            onClick={() => addLocalModel(m)}
                          >
                            {addingKey === key
                              ? <RotateCw size={12} className="spin" />
                              : <Plus size={12} />}
                            {addingKey === key ? (restarting ? "Restarting…" : "Adding…") : "Add"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

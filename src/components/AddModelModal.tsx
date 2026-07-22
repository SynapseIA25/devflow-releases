import { useEffect, useMemo, useState } from "react";
import { Search, Plus, RotateCw, AlertCircle, CheckCircle2 } from "lucide-react";
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

// Buscador de modelos: agrega cualquier modelo de models.dev al config de OpenCode sin editar JSON a
// mano (ver lib/modelCatalog.ts). Solo aplica al provider "opencode" — MiMo/Claude Code gestionan su
// propio modelo desde su CLI.
export function AddModelModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (model: CatalogModel) => void;
}) {
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
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

  const add = async (model: CatalogModel) => {
    setAddingId(model.modelId);
    setAddError(null);
    try {
      await addModelToOpencodeConfig(model);
      setRestarting(true);
      // Reiniciamos OpenCode para que la próxima sesión lea el config nuevo (mismo patrón que
      // "Save & restart" al guardar API keys) y dejamos ese modelo pre-elegido para esa sesión.
      useSettingsStore.getState().setModelForProvider("opencode", `${model.providerId}/${model.modelId}`);
      await opencodeClient.restart("opencode");
      useWorkspaceStore.getState().resetSessions("opencode");
      setAddedId(model.modelId);
      onAdded(model);
    } catch (e: any) {
      setAddError(String(e?.message ?? e));
    } finally {
      setRestarting(false);
      setAddingId(null);
    }
  };

  return (
    <div className="model-search-overlay" onClick={onClose}>
      <div className="model-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-search-header">
          <span className="model-search-title">Buscar modelo</span>
          <button className="model-search-close" onClick={onClose}>×</button>
        </div>
        <div className="model-search-body">
          <p className="model-search-hint">
            Catálogo completo de OpenRouter, Google, Groq y Mistral (models.dev) — no solo la lista
            curada de DevFlow Code. Agregar un modelo edita tu configuración por vos y reinicia
            DevFlow Code.
          </p>
          <div className="model-search-inputrow">
            <Search size={13} />
            <input
              autoFocus
              className="model-search-input"
              placeholder="ej. kimi, gemini flash, deepseek…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {loading && <div className="model-search-status">Cargando catálogo…</div>}
          {loadError && (
            <div className="model-search-status model-search-status--error">
              <AlertCircle size={12} /> No se pudo cargar el catálogo: {loadError}
            </div>
          )}
          {addError && (
            <div className="model-search-status model-search-status--error">
              <AlertCircle size={12} /> {addError}
            </div>
          )}
          {!loading && !loadError && (
            <div className="model-search-results">
              {results.length === 0 && <div className="model-search-empty">Sin resultados.</div>}
              {results.map((m) => (
                <div key={`${m.providerId}/${m.modelId}`} className="model-search-row">
                  <div className="model-search-row-info">
                    <span className="model-search-row-name">{m.name}</span>
                    <span className="model-search-row-meta">
                      {keyLabel(m.providerId)} · {fmtCost(m)}{fmtContext(m) ? ` · ${fmtContext(m)}` : ""}
                      {!hasKey(m.providerId) && <span className="model-search-nokey"> · sin key configurada</span>}
                    </span>
                  </div>
                  {addedId === m.modelId ? (
                    <span className="model-search-added"><CheckCircle2 size={13} /> Agregado</span>
                  ) : (
                    <button
                      className="model-search-add"
                      disabled={addingId === m.modelId}
                      onClick={() => add(m)}
                    >
                      {addingId === m.modelId
                        ? <RotateCw size={12} className="spin" />
                        : <Plus size={12} />}
                      {addingId === m.modelId ? (restarting ? "Reiniciando…" : "Agregando…") : "Agregar"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

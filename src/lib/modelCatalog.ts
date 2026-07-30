// Buscador de modelos para el agente OpenCode: permite agregar CUALQUIER modelo de un provider ya
// configurado (OpenRouter/Google/Groq/Mistral, ver PROVIDER_KEY_SPECS) sin editar opencode.jsonc a
// mano. Fuente del catálogo: models.dev (el mismo índice que usa OpenCode internamente para su lista
// curada) — acá se expone completo, cacheado 24h en disco para no re-descargar ~3MB cada vez.
import { readTextFile, writeTextFile, httpRequest, homeDir } from "./tauriApi";
import { PROVIDER_KEY_SPECS } from "./providers";

export type CatalogModel = {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  context: number | null;
  output: number | null;
  costInput: number | null;
  costOutput: number | null;
};

type RawCatalog = Record<
  string,
  {
    name?: string;
    models?: Record<
      string,
      {
        name?: string;
        limit?: { context?: number; output?: number };
        cost?: { input?: number; output?: number };
      }
    >;
  }
>;

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Solo estos providers reciben su key vía env desde DevFlow (acpClient.providerKeysEnv) — son los
// únicos donde agregar un modelo custom al config de OpenCode puede llegar a funcionar de verdad.
const SEARCHABLE_PROVIDER_IDS = new Set(PROVIDER_KEY_SPECS.map((s) => s.id));

let memCache: CatalogModel[] | null = null;
let memCacheAt = 0;

async function cachePath(): Promise<string> {
  return `${await homeDir()}/.devflow/models-catalog.json`;
}

async function opencodeConfigPath(): Promise<string> {
  return `${await homeDir()}/.config/opencode/opencode.jsonc`;
}

function flatten(raw: RawCatalog): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const [providerId, provider] of Object.entries(raw)) {
    if (!SEARCHABLE_PROVIDER_IDS.has(providerId)) continue;
    for (const [modelId, m] of Object.entries(provider.models ?? {})) {
      out.push({
        providerId,
        providerName: provider.name ?? providerId,
        modelId,
        name: m.name ?? modelId,
        context: m.limit?.context ?? null,
        output: m.limit?.output ?? null,
        costInput: m.cost?.input ?? null,
        costOutput: m.cost?.output ?? null,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Trae el catálogo completo (168 providers / ~5700 modelos en models.dev), filtrado a los providers
// buscables. force=true ignora el cache de disco y memoria (botón "Actualizar catálogo").
export async function fetchModelCatalog(force = false): Promise<CatalogModel[]> {
  if (!force && memCache && Date.now() - memCacheAt < CACHE_MAX_AGE_MS) return memCache;

  if (!force) {
    try {
      const raw = await readTextFile(await cachePath());
      const parsed = JSON.parse(raw) as { fetchedAt: number; data: RawCatalog };
      if (Date.now() - parsed.fetchedAt < CACHE_MAX_AGE_MS) {
        memCache = flatten(parsed.data);
        memCacheAt = parsed.fetchedAt;
        return memCache;
      }
    } catch {
      // sin cache en disco todavía, o corrupto/vencido — seguimos a descargar
    }
  }

  const res = await httpRequest("GET", CATALOG_URL, {}, "");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`models.dev respondió ${res.status}`);
  }
  const data = JSON.parse(res.body) as RawCatalog;
  const fetchedAt = Date.now();
  memCache = flatten(data);
  memCacheAt = fetchedAt;
  try {
    await writeTextFile(await cachePath(), JSON.stringify({ fetchedAt, data }));
  } catch {
    // el cache en disco es solo optimización de arranque — si falla escribirlo, seguimos igual
  }
  return memCache;
}

// Cruza un model id de runtime (ej. de acpClient/opencodeClient configOptions) contra el catálogo ya
// cacheado, para el cost ceiling del router (modelRouter.ts, Fase 2). `modelId` va SIN el prefijo de
// provider (ver inferenceProviderOf) — ej. para "openrouter/qwen/qwen3-coder:free" es
// "qwen/qwen3-coder:free". undefined = provider no buscable (ej. "opencode") o modelo no encontrado —
// el caller lo trata como "gratis/desconocido, nunca se penaliza".
export function findCatalogModel(catalog: CatalogModel[], providerId: string, modelId: string): CatalogModel | undefined {
  return catalog.find((m) => m.providerId === providerId && m.modelId === modelId);
}

export function searchCatalog(catalog: CatalogModel[], query: string, limit = 40): CatalogModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, limit);
  return catalog
    .filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

// Agrega (o actualiza) un modelo al opencode.jsonc GLOBAL del usuario, bajo
// provider.<providerId>.models.<modelId> — el mecanismo de config que documenta
// opencode.ai/docs/providers. DevFlow solo automatiza escribirlo; el efecto es el mismo que editarlo
// a mano. Si el archivo existe pero no es JSON válido (ej. tiene comentarios reales de jsonc), NO lo
// pisamos — mejor fallar y que el usuario lo edite a mano que perder ediciones previas.
export async function addModelToOpencodeConfig(model: CatalogModel): Promise<void> {
  const path = await opencodeConfigPath();
  let raw: string | null = null;
  try {
    raw = await readTextFile(path);
  } catch {
    raw = null; // no existe todavía — arrancamos de un config vacío
  }

  let config: any = { $schema: "https://opencode.ai/config.json" };
  if (raw !== null) {
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(
        `No se pudo parsear ${path} como JSON (¿tiene comentarios o errores de sintaxis?). ` +
          `Para no perder tus cambios, agregá el modelo ahí a mano en vez de dejar que DevFlow lo pise.`
      );
    }
  }

  config.provider ??= {};
  config.provider[model.providerId] ??= {};
  config.provider[model.providerId].models ??= {};
  const limit: Record<string, number> = {};
  if (model.context) limit.context = model.context;
  if (model.output) limit.output = model.output;
  config.provider[model.providerId].models[model.modelId] = {
    name: model.name,
    ...(Object.keys(limit).length ? { limit } : {}),
  };

  await writeTextFile(path, JSON.stringify(config, null, 2));
}

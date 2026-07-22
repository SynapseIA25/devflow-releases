import { readTextFile, writeTextFile, httpRequest, homeDir } from "./tauriApi";

// Conectar motores de inferencia locales (Ollama, LM Studio, o cualquier otro server
// OpenAI-compatible) a OpenCode. Mismo mecanismo genérico que documenta OpenCode:
// npm "@ai-sdk/openai-compatible" + options.baseURL — no hace falta código específico por
// herramienta porque todas exponen la misma forma de API que OpenAI (incluyendo GET /models).
export type LocalProviderPreset = { id: string; label: string; defaultBaseUrl: string };

export const LOCAL_PROVIDER_PRESETS: LocalProviderPreset[] = [
  { id: "ollama", label: "Ollama", defaultBaseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", label: "LM Studio", defaultBaseUrl: "http://127.0.0.1:1234/v1" },
];

export type LocalModel = { id: string; name?: string };

async function opencodeConfigPath(): Promise<string> {
  return `${await homeDir()}/.config/opencode/opencode.jsonc`;
}

export async function discoverLocalModels(baseUrl: string): Promise<LocalModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await httpRequest("GET", url, {}, "");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${url} respondió ${res.status} — ¿está corriendo el server?`);
  }
  let data: any;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error(`La respuesta de ${url} no es JSON válido.`);
  }
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list
    .map((m: any) => ({ id: String(m.id ?? m.name ?? m.model ?? ""), name: m.name }))
    .filter((m: LocalModel) => m.id);
}

// Registra (o actualiza) un provider local completo en el opencode.jsonc GLOBAL — mismo patrón
// seguro read-modify-write que addModelToOpencodeConfig (modelCatalog.ts): falla en vez de pisar
// un config con comentarios o errores de sintaxis reales. A diferencia de agregar un modelo suelto,
// acá se declara el PROVIDER entero (npm + baseURL), mergeando con los modelos que ya hubiera.
export async function addLocalProviderToOpencodeConfig(
  providerId: string,
  label: string,
  baseUrl: string,
  models: LocalModel[]
): Promise<void> {
  const path = await opencodeConfigPath();
  let raw: string | null = null;
  try {
    raw = await readTextFile(path);
  } catch {
    raw = null;
  }
  let config: any = { $schema: "https://opencode.ai/config.json" };
  if (raw !== null) {
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(
        `No se pudo parsear ${path} como JSON (¿tiene comentarios o errores de sintaxis?). Agregá el provider ahí a mano.`
      );
    }
  }
  config.provider ??= {};
  const existingModels = config.provider[providerId]?.models ?? {};
  config.provider[providerId] = {
    npm: "@ai-sdk/openai-compatible",
    name: label,
    options: { baseURL: baseUrl },
    models: {
      ...existingModels,
      ...Object.fromEntries(models.map((m) => [m.id, { name: m.name || m.id }])),
    },
  };
  await writeTextFile(path, JSON.stringify(config, null, 2));
}

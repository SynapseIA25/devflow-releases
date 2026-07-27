// Fase 6 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Fallback real cuando testStrategyCatalog.ts no matchea ningún stack
// conocido (desktop nativo no-Chromium, o cualquier cosa fuera de la tabla): se delega al experto QA
// (expert-qa, ya existe en providers.ts) con contexto acotado del proyecto, y se valida/reintenta su
// respuesta con el mismo patrón "reducir grados de libertad + validar + reintentar una vez + error
// duro" que ya usa verifyScript.ts para el codegen del nodo verify.
import { readDir, readTextFile } from "./tauriApi";
import { useAgentsStore } from "../store/agentsStore";
import { runAgentTurn } from "./teamDelegate";
import type { StackFingerprint } from "./stackDetect";
import { KNOWN_MCP_SERVER_IDS, type TestCasePattern, type TestStrategy } from "./testStrategyCatalog";

const AGENT_TIMEOUT_MS = 120_000;
const MANIFEST_NAMES = ["package.json", "pubspec.yaml", "Cargo.toml", "go.mod", "pom.xml"];
const MAX_MANIFEST_CHARS = 3000;
const MAX_SUBDIRS_LISTED = 5;
// Mismas carpetas ruidosas que ya excluye Rust en read_dir para codebaseMap.ts — nada de walk profundo
// acá tampoco, solo raíz + 1 nivel, para no pagar el costo de un escaneo completo del repo.
const NOISE_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", ".venv", "__pycache__"]);

// Contexto acotado para el agente: manifiestos reales (truncados) + un listado superficial, NO un
// escaneo completo del repo (eso lo paga collectFiles de codebaseMap.ts para otro caso de uso, acá no
// hace falta esa profundidad — el agente solo necesita entender la FORMA del proyecto).
async function gatherContext(projectPath: string): Promise<string> {
  const entries = await readDir(projectPath).catch(() => []);
  const fileNames = entries.filter((e) => !e.isDir).map((e) => e.name);
  const dirEntries = entries.filter((e) => e.isDir && !NOISE_DIRS.has(e.name));

  const manifestNames = fileNames.filter(
    (f) => MANIFEST_NAMES.includes(f) || /\.csproj$/i.test(f) || f === "CMakeLists.txt"
  );
  const manifests: string[] = [];
  for (const name of manifestNames) {
    const raw = await readTextFile(`${projectPath}/${name}`).catch(() => null);
    if (raw != null) manifests.push(`### ${name}\n${raw.slice(0, MAX_MANIFEST_CHARS)}`);
  }

  const rootListing = `root: ${[...fileNames, ...dirEntries.map((d) => `${d.name}/`)].join(", ") || "(empty)"}`;
  const subListings: string[] = [];
  for (const dir of dirEntries.slice(0, MAX_SUBDIRS_LISTED)) {
    const sub = await readDir(`${projectPath}/${dir.name}`).catch(() => []);
    subListings.push(`${dir.name}/: ${sub.map((e) => e.name + (e.isDir ? "/" : "")).join(", ") || "(empty)"}`);
  }

  return [
    "Manifests found at the root:",
    manifests.length > 0 ? manifests.join("\n\n") : "(none readable)",
    "",
    "Shallow listing (root + 1 level into the first relevant subfolders):",
    rootListing,
    ...subListings,
  ].join("\n");
}

function buildStrategyPrompt(fingerprint: StackFingerprint, context: string): string {
  return [
    `DevFlow's automatic testing-strategy catalog didn't recognize this project's stack.`,
    `Your task: propose a reasonable testing strategy for it.`,
    ``,
    `Fingerprint detected by file heuristics (may be incomplete/imprecise):`,
    "```json",
    JSON.stringify(fingerprint, null, 2),
    "```",
    ``,
    context,
    ``,
    `The ONLY automation MCP servers that actually exist in DevFlow are: ${KNOWN_MCP_SERVER_IDS.join(", ")}.`,
    `If none of them apply to this stack (e.g. native desktop Qt/GTK/Swing/WinForms, which today has no`,
    `automation backend of its own in DevFlow), leave "mcpServerIds" as an empty array — DO NOT INVENT`,
    `a server name that isn't in that exact list.`,
    ``,
    `Respond ONLY with a single fenced JSON object (\`\`\`json), no text before or after, with exactly`,
    `this shape:`,
    "```json",
    `{`,
    `  "backend": "<short descriptive name of the approach, e.g. \\"qt-native-testing\\" or \\"manual, no automation available\\">",`,
    `  "mcpServerIds": ["<only ids from the list above, or an empty array>"],`,
    `  "casePatterns": [{"id": "<unique slug>", "label": "<short title>", "description": "<what this case checks>"}],`,
    `  "rationale": "<2-3 sentences in English explaining why this strategy>"`,
    `}`,
    "```",
    `"casePatterns" must have at least one element, with unique "id"s.`,
  ].join("\n");
}

// Clon de teamDelegate.ts::extractJsonArray para el caso objeto (mismo approach: fence → recorte por
// llaves → JSON.parse, tolera texto alrededor).
function extractJsonObject(s: string): Record<string, unknown> | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type ValidationResult =
  | { ok: true; strategy: Omit<TestStrategy, "source"> }
  | { ok: false; reason: string };

// Validación estricta: cada campo de la forma esperada, y sobre todo mcpServerIds contra la whitelist
// real — es el "known failure mode" análogo al `require(`/`"ws"` de verifyScript.ts (acá: un id de MCP
// server inventado en vez de uno real).
function validateStrategyJson(obj: Record<string, unknown> | null): ValidationResult {
  if (!obj) return { ok: false, reason: "the response didn't have a recognizable fenced JSON object" };

  const backend = obj.backend;
  if (typeof backend !== "string" || !backend.trim()) {
    return { ok: false, reason: '"backend" must be a non-empty string' };
  }

  const mcpServerIdsRaw = obj.mcpServerIds;
  if (!Array.isArray(mcpServerIdsRaw)) {
    return { ok: false, reason: '"mcpServerIds" must be an array (can be empty)' };
  }
  const known: readonly string[] = KNOWN_MCP_SERVER_IDS;
  const invalidIds = mcpServerIdsRaw.filter((id) => typeof id !== "string" || !known.includes(id));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      reason: `"mcpServerIds" has invented ids that don't exist: ${JSON.stringify(invalidIds)} — the only valid ones are ${known.join(", ")} (or an empty array)`,
    };
  }
  const mcpServerIds = mcpServerIdsRaw as string[];

  const casePatternsRaw = obj.casePatterns;
  if (!Array.isArray(casePatternsRaw) || casePatternsRaw.length === 0) {
    return { ok: false, reason: '"casePatterns" must be a non-empty array of {id,label,description} objects' };
  }
  const casePatterns: TestCasePattern[] = [];
  const seenIds = new Set<string>();
  for (const raw of casePatternsRaw) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, reason: 'each element of "casePatterns" must be an {id,label,description} object' };
    }
    const { id, label, description } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, reason: 'each element of "casePatterns" needs a non-empty string "id"' };
    }
    if (seenIds.has(id)) {
      return { ok: false, reason: `"casePatterns" has duplicate ids: "${id}" — each pattern needs a unique id` };
    }
    seenIds.add(id);
    if (typeof label !== "string" || !label.trim()) {
      return { ok: false, reason: `pattern "${id}" needs a non-empty string "label"` };
    }
    if (typeof description !== "string" || !description.trim()) {
      return { ok: false, reason: `pattern "${id}" needs a non-empty string "description"` };
    }
    casePatterns.push({ id, label, description });
  }

  const rationale = typeof obj.rationale === "string" && obj.rationale.trim() ? obj.rationale.trim() : undefined;
  return { ok: true, strategy: { backend: backend.trim(), mcpServerIds, casePatterns, rationale } };
}

export async function suggestStrategyViaAgent(fingerprint: StackFingerprint, projectPath: string): Promise<TestStrategy> {
  const agent = useAgentsStore.getState().agents.find((a) => a.id === "expert-qa");
  if (!agent) throw new Error('Could not find the "expert-qa" agent — can\'t request a testing strategy.');

  const context = await gatherContext(projectPath);
  const prompt = buildStrategyPrompt(fingerprint, context);

  const response = await runAgentTurn(agent, prompt, projectPath, AGENT_TIMEOUT_MS);
  let result = validateStrategyJson(extractJsonObject(response));

  // Un solo reintento con la violación EXACTA señalada — mismo patrón que verifyScript.ts. Si vuelve a
  // fallar, error duro: mejor decirle al usuario que no se pudo derivar una estrategia que guardar una
  // inválida (con un id de MCP server inventado, por ejemplo).
  if (!result.ok) {
    const retryPrompt =
      `${prompt}\n\nYour previous response didn't match the requested format — the exact problem was:\n` +
      `${result.reason}\n\nRespond again with ONLY the corrected fenced JSON object, nothing else.`;
    const retryResponse = await runAgentTurn(agent, retryPrompt, projectPath, AGENT_TIMEOUT_MS);
    result = validateStrategyJson(extractJsonObject(retryResponse));
    if (!result.ok) {
      throw new Error(`The QA agent couldn't propose a valid strategy after one retry: ${result.reason}`);
    }
  }

  return { ...result.strategy, source: "agent" };
}

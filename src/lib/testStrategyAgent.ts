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

  const rootListing = `raíz: ${[...fileNames, ...dirEntries.map((d) => `${d.name}/`)].join(", ") || "(vacía)"}`;
  const subListings: string[] = [];
  for (const dir of dirEntries.slice(0, MAX_SUBDIRS_LISTED)) {
    const sub = await readDir(`${projectPath}/${dir.name}`).catch(() => []);
    subListings.push(`${dir.name}/: ${sub.map((e) => e.name + (e.isDir ? "/" : "")).join(", ") || "(vacía)"}`);
  }

  return [
    "Manifiestos encontrados en la raíz:",
    manifests.length > 0 ? manifests.join("\n\n") : "(ninguno legible)",
    "",
    "Listado superficial (raíz + 1 nivel en las primeras subcarpetas relevantes):",
    rootListing,
    ...subListings,
  ].join("\n");
}

function buildStrategyPrompt(fingerprint: StackFingerprint, context: string): string {
  return [
    `El catálogo automático de estrategias de testing de DevFlow no reconoció el stack de este proyecto.`,
    `Tu tarea: proponer una estrategia de testing razonable para él.`,
    ``,
    `Fingerprint detectado por heurística de archivos (puede ser incompleto/impreciso):`,
    "```json",
    JSON.stringify(fingerprint, null, 2),
    "```",
    ``,
    context,
    ``,
    `Los ÚNICOS MCP servers de automatización que existen de verdad en DevFlow son: ${KNOWN_MCP_SERVER_IDS.join(", ")}.`,
    `Si ninguno aplica a este stack (ej. desktop nativo Qt/GTK/Swing/WinForms, que hoy no tiene backend`,
    `de automatización propio en DevFlow), dejá "mcpServerIds" como un array vacío — NO INVENTES un`,
    `nombre de servidor que no esté en esa lista exacta.`,
    ``,
    `Respondé ÚNICAMENTE con un único objeto JSON fenced (\`\`\`json), sin texto antes ni después, con`,
    `esta forma exacta:`,
    "```json",
    `{`,
    `  "backend": "<nombre corto y descriptivo del enfoque, ej. \\"qt-test-nativo\\" o \\"manual, sin automatización disponible\\">",`,
    `  "mcpServerIds": ["<solo ids de la lista de arriba, o array vacío>"],`,
    `  "casePatterns": [{"id": "<slug único>", "label": "<título corto>", "description": "<qué verifica este caso>"}],`,
    `  "rationale": "<2-3 frases en español explicando por qué esta estrategia>"`,
    `}`,
    "```",
    `"casePatterns" tiene que tener al menos un elemento, con "id" únicos entre sí.`,
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
  if (!obj) return { ok: false, reason: "la respuesta no tenía un objeto JSON fenced reconocible" };

  const backend = obj.backend;
  if (typeof backend !== "string" || !backend.trim()) {
    return { ok: false, reason: '"backend" tiene que ser un string no vacío' };
  }

  const mcpServerIdsRaw = obj.mcpServerIds;
  if (!Array.isArray(mcpServerIdsRaw)) {
    return { ok: false, reason: '"mcpServerIds" tiene que ser un array (puede estar vacío)' };
  }
  const known: readonly string[] = KNOWN_MCP_SERVER_IDS;
  const invalidIds = mcpServerIdsRaw.filter((id) => typeof id !== "string" || !known.includes(id));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      reason: `"mcpServerIds" tiene ids inventados que no existen: ${JSON.stringify(invalidIds)} — los únicos válidos son ${known.join(", ")} (o array vacío)`,
    };
  }
  const mcpServerIds = mcpServerIdsRaw as string[];

  const casePatternsRaw = obj.casePatterns;
  if (!Array.isArray(casePatternsRaw) || casePatternsRaw.length === 0) {
    return { ok: false, reason: '"casePatterns" tiene que ser un array no vacío de objetos {id,label,description}' };
  }
  const casePatterns: TestCasePattern[] = [];
  const seenIds = new Set<string>();
  for (const raw of casePatternsRaw) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, reason: 'cada elemento de "casePatterns" tiene que ser un objeto {id,label,description}' };
    }
    const { id, label, description } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, reason: 'cada elemento de "casePatterns" necesita un "id" string no vacío' };
    }
    if (seenIds.has(id)) {
      return { ok: false, reason: `"casePatterns" tiene ids repetidos: "${id}" — cada patrón necesita un id único` };
    }
    seenIds.add(id);
    if (typeof label !== "string" || !label.trim()) {
      return { ok: false, reason: `el patrón "${id}" necesita un "label" string no vacío` };
    }
    if (typeof description !== "string" || !description.trim()) {
      return { ok: false, reason: `el patrón "${id}" necesita una "description" string no vacía` };
    }
    casePatterns.push({ id, label, description });
  }

  const rationale = typeof obj.rationale === "string" && obj.rationale.trim() ? obj.rationale.trim() : undefined;
  return { ok: true, strategy: { backend: backend.trim(), mcpServerIds, casePatterns, rationale } };
}

export async function suggestStrategyViaAgent(fingerprint: StackFingerprint, projectPath: string): Promise<TestStrategy> {
  const agent = useAgentsStore.getState().agents.find((a) => a.id === "expert-qa");
  if (!agent) throw new Error('No se encontró el agente "expert-qa" — no se puede pedir una estrategia de testing.');

  const context = await gatherContext(projectPath);
  const prompt = buildStrategyPrompt(fingerprint, context);

  const response = await runAgentTurn(agent, prompt, projectPath, AGENT_TIMEOUT_MS);
  let result = validateStrategyJson(extractJsonObject(response));

  // Un solo reintento con la violación EXACTA señalada — mismo patrón que verifyScript.ts. Si vuelve a
  // fallar, error duro: mejor decirle al usuario que no se pudo derivar una estrategia que guardar una
  // inválida (con un id de MCP server inventado, por ejemplo).
  if (!result.ok) {
    const retryPrompt =
      `${prompt}\n\nTu respuesta anterior no cumplió el formato pedido — el problema exacto fue:\n` +
      `${result.reason}\n\nRespondé de nuevo con ÚNICAMENTE el objeto JSON fenced corregido, nada más.`;
    const retryResponse = await runAgentTurn(agent, retryPrompt, projectPath, AGENT_TIMEOUT_MS);
    result = validateStrategyJson(extractJsonObject(retryResponse));
    if (!result.ok) {
      throw new Error(`El agente QA no pudo proponer una estrategia válida tras un reintento: ${result.reason}`);
    }
  }

  return { ...result.strategy, source: "agent" };
}

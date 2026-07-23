// Genera un script determinístico a partir de una corrida exitosa de un nodo `verify` en modo
// exploración — el punto es que las corridas SIGUIENTES de ese nodo (en modo "script", ver execVerify
// en workflowEngine.ts) no necesiten un turno de agente/LLM: se corre el script guardado y se
// interpreta su exit code, igual que el nodo terminal. La generación en sí SÍ usa un turno de agente
// (una vez, manual — el usuario aprieta el botón), pidiéndole al mismo agente que ya exploró que
// traduzca lo que hizo a un script reproducible.
import { useAgentsStore } from "../store/agentsStore";
import { useProjectStore } from "../store/projectStore";
import { useWorkflowStore, type WorkflowNode } from "../store/workflowStore";
import { createDir, writeTextFile } from "./tauriApi";
import { runAgentTurn } from "./teamDelegate";
import type { TraceEntry } from "./workflowEngine";

const CODEGEN_TIMEOUT_MS = 120_000;

// Esqueleto COMPLETO (descubrimiento de target + conexión), no solo la función de bajo nivel — un
// primer intento con solo `cdpCall` produjo scripts que le pegaban al puerto EQUIVOCADO (confundían
// el puerto del target con el de debug CDP) o reinventaban mal el descubrimiento. Mismo patrón que ya
// usa DevFlow para esto sin dependencias npm (ver desktopCdpScript.ts: listTargets/pickTarget/cdpCall)
// — se lo damos al agente CASI completo, con un solo hueco a llenar, para minimizar los grados de
// libertad donde puede meter la pata.
const CDP_CONNECT_SNIPPET = `const CDP_PORT = process.env.CDP_PORT || "9222"; // puerto de DEBUG CDP, NO el puerto de la app

async function pickTarget(urlContains) {
  const res = await fetch("http://localhost:" + CDP_PORT + "/json"); // el "/json" vive en el puerto de debug, no en la app
  const targets = await res.json();
  const target = targets.find((t) => t.type === "page" && (!urlContains || (t.url || "").includes(urlContains)));
  if (!target) throw new Error("No se encontró el target CDP (¿la app target está corriendo con --remote-debugging-port=" + CDP_PORT + "?)");
  return target;
}

function cdpCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); // WebSocket global de Node (>=22) — NO se importa, NO es el paquete npm "ws"
    const id = 1;
    const timeout = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("timeout CDP " + method)); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      clearTimeout(timeout);
      try { ws.close(); } catch (e) {}
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result); // YA es un objeto — NO hacerle JSON.parse()
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("WebSocket error " + wsUrl)); };
  });
}

async function evaluate(expression, urlContains) {
  const target = await pickTarget(urlContains);
  const wrapped = "(async () => { " + expression + " })()";
  const result = await cdpCall(target.webSocketDebuggerUrl, "Runtime.evaluate", { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result && "value" in result.result ? result.result.value : null;
}`;

function slug(s: string): string {
  const base = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "verify-script";
}

// Extrae el ÚNICO fence de código de la respuesta (mismo espíritu que teamDelegate::extractJsonArray)
// y decide la extensión por el language hint del fence — default a shell si no hay hint reconocible.
function extractScript(text: string): { code: string; ext: "sh" | "mjs" } | null {
  const match = text.match(/```([a-zA-Z]*)\n([\s\S]*?)```/);
  if (!match) return null;
  const lang = match[1].toLowerCase();
  const code = match[2].trim();
  if (!code) return null;
  const ext = lang === "js" || lang === "javascript" || lang === "node" || lang === "mjs" ? "mjs" : "sh";
  return { code, ext };
}

function buildCodegenPrompt(verifyPrompt: string, trace: TraceEntry[]): string {
  const traceJson = JSON.stringify(trace, null, 2);
  return [
    `Ya verificaste esto explorando en vivo: "${verifyPrompt}"`,
    ``,
    `Acá está la traza real de lo que hiciste (cada tool call con su input y output):`,
    "```json",
    traceJson,
    "```",
    ``,
    `Ahora escribí un script DETERMINÍSTICO (sin ningún razonamiento de IA en runtime) que reproduzca`,
    `exactamente el mismo chequeo y llegue al mismo veredicto. Reglas:`,
    `1. Si la traza es solo comandos de terminal (no hay tool calls de "desktop_evaluate" ni otro MCP),`,
    `   escribí un script de shell POSIX (bash) — se va a correr con "bash <script>".`,
    `2. Si la traza usa "desktop_evaluate" (Chrome DevTools Protocol) para inspeccionar una app`,
    `   Tauri/Electron, escribí un script Node.js SIN NINGUNA dependencia externa. ESTO ES OBLIGATORIO,`,
    `   no una preferencia: el script NO PUEDE tener ningún \`require(...)\` NI ningún \`import ... from\`,`,
    `   ni siquiera de "ws" — \`WebSocket\` YA es una variable global disponible en Node, exactamente como`,
    `   \`fetch\`. NO la declares, NO la importes, usala directo.`,
    `   Pegá este bloque COMPLETO tal cual, SIN modificarlo ni reimplementarlo — ya resuelve la conexión`,
    `   y el descubrimiento del target correctamente (el error más común es confundir el puerto de la`,
    `   APP con el puerto de DEBUG CDP — este bloque ya lo maneja bien, no lo toques):`,
    "```js",
    CDP_CONNECT_SNIPPET,
    "```",
    `   Tu trabajo es SOLO llamar \`await evaluate(expression, urlContains)\` con la misma expression y`,
    `   el mismo filtro de URL que aparecen en la traza (campo "input" de cada tool call`,
    `   "desktop_evaluate"), y comparar el valor devuelto contra el resultado esperado (mismo campo`,
    `   "output" de la traza, o lo que diga el texto de verificación de arriba). Terminá el script`,
    `   llamando a tu función main y saliendo con el exit code correspondiente.`,
    `3. El script tiene que salir con exit code 0 si el chequeo pasa, y con exit code distinto de 0 si`,
    `   falla — es la única señal que se interpreta (no imprimas ningún sentinel especial).`,
    `4. Imprimí solo diagnóstico relevante por stdout/stderr (qué se chequeó, qué se encontró).`,
    `5. Si la traza incluye tools que NO son terminal ni desktop_evaluate (ej. mobile-mcp u otro MCP),`,
    `   hacé lo mejor posible con la información disponible — no hace falta un replay perfecto, mejor`,
    `   un script que capture la intención central de la verificación.`,
    ``,
    `Respondé ÚNICAMENTE con un solo bloque de código fenced (\`\`\`sh o \`\`\`js) con el script completo,`,
    `sin texto antes ni después del fence.`,
  ].join("\n");
}

export async function generateVerifyScript(node: WorkflowNode): Promise<{ scriptPath: string }> {
  const traceRaw = String(node.data.lastVerifyTrace ?? "");
  if (!traceRaw) throw new Error("No hay una corrida exitosa reciente de este nodo para generar un script (correlo en modo Exploración primero).");
  let trace: TraceEntry[] = [];
  try {
    trace = JSON.parse(traceRaw);
  } catch {
    // trace truncada a MAX_TRACE_CHARS puede cortar el JSON a la mitad — degradamos con gracia,
    // el agente igual tiene el prompt original para trabajar.
  }
  const verifyPrompt = String(node.data.lastVerifyPrompt ?? node.data.prompt ?? "");
  const agentId = String(node.data.agentId ?? "");
  const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("El agente de este nodo ya no existe — elegí uno de nuevo antes de generar el script.");
  const cwd = useProjectStore.getState().projectPath;

  const codegenPrompt = buildCodegenPrompt(verifyPrompt, trace);
  const response = await runAgentTurn(agent, codegenPrompt, cwd, CODEGEN_TIMEOUT_MS);
  let extracted = extractScript(response);
  if (!extracted) throw new Error(`El agente no devolvió un bloque de código reconocible. Respuesta: ${response.slice(0, 300)}`);

  // Verificado en la práctica: incluso con la instrucción explícita e el snippet de referencia en el
  // prompt, un modelo puede igual escribir `require("ws")` en un .mjs (ESM) — rompe en runtime
  // (ReferenceError: require is not defined). Un reintento con la violación EXACTA señalada suele
  // bastar (probado); si persiste, mejor un error claro que un script silenciosamente roto.
  if (extracted.ext === "mjs" && /\brequire\s*\(|from\s*["']ws["']|import\s+.*\bws\b/.test(extracted.code)) {
    const retryPrompt =
      `${codegenPrompt}\n\nTu respuesta anterior violó la regla de cero dependencias — tenía esto:\n\n` +
      "```js\n" + extracted.code + "\n```\n\n" +
      `Usa "require" o el paquete "ws", ninguno de los dos existe en runtime acá. Reescribilo usando SOLO ` +
      `\`new WebSocket(wsUrl)\` (la variable global, sin declararla ni importarla) — copiá la función ` +
      `cdpCall del snippet tal cual. Respondé de nuevo con un único bloque fenced, nada más.`;
    const retryResponse = await runAgentTurn(agent, retryPrompt, cwd, CODEGEN_TIMEOUT_MS);
    const retryExtracted = extractScript(retryResponse);
    if (!retryExtracted) throw new Error(`El reintento tampoco devolvió un bloque de código reconocible. Respuesta: ${retryResponse.slice(0, 300)}`);
    if (/\brequire\s*\(|from\s*["']ws["']|import\s+.*\bws\b/.test(retryExtracted.code)) {
      throw new Error("El agente insiste en usar una dependencia externa (require/\"ws\") para el script Node — no se pudo generar un script sin dependencias. Probá de nuevo o revisá el prompt del nodo.");
    }
    extracted = retryExtracted;
  }

  const dir = `${cwd}/.devflow/scripts`;
  await createDir(dir);
  const fileName = `${slug(String(node.data.label ?? node.id))}.${extracted.ext}`;
  const scriptPath = `${dir}/${fileName}`;
  await writeTextFile(scriptPath, extracted.code);

  useWorkflowStore.getState().updateNodeData(node.id, { scriptPath, scriptGeneratedAt: Date.now() });
  return { scriptPath };
}

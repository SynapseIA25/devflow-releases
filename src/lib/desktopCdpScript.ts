// Fuente del script Node que hace de MCP server (stdio) para verificar apps DESKTOP Chromium-based
// (Tauri/Electron) de CUALQUIER proyecto — generaliza el helper `cdp.mjs` que uso a mano para
// verificar DevFlow mismo (ver memoria devflow-cdp-verificacion) a una tool reusable por el experto
// QA en el nodo `verify` (Fase 2 de la herramienta de testing nativa). Se escribe a
// `<home>/.devflow/cdp-mcp.js` (ver desktopCdpMcp.ts, mismo patrón read-modify-write que
// mcpBridgeScript.ts/opencodeAgents.ts) y se registra en `opencode.json` vía el catálogo de McpView.
//
// A diferencia del bridge de DevFlow (mcpBridgeScript.ts), este script NO le habla de vuelta a
// DevFlow — se conecta DIRECTO al puerto de debug remoto (Chrome DevTools Protocol) de la app target,
// que el agente tiene que haber lanzado él mismo (con su tool de terminal) ANTES de llamar estas
// tools — ver la descripción de `desktop_list_targets`. Puerto configurable por env var CDP_PORT
// (default 9222, el de-facto estándar). Requiere Node ≥ 20 (WebSocket/fetch globales).
//
// Node puro, SIN dependencias — mismo criterio que mcpBridgeScript.ts (DevFlow ya asume `node` en
// PATH para MCP servers, no bundlea node_modules para un script suelto).
export const DESKTOP_CDP_MCP_SCRIPT_SOURCE = `#!/usr/bin/env node
"use strict";
const readline = require("readline");

const CDP_PORT = process.env.CDP_PORT || "9222";

const TOOLS = [
  {
    name: "desktop_list_targets",
    description: "Lista las páginas/ventanas disponibles en el puerto de debug CDP (default 9222, override con la env var CDP_PORT). PRERREQUISITO: la app target tiene que estar corriendo con el puerto de debug remoto abierto — lanzala vos mismo con tu tool de terminal ANTES de usar estas tools: Tauri/WebView2 en Windows -> 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 <comando de dev>'; Electron/Chromium -> flag '--remote-debugging-port=9222' al binario. Si la lista viene vacía, la app no está corriendo o no abrió ese puerto.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "desktop_evaluate",
    description: "Corre JS en el contexto de la página target (via Runtime.evaluate, awaitPromise+returnByValue) y devuelve el resultado serializado. Usalo para navegar clickeando por texto, leer el DOM/localStorage, o invocar comandos nativos (ej. window.__TAURI_INTERNALS__.invoke). Tips de campo: (1) para inputs/textareas controlados por React, asignar .value directo NO dispara onChange -- usá el setter nativo del prototype + dispatchEvent(new Event('input',{bubbles:true})); (2) sobrescribí window.confirm/alert ANTES de disparar la acción que los abre; (3) después de inyectar estado en localStorage hace falta location.reload() para que un store tipo Zustand lo rehidrate.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JS a evaluar (se envuelve en un async IIFE -- podés usar await y return)" },
        targetUrlContains: { type: "string", description: "Filtra el target por substring de su URL, si hay más de una página abierta" },
      },
      required: ["expression"],
    },
  },
  {
    name: "desktop_screenshot",
    description: "Captura un screenshot PNG de la página target (Page.captureScreenshot). Útil para verificación visual cuando leer el DOM no alcanza.",
    inputSchema: {
      type: "object",
      properties: { targetUrlContains: { type: "string", description: "Filtra el target por substring de su URL, si hay más de una página abierta" } },
    },
  },
];

async function listTargets() {
  let res;
  try {
    res = await fetch("http://localhost:" + CDP_PORT + "/json");
  } catch (e) {
    throw new Error("No se pudo conectar al puerto de debug CDP " + CDP_PORT + " (¿la app target está corriendo con --remote-debugging-port=" + CDP_PORT + "?): " + e.message);
  }
  if (!res.ok) throw new Error("El puerto de debug CDP " + CDP_PORT + " respondió " + res.status);
  return res.json();
}

async function pickTarget(urlContains) {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  const target = urlContains ? pages.find((t) => t.url && t.url.includes(urlContains)) : pages[0];
  if (!target) {
    throw new Error(
      "No se encontró un target 'page'" + (urlContains ? " que contenga \\"" + urlContains + "\\"" : "") +
      " en el puerto " + CDP_PORT + ". Targets disponibles: " + JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })))
    );
  }
  return target;
}

function cdpCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timeout = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("Timeout esperando respuesta CDP de " + method)); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id !== id) return;
      clearTimeout(timeout);
      try { ws.close(); } catch (e) {}
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("Error de WebSocket conectando a " + wsUrl)); };
  });
}

async function desktopEvaluate(args) {
  const target = await pickTarget(args.targetUrlContains);
  const wrapped = "(async () => { " + String(args.expression || "") + " })()";
  const result = await cdpCall(target.webSocketDebuggerUrl, "Runtime.evaluate", { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const value = result.result && "value" in result.result ? result.result.value : null;
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError: false };
}

async function desktopScreenshot(args) {
  const target = await pickTarget(args.targetUrlContains);
  const result = await cdpCall(target.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" });
  return { content: [{ type: "image", data: result.data, mimeType: "image/png" }], isError: false };
}

async function desktopListTargets() {
  const targets = await listTargets();
  const summary = targets.map((t) => ({ id: t.id, type: t.type, title: t.title, url: t.url }));
  return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], isError: false };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "devflow-desktop-cdp", version: "0.1" } } });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      let result;
      if (name === "desktop_list_targets") result = await desktopListTargets();
      else if (name === "desktop_evaluate") result = await desktopEvaluate(args);
      else if (name === "desktop_screenshot") result = await desktopScreenshot(args);
      else result = { content: [{ type: "text", text: "Tool desconocida: " + name }], isError: true };
      send({ jsonrpc: "2.0", id, result });
    } catch (e) {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e && e.message ? e.message : e) }], isError: true } });
    }
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch (e) { return; }
  if (msg.method === "notifications/initialized" || msg.id === undefined) return;
  handleRequest(msg).catch(() => {});
});
`;

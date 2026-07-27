// Fuente del script Node que hace de MCP server (stdio) del bridge de DevFlow. Se escribe a
// `<home>/.devflow/mcp-bridge.js` (ver mcpBridge.ts, mismo patrón read-modify-write que
// opencodeAgents.ts) y se registra en `opencode.json` de cada proyecto (`command: ["node",
// "<home>/.devflow/mcp-bridge.js", "<projectPath>"]`) — el propio `opencode serve` lo spawnea como
// cualquier otro MCP server local, no DevFlow.
//
// Node puro, SIN dependencias (solo `http`/`fs`/`os`/`path`/`readline`, builtins): DevFlow ya asume
// `node` en PATH para MCP servers (ver checkPrerequisites) pero no bundlea `node_modules` para un
// script suelto — más simple y sin paso de instalación.
//
// Framing: newline-delimited JSON-RPC (un mensaje por línea), igual que el resto de la integración
// MCP de DevFlow (ver mcp_call_tool/mcp_list_tools en Rust, que hablan este mismo framing como
// CLIENTES de otros servers) — es el framing real del transporte stdio de la spec de MCP.
//
// `tools/list` devuelve un catálogo ESTÁTICO (hardcodeado acá abajo) — así un agente ve las tools
// aunque DevFlow esté cerrado; solo `tools/call` necesita el bridge HTTP vivo, y si no lo está,
// responde un error MCP claro (isError:true) en vez de colgarse.
export const MCP_BRIDGE_SCRIPT_SOURCE = `#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const PROJECT_PATH = process.argv[2] || "";
const DISCOVERY_PATH = path.join(os.homedir(), ".devflow", "mcp-bridge.json");

const TOOLS = [
  { name: "devflow_list_node_types", description: "Lista los tipos de nodo disponibles en el motor de Workflows de DevFlow, con sus campos configurables.", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_list_workflows", description: "Lista los workflows existentes (id, nombre, cantidad de nodos/edges).", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_get_workflow", description: "Devuelve el grafo completo (nodes+edges) de un workflow por id.", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "devflow_list_agents", description: "Lista los agentes de DevFlow disponibles (id, nombre, provider) para usarlos en nodos tipo 'agent'.", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_list_mcp_servers", description: "Lista los MCP servers configurados en el proyecto actual (opencode.json).", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_list_mcp_tools", description: "Introspecta las tools que expone un MCP server ya configurado en el proyecto (evita adivinar nombres para un nodo tipo 'mcp').", inputSchema: { type: "object", properties: { serverId: { type: "string" } }, required: ["serverId"] } },
  { name: "devflow_create_workflow", description: "Crea un workflow vacío y devuelve su id.", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
  { name: "devflow_define_workflow", description: "Reemplaza el grafo completo (nodes+edges) de un workflow, atómicamente. Valida tipos de nodo, ciclos y referencias {{id.output}} antes de guardar — es la forma principal de autorar un workflow entero de una.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, nodes: { type: "array" }, edges: { type: "array" } }, required: ["workflowId", "nodes", "edges"] } },
  { name: "devflow_add_node", description: "Agrega un nodo a un workflow existente. Devuelve el id del nodo nuevo.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, type: { type: "string" }, position: { type: "object" }, data: { type: "object" } }, required: ["workflowId", "type"] } },
  { name: "devflow_update_node", description: "Actualiza (merge) los datos/config de un nodo existente.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, nodeId: { type: "string" }, data: { type: "object" } }, required: ["workflowId", "nodeId", "data"] } },
  { name: "devflow_delete_node", description: "Borra un nodo (y sus edges) de un workflow.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, nodeId: { type: "string" } }, required: ["workflowId", "nodeId"] } },
  { name: "devflow_connect_nodes", description: "Conecta dos nodos con una edge. sourceHandle opcional ('true'/'false' para ramificar un nodo 'condition').", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, source: { type: "string" }, target: { type: "string" }, sourceHandle: { type: "string" } }, required: ["workflowId", "source", "target"] } },
  { name: "devflow_disconnect_nodes", description: "Quita la edge entre dos nodos.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, source: { type: "string" }, target: { type: "string" } }, required: ["workflowId", "source", "target"] } },
  { name: "devflow_rename_workflow", description: "Renombra un workflow.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, name: { type: "string" } }, required: ["workflowId", "name"] } },
  { name: "devflow_delete_workflow", description: "Borra un workflow (no permite borrar el último que queda).", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "devflow_validate_workflow", description: "Valida el grafo de un workflow (tipos de nodo, ciclos, referencias colgantes) sin ejecutarlo.", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "devflow_run_workflow", description: "Corre un workflow de punta a punta (motor real) y devuelve el log completo de la ejecución. Sensible: ejecuta comandos de shell/agentes/HTTP reales.", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, input: { type: "string" } }, required: ["workflowId"] } },
  { name: "devflow_stop_run", description: "Cancela una ejecución de workflow en curso.", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "devflow_run_tests", description: "Runs the current project's tests (command configured in the Tests view, or auto-detected by convention: package.json 'test' script, Cargo.toml, go.mod, pytest.ini/pyproject.toml/setup.py). Returns status (passed/failed), exit code and the full output.", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_suggest_test_strategy", description: "Detects the current project's stack (language, UI framework, render engine) and suggests a testing strategy: automation backend, recommended MCP servers and test-case patterns. Uses a known table for common stacks (web/Chromium, mobile, CLI) or falls back to the QA agent if the stack doesn't match any. Persists the suggestion so devflow_insert_test_case can use it afterward.", inputSchema: { type: "object", properties: {} } },
  { name: "devflow_insert_test_case", description: "Generates and inserts a real test case for a pattern suggested by devflow_suggest_test_strategy (call that first). Looks for an existing test file in the project as a style reference and inserts it there (or creates a new one if there isn't any). For simple patterns (smoke/cli-smoke) the body is left with an explicit TODO; for the rest the QA agent fills it in — treat it as a draft to review, not a guaranteed result.", inputSchema: { type: "object", properties: { patternId: { type: "string", description: "id of a pattern returned by devflow_suggest_test_strategy (e.g. 'smoke', 'form-validation')" }, targetHint: { type: "string", description: "what to test specifically (module, component, endpoint)" } }, required: ["patternId", "targetHint"] } },
];

function readDiscovery() {
  const raw = fs.readFileSync(DISCOVERY_PATH, "utf8");
  return JSON.parse(raw);
}

function callBridge(tool, args) {
  return new Promise((resolve) => {
    let discovery;
    try {
      discovery = readDiscovery();
    } catch (e) {
      resolve({ error: "DevFlow no está corriendo (no se encontró " + DISCOVERY_PATH + "). Abrí la app y volvé a intentar." });
      return;
    }
    const body = JSON.stringify({ tool, arguments: args || {} });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: discovery.port,
        path: "/call",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: "Bearer " + discovery.token,
          "X-Devflow-Project": PROJECT_PATH,
        },
        timeout: 620000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            resolve({ error: "Respuesta inválida del bridge de DevFlow: " + String(e) });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "Timeout esperando a DevFlow." });
    });
    req.on("error", (e) => {
      resolve({ error: "No se pudo conectar con DevFlow (¿está corriendo y con este proyecto abierto?): " + e.message });
    });
    req.write(body);
    req.end();
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "devflow-bridge", version: "0.1" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const reply = await callBridge(name, args);
    if (reply && reply.error) {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(reply.error) }], isError: true } });
      return;
    }
    const text = typeof reply.result === "string" ? reply.result : JSON.stringify(reply.result, null, 2);
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: text }], isError: false } });
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
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    return;
  }
  if (msg.method === "notifications/initialized" || msg.id === undefined) return; // notification, sin respuesta
  handleRequest(msg).catch(() => {});
});
`;

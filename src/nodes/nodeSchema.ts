import { TASK_PROFILES } from "../lib/modelRouter";

// Modelo declarativo de nodos: describe, por tipo, sus metadatos y sus campos configurables. Es la
// FUENTE ÚNICA que consume el inspector (NodeInspector) para renderizar la config de cualquier nodo.
// Agregar un tipo de nodo nuevo (HTTP, agente, loop, …) = agregar una entrada acá + su componente de
// canvas + su ejecutor en workflowEngine. Los campos con `vars:true` habilitan el autocompletado de
// {{id.output}} en el inspector.
export type NodeFieldType = "text" | "textarea" | "select";

export type NodeField = {
  key: string;
  label: string;
  type: NodeFieldType;
  placeholder?: string;
  rows?: number;
  vars?: boolean; // soporta templating {{...}} → autocompletado en el inspector
  options?: { value: string; label: string }[];
  dynamicOptions?: "flows" | "agents"; // opciones calculadas en runtime (flujos para subflow, agentes para agent)
};

export type NodeSchema = {
  type: string;
  title: string;
  icon: string;
  description: string;
  fields: NodeField[];
};

const LABEL_FIELD: NodeField = { key: "label", label: "Etiqueta", type: "text", placeholder: "Nombre del nodo" };

// Perfil de tarea para el router de modelos (modelRouter): en providers multi-modelo (OpenCode) la
// sesión del nodo usa el mejor modelo GRATIS para ese perfil, cuota-consciente. Vacío = default del agente.
const TASK_PROFILE_FIELD: NodeField = {
  key: "taskProfile", label: "Perfil de modelo", type: "select",
  options: [
    { value: "", label: "(default del agente)" },
    ...TASK_PROFILES.map((p) => ({ value: p.id, label: `${p.label} — ${p.hint}` })),
  ],
};

export const NODE_SCHEMAS: Record<string, NodeSchema> = {
  mimo: {
    type: "mimo",
    title: "DevFlow Code",
    icon: "🤖",
    description: "Le manda un prompt a DevFlow Code (sesión nueva por nodo) y usa su respuesta como salida.",
    fields: [
      LABEL_FIELD,
      { key: "prompt", label: "Prompt", type: "textarea", rows: 6, vars: true, placeholder: "Describí qué debe hacer DevFlow Code…" },
      TASK_PROFILE_FIELD,
    ],
  },
  terminal: {
    type: "terminal",
    title: "Terminal",
    icon: "💻",
    description: "Ejecuta un comando de shell (one-shot) en la carpeta del proyecto. Expone su salida y su exit code.",
    fields: [
      LABEL_FIELD,
      { key: "command", label: "Comando", type: "textarea", rows: 3, vars: true, placeholder: "npm test" },
    ],
  },
  file: {
    type: "file",
    title: "Archivo",
    icon: "📄",
    description: "Lee un archivo (salida = su contenido) o escribe la entrada del nodo en un archivo.",
    fields: [
      LABEL_FIELD,
      { key: "operation", label: "Operación", type: "select", options: [
        { value: "read", label: "Leer" },
        { value: "write", label: "Escribir" },
      ] },
      { key: "path", label: "Ruta", type: "text", vars: true, placeholder: "./src/main.ts" },
    ],
  },
  agent: {
    type: "agent",
    title: "Agente",
    icon: "🤖",
    description: "Le manda un prompt al agente elegido (elegible por nodo). Solo funcionan agentes con backend ACP o nativo real (DevFlow Code, Claude Code).",
    fields: [
      LABEL_FIELD,
      { key: "agentId", label: "Agente", type: "select", dynamicOptions: "agents" },
      { key: "prompt", label: "Prompt", type: "textarea", rows: 6, vars: true, placeholder: "Describí qué debe hacer el agente…" },
      TASK_PROFILE_FIELD,
    ],
  },
  verify: {
    type: "verify",
    title: "Verificar",
    icon: "✅",
    description: "Le pide al agente elegido (típicamente QA) que verifique algo de verdad usando sus tools disponibles (terminal, MCP de mobile-mcp/Desktop CDP/Puppeteer según lo que esté habilitado para el proyecto) y traduce su veredicto a exitCode (0=pasó, 1=falló) para que un nodo Condición pueda ramificar sobre {{id.exitCode}}.",
    fields: [
      LABEL_FIELD,
      { key: "agentId", label: "Agente", type: "select", dynamicOptions: "agents" },
      { key: "prompt", label: "Qué verificar", type: "textarea", rows: 6, vars: true, placeholder: "Ej: Abrí la app y confirmá que el botón \"Guardar\" persiste el formulario. Si el proyecto es mobile/web/desktop, usá las tools de MCP que tengas disponibles para operarlo de verdad, no asumas." },
      TASK_PROFILE_FIELD,
    ],
  },
  http: {
    type: "http",
    title: "HTTP Request",
    icon: "🌐",
    description: "Llama a una API (email, Telegram, deploy webhooks…). Salida = cuerpo de la respuesta; exitCode = 0 si 2xx, si no el código HTTP.",
    fields: [
      LABEL_FIELD,
      { key: "method", label: "Método", type: "select", options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" },
        { value: "PATCH", label: "PATCH" },
        { value: "DELETE", label: "DELETE" },
      ] },
      { key: "url", label: "URL", type: "text", vars: true, placeholder: "https://api.telegram.org/bot{{token}}/sendMessage" },
      { key: "headers", label: "Headers (JSON)", type: "textarea", rows: 3, vars: true, placeholder: "{ \"Content-Type\": \"application/json\" }" },
      { key: "body", label: "Body", type: "textarea", rows: 5, vars: true, placeholder: "{ \"chat_id\": \"...\", \"text\": \"{{msg.output}}\" }" },
    ],
  },
  mcp: {
    type: "mcp",
    title: "MCP Tool",
    icon: "🧩",
    description: "Llama una tool de un MCP server (DevFlow spawnea el server, hace el handshake y ejecuta tools/call). One-shot: ideal para tools sin estado (filesystem, fetch, brave-search…).",
    fields: [
      LABEL_FIELD,
      { key: "command", label: "Comando del server", type: "text", placeholder: "uvx code-index-mcp" },
      { key: "tool", label: "Tool", type: "text", placeholder: "search_code" },
      { key: "arguments", label: "Argumentos (JSON)", type: "textarea", rows: 4, vars: true, placeholder: "{ \"pattern\": \"{{1.output}}\" }" },
    ],
  },
  condition: {
    type: "condition",
    title: "Condición",
    icon: "🔀",
    description: "Evalúa una expresión (JS) y ramifica: la salida true/false activa la rama correspondiente.",
    fields: [
      LABEL_FIELD,
      { key: "condition", label: "Expresión", type: "text", vars: true, placeholder: "{{3.exitCode}} === 0" },
    ],
  },
  loop: {
    type: "loop",
    title: "Loop / ForEach",
    icon: "🔁",
    description: "Ejecuta un sub-flujo una vez por cada item de una lista (array JSON o líneas). El item se pasa como {{input}} (accedé campos con {{input.campo}}). Salida = array JSON con el resultado de cada iteración.",
    fields: [
      LABEL_FIELD,
      { key: "list", label: "Lista (array JSON o líneas)", type: "textarea", rows: 4, vars: true, placeholder: "[{\"email\":\"a@x.com\"},{\"email\":\"b@x.com\"}]" },
      { key: "flowId", label: "Sub-flujo por item", type: "select", dynamicOptions: "flows" },
      { key: "parallel", label: "Ejecución", type: "select", options: [
        { value: "sequential", label: "Secuencial" },
        { value: "parallel", label: "Paralelo (todas a la vez)" },
      ] },
    ],
  },
  subflow: {
    type: "subflow",
    title: "Sub-flujo",
    icon: "🧩",
    description: "Ejecuta otro flujo entero como un nodo (referencia viva). La entrada de este nodo se pasa como {{input}} del sub-flujo.",
    fields: [
      LABEL_FIELD,
      { key: "flowId", label: "Flujo a ejecutar", type: "select", dynamicOptions: "flows" },
    ],
  },
};

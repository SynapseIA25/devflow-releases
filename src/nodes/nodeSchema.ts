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
  dynamicOptions?: "flows"; // opciones calculadas en runtime (ej. lista de flujos para subflow)
};

export type NodeSchema = {
  type: string;
  title: string;
  icon: string;
  description: string;
  fields: NodeField[];
};

const LABEL_FIELD: NodeField = { key: "label", label: "Etiqueta", type: "text", placeholder: "Nombre del nodo" };

export const NODE_SCHEMAS: Record<string, NodeSchema> = {
  mimo: {
    type: "mimo",
    title: "MiMo Agent",
    icon: "🤖",
    description: "Le manda un prompt al agente MiMo (sesión ACP nueva por nodo) y usa su respuesta como salida.",
    fields: [
      LABEL_FIELD,
      { key: "prompt", label: "Prompt", type: "textarea", rows: 6, vars: true, placeholder: "Describí qué debe hacer MiMo…" },
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

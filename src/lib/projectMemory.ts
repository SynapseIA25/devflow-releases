// Memoria persistente de proyecto (Fase 3 del roadmap "herramienta nativa" — ver memoria del
// proyecto devflow-opencode-nativo): la pieza de MiMo Code de más valor y más portable sin forkear
// el motor de OpenCode. A diferencia de la memoria real de MiMo (SQLite, checkpoints automáticos,
// gestión de contexto), esto es 100% capa de DevFlow — un MEMORY.md por proyecto que se inyecta
// solo al abrir sesión y se actualiza a pedido (/remember en ChatView), por eso funciona igual para
// agentes ACP (MiMo/Claude) y para el path nativo de OpenCode: no depende de nada del motor.
import { readTextFile } from "./tauriApi";
import type { DocBlockData } from "../store/workspaceStore";

// Un archivo más en la raíz del proyecto, al mismo nivel que README.md — aparece solo en la
// pestaña Documentación de Project Hub (ya escanea *.md ahí), sin tocar esa vista.
export function memoryPath(projectRoot: string): string {
  return `${projectRoot}/MEMORY.md`;
}

export async function readProjectMemory(projectRoot: string): Promise<string> {
  try {
    return await readTextFile(memoryPath(projectRoot));
  } catch {
    return ""; // no existe todavía — no es un error, el proyecto simplemente no tiene memoria aún
  }
}

// Se manda el contenido COMPLETO (no un índice+path como el preámbulo de skills): la memoria es
// chica por diseño — cada /remember la re-resume, no crece sin límite — y no vale la pena pagar un
// tool-call de lectura aparte para algo que ya tenemos a mano al armar el prompt.
export async function buildMemoryPreamble(projectRoot: string): Promise<string> {
  const content = (await readProjectMemory(projectRoot)).trim();
  if (!content) return "";
  return `[Memory]\nProject memory from previous sessions:\n\n${content}`;
}

// Transcript acotado de los bloques recientes del workspace para el turno de destilación (/remember)
// — solo user/ai (se saltea tool/thought, son ruido para "qué aprendimos"), capado en cantidad y en
// largo por bloque para no volar el contexto del modelo que arma la memoria.
export function summarizeWorkspaceBlocks(blocks: DocBlockData[], maxBlocks = 40, maxCharsPerBlock = 800): string {
  const relevant = blocks.filter((b) => b.type === "user" || b.type === "ai").slice(-maxBlocks);
  const lines = relevant.map((b) => {
    const who = b.type === "user" ? "Usuario" : "Agente";
    const text = b.content.length > maxCharsPerBlock ? `${b.content.slice(0, maxCharsPerBlock)}…` : b.content;
    return `${who}: ${text}`;
  });
  return lines.join("\n\n");
}

export function buildDistillationPrompt(existingMemory: string, transcript: string): string {
  return (
    `Mantenés el archivo de memoria persistente de un proyecto (MEMORY.md), que se inyecta ` +
    `completo al principio de CADA sesión nueva de chat sobre este proyecto — tiene que quedar ` +
    `conciso y realmente útil, no un log de todo lo que pasó.\n\n` +
    `Memoria actual:\n${existingMemory.trim() || "(vacía — todavía no hay memoria para este proyecto)"}\n\n` +
    `Conversación reciente:\n${transcript || "(sin mensajes de usuario/agente para resumir)"}\n\n` +
    `Actualizá la memoria: agregá decisiones, contexto de negocio, convenciones o gotchas ` +
    `durables que aprendiste en esta conversación y que le servirían a una sesión futura para no ` +
    `arrancar de cero; sacá lo que haya quedado obsoleto o irrelevante; no dupliques lo que ya está. ` +
    `Respondé ÚNICAMENTE con el contenido Markdown completo y actualizado del archivo, sin comentario ` +
    `extra, sin fences de código alrededor de todo el archivo.`
  );
}

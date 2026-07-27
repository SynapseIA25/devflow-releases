import { StreamLanguage, type LanguageSupport } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { Extension } from "@codemirror/state";

// Devuelve la extensión de lenguaje de CodeMirror apropiada según la extensión del archivo.
// Los lenguajes con paquete propio usan `lang-*`; toml/yaml no tienen uno oficial en CM6 y van
// por `legacy-modes` (StreamLanguage). Si no hay match, devuelve [] (texto plano sin resaltado).
export function languageForPath(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "jsx":
      return javascript({ jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "rs":
      return rust() as LanguageSupport;
    case "css":
      return css();
    case "json":
      return json();
    case "html":
    case "htm":
      return html();
    case "md":
    case "markdown":
      return markdown();
    case "py":
      return python();
    case "toml":
      return StreamLanguage.define(toml);
    case "yaml":
    case "yml":
      return StreamLanguage.define(yaml);
    default:
      return [];
  }
}

export type LspKind = "ts" | "rust";

// Extensiones con language server real disponible (TS/JS vía typescript-language-server, Rust vía
// rust-analyzer, ver lspClient.ts). `languageId` es el identificador que espera el protocolo LSP
// (`textDocument/didOpen.textDocument.languageId`), no necesariamente igual a la extensión del
// archivo (ej. "typescript" para .ts, "typescriptreact" para .tsx). null = sin LSP para esa
// extensión — el editor sigue comportándose exactamente igual que hoy (solo resaltado sintáctico).
export function lspInfoForPath(path: string): { kind: LspKind; languageId: string } | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return { kind: "ts", languageId: "typescript" };
    case "tsx":
      return { kind: "ts", languageId: "typescriptreact" };
    case "js":
    case "mjs":
    case "cjs":
      return { kind: "ts", languageId: "javascript" };
    case "jsx":
      return { kind: "ts", languageId: "javascriptreact" };
    case "rs":
      return { kind: "rust", languageId: "rust" };
    default:
      return null;
  }
}

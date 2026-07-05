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

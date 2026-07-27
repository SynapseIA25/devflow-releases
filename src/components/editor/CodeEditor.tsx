import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageForPath } from "../../lib/editorLang";
import { pluginFor } from "../../lib/lspClient";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  // Raíz del proyecto activo — si se pasa, habilita hover/autocompletado/find-references reales
  // (LSP) para los lenguajes que tengan server mapeado (ver lspInfoForPath). Omitirlo deja el
  // editor exactamente como hoy (solo resaltado sintáctico).
  projectPath?: string;
};

// Wrapper imperativo de CodeMirror 6 (mismo patrón que TerminalPane con xterm): la instancia de
// EditorView vive en un ref y se crea una sola vez por montaje. Se monta una instancia por archivo
// activo — el `key={path}` en EditorView hace que React lo recree al cambiar de pestaña, así el
// lenguaje/documento arrancan correctos sin tener que reconfigurar en vivo.
export function CodeEditor({ path, value, onChange, onSave, projectPath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lspCompartmentRef = useRef<Compartment | null>(null);
  // Refs para que los callbacks siempre vean la última versión sin recrear el editor.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current(u.state.doc.toString());
    });

    // Arranca vacío: la extensión LSP real (hover/autocompletado/find-references) se resuelve
    // async en el efecto de abajo y se inyecta acá sin recrear el editor (evita bloquear la
    // apertura del archivo esperando al language server).
    const lspCompartment = new Compartment();
    lspCompartmentRef.current = lspCompartment;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        saveKeymap,
        languageForPath(path),
        lspCompartment.of([]),
        oneDark,
        updateListener,
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "'Cascadia Code','Consolas',monospace" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza cambios EXTERNOS de `value` (ej. recargar desde disco, o carga async inicial) hacia
  // el documento. Guarda contra el loop: si el valor ya coincide con el doc (caso típico: el cambio
  // vino de que el usuario tipeó → onChange → store → value), no vuelve a despachar.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Conecta el language server real (hover/autocompletado/signature help/find-references/jump-to-
  // definition) para el lenguaje de este archivo, si hay uno mapeado (ver lspInfoForPath) y se
  // conoce la raíz del proyecto activo. Sin projectPath, o para lenguajes sin server (css/json/
  // md/py/etc.), pluginFor resuelve null y el editor queda exactamente como antes.
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void pluginFor(path, projectPath).then((ext) => {
      if (cancelled) return;
      const view = viewRef.current;
      const compartment = lspCompartmentRef.current;
      if (!view || !compartment) return;
      view.dispatch({ effects: compartment.reconfigure(ext ?? []) });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, projectPath]);

  return <div ref={hostRef} className="code-editor-host" />;
}

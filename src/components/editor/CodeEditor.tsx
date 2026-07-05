import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageForPath } from "../../lib/editorLang";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
};

// Wrapper imperativo de CodeMirror 6 (mismo patrón que TerminalPane con xterm): la instancia de
// EditorView vive en un ref y se crea una sola vez por montaje. Se monta una instancia por archivo
// activo — el `key={path}` en EditorView hace que React lo recree al cambiar de pestaña, así el
// lenguaje/documento arrancan correctos sin tener que reconfigurar en vivo.
export function CodeEditor({ path, value, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        saveKeymap,
        languageForPath(path),
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

  return <div ref={hostRef} className="code-editor-host" />;
}

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { isTauri, watchStart, watchStop, readTextFile } from "../lib/tauriApi";

// Vigila los archivos abiertos en el editor (reusa el watcher notify de Rust) y mantiene las pestañas
// en sync con el disco. Montado UNA vez a nivel App (no renderiza nada). Cuando un archivo cambia
// afuera (ej. lo escribió el agente):
//  - si la pestaña NO tiene cambios sin guardar → auto-recarga silenciosa (compara para no parpadear
//    ni reaccionar al propio guardado del editor).
//  - si la pestaña SÍ tiene cambios sin guardar → marca externalChanged (aviso, no pisa tu edición).
// Los ids de watcher del editor son las propias rutas; no chocan con los triggers de workflow (que
// escuchan el mismo evento pero buscan por su id de trigger, no de path).
const DEBOUNCE_MS = 350;

export function EditorWatcher() {
  const tabs = useEditorStore((s) => s.tabs);
  const watchedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Reconcilia los watchers con las pestañas abiertas.
  useEffect(() => {
    if (!isTauri()) return;
    const open = new Set(tabs.map((t) => t.path));
    for (const path of open) {
      if (!watchedRef.current.has(path)) {
        watchStart(path, path).then(() => watchedRef.current.add(path)).catch(() => {});
      }
    }
    for (const path of [...watchedRef.current]) {
      if (!open.has(path)) {
        void watchStop(path);
        watchedRef.current.delete(path);
      }
    }
  }, [tabs]);

  // Escucha los cambios en disco y reconcilia la pestaña.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("file-changed", (e) => {
        const path = e.payload;
        const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
        if (!tab || tab.loading) return; // no es una pestaña abierta (o es un id de trigger) → ignora

        // Debounce: notify emite varios eventos por un mismo cambio.
        const prev = timersRef.current.get(path);
        if (prev) clearTimeout(prev);
        timersRef.current.set(
          path,
          setTimeout(async () => {
            timersRef.current.delete(path);
            const t = useEditorStore.getState().tabs.find((x) => x.path === path);
            if (!t) return;
            const dirty = t.content !== t.savedContent;
            if (dirty) {
              // No pisamos ediciones sin guardar: avisamos.
              useEditorStore.getState().markExternalChanged(path);
              return;
            }
            // No sucia: recargamos solo si el contenido en disco realmente difiere (evita reaccionar
            // al propio guardado del editor y parpadeos).
            try {
              const disk = await readTextFile(path);
              if (disk !== t.savedContent) await useEditorStore.getState().reload(path);
            } catch {
              /* archivo borrado/ilegible: lo dejamos como está */
            }
          }, DEBOUNCE_MS)
        );
      });
    })();
    return () => {
      unlisten?.();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  return null;
}

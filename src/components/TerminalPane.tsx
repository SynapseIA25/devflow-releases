import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, isTauri, readTextFile, writeTextFile, createDir } from "../lib/tauriApi";

// Ruta del archivo de scrollback persistido de esta terminal — separado por proyecto/worktree (cwd)
// vía una carpeta oculta, mismo criterio que .devflow/memory. Forward-slashes: Tauri los resuelve
// bien en Windows, a diferencia de mezclar con backslashes.
function scrollbackPath(cwd: string, workspaceId: string): string {
  return `${cwd.replace(/[\\/]+$/, "")}/.devflow/terminal-scrollback/${workspaceId}.txt`;
}

type TerminalPaneProps = {
  workspaceId: string;
  cwd: string;
  env?: Record<string, string>; // ambiente del proyecto (Frente 4), inyectado a la terminal
  active: boolean;
};

// Una sesión PTY por workspace, montada UNA sola vez y nunca destruida mientras la pestaña
// exista (display:none cuando no está activa) — así cambiar de tab no mata el proceso ni
// pierde el scrollback. xterm.js ya acumula el buffer en background aunque el panel esté oculto.
export function TerminalPane({ workspaceId, cwd, env, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const spawnedRef = useRef(false);

  // Best-effort: nunca debe romper la terminal si falla (disco lleno, path raro, etc.).
  const persistScrollback = () => {
    const term = termRef.current;
    const serializeAddon = serializeAddonRef.current;
    if (!term || !serializeAddon || !isTauri()) return;
    const content = serializeAddon.serialize();
    if (!content) return;
    const path = scrollbackPath(cwd, workspaceId);
    void createDir(path.slice(0, path.lastIndexOf("/")))
      .catch(() => {})
      .then(() => writeTextFile(path, content))
      .catch(() => {});
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'Cascadia Code','Consolas',monospace",
      fontSize: 12,
      scrollback: 2000,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#7c3aed",
        selectionBackground: "#21262d",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;

    // WebGL es una mejora de rendering, no una dependencia dura: si el contexto GPU no está
    // disponible (VM, drivers viejos, etc.) seguimos con el renderer DOM por defecto de xterm.
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      /* renderer DOM por defecto */
    }

    if (!isTauri()) {
      term.write("Terminal real requiere la app desktop (Tauri). Ejecutá: npm run tauri dev\r\n");
    }

    const dataDisposable = term.onData((data) => { void ptyWrite(workspaceId, data); });

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    (async () => {
      if (!isTauri()) return;
      // Restaura el scrollback de una sesión anterior (si existe) ANTES de conectar el PTY en
      // vivo, así el usuario ve el historial de la última vez que abrió esta misma terminal.
      try {
        const saved = await readTextFile(scrollbackPath(cwd, workspaceId));
        if (saved) term.write(saved);
      } catch {
        /* sin scrollback previo, primera vez */
      }

      const { listen } = await import("@tauri-apps/api/event");
      unlistenOutput = await listen<string>(`pty-output:${workspaceId}`, (e) => {
        term.write(e.payload);
      });
      unlistenExit = await listen<number | null>(`pty-exit:${workspaceId}`, (e) => {
        term.write(`\r\n\x1b[2m[proceso terminado${e.payload != null ? ` - exit code ${e.payload}` : ""}]\x1b[0m\r\n`);
      });

      if (!spawnedRef.current) {
        spawnedRef.current = true;
        fitAddon.fit();
        try {
          // env se captura al spawnear (cwd cambia junto al proyecto → el efecto re-spawnea con el env fresco).
          await ptySpawn(workspaceId, cwd, term.rows, term.cols, undefined, env);
        } catch (e) {
          term.write(`\r\n\x1b[31mError al iniciar terminal: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      persistScrollback();
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      term.dispose();
      void ptyKill(workspaceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, cwd]);

  // Hacer fit solo cuando el panel está visible — un contenedor display:none mide 0x0 y
  // rompería el cálculo de filas/columnas.
  useEffect(() => {
    if (!active) return;
    const fitAddon = fitAddonRef.current;
    const term = termRef.current;
    if (!fitAddon || !term) return;
    fitAddon.fit();
    void ptyResize(workspaceId, term.rows, term.cols);
    // Al ocultarse (deja de estar activa) persistimos el scrollback — cubre el caso común de
    // cambiar de pestaña/desactivar el split sin cerrar la terminal (que ya persiste al desmontar).
    return () => persistScrollback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaceId]);

  // Cubre el drag-handle de termHeight y cualquier otro cambio de layout mientras el panel
  // está visible (un panel oculto no dispara ResizeObserver, ese caso ya lo cubre el efecto de arriba).
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!active) return;
      fitAddonRef.current?.fit();
      const term = termRef.current;
      if (term) void ptyResize(workspaceId, term.rows, term.cols);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [workspaceId, active]);

  return (
    <div className="terminal-pane-host" style={{ display: active ? "block" : "none", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

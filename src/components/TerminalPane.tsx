import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, isTauri } from "../lib/tauriApi";

type TerminalPaneProps = {
  workspaceId: string;
  cwd: string;
  active: boolean;
};

// Una sesión PTY por workspace, montada UNA sola vez y nunca destruida mientras la pestaña
// exista (display:none cuando no está activa) — así cambiar de tab no mata el proceso ni
// pierde el scrollback. xterm.js ya acumula el buffer en background aunque el panel esté oculto.
export function TerminalPane({ workspaceId, cwd, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);

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
    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    if (!isTauri()) {
      term.write("Terminal real requiere la app desktop (Tauri). Ejecutá: npm run tauri dev\r\n");
    }

    const dataDisposable = term.onData((data) => { void ptyWrite(workspaceId, data); });

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    (async () => {
      if (!isTauri()) return;
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
          await ptySpawn(workspaceId, cwd, term.rows, term.cols);
        } catch (e) {
          term.write(`\r\n\x1b[31mError al iniciar terminal: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
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

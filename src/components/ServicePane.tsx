import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, isTauri } from "../lib/tauriApi";

type Props = {
  id: string;          // = id del servicio; también el id del canal PTY (pty-output:<id> / pty-exit:<id>)
  command: string;
  cwd: string;
  env?: Record<string, string>; // ambiente del proyecto (Frente 4), inyectado al proceso del servicio
  active: boolean;     // visible (el servicio seleccionado). Los no-activos quedan display:none, montados.
  onExit: (code: number | null) => void;
};

// Terminal de logs de un servicio. Igual patrón que TerminalPane pero corre un COMANDO (no un shell
// interactivo) y reporta cuándo termina. Se monta cuando el servicio arranca y se mantiene montado
// (aunque el proceso muera) para no perder los logs; la vista decide cuándo desmontarlo.
export function ServicePane({ id, command, cwd, env, active, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: false,
      fontFamily: "'Cascadia Code','Consolas',monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: { background: "#0d1117", foreground: "#e6edf3", cursor: "#7c3aed", selectionBackground: "#21262d" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    term.write(`\x1b[2m$ ${command}\x1b[0m\r\n`);
    if (!isTauri()) term.write("Los servicios requieren la app desktop (Tauri).\r\n");

    // Permite mandar input al proceso (responder prompts, Ctrl+C, etc.), igual que la terminal del chat.
    const dataDisposable = term.onData((d) => { void ptyWrite(id, d); });

    let unOut: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    (async () => {
      if (!isTauri()) return;
      const { listen } = await import("@tauri-apps/api/event");
      unOut = await listen<string>(`pty-output:${id}`, (e) => term.write(e.payload));
      unExit = await listen<number | null>(`pty-exit:${id}`, (e) => {
        term.write(`\r\n\x1b[2m[servicio terminado${e.payload != null ? ` - exit code ${e.payload}` : ""}]\x1b[0m\r\n`);
        onExitRef.current(e.payload);
      });
      if (!spawnedRef.current) {
        spawnedRef.current = true;
        fitAddon.fit();
        try {
          await ptySpawn(id, cwd, term.rows, term.cols, command, env);
        } catch (e) {
          term.write(`\r\n\x1b[31mError al iniciar el servicio: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      dataDisposable.dispose();
      unOut?.();
      unExit?.();
      term.dispose();
      void ptyKill(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!active) return;
    const fitAddon = fitAddonRef.current;
    const term = termRef.current;
    if (!fitAddon || !term) return;
    fitAddon.fit();
    void ptyResize(id, term.rows, term.cols);
  }, [active, id]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!active) return;
      fitAddonRef.current?.fit();
      const term = termRef.current;
      if (term) void ptyResize(id, term.rows, term.cols);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [id, active]);

  return (
    <div className="service-pane-host" style={{ display: active ? "block" : "none", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

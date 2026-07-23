// Escribe (idempotente, dedup por contenido) el script del MCP server de verificación desktop a
// `<home>/.devflow/cdp-mcp.js` — mismo patrón que mcpBridge.ts/ensureBridgeStarted, pero más simple:
// este server no le habla de vuelta a DevFlow (se conecta directo al puerto de debug de la app
// target), así que no hace falta discovery file ni proceso HTTP en Rust, solo el archivo en disco.
import { readTextFile, writeTextFile, createDir, homeDir } from "./tauriApi";
import { DESKTOP_CDP_MCP_SCRIPT_SOURCE } from "./desktopCdpScript";

let ensurePromise: Promise<string> | null = null;

// Devuelve la ruta del script, escribiéndolo primero si hace falta.
export function ensureDesktopCdpScriptWritten(): Promise<string> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const dir = `${await homeDir()}/.devflow`;
      await createDir(dir);
      const path = `${dir}/cdp-mcp.js`;
      try {
        const existing = await readTextFile(path);
        if (existing !== DESKTOP_CDP_MCP_SCRIPT_SOURCE) await writeTextFile(path, DESKTOP_CDP_MCP_SCRIPT_SOURCE);
      } catch {
        await writeTextFile(path, DESKTOP_CDP_MCP_SCRIPT_SOURCE);
      }
      return path;
    })();
  }
  return ensurePromise;
}

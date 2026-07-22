import { useEffect } from "react";
import { isTauri, mcpRespond } from "../lib/tauriApi";
import { ensureBridgeStarted } from "../lib/mcpBridge";
import { handleBridgeTool } from "../lib/mcpBridgeHandlers";

type BridgeCallPayload = { id: number; tool: string; arguments: unknown; projectPath: string };

// El listener se registra UNA sola vez por vida de la app (flag a nivel de módulo, no por-montaje) —
// mismo criterio que `frontendListenerAttached` en opencodeClient.ts. Necesario: bajo React.StrictMode
// (dev) los efectos se montan/desmontan/remontan, y como `listen()` es async, el cleanup de la PRIMERA
// pasada corre ANTES de que su `unlisten` esté asignado — sin este flag quedan dos listeners activos,
// y cada tool call real se despacha DOS VECES (verificado en runtime: rompía el guard de recursión de
// devflow_run_workflow, que veía su propio "ya está corriendo" contra sí mismo).
let listenerAttached = false;

// Arranca el MCP bridge de DevFlow y despacha las tool calls que le lleguen. Montado UNA vez a nivel
// App (no renderiza nada) — mismo patrón que TriggerRunner/EditorWatcher. Ver mcpBridge.ts para el
// diseño completo (por qué un bridge HTTP+Rust en vez de hablarle directo al store desde el proceso
// Node del MCP server: ese proceso es OTRO proceso del SO, sin acceso al estado en memoria del webview).
export function McpBridgeRunner() {
  useEffect(() => {
    if (!isTauri() || listenerAttached) return;
    listenerAttached = true;
    void ensureBridgeStarted();
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<BridgeCallPayload>("devflow-bridge-call", async (event) => {
        const { id, tool, arguments: args, projectPath } = event.payload;
        try {
          const result = await handleBridgeTool(tool, args, projectPath);
          await mcpRespond(id, result);
        } catch (e) {
          await mcpRespond(id, undefined, e instanceof Error ? e.message : String(e));
        }
      });
    })();
  }, []);

  return null;
}

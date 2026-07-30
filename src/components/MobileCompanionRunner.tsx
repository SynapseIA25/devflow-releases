import { useEffect, useRef } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { mobileCompanionStart, mobileCompanionReply, isTauri } from "../lib/tauriApi";

export const MOBILE_COMPANION_PORT = 8791;

type MobileRequest = { id: number; kind: "list" | "message"; workspaceId: string; body: string };

// Mobile Companion (base, Orca backlog): puente entre el servidor HTTP de lib.rs y el estado real
// de la app (workspaces viven en zustand, no en Rust) — mismo patrón que McpBridgeRunner para el
// MCP bridge. Montado una vez en App.tsx, no renderiza nada. El servidor arranca una sola vez que
// se habilita (idempotente del lado de Rust); si se deshabilita después, seguimos escuchando pero
// respondemos error en vez de datos reales — más simple que intentar cerrar el socket de tiny_http.
export function MobileCompanionRunner() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<MobileRequest>("mobile-companion-request", (e) => {
        const { id, kind, workspaceId, body } = e.payload;
        const enabled = useSettingsStore.getState().mobileCompanionEnabled;
        if (!enabled) {
          void mobileCompanionReply(id, null, "Mobile Companion is disabled in Settings.");
          return;
        }
        if (kind === "list") {
          const list = useWorkspaceStore.getState().workspaces.map((w) => ({
            id: w.id,
            title: w.title,
            projectId: w.projectId,
            running: !!w.running,
            lastMessage: [...w.blocks].reverse().find((b) => b.type === "ai" || b.type === "user")?.content?.slice(0, 300) ?? "",
          }));
          void mobileCompanionReply(id, list);
          return;
        }
        if (kind === "message") {
          let text = "";
          try {
            text = (JSON.parse(body) as { text?: string }).text ?? "";
          } catch {
            /* body no era JSON válido */
          }
          const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
          if (!ws) {
            void mobileCompanionReply(id, null, `No existe el workspace "${workspaceId}".`);
            return;
          }
          if (!text.trim()) {
            void mobileCompanionReply(id, null, "Falta el texto del mensaje.");
            return;
          }
          useWorkspaceStore.getState().setPendingInitialPrompt(workspaceId, text);
          void mobileCompanionReply(id, { ok: true });
        }
      });
    })();
    return () => unlisten?.();
  }, []);

  // Arranca el servidor la primera vez que se habilita en esta sesión — idempotente del lado de
  // Rust (devuelve el mismo puerto si ya está corriendo), así que no hace falta un flag propio más
  // allá de evitar el llamado repetido en cada render.
  const enabled = useSettingsStore((s) => s.mobileCompanionEnabled);
  const token = useSettingsStore((s) => s.mobileCompanionToken);
  useEffect(() => {
    if (!enabled || startedRef.current || !isTauri()) return;
    startedRef.current = true;
    void mobileCompanionStart(MOBILE_COMPANION_PORT, token).catch(() => { startedRef.current = false; });
  }, [enabled, token]);

  return null;
}

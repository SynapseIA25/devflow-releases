import { useState } from "react";
import { X, ExternalLink, MousePointerClick, Send, Loader2 } from "lucide-react";
import { openDesignModeWindow, closeDesignModeWindow } from "../lib/tauriApi";
import { captureNextClick, type CapturedElement } from "../lib/cdpClient";
import { useUiStore } from "../store/uiStore";

// Puerto de debug dedicado a la ventana de Design Mode — distinto del 9222 que se usa a mano para
// verificar DevFlow mismo, y de los puertos de dev server comunes (1420 de Vite acá, 3000/5173, etc).
// Exportado: DesignPreviewControls.tsx (vista Design) reusa la MISMA ventana singleton "design-mode".
export const DESIGN_MODE_DEBUG_PORT = 9333;

export function DesignModeModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("http://localhost:");
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<CapturedElement | null>(null);
  const setPendingPrompt = useUiStore((s) => s.setPendingPrompt);
  const setPendingImage = useUiStore((s) => s.setPendingImage);
  const setView = useUiStore((s) => s.setView);

  const open = async () => {
    if (!url.trim()) return;
    setOpening(true);
    setError(null);
    try {
      await openDesignModeWindow(url.trim(), DESIGN_MODE_DEBUG_PORT);
      setOpened(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const capture = async () => {
    setCapturing(true);
    setError(null);
    try {
      setCaptured(await captureNextClick(DESIGN_MODE_DEBUG_PORT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  const sendToChat = () => {
    if (!captured) return;
    setPendingPrompt(`[Design Mode] Captured element:\n\n\`\`\`html\n${captured.html}\n\`\`\`\n\nComputed styles (abridged):\n\`\`\`css\n${captured.css}\n\`\`\``);
    setPendingImage({ dataUrl: captured.screenshotDataUrl, mimeType: "image/png" });
    setView("chat");
    onClose();
  };

  const closeWindow = () => {
    void closeDesignModeWindow();
    setOpened(false);
    setCaptured(null);
  };

  return (
    <div className="mcp-modal-overlay" onClick={onClose}>
      <div className="mcp-modal design-mode-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-modal-header">
          <span className="mcp-modal-title">Design Mode</span>
          <button className="fw-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="mcp-modal-body">
          <p className="design-mode-hint">
            Point this at your own app's dev server (must already be running). Click any element in
            that window to send its HTML, computed styles, and a cropped screenshot into the chat.
          </p>
          {!opened ? (
            <div className="design-mode-open-row">
              <input
                className="terms-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:5173"
                onKeyDown={(e) => { if (e.key === "Enter") void open(); }}
              />
              <button className="svc-btn svc-btn--primary" onClick={() => void open()} disabled={opening || !url.trim()}>
                {opening ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />} Open
              </button>
            </div>
          ) : (
            <>
              <div className="design-mode-open-row">
                <button className="svc-btn svc-btn--primary" onClick={() => void capture()} disabled={capturing}>
                  {capturing ? <Loader2 size={13} className="spin" /> : <MousePointerClick size={13} />}
                  {capturing ? "Click an element in the other window…" : "Capture next click"}
                </button>
                <button className="svc-btn" onClick={closeWindow}>Close window</button>
              </div>
              {captured && (
                <div className="design-mode-preview">
                  <img src={captured.screenshotDataUrl} alt="" className="design-mode-screenshot" />
                  <pre className="design-mode-code">{captured.html.slice(0, 400)}</pre>
                  <button className="svc-btn svc-btn--primary" onClick={sendToChat}>
                    <Send size={13} /> Send to chat
                  </button>
                </div>
              )}
            </>
          )}
          {error && <div className="onb-install-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

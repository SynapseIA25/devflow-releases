import { useState } from "react";
import { ExternalLink, Smartphone, Tablet, Monitor, Loader2 } from "lucide-react";
import { openDesignModeWindow, resizeDesignModeWindow } from "../../lib/tauriApi";
import { DESIGN_MODE_DEBUG_PORT } from "../DesignModeModal";

// Preview visual REAL del proyecto (no un re-render propio de DevFlow, ver plan): abre la misma
// ventana secundaria que ya usa Design Mode apuntando al dev server del usuario, y la redimensiona a
// presets de viewport. Como el canvas escribe archivos reales, el HMR del propio proyecto muestra el
// resultado ahí solo — cero motor de renderizado propio que mantener.
const PRESETS = [
  { id: "mobile", label: "Mobile", icon: Smartphone, width: 375, height: 812 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 768, height: 1024 },
  { id: "desktop", label: "Desktop", icon: Monitor, width: 1440, height: 900 },
] as const;

export function DesignPreviewControls() {
  const [url, setUrl] = useState("");
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (!url.trim()) return;
    setOpening(true);
    setError(null);
    try {
      await openDesignModeWindow(url.trim(), DESIGN_MODE_DEBUG_PORT);
      setOpened(true);
      const first = PRESETS[0];
      await resizeDesignModeWindow(first.width, first.height);
      setActivePreset(first.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const applyPreset = async (preset: (typeof PRESETS)[number]) => {
    setError(null);
    try {
      await resizeDesignModeWindow(preset.width, preset.height);
      setActivePreset(preset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="design-preview">
      <p className="design-preview-hint">
        This opens your project's own app in a real browser window — start its dev server first
        (e.g. <code>npm run dev</code>, from the <strong>Services</strong> tab keeps it running in the
        background), then enter the URL it prints below.
      </p>
      <div className="design-preview-row">
        <input
          className="design-save-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:5173"
          onKeyDown={(e) => { if (e.key === "Enter") void open(); }}
        />
        <button className="design-save-btn" onClick={() => void open()} disabled={opening || !url.trim()}>
          {opening ? <Loader2 size={12} className="spin" /> : <ExternalLink size={12} />}
          {opened ? "Reopen" : "Open preview"}
        </button>
        {opened &&
          PRESETS.map((p) => (
            <button
              key={p.id}
              className={`design-preview-preset${activePreset === p.id ? " active" : ""}`}
              onClick={() => void applyPreset(p)}
              title={`${p.width}×${p.height}`}
            >
              <p.icon size={12} /> {p.label}
            </button>
          ))}
      </div>
      {error && (
        <div className="design-save-status design-save-status--error">
          {error.toLowerCase().includes("refused") || error.toLowerCase().includes("connect")
            ? "Couldn't connect — is the dev server actually running at that URL?"
            : error}
        </div>
      )}
      {opened && (
        <div className="design-preview-note">
          If the preview window shows a browser error instead of your app, the dev server isn't
          reachable at that URL yet — start it and click "Reopen".
        </div>
      )}
    </div>
  );
}

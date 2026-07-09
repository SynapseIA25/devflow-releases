import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, Loader2 } from "lucide-react";

// Banner no intrusivo de auto-actualización. Al montar, consulta el endpoint del updater
// (Releases de GitHub) una sola vez; si hay una versión nueva firmada, ofrece descargarla e
// instalarla, y relanza la app. Silencioso si no hay update o si el chequeo falla (típico en
// `tauri dev`, donde no hay artefactos firmados publicados).
type Phase = "idle" | "available" | "downloading" | "done" | "error";

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    check()
      .then((u) => {
        if (!cancelled && u) {
          setUpdate(u);
          setPhase("available");
        }
      })
      .catch(() => {
        // Sin conexión, sin endpoint publicado o ya estamos en la última: no molestamos.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (!update) return;
    setPhase("downloading");
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        }
      });
      setPhase("done");
      await relaunch();
    } catch {
      setPhase("error");
    }
  }

  if (dismissed || phase === "idle" || !update) return null;

  return (
    <div className="update-banner">
      {phase === "available" && (
        <>
          <span className="update-banner-text">
            DevFlow <b>v{update.version}</b> disponible.
          </span>
          <button className="update-banner-btn" onClick={install}>
            <Download size={13} /> Instalar y reiniciar
          </button>
          <button className="update-banner-x" onClick={() => setDismissed(true)} aria-label="Descartar">
            <X size={14} />
          </button>
        </>
      )}
      {phase === "downloading" && (
        <span className="update-banner-text">
          <Loader2 size={13} className="update-banner-spin" /> Descargando actualización… {pct}%
        </span>
      )}
      {phase === "done" && <span className="update-banner-text">Instalada. Reiniciando…</span>}
      {phase === "error" && (
        <>
          <span className="update-banner-text">No se pudo instalar la actualización.</span>
          <button className="update-banner-x" onClick={() => setDismissed(true)} aria-label="Descartar">
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}

// Cliente CDP (Chrome DevTools Protocol) desde el propio browser, misma técnica que el helper
// cdp.mjs usado a mano toda la sesión para verificar DevFlow (ver memoria devflow-cdp-verificacion):
// fetch a /json + WebSocket al webSocketDebuggerUrl + Runtime.evaluate/Page.captureScreenshot. No se
// reusa desktopCdpScript.ts (el MCP tool que usa el agente para QA) porque ese es una STRING de
// script Node para un proceso aparte via stdio, no un módulo importable desde React — mismo criterio
// de "duplicar lo mínimo, con motivo" que ya sigue collectFiles/collectRagFiles en este proyecto.

type CdpTarget = { id: string; type: string; url: string; webSocketDebuggerUrl: string };

async function findPageTarget(port: number): Promise<CdpTarget> {
  const res = await fetch(`http://localhost:${port}/json`);
  const list: CdpTarget[] = await res.json();
  const target = list.find((t) => t.type === "page");
  if (!target) throw new Error("No se encontró una página para conectar por CDP — ¿la ventana de Design Mode sigue abierta?");
  return target;
}

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("No se pudo conectar por CDP a la ventana de Design Mode."));
  });
}

function send(ws: WebSocket, id: number, method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Instala un listener de click de una sola vez (capture, preventDefault) y resuelve con el HTML/CSS
// del elemento clickeado — Runtime.evaluate con awaitPromise:true bloquea la request de CDP hasta
// que el usuario clickea, igual que hace cdp.mjs con expresiones async envueltas.
const CLICK_CAPTURE_SCRIPT = `
(async () => {
  return new Promise((resolve) => {
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener("click", onClick, true);
      const el = e.target;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cssText = [...cs].slice(0, 60).map((p) => p + ": " + cs.getPropertyValue(p) + ";").join(" ");
      resolve({
        html: el.outerHTML.slice(0, 5000),
        css: cssText.slice(0, 3000),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    };
    document.addEventListener("click", onClick, true);
  });
})()
`;

export type CapturedElement = { html: string; css: string; screenshotDataUrl: string };

// Espera el próximo click en la ventana de Design Mode y devuelve HTML + estilos computados +
// un screenshot recortado al elemento clickeado.
export async function captureNextClick(port: number): Promise<CapturedElement> {
  const target = await findPageTarget(port);
  const ws = await connect(target.webSocketDebuggerUrl);
  try {
    const evalResult = await send(ws, 1, "Runtime.evaluate", {
      expression: CLICK_CAPTURE_SCRIPT,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evalResult.exceptionDetails) {
      throw new Error(evalResult.exceptionDetails.exception?.description ?? "Error ejecutando el script de captura.");
    }
    const { html, css, rect } = evalResult.result.value as { html: string; css: string; rect: { x: number; y: number; width: number; height: number } };
    const shot = await send(ws, 2, "Page.captureScreenshot", {
      format: "png",
      clip: { x: rect.x, y: rect.y, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1), scale: 1 },
    });
    return { html, css, screenshotDataUrl: `data:image/png;base64,${shot.data}` };
  } finally {
    ws.close();
  }
}

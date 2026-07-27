// Fase 5 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Tabla estática fingerprint→estrategia, mismo espíritu que el CATALOG
// de McpView.tsx, pero vive en src/lib/ (no en el view) porque la consumen tres cosas: el panel de UI,
// el fallback al agente QA (para saber qué mcpServerIds puede elegir — ver testStrategyAgent.ts) y,
// más adelante, el bridge MCP conversacional — ninguno de los dos últimos tiene un árbol de React del
// que colgarse, así que los íconos son strings (emoji), no JSX, igual que nodeSchema.ts.
import type { StackFingerprint } from "./stackDetect";

export type TestCasePattern = {
  id: string;
  label: string;
  description: string;
};

export type TestStrategy = {
  backend: string;
  mcpServerIds: string[]; // ids reales del catálogo de McpView.tsx — ver KNOWN_MCP_SERVER_IDS
  casePatterns: TestCasePattern[];
  source: "catalog" | "agent";
  rationale?: string; // solo presente cuando source === "agent"
};

export type StrategyCatalogEntry = {
  id: string;
  label: string;
  matches: (fp: StackFingerprint) => boolean;
  strategy: Omit<TestStrategy, "source" | "rationale">;
};

// Whitelist de ids de MCP server que existen de verdad en el catálogo de McpView.tsx — el fallback al
// agente (testStrategyAgent.ts) valida sus sugerencias contra esta lista para no dejarlo inventar un
// nombre de servidor que no existe.
export const KNOWN_MCP_SERVER_IDS = ["puppeteer", "desktop-cdp", "mobile-mcp"] as const;

const MOBILE_PATTERNS: TestCasePattern[] = [
  { id: "smoke", label: "Smoke", description: "La app abre y la pantalla principal se ve." },
  { id: "tap-navigate", label: "Navegación por tap", description: "Tocar un elemento navega a la pantalla esperada." },
  { id: "form-validation", label: "Validación de formulario", description: "Completar un formulario y confirmar el resultado (éxito o error de validación)." },
  { id: "crash-check", label: "Chequeo de crashes", description: "No hay crashes reportados tras el flujo ejercitado." },
];

export const CATALOG: StrategyCatalogEntry[] = [
  {
    id: "desktop-shell-chromium",
    label: "Desktop Chromium (Tauri/Electron)",
    matches: (fp) => fp.renderEngine === "chromium" && (fp.uiFramework === "tauri" || fp.uiFramework === "electron"),
    strategy: {
      backend: "chromium-cdp-desktop",
      mcpServerIds: ["desktop-cdp"],
      casePatterns: [
        { id: "smoke", label: "Smoke", description: "La ventana abre y un elemento clave del DOM renderiza." },
        { id: "form-validation", label: "Validación de formulario", description: "Completar un formulario y confirmar que persiste/valida como se espera." },
        { id: "navigation", label: "Navegación", description: "Cambiar de vista/tab deja el estado esperado en pantalla." },
      ],
    },
  },
  {
    id: "web-browser-chromium",
    label: "Web (browser, Chromium)",
    matches: (fp) => fp.renderEngine === "chromium" && fp.uiFramework !== "tauri" && fp.uiFramework !== "electron",
    strategy: {
      backend: "chromium-cdp-browser",
      mcpServerIds: ["puppeteer"],
      casePatterns: [
        { id: "smoke", label: "Smoke", description: "La página carga y un elemento clave renderiza." },
        { id: "form-validation", label: "Validación de formulario", description: "Completar un formulario y confirmar el resultado (éxito o error de validación)." },
        { id: "api-contract", label: "Contrato de API", description: "Una request desde la página recibe la forma de respuesta esperada." },
      ],
    },
  },
  {
    id: "mobile-react-native",
    label: "Mobile (React Native / Expo)",
    matches: (fp) => fp.isMobile && (fp.uiFramework === "react-native" || fp.uiFramework === "expo"),
    strategy: { backend: "mobile-mcp", mcpServerIds: ["mobile-mcp"], casePatterns: MOBILE_PATTERNS },
  },
  {
    id: "mobile-flutter",
    label: "Mobile (Flutter)",
    matches: (fp) => fp.isMobile && fp.uiFramework === "flutter",
    strategy: { backend: "mobile-mcp", mcpServerIds: ["mobile-mcp"], casePatterns: MOBILE_PATTERNS },
  },
  {
    id: "mobile-native",
    label: "Mobile nativo (iOS/Android)",
    matches: (fp) => fp.isMobile && (fp.uiFramework === "native-ios" || fp.uiFramework === "native-android"),
    strategy: { backend: "mobile-mcp", mcpServerIds: ["mobile-mcp"], casePatterns: MOBILE_PATTERNS },
  },
  {
    id: "generic-cli",
    label: "CLI / shell",
    matches: (fp) => fp.renderEngine === "none-cli",
    strategy: {
      backend: "shell-cli",
      mcpServerIds: [], // runShellCommand ya cubre esto, sin backend nuevo — ver testRunner.ts
      casePatterns: [
        { id: "cli-smoke", label: "Smoke de CLI", description: "--version/--help sale con exit code 0." },
        { id: "cli-args", label: "Argumentos inválidos", description: "Un flag inválido sale con exit code distinto de 0 y un mensaje de uso en stderr." },
        { id: "exit-code-contract", label: "Contrato de exit code", description: "El comando principal devuelve 0 en el caso feliz y no-0 en el de error, de forma consistente." },
      ],
    },
  },
];

export function matchCatalog(fp: StackFingerprint): StrategyCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.matches(fp));
}

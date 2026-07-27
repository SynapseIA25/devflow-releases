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
  { id: "smoke", label: "Smoke", description: "The app opens and the home screen is visible." },
  { id: "tap-navigate", label: "Tap navigation", description: "Tapping an element navigates to the expected screen." },
  { id: "form-validation", label: "Form validation", description: "Filling out a form and confirming the result (success or validation error)." },
  { id: "crash-check", label: "Crash check", description: "No crashes reported after exercising the flow." },
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
        { id: "smoke", label: "Smoke", description: "The window opens and a key DOM element renders." },
        { id: "form-validation", label: "Form validation", description: "Filling out a form and confirming it persists/validates as expected." },
        { id: "navigation", label: "Navigation", description: "Switching view/tab leaves the expected state on screen." },
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
        { id: "smoke", label: "Smoke", description: "The page loads and a key element renders." },
        { id: "form-validation", label: "Form validation", description: "Filling out a form and confirming the result (success or validation error)." },
        { id: "api-contract", label: "API contract", description: "A request from the page receives the expected response shape." },
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
    label: "Native mobile (iOS/Android)",
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
        { id: "cli-smoke", label: "CLI smoke", description: "--version/--help exits with code 0." },
        { id: "cli-args", label: "Invalid arguments", description: "An invalid flag exits with a non-zero code and a usage message on stderr." },
        { id: "exit-code-contract", label: "Exit code contract", description: "The main command returns 0 on the happy path and non-0 on error, consistently." },
      ],
    },
  },
];

export function matchCatalog(fp: StackFingerprint): StrategyCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.matches(fp));
}

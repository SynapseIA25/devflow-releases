// Fase 5 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Detecta el "fingerprint" de stack de un proyecto: lenguaje, framework
// de UI, categoría de motor de render y si es mobile. Es la entrada de testStrategyCatalog.ts (tabla
// estática) y testStrategyAgent.ts (fallback). Mismo espíritu que detectTestCommand en testRunner.ts:
// heurística por archivo marcador en la raíz, sin walk de monorepo, degradando con gracia si un
// archivo no se puede leer — de hecho reutiliza detectTestCommand para no duplicar esa heurística.
import { readDir, readTextFile } from "./tauriApi";
import { detectTestCommand } from "./testRunner";

export type RenderEngineCategory =
  | "chromium" // Chromium/Blink real (Electron, o Tauri en Windows/Linux — ver nota abajo)
  | "webkit" // sin heurística propia hoy — nada cae acá explícitamente, ver nota Tauri
  | "native-skia" // Flutter desktop: pinta a un canvas nativo vía Skia, sin motor de browser
  | "qt-gtk-swing" // desktop nativo no-Chromium (Qt/GTK/JavaFX/Swing/WinForms)
  | "none-cli" // sin ningún marker de UI — proyecto shell/CLI puro
  | "unknown"; // mobile nativo/RN/Flutter mobile (no es "un browser", pero tampoco CLI) o sin match

export type StackFingerprint = {
  language: string;
  uiFramework?: string;
  renderEngine: RenderEngineCategory;
  isMobile: boolean;
  existingTestFrameworks: string[];
  markers: string[]; // qué archivos/heurísticas matchearon — transparencia en la UI ("por qué esto")
};

const UNKNOWN_FINGERPRINT: StackFingerprint = {
  language: "unknown",
  renderEngine: "unknown",
  isMobile: false,
  existingTestFrameworks: [],
  markers: [],
};

export async function detectStackFingerprint(projectPath: string): Promise<StackFingerprint> {
  let entries;
  try {
    entries = await readDir(projectPath);
  } catch {
    return UNKNOWN_FINGERPRINT;
  }
  const files = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));
  const dirs = new Set(entries.filter((e) => e.isDir).map((e) => e.name));

  // Reuso directo — no re-derivar "¿hay Cargo.toml/go.mod/pytest marker?" a mano, testRunner.ts ya lo
  // resuelve (incluida la lógica no trivial de "no test specified" para el caso npm).
  const testConfig = await detectTestCommand(projectPath);

  if (files.has("package.json")) {
    const fp = await detectNodeStack(projectPath, files, testConfig?.framework === "npm");
    if (fp) return fp;
  }

  if (files.has("pubspec.yaml")) {
    const isMobile = dirs.has("android") || dirs.has("ios");
    return {
      language: "dart",
      uiFramework: "flutter",
      // Flutter desktop pinta directo a un canvas Skia, no hay motor de browser que inspeccionar por
      // CDP — sin entrada de catálogo (queda para el fallback al agente). Flutter mobile sí lo cubre
      // mobile-mcp (ver testStrategyCatalog.ts), por eso acá "unknown" en vez de "native-skia".
      renderEngine: isMobile ? "unknown" : "native-skia",
      isMobile,
      existingTestFrameworks: [],
      markers: ["pubspec.yaml"],
    };
  }

  if (testConfig?.framework === "cargo") {
    return { language: "rust", renderEngine: "none-cli", isMobile: false, existingTestFrameworks: ["cargo"], markers: ["Cargo.toml"] };
  }
  if (testConfig?.framework === "go") {
    return { language: "go", renderEngine: "none-cli", isMobile: false, existingTestFrameworks: ["go"], markers: ["go.mod"] };
  }
  if (testConfig?.framework === "pytest") {
    const marker = files.has("pytest.ini") ? "pytest.ini" : files.has("pyproject.toml") ? "pyproject.toml" : "setup.py";
    return { language: "python", renderEngine: "none-cli", isMobile: false, existingTestFrameworks: ["pytest"], markers: [marker] };
  }

  const nativeDesktop = await detectNativeDesktopOrMobile(projectPath, files, dirs);
  if (nativeDesktop) return nativeDesktop;

  // Nada matcheó ningún ecosistema conocido, pero hay algo en la carpeta: tratarlo como CLI/shell puro
  // (mismo bucket que un proyecto Node sin framework de UI) en vez de "unknown" — es la categoría más
  // útil por default, y ya la cubre el runner de shell existente sin backend nuevo.
  if (files.size > 0 || dirs.size > 0) {
    return { language: "unknown", renderEngine: "none-cli", isMobile: false, existingTestFrameworks: [], markers: [] };
  }
  return UNKNOWN_FINGERPRINT;
}

async function detectNodeStack(
  projectPath: string,
  files: Set<string>,
  hasNpmTestScript: boolean
): Promise<StackFingerprint | null> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await readTextFile(`${projectPath}/package.json`));
  } catch {
    return null; // package.json ilegible/inválido — dejar que el llamador siga probando otros ecosistemas
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => name in deps;
  const markers = ["package.json"];

  const existingTestFrameworks = ["vitest", "jest", "playwright", "cypress", "mocha"].filter((fw) => {
    if (has(fw)) { markers.push(`devDependencies.${fw}`); return true; }
    return false;
  });
  // Hay un "npm test" real (per testRunner.ts) pero ninguna de las libs conocidas de arriba — otro
  // test runner no listado (jasmine/ava/tap/etc.). Señal genérica en vez de silencio.
  if (hasNpmTestScript && existingTestFrameworks.length === 0) existingTestFrameworks.push("npm");

  const language = files.has("tsconfig.json") || has("typescript") ? "typescript" : "javascript";
  const base = { language, existingTestFrameworks, markers };

  if (has("@tauri-apps/api") || has("@tauri-apps/cli")) {
    markers.push("dependencies.@tauri-apps");
    // Tauri es Chromium/WebView2 en Windows/Linux pero WKWebView (WebKit) en macOS por default — se
    // asume "chromium" a propósito (coincide con lo que ya asume el MCP server desktop-cdp existente
    // en McpView.tsx) en vez de inventar un heurístico para distinguir el caso WebKit real: no hay
    // ningún archivo de proyecto que lo delate de forma confiable. Gap conocido, no un bug de Fase 5.
    return { ...base, uiFramework: "tauri", renderEngine: "chromium", isMobile: false };
  }
  if (has("electron")) {
    markers.push("dependencies.electron");
    return { ...base, uiFramework: "electron", renderEngine: "chromium", isMobile: false };
  }
  if (has("react-native") || has("expo")) {
    const uiFramework = has("expo") ? "expo" : "react-native";
    markers.push(`dependencies.${uiFramework}`);
    return { ...base, uiFramework, renderEngine: "unknown", isMobile: true };
  }
  for (const [dep, uiFramework] of [["react", "react"], ["vue", "vue"], ["svelte", "svelte"], ["@angular/core", "angular"]] as const) {
    if (has(dep)) {
      markers.push(`dependencies.${dep}`);
      return { ...base, uiFramework, renderEngine: "chromium", isMobile: false };
    }
  }
  // Node puro, sin ningún framework de UI: shape de CLI/shell.
  return { ...base, renderEngine: "none-cli", isMobile: false };
}

// Desktop nativo (no-Chromium) y mobile nativo (sin RN/Flutter, ya descartados arriba por no tener
// package.json/pubspec.yaml matcheando primero). Bucket "qt-gtk-swing" agrupa todo lo desktop nativo
// no-Chromium a propósito — hoy no hay backend de automatización distinto para Qt vs. GTK vs. Swing
// (ninguno tiene entrada de catálogo, todos caen al fallback del agente QA), así que separarlos no
// aportaría nada todavía; si algún día se agrega un backend tipo UIA/AT-SPI específico, ahí se separan.
async function detectNativeDesktopOrMobile(
  projectPath: string,
  files: Set<string>,
  dirs: Set<string>
): Promise<StackFingerprint | null> {
  const csproj = [...files].find((f) => /\.csproj$/i.test(f));
  if (csproj) {
    const raw = await tryReadTextFile(`${projectPath}/${csproj}`);
    const isWinForms = raw != null && /UseWindowsForms/i.test(raw);
    return {
      language: "csharp",
      uiFramework: isWinForms ? "winforms" : undefined,
      renderEngine: isWinForms ? "qt-gtk-swing" : "unknown",
      isMobile: false,
      existingTestFrameworks: [],
      markers: [csproj],
    };
  }

  const qtProFile = [...files].find((f) => /\.pro$/i.test(f));
  if (qtProFile) {
    return { language: "cpp", uiFramework: "qt", renderEngine: "qt-gtk-swing", isMobile: false, existingTestFrameworks: [], markers: [qtProFile] };
  }
  if (files.has("CMakeLists.txt")) {
    const raw = await tryReadTextFile(`${projectPath}/CMakeLists.txt`);
    const isQt = raw != null && /find_package\s*\(\s*Qt/i.test(raw);
    return {
      language: "cpp",
      uiFramework: isQt ? "qt" : undefined,
      renderEngine: isQt ? "qt-gtk-swing" : "unknown",
      isMobile: false,
      existingTestFrameworks: [],
      markers: ["CMakeLists.txt"],
    };
  }
  if (files.has("meson.build")) {
    return { language: "c", uiFramework: "gtk", renderEngine: "qt-gtk-swing", isMobile: false, existingTestFrameworks: [], markers: ["meson.build"] };
  }

  const gradleFile = files.has("build.gradle") ? "build.gradle" : files.has("build.gradle.kts") ? "build.gradle.kts" : null;
  if (files.has("pom.xml") || gradleFile) {
    const manifestFile = files.has("pom.xml") ? "pom.xml" : gradleFile!;
    if (dirs.has("android") && files.has("AndroidManifest.xml")) {
      return { language: "java", uiFramework: "native-android", renderEngine: "unknown", isMobile: true, existingTestFrameworks: [], markers: [manifestFile] };
    }
    const raw = await tryReadTextFile(`${projectPath}/${manifestFile}`);
    const uiFramework = raw != null && /javafx/i.test(raw) ? "javafx" : raw != null && /swing/i.test(raw) ? "swing" : undefined;
    return {
      language: "java",
      uiFramework,
      renderEngine: uiFramework ? "qt-gtk-swing" : "unknown",
      isMobile: false,
      existingTestFrameworks: [],
      markers: [manifestFile],
    };
  }

  const xcodeMarker = [...files].find((f) => /\.xcodeproj$|\.xcworkspace$/i.test(f)) ?? (files.has("Podfile") ? "Podfile" : null);
  if (xcodeMarker) {
    return { language: "swift", uiFramework: "native-ios", renderEngine: "unknown", isMobile: true, existingTestFrameworks: [], markers: [xcodeMarker] };
  }
  if (files.has("AndroidManifest.xml")) {
    return { language: "java", uiFramework: "native-android", renderEngine: "unknown", isMobile: true, existingTestFrameworks: [], markers: ["AndroidManifest.xml"] };
  }
  return null;
}

async function tryReadTextFile(path: string): Promise<string | null> {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

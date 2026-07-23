// Motor del runner de tests (Fase 1 de la herramienta de testing nativa — ver memoria
// devflow-testing-tool-design). Única implementación real de "detectar y correr los tests de un
// proyecto": la usan TestsView (UI) y la tool MCP `devflow_run_tests` (mcpBridgeHandlers.ts), así
// nunca hay dos comportamientos distintos para lo mismo.
import { useProjectStore, type Project, type TestConfig, type TestRun } from "../store/projectStore";
import { readDir, readTextFile, runShellCommand } from "./tauriApi";

// Recorte de seguridad: no persistir en el store (y en localStorage) un output de test gigante.
const MAX_OUTPUT = 200_000;

// Heurística por marcador de archivo en la raíz del proyecto — mismo espíritu que el skill `run`
// (detectar por convenciones del ecosistema, no parsear cada test runner de verdad).
export async function detectTestCommand(projectPath: string): Promise<TestConfig | null> {
  let entries;
  try {
    entries = await readDir(projectPath);
  } catch {
    return null;
  }
  const files = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));

  if (files.has("package.json")) {
    try {
      const raw = await readTextFile(`${projectPath}/package.json`);
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      const test = pkg.scripts?.test;
      if (test && !/no test specified/i.test(test)) {
        return { command: "npm test", framework: "npm" };
      }
    } catch {
      // package.json ilegible/inválido — seguir probando otros ecosistemas en vez de fallar acá.
    }
  }
  if (files.has("Cargo.toml")) return { command: "cargo test", framework: "cargo" };
  if (files.has("go.mod")) return { command: "go test ./...", framework: "go" };
  if (files.has("pytest.ini") || files.has("pyproject.toml") || files.has("setup.py")) {
    return { command: "pytest", framework: "pytest" };
  }
  return null;
}

// Normaliza separadores (\ y / se tratan igual, como en baseName() de projectStore.ts) y mayúsculas
// antes de comparar — el path que llega en una tool call del MCP bridge puede no coincidir carácter a
// carácter con el `.path` guardado del proyecto aunque sean "el mismo" path en Windows.
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findProjectByPath(projectPath: string): Project | undefined {
  const { projects } = useProjectStore.getState();
  return Object.values(projects).find((p) => normalizePath(p.path) === normalizePath(projectPath));
}

// Corre los tests del proyecto `projectId`: usa su testConfig si tiene uno guardado, o auto-detecta y
// lo guarda para la próxima corrida. Lanza si no hay config ni se pudo detectar nada.
export async function runProjectTests(projectId: string): Promise<TestRun> {
  const store = useProjectStore.getState();
  const project = store.projects[projectId];
  if (!project) throw new Error(`No existe el proyecto "${projectId}".`);

  let config = project.testConfig;
  if (!config) {
    const detected = await detectTestCommand(project.path);
    if (!detected) {
      throw new Error(
        "No se detectó un comando de test para este proyecto (sin package.json con script \"test\", Cargo.toml, go.mod ni pytest.ini/pyproject.toml/setup.py). Configurá uno manualmente en la vista Tests."
      );
    }
    config = detected;
    store.setTestConfig(projectId, config);
  }

  const runId = store.addTestRun(projectId, { status: "running", startedAt: Date.now(), output: "" });
  try {
    const res = await runShellCommand(config.command, config.cwd?.trim() || project.path);
    const output = res.output.length > MAX_OUTPUT ? res.output.slice(-MAX_OUTPUT) : res.output;
    store.updateTestRun(projectId, runId, {
      status: res.exitCode === 0 ? "passed" : "failed",
      exitCode: res.exitCode,
      output,
      finishedAt: Date.now(),
    });
  } catch (e) {
    store.updateTestRun(projectId, runId, {
      status: "failed",
      output: e instanceof Error ? e.message : String(e),
      finishedAt: Date.now(),
    });
  }
  const finished = useProjectStore.getState().projects[projectId]?.testRuns.find((r) => r.id === runId);
  if (!finished) throw new Error("La corrida de tests desapareció (¿se borró el proyecto mientras corría?).");
  return finished;
}

// Variante para el MCP bridge: recibe el path de proyecto que le llega en la tool call (que puede no
// ser el proyecto activo en la UI), no un id de store.
export async function runTestsForPath(projectPath: string): Promise<TestRun> {
  const project = findProjectByPath(projectPath);
  if (!project) throw new Error(`DevFlow no tiene abierto ningún proyecto en "${projectPath}".`);
  return runProjectTests(project.id);
}

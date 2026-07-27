// Fases 5-6 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Única implementación real de "sugerime una estrategia de test para
// este proyecto": la usan TestStrategyPanel.tsx (UI) y, en Fase 8, el bridge MCP — misma disciplina
// que runProjectTests/runTestsForPath en testRunner.ts (nunca dos comportamientos para lo mismo).
import { detectStackFingerprint, type StackFingerprint } from "./stackDetect";
import { matchCatalog, type TestStrategy } from "./testStrategyCatalog";
import { suggestStrategyViaAgent } from "./testStrategyAgent";

export type TestStrategyResult = { fingerprint: StackFingerprint; strategy: TestStrategy };

export async function suggestTestStrategy(projectPath: string): Promise<TestStrategyResult> {
  const fingerprint = await detectStackFingerprint(projectPath);
  const catalogEntry = matchCatalog(fingerprint);
  const strategy: TestStrategy = catalogEntry
    ? { ...catalogEntry.strategy, source: "catalog" }
    : await suggestStrategyViaAgent(fingerprint, projectPath);
  return { fingerprint, strategy };
}

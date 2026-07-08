import type { AgentConfig } from "./providers";

// Router determinista tarea→experto (pilar 1): puntúa cada experto por cuántas de sus keywords de
// área aparecen en la tarea. Sin IA — matching de texto, predecible y verificable. La auto-delegación
// (etapa 2) reusa esto para asignar sub-tareas a expertos.
export type ExpertMatch = { agent: AgentConfig; score: number; hits: string[] };

// minúsculas + sin tildes (NFD y saca los diacríticos) para que "migración" matchee "migracion", etc.
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function suggestExperts(task: string, experts: AgentConfig[]): ExpertMatch[] {
  const t = normalizeText(task);
  const matches: ExpertMatch[] = [];
  for (const agent of experts) {
    const kws = agent.areaKeywords ?? [];
    const hits: string[] = [];
    for (const kw of kws) {
      const nk = normalizeText(kw);
      // Keyword multipalabra ("base de datos") → substring; palabra suelta → límite de palabra
      // (así "api" no matchea dentro de "rapido", pero sí en "la api de pagos").
      const found = nk.includes(" ") ? t.includes(nk) : new RegExp(`\\b${escapeRe(nk)}\\b`).test(t);
      if (found) hits.push(kw);
    }
    if (hits.length > 0) matches.push({ agent, score: hits.length, hits });
  }
  return matches.sort((a, b) => b.score - a.score);
}

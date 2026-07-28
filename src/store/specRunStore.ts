// Estado de ejecución de una fase de Spec-Driven Development — separado de projectStore (que guarda
// lo persistente: fase, artefactos, tasks) y separado del estado local de SpecDetail. Antes vivía
// como useState DENTRO de SpecDetail, que se desmonta cada vez que cambiás la spec seleccionada en el
// sidebar (key={spec.id}) — eso significaba que arrancar Implement en la spec B mientras la spec A
// seguía corriendo la dejaba huérfana (su progreso dejaba de tener a dónde escribirse). Acá el estado
// de corrida vive por spec.id en un store global, así dos specs pueden correr a la vez y cada una
// sigue siendo visible/reanudable al volver a seleccionarla. No persistido (igual criterio que
// workspaceStore.running: un turno en curso no debería sobrevivir un reinicio de la app).
import { create } from "zustand";
import type { SpecStep } from "../lib/specOrchestrator";
import type { NonDonePhase } from "../lib/specOrchestrator";

export type SpecRunState = {
  running: NonDonePhase | null;
  steps: SpecStep[];
  note: string | null;
  error: string | null;
  envName: string | null;
  cancelled: boolean;
  // Providers en uso por la corrida activa — permite que otra spec corriendo en paralelo sepa si
  // "reiniciar el proceso para arrancar fresco" (ver specRuns.ts) tumbaría una corrida ajena.
  providers: string[];
};

const EMPTY_RUN: SpecRunState = {
  running: null,
  steps: [],
  note: null,
  error: null,
  envName: null,
  cancelled: false,
  providers: [],
};

type SpecRunStore = {
  runs: Record<string, SpecRunState>;
  getRun: (specId: string) => SpecRunState;
  startRun: (specId: string, phase: NonDonePhase) => void;
  appendStep: (specId: string, step: SpecStep) => void;
  setNote: (specId: string, note: string | null) => void;
  setError: (specId: string, error: string | null) => void;
  setEnvName: (specId: string, envName: string | null) => void;
  setProviders: (specId: string, providers: string[]) => void;
  finishRun: (specId: string) => void;
  cancel: (specId: string) => void;
  isProviderBusyElsewhere: (specId: string, provider: string) => boolean;
};

const patch = (
  set: (fn: (s: SpecRunStore) => Partial<SpecRunStore>) => void,
  specId: string,
  fn: (r: SpecRunState) => SpecRunState
) => set((s) => ({ runs: { ...s.runs, [specId]: fn(s.runs[specId] ?? EMPTY_RUN) } }));

export const useSpecRunStore = create<SpecRunStore>((set, get) => ({
  runs: {},
  getRun: (specId) => get().runs[specId] ?? EMPTY_RUN,
  startRun: (specId, phase) => patch(set, specId, () => ({ ...EMPTY_RUN, running: phase })),
  appendStep: (specId, step) => patch(set, specId, (r) => ({ ...r, steps: [...r.steps, step] })),
  setNote: (specId, note) => patch(set, specId, (r) => ({ ...r, note })),
  setError: (specId, error) => patch(set, specId, (r) => ({ ...r, error })),
  setEnvName: (specId, envName) => patch(set, specId, (r) => ({ ...r, envName })),
  setProviders: (specId, providers) => patch(set, specId, (r) => ({ ...r, providers })),
  finishRun: (specId) => patch(set, specId, (r) => ({ ...r, running: null, note: null, providers: [] })),
  cancel: (specId) => patch(set, specId, (r) => ({ ...r, cancelled: true })),
  isProviderBusyElsewhere: (specId, provider) =>
    Object.entries(get().runs).some(([id, r]) => id !== specId && r.running !== null && r.providers.includes(provider)),
}));

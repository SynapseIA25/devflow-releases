import { create } from "zustand";
import { persist } from "zustand/middleware";

// Métricas de uso REALES (no maqueta): se acumulan a medida que se usan los agentes y los workflows.
// - Chat: ChatView llama recordChat() al terminar cada turno ACP (latencia medida con reloj de pared,
//   chars de entrada/salida reales del prompt y de la respuesta acumulada).
// - Workflow: WorkflowView llama recordWorkflowRun() al terminar cada Run.
// "Tokens" es una APROXIMACIÓN (chars/4): ACP no reporta uso real de tokens en este código, así que
// no inventamos un contador exacto — lo mostramos etiquetado como aprox. Costo no se modela (no hay
// tabla de tarifas por proveedor), por eso no hay tarjeta de costo.

const CHARS_PER_TOKEN = 4;
export const approxTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

export type ProviderStat = {
  prompts: number;
  latencyMs: number; // suma de latencias, para promediar
  samples: number;
  inChars: number;
  outChars: number;
};

type MetricsStore = {
  chatPrompts: number;
  workflowRuns: number;
  totalLatencyMs: number;
  latencySamples: number;
  inChars: number;
  outChars: number;
  lastActivity: number | null; // epoch ms
  byProvider: Record<string, ProviderStat>;

  recordChat: (e: { provider: string; latencyMs: number; inChars: number; outChars: number }) => void;
  recordWorkflowRun: (e: { latencyMs: number }) => void;
  reset: () => void;
};

const emptyProviderStat = (): ProviderStat => ({ prompts: 0, latencyMs: 0, samples: 0, inChars: 0, outChars: 0 });

const initial = {
  chatPrompts: 0,
  workflowRuns: 0,
  totalLatencyMs: 0,
  latencySamples: 0,
  inChars: 0,
  outChars: 0,
  lastActivity: null as number | null,
  byProvider: {} as Record<string, ProviderStat>,
};

export const useMetricsStore = create<MetricsStore>()(
  persist(
    (set) => ({
      ...initial,

      recordChat: ({ provider, latencyMs, inChars, outChars }) =>
        set((s) => {
          const prev = s.byProvider[provider] ?? emptyProviderStat();
          return {
            chatPrompts: s.chatPrompts + 1,
            totalLatencyMs: s.totalLatencyMs + latencyMs,
            latencySamples: s.latencySamples + 1,
            inChars: s.inChars + inChars,
            outChars: s.outChars + outChars,
            lastActivity: Date.now(),
            byProvider: {
              ...s.byProvider,
              [provider]: {
                prompts: prev.prompts + 1,
                latencyMs: prev.latencyMs + latencyMs,
                samples: prev.samples + 1,
                inChars: prev.inChars + inChars,
                outChars: prev.outChars + outChars,
              },
            },
          };
        }),

      recordWorkflowRun: ({ latencyMs }) =>
        set((s) => ({
          workflowRuns: s.workflowRuns + 1,
          totalLatencyMs: s.totalLatencyMs + latencyMs,
          latencySamples: s.latencySamples + 1,
          lastActivity: Date.now(),
        })),

      reset: () => set({ ...initial, byProvider: {} }),
    }),
    { name: "devflow-metrics" }
  )
);

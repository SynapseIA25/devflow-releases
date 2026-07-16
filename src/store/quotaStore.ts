import { create } from "zustand";
import { persist } from "zustand/middleware";

// Tracking local de uso de los tiers gratuitos de inferencia (pilar del router de modelos).
// Los providers NO exponen la cuota restante en el flujo ACP (DevFlow ni ve el HTTP), así que:
// - contamos requests por provider de inferencia por día (aprox conservadora, se resetea a medianoche
//   local), y el router deja de elegir un provider cuando alcanza su presupuesto diario;
// - cuando un turno falla con pinta de rate-limit (429/quota), el provider entra en "cooldown" y el
//   router lo saltea hasta que expire (10 min para límites por minuto; hasta medianoche si el error
//   menciona límite diario).
// El "provider de inferencia" es el primer segmento del model id que expone OpenCode
// ("openrouter/qwen/qwen3-coder:free" → "openrouter"). Los locales (ollama/lmstudio) no tienen budget.

// Presupuestos diarios conservadores (requests/día). Referencias reales al 2026-07:
// OpenRouter :free = 50/día por CUENTA (1000 si alguna vez cargó US$10) → 45 deja margen.
// Gemini/Groq/Mistral tienen tiers gratis independientes y más generosos. opencode (Zen) sin límite conocido.
export const DAILY_BUDGETS: Record<string, number> = {
  openrouter: 45,
  google: 200,
  groq: 800,
  mistral: 300,
};

const todayKey = () => new Date().toISOString().slice(0, 10);

type QuotaStore = {
  day: string;
  counts: Record<string, number>; // requests de hoy por provider de inferencia
  cooldownUntil: Record<string, number>; // epoch ms; transitorio (no se persiste)
  recordUse: (infProvider: string) => void;
  setCooldown: (infProvider: string, untilMs: number) => void;
  // true si el provider está en cooldown o gastó su presupuesto de hoy.
  isExhausted: (infProvider: string) => boolean;
};

export const useQuotaStore = create<QuotaStore>()(
  persist(
    (set, get) => ({
      day: todayKey(),
      counts: {},
      cooldownUntil: {},

      recordUse: (p) =>
        set((s) => {
          const day = todayKey();
          const counts = day === s.day ? { ...s.counts } : {}; // rollover de día: arranca de cero
          counts[p] = (counts[p] ?? 0) + 1;
          return { day, counts };
        }),

      setCooldown: (p, untilMs) =>
        set((s) => ({ cooldownUntil: { ...s.cooldownUntil, [p]: untilMs } })),

      isExhausted: (p) => {
        const s = get();
        if ((s.cooldownUntil[p] ?? 0) > Date.now()) return true;
        const budget = DAILY_BUDGETS[p];
        if (budget === undefined) return false; // sin budget conocido = sin límite (zen/local/mimo)
        const used = s.day === todayKey() ? (s.counts[p] ?? 0) : 0;
        return used >= budget;
      },
    }),
    {
      name: "devflow-quota",
      version: 1,
      // cooldowns no se persisten: son por-proceso (un rate limit por minuto no sobrevive un reinicio útilmente).
      partialize: (s) => ({ day: s.day, counts: s.counts }),
    }
  )
);

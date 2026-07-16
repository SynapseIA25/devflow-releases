import { describe, it, expect, beforeEach } from "vitest";
import { pickModel, inferenceProviderOf, isLocalModel, isQuotaError, reportQuotaError, classifyTask, economyActive } from "../modelRouter";
import { useQuotaStore } from "../../store/quotaStore";
import type { ModelOption } from "../acpClient";

const opt = (v: string): ModelOption => ({ value: v, label: v });

// Catálogo realista (ids reales de `opencode models` al 2026-07 con key de OpenRouter).
const FULL: ModelOption[] = [
  "opencode/big-pickle",
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  "openrouter/qwen/qwen3-coder:free",
  "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/meta-llama/llama-3.2-3b-instruct:free",
  "openrouter/anthropic/claude-sonnet-5",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "groq/llama-3.3-70b-versatile",
  "ollama/qwen3:8b",
].map(opt);

// Catálogo tipo MiMo: nada matchea los patterns → el router devuelve null (no rompe el flujo).
const MIMO: ModelOption[] = ["mimo/mimo-auto", "mimo/mimo-v2.5-pro"].map(opt);

beforeEach(() => {
  useQuotaStore.setState({ day: new Date().toISOString().slice(0, 10), counts: {}, cooldownUntil: {} });
});

describe("inferenceProviderOf / isLocalModel", () => {
  it("extrae el primer segmento y colapsa locales", () => {
    expect(inferenceProviderOf("openrouter/qwen/qwen3-coder:free")).toBe("openrouter");
    expect(inferenceProviderOf("google/gemini-2.5-flash")).toBe("google");
    expect(inferenceProviderOf("ollama/qwen3:8b")).toBe("local");
    expect(inferenceProviderOf("mimo-auto")).toBe("mimo-auto");
    expect(isLocalModel("ollama/qwen3:8b")).toBe(true);
    expect(isLocalModel("groq/llama-3.3-70b-versatile")).toBe(false);
  });
});

describe("pickModel", () => {
  it("code elige un modelo de código gratis", () => {
    expect(pickModel("code", FULL)).toBe("opencode/big-pickle");
  });
  it("reasoning prefiere el razonador gratis de Zen", () => {
    expect(pickModel("reasoning", FULL)).toBe("opencode/nemotron-3-ultra-free");
  });
  it("fast prefiere local si existe", () => {
    expect(pickModel("fast", FULL)).toBe("ollama/qwen3:8b");
  });
  it("long-context va a gemini flash", () => {
    expect(pickModel("long-context", FULL)).toBe("google/gemini-2.5-flash");
  });
  it("catálogo sin matches (mimo) devuelve null", () => {
    expect(pickModel("code", MIMO)).toBeNull();
  });
  it("saltea providers agotados y cae al siguiente candidato", () => {
    useQuotaStore.getState().setCooldown("opencode", Date.now() + 60_000);
    useQuotaStore.getState().setCooldown("groq", Date.now() + 60_000);
    expect(pickModel("code", FULL)).toBe("google/gemini-2.5-flash");
  });
  it("respeta el presupuesto diario de openrouter", () => {
    const only = ["openrouter/qwen/qwen3-coder:free"].map(opt);
    for (let i = 0; i < 45; i++) useQuotaStore.getState().recordUse("openrouter");
    expect(pickModel("code", only)).toBeNull();
  });
  it("nunca elige un modelo pago si hay :free del perfil", () => {
    const picked = pickModel("reasoning", FULL, new Set(["opencode", "groq", "google"]));
    expect(picked).toBe("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free");
  });
});

describe("classifyTask (modo Auto del chat)", () => {
  it("señales de diseño sin código → reasoning", () => {
    expect(classifyTask("Analizá la arquitectura del proyecto y proponé un plan de mejora por módulos")).toBe("reasoning");
    // "refactor" es señal de código: gana code aunque haya señales de diseño (heurística code-biased).
    expect(classifyTask("Analizá la arquitectura y proponé un plan de refactor")).toBe("code");
    expect(classifyTask("Why is this design better? Compare the trade-offs")).toBe("reasoning");
  });
  it("señales de código → code", () => {
    expect(classifyTask("Fix the bug in the login endpoint and add a test")).toBe("code");
    expect(classifyTask("implementá la función de exportar CSV")).toBe("code");
  });
  it("pregunta corta sin señales → fast; prompt gigante → long-context", () => {
    expect(classifyTask("de que trata el proyecto?")).toBe("fast");
    expect(classifyTask("x".repeat(25_000))).toBe("long-context");
  });
});

describe("economyActive", () => {
  it("auto recorta solo remotos", () => {
    expect(economyActive("auto", "openrouter/qwen/qwen3-coder:free")).toBe(true);
    expect(economyActive("auto", "ollama/qwen3:8b")).toBe(false);
    expect(economyActive("auto", null)).toBe(true); // desconocido = remoto
  });
  it("always y off fuerzan la decisión", () => {
    expect(economyActive("always", "ollama/qwen3:8b")).toBe(true);
    expect(economyActive("off", "openrouter/qwen/qwen3-coder:free")).toBe(false);
  });
});

describe("cuota: errores y cooldown", () => {
  it("reconoce errores de rate-limit", () => {
    expect(isQuotaError("429 Too Many Requests")).toBe(true);
    expect(isQuotaError("Rate limit exceeded: free-models-per-day")).toBe(true);
    expect(isQuotaError("RESOURCE_EXHAUSTED: quota")).toBe(true);
    expect(isQuotaError("ENOENT: no such file")).toBe(false);
  });
  it("cooldown por minuto es corto; por día llega a medianoche", () => {
    reportQuotaError("openrouter/qwen/qwen3-coder:free", "429 rate limit per minute");
    const shortCd = useQuotaStore.getState().cooldownUntil["openrouter"];
    expect(shortCd).toBeGreaterThan(Date.now());
    expect(shortCd).toBeLessThan(Date.now() + 11 * 60_000);
    reportQuotaError("google/gemini-2.5-flash", "quota exceeded: requests per day");
    const dailyCd = useQuotaStore.getState().cooldownUntil["google"];
    expect(dailyCd).toBeGreaterThan(Date.now() + 11 * 60_000);
  });
  it("isExhausted refleja cooldown y presupuesto", () => {
    const q = useQuotaStore.getState();
    expect(q.isExhausted("openrouter")).toBe(false);
    q.setCooldown("openrouter", Date.now() + 60_000);
    expect(useQuotaStore.getState().isExhausted("openrouter")).toBe(true);
    expect(useQuotaStore.getState().isExhausted("opencode")).toBe(false); // sin budget = nunca agotado
  });
});

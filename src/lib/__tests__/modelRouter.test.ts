import { describe, it, expect, beforeEach, vi } from "vitest";
import { pickModel, inferenceProviderOf, isLocalModel, isQuotaError, reportQuotaError, classifyTask, economyActive, effectiveModelPreference, AUTO_MODEL } from "../modelRouter";
import { useQuotaStore } from "../../store/quotaStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { ModelOption } from "../acpClient";
import type { CatalogModel } from "../modelCatalog";

// fetchModelCatalog hace I/O real (httpRequest/readTextFile de tauriApi, no disponible fuera de
// Tauri) — se mockea; findCatalogModel es puro y se deja real (importOriginal).
const catalogMock = vi.fn<() => Promise<CatalogModel[]>>();
vi.mock("../modelCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modelCatalog")>();
  return { ...actual, fetchModelCatalog: () => catalogMock() };
});

const catalogEntry = (providerId: string, modelId: string, costInput: number | null): CatalogModel => ({
  providerId, providerName: providerId, modelId, name: modelId, context: null, output: null, costInput, costOutput: null,
});

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
  useQuotaStore.setState({ day: new Date().toISOString().slice(0, 10), counts: {}, cooldownUntil: {}, budgetOverrides: {} });
  useSettingsStore.setState({ costCeilingUsdPerMTok: null, pinnedModelByTaskKind: {} });
  catalogMock.mockReset();
  catalogMock.mockResolvedValue([]);
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
  it("execute elige un modelo de código gratis", async () => {
    expect(await pickModel("execute", FULL)).toBe("opencode/big-pickle");
  });
  it("plan prefiere el razonador gratis de Zen", async () => {
    expect(await pickModel("plan", FULL)).toBe("opencode/nemotron-3-ultra-free");
  });
  it("research prefiere el razonador gratis de Zen", async () => {
    expect(await pickModel("research", FULL)).toBe("opencode/nemotron-3-ultra-free");
  });
  it("fast prefiere local si existe", async () => {
    expect(await pickModel("fast", FULL)).toBe("ollama/qwen3:8b");
  });
  it("long-context va a gemini flash", async () => {
    expect(await pickModel("long-context", FULL)).toBe("google/gemini-2.5-flash");
  });
  it("catálogo sin matches (mimo) devuelve null", async () => {
    expect(await pickModel("execute", MIMO)).toBeNull();
  });
  it("saltea providers agotados y cae al siguiente candidato", async () => {
    useQuotaStore.getState().setCooldown("opencode", Date.now() + 60_000);
    useQuotaStore.getState().setCooldown("groq", Date.now() + 60_000);
    expect(await pickModel("execute", FULL)).toBe("google/gemini-2.5-flash");
  });
  it("respeta el presupuesto diario de openrouter", async () => {
    const only = ["openrouter/qwen/qwen3-coder:free"].map(opt);
    for (let i = 0; i < 45; i++) useQuotaStore.getState().recordUse("openrouter");
    expect(await pickModel("execute", only)).toBeNull();
  });
  it("nunca elige un modelo pago si hay :free del perfil", async () => {
    const picked = await pickModel("plan", FULL, new Set(["opencode", "groq", "google"]));
    expect(picked).toBe("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free");
  });

  describe("techo de costo (Fase 2)", () => {
    it("excluye un candidato caro y cae al siguiente pattern del perfil", async () => {
      const list = ["opencode/big-pickle", "openrouter/qwen/qwen3-coder:free"].map(opt);
      catalogMock.mockResolvedValue([catalogEntry("opencode", "big-pickle", 5)]); // $5/MTok
      useSettingsStore.getState().setCostCeilingUsdPerMTok(1);
      expect(await pickModel("execute", list)).toBe("openrouter/qwen/qwen3-coder:free");
    });
    it("nunca excluye un modelo gratis o sin precio conocido en el catálogo", async () => {
      const list = ["opencode/big-pickle"].map(opt);
      catalogMock.mockResolvedValue([]); // sin entrada para este modelo
      useSettingsStore.getState().setCostCeilingUsdPerMTok(0.01);
      expect(await pickModel("execute", list)).toBe("opencode/big-pickle");
    });
    it("si fetchModelCatalog rechaza, degrada a sin-filtro (nunca rompe el turno)", async () => {
      const list = ["opencode/big-pickle"].map(opt);
      catalogMock.mockRejectedValue(new Error("network down"));
      useSettingsStore.getState().setCostCeilingUsdPerMTok(0.01);
      expect(await pickModel("execute", list)).toBe("opencode/big-pickle");
    });
    it("sin ceiling configurado nunca busca el catálogo", async () => {
      await pickModel("execute", FULL);
      expect(catalogMock).not.toHaveBeenCalled();
    });
  });

  describe("pin de modelo por TaskKind (Fase 5)", () => {
    it("un pin presente en available gana sobre PROFILE_CANDIDATES", async () => {
      const list = ["openrouter/anthropic/claude-sonnet-5", "opencode/nemotron-3-ultra-free"].map(opt);
      useSettingsStore.getState().setPinnedModel("plan", "openrouter/anthropic/claude-sonnet-5");
      expect(await pickModel("plan", list)).toBe("openrouter/anthropic/claude-sonnet-5");
    });
    it("un pin ausente de la sesión actual cae con gracia a la tabla", async () => {
      useSettingsStore.getState().setPinnedModel("plan", "some/model-not-available");
      expect(await pickModel("plan", FULL)).toBe("opencode/nemotron-3-ultra-free");
    });
    it("Clear (null) despinnea", async () => {
      useSettingsStore.getState().setPinnedModel("plan", "openrouter/anthropic/claude-sonnet-5");
      useSettingsStore.getState().setPinnedModel("plan", null);
      expect(useSettingsStore.getState().pinnedModelByTaskKind.plan).toBeUndefined();
    });
  });
});

describe("classifyTask (modo Auto del chat)", () => {
  it("señales de diseño sin código → plan", () => {
    expect(classifyTask("Analizá la arquitectura del proyecto y proponé un plan de mejora por módulos")).toBe("plan");
    // "refactor" es señal de ejecución: gana execute aunque haya señales de diseño (heurística execute-biased).
    expect(classifyTask("Analizá la arquitectura y proponé un plan de refactor")).toBe("execute");
    expect(classifyTask("Why is this design better? Compare the trade-offs")).toBe("plan");
  });
  it("señales de código → execute", () => {
    expect(classifyTask("Fix the bug in the login endpoint and add a test")).toBe("execute");
    expect(classifyTask("implementá la función de exportar CSV")).toBe("execute");
  });
  it("preguntas de investigación/explicación sin señales de plan o código → research", () => {
    expect(classifyTask("How does this library work under the hood?")).toBe("research");
    expect(classifyTask("¿Qué es Redis y para qué sirve en este proyecto?")).toBe("research");
  });
  it("pregunta corta sin señales → fast; prompt gigante → long-context", () => {
    expect(classifyTask("de que trata el proyecto?")).toBe("fast");
    expect(classifyTask("x".repeat(25_000))).toBe("long-context");
  });
  it("fingerprint mobile desempata un mensaje corto y ambiguo hacia execute (nunca pisa un match de keyword)", () => {
    const mobile = { isMobile: true } as any;
    expect(classifyTask("qué onda?", mobile)).toBe("execute");
    expect(classifyTask("qué onda?", { isMobile: false } as any)).toBe("fast");
    expect(classifyTask("qué onda?")).toBe("fast");
    // un mensaje con match de keyword no cambia por el fingerprint
    expect(classifyTask("Fix the bug in the login endpoint", mobile)).toBe("execute");
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

describe("cuota: budgets configurables y reset", () => {
  it("el override reemplaza al default y vaciarlo lo restaura", () => {
    const q = useQuotaStore.getState();
    expect(q.effectiveBudget("openrouter")).toBe(45); // default de DAILY_BUDGETS
    q.setBudgetOverride("openrouter", 900); // tier de 1000/día
    expect(useQuotaStore.getState().effectiveBudget("openrouter")).toBe(900);
    useQuotaStore.getState().setBudgetOverride("openrouter", null);
    expect(useQuotaStore.getState().effectiveBudget("openrouter")).toBe(45);
  });
  it("un override le pone límite a un provider sin default (y afecta isExhausted)", () => {
    const q = useQuotaStore.getState();
    expect(q.effectiveBudget("opencode")).toBeUndefined();
    q.setBudgetOverride("opencode", 2);
    useQuotaStore.getState().recordUse("opencode");
    expect(useQuotaStore.getState().isExhausted("opencode")).toBe(false);
    useQuotaStore.getState().recordUse("opencode");
    expect(useQuotaStore.getState().isExhausted("opencode")).toBe(true);
  });
  it("valores inválidos o negativos no dejan basura", () => {
    useQuotaStore.getState().setBudgetOverride("openrouter", NaN);
    expect(useQuotaStore.getState().budgetOverrides["openrouter"]).toBeUndefined();
    useQuotaStore.getState().setBudgetOverride("openrouter", -5);
    expect(useQuotaStore.getState().budgetOverrides["openrouter"]).toBe(0); // 0 = provider deshabilitado
  });
  it("resetToday limpia contadores y desagota el provider (sin tocar overrides)", () => {
    useQuotaStore.getState().setBudgetOverride("groq", 1);
    useQuotaStore.getState().recordUse("groq");
    expect(useQuotaStore.getState().isExhausted("groq")).toBe(true);
    useQuotaStore.getState().resetToday();
    expect(useQuotaStore.getState().isExhausted("groq")).toBe(false);
    expect(useQuotaStore.getState().effectiveBudget("groq")).toBe(1);
  });
});

describe("effectiveModelPreference (Auto por defecto, Fase 4)", () => {
  it("opencode nunca tocado por el usuario → Auto por default", () => {
    expect(effectiveModelPreference({}, "opencode")).toBe(AUTO_MODEL);
  });
  it("un provider pago de un solo modelo (anthropic) NO tiene default a Auto", () => {
    expect(effectiveModelPreference({}, "anthropic")).toBeUndefined();
  });
  it("una elección explícita del usuario se respeta tal cual, sea la que sea", () => {
    expect(effectiveModelPreference({ opencode: "opencode/big-pickle" }, "opencode")).toBe("opencode/big-pickle");
    expect(effectiveModelPreference({ opencode: AUTO_MODEL }, "opencode")).toBe(AUTO_MODEL);
  });
});

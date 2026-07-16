import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PROVIDERS, ProviderConfig } from "../lib/providers";
import type { ModelOption } from "../lib/acpClient";

// Registro de decisiones automáticas de permisos (cuando no hay UI para aprobar, ej. workflows
// headless). Transitorio (no se persiste): sirve para auditar qué se auto-aprobó/denegó en la sesión.
export type PermissionLogEntry = { ts: number; provider: string; tool: string; decision: "auto-allow" | "auto-deny" };

type SettingsStore = {
  // Config estática de providers ACP (DEFAULT_PROVIDERS). NO se persiste: es código, no estado editable.
  providers: ProviderConfig[];
  // Postura de permisos cuando NO hay UI para aprobar (workflows). Default false = denegar (seguro).
  // En true, se auto-aprueba la primera opción "allow*" (comodidad, riesgo: el agente hace todo solo).
  autoApprovePermissions: boolean;
  permissionLog: PermissionLogEntry[];
  // Modelo elegido por el usuario para cada provider ACP (se aplica al abrir sesión, ver acpClient.newSession).
  // Persistido. Vacío = usar el default del agente (o el fallback mimo-auto para MiMo).
  modelByProvider: Record<string, string>;
  // Modelos que el agente ofrece (descubiertos en runtime al abrir sesión) y el actualmente activo.
  // NO se persisten: se repueblan en cada sesión.
  availableModelsByProvider: Record<string, ModelOption[]>;
  currentModelByProvider: Record<string, string>;
  // API keys de providers de inferencia (keyed por PROVIDER_KEY_SPECS.id, ej. "openrouter").
  // Se inyectan como env vars al agente OpenCode al spawnearlo (acpClient.ensureStarted).
  // Persistidas en localStorage (texto plano — mismo trade-off que ~/.config de cualquier CLI).
  providerKeys: Record<string, string>;
  // Wizard de primer arranque: true una vez que el usuario lo cerró.
  onboardingDone: boolean;
  setProviderKey: (id: string, key: string) => void;
  setOnboardingDone: (v: boolean) => void;
  setAutoApprovePermissions: (v: boolean) => void;
  logPermission: (entry: Omit<PermissionLogEntry, "ts">) => void;
  // Elección explícita del usuario (persistida) — se aplicará en la próxima sesión de ese provider.
  setModelForProvider: (provider: string, model: string) => void;
  // Reporta lo que descubrió acpClient al abrir una sesión (modelos disponibles + el activo).
  reportModelOptions: (provider: string, available: ModelOption[], current: string | null) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      providers: DEFAULT_PROVIDERS,
      autoApprovePermissions: false,
      permissionLog: [],
      modelByProvider: {},
      availableModelsByProvider: {},
      currentModelByProvider: {},
      providerKeys: {},
      onboardingDone: false,

      setProviderKey: (id, key) =>
        set((s) => {
          const next = { ...s.providerKeys };
          if (key.trim()) next[id] = key.trim();
          else delete next[id];
          return { providerKeys: next };
        }),

      setOnboardingDone: (v) => set({ onboardingDone: v }),

      setModelForProvider: (provider, model) =>
        set((s) => ({
          modelByProvider: { ...s.modelByProvider, [provider]: model },
          currentModelByProvider: { ...s.currentModelByProvider, [provider]: model },
        })),

      reportModelOptions: (provider, available, current) =>
        set((s) => ({
          availableModelsByProvider: { ...s.availableModelsByProvider, [provider]: available },
          currentModelByProvider: current
            ? { ...s.currentModelByProvider, [provider]: current }
            : s.currentModelByProvider,
        })),

      setAutoApprovePermissions: (v) => set({ autoApprovePermissions: v }),

      logPermission: (entry) =>
        set((s) => ({
          // capado a las últimas 50 entradas para no crecer sin límite
          permissionLog: [{ ...entry, ts: Date.now() }, ...s.permissionLog].slice(0, 50),
        })),
    }),
    {
      name: "devflow-settings",
      version: 1,
      // v0 persistía `providers` (con apiKey/baseUrl/modelos ficticios) y `selectedProviderId/selectedModel`
      // — vestigios del diseño viejo "cliente-LLM directo". Los descartamos: providers es config estática y
      // la selección de modelo vive en modelByProvider + el selector del chat.
      migrate: (persisted: any) => {
        if (persisted && typeof persisted === "object") {
          delete persisted.providers;
          delete persisted.selectedProviderId;
          delete persisted.selectedModel;
        }
        return persisted;
      },
      // Solo persistimos preferencias reales; providers es estático y permissionLog/modelos-runtime no persisten.
      partialize: (s) => ({
        autoApprovePermissions: s.autoApprovePermissions,
        modelByProvider: s.modelByProvider,
        providerKeys: s.providerKeys,
        onboardingDone: s.onboardingDone,
      }),
    }
  )
);

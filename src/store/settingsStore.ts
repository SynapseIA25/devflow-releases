import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PROVIDERS, ProviderConfig } from "../lib/providers";
import type { ModelOption } from "../lib/acpClient";

// Registro de decisiones automáticas de permisos (cuando no hay UI para aprobar, ej. workflows
// headless). Transitorio (no se persiste): sirve para auditar qué se auto-aprobó/denegó en la sesión.
export type PermissionLogEntry = { ts: number; provider: string; tool: string; decision: "auto-allow" | "auto-deny" };

type SettingsStore = {
  providers: ProviderConfig[];
  selectedProviderId: string;
  selectedModel: string;
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
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void;
  setSelectedModel: (providerId: string, model: string) => void;
  getActiveProvider: () => ProviderConfig | undefined;
  setAutoApprovePermissions: (v: boolean) => void;
  logPermission: (entry: Omit<PermissionLogEntry, "ts">) => void;
  // Elección explícita del usuario (persistida) — se aplicará en la próxima sesión de ese provider.
  setModelForProvider: (provider: string, model: string) => void;
  // Reporta lo que descubrió acpClient al abrir una sesión (modelos disponibles + el activo).
  reportModelOptions: (provider: string, available: ModelOption[], current: string | null) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      providers: DEFAULT_PROVIDERS,
      selectedProviderId: "ollama",
      selectedModel: "llama3",
      autoApprovePermissions: false,
      permissionLog: [],
      modelByProvider: {},
      availableModelsByProvider: {},
      currentModelByProvider: {},

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

      updateProvider: (id, updates) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),

      setSelectedModel: (providerId, model) =>
        set({ selectedProviderId: providerId, selectedModel: model }),

      getActiveProvider: () => {
        const s = get();
        return s.providers.find((p) => p.id === s.selectedProviderId);
      },

      setAutoApprovePermissions: (v) => set({ autoApprovePermissions: v }),

      logPermission: (entry) =>
        set((s) => ({
          // capado a las últimas 50 entradas para no crecer sin límite
          permissionLog: [{ ...entry, ts: Date.now() }, ...s.permissionLog].slice(0, 50),
        })),
    }),
    {
      name: "devflow-settings",
      // permissionLog es transitorio (auditoría de la sesión); el resto sí persiste.
      partialize: (s) => ({
        providers: s.providers,
        selectedProviderId: s.selectedProviderId,
        selectedModel: s.selectedModel,
        autoApprovePermissions: s.autoApprovePermissions,
        // La elección del usuario persiste; los modelos disponibles/activo son runtime (se repueblan).
        modelByProvider: s.modelByProvider,
      }),
    }
  )
);

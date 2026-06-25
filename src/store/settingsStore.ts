import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PROVIDERS, ProviderConfig } from "../lib/providers";

type SettingsStore = {
  providers: ProviderConfig[];
  selectedProviderId: string;
  selectedModel: string;
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void;
  setSelectedModel: (providerId: string, model: string) => void;
  getActiveProvider: () => ProviderConfig | undefined;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      providers: DEFAULT_PROVIDERS,
      selectedProviderId: "ollama",
      selectedModel: "llama3",

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
    }),
    { name: "devflow-settings" }
  )
);

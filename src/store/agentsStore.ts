import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_AGENTS, AgentConfig } from "../lib/providers";

// Los agentes arrancan desde DEFAULT_AGENTS pero el usuario puede editarlos (system prompt, nombre)
// y agregar agentes custom desde AgentsView. Persistimos la lista completa, pero el `merge` de abajo
// la reconcilia contra DEFAULT_AGENTS en cada hidratación: si en el futuro se agrega un agente default
// nuevo en código, aparece; las ediciones guardadas del usuario se aplican encima por id.
const DEFAULT_IDS = new Set(DEFAULT_AGENTS.map((a) => a.id));

export const isDefaultAgent = (id: string) => DEFAULT_IDS.has(id);

type AgentsStore = {
  agents: AgentConfig[];
  updateAgent: (id: string, patch: Partial<AgentConfig>) => void;
  addAgent: (partial: Partial<AgentConfig>) => string;
  removeAgent: (id: string) => void;
  resetAgent: (id: string) => void; // vuelve un agente default a sus valores de código
};

export const useAgentsStore = create<AgentsStore>()(
  persist(
    (set) => ({
      agents: DEFAULT_AGENTS,

      updateAgent: (id, patch) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      addAgent: (partial) => {
        const id = `custom_${Math.random().toString(36).slice(2, 8)}`;
        const agent: AgentConfig = {
          ...partial,
          id, // el id lo decidimos nosotros, no el caller
          name: partial.name?.trim() || "Agente custom",
          description: partial.description?.trim() || "Agente definido por el usuario.",
          icon: partial.icon || "✦",
          color: partial.color || "#a78bfa",
          providerId: partial.providerId || "mimo",
          model: partial.model || "",
          systemPrompt: partial.systemPrompt || "",
          skills: partial.skills || [],
          status: "inactive",
        };
        set((s) => ({ agents: [...s.agents, agent] }));
        return id;
      },

      removeAgent: (id) =>
        set((s) =>
          // Los agentes default no se borran (se pueden resetear); solo los custom.
          isDefaultAgent(id) ? {} : { agents: s.agents.filter((a) => a.id !== id) }
        ),

      resetAgent: (id) =>
        set((s) => {
          const def = DEFAULT_AGENTS.find((a) => a.id === id);
          if (!def) return {};
          return { agents: s.agents.map((a) => (a.id === id ? { ...def } : a)) };
        }),
    }),
    {
      name: "devflow-agents",
      // Reconcilia lo guardado con los defaults de código: parte de DEFAULT_AGENTS, aplica las
      // ediciones guardadas por id, y agrega los agentes custom que no son defaults.
      merge: (persisted, current) => {
        const saved = (persisted as { agents?: AgentConfig[] } | undefined)?.agents ?? [];
        const byId = new Map(saved.map((a) => [a.id, a]));
        const merged: AgentConfig[] = DEFAULT_AGENTS.map((d) => ({ ...d, ...byId.get(d.id) }));
        for (const a of saved) if (!DEFAULT_IDS.has(a.id)) merged.push(a);
        return { ...current, agents: merged };
      },
    }
  )
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_AGENTS, AgentConfig } from "../lib/providers";

// Los agentes arrancan desde DEFAULT_AGENTS pero el usuario puede editarlos (system prompt, nombre)
// y agregar agentes custom desde AgentsView. Persistimos la lista completa, pero el `merge` de abajo
// la reconcilia contra DEFAULT_AGENTS en cada hidratación: si en el futuro se agrega un agente default
// nuevo en código, aparece; las ediciones guardadas del usuario se aplican encima por id.
const DEFAULT_IDS = new Set(DEFAULT_AGENTS.map((a) => a.id));

// Agentes default que se retiraron del código pero pueden seguir persistidos: el merge los descarta
// para que no reaparezcan como "custom". "hermes" se reubicó como infraestructura MCP (Hermes · Mensajería
// en la vista MCP), ya no es un agente de chat (su modelo local era débil). Ver investigación MiMo×Hermes.
// "mimo-coder" se retiró en la Fase 4 (provider MiMo dado de baja) — DevFlow Code (opencode-agent) es
// el nuevo agente líder por defecto.
const RETIRED_AGENT_IDS = new Set(["hermes", "mimo-coder"]);

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
          providerId: partial.providerId || "opencode",
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
      version: 2,
      // v0→v1: rebrand del agente nativo de OpenCode a "DevFlow Code" (nombre de cara al usuario;
      // el id interno "opencode-agent"/"opencode" no cambia). El merge de abajo aplica lo persistido
      // ENCIMA de los defaults de código por diseño (para no pisar ediciones reales del usuario), así
      // que sin esto una instalación existente se queda con el nombre viejo para siempre. Solo toca
      // el registro si el nombre persistido es EXACTAMENTE el default viejo — si el usuario lo
      // renombró a otra cosa, esa edición real se respeta y no se toca.
      // v1→v2: retiro del provider "mimo" (Fase 4). A diferencia del parche anterior (un solo registro
      // por id fijo), acá reescribimos TODO registro persistido —default o custom— cuyo providerId sea
      // "mimo" (los 9 expertos + cualquier agente custom que el usuario haya apuntado ahí), porque el
      // merge de abajo aplica ese providerId persistido encima del nuevo default de código y lo dejaría
      // apuntando a un provider que ya no existe.
      migrate: (persisted, version) => {
        const p = persisted as { agents?: AgentConfig[] } | undefined;
        if (version < 1 && p?.agents) {
          const oc = p.agents.find((a) => a.id === "opencode-agent");
          if (oc && oc.name === "OpenCode") {
            const def = DEFAULT_AGENTS.find((a) => a.id === "opencode-agent");
            if (def) Object.assign(oc, { name: def.name, description: def.description, icon: def.icon, color: def.color });
          }
        }
        if (version < 2 && p?.agents) {
          for (const a of p.agents) {
            if (a.providerId === "mimo") {
              a.providerId = "opencode";
              if (a.model === "mimo-coder") a.model = "";
            }
          }
        }
        return p as AgentsStore;
      },
      // Reconcilia lo guardado con los defaults de código: parte de DEFAULT_AGENTS, aplica las
      // ediciones guardadas por id, y agrega los agentes custom que no son defaults.
      merge: (persisted, current) => {
        const saved = (persisted as { agents?: AgentConfig[] } | undefined)?.agents ?? [];
        const byId = new Map(saved.map((a) => [a.id, a]));
        const merged: AgentConfig[] = DEFAULT_AGENTS.map((d) => ({ ...d, ...byId.get(d.id) }));
        for (const a of saved) if (!DEFAULT_IDS.has(a.id) && !RETIRED_AGENT_IDS.has(a.id)) merged.push(a);
        return { ...current, agents: merged };
      },
    }
  )
);

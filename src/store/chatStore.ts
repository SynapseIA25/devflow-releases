import { create } from "zustand";

// Solo guarda el agente activo del chat. El historial real de la conversacion
// vive en workspaceStore.ts (tabs/Workspace). El antiguo sistema de
// conversations/Message fue removido junto con los componentes huerfanos
// ChatInput/ChatMessages (Fase 3 housekeeping).
type ChatStore = {
  activeAgentId: string;
  setActiveAgent: (id: string) => void;
};

export const useChatStore = create<ChatStore>()((set) => ({
  activeAgentId: "opencode-agent",
  setActiveAgent: (id) => set({ activeAgentId: id }),
}));

import { create } from "zustand";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string;
  timestamp: Date;
  isStreaming?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  agentId: string;
  createdAt: Date;
};

type ChatStore = {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeAgentId: string;
  isLoading: boolean;

  setActiveAgent: (id: string) => void;
  createConversation: (agentId?: string) => string;
  setActiveConversation: (id: string) => void;
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => void;
  getActiveConversation: () => Conversation | null;
  deleteConversation: (id: string) => void;
  setLoading: (v: boolean) => void;
};

const makeId = () => Math.random().toString(36).slice(2);

const welcome: Conversation = {
  id: "welcome",
  title: "Bienvenido a DevFlow",
  agentId: "mimo-coder",
  createdAt: new Date(),
  messages: [
    {
      id: "w1",
      role: "assistant",
      content: "Hola! Soy tu asistente de desarrollo. Puedo ayudarte a escribir código, refactorizar proyectos, ejecutar comandos y diseñar flujos de trabajo.\n\nPara empezar, configurá un proveedor de IA en **Settings** o elegí un agente del selector de arriba.",
      agentId: "mimo-coder",
      timestamp: new Date(),
    },
  ],
};

export const useChatStore = create<ChatStore>()((set, get) => ({
  conversations: [welcome],
  activeConversationId: "welcome",
  activeAgentId: "mimo-coder",
  isLoading: false,

  setActiveAgent: (id) => set({ activeAgentId: id }),

  createConversation: (agentId) => {
    const id = makeId();
    const aid = agentId ?? get().activeAgentId;
    const conv: Conversation = {
      id,
      title: "Nueva conversación",
      agentId: aid,
      createdAt: new Date(),
      messages: [],
    };
    set((s) => ({ conversations: [conv, ...s.conversations], activeConversationId: id }));
    return id;
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (msg) => {
    const { activeConversationId, conversations } = get();
    if (!activeConversationId) return;
    const newMsg: Message = { ...msg, id: makeId(), timestamp: new Date() };
    set({
      conversations: conversations.map((c) => {
        if (c.id !== activeConversationId) return c;
        const title = c.messages.length === 0 && msg.role === "user"
          ? msg.content.slice(0, 40)
          : c.title;
        return { ...c, title, messages: [...c.messages, newMsg] };
      }),
    });
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },

  deleteConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
    })),

  setLoading: (v) => set({ isLoading: v }),
}));

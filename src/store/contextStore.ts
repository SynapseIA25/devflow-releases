import { create } from "zustand";

export type ContextItem = { path: string; isDir: boolean };

type ContextStore = {
  items: ContextItem[];
  addItem: (item: ContextItem) => void;
  removeItem: (path: string) => void;
  clear: () => void;
};

export const useContextStore = create<ContextStore>()((set, get) => ({
  items: [],
  addItem: (item) => {
    if (get().items.some((i) => i.path === item.path)) return;
    set((s) => ({ items: [...s.items, item] }));
  },
  removeItem: (path) => set((s) => ({ items: s.items.filter((i) => i.path !== path) })),
  clear: () => set({ items: [] }),
}));

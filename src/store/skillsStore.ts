import { create } from "zustand";
import { persist } from "zustand/middleware";
import { slugify, syncSkillsToDisk, type Skill, type SkillSource, type SkillSuggestion } from "../lib/skills";

// Estado del sistema de skills (ver lib/skills.ts para el modelo completo). Persistido en
// localStorage como el resto de la app; el disco (~/.devflow/skills) es una proyección para que
// los agentes puedan LEER las skills — la fuente de verdad es este store.

const makeId = () => Math.random().toString(36).slice(2);

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 días sin uso → stale (igual que Hermes)
const CURATOR_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // la pasada corre a lo sumo 1 vez/día

type SkillsStore = {
  skills: Record<string, Skill>;
  order: string[];
  suggestions: SkillSuggestion[];
  taps: string[]; // repos GitHub "owner/repo" usados como fuentes de skills de la comunidad
  miningEnabled: boolean; // minería automática post-turno (las sugerencias SIEMPRE requieren aprobación)
  lastCuratorRun: number;
  // wsId → cantidad de bloques tool ya minados (para no re-analizar la misma actividad)
  minedAt: Record<string, number>;

  addSkill: (partial: { name: string; description: string; content: string; category?: string; source: SkillSource; tapRepo?: string }) => string;
  updateSkill: (id: string, patch: Partial<Pick<Skill, "name" | "description" | "category" | "content" | "enabled" | "pinned">>) => void;
  removeSkill: (id: string) => void;
  archiveSkill: (id: string) => void;
  restoreSkill: (id: string) => void;
  recordUse: (name: string) => void;
  addSuggestion: (s: Omit<SkillSuggestion, "id" | "createdAt">) => void;
  acceptSuggestion: (id: string) => void;
  rejectSuggestion: (id: string) => void;
  addTap: (repo: string) => void;
  removeTap: (repo: string) => void;
  setMiningEnabled: (v: boolean) => void;
  setMinedAt: (wsId: string, toolBlocks: number) => void;
  curatorPass: () => void;
};

// Nombre único: si ya existe una skill con ese slug, sufija -2, -3, …
const uniqueName = (base: string, skills: Record<string, Skill>, exceptId?: string): string => {
  const taken = new Set(Object.values(skills).filter((s) => s.id !== exceptId).map((s) => s.name));
  let name = slugify(base);
  for (let i = 2; taken.has(name); i++) name = `${slugify(base)}-${i}`;
  return name;
};

// Proyección al disco tras cada mutación (mejor esfuerzo, fire-and-forget).
const sync = (skills: Record<string, Skill>) => {
  void syncSkillsToDisk(Object.values(skills));
};

export const useSkillsStore = create<SkillsStore>()(
  persist(
    (set, get) => ({
      skills: {},
      order: [],
      suggestions: [],
      taps: [],
      miningEnabled: true,
      lastCuratorRun: 0,
      minedAt: {},

      addSkill: (partial) => {
        const id = makeId();
        set((s) => {
          const now = Date.now();
          const skill: Skill = {
            id,
            name: uniqueName(partial.name, s.skills),
            description: partial.description,
            category: partial.category,
            content: partial.content,
            source: partial.source,
            tapRepo: partial.tapRepo,
            enabled: true,
            pinned: false,
            archived: false,
            stale: false,
            uses: 0,
            createdAt: now,
            updatedAt: now,
          };
          const skills = { ...s.skills, [id]: skill };
          sync(skills);
          return { skills, order: [id, ...s.order] };
        });
        return id;
      },

      updateSkill: (id, patch) =>
        set((s) => {
          const prev = s.skills[id];
          if (!prev) return s;
          const name = patch.name !== undefined ? uniqueName(patch.name, s.skills, id) : prev.name;
          const skills = { ...s.skills, [id]: { ...prev, ...patch, name, updatedAt: Date.now() } };
          sync(skills);
          return { skills };
        }),

      removeSkill: (id) =>
        set((s) => {
          const { [id]: _, ...skills } = s.skills;
          return { skills, order: s.order.filter((x) => x !== id) };
        }),

      archiveSkill: (id) =>
        set((s) => {
          const prev = s.skills[id];
          if (!prev) return s;
          return { skills: { ...s.skills, [id]: { ...prev, archived: true, enabled: false } } };
        }),

      restoreSkill: (id) =>
        set((s) => {
          const prev = s.skills[id];
          if (!prev) return s;
          const skills = { ...s.skills, [id]: { ...prev, archived: false, stale: false, enabled: true, updatedAt: Date.now() } };
          sync(skills);
          return { skills };
        }),

      recordUse: (name) =>
        set((s) => {
          const found = Object.values(s.skills).find((x) => x.name === name);
          if (!found) return s;
          return {
            skills: { ...s.skills, [found.id]: { ...found, uses: found.uses + 1, lastUsedAt: Date.now(), stale: false } },
          };
        }),

      addSuggestion: (sug) =>
        set((s) => {
          // Dedupe: ya hay una sugerencia o una skill con ese nombre → descartar en silencio.
          const name = slugify(sug.name);
          if (s.suggestions.some((x) => x.name === name)) return s;
          if (Object.values(s.skills).some((x) => x.name === name)) return s;
          return { suggestions: [{ ...sug, name, id: makeId(), createdAt: Date.now() }, ...s.suggestions] };
        }),

      acceptSuggestion: (id) => {
        const sug = get().suggestions.find((x) => x.id === id);
        if (!sug) return;
        get().addSkill({ name: sug.name, description: sug.description, category: sug.category, content: sug.content, source: "mined" });
        set((s) => ({ suggestions: s.suggestions.filter((x) => x.id !== id) }));
      },

      rejectSuggestion: (id) =>
        set((s) => ({ suggestions: s.suggestions.filter((x) => x.id !== id) })),

      addTap: (repo) =>
        set((s) => {
          const r = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
          if (!/^[\w.-]+\/[\w.-]+$/.test(r) || s.taps.includes(r)) return s;
          return { taps: [...s.taps, r] };
        }),

      removeTap: (repo) => set((s) => ({ taps: s.taps.filter((t) => t !== repo) })),

      setMiningEnabled: (v) => set({ miningEnabled: v }),

      setMinedAt: (wsId, toolBlocks) => set((s) => ({ minedAt: { ...s.minedAt, [wsId]: toolBlocks } })),

      // Curator-lite determinista (sin LLM): marca stale lo no usado en 30 días. Nunca archiva ni
      // borra solo, y las pinneadas quedan exentas — el peor resultado es un badge en la UI.
      curatorPass: () =>
        set((s) => {
          const now = Date.now();
          if (now - s.lastCuratorRun < CURATOR_MIN_INTERVAL_MS) return s;
          let changed = false;
          const skills = { ...s.skills };
          for (const sk of Object.values(skills)) {
            const lastActivity = sk.lastUsedAt ?? sk.updatedAt;
            const shouldStale = !sk.pinned && !sk.archived && now - lastActivity > STALE_AFTER_MS;
            if (shouldStale !== sk.stale) {
              skills[sk.id] = { ...sk, stale: shouldStale };
              changed = true;
            }
          }
          return changed ? { skills, lastCuratorRun: now } : { lastCuratorRun: now };
        }),
    }),
    { name: "devflow-skills" }
  )
);

import { describe, it, expect } from "vitest";
import { suggestExperts, normalizeText } from "../expertRouter";
import { EXPERT_AGENTS } from "../providers";

describe("normalizeText", () => {
  it("baja a minúsculas y saca tildes", () => {
    expect(normalizeText("Migración de Índices")).toBe("migracion de indices");
    expect(normalizeText("DISEÑO")).toBe("diseno");
  });
});

describe("suggestExperts", () => {
  it("recomienda Base de Datos para una tarea de migración/query", () => {
    const r = suggestExperts("Necesito optimizar una query SQL y agregar una migración de esquema", EXPERT_AGENTS);
    expect(r[0].agent.id).toBe("expert-db");
    expect(r[0].score).toBeGreaterThan(1);
  });

  it("recomienda Seguridad para una tarea de vulnerabilidades/auth", () => {
    const r = suggestExperts("Revisar vulnerabilidades de XSS y el manejo de secrets en el auth", EXPERT_AGENTS);
    expect(r[0].agent.id).toBe("expert-seguridad");
  });

  it("recomienda Frontend para una tarea de UI/React", () => {
    const r = suggestExperts("El componente de React no es accesible y el estado del cliente se rompe", EXPERT_AGENTS);
    expect(r[0].agent.id).toBe("expert-frontend");
  });

  it("matchea keyword multipalabra 'base de datos'", () => {
    const r = suggestExperts("problema con la base de datos", EXPERT_AGENTS);
    expect(r.some((m) => m.agent.id === "expert-db")).toBe(true);
  });

  it("no matchea 'api' dentro de otra palabra (límite de palabra)", () => {
    const r = suggestExperts("el proceso es rapido y estable", EXPERT_AGENTS);
    // 'rapido' contiene 'api' pero NO debe activar Backend por eso
    expect(r.some((m) => m.agent.id === "expert-backend" && m.hits.includes("api"))).toBe(false);
  });

  it("devuelve vacío si no hay keywords que matcheen", () => {
    expect(suggestExperts("xyzzy plugh foobar", EXPERT_AGENTS)).toEqual([]);
  });

  it("ordena por score descendente", () => {
    const r = suggestExperts("arquitectura, patrones, refactor y deuda técnica del módulo", EXPERT_AGENTS);
    expect(r[0].agent.id).toBe("expert-arquitecto");
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });
});

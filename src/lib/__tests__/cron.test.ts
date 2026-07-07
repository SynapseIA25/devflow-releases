import { describe, it, expect } from "vitest";
import { cronMatches, isValidCron, describeCron } from "../cron";

// Fechas ancla (hora local). 2026-01-01 = jueves ⇒ Jan 3 sáb, 4 dom, 5 lun, 6 mar, 7 mié.
const MON_0900 = new Date(2026, 0, 5, 9, 0);
const TUE_0900 = new Date(2026, 0, 6, 9, 0);
const MON_1000 = new Date(2026, 0, 5, 10, 0);
const WED_0800 = new Date(2026, 0, 7, 8, 0);
const SAT_0800 = new Date(2026, 0, 3, 8, 0);
const SUN_0000 = new Date(2026, 0, 4, 0, 0);

describe("cronMatches", () => {
  it("'0 9 * * 1' matchea lunes 09:00", () => {
    expect(cronMatches("0 9 * * 1", MON_0900)).toBe(true);
  });
  it("'0 9 * * 1' NO matchea martes 09:00", () => {
    expect(cronMatches("0 9 * * 1", TUE_0900)).toBe(false);
  });
  it("'0 9 * * 1' NO matchea lunes 10:00", () => {
    expect(cronMatches("0 9 * * 1", MON_1000)).toBe(false);
  });
  it("'*/15 * * * *' matchea minutos múltiplos de 15", () => {
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 9, 30))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 9, 31))).toBe(false);
  });
  it("'0 8 * * 1-5' matchea de lunes a viernes, no sábado", () => {
    expect(cronMatches("0 8 * * 1-5", WED_0800)).toBe(true);
    expect(cronMatches("0 8 * * 1-5", SAT_0800)).toBe(false);
  });
  it("día de semana 7 se normaliza a domingo", () => {
    expect(cronMatches("0 0 * * 7", SUN_0000)).toBe(true);
    expect(cronMatches("0 0 * * 0", SUN_0000)).toBe(true);
    expect(cronMatches("0 0 * * 1", SUN_0000)).toBe(false);
  });
  it("lista de horas '0 9,17 * * *'", () => {
    expect(cronMatches("0 9,17 * * *", new Date(2026, 0, 5, 17, 0))).toBe(true);
    expect(cronMatches("0 9,17 * * *", new Date(2026, 0, 5, 12, 0))).toBe(false);
  });
  it("expresión con distinto número de campos no matchea", () => {
    expect(cronMatches("0 9 * *", MON_0900)).toBe(false);
  });
});

describe("isValidCron", () => {
  it("acepta 5 campos válidos", () => {
    expect(isValidCron("0 9 * * 1")).toBe(true);
    expect(isValidCron("*/15 0-8 1,15 * 1-5")).toBe(true);
  });
  it("rechaza cantidad de campos != 5", () => {
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("0 9 * * 1 1")).toBe(false);
  });
  it("rechaza caracteres inválidos", () => {
    expect(isValidCron("0 9 * * MON")).toBe(false);
  });
});

describe("describeCron", () => {
  it("describe patrones conocidos", () => {
    expect(describeCron("0 9 * * 1")).toBe("los lunes a las 09:00");
    expect(describeCron("*/15 * * * *")).toBe("cada 15 minutos");
  });
  it("devuelve la expresión cruda si no es conocida", () => {
    expect(describeCron("7 3 5 6 2")).toBe("7 3 5 6 2");
  });
});

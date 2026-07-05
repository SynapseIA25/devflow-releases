// Matcher de cron minimalista (5 campos: minuto hora día-mes mes día-semana) para el scheduler de
// triggers. Soporta `*`, números, listas `a,b`, rangos `a-b` y pasos `*/n` / `a-b/n`. Suficiente para
// los casos típicos ("0 9 * * 1" = lunes 9:00). No cubre nombres (JAN/MON) ni la disyunción especial
// dom/dow de cron real (acá se ANDean, documentado).

function matchField(field: string, value: number, min: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      step = Number(part.slice(slash + 1)) || 1;
      range = part.slice(0, slash);
    }
    if (range === "*") return (value - min) % step === 0;
    let lo: number;
    let hi: number;
    if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Validación laxa: cada campo debe tener solo caracteres esperados.
  return parts.every((p) => /^[\d*/,-]+$/.test(p));
}

// ¿La expresión cron matchea el momento `date`? Granularidad de minuto.
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hr, dom, mon, dow] = parts;
  return (
    matchField(min, date.getMinutes(), 0) &&
    matchField(hr, date.getHours(), 0) &&
    matchField(dom, date.getDate(), 1) &&
    matchField(mon, date.getMonth() + 1, 1) &&
    // día de semana: 0-6 (dom=0); aceptamos 7 como domingo normalizándolo a 0.
    matchField(dow.replace(/7/g, "0"), date.getDay(), 0)
  );
}

// Descripción legible de patrones comunes; si no matchea uno conocido, devuelve la expresión cruda.
export function describeCron(expr: string): string {
  const map: Record<string, string> = {
    "* * * * *": "cada minuto",
    "0 * * * *": "cada hora en punto",
    "0 9 * * *": "todos los días a las 09:00",
    "0 9 * * 1": "los lunes a las 09:00",
    "0 0 * * *": "todos los días a medianoche",
    "*/5 * * * *": "cada 5 minutos",
    "*/15 * * * *": "cada 15 minutos",
    "*/30 * * * *": "cada 30 minutos",
    "0 0 * * 0": "los domingos a medianoche",
    "0 8 * * 1-5": "de lunes a viernes a las 08:00",
  };
  return map[expr.trim()] ?? expr.trim();
}

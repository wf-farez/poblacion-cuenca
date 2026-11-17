// Cálculos demográficos (puros, sin dependencias) — se pueden probar con Node.

export const ANIO_MIN = 1950;
export const ANIO_MAX = 2050;

export const METODOS = {
  exponencial: "Exponencial (r continuo)",
  geometrico: "Geométrico (tasa compuesta)",
  lineal: "Lineal (incremento constante)",
};

export const BASES = {
  ultimos2: "Últimos dos censos",
  todo: "Serie completa (primer a último censo)",
};

/** Si la tasa anual de un tramo supera este valor (%), se considera cambio de límites / dato no comparable. */
export const UMBRAL_DISCONTINUIDAD = 15;

const SEXO_KEY = { total: "t", hombres: "h", mujeres: "m" };

/** Censos disponibles de una parroquia, ordenados: [{anio, valor}] para el sexo pedido. */
export function serieCensal(parroquia, sexo = "total") {
  const k = SEXO_KEY[sexo];
  return Object.entries(parroquia.censos)
    .map(([a, v]) => ({ anio: +a, valor: v[k] }))
    .sort((a, b) => a.anio - b.anio);
}

/** Tasa anual entre dos puntos según el método (fracción, 0.02 = 2 %). */
function tasa(p0, p1, metodo) {
  const dt = p1.anio - p0.anio;
  if (dt <= 0 || p0.valor <= 0 || p1.valor <= 0) return null;
  if (metodo === "geometrico") return Math.pow(p1.valor / p0.valor, 1 / dt) - 1;
  if (metodo === "lineal") return (p1.valor - p0.valor) / dt; // personas por año
  return Math.log(p1.valor / p0.valor) / dt;
}

function evalua(p0, r, anio, metodo) {
  const dt = anio - p0.anio;
  if (metodo === "geometrico") return p0.valor * Math.pow(1 + r, dt);
  if (metodo === "lineal") return Math.max(0, p0.valor + r * dt);
  return p0.valor * Math.exp(r * dt);
}

/** Tasa anual equivalente (%/año) para mostrar, comparable entre métodos. */
function tasaPct(p0, p1) {
  const dt = p1.anio - p0.anio;
  if (dt <= 0 || p0.valor <= 0 || p1.valor <= 0) return null;
  return (Math.log(p1.valor / p0.valor) / dt) * 100;
}

/**
 * Población de una entidad (parroquia o sector censal) en un año.
 * Devuelve { valor, tipo, tasa, ... } o null si no hay forma de estimarla.
 *  tipo: "censo" | "interpolado" | "proyectado"
 *  tasa: crecimiento anual (%) del tramo al que pertenece el año
 *  padre: (solo sectores) la parroquia a la que pertenece; después de su último censo el sector
 *         crece al ritmo de su parroquia (fallback = true). Entre censos se interpola con su serie.
 */
export function poblacionEn(parroquia, anio, opts = {}, padre = null) {
  const { sexo = "total", metodo = "exponencial", base = "ultimos2" } = opts;
  const s = serieCensal(parroquia, sexo);
  if (!s.length) return null;
  const exacto = s.find((p) => p.anio === anio);
  const idx = s.findIndex((p) => p.anio > anio);

  // Tramo entre censos disponibles (interpolación)
  if (idx > 0 || (idx === -1 && exacto)) {
    if (exacto) {
      const i = s.indexOf(exacto);
      // un sector muestra la tasa de su parroquia (su serie propia no es comparable entre censos)
      if (padre) return { valor: exacto.valor, tipo: "censo", tasa: poblacionEn(padre, anio, opts)?.tasa ?? null };
      const ref = i > 0 ? [s[i - 1], s[i]] : s.length > 1 ? [s[0], s[1]] : null;
      return { valor: exacto.valor, tipo: "censo", tasa: ref ? tasaPct(...ref) : null };
    }
    const a = s[idx - 1], b = s[idx];
    const tp = tasaPct(a, b);
    if (tp != null && Math.abs(tp) > UMBRAL_DISCONTINUIDAD)
      return { valor: null, tipo: "discontinuo", tasa: tp, discontinua: true };
    const r = tasa(a, b, metodo);
    return { valor: r == null ? null : evalua(a, r, anio, metodo), tipo: "interpolado", tasa: tp };
  }
  if (idx === 0) return null; // antes del primer censo de esa parroquia

  // Proyección más allá del último censo disponible
  const ult = s[s.length - 1];
  // Un sector que ya no figura en el último censo de su parroquia dejó de existir como tal: no se proyecta
  if (padre && ult.anio < Math.max(...Object.keys(padre.censos).map(Number))) return null;
  // Un sector siempre crece al ritmo de su parroquia, desde su último censo: su serie propia no es
  // comparable entre censos (el INEC divide sectores y, en el área urbana, cambia la numeración),
  // y así los sectores de una parroquia suman lo mismo que la proyección de la parroquia.
  if (padre) {
    const p1 = poblacionEn(padre, anio, opts);
    const p0 = poblacionEn(padre, ult.anio, opts);
    if (!p1?.valor || !p0?.valor) return { valor: null, tipo: "sin-serie", tasa: null };
    return { valor: (ult.valor * p1.valor) / p0.valor, tipo: "proyectado", tasa: p1.tasa, desde: ult.anio, fallback: true };
  }
  if (s.length < 2) return { valor: null, tipo: "sin-serie", tasa: null };
  const ini = base === "todo" ? s[0] : s[s.length - 2];
  const tp = tasaPct(ini, ult);
  if (tp != null && Math.abs(tp) > UMBRAL_DISCONTINUIDAD)
    // serie no comparable (cambio de límites): se mantiene constante
    return { valor: ult.valor, tipo: "proyectado", tasa: 0, desde: ult.anio, discontinua: true };
  const r = tasa(ini, ult, metodo);
  return {
    valor: r == null ? null : evalua(ult, r, anio, metodo),
    tipo: "proyectado",
    tasa: tp,
    desde: ult.anio,
  };
}

/** Densidad hab/km2 */
export const densidad = (pob, km2) => (pob != null && km2 > 0 ? pob / km2 : null);

/** Tasa de crecimiento anual (%) entre dos años cualesquiera. */
export function tasaEntre(parroquia, a1, a2, opts) {
  const p1 = poblacionEn(parroquia, a1, opts)?.valor;
  const p2 = poblacionEn(parroquia, a2, opts)?.valor;
  if (!p1 || !p2 || a2 <= a1) return null;
  return (Math.log(p2 / p1) / (a2 - a1)) * 100;
}

/**
 * Fila lista para tabla/mapa: valores para el año y filtro de sexo seleccionados,
 * más hombres / mujeres siempre desglosados.
 */
export function filaParroquia(parroquia, anio, opts, padre = null) {
  const total = poblacionEn(parroquia, anio, { ...opts, sexo: "total" }, padre);
  const h = poblacionEn(parroquia, anio, { ...opts, sexo: "hombres" }, padre);
  const m = poblacionEn(parroquia, anio, { ...opts, sexo: "mujeres" }, padre);
  const sel = poblacionEn(parroquia, anio, opts, padre);
  const pob = sel?.valor ?? null;
  return {
    id: parroquia.id,
    parr: padre ? padre.id : parroquia.id,
    nombre: padre ? parroquia.id : parroquia.nombre,
    parroquia: padre ? padre.nombre : parroquia.nombre,
    area: padre ? padre.area : parroquia.area,
    km2: parroquia.km2,
    poblacion: pob,
    hombres: h?.valor ?? null,
    mujeres: m?.valor ?? null,
    total: total?.valor ?? null,
    densidad: densidad(pob, parroquia.km2),
    tasa: sel?.tasa ?? null,
    tipo: sel?.tipo ?? "sin-dato",
    discontinua: !!sel?.discontinua,
    fallback: !!sel?.fallback,
  };
}

/** Serie anual completa ANIO_MIN–ANIO_MAX para el gráfico de una parroquia. */
export function serieAnual(parroquia, opts, padre = null) {
  const out = [];
  for (let a = ANIO_MIN; a <= ANIO_MAX; a++) {
    const p = poblacionEn(parroquia, a, opts, padre);
    out.push({ anio: a, valor: p?.valor ?? null, tipo: p?.tipo ?? "sin-dato" });
  }
  return out;
}

/** Serie anual de la suma de varias parroquias (total cantonal, urbano o RURAL). */
export function serieTotal(parroquias, opts, censos) {
  const ult = Math.max(...censos);
  const out = [];
  for (let a = ANIO_MIN; a <= ANIO_MAX; a++) {
    let suma = 0, n = 0;
    for (const p of parroquias) {
      const v = poblacionEn(p, a, opts)?.valor;
      if (v != null) { suma += v; n++; }
    }
    out.push({ anio: a, valor: n ? suma : null, tipo: censos.includes(a) ? "censo" : a > ult ? "proyectado" : "interpolado" });
  }
  return out;
}

/** Totales cantonales (suma de las filas con dato). */
export function totales(filas) {
  const con = filas.filter((f) => f.poblacion != null);
  const sum = (k) => con.reduce((s, f) => s + (f[k] ?? 0), 0);
  const km2 = filas.reduce((s, f) => s + f.km2, 0);
  const pob = sum("poblacion");
  return {
    poblacion: pob,
    hombres: sum("hombres"),
    mujeres: sum("mujeres"),
    km2,
    densidad: km2 > 0 ? pob / km2 : null,
    conDato: con.length,
    total: filas.length,
    estimados: con.filter((f) => f.tipo !== "censo").length,
    respaldo: con.filter((f) => f.fallback).length,
  };
}

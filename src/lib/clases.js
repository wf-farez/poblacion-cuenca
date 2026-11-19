// Clasificación en 6 clases de igual intervalo, en tonos tomate cálidos (contrastan con el verde de la
// interfaz y con los verdes y azules del mapa base); para la tasa, verde–tomate.

// gris medio: no se confunde con la clase más clara
export const SIN_DATO = [190, 190, 190];
export const N_CLASES = 6;
// 7 tonos de claro a oscuro; con menos clases se toman repartidos a lo largo de la escala
const TOMATES = [[254, 230, 212], [253, 198, 160], [252, 164, 118], [246, 128, 80], [230, 90, 50], [200, 52, 26], [150, 24, 10]];
const tonos = (n) => Array.from({ length: n }, (_, i) => TOMATES[n === 1 ? 3 : Math.round((i * (TOMATES.length - 1)) / (n - 1))]);
// población por parroquia: cortes fijos pedidos (5, 10, 20, 30, 40 y 50 mil)
export const CORTES_POBLACION_PARROQUIA = [5000, 10000, 20000, 30000, 40000, 50000];
// tasa: dos clases en tonos cálidos y suaves: verde salvia (decrece o se mantiene, hasta 0 %) y
// tomate suave (crece, más de 0 %)
const VERDE_TOMATE = [[143, 188, 122], [240, 142, 104]];
const CORTES_TASA = [0];

export const num = (n, d = 0) =>
  n == null || !isFinite(n) ? "—" : n.toLocaleString("es-EC", { maximumFractionDigits: d, minimumFractionDigits: d });

export const METRICAS = {
  poblacion: { label: "Población", unidad: "hab.", dec: () => 0, sufijo: "" },
  densidad: { label: "Densidad", unidad: "hab/ha", dec: (x) => (Math.abs(x) < 1 ? 2 : Math.abs(x) < 10 ? 1 : 0), sufijo: "" },
  tasa: { label: "Tasa de crecimiento anual", unidad: "% anual", dec: () => 2, sufijo: " %" },
};

// Intervalos «redondos» (1, 1,5, 2, 2,5, 3, 4, 5, 6 u 8 × 10^k) para que los cortes sean legibles
const REDONDOS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/**
 * Cortes de igual intervalo (en números redondos) entre `lo` (por defecto el mínimo) y el percentil
 * `techo` de v (1 = el máximo). v ordenado. Lo que pasa del techo entra en la última clase «Más de…».
 */
function cortesIguales(v, n, { lo = v[0], techo = 1 } = {}) {
  const hi = v[Math.min(v.length - 1, Math.floor(techo * (v.length - 1)))];
  if (!(hi > lo)) return [hi];
  // el intervalo redondo más cercano a (hi − lo)/n con el que la última clase («Más de…») aún
  // empiece por debajo del techo, para que ninguna clase quede vacía
  const ideal = (hi - lo) / n;
  const e = Math.pow(10, Math.floor(Math.log10(ideal)));
  const candidatos = [...REDONDOS.map((m) => m * e / 10), ...REDONDOS.map((m) => m * e), 10 * e]
    .map((paso) => ({ paso, ini: Math.floor(lo / paso) * paso }))
    .filter(({ paso, ini }) => ini + (n - 1) * paso < hi);
  const { paso, ini } = candidatos.reduce((a, b) => (Math.abs(b.paso - ideal) < Math.abs(a.paso - ideal) ? b : a));
  return Array.from({ length: n - 1 }, (_, i) => +(ini + (i + 1) * paso).toPrecision(12));
}

export function formato(metrica, x) {
  const m = METRICAS[metrica];
  return num(x, m.dec(x)) + m.sufijo;
}

/**
 * { clases:[{hasta,color,etiqueta}], claseDe(v) }
 * valores: los que fijan la escala (el visor pasa los del año 2050, así la leyenda no cambia con el año).
 * opciones: { lo, techo } de cortesIguales, o { cortes } para usar cortes fijos.
 */
export function crearClases(metrica, valores, opciones) {
  const v = valores.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  let cortes, colores;
  if (metrica === "tasa") {
    cortes = CORTES_TASA;
    colores = VERDE_TOMATE;
  } else {
    cortes = opciones?.cortes ?? (v.length ? cortesIguales(v, N_CLASES, opciones) : []);
    colores = tonos(cortes.length + 1);
  }
  const f = (x) => formato(metrica, x);
  const clases = [...cortes, Infinity].map((hasta, i) => ({
    hasta,
    color: colores[i] ?? TOMATES[TOMATES.length - 1],
    etiqueta:
      i === 0 ? `Hasta ${f(cortes[0])}` : hasta === Infinity ? `Más de ${f(cortes[i - 1])}` : `Más de ${f(cortes[i - 1])} a ${f(hasta)}`,
  }));
  if (!cortes.length) clases[0].etiqueta = "Sin datos";
  const claseDe = (x) => {
    if (x == null || !isFinite(x)) return -1;
    const i = clases.findIndex((c) => x <= c.hasta);
    return i === -1 ? clases.length - 1 : i;
  };
  return { clases, claseDe };
}

/** Texto blanco sobre fondos oscuros, oscuro sobre claros. */
export const colorTexto = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b < 100 ? [255, 255, 255] : [18, 25, 35]);

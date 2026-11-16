// Clasificación discreta con la misma paleta azul de MOVIDATA.

export const SIN_DATO = [240, 239, 236];
const AZULES = [[214, 228, 245], [134, 182, 239], [57, 135, 229], [28, 92, 171], [13, 54, 107], [6, 29, 58]];
const ROJO_AZUL = [[165, 16, 8], [214, 96, 77], [246, 176, 150], [134, 182, 239], [28, 92, 171], [6, 29, 58]];
const CORTES_TASA = [-2, -0.5, 0, 1, 2.5];

export const num = (n, d = 0) =>
  n == null || !isFinite(n) ? "—" : n.toLocaleString("es-EC", { maximumFractionDigits: d, minimumFractionDigits: d });

export const METRICAS = {
  poblacion: { label: "Población", unidad: "hab.", dec: () => 0, sufijo: "" },
  densidad: { label: "Densidad", unidad: "hab/km²", dec: (x) => (Math.abs(x) < 10 ? 1 : 0), sufijo: "" },
  tasa: { label: "Tasa de crecimiento anual", unidad: "% anual", dec: () => 2, sufijo: " %" },
};

// 2 cifras significativas para que los cortes sean legibles
function bonito(x) {
  if (!isFinite(x) || x === 0) return 0;
  const e = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / e) * e;
}

export function formato(metrica, x) {
  const m = METRICAS[metrica];
  return num(x, m.dec(x)) + m.sufijo;
}

/** { clases:[{hasta,color,etiqueta}], claseDe(v) } */
export function crearClases(metrica, valores) {
  const v = valores.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  let cortes, colores;
  if (metrica === "tasa") {
    cortes = CORTES_TASA;
    colores = ROJO_AZUL;
  } else {
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    cortes = v.length ? [1, 2, 3, 4, 5].map((i) => bonito(q(i / 6))) : [];
    cortes = cortes.filter((c, i) => i === 0 || c > cortes[i - 1]);
    const n = cortes.length + 1;
    colores = Array.from({ length: n }, (_, i) => AZULES[n === 1 ? 2 : Math.round((i * 5) / (n - 1))]);
  }
  const f = (x) => formato(metrica, x);
  const clases = [...cortes, Infinity].map((hasta, i) => ({
    hasta,
    color: colores[i] ?? AZULES[AZULES.length - 1],
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

import { useEffect, useId, useMemo, useRef, useState } from "react";
import MapView from "./MapView.jsx";
import { METRICAS, SIN_DATO, colorTexto, crearClases, formato, num } from "./lib/clases.js";
import {
  ANIO_MAX, ANIO_MIN, BASES, METODOS, UMBRAL_DISCONTINUIDAD,
  filaParroquia, serieAnual, serieTotal, totales,
} from "./lib/demografia.js";

// Cambia estos textos para el encabezado
const TITULO = "Población de Cuenca, 1950–2050";
const MAX_FILAS_SECTORES = 300;

const BASE = import.meta.env.BASE_URL;
const TIPO = {
  censo: "Censo", interpolado: "Interpolado", proyectado: "Proyección",
  discontinuo: "Serie discontinua", "sin-serie": "Sin serie", "sin-dato": "Sin dato",
};

function Campo({ etiqueta, ayuda, children, id }) {
  const tip = useId();
  return (
    <div className="field">
      <span className="tooltip tooltip--top filter-panel__tooltip" aria-describedby={tip}>
        <label className="field__label" htmlFor={id}>{etiqueta}</label>
        <span id={tip} className="tooltip__content" role="tooltip">{ayuda}</span>
      </span>
      {children}
    </div>
  );
}

export default function App() {
  const [datos, setDatos] = useState(null);
  const [sectores, setSectores] = useState(null);
  const [limites, setLimites] = useState(null);
  const [urbanasGeo, setUrbanasGeo] = useState({ type: "FeatureCollection", features: [] });
  const [error, setError] = useState(null);

  const [vista, setVista] = useState("parroquias"); // "parroquias" | "sectores"
  const [anio, setAnio] = useState(2022);
  const [area, setArea] = useState("");
  const [sexo, setSexo] = useState("total");
  const [metrica, setMetrica] = useState("poblacion");
  const [metodo, setMetodo] = useState("exponencial");
  const [base, setBase] = useState("ultimos2");
  const [selParr, setSelParr] = useState(""); // cod_parr (6 dígitos) o, en la vista de sectores, parroquia urbana (U01…)
  const [selSec, setSelSec] = useState(""); // cod_inec (12 dígitos)
  const [orden, setOrden] = useState({ k: "poblacion", d: -1 });
  const [panel, setPanel] = useState(null); // móvil: "leyenda" | "resultados"

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}data/poblacion.json`).then((r) => r.json()),
      fetch(`${BASE}data/sectores-cuenca.geojson`).then((r) => r.json()),
      fetch(`${BASE}data/limites.geojson`).then((r) => r.json()),
    ])
      .then(([d, g, l]) => { setDatos(d); setSectores(g); setLimites(l); })
      .catch((e) => setError(String(e)));
    fetch(`${BASE}data/urbanas.geojson`).then((r) => r.json()).then(setUrbanasGeo).catch(() => {});
  }, []);

  const porSectores = vista === "sectores";
  const opts = useMemo(() => ({ sexo, metodo, base }), [sexo, metodo, base]);
  const parrPorId = useMemo(() => new Map((datos?.parroquias ?? []).map((p) => [p.id, p])), [datos]);
  // Parroquias urbanas: solo nombran y filtran sectores urbanos (las cifras por parroquia siguen en 010150)
  const urbPorId = useMemo(() => new Map((datos?.urbanas ?? []).map((u) => [u.id, u])), [datos]);
  const selUrb = urbPorId.get(selParr) ?? null;

  // Filas por parroquia (siempre, 22) y por sector (solo en la vista de sectores)
  const filasParr = useMemo(() => (datos ? datos.parroquias.map((p) => filaParroquia(p, anio, opts)) : []), [datos, anio, opts]);
  const filasSec = useMemo(
    () =>
      datos && porSectores
        ? datos.sectores.map((s) => {
            const f = filaParroquia(s, anio, opts, parrPorId.get(s.parr));
            const u = urbPorId.get(s.pu);
            return u ? { ...f, pu: u.id, parroquia: u.nombre } : f;
          })
        : [],
    [datos, porSectores, anio, opts, parrPorId, urbPorId],
  );
  const filas = porSectores ? filasSec : filasParr;

  // El filtro «Parroquia» acota los sectores; en la vista de parroquias solo resalta
  const pasa = (f) => (!area || f.area === area) && (!porSectores || !selParr || f.parr === selParr || f.pu === selParr);
  const filasVis = useMemo(() => filas.filter(pasa), [filas, area, selParr, porSectores]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => new Set(filasVis.map((f) => f.id)), [filasVis]);
  const porId = useMemo(() => new Map(filas.map((f) => [f.id, f])), [filas]);

  const { clases, claseDe } = useMemo(() => crearClases(metrica, filasVis.map((f) => f[metrica])), [filasVis, metrica]);

  // Cada polígono se pinta con su sector (vista sectores) o con su parroquia (vista parroquias)
  const colorDe = useMemo(
    () => (p) => {
      const id = porSectores ? p.c : p.p;
      const f = porId.get(id);
      if (!f || !visible.has(id)) return [...SIN_DATO, 70];
      const c = claseDe(f[metrica]);
      return c < 0 ? [...SIN_DATO, 255] : [...clases[c].color, 255];
    },
    [porSectores, porId, visible, claseDe, clases, metrica],
  );

  const etiquetas = useMemo(() => {
    const ents = porSectores ? datos?.sectores : datos?.parroquias;
    if (!ents) return [];
    return ents.flatMap((e) => {
      const f = porId.get(e.id);
      if (!f || !visible.has(e.id) || f[metrica] == null) return [];
      const c = claseDe(f[metrica]);
      return [{ text: formato(metrica, f[metrica]), position: e.l, ancho: e.w, color: colorTexto(clases[c]?.color ?? SIN_DATO) }];
    });
  }, [datos, porSectores, porId, visible, metrica, clases, claseDe]);

  const tot = useMemo(() => totales(filasVis), [filasVis]);
  // Censos con cifras solo por parroquia (1950, 1982: sin zona ni sector)
  const censosParr = datos?.censosParroquia ?? [];
  const primerCensoSector = Math.min(...(datos?.censos ?? []).filter((a) => !censosParr.includes(a)));
  const sinSectores = porSectores && anio < primerCensoSector;
  // Población que está en sectores sin polígono (códigos que ya no existen) — solo antes de 2022
  const faltante = useMemo(() => {
    if (!porSectores || sinSectores || selUrb) return 0; // una parroquia urbana no tiene cifra propia con qué comparar
    const p = totales(filasParr.filter((f) => (!area || f.area === area) && (!selParr || f.id === selParr)));
    return Math.max(0, p.poblacion - tot.poblacion);
  }, [porSectores, sinSectores, selUrb, filasParr, area, selParr, tot]);

  const tabla = useMemo(() => {
    const { k, d } = orden;
    return [...filasVis].sort((a, b) => {
      const x = a[k], y = b[k];
      if (typeof x === "string" || typeof y === "string") return d * String(x ?? "").localeCompare(String(y ?? ""), "es");
      return d * ((x ?? -Infinity) - (y ?? -Infinity));
    });
  }, [filasVis, orden]);

  // Ficha: el sector elegido (vista sectores) o la parroquia elegida
  const entSel = porSectores && selSec ? datos?.sectores.find((s) => s.id === selSec) : selParr ? parrPorId.get(selParr) : null;
  const padreSel = entSel && entSel.parr ? parrPorId.get(entSel.parr) : null;
  const filaSel = entSel ? (porSectores && selSec ? porId.get(selSec) : filasParr.find((f) => f.id === selParr)) : null;
  const serie = useMemo(() => (entSel ? serieAnual(entSel, opts, padreSel) : null), [entSel, opts, padreSel]);
  // Sin selección, el gráfico muestra el total (cantón, o solo el área URBANA / RURAL según el filtro)
  const parrArea = useMemo(() => (datos?.parroquias ?? []).filter((p) => !area || p.area === area), [datos, area]);
  const serieGlobal = useMemo(() => (datos ? serieTotal(parrArea, opts, datos.censos) : null), [datos, parrArea, opts]);
  const km2Global = useMemo(() => parrArea.reduce((t, p) => t + p.km2, 0), [parrArea]);
  const tituloGlobal = area === "URBANA" ? "Área URBANA de Cuenca" : area === "RURAL" ? "Parroquias rurales de Cuenca" : "Cantón Cuenca";

  const elegirEnMapa = (p) => (porSectores ? setSelSec(p.c) : setSelParr(p.p));

  const textoTooltip = (p) => {
    const f = porId.get(porSectores ? p.c : p.p);
    const nombre = porSectores ? `Sector ${p.c}` : f?.nombre ?? p.p;
    if (!f) return nombre;
    const sub = porSectores ? `${f.parroquia}${f.pu ? " · parroquia urbana" : ` (${f.area})`}` : f.area;
    if (f.poblacion == null) return `<b>${nombre}</b><br/>${sub}<br/>Sin dato para ${anio}`;
    return `<b>${nombre}</b><br/>${sub}<br/>${TIPO[f.tipo]} ${anio}${f.fallback ? " (crece como su parroquia)" : ""}<br/>Población: ${num(f.poblacion)}<br/>Densidad: ${num(f.densidad, 1)} hab/km²<br/>Tasa: ${num(f.tasa, 2)} % anual`;
  };

  const exportarCSV = () => {
    const cab = [porSectores ? "cod_inec" : "cod_parr", "nombre", "parroquia", "area", "anio", "fuente", "poblacion", "hombres", "mujeres", "km2", "densidad_hab_km2", "tasa_pct_anual"];
    const lin = tabla.map((f) => [f.id, f.nombre, f.parroquia, f.area, anio, TIPO[f.tipo] + (f.fallback ? " (tasa parroquial)" : ""), f.poblacion?.toFixed(0), f.hombres?.toFixed(0), f.mujeres?.toFixed(0), f.km2.toFixed(3), f.densidad?.toFixed(2), f.tasa?.toFixed(3)].join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [cab.join(";"), ...lin].join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `poblacion_cuenca_${porSectores ? "sectores" : "parroquias"}_${anio}.csv`;
    a.click();
  };

  if (error) return <div style={{ padding: 32 }}>No se pudieron cargar los datos: {error}</div>;
  if (!datos || !sectores || !limites) return <div style={{ padding: 32 }}>Cargando sectores censales…</div>;

  const ultimoCenso = Math.max(...datos.censos);
  const anios = Array.from({ length: ANIO_MAX - ANIO_MIN + 1 }, (_, i) => ANIO_MIN + i);
  const m = METRICAS[metrica];
  const pctH = tot.poblacion ? (tot.hombres / tot.poblacion) * 100 : null;
  const ordenar = (k) => setOrden((o) => ({ k, d: o.k === k ? -o.d : -1 }));
  const abrir = (p) => setPanel((x) => (x === p ? null : p));
  const nombreSexo = { total: "", hombres: " de hombres", mujeres: " de mujeres" }[sexo];
  const unidad = porSectores ? "sectores" : "parroquias";
  const columnas = porSectores
    ? [["id", "Sector"], ["parroquia", "Parroquia"], ["area", "Área"], ["poblacion", "Población"], ["hombres", "Hombres"], ["mujeres", "Mujeres"], ["km2", "km²"], ["densidad", "hab/km²"], ["tasa", "Tasa %"], ["tipo", "Fuente"]]
    : [["nombre", "Parroquia"], ["area", "Área"], ["poblacion", "Población"], ["hombres", "Hombres"], ["mujeres", "Mujeres"], ["km2", "km²"], ["densidad", "hab/km²"], ["tasa", "Tasa %"], ["tipo", "Fuente"]];
  const filasTabla = porSectores ? tabla.slice(0, MAX_FILAS_SECTORES) : tabla;
  const esSel = (f) => (porSectores ? f.id === selSec : f.id === selParr);
  const clicFila = (f) => (porSectores ? setSelSec(f.id) : setSelParr(f.id));

  return (
    <div className="app-shell app-shell--mapa sp03">
      <header className="site-header sp03-header">
        <span className="brand__identity"><span className="brand__name"><strong><b>CIT</b>MOV</strong></span></span>
        <p className="sp03-header__titulo">{TITULO}</p>
      </header>

      <div className="app-shell__body">
        <aside className="filter-panel sp03-filtros">
          <div className="filter-panel__header"><h2>Filtros</h2></div>

          <Campo id="f-vista" etiqueta="Vista" ayuda="Parroquias: cifras de cada parroquia (suma de sus sectores, código INEC de 6 dígitos). Sectores censales: cifras de cada sector (código INEC de 12 dígitos).">
            <select id="f-vista" value={vista} onChange={(e) => { setVista(e.target.value); setSelSec(""); if (e.target.value !== "sectores" && selUrb) setSelParr("010150"); }}>
              <option value="parroquias">Parroquias</option>
              <option value="sectores">Sectores censales</option>
            </select>
          </Campo>

          <Campo id="f-anio" etiqueta="Año" ayuda="Años de censo: dato oficial del INEC. Años entre censos: interpolación. Después del último censo: proyección.">
            <select id="f-anio" value={anio} onChange={(e) => setAnio(+e.target.value)}>
              <optgroup label="Censos">
                {datos.censos.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
              <optgroup label="Entre censos (interpolado)">
                {anios.filter((a) => a < ultimoCenso && !datos.censos.includes(a)).map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
              <optgroup label="Proyección">
                {anios.filter((a) => a > ultimoCenso).map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            </select>
            <input className="pob-rango" type="range" min={ANIO_MIN} max={ANIO_MAX} value={anio} onChange={(e) => setAnio(+e.target.value)} aria-label="Año" />
          </Campo>

          <Campo id="f-area" etiqueta="Área" ayuda="URBANA: el área URBANA de Cuenca (código INEC 010150, agrupa todas las parroquias urbanas). RURAL: las 21 parroquias rurales del cantón.">
            <select id="f-area" value={area} onChange={(e) => { setArea(e.target.value); setSelParr(""); setSelSec(""); }}>
              <option value="">Todas</option><option value="URBANA">URBANA</option><option value="RURAL">RURAL</option>
            </select>
          </Campo>

          <Campo id="f-parroquia" etiqueta="Parroquia" ayuda="Elige una parroquia para ver su ficha y su serie 1950–2050. En la vista de sectores, acota el mapa a los sectores de esa parroquia; ahí también puedes elegir una parroquia urbana (Yanuncay, Huayna Cápac…) para ver solo los sectores que caen dentro de su límite. También puedes pulsarla en el mapa.">
            <select id="f-parroquia" value={selParr} onChange={(e) => { setSelParr(e.target.value); setSelSec(""); }}>
              <option value="">Todas</option>
              {[["URBANA", "URBANA"], ["RURAL", "RURALES"]].filter(([a]) => !area || a === area).map(([a, t]) => (
                <optgroup key={a} label={t}>
                  {datos.parroquias.filter((p) => p.area === a).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  {a === "URBANA" && porSectores && (datos.urbanas ?? []).map((u) => <option key={u.id} value={u.id}>{"\u00a0\u00a0"}{u.nombre}</option>)}
                </optgroup>
              ))}
            </select>
          </Campo>

          <Campo id="f-sexo" etiqueta="Sexo" ayuda="Hombres y mujeres se proyectan por separado; el total es su suma.">
            <select id="f-sexo" value={sexo} onChange={(e) => setSexo(e.target.value)}>
              <option value="total">Total</option><option value="hombres">Hombres</option><option value="mujeres">Mujeres</option>
            </select>
          </Campo>

          <Campo id="f-metrica" etiqueta="Mostrar en el mapa" ayuda="Población: habitantes. Densidad: habitantes por km² (superficie de los polígonos de sectores). Tasa: crecimiento anual del tramo (%).">
            <select id="f-metrica" value={metrica} onChange={(e) => setMetrica(e.target.value)}>
              {Object.entries(METRICAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Campo>

          <h3 className="layer-group-title">Proyección</h3>
          <Campo id="f-metodo" etiqueta="Método" ayuda="Exponencial: P·e^(r·t). Geométrico: P·(1+r)^t. Lineal: incremento constante por año.">
            <select id="f-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <Campo id="f-base" etiqueta="Período base" ayuda={`Censos que fijan la tasa. Si supera ±${UMBRAL_DISCONTINUIDAD} % anual se asume un cambio de límites. Los sectores censales se proyectan siempre al ritmo de su parroquia, desde su cifra de 2022.`}>
            <select id="f-base" value={base} onChange={(e) => setBase(e.target.value)}>
              {Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
        </aside>

        <main className="main-content">
          <div className="map-layout" data-mobile-panel={panel ?? undefined}>
            <section className="card map-card">
              <MapView
                sectores={sectores} limites={limites} vista={vista} colorDe={colorDe} visible={visible} etiquetas={etiquetas}
                selParr={selParr} selSec={porSectores ? selSec : ""} urbanas={urbanasGeo} onElegir={elegirEnMapa} textoTooltip={textoTooltip}
              />
            </section>

            <div className={`map-mobile-bar${panel ? " map-mobile-bar--open" : ""}`} role="group" aria-label="Paneles del mapa">
              <button type="button" className="map-mobile-bar__button" aria-pressed={panel === "leyenda"} onClick={() => abrir("leyenda")}>Leyenda</button>
              <button type="button" className="map-mobile-bar__button" aria-pressed={panel === "resultados"} onClick={() => abrir("resultados")}>Resultados</button>
              {panel && <button type="button" className="map-mobile-bar__close" aria-label="Cerrar panel" onClick={() => setPanel(null)}>×</button>}
            </div>

            <aside className="map-controls" aria-label="Leyenda del mapa">
              <section className="card map-controls__legend">
                <h2>Leyenda</h2>
                <div>
                  <span className="tooltip tooltip--bottom legend-sp06__help" aria-describedby="tip-ley">
                    <h3 className="layer-group-title">{m.label}{nombreSexo} · {anio}</h3>
                    <span id="tip-ley" className="tooltip__content" role="tooltip">
                      Las clases se calculan con los {unidad} visibles (seis grupos con igual número de {unidad}). Las cifras sobre el mapa aparecen al acercar.
                    </span>
                  </span>
                  <ul className="legend-list">
                    <li><span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: `rgb(${SIN_DATO})` }} />Sin dato</li>
                    {clases.map((c) => (
                      <li key={c.etiqueta}><span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: `rgb(${c.color})` }} />{c.etiqueta}</li>
                    ))}
                  </ul>
                  <p className="legend-heatmap__note">Pulsa {porSectores ? "un sector" : "una parroquia"} para ver su ficha.</p>
                </div>
              </section>
            </aside>

            <section className="card map-results">
              <h2>Resultados</h2>
              <p className="data-counter" aria-live="polite">
                Población{nombreSexo} de {anio}: <strong>{num(tot.poblacion)}</strong> habitantes en {tot.conDato} {unidad}
                {tot.conDato < tot.total ? ` (${tot.total - tot.conDato} sin dato)` : ""}.
              </p>
              <p className="data-counter">
                Superficie {num(tot.km2, 1)} km² · densidad <strong>{num(tot.densidad, 1)}</strong> hab/km² · hombres {num(pctH, 1)} % · mujeres {num(pctH == null ? null : 100 - pctH, 1)} %.
              </p>
              {sinSectores && (
                <p className="data-counter data-counter--warning">
                  No hay datos por sector censal antes de {primerCensoSector}: los censos {censosParr.join(" y ")} solo tienen cifras por parroquia (sin zona ni sector).{" "}
                  <button type="button" className="pob-enlace" onClick={() => { setVista("parroquias"); setSelSec(""); if (selUrb) setSelParr("010150"); }}>Ver por parroquias</button>
                </p>
              )}
              {faltante > 0.005 * tot.poblacion && (
                <p className="data-counter data-counter--warning">
                  Los sectores cambian de límites entre censos: {num(faltante)} habitantes del censo {anio} ({num((faltante / (tot.poblacion + faltante)) * 100, 1)} %) están en sectores cuyo código ya no existe en el mapa actual y no se dibujan, y la densidad y la tasa de cada sector se calculan con el polígono actual, por lo que son aproximadas. La vista de parroquias no tiene este problema.
                </p>
              )}
              {tot.estimados > 0 && (
                <p className="data-counter data-counter--warning">
                  {tot.estimados} {unidad} con valores estimados (interpolados o proyectados), no censales
                  {tot.respaldo > 0 ? `; cada sector se proyecta al ritmo de su parroquia, a partir de su cifra del último censo` : ""}. Las proyecciones son cálculo propio, no oficiales.
                </p>
              )}

              {entSel && filaSel && (
                <div className="pob-ficha">
                  <h3>
                    {porSectores && selSec ? `Sector ${entSel.id}` : entSel.nombre}{" "}
                    <small>· {porSectores && selSec ? `${filaSel.parroquia} · ` : ""}{filaSel.area} · {num(entSel.km2, 3)} km²</small>
                  </h3>
                  <p className="data-counter">
                    {anio} ({TIPO[filaSel.tipo]}): <strong>{num(filaSel.poblacion)}</strong> hab. · {num(filaSel.densidad, 1)} hab/km² · tasa {num(filaSel.tasa, 2)} % anual
                    {filaSel.fallback ? " · crece al ritmo de su parroquia" : ""}
                    {filaSel.discontinua && !filaSel.fallback ? " · serie discontinua (cambio de límites), se mantiene constante" : ""}
                  </p>
                  <Grafico serie={serie} anio={anio} onAnio={setAnio} km2={entSel.km2} />
                </div>
              )}
              {!entSel && selUrb && (
                <p className="data-counter">
                  <strong>{selUrb.nombre}</strong> (parroquia urbana): se muestran los {tot.total} sectores que caen dentro de su límite. El INEC no publica cifras propias de las parroquias urbanas (todas están en el código 010150), así que no hay serie ni proyección de la parroquia; pulsa un sector para ver la suya.
                </p>
              )}
              {!entSel && !selUrb && serieGlobal && (
                <div className="pob-ficha">
                  <h3>{tituloGlobal} <small>· serie 1950–2050</small></h3>
                  <Grafico serie={serieGlobal} anio={anio} onAnio={setAnio} km2={km2Global} />
                </div>
              )}

              <div className="pob-tabla">
                <div className="pob-tabla__barra">
                  <strong>Detalle por {porSectores ? "sector censal" : "parroquia"} · {anio}</strong>
                  <button type="button" onClick={exportarCSV}>Descargar CSV</button>
                </div>
                <div className="pob-tabla__scroll">
                  <table>
                    <thead>
                      <tr>
                        {columnas.map(([k, t]) => (
                          <th key={k} scope="col" onClick={() => ordenar(k)} aria-sort={orden.k === k ? (orden.d > 0 ? "ascending" : "descending") : "none"}>
                            {t}{orden.k === k ? (orden.d > 0 ? " ▲" : " ▼") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filasTabla.map((f) => (
                        <tr key={f.id} className={esSel(f) ? "is-sel" : ""} onClick={() => clicFila(f)}>
                          {porSectores ? <td>{f.id}</td> : <td>{f.nombre}</td>}
                          {porSectores && <td>{f.parroquia}</td>}
                          <td>{f.area}</td>
                          <td className="n">{num(f.poblacion)}</td><td className="n">{num(f.hombres)}</td><td className="n">{num(f.mujeres)}</td>
                          <td className="n">{num(f.km2, porSectores ? 3 : 1)}</td><td className="n">{num(f.densidad, 1)}</td><td className="n">{num(f.tasa, 2)}</td>
                          <td>{TIPO[f.tipo]}{f.fallback ? " (tasa parroquial)" : ""}{f.discontinua && !f.fallback ? " ⚠" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {porSectores && tabla.length > MAX_FILAS_SECTORES && (
                  <p className="data-counter">Se muestran los primeros {MAX_FILAS_SECTORES} de {num(tabla.length)} sectores; ordena la tabla, filtra por parroquia o descarga el CSV para verlos todos.</p>
                )}
              </div>

              <p className="map-attribution">
                Fuente: INEC, Censos de Población {censosParr.join(" y ")} (por parroquia) y de Población y Vivienda {datos.censos.filter((a) => !censosParr.includes(a)).join(", ")} (sectores censales, unidos por cod_inec) · superficie = polígonos de los sectores censales · Mapa base ©{" "}
                <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Grafico({ serie, anio, onAnio, km2 }) {
  const W = 560, H = 190, P = { l: 52, r: 14, t: 12, b: 24 };
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [arrastra, setArrastra] = useState(false);
  const pts = (serie ?? []).filter((s) => s.valor != null);
  if (!pts.length) return <p className="data-counter">Esta entidad no tiene serie suficiente para graficar.</p>;

  const max = Math.max(...pts.map((s) => s.valor)) * 1.1;
  const x = (a) => P.l + ((a - ANIO_MIN) / (ANIO_MAX - ANIO_MIN)) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const censos = pts.filter((s) => s.tipo === "censo");
  const ult = Math.max(...censos.map((s) => s.anio), 0);
  const tramo = (f) => pts.filter(f).map((s, i) => `${i ? "L" : "M"}${x(s.anio).toFixed(1)},${y(s.valor).toFixed(1)}`).join(" ");

  // Año bajo el puntero (el gráfico se escala con el ancho de la tarjeta)
  const anioDe = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const xs = ((e.clientX - r.left) / r.width) * W;
    return Math.max(ANIO_MIN, Math.min(ANIO_MAX, Math.round(ANIO_MIN + ((xs - P.l) / (W - P.l - P.r)) * (ANIO_MAX - ANIO_MIN))));
  };
  const alMover = (e) => {
    const a = anioDe(e);
    setHover(a);
    if (arrastra) onAnio(a);
  };
  const alPulsar = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setArrastra(true);
    onAnio(anioDe(e));
  };
  const soltar = () => setArrastra(false);

  const dato = hover != null ? serie[hover - ANIO_MIN] : null;
  const previo = hover != null && hover > ANIO_MIN ? serie[hover - ANIO_MIN - 1] : null;
  const crec = dato?.valor > 0 && previo?.valor > 0 ? Math.log(dato.valor / previo.valor) * 100 : null;
  const dens = dato?.valor != null && km2 > 0 ? dato.valor / km2 : null;
  const aDerecha = hover != null && hover > (ANIO_MIN + ANIO_MAX) / 2;

  return (
    <div className="pob-grafico-wrap">
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="pob-grafico" role="img"
        aria-label="Serie de población 1950–2050; pasa el ratón para ver cada año"
        onPointerMove={alMover} onPointerDown={alPulsar} onPointerUp={soltar} onPointerCancel={soltar}
        onPointerLeave={() => !arrastra && setHover(null)}
      >
        {[0, 0.5, 1].map((t) => {
          const v = (max / 1.1) * t;
          return (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="pob-grafico__rej" />
              <text x={P.l - 6} y={y(v) + 4} textAnchor="end">{num(v)}</text>
            </g>
          );
        })}
        {[1950, 1970, 1990, 2010, 2030, 2050].map((a) => <text key={a} x={x(a)} y={H - 6} textAnchor="middle">{a}</text>)}
        <path d={tramo((s) => s.anio <= ult)} className="pob-grafico__real" />
        <path d={tramo((s) => s.anio >= ult)} className="pob-grafico__proy" />
        {censos.map((s) => <circle key={s.anio} cx={x(s.anio)} cy={y(s.valor)} r="3.5" className="pob-grafico__pt" />)}
        <line x1={x(anio)} x2={x(anio)} y1={P.t} y2={H - P.b} className="pob-grafico__ahora" />
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="pob-grafico__guia" />
            {dato?.valor != null && <circle cx={x(hover)} cy={y(dato.valor)} r="5" className="pob-grafico__foco" />}
          </g>
        )}
        <rect x={P.l} y={P.t} width={W - P.l - P.r} height={H - P.t - P.b} fill="transparent" />
      </svg>

      {dato && (
        <div className={`pob-tooltip${aDerecha ? " pob-tooltip--izq" : ""}`} style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
          <span><strong>{hover}</strong> · {TIPO[dato.tipo] ?? dato.tipo}</span>
          {dato.valor == null ? (
            <span>Sin dato</span>
          ) : (
            <>
              <span>Población: <b>{num(dato.valor)}</b></span>
              <span>Densidad: <b>{num(dens, 1)}</b> hab/km²</span>
              <span>Crecimiento: <b>{num(crec, 2)}</b> % anual</span>
            </>
          )}
        </div>
      )}

      <input
        className="pob-rango pob-grafico__rango" type="range" min={ANIO_MIN} max={ANIO_MAX} value={anio}
        onChange={(e) => onAnio(+e.target.value)} aria-label="Año del mapa"
        style={{ marginLeft: `${(P.l / W) * 100}%`, width: `${((W - P.l - P.r) / W) * 100}%` }}
      />
      <p className="data-counter">Año del mapa: <strong>{anio}</strong>. Pasa el ratón por el gráfico para ver cada año; pulsa o arrastra, o usa el deslizador, para cambiar el año del mapa.</p>
    </div>
  );
}

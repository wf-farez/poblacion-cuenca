import { useEffect, useId, useMemo, useRef, useState } from "react";
import MapView from "./MapView.jsx";
import { CORTES_POBLACION_PARROQUIA, METRICAS, SIN_DATO, colorTexto, crearClases, formato, num } from "./lib/clases.js";
import {
  ANIO_MAX, ANIO_MIN,
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
  const [error, setError] = useState(null);

  const [vista, setVista] = useState("parroquias"); // "parroquias" | "sectores"
  const [anio, setAnio] = useState(2022);
  const [area, setArea] = useState("");
  const [sexo, setSexo] = useState("total");
  const [metrica, setMetrica] = useState("poblacion");
  // Proyección fija: método exponencial (como la tasa intercensal del INEC) con la tasa de los dos
  // últimos censos (2010–2022)
  const metodo = "exponencial";
  const base = "ultimos2";
  const [selParr, setSelParr] = useState(""); // cod_parr (6 dígitos), parroquia urbana (U01…) o 010150 (toda el área URBANA)
  const [selSec, setSelSec] = useState(""); // cod_inec (12 dígitos)
  const [orden, setOrden] = useState({ k: "poblacion", d: -1 });
  const [panel, setPanel] = useState(null); // móvil: "leyenda" | "resultados"

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}data/poblacion.json`).then((r) => r.json()),
      fetch(`${BASE}data/sectores-cuenca.geojson`).then((r) => r.json()),
      fetch(`${BASE}data/limites.geojson`).then((r) => r.json()),
    ])
      .then(([d, g, l]) => {
        // nombres de parroquias en mayúsculas en todo el visor (mapa, tabla, ficha, CSV)
        for (const p of d.parroquias) p.nombre = p.nombre.toLocaleUpperCase("es");
        setDatos(d); setSectores(g); setLimites(l);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const porSectores = vista === "sectores";
  const opts = useMemo(() => ({ sexo, metodo, base }), [sexo, metodo, base]);
  const parrPorId = useMemo(() => new Map((datos?.parroquias ?? []).map((p) => [p.id, p])), [datos]);

  const censosParr = datos?.censosParroquia ?? [];
  // Los polígonos de sectores son del último censo (2022). Antes, los códigos de sector no marcan el
  // mismo lugar (el INEC divide y renumera sectores) y 1950/1982 no tienen sectores: la vista de
  // sectores solo se muestra desde ese censo hasta 2050.
  const anioMapa = Math.max(...(datos?.censos ?? [0]));
  const sinSectores = porSectores && anio < anioMapa;
  // Parroquias urbanas (grupo 010150): solo existen desde el censo del mapa (suma de sus sectores 2022).
  // Antes, el área urbana se muestra como un solo total, «Cuenca (URBANA)» (agregado).
  const agrupa = anio < anioMapa;
  const parrMapa = useMemo(() => (datos?.parroquias ?? []).filter((p) => (agrupa ? !p.grupo : !p.agregado)), [datos, agrupa]);
  // parroquia con la que se pinta el polígono de un sector en la vista de parroquias
  const idParr = (props) => (agrupa ? props.p : props.u || props.p);
  // id dibujado en el mapa (antes de 2022, una parroquia urbana se dibuja como toda el área URBANA)
  const grupoDe = useMemo(() => (id) => (agrupa && parrPorId.get(id)?.grupo) || id, [agrupa, parrPorId]);
  // ¿pertenece a lo elegido? (elegir el área URBANA incluye sus 15 parroquias)
  const enSel = useMemo(() => (id) => !!selParr && (id === selParr || parrPorId.get(id)?.grupo === selParr), [selParr, parrPorId]);
  // Fila de una parroquia o de un sector. Las parroquias urbanas crecen al ritmo del total urbano
  // (solo tienen el censo 2022); los sectores, al de su parroquia.
  const fila = (e, a = anio) => {
    if (e.grupo) return { ...filaParroquia(e, a, opts, parrPorId.get(e.grupo)), nombre: e.nombre, parroquia: e.nombre, parr: e.id };
    if (!e.parr) return filaParroquia(e, a, opts);
    const f = filaParroquia(e, a, opts, parrPorId.get(e.parr));
    const u = parrPorId.get(e.pu);
    return u ? { ...f, pu: u.id, parroquia: u.nombre } : f;
  };

  // Filas por parroquia (siempre) y por sector (solo en la vista de sectores)
  const filasParr = useMemo(() => parrMapa.map((e) => fila(e)), [parrMapa, anio, opts]); // eslint-disable-line react-hooks/exhaustive-deps
  const filasSec = useMemo(
    () => (datos && porSectores ? datos.sectores.map((e) => fila(e)) : []),
    [datos, porSectores, anio, opts, parrPorId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filas = porSectores ? filasSec : filasParr;

  // El filtro «Parroquia» acota los sectores; en la vista de parroquias solo resalta
  const pasa = (f) => !sinSectores && (!area || f.area === area) && (!porSectores || !selParr || enSel(f.parr) || f.pu === selParr);
  const filasVis = useMemo(() => filas.filter(pasa), [filas, area, enSel, porSectores, sinSectores]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => new Set(filasVis.map((f) => f.id)), [filasVis]);
  const porId = useMemo(() => new Map(filas.map((f) => [f.id, f])), [filas]);
  // ¿pertenece a la parroquia elegida? (antes de 2022 una parroquia urbana se dibuja como toda el área URBANA)
  const esDeSel = (id) => !selParr || enSel(id) || id === grupoDe(selParr);
  // Lo que se dibuja en el mapa: con una parroquia elegida, solo ella (la tabla sigue mostrando todas)
  const enMapa = useMemo(
    () => (selParr && !porSectores ? new Set([...visible].filter(esDeSel)) : visible),
    [visible, selParr, porSectores, enSel, grupoDe], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const idMapa = (p) => (porSectores ? p.c : idParr(p));
  const filtroMapa = useMemo(
    () => (selParr ? (p) => enMapa.has(idMapa(p)) : null),
    [selParr, enMapa, porSectores, agrupa], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Leyenda fija para todos los años: 4 clases iguales de 0 al valor máximo de la proyección de 2050
  // (de todo el cantón, para el sexo elegido). En sectores se usa el percentil 90 de 2050 en vez del
  // máximo: unos pocos sectores diminutos con valores extremos dejarían a casi todos en la primera clase.
  const { clases, claseDe } = useMemo(() => {
    if (!datos) return crearClases(metrica, []);
    const ents = porSectores ? datos.sectores : datos.parroquias.filter((p) => !p.agregado);
    const v2050 = ents.map((e) => fila(e, ANIO_MAX)[metrica]);
    // población por parroquia: cortes fijos de 5, 10, 20, 30, 40 y 50 mil habitantes
    if (metrica === "poblacion" && !porSectores) return crearClases(metrica, v2050, { cortes: CORTES_POBLACION_PARROQUIA });
    return crearClases(metrica, v2050, { lo: 0, techo: porSectores ? 0.9 : 1 });
  }, [datos, porSectores, metrica, opts, parrPorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada polígono se pinta con su sector (vista sectores) o con su parroquia (vista parroquias)
  const colorDe = useMemo(
    () => (p) => {
      const id = idMapa(p);
      const f = porId.get(id);
      if (!f || !enMapa.has(id)) return [...SIN_DATO, selParr ? 0 : 70];
      const c = claseDe(f[metrica]);
      return c < 0 ? [...SIN_DATO, 255] : [...clases[c].color, 255];
    },
    [porSectores, porId, enMapa, selParr, claseDe, clases, metrica, agrupa], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const etiquetas = useMemo(() => {
    const ents = porSectores ? datos?.sectores : parrMapa;
    if (!ents) return [];
    return ents.flatMap((e) => {
      const f = porId.get(e.id);
      if (!f || !enMapa.has(e.id) || f[metrica] == null) return [];
      const c = claseDe(f[metrica]);
      return [{ text: formato(metrica, f[metrica]), position: e.l, ancho: e.w, color: colorTexto(clases[c]?.color ?? SIN_DATO) }];
    });
  }, [datos, parrMapa, porSectores, porId, enMapa, metrica, clases, claseDe]);

  // Nombres de las parroquias sobre el mapa (con una parroquia elegida, solo la suya)
  const nombresMapa = useMemo(() => {
    if (sinSectores) return [];
    return parrMapa
      .filter((p) => (!area || p.area === area) && (esDeSel(p.id) || p.id === selParr))
      .map((p) => ({ text: p.nombre, position: p.l, ancho: p.w }));
  }, [parrMapa, area, selParr, enSel, grupoDe, sinSectores]); // eslint-disable-line react-hooks/exhaustive-deps

  const tot = useMemo(() => totales(filasVis), [filasVis]);
  // Censos con cifras solo por parroquia (1950, 1982: sin zona ni sector)
  // Población que está en sectores sin polígono (códigos que ya no existen) — solo antes de 2022
  const faltante = useMemo(() => {
    if (!porSectores || sinSectores) return 0;
    const p = totales(filasParr.filter((f) => (!area || f.area === area) && (!selParr || enSel(f.id))));
    return Math.max(0, p.poblacion - tot.poblacion);
  }, [porSectores, sinSectores, filasParr, area, selParr, enSel, tot]);

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
  const padreSel = entSel?.grupo ? parrPorId.get(entSel.grupo) : entSel?.parr ? parrPorId.get(entSel.parr) : null;
  const filaSel = entSel ? (porSectores && selSec ? porId.get(selSec) : filasParr.find((f) => f.id === selParr) ?? fila(entSel)) : null;
  const serie = useMemo(() => {
    if (!entSel) return null;
    const sa = serieAnual(entSel, opts, padreSel);
    // sector: solo desde el año del mapa (antes su código puede ser otro lugar)
    return porSectores && selSec ? sa.map((v) => (v.anio < anioMapa ? { ...v, valor: null, tipo: "sin-dato" } : v)) : sa;
  }, [entSel, opts, padreSel, porSectores, selSec, anioMapa]);
  // Sin selección, el gráfico muestra el total (cantón, o solo el área URBANA / RURAL según el filtro);
  // lo urbano entra con su total (serie 1950–2050), no con sus parroquias
  const parrArea = useMemo(() => (datos?.parroquias ?? []).filter((p) => !p.grupo && (!area || p.area === area)), [datos, area]);
  const serieGlobal = useMemo(() => (datos ? serieTotal(parrArea, opts, datos.censos) : null), [datos, parrArea, opts]);
  const km2Global = useMemo(() => parrArea.reduce((t, p) => t + p.km2, 0), [parrArea]);
  const tituloGlobal = area === "URBANA" ? "Área URBANA de Cuenca" : area === "RURAL" ? "Parroquias rurales de Cuenca" : "Cantón Cuenca";

  const elegirEnMapa = (p) => (porSectores ? setSelSec(p.c) : setSelParr(idParr(p)));

  const textoTooltip = (p) => {
    const f = porId.get(porSectores ? p.c : idParr(p));
    const nombre = `<span style="display:block;margin-bottom:4px;font-size:16px;font-weight:700;color:#23501b">${porSectores ? `Sector ${p.c}` : f?.nombre ?? p.p}</span>`;
    if (sinSectores) return `${nombre}Sin datos por sector antes de ${anioMapa}`;
    if (!f) return nombre;
    const sub = porSectores ? `${f.parroquia}${f.pu ? " · parroquia urbana" : ` (${f.area})`}` : f.area;
    if (f.poblacion == null) return `${nombre}${sub}<br/>Sin dato para ${anio}`;
    return `${nombre}${sub}<br/>${TIPO[f.tipo]} ${anio}${f.fallback ? (porSectores ? " (crece como su parroquia)" : " (crece al ritmo del área URBANA)") : ""}<br/>Población: ${num(f.poblacion)}<br/>Densidad: ${num(f.densidad, 2)} hab/ha<br/>Tasa: ${num(f.tasa, 2)} % anual`;
  };

  const exportarCSV = () => {
    const cab = [porSectores ? "cod_inec" : "cod_parr", "nombre", "parroquia", "area", "anio", "fuente", "poblacion", "hombres", "mujeres", "ha", "densidad_hab_ha", "tasa_pct_anual"];
    const lin = tabla.map((f) => [f.id, f.nombre, f.parroquia, f.area, anio, TIPO[f.tipo] + (f.fallback ? (porSectores ? " (tasa parroquial)" : " (tasa del área URBANA)") : ""), f.poblacion?.toFixed(0), f.hombres?.toFixed(0), f.mujeres?.toFixed(0), f.ha.toFixed(2), f.densidad?.toFixed(2), f.tasa?.toFixed(3)].join(";"));
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
  // Porcentajes sobre la población total (hombres + mujeres). Con el filtro SEXO, el sexo que no se
  // muestra va en 0 % y el elegido con su parte del total.
  const totHM = tot.hombres + tot.mujeres;
  const pctH = !totHM ? null : sexo === "mujeres" ? 0 : (tot.hombres / totHM) * 100;
  const pctM = !totHM ? null : sexo === "hombres" ? 0 : (tot.mujeres / totHM) * 100;
  const ordenar = (k) => setOrden((o) => ({ k, d: o.k === k ? -o.d : -1 }));
  const abrir = (p) => setPanel((x) => (x === p ? null : p));
  const nombreSexo = { total: "", hombres: " de hombres", mujeres: " de mujeres" }[sexo];
  const unidad = porSectores ? "sectores" : "parroquias";
  const columnas = porSectores
    ? [["id", "Sector"], ["parroquia", "Parroquia"], ["area", "Territorio"], ["poblacion", "Población"], ["hombres", "Hombres"], ["mujeres", "Mujeres"], ["ha", "ha"], ["densidad", "hab/ha"], ["tasa", "Tasa %"], ["tipo", "Fuente"]]
    : [["nombre", "Parroquia"], ["area", "Territorio"], ["poblacion", "Población"], ["hombres", "Hombres"], ["mujeres", "Mujeres"], ["ha", "ha"], ["densidad", "hab/ha"], ["tasa", "Tasa %"], ["tipo", "Fuente"]];
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
          <div className="filter-panel__header"><h2>FILTROS</h2></div>

          <Campo id="f-area" etiqueta="TERRITORIO" ayuda="URBANA: las 15 parroquias urbanas de Cuenca desde 2022 (el INEC las agrupa en el código 010150; antes de 2022 se muestra el área URBANA completa). RURAL: las 21 parroquias rurales del cantón.">
            <select id="f-area" value={area} onChange={(e) => { setArea(e.target.value); setSelParr(""); setSelSec(""); }}>
              <option value="">TODOS</option><option value="URBANA">URBANA</option><option value="RURAL">RURAL</option>
            </select>
          </Campo>

          <Campo id="f-vista" etiqueta="VISTA" ayuda="Parroquias: cifras de cada parroquia (código INEC de 6 dígitos); desde 2022, también de cada parroquia urbana (suma de sus sectores). Sectores censales: cifras de cada sector (código INEC de 12 dígitos), de 2022 a 2050.">
            <select id="f-vista" value={vista} onChange={(e) => { setVista(e.target.value); setSelSec(""); }}>
              <option value="parroquias">PARROQUIAS</option>
              <option value="sectores">SECTORES CENSALES</option>
            </select>
          </Campo>

          <Campo id="f-parroquia" etiqueta="PARROQUIA" ayuda="Elige una parroquia para ver su ficha y su serie 1950–2050. En la vista de sectores, acota el mapa a los sectores de esa parroquia; ahí también puedes elegir una parroquia urbana (Yanuncay, Huayna Cápac…) para ver solo los sectores que caen dentro de su límite. También puedes pulsarla en el mapa.">
            <select id="f-parroquia" value={selParr} onChange={(e) => { setSelParr(e.target.value); setSelSec(""); }}>
              <option value="">TODAS</option>
              {[["URBANA", "URBANA"], ["RURAL", "RURALES"]].filter(([a]) => !area || a === area).map(([a, t]) => (
                <optgroup key={a} label={t}>
                  {datos.parroquias.filter((p) => p.area === a)
                    .sort((x, y) => (x.agregado ? -1 : y.agregado ? 1 : a === "URBANA" ? x.nombre.localeCompare(y.nombre, "es") : 0))
                    .map((p) => <option key={p.id} value={p.id}>{p.agregado ? "TODA EL ÁREA URBANA" : p.nombre}</option>)}
                </optgroup>
              ))}
            </select>
          </Campo>

          <Campo id="f-anio" etiqueta="AÑO" ayuda="Años de censo: dato oficial del INEC. Años entre censos: interpolación. Después del último censo: proyección.">
            <select id="f-anio" value={anio} onChange={(e) => setAnio(+e.target.value)}>
              <optgroup label="CENSOS">
                {datos.censos.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
              <optgroup label="ENTRE CENSOS (INTERPOLADO)">
                {anios.filter((a) => a < ultimoCenso && !datos.censos.includes(a)).map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
              <optgroup label="PROYECCIÓN">
                {anios.filter((a) => a > ultimoCenso).map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            </select>
            <input className="pob-rango" type="range" min={ANIO_MIN} max={ANIO_MAX} value={anio} onChange={(e) => setAnio(+e.target.value)} aria-label="Año" />
          </Campo>

          <Campo id="f-sexo" etiqueta="SEXO" ayuda="Hombres y mujeres se proyectan por separado; el total es su suma.">
            <select id="f-sexo" value={sexo} onChange={(e) => setSexo(e.target.value)}>
              <option value="total">TOTAL</option><option value="hombres">HOMBRES</option><option value="mujeres">MUJERES</option>
            </select>
          </Campo>

          <Campo id="f-metrica" etiqueta="MOSTRAR EN EL MAPA" ayuda="Población: habitantes. Densidad: habitantes por hectárea (superficie de los polígonos de sectores). Tasa: crecimiento anual del tramo (%).">
            <select id="f-metrica" value={metrica} onChange={(e) => setMetrica(e.target.value)}>
              {Object.entries(METRICAS).map(([k, v]) => <option key={k} value={k}>{v.label.toLocaleUpperCase("es")}</option>)}
            </select>
          </Campo>
        </aside>

        <main className="main-content">
          <div className="map-layout" data-mobile-panel={panel ?? undefined}>
            <section className="card map-card">
              <MapView
                sectores={sectores} limites={limites} vista={vista} colorDe={colorDe} visible={visible} etiquetas={etiquetas} nombres={nombresMapa} filtroMapa={filtroMapa}
                selParr={selParr} selSec={porSectores ? selSec : ""} grupoDe={grupoDe} enSel={enSel} onElegir={elegirEnMapa} textoTooltip={textoTooltip}
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
                      {metrica === "tasa"
                        ? "Dos clases: verde, la población decrece o se mantiene (hasta 0 %); tomate, crece (más de 0 %)."
                        : metrica === "poblacion" && !porSectores
                        ? "Escala fija para todos los años: hasta 5 000, de 5 000 a 10 000 y luego tramos de 10 000 hasta 50 000; la última clase, más de 50 000 habitantes."
                        : `Escala fija para todos los años: seis clases iguales desde 0 hasta el ${porSectores ? "valor del 90 % de los sectores" : "valor más alto"} de la proyección de 2050 (todo el cantón), en números redondos. Así el mismo color significa lo mismo en cualquier año.`}
                    </span>
                  </span>
                  <ul className="legend-list">
                    <li><span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: `rgb(${SIN_DATO})` }} />Sin dato</li>
                    {!sinSectores && clases.map((c) => (
                      <li key={c.etiqueta}><span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: `rgb(${c.color})` }} />{c.etiqueta}</li>
                    ))}
                  </ul>
                  <p className="legend-heatmap__note">Pulsa {porSectores ? "un sector" : "una parroquia"} para ver su ficha.</p>
                </div>
              </section>
            </aside>

            <section className="card map-results">
              <h2>Resultados</h2>
              {!sinSectores && (<>
              <p className="data-counter" aria-live="polite">
                Población{nombreSexo} de {anio}: <strong>{num(tot.poblacion)}</strong> habitantes en{" "}
                {porSectores
                  ? `${tot.conDato} ${unidad}`
                  : area === "URBANA" ? "el área URBANA" : area === "RURAL" ? "el área RURAL" : "el cantón Cuenca"}
                {tot.conDato < tot.total ? ` (${tot.total - tot.conDato} ${porSectores ? "sin dato" : `${unidad} sin dato`})` : ""}.
              </p>
              <p className="data-counter">
                Superficie {num(tot.ha, 0)} ha · densidad <strong>{num(tot.densidad, 2)}</strong> hab/ha · hombres {num(pctH, 1)} % · mujeres {num(pctM, 1)} %{sexo !== "total" ? " de la población total" : ""}.
              </p>
              </>)}
              {sinSectores && (
                <p className="data-counter data-counter--warning">
                  La vista de sectores censales muestra {anioMapa}–2050. Antes de {anioMapa} no hay datos comparables por sector: los sectores se dibujan con el mapa del censo {anioMapa}, y en los censos anteriores el INEC dividió y renumeró los sectores, así que el mismo código puede ser otro lugar; {censosParr.length ? `${censosParr.join(" y ")} solo tienen cifras por parroquia. ` : ""}Para ver la evolución desde 1950 usa la vista de parroquias.{" "}
                  <button type="button" className="pob-enlace" onClick={() => { setVista("parroquias"); setSelSec(""); }}>Ver por parroquias</button>
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
                  {tot.respaldo > 0 ? (porSectores ? `; cada sector se proyecta al ritmo de su parroquia, a partir de su cifra del último censo` : `; las ${tot.respaldo} parroquias urbanas solo tienen el censo ${anioMapa} y se proyectan al ritmo del área URBANA`) : ""}. Las proyecciones son cálculo propio, no oficiales.
                </p>
              )}

              {entSel && filaSel && !(sinSectores && selSec) && (
                <div className="pob-ficha">
                  <h3>
                    {porSectores && selSec ? `Sector ${entSel.id}` : entSel.nombre}{" "}
                    <small>· {porSectores && selSec ? `${filaSel.parroquia} · ` : ""}{filaSel.area} · {num(entSel.km2 * 100, 1)} ha</small>
                  </h3>
                  <p className="data-counter">
                    {anio} ({TIPO[filaSel.tipo]}): <strong>{num(filaSel.poblacion)}</strong> hab. · {num(filaSel.densidad, 2)} hab/ha · tasa {num(filaSel.tasa, 2)} % anual
                    {filaSel.fallback ? (entSel.grupo ? ` · crece al ritmo del área URBANA (solo tiene el censo ${anioMapa})` : " · crece al ritmo de su parroquia") : ""}
                    {entSel.grupo && anio < anioMapa ? ` · no hay datos por parroquia urbana antes de ${anioMapa} (el INEC solo da el total urbano); el mapa muestra toda el área URBANA` : ""}
                    {filaSel.discontinua && !filaSel.fallback ? " · serie discontinua (cambio de límites), se mantiene constante" : ""}
                  </p>
                  <Grafico serie={serie} anio={anio} onAnio={setAnio} km2={entSel.km2} />
                </div>
              )}
              {!entSel && serieGlobal && (
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
                          <td className="n">{num(f.ha, porSectores ? 2 : 0)}</td><td className="n">{num(f.densidad, 2)}</td><td className="n">{num(f.tasa, 2)}</td>
                          <td>{TIPO[f.tipo]}{f.fallback ? (porSectores ? " (tasa parroquial)" : " (tasa urbana)") : ""}{f.discontinua && !f.fallback ? " ⚠" : ""}</td>
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
                Fuente: INEC, Censos de Población {censosParr.join(" y ")} (por parroquia) y de Población y Vivienda {datos.censos.filter((a) => !censosParr.includes(a)).join(", ")} (sectores censales, unidos por cod_inec) · superficie = polígonos de los sectores censales · Mapas base: calles ©{" "}
                <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; satélite © Esri, Maxar, Earthstar Geographics; oscuro © Esri, HERE, Garmin, OpenStreetMap contributors
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Grafico({ serie, anio, onAnio, km2 }) {
  const W = 560, H = 210, P = { l: 52, r: 14, t: 12, b: 24 };
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
  const dens = dato?.valor != null && km2 > 0 ? dato.valor / (km2 * 100) : null; // hab/ha
  const aDerecha = hover != null && hover > (ANIO_MIN + ANIO_MAX) / 2;

  return (
    <div className="pob-grafico-wrap">
      <div className="pob-grafico__leyenda" aria-hidden="true">
        <span><i className="pob-grafico__marca pob-grafico__marca--real" />Censos e interpolación</span>
        <span><i className="pob-grafico__marca pob-grafico__marca--proy" />Proyección exponencial (tasa 2010–2022)</span>
      </div>
      <div className="pob-grafico__lienzo">
        <svg
          ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="pob-grafico" role="img"
          aria-label="Serie de población 1950–2050 con proyección exponencial; pasa el ratón para ver cada año"
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
          {ult > 0 && <rect x={x(ult)} y={P.t} width={W - P.r - x(ult)} height={H - P.t - P.b} className="pob-grafico__zona-proy" />}
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
                <span>Densidad: <b>{num(dens, 2)}</b> hab/ha</span>
                <span>Crecimiento: <b>{num(crec, 2)}</b> % anual</span>
              </>
            )}
          </div>
        )}
      </div>

      <input
        className="pob-rango pob-grafico__rango" type="range" min={ANIO_MIN} max={ANIO_MAX} value={anio}
        onChange={(e) => onAnio(+e.target.value)} aria-label="Año del mapa"
        style={{ marginLeft: `${(P.l / W) * 100}%`, width: `${((W - P.l - P.r) / W) * 100}%` }}
      />
      <p className="data-counter">Año del mapa: <strong>{anio}</strong>. Pasa el ratón por el gráfico para ver cada año; pulsa o arrastra, o usa el deslizador, para cambiar el año del mapa.</p>
    </div>
  );
}

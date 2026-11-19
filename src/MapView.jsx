import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer, TextLayer } from "@deck.gl/layers";

const VISTA = { center: [-79.002, -2.9], zoom: 11.2 };
// Mapas base: se cargan los tres y se muestra uno (visibility). Cada uno puede tener varias capas
// (`capas`: [tiles, maxzoom], p. ej. fondo + nombres). Sin claves de acceso: OpenStreetMap y Esri.
// `opacidad`: transparencia de las parroquias/sectores sobre ese fondo; `linea`: color de los límites.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const FONDOS = {
  calles: {
    nombre: "OpenStreetMap",
    capas: [["https://tile.openstreetmap.org/{z}/{x}/{y}.png", 19]],
    atribucion: "© OpenStreetMap contributors",
    enlace: "https://www.openstreetmap.org/copyright",
    opacidad: 0.5,
    linea: [35, 80, 27], // verde del tema (#23501B)
  },
  satelite: {
    nombre: "Esri Satélite",
    capas: [[`${ESRI}World_Imagery/MapServer/tile/{z}/{y}/{x}`, 19]],
    atribucion: "Imágenes © Esri, Maxar, Earthstar Geographics",
    enlace: "https://www.esri.com/",
    opacidad: 0.4,
    linea: [255, 255, 255],
  },
  oscuro: {
    nombre: "Esri Gris oscuro",
    capas: [
      [`${ESRI}Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, 16],
      [`${ESRI}Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, 16],
    ],
    atribucion: "Mapa base © Esri, HERE, Garmin, © OpenStreetMap contributors",
    enlace: "https://www.esri.com/",
    opacidad: 0.55,
    linea: [255, 255, 255],
  },
};
const CAPAS_FONDO = Object.entries(FONDOS).flatMap(([k, f]) => f.capas.map(([tiles, maxzoom], i) => ({ id: `${k}-${i}`, fondo: k, tiles, maxzoom })));
const ESTILO = {
  version: 8,
  sources: Object.fromEntries(CAPAS_FONDO.map((c) => [c.id, { type: "raster", tiles: [c.tiles], tileSize: 256, maxzoom: c.maxzoom }])),
  layers: CAPAS_FONDO.map((c) => ({ id: c.id, type: "raster", source: c.id, layout: { visibility: c.fondo === "calles" ? "visible" : "none" } })),
};
const AMARILLO = [255, 214, 0];

function bboxDe(features) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const rec = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    } else c.forEach(rec);
  };
  features.forEach((f) => rec(f.geometry.coordinates));
  return x0 > x1 ? null : [[x0, y0], [x1, y1]];
}

// Escala gráfica de 4 tramos: 0 · d/2 · d
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
function calcularEscala(map) {
  const mpp = (78271.517 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();
  const km = [...NICE].reverse().find((d) => (d * 1000) / mpp <= 110) ?? NICE[0];
  return { km, ancho: (km * 1000) / mpp };
}

/**
 * sectores: geojson de sectores (props: c = cod_inec 12 dígitos, p = cod_parr 6 dígitos,
 *           u = parroquia urbana U01…U15 en los sectores urbanos)
 * limites: aristas derivadas (props: a, b = parroquias que separa —las urbanas con su id U01…—;
 *          b === "" es el contorno cantonal)
 * vista: "parroquias" (todos los sectores de una parroquia con el mismo color) | "sectores"
 * grupoDe(id): parroquia con la que se dibuja `id` (antes de 2022 las urbanas se juntan en 010150)
 * enSel(id): si la parroquia `id` es la elegida o forma parte de ella (010150 incluye las urbanas)
 */
export default function MapView({
  sectores, limites, vista, colorDe, visible, etiquetas, nombres = [], filtroMapa = null, selParr, selSec, onElegir, textoTooltip,
  grupoDe = (id) => id, enSel = (id) => id === selParr,
}) {
  const cont = useRef(null);
  const mapa = useRef(null);
  const overlay = useRef(null);
  const cb = useRef({});
  cb.current = { onElegir, textoTooltip };
  const [zoom, setZoom] = useState(VISTA.zoom);
  const [rumbo, setRumbo] = useState(0);
  const [escala, setEscala] = useState({ km: 2, ancho: 60 });
  const [fondo, setFondo] = useState("calles");
  const [listo, setListo] = useState(false);
  const [menuCapas, setMenuCapas] = useState(false);
  const capasRef = useRef(null);
  const F = FONDOS[fondo];

  useEffect(() => {
    const map = new maplibregl.Map({ container: cont.current, style: ESTILO, ...VISTA, attributionControl: false });
    const ov = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }) =>
        object && {
          html: cb.current.textoTooltip(object.properties),
          // tarjeta blanca con texto negro y franja verde del tema a la izquierda
          style: {
            background: "#fff", color: "#121923", fontSize: "14px", lineHeight: "1.55", padding: "12px 16px",
            minWidth: "230px", border: "1px solid #dadada", borderLeft: "4px solid #23501b", borderRadius: "4px",
            boxShadow: "0 10px 30px rgb(18 25 35 / 22%)",
          },
        },
    });
    map.addControl(ov);
    const sync = () => {
      setZoom(map.getZoom());
      setRumbo(map.getBearing());
      setEscala(calcularEscala(map));
    };
    map.on("move", sync);
    map.on("load", () => setListo(true));
    map.on("load", sync);
    mapa.current = map;
    overlay.current = ov;
    return () => map.remove();
  }, []);

  // mapa base visible
  useEffect(() => {
    const map = mapa.current;
    if (!map || !listo) return;
    const aplicar = () => {
      for (const c of CAPAS_FONDO) if (map.getLayer(c.id)) map.setLayoutProperty(c.id, "visibility", c.fondo === fondo ? "visible" : "none");
    };
    // si el estilo aún se está cargando, se aplica en cuanto termine
    if (map.isStyleLoaded()) aplicar();
    else map.once("styledata", aplicar);
  }, [fondo, listo]);

  // el menú de capas se cierra al pulsar fuera o con Escape
  useEffect(() => {
    if (!menuCapas) return;
    const fuera = (e) => !capasRef.current?.contains(e.target) && setMenuCapas(false);
    const tecla = (e) => e.key === "Escape" && setMenuCapas(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuCapas]);

  const feats = sectores?.features;
  const lineas = useMemo(() => {
    const f = limites?.features ?? [];
    return {
      contorno: f.filter((x) => x.properties.b === ""),
      // en la vista de parroquias, sin límites entre parroquias urbanas mientras se dibujan juntas
      // con una parroquia elegida no se dibujan los límites de las demás (solo su borde, en amarillo)
      internas: selParr ? [] : f.filter((x) => x.properties.b !== "" && (vista === "sectores" || grupoDe(x.properties.a) !== grupoDe(x.properties.b))),
    };
  }, [limites, vista, grupoDe, selParr]);
  // polígonos que se dibujan: con una parroquia elegida, solo los suyos (las demás ni se ven ni se pueden pulsar)
  const datosMapa = useMemo(
    () => (filtroMapa && sectores ? { ...sectores, features: sectores.features.filter((f) => filtroMapa(f.properties)) } : sectores),
    [sectores, filtroMapa],
  );
  // borde de lo elegido: aristas que tienen lo elegido a un solo lado (contorno cantonal: b === "")
  const resaltadas = useMemo(
    () => (selParr ? (limites?.features ?? []).filter((x) => enSel(x.properties.a) !== (x.properties.b !== "" && enSel(x.properties.b))) : []),
    [limites, selParr, enSel],
  );
  const sectorElegido = useMemo(() => (selSec && feats ? feats.filter((f) => f.properties.c === selSec) : []), [feats, selSec]);

  // Zoom a lo elegido
  useEffect(() => {
    if (!selParr || !feats || !mapa.current) return;
    const b = bboxDe(feats.filter((f) => enSel(f.properties.u || f.properties.p)));
    if (b) mapa.current.fitBounds(b, { padding: 80, maxZoom: 13.5, duration: 700 });
  }, [selParr, feats]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sectorElegido.length || !mapa.current) return;
    const b = bboxDe(sectorElegido);
    if (b) mapa.current.fitBounds(b, { padding: 100, maxZoom: 16, duration: 700 });
  }, [sectorElegido]);

  useEffect(() => {
    if (!overlay.current || !feats) return;
    const px = 1.4222222222222223 * 2 ** zoom;
    const porSectores = vista === "sectores";
    // el nombre se muestra si cabe en la parroquia (≈ 6,5 px por letra a 12 px)
    const cabeNombre = (d) => d.ancho * px >= Math.max(50, d.text.length * 6.5);
    // en la vista de parroquias, nombre y cifra van en el mismo punto: nombre arriba, cifra abajo
    const conNombre = new Set(porSectores ? [] : nombres.filter(cabeNombre).map((d) => d.position.join()));
    overlay.current.setProps({
      layers: [
        new GeoJsonLayer({
          id: "sectores",
          data: datosMapa,
          pickable: true,
          autoHighlight: porSectores,
          highlightColor: [...AMARILLO, 110],
          opacity: F.opacidad,
          stroked: porSectores,
          filled: true,
          lineWidthUnits: "pixels",
          getLineWidth: 0.6,
          getLineColor: [255, 255, 255, 220],
          getFillColor: (f) => colorDe(f.properties),
          updateTriggers: { getFillColor: [colorDe] },
          onClick: ({ object }) => object && cb.current.onElegir(object.properties),
        }),
        new GeoJsonLayer({
          id: "limites-parroquias",
          data: lineas.internas,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: porSectores ? 1.6 : 1.2,
          getLineColor: [...F.linea, porSectores ? 200 : 150],
          updateTriggers: { getLineColor: [fondo] },
        }),
        new GeoJsonLayer({
          id: "parroquia-elegida",
          data: resaltadas,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 3,
          getLineColor: [...AMARILLO, 255],
        }),
        new GeoJsonLayer({
          id: "sector-elegido",
          data: sectorElegido,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 3,
          getLineColor: [...AMARILLO, 255],
        }),
        new GeoJsonLayer({
          id: "limite",
          data: lineas.contorno,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          getLineColor: [...F.linea, 255],
          updateTriggers: { getLineColor: [fondo] },
        }),
        new TextLayer({
          id: "cifras",
          data: etiquetas.filter((e) => e.ancho * px >= 40),
          pickable: false,
          sizeUnits: "pixels",
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: 12,
          getColor: (d) => [...d.color, 255],
          getPixelOffset: (d) => (conNombre.has(d.position.join()) ? [0, 8] : [0, 0]),
          updateTriggers: { getPixelOffset: [zoom, vista, nombres] },
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontFamily: "Arial, sans-serif",
          fontWeight: 700,
          characterSet: "auto",
        }),
        new TextLayer({
          id: "nombres",
          data: nombres.filter(cabeNombre),
          pickable: false,
          sizeUnits: "pixels",
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: porSectores ? 13 : 12,
          getColor: [255, 255, 255, 255],
          getPixelOffset: porSectores ? [0, 0] : [0, -8],
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontFamily: "Arial, sans-serif",
          fontWeight: 700,
          characterSet: "auto",
          // color fijo: texto blanco con contorno verde oscuro del tema; se lee sobre cualquier
          // tono del mapa y sobre los tres mapas base
          fontSettings: { sdf: true, fontSize: 64, buffer: 8 },
          outlineWidth: 5,
          outlineColor: [20, 47, 16, 255],
        }),
      ],
    });
  }, [sectores, datosMapa, feats, lineas, resaltadas, sectorElegido, vista, colorDe, visible, etiquetas, nombres, zoom, fondo]); // eslint-disable-line react-hooks/exhaustive-deps

  const inicio = () => mapa.current?.easeTo({ ...VISTA, bearing: 0, pitch: 0 });
  const paso = escala.ancho / 4;
  const sub = escala.km < 1;
  const rotulos = [0, escala.km / 2, escala.km].map((v) => (sub ? Math.round(v * 1000) : v));

  return (
    <div className="map-canvas">
      <div ref={cont} style={{ position: "absolute", inset: 0 }} />

      <div className="pob-capas" ref={capasRef}>
        <button
          type="button" className="pob-capas__boton" aria-label="Mapa base" title="Mapa base"
          aria-haspopup="menu" aria-expanded={menuCapas} onClick={() => setMenuCapas((v) => !v)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 8 12 13l9.5-5L12 3Z" /><path d="m2.5 12 9.5 5 9.5-5" /><path d="m2.5 16 9.5 5 9.5-5" /></svg>
        </button>
        {menuCapas && (
          <ul className="pob-capas__menu" role="menu" aria-label="Mapa base">
            {Object.entries(FONDOS).map(([k, f]) => (
              <li key={k} role="none">
                <button
                  type="button" role="menuitemradio" aria-checked={fondo === k}
                  onClick={() => { setFondo(k); setMenuCapas(false); }}
                >{f.nombre}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pob-atribucion">
        <a href={F.enlace} target="_blank" rel="noreferrer">{F.atribucion}</a>
      </div>

      <div className="map-navigation" role="group" aria-label="Controles de navegación del mapa">
        <button type="button" className="map-navigation__button map-navigation__button--zoom-in" aria-label="Acercar mapa" title="Acercar" onClick={() => mapa.current?.zoomIn()} />
        <button type="button" className="map-navigation__button map-navigation__button--zoom-out" aria-label="Alejar mapa" title="Alejar" onClick={() => mapa.current?.zoomOut()} />
        <button type="button" className="map-navigation__button map-navigation__button--home" aria-label="Volver a la vista inicial de Cuenca" title="Vista inicial" onClick={inicio}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 9.5V20h12V9.5" /></svg>
        </button>
      </div>

      <div className="map-north" role="img" aria-label="Norte">
        <svg viewBox="0 0 24 34" aria-hidden="true">
          <g transform={`rotate(${-rumbo} 12 17)`}>
            <text x="12" y="10" textAnchor="middle">N</text>
            <path className="map-north__left" d="M12 13 L5 32 L12 27 Z" />
            <path className="map-north__right" d="M12 13 L19 32 L12 27 Z" />
          </g>
        </svg>
      </div>

      <div className="map-scale" role="img" aria-label={`Escala gráfica: ${sub ? escala.km * 1000 : escala.km} ${sub ? "m" : "km"}`}>
        <svg width={escala.ancho + 36} height="21" viewBox={`0 0 ${escala.ancho + 36} 21`} aria-hidden="true">
          <g transform="translate(8 0)">
            {rotulos.map((r, i) => (
              <text key={i} x={(escala.ancho / 2) * i} y="10" textAnchor="middle">{r}</text>
            ))}
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} className={i % 2 === 0 ? "map-scale__fill" : "map-scale__blank"} x={paso * i} y="15.5" width={paso} height="5" />
            ))}
            <rect className="map-scale__frame" x="0" y="15.5" width={escala.ancho} height="5" />
            <text x={escala.ancho + 5} y="18" dominantBaseline="middle">{sub ? "m" : "km"}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer, TextLayer } from "@deck.gl/layers";

const VISTA = { center: [-79.002, -2.9], zoom: 11.2 };
const OSM = "© OpenStreetMap contributors";
const ESTILO = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: OSM, maxzoom: 19 } },
  layers: [{ id: "osm", type: "raster", source: "osm", minzoom: 0 }],
};
const OPACIDAD = 0.85;
const AMARILLO = [255, 214, 0];
const NAVY = [0, 40, 86];

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
 * sectores: geojson de sectores (props: c = cod_inec 12 dígitos, p = cod_parr 6 dígitos)
 * limites: aristas derivadas (props: a, b = parroquias que separa; b === "" es el contorno cantonal)
 * vista: "parroquias" (todos los sectores de una parroquia con el mismo color) | "sectores"
 * urbanas: contorno de las parroquias urbanas (props: u = U01…); se dibuja solo en la vista de sectores.
 *          Los sectores urbanos llevan su parroquia urbana en props.u.
 */
export default function MapView({
  sectores, limites, vista, colorDe, visible, etiquetas, selParr, selSec, onElegir, textoTooltip, urbanas,
}) {
  const cont = useRef(null);
  const mapa = useRef(null);
  const overlay = useRef(null);
  const cb = useRef({});
  cb.current = { onElegir, textoTooltip };
  const [zoom, setZoom] = useState(VISTA.zoom);
  const [rumbo, setRumbo] = useState(0);
  const [escala, setEscala] = useState({ km: 2, ancho: 60 });

  useEffect(() => {
    const map = new maplibregl.Map({ container: cont.current, style: ESTILO, ...VISTA, attributionControl: false });
    const ov = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }) =>
        object && {
          html: cb.current.textoTooltip(object.properties),
          style: { background: "#002856", color: "#fff", fontSize: "12px", lineHeight: "1.4", padding: "8px 10px", borderRadius: "0", boxShadow: "0 10px 30px rgb(0 40 86 / 25%)" },
        },
    });
    map.addControl(ov);
    const sync = () => {
      setZoom(map.getZoom());
      setRumbo(map.getBearing());
      setEscala(calcularEscala(map));
    };
    map.on("move", sync);
    map.on("load", sync);
    mapa.current = map;
    overlay.current = ov;
    return () => map.remove();
  }, []);

  const feats = sectores?.features;
  const lineas = useMemo(() => {
    const f = limites?.features ?? [];
    return {
      contorno: f.filter((x) => x.properties.b === ""),
      internas: f.filter((x) => x.properties.b !== ""),
    };
  }, [limites]);
  const resaltadas = useMemo(
    () => (selParr ? (limites?.features ?? []).filter((x) => x.properties.a === selParr || x.properties.b === selParr) : []),
    [limites, selParr],
  );
  const urbanaElegida = useMemo(() => (urbanas?.features ?? []).filter((x) => x.properties.u === selParr), [urbanas, selParr]);
  const sectorElegido = useMemo(() => (selSec && feats ? feats.filter((f) => f.properties.c === selSec) : []), [feats, selSec]);

  // Zoom a lo elegido
  useEffect(() => {
    if (!selParr || !feats || !mapa.current) return;
    const b = bboxDe(feats.filter((f) => f.properties.p === selParr || f.properties.u === selParr));
    if (b) mapa.current.fitBounds(b, { padding: 80, maxZoom: 13.5, duration: 700 });
  }, [selParr, feats]);
  useEffect(() => {
    if (!sectorElegido.length || !mapa.current) return;
    const b = bboxDe(sectorElegido);
    if (b) mapa.current.fitBounds(b, { padding: 100, maxZoom: 16, duration: 700 });
  }, [sectorElegido]);

  useEffect(() => {
    if (!overlay.current || !feats) return;
    const px = 1.4222222222222223 * 2 ** zoom;
    const porSectores = vista === "sectores";
    overlay.current.setProps({
      layers: [
        new GeoJsonLayer({
          id: "sectores",
          data: sectores,
          pickable: true,
          autoHighlight: porSectores,
          highlightColor: [...AMARILLO, 110],
          opacity: OPACIDAD,
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
          getLineColor: [...NAVY, porSectores ? 200 : 150],
        }),
        new GeoJsonLayer({
          id: "limites-urbanas",
          data: porSectores ? urbanas?.features ?? [] : [],
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 1.2,
          getLineColor: [...NAVY, 170],
        }),
        new GeoJsonLayer({
          id: "urbana-elegida",
          data: porSectores ? urbanaElegida : [],
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthUnits: "pixels",
          getLineWidth: 3,
          getLineColor: [...AMARILLO, 255],
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
          getLineColor: [...NAVY, 255],
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
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontFamily: "Arial, sans-serif",
          fontWeight: 700,
          characterSet: "auto",
        }),
      ],
    });
  }, [sectores, feats, lineas, resaltadas, sectorElegido, urbanas, urbanaElegida, vista, colorDe, visible, etiquetas, zoom]);

  const inicio = () => mapa.current?.easeTo({ ...VISTA, bearing: 0, pitch: 0 });
  const paso = escala.ancho / 4;
  const sub = escala.km < 1;
  const rotulos = [0, escala.km / 2, escala.km].map((v) => (sub ? Math.round(v * 1000) : v));

  return (
    <div className="map-canvas">
      <div ref={cont} style={{ position: "absolute", inset: 0 }} />

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

"""Une CENSOS_FINAL.xlsx con censo_sectores.geojson por `cod_inec` y genera
los archivos que lee el visor en public/data/:

  cod_inec de 12 dígitos = sector censal (1990, 2001, 2010, 2022)
  cod_inec de  6 dígitos = solo parroquia, sin zona ni sector (censos antiguos: 1950, 1982)


  poblacion.json          parroquias (6 dígitos) y sectores (12 dígitos) con su serie censal
  sectores-cuenca.geojson sectores del cantón Cuenca (copia para web: misma geometría,
                          coordenadas a 5 decimales ≈ 1 m, solo el cantón 0101)
  limites.geojson         límites parroquiales y contorno cantonal, derivados de las aristas
                          de los propios sectores
  urbanas.geojson         contorno de las 15 parroquias urbanas (de raw/parraquias_urbanas.geojson)

Parroquias urbanas: el INEC las agrupa todas en 010150. Cada sector urbano se etiqueta con la
parroquia urbana donde cae su punto interior (campo `pu` del sector). Solo sirve para nombrar y
filtrar sectores; las cifras por parroquia no cambian (el área urbana sigue siendo 010150).

Uso:
    pip install pandas openpyxl numpy      (una vez)
    python scripts/build_data.py [ruta/censo_sectores.geojson] [ruta/parroquias_urbanas.geojson]

Los geojson originales NO se modifican. Por defecto se buscan en raw/.
"""
import collections
import json
import math
import pathlib
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "raw" / "CENSOS_FINAL.xlsx"
GEO = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "raw" / "censo_sectores.geojson"
GEO_URB = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "raw" / "parraquias_urbanas.geojson"
OUT = ROOT / "public" / "data"
CANTON = "0101"
URBANA = "010150"  # INEC agrupa todas las parroquias urbanas de Cuenca en 010150
DEC = 5
# nombre para mostrar (la capa los trae en mayúsculas, sin tildes y alguno abreviado)
NOMBRE_URB = {
    "BELLAVISTA": "Bellavista", "CAÑARIBAMBA": "Cañaribamba", "EL BATAN": "El Batán",
    "EL SAGRARIO": "El Sagrario", "EL VECINO": "El Vecino", "GIL RAMIREZ D.": "Gil Ramírez Dávalos",
    "HERMANO MIGUEL": "Hermano Miguel", "HUAYNA CAPAC": "Huayna Cápac", "MACHANGARA": "Machángara",
    "MONAY": "Monay", "SAN BLAS": "San Blas", "SAN SEBASTIAN": "San Sebastián", "SUCRE": "Sucre",
    "TOTORACOCHA": "Totoracocha", "YANUNCAY": "Yanuncay",
}


# ───────────────────────── utilidades ─────────────────────────
def titulo(s):
    t = s.title()
    for a, b in (("Del", "del"), ("De", "de"), ("La", "la")):
        t = t.replace(f" {a} ", f" {b} ")
    return t


def anillos(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return polys


def redondea(ring):
    out = []
    for x, y in ring:
        p = (round(x, DEC), round(y, DEC))
        if not out or p != out[-1]:
            out.append(p)
    if out and out[0] != out[-1]:
        out.append(out[0])
    return out


def polo(ext):
    """Punto interior más alejado del borde (polo de inaccesibilidad aproximado)."""
    xy = np.array(ext, dtype=float)
    if len(xy) > 400:
        xy = xy[np.linspace(0, len(xy) - 1, 400).astype(int)]
        xy[-1] = xy[0]
    k = math.cos(math.radians(xy[:, 1].mean()))
    xy = xy * [k, 1.0]
    a, b = xy[:-1], xy[1:]
    ab = b - a
    L2 = (ab ** 2).sum(1) + 1e-18

    def evalua(P):
        d = np.full(len(P), np.inf)
        dentro = np.zeros(len(P), bool)
        for i in range(len(a)):
            t = np.clip(((P - a[i]) @ ab[i]) / L2[i], 0, 1)
            d = np.minimum(d, np.linalg.norm(P - (a[i] + t[:, None] * ab[i]), axis=1))
            dy = b[i, 1] - a[i, 1]
            cruza = ((a[i, 1] > P[:, 1]) != (b[i, 1] > P[:, 1])) & (
                P[:, 0] < (b[i, 0] - a[i, 0]) * (P[:, 1] - a[i, 1]) / (dy if dy else 1e-18) + a[i, 0])
            dentro ^= cruza
        return np.where(dentro, d, -d)

    x0, y0 = xy.min(0)
    x1, y1 = xy.max(0)
    mejor, paso = None, None
    for n in (16, 10):
        if mejor is None:
            gx, gy = np.meshgrid(np.linspace(x0, x1, n), np.linspace(y0, y1, n))
            paso = ((x1 - x0) / n, (y1 - y0) / n)
        else:
            gx, gy = np.meshgrid(np.linspace(mejor[0] - paso[0], mejor[0] + paso[0], n),
                                 np.linspace(mejor[1] - paso[1], mejor[1] + paso[1], n))
        P = np.c_[gx.ravel(), gy.ravel()]
        mejor = P[evalua(P).argmax()]
    return [round(float(mejor[0] / k), DEC), round(float(mejor[1]), DEC)]


def dentro(pt, polys):
    """Punto dentro de un (Multi)Polygon (regla par-impar sobre todos los anillos, respeta huecos)."""
    x, y, c = pt[0], pt[1], False
    for poly in polys:
        for ring in poly:
            for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
                if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
                    c = not c
    return c


def cadenas(aristas):
    """Une aristas (a,b) en polilíneas, cortando en los cruces."""
    adj = collections.defaultdict(list)
    for i, (a, b) in enumerate(aristas):
        adj[a].append(i)
        adj[b].append(i)
    usado = [False] * len(aristas)
    lineas = []
    for i, (a, b) in enumerate(aristas):
        if usado[i]:
            continue
        usado[i] = True
        linea = [a, b]
        for fin in (0, 1):
            while True:
                nodo = linea[-1] if fin == 0 else linea[0]
                if len(adj[nodo]) != 2:
                    break
                j = next((j for j in adj[nodo] if not usado[j]), None)
                if j is None:
                    break
                usado[j] = True
                p, q = aristas[j]
                nuevo = q if p == nodo else p
                if fin == 0:
                    linea.append(nuevo)
                else:
                    linea.insert(0, nuevo)
        lineas.append([list(p) for p in linea])
    return lineas


# ───────────────────────── 1. Excel ─────────────────────────
x = pd.read_excel(XLSX, dtype={"cod_inec": str}).rename(
    columns={"AÑO": "anio", "POBLACION_TOTAL": "t", "POBLACION_HOMBRE": "h", "POBLACION_MUJER": "m"})
x["cod_inec"] = x["cod_inec"].str.strip()
assert x.cod_inec.str.len().isin([6, 12]).all(), "cod_inec debe tener 6 (parroquia) o 12 (sector) dígitos"
assert x.cod_inec.str.fullmatch(r"\d+").all(), "cod_inec con caracteres no numéricos"
assert not x.duplicated(["cod_inec", "anio"]).any(), "cod_inec repetido en un mismo año"
if {"I01", "I02", "I03"} <= set(x.columns):  # el código debe coincidir con sus partes I01..I05
    parte = lambda c, n: x[c].map(lambda v: "" if pd.isna(v) else f"{int(v):0{n}d}")
    rearmado = parte("I01", 2) + parte("I02", 2) + parte("I03", 2) + parte("I04", 3) + parte("I05", 3)
    assert (rearmado == x.cod_inec).all(), f"cod_inec no coincide con I01..I05: {x.cod_inec[rearmado != x.cod_inec].tolist()[:5]}"
mal = x[x.h + x.m != x.t]
assert mal.empty, f"hombres + mujeres no cuadra con el total:\n{mal}"
x = x[x.cod_inec.str[:4] == CANTON]
x["parr"] = x.cod_inec.str[:6]
x["nivel"] = np.where(x.cod_inec.str.len() == 12, "sector", "parroquia")
for a, g in x.groupby("anio"):
    assert g.nivel.nunique() == 1, f"{a}: mezcla filas de parroquia y de sector en el mismo censo"
censos = sorted(int(a) for a in x.anio.unique())
censos_parr = sorted(int(a) for a in x.anio[x.nivel == "parroquia"].unique())  # sin zona ni sector

# ───────────────────────── 2. Geometría ─────────────────────────
geo = json.loads(GEO.read_text(encoding="utf-8"))
feats = [f for f in geo["features"] if f["properties"]["cod_canton"] == CANTON]
print(f"geojson: {len(geo['features'])} sectores en total, {len(feats)} del cantón {CANTON}")

sectores, web, aristas = {}, [], collections.defaultdict(list)
nombres, km2_parr, bbox_parr = {}, collections.defaultdict(float), {}
for f in feats:
    p = f["properties"]
    cod, parr = p["cod_inec"], p["cod_parr"]
    nombres[parr] = titulo(p["parroquia"])
    polys = [[redondea(r) for r in poly] for poly in anillos(f["geometry"])]
    polys = [[r for r in poly if len(r) >= 4] for poly in polys]
    polys = [poly for poly in polys if poly]
    if not polys:
        continue
    web.append({"type": "Feature", "properties": {"c": cod, "p": parr},
                "geometry": {"type": "MultiPolygon", "coordinates": [[[list(q) for q in r] for r in poly] for poly in polys]}})
    for poly in polys:
        for r in poly:
            for a, b in zip(r, r[1:]):
                aristas[(a, b) if a < b else (b, a)].append(parr)
    mayor = max(polys, key=lambda poly: abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly[0], poly[0][1:]))))
    xs = [q[0] for poly in polys for q in poly[0]]
    ys = [q[1] for poly in polys for q in poly[0]]
    km2 = float(p["area_ha"]) / 100.0
    km2_parr[parr] += km2
    bb = bbox_parr.setdefault(parr, [180, 90, -180, -90])
    bb[:] = [min(bb[0], min(xs)), min(bb[1], min(ys)), max(bb[2], max(xs)), max(bb[3], max(ys))]
    sectores[cod] = {"id": cod, "parr": parr, "km2": round(km2, 4), "l": polo(mayor[0]),
                     "w": round(max(xs) - min(xs), DEC), "censos": {}}
print(f"sectores con geometría: {len(sectores)}")

# ───────────────────────── 2b. Parroquia urbana de cada sector urbano ─────────────────────────
urbanas, urb_web = [], []
if GEO_URB.exists():
    capa = json.loads(GEO_URB.read_text(encoding="utf-8"))["features"]
    nombres_urb = sorted(((NOMBRE_URB.get(f["properties"]["parroquia"].strip(), titulo(f["properties"]["parroquia"].strip())), f)
                         for f in capa), key=lambda t: t[0])
    for i, (nom, f) in enumerate(nombres_urb, 1):
        uid = f"U{i:02d}"
        polys = [[redondea(r) for r in poly] for poly in anillos(f["geometry"])]
        urbanas.append({"id": uid, "nombre": nom, "polys": polys})
        urb_web.append({"type": "Feature", "properties": {"u": uid},
                        "geometry": {"type": "MultiLineString", "coordinates": [[list(q) for q in r] for poly in polys for r in poly]}})
    sin_urb = []
    for s in sectores.values():
        if s["parr"] != URBANA:
            continue
        hay = [u["id"] for u in urbanas if dentro(s["l"], u["polys"])]
        if len(hay) == 1:
            s["pu"] = hay[0]
        else:
            sin_urb.append(s["id"])
    cuenta = collections.Counter(s.get("pu") for s in sectores.values() if s["parr"] == URBANA)
    print(f"parroquias urbanas: {len(urbanas)} · sectores urbanos con parroquia: {sum(v for k, v in cuenta.items() if k)}"
          f" · sin parroquia (fuera o en dos): {len(sin_urb)} {sin_urb[:5]}")
else:
    print(f"AVISO no se encontró {GEO_URB}: los sectores urbanos quedan sin nombre de parroquia")

# ───────────────────────── 3. Unir por cod_inec ─────────────────────────
parroquias = {}
sin_geo = collections.Counter()
for r in x.itertuples(index=False):
    d = {"t": int(r.t), "h": int(r.h), "m": int(r.m)}
    if r.nivel == "parroquia":
        if r.parr not in nombres:
            sys.exit(f"{r.anio}: la parroquia {r.parr} no existe en el geojson")
    elif r.cod_inec in sectores:
        sectores[r.cod_inec]["censos"][int(r.anio)] = d
    else:
        sin_geo[int(r.anio)] += d["t"]
    pa = parroquias.setdefault(r.parr, {"id": r.parr, "censos": {}})
    c = pa["censos"].setdefault(int(r.anio), {"t": 0, "h": 0, "m": 0})
    for k in ("t", "h", "m"):
        c[k] += d[k]

sin_datos = [c for c, s in sectores.items() if not s["censos"]]
print("población de sectores del Excel sin polígono (cuenta en la parroquia, no en el mapa):", dict(sin_geo))
print("sectores con polígono pero sin ningún dato en el Excel:", len(sin_datos))
for c in sin_datos:
    del sectores[c]

# posición de la cifra de cada parroquia: el polo de sector más cercano al centroide ponderado
pol = collections.defaultdict(list)
for s in sectores.values():
    pol[s["parr"]].append(s)
out_parr = []
for pid, pa in sorted(parroquias.items()):
    ss = pol[pid]
    w = np.array([max(s["km2"], 1e-6) for s in ss])
    P = np.array([s["l"] for s in ss])
    cen = (P * w[:, None]).sum(0) / w.sum()
    lab = P[np.linalg.norm(P - cen, axis=1).argmin()]
    bb = bbox_parr[pid]
    out_parr.append({"id": pid, "nombre": "Cuenca (URBANA)" if pid == URBANA else nombres[pid],
                     "area": "URBANA" if pid == URBANA else "RURAL",
                     "km2": round(km2_parr[pid], 3), "l": [float(lab[0]), float(lab[1])],
                     "w": round(bb[2] - bb[0], DEC), "censos": pa["censos"]})

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "poblacion.json").write_text(json.dumps(
    {"censos": censos, "censosParroquia": censos_parr, "parroquias": out_parr, "urbanas": [{"id": u["id"], "nombre": u["nombre"]} for u in urbanas],
     "sectores": sorted(sectores.values(), key=lambda s: s["id"])},
    ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
web = [f for f in web if f["properties"]["c"] in sectores]
for f in web:  # parroquia urbana del sector (para filtrar y hacer zoom en el mapa)
    if "pu" in sectores[f["properties"]["c"]]:
        f["properties"]["u"] = sectores[f["properties"]["c"]]["pu"]
(OUT / "urbanas.geojson").write_text(
    json.dumps({"type": "FeatureCollection", "features": urb_web}, separators=(",", ":")), encoding="utf-8")
(OUT / "sectores-cuenca.geojson").write_text(
    json.dumps({"type": "FeatureCollection", "features": web}, separators=(",", ":")), encoding="utf-8")

# ───────────────────────── 4. Límites desde las aristas ─────────────────────────
grupos = collections.defaultdict(list)
for arista, ps in aristas.items():
    u = sorted(set(ps))
    if len(ps) == 1:
        grupos[(u[0], "")].append(arista)       # borde exterior (contorno cantonal)
    elif len(u) > 1:
        grupos[(u[0], u[1])].append(arista)     # frontera entre dos parroquias
lim = []
for (a, b), ar in sorted(grupos.items()):
    lim.append({"type": "Feature", "properties": {"a": a, "b": b},
                "geometry": {"type": "MultiLineString", "coordinates": cadenas(ar)}})
(OUT / "limites.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": lim}, separators=(",", ":")), encoding="utf-8")

# ───────────────────────── 5. Resumen ─────────────────────────
print("\nCensos:", censos, "· solo por parroquia (sin zona ni sector):", censos_parr)
for a in censos:
    con = [p for p in out_parr if a in p["censos"]]
    tot = sum(p["censos"][a]["t"] for p in con)
    h = sum(p["censos"][a]["h"] for p in con)
    print(f"  {a}: población {tot:,} · hombres {h / tot:.1%} · {len(con)} parroquias".replace(",", " "))
print(f"parroquias: {len(out_parr)} · sectores en el visor: {len(sectores)} · superficie con polígono: {sum(p['km2'] for p in out_parr):.1f} km²")
for f in ("poblacion.json", "sectores-cuenca.geojson", "limites.geojson", "urbanas.geojson"):
    print(f"  {f}: {(OUT / f).stat().st_size / 1e6:.2f} MB")

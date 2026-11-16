# Población de Cuenca por parroquia y sector censal (1950–2050)

Mismo stack y diseño que los mapas MOVIDATA : React 19 + MapLibre GL + deck.gl + Vite, hoja de estilos `src/movidata.css`, mapa base OpenStreetMap.

## Uso
```bash
npm install
npm run dev        # desarrollo
npm run build      # genera dist/ (base "./", se puede subir a cualquier carpeta)
```

## Datos (se unen por `cod_inec`)
Fuentes únicas:
- `raw/CENSOS_FINAL.xlsx`: población total, hombres y mujeres por sector censal (12 dígitos) en 1990, 2001, 2010 y 2022, y por parroquia (6 dígitos, sin zona ni sector) en 1950 y 1982.
- `censo_sectores.geojson`: polígonos de los sectores (no se modifica). Cópialo a `raw/` (pesa 61 MB, no va en el zip).
- `raw/parraquias_urbanas.geojson`: límites de las 15 parroquias urbanas (campo `parroquia`). Opcional: sirve para poner nombre a los sectores urbanos.

| Censo | Nivel | `cod_inec` | Población del cantón |
|---|---|---|---|
| 1950 | parroquia (sin zona ni sector) | 6 dígitos | 122 434 |
| 1982 | parroquia (sin zona ni sector) | 6 dígitos | 275 070 |
| 1990 | sector censal | 12 dígitos | 331 028 |
| 2001 | sector censal | 12 dígitos | 417 632 |
| 2010 | sector censal | 12 dígitos | 505 585 |
| 2022 | sector censal | 12 dígitos | 596 101 |

Para regenerar lo que lee el visor:
```bash
pip install pandas openpyxl numpy      # una vez
python scripts/build_data.py           # usa raw/censo_sectores.geojson
python scripts/build_data.py ruta/al/censo_sectores.geojson   # o indica la ruta
python scripts/build_data.py ruta/sectores.geojson ruta/parroquias_urbanas.geojson   # y la capa urbana
```
El script se detiene con error si `cod_inec` no tiene 6 ni 12 dígitos o no coincide con `I01`–`I05`, si un código se repite en un año, si un censo mezcla filas de parroquia y de sector, si hombres + mujeres no es igual al total, o si una parroquia de 6 dígitos no existe en el geojson.

Genera en `public/data/`: `poblacion.json` (incluye `censosParroquia`: los años que solo tienen cifras por parroquia), `sectores-cuenca.geojson` (solo el cantón 0101, coordenadas a 5 decimales ≈ 1 m, 25 MB / 4,6 MB comprimido), `limites.geojson` (límites parroquiales y contorno cantonal sacados de las aristas de los propios sectores) y `urbanas.geojson` (contorno de las parroquias urbanas, solo para dibujarlo en la vista de sectores).

Estructura del código INEC: `01 01 50 001 001` = provincia, cantón, parroquia (`50` = área URBANA, `51`–`71` = parroquias rurales), zona, sector. La parroquia es `cod_inec[:6]`. En 1950 y 1982 el código solo tiene las tres primeras partes (`010150`, `010151`…).

## Qué calcula (`src/lib/demografia.js`)
- Rango de años: 1950–2050.
- **Año censal**: dato oficial. **Entre censos**: interpolación. **Después del último censo**: proyección.
- Métodos: exponencial, geométrico, lineal; período base: últimos dos censos o serie completa (para parroquias, desde 1950).
- **Densidad** = población / km² (km² = `area_ha` del geojson). **Tasa** = crecimiento anual % del tramo.
- Vista **Parroquias**: 1950 y 1982 con la cifra directa de la parroquia; desde 1990, suma de sus sectores.
- Vista **Sectores censales**: serie propia de cada sector desde 1990 (antes no hay dato por sector y el visor lo avisa). Cada sector urbano muestra su parroquia urbana (Yanuncay, Huayna Cápac…), y en el filtro «Parroquia» se puede elegir una para ver solo los sectores que caen dentro de su límite. Un sector sin serie comparable (un solo censo, o tasa que supera ±15 % anual) crece como su parroquia. Un sector que no figura en el censo más reciente no se proyecta.

## Limitaciones de los datos
- **Parroquias urbanas**: el código INEC agrupa las 15 parroquias urbanas en una sola (`010150`, «Cuenca (URBANA)»). En la vista de parroquias se muestran juntas. Con `raw/parraquias_urbanas.geojson`, cada sector urbano se etiqueta con la parroquia donde cae su punto interior (campo `pu` del sector en `poblacion.json`); eso solo nombra y filtra sectores, no da cifras ni proyección de la parroquia urbana.
- **1950 y 1982 solo por parroquia**: no tienen zona ni sector. Se asume que cada parroquia de esos censos es la parroquia actual del mismo código; los cambios de límites o las parroquias creadas después pueden afectar la comparación.
- **Los sectores cambian entre censos**: solo 648 existen en los cuatro censos por sector. Antes de 2022, entre 10 % y 14 % de la población está en sectores sin polígono actual y la densidad por sector usa el polígono de 2022.
- **Superficie**: los polígonos de sectores suman 3 195 km², menos que el territorio cantonal; la densidad de parroquias grandes (p. ej. Molleturo) puede estar sobreestimada. En todos los años se usa la superficie actual.

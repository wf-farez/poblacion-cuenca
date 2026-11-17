# Población de Cuenca por parroquia y sector censal (1950–2050)

React 19 + MapLibre GL + deck.gl + Vite, mapa base OpenStreetMap.

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
- `raw/parraquias_urbanas.geojson`: límites de las 15 parroquias urbanas (campo `parroquia`). Sirve para asignar cada sector urbano de 2022 a su parroquia urbana.

| Censo | Nivel | `cod_inec` | Población del cantón |
|---|---|---|---|
| 1950 | parroquia (sin zona ni sector) | 6 dígitos | 122 434 |
| 1982 | parroquia (sin zona ni sector) | 6 dígitos | 275 070 |
| 1990 | sector censal | 12 dígitos | 331 028 |
| 2001 | sector censal | 12 dígitos | 417 632 |
| 2010 | sector censal | 12 dígitos | 505 585 |
| 2022 | sector censal | 12 dígitos | 596 101 |

### Enlaces de descarga de los datos
- INEC – Bases de datos de los Censos de Población y Vivienda: https://www.ecuadorencifras.gob.ec/base-de-datos-censo-de-poblacion-y-vivienda/
- INEC – Libros históricos de los censos de población y vivienda (resultados nacionales): https://www.ecuadorencifras.gob.ec/institucional/libros-historicos-censos-de-poblacion-y-vivienda-del-ecuador-resultados-nacionales/
- GAD Municipal de Cuenca, Cuenca en Datos – Población, censo 2022: https://cuencaendatos.cuenca.gob.ec/dataset/poblacion-censo-2022
- Censo de Población y Vivienda del Ecuador 2022 – registro 20943520: https://zenodo.org/records/20943520

Para regenerar lo que lee el visor:
```bash
pip install pandas openpyxl numpy      # una vez
python scripts/build_data.py           # usa raw/censo_sectores.geojson
python scripts/build_data.py ruta/al/censo_sectores.geojson   # o indica la ruta
python scripts/build_data.py ruta/sectores.geojson ruta/parroquias_urbanas.geojson   # y la capa urbana
```
El script se detiene con error si `cod_inec` no tiene 6 ni 12 dígitos o no coincide con `I01`–`I05`, si un código se repite en un año, si un censo mezcla filas de parroquia y de sector, si hombres + mujeres no es igual al total, o si una parroquia de 6 dígitos no existe en el geojson.

Genera en `public/data/`: `poblacion.json` (incluye `censosParroquia`: los años que solo tienen cifras por parroquia), `sectores-cuenca.geojson` (solo el cantón 0101, coordenadas a 5 decimales ≈ 1 m, 25 MB / 4,6 MB comprimido) y `limites.geojson` (límites entre parroquias —incluidas las urbanas— y contorno cantonal, sacados de las aristas de los propios sectores).

Estructura del código INEC: `01 01 50 001 001` = provincia, cantón, parroquia (`50` = área URBANA, `51`–`71` = parroquias rurales), zona, sector. La parroquia es `cod_inec[:6]`. En 1950 y 1982 el código solo tiene las tres primeras partes (`010150`, `010151`…).

## Qué calcula (`src/lib/demografia.js`)
- Rango de años: 1950–2050.
- **Año censal**: dato oficial. **Entre censos**: interpolación. **Después del último censo**: proyección.
- Métodos: exponencial, geométrico, lineal; período base: últimos dos censos o serie completa (para parroquias, desde 1950).
- **Densidad** = población / km² (km² = `area_ha` del geojson). **Tasa** = crecimiento anual % del tramo.
- Vista **Parroquias**: 1950 y 1982 con la cifra directa de la parroquia; desde 1990, suma de sus sectores. El área urbana se muestra como un solo total, «Cuenca (URBANA)», de 1950 a 2021; **desde 2022 se muestran las 15 parroquias urbanas** (Yanuncay, Huayna Cápac…), cada una con la suma de sus sectores del censo 2022. Como solo tienen ese censo, se proyectan al ritmo del total urbano (sumadas dan siempre el total urbano). En el filtro «Parroquia», «Toda el área URBANA» muestra la serie urbana completa 1950–2050.
- Vista **Sectores censales**: solo **2022–2050** (censo 2022 y proyección). Antes de 2022 el visor muestra un aviso y no dibuja sectores: los polígonos son del censo 2022 y en los censos anteriores el INEC dividió y renumeró los sectores, así que un mismo código puede ser otro lugar (en el área urbana, entre 15 % y 20 % de la población de 1990–2010 no tenía polígono y la que sí se dibujaba caía en otros lugares). La tasa que se muestra para un sector es la de su parroquia. La evolución desde 1950 se ve en la vista de parroquias. Cada sector urbano muestra su parroquia urbana (Yanuncay, Huayna Cápac…), y en el filtro «Parroquia» se puede elegir una para ver solo los sectores que caen dentro de su límite. **Proyección de sectores:** cada sector parte de su cifra del último censo (2022) y crece al ritmo de su parroquia (los urbanos, al de Cuenca (URBANA)): población del sector × (parroquia en el año ÷ parroquia en 2022). No se usa la tasa propia del sector porque su serie no es comparable entre censos: el INEC divide sectores y, en el área urbana, cambia la numeración (con la tasa propia, la mediana salía −2,1 % anual en los sectores urbanos aunque el área urbana crece +0,71 %). Así los sectores de una parroquia suman lo mismo que la proyección de la parroquia. Un sector que no figura en el censo más reciente no se proyecta.

## Limitaciones de los datos
- **Parroquias urbanas solo desde 2022**: el código INEC agrupa las 15 parroquias urbanas en `010150`. Se separan por ubicación: cada sector urbano va a la parroquia de `raw/parraquias_urbanas.geojson` donde cae su punto interior (los 17 habitantes de 2022 en sectores sin polígono, por su zona censal). Antes de 2022 no se puede, porque los polígonos son del censo 2022 y en los censos anteriores el INEC renumeró las zonas urbanas (en 1990 toda la ciudad estaba en las zonas 001–034; en 2022 esas zonas son solo el noroeste). Por eso las parroquias urbanas no tienen tasa propia: crecen al ritmo del total urbano. Para separarlas en 1990–2010 haría falta la cartografía de sectores de esos censos.
- **1950 y 1982 solo por parroquia**: no tienen zona ni sector. Se asume que cada parroquia de esos censos es la parroquia actual del mismo código; los cambios de límites o las parroquias creadas después pueden afectar la comparación.
- **Los sectores cambian entre censos**: solo 648 existen en los cuatro censos por sector. Antes de 2022, entre 10 % y 14 % de la población está en sectores sin polígono actual y la densidad por sector usa el polígono de 2022.
- **Superficie**: los polígonos de sectores suman 3 195 km², menos que el territorio cantonal; la densidad de parroquias grandes (p. ej. Molleturo) puede estar sobreestimada. En todos los años se usa la superficie actual.

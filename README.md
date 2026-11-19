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
- Colores del mapa: 6 clases (2 en la tasa); «Sin dato» en gris. Población y densidad, en tonos tomate cálidos y semitransparentes (contrastan con el verde de la interfaz y con los verdes y azules del mapa base, que se ve debajo), con una **escala fija para todos los años**: 6 intervalos iguales y redondeados desde 0 hasta el valor más alto de la proyección de 2050 de todo el cantón (densidad por parroquias: tramos de 20 hab/ha; población por sectores: tramos de 100). La población por parroquia usa cortes fijos elegidos: hasta 5 000, 5 000–10 000, 10 000–20 000, 20 000–30 000, 30 000–40 000, 40 000–50 000 y más de 50 000 (7 clases). Así un color significa lo mismo en 1950 que en 2050. En la vista de sectores el techo es el percentil 90 de 2050 (el 10 % más alto entra en «Más de…»), porque unos pocos sectores diminutos con valores extremos dejarían a casi todos en la primera clase. Tasa de crecimiento, en dos clases de tonos suaves: verde, decrece o se mantiene (hasta 0 %); tomate, crece (más de 0 %).
- Mapas base, a elegir con el botón de capas (esquina superior derecha del mapa): **Calles** (OpenStreetMap), **Satélite** (Esri World Imagery; ahí los polígonos se dibujan más transparentes para ver la imagen) y **Oscuro** (Esri World Dark Gray, con nombres; CARTO ya exige clave de acceso). En satélite y oscuro los límites se dibujan en blanco.
- Nombres de las parroquias sobre el mapa, en blanco con contorno verde oscuro, siempre del mismo color (se leen sobre cualquier tono y mapa base). Aparecen cuando caben en la parroquia: las urbanas pequeñas, al acercar. En la vista de parroquias van con la cifra debajo; en la de sectores, solo el nombre (y si hay una parroquia elegida, solo el de esa).
- Método fijo: **exponencial**, P(t) = P(2022)·e^(r·t), con r = ln(P2022/P2010)/12, la misma fórmula con que el INEC calcula la tasa de crecimiento intercensal. Período base fijo: los dos últimos censos (2010–2022). No hay opciones de método ni de período en el visor. (El código de `demografia.js` conserva los métodos geométrico y lineal y el período «serie completa», por si se quieren volver a usar.)
- **Densidad** = población / hectáreas (habitantes por hectárea, hab/ha). La superficie se muestra en hectáreas (ha); internamente se guarda en km² (1 km² = 100 ha). **Tasa** = crecimiento anual % del tramo.
- Vista **Parroquias**: 1950 y 1982 con la cifra directa de la parroquia; desde 1990, suma de sus sectores. El área urbana se muestra como un solo total, «Cuenca (URBANA)», de 1950 a 2021; **desde 2022 se muestran las 15 parroquias urbanas** (Yanuncay, Huayna Cápac…), cada una con la suma de sus sectores del censo 2022. Como solo tienen ese censo, se proyectan al ritmo del total urbano (sumadas dan siempre el total urbano). En el filtro «Parroquia», «Toda el área URBANA» muestra la serie urbana completa 1950–2050.
- Vista **Sectores censales**: solo **2022–2050** (censo 2022 y proyección). Antes de 2022 el visor muestra un aviso y no dibuja sectores: los polígonos son del censo 2022 y en los censos anteriores el INEC dividió y renumeró los sectores, así que un mismo código puede ser otro lugar (en el área urbana, entre 15 % y 20 % de la población de 1990–2010 no tenía polígono y la que sí se dibujaba caía en otros lugares). La tasa que se muestra para un sector es la de su parroquia. La evolución desde 1950 se ve en la vista de parroquias. Cada sector urbano muestra su parroquia urbana (Yanuncay, Huayna Cápac…), y en el filtro «Parroquia» se puede elegir una para ver solo los sectores que caen dentro de su límite. **Proyección de sectores:** cada sector parte de su cifra del último censo (2022) y crece al ritmo de su parroquia (los urbanos, al de Cuenca (URBANA)): población del sector × (parroquia en el año ÷ parroquia en 2022). No se usa la tasa propia del sector porque su serie no es comparable entre censos: el INEC divide sectores y, en el área urbana, cambia la numeración (con la tasa propia, la mediana salía −2,1 % anual en los sectores urbanos aunque el área urbana crece +0,71 %). Así los sectores de una parroquia suman lo mismo que la proyección de la parroquia. Un sector que no figura en el censo más reciente no se proyecta.

## Limitaciones de los datos
- **Parroquias urbanas solo desde 2022**: el código INEC agrupa las 15 parroquias urbanas en `010150`. Se separan por ubicación: cada sector urbano va a la parroquia de `raw/parraquias_urbanas.geojson` donde cae su punto interior (los 17 habitantes de 2022 en sectores sin polígono, por su zona censal). Antes de 2022 no se puede, porque los polígonos son del censo 2022 y en los censos anteriores el INEC renumeró las zonas urbanas (en 1990 toda la ciudad estaba en las zonas 001–034; en 2022 esas zonas son solo el noroeste). Por eso las parroquias urbanas no tienen tasa propia: crecen al ritmo del total urbano. Para separarlas en 1990–2010 haría falta la cartografía de sectores de esos censos.
- **1950 y 1982 solo por parroquia**: no tienen zona ni sector. Se asume que cada parroquia de esos censos es la parroquia actual del mismo código; los cambios de límites o las parroquias creadas después pueden afectar la comparación.
- **Los sectores cambian entre censos**: solo 648 existen en los cuatro censos por sector. Antes de 2022, entre 10 % y 14 % de la población está en sectores sin polígono actual y la densidad por sector usa el polígono de 2022.
- **Superficie**: los polígonos de sectores suman 319 480 ha (3 195 km²), menos que el territorio cantonal; la densidad de parroquias grandes (p. ej. Molleturo) puede estar sobreestimada. En todos los años se usa la superficie actual.

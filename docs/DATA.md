# Map data

The game boundary is Austria excluding Tirol and Vorarlberg. Changing it requires
rebuilding the derived feature presets as well as changing the UI boundary.
The app is not currently a configurable worldwide map engine.

| Asset | Source and licence | Processing |
| --- | --- | --- |
| `austria-states.geojson`, `austria-districts.geojson` | Flooh Perlot / Statistik Austria, [2021 boundaries](https://github.com/ginseng666/GeoJSON-TopoJSON-Austria), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Upstream simplified GeoJSON; Vienna includes whole-city and municipal-district features. |
| `rail-network.geojson` | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), snapshot 2026-09-08 | Austrian rail ways and station nodes, simplified and rounded. Not a passenger-service eligibility list. |
| `features-public-20260911.json` | Collection of boundary derivatives (CC BY 4.0, above) and an OSM railway derivative (ODbL 1.0, above) | Dissolved/merged boundaries and simplified lines clipped to the game area. Licences apply to their respective components; the collection is not all MIT. |
| `highspeed-corridors-20260910-v2.json` | OSM contributors, ODbL 1.0, September 2026 | Selected actual railway paths, plus mapped fast bypasses; clipped, merged and simplified. |

The separate Linz and Graz city-district extensions used in the private prototype
are not bundled: redistribution terms for those exact downloads were not confirmed
for this release. Existing imported clues with saved region geometry remain usable.

## High-speed game corridors

- Vienna Hbf and Westbf via St. Poelten, Linz Hbf and Wels to Attnang-Puchheim.
- Graz Hbf to Klagenfurt Hbf via Koralmbahn.
- Vienna Meidling to Wiener Neustadt via Pottendorfer Linie.

These include slower station approaches and connecting sections. They exclude
Attnang-Salzburg, Marchegger Ostbahn, unfinished projects and out-of-map Tirol.
This is a game agreement, not an official or exhaustive speed classification.
Route reference links are included in the asset. New clues require confirmation
before they constrain the combined map. Old clues keep their saved snapshots.

## External services

Street tiles: [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/).
Do not bulk-download or prefetch public tiles. Railway overlays are served locally.
Satellite: [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer),
with imagery attribution displayed on the map. Hosts are responsible for service
terms and capacity; replace providers if deploying at larger scale.

Google Fonts supplies the typefaces. Tile/font providers receive normal browser
requests, including IP address and requested map areas. No map tiles, satellite
imagery or font files are bundled. README screenshots use OSM street tiles with
visible attribution and the bundled open geographic data.

Boundaries and buffers are approximate. Incomplete nearest-feature sets can give
wrong exclusions. Check close calls manually against the group's chosen rules.

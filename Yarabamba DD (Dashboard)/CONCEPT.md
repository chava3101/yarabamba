# Yarabamba DD Preview: dashboard concept

**Status:** all three phases built · 2026-09-30 · [`index.html`](index.html)
**Source:** `Refinagro_Yarabamba_responsAbility_vComplete.pdf` (33 pages) and its data in `~/Desktop/Refinagro/Responsability/`
**Visual board:** [`concept.html`](concept.html)

---

## 1. The idea in one line

**A 33-page deck becomes one asset workspace: one valley map, a crop lens and a scenario lens, and eight screens.**

The report repeats itself by design, because paper can't be interactive: suitability ×3 crops, microclimate ×3, risk ×3, and each map printed once per variant. The app collapses that repetition into **controls**:

| The report does this… | …the app does this |
|---|---|
| One page per crop (p. 7–12, 20–22, 9 pages) | A **crop lens** (All · Avocado · Mandarin · Blueberry) that re-renders the same screen |
| One map per variant (soil read vs pH amended, p98 vs p99 vs El Niño) | A **layer stack** on one map, with a **swipe** to compare two layers |
| Tables per probability tier (moderate · strong · extraordinary) | A **scenario lens** (Today · Moderate 16 % · Strong 40 % · Extraordinary 43 %) that moves maps, hectares and loss bands together |
| Static charts of 1981–2025 | Hoverable series with El Niño seasons marked and a 2040 projection |
| "Where we'd walk" as prose | Clickable fundos and lots that open a **fundo profile** |
| Illustrative covenant chart | A **trigger backtest** on the real stress-day series: drag the threshold, see how often it fires |

## 2. Screens

| # | Screen | Headline finding (the screen's question) | Replaces |
|---|---|---|---|
| 1 | **Overview** | "The ground scores well. The variable that decides it doesn't show up from orbit." | Cover, contents, exec summary, p. 5 |
| 2 | **Valley map** | Where is each lot, and what sits under it? | p. 5, 17, 18, A1, all map panels |
| 3 | **Suitability** | Climate and terrain score 91–98; soil chemistry is the binding constraint | p. 6, 7, 9, 11 |
| 4 | **Heat & frost** | Which crop is already on its stress line, and how far is frost? | p. 8, 10, 12, A2, A3 |
| 5 | **El Niño** | The baseline had already moved: 2.4 → 6.2 stress days a year, 26 in 2024 | p. 13–16, A4 |
| 6 | **Exposure** | One property, two perils: flood up-valley, heat down-valley | p. 17–22 |
| 7 | **Underwriting** | How a climate index sits inside a covenant | p. 23–25 |
| 8 | **Next steps** | What the visit needs; what the full DD adds | p. 3 (§ 03–04), 26–27 |
| – | **Sources & limits** (drawer, from any screen) | What we ran and what it can't tell you | p. 6 footnotes, A5 |

### What each screen shows

1. **Overview**: hero 3D aerial of the Zaña valley with the headline. ENFEN alert pill: *Coastal El Niño Alert · 83 % strong or extraordinary*. KPI row: planted 1,740 / 1,967 ha with the crop split · climate 91–98 · soil 26–50 ◆ · stress days 6.2 / yr (sparkline) · El Niño 83 %. The four exec-summary findings as cards linking to their screens. Satellite lots + "two perils" summary.
2. **Valley map** (workspace): satellite basemap, 23 lot polygons coloured by crop, and a layer panel: Suitability (soil read / pH amended per crop), Heat (p98 / p99 / El Niño), Cold (p02 / p01), Flood (tier / height above channel). Opacity, swipe compare, 2D ↔ 3D valley. Click a lot → **fundo profile** drawer: crop, variety, density, polygon vs productive ha, thermal structure, flood exposure per tier, suitability.
3. **Suitability** (crop lens): three score dials (Climate 2026 → 2040 · Terrain · Soil baseline → managed). **Law of the minimum** bars (every factor, binding one highlighted). Soil read ↔ pH amended swipe map. "The 45-point gap is what management is worth." What to focus on · what the models show · 2040.
4. **Heat & frost** (crop lens): stress line; hectares by 1 °C band per scenario (typical · 1-in-10 · 1-in-20 · El Niño) with "past the line"; frost margin thermometer (coldest night vs frost line); fundo thermal ranking (1.6 °C spread); tolerance thresholds.
5. **El Niño**: alert banner + 83 %. ENFEN monthly probabilities Sep 26 – May 27. Hottest day of the year 1981 → 2040 with stress lines, El Niño seasons, trend. Stress days per year (≥ 32 / 33 / 34 °C). Rainfall per year with the 2026-27 scenario. The 44-season ranking and the two regimes (heat & dry vs flood).
6. **Exposure** (scenario lens is the star): the map shows the tier's flood footprint and heat field; crop × peril matrix (ha, %); yield and inventory loss bands; fundo ranking (Chumbenique II-III 83 % flood · Cojal warmest); probability-weighted expected loss, derived and labelled as such.
7. **Underwriting**: five-step chain (reanalysis → attribution → trigger → response → structure). **Trigger backtest**: pick an index and threshold, see fires-per-45-years and which seasons. Illustrative DSCR, structured vs unstructured. Attribution per peril. The six datasets that convert this into a debt-service view.
8. **Next steps**: deliverables board (delivered in preview ✓ · full DD · financial & structuring · continuous monitoring); site-visit plan ("where we'd walk", by fundo); data requests with owner.

## 3. Data: real, not mocked

| Kind | Source | Used by |
|---|---|---|
| Lots | `Yarabamba_lotes_produccion.kml`: 23 polygons with fundo, crop, variety, density, ha | Map, fundo profile, Overview |
| Layers | 12 GeoTIFFs (WGS84) + colour ramps in `yarabamba-layers.json` | Map, Suitability, Heat, Exposure |
| Series | 18 CSVs in `Yarabamba_Findings/data/`: climate 1981–2025 (annual, monthly), extremes, projection 2026–2040, Niño composites and ranking, flood by crop/fundo, microclimate by crop/fundo, suitability by factor | Every chart |
| Narrative | `yarabamba-report.json`: section copy, findings | Headlines, callouts |
| ENFEN 15-2026 | Tables in the report (A4) | El Niño |
| Derived | Probability-weighted loss = Σ p(tier) × band midpoint | Exposure (labelled "derived") |
| Illustrative | DSCR curves | Underwriting (labelled "illustrative, no scale", as in the report) |

**Area bases differ, so every figure says which it uses:** productive (planted) area from the KML sums to 1,739.6 ha (the "1,740"). KML polygon area sums to 1,971 ha, and the risk tables use 1,967 ha of lots (1,245 / 278 / 444), their pixel-based base.

**Pipeline:** a small `build_data.py` in this folder turns the sources into (a) `data.js` (`window.YB = {…}`, a script, so it works on `file://`), (b) `layers/*.png` colourised with the layers.json ramps plus their WGS84 bounds, (c) `lots.geojson` embedded in `data.js`. Re-run it when the analysis updates.

## 4. Visual direction

- **Light by default** (decided), like every other dashboard; dark is one click away. Imagery and heat rasters carry the look in both.
- **Imagery-led**: 3D aerial hero, satellite basemap, the analysis rasters as the main visuals. Rasters keep their scientific ramps (inferno for heat, red→green for suitability, amber→red for flood tiers). Charts use system tokens.
- **Colour roles**
  - Crop identity (categorical, validated all-pairs slots): **avocado `--c2` teal · mandarin `--c1` orange · blueberry `--c3` violet**, on map outlines, chips, legends and series.
  - Scenario tiers (ordinal severity): moderate `na` · strong `warn` · extraordinary `bad`, matching the report.
  - Suitability 0–100: ≥ 80 `ok` · 50–79 `warn` · < 50 `bad`.
  - ◆ "requires on-site validation" flag on every soil figure and loss band.
- **Headline-led screens**: each screen opens with its one-sentence finding in large type (the report's strongest device), above the lenses and KPIs.

## 5. System impact

- **New archetype F · Asset risk brief**: a hybrid of C (portfolio KPIs), D (map workspace) and E (entity profile), plus **global lenses** (crop × scenario) held in the URL (`#exposure?crop=avocado&tier=strong`). Documented in GUIDELINES once built.
- Likely promotions to `_system/` (only if a second dashboard needs them): layer-stack map, swipe compare, `.lede` headline block, lens bar, score dial, alert pill.
- Done already: a dashboard can open dark (`<html data-theme="dark">`), and theme choice is remembered per dashboard.

## 6. Decisions (resolved 2026-09-30)

1. **Map engine:** MapLibre GL 4.7 from cdnjs, Esri World Imagery, AWS Terrarium terrain for 3D. Analysis overlays are embedded as WebP data URLs (`layers.js`) so they work on `file://`; without WebGL or the CDN, the valley map falls back to a static satellite view (`img/satellite.jpg`, fetched at build time).
2. **Headline typeface:** DM Sans everywhere.
3. **Build order:** three phases, all done. Phase 1: Overview, Valley map, El Niño. Phase 2: Suitability, Heat & frost, Exposure. Phase 3: Underwriting, Next steps, brief export, and promotion of lede, hero, alert pill, lens bar, dial and swipe into the system (v1.3).
4. **Theme:** light by default.

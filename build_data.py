#!/usr/bin/env python3
"""Build the Yarabamba dashboard data from the analysis outputs.

Reads   ~/Desktop/Refinagro/Responsability/  (KML, GeoTIFFs, CSVs, layers.json)
Writes  data.js        window.YB         numbers, series, lots GeoJSON
        layers.js      window.YB_LAYERS  map overlays as WebP data URLs (work on file://)
        img/satellite.jpg                static basemap for the offline fallback

Needs the GDAL command-line tools, numpy and Pillow. Re-run whenever the analysis updates:
    python3 build_data.py
"""
import base64, csv, io, json, math, os, re, subprocess, sys, tempfile, urllib.request
from collections import defaultdict
import numpy as np
from PIL import Image

SRC = os.path.expanduser("~/Desktop/Refinagro/Responsability")
OUT = os.path.dirname(os.path.abspath(__file__))
DATA = f"{SRC}/Yarabamba_Findings/data"
TIF = f"{SRC}/yarabamba-layers-wgs84"
KML = f"{SRC}/Yarabamba/Yarabamba_lotes_produccion.kml"
TMP = tempfile.mkdtemp(prefix="yb_")

# Valley grid: every overlay is resampled onto the 30 m analysis grid extent so they stack exactly.
W, S, E, N = -79.7965993, -7.1276386, -79.2027790, -6.6727744
GW, GH = 2188, 1676            # native 30 m grid (analysis resolution, used for zonal counts)
OW, OH = 1400, 1072            # overlay image size

CROPS = {  # final report values (p. 7, 9, 11 and yarabamba-layers.json descriptions)
    "avocado":   {"name": "Avocado",   "kml": "Avocado",   "color": "c2", "variety": "Hass",  "stress": 33, "severe": 35, "frost": 0,
                  "stress_label": "fruit set & drop", "coldest": 8.8,
                  "suit": {"climate": 98, "climate2040": 98, "terrain": 95, "soil": 26, "soil_managed": 71}},
    "mandarin":  {"name": "Mandarin",  "kml": "Mandarin",  "color": "c1", "variety": "Tango", "stress": 34, "severe": 36, "frost": -2,
                  "stress_label": "sunburn & puffing", "coldest": 9.0,
                  "suit": {"climate": 91, "climate2040": 94, "terrain": 97, "soil": 50, "soil_managed": 68}},
    "blueberry": {"name": "Blueberry", "kml": "Blueberry", "color": "c3", "variety": "Matias · Sekoya Pop · Manila", "stress": 32, "severe": 34, "frost": 0,
                  "stress_label": "firmness & calibre", "coldest": 8.6,
                  "suit": {"climate": 98, "climate2040": 96, "terrain": None, "soil": None, "soil_managed": None}},
}
TIERS = {  # ENFEN 15-2026 summer magnitude, Niño 1+2; ΔT = Sep–Dec maxima anomaly of the analog composites; stage = flood band
    "moderate":      {"name": "Moderate",      "p": 16, "dT": 0.9, "stage": 1.5, "tier_code": 3},
    "strong":        {"name": "Strong",        "p": 40, "dT": 1.1, "stage": 3.0, "tier_code": 2},
    "extraordinary": {"name": "Extraordinary", "p": 43, "dT": 1.8, "stage": 5.0, "tier_code": 1},
}
HEAT = ["#000004", "#110a30", "#320a5e", "#57106e", "#781c6d", "#9a2865", "#bc3754", "#d84c3e", "#ed6925", "#f98e09", "#fbb61a", "#f4df53", "#fcffa4"]
COLD = ["#0c1524", "#1c334f", "#2c507b", "#3d6fa8", "#5382b8", "#6995c9", "#7fa8d9", "#9fbcdb", "#bfcfdc", "#dee2de"]
SUIT = ["#7A2E20", "#E0654E", "#E0A24E", "#D9D26A", "#63C77B", "#1F9D57"]
FLOOD = {3: "#E0A24E", 2: "#E0654E", 1: "#B02020"}  # moderate < 1.5 m · strong < 3 m · extraordinary < 5 m


def sh(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def read_grid(path, w, h, resample="bilinear", srcnodata=None):
    """Warp a GeoTIFF onto the valley grid and return a float32 array (NaN = no data)."""
    out = f"{TMP}/{os.path.basename(path)}.{w}.{resample}.bin"
    args = ["gdalwarp", "-q", "-overwrite", "-te", str(W), str(S), str(E), str(N), "-ts", str(w), str(h),
            "-r", resample, "-ot", "Float32", "-dstnodata", "nan", "-of", "ENVI"]
    if srcnodata is not None:
        args += ["-srcnodata", str(srcnodata)]
    sh(*args, path, out)
    return np.fromfile(out, dtype="<f4").reshape(h, w)


def hex_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def ramp(arr, colors, d0, d1):
    stops = np.array([hex_rgb(c) for c in colors], dtype=np.float32)
    t = np.clip((arr - d0) / (d1 - d0), 0, 1) * (len(colors) - 1)
    t = np.nan_to_num(t)
    i = np.clip(np.floor(t).astype(int), 0, len(colors) - 2)
    f = (t - i)[..., None]
    rgb = stops[i] * (1 - f) + stops[i + 1] * f
    alpha = np.where(np.isfinite(arr), 255, 0).astype(np.uint8)
    return np.dstack([rgb.astype(np.uint8), alpha])


def classes(arr, mapping):
    img = np.zeros(arr.shape + (4,), dtype=np.uint8)
    for code, color in mapping.items():
        m = arr == code
        img[m, :3] = hex_rgb(color)
        img[m, 3] = 255
    return img


def data_url(rgba, lossless):
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "WEBP", lossless=lossless, quality=82, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def rcsv(name):
    with open(f"{DATA}/{name}", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def key(s):
    return re.sub(r"[^A-Z0-9]", "", s.upper().replace("Í", "I").replace("Ó", "O").replace("Ñ", "N").replace("Á", "A"))


def linfit(xs, ys):
    x, y = np.array(xs, float), np.array(ys, float)
    b, a = np.polyfit(x, y, 1)
    return float(a), float(b)


# ------------------------------------------------------------------ lots (KML → GeoJSON)
# the KML holds one layer per fundo: convert each, then merge into one collection
layer_names = [l.split(": ", 1)[1] for l in subprocess.run(["ogrinfo", "-q", KML], capture_output=True, text=True).stdout.splitlines()
               if re.match(r"^\d+: ", l)]
raw = []
for li, ln in enumerate(layer_names):
    part = f"{TMP}/layer_{li}.geojson"
    sh("ogr2ogr", "-f", "GeoJSON", "-dim", "XY", "-lco", "COORDINATE_PRECISION=5", part, KML, ln)
    raw += json.load(open(part, encoding="utf-8"))["features"]
gj_path = f"{TMP}/lots.geojson"
json.dump({"type": "FeatureCollection", "features": raw}, open(gj_path, "w", encoding="utf-8"))
features = []
for i, f in enumerate(raw):
    p = f["properties"]
    crop = next(k for k, c in CROPS.items() if c["kml"].lower() == str(p.get("Crop", "")).lower())
    features.append({"type": "Feature", "id": i, "geometry": f["geometry"], "properties": {
        "lot": p.get("Lote") or p.get("Name"), "fundo": p["Fundo"], "fkey": key(p["Fundo"]), "crop": crop,
        "variety": p.get("Variety"), "density": p.get("Density_plants_ha"),
        "ha": round(float(p["Polygon_ha"]), 2), "fundo_ha": round(float(p["Polygon_ha_fundo"]), 2),
        "productive_ha": round(float(p["Productive_ha"]), 2), "diff_pct": p.get("Diff_pct")}})
lots_fc = {"type": "FeatureCollection", "features": features}
print(f"lots: {len(features)} polygons, fundos: {sorted({f['properties']['fundo'] for f in features})}")

# crop masks on the native 30 m grid → zonal hectares straight from the rasters
masks = {}
for ck, c in CROPS.items():
    mpath = f"{TMP}/mask_{ck}.tif"
    sh("gdal_rasterize", "-q", "-l", "lots", "-burn", "1", "-where", f"Crop = '{c['kml']}'", "-te", str(W), str(S), str(E), str(N),
       "-ts", str(GW), str(GH), "-ot", "Byte", "-init", "0", gj_path, mpath)
    masks[ck] = read_grid(mpath, GW, GH, "near") > 0.5
lat_c = (S + N) / 2
px_ha = ((E - W) / GW * 111320 * math.cos(math.radians(lat_c))) * ((N - S) / GH * 110574) / 10000
print(f"pixel = {px_ha:.4f} ha; crop mask ha: " + ", ".join(f"{k} {m.sum() * px_ha:.0f}" for k, m in masks.items()))

p98 = read_grid(f"{TIF}/Tmax_p98_degC.tif", GW, GH)
p99 = read_grid(f"{TIF}/Tmax_p99_degC.tif", GW, GH)
tier = read_grid(f"{TIF}/Flood_exposure_tier_ElNino.tif", GW, GH, "near", srcnodata=255)
exposure = {"heat": {"today": {}}, "flood": {"today": {}}}
for tk in TIERS:
    exposure["heat"][tk], exposure["flood"][tk] = {}, {}
for ck, c in CROPS.items():
    m = masks[ck]; tot = m.sum()
    past = lambda grid, dT=0.0: int(round(((grid[m] + dT) >= c["stress"]).sum() * px_ha))
    exposure["heat"]["today"][ck] = past(p98)
    exposure["flood"]["today"][ck] = 0
    for tk, t in TIERS.items():
        exposure["heat"][tk][ck] = past(p99, t["dT"])
        exposure["flood"][tk][ck] = int(round(((tier[m] >= 1) & (tier[m] <= 3) & (tier[m] >= t["tier_code"])).sum() * px_ha))
    c["lot_ha"] = int(round(tot * px_ha))
print("heat exposure", json.dumps(exposure["heat"]))
print("flood exposure", json.dumps(exposure["flood"]))
# Flood: the analysis published its own table (risk_flood_exposure_by_crop.csv, report p. 17) — use it verbatim.
# Heat: no table exists, so it is counted from the 30 m rasters above, capped at the crop's lot area (±1–2 ha vs the PDF).
flood_csv = {r["crop"].lower(): r for r in rcsv("risk_flood_exposure_by_crop.csv")}
TIER_COL = {"moderate": "moderado", "strong": "fuerte", "extraordinary": "extraordinario"}
for ck in CROPS:
    c = CROPS[ck]; r = flood_csv[ck]
    c["risk_lot_ha"] = round(float(r["total_ha"]))
    c["hanc_p50_m"] = float(r["hanc_p50_m"])
    for tk, col in TIER_COL.items():
        exposure["flood"][tk][ck] = round(float(r[f"{col}_ha"]))
    for tk in exposure["heat"]:
        exposure["heat"][tk][ck] = min(exposure["heat"][tk][ck], c["risk_lot_ha"])
print("published exposure", json.dumps(exposure))

# ------------------------------------------------------------------ overlays
layers = {}
def add(lid, rgba, lossless, **meta):
    layers[lid] = {"url": data_url(rgba, lossless), **meta}

ov98 = read_grid(f"{TIF}/Tmax_p98_degC.tif", OW, OH)
ov99 = read_grid(f"{TIF}/Tmax_p99_degC.tif", OW, OH)
add("heat-today", ramp(ov98, HEAT, 29.5, 35.5), False, group="heat", tier="today", domain=[29.5, 35.5], ramp=HEAT,
    name="Typical extreme day · Tmax p98", note="98th percentile of daily maxima 2006–2025, 30 m relief-downscaled")
for tk, t in TIERS.items():
    grid = read_grid(f"{TIF}/Tmax_p99_ElNino_2026-27_plus1p8_degC.tif", OW, OH) if tk == "extraordinary" else ov99 + t["dT"]
    add(f"heat-{tk}", ramp(grid, HEAT, 29.5, 35.5), False, group="heat", tier=tk, domain=[29.5, 35.5], ramp=HEAT,
        name=f"{t['name']} El Niño · Tmax p99 + {t['dT']} °C", note=f"1-in-10-year day plus the {t['name'].lower()} analog Sep–Dec anomaly")
ovt = read_grid(f"{TIF}/Flood_exposure_tier_ElNino.tif", OW, OH, "near", srcnodata=255)
for tk, t in TIERS.items():
    add(f"flood-{tk}", classes(np.where(ovt >= t["tier_code"], ovt, np.nan), FLOOD), True, group="flood", tier=tk,
        classes=[[FLOOD[t2["tier_code"]], f"{t2['name']} stage · ground < {t2['stage']:g} m above channel"] for t2 in TIERS.values() if t2["tier_code"] >= t["tier_code"]],
        name=f"Flood exposure · {t['name']} El Niño", note="Height above the nearest Río Zaña channel; tiers nest. First-order screening, not hydraulic modelling")
add("cold-p02", ramp(read_grid(f"{TIF}/Tmin_p02_degC.tif", OW, OH), COLD, 7, 16), False, group="cold", domain=[7, 16], ramp=COLD,
    name="Coldest 2 % of nights · Tmin p02", note="With terrain cold-air pooling, 30 m. Frost lines (0 / −2 °C) fall far below this range")
for ck, file_, variant, label in [("avocado", "Suitability_avocado_2026_soil_read", "soil", "Soil read"),
                                   ("avocado", "Suitability_avocado_2026_pH_amended", "ph", "pH amended"),
                                   ("mandarin", "Suitability_mandarin_2026_soil_read", "soil", "Soil read"),
                                   ("mandarin", "Suitability_mandarin_2026_pH_amended", "ph", "pH amended"),
                                   ("blueberry", "Suitability_blueberry_2026_climate", "climate", "Climate read (potted)")]:
    grid = read_grid(f"{TIF}/{file_}.tif", OW // 2, OH // 2, "near")   # 250 m source: keep the blocky read honest
    rgba = np.array(Image.fromarray(ramp(grid, SUIT, 0, 100), "RGBA").resize((OW, OH), Image.NEAREST))
    add(f"suit-{ck}-{variant}", rgba, True, group="suit", crop=ck, variant=variant, domain=[0, 100], ramp=SUIT,
        name=f"Suitability 2026 · {CROPS[ck]['name']} · {label}", note="Liebig minimum over 13 factors, irrigated, 0–100, 250 m")
size = sum(len(v["url"]) for v in layers.values())
print(f"overlays: {len(layers)} layers, {size / 1e6:.1f} MB as data URLs")

# ------------------------------------------------------------------ static satellite (offline fallback + overview)
sat = f"{OUT}/img/satellite.jpg"
if not os.path.exists(sat):
    url = ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
           f"?bbox={W},{S},{E},{N}&bboxSR=4326&imageSR=4326&size=2000,{round(2000 * GH / GW)}&format=jpg&f=image")
    try:
        urllib.request.urlretrieve(url, sat)
        Image.open(sat).convert("RGB").save(sat, quality=80, optimize=True, progressive=True)
        print("satellite.jpg fetched")
    except Exception as e:  # keep building without it
        print("satellite.jpg not fetched:", e, file=sys.stderr)

# ------------------------------------------------------------------ fundos
micro = {key(r["fundo"]): r for r in rcsv("microclima_por_fundo.csv")}
floodf = {key(r["fundo"]): r for r in rcsv("risk_flood_exposure_by_fundo.csv")}
NOTES = {  # "where we'd walk" (report p. 3, 17, 20–22)
    "CHUMBENIQUEIIIII": "The flood-critical fundo: most of its area sits in the extraordinary band, median 1.9 m above the channel. Walk the drainage and the channel margin.",
    "COJAL": "Highest ground of the avocado fundos and the warmest. A placement trade-off, not a ranking.",
    "ANAMARIA": "Carries the mandarin flood exposure. Same crop as San Nicolás on different ground; sample both.",
    "SANNICOLAS": "Sits higher than Ana María. The saltier read here (WISE block) is a lab question, not a finding.",
}
DISPLAY = {"CHUMBENIQUEI": "Chumbenique I", "CHUMBENIQUEIIIII": "Chumbenique II-III", "COJAL": "Cojal", "CULPON": "Culpón",
           "LAHUMEDAD": "La Humedad", "SANISMAEL": "San Ismael", "VINAI": "Viña I", "VINAIV": "Viña IV", "ANAMARIA": "Ana María", "SANNICOLAS": "San Nicolás"}
fundos = []
for fk in sorted({f["properties"]["fkey"] for f in features}):
    fl = [f["properties"] for f in features if f["properties"]["fkey"] == fk]
    m, fd = micro.get(fk), floodf.get(fk)
    crop = fl[0]["crop"]
    fundos.append({
        "key": fk, "name": DISPLAY.get(fk, fl[0]["fundo"].title()),
        "crop": crop, "lots": len(fl), "polygon_ha": round(fl[0]["fundo_ha"], 1), "productive_ha": round(fl[0]["productive_ha"], 2),
        "variety": fl[0]["variety"], "density": fl[0]["density"],
        "tmax": {k: float(m[f"T_max_{k}"]) for k in ("p98", "p99", "p995", "absmax")} if m else None,
        "tmin": {k: float(m[f"T_min_{k}"]) for k in ("p02", "p01", "absmin")} if m else None,
        "suit": float(m["suit_irrigated"]) if m else None,
        "flood": {"hanc_p50_m": float(fd["hanc_p50_m"]), "moderate": float(fd["moderado_pct"]), "strong": float(fd["fuerte_pct"]),
                  "extraordinary": float(fd["extraordinario_pct"])} if fd else None,
        "note": NOTES.get(fk),
    })
print("fundos:", [(f["name"], f["crop"], bool(f["tmax"]), bool(f["flood"])) for f in fundos])

# ------------------------------------------------------------------ climate series
annual = rcsv("clima_historico_anual_1981_2025.csv")
years = [int(r["year"]) for r in annual]
ext = rcsv("clima_extremos_tmax_mensual_1981_2025.csv")
ym = defaultdict(lambda: {"hot": -99.0, "d32": 0.0, "d33": 0.0, "d34": 0.0})
for r in ext:
    b = ym[int(r["year"])]
    b["hot"] = max(b["hot"], float(r["tmax_abs"]))
    for d in ("32", "33", "34"):
        b["d" + d] += float(r[f"days_ge_{d}"])
hottest = [round(ym[y]["hot"], 2) for y in years]
a_hot, b_hot = linfit([y for y in years if y >= 2006], [ym[y]["hot"] for y in years if y >= 2006])
proj = rcsv("clima_proyeccion_2026_2040.csv")
trends = {r["variable"]: {"per_decade": float(r["slope_per_decade"]), "p": float(r["p_value"]), "mean": float(r["mean_2006_2025"])} for r in rcsv("clima_tendencias_resumen.csv")}
monthly = rcsv("clima_historico_mensual_1981_2025.csv")
mprec = {(int(r["year"]), int(r["month"])): float(r["precip_mm"]) for r in monthly}
mext = {(int(r["year"]), int(r["month"])): r for r in ext}
clim = {int(r["month"]): float(r["precip_mm"]) for r in rcsv("clima_climatologia_mensual.csv")}

def season(y):  # Sep(y) – Apr(y+1)
    mm = [(y, m) for m in range(9, 13)] + [(y + 1, m) for m in range(1, 5)]
    rows = [mext[k] for k in mm if k in mext]
    return {"season": f"{y}-{str(y + 1)[2:]}", "hottest": round(max(float(r["tmax_abs"]) for r in rows), 1),
            "d32": round(sum(float(r["days_ge_32"]) for r in rows)), "d33": round(sum(float(r["days_ge_33"]) for r in rows)),
            "rain": round(sum(mprec.get(k, 0) for k in mm))}
NINO_SEASONS = [1982, 1997, 2015, 2016, 2022, 2023]
seasons = [season(y) for y in NINO_SEASONS]
rank = [{"season": f"{r['season']}-{str(int(r['season']) + 1)[2:]}", "t_anom": float(r["t_anom"]), "rain": round(float(r["p_mm"])),
         "mult": float(r["p_mult"]), "index": float(r["index"])} for r in rcsv("nino_ranking_temporadas.csv")]
scen = rcsv("nino_escenario_2026_2027.csv")
rest = sum(v for m, v in clim.items() if m in (5, 6, 7, 8))
scenario = {"months": [int(r["month"]) for r in scen],
            "exp_precip": [float(r["exp_precip_mm"]) for r in scen], "extra_precip": [float(r["extra_precip_mm"]) for r in scen],
            "clim_precip": [float(r["precip_clim"]) for r in scen], "exp_tmax_anom": [float(r["exp_t2m_max_anom"]) for r in scen],
            "annual_weighted": round(sum(float(r["exp_precip_mm"]) for r in scen) + rest),
            "annual_extra": round(sum(float(r["extra_precip_mm"]) for r in scen) + rest)}
print(f"hottest-day trend 2006–2025: {b_hot * 10:+.2f} °C/decade; 2026-27 rain weighted {scenario['annual_weighted']} mm, extraordinary {scenario['annual_extra']} mm")

climate = {
    "years": years, "hottest": hottest,
    "d32": [round(ym[y]["d32"], 1) for y in years], "d33": [round(ym[y]["d33"], 1) for y in years], "d34": [round(ym[y]["d34"], 1) for y in years],
    "tmax": [float(r["t2m_max"]) for r in annual], "tmean": [float(r["t2m_mean"]) for r in annual], "tmin": [float(r["t2m_min"]) for r in annual],
    "precip": [float(r["precip_mm"]) for r in annual],
    "proj": {"years": [int(r["year"]) for r in proj], "tmax": [float(r["t2m_max"]) for r in proj], "tmean": [float(r["t2m_mean"]) for r in proj],
             "tmin": [float(r["t2m_min"]) for r in proj], "precip": [float(r["precip_mm"]) for r in proj]},
    "hottest_trend": {"a": a_hot, "b": b_hot, "per_decade": round(b_hot * 10, 2), "from": 2006},
    "trends": trends,
}

# ------------------------------------------------------------------ phase 2 · suitability factors and the raw soil read
FACTORS = [  # (id, label, group) — Liebig minimum over these, irrigated scenario
    ("temperature", "Mean cycle temperature", "climate"), ("precipitation", "Cycle precipitation (irrigated)", "climate"), ("photoperiod", "Photoperiod", "climate"),
    ("slope", "Terrain slope", "terrain"),
    ("pH", "Acidity · pH", "soil"), ("coarse_fragments", "Coarse fragments · stoniness", "soil"), ("texture", "Soil texture", "soil"),
    ("soil_organic_carbon", "Organic carbon", "soil"), ("base_saturation", "Base saturation", "soil"), ("gypsum", "Gypsum", "soil"),
    ("salinity", "Salinity", "soil"), ("sodicity", "Sodicity", "soil")]
factors = {ck: {} for ck in CROPS}
for r in rcsv("aptitud_por_factor.csv"):
    if r["irrigation"] == "yes_irri" and r["zone"] == "own_lotes" and r["factor"] != "climate":
        factors["mandarin" if r["crop"] == "citrus" else r["crop"]][r["factor"]] = float(r["suitability"])
soil_raw = {r["zona"].lower(): {k: float(v) for k, v in r.items() if k != "zona"} for r in rcsv("suelo_valores_crudos.csv")}

# ------------------------------------------------------------------ phase 2 · thermal bands per crop and scenario, from the 30 m rasters
def bands(values):
    lo = np.floor(values).astype(int); out = defaultdict(float)
    for b in lo:
        out[int(b)] += px_ha
    return [[b, round(h, 1)] for b, h in sorted(out.items())]
HEAT_SCEN = [("today", "Typical year · p98", None, 0.0), ("p99", "1-in-10-year day · p99", None, 0.0)] + [(tk, f"{t['name']} El Niño · p99 + {t['dT']} °C", tk, t["dT"]) for tk, t in TIERS.items()]
p02 = read_grid(f"{TIF}/Tmin_p02_degC.tif", GW, GH)
p01 = read_grid(f"{TIF}/Tmin_p01_degC.tif", GW, GH)
thermal = {}
for ck, c in CROPS.items():
    m = masks[ck]
    heat = []
    for sid, label, tier_key, dT in HEAT_SCEN:
        v = (p98 if sid == "today" else p99)[m] + dT
        v = v[np.isfinite(v)]
        past = float((v >= c["stress"]).sum() * px_ha)
        heat.append({"id": sid, "label": label, "tier": tier_key, "bands": bands(v), "min": round(float(v.min()), 1), "max": round(float(v.max()), 1),
                     "past_ha": round(min(past, c["risk_lot_ha"])), "past_pct": round(100 * past / (m.sum() * px_ha), 1)})
    cold = []
    for sid, label, grid in [("p02", "Coldest 2 % of nights", p02), ("p01", "Coldest 1 % of nights", p01)]:
        v = grid[m]; v = v[np.isfinite(v)]
        cold.append({"id": sid, "label": label, "bands": bands(v), "min": round(float(v.min()), 1), "max": round(float(v.max()), 1)})
    thermal[ck] = {"heat": heat, "cold": cold}
    print(ck, "p98", heat[0]["min"], "–", heat[0]["max"], "past", heat[0]["past_ha"], "| extraordinary", heat[-1]["min"], "–", heat[-1]["max"], "past", heat[-1]["past_ha"])

# per-fundo heat share past the crop line, per scenario (flood shares come from the analysis CSV)
for f in fundos:
    mpath = f"{TMP}/mask_f_{f['key']}.tif"
    fname = next(x["properties"]["fundo"] for x in features if x["properties"]["fkey"] == f["key"])
    sh("gdal_rasterize", "-q", "-l", "lots", "-burn", "1", "-where", f"Fundo = '{fname}'", "-te", str(W), str(S), str(E), str(N),
       "-ts", str(GW), str(GH), "-ot", "Byte", "-init", "0", gj_path, mpath)
    m = read_grid(mpath, GW, GH, "near") > 0.5; line = CROPS[f["crop"]]["stress"]
    share = lambda grid, dT=0.0: round(100 * float(((grid[m] + dT) >= line).sum()) / max(1, int(m.sum())), 1)
    f["heat_share"] = {"today": share(p98), **{tk: share(p99, t["dT"]) for tk, t in TIERS.items()}}
print("fundo heat shares:", {f["name"]: f["heat_share"]["extraordinary"] for f in fundos})

# ------------------------------------------------------------------ phase 2 · narrative from the report (p. 7–12, 16, 20–22, A3), kept as data
SUIT_TEXT = {
    "avocado": {"focus": "Remote data put the constraint in the soil, not the climate. For the visit: obtain the soil analyses and the nutrition programme; establish where and how pH amendments are applied, and at what cost per season; check the plans against runoff of inputs under heavy rain. An El Niño season washes an amendment out.",
                "models": "Climate and terrain sit near the ceiling of the index. The score is the soil's: pH caps it on the global read, and with pH set to non-limiting it runs where stoniness binds. The orchards are established and productive, so something is resolving the chemistry: rootstock selection, acidified fertigation, gypsum on sodicity, or the 250 m read simply being wrong here. Which one, and at what cost per hectare per season, is a visit question.",
                "y2040": "Climate holds under the observed warming trend. The constraint is chemical, not climatic: an amendment keeps its value."},
    "mandarin": {"focus": "Remote data put the constraint in the soil. Ana María and San Nicolás sit on different ground at a grain finer than 250 m: sample both. The saltier read on the mandarin fundos is a lab question, not a finding.",
                 "models": "Soil on the global read is capped by pH and stoniness; once pH is non-limiting, stoniness takes over. Scores follow the river alluvium: the corridor reads best on both panels. The trees are standing on it, so something is resolving the chemistry; what, is a visit question.",
                 "y2040": "Climate rises as the cool coast drifts toward the citrus optimum. Every binding factor is soil."},
    "blueberry": {"focus": "Soil and terrain are engineered out by the pot; the visit should confirm the engineering. Substrate source and age; fertigation water quality (pH, EC); drainage of pots and beds under heavy rain; the shade and cooling plan. Heat is the one variable the pot does not control, and the one El Niño amplifies first.",
                  "models": "The valley's annual mean sits inside the low-chill varieties' optimum, flat across every lot. Siting is thermally unconstrained at this scale; the gradients that matter are on Heat & frost.",
                  "y2040": "The curve edges toward its warm shoulder. Stable nights, the quality variable, are the asset."},
}
RISK = {
    "signature": {"moderate": ["+0.9 °C · rain ×0.5–1.5", "hot and mostly dry"], "strong": ["+1.0–1.2 °C · rain ×1–3", "heat-led · rain lottery"],
                  "extraordinary": ["+1.5 °C nights · rain ×3–10", "flood-led · 1998-class"]},
    "crops": {
        "avocado": {"perils": "Root asphyxia and Phytophthora after waterlogging; fruit set and drop from extreme-day heat.",
                    "yield": [[3, 8], [10, 25], [30, 60]], "inventory": [[0, 1], [1, 5], [5, 15]], "replacement": "3–4 years",
                    "inventory_note": "plant mortality at ~48–72 h of saturation, susceptible rootstock, no functioning drainage",
                    "reading": ["Most exposed asset.", "The largest share of the property, the highest waterlogging sensitivity, and the flood-exposed hectares concentrate at Chumbenique II-III, not at Cojal, which sits highest but runs warmest. Inventory loss at the extraordinary tier means 3–4 years to replacement."]},
        "mandarin": {"perils": "Gummosis and root asphyxia on heavy ground; rind puffing and delayed colour break from heat.",
                     "yield": [[3, 8], [10, 20], [25, 45]], "inventory": [[0, 1], [1, 5], [5, 10]], "replacement": "2–3 years",
                     "inventory_note": "plant mortality at ~48–72 h of saturation on heavy ground without drainage",
                     "reading": ["The exposure is uneven.", "Ana María carries the flood exposure while San Nicolás sits higher. Sunburn pressure appears only at the extraordinary tier, but then it covers a large share of the crop at once."]},
        "blueberry": {"perils": "Botrytis on flower and fruit under rain; soft fruit and smaller calibre from warm nights.",
                      "yield": [[3, 8], [5, 15], [15, 35]], "inventory": [[0, 1], [0, 1], [0, 3]], "replacement": "< 1 year",
                      "inventory_note": "bush loss, excluding infrastructure (pumping, fertigation lines, access)",
                      "reading": ["The pot is the insurance.", "Ground exposure is the highest of the three crops (the blueberry fundos hug the river) but the root sits in a drained substrate above it. Losses are yield and quality, not plants. The residual inventory risk is infrastructure: access roads, fertigation lines, pumping."]},
    },
}
TOLERANCE = {
    "avocado": {"heat_yield": "From 33 °C: fruit-set failure and early drop · severe from 35 °C (shoot & fruit damage)", "heat_plant": "Not from heat at this valley's magnitudes: tree loss comes from waterlogging (root asphyxia, Phytophthora after ~48–72 h)",
                "cold_yield": "Flower and fruitlet damage from −1 °C; foliage from −2 °C", "cold_plant": "Wood damage −4 °C; tree death near −5 / −6 °C sustained"},
    "mandarin": {"heat_yield": "From 34 °C: sunburn, rind puffing, delayed colour · severe from 36 °C (fruit loss)", "heat_plant": "Not from heat: citrus tolerates short 38–40 °C spikes; tree loss via gummosis / root asphyxia on saturated heavy ground",
                 "cold_yield": "Fruit damage from −2 °C on the tree", "cold_plant": "Wood damage −7 °C; tree death below −9 °C"},
    "blueberry": {"heat_yield": "From 32 °C: soft fruit, smaller calibre · severe from 34 °C; bloom abortion if ≥ 35 °C in flower", "heat_plant": "Not from heat while fertigation holds: bush loss needs sustained substrate failure",
                  "cold_yield": "Open flower damage from 0 °C; fruit set from −1 °C", "cold_plant": "Dormant wood hardy to −15 °C and below"},
}
WALK = [  # report p. 3 § 04 "Where we'd walk"
    {"fundos": ["CHUMBENIQUEIIIII"], "peril": "flood", "text": "The flood-critical fundo. Walk the drainage and the channel margin."},
    {"fundos": ["COJAL"], "peril": "heat", "text": "The inverse: highest ground of the avocado fundos, and the warmest. A placement trade-off, not a ranking."},
    {"fundos": ["ANAMARIA", "SANNICOLAS"], "peril": "flood", "text": "Same crop, different ground at a grain finer than 250 m, and very different flood exposure. Sample both; don't let one stand for mandarin."},
    {"fundos": ["LAHUMEDAD", "SANISMAEL", "VINAI", "VINAIV"], "peril": "infrastructure", "text": "The pot engineers out soil and terrain. Look at pumping, fertigation lines and access roads under water, not the bushes."},
]

# ------------------------------------------------------------------ phase 3 · underwriting and next steps (report p. 3, 24–25, 27)
UNDERWRITING = {
    "chain": [
        {"n": "01", "title": "Reanalysis & continuous monitoring", "text": "Decades of daily reconstruction, then live"},
        {"n": "02", "title": "Attribution", "text": "Which peril, how often, per crop × region"},
        {"n": "03", "title": "Trigger", "text": "An index and a threshold, backtested"},
        {"n": "04", "title": "Response", "text": "Defined, timed to the period of the shortfall"},
        {"n": "05", "title": "Structure · chosen with you", "text": "The chain does not care what sits at the end of it"},
    ],
    "structures": [["DSRA & advance rate sized to trigger frequency", True], ["Indexed covenant · pre-agreed step-down", True], ["Indexed debt-service schedule", True], ["Risk transfer · may come later", False]],
    "ways": [
        ["Sizing", "DSRA and advance rate calibrated to how often the trigger actually fires on this ground, instead of a generic haircut. Pure analysis, no instrument."],
        ["Covenant", "A pre-agreed DSCR step-down when the index fires, rather than a waiver negotiated under stress."],
        ["Schedule", "Debt service indexed to the season, so the bad year is bounded by design."],
    ],
    "rely": "The index is backtested against the same reanalysis window that built it, reconciled campaign by campaign before a threshold is fixed, and monitored continuously afterwards, so a covenant built on it can be watched, not just set.",
    "bring": "The index, the attribution and the backtest: the architecture. Which structure to hang on it, and whether any risk is ever transferred, is your decision and comes later.",
    "running": "The same reanalysis-to-trigger pipeline runs live for two crops in two countries.",
    "framing": "El Niño defence (drainage, bocatoma protection, phytosanitary stock) belongs in base-case capex, not the contingency line.",
    "datasets": [
        {"name": "Debt terms", "does": "DSCR sensitivity by scenario: base, strong, extraordinary", "owner": "responsAbility"},
        {"name": "Price series by crop", "does": "Revenue-at-risk per tier; heat marks fruit, so quality downgrades price as much as volume", "owner": "responsAbility"},
        {"name": "Yield history by lot", "does": "Calibrates the loss bands against observed campaigns, 2017 and 2023 in particular", "owner": "operator"},
        {"name": "Soil analyses", "does": "Pits and lab chemistry measure how far management has moved the soil from its 250 m baseline, and what it costs to hold it there", "owner": "operator"},
        {"name": "Nutrition and amendment programme", "does": "Sizes the amendment cost and its wash-out exposure under a wet event", "owner": "operator"},
        {"name": "Irrigation and water-rights documentation", "does": "ANA licences, wells, reservoirs, pumping and energy: water security under a hot, dry event", "owner": "seller"},
    ],
}
NEXT = {
    "columns": [
        {"id": "preview", "title": "Delivered in this preview", "status": "delivered", "note": "To be adjusted and re-run on the data shared on site: soil labs, weather-station records, varieties and rootstocks.",
         "items": [["Crop suitability", "Three crops scored 0–100 by climate, terrain and soil · 2026 and 2040 · initial soil read and pH-amended · weak spots to fundo level", "suit"],
                   ["Microclimates", "Relief-downscaled heat distributions against each crop's tolerance · frost margins · thermal structure by fundo", "heat"],
                   ["Risk assessment per crop · El Niño 2026-27", "Three probability-weighted scenarios per crop · flood- and heat-affected hectares · indicative loss bands", "exposure"]]},
        {"id": "full", "title": "Full due diligence · for the acquisition", "status": "proposed", "note": "Orchard, commercial and financial modules on the same data chain.",
         "items": [["Lot tree inventory & scorecard", "Total trees, health, age and tenure per hectare · production curve, current vs future · the gap between productive and polygon hectares", None],
                   ["Topography dynamics modelling", "Sun exposure, runoff and flash-flood pathways, waterlogging: hydraulic-grade refinement of the exposure bands", None],
                   ["Commercial", "Market research, competitive landscape and supply-chain mapping · yields and margins along the chain", None],
                   ["Parametric risk & insurance modelling", "Trigger design on ENFEN and rainfall indices: pricing El Niño transfer against retention", "underwriting"]]},
        {"id": "committee", "title": "Financial & structuring · for committee", "status": "proposed", "note": "The asset arrives at committee with a single data chain behind it.",
         "items": [["Revenue-at-risk & DSCR by scenario", "The scenario grids priced against debt terms, price series and yield history: base, strong, extraordinary", "underwriting"],
                   ["Climate-indexed structuring", "DSRA and advance rate sized to trigger frequency · indexed covenants · mitigation capex vs expected loss", "underwriting"],
                   ["Committee-ready financial legibility", "One model, one data chain, every figure traceable from satellite to cash flow", None]]},
        {"id": "monitoring", "title": "After close · continuous monitoring", "status": "proposed", "note": "Monitoring does not replace field validation: it directs it.",
         "items": [["Continuous platform, per asset", "Vegetation health and anomalies · continuous inventory and scorecard · farm vs regional benchmark · price reports · anomaly flags as each new image is processed", None]]},
    ],
    "requests": [  # what we cannot see (p. 3 § 03) + the data behind the debt-service view (p. 24)
        {"item": "Soil pits and lab chemistry", "why": "The binding constraint on two of three crops; the managed state vs the 250 m baseline", "owner": "operator", "moves": "suitability"},
        {"item": "Nutrition and amendment programme", "why": "Where and how pH is amended, at what cost per hectare per season, and its wash-out exposure", "owner": "operator", "moves": "suitability"},
        {"item": "Yield history by lot (2017 and 2023)", "why": "Turns the indicative loss bands into observed outcomes", "owner": "operator", "moves": "exposure"},
        {"item": "Varieties and rootstocks, with planting years", "why": "Every tolerance threshold is a literature range until they are named", "owner": "operator", "moves": "heat"},
        {"item": "Local weather-station records", "why": "Calibrates the reconstruction: cold-air pooling, Ciclón Yaku-type local rain", "owner": "operator", "moves": "heat"},
        {"item": "Water rights and source", "why": "Licences, allocation, wells and reservoir. An 84 mm valley is a water asset before it is a land asset", "owner": "seller", "moves": "underwriting"},
        {"item": "Irrigation and drainage documentation", "why": "Pumping, energy and drainage under a hot, dry event and under saturation", "owner": "seller", "moves": "exposure"},
        {"item": "Debt terms", "why": "DSCR sensitivity by scenario", "owner": "responsAbility", "moves": "underwriting"},
        {"item": "Price series by crop", "why": "Revenue-at-risk per tier; quality downgrades price as much as volume", "owner": "responsAbility", "moves": "underwriting"},
    ],
    "closing": "Monitoring does not replace field validation: it directs it.",
}

# ------------------------------------------------------------------ ENFEN (Comunicado Oficial 15-2026, 28 Aug 2026 · report annex A4)
enfen = {
    "comunicado": "Comunicado Oficial N.º 15-2026", "date": "2026-08-28", "next": "2026-09-14", "status": "Coastal El Niño Alert",
    "summer": [["La Niña / neutral", 0], ["Weak", 1], ["Moderate", 16], ["Strong", 40], ["Extraordinary", 43]],
    "monthly": [["Sep 26", 75, 25, 0, 0], ["Oct 26", 74, 26, 0, 0], ["Nov 26", 72, 26, 2, 0], ["Dec 26", 70, 27, 3, 0], ["Jan 27", 62, 29, 9, 0],
                ["Feb 27", 47, 37, 15, 1], ["Mar 27", 30, 34, 23, 13], ["Apr 27", 12, 25, 25, 38], ["May 27", 2, 10, 20, 68]],
    "nino34": "Very strong 44 % · strong 41 % · moderate 14 % · weak 1 % — peak intensity Nov–Dec 2026",
    "statements": [
        "≥ 62 % probability of extraordinary magnitude in Niño 1+2, Sep 2026 – Jan 2027; gradual transition to neutral toward autumn 2027",
        "≥ 58 % probability Niño 3.4 reaches very strong, Sep 2026 – Jan 2027",
        "Sep–Nov: air temperatures well above normal along the entire coast, with high probability of new records",
        "North coast: rains above normal, weak-to-moderate episodes from November; above-normal summer rainfall on the north and central coast",
    ],
}

YB = {
    "asOf": "2026-09", "asOfLabel": "September 2026",
    "place": "Valle de Zaña · Lambayeque, Peru", "preparedFor": "responsAbility",
    "bbox": [W, S, E, N], "crops": CROPS, "tiers": TIERS, "exposure": exposure,
    "lots": lots_fc, "fundos": fundos, "climate": climate, "seasons": seasons, "ranking": rank,
    "scenario2627": scenario, "enfen": enfen,
    "factors": factors, "soilRaw": soil_raw,
    # the final model discounts salinity and sodicity: the WISE30sec block over San Nicolás is a data artefact pending a field check
    "factorMeta": [{"id": a, "label": b, "group": g, "discounted": a in ("salinity", "sodicity")} for a, b, g in FACTORS],
    "thermal": thermal, "suitText": SUIT_TEXT, "risk": RISK, "tolerance": TOLERANCE, "walk": WALK,
    "underwriting": UNDERWRITING, "next": NEXT,
    "rainfall_mm": round(trends["precip_mm"]["mean"]),
    "sources": {
        "lots": "Yarabamba_lotes_produccion.kml (23 polygons; productive ha from the seller's planting frame)",
        "climate": "ERA5-Land daily over the lots, 1981–2025; CHIRPS v3 rainfall; 30 m relief-downscaled extremes",
        "soil": "SoilGrids / WISE at 250 m — the pre-management baseline; requires on-site validation",
        "flood": "Height above nearest Río Zaña channel (30 m DEM), stages 1.5 / 3 / 5 m anchored to the 1998 and 2017 footprints",
        "enfen": "ENFEN Comunicado Oficial N.º 15-2026, 28 Aug 2026 (enfen.imarpe.gob.pe)",
    },
}
with open(f"{OUT}/data.js", "w", encoding="utf-8") as f:
    f.write("// Generated by build_data.py — do not edit by hand.\nwindow.YB = ")
    json.dump(YB, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
with open(f"{OUT}/layers.js", "w", encoding="utf-8") as f:
    f.write("// Generated by build_data.py — map overlays as WebP data URLs, all on the valley grid YB.bbox.\nwindow.YB_LAYERS = ")
    json.dump(layers, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print(f"wrote data.js ({os.path.getsize(OUT + '/data.js') / 1e3:.0f} KB) and layers.js ({os.path.getsize(OUT + '/layers.js') / 1e6:.1f} MB)")

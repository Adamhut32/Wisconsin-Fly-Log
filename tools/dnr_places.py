#!/usr/bin/env python3
"""Boat landings, shore fishing sites and lake facts from the Wisconsin DNR, split into one small file per county.

  data/places/{county}.json = {
    "b": [[lat, lng, name, kind, ramp, ada, water, owner], ...]     boat landings (kind: RAMP / CARRY-IN / ...)
    "s": [[lat, lng, name, water, more_info_url], ...]              shore fishing sites
    "l": [[lat, lng, name, wbic, lake_class, acres, max_depth_ft, description, fisheries], ...]   lake facts
  }
Run by .github/workflows/dnr-places.yml (the cloud session can't reach dnrmaps.wi.gov; GitHub's runner can).
"""
import json, pathlib, sys, time, urllib.parse, urllib.request
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "places"
BASE = "https://dnrmaps.wi.gov/arcgis2/rest/services/"
BOAT = BASE + "PR_Recreation/PR_Boat_Access_Shore_Fishing_WTM_Ext/MapServer/"
LAKES = BASE + "FM_WFF/FM_WFF_LAKE_CLASSIFICATIONS_WTM_EXT/MapServer/0"
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)"}

def call(url, params, post=True):
    data = urllib.parse.urlencode({"f": "json", **params})
    for attempt in range(4):
        try:
            req = urllib.request.Request(url + "/query", data=data.encode(), headers=UA) if post else urllib.request.Request(url + "/query?" + data, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                out = json.load(r)
            if "error" in out: raise RuntimeError(out["error"])
            return out
        except Exception as e:
            if attempt == 3: raise
            time.sleep(4 * (attempt + 1))

def everything(url, extra, label):
    """Every feature of a layer. Tries the tidy way (ask for ids, fetch in chunks); if the server won't do that, pages through."""
    feats = []
    try:
        ids = sorted(call(url, {"where": "1=1", "returnIdsOnly": "true"})["objectIds"] or [])
        print(label, len(ids), "ids", flush=True)
        for i in range(0, len(ids), 100):
            feats += call(url, {"objectIds": ",".join(map(str, ids[i:i + 100])), "outFields": "*", "outSR": "4326", **extra})["features"]
    except Exception as e:
        print(label, "by ids failed:", e, "-> paging", flush=True); feats = []; off = 0
        while True:
            r = call(url, {"where": "1=1", "outFields": "*", "outSR": "4326", "resultOffset": off, "resultRecordCount": 500, "orderByFields": "OBJECTID", **extra})
            feats += r["features"]; off += len(r["features"])
            if not r["features"] or not r.get("exceededTransferLimit"): break
    print(label, len(feats), "features", flush=True)
    return feats

geo = json.load(open(ROOT / "data" / "geo.json"))
shapes = [shape(f["geometry"]) for f in geo["counties"]["features"]]
fips = [f["id"] for f in geo["counties"]["features"]]
tree = STRtree(shapes)
def county_at(lat, lng):
    p = Point(lng, lat)
    for i in tree.query(p):
        if shapes[i].contains(p): return fips[i]
    i = tree.nearest(p)                      # a landing a few feet outside the outline still belongs to the nearest county
    return fips[i] if shapes[i].distance(p) < 0.02 else None

clean = lambda v: (v.strip() or None) if isinstance(v, str) else v
r5 = lambda v: round(float(v), 5)
by = {}
slot = lambda c: by.setdefault(c, {"b": [], "s": [], "l": []})
sample = {}

boats = everything(BOAT + "2", {"returnGeometry": "true"}, "boat landings"); sample["boat"] = [f["attributes"] for f in boats[:5]]
for f in boats:
    a, g = f["attributes"], f.get("geometry") or {}
    lat, lng = (g.get("y") or a.get("LL_LAT_DD_AMT")), (g.get("x") or a.get("LL_LONG_DD_AMT"))
    if not lat or not lng or str(a.get("ABANDON_FLAG") or "").upper() in ("Y", "YES", "1", "TRUE"): continue
    c = county_at(lat, lng)
    if c: slot(c)["b"].append([r5(lat), r5(lng), clean(a.get("LMS_BOAT_LANDING_NAME")), clean(a.get("LANDING_TYPE_CODE")), clean(a.get("RAMP_TYPE_CODE")),
                               clean(a.get("ADA_ACCESSIBLE_FEATURE_CODE")), clean(a.get("WATERBODY_NAME_TEXT")), clean(a.get("OWNERSHIP_MANAGER_NAME_TEXT") or a.get("OWNERSHIP_NAME_TEXT"))])

shore = everything(BOAT + "1", {"returnGeometry": "true"}, "shore fishing"); sample["shore"] = [f["attributes"] for f in shore[:5]]
for f in shore:
    a, g = f["attributes"], f.get("geometry") or {}
    lat, lng = (g.get("y") or a.get("LL_LAT_DD_AMT")), (g.get("x") or a.get("LL_LONG_DD_AMT"))
    if not lat or not lng: continue
    c = county_at(lat, lng)
    if c: slot(c)["s"].append([r5(lat), r5(lng), clean(a.get("FACILITY_NAME_TEXT")), clean(a.get("WATERBODY_NAME_TEXT")), clean(a.get("MORE_INFO_URL"))])

try: lakes = everything(LAKES, {"returnGeometry": "true", "maxAllowableOffset": "0.002", "geometryPrecision": "4"}, "lakes")
except Exception as e: print("lakes with shapes failed:", e, flush=True); lakes = everything(LAKES, {"returnGeometry": "true"}, "lakes (full shapes)")
sample["lake"] = [f["attributes"] for f in lakes[:5]]
classes = {}
for f in lakes:
    a, rings = f["attributes"], (f.get("geometry") or {}).get("rings") or []
    if not rings: continue
    ring = max(rings, key=len); n = len(ring)
    lng, lat = sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
    c = county_at(lat, lng)
    classes[a.get("LAKE_CLASS")] = classes.get(a.get("LAKE_CLASS"), 0) + 1
    if c: slot(c)["l"].append([r5(lat), r5(lng), clean(a.get("LAKE_NAME")), a.get("WBIC"), clean(a.get("LAKE_CLASS")),
                               round(a["AREA_ACRES_"], 1) if a.get("AREA_ACRES_") else None, a.get("MAXDEP_FT"), clean(a.get("DESCRIPT")), clean(a.get("FISHERIES"))])

OUT.mkdir(parents=True, exist_ok=True)
for c, d in by.items():
    for k in d: d[k].sort(key=lambda r: (r[2] or "", r[0], r[1]))
    (OUT / f"{c}.json").write_text(json.dumps(d, separators=(",", ":"), ensure_ascii=False))
sample["counts"] = {"boat": len(boats), "shore": len(shore), "lakes": len(lakes), "counties": len(by), "lake_classes": classes,
                    "kinds": sorted({str(r[3]) for d in by.values() for r in d["b"]}), "ramps": sorted({str(r[4]) for d in by.values() for r in d["b"]}), "ada": sorted({str(r[5]) for d in by.values() for r in d["b"]}),
                    "lake_desc": sorted({str(r[7]) for d in by.values() for r in d["l"]})[:40], "lake_fish": sorted({str(r[8]) for d in by.values() for r in d["l"]})[:40]}
(ROOT / "tools" / "places_sample.json").write_text(json.dumps(sample, indent=1, default=str))
print(json.dumps(sample["counts"], default=str)[:3000])

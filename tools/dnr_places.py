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

def everything(url, extra, label, fields="*"):
    """Every feature of a layer: ask for the ids, then fetch them in small chunks. Some DNR layers refuse the id list;
    for those, page through with an offset instead."""
    feats = []
    try:
        ids = sorted(call(url, {"where": "1=1", "returnIdsOnly": "true"})["objectIds"] or [])
        print(label, len(ids), "ids", flush=True)
        for i in range(0, len(ids), 100):
            feats += call(url, {"objectIds": ",".join(map(str, ids[i:i + 100])), "outFields": fields, **extra})["features"]
    except Exception as e:
        print(label, "id list refused (" + str(e)[:80] + "); paging instead", flush=True)
        feats, off = [], 0
        while True:
            page = call(url, {"where": "1=1", "outFields": fields, "orderByFields": "OBJECTID", "resultOffset": str(off), "resultRecordCount": "500", **extra})["features"]
            feats += page; off += len(page)
            if len(page) < 500: break
    print(label, len(feats), "features", flush=True)
    return feats

def first_that_works(sources, extra, label, fields):
    """The DNR publishes some layers in more than one place; use the first that answers with any features."""
    for url in sources:
        for f in (fields, "*"):
            try:
                got = everything(url, extra, label, f)
                if got: print(label, "from", url, flush=True); return got
            except Exception as e: print(label, "failed at", url, str(e)[:120], flush=True)
    return []

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
slot = lambda c: by.setdefault(c, {"b": [], "s": [], "l": [], "k": []})
sample = {}

LF_BOAT = "https://dnrmaps.wi.gov/arcgis/rest/services/LF_DML/LF_DNR_BOAT_BoatAccess_WTM_Ext/MapServer/"
boats = first_that_works([LF_BOAT + "8", LF_BOAT + "5", LF_BOAT + "2", BOAT + "2"], {"returnGeometry": "true", "outSR": "4326"}, "boat landings",
    "LMS_BOAT_LANDING_NAME,LANDING_TYPE_CODE,RAMP_TYPE_CODE,ADA_ACCESSIBLE_FEATURE_CODE,OWNERSHIP_NAME_TEXT,LL_LAT_DD_AMT,LL_LONG_DD_AMT,WATERBODY_NAME_TEXT,COUNTY_NAME_TEXT,ABANDON_FLAG")
sample["boat"] = [f["attributes"] for f in boats[:5]]
for f in boats:
    a, g = f["attributes"], f.get("geometry") or {}
    lat, lng = (a.get("LL_LAT_DD_AMT") or g.get("y")), (a.get("LL_LONG_DD_AMT") or g.get("x"))
    if not lat or not lng or not (42 < lat < 48 and -93.5 < lng < -86) or str(a.get("ABANDON_FLAG") or "").upper() in ("Y", "YES", "1", "TRUE"): continue
    c = county_at(lat, lng)
    if c: slot(c)["b"].append([r5(lat), r5(lng), clean(a.get("LMS_BOAT_LANDING_NAME")), clean(a.get("LANDING_TYPE_CODE")), clean(a.get("RAMP_TYPE_CODE")),
                               clean(a.get("ADA_ACCESSIBLE_FEATURE_CODE")), clean(a.get("WATERBODY_NAME_TEXT")), clean(a.get("OWNERSHIP_MANAGER_NAME_TEXT") or a.get("OWNERSHIP_NAME_TEXT"))])

shore = first_that_works([BOAT + "1", LF_BOAT + "7", LF_BOAT + "4"], {"returnGeometry": "false"}, "shore fishing", "FACILITY_NAME_TEXT,WATERBODY_NAME_TEXT,COUNTY_NAME_TEXT,LL_LAT_DD_AMT,LL_LONG_DD_AMT,MORE_INFO_URL")

# DNR parking lots (the lots at DNR lands, landings and easements): "k": [[lat, lng, name, note], ...]
lots = first_that_works([LF_BOAT + "6", LF_BOAT + "3"], {"returnGeometry": "true", "outSR": "4326"}, "DNR parking lots", "PARKING_LOT_NAME,PARKING_LOT_DESC,LOCATION_DESC,LMS_PARKING_GIS_MAP_STATUS")
sample["parking"] = [f["attributes"] for f in lots[:5]]
for f in lots:
    a, g = f["attributes"], f.get("geometry") or {}
    lat, lng = g.get("y"), g.get("x")
    if not lat or not lng or not (42 < lat < 48 and -93.5 < lng < -86): continue
    c = county_at(lat, lng)
    note = clean(a.get("PARKING_LOT_DESC")) or clean(a.get("LOCATION_DESC"))
    if c: slot(c)["k"].append([r5(lat), r5(lng), clean(a.get("PARKING_LOT_NAME")), (note or "")[:160] or None])
sample["shore"] = [f["attributes"] for f in shore[:5]]
for f in shore:
    a, g = f["attributes"], f.get("geometry") or {}
    lat, lng = (g.get("y") or a.get("LL_LAT_DD_AMT")), (g.get("x") or a.get("LL_LONG_DD_AMT"))
    if not lat or not lng: continue
    c = county_at(lat, lng)
    if c: slot(c)["s"].append([r5(lat), r5(lng), clean(a.get("FACILITY_NAME_TEXT")), clean(a.get("WATERBODY_NAME_TEXT")), clean(a.get("MORE_INFO_URL"))])

LF = "LAKE_NAME,WBIC,LAKE_CLASS,COUNTY,AREA_ACRES_,MAXDEP_FT,DESCRIPT,FISHERIES"
lakes = None
for extra in ({"returnGeometry": "true", "outSR": "4326", "maxAllowableOffset": "200", "geometryPrecision": "4"}, {"returnGeometry": "true", "outSR": "4326"}, {"returnGeometry": "false", "returnCentroid": "true", "outSR": "4326"}, {"returnGeometry": "false"}):
    try: lakes = everything(LAKES, extra, "lakes", LF); break
    except Exception as e: print("lakes attempt failed:", extra, e, flush=True)
if lakes is None: lakes = []
sample["lake"] = [f["attributes"] for f in lakes[:5]]
classes = {}; class_text = {}   # lake class -> [what it means, what the fishing is like]: the same words for every lake of a class
cname = {f["properties"]["name"].lower(): f["id"] for f in geo["counties"]["features"]}
for f in lakes:
    a, g = f["attributes"], f.get("geometry") or {}
    rings = g.get("rings") or []; cen = f.get("centroid") or {}
    lat = lng = None
    if rings: ring = max(rings, key=len); n = len(ring); lng, lat = sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
    elif cen.get("x") is not None: lng, lat = cen["x"], cen["y"]
    c = county_at(lat, lng) if lat is not None and abs(lat) <= 90 else cname.get(str(a.get("COUNTY") or "").lower().replace(" county", "").strip())
    classes[a.get("LAKE_CLASS")] = classes.get(a.get("LAKE_CLASS"), 0) + 1
    if c: slot(c)["l"].append([r5(lat) if lat is not None and abs(lat) <= 90 else None, r5(lng) if lat is not None and abs(lat) <= 90 else None, clean(a.get("LAKE_NAME")), a.get("WBIC"), clean(a.get("LAKE_CLASS")),
                               round(a["AREA_ACRES_"], 1) if a.get("AREA_ACRES_") else None, a.get("MAXDEP_FT")])
    k = clean(a.get("LAKE_CLASS"))
    if k and k not in class_text and (a.get("DESCRIPT") or a.get("FISHERIES")): class_text[k] = [clean(a.get("DESCRIPT")), clean(a.get("FISHERIES"))]

OUT.mkdir(parents=True, exist_ok=True)
for c, d in by.items():
    for k in d: d[k].sort(key=lambda r: (r[2] or "", r[0] or 0, r[1] or 0))
    (OUT / f"{c}.json").write_text(json.dumps(d, separators=(",", ":"), ensure_ascii=False))
if class_text: (ROOT / "data" / "lakeclasses.json").write_text(json.dumps(class_text, separators=(",", ":"), ensure_ascii=False))
sample["counts"] = {"boat": len(boats), "shore": len(shore), "parking": len(lots), "lakes": len(lakes), "counties": len(by), "lake_classes": classes,
                    "kinds": sorted({str(r[3]) for d in by.values() for r in d["b"]}), "ramps": sorted({str(r[4]) for d in by.values() for r in d["b"]}), "ada": sorted({str(r[5]) for d in by.values() for r in d["b"]})}
(ROOT / "tools" / "places_sample.json").write_text(json.dumps(sample, indent=1, default=str))
print(json.dumps(sample["counts"], default=str)[:3000])

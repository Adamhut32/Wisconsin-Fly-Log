#!/usr/bin/env python3
"""DNR fish stocking records for the last three posted years, one file per county:
  data/stocking/{county}.json = [[year, water, wbic, local_name, species, strain, age_class, number, avg_length_in], ...]
Source: the DNR's public Fish Stocking Summary (apps.dnr.wi.gov/fisheriesmanagement/Public/Summary), the same data its own
CSV button exports. The DNR posts each year's records once a year after checking them, so this changes about once a year.
One request per county per year, a second apart, to stay light on the DNR's server."""
import json, pathlib, sys, time, urllib.parse, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "stocking"; PROBE = ROOT / "tools" / "probe"; PROBE.mkdir(parents=True, exist_ok=True)
BASE = "https://apps.dnr.wi.gov/fisheriesmanagement/Public/Summary/"
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*"}
def call(path, data=None, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(BASE + path, data=urllib.parse.urlencode(data).encode() if data is not None else None, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            if attempt == tries - 1: raise
            time.sleep(5 * (attempt + 1))
def first(d, *words):
    for k, v in d.items():
        if all(w in k.upper() for w in words): return v
def listing(path):
    for data in (None, {}):
        try:
            r = call(path, data, tries=2)
            (PROBE / (path + ".json")).write_text(json.dumps(r)[:4000])
            return r if isinstance(r, list) else r.get("data") or r.get("Data") or list(r.values())[0]
        except Exception as e: err = e
    raise err
years_raw, counties_raw = listing("GetStockingYears"), listing("GetCounties")
def val(x, *words):
    if isinstance(x, dict): return first(x, *words) if first(x, *words) is not None else first(x, "VALUE") if words[0] != "NAME" else (first(x, "NAME") or first(x, "TEXT"))
    return x
years = sorted({int(str(val(y, "YEAR")).strip()) for y in years_raw if str(val(y, "YEAR")).strip().isdigit()}, reverse=True)[:3]
geo = json.load(open(ROOT / "data" / "geo.json")); fips = {f["properties"]["name"].lower().replace(".", "").replace(" ", ""): f["id"] for f in geo["counties"]["features"]}
counties = []
for c in counties_raw:
    code = val(c, "CODE") if isinstance(c, dict) else c; name = (first(c, "NAME") or first(c, "TEXT")) if isinstance(c, dict) else c
    key = str(name or "").lower().replace("county", "").replace(".", "").replace(" ", "")
    if key in fips: counties.append((str(code), fips[key], name))
print("years", years, "| counties matched", len(counties), "of", len(counties_raw), flush=True)
if not years or len(counties) < 60: sys.exit("Couldn't read the DNR's year or county lists; see tools/probe/")
OUT.mkdir(parents=True, exist_ok=True); total = 0; sample = None
num = lambda v: (int(float(v)) if v not in (None, "") and float(v) == int(float(v)) else float(v)) if str(v).replace(".", "", 1).replace("-", "", 1).isdigit() else None
for code, fid, name in counties:
    rows = []
    for y in years:
        d = {"draw": 1, "start": 0, "length": 5000, "STOCKING_YEAR": y, "SPECIES_NAME": "", "COUNTY_CODE": code, "STOCKED_WB_NAME": "", "STOCKED_WB_WBIC": "", "LOCAL_WB_NAME": ""}
        r = call("LoadResults", d)
        if sample is None: sample = r; (PROBE / "LoadResults.json").write_text(json.dumps(r)[:6000])
        for x in (r.get("data") or r.get("Data") or []):
            rows.append([int(x.get("STOCKING_YEAR") or y), (x.get("STOCKED_WB_NAME") or "").strip(), x.get("STOCKED_WBIC"), (x.get("LOCAL_WB_NAME") or "").strip() or None,
                         (x.get("SPECIES_NAME") or "").strip().title(), (x.get("STOCK_NAME") or "").strip() or None, (x.get("AGE_CLASS") or "").strip().title() or None,
                         num(x.get("SUM_FISH_STOCKED_NUMBER")), num(x.get("AVERAGE_FISH_LENGTH_INCHES"))])
        time.sleep(1)
    rows.sort(key=lambda r: (-r[0], r[1], r[4]))
    (OUT / f"{fid}.json").write_text(json.dumps(rows, separators=(",", ":"), ensure_ascii=False)); total += len(rows)
    print(name, len(rows), flush=True)
print("total stocking rows", total)

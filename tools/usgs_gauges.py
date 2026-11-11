#!/usr/bin/env python3
"""The list of Wisconsin stream gauges that report flow right now: data/gauges.json = [[id, name, lat, lng, drainage_sq_mi], ...].
The app reads live flows straight from the USGS; this file only gives each gauge its name and place, so it changes rarely."""
import json, pathlib, time, urllib.parse, urllib.request, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/"
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)"}
def get(path, params):
    url = API + path + "?" + urllib.parse.urlencode({"f": "json", **params})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return json.load(r)
        except Exception:
            if attempt == 5: raise
            time.sleep(8 * (attempt + 1))
latest = get("latest-continuous/items", {"state_name": "Wisconsin", "parameter_code": "00060", "limit": 5000, "properties": "monitoring_location_id,time,value"})["features"]
cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)).isoformat()
live = {}
for f in latest:
    p, g = f["properties"], f.get("geometry")
    if g and p.get("time", "") >= cut: live[p["monitoring_location_id"]] = g["coordinates"]
ids = sorted(live); names = {}
for i in range(0, len(ids), 40):
    for f in get("monitoring-locations/items", {"id": ",".join(ids[i:i + 40]), "properties": "monitoring_location_name,drainage_area,site_type_code", "skipGeometry": "true", "limit": 200})["features"]:
        names[f["id"]] = f["properties"]
small = {"at", "near", "nr", "above", "below", "of", "on", "the", "and", "to"}
def title(s):
    s = (s or "").replace(", WI", "").replace(",WI", "").strip()
    out = []
    for i, w in enumerate(s.split()):
        lw = w.lower()
        out.append(lw if i and lw in small else w.upper() if lw in {"usgs", "sth", "cth", "ush", "ih", "ne", "nw", "se", "sw"} else lw.capitalize())
    return " ".join(out).replace(" Nr ", " near ").replace(" nr ", " near ").replace(" R ", " River ").replace(" Cr ", " Creek ")
rows = []
for i in ids:
    n = names.get(i)
    if not n or n.get("site_type_code") not in ("ST", "ST-CA", "ST-DCH", "ST-TS", None): continue
    lng, lat = live[i]
    rows.append([i, title(n.get("monitoring_location_name")), round(lat, 5), round(lng, 5), n.get("drainage_area")])
(ROOT / "data" / "gauges.json").write_text(json.dumps(rows, separators=(",", ":")))
print(len(latest), "latest readings;", len(rows), "live stream gauges;", rows[:3])

# What each gauge's flow normally is at each time of year: data/flownorms.json = {id: [[p10, p25, p75, p90], ... one per week]}.
# Kept in the app's own files so "low / normal / high for the date" works with no signal and doesn't lean on a second USGS service.
STATS = "https://api.waterdata.usgs.gov/statistics/v0/observationNormals"
def norms(gid):
    url = STATS + "?" + urllib.parse.urlencode({"monitoring_location_id": gid, "parameter_code": "00060", "computation_type": "percentile", "start_date": "01-01", "end_date": "12-31"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: d = json.load(r)
            break
        except Exception:
            if attempt == 3: return None
            time.sleep(6 * (attempt + 1))
    try: vals = d["features"][0]["properties"]["data"][0]["values"]
    except Exception: return None
    by_day = {}
    for v in vals:
        try:
            p = {int(float(k)): float(x) for k, x in zip(v["percentiles"], v["values"])}
            if int(v.get("sample_count") or 0) < 10: continue                      # under ten years on record: no fair "normal"
            mm, dd = map(int, v["time_of_year"].split("-")); doy = (datetime.date(2024, mm, dd) - datetime.date(2024, 1, 1)).days
            q = [p[10], p[25], p[75], p[90]]
            if any(x != x or x < 0 for x in q): continue                           # the service sends "NaN" for days it has no figure for
            by_day[doy] = q
        except Exception: continue
    if len(by_day) < 300: return None
    weeks = []
    for w in range(53):
        near = min(by_day, key=lambda d0: min(abs(d0 - (w * 7 + 3)), 366 - abs(d0 - (w * 7 + 3))))
        weeks.append([round(x, 1) if x < 100 else round(x) for x in by_day[near]])
    return weeks
out, tried = {}, 0
try: old = json.load(open(ROOT / "data" / "flownorms.json"))
except Exception: old = {}
for row in rows:
    try: n_ = norms(row[0])
    except Exception as e: print('norms failed for', row[0], e); n_ = None
    tried += 1
    if n_: out[row[0]] = n_
    elif row[0] in old: out[row[0]] = old[row[0]]                                   # keep last time's rather than lose a gauge to one bad request
    time.sleep(0.4)
if out: (ROOT / "data" / "flownorms.json").write_text(json.dumps(out, separators=(",", ":")))
print("flow norms for", len(out), "of", tried, "gauges")

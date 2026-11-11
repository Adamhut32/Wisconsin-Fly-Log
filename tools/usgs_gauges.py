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

#!/usr/bin/env python3
"""Where public roads cross trout streams: data/crossings/{county}.json = [[lat, lng, road, stream, trout_class], ...].
Roads: U.S. Census TIGER/Line (public domain). Streams: the app's own trout stream files (from the Wisconsin DNR).
Only named secondary and local public roads are kept (no interstates, ramps, private drives, parking lots or trails)."""
import io, json, math, pathlib, sys, time, urllib.request, zipfile
import shapefile
from shapely.geometry import LineString, MultiLineString, Point
from shapely.strtree import STRtree
ROOT = pathlib.Path(__file__).resolve().parent.parent
TROUT = ROOT / "data" / "water" / "trout"
OUT = ROOT / "data" / "crossings"; OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)"}
KEEP = {"S1200", "S1400"}
def roads(fips):
    for year in (2025, 2024):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://www2.census.gov/geo/tiger/TIGER{year}/ROADS/tl_{year}_{fips}_roads.zip", headers=UA), timeout=180) as r:
                z = zipfile.ZipFile(io.BytesIO(r.read()))
            base = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
            sf = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
            fields = [f[0] for f in sf.fields[1:]]; iN, iM = fields.index("FULLNAME"), fields.index("MTFCC")
            out = []
            for sr in sf.iterShapeRecords():
                name, kind = sr.record[iN], sr.record[iM]
                if kind in KEEP and name and len(sr.shape.points) > 1: out.append((name.strip(), LineString(sr.shape.points)))
            return out
        except Exception as e:
            err = e; time.sleep(3)
    raise err
total = 0; files = sorted(TROUT.glob("*.json"))
only = set(sys.argv[1:])
for fp in files:
    fips = fp.stem
    if only and fips not in only: continue
    t = json.load(open(fp)).get("t") or []
    segs = [(s[0], s[1], MultiLineString([p for p in s[4] if len(p) > 1])) for s in t if s[1] in (1, 2, 3) and s[4]]
    if not segs: (OUT / f"{fips}.json").write_text("[]"); continue
    rd = roads(fips); tree = STRtree([g for _, g in rd])
    pts = []
    for name, cls, geom in segs:
        for i in tree.query(geom):
            x = rd[i][1].intersection(geom)
            if x.is_empty: continue
            for g in (x.geoms if hasattr(x, "geoms") else [x]):
                if g.geom_type == "Point": pts.append((g.y, g.x, rd[i][0], name, cls))
                elif g.geom_type == "LineString" and g.length: c = g.interpolate(.5, normalized=True); pts.append((c.y, c.x, rd[i][0], name, cls))
    # one pin per crossing: drop points within ~40 m of one already kept on the same stream (divided roads, doubled lines)
    kept = []
    for p in sorted(pts, key=lambda p: (p[3] or "", p[0], p[1])):
        if any(q[3] == p[3] and math.hypot((q[0] - p[0]) * 111000, (q[1] - p[1]) * 111000 * math.cos(math.radians(p[0]))) < 40 for q in kept): continue
        kept.append(p)
    (OUT / f"{fips}.json").write_text(json.dumps([[round(p[0], 5), round(p[1], 5), p[2], p[3], p[4]] for p in kept], separators=(",", ":"), ensure_ascii=False))
    total += len(kept); print(fips, len(rd), "roads", len(segs), "trout stretches", len(kept), "crossings", flush=True)
print("total crossings", total)

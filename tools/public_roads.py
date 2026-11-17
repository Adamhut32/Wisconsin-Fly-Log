#!/usr/bin/env python3
"""Public roads for the map: data/roads/{county}.json = {"v":1, "r":[[name, cls, [line, ...]], ...]}.
Each line is a flat list of whole numbers: lat0, lng0 (degrees x 100000), then the change in lat, lng to each next point.
cls: 1 = interstate, US or state highway; 2 = county highway; 3 = other named public road.
Source: U.S. Census TIGER/Line roads (public domain). Kept: primary, secondary and named local roads (MTFCC S1100, S1200,
S1400). Left out: ramps, private drives, parking lots, alleys, trails and unnamed local roads.
Usage: python3 tools/public_roads.py [county FIPS ...]"""
import io, json, pathlib, re, sys, time, urllib.request, zipfile
import shapefile
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "roads"; OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)"}
TOL = 0.00007   # simplify to about 6-7 m: the line still sits on the road at the closest zoom
def fetch(fips):
    err = None
    for year in (2025, 2024):
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(f"https://www2.census.gov/geo/tiger/TIGER{year}/ROADS/tl_{year}_{fips}_roads.zip", headers=UA), timeout=180) as r:
                    return zipfile.ZipFile(io.BytesIO(r.read()))
            except Exception as e:
                err = e; time.sleep(3 + attempt * 5)
    raise err
def nice(name):
    n = re.sub(r"\s+", " ", name).strip()
    n = re.sub(r"^I- ?(\d+)", r"I-\1", n)
    n = re.sub(r"^US Hwy ", "US ", n)
    n = re.sub(r"^(State Hwy|State Rd|State Highway|Wis Hwy) ", "Hwy ", n)
    n = re.sub(r"^(Co Rd|Co Hwy|County Rd|County Road|County Hwy|Cty Rd|Cty Hwy) ", "County ", n)
    return n
def kind(mtfcc, name):
    if mtfcc == "S1100" or re.match(r"^(I-|US |Hwy )", name): return 1
    if name.startswith("County "): return 2
    return 2 if mtfcc == "S1200" else 3
def enc(coords):
    out, plat, plng = [], None, None
    for x, y in coords:
        la, ln = round(y * 1e5), round(x * 1e5)
        if plat is None: out += [la, ln]
        else:
            if la == plat and ln == plng: continue
            out += [la - plat, ln - plng]
        plat, plng = la, ln
    return out
def county(fips):
    z = fetch(fips)
    base = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
    sf = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
    fields = [f[0] for f in sf.fields[1:]]; iN, iM = fields.index("FULLNAME"), fields.index("MTFCC")
    groups = {}
    for sr in sf.iterShapeRecords():
        name, mt = (sr.record[iN] or "").strip(), sr.record[iM]
        if mt not in ("S1100", "S1200", "S1400") or len(sr.shape.points) < 2: continue
        if not name: continue
        n = nice(name); groups.setdefault((n, kind(mt, n)), []).append(LineString(sr.shape.points))
    rows, pts = [], 0
    for (n, k), lines in sorted(groups.items(), key=lambda g: (g[0][1], g[0][0])):
        m = linemerge(MultiLineString(lines)) if len(lines) > 1 else lines[0]
        parts = list(m.geoms) if hasattr(m, "geoms") else [m]
        out = []
        for g in parts:
            g = g.simplify(TOL, preserve_topology=False)
            e = enc(g.coords)
            if len(e) >= 4: out.append(e); pts += len(e) // 2
        if out: rows.append([n, k, out])
    (OUT / f"{fips}.json").write_text(json.dumps({"v": 1, "r": rows}, separators=(",", ":"), ensure_ascii=False))
    return len(rows), pts
if __name__ == "__main__":
    ids = sys.argv[1:] or sorted(p.stem for p in (ROOT / "data" / "water").glob("55*.json"))
    total = 0
    for fips in ids:
        try:
            n, p = county(fips); total += p
            print(fips, n, "roads", p, "points", (OUT / f"{fips}.json").stat().st_size // 1024, "KB", flush=True)
        except Exception as e:
            print(fips, "FAILED", e, flush=True)
    print("total points", total)

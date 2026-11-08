#!/usr/bin/env python3
"""Monthly DNR creek refresh for Coulee.

Downloads the Wisconsin DNR 24K flowlines (every named creek plus unnamed creeks with
tributaries), rebuilds the detailed per-county creek files, and compares them with the ones
the app uses now. Counties that changed are written to data-next/water/hd/ (unchanged ones are
copied as-is), so a test version can use them before the founder releases them to everyone.

Prints a one-line summary and writes it to $GITHUB_OUTPUT as changed=0/1 and note=...
Stops without writing anything if the download looks incomplete.
"""
import collections, concurrent.futures, json, os, pathlib, shutil, sys, time, urllib.parse, urllib.request
from shapely.geometry import shape, LineString, MultiLineString
from shapely.ops import linemerge
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIVE = ROOT / "data" / "water" / "hd"
NEXT = ROOT / "data-next" / "water" / "hd"
LAYER = "https://dnrmaps.wi.gov/arcgis2/rest/services/TS_AGOL_STAGING_SERVICES/EN_AGOL_STAGING_SurfaceWater_WTM/MapServer/2/query"
WHERE = "HYDROTYPE IN (503,508) AND (RIVER_SYS_NAME <> 'Unnamed' OR STREAM_ORDER >= 2)"
UA = {"User-Agent": "Coulee-map-refresh (GitHub Actions)"}

def call(params, post=False):
    data = urllib.parse.urlencode({"f": "json", **params}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(LAYER, data=data if post else None, headers=UA) if post else urllib.request.Request(LAYER + "?" + data.decode(), headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                out = json.load(r)
            if "error" in out: raise RuntimeError(out["error"])
            return out
        except Exception as e:
            if attempt == 5: raise
            time.sleep(5 * (attempt + 1))

def download():
    ids = sorted(call({"where": WHERE, "returnIdsOnly": "true"})["objectIds"])
    chunks = [ids[i:i + 400] for i in range(0, len(ids), 400)]
    def get(c):
        r = call({"objectIds": ",".join(map(str, c)), "outFields": "RIVER_SYS_NAME,STREAM_ORDER", "outSR": "4326",
                  "geometryPrecision": "5", "maxAllowableOffset": "0.00003", "returnGeometry": "true"}, post=True)
        return [(f["attributes"]["RIVER_SYS_NAME"], f["attributes"]["STREAM_ORDER"], (f.get("geometry") or {}).get("paths", [])) for f in r["features"]]
    feats = []
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        for part in ex.map(get, chunks): feats.extend(part)
    return ids, feats

def lines_of(g):
    if g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if hasattr(g, "geoms"): return [x for gg in g.geoms for x in lines_of(gg)]
    return []

def split(feats):
    counties = json.load(open(ROOT / "data" / "geo.json"))["counties"]["features"]
    cgeom = {f["id"]: shape(f["geometry"]).buffer(0.003) for f in counties}
    ids = list(cgeom); tree = STRtree([cgeom[i] for i in ids])
    streams = collections.defaultdict(lambda: collections.defaultdict(list)); orders = collections.defaultdict(dict)
    for name, order, paths in feats:
        paths = [p for p in paths if len(p) > 1]
        if not paths: continue
        name = "NA" if (not name or name in ("NA", "Unnamed")) else name
        g = MultiLineString(paths) if len(paths) > 1 else LineString(paths[0])
        for idx in tree.query(g):
            cid = ids[idx]; cg = cgeom[cid]
            part = g if cg.contains(g) else g.intersection(cg)
            ls = lines_of(part)
            if not ls: continue
            streams[cid][name].extend(ls); orders[cid][name] = max(orders[cid].get(name, 0), order or 0)
    out = {}
    for cid in ids:
        s_out = []
        for name, ls in sorted(streams[cid].items()):
            m = linemerge(MultiLineString(ls)) if len(ls) > 1 else ls[0]
            m = m.simplify(0.00001)
            paths = [[[round(c[0], 5), round(c[1], 5)] for c in l.coords] for l in lines_of(m)]
            paths = [p for p in paths if len(p) > 1]
            if paths: s_out.append([name, orders[cid][name], paths])
        s_out.sort(key=lambda x: (x[1], x[0]))
        out[cid] = s_out
    return out

def canon(s):
    """Same water regardless of the order the DNR returned it in."""
    rows = []
    for name, order, paths in s:
        ps = sorted(tuple(map(tuple, p)) if p[0] <= p[-1] else tuple(map(tuple, reversed(p))) for p in paths)
        rows.append((name, order, tuple(ps)))
    return sorted(rows)

def main():
    started = time.time()
    ids, feats = download()
    meta_path = LIVE / "_meta.json"
    meta = json.load(open(meta_path)) if meta_path.exists() else {}
    # sanity: never ship a partial download
    if len(feats) < len(ids) * 0.99 or (meta.get("features") and len(feats) < meta["features"] * 0.9):
        sys.exit(f"download looks incomplete: {len(feats)} of {len(ids)} pieces (last time {meta.get('features')})")
    new = split(feats)
    changed = []
    for cid, s in new.items():
        f = LIVE / f"{cid}.json"
        old = json.load(open(f))["s"] if f.exists() else None
        if old is None or canon(old) != canon(s): changed.append(cid)
    note = (f"DNR creek refresh: {len(changed)} of {len(new)} counties changed" if changed else "DNR creek refresh: no changes")
    print(note, f"({len(feats)} pieces, {round(time.time() - started)} s)")
    if changed:
        if NEXT.exists(): shutil.rmtree(NEXT)
        NEXT.mkdir(parents=True)
        for cid, s in new.items():
            if cid in changed: (NEXT / f"{cid}.json").write_text(json.dumps({"s": s}, separators=(",", ":")))
            else: shutil.copy(LIVE / f"{cid}.json", NEXT / f"{cid}.json")
        (NEXT / "_meta.json").write_text(json.dumps({"features": len(feats), "built": time.strftime("%Y-%m-%d"), "changed": changed}) + "\n")
    # record every check (also keeps the repo active so GitHub doesn't pause scheduled jobs)
    meta.update({"last_checked": time.strftime("%Y-%m-%d"), "last_result": note, "dnr_pieces": len(feats)})
    meta_path.write_text(json.dumps(meta) + "\n")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as o: o.write(f"changed={1 if changed else 0}\nnote={note}\n")

if __name__ == "__main__":
    main()

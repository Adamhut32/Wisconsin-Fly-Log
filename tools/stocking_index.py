"""Statewide index of DNR stocking by species, for "find water stocked with ..." in the app's search.
Reads data/stocking/55*.json (one file per county, written by dnr_stocking.py) and data/water/index.json,
writes data/stocking/index.json:  { "Brook Trout": [[name, county_fips, last_year, fish_in_last_3_years, wbic, matched], ...], ... }
`matched` is 1 when the name matches a creek or lake on the map in that county (so the app can fly to it)."""
import json, glob, pathlib, re, collections
ROOT = pathlib.Path(__file__).resolve().parent.parent
BAIT = {"Fathead Minnow", "White Sucker", "Golden Shiner", "Mottled Sculpin", "Starhead Topminnow", "Lake Chubsucker"}
norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("creek", "cr").replace("river", "r").replace("lake", "l"))
names = collections.defaultdict(dict)   # county -> normalized name -> display name
for name, places in json.load(open(ROOT / "data/water/index.json")):
    for p in places: names[p[0]][norm(name)] = name
out = collections.defaultdict(dict)
for f in sorted(glob.glob(str(ROOT / "data/stocking/55*.json"))):
    cid = pathlib.Path(f).stem
    for y, water, wbic, local, sp, strain, size, count, length in json.load(open(f)):
        if not water or water.upper().startswith("UNNAMED") or not sp or sp in BAIT: continue
        sp = re.sub(r"\s*\(.*\)$", "", sp).strip()
        disp = names[cid].get(norm(water)) or names[cid].get(norm(local or "")) 
        key = (disp or water.title(), cid)
        e = out[sp].setdefault(key, [key[0], cid, y, 0, wbic, 1 if disp else 0])
        e[2] = max(e[2], y); e[3] += int(count or 0)
idx = {sp: sorted(v.values(), key=lambda e: (-e[2], e[0])) for sp, v in sorted(out.items())}
(ROOT / "data/stocking/index.json").write_text(json.dumps(idx, separators=(",", ":"), ensure_ascii=False))
print({k: len(v) for k, v in idx.items()}, "| matched to the map:", sum(e[5] for v in idx.values() for e in v), "of", sum(len(v) for v in idx.values()))

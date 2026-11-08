
/* ---------- which creek or lake a catch came from, worked out from its location ---------- */
const WATER_NEAR_M = 200, LAKE_NEAR_M = 150, SUGGEST_M = 1200;
const countyBox = {};
for(const f of counties){ let a = 90, b = -180, c = -90, d = 180; const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for(const p of polys) for(const [x, y] of p[0]){ if(y < a) a = y; if(y > c) c = y; if(x < d) d = x; if(x > b) b = x; }
  countyBox[f.id] = [a - .006, d - .008, c + .006, b + .008]; }
// metres from a point to a segment, on a flat local projection (fine at creek scale)
function segDistM(lat, lng, p, q){
  const k = Math.cos(lat * Math.PI / 180) * 111320, m = 110540;
  const ax = (p[0] - lng) * k, ay = (p[1] - lat) * m, bx = (q[0] - lng) * k, by = (q[1] - lat) * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
async function watersNear(lat, lng){
  if(lat == null || lng == null) return [];
  const ids = counties.map(f => f.id).filter(id => { const [a, d, c, b] = countyBox[id]; return lat >= a && lat <= c && lng >= d && lng <= b; });
  const best = {};
  const note = (name, kind, dist) => { if(!name) return; const k = name.toLowerCase(); if(!best[k] || dist < best[k].dist) best[k] = { name, kind, dist }; };
  for(const id of ids){
    let w; try{ w = await getJSON(waterCache, dataUrl("water/" + id + ".json"), id); }catch(e){ continue; }
    for(const [name, , paths] of w.s || []) for(const path of paths) for(let i = 1; i < path.length; i++){
      const p = path[i - 1], q = path[i];
      if(Math.abs(p[1] - lat) > .02 && Math.abs(q[1] - lat) > .02) continue;
      const d = segDistM(lat, lng, p, q); if(d < SUGGEST_M) note(name, /river/i.test(name) ? "River" : "Creek", d);
    }
    for(const [name, , rings] of w.l || []){
      for(const ring of rings){
        if(ring.length > 2 && pipRing(lng, lat, ring)){ note(name, waterType(name), 0); continue; }
        for(let i = 1; i < ring.length; i++){ const p = ring[i - 1], q = ring[i];
          if(Math.abs(p[1] - lat) > .02) continue;
          const d = segDistM(lat, lng, p, q); if(d < SUGGEST_M) note(name, waterType(name), d); }
      }
    }
  }
  return Object.values(best).sort((a, b) => a.dist - b.dist);
}
// the water to label the catch with: the nearest one, if it's close enough
function pickWater(list){ const w = list[0]; if(!w) return null; return w.dist <= (/creek|river/i.test(w.kind) ? WATER_NEAR_M : LAKE_NEAR_M) ? w : null; }
const distTxt = m => m < 15 ? "right on it" : m < 300 ? `about ${Math.round(m * 3.281 / 10) * 10} ft away` : `about ${(m / 1609).toFixed(1)} mi away`;

/* catch form: fill Water whenever the location changes, unless the angler typed their own */
let waterTouched = false, waterReq = 0;
$("fWaterName").addEventListener("input", () => { waterTouched = true; $("waterHint").textContent = ""; });
async function updateWaterFromCoords(){
  if(formKind !== "catch") return;
  const c = parseCoords($("fCoords").value), my = ++waterReq;
  if(!c){ $("waterNear").innerHTML = ""; if(!waterTouched) $("waterHint").textContent = ""; return; }
  const list = await watersNear(c.lat, c.lng);
  if(my !== waterReq) return;
  $("waterNear").innerHTML = list.slice(0, 8).map(w => `<option value="${esc(w.name)}">${esc(w.kind)} · ${esc(distTxt(w.dist))}</option>`).join("");
  if(waterTouched) return;
  const w = pickWater(list), h = $("waterHint");
  if(w){ $("fWaterName").value = w.name; h.className = "hint ok"; h.textContent = `From the location: ${w.dist < 15 ? "on" : distTxt(w.dist).replace("away", "from")} ${w.name}.`; }
  else { $("fWaterName").value = ""; h.className = "hint"; h.textContent = list.length ? `Nearest named water is ${list[0].name}, ${distTxt(list[0].dist)}. Type it in if that's where you were.` : countyAt(c.lat, c.lng) ? "No named creek or lake right here. Type one in if you like." : ""; }
}
$("fCoords").addEventListener("input", () => { clearTimeout(updateWaterFromCoords._t); updateWaterFromCoords._t = setTimeout(updateWaterFromCoords, 300); });

/* older catches get their water filled in quietly, a few at a time */
let waterBackfilling = false;
async function backfillWaters(){
  if(waterBackfilling || !me) return; waterBackfilling = true;
  try{
    const done = lsGet("fl.waterTried", {});
    const todo = catches.filter(c => !c.water && c.lat != null && c.county && !done[c.id] && !c._pending).slice(0, 15);
    for(const c of todo){
      done[c.id] = 1;
      const w = pickWater(await watersNear(+c.lat, +c.lng));
      if(w) await saveRecord("catches", { ...c, water:w.name }, null, true);
    }
    lsSet("fl.waterTried", done);
  }catch(e){ console.warn("waters", e); } finally { waterBackfilling = false; }
}

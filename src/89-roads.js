/* ---------- public roads: Coulee's own lines from the Census road files, drawn in the map's style ----------
   (Build 38 laid a picture layer of roads from an outside map service over the map: blurry text that clashed with the
   creek names, extra downloads that slowed the map, and nothing offline.) These are real lines, loaded per county like
   public land, sharp at any zoom, saved with a county for offline use, and named with the map's own lettering.
   Highways and county roads show from zoom 10.5, every other named public road from zoom 12. Topo already has roads. */
pane("roads", 397, false);
var ROAD_ZOOM = 10.5, LOCAL_ROAD_ZOOM = 12, roadCache = {}, roadGroups = {}, roadItems = {}, roadOn = new Set(), roadSeq = 0, roadR = null;
var showRoads = lsGet("fl.roads", true);
function decodeRoad(a){ const out = []; let la = 0, ln = 0; for(let i = 0; i + 1 < a.length; i += 2){ la += a[i]; ln += a[i+1]; out.push([la / 1e5, ln / 1e5]); } return out; }
function roadWeight(k, z){ return k === 1 ? (z >= 14 ? 3.4 : z >= 12 ? 2.6 : 2) : k === 2 ? (z >= 14 ? 2.6 : z >= 12 ? 2 : 1.5) : (z >= 15 ? 2 : z >= 13.5 ? 1.5 : 1); }
function roadStyle(k, z){
  const w = roadWeight(k, z);
  if(mapView === "sat") return { color: k === 3 ? "rgba(255,255,255,.5)" : "rgba(255,240,205,.78)", weight: w * .8 };
  return { color: css(k === 3 ? "--road" : "--road-major"), weight: w };
}
function buildRoads(id, d){
  roadR ||= L.canvas({ pane:"roads", padding:canvasPad() });
  const by = { 1:[], 2:[], 3:[] }, items = [];
  for(let [name, k, lines] of d.r || []){ name = name.replace(/^County ([A-Za-z]{1,3})$/, (m, x) => "County " + x.toUpperCase()); const ll = lines.map(decodeRoad); by[k]?.push(...ll); items.push({ name, k, lines:ll }); }
  roadItems[id] = items;
  const z = map.getZoom(), g = { group:L.layerGroup(), parts:{} };
  for(const k of [1, 2, 3]) if(by[k].length) g.parts[k] = L.polyline(by[k], { renderer:roadR, interactive:false, lineCap:"round", lineJoin:"round", smoothFactor:1.5, ...roadStyle(k, z) });
  return g;
}
async function syncRoadLines(){
  const seq = ++roadSeq, z = map.getZoom();
  const want = new Set(showRoads && mapView !== "topo" && z >= ROAD_ZOOM ? [...areaWant, currentCounty].filter(Boolean) : []);
  for(const id of [...roadOn]) if(!want.has(id)){ roadGroups[id].group.remove(); roadOn.delete(id); }
  await Promise.all([...want].map(async id => {
    if(!roadGroups[id]){ let d; try{ d = await getJSON(roadCache, dataUrl("roads/" + id + ".json"), id); }catch(e){ return; } await new Promise(r => setTimeout(r, 40)); if(seq !== roadSeq) return; roadGroups[id] ||= buildRoads(id, d); }   // let the creeks and land draw first
    if(seq !== roadSeq) return;
    if(!roadOn.has(id)){ roadGroups[id].group.addTo(map); roadOn.add(id); }
  }));
  if(seq !== roadSeq) return;
  // local roads only up close; widths follow the zoom
  for(const id of roadOn){ const g = roadGroups[id];
    for(const k of [1, 2, 3]){ const p = g.parts[k]; if(!p) continue;
      const on = k < 3 || z >= LOCAL_ROAD_ZOOM;
      if(on && !g.group.hasLayer(p)) g.group.addLayer(p); else if(!on && g.group.hasLayer(p)) g.group.removeLayer(p);
      if(on){ const st = roadStyle(k, z); if(p.options.weight !== st.weight || p.options.color !== st.color) p.setStyle(st); } } }
  // nothing to draw: give the drawing memory back (iPhone caps it; see dropCanvas)
  if(!roadOn.size && roadR){ dropCanvas(roadR); roadR = null; roadGroups = {}; roadItems = {}; }
  drawLabels();
  const b = $("roadsToggle"); if(b){ b.setAttribute("aria-pressed", String(showRoads)); b.textContent = showRoads ? "Roads on" : "Roads off"; b.hidden = mapView === "topo"; }
}
document.addEventListener("mapsettled", syncRoadLines);
document.addEventListener("mapview", () => { for(const id of roadOn) for(const k of [1, 2, 3]) roadGroups[id].parts[k]?.setStyle(roadStyle(k, map.getZoom())); syncRoadLines(); });
$("roadsToggle").onclick = () => { showRoads = !showRoads; lsSet("fl.roads", showRoads); syncRoadLines(); };
syncRoadLines();
/* Road names: drawn after creek and lake names (those win any overlap), straight along the longest stretch of road on screen,
   highways and county roads from zoom 12.5, other roads from zoom 14. Called from renderLabels. */
function roadLabels(ctx, o){
  const z = map.getZoom(); if(!roadOn || !roadOn.size || z < 12.5) return;
  const sat = mapView === "sat";
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `600 ${z >= 15 ? 11.5 : 10.5}px "Source Sans 3", "Segoe UI", system-ui, sans-serif`;
  const fill = sat ? "#FFFFFF" : css("--road-ink"), halo = sat ? "rgba(20,20,16,.75)" : css("--land");
  const done = new Set(), list = [];
  for(const id of roadOn) for(const r of roadItems[id] || []) if(r.k < 3 || z >= 14) list.push(r);
  list.sort((a, b) => a.k - b.k);
  let n = 0;
  for(const r of list){
    if(done.has(r.name) || n > 60) continue;
    const tw = ctx.measureText(r.name).width + 10;
    let best = null, bestLen = 0;
    for(const line of r.lines){
      const m = merc(line), a = m.a;
      if(m.x1 * o.scale - o.ox < 0 || m.x0 * o.scale - o.ox > o.W || m.y1 * o.scale - o.oy < 0 || m.y0 * o.scale - o.oy > o.H) continue;
      for(let i = 0; i + 3 < a.length; i += 2){
        const x1 = a[i] * o.scale - o.ox, y1 = a[i+1] * o.scale - o.oy, x2 = a[i+2] * o.scale - o.ox, y2 = a[i+3] * o.scale - o.oy;
        const len = Math.hypot(x2 - x1, y2 - y1); if(len < tw + 12 || len <= bestLen) continue;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; if(!o.onScreen({ x:mx, y:my })) continue;
        best = { mx, my, ang:Math.atan2(y2 - y1, x2 - x1) }; bestLen = len;
      }
    }
    if(!best) continue;
    let ang = best.ang; if(ang > Math.PI / 2) ang -= Math.PI; if(ang < -Math.PI / 2) ang += Math.PI;
    const cos = Math.abs(Math.cos(ang)), sin = Math.abs(Math.sin(ang)), hw = tw / 2, hh = 7;
    const box = { x:best.mx - (hw * cos + hh * sin), y:best.my - (hw * sin + hh * cos), w:2 * (hw * cos + hh * sin), h:2 * (hw * sin + hh * cos) };
    if(o.hits(box)) continue;
    o.placed.push(box); done.add(r.name); n++;
    ctx.translate(best.mx, best.my); ctx.rotate(ang);
    ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(r.name, 0, 0);
    ctx.fillStyle = fill; ctx.fillText(r.name, 0, 0);
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  }
  ctx.restore();
}

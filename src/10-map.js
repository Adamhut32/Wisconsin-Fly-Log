const map = L.map("map", { zoomControl:true, attributionControl:false, minZoom:6, maxZoom:18, zoomSnap:0.25, preferCanvas:false });
map.zoomControl.setPosition("topright");
const wiBounds = L.geoJSON(GEO.counties).getBounds();
map.setMaxBounds(wiBounds.pad(0.6));

/* pane stack, bottom to top: base 380 · counties 400 · water 420 · state line 425 · mask 428 · detail 430 · labels 440 */
const pane = (n, z, pe) => { map.createPane(n); const p = map.getPane(n); p.style.zIndex = z; if(pe === false) p.style.pointerEvents = "none"; return p; };
pane("base", 380, false); pane("water", 420, false); pane("stateline", 425, false); pane("mask", 428, false); pane("detail", 430);
pane("nearby", 426, false);
let detailRenderer = null, nearbyRenderer = null, nearbyLayer = null;

/* graticule — every half degree, like a printed field map */
const gratLayer = L.layerGroup([]).addTo(map);
for(let x = -95; x <= -85; x += .5) gratLayer.addLayer(L.polyline([[41,x],[48.5,x]], { pane:"base", interactive:false, color:css("--grid"), weight:.6 }));
for(let y = 41; y <= 48.5; y += .5) gratLayer.addLayer(L.polyline([[y,-95],[y,-85]], { pane:"base", interactive:false, color:css("--grid"), weight:.6 }));
const neighborLayer = L.geoJSON(GEO.neighbors, { pane:"base", interactive:false, style:()=>({ color:css("--county-edge"), weight:.8, fillColor:css("--paper-2"), fillOpacity:1 }) }).addTo(map);
const NEIGHBOR_NAMES = [["MINNESOTA",45.2,-93.15],["IOWA",42.75,-91.75],["ILLINOIS",42.2,-89.2],["MICHIGAN",46.3,-87.6]];
const neighborNames = L.layerGroup(NEIGHBOR_NAMES.map(([n,la,ln]) => L.marker([la,ln], { interactive:false, keyboard:false, pane:"base", icon:L.divIcon({ className:"", html:`<div class="sname">${n}</div>`, iconSize:[0,0] }) }))).addTo(map);
const stateFill = L.geoJSON(GEO.state, { pane:"base", interactive:false, className:"state-shadow", style:()=>({ stroke:false, fillColor:css("--land"), fillOpacity:1 }) }).addTo(map);
const lakeLayer = L.geoJSON(GEO.lakes, { pane:"water", interactive:false, style:()=>({ color:css("--water"), weight:.6, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" }) }).addTo(map);
const rippleLayer = L.layerGroup(GEO.ripples.map(r => L.polyline(r.map(p=>[p[1],p[0]]), { pane:"water", interactive:false, color:css("--water"), weight:.7, opacity:.45 }))).addTo(map);
const stateLine = L.geoJSON(GEO.state, { pane:"stateline", interactive:false, style:()=>({ color:css("--ink"), weight:2.2, fill:false }) }).addTo(map);

/* fishing regions — faint tint and a dashed edge, statewide only */
const REGION_TINT = { "Driftless Area":"--r-drift", "Northwoods":"--r-north", "Central Sands":"--r-sands" };
const regionLayer = L.geoJSON(GEO.regions, { pane:"base", interactive:false, style:f=>({ color:css(REGION_TINT[f.properties.name]), weight:1.2, dashArray:"5 4", fillColor:css(REGION_TINT[f.properties.name]), fillOpacity:.16 }) }).addTo(map);
const REGION_AT = { "Driftless Area":[43.55,-90.55], "Northwoods":[45.95,-89.9], "Central Sands":[44.2,-89.45] };
const regionNames = L.layerGroup(Object.entries(REGION_AT).map(([n,p]) => L.marker(p, { interactive:false, keyboard:false, pane:"stateline", icon:L.divIcon({ className:"", html:`<div class="rname" style="color:var(${REGION_TINT[n]}-ink)">${n}</div>`, iconSize:[0,0] }) }))).addTo(map);

let countyLayer;
function countyStyle(f){
  const s = countyStats(f.id);
  const max = Math.max(1, ...counties.map(c => countyStats(c.id).fish));
  const heat = (s.fish ? 0.2 + 0.45 * (s.fish / max) : (s.spots ? 0.14 : 0)) * (map.getZoom() >= 9.5 ? 0.25 : 1);
  if(currentCounty === f.id) return { color: css("--ink"), weight: 2.4, fillColor: css("--land"), fillOpacity: 0 };
  return { color: css("--county-edge"), weight: 0.8, fillColor: s.fish ? css("--fish") : css("--spot"), fillOpacity: heat };
}
countyLayer = L.geoJSON(GEO.counties, {
  style: countyStyle,
  onEachFeature: (f, layer) => {
    layer.on("click", e => { if(picking){ handlePick(e.latlng); return; } if(currentCounty === f.id) return; openCounty(f.id); });
    layer.on("mouseover", () => { if(currentCounty === f.id) return; layer.setStyle({ fillColor:css("--hl"), fillOpacity:.5, color:css("--ink"), weight:2 }); layer.bringToFront(); });
    layer.on("mouseout", () => { layer.setStyle(countyStyle(f)); });
    layer.bindTooltip(f.properties.name + " County", { sticky:true, direction:"top", opacity:.95 });
  }
}).addTo(map);

/* major rivers: paper-colored casing under a blue line */
const riverLayer = L.layerGroup().addTo(map);
for(const r of GEO.rivers){ const ll = r.c.map(p=>[p[1],p[0]]);
  riverLayer.addLayer(L.polyline(ll, { pane:"water", interactive:false, color:css("--land"), weight:4, opacity:.9 }));
  riverLayer.addLayer(L.polyline(ll, { pane:"water", interactive:false, color:css("--water"), weight:1.7 })); }
const badgeLayer = L.layerGroup().addTo(map);
const nameLayer = L.layerGroup();
const markerLayer = L.layerGroup();

/* soft mask outside the open county */
let maskLayer = null;
function setMask(id){
  if(maskLayer){ map.removeLayer(maskLayer); maskLayer = null; }
  if(!id) return;
  const g = byId[id].geometry; const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const holes = polys.map(p => p[0].map(q=>[q[1],q[0]]));
  maskLayer = L.polygon([[[38,-100],[38,-80],[52,-80],[52,-100]], ...holes], { pane:"mask", interactive:false, stroke:false, fillColor:css("--paper"), fillOpacity:.72 }).addTo(map);
}

/* ---------- detailed creeks, lakes and trout water, one file per county ---------- */
const waterCache = {}, troutCache = {};
let detailLayer = null, detailFor = null, detailStreams = [], detailLakes = [], detailLabelsExtra = [];
/* the creek data has a point every ~60 m, so lines look jagged up close; round the corners (Chaikin) so they read like water */
function smoothPath(pts, n = 2){
  if(pts.length < 3) return pts;
  // detailed lines (a point every ~30 m or closer) already curve; only round off sparse ones
  let d = 0; for(let i = 1; i < pts.length; i++) d += Math.hypot((pts[i][0] - pts[i-1][0]) * 111000, (pts[i][1] - pts[i-1][1]) * 80000);
  if(d / (pts.length - 1) < 70) return pts;   // average gap in meters
  for(let k = 0; k < n; k++){
    const out = [pts[0]];
    for(let i = 0; i < pts.length - 1; i++){ const a = pts[i], b = pts[i+1];
      out.push([a[0]*.75 + b[0]*.25, a[1]*.75 + b[1]*.25], [a[0]*.25 + b[0]*.75, a[1]*.25 + b[1]*.75]); }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}
// rounding only shows up close in; skip it when zoomed out so drawing stays quick
const llPaths = paths => { const sm = map.getZoom() >= 12; return paths.map(pa => { const ll = pa.map(q => [q[1], q[0]]); return sm ? smoothPath(ll) : ll; }); };
function streamWeight(o){ return o >= 6 ? 3 : o >= 5 ? 2.5 : o >= 4 ? 2 : o >= 3 ? 1.6 : o >= 2 ? 1.25 : 0.95; }
const TROUT = { 1:{ label:"Class I", tok:"--t1" }, 2:{ label:"Class II", tok:"--t2" }, 3:{ label:"Class III", tok:"--t3" } };
async function getJSON(cache, path, id){
  if(cache[id]) return cache[id];
  const r = await fetch(path); if(!r.ok) throw new Error("missing");
  return (cache[id] = await r.json());
}
function waterType(name){ return /lake|pond|flowage|reservoir|springs/i.test(name) ? (/flowage/i.test(name) ? "Flowage" : /pond|springs/i.test(name) ? "Spring pond" : "Lake") : (/river/i.test(name) ? "River" : "Creek"); }
function d2(a, b){ const k = Math.cos(a[1]*Math.PI/180); return ((a[0]-b[0])*k)**2 + (a[1]-b[1])**2; }
function nearestReg(name, ll, cid){
  const t = troutCache[cid || detailFor]; if(!t) return null;
  const p = [ll.lng, ll.lat]; let best = null, bd = Infinity;
  for(const r of t.r){ const same = r[0] && name && r[0].toLowerCase().replace(/\s*\(.*\)/,"") === name.toLowerCase();
    for(const pa of r[7]) for(const q of pa){ const d = d2(p, q) * (same ? .25 : 1); if(d < bd){ bd = d; best = r; } } }
  return bd < 0.0004 ? best : null; // within ~1–2 km
}
function waterPopup(name, kind, ll, trout, cid){
  const div = document.createElement("div"); div.className = "pop";
  const reg = trout ? nearestReg(name, ll, cid) : null;
  const regHtml = reg ? `<div class="regs"><b>${esc(reg[1])}</b>${reg[3]?`<div><span>Season</span>${esc(reg[3])}</div>`:""}${reg[4]?`<div><span>Early season</span>${esc(reg[4])}</div>`:""}${reg[2]?`<div><span>Bag</span>${esc(reg[2])}</div>`:""}${reg[5]?`<div><span>Gear</span>${esc(reg[5])}</div>`:""}${reg[6]?`<div><span>Special</span>${esc(reg[6])}</div>`:""}${seasonHtml(reg)}<small>From DNR's trout regulation map. Check the current regulations before you fish.</small></div>` : "";
  div.innerHTML = `<h3>${esc(name)}</h3><div class="meta">${esc(kind)}${trout?` · <span class="tclass" style="background:var(${TROUT[trout.c].tok})">${TROUT[trout.c].label} trout</span>`:""}${trout && trout.mi?` · ${trout.mi} mi`:""}</div>${regHtml}
    <div class="coords">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>
    <div class="row"><a class="link" href="${gmaps(ll.lat,ll.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>${canWrite?`<button class="link" data-a="addspot">Add as spot</button><button class="link" data-a="planwater">Plan a trip</button>`:""}</div>
    <div class="row dnr">${dnrLinks(kind, trout ? TROUT[trout.c].label : null)}</div>`;
  div.addEventListener("click", ev => {
    if(ev.target.closest('[data-a="addspot"]')){ map.closePopup(); openForm("spot", null, { name, lat:ll.lat, lng:ll.lng, water: waterType(name), trout_class: trout ? TROUT[trout.c].label : "" }); }
    const pw = ev.target.closest('[data-a="planwater"]');
    if(pw){ pendingPlanWater = { name, kind: waterType(name), lat:+ll.lat.toFixed(5), lng:+ll.lng.toFixed(5), county: countyAt(ll.lat, ll.lng) || detailFor || null, trout: trout ? TROUT[trout.c].label + " trout" : null };
      pw.hidden = true; div.insertAdjacentHTML("beforeend", planChooserHtml(pendingPlanWater)); map._popup && map._popup.update(); }
  });
  return div;
}
/* hovering any piece of a creek lights up the whole creek */
let hoverName = null;
function setHover(name){
  if(hoverName === name) return; hoverName = name;
  for(const s of [...detailStreams, ...areaStreams()]){ const on = name && s.name === name; s.line.setStyle(on ? { color:css("--hl"), weight:s.w + 2.2 } : { color:css("--stream"), weight:s.w }); }
  drawLabels();
}
function openWaterPopup(e, name, kind, trout, cid){
  if(picking){ handlePick(e.latlng); return; }
  L.popup({ maxWidth:300, autoPanPadding:[20,20] }).setLatLng(e.latlng).setContent(waterPopup(name, kind, e.latlng, trout, cid)).openOn(map);
}
let detailPromise = null;
function showDetail(id){
  if(detailFor === id && detailPromise) return detailPromise;
  clearDetail(); detailFor = id;
  return (detailPromise = loadDetail(id));
}
async function loadDetail(id){
  let w, t = null;
  try{ [w, t] = await Promise.all([ getJSON(waterCache, dataUrl("water/" + id + ".json"), id), getJSON(troutCache, dataUrl("water/trout/" + id + ".json"), id).catch(()=>null) ]); }
  catch(e){ if(detailFor===id) toast("Couldn't load creeks for this county."); return; }
  if(detailFor !== id) return;
  drawDetail(id, levelOf(id, w), t);
  map.removeLayer(riverLayer);
  $("legend").classList.add("trout-on");
  drawLabels(); renderLog();
  loadAccess(id);
  updateArea();
}
function drawDetail(id, w, t){
  if(detailLayer){ map.removeLayer(detailLayer); detailLayer = null; }
  if(detailRenderer){ map.removeLayer(detailRenderer); detailRenderer = null; }
  const g = L.layerGroup(); detailStreams = []; detailLakes = []; detailLabelsExtra = [];
  const R = detailRenderer = L.canvas({ pane:"detail", tolerance:6, padding:.6 });  // draw well past the screen edge so panning doesn't show blank strips // a fresh canvas per county
  for(const [name, typ, rings] of w.l){
    const p = L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, color:css("--stream"), weight:.7, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" });
    if(name && name !== "Unnamed"){ p.on("click", e => openWaterPopup(e, name, waterType(name))); detailLakes.push({ name, poly:p }); }
    else p.options.interactive = false;
    g.addLayer(p);
  }
  if(t) for(const [name, c, rings] of t.p){
    const p = L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, color:css(TROUT[c]?.tok || "--t1"), weight:2, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" });
    p.on("click", e => openWaterPopup(e, name, "Spring pond", { c, mi:null })); detailLakes.push({ name, poly:p }); g.addLayer(p);
  }
  /* trout class bands sit under the creek line, like a highlighter on a paper map */
  if(t) for(const [name, c, mi, orw, paths] of t.t){
    if(!TROUT[c]) continue;
    const band = L.polyline(llPaths(paths), { renderer:R, color:css(TROUT[c].tok), weight:6, opacity:.38, lineCap:"round", lineJoin:"round", smoothFactor:.5 });
    band.on("click", e => openWaterPopup(e, name, waterType(name), { c, mi }));
    band.on("mouseover", () => setHover(name)); band.on("mouseout", () => setHover(null));
    g.addLayer(band);
  }
  for(const [name, order, raw] of w.s){
    if((!name || name === "NA" || name === "Unnamed") && order >= 4) continue;   // DNR flow paths through lakes, not creeks
    const paths = raw.filter(pa => pa.length > 1 && (pa[0][0] !== pa[pa.length-1][0] || pa[0][1] !== pa[pa.length-1][1] || pa.length > 2));
    if(!paths.length) continue;
    const ll = llPaths(paths);
    const wgt = streamWeight(order);
    g.addLayer(L.polyline(ll, { renderer:R, interactive:false, color:css("--land"), weight:wgt + 2.4, opacity:.85, lineCap:"round", lineJoin:"round", smoothFactor:.5 }));
    const unnamed = !name || name === "NA" || name === "Unnamed";
    const line = L.polyline(ll, { renderer:R, interactive:!unnamed, color:css("--stream"), weight:wgt, opacity:1, lineCap:"round", lineJoin:"round", smoothFactor:.5 });
    if(unnamed){ g.addLayer(line); continue; }   // unnamed creeks: drawn, but no label or card
    const tseg = t && t.t.find(x => x[0] && x[0].toLowerCase() === name.toLowerCase());
    line.on("click", e => openWaterPopup(e, name, waterType(name), tseg ? { c:tseg[1], mi:null } : null));
    line.on("mouseover", () => setHover(name)); line.on("mouseout", () => setHover(null));
    g.addLayer(line);
    detailStreams.push({ name, order, w:wgt, line, ll });
  }
  if(t){ const have = new Set(detailStreams.map(x => x.name.toLowerCase()));
    for(const [name, c, mi, orw, paths] of t.t){ if(!name || have.has(name.toLowerCase())) continue;
      detailLabelsExtra.push({ name, order:2, ll: paths.map(pa=>pa.map(q=>[q[1],q[0]])) }); } }
  detailLayer = g.addTo(map);
}
/* creeks in the surrounding counties, drawn under the fade so they read as context */
async function loadNearby(id){
  const lb = {}; countyLayer.eachLayer(l => lb[l.feature.id] = l.getBounds());
  const around = lb[id].pad(0.35);
  const ids = Object.keys(lb).filter(k => k !== id && around.intersects(lb[k]));
  const R = nearbyRenderer = L.canvas({ pane:"nearby", padding:.6 });
  const layer = nearbyLayer = L.layerGroup().addTo(map);
  await Promise.all(ids.map(async k => {
    let w, t;
    try{ [w, t] = await Promise.all([ getJSON(waterCache, dataUrl("water/" + k + ".json"), k), getJSON(troutCache, dataUrl("water/trout/" + k + ".json"), k).catch(()=>null) ]); }catch(e){ return; }
    if(detailFor !== id || nearbyLayer !== layer) return;
    for(const [name, typ, rings] of w.l) layer.addLayer(L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, interactive:false, color:css("--stream"), weight:.5, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" }));
    if(t) for(const [name, c, mi, orw, paths] of t.t) if(TROUT[c]) layer.addLayer(L.polyline(llPaths(paths), { renderer:R, interactive:false, color:css(TROUT[c].tok), weight:5, opacity:.3, lineJoin:"round" }));
    for(const [name, order, paths] of w.s) if(!((!name || name === "NA" || name === "Unnamed") && order >= 4)) layer.addLayer(L.polyline(llPaths(paths), { renderer:R, interactive:false, color:css("--stream"), weight:streamWeight(order), lineJoin:"round" }));
  }));
}
function clearDetail(){
  if(detailLayer){ map.removeLayer(detailLayer); detailLayer = null; }
  // drop the canvases too: left on the map they cover it and swallow county clicks
  if(detailRenderer){ map.removeLayer(detailRenderer); detailRenderer = null; }
  if(nearbyLayer){ map.removeLayer(nearbyLayer); nearbyLayer = null; }
  if(nearbyRenderer){ map.removeLayer(nearbyRenderer); nearbyRenderer = null; }
  detailFor = null; detailPromise = null; detailStreams = []; detailLakes = []; detailLabelsExtra = []; hoverName = null;
  if(!map.hasLayer(riverLayer)) map.addLayer(riverLayer);
  clearAccess();
  $("legend").classList.remove("trout-on");
  drawLabels(); setTimeout(updateArea, 0);
}
function waterNames(id){
  const w = waterCache[id]; if(!w) return null;
  const tally = {}; for(const [n,o] of w.s) if(n && n !== "NA" && n !== "Unnamed") tally[n] = Math.max(tally[n]||0, o);
  const tr = {}; const t = troutCache[id]; if(t) for(const [n,c] of t.t) if(TROUT[c]) tr[n.toLowerCase()] = Math.min(tr[n.toLowerCase()]||9, c);
  return Object.entries(tally).map(([n,o]) => [n, o, tr[n.toLowerCase()] || 0]).sort((a,b)=>(a[2]||9)-(b[2]||9)||b[1]-a[1]||a[0].localeCompare(b[0]));
}

/* ---------- labels drawn along the water ---------- */
pane("labels", 440, false);
const labelCanvas = L.DomUtil.create("canvas", "label-canvas", map.getPane("labels"));
map.on("zoomstart", () => { labelCanvas.style.visibility = "hidden"; });
map.on("zoomend", () => { labelCanvas.style.visibility = ""; drawLabels(); });
let labelQueued = false;
function drawLabels(){ if(labelQueued) return; labelQueued = true; requestAnimationFrame(() => { labelQueued = false; renderLabels(); }); }
map.on("move zoom resize viewreset", drawLabels);
function renderLabels(){
  const el = map.getContainer(), W = el.clientWidth, H = el.clientHeight, dpr = window.devicePixelRatio || 1;
  if(labelCanvas.width !== W*dpr || labelCanvas.height !== H*dpr){ labelCanvas.width = W*dpr; labelCanvas.height = H*dpr; labelCanvas.style.width = W+"px"; labelCanvas.style.height = H+"px"; }
  L.DomUtil.setPosition(labelCanvas, map.containerPointToLayerPoint([0,0]));
  const ctx = labelCanvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  const z = map.getZoom(), placed = [];
  const hits = (b) => placed.some(p => b.x < p.x+p.w && b.x+b.w > p.x && b.y < p.y+p.h && b.y+b.h > p.y);
  const halo = css("--land"), ink = css("--label");
  ctx.lineJoin = "round"; ctx.textBaseline = "middle";
  let items;
  const close = detailFor || areaOn.size;
  if(close){
    const minOrder = z >= 11.5 ? 0 : z >= 10.5 ? 2 : z >= 9.5 ? 3 : 4;
    const byName = {};
    for(const s of [...detailStreams, ...detailLabelsExtra, ...areaStreams(), ...areaExtra()]){ if(s.order < minOrder && s.name !== hoverName) continue; (byName[s.name] ||= { name:s.name, order:s.order, lines:[] }).lines.push(...s.ll); byName[s.name].order = Math.max(byName[s.name].order, s.order); }
    items = Object.values(byName).sort((a,b) => (b.name===hoverName) - (a.name===hoverName) || b.order - a.order);
  } else {
    items = z >= 7.5 ? GEO.rivers.filter(r=>r.n).map(r => ({ name:r.n.replace(/\s+/g," ").replace(/^E\. Fk\./,"East Fork"), order:6, lines:[r.c.map(p=>[p[1],p[0]])] })) : [];
  }
  const seen = new Set();
  for(const it of items){
    if(seen.has(it.name) && !close) continue;
    const size = it.order >= 5 ? 14 : it.order >= 3 ? 12.5 : 11.5;
    ctx.font = `italic ${it.order >= 5 ? 600 : 500} ${size}px "Crimson Pro", Georgia, serif`;
    const text = it.order >= 5 && close ? it.name.toUpperCase().split("").join(" ") : it.name;
    const tw = ctx.measureText(text).width + 6;
    // longest on-screen stretch of this water
    let best = null, bestLen = 0;
    for(const line of it.lines){
      let run = [], len = 0;
      const flush = () => { if(len > bestLen){ bestLen = len; best = run; } run = []; len = 0; };
      for(const ll of line){ const p = map.latLngToContainerPoint(ll);
        if(p.x < 4 || p.y < 4 || p.x > W-4 || p.y > H-4){ flush(); continue; }
        if(run.length) len += Math.hypot(p.x-run[run.length-1].x, p.y-run[run.length-1].y);
        run.push(p); }
      flush();
    }
    if(!best || bestLen < tw + 16) continue;
    if(best[0].x > best[best.length-1].x) best = best.slice().reverse();
    // smooth the on-screen line so letters follow the creek's general course, not every wiggle
    const step = 3, raw = [best[0]];
    for(let k=1;k<best.length;k++){ const a = raw[raw.length-1], b = best[k]; const dd = Math.hypot(b.x-a.x, b.y-a.y); const n = Math.floor(dd/step);
      for(let m=1;m<=n;m++) raw.push({ x:a.x+(b.x-a.x)*m/n, y:a.y+(b.y-a.y)*m/n }); if(!n) raw.push(b); }
    const kk = Math.max(2, Math.round(size*1.4/step)), sm = raw.map((_, k) => { let x=0, y=0, c=0; for(let m=Math.max(0,k-kk); m<=Math.min(raw.length-1,k+kk); m++){ x+=raw[m].x; y+=raw[m].y; c++; } return { x:x/c, y:y/c }; });
    const cum = [0]; for(let k=1;k<sm.length;k++) cum.push(cum[k-1] + Math.hypot(sm[k].x-sm[k-1].x, sm[k].y-sm[k-1].y));
    const L = cum[cum.length-1];
    if(L < tw + 10) continue;
    const at = (d) => { d = Math.max(0, Math.min(L, d)); let k = 1; while(k < cum.length-1 && cum[k] < d) k++; const a = sm[k-1], b = sm[k], t = (d-cum[k-1])/((cum[k]-cum[k-1])||1); return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t }; };
    const tan = (d) => { const a = at(d - size*0.7), b = at(d + size*0.7); return Math.atan2(b.y-a.y, b.x-a.x); };
    // pick the straightest stretch long enough for the name, favoring the middle
    let pick = null;
    for(let d0 = 0; d0 + tw <= L; d0 += 5){
      const a = at(d0), b = at(d0 + tw), chord = Math.hypot(b.x-a.x, b.y-a.y), straight = chord / tw;
      let turn = 0, prev = tan(d0); for(let d = d0 + 6; d <= d0 + tw; d += 6){ const t2 = tan(d); turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(t2-prev), Math.cos(t2-prev)))); prev = t2; }
      const score = straight - turn*0.15 - Math.abs((d0 + tw/2) - L/2) / L * 0.15;
      if(!pick || score > pick.score) pick = { d0, a, b, straight, turn, score };
    }
    if(!pick) continue;
    const curved = pick.straight >= 0.94 && pick.turn <= 0.35 && pick.b.x >= pick.a.x;
    const off = -(size*0.62) - 1; // sit just above the line
    const color = it.name === hoverName ? css("--ink") : ink;
    if(curved){
      const glyphs = []; let d = pick.d0 + 3;
      for(const ch of text){ const cw = ctx.measureText(ch).width; const mid = d + cw/2; glyphs.push({ ch, ...at(mid), ang:tan(mid) }); d += cw; }
      const xs = glyphs.map(g=>g.x), ys = glyphs.map(g=>g.y);
      const box = { x:Math.min(...xs)-size*.6, y:Math.min(...ys)-size*1.1, w:Math.max(...xs)-Math.min(...xs)+size*1.2, h:Math.max(...ys)-Math.min(...ys)+size*1.6 };
      if(hits(box)) continue;
      placed.push(box); seen.add(it.name);
      for(const pass of [0, 1]) for(const g of glyphs){
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang);
        const x0 = -ctx.measureText(g.ch).width/2;
        if(pass === 0){ ctx.lineWidth = 3.2; ctx.strokeStyle = halo; ctx.strokeText(g.ch, x0, off); }
        else { ctx.fillStyle = color; ctx.fillText(g.ch, x0, off); }
        ctx.restore();
      }
    } else {
      // too twisty to follow: set the name straight, along the stretch's overall direction
      let ang = Math.atan2(pick.b.y-pick.a.y, pick.b.x-pick.a.x);
      if(ang > Math.PI/2) ang -= Math.PI; if(ang < -Math.PI/2) ang += Math.PI;
      const c = at(pick.d0 + tw/2);
      const cos = Math.abs(Math.cos(ang)), sin = Math.abs(Math.sin(ang)), hw = tw/2, hh = size*0.9;
      const box = { x:c.x - (hw*cos + hh*sin), y:c.y - (hw*sin + hh*cos) - size*0.5, w:2*(hw*cos + hh*sin), h:2*(hw*sin + hh*cos) + size*0.5 };
      if(hits(box)) continue;
      placed.push(box); seen.add(it.name);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.textAlign = "center";
      ctx.lineWidth = 3.2; ctx.strokeStyle = halo; ctx.strokeText(text, 0, off);
      ctx.fillStyle = color; ctx.fillText(text, 0, off);
      ctx.restore(); ctx.textAlign = "start";
    }
  }
  // lake names, centered, when the lake is big enough on screen
  if(detailFor){
    ctx.font = `italic 500 12px "Crimson Pro", Georgia, serif`; ctx.textAlign = "center";
    for(const l of detailLakes){
      const b = l.poly.getBounds(); const a = map.latLngToContainerPoint(b.getNorthWest()), c = map.latLngToContainerPoint(b.getSouthEast());
      const w = c.x - a.x, h = c.y - a.y; const tw = ctx.measureText(l.name).width;
      if(w < Math.min(tw*0.8, 90) || h < 12 || c.x < 0 || a.x > W || c.y < 0 || a.y > H) continue;
      const x = (a.x + c.x)/2, y = (a.y + c.y)/2;
      const box = { x:x-tw/2-3, y:y-8, w:tw+6, h:16 }; if(hits(box)) continue; placed.push(box);
      ctx.lineWidth = 3; ctx.strokeStyle = css("--lake"); ctx.strokeText(l.name, x, y); ctx.fillStyle = ink; ctx.fillText(l.name, x, y);
    }
    ctx.textAlign = "start";
  }
}
document.fonts && document.fonts.load('italic 500 12px "Crimson Pro"').then(drawLabels).catch(()=>{});

function fitState(){ map.fitBounds(wiBounds, { padding:[16,16] }); }
fitState();

function restyleBase(){
  const s = (layer, o) => layer.eachLayer(l => l.setStyle(typeof o === "function" ? o(l) : o));
  s(gratLayer, { color:css("--grid") });
  neighborLayer.setStyle({ color:css("--county-edge"), fillColor:css("--paper-2") });
  stateFill.setStyle({ fillColor:css("--land") }); stateLine.setStyle({ color:css("--ink") });
  lakeLayer.setStyle({ color:css("--water"), fillColor:css("--lake") });
  s(rippleLayer, { color:css("--water") });
  regionLayer.setStyle(f => ({ color:css(REGION_TINT[f.properties.name]), fillColor:css(REGION_TINT[f.properties.name]) }));
  let i = 0; s(riverLayer, () => (i++ % 2 ? { color:css("--water") } : { color:css("--land") }));
  countyLayer.setStyle(countyStyle);
  if(maskLayer) maskLayer.setStyle({ fillColor:css("--paper") });
  if(detailFor){ const id = detailFor; clearDetail(); showDetail(id); }
  drawLabels();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", restyleBase);
new MutationObserver(restyleBase).observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });


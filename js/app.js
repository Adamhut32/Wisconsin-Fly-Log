/* Wisconsin Fly Log — built from src/*.js by build.py. Edit the files in src/, then run: python3 build.py */
(async function(){
"use strict";
const CFG = window.FLYLOG_CONFIG;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dataUrl = p => "data/" + p + "?v=" + CFG.dataVersion;
const DETAIL_ZOOM = 9;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
let toastT; function toast(msg){ const t=$("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3000); }

/* ---------- state ---------- */
let me = null;                 // { id, email }
let profile = null;            // { id, display_name, friend_code }
let spots = [], catches = [], trips = [];
let friendCatches = [], friendSpots = [], friendTrips = [], friendships = [], people = {};
let follows = [], tournaments = [], announcements = [], mySuggestions = [];
let showFriends = lsGet("fl.showFriends", true);
let showAccess = lsGet("fl.showAccess", true);
let canWrite = true;
let currentCounty = null;
let loadState = "loading";     // loading | ready | offline
let tab = "map";               // map | trips | tourney | friends | stats | me
let tripOpen = null;           // trip id shown in Trips tab

/* ---------- base geography ---------- */
const GEO = await (await fetch(dataUrl("geo.json"))).json();
const counties = GEO.counties.features;
const byId = {}; counties.forEach(f => byId[f.id] = f);
function pipRing(x, y, ring){ let ins=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1]; if(((yi>y)!=(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
function inPoly(x,y,poly){ if(!pipRing(x,y,poly[0])) return false; for(let k=1;k<poly.length;k++) if(pipRing(x,y,poly[k])) return false; return true; }
function countyAt(lat, lng){
  for(const f of counties){ const g=f.geometry; const polys = g.type==="Polygon"?[g.coordinates]:g.coordinates; if(polys.some(p=>inPoly(lng,lat,p))) return f.id; }
  return null;
}
function labelPoint(f){
  const g=f.geometry; const polys = g.type==="Polygon"?[g.coordinates]:g.coordinates;
  let best=null, bestA=0;
  for(const p of polys){ const r=p[0]; let a=0,cx=0,cy=0; for(let i=0,j=r.length-1;i<r.length;j=i++){ const c=r[j][0]*r[i][1]-r[i][0]*r[j][1]; a+=c; cx+=(r[j][0]+r[i][0])*c; cy+=(r[j][1]+r[i][1])*c; } a/=2; if(Math.abs(a)>bestA){ bestA=Math.abs(a); best=[cy/(6*a), cx/(6*a)]; } }
  return best;
}
const LABEL = {}; counties.forEach(f => LABEL[f.id] = labelPoint(f));
function countyName(id){ return byId[id] ? byId[id].properties.name + " County" : "Outside Wisconsin"; }
function gmaps(lat,lng){ return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`; }
function fmtDate(d, opts){ if(!d) return ""; const [y,m,dd]=d.split("-").map(Number); return new Date(y,m-1,dd).toLocaleDateString(undefined, opts || {month:"short",day:"numeric",year:"numeric"}); }
function fmtRange(a, b){ if(!a) return ""; if(a === b) return fmtDate(a); const ya = a.slice(0,4), yb = b.slice(0,4);
  return ya === yb ? `${fmtDate(a,{month:"short",day:"numeric"})} – ${fmtDate(b)}` : `${fmtDate(a)} – ${fmtDate(b)}`; }
const fishOf = c => (c.count ?? 1);
const lenTxt = v => v == null || v === "" ? "" : `${+v}″`;

/* ---------- derived numbers ---------- */
function countyStats(id){
  let s=0,f=0; for(const x of spots) if(x.county===id) s++; for(const c of catches) if(c.county===id) f+=fishOf(c);
  return { spots:s, fish:f };
}
function totals(){
  const ids = new Set([...spots.map(s=>s.county), ...catches.map(c=>c.county)].filter(Boolean));
  return { spots:spots.length, fish:catches.reduce((a,c)=>a+fishOf(c),0), counties:ids.size };
}

const map = L.map("map", { zoomControl:true, attributionControl:false, minZoom:6, maxZoom:16, zoomSnap:0.25, preferCanvas:false });
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
const lakeLayer = L.geoJSON(GEO.lakes, { pane:"water", interactive:false, style:()=>({ color:css("--water"), weight:.6, fillColor:css("--lake"), fillOpacity:1 }) }).addTo(map);
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
  const heat = s.fish ? 0.2 + 0.45 * (s.fish / max) : (s.spots ? 0.14 : 0);
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
function streamWeight(o){ return o >= 6 ? 3 : o >= 5 ? 2.5 : o >= 4 ? 2 : o >= 3 ? 1.6 : o >= 2 ? 1.25 : 0.95; }
const TROUT = { 1:{ label:"Class I", tok:"--t1" }, 2:{ label:"Class II", tok:"--t2" }, 3:{ label:"Class III", tok:"--t3" } };
async function getJSON(cache, path, id){
  if(cache[id]) return cache[id];
  const r = await fetch(path); if(!r.ok) throw new Error("missing");
  return (cache[id] = await r.json());
}
function waterType(name){ return /lake|pond|flowage|reservoir|springs/i.test(name) ? (/flowage/i.test(name) ? "Flowage" : /pond|springs/i.test(name) ? "Spring pond" : "Lake") : (/river/i.test(name) ? "River" : "Creek"); }
function d2(a, b){ const k = Math.cos(a[1]*Math.PI/180); return ((a[0]-b[0])*k)**2 + (a[1]-b[1])**2; }
function nearestReg(name, ll){
  const t = troutCache[detailFor]; if(!t) return null;
  const p = [ll.lng, ll.lat]; let best = null, bd = Infinity;
  for(const r of t.r){ const same = r[0] && name && r[0].toLowerCase().replace(/\s*\(.*\)/,"") === name.toLowerCase();
    for(const pa of r[7]) for(const q of pa){ const d = d2(p, q) * (same ? .25 : 1); if(d < bd){ bd = d; best = r; } } }
  return bd < 0.0004 ? best : null; // within ~1–2 km
}
function waterPopup(name, kind, ll, trout){
  const div = document.createElement("div"); div.className = "pop";
  const reg = trout ? nearestReg(name, ll) : null;
  const regHtml = reg ? `<div class="regs"><b>${esc(reg[1])}</b>${reg[3]?`<div><span>Season</span>${esc(reg[3])}</div>`:""}${reg[4]?`<div><span>Early season</span>${esc(reg[4])}</div>`:""}${reg[2]?`<div><span>Bag</span>${esc(reg[2])}</div>`:""}${reg[5]?`<div><span>Gear</span>${esc(reg[5])}</div>`:""}${reg[6]?`<div><span>Special</span>${esc(reg[6])}</div>`:""}${seasonHtml(reg)}<small>From DNR's trout regulation map. Check the current regulations before you fish.</small></div>` : "";
  div.innerHTML = `<h3>${esc(name)}</h3><div class="meta">${esc(kind)}${trout?` · <span class="tclass" style="background:var(${TROUT[trout.c].tok})">${TROUT[trout.c].label} trout</span>`:""}${trout && trout.mi?` · ${trout.mi} mi`:""}</div>${regHtml}
    <div class="coords">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>
    <div class="row"><a class="link" href="${gmaps(ll.lat,ll.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>${canWrite?`<button class="link" data-a="addspot">Add as spot</button>`:""}</div>`;
  div.addEventListener("click", ev => { if(ev.target.closest('[data-a="addspot"]')){ map.closePopup(); openForm("spot", null, { name, lat:ll.lat, lng:ll.lng, water: waterType(name), trout_class: trout ? TROUT[trout.c].label : "" }); } });
  return div;
}
/* hovering any piece of a creek lights up the whole creek */
let hoverName = null;
function setHover(name){
  if(hoverName === name) return; hoverName = name;
  for(const s of detailStreams){ const on = name && s.name === name; s.line.setStyle(on ? { color:css("--hl"), weight:s.w + 2.2 } : { color:css("--stream"), weight:s.w }); }
  drawLabels();
}
function openWaterPopup(e, name, kind, trout){
  if(picking){ handlePick(e.latlng); return; }
  L.popup({ maxWidth:300, autoPanPadding:[20,20] }).setLatLng(e.latlng).setContent(waterPopup(name, kind, e.latlng, trout)).openOn(map);
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
  const g = L.layerGroup(); detailStreams = []; detailLakes = []; detailLabelsExtra = [];
  const R = detailRenderer = L.canvas({ pane:"detail", tolerance:6 }); // a fresh canvas per county
  for(const [name, typ, rings] of w.l){
    const p = L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, color:css("--stream"), weight:.7, fillColor:css("--lake"), fillOpacity:1 });
    if(name && name !== "Unnamed"){ p.on("click", e => openWaterPopup(e, name, waterType(name))); detailLakes.push({ name, poly:p }); }
    else p.options.interactive = false;
    g.addLayer(p);
  }
  if(t) for(const [name, c, rings] of t.p){
    const p = L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, color:css(TROUT[c]?.tok || "--t1"), weight:2, fillColor:css("--lake"), fillOpacity:1 });
    p.on("click", e => openWaterPopup(e, name, "Spring pond", { c, mi:null })); detailLakes.push({ name, poly:p }); g.addLayer(p);
  }
  /* trout class bands sit under the creek line, like a highlighter on a paper map */
  if(t) for(const [name, c, mi, orw, paths] of t.t){
    if(!TROUT[c]) continue;
    const band = L.polyline(paths.map(pa=>pa.map(q=>[q[1],q[0]])), { renderer:R, color:css(TROUT[c].tok), weight:6, opacity:.38, lineCap:"round" });
    band.on("click", e => openWaterPopup(e, name, waterType(name), { c, mi }));
    band.on("mouseover", () => setHover(name)); band.on("mouseout", () => setHover(null));
    g.addLayer(band);
  }
  for(const [name, order, raw] of w.s){
    const paths = raw.filter(pa => pa.length > 1 && (pa[0][0] !== pa[pa.length-1][0] || pa[0][1] !== pa[pa.length-1][1] || pa.length > 2));
    if(!paths.length) continue;
    const ll = paths.map(pa=>pa.map(q=>[q[1],q[0]]));
    const wgt = streamWeight(order);
    g.addLayer(L.polyline(ll, { renderer:R, interactive:false, color:css("--land"), weight:wgt + 2.4, opacity:.85 }));
    const line = L.polyline(ll, { renderer:R, color:css("--stream"), weight:wgt, opacity:1 });
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
  map.removeLayer(riverLayer);
  $("legend").classList.add("trout-on");
  drawLabels(); renderLog();
  loadNearby(id);
  loadAccess(id);
}
/* creeks in the surrounding counties, drawn under the fade so they read as context */
async function loadNearby(id){
  const lb = {}; countyLayer.eachLayer(l => lb[l.feature.id] = l.getBounds());
  const around = lb[id].pad(0.35);
  const ids = Object.keys(lb).filter(k => k !== id && around.intersects(lb[k]));
  const R = nearbyRenderer = L.canvas({ pane:"nearby" });
  const layer = nearbyLayer = L.layerGroup().addTo(map);
  await Promise.all(ids.map(async k => {
    let w, t;
    try{ [w, t] = await Promise.all([ getJSON(waterCache, dataUrl("water/" + k + ".json"), k), getJSON(troutCache, dataUrl("water/trout/" + k + ".json"), k).catch(()=>null) ]); }catch(e){ return; }
    if(detailFor !== id || nearbyLayer !== layer) return;
    for(const [name, typ, rings] of w.l) layer.addLayer(L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, interactive:false, color:css("--stream"), weight:.5, fillColor:css("--lake"), fillOpacity:1 }));
    if(t) for(const [name, c, mi, orw, paths] of t.t) if(TROUT[c]) layer.addLayer(L.polyline(paths.map(pa=>pa.map(q=>[q[1],q[0]])), { renderer:R, interactive:false, color:css(TROUT[c].tok), weight:5, opacity:.3 }));
    for(const [name, order, paths] of w.s) layer.addLayer(L.polyline(paths.map(pa=>pa.map(q=>[q[1],q[0]])), { renderer:R, interactive:false, color:css("--stream"), weight:streamWeight(order) }));
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
  drawLabels();
}
function waterNames(id){
  const w = waterCache[id]; if(!w) return null;
  const tally = {}; for(const [n,o] of w.s) tally[n] = Math.max(tally[n]||0, o);
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
  if(detailFor){
    const minOrder = z >= 11.5 ? 0 : z >= 10.5 ? 2 : z >= 9.5 ? 3 : 4;
    const byName = {};
    for(const s of [...detailStreams, ...detailLabelsExtra]){ if(s.order < minOrder && s.name !== hoverName) continue; (byName[s.name] ||= { name:s.name, order:s.order, lines:[] }).lines.push(...s.ll); byName[s.name].order = Math.max(byName[s.name].order, s.order); }
    items = Object.values(byName).sort((a,b) => (b.name===hoverName) - (a.name===hoverName) || b.order - a.order);
  } else {
    items = z >= 7.5 ? GEO.rivers.filter(r=>r.n).map(r => ({ name:r.n.replace(/\s+/g," ").replace(/^E\. Fk\./,"East Fork"), order:6, lines:[r.c.map(p=>[p[1],p[0]])] })) : [];
  }
  const seen = new Set();
  for(const it of items){
    if(seen.has(it.name) && !detailFor) continue;
    const size = it.order >= 5 ? 14 : it.order >= 3 ? 12.5 : 11.5;
    ctx.font = `italic ${it.order >= 5 ? 600 : 500} ${size}px "Crimson Pro", Georgia, serif`;
    const text = it.order >= 5 && detailFor ? it.name.toUpperCase().split("").join(" ") : it.name;
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



/* ---------- markers and popups ---------- */
const friendLayer = L.layerGroup();
function renderBadges(){
  badgeLayer.clearLayers(); nameLayer.clearLayers();
  for(const f of counties){
    const s = countyStats(f.id), p = LABEL[f.id]; if(!p) continue;
    nameLayer.addLayer(L.marker(p, { interactive:false, keyboard:false, icon:L.divIcon({ className:"", html:`<div class="cname">${esc(f.properties.name)}</div>`, iconSize:[0,0] }) }));
    if(!s.spots && !s.fish) continue;
    const html = `<div class="cbadge">${s.spots?`<span class="s">${icon("i-pin")}${s.spots}</span>`:""}${s.fish?`<span class="f">${icon("i-fish")}${s.fish}</span>`:""}</div>`;
    badgeLayer.addLayer(L.marker(p, { interactive:false, keyboard:false, icon:L.divIcon({ className:"", html, iconSize:[0,0] }) }));
  }
}
const markerIndex = {};
function renderMarkers(){
  markerLayer.clearLayers(); friendLayer.clearLayers();
  for(const s of spots){
    const m = L.marker([s.lat,s.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-spot ${esc(s.status)}"></div>`, iconSize:[0,0] }), riseOnHover:true, title:s.name||"Spot" });
    m.bindPopup(() => spotPopup(s), { maxWidth:300, autoPanPadding:[20,20] });
    markerLayer.addLayer(m); markerIndex["s:"+s.id] = m;
  }
  for(const c of catches){
    if(c.lat == null) continue;
    const url = photoSrc(c.photo_path);
    const bg = url ? `style="background-image:url('${url}')"` : "";
    const html = `<div class="mk-fish" ${bg}>${url?"":icon("i-fish")}${fishOf(c)>1?`<span class="n">${fishOf(c)}</span>`:""}</div>`;
    const m = L.marker([c.lat,c.lng], { icon:L.divIcon({ className:"", html, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:500, title:c.species||"Catch" });
    m.bindPopup(() => catchPopup(c), { maxWidth:320, autoPanPadding:[20,20] });
    markerLayer.addLayer(m); markerIndex["c:"+c.id] = m;
  }
  for(const c of friendCatches){
    if(c.lat == null) continue;
    const first = (c.display_name || "Friend").split(" ")[0];
    const html = `<div class="mk-fish friend">${icon("i-fish")}<span class="mk-name">${esc(first)}</span></div>`;
    const m = L.marker([c.lat,c.lng], { icon:L.divIcon({ className:"", html, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:300, title:`${c.display_name}: ${c.species||"Catch"}` });
    m.bindPopup(() => friendCatchPopup(c), { maxWidth:320, autoPanPadding:[20,20] });
    friendLayer.addLayer(m); markerIndex["f:"+c.id] = m;
  }
  $("legend").classList.toggle("friends-on", showFriends && friendCatches.some(c => c.lat != null));
}
function updateZoomLayers(){
  const z = map.getZoom();
  const detail = z >= DETAIL_ZOOM;
  const want = (l, on) => { if(on && !map.hasLayer(l)) map.addLayer(l); if(!on && map.hasLayer(l)) map.removeLayer(l); };
  want(badgeLayer, !detail); want(markerLayer, detail); want(nameLayer, detail); want(friendLayer, detail && showFriends);
  const showRegions = z < 8.6 && !currentCounty;
  [regionLayer, regionNames].forEach(l => want(l, showRegions));
  want(neighborNames, z < 8);
}
map.on("zoomend", updateZoomLayers);

const STATUS = { want:"Want to try", scouted:"Scouted", fished:"Fished" };
const VIS = { exact:"Friends see the exact spot", county:"Friends see the county only", private:"Private" };
function spotVisits(s){
  const cs = catches.filter(c => c.spot_id === s.id);
  const last = cs.map(c => c.caught_on).sort().pop();
  return { fish: cs.reduce((a,c)=>a+fishOf(c),0), days: new Set(cs.map(c=>c.caught_on)).size, last };
}
function popupShell(kind, rec, inner){
  const div = document.createElement("div"); div.className = "pop";
  div.innerHTML = inner + (rec.lat != null ? `<div class="coords">${rec.lat.toFixed(5)}, ${rec.lng.toFixed(5)}</div>` : "") +
    `<div class="row">${rec.lat != null ? `<a class="link" href="${gmaps(rec.lat,rec.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>` : ""}
    ${canWrite?`<button class="link" data-a="edit">Edit</button><button class="link danger" data-a="del">Delete</button>`:""}</div><div data-slot></div>`;
  div.addEventListener("click", ev => {
    const a = ev.target.closest("[data-a]"); if(!a) return;
    const slot = div.querySelector("[data-slot]");
    if(a.dataset.a==="edit"){ map.closePopup(); openForm(kind, rec); }
    if(a.dataset.a==="del"){ slot.innerHTML = `<div class="confirm">Delete this ${kind==="catch"?"catch":"spot"} for good?<button class="link danger" data-a="yes">Delete</button><button class="link" data-a="no">Keep</button></div>`; }
    if(a.dataset.a==="no"){ slot.innerHTML = ""; }
    if(a.dataset.a==="yes"){ map.closePopup(); removeRecord(kind, rec); }
    if(a.dataset.a==="trip"){ map.closePopup(); openTrip(a.dataset.id); }
  });
  return div;
}
function spotPopup(s){
  const v = spotVisits(s);
  const bits = [s.water, s.trout_class, s.target ? "for " + s.target : ""].filter(Boolean).join(" · ");
  const div = popupShell("spot", s, `<h3>${esc(s.name||"Unnamed spot")}</h3>
    <div class="row2" style="margin:2px 0 4px"><span class="pill ${esc(s.status)}">${STATUS[s.status]||"Want to try"}</span>${s.visibility==="private"?`<span class="pill priv">Private</span>`:""}</div>
    <div class="meta">${esc(bits)}</div>
    <div class="meta">${v.last ? `Last fished ${esc(fmtDate(v.last))} · ${v.fish} fish over ${v.days} day${v.days===1?"":"s"}` : "No catches logged here yet"}</div>
    <div data-season></div>
    ${s.notes?`<p style="margin:8px 0 6px">${esc(s.notes)}</p>`:""}`);
  regNear(s.county, s.lat, s.lng, s.name).then(reg => { const el = div.querySelector("[data-season]"); if(el && reg) el.innerHTML = seasonHtml(reg); }).catch(()=>{});
  return div;
}
function catchPopup(c){
  const spot = spots.find(s=>s.id===c.spot_id), trip = trips.find(t=>t.id===c.trip_id);
  const url = photoSrc(c.photo_path);
  const head = `${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}`;
  return popupShell("catch", c, `<h3>${head}</h3><div class="meta">${esc(fmtDate(c.caught_on))}${c.fly?` · ${esc(c.fly)}`:""}${spot?` · ${esc(spot.name)}`:""}</div>
    ${trip?`<div class="meta">Trip: <button class="link" data-a="trip" data-id="${esc(trip.id)}">${esc(trip.name)}</button></div>`:""}
    ${url?`<img src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
    ${c.notes?`<p style="margin:6px 0">${esc(c.notes)}</p>`:""}
    <div class="meta" style="margin-top:4px">${VIS[c.visibility]||""}${c._pending?" · Waiting to sync":""}</div>`);
}
function friendCatchPopup(c){
  const div = document.createElement("div"); div.className = "pop";
  const url = photoSrc(c.photo_path);
  div.innerHTML = `<div class="meta" style="color:var(--friend);font-weight:700">${esc(c.display_name)}</div>
    <h3>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</h3>
    <div class="meta">${esc(fmtDate(c.caught_on))}${c.fly?` · ${esc(c.fly)}`:""} · ${esc(countyName(c.county))}</div>
    ${c.trip_name?`<div class="meta">Trip: ${esc(c.trip_name)}</div>`:""}
    ${url?`<img src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
    ${c.notes?`<p style="margin:6px 0">${esc(c.notes)}</p>`:""}
    ${c.lat!=null?`<div class="row"><a class="link" href="${gmaps(c.lat,c.lng)}" target="_blank" rel="noopener">Open in Google Maps</a></div>`:""}`;
  return div;
}

/* ---------- side panel ---------- */
function thumb(c, cls){
  const url = photoSrc(c.photo_path);
  return url ? `<span class="th ${cls||""}" style="background-image:url('${url}')"></span>` : `<span class="th ${cls||""}">${icon("i-fish")}</span>`;
}
function itemCatch(c){
  return `<li><button class="item" data-go="c:${esc(c.id)}">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}</b><small>${esc([fmtDate(c.caught_on), c.fly, c.county && !currentCounty ? countyName(c.county) : ""].filter(Boolean).join(" · "))}</small></span><span class="num">${fishOf(c)!==1?`<span class="f">×${fishOf(c)}</span>`:""}${c._pending?" ⋯":""}</span></button></li>`;
}
function itemSpot(s){
  const v = spotVisits(s);
  return `<li><button class="item" data-go="s:${esc(s.id)}"><span class="th sp">${icon("i-pin")}</span><span class="t"><b>${esc(s.name||"Unnamed spot")}</b><small>${esc([v.last ? "Last fished " + fmtDate(v.last) : "", s.water, s.trout_class].filter(Boolean).join(" · "))}</small></span><span class="num"><span class="pill ${esc(s.status)}">${STATUS[s.status]||""}</span></span></button></li>`;
}
const byDateDesc = (a,b) => (b.caught_on||"").localeCompare(a.caught_on||"") || (b.created_at||"").localeCompare(a.created_at||"");

function statusLine(){
  if(loadState==="loading") return `<p class="status">Loading your log…</p>`;
  if(loadState==="offline") return `<p class="status">You're offline. Showing what was saved on this phone; new entries will sync when you're back online.</p>`;
  return "";
}
let showAllWaters = false;
function watersBlock(id){
  const names = waterNames(id);
  if(!names) return `<h4><span>Creeks &amp; rivers</span></h4><p class="status">Loading creeks…</p>`;
  if(!names.length) return "";
  const list = showAllWaters ? names : names.slice(0, 12);
  return `<h4><span>Creeks &amp; rivers</span><span>${names.length}</span></h4><ul class="list">${list.map(([n,o,c])=>`<li><button class="item" data-water="${esc(n)}" style="grid-template-columns:1fr auto;padding-block:5px"><span class="t"><b class="wname">${esc(n)}</b></span><span class="num">${c?`<span class="tclass" style="background:var(${TROUT[c].tok})">${TROUT[c].label}</span>`:o>=5?"river":""}</span></button></li>`).join("")}</ul>
    ${names.length>12?`<button class="link" data-a="morewaters" style="margin-top:6px">${showAllWaters?"Show fewer":"Show all " + names.length}</button>`:""}`;
}
let flashT;
function flashWater(name){
  const hits = detailStreams.filter(x => x.name === name).map(x => x.line);
  if(!hits.length) return;
  map.fitBounds(L.featureGroup(hits).getBounds(), { padding:[40,40], maxZoom:14 });
  map.once("moveend", () => { setHover(name); clearTimeout(flashT); flashT = setTimeout(() => setHover(null), 2600); });
}
function renderMapTab(el){
  if(!currentCounty){
    const T = totals();
    const rows = counties.map(f=>({ id:f.id, name:f.properties.name, ...countyStats(f.id) })).filter(r=>r.spots||r.fish).sort((a,b)=>b.fish-a.fish||b.spots-a.spots||a.name.localeCompare(b.name));
    const recent = [...catches].sort(byDateDesc).slice(0,6);
    const want = spots.filter(s => s.status === "want").slice(0, 5);
    const ann = announcements[0] && (Date.now() - new Date(announcements[0].created_at)) < 14*864e5 ? `<div class="card notice" style="margin:8px 0 4px"><p class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">From the creator</p><p>${esc(announcements[0].body)}</p></div>` : "";
    el.innerHTML = `<div class="eyebrow">Statewide</div><h2>Wisconsin</h2>${statusLine()}${ann}
      <div class="stats"><div class="stat s"><b>${T.spots}</b><span>potential spots</span></div><div class="stat f"><b>${T.fish}</b><span>fish caught</span></div><div class="stat"><b>${T.counties}<small style="font-size:13px;color:var(--muted)">/72</small></b><span>counties</span></div></div>
      ${rows.length ? `<h4><span>Counties</span><span>spots · fish</span></h4><ul class="list">${rows.map(r=>`<li><button class="item" data-county="${r.id}" style="grid-template-columns:1fr auto"><span class="t"><b>${esc(r.name)} County</b></span><span class="num"><span class="s">${r.spots}</span> · <span class="f">${r.fish}</span></span></button></li>`).join("")}</ul>` :
        (loadState!=="loading" ? `<div class="empty"><b>Your log is empty</b>Tap a county to zoom in, then use <b style="display:inline;font:inherit;color:var(--spot)">Add spot</b> for water you want to try, or <b style="display:inline;font:inherit;color:var(--fish)">Log a catch</b> with a photo. Counties fill in as you go.</div>` : "")}
      ${want.length?`<h4><span>Want to try</span></h4><ul class="list">${want.map(itemSpot).join("")}</ul>`:""}
      ${recent.length?`<h4><span>Recent catches</span></h4><ul class="list">${recent.map(itemCatch).join("")}</ul>`:""}
      <p class="note">Statewide view shows major rivers. Open a county to see every named creek, river and lake, DNR trout stream classes and regulations, and public land. Region outlines are approximate.</p>`;
  } else {
    const f = byId[currentCounty], s = countyStats(currentCounty);
    const sp = spots.filter(x=>x.county===currentCounty).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    const ca = catches.filter(x=>x.county===currentCounty).sort(byDateDesc);
    const fc = friendCatches.filter(x=>x.county===currentCounty);
    el.innerHTML = `<div class="eyebrow">County</div><h2>${esc(f.properties.name)} County</h2>${statusLine()}
      <div class="stats"><div class="stat s"><b>${s.spots}</b><span>potential spots</span></div><div class="stat f"><b>${s.fish}</b><span>fish caught</span></div><div class="stat"><b>${new Set(ca.map(c=>c.caught_on)).size}</b><span>days fished</span></div></div>
      <h4><span>Spots</span></h4>${sp.length?`<ul class="list">${sp.map(itemSpot).join("")}</ul>`:`<div class="empty">No spots in ${esc(f.properties.name)} County yet. Tap a creek and choose <b style="display:inline;font:inherit;color:var(--spot)">Add as spot</b>, or use <b style="display:inline;font:inherit;color:var(--spot)">Add spot</b>.</div>`}
      <h4><span>Catches</span></h4>${ca.length?`<ul class="list">${ca.map(itemCatch).join("")}</ul>`:`<div class="empty">No catches logged here yet.</div>`}
      ${fc.length?`<h4><span>Friends here</span><span>${fc.reduce((a,c)=>a+fishOf(c),0)} fish</span></h4><ul class="list">${fc.slice(0,8).map(c=>`<li><button class="item" data-go="${c.lat!=null?"f:"+esc(c.id):""}">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}</b><small>${esc(c.display_name)} · ${esc(fmtDate(c.caught_on))}${c.lat==null?" · county only":""}</small></span><span class="num"></span></button></li>`).join("")}</ul>`:""}
      ${watersBlock(currentCounty)}`;
  }
}
function renderLog(){
  const el = $("log"); const T = totals();
  $("tSpots").textContent = T.spots; $("tFish").textContent = T.fish; $("tCounties").textContent = T.counties;
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  const big = tab !== "map", mainEl = document.querySelector(".main");
  if(mainEl.classList.contains("panel-big") !== big){ mainEl.classList.toggle("panel-big", big); setTimeout(() => { map.invalidateSize(); drawLabels(); }, 300); }
  $("reqDot").hidden = !friendships.some(f => f.status === "pending" && f.addressee === me?.id);
  $("tDot").hidden = !tournaments.some(t => t.my_status === "invited");
  if(tab === "map") renderMapTab(el);
  else if(tab === "trips") renderTripsTab(el);
  else if(tab === "tourney") renderTourneyTab(el);
  else if(tab === "friends") renderFriendsTab(el);
  else if(tab === "stats") renderStatsTab(el);
  else renderMeTab(el);
}
function setTab(t){ if(t === "me" && tab !== "me") meView = "main"; if(t === "tourney" && tab === "tourney") tourneyOpen = null; if(t === "trips" && tab === "trips") tripOpen = null; tab = t; lsSet("fl.tab", t); renderLog(); $("log").scrollTop = 0; if(t === "tourney") loadTournaments(); }
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if(b) setTab(b.dataset.tab); });

$("log").addEventListener("click", ev => {
  const c = ev.target.closest("[data-county]"); if(c){ openCounty(c.dataset.county); return; }
  const w = ev.target.closest("[data-water]"); if(w){ flashWater(w.dataset.water); return; }
  if(ev.target.closest('[data-a="morewaters"]')){ showAllWaters = !showAllWaters; renderLog(); return; }
  const g = ev.target.closest("[data-go]"); if(g && g.dataset.go){ focusMarker(g.dataset.go); }
});
function focusMarker(key){
  const m = markerIndex[key]; if(!m) return;
  const ll = m.getLatLng();
  if(key.startsWith("f:") && !showFriends){ showFriends = true; lsSet("fl.showFriends", true); }
  map.flyTo(ll, Math.max(map.getZoom(), 12), { duration:.6 });
  map.once("moveend", () => { updateZoomLayers(); m.openPopup(); });
}
let renderQueued = false;
function renderAll(){ if(renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderBadges(); renderMarkers(); countyLayer.setStyle(countyStyle); updateZoomLayers(); renderLog(); }); }

function openCounty(id){
  currentCounty = id; $("backBtn").hidden = false;
  const layer = countyLayer.getLayers().find(l => l.feature.id === id);
  if(layer) map.fitBounds(layer.getBounds(), { padding:[24,24] });
  if(tab !== "map") tab = "map";
  countyLayer.setStyle(countyStyle); setMask(id); updateZoomLayers(); renderLog(); showDetail(id);
}
function backToState(){ currentCounty = null; clearDetail(); setMask(null); $("backBtn").hidden = true; fitState(); countyLayer.setStyle(countyStyle); updateZoomLayers(); renderLog(); }
$("backBtn").addEventListener("click", backToState);


/* ---------- EXIF (JPEG GPS + date) ---------- */
function readExif(buf){
  const v = new DataView(buf); if(v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while(off < v.byteLength - 4){
    const marker = v.getUint16(off); const size = v.getUint16(off+2);
    if(marker === 0xFFE1 && v.getUint32(off+4) === 0x45786966) return parseTiff(v, off+10);
    if((marker & 0xFF00) !== 0xFF00) break;
    off += 2 + size;
  }
  return null;
}
function parseTiff(v, start){
  const le = v.getUint16(start) === 0x4949;
  const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const out = {};
  function ifd(o){ const tags={}; const n=u16(o); for(let i=0;i<n;i++){ const e=o+2+i*12; tags[u16(e)] = { type:u16(e+2), count:u32(e+4), valOff:e+8 }; } return tags; }
  const rat = (o) => u32(o) / (u32(o+4) || 1);
  const str = (t) => { const p = t.count > 4 ? start + u32(t.valOff) : t.valOff; let s=""; for(let i=0;i<t.count-1;i++) s += String.fromCharCode(v.getUint8(p+i)); return s; };
  try{
    const ifd0 = ifd(start + u32(start+4));
    if(ifd0[0x8769]){ const ex = ifd(start + u32(ifd0[0x8769].valOff)); const t = ex[0x9003] || ex[0x9004]; if(t) out.date = str(t); }
    if(!out.date && ifd0[0x0132]) out.date = str(ifd0[0x0132]);
    if(ifd0[0x8825]){
      const g = ifd(start + u32(ifd0[0x8825].valOff));
      if(g[2] && g[4]){
        const tri = t => { const p = start + u32(t.valOff); return rat(p) + rat(p+8)/60 + rat(p+16)/3600; };
        let lat = tri(g[2]), lng = tri(g[4]);
        if(g[1] && String.fromCharCode(v.getUint8(g[1].valOff)) === "S") lat = -lat;
        if(g[3] && String.fromCharCode(v.getUint8(g[3].valOff)) === "W") lng = -lng;
        if(isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
      }
    }
  }catch(e){}
  return out;
}

/* ---------- catch / spot form ---------- */
let photoDate = null;
let formKind = "catch", editing = null, photoFile = null, photoPreviewUrl = null, picking = false, pickMarker = null, tripTouched = false, visibility = "county";
function setKind(k){
  formKind = k;
  $("segFish").setAttribute("aria-pressed", k==="catch"); $("segSpot").setAttribute("aria-pressed", k==="spot");
  $("catchFields").hidden = k!=="catch"; $("catchFields2").hidden = k!=="catch";
  $("spotFields").hidden = k!=="spot"; $("nameField").hidden = k!=="spot";
  $("formTitle").textContent = editing ? (k==="catch"?"Edit catch":"Edit spot") : (k==="catch"?"Log a catch":"Add a spot");
  $("saveBtn").textContent = k==="catch" ? "Save catch" : "Save spot";
  $("saveBtn").className = "btn " + (k==="catch"?"fish":"spot");
  $("segFish").disabled = $("segSpot").disabled = !!editing;
  if(!editing) setVis(k === "spot" ? "private" : "county");
}
$("segFish").onclick = () => setKind("catch");
$("segSpot").onclick = () => setKind("spot");
function setVis(v){ visibility = v; $("visSeg").querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); }
$("visSeg").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if(b) setVis(b.dataset.v); });

function parseCoords(s){
  const m = String(s).match(/(-?\d+(?:\.\d+)?)\s*[°]?\s*([NS])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[°]?\s*([EW])?/i);
  if(!m) return null;
  let lat = parseFloat(m[1]), lng = parseFloat(m[3]);
  if(m[2] && m[2].toUpperCase()==="S") lat = -Math.abs(lat);
  if(m[4] && m[4].toUpperCase()==="W") lng = -Math.abs(lng);
  if(!m[4] && lng > 80 && lng < 95) lng = -lng; // "43.6, 90.9" → western hemisphere
  if(Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function coordHint(){
  const h = $("coordHint"); const c = parseCoords($("fCoords").value);
  if(!$("fCoords").value.trim()){ h.className="hint"; h.textContent="Use your location, pick on the map, or paste coordinates."; fillSpotOptions(null); return; }
  if(!c){ h.className="hint bad"; h.textContent="Use decimal coordinates like 43.6120, -90.9081."; return; }
  const cid = countyAt(c.lat, c.lng);
  h.className = cid ? "hint ok" : "hint bad";
  h.textContent = cid ? `In ${countyName(cid)}.` : "That point is outside Wisconsin. It will save, but won't count toward a county.";
  fillSpotOptions(c);
}
$("fCoords").addEventListener("input", coordHint);

function fillSpotOptions(c){
  const sel = $("fSpotLink"); const keep = sel.value;
  const d = s => c ? Math.hypot((s.lat-c.lat)*111, (s.lng-c.lng)*111*Math.cos(c.lat*Math.PI/180)) : 0;
  const list = [...spots].sort((a,b)=>d(a)-d(b) || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">None</option>` + list.map(s=>`<option value="${esc(s.id)}">${esc(s.name||"Unnamed spot")}${c?` (${(d(s)*0.621).toFixed(1)} mi)`:""}</option>`).join("");
  if(keep && list.some(s=>s.id===keep)) sel.value = keep;
  else if(c && list.length && d(list[0]) < 1.5 && !editing) sel.value = list[0].id;
}
function tripFor(date){ return trips.filter(t => t.start_date <= date && date <= t.end_date).sort((a,b) => b.start_date.localeCompare(a.start_date))[0] || null; }
function fillTripOptions(selected){
  const sel = $("fTrip");
  const list = [...trips].sort((a,b) => b.start_date.localeCompare(a.start_date));
  sel.innerHTML = `<option value="">No trip</option>` + list.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(fmtRange(t.start_date, t.end_date))})</option>`).join("");
  sel.value = selected && list.some(t => t.id === selected) ? selected : "";
}
$("fTrip").addEventListener("change", () => { tripTouched = true; });
$("fDate").addEventListener("change", () => { if(!tripTouched){ const t = tripFor($("fDate").value); $("fTrip").value = t ? t.id : ""; } });

function setPhotoPreview(url, title, sub){
  $("photoPv").style.backgroundImage = url ? `url('${url}')` : ""; $("photoPv").innerHTML = url ? "" : icon("i-fish");
  $("photoTitle").textContent = title; $("photoSub").textContent = sub;
}
$("fPhoto").addEventListener("change", async () => {
  const file = $("fPhoto").files[0]; if(!file) return;
  photoFile = file; photoDate = null;
  if(photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  let ex = null; try{ ex = readExif(await file.arrayBuffer()); }catch(e){}
  const found = [];
  if(ex && ex.lat != null){ $("fCoords").value = `${ex.lat.toFixed(5)}, ${ex.lng.toFixed(5)}`; coordHint(); found.push("location"); }
  if(ex && ex.date){ const m = ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m){ photoDate = `${m[1]}-${m[2]}-${m[3]}`; $("fDate").value = photoDate; $("fDate").dispatchEvent(new Event("change")); found.push("date"); } }
  setPhotoPreview(photoPreviewUrl, file.name || "Photo",
    (found.length ? `Filled ${found.join(" and ")} from the photo.` : "No location in this photo. Tap Here or Map below.") + (photoDate ? "" : " It has no date stamp, so it can't count in photo tournaments."));
  $("photoSub").style.color = found.includes("location") ? "var(--spot)" : "var(--danger)";
});

/* phone GPS */
$("gpsBtn").onclick = () => {
  const h = $("coordHint");
  if(!navigator.geolocation){ h.className = "hint bad"; h.textContent = "This browser can't share your location. Pick on the map instead."; return; }
  h.className = "hint"; h.textContent = "Finding your location…"; $("gpsBtn").disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $("gpsBtn").disabled = false;
    $("fCoords").value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`; coordHint();
    if(pos.coords.accuracy > 100) h.textContent += ` Accurate to about ${Math.round(pos.coords.accuracy * 3.28)} ft.`;
  }, err => {
    $("gpsBtn").disabled = false; h.className = "hint bad";
    h.textContent = err.code === 1 ? "Location is turned off for this app. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using." : "Couldn't get a GPS fix. Try again in the open, or pick on the map.";
  }, { enableHighAccuracy:true, timeout:20000, maximumAge:30000 });
};

function openForm(kind, rec, prefill){
  if(!canWrite){ toast("Sign in to save entries."); return; }
  editing = rec || null; photoFile = null; photoDate = null; tripTouched = !!rec; $("fPhoto").value = ""; $("formErr").textContent = ""; $("photoSub").style.color = "";
  setKind(kind);
  const r = rec || prefill || {};
  $("fCoords").value = (r.lat != null) ? `${(+r.lat).toFixed(5)}, ${(+r.lng).toFixed(5)}` : "";
  $("fName").value = r.name || ""; $("fWater").value = r.water || "Creek"; $("fClass").value = r.trout_class || ""; $("fTarget").value = r.target || ""; $("fStatus").value = r.status || "want";
  $("fSpecies").value = r.species || ""; $("fLen").value = r.length_in ?? ""; $("fCount").value = r.count ?? 1; $("fFly").value = r.fly || "";
  $("fDate").value = r.caught_on || todayStr(); $("fNotes").value = r.notes || "";
  fillTripOptions(rec ? rec.trip_id : (r.trip_id || (tripFor($("fDate").value)?.id)));
  fillSpotOptions(r.lat != null ? { lat:+r.lat, lng:+r.lng } : null); $("fSpotLink").value = r.spot_id || $("fSpotLink").value;
  if(rec) setVis(rec.visibility);
  const url = photoSrc(r.photo_path);
  if(r.photo_path) setPhotoPreview(url, "Photo saved", "Choose another to replace it");
  else setPhotoPreview(null, "Add a photo", "Location and date fill in from the photo when it has them");
  coordHint();
  $("scrim").hidden = false;
}
function closeForm(){ $("scrim").hidden = true; editing = null; }
$("addCatchBtn").onclick = () => openForm("catch");
$("addSpotBtn").onclick = () => openForm("spot");
$("cancelBtn").onclick = closeForm;
$("scrim").addEventListener("click", e => { if(e.target === $("scrim")) closeForm(); });
document.addEventListener("keydown", e => { if(e.key === "Escape"){ if(picking) endPick(); else if(!$("scrim").hidden) closeForm(); else if(!$("tripScrim").hidden) closeTripForm(); } });

/* pick on map */
$("pickBtn").onclick = () => {
  picking = true; $("scrim").hidden = true; $("pickbar").hidden = false; $("fab").hidden = true;
  map.getContainer().style.cursor = "crosshair";
};
function endPick(){ picking = false; $("pickbar").hidden = true; $("fab").hidden = false; map.getContainer().style.cursor = ""; $("scrim").hidden = false; }
$("pickCancel").onclick = endPick;
function handlePick(ll){
  $("fCoords").value = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  if(pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.circleMarker(ll, { radius:7, color:css("--ink"), weight:2, fillColor:css("--paper"), fillOpacity:1 }).addTo(map);
  setTimeout(() => { if(pickMarker){ map.removeLayer(pickMarker); pickMarker = null; } }, 2500);
  endPick(); coordHint();
}
map.on("click", e => {
  if(picking){ handlePick(e.latlng); return; }
  if(currentCounty){ const cid = countyAt(e.latlng.lat, e.latlng.lng); if(cid && cid !== currentCounty) openCounty(cid); }
});

/* shrink photos before upload; re-encoding also drops the photo's hidden GPS data */
async function shrink(file){
  const MAX = 1600;
  let bmp; try{ bmp = await createImageBitmap(file, { imageOrientation:"from-image" }); }catch(e){ bmp = null; }
  if(!bmp){
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height, k = Math.min(1, MAX / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.round(w*k); cv.height = Math.round(h*k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return await new Promise(res => cv.toBlob(res, "image/jpeg", 0.82));
}

$("entryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("formErr"); err.className = "hint bad"; err.textContent = "";
  const c = parseCoords($("fCoords").value);
  if(formKind==="spot" && !c){ err.textContent = "Add a location: tap Here, pick on the map, or paste coordinates."; $("fCoords").focus(); return; }
  if(formKind==="catch" && !c && $("fCoords").value.trim()){ err.textContent = "Those coordinates don't look right. Use a format like 43.6120, -90.9081."; return; }
  if(formKind==="spot" && !$("fName").value.trim()){ err.textContent = "Give the spot a name."; $("fName").focus(); return; }
  const len = $("fLen").value.trim();
  if(formKind==="catch" && len && !(+len >= 0 && +len <= 80)){ err.textContent = "Length should be in inches, like 14 or 15.5."; $("fLen").focus(); return; }
  if(formKind==="catch" && !$("fDate").value){ err.textContent = "Add the date you caught it."; $("fDate").focus(); return; }
  const btn = $("saveBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Saving…";
  try{
    const base = { id: editing ? editing.id : uuid(), lat: c ? c.lat : null, lng: c ? c.lng : null, county: c ? countyAt(c.lat,c.lng) : (editing?.county || null),
      notes: $("fNotes").value.trim() || null, visibility };
    let rec, table, blob = null;
    if(formKind==="catch"){
      table = "catches";
      if(photoFile){ btn.textContent = "Preparing photo…"; blob = await shrink(photoFile); }
      rec = { ...base, species:$("fSpecies").value.trim() || null, length_in: len ? +len : null, count: Math.max(0, parseInt($("fCount").value,10) || 0),
        fly:$("fFly").value.trim() || null, caught_on:$("fDate").value, spot_id:$("fSpotLink").value || null, trip_id:$("fTrip").value || null,
        photo_path: editing ? (editing.photo_path || null) : null,
        photo_taken_on: photoFile ? photoDate : (editing ? (editing.photo_taken_on || null) : null) };
      if($("fCount").value === "") rec.count = 1;
    } else {
      table = "spots";
      rec = { ...base, name:$("fName").value.trim(), water:$("fWater").value, trout_class:$("fClass").value || null, target:$("fTarget").value.trim() || null, status:$("fStatus").value };
    }
    const wasEditing = !!editing;
    await saveRecord(table, rec, blob, wasEditing);
    closeForm();
    const where = rec.county ? countyName(rec.county) : "your log";
    toast(navigator.onLine ? `${table==="catches"?"Catch":"Spot"} saved in ${where}` : `Saved on this phone. It will sync when you're back online.`);
    if(rec.county && !currentCounty && !wasEditing) openCounty(rec.county);
  }catch(e){
    console.error(e);
    err.textContent = e && e.userMessage ? e.userMessage : "Couldn't save. Check your connection and try again.";
  }finally{ btn.disabled = false; btn.textContent = label; }
});


/* ---------- Supabase connection ---------- */
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"fl.auth" }
});
const COLS = {
  catches: ["id","trip_id","spot_id","lat","lng","county","species","length_in","count","fly","caught_on","notes","photo_path","visibility","photo_taken_on"],
  spots: ["id","name","lat","lng","county","water","trout_class","target","notes","status","visibility"],
  trips: ["id","name","start_date","end_date","base","notes","shared"]
};
const pick = (table, r) => { const o = {}; for(const k of COLS[table]) if(k in r) o[k] = r[k] === undefined ? null : r[k]; return o; };
const listFor = t => t === "catches" ? catches : t === "spots" ? spots : trips;
function setList(t, v){ if(t === "catches") catches = v; else if(t === "spots") spots = v; else trips = v; }

/* ---------- photo blobs waiting to upload (IndexedDB) ---------- */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("flylog", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("blobs", mode); const s = t.objectStore("blobs"); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { put:(k,v) => tx("readwrite", s => s.put(v, k)), get:k => tx("readonly", s => s.get(k)), del:k => tx("readwrite", s => s.delete(k)) };
})();

/* ---------- photo display: short-lived signed links, fetched in batches ---------- */
const photoCache = {}, pendingPhotoUrls = {};
let photoWant = new Set(), photoTimer = null;
function photoSrc(path){
  if(!path) return "";
  if(pendingPhotoUrls[path]) return pendingPhotoUrls[path];
  const c = photoCache[path];
  if(c && c.exp > Date.now()) return c.url;
  if(!c || !c.failed){ photoWant.add(path); clearTimeout(photoTimer); photoTimer = setTimeout(fetchPhotoUrls, 60); }
  return c ? c.url : "";
}
async function fetchPhotoUrls(){
  const paths = [...photoWant]; photoWant = new Set();
  if(!paths.length || !navigator.onLine || !me) return;
  try{
    const { data, error } = await sb.storage.from("photos").createSignedUrls(paths, 60*60*6);
    if(error) throw error;
    for(const d of data){ if(d.signedUrl) photoCache[d.path] = { url:d.signedUrl, exp:Date.now() + 5.5*3600*1000 }; else photoCache[d.path] = { url:"", exp:0, failed:true }; }
    renderAll();
  }catch(e){ console.warn("photo links", e); }
}

/* ---------- offline outbox ---------- */
let outbox = [];
const outboxKey = () => "fl.outbox." + (me?.id || "anon");
const cacheKey = () => "fl.cache." + (me?.id || "anon");
function saveOutbox(){ lsSet(outboxKey(), outbox); updateSync(); }
function saveCache(){ lsSet(cacheKey(), { catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile, follows, tournaments, announcements, at:Date.now() }); }
function updateSync(){
  const el = $("sync"); const n = outbox.length;
  if(!navigator.onLine){ el.hidden = false; el.className = "sync"; el.innerHTML = `${icon("i-cloud-off")}Offline${n?` · ${n} to sync`:""}`; return; }
  if(n){ el.hidden = false; el.className = "sync" + (syncFailing ? " warn" : ""); el.textContent = syncFailing ? `${n} not synced yet` : `Syncing ${n}…`; return; }
  el.hidden = true;
}
let flushing = false, syncFailing = false;
async function flush(){
  if(flushing || !me || !navigator.onLine) { updateSync(); return; }
  flushing = true; updateSync();
  try{
    while(outbox.length){
      const job = outbox[0];
      try{
        if(job.op === "upsert"){
          if(job.photo){
            const blob = await idb.get(job.photo);
            if(blob){
              const { error } = await sb.storage.from("photos").upload(job.photo, blob, { contentType:"image/jpeg", upsert:true });
              if(error) throw error;
            }
          }
          const { error } = await sb.from(job.table).upsert(job.row);
          if(error) throw error;
          if(job.table === "catches"){
            sb.rpc("auto_enter", { cid: job.row.id }).then(({ data }) => {
              if(job.isNew && data && data.length) toast(`Entered in ${data.join(", ")}`);
              if(data && data.length) loadTournaments();
            });
          }
          if(job.oldPhoto) await sb.storage.from("photos").remove([job.oldPhoto]);
          if(job.photo){ await idb.del(job.photo).catch(()=>{}); }
          const rec = listFor(job.table).find(r => r.id === job.row.id); if(rec) delete rec._pending;
        } else if(job.op === "delete"){
          const { error } = await sb.from(job.table).delete().eq("id", job.id);
          if(error) throw error;
          if(job.photo) await sb.storage.from("photos").remove([job.photo]);
        }
        outbox.shift(); saveOutbox(); syncFailing = false;
      }catch(e){
        const status = e && (e.status || e.statusCode);
        const offline = !navigator.onLine || (e && /fetch|network|Load failed/i.test(String(e.message || e)));
        if(offline){ break; }
        console.error("sync", job, e);
        if(status && String(status).startsWith("4")){ outbox.shift(); saveOutbox(); toast("One change couldn't be saved and was skipped."); continue; }
        syncFailing = true; break;
      }
    }
  } finally { flushing = false; updateSync(); saveCache(); renderAll(); }
}
window.addEventListener("online", () => { loadAll(); flush(); });
window.addEventListener("offline", () => { updateSync(); if(loadState === "ready") { loadState = "offline"; renderLog(); } });
setInterval(() => { if(outbox.length) flush(); }, 30000);

async function saveRecord(table, rec, blob, isEdit){
  if(!me) throw Object.assign(new Error("signed out"), { userMessage:"Sign in to save." });
  const job = { op:"upsert", table, row: pick(table, rec), isNew: !isEdit };
  if(blob){
    const path = `${me.id}/${rec.id}-${Date.now()}.jpg`;
    await idb.put(path, blob);
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    if(isEdit && rec.photo_path) job.oldPhoto = rec.photo_path;
    rec.photo_path = path; job.row.photo_path = path; job.photo = path;
  }
  // newer edits of the same record replace a waiting one
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id && !j.photo));
  outbox.push(job); saveOutbox();
  const list = listFor(table).filter(r => r.id !== rec.id);
  const prev = listFor(table).find(r => r.id === rec.id) || {};
  list.push({ ...prev, ...rec, user_id: me.id, created_at: prev.created_at || new Date().toISOString(), _pending:true });
  setList(table, list); saveCache(); renderAll();
  flush();
}
async function removeRecord(kind, rec){
  const table = kind === "catch" ? "catches" : kind === "spot" ? "spots" : "trips";
  setList(table, listFor(table).filter(r => r.id !== rec.id));
  if(table === "spots") catches.forEach(c => { if(c.spot_id === rec.id) c.spot_id = null; });
  if(table === "trips") catches.forEach(c => { if(c.trip_id === rec.id) c.trip_id = null; });
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id));
  outbox.push({ op:"delete", table, id:rec.id, photo: rec.photo_path && !pendingPhotoUrls[rec.photo_path] ? rec.photo_path : null });
  saveOutbox(); saveCache(); renderAll();
  toast(`${kind === "catch" ? "Catch" : kind === "spot" ? "Spot" : "Trip"} deleted`);
  flush();
}

/* ---------- loading everything for the signed-in angler ---------- */
async function loadAll(){
  if(!me || !navigator.onLine) return;
  try{
    const [c, s, t, fc, fs, ft, fr, pr, fo, an, su] = await Promise.all([
      sb.from("catches").select("*").order("caught_on", { ascending:false }),
      sb.from("spots").select("*"),
      sb.from("trips").select("*").order("start_date", { ascending:false }),
      sb.rpc("friend_catches"), sb.rpc("friend_spots"), sb.rpc("friend_trips"),
      sb.from("friendships").select("*"),
      sb.from("profiles").select("*").eq("id", me.id).maybeSingle(),
      sb.rpc("my_follows"),
      sb.from("announcements").select("*").order("created_at", { ascending:false }).limit(5),
      sb.from("suggestions").select("*").eq("user_id", me.id).order("created_at", { ascending:false })
    ]);
    for(const r of [c, s, t, fc, fs, ft, fr, pr, fo, an, su]) if(r.error) throw r.error;
    follows = fo.data || []; announcements = an.data || []; mySuggestions = su.data || [];
    // keep local changes that haven't reached the server yet
    const merge = (table, rows) => {
      const pend = outbox.filter(j => j.table === table);
      const dels = new Set(pend.filter(j => j.op === "delete").map(j => j.id));
      const ups = pend.filter(j => j.op === "upsert").map(j => listFor(table).find(r => r.id === j.row.id)).filter(Boolean);
      const upIds = new Set(ups.map(r => r.id));
      return [...rows.filter(r => !dels.has(r.id) && !upIds.has(r.id)), ...ups];
    };
    catches = merge("catches", c.data); spots = merge("spots", s.data); trips = merge("trips", t.data);
    friendCatches = fc.data || []; friendSpots = fs.data || []; friendTrips = ft.data || [];
    friendships = fr.data || []; profile = pr.data || profile;
    const ids = [...new Set(friendships.flatMap(f => [f.requester, f.addressee]).filter(id => id !== me.id))];
    if(ids.length){ const { data } = await sb.from("profiles").select("id, display_name").in("id", ids); people = Object.fromEntries((data || []).map(p => [p.id, p])); }
    loadState = "ready"; saveCache(); renderAll();
    loadTournaments();
    if(profile && !profile.onboarded) openGuide();
  }catch(e){
    console.error("load", e);
    if(loadState === "loading") loadState = navigator.onLine ? "ready" : "offline";
    renderAll();
  }
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && me){ loadAll(); flush(); } });

/* ---------- friends ---------- */
async function addFriend(code){
  code = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if(code.length !== 6) throw new Error("Friend codes are 6 letters and numbers.");
  if(code === profile?.friend_code) throw new Error("That's your own code. Share it with a friend instead.");
  const { data, error } = await sb.from("profiles").select("id, display_name").eq("friend_code", code).maybeSingle();
  if(error) throw new Error("Couldn't look up that code. Check your connection and try again.");
  if(!data) throw new Error("No one has that friend code. Check it and try again.");
  const ins = await sb.from("friendships").insert({ addressee: data.id });
  if(ins.error){ if(ins.error.code === "23505") throw new Error(`You and ${data.display_name} are already connected or have a request waiting.`); throw new Error("Couldn't send the request. Try again."); }
  await loadAll();
  return data.display_name;
}
async function answerRequest(id, accept){
  const r = accept ? await sb.from("friendships").update({ status:"accepted" }).eq("id", id) : await sb.from("friendships").delete().eq("id", id);
  if(r.error) throw r.error;
  await loadAll();
}


/* ---------- trout season status from DNR regulation text ---------- */
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function parseDay(txt, year){
  if(!txt) return null;
  let m = txt.match(/first\s+saturday\s+in\s+([a-z]+)/i);
  if(m){ const mi = MONTHS.indexOf(m[1].slice(0,3).toLowerCase()); if(mi < 0) return null; const d = new Date(year, mi, 1); while(d.getDay() !== 6) d.setDate(d.getDate()+1); return d; }
  m = txt.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if(m) return new Date(year, MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  return null;
}
function parseRange(txt, year){
  if(!txt) return null;
  const parts = txt.split(/\bto\b|\bthrough\b|–/i);
  if(parts.length < 2) return null;
  const a = parseDay(parts[0], year), b = parseDay(parts[1], year);
  if(!a || !b) return null;
  if(b < a) b.setFullYear(year + 1);
  return [a, b];
}
function seasonStatus(reg, now = new Date()){
  const season = reg[3] || "", early = reg[4] || "";
  if(/open all year|year[- ]round|no closed season/i.test(season)) return { kind:"open", label:"Open now", note:"Open all year" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const ranges = [];
  for(const yy of [y - 1, y, y + 1]){
    const r = parseRange(season, yy); if(r) ranges.push({ kind:"open", a:r[0], b:r[1], end:"inclusive" });
    const e = parseRange(early, yy); if(e) ranges.push({ kind:"early", a:e[0], b:e[1], end:"exclusive" });
  }
  if(!ranges.length) return null;
  const inR = r => today >= r.a && (r.end === "inclusive" ? today <= r.b : today < r.b);
  const cur = ranges.find(r => r.kind === "open" && inR(r)) || ranges.find(r => r.kind === "early" && inR(r));
  const f = d => d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
  if(cur && cur.kind === "open") return { kind:"open", label:"Open now", note:`Regular season through ${f(cur.b)}` };
  if(cur) return { kind:"early", label:"Early season", note:"Catch and release, artificial lures only (check the rule below)" };
  const next = ranges.filter(r => r.a > today).sort((p, q) => p.a - q.a)[0];
  return { kind:"closed", label:"Closed", note: next ? `Opens ${f(next.a)}${next.a.getFullYear() !== y ? " " + next.a.getFullYear() : ""}${next.kind === "early" ? " (early catch-and-release season)" : ""}` : "" };
}
function seasonHtml(reg){
  const s = reg && seasonStatus(reg);
  if(!s) return "";
  return `<div class="season"><span><span class="pill ${s.kind}">${s.label}</span></span>${s.note?`<small>${esc(s.note)}</small>`:""}</div>`;
}
async function regNear(cid, lat, lng, name){
  if(!cid || lat == null) return null;
  const t = await getJSON(troutCache, dataUrl("water/trout/" + cid + ".json"), cid).catch(() => null);
  if(!t) return null;
  const p = [lng, lat]; let best = null, bd = Infinity;
  const nm = (name || "").toLowerCase();
  for(const r of t.r){ const same = r[0] && nm.includes(r[0].toLowerCase().replace(/\s*\(.*\)/, ""));
    for(const pa of r[7]) for(const q of pa){ const d = d2(p, q) * (same ? .25 : 1); if(d < bd){ bd = d; best = r; } } }
  return bd < 0.0004 ? best : null;
}

/* ---------- public land and easements ---------- */
map.createPane("access"); map.getPane("access").style.zIndex = 410;
const accessCache = {};
let accessLayer = null, accessRenderer = null;
const ACCESS = {
  dnr:   { title:"DNR land", note:"Owned by the DNR and open to the public." },
  dnre:  { title:"DNR easement", note:"Public access through a DNR easement. On stream easements, access is usually limited to the stream corridor." },
  trout: { title:"Trout fishing easement", note:"Fishing access along the stream on private land. Stay near the water and respect the landowner." },
  cf:    { title:"County forest", note:"County forest land, open to the public." },
  usfs:  { title:"National forest", note:"Chequamegon-Nicolet National Forest, open to the public." },
  nps:   { title:"National Park Service land", note:"Federal land, generally open to the public." }
};
function accessPopup(kind, name, extra){
  const a = ACCESS[kind] || ACCESS.dnr;
  return `<div class="pop"><h3>${esc(name || a.title)}</h3><div class="meta">${esc(a.title)}${extra?` · ${esc(extra)}`:""}</div><p style="margin:8px 0 4px">${esc(a.note)}</p><small class="muted">From DNR's public lands maps. Check posted signs and property rules before you go.</small></div>`;
}
async function loadAccess(id){
  clearAccess();
  if(!showAccess) return;
  let rows;
  try{ rows = await getJSON(accessCache, dataUrl("access/" + id + ".json"), id); }catch(e){ return; }
  if(detailFor !== id || !showAccess) return;
  const R = accessRenderer = L.canvas({ pane:"access", tolerance:2 });
  const g = accessLayer = L.layerGroup();
  const col = css("--pub");
  for(const [kind, name, extra, rings] of rows){
    const p = L.polygon(rings.map(r => r.map(q => [q[1], q[0]])), { renderer:R, color:col, weight: kind === "trout" || kind === "dnre" ? 1.4 : .8, dashArray: kind === "dnre" || kind === "trout" ? "4 3" : null, fillColor:col, fillOpacity: kind === "usfs" || kind === "cf" ? .12 : .26 });
    p.on("click", e => { if(picking){ handlePick(e.latlng); return; } L.popup({ maxWidth:280 }).setLatLng(e.latlng).setContent(accessPopup(kind, name, extra)).openOn(map); });
    g.addLayer(p);
  }
  g.addTo(map);
}
function clearAccess(){
  if(accessLayer){ map.removeLayer(accessLayer); accessLayer = null; }
  if(accessRenderer){ map.removeLayer(accessRenderer); accessRenderer = null; }
}
$("accessToggle").onclick = () => {
  showAccess = !showAccess; lsSet("fl.showAccess", showAccess);
  $("accessToggle").setAttribute("aria-pressed", showAccess); $("accessToggle").textContent = showAccess ? "Public land on" : "Public land off";
  if(showAccess && detailFor) loadAccess(detailFor); else clearAccess();
};
$("accessToggle").setAttribute("aria-pressed", showAccess); $("accessToggle").textContent = showAccess ? "Public land on" : "Public land off";


/* ---------- trips ---------- */
function tripCatches(t){ return catches.filter(c => c.trip_id === t.id).sort((a,b) => (a.caught_on||"").localeCompare(b.caught_on||"") || (a.created_at||"").localeCompare(b.created_at||"")); }
function daysBetween(a, b){ const out = []; const d = new Date(a + "T12:00:00"), e = new Date(b + "T12:00:00"); while(d <= e && out.length < 60){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); } return out; }
function summarize(cs){
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const species = new Set(cs.filter(c=>fishOf(c)>0).map(c=>c.species).filter(Boolean));
  const big = cs.filter(c => c.length_in != null).sort((a,b) => b.length_in - a.length_in)[0] || null;
  const flies = {}; cs.forEach(c => { if(c.fly && fishOf(c)>0) flies[c.fly] = (flies[c.fly]||0) + fishOf(c); });
  const fly = Object.entries(flies).sort((a,b)=>b[1]-a[1])[0] || null;
  return { fish, species, big, fly };
}
function renderTripsTab(el){
  if(tripOpen){ const t = trips.find(x => x.id === tripOpen); if(t) return renderTrip(el, t); tripOpen = null; }
  const today = todayStr();
  const list = [...trips].sort((a,b) => b.start_date.localeCompare(a.start_date));
  const loose = catches.filter(c => !c.trip_id).length;
  el.innerHTML = `<div class="eyebrow">Trips</div><h2>Your trips</h2>
    <p class="muted" style="margin:4px 0 12px">Catches join a trip automatically when their date falls inside it.</p>
    <button class="btn ink" type="button" data-a="newtrip">${icon("i-plus")}New trip</button>
    <div class="stack" style="margin-top:14px">${list.length ? list.map(t => {
      const s = summarize(tripCatches(t)); const now = t.start_date <= today && today <= t.end_date;
      return `<button class="trip${now?" now":""}" data-trip="${esc(t.id)}" type="button"><small>${now?"Happening now · ":""}${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</small><b>${esc(t.name)}</b>
        <span class="tnums"><span><em>${s.fish}</em> fish</span><span>${daysBetween(t.start_date, t.end_date).length} days</span>${s.big?`<span>Biggest ${lenTxt(s.big.length_in)}</span>`:""}${!t.shared?"<span>Private</span>":""}${t._pending?"<span>Waiting to sync</span>":""}</span></button>`; }).join("")
      : `<div class="empty"><b>No trips yet</b>Make one for your next outing, even a single day. Every catch you log during those dates lands in it, and you get a recap with photos, the best fly, and day-by-day notes.</div>`}</div>
    ${loose && list.length ? `<p class="note">${loose} catch${loose===1?" isn't":"es aren't"} part of a trip. Edit a catch to add it to one.</p>` : ""}`;
}
function renderTrip(el, t){
  const cs = tripCatches(t), s = summarize(cs);
  const days = daysBetween(t.start_date, t.end_date);
  const photos = cs.filter(c => c.photo_path);
  const byDay = {}; cs.forEach(c => (byDay[c.caught_on] ||= []).push(c));
  const counties_ = new Set(cs.map(c => c.county).filter(Boolean));
  el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
    <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</div><h2>${esc(t.name)}</h2>
    <div class="stats four"><div class="stat f"><b>${s.fish}</b><span>fish</span></div><div class="stat"><b>${s.species.size}</b><span>species</span></div>
      <div class="stat"><b>${s.big ? lenTxt(s.big.length_in) : "–"}</b><span>biggest</span></div><div class="stat"><b>${days.filter(d => byDay[d]?.some(c=>fishOf(c)>0)).length}/${days.length}</b><span>days with fish</span></div></div>
    ${s.fly ? `<p style="margin:0 0 6px"><b>Best fly:</b> ${esc(s.fly[0])} (${s.fly[1]} fish)</p>` : ""}
    ${counties_.size ? `<p class="muted" style="margin:0 0 8px">${[...counties_].map(countyName).join(", ")}</p>` : ""}
    ${t.notes ? `<p style="margin:6px 0 10px">${esc(t.notes)}</p>` : ""}
    ${photos.length ? `<div class="strip">${photos.map(c => `<button type="button" data-go="c:${esc(c.id)}" aria-label="${esc(c.species||"Catch")} photo" style="background-image:url('${photoSrc(c.photo_path)}')"></button>`).join("")}</div>` : ""}
    <div class="row2" style="margin:8px 0 4px">
      <button class="btn sm fish" type="button" data-a="logtrip">${icon("i-fish")}Log a catch</button>
      <button class="btn sm" type="button" data-a="fittrip">Show on map</button>
      <button class="btn sm" type="button" data-a="edittrip">Edit</button>
      <button class="btn sm" type="button" data-a="deltrip">Delete</button>
    </div><div data-slot></div>
    ${days.map(d => { const list = byDay[d] || []; const n = list.reduce((a,c)=>a+fishOf(c),0);
      return `<div class="day"><h5>${esc(fmtDate(d, { weekday:"long", month:"short", day:"numeric" }))}<span>${n} fish</span></h5>
        ${list.length ? `<ul class="list">${list.map(itemCatch).join("")}</ul>` : `<p class="skunk">${d > todayStr() ? "Still to come" : "No fish logged"}</p>`}</div>`; }).join("")}
    ${(() => { const out = cs.filter(c => !days.includes(c.caught_on)); return out.length ? `<div class="day"><h5>Outside the trip dates<span>${out.length}</span></h5><ul class="list">${out.map(itemCatch).join("")}</ul></div>` : ""; })()}
    <p class="note">${t.shared ? "Friends can see this trip and the catches in it that aren't private." : "This trip is private."}</p>`;
}
function openTrip(id){ tripOpen = id; tab = "trips"; renderLog(); $("log").scrollTop = 0; fitTrip(); }
function fitTrip(){
  const t = trips.find(x => x.id === tripOpen); if(!t) return;
  const pts = tripCatches(t).filter(c => c.lat != null).map(c => [c.lat, c.lng]);
  if(!pts.length) return;
  const cid = tripCatches(t).map(c => c.county).filter(Boolean)[0];
  if(cid && currentCounty !== cid){ currentCounty = cid; $("backBtn").hidden = false; setMask(cid); showDetail(cid); countyLayer.setStyle(countyStyle); }
  map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom:13, padding:[40,40] });
}
$("log").addEventListener("click", ev => {
  const tb = ev.target.closest("[data-trip]"); if(tb){ openTrip(tb.dataset.trip); return; }
  const a = ev.target.closest("[data-a]"); if(!a) return;
  const t = trips.find(x => x.id === tripOpen);
  switch(a.dataset.a){
    case "newtrip": openTripForm(); break;
    case "trips": tripOpen = null; renderLog(); break;
    case "edittrip": if(t) openTripForm(t); break;
    case "fittrip": fitTrip(); break;
    case "logtrip": if(t){ const d = todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date; openForm("catch", null, { caught_on:d, trip_id:t.id }); tripTouched = true; } break;
    case "deltrip": { const slot = $("log").querySelector("[data-slot]"); if(slot) slot.innerHTML = `<div class="confirm">Delete this trip? Its catches stay in your log.<button class="link danger" data-a="deltripyes" type="button">Delete trip</button><button class="link" data-a="deltripno" type="button">Keep</button></div>`; break; }
    case "deltripno": { const slot = $("log").querySelector("[data-slot]"); if(slot) slot.innerHTML = ""; break; }
    case "deltripyes": if(t){ tripOpen = null; removeRecord("trip", t); } break;
  }
});

/* trip form */
let tripEditing = null;
function openTripForm(t){
  if(!canWrite){ toast("Sign in to save trips."); return; }
  tripEditing = t || null;
  $("tripTitle").textContent = t ? "Edit trip" : "New trip"; $("tripErr").textContent = "";
  $("tName").value = t?.name || ""; $("tStart").value = t?.start_date || todayStr(); $("tEnd").value = t?.end_date || todayStr();
  $("tBase").value = t?.base || ""; $("tNotes").value = t?.notes || ""; $("tShared").checked = t ? t.shared : true;
  $("tripScrim").hidden = false; setTimeout(() => $("tName").focus({ preventScroll:true }), 50);
}
function closeTripForm(){ $("tripScrim").hidden = true; tripEditing = null; }
$("tripCancel").onclick = closeTripForm;
$("tripScrim").addEventListener("click", e => { if(e.target === $("tripScrim")) closeTripForm(); });
$("tStart").addEventListener("change", () => { if($("tEnd").value < $("tStart").value) $("tEnd").value = $("tStart").value; });
$("tripForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("tripErr"); err.className = "hint bad"; err.textContent = "";
  const name = $("tName").value.trim(), a = $("tStart").value, b = $("tEnd").value;
  if(!name){ err.textContent = "Give the trip a name."; $("tName").focus(); return; }
  if(!a || !b){ err.textContent = "Add the first and last day."; return; }
  if(b < a){ err.textContent = "The last day can't be before the first day."; $("tEnd").focus(); return; }
  if(daysBetween(a, b).length > 45){ err.textContent = "Trips can be up to 45 days long."; return; }
  const rec = { id: tripEditing ? tripEditing.id : uuid(), name, start_date:a, end_date:b, base:$("tBase").value.trim() || null, notes:$("tNotes").value.trim() || null, shared:$("tShared").checked };
  const isNew = !tripEditing;
  try{
    await saveRecord("trips", rec, null, !isNew);
    // pull in catches from these dates that aren't on another trip yet
    const adopt = catches.filter(c => !c.trip_id && c.caught_on >= a && c.caught_on <= b);
    for(const c of adopt){ await saveRecord("catches", { ...c, trip_id: rec.id }, null, true); }
    closeTripForm();
    toast(adopt.length ? `Trip saved. Added ${adopt.length} catch${adopt.length===1?"":"es"} from those dates.` : "Trip saved");
    openTrip(rec.id);
  }catch(e){ err.textContent = "Couldn't save the trip. Try again."; }
});


/* ---------- tournaments ---------- */
const REGION_COUNTIES = {
  "Driftless Area": ["Vernon","Crawford","Richland","Grant","Iowa","La Crosse","Monroe","Buffalo","Trempealeau","Pepin","Pierce","Lafayette","Sauk","Jackson"],
  "Northwoods": ["Vilas","Oneida","Forest","Florence","Iron","Price","Lincoln","Langlade","Sawyer","Ashland","Bayfield","Douglas","Washburn","Burnett","Taylor","Rusk"],
  "Central Sands": ["Adams","Waushara","Portage","Wood","Marquette","Juneau","Green Lake"]
};
const idByName = {}; counties.forEach(f => idByName[f.properties.name] = f.id);
const TROUT_SPECIES = ["Brook trout","Brown trout","Rainbow trout","Tiger trout"];
const SCORING = {
  biggest: { label:"Biggest fish", how:"Longest single fish wins." },
  top3:    { label:"Top 3 total", how:"Add up each angler's three longest fish." },
  most:    { label:"Most fish", how:"Most fish caught wins." },
  species: { label:"Most species", how:"Most different species wins." }
};
let tourneyOpen = null, tourneyBoard = {}, tourneyPeople = {};
async function loadTournaments(){
  if(!me || !navigator.onLine) return;
  const { data, error } = await sb.rpc("my_tournaments");
  if(!error){ tournaments = data || []; saveCache(); if(tab === "tourney") renderLog(); }
}
function tState(t){ const d = todayStr(); return d < t.starts_on ? "upcoming" : d > t.ends_on ? "finished" : "live"; }
function tRules(t){
  const bits = [`${fmtRange(t.starts_on, t.ends_on)}`, t.area_label || (t.counties ? `${t.counties.length} counties` : "Anywhere in Wisconsin"),
    t.species ? (t.species.length > 3 ? `${t.species.length} species` : t.species.join(", ")) : "Any species", SCORING[t.scoring]?.label];
  return bits.filter(Boolean).join(" · ");
}
function standings(t, rows){
  const by = {};
  for(const r of rows){ const u = by[r.user_id] ||= { id:r.user_id, name:r.display_name, rows:[] }; u.rows.push(r); }
  const list = Object.values(by).map(u => {
    const lens = u.rows.map(r => +r.length_in || 0).sort((a,b) => b-a);
    const v = t.scoring === "biggest" ? lens[0] || 0 : t.scoring === "top3" ? lens.slice(0,3).reduce((a,b)=>a+b,0)
      : t.scoring === "most" ? u.rows.reduce((a,r)=>a+fishOf(r),0) : new Set(u.rows.map(r => (r.species||"").toLowerCase()).filter(Boolean)).size;
    const txt = t.scoring === "biggest" || t.scoring === "top3" ? `${Math.round(v*10)/10}″` : `${v}`;
    return { ...u, v, txt, sub: `${u.rows.length} entr${u.rows.length===1?"y":"ies"}` };
  });
  return list.sort((a,b) => b.v - a.v);
}
async function openTourney(id){
  tourneyOpen = id; tab = "tourney"; renderLog(); $("log").scrollTop = 0;
  const [b, p] = await Promise.all([ sb.rpc("tournament_board", { tid:id }), sb.rpc("tournament_people", { tid:id }) ]);
  tourneyBoard[id] = b.data || []; tourneyPeople[id] = p.data || [];
  if(tourneyOpen === id && tab === "tourney") renderLog();
}
function renderTourneyTab(el){
  if(tourneyOpen){ const t = tournaments.find(x => x.id === tourneyOpen); if(t) return renderTourney(el, t); tourneyOpen = null; }
  const invites = tournaments.filter(t => t.my_status === "invited");
  const mine = tournaments.filter(t => t.my_status === "joined");
  const openOnes = tournaments.filter(t => t.open && !t.my_status && tState(t) !== "finished");
  const card = t => { const s = tState(t); return `<button class="trip${s==="live"?" now":""}" type="button" data-tourney="${esc(t.id)}"><small>${s==="live"?"Happening now":s==="upcoming"?"Starts "+esc(fmtDate(t.starts_on)):"Finished"} · by ${esc(t.owner_name)}${t.open?" · Open to everyone":""}</small><b>${esc(t.name)}</b>
    <span class="tnums"><span>${esc(tRules(t))}</span></span><span class="tnums"><span>${t.members} angler${t.members===1?"":"s"}</span><span>${t.entries} entr${t.entries===1?"y":"ies"}</span>${t.require_photo?"<span>Photo required</span>":""}</span></button>`; };
  el.innerHTML = `<div class="eyebrow">Tournaments</div><h2>Tournaments</h2>
    <p class="muted" style="margin:4px 0 12px">Set the dates, area and how it's scored, then invite friends. Catches that fit the rules are entered automatically when you log them.</p>
    <button class="btn ink" type="button" data-a="newtourney">${icon("i-plus")}New tournament</button>
    ${invites.length ? `<h4><span>Invitations</span></h4><div class="stack">${invites.map(t => `<div class="card"><p><b>${esc(t.name)}</b></p><p class="muted">${esc(t.owner_name)} invited you · ${esc(tRules(t))}</p><div class="row2"><button class="btn sm ink" type="button" data-tjoin="${esc(t.id)}">Join</button><button class="btn sm" type="button" data-tdecline="${esc(t.id)}">No thanks</button></div></div>`).join("")}</div>` : ""}
    <h4><span>Your tournaments</span></h4>
    ${mine.length ? `<div class="stack">${mine.map(card).join("")}</div>` : `<div class="empty"><b>No tournaments yet</b>Start one for a weekend or a whole season, limit it to a county or region if you like, and invite your fishing friends.</div>`}
    ${openOnes.length ? `<h4><span>Open to everyone</span></h4><div class="stack">${openOnes.map(card).join("")}</div>` : ""}`;
}
function renderTourney(el, t){
  const rows = tourneyBoard[t.id], ppl = tourneyPeople[t.id] || [];
  const s = tState(t), isOwner = t.owner === me?.id, joined = t.my_status === "joined";
  const board = rows ? standings(t, rows) : null;
  const myCatches = catches.filter(c => c.caught_on >= t.starts_on && c.caught_on <= t.ends_on);
  const entered = new Set((rows || []).map(r => r.catch_id));
  el.innerHTML = `<button class="link backlink" data-a="tourneys" type="button">${icon("i-back")}All tournaments</button>
    <div class="eyebrow">${s === "live" ? "Happening now" : s === "upcoming" ? "Upcoming" : "Finished"} · by ${esc(t.owner_name)}</div><h2>${esc(t.name)}</h2>
    ${t.description ? `<p style="margin:4px 0 8px">${esc(t.description)}</p>` : ""}
    <div class="card" style="margin:8px 0 4px">
      <p><b>Dates:</b> ${esc(fmtRange(t.starts_on, t.ends_on))}</p>
      <p><b>Area:</b> ${esc(t.area_label || (t.counties ? t.counties.map(id => byId[id]?.properties.name).filter(Boolean).join(", ") : "Anywhere in Wisconsin"))}</p>
      <p><b>Species:</b> ${esc(t.species ? t.species.join(", ") : "Any")}</p>
      <p><b>Scoring:</b> ${esc(SCORING[t.scoring]?.label)}. ${esc(SCORING[t.scoring]?.how)}</p>
      ${t.require_photo ? `<p><b>Photo:</b> Each fish needs a photo taken during the tournament dates. The app checks the date stamp saved in the photo.</p>` : ""}
    </div>
    ${t.my_status === "invited" ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button><button class="btn" type="button" data-tdecline="${esc(t.id)}">No thanks</button></div>` : ""}
    ${!t.my_status && t.open ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button></div>` : ""}
    <h4><span>${s === "finished" ? "Final standings" : "Standings"}</span><span>${SCORING[t.scoring]?.label}</span></h4>
    ${!board ? `<p class="status">Loading standings…</p>` : board.length ? `<div class="board"><ol>${board.map((r,i) => `<li class="${r.id===me?.id?"me":""}"><span class="r">${i+1}</span><span>${i===0&&s==="finished"?`<span class="pill open">Winner</span> `:""}${esc(r.name)}<small>${esc(r.sub)}</small></span><span class="v">${esc(r.txt)}</span></li>`).join("")}</ol></div>` : `<p class="muted">No entries yet.</p>`}
    ${rows && rows.length ? `<h4><span>Entries</span><span>${rows.length}</span></h4><div class="strip">${rows.filter(r => r.photo_path).map(r => `<button type="button" title="${esc(r.display_name)}: ${esc(r.species||"")} ${r.length_in?lenTxt(r.length_in):""}" style="background-image:url('${photoSrc(r.photo_path)}')" data-tphoto="${esc(r.catch_id)}"></button>`).join("")}</div>
      <ul class="list">${rows.slice().sort((a,b)=>(b.caught_on||"").localeCompare(a.caught_on||"")).map(r => `<li class="item" style="cursor:default">${thumb(r)}<span class="t"><b>${esc(r.species||"Fish")}${r.length_in?` · ${lenTxt(r.length_in)}`:""}</b><small>${esc(r.display_name)} · ${esc(fmtDate(r.caught_on))} · ${esc(countyName(r.county))}</small></span><span class="num">${r.user_id===me?.id && s!=="finished"?`<button class="link danger" type="button" data-twithdraw="${esc(r.catch_id)}">Remove</button>`:""}</span></li>`).join("")}</ul>` : ""}
    ${joined && s !== "finished" ? `<h4><span>Your catches during these dates</span></h4>${myCatches.length ? `<ul class="list">${myCatches.map(c => `<li class="item" style="cursor:default">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}</b><small>${esc(fmtDate(c.caught_on))}${c.photo_taken_on?"":" · photo has no date"}</small></span><span class="num">${entered.has(c.id)?`<span class="pill fished">Entered</span>`:`<button class="btn sm" type="button" data-tenter="${esc(c.id)}">Enter</button>`}</span></li>`).join("")}</ul><span class="hint" id="tenterMsg" role="alert"></span>` : `<p class="muted">Nothing logged during the tournament yet. Catches that fit the rules are entered when you log them.</p>`}` : ""}
    <h4><span>Anglers</span><span>${ppl.filter(p => p.status === "joined").length}</span></h4>
    <p style="margin:0">${ppl.map(p => `<span class="pill${p.status==="joined"?"":" priv"}" style="margin:0 4px 4px 0">${esc(p.display_name)}${p.status==="invited"?" (invited)":""}</span>`).join("") || `<span class="muted">Loading…</span>`}</p>
    ${joined && s !== "finished" ? `<div class="row2" style="margin-top:10px"><button class="btn sm" type="button" data-a="tinvite">Invite friends</button></div><div data-invite></div>` : ""}
    <div class="row2" style="margin-top:16px">${isOwner || profile?.role === "creator" ? `<button class="btn sm" type="button" data-a="tdelete">Delete tournament</button>` : joined ? `<button class="btn sm" type="button" data-tdecline="${esc(t.id)}">Leave tournament</button>` : ""}</div><div data-tslot></div>`;
}
function friendsList(){ return friendships.filter(f => f.status === "accepted").map(f => { const id = f.requester === me.id ? f.addressee : f.requester; return { id, name: people[id]?.display_name || "Friend" }; }); }
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const card = t.closest("[data-tourney]"); if(card){ openTourney(card.dataset.tourney); return; }
  const j = t.closest("[data-tjoin]"); if(j){ j.disabled = true; const { error } = await sb.rpc("respond_tournament", { tid:j.dataset.tjoin, accept:true }); if(error){ toast(error.message); j.disabled = false; return; }
    toast("You're in. Catches that fit will be entered as you log them."); await loadTournaments();
    for(const c of catches) await sb.rpc("auto_enter", { cid:c.id }); openTourney(j.dataset.tjoin); return; }
  const d = t.closest("[data-tdecline]"); if(d){ const { error } = await sb.rpc("respond_tournament", { tid:d.dataset.tdecline, accept:false }); if(error){ toast(error.message); return; } tourneyOpen = null; await loadTournaments(); renderLog(); return; }
  const en = t.closest("[data-tenter]"); if(en){ en.disabled = true; const { data, error } = await sb.rpc("enter_catch", { tid:tourneyOpen, cid:en.dataset.tenter });
    const msg = $("tenterMsg"); if(error || data){ if(msg){ msg.className = "hint bad"; msg.textContent = error ? "Couldn't enter it. Try again." : data; } en.disabled = false; return; }
    toast("Catch entered"); openTourney(tourneyOpen); loadTournaments(); return; }
  const w = t.closest("[data-twithdraw]"); if(w){ await sb.rpc("withdraw_catch", { tid:tourneyOpen, cid:w.dataset.twithdraw }); toast("Entry removed"); openTourney(tourneyOpen); loadTournaments(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "newtourney") openTourneyForm();
  if(a.dataset.a === "tourneys"){ tourneyOpen = null; renderLog(); }
  if(a.dataset.a === "tinvite"){
    const slot = $("log").querySelector("[data-invite]"); const inT = new Set((tourneyPeople[tourneyOpen]||[]).map(p => p.user_id));
    const fr = friendsList().filter(f => !inT.has(f.id));
    slot.innerHTML = fr.length ? `<div class="card" style="margin-top:8px">${fr.map(f => `<label class="check"><input type="checkbox" value="${esc(f.id)}"> ${esc(f.name)}</label>`).join("")}<div class="row2"><button class="btn sm ink" type="button" data-a="tinvitego">Send invites</button></div></div>` : `<p class="muted">All your friends are already in, or you haven't added any friends yet.</p>`;
  }
  if(a.dataset.a === "tinvitego"){
    const ids = [...$("log").querySelectorAll("[data-invite] input:checked")].map(i => i.value); if(!ids.length) return;
    const { error } = await sb.rpc("invite_to_tournament", { tid:tourneyOpen, p_invite:ids }); if(error){ toast(error.message); return; }
    toast(`Invited ${ids.length} friend${ids.length===1?"":"s"}`); openTourney(tourneyOpen);
  }
  if(a.dataset.a === "tdelete"){ const slot = $("log").querySelector("[data-tslot]"); slot.innerHTML = `<div class="confirm">Delete this tournament for everyone? Catches stay in each angler's log.<button class="link danger" type="button" data-a="tdeleteyes">Delete</button><button class="link" type="button" data-a="tdeleteno">Keep</button></div>`; }
  if(a.dataset.a === "tdeleteno"){ $("log").querySelector("[data-tslot]").innerHTML = ""; }
  if(a.dataset.a === "tdeleteyes"){ const { error } = await sb.from("tournaments").delete().eq("id", tourneyOpen); if(error){ toast("Couldn't delete it. Try again."); return; } toast("Tournament deleted"); tourneyOpen = null; await loadTournaments(); renderLog(); }
});

/* tournament form */
let tfCounties = new Set();
function openTourneyForm(){
  if(!navigator.onLine){ toast("Get back online to start a tournament."); return; }
  $("tfErr").textContent = ""; $("tfName").value = ""; $("tfDesc").value = "";
  const d = new Date(); const sat = new Date(d); sat.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  const iso = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  const sun = new Date(sat); sun.setDate(sat.getDate()+1);
  $("tfStart").value = iso(sat); $("tfEnd").value = iso(sun);
  $("tfArea").value = "any"; tfCounties = new Set(); renderCountyPick();
  $("tfSpecies").value = "any"; $("tfScoring").value = "biggest"; $("tfPhoto").checked = true;
  $("tfOpenRow").hidden = profile?.role !== "creator"; $("tfOpen").checked = false;
  const fr = friendsList();
  $("tfInvite").innerHTML = fr.length ? fr.map(f => `<label class="check"><input type="checkbox" value="${esc(f.id)}"> ${esc(f.name)}</label>`).join("") : `<p class="muted" style="margin:0">Add friends in the Friends tab to invite them. You can invite people later too.</p>`;
  $("tourneyScrim").hidden = false;
}
function renderCountyPick(){
  const area = $("tfArea").value;
  $("tfCountyBox").hidden = area !== "pick";
  if(area !== "pick") return;
  const q = $("tfCountyQ").value.trim().toLowerCase();
  const names = counties.map(f => f.properties.name).sort().filter(n => !q || n.toLowerCase().includes(q));
  $("tfCountyList").innerHTML = names.map(n => `<label class="check"><input type="checkbox" value="${esc(idByName[n])}" ${tfCounties.has(idByName[n])?"checked":""}> ${esc(n)}</label>`).join("");
  $("tfCountyCount").textContent = `${tfCounties.size} selected`;
}
$("tfArea").addEventListener("change", renderCountyPick);
$("tfCountyQ").addEventListener("input", renderCountyPick);
$("tfCountyList").addEventListener("change", e => { const i = e.target; if(i.type !== "checkbox") return; if(i.checked) tfCounties.add(i.value); else tfCounties.delete(i.value); $("tfCountyCount").textContent = `${tfCounties.size} selected`; });
$("tfCancel").onclick = () => { $("tourneyScrim").hidden = true; };
$("tourneyScrim").addEventListener("click", e => { if(e.target === $("tourneyScrim")) $("tourneyScrim").hidden = true; });
$("tourneyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("tfErr"); err.className = "hint bad"; err.textContent = "";
  const name = $("tfName").value.trim(), a = $("tfStart").value, b = $("tfEnd").value, area = $("tfArea").value;
  if(name.length < 2){ err.textContent = "Give the tournament a name."; $("tfName").focus(); return; }
  if(!a || !b){ err.textContent = "Add a start and end date."; return; }
  if(b < a){ err.textContent = "The end date can't be before the start date."; return; }
  if(daysBetween(a, b).length > 121){ err.textContent = "Tournaments can run up to about four months."; return; }
  let ids = null, label = null;
  if(area === "pick"){ if(!tfCounties.size){ err.textContent = "Pick at least one county, or choose Anywhere."; return; } ids = [...tfCounties]; label = ids.length <= 3 ? ids.map(id => byId[id].properties.name).join(", ") + (ids.length === 1 ? " County" : " counties") : `${ids.length} counties`; }
  else if(area !== "any"){ ids = REGION_COUNTIES[area].map(n => idByName[n]).filter(Boolean); label = area; }
  const sp = $("tfSpecies").value;
  const species = sp === "any" ? null : sp === "trout" ? TROUT_SPECIES : [sp];
  const invite = [...$("tfInvite").querySelectorAll("input:checked")].map(i => i.value);
  const btn = $("tfSave"); btn.disabled = true;
  const { data, error } = await sb.rpc("create_tournament", { p_name:name, p_description:$("tfDesc").value.trim() || null, p_starts:a, p_ends:b, p_counties:ids, p_area_label:label,
    p_species:species, p_scoring:$("tfScoring").value, p_require_photo:$("tfPhoto").checked, p_open:$("tfOpen").checked, p_invite:invite });
  btn.disabled = false;
  if(error){ err.textContent = error.message.includes("creator") ? error.message : "Couldn't create the tournament. Check your connection and try again."; return; }
  $("tourneyScrim").hidden = true;
  toast(invite.length ? `Tournament created. Invited ${invite.length} friend${invite.length===1?"":"s"}.` : "Tournament created");
  await loadTournaments();
  for(const c of catches.filter(c => c.caught_on >= a && c.caught_on <= b)) await sb.rpc("auto_enter", { cid:c.id });
  openTourney(data);
});


/* ---------- friends, feed and leaderboard ---------- */
let boardPeriod = lsGet("fl.boardPeriod", "year");
let friendsView = "feed", findQ = "", findResults = null;
async function searchAnglers(q){
  const { data, error } = await sb.rpc("find_anglers", { q });
  findResults = error ? [] : (data || []); if(tab === "friends" && friendsView === "find") renderLog();
}
async function refreshFollows(){ const { data } = await sb.rpc("my_follows"); follows = data || []; const fc = await sb.rpc("friend_catches"); if(!fc.error) friendCatches = fc.data || []; renderAll(); }
function inPeriod(d, p){
  if(p === "all") return true;
  const now = new Date();
  if(p === "year") return d && d.slice(0,4) === String(now.getFullYear());
  if(p === "month") return d && d.slice(0,7) === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  return true;
}
function everyone(){
  // my catches (all of them, since this is my own view) plus what friends share with me
  const mine = catches.map(c => ({ ...c, user_id: me.id, display_name: profile?.display_name || "You" }));
  return [...mine, ...friendCatches.filter(c => c.rel !== "following")];
}
function leaderboards(p){
  const all = everyone().filter(c => inPeriod(c.caught_on, p) && fishOf(c) > 0);
  const by = {}; const name = {};
  for(const c of all){ (by[c.user_id] ||= []).push(c); name[c.user_id] = c.display_name; }
  if(me && !by[me.id]){ by[me.id] = []; name[me.id] = profile?.display_name || "You"; }
  const ppl = Object.keys(by);
  const rank = (fn, fmt) => ppl.map(id => ({ id, name:name[id], v:fn(by[id]) })).filter(r => r.v > 0).sort((a,b) => b.v - a.v).slice(0, 10).map(r => ({ ...r, txt:fmt(r.v) }));
  const biggest = all.filter(c => c.length_in != null).sort((a,b) => b.length_in - a.length_in).slice(0, 10)
    .map(c => ({ id:c.user_id, name:c.display_name, v:+c.length_in, txt:lenTxt(c.length_in), sub:[c.species, fmtDate(c.caught_on), countyName(c.county)].filter(Boolean).join(" · ") }));
  const species = {};
  for(const c of all) if(c.species && c.length_in != null){ const k = c.species; if(!species[k] || +c.length_in > +species[k].length_in) species[k] = c; }
  const perSpecies = Object.entries(species).sort((a,b) => b[1].length_in - a[1].length_in).map(([k, c]) => ({ id:c.user_id, name:k, v:+c.length_in, txt:lenTxt(c.length_in), sub:`${c.display_name} · ${fmtDate(c.caught_on)}` }));
  return {
    biggest,
    perSpecies,
    fish: rank(cs => cs.reduce((a,c)=>a+fishOf(c),0), v => `${v}`),
    species: rank(cs => new Set(cs.map(c=>c.species).filter(Boolean)).size, v => `${v}`),
    counties: rank(cs => new Set(cs.map(c=>c.county).filter(Boolean)).size, v => `${v}`),
    friendsCount: ppl.length - 1
  };
}
function boardHtml(title, rows, unit, emptyTxt){
  return `<div class="board"><h5>${esc(title)}</h5>${rows.length ? `<ol>${rows.map((r,i) => `<li class="${r.id === me?.id && !r.sub ? "me" : r.id === me?.id ? "me" : ""}"><span class="r">${i+1}</span><span>${esc(r.name)}${r.sub?`<small>${esc(r.sub)}</small>`:""}</span><span class="v">${esc(r.txt)}${unit?` ${unit}`:""}</span></li>`).join("")}</ol>` : `<p class="muted" style="margin:0;padding:10px 12px;font-size:13.5px">${esc(emptyTxt)}</p>`}</div>`;
}
function renderFriendsTab(el){
  const accepted = friendships.filter(f => f.status === "accepted");
  const incoming = friendships.filter(f => f.status === "pending" && f.addressee === me?.id);
  const outgoing = friendships.filter(f => f.status === "pending" && f.requester === me?.id);
  const other = f => people[f.requester === me?.id ? f.addressee : f.requester] || { display_name:"Someone" };
  const views = [["feed","Feed"],["board","Leaderboard"],["people","People"],["find","Find anglers"]];
  let body = "";
  if(friendsView === "feed"){
    const posts = friendCatches.slice(0, 40);
    body = posts.length ? `<div class="feed">${posts.map(c => { const url = photoSrc(c.photo_path); return `<article class="post">${url?`<img class="ph" src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
      <div class="pb"><span class="who">${esc(c.display_name)}</span>${c.rel === "following" ? ` <span class="pill">Following</span>` : ""}<div class="what">${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</div>
      <small>${esc([fmtDate(c.caught_on), c.fly, countyName(c.county)].filter(Boolean).join(" · "))}</small>${c.trip_name?`<small>Trip: ${esc(c.trip_name)}</small>`:""}
      <div class="row2" style="margin-top:6px">${profile?.role === "creator" ? `<button class="link danger" type="button" data-hide="${esc(c.id)}">Hide from feeds</button>` : ""}${c.lat!=null?`<button class="link" type="button" data-go="f:${esc(c.id)}">Show on map</button>`:c.county?`<button class="link" type="button" data-county="${esc(c.county)}">Open ${esc(byId[c.county]?.properties.name || "")} County</button>`:""}</div></div></article>`; }).join("")}</div>`
      : `<div class="empty"><b>${accepted.length || follows.length ? "No shared catches yet" : "Add your fishing friends"}</b>${accepted.length || follows.length ? "When friends and anglers you follow log catches they share, they show up here." : "Share your friend code above, or follow anglers from Find anglers. Their shared catches show up here and on the map."}</div>`;
    if(announcements.length) body = announcements.slice(0, 2).map(a => `<div class="card notice" style="margin-bottom:10px"><p class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">From the creator · ${esc(fmtDate(a.created_at.slice(0,10)))}</p><p>${esc(a.body)}</p></div>`).join("") + body;
  } else if(friendsView === "board"){
    const b = leaderboards(boardPeriod);
    const periods = [["month","This month"],["year","This year"],["all","All time"]];
    body = `<div class="yearsel">${periods.map(([k,l]) => `<button type="button" data-period="${k}" aria-pressed="${boardPeriod===k}">${l}</button>`).join("")}</div>
      <div class="boards">
      ${boardHtml("Biggest fish", b.biggest, "", "Log a length with your catches to get on this board.")}
      ${boardHtml("Record by species", b.perSpecies, "", "Species records show up once catches have lengths.")}
      ${boardHtml("Most fish", b.fish, "fish", "No fish logged in this period.")}
      ${boardHtml("Most species", b.species, "", "No species logged in this period.")}
      ${boardHtml("Most counties fished", b.counties, "", "No counties logged in this period.")}
      </div><p class="note">Boards count your catches and what friends share with you. Private catches don't count toward anyone else's view.</p>`;
  } else {
    body = `${incoming.length ? `<h4><span>Requests</span></h4><ul class="list">${incoming.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>Wants to share catches with you</small></span><span class="row2"><button class="btn sm ink" type="button" data-accept="${esc(f.id)}">Accept</button><button class="btn sm" type="button" data-decline="${esc(f.id)}">Decline</button></span></li>`).join("")}</ul>` : ""}
      <h4><span>Friends</span><span>${accepted.length}</span></h4>
      ${accepted.length ? `<ul class="list">${accepted.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>${friendCatches.filter(c => c.user_id === (f.requester === me.id ? f.addressee : f.requester)).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><span data-slot-${esc(f.id)}><button class="link danger" type="button" data-unfriend="${esc(f.id)}">Remove</button></span></li>`).join("")}</ul>` : `<p class="muted">No friends added yet.</p>`}
      <h4><span>Following</span><span>${follows.filter(f => f.direction === "following").length}</span></h4>
      ${follows.some(f => f.direction === "following") ? `<ul class="list">${follows.filter(f => f.direction === "following").map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(f.display_name)}</b><small>${friendCatches.filter(c => c.user_id === f.user_id).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><button class="link" type="button" data-unfollow="${esc(f.user_id)}">Unfollow</button></li>`).join("")}</ul>` : `<p class="muted">You aren't following anyone. Use Find anglers to follow people with public profiles.</p>`}
      <p class="muted" style="margin-top:10px">${follows.filter(f => f.direction === "follower").length} follower${follows.filter(f => f.direction === "follower").length===1?"":"s"}${profile?.is_public ? "" : ". Turn on a public profile in the Me tab to let people follow you."}</p>
      ${outgoing.length ? `<h4><span>Waiting on</span></h4><ul class="list">${outgoing.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>Request sent</small></span><button class="link" type="button" data-decline="${esc(f.id)}">Cancel</button></li>`).join("")}</ul>` : ""}`;
  }
  if(friendsView === "find"){
    body = `<form id="findForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="findQ" placeholder="Search anglers by name" aria-label="Search anglers by name" value="${esc(findQ)}"><button class="btn" type="submit">Search</button></form>
      <p class="muted" style="margin:6px 0 10px">Follow anglers with public profiles to see the catches they share. Unlike friends, following doesn't need their OK, and they don't see your catches.</p>
      <div id="findResults">${findResults ? (findResults.length ? `<ul class="list">${findResults.map(p => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b class="wrap">${esc(p.display_name)}${p.featured?` <span class="pill open">Featured</span>`:""}</b><small>${p.followers} follower${p.followers===1?"":"s"} · ${p.fish} shared fish${p.bio?` · ${esc(p.bio)}`:""}</small></span><span class="row2">${profile?.role==="creator"?`<button class="link" type="button" data-feature="${esc(p.id)}" data-on="${p.featured?"0":"1"}">${p.featured?"Unfeature":"Feature"}</button>`:""}<button class="btn sm ${p.following?"":"ink"}" type="button" data-${p.following?"unfollow":"follow"}="${esc(p.id)}">${p.following?"Following":"Follow"}</button></span></li>`).join("")}</ul>` : `<p class="muted">No public anglers match that name.</p>`) : `<p class="status">Loading anglers…</p>`}</div>`;
    if(!findResults) searchAnglers(findQ);
  }
  el.innerHTML = `<div class="eyebrow">Friends</div><h2>Fishing friends</h2>
    <div class="code" style="margin:10px 0 12px"><span>Your friend code</span><b>${esc(profile?.friend_code || "······")}</b><button class="btn sm" type="button" data-a="sharecode">Share</button></div>
    <form id="addFriendForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="friendCode" placeholder="Friend's code" autocapitalize="characters" maxlength="8" aria-label="Friend's code" style="font-family:var(--f-data);letter-spacing:.12em"><button class="btn ink" type="submit">Add</button></form>
    <span class="hint" id="friendMsg" role="alert"></span>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="showFriendsBox" ${showFriends?"checked":""}> Show friends' catches on the map</label>
    <div class="yearsel" style="margin-top:14px">${views.map(([k,l]) => `<button type="button" data-fview="${k}" aria-pressed="${friendsView===k}">${l}${k==="people"&&incoming.length?` (${incoming.length})`:""}</button>`).join("")}</div>
    <div style="margin-top:10px">${body}</div>`;
  $("addFriendForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("friendMsg"); msg.className = "hint"; msg.textContent = "Sending…";
    try{ const n = await addFriend($("friendCode").value); msg.className = "hint ok"; msg.textContent = `Request sent to ${n}. They'll see it in their Friends tab.`; $("friendCode").value = ""; }
    catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Couldn't add that friend."; }
  });
  if($("findForm")) $("findForm").addEventListener("submit", e => { e.preventDefault(); findQ = $("findQ").value.trim(); findResults = null; renderLog(); });
  $("showFriendsBox").addEventListener("change", e => { showFriends = e.target.checked; lsSet("fl.showFriends", showFriends); renderAll(); });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const fv = t.closest("[data-fview]"); if(fv){ friendsView = fv.dataset.fview; renderLog(); return; }
  const pe = t.closest("[data-period]"); if(pe){ boardPeriod = pe.dataset.period; lsSet("fl.boardPeriod", boardPeriod); renderLog(); return; }
  const ac = t.closest("[data-accept]"); if(ac){ ac.disabled = true; try{ await answerRequest(ac.dataset.accept, true); toast("Friend added"); }catch(e){ toast("Couldn't accept. Try again."); } return; }
  const de = t.closest("[data-decline]"); if(de){ de.disabled = true; try{ await answerRequest(de.dataset.decline, false); }catch(e){ toast("Couldn't update. Try again."); } return; }
  const un = t.closest("[data-unfriend]"); if(un){ const slot = un.parentElement; slot.innerHTML = `<span class="row2"><button class="link danger" type="button" data-unfriendyes="${esc(un.dataset.unfriend)}">Remove friend</button><button class="link" type="button" data-fview="people">Keep</button></span>`; return; }
  const uy = t.closest("[data-unfriendyes]"); if(uy){ try{ await answerRequest(uy.dataset.unfriendyes, false); toast("Friend removed"); }catch(e){ toast("Couldn't remove. Try again."); } return; }
  if(t.closest('[data-a="sharecode"]')) shareCode();
  const fo = t.closest("[data-follow]"); if(fo){ fo.disabled = true; const { error } = await sb.from("follows").insert({ followee: fo.dataset.follow }); if(error){ toast("Couldn't follow. Try again."); fo.disabled = false; return; } toast("Following"); findResults = null; await refreshFollows(); return; }
  const uf = t.closest("[data-unfollow]"); if(uf){ uf.disabled = true; await sb.from("follows").delete().eq("follower", me.id).eq("followee", uf.dataset.unfollow); toast("Unfollowed"); findResults = null; await refreshFollows(); return; }
  const ft = t.closest("[data-feature]"); if(ft){ const { error } = await sb.from("profiles").update({ featured: ft.dataset.on === "1" }).eq("id", ft.dataset.feature); toast(error ? "Couldn't update." : ft.dataset.on === "1" ? "Featured" : "No longer featured"); findResults = null; renderLog(); return; }
  const hd = t.closest("[data-hide]"); if(hd){ const { error } = await sb.rpc("creator_hide_catch", { catch_id: hd.dataset.hide, hide:true }); if(error){ toast("Couldn't hide it."); return; } friendCatches = friendCatches.filter(c => c.id !== hd.dataset.hide); toast("Hidden from all feeds and tournaments"); renderAll(); return; }
});
async function shareCode(){
  const url = location.origin + location.pathname;
  const text = `Add me on Wisconsin Fly Log. My friend code is ${profile?.friend_code}. Open ${url} on your phone, create an account, then enter the code in the Friends tab.`;
  if(navigator.share){ try{ await navigator.share({ title:"Wisconsin Fly Log", text, url }); return; }catch(e){ if(e.name === "AbortError") return; } }
  try{ await navigator.clipboard.writeText(text); toast("Invite copied. Paste it into a text to a friend."); }
  catch(e){ toast(`Your code is ${profile?.friend_code}`); }
}


/* ---------- stats ---------- */
let statYear = lsGet("fl.statYear", "all");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function renderStatsTab(el){
  const years = [...new Set(catches.map(c => (c.caught_on||"").slice(0,4)).filter(Boolean))].sort().reverse();
  if(statYear !== "all" && !years.includes(statYear)) statYear = "all";
  const cs = catches.filter(c => statYear === "all" || (c.caught_on||"").startsWith(statYear));
  const withFish = cs.filter(c => fishOf(c) > 0);
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const days = new Set(cs.map(c=>c.caught_on)).size;
  const species = {}; const flies = {}; const months = Array(12).fill(0); const flyMonth = {};
  for(const c of withFish){
    const n = fishOf(c), m = +(c.caught_on||"0000-01").slice(5,7) - 1; months[m] += n;
    if(c.species){ const s = species[c.species] ||= { n:0, big:null }; s.n += n; if(c.length_in != null && (!s.big || +c.length_in > +s.big.length_in)) s.big = c; }
    if(c.fly){ const f = flies[c.fly] ||= { n:0, months:Array(12).fill(0) }; f.n += n; f.months[m] += n; (flyMonth[m] ||= {})[c.fly] = ((flyMonth[m] ||= {})[c.fly] || 0) + n; }
  }
  const max = Math.max(1, ...months);
  const W = 320, H = 130, bw = W/12;
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H+18}" role="img" aria-label="Fish caught by month"><title>Fish caught by month</title>
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)" stroke-width="1"/>
    ${months.map((v,i) => { const h = Math.round((v/max)*(H-16)); return `<rect x="${i*bw+4}" y="${H-h}" width="${bw-8}" height="${h}" rx="2" fill="${v?"var(--fish)":"var(--line)"}"/>${v?`<text x="${i*bw+bw/2}" y="${H-h-4}" text-anchor="middle">${v}</text>`:""}<text x="${i*bw+bw/2}" y="${H+13}" text-anchor="middle">${MON[i][0]}</text>`; }).join("")}</svg>`;
  const sp = Object.entries(species).sort((a,b)=>b[1].n-a[1].n);
  const fl = Object.entries(flies).sort((a,b)=>b[1].n-a[1].n).slice(0, 12);
  const bestByMonth = Object.entries(flyMonth).map(([m, o]) => [+m, Object.entries(o).sort((a,b)=>b[1]-a[1])[0]]).sort((a,b)=>a[0]-b[0]);
  const st = { want:0, scouted:0, fished:0 }; spots.forEach(s => st[s.status] = (st[s.status]||0) + 1);
  const tripCount = trips.filter(t => statYear === "all" || t.start_date.startsWith(statYear) || t.end_date.startsWith(statYear)).length;
  el.innerHTML = `<div class="eyebrow">Stats</div><h2>${statYear === "all" ? "All time" : statYear}</h2>
    <div class="yearsel"><button type="button" data-year="all" aria-pressed="${statYear==="all"}">All time</button>${years.map(y => `<button type="button" data-year="${y}" aria-pressed="${statYear===y}">${y}</button>`).join("")}</div>
    <div class="stats four"><div class="stat f"><b>${fish}</b><span>fish</span></div><div class="stat"><b>${days}</b><span>days fished</span></div><div class="stat"><b>${sp.length}</b><span>species</span></div><div class="stat"><b>${tripCount}</b><span>trips</span></div></div>
    ${cs.length ? `<h4><span>Fish by month</span></h4>${chart}
    <h4><span>Species</span></h4><table class="tbl"><thead><tr><th>Species</th><th class="n">Fish</th><th class="n">Biggest</th></tr></thead><tbody>${sp.map(([k,v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.big ? lenTxt(v.big.length_in) : "–"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Add species to your catches to see them here.</td></tr>`}</tbody></table>
    <h4><span>Flies that worked</span></h4><table class="tbl"><thead><tr><th>Fly</th><th class="n">Fish</th><th class="n">Best month</th></tr></thead><tbody>${fl.map(([k,v]) => { const bm = v.months.indexOf(Math.max(...v.months)); return `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${MON[bm]}</td></tr>`; }).join("") || `<tr><td colspan="3" class="muted">Add the fly to your catches to see what works.</td></tr>`}</tbody></table>
    ${bestByMonth.length ? `<h4><span>Best fly each month</span></h4><ul class="list">${bestByMonth.map(([m, [f, n]]) => `<li class="item" style="grid-template-columns:44px 1fr auto;cursor:default"><span class="muted" style="font-weight:700">${MON[m]}</span><span class="t"><b>${esc(f)}</b></span><span class="num">${n} fish</span></li>`).join("")}</ul>` : ""}
    <h4><span>Spots</span></h4><p style="margin:0"><span class="pill want">${st.want} want to try</span> <span class="pill scouted">${st.scouted} scouted</span> <span class="pill fished">${st.fished} fished</span></p>`
    : `<div class="empty"><b>Nothing to count yet</b>Log a few catches with the species, length and fly, and this page fills in with your best months and flies.</div>`}`;
}
$("log").addEventListener("click", ev => { const y = ev.target.closest("[data-year]"); if(y){ statYear = y.dataset.year; lsSet("fl.statYear", statYear); renderLog(); } });

/* ---------- me ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let meView = "main";
function renderMeTab(el){
  if(meView === "help") return renderHelp(el);
  if(meView === "suggest") return renderSuggest(el);
  if(meView === "creator" && profile?.role === "creator") return renderCreator(el);
  const followers = follows.filter(f => f.direction === "follower").length;
  el.innerHTML = `<div class="eyebrow">Account${profile?.role === "creator" ? ` · <span class="pill open">Creator</span>` : ""}</div><h2>${esc(profile?.display_name || "You")}</h2>
    <p class="muted" style="margin:0 0 12px">${esc(me?.email || "")}</p>
    <form id="nameForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="meName" value="${esc(profile?.display_name || "")}" maxlength="40" aria-label="Your name"><button class="btn" type="submit">Save name</button></form>
    <span class="hint" id="nameMsg" role="alert"></span>
    <div class="row2" style="margin-top:14px">
      <button class="btn sm" type="button" data-me="help">Help</button>
      <button class="btn sm" type="button" data-me="suggest">Suggestions</button>
      <button class="btn sm" type="button" data-a="guide">Setup guide</button>
      ${profile?.role === "creator" ? `<button class="btn sm ink" type="button" data-me="creator">Creator tools</button>` : ""}
    </div>
    <h4><span>Public profile</span><span>${followers} follower${followers===1?"":"s"}</span></h4>
    <div class="card">
      <label class="check"><input type="checkbox" id="mePublic" ${profile?.is_public ? "checked" : ""}> Let anyone find and follow me</label>
      <p class="muted">Followers see the catches you share (County only or Exact spot), the same as friends do. Catches set to Nothing stay private, and following doesn't let anyone into your tournaments or friend list.</p>
      <div class="field"><label for="meBio">Short bio</label><textarea id="meBio" maxlength="280" placeholder="Driftless brown trout nut. Mostly dries.">${esc(profile?.bio || "")}</textarea></div>
      <div class="row2"><button class="btn sm" type="button" data-a="savepublic">Save profile</button><span class="hint" id="pubMsg" role="alert"></span></div>
    </div>
    ${!isStandalone ? `<h4><span>Put it on your home screen</span></h4><div class="card">${isIOS
      ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted">It opens full screen like an app and keeps your counties for offline use.</p>`
      : `<p>In your browser's menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ""}
    <h4><span>Your data</span></h4>
    <div class="card"><p>${catches.length} catches, ${spots.length} spots and ${trips.length} trips.</p><div class="row2"><button class="btn sm" type="button" data-a="export">Download a copy</button></div></div>
    <h4><span>Map data</span></h4>
    <p class="muted" style="margin:0">Streams, lakes, trout classes, trout regulations and public lands come from the Wisconsin DNR. Regulations change; check the current DNR rules before you fish.</p>
    <div class="row2" style="margin-top:22px"><button class="btn" type="button" data-a="signout">Sign out</button></div>`;
  $("nameForm").addEventListener("submit", async e => {
    e.preventDefault(); const v = $("meName").value.trim(); const msg = $("nameMsg");
    if(!v){ msg.className = "hint bad"; msg.textContent = "Enter a name."; return; }
    const { error } = await sb.from("profiles").update({ display_name:v }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save your name. Try again."; return; }
    profile = { ...profile, display_name:v }; saveCache(); msg.className = "hint ok"; msg.textContent = "Name saved. Friends will see it on your catches.";
  });
}
const HELP = [
  ["Getting around the map", [
    "Tap a county to zoom in. Every named creek, river and lake appears, with DNR trout classes as colored bands: green for Class I, gold for Class II, rust for Class III.",
    "Tap a creek to see its name, trout class, season status and the nearest DNR regulation. Tap Add as spot to save it.",
    "Green shading is public land: DNR properties, fishing easements, county forests and the national forest. Dashed outlines are easements, where access is usually limited to the stream corridor. Turn it off with the Public land button in the legend.",
    "Search for any creek or lake by name from the box at the top of the map."]],
  ["Logging catches", [
    "Tap Log a catch. Add a photo first; if it has location and date saved in it, they fill in for you.",
    "No location in the photo? Tap Here to use your phone's GPS, or Map to tap the spot.",
    "Friends see shows what others can see: Exact spot, County only, or Nothing.",
    "No signal? Log anyway. The catch is saved on your phone and syncs when you're back in range."]],
  ["Spots", [
    "Spots are water you want to fish. Mark each one Want to try, Scouted or Fished.",
    "Each spot shows when you last fished it and how many fish you've logged there. Pick the spot when you log a catch to connect them."]],
  ["Trips", [
    "Make a trip with first and last days. Any catch logged in those dates joins it automatically.",
    "Each trip shows a recap: fish, species, biggest fish, best fly, photos and a day-by-day list, including days with no fish."]],
  ["Tournaments", [
    "Anyone can start a tournament: pick dates, an area (anywhere, a region, or specific counties), species and scoring, then invite friends.",
    "Catches that fit the rules are entered automatically when you log them. You can also enter or remove catches on the tournament page.",
    "Photo tournaments only accept fish whose photo was taken during the tournament dates. The app reads the date stamp saved in the photo, so take photos with your phone's camera rather than screenshots."]],
  ["Friends and following", [
    "Friends: share your 6-character friend code. Once they accept, you see each other's shared catches, trips and leaderboards, and can invite each other to tournaments.",
    "Following: turn on a public profile in the Me tab to let anyone follow you. You can follow public anglers from Find anglers without their OK. Followers see your shared catches but aren't on your leaderboard."]],
  ["Location not filling in from photos", [
    "On iPhone: Settings → Privacy & Security → Location Services → Camera → While Using the App, with Precise Location on. New photos will then carry their location.",
    "Some ways of choosing a photo strip the location. If it doesn't fill in, tap Here while you're at the spot, or Map."]],
  ["Phone location for the Here button", [
    "When the app asks to use your location, tap Allow.",
    "If you tapped Don't Allow: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App."]],
  ["Install it like an app", [
    "In Safari, tap Share → Add to Home Screen → Add. Open it from the icon from then on.",
    "Updates arrive on their own the next time you open it."]]
];
function renderHelp(el){
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Help</div><h2>How it works</h2>
    ${HELP.map(([h, items]) => `<h4><span>${esc(h)}</span></h4><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}
    <div class="row2" style="margin-top:18px"><button class="btn sm" type="button" data-a="guide">Replay setup guide</button><button class="btn sm" type="button" data-me="suggest">Send a suggestion</button></div>`;
}
const SUG_STATUS = { new:"Received", planned:"Planned", done:"Done", declined:"Not planned" };
function renderSuggest(el){
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Suggestions</div><h2>Send a suggestion</h2>
    <p class="muted" style="margin:4px 0 12px">Ideas, problems, anything. They go straight to the creator of the app.</p>
    <form id="sugForm" novalidate>
      <div class="seg" role="group" aria-label="Type" id="sugKind"><button type="button" class="ink" data-k="idea" aria-pressed="true">Idea</button><button type="button" class="ink" data-k="problem" aria-pressed="false">Problem</button><button type="button" class="ink" data-k="other" aria-pressed="false">Other</button></div>
      <div class="field"><label for="sugBody">Your suggestion</label><textarea id="sugBody" maxlength="2000" placeholder="It would help if…" style="min-height:110px"></textarea></div>
      <span class="hint" id="sugMsg" role="alert"></span>
      <div class="actions"><button class="btn ink" type="submit">Send</button></div>
    </form>
    <h4><span>Your suggestions</span><span>${mySuggestions.length}</span></h4>
    ${mySuggestions.length ? `<div class="stack">${mySuggestions.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)} · <span class="pill ${s.status==="done"?"fished":s.status==="planned"?"scouted":""}">${SUG_STATUS[s.status]}</span></p><p>${esc(s.body)}</p>${s.reply?`<p style="border-left:3px solid var(--line);padding-left:10px"><b>Reply:</b> ${esc(s.reply)}</p>`:""}</div>`).join("")}</div>` : `<p class="muted">Nothing sent yet.</p>`}`;
  let kind = "idea";
  $("sugKind").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if(!b) return; kind = b.dataset.k; $("sugKind").querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("sugForm").addEventListener("submit", async e => {
    e.preventDefault(); const body = $("sugBody").value.trim(), msg = $("sugMsg");
    if(body.length < 3){ msg.className = "hint bad"; msg.textContent = "Write a few words first."; return; }
    const { data, error } = await sb.from("suggestions").insert({ kind, body }).select().single();
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't send it. Check your connection and try again."; return; }
    mySuggestions = [data, ...mySuggestions]; toast("Suggestion sent. Thanks!"); renderLog();
  });
}
let creatorData = null;
async function loadCreator(){
  const [o, s] = await Promise.all([ sb.rpc("creator_overview"), sb.rpc("all_suggestions") ]);
  creatorData = { o: (o.data || [])[0] || null, s: s.data || [] };
  if(tab === "me" && meView === "creator") renderLog();
}
function renderCreator(el){
  if(!creatorData){ el.innerHTML = `<p class="status">Loading creator tools…</p>`; loadCreator(); return; }
  const o = creatorData.o || {};
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Creator</div><h2>Creator tools</h2>
    <div class="stats four"><div class="stat"><b>${o.anglers ?? "–"}</b><span>anglers</span></div><div class="stat f"><b>${o.fish ?? "–"}</b><span>fish logged</span></div><div class="stat"><b>${o.tournaments ?? "–"}</b><span>tournaments</span></div><div class="stat"><b>${o.open_suggestions ?? "–"}</b><span>new suggestions</span></div></div>
    <p class="muted" style="margin:0 0 6px">${o.public_anglers ?? 0} public profiles · ${o.catches ?? 0} catches · ${o.trips ?? 0} trips</p>
    <h4><span>Post an announcement</span></h4>
    <form id="annForm" novalidate><textarea id="annBody" maxlength="1000" placeholder="Opening weekend tournament starts Saturday. Good luck!"></textarea><div class="actions"><button class="btn ink" type="submit">Post to everyone</button></div></form>
    ${announcements.length ? `<ul class="list">${announcements.map(a => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b style="white-space:normal">${esc(a.body)}</b><small>${esc(fmtDate(a.created_at.slice(0,10)))}</small></span><button class="link danger" type="button" data-delann="${esc(a.id)}">Remove</button></li>`).join("")}</ul>` : ""}
    <h4><span>Suggestions inbox</span><span>${creatorData.s.length}</span></h4>
    ${creatorData.s.length ? `<div class="stack">${creatorData.s.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(s.display_name)} · ${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)}</p><p>${esc(s.body)}</p>
      <div class="row2"><select data-sugstatus="${esc(s.id)}" aria-label="Status" style="width:auto">${Object.entries(SUG_STATUS).map(([k,l]) => `<option value="${k}" ${s.status===k?"selected":""}>${l}</option>`).join("")}</select></div>
      <textarea data-sugreply="${esc(s.id)}" placeholder="Reply (the sender sees this)" maxlength="1000">${esc(s.reply || "")}</textarea>
      <div class="row2"><button class="btn sm" type="button" data-sugsave="${esc(s.id)}">Save reply</button><button class="link danger" type="button" data-sugdel="${esc(s.id)}">Delete</button></div></div>`).join("")}</div>` : `<p class="muted">No suggestions yet.</p>`}
    <h4><span>Other creator powers</span></h4>
    <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Feature anglers from Friends → Find anglers. Featured anglers show first with a badge.</li>
      <li>Hide any shared catch from feeds and tournaments with Hide from feeds in the Friends feed.</li>
      <li>Make tournaments open to everyone, and delete any tournament.</li>
    </ul>`;
  $("annForm").addEventListener("submit", async e => {
    e.preventDefault(); const body = $("annBody").value.trim(); if(body.length < 2) return;
    const { data, error } = await sb.from("announcements").insert({ body }).select().single();
    if(error){ toast("Couldn't post it."); return; }
    announcements = [data, ...announcements]; toast("Posted. Everyone sees it in their Friends feed."); renderLog();
  });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const mv = t.closest("[data-me]"); if(mv){ meView = mv.dataset.me; if(meView === "creator") creatorData = null; renderLog(); $("log").scrollTop = 0; return; }
  const da = t.closest("[data-delann]"); if(da){ await sb.from("announcements").delete().eq("id", da.dataset.delann); announcements = announcements.filter(a => a.id !== da.dataset.delann); renderLog(); return; }
  const ss = t.closest("[data-sugsave]"); if(ss){ const id = ss.dataset.sugsave;
    const status = $("log").querySelector(`[data-sugstatus="${id}"]`).value, reply = $("log").querySelector(`[data-sugreply="${id}"]`).value.trim() || null;
    const { error } = await sb.from("suggestions").update({ status, reply, updated_at:new Date().toISOString() }).eq("id", id);
    toast(error ? "Couldn't save." : "Saved. They'll see it in their Suggestions page."); loadCreator(); return; }
  const sd = t.closest("[data-sugdel]"); if(sd){ await sb.from("suggestions").delete().eq("id", sd.dataset.sugdel); loadCreator(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "guide") openGuide(true);
  if(a.dataset.a === "savepublic"){
    const is_public = $("mePublic").checked, bio = $("meBio").value.trim() || null, msg = $("pubMsg");
    const { error } = await sb.from("profiles").update({ is_public, bio }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save. Try again."; return; }
    profile = { ...profile, is_public, bio }; saveCache(); msg.className = "hint ok"; msg.textContent = is_public ? "Saved. Anyone can now find and follow you." : "Saved. Your profile is private.";
  }
});
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "signout"){
    if(outbox.length){ toast("Some entries haven't synced yet. Get back online first so nothing is lost."); return; }
    await sb.auth.signOut(); location.reload();
  }
  if(a.dataset.a === "export"){
    const blob = new Blob([JSON.stringify({ exported_at:new Date().toISOString(), profile, trips, spots, catches }, null, 2)], { type:"application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `fly-log-${todayStr()}.json`; document.body.appendChild(link); link.click(); link.remove();
  }
});


/* ---------- setup guide for new accounts ---------- */
const GUIDE = () => [
  { t:"Welcome to Wisconsin Fly Log", b:`<p>A map of every named creek and lake in Wisconsin, with DNR trout classes, regulations and public land, plus a log for your spots, catches and trips.</p><p class="muted">This takes about a minute. You can replay it any time from Me → Setup guide.</p>` },
  ...(!isStandalone ? [{ t:"Put it on your home screen", b: isIOS
    ? `<ol class="steps"><li>Make sure this page is open in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>From now on, open the app from that icon. It opens full screen and works offline.</li></ol>`
    : `<p>Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Then open it from the icon.</p>` }] : []),
  { t:"Let your camera save locations", b:`<p>Photos can fill in where you caught a fish, but only if your camera saves the location.</p>
      <ol class="steps"><li>Open the iPhone <b>Settings</b> app.</li><li>Tap <b>Privacy &amp; Security</b>, then <b>Location Services</b>.</li><li>Make sure <b>Location Services</b> is on.</li><li>Tap <b>Camera</b> and choose <b>While Using the App</b>.</li><li>Turn on <b>Precise Location</b>.</li></ol>
      <p class="muted">Photos you take after this carry their location. If a photo still doesn't fill it in, tap <b>Here</b> while you're at the water.</p>` },
  { t:"Allow location for the Here button", b:`<p>When you tap <b>Here</b> while logging a catch, your phone asks to share your location with the app. Tap <b>Allow</b>.</p>
      <p>Tapped Don't Allow by mistake? Go to <b>Settings → Privacy &amp; Security → Location Services → Safari Websites</b> and choose <b>While Using the App</b>.</p>
      <div class="row2"><button class="btn sm" type="button" id="guideGps">${icon("i-gps")}Try it now</button><span class="hint" id="guideGpsMsg"></span></div>` },
  { t:"Find water", b:`<ul class="steps"><li><b>Tap a county</b> to see every named creek, river and lake in it.</li><li><b>Colored bands</b> are DNR trout classes: green Class I, gold Class II, rust Class III.</li><li><b>Tap a creek</b> for its name, the trout season status and the nearest regulation.</li><li><b>Green shading</b> is public land and fishing easements.</li><li><b>Search</b> any creek or lake by name at the top of the map.</li></ul>` },
  { t:"Log spots and catches", b:`<ul class="steps"><li><b>Add spot</b> saves water to try. Mark it Want to try, Scouted or Fished.</li><li><b>Log a catch</b> with a photo, species, length and fly.</li><li><b>Friends see</b> lets you choose Exact spot, County only or Nothing for every entry. Spots start private.</li><li>No signal? Log anyway. It syncs when you're back in range.</li></ul>` },
  { t:"Trips and tournaments", b:`<ul class="steps"><li><b>Trips</b>: set the dates and every catch from those days joins the trip, with a recap at the end.</li><li><b>Tournaments</b>: pick dates, an area, species and scoring, and invite friends. Fish that fit are entered automatically. Photo tournaments only accept photos taken during the tournament.</li></ul>` },
  { t:"Friends and following", b:`<ul class="steps"><li><b>Friends</b>: share your friend code${profile?.friend_code ? ` (<b style="font-family:var(--f-data);letter-spacing:.1em">${esc(profile.friend_code)}</b>)` : ""}. Friends see each other's shared catches and leaderboards.</li><li><b>Following</b>: follow anglers with public profiles without needing their OK. Turn on your own public profile in the Me tab if you want followers.</li></ul>` },
  { t:"You're set", b:`<p>Tap a county to start exploring, or log your first fish.</p><p class="muted">Help and Suggestions are in the Me tab. Suggestions go straight to the person who built the app.</p>` }
];
let guideStep = 0, guideSteps = [];
function openGuide(replay){
  if(!$("guide").hidden) return;
  guideSteps = GUIDE(); guideStep = 0; renderGuide(); $("guide").hidden = false;
}
function renderGuide(){
  const s = guideSteps[guideStep];
  $("guideDots").innerHTML = guideSteps.map((_, i) => `<i class="${i === guideStep ? "on" : i < guideStep ? "done" : ""}"></i>`).join("");
  $("guideBody").innerHTML = `<div class="eyebrow">Step ${guideStep + 1} of ${guideSteps.length}</div><h3 id="guideTitle">${esc(s.t)}</h3><div class="gbody">${s.b}</div>`;
  $("guideBack").hidden = guideStep === 0;
  $("guideNext").textContent = guideStep === guideSteps.length - 1 ? "Start fishing" : "Next";
  $("guideSkip").hidden = guideStep === guideSteps.length - 1;
  const g = $("guideGps");
  if(g) g.onclick = () => {
    const m = $("guideGpsMsg"); m.className = "hint"; m.textContent = "Asking for your location…";
    if(!navigator.geolocation){ m.className = "hint bad"; m.textContent = "This browser can't share location."; return; }
    navigator.geolocation.getCurrentPosition(pos => { const cid = countyAt(pos.coords.latitude, pos.coords.longitude); m.className = "hint ok"; m.textContent = cid ? `It works. You're in ${countyName(cid)}.` : "It works."; },
      err => { m.className = "hint bad"; m.textContent = err.code === 1 ? "Location is blocked. Use the Settings steps above, then try again." : "Couldn't get a fix. Try again outside."; }, { enableHighAccuracy:true, timeout:15000 });
  };
}
async function finishGuide(){
  $("guide").hidden = true;
  if(profile && !profile.onboarded){ profile.onboarded = true; saveCache(); await sb.from("profiles").update({ onboarded:true }).eq("id", me.id); }
}
$("guideNext").onclick = () => { if(guideStep < guideSteps.length - 1){ guideStep++; renderGuide(); $("guide").querySelector(".sheet").scrollTop = 0; } else finishGuide(); };
$("guideBack").onclick = () => { if(guideStep > 0){ guideStep--; renderGuide(); } };
$("guideSkip").onclick = finishGuide;


/* ---------- creek & lake search ---------- */
let nameIndex = null, qSel = 0, qList = [];
async function loadIndex(){ if(nameIndex) return nameIndex; try{ const r = await fetch(dataUrl("water/index.json")); nameIndex = await r.json(); }catch(e){ nameIndex = []; } return nameIndex; }
function renderQ(){
  const ul = $("qres");
  if(!qList.length){ ul.hidden = !$("q").value.trim(); ul.innerHTML = $("q").value.trim() ? `<li><button disabled>No creeks or lakes by that name</button></li>` : ""; return; }
  ul.hidden = false;
  ul.innerHTML = qList.map((r,i)=>`<li><button class="${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)}</small></button></li>`).join("");
}
$("q").addEventListener("focus", loadIndex);
$("q").addEventListener("input", async () => {
  const q = $("q").value.trim().toLowerCase(); const idx = await loadIndex();
  if(q.length < 2){ qList = []; renderQ(); return; }
  const out = [];
  for(const [name, places] of idx){ const n = name.toLowerCase(); const k = n.startsWith(q) ? 0 : n.includes(" " + q) ? 1 : n.includes(q) ? 2 : -1; if(k < 0) continue;
    out.push({ k, name, places, counties: places.map(p => byId[p[0]]?.properties.name).filter(Boolean).slice(0,3).join(", ") + (places.length > 3 ? "…" : "") }); }
  out.sort((a,b)=>a.k-b.k||a.name.length-b.name.length||a.name.localeCompare(b.name));
  qList = out.slice(0, 10); qSel = 0; renderQ();
});
$("q").addEventListener("keydown", e => {
  if(e.key === "ArrowDown"){ qSel = Math.min(qSel+1, qList.length-1); renderQ(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ qSel = Math.max(qSel-1, 0); renderQ(); e.preventDefault(); }
  if(e.key === "Enter" && qList[qSel]){ goTo(qList[qSel]); e.preventDefault(); }
  if(e.key === "Escape"){ $("qres").hidden = true; $("q").blur(); }
});
$("qres").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if(b) goTo(qList[+b.dataset.i]); });
document.addEventListener("click", e => { if(!e.target.closest(".search")) $("qres").hidden = true; });
async function goTo(r){
  $("qres").hidden = true; $("q").value = r.name; $("q").blur();
  // the place with the biggest stretch of this water
  const p = r.places.slice().sort((a,b)=>((b[3]-b[1])*(b[4]-b[2]))-((a[3]-a[1])*(a[4]-a[2])))[0];
  const cid = p[0];
  if(currentCounty !== cid){ openCounty(cid); await new Promise(r => { map.once("moveend", r); setTimeout(r, 1500); }); }
  await showDetail(cid);
  const b = L.latLngBounds([p[2],p[1]],[p[4],p[3]]);
  map.fitBounds(b, { padding:[50,50], maxZoom:14 });
  map.once("moveend", () => { if(p[5] === "s"){ setHover(r.name); clearTimeout(flashT); flashT = setTimeout(() => setHover(null), 3200); }
    else { const l = detailLakes.find(x => x.name === r.name); if(l){ l.poly.setStyle({ color:css("--hl"), weight:4 }); setTimeout(() => l.poly.setStyle({ color:css("--stream"), weight:.7 }), 3200); } } });
}


/* ---------- sign in ---------- */
let authMode = "in";
function setAuthMode(m){
  authMode = m;
  $("authInTab").setAttribute("aria-pressed", m === "in"); $("authUpTab").setAttribute("aria-pressed", m === "up");
  $("nameRow").hidden = m !== "up";
  $("pwRow").hidden = m === "reset";
  $("aEmail").closest(".field").hidden = m === "newpw";
  $("aPw").autocomplete = m === "in" ? "current-password" : "new-password";
  $("pwRow").querySelector("label").textContent = m === "newpw" ? "New password" : "Password";
  $("authGo").textContent = { in:"Sign in", up:"Create account", reset:"Send reset link", newpw:"Save new password" }[m];
  $("forgotBtn").hidden = m !== "in";
  $("authMsg").textContent = ""; $("authMsg").className = "hint";
}
$("authInTab").onclick = () => setAuthMode("in");
$("authUpTab").onclick = () => setAuthMode("up");
$("forgotBtn").onclick = () => setAuthMode("reset");
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("authMsg"), email = $("aEmail").value.trim(), pw = $("aPw").value, go = $("authGo");
  msg.className = "hint bad";
  if(authMode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Enter your email address."; $("aEmail").focus(); return; }
  if(authMode !== "reset" && pw.length < 8){ msg.textContent = "Passwords need at least 8 characters."; $("aPw").focus(); return; }
  if(authMode === "up" && !$("aName").value.trim()){ msg.textContent = "Add your name so friends know who you are."; $("aName").focus(); return; }
  go.disabled = true;
  const redirect = location.origin + location.pathname;
  try{
    if(authMode === "in"){
      const { error } = await sb.auth.signInWithPassword({ email, password:pw });
      if(error) throw new Error(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match.");
    } else if(authMode === "up"){
      const { data, error } = await sb.auth.signUp({ email, password:pw, options:{ data:{ display_name:$("aName").value.trim() }, emailRedirectTo:redirect } });
      if(error) throw new Error(/registered/i.test(error.message) ? "That email already has an account. Sign in instead." : error.message);
      if(!data.session){ setAuthMode("in"); $("aEmail").value = email; msg.className = "hint ok"; msg.textContent = "Check your email and tap the confirmation link, then sign in here."; }
    } else if(authMode === "reset"){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:redirect });
      if(error) throw new Error("Couldn't send the email. Wait a minute and try again.");
      msg.className = "hint ok"; msg.textContent = "Check your email for a link to set a new password.";
    } else {
      const { error } = await sb.auth.updateUser({ password:pw });
      if(error) throw new Error("Couldn't save the new password. Try again.");
      $("auth").hidden = true; toast("Password updated");
    }
  }catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Something went wrong. Try again."; }
  finally{ go.disabled = false; }
});

async function startSession(user){
  if(me && me.id === user.id) return;
  me = { id:user.id, email:user.email };
  outbox = lsGet(outboxKey(), []);
  const cache = lsGet(cacheKey(), null);
  if(cache){ ({ catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile } = { ...cache }); follows = cache.follows || []; tournaments = cache.tournaments || []; announcements = cache.announcements || [];
    for(const j of outbox) if(j.photo){ idb.get(j.photo).then(b => { if(b){ pendingPhotoUrls[j.photo] = URL.createObjectURL(b); renderAll(); } }).catch(()=>{}); } }
  loadState = navigator.onLine ? "loading" : "offline";
  $("auth").hidden = true; canWrite = true;
  renderAll(); updateSync();
  await loadAll(); flush();
}
function showAuth(){ me = null; $("auth").hidden = false; setAuthMode("in"); }
sb.auth.onAuthStateChange((event, session) => {
  if(event === "PASSWORD_RECOVERY"){ $("auth").hidden = false; setAuthMode("newpw"); return; }
  if(session?.user) startSession(session.user);
  else if(event === "SIGNED_OUT") showAuth();
});

/* ---------- start ---------- */
tab = lsGet("fl.tab", "map");
renderAll();
const { data:{ session } } = await sb.auth.getSession();
if(session?.user) startSession(session.user); else if(!location.hash.includes("type=recovery")) showAuth();

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("offline support unavailable", e));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading) return;
    const busy = !$("scrim").hidden || !$("tripScrim").hidden || picking;
    if(!busy){ reloading = true; location.reload(); }
  });
}
})().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<div style="position:fixed;inset:auto 16px 16px;padding:12px 14px;border-radius:12px;background:#2C2922;color:#FAF6EB;z-index:3000;font:15px system-ui">The map couldn't start. Check your connection and reopen the app.</div>`);
});

/* Coulee — built from src/*.js by build.py. Edit the files in src/, then run: python3 build.py */
(async function(){
"use strict";
const CFG = window.FLYLOG_CONFIG;
const RECOVERY_LINK = /type=recovery/.test(location.hash + location.search);
const LINK_ERROR = (location.hash.match(/error_description=([^&]+)/) || [])[1];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dataUrl = p => (CFG.dataBase || "data/") + p + "?v=" + CFG.dataVersion;
// "copper John" -> "Copper John" (flies); "brown Trout" -> "Brown trout" (species, like the app's list). Same rule as the database.
const capWords = s => { s = (s || "").trim().replace(/\s+/g, " "); return s ? s.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ") : null; };
const sentenceCase = s => { s = (s || "").trim().replace(/\s+/g, " "); return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : null; };
// detailed creek lines (DNR 24K) for close zoom; a test version may point these at the monthly refresh
const hdUrl = id => (CFG.hdBase || (CFG.dataBase || "data/") + "water/hd/") + id + ".json?h=" + (CFG.hdVersion || "1");
const offlineV = () => CFG.dataVersion + "." + (CFG.hdVersion || "1");
const DETAIL_ZOOM = 9;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
let toastT; function toast(msg){ const t=$("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3000); }

/* ---------- state ---------- */
let me = null;                 // { id, email }
let profile = null;            // { id, display_name, friend_code }
let spots = [], catches = [], trips = [], outings = [], groupTrips = [];
let friendCatches = [], friendSpots = [], friendTrips = [], friendships = [], people = {};
let follows = [], tournaments = [], announcements = [], mySuggestions = [];
let showFriends = lsGet("fl.showFriends", true);
let showAccess = lsGet("fl.showAccess", true);
let canWrite = true;
let currentCounty = null;
let mapPerson = null;
let waterTapAt = 0, featureTaps = 0, countyOpenZoom = null; // last creek/lake tap time; zoom a county was opened at
let hidePins = false; // "My pins off": hide every spot, catch and fish count, e.g. to show someone the map // when set, the map shows that friend's shared catches and spots instead of yours
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
// One pass over your spots and catches gives every county's numbers. The result is kept only for the current burst of work
// (restyling all 72 counties asks for each county's numbers, and the busiest county's, 72 times over).
let countyMemo = null;
function countyTally(){
  if(countyMemo) return countyMemo;
  const by = {}, at = id => (by[id] ||= { spots:0, fish:0 });
  if(!hidePins){
    if(mapPerson){ // looking at a friend's map: count what they share
      for(const x of friendSpots) if(x.user_id === mapPerson && x.county) at(x.county).spots++;
      for(const c of friendCatches) if(c.user_id === mapPerson && c.county) at(c.county).fish += fishOf(c);
    } else {
      for(const x of spots) if(x.county) at(x.county).spots++;
      for(const c of catches) if(c.county) at(c.county).fish += fishOf(c);
    }
  }
  let max = 1; for(const id in by) if(byId[id] && by[id].fish > max) max = by[id].fish;
  countyMemo = { by, max }; queueMicrotask(() => { countyMemo = null; });
  return countyMemo;
}
function countyStats(id){ const o = countyTally().by[id]; return o ? { spots:o.spots, fish:o.fish } : { spots:0, fish:0 }; }
function totals(){
  const ids = new Set([...spots.map(s=>s.county), ...catches.map(c=>c.county)].filter(Boolean));
  return { spots:spots.length, fish:catches.reduce((a,c)=>a+fishOf(c),0), counties:ids.size };
}

/* Resize an open card after part of it fills in. (Calling the card's own update re-built cards made by a function, which then
   updated again, forever: tapping a stream-flow pin froze instead of opening its card.) */
function refitPopup(node){
  const p = map._popup; if(!p || !p._contentNode || (node && !p._contentNode.contains(node))) return;
  p._updateLayout(); p._updatePosition(); if(p._adjustPan) p._adjustPan();
}

/* Directions links: Google Maps for everyone, Apple Maps too on iPhones, iPads and Macs. */
const appleDevice = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const appleMaps = (lat, lng) => `https://maps.apple.com/?ll=${(+lat).toFixed(6)},${(+lng).toFixed(6)}&q=${encodeURIComponent("Pin")}`;
const mapLinks = (lat, lng) => `<a class="link" href="${gmaps(lat, lng)}" target="_blank" rel="noopener">Open in Google Maps</a>` +
  (appleDevice ? `<a class="link" href="${appleMaps(lat, lng)}" target="_blank" rel="noopener">Open in Apple Maps</a>` : "");

const map = L.map("map", { zoomControl:true, attributionControl:false, minZoom:6, maxZoom:18, zoomSnap:0.25, preferCanvas:false });
map.zoomControl.setPosition("topright");
const wiBounds = L.geoJSON(GEO.counties).getBounds();
map.setMaxBounds(wiBounds.pad(0.6));

/* pane stack, bottom to top: base 380 · counties 400 · water 420 · state line 425 · mask 428 · detail 430 · labels 440 */
const pane = (n, z, pe) => { map.createPane(n); const p = map.getPane(n); p.style.zIndex = z; if(pe === false) p.style.pointerEvents = "none"; return p; };
pane("base", 380, false); pane("water", 420, false); pane("stateline", 425, false); pane("mask", 428, false); pane("detail", 430);
pane("nearby", 426, false);
let detailRenderer = null, nearbyRenderer = null, nearbyLayer = null;
// how close a tap has to be to a creek to count: a fingertip is wider than a mouse pointer
const TAP_TOL = matchMedia("(pointer:coarse)").matches ? 13 : 6;

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
// mapView is declared in a later file; read it safely while the map is first built
const curView = () => { try{ return mapView; }catch(e){ return "field"; } };
function countyStyle(f){
  const s = countyStats(f.id);
  const max = countyTally().max;
  // full strength statewide, fading out as you zoom in (and softer over satellite/topo) so it never sits on top of the water
  const z = map.getZoom(), fade = z < 7.5 ? 1 : Math.max(.12, 1 - (z - 7.5) * .45);
  const heat = (s.fish ? 0.2 + 0.45 * (s.fish / max) : (s.spots ? 0.14 : 0)) * fade * (curView() !== "field" ? .55 : 1);
  if(currentCounty === f.id) return { color: css("--ink"), weight: 2.4, fillColor: css("--land"), fillOpacity: 0 };
  return { color: css("--county-edge"), weight: 0.8, fillColor: s.fish ? css("--fish") : css("--spot"), fillOpacity: heat };
}
countyLayer = L.geoJSON(GEO.counties, {
  style: countyStyle,
  onEachFeature: (f, layer) => {
    layer.on("click", e => { if(picking){ handlePick(e.latlng); return; } if(currentCounty === f.id || currentCounty || map.getZoom() >= AREA_ZOOM) return; openCounty(f.id); });
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
// on satellite and topo the fade outside an open county is lighter, so the photo still reads
const maskOpacity = () => curView() === "field" ? .72 : .38;
document.addEventListener("mapview", () => { if(maskLayer) maskLayer.setStyle({ fillOpacity:maskOpacity(), fillColor:css("--paper") }); });
function setMask(id){
  if(maskLayer){ map.removeLayer(maskLayer); maskLayer = null; }
  if(!id) return;
  const g = byId[id].geometry; const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const holes = polys.map(p => p[0].map(q=>[q[1],q[0]]));
  maskLayer = L.polygon([[[38,-100],[38,-80],[52,-80],[52,-100]], ...holes], { pane:"mask", interactive:false, stroke:false, fillColor:css("--paper"), fillOpacity:maskOpacity() }).addTo(map);
}

/* ---------- detailed creeks, lakes and trout water, one file per county ---------- */
const waterCache = {}, troutCache = {};
let detailLayer = null, detailFor = null, detailStreams = [], detailLakes = [], detailLabelsExtra = [];
/* the creek data has a point every ~60 m, so lines look jagged up close; round the corners (Chaikin) so they read like water */
// how far past the screen edge to pre-draw: generous on phones (quick swipes), modest on big monitors (huge canvases are slow)
const canvasPad = () => innerWidth * innerHeight > 1.2e6 ? .2 : innerWidth > 700 ? .35 : .4;
/* Throw away a drawing surface and give its memory back right away. iPhones cap the total memory all map drawing surfaces
   may use and only reclaim a discarded one much later, so after a few counties the last layer drawn (public land) came up blank. */
function dropCanvas(r){ if(!r) return; const c = r._container; if(map.hasLayer(r)) map.removeLayer(r); if(c){ c.width = 0; c.height = 0; } }
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
/* Line widths follow the zoom, like a printed map drawn at different scales: fine lines when a whole county is on screen
   (so creeks don't clot into blobs), full weight up close. Each line remembers its full-size width (_bw). */
const lineScale = z => z < 9.25 ? .5 : z < 10.25 ? .62 : z < 11.25 ? .8 : z < 12.5 ? 1 : z < 14 ? 1.12 : 1.28;
const sizedLine = (ll, o, bw) => { const k = lineScale(map.getZoom()), l = L.polyline(ll, { ...o, weight:bw * k }); l._bw = bw; l._bk = k; return l; };
function restyleLines(onZoom){
  // on a zoom the layers are about to be redrawn anyway, so only the widths are changed here (no second redraw)
  const k = lineScale(map.getZoom()), fix = l => { if(l._bw && l._bk !== k){ l._bk = k; if(onZoom === true) l.options.weight = l._bw * k; else l.setStyle({ weight:l._bw * k }); } };
  if(detailLayer) detailLayer.eachLayer(fix);
  if(nearbyLayer) nearbyLayer.eachLayer(fix);
  for(const more of restyleMore) more(fix);
}
const restyleMore = [];   // other files add their own line layers here
map.on("zoomend", () => restyleLines(true));
const TROUT = { 1:{ label:"Class I", tok:"--t1" }, 2:{ label:"Class II", tok:"--t2" }, 3:{ label:"Class III", tok:"--t3" } };
/* Map filters for trout water: show or hide each class, and optionally only water you can fish today.
   A stretch's season comes from the nearest DNR regulation; where the DNR lists none, the general inland trout season applies. */
let troutShow = lsGet("fl.troutShow", { 1:true, 2:true, 3:true }), openOnly = lsGet("fl.openOnly", false);
const GENERAL_REG = ["", "General inland trout season", "", "First Saturday in May to October 15", "First Saturday in January to first Saturday in May"];
const openMemo = {};   // county -> Map(trout stretch -> can it be fished today)
function troutOpenNow(cid, seg){
  const m = (openMemo[cid] ||= new Map());
  if(m.has(seg)) return m.get(seg);
  const path = seg[4] && seg[4][0], q = path && path[Math.floor(path.length / 2)];
  const reg = (q && nearestReg(seg[0], { lat:q[1], lng:q[0] }, cid)) || GENERAL_REG;
  const st = seasonStatus(reg) || seasonStatus(GENERAL_REG), ok = !!st && st.kind !== "closed";
  m.set(seg, ok); return ok;
}
const troutVisible = (cid, seg) => !!TROUT[seg[1]] && troutShow[seg[1]] !== false && (!openOnly || troutOpenNow(cid, seg));
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
const waterPopupExtras = [];   // other files add sections to a water's card (lake facts, stocking, flow, weather)
function waterPopup(name, kind, ll, trout, cid){
  const div = document.createElement("div"); div.className = "pop";
  const reg = trout ? nearestReg(name, ll, cid) : null;
  const regHtml = reg ? `<div class="regs"><b>${esc(reg[1])}</b>${reg[3]?`<div><span>Season</span>${esc(reg[3])}</div>`:""}${reg[4]?`<div><span>Early season</span>${esc(reg[4])}</div>`:""}${reg[2]?`<div><span>Bag</span>${esc(reg[2])}</div>`:""}${reg[5]?`<div><span>Gear</span>${esc(reg[5])}</div>`:""}${reg[6]?`<div><span>Special</span>${esc(reg[6])}</div>`:""}${seasonHtml(reg)}<small>From DNR's trout regulation map. Check the current regulations before you fish.</small></div>` : "";
  div.innerHTML = `<h3>${esc(name)}</h3><div class="meta">${esc(kind)}${trout?` · <span class="tclass" style="background:var(${TROUT[trout.c].tok})">${TROUT[trout.c].label} trout</span>`:""}${trout && trout.mi?` · ${trout.mi} mi`:""}</div>${regHtml}
    <div class="coords">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>
    <div class="row">${mapLinks(ll.lat,ll.lng)}${canWrite?`<button class="link" data-a="addspot">Add as spot</button><button class="link" data-a="planwater">Plan a trip</button>`:""}</div>
    <div class="row dnr">${dnrLinks(kind, trout ? TROUT[trout.c].label : null)}</div>`;
  div.addEventListener("click", ev => {
    if(ev.target.closest(".tclass")){ showClassHelp(); return; }   // tap the class for what it means
    if(ev.target.closest('[data-a="addspot"]')){ map.closePopup(); openForm("spot", null, { name, lat:ll.lat, lng:ll.lng, water: waterType(name), trout_class: trout ? TROUT[trout.c].label : "" }); }
    const pw = ev.target.closest('[data-a="planwater"]');
    if(pw){ pendingPlanWater = { name, kind: waterType(name), lat:+ll.lat.toFixed(5), lng:+ll.lng.toFixed(5), county: countyAt(ll.lat, ll.lng) || detailFor || null, trout: trout ? TROUT[trout.c].label + " trout" : null };
      pw.hidden = true; div.insertAdjacentHTML("beforeend", planChooserHtml(pendingPlanWater)); map._popup && map._popup.update(); }
  });
  const info = { name, kind, ll, trout, cid, isLake: /lake|pond|flowage|reservoir/i.test(kind) };
  for(const add of waterPopupExtras){ try{ add(div, info); }catch(e){ console.warn("card section", e); } }
  return div;
}
/* hovering any piece of a creek lights up the whole creek */
let hoverName = null;
function setHover(name){
  if(hoverName === name) return; hoverName = name;
  for(const s of [...detailStreams, ...areaStreams()]){ const on = name && s.name === name; const k = lineScale(map.getZoom()); s.line._bk = k; s.line.setStyle(on ? { color:css("--hl"), weight:(s.w + 2.2) * k } : { color:css("--stream"), weight:s.w * k }); }
  drawLabels();
}
function openWaterPopup(e, name, kind, trout, cid){
  if(picking){ handlePick(e.latlng); return; }
  const el = waterPopup(name, kind, e.latlng, trout, cid), here = countyAt(e.latlng.lat, e.latlng.lng);
  if(here && here !== currentCounty){ const r = document.createElement("div"); r.className = "row"; r.innerHTML = `<button class="link" type="button" data-opencounty="${esc(here)}">Open ${esc(countyName(here))}</button>`; el.appendChild(r); }
  waterTapAt = Date.now(); featureTaps++;
  L.popup({ maxWidth:300 }).setLatLng(e.latlng).setContent(el).openOn(map);
  if(here && here !== currentCounty) outlineCounty(here);
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
  loadAccess(id);
  drawLabels(); renderLog();
  updateArea();
}
function drawDetail(id, w, t){
  if(detailLayer){ map.removeLayer(detailLayer); detailLayer = null; }
  if(detailRenderer){ dropCanvas(detailRenderer); detailRenderer = null; }
  const g = L.layerGroup(); detailStreams = []; detailLakes = []; detailLabelsExtra = [];
  const R = detailRenderer = L.canvas({ pane:"detail", tolerance:TAP_TOL, padding:canvasPad() });  // draw well past the screen edge so panning doesn't show blank strips // a fresh canvas per county
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
  if(t) for(const seg of t.t){
    const [name, c, mi, orw, paths] = seg;
    if(!troutVisible(id, seg)) continue;
    const band = sizedLine(llPaths(paths), { renderer:R, color:css(TROUT[c].tok), opacity:.38, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, 6);
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
    g.addLayer(sizedLine(ll, { renderer:R, interactive:false, color:css("--land"), opacity:.85, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, wgt + 2.4));
    const unnamed = !name || name === "NA" || name === "Unnamed";
    const line = sizedLine(ll, { renderer:R, interactive:!unnamed, color:css("--stream"), opacity:1, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, wgt);
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
  restyleLines();
}
/* creeks in the surrounding counties, drawn under the fade so they read as context */
async function loadNearby(id){
  const lb = {}; countyLayer.eachLayer(l => lb[l.feature.id] = l.getBounds());
  const around = lb[id].pad(0.35);
  const ids = Object.keys(lb).filter(k => k !== id && around.intersects(lb[k]));
  const R = nearbyRenderer = L.canvas({ pane:"nearby", padding:canvasPad() });
  const layer = nearbyLayer = L.layerGroup().addTo(map);
  await Promise.all(ids.map(async k => {
    let w, t;
    try{ [w, t] = await Promise.all([ getJSON(waterCache, dataUrl("water/" + k + ".json"), k), getJSON(troutCache, dataUrl("water/trout/" + k + ".json"), k).catch(()=>null) ]); }catch(e){ return; }
    if(detailFor !== id || nearbyLayer !== layer) return;
    for(const [name, typ, rings] of w.l) layer.addLayer(L.polygon(rings.map(r=>r.map(q=>[q[1],q[0]])), { renderer:R, interactive:false, color:css("--stream"), weight:.5, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" }));
    if(t) for(const seg of t.t){ const [name, c, mi, orw, paths] = seg; if(troutVisible(k, seg)) layer.addLayer(sizedLine(llPaths(paths), { renderer:R, interactive:false, color:css(TROUT[c].tok), opacity:.3, lineJoin:"round" }, 5)); }
    for(const [name, order, paths] of w.s) if(!((!name || name === "NA" || name === "Unnamed") && order >= 4)) layer.addLayer(sizedLine(llPaths(paths), { renderer:R, interactive:false, color:css("--stream"), lineJoin:"round" }, streamWeight(order)));
  }));
}
function clearDetail(){
  if(detailLayer){ map.removeLayer(detailLayer); detailLayer = null; }
  // drop the canvases too: left on the map they cover it and swallow county clicks
  if(detailRenderer){ dropCanvas(detailRenderer); detailRenderer = null; }
  if(nearbyLayer){ map.removeLayer(nearbyLayer); nearbyLayer = null; }
  if(nearbyRenderer){ dropCanvas(nearbyRenderer); nearbyRenderer = null; }
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
// The names are drawn a little past every edge of the screen and ride along with the map while it's dragged, so nothing is
// redrawn mid-drag (redrawing them several times a second was the main cause of choppy panning). They're redrawn when the
// map comes to rest, or mid-drag only once it has travelled far enough to run out of pre-drawn names.
const LABEL_PAD = .22;
let labelDrawnAt = null;
map.on("move", () => {
  if(!labelDrawnAt) return;
  const o = map.getPixelBounds().min, el = map.getContainer();
  if(Math.abs(o.x - labelDrawnAt.x) > el.clientWidth * LABEL_PAD * .7 || Math.abs(o.y - labelDrawnAt.y) > el.clientHeight * LABEL_PAD * .7) drawLabels();
});
map.on("resize viewreset moveend", drawLabels);
// every creek point's place on the flat map, worked out once per line; turning that into a screen position is then one multiply
const mercCache = new WeakMap();
function merc(line){
  let m = mercCache.get(line);
  if(!m){ const n = line.length, a = new Float64Array(n * 2); let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for(let i = 0; i < n; i++){ const sn = Math.sin(line[i][0] * Math.PI / 180), x = (line[i][1] + 180) / 360, y = .5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI);
      a[2*i] = x; a[2*i+1] = y; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
    m = { a, x0, x1, y0, y1 }; mercCache.set(line, m); }
  return m;
}
function renderLabels(){
  const el = map.getContainer(), vw = el.clientWidth, vh = el.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if(!vw || !vh) return;
  // the drawing area reaches past the screen by padX/padY on every side; W and H below are that whole area
  const padX = Math.round(vw * LABEL_PAD), padY = Math.round(vh * LABEL_PAD), W = vw + 2 * padX, H = vh + 2 * padY;
  if(labelCanvas.width !== W*dpr || labelCanvas.height !== H*dpr){ labelCanvas.width = W*dpr; labelCanvas.height = H*dpr; labelCanvas.style.width = W+"px"; labelCanvas.style.height = H+"px"; }
  L.DomUtil.setPosition(labelCanvas, map.containerPointToLayerPoint([-padX, -padY]));
  const ctx = labelCanvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  const org = map.getPixelBounds().min, scale = 256 * Math.pow(2, map.getZoom()), ox = org.x - padX, oy = org.y - padY;   // drawing-area pixel = flat-map position * scale - (ox, oy)
  labelDrawnAt = { x:org.x, y:org.y };
  const onScreen = p => p.x > padX + 2 && p.x < padX + vw - 2 && p.y > padY + 2 && p.y < padY + vh - 2;
  const toArea = ll => { const p = map.latLngToContainerPoint(ll); return { x:p.x + padX, y:p.y + padY }; };
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
      const m = merc(line), a = m.a;
      if(m.x1 * scale - ox < 4 || m.x0 * scale - ox > W - 4 || m.y1 * scale - oy < 4 || m.y0 * scale - oy > H - 4) continue;   // this piece is nowhere near the screen
      let run = [], len = 0, lx = 0, ly = 0;
      const flush = () => { if(len > bestLen){ bestLen = len; best = run; } run = []; len = 0; };
      for(let i = 0, n = a.length; i < n; i += 2){ const x = a[i] * scale - ox, y = a[i+1] * scale - oy;
        if(x < 4 || y < 4 || x > W-4 || y > H-4){ flush(); continue; }
        if(run.length){ const d = Math.hypot(x - lx, y - ly); if(d < 1.5) continue; len += d; }   // points closer than a pixel and a half add nothing
        run.push({ x, y }); lx = x; ly = y; }
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
      const score = straight - turn*0.15 - Math.abs((d0 + tw/2) - L/2) / L * 0.15 + (onScreen(a) && onScreen(b) ? .6 : 0);   // a name you can see beats one waiting past the edge
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
      const b = l.poly.getBounds(); const a = toArea(b.getNorthWest()), c = toArea(b.getSouthEast());
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



/* ---------- creeks for every county on screen once you zoom in, so water reads across county lines ---------- */
pane("area", 429);               // above the fade outside an open county, below the open county itself
const AREA_ZOOM = 9.5;
const areaRenderer = L.canvas({ pane:"area", tolerance:TAP_TOL, padding:canvasPad() });
const areaGroups = {};           // county id -> { g, streams, extra }
const areaOn = new Set();        // counties drawn right now
let areaWant = new Set(), countyBounds = null;
restyleMore.push(fix => { for(const id of areaOn) if(areaGroups[id]) areaGroups[id].g.eachLayer(fix); });
function areaStreams(){ const out = []; for(const id of areaOn) if(areaGroups[id]) out.push(...areaGroups[id].streams); return out; }
function areaExtra(){ const out = []; for(const id of areaOn) if(areaGroups[id]) out.push(...areaGroups[id].extra); return out; }
function buildArea(id, w, t){
  const g = L.layerGroup(), streams = [], extra = [], R = areaRenderer;
  for(const [name, typ, rings] of w.l){
    const named = name && name !== "Unnamed";
    const p = L.polygon(rings.map(r => r.map(q => [q[1], q[0]])), { renderer:R, interactive:!!named, color:css("--stream"), weight:.7, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" });
    if(named) p.on("click", e => openWaterPopup(e, name, waterType(name), null, id));
    g.addLayer(p);
  }
  if(t) for(const [name, c, rings] of t.p){
    const p = L.polygon(rings.map(r => r.map(q => [q[1], q[0]])), { renderer:R, color:css(TROUT[c]?.tok || "--t1"), weight:2, fillColor:css("--lake"), fillOpacity:1, fillRule:"nonzero" });
    p.on("click", e => openWaterPopup(e, name, "Spring pond", { c, mi:null }, id)); g.addLayer(p);
  }
  if(t) for(const seg of t.t){
    const [name, c, mi, orw, paths] = seg;
    if(!troutVisible(id, seg)) continue;
    const band = sizedLine(llPaths(paths), { renderer:R, color:css(TROUT[c].tok), opacity:.38, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, 6);
    band.on("click", e => openWaterPopup(e, name, waterType(name), { c, mi }, id));
    band.on("mouseover", () => setHover(name)); band.on("mouseout", () => setHover(null));
    g.addLayer(band);
  }
  for(const [name, order, raw] of w.s){
    if((!name || name === "NA" || name === "Unnamed") && order >= 4) continue;   // DNR flow paths through lakes, not creeks
    const paths = raw.filter(pa => pa.length > 1 && (pa[0][0] !== pa[pa.length-1][0] || pa[0][1] !== pa[pa.length-1][1] || pa.length > 2));
    if(!paths.length) continue;
    const ll = llPaths(paths), wgt = streamWeight(order);
    g.addLayer(sizedLine(ll, { renderer:R, interactive:false, color:css("--land"), opacity:.85, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, wgt + 2.4));
    const unnamed = !name || name === "NA" || name === "Unnamed";
    const line = sizedLine(ll, { renderer:R, interactive:!unnamed, color:css("--stream"), opacity:1, lineCap:"round", lineJoin:"round", smoothFactor:.5 }, wgt);
    if(unnamed){ g.addLayer(line); continue; }
    const tseg = t && t.t.find(x => x[0] && x[0].toLowerCase() === name.toLowerCase());
    line.on("click", e => openWaterPopup(e, name, waterType(name), tseg ? { c:tseg[1], mi:null } : null, id));
    line.on("mouseover", () => setHover(name)); line.on("mouseout", () => setHover(null));
    g.addLayer(line); streams.push({ name, order, w:wgt, line, ll });
  }
  if(t){ const have = new Set(streams.map(x => x.name.toLowerCase()));
    for(const [name, c, mi, orw, paths] of t.t) if(name && !have.has(name.toLowerCase())) extra.push({ name, order:2, ll:llPaths(paths) }); }
  return { g, streams, extra };
}
let areaBusy = false, areaAgain = false;
async function updateArea(){
  if(areaBusy){ areaAgain = true; return; }
  areaBusy = true;
  try{
    const want = new Set();
    if(map.getZoom() >= AREA_ZOOM){
      countyBounds ||= Object.fromEntries(countyLayer.getLayers().map(l => [l.feature.id, l.getBounds()]));
      const vb = map.getBounds().pad(.15);
      for(const [id, b] of Object.entries(countyBounds)) if(id !== detailFor && vb.intersects(b)) want.add(id);
    }
    areaWant = want;
    for(const id of [...areaOn]) if(!want.has(id)){ map.removeLayer(areaGroups[id].g); areaOn.delete(id); }
    // an empty creek canvas still covers the whole map and would swallow every tap meant for a county: let taps fall through it
    map.getPane("area").style.pointerEvents = areaOn.size ? "" : "none";
    await Promise.all([...want].map(async id => {
      if(areaOn.has(id)) return;
      if(!areaGroups[id]){
        let w, t;
        try{ [w, t] = await Promise.all([ getJSON(waterCache, dataUrl("water/" + id + ".json"), id), getJSON(troutCache, dataUrl("water/trout/" + id + ".json"), id).catch(() => null) ]); }catch(e){ return; }
        areaGroups[id] ||= buildArea(id, levelOf(id, w), t);
      }
      if(!areaWant.has(id) || id === detailFor || areaOn.has(id)) return;
      areaGroups[id].g.addTo(map); areaOn.add(id);
    }));
    // keep a handful of built counties for quick panning back, drop the rest
    const built = Object.keys(areaGroups).filter(id => !areaOn.has(id));
    for(const id of built.slice(0, Math.max(0, built.length - 10))) delete areaGroups[id];
    map.getPane("area").style.pointerEvents = areaOn.size ? "" : "none";
    restyleLines();   // counties kept from an earlier zoom get this zoom's line widths
    const any = areaOn.size > 0 || !!detailFor;
    if(any && map.hasLayer(riverLayer)) map.removeLayer(riverLayer);
    if(!any && !map.hasLayer(riverLayer)) map.addLayer(riverLayer);
    $("legend").classList.toggle("trout-on", any);
    drawLabels();
    document.dispatchEvent(new Event("areachange"));
  }finally{
    areaBusy = false;
    if(areaAgain){ areaAgain = false; updateArea(); }
  }
}
// heavy work waits until the map settles, instead of running after every scroll-zoom step
let settleTimer = null;
map.on("moveend zoomend", () => { clearTimeout(settleTimer); settleTimer = setTimeout(() => { updateArea(); setTimeout(updateHd, 30); document.dispatchEvent(new Event("mapsettled")); }, 220); });

/* ---------- detailed creek lines (DNR 24K, ~3 m) once you're zoomed in close; light lines otherwise ---------- */
const HD_ZOOM = 12;
const hdCache = {}, hdLevel = {};   // county -> detailed streams; county -> "hd" | "base" currently drawn
function levelOf(id, w){ const hd = map.getZoom() >= HD_ZOOM && hdCache[id]; hdLevel[id] = hd ? "hd" : "base"; return hd ? { s:hdCache[id].s, l:w.l } : w; }
let hdBusy = false, hdAgain = false;
async function updateHd(){
  if(hdBusy){ hdAgain = true; return; } hdBusy = true;
  try{
    const z = map.getZoom(), shown = [detailFor, ...areaOn].filter(Boolean);
    if(z >= HD_ZOOM) await Promise.all(shown.filter(id => !hdCache[id]).map(id =>
      fetch(hdUrl(id)).then(r => r.ok ? r.json() : null).then(d => { if(d) hdCache[id] = d; }).catch(() => {})));
    let changed = false;
    for(const id of [detailFor, ...areaOn].filter(Boolean)){
      const want = map.getZoom() >= HD_ZOOM && hdCache[id] ? "hd" : "base";
      if(hdLevel[id] === want || !waterCache[id]) continue;
      if(id === detailFor){ drawDetail(id, levelOf(id, waterCache[id]), troutCache[id]); changed = true; }
      else if(areaOn.has(id)){ map.removeLayer(areaGroups[id].g); areaGroups[id] = buildArea(id, levelOf(id, waterCache[id]), troutCache[id]); areaGroups[id].g.addTo(map); changed = true; }
    }
    if(changed){ drawLabels(); document.dispatchEvent(new Event("areachange")); }
  }finally{ hdBusy = false; if(hdAgain){ hdAgain = false; setTimeout(updateHd, 0); } }
}
document.addEventListener("areachange", () => setTimeout(updateHd, 0));
/* zoomed in, the county "fish caught here" shading would sit over the creeks: fade it out */
let areaShade = null;
document.addEventListener("mapsettled", () => { const z = Math.round(map.getZoom() * 2) / 2; if(z !== areaShade){ areaShade = z; countyLayer.setStyle(countyStyle); } });
document.addEventListener("mapview", () => countyLayer.setStyle(countyStyle));
/* the creek canvas sits over the counties, so a tap on open land opens that county */
// (taps on open land are handled by the county highlight in 89-countytap.js)

/* ---------- map key: trout class and open-now filters ---------- */
function applyTroutFilter(){
  if(detailFor && waterCache[detailFor]) drawDetail(detailFor, levelOf(detailFor, waterCache[detailFor]), troutCache[detailFor]);
  for(const id of Object.keys(areaGroups)){
    if(!areaOn.has(id)){ delete areaGroups[id]; continue; }
    map.removeLayer(areaGroups[id].g); areaGroups[id] = buildArea(id, levelOf(id, waterCache[id]), troutCache[id]); areaGroups[id].g.addTo(map);
  }
  restyleLines(); drawLabels();
}
function syncTroutKey(){
  document.querySelectorAll("#legend [data-tclass]").forEach(b => b.setAttribute("aria-pressed", String(troutShow[b.dataset.tclass] !== false)));
  const o = $("openToggle"); o.setAttribute("aria-pressed", String(openOnly)); o.textContent = openOnly ? "Open now: on" : "Open now: off";
}
$("legend").addEventListener("click", e => {
  const b = e.target.closest("[data-tclass]");
  if(b){ const c = b.dataset.tclass; troutShow = { ...troutShow, [c]: troutShow[c] === false }; lsSet("fl.troutShow", troutShow); syncTroutKey(); applyTroutFilter(); return; }
  if(e.target.closest("#openToggle")){ openOnly = !openOnly; lsSet("fl.openOnly", openOnly); syncTroutKey(); applyTroutFilter();
    if(openOnly) toast("Showing only trout water you can fish today. Always check the current regulations."); return; }
  if(e.target.closest("#classHelp")) showClassHelp();
});
syncTroutKey();
function showClassHelp(){
  const v = document.createElement("div"); v.className = "scrim"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", "What the trout classes mean");
  v.innerHTML = `<div class="sheet"><h2 style="margin-top:0">Trout stream classes</h2>
    <p class="muted" style="margin-top:0">The Wisconsin DNR sorts every trout stream into one of three classes by how well trout reproduce there on their own.</p>
    <div class="classes">
      <div><span class="tclass" style="background:var(--t1)">Class I</span><p><b>Wild trout, no stocking.</b> High-quality water where trout reproduce well enough to keep the stream full on their own. Often small headwater creeks, where the fish can be small or slow-growing. About 40% of Wisconsin's trout miles.</p></div>
      <div><span class="tclass" style="background:var(--t2)">Class II</span><p><b>Some wild trout, helped by stocking.</b> Trout reproduce here, but not enough to fill the stream, so it's stocked. Adult fish survive well from year to year, and some grow bigger than average. About 46%.</p></div>
      <div><span class="tclass" style="background:var(--t3)">Class III</span><p><b>Stocked every year.</b> Marginal trout water with no natural reproduction. Fish generally don't last from one year to the next. About 14%.</p></div>
    </div>
    <p class="muted">A class says how the trout got there, not how good the fishing is or whether you may fish it. Tap any stream for its season and rules.</p>
    <p><a class="link" href="https://dnr.wisconsin.gov/topic/Fishing/trout/streamclassification" target="_blank" rel="noopener">Wisconsin DNR: trout stream classifications</a></p>
    <div class="row2"><button class="btn ink" type="button" data-close>Got it</button></div></div>`;
  v.addEventListener("click", ev => { if(ev.target === v || ev.target.closest("[data-close]")) v.remove(); });
  document.body.appendChild(v);
}


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
/* Catch pins that would sit on top of each other are gathered into one numbered pin until you zoom in far enough to tell them
   apart. Tapping a numbered pin zooms in on its catches. */
const CLUSTER_BELOW = 13.5, CLUSTER_PX = 34;
let ownFish = [], friendFish = [], clusterPins = [];
function groupPins(list, z){
  const out = [];
  for(const it of list){ const p = map.project(it.m.getLatLng(), z); let g = null;
    for(const o of out) if(Math.abs(o.x - p.x) < CLUSTER_PX && Math.abs(o.y - p.y) < CLUSTER_PX){ g = o; break; }
    if(g){ g.items.push(it); const n = g.items.length; g.x += (p.x - g.x) / n; g.y += (p.y - g.y) / n; } else out.push({ x:p.x, y:p.y, items:[it] }); }
  return out.map(o => o.items);
}
function layoutPins(){
  for(const c of clusterPins) c._home.removeLayer(c); clusterPins = [];
  const z = map.getZoom();
  for(const [list, home, cls] of [[ownFish, markerLayer, ""], [friendFish, friendLayer, " friend"]]){
    for(const g of (z >= CLUSTER_BELOW ? list.map(x => [x]) : groupPins(list, z))){
      if(g.length === 1){ if(!home.hasLayer(g[0].m)) home.addLayer(g[0].m); continue; }
      for(const x of g) if(home.hasLayer(x.m)) home.removeLayer(x.m);
      const b = L.latLngBounds(g.map(x => x.m.getLatLng()));
      const cm = L.marker(b.getCenter(), { icon:L.divIcon({ className:"", html:`<div class="mk-cluster${cls}">${icon("i-fish")}<b>${g.length}</b></div>`, iconSize:[0,0] }), zIndexOffset:600, riseOnHover:true, title:`${g.length} catches here. Tap to zoom in.` });
      cm.on("click", () => map.flyToBounds(b.pad(.6), { maxZoom:15, duration:.5 }));
      cm._home = home; home.addLayer(cm); clusterPins.push(cm);
    }
  }
}
map.on("zoomend", layoutPins);
function renderMarkers(){
  markerLayer.clearLayers(); friendLayer.clearLayers(); ownFish = []; friendFish = []; clusterPins = [];
  if(hidePins){ $("legend").classList.remove("friends-on"); return; }
  for(const s of (mapPerson ? [] : spots)){
    const m = L.marker([s.lat,s.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-spot ${esc(s.status)}"></div>`, iconSize:[0,0] }), riseOnHover:true, title:s.name||"Spot" });
    m.bindPopup(() => spotPopup(s), { maxWidth:300, autoPanPadding:[20,20] });
    markerLayer.addLayer(m); markerIndex["s:"+s.id] = m;
  }
  for(const c of (mapPerson ? [] : catches)){
    if(c.lat == null) continue;
    const url = photoSrc(c.photo_path);
    const bg = url ? `style="background-image:url('${url}')"` : "";
    const html = `<div class="mk-fish" ${bg}>${url?"":icon("i-fish")}${fishOf(c)>1?`<span class="n">${fishOf(c)}</span>`:""}</div>`;
    const m = L.marker([c.lat,c.lng], { icon:L.divIcon({ className:"", html, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:500, title:c.species||"Catch" });
    m.bindPopup(() => catchPopup(c), { maxWidth:320, autoPanPadding:[20,20] });
    ownFish.push({ m }); markerIndex["c:"+c.id] = m;
  }
  outingMarkers();
  for(const c of friendCatches){
    if(c.lat == null || (mapPerson && c.user_id !== mapPerson)) continue;
    const first = (c.display_name || "Friend").split(" ")[0];
    const url = photoSrc(c.photo_path);
    const html = `<div class="mk-fish friend${url ? " ph" : ""}" ${url ? `style="background-image:url('${url}')"` : ""}>${url ? "" : icon("i-fish")}${fishOf(c)>1?`<span class="n">${fishOf(c)}</span>`:""}${mapPerson ? "" : `<span class="mk-name">${esc(first)}</span>`}</div>`;
    const m = L.marker([c.lat,c.lng], { icon:L.divIcon({ className:"", html, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:300, title:`${c.display_name}: ${c.species||"Catch"}` });
    m.bindPopup(() => friendCatchPopup(c), { maxWidth:320, autoPanPadding:[20,20] });
    friendFish.push({ m }); markerIndex["f:"+c.id] = m;
  }
  for(const s of friendSpots){
    if(s.lat == null || (mapPerson ? s.user_id !== mapPerson : !showFriends)) continue;
    const m = L.marker([s.lat,s.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-spot friend ${esc(s.status || "")}"></div>`, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:200, title:`${s.display_name}: ${s.name || "Spot"}` });
    m.bindPopup(() => friendSpotPopup(s), { maxWidth:300, autoPanPadding:[20,20] });
    friendLayer.addLayer(m); markerIndex["fs:"+s.id] = m;
  }
  layoutPins();
  $("legend").classList.toggle("friends-on", !!mapPerson || (showFriends && (friendCatches.some(c => c.lat != null) || friendSpots.some(s => s.lat != null))));
}
function updateZoomLayers(){
  const z = map.getZoom();
  const detail = z >= DETAIL_ZOOM;
  const want = (l, on) => { if(on && !map.hasLayer(l)) map.addLayer(l); if(!on && map.hasLayer(l)) map.removeLayer(l); };
  want(badgeLayer, !detail); want(markerLayer, detail); want(nameLayer, detail); want(friendLayer, detail && (showFriends || !!mapPerson));
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
    `<div class="row">${rec.lat != null ? `${mapLinks(rec.lat,rec.lng)}` : ""}
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
    <div class="row2" style="margin:2px 0 4px"><span class="pill ${esc(s.status)}">${STATUS[s.status]||"Want to try"}</span>${s.visibility==="private"?`<span class="pill priv">Private</span>`:s.share_with?.length?`<span class="pill" title="${esc(s.share_with.map(id => people[id]?.display_name || "Friend").join(", "))}">Shared with ${esc(s.share_with.length === 1 ? (people[s.share_with[0]]?.display_name || "1 friend") : s.share_with.length + " friends")}</span>`:""}</div>
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
  const head = `${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${c.weight_lb?` · ${wtTxt(c.weight_lb)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}`;
  return popupShell("catch", c, `<h3>${head}</h3>${c.water?`<div class="meta"><b>${esc(c.water)}</b></div>`:""}<div class="meta">${esc(fmtDate(c.caught_on))}${c.fly?` · ${esc(c.fly)}`:""}${spot?` · ${esc(spot.name)}`:""}</div>
    ${trip?`<div class="meta">Trip: <button class="link" data-a="trip" data-id="${esc(trip.id)}">${esc(trip.name)}</button></div>`:""}
    ${photoGallery(c)}
    ${c.notes?`<p style="margin:6px 0">${esc(c.notes)}</p>`:""}
    <div class="meta" style="margin-top:4px">${VIS[c.visibility]||""}${c._pending?" · Waiting to sync":""}</div>`);
}
function friendCatchPopup(c){
  const div = document.createElement("div"); div.className = "pop";
  const url = photoSrc(c.photo_path);
  div.innerHTML = `<div class="meta" style="color:var(--friend);font-weight:700">${esc(c.display_name)}</div>
    <h3>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${c.weight_lb?` · ${wtTxt(c.weight_lb)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</h3>
    <div class="meta">${esc(fmtDate(c.caught_on))}${c.fly?` · ${esc(c.fly)}`:""} · ${esc(countyName(c.county))}</div>
    ${c.trip_name?`<div class="meta">Trip: ${esc(c.trip_name)}</div>`:""}
    ${photoGallery(c)}
    ${c.notes?`<p style="margin:6px 0">${esc(c.notes)}</p>`:""}
    <div class="row">${c.lat!=null?`${mapLinks(c.lat,c.lng)}`:""}${mapPerson ? "" : `<button class="link" type="button" data-pmap="${esc(c.user_id)}">See ${esc((c.display_name || "their").split(" ")[0])}'s map</button>`}</div>`;
  return div;
}

/* ---------- side panel ---------- */
function thumb(c, cls){
  const url = photoSrc(c.photo_path);
  return url ? `<span class="th ${cls||""}" style="background-image:url('${url}')"></span>` : `<span class="th ${cls||""}">${icon("i-fish")}</span>`;
}
function itemCatch(c){
  return `<li><button class="item" data-go="c:${esc(c.id)}">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${c.weight_lb?` · ${wtTxt(c.weight_lb)}`:""}${beforeJoin(c)?` <span class="pill hist">Before Coulee</span>`:""}</b><small>${esc([fmtDate(c.caught_on), c.water, c.method && c.method !== "fly" ? METHODS[c.method] : "", c.fly, c.county && !currentCounty ? countyName(c.county) : ""].filter(Boolean).join(" · "))}</small></span><span class="num">${fishOf(c)!==1?`<span class="f">×${fishOf(c)}</span>`:""}${c._pending?" ⋯":""}</span></button></li>`;
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
    const ann = announcements[0] && (Date.now() - new Date(announcements[0].created_at)) < 14*864e5 ? `<div class="card notice" style="margin:8px 0 4px"><p class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">From the founder</p><p>${esc(announcements[0].body)}</p></div>` : "";
    el.innerHTML = `<div class="eyebrow">Statewide</div><h2>Wisconsin</h2>${statusLine()}${ann}${inboxHtml()}
      <div class="stats"><div class="stat s"><b>${T.spots}</b><span>potential spots</span></div><div class="stat f"><b>${T.fish}</b><span>fish caught</span></div><div class="stat"><b>${T.counties}<small style="font-size:13px;color:var(--muted)">/72</small></b><span>counties</span></div></div>
      ${rows.length ? `<h4><span>Counties</span><span>spots · fish</span></h4><ul class="list">${rows.map(r=>`<li><button class="item" data-county="${r.id}" style="grid-template-columns:1fr auto"><span class="t"><b>${esc(r.name)} County</b></span><span class="num"><span class="s">${r.spots}</span> · <span class="f">${r.fish}</span></span></button></li>`).join("")}</ul>` :
        (loadState!=="loading" ? `<div class="empty"><b>Your log is empty</b>Tap a county to zoom in, then use <b style="display:inline;font:inherit;color:var(--spot)">Add spot</b> for water you want to try, or <b style="display:inline;font:inherit;color:var(--fish)">Log a catch</b> with a photo. Counties fill in as you go.</div>` : "")}
      ${want.length?`<h4><span>Want to try</span></h4><ul class="list">${want.map(itemSpot).join("")}</ul>`:""}
      ${recent.length?`<h4><span>Recent catches</span></h4><ul class="list">${recent.map(itemCatch).join("")}</ul>`:""}
      ${outsideHtml()}
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
      ${watersBlock(currentCounty)}${offlineBlock(currentCounty)}`;
  }
}
function renderLog(){
  const el = $("log"); const T = totals();
  $("tSpots").textContent = T.spots; $("tFish").textContent = T.fish; $("tCounties").textContent = T.counties;
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  const big = tab !== "map", mainEl = document.querySelector(".main");
  if(mainEl.classList.contains("panel-big") !== big){ mainEl.classList.toggle("panel-big", big); setTimeout(() => { map.invalidateSize(); drawLabels(); }, 300); }
  $("reqDot").hidden = !friendships.some(f => f.status === "pending" && f.addressee === me?.id) && !unreadTotal;
  $("tDot").hidden = !tournaments.some(t => t.my_status === "invited") && !notices.some(n => n.kind.startsWith("tourney") && !n.read);
  if(tab === "map") renderMapTab(el);
  else if(tab === "trips") renderTripsTab(el);
  else if(tab === "tourney") renderTourneyTab(el);
  else if(tab === "friends") renderFriendsTab(el);
  else if(tab === "stats") renderStatsTab(el);
  else renderMeTab(el);
}
function setTab(t){ expandPanel(); if(t === "me" && tab !== "me") meView = "main"; if(t === "tourney" && tab === "tourney") tourneyOpen = null; if(t === "trips" && tab === "trips") tripOpen = null; tab = t; lsSet("fl.tab", t); renderLog(); $("log").scrollTop = 0; if(t === "tourney") loadTournaments(); }
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if(b) setTab(b.dataset.tab); });

$("log").addEventListener("click", ev => {
  const c = ev.target.closest("[data-county]"); if(c){ openCounty(c.dataset.county); return; }
  const w = ev.target.closest("[data-water]"); if(w){ flashWater(w.dataset.water); return; }
  if(ev.target.closest('[data-a="morewaters"]')){ showAllWaters = !showAllWaters; renderLog(); return; }
  const g = ev.target.closest("[data-go]");
  if(g && g.dataset.go){
    if(tab === "stats"){ const c = catches.find(x => "c:" + x.id === g.dataset.go); if(c && c.lat == null){ openForm("catch", c); return; } setTab("map"); }
    focusMarker(g.dataset.go); }
});
function focusMarker(key){
  const m = markerIndex[key]; if(!m) return;
  const ll = m.getLatLng();
  if(key.startsWith("f:") && !showFriends){ showFriends = true; lsSet("fl.showFriends", true); }
  map.flyTo(ll, Math.max(map.getZoom(), 14), { duration:.6 });   // close enough that the pin stands on its own, not inside a numbered group
  map.once("moveend", () => { updateZoomLayers(); m.openPopup(); });
}
let renderQueued = false;
function renderAll(){ if(renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderBadges(); renderMarkers(); countyLayer.setStyle(countyStyle); updateZoomLayers(); renderLog(); }); }

function openCounty(id){
  currentCounty = id; $("backBtn").hidden = false;
  const layer = countyLayer.getLayers().find(l => l.feature.id === id);
  if(layer){ map.fitBounds(layer.getBounds(), { padding:[24,24] }); countyOpenZoom = map.getBoundsZoom(layer.getBounds(), false, L.point(48, 48)); }
  clearOutline();
  if(tab !== "map") tab = "map";
  countyLayer.setStyle(countyStyle); setMask(id); updateZoomLayers(); renderLog(); showDetail(id);
}
function backToState(){ currentCounty = null; countyOpenZoom = null; clearOutline(); clearDetail(); setMask(null); $("backBtn").hidden = true; fitState(); countyLayer.setStyle(countyStyle); updateZoomLayers(); renderLog(); }
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
let photoDate = null, photoTime = null, photoExif = null, ph2File = null, ph2Url = null, ph2Removed = false;
let formOpenSeq = 0;
function setPh2(url, title, has){
  $("ph2Pv").style.backgroundImage = url ? `url('${url}')` : ""; $("ph2Pv").textContent = url ? "" : "+";
  $("ph2Title").textContent = title; $("ph2Del").hidden = !(url || has);
}
$("fPhoto2").addEventListener("change", () => {
  const f = $("fPhoto2").files[0]; if(!f) return;
  ph2File = f; ph2Removed = false; if(ph2Url) URL.revokeObjectURL(ph2Url); ph2Url = URL.createObjectURL(f);
  setPh2(ph2Url, "Second photo added");
});
$("ph2Del").onclick = () => { ph2File = null; ph2Removed = true; $("fPhoto2").value = ""; setPh2(null, "Add a second photo"); };
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
function setVis(v){ visibility = v; $("visSeg").querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); renderShareRow(); }
/* spots and catches can go to only some friends, and chosen friends can get the exact place when everyone else sees the county */
let shareWith = null; // null = all friends, otherwise a Set of friend ids
let exactFor = null;  // null = nobody extra, otherwise a Set of friend ids who see the exact place
function myFriends(){ return friendships.filter(f => f.status === "accepted").map(f => f.requester === me?.id ? f.addressee : f.requester).map(id => ({ id, name:people[id]?.display_name || "Friend" })).sort((a, b) => a.name.localeCompare(b.name)); }
function renderShareRow(){
  const el = $("shareRow"); if(!el) return;
  const fr = myFriends(), what = formKind === "spot" ? "spot" : "catch";
  if(visibility === "private" || !fr.length){ el.hidden = true; return; }
  el.hidden = false;
  const pool = shareWith ? fr.filter(f => shareWith.has(f.id)) : fr;
  if(exactFor) for(const id of [...exactFor]) if(!pool.some(f => f.id === id)) exactFor.delete(id);
  el.innerHTML = `<div class="seg vis sm" role="group" aria-label="Which friends"><button type="button" data-sw="all" aria-pressed="${!shareWith}">All friends</button><button type="button" data-sw="some" aria-pressed="${!!shareWith}">Only some</button></div>
    ${shareWith ? `<div class="chips">${fr.map(f => `<button type="button" class="chip" data-swid="${esc(f.id)}" aria-pressed="${shareWith.has(f.id)}">${esc(f.name)}</button>`).join("")}</div>
    <small class="hint">${shareWith.size ? `Only ${shareWith.size === 1 ? "this friend sees" : `these ${shareWith.size} friends see`} this ${what}. Followers don't.` : `Pick at least one friend, or nobody sees this ${what}.`}</small>` : ""}
    ${visibility === "county" && pool.length ? `<div class="exactrow"><span class="lbl">Exact spot for</span><div class="seg vis sm" role="group" aria-label="Who sees the exact spot"><button type="button" data-ex="none" aria-pressed="${!exactFor}">Nobody</button><button type="button" data-ex="some" aria-pressed="${!!exactFor}">Some friends</button></div>
      ${exactFor ? `<div class="chips">${pool.map(f => `<button type="button" class="chip" data-exid="${esc(f.id)}" aria-pressed="${exactFor.has(f.id)}">${esc(f.name)}</button>`).join("")}</div>
      <small class="hint">${exactFor.size ? `${exactFor.size === 1 ? "This friend gets" : `These ${exactFor.size} friends get`} the exact place, water and notes. Everyone else sees the county.` : "Pick the friends who get the exact place."}</small>` : ""}</div>` : ""}`;
}
$("shareRow").addEventListener("click", e => {
  const a = e.target.closest("[data-sw]"); if(a){ shareWith = a.dataset.sw === "some" ? new Set(shareWith || []) : null; renderShareRow(); return; }
  const c = e.target.closest("[data-swid]"); if(c){ shareWith.has(c.dataset.swid) ? shareWith.delete(c.dataset.swid) : shareWith.add(c.dataset.swid); renderShareRow(); return; }
  const x = e.target.closest("[data-ex]"); if(x){ exactFor = x.dataset.ex === "some" ? new Set(exactFor || []) : null; renderShareRow(); return; }
  const y = e.target.closest("[data-exid]"); if(y){ exactFor.has(y.dataset.exid) ? exactFor.delete(y.dataset.exid) : exactFor.add(y.dataset.exid); renderShareRow(); }
});
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
  clearTimeout(updateWaterFromCoords._t); updateWaterFromCoords._t = setTimeout(updateWaterFromCoords, 150);
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
  photoFile = file; photoDate = null; photoTime = null;
  if(photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  let ex = null; try{ ex = readExif(await file.arrayBuffer()); }catch(e){}
  photoExif = ex;
  const found = [];
  if(ex && ex.lat != null){ $("fCoords").value = `${ex.lat.toFixed(5)}, ${ex.lng.toFixed(5)}`; coordHint(); found.push("location"); }
  if(ex && ex.date){ const m = ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m){ photoDate = `${m[1]}-${m[2]}-${m[3]}`; const tm = ex.date.match(/[ T](\d{2}):(\d{2})(?::(\d{2}))?/); photoTime = tm ? `${tm[1]}:${tm[2]}:${tm[3] || "00"}` : null; $("fDate").value = photoDate; $("fDate").dispatchEvent(new Event("change")); found.push("date"); } }
  setPhotoPreview(photoPreviewUrl, file.name || "Photo",
    (found.length ? `Filled ${found.join(" and ")} from the photo.` : "No location in this photo. Tap Here or Map below.") + (photoDate ? "" : " It has no date stamp, so it can't count in photo tournaments."));
  $("photoSub").style.color = found.includes("location") ? "var(--spot)" : "var(--danger)";
  $("camFixBtn").hidden = found.includes("location");
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
  editing = rec || null; photoFile = null; photoDate = null; photoTime = null; tripTouched = !!rec; $("fPhoto").value = ""; $("formErr").textContent = ""; $("photoSub").style.color = ""; $("camFixBtn").hidden = true;
  setKind(kind);
  const r = rec || prefill || {};
  $("fCoords").value = (r.lat != null) ? `${(+r.lat).toFixed(5)}, ${(+r.lng).toFixed(5)}` : "";
  $("fName").value = r.name || ""; $("fWater").value = r.water || "Creek"; $("fClass").value = r.trout_class || ""; $("fTarget").value = r.target || ""; $("fStatus").value = r.status || "want";
  $("fSpecies").value = r.species || ""; $("fLen").value = r.length_in ?? ""; $("fCount").value = r.count ?? 1; $("fFly").value = r.fly || "";
  $("fDate").value = r.caught_on || todayStr(); $("fNotes").value = r.notes || "";
  $("fWaterName").value = r.water || ""; waterTouched = !!(rec && rec.water); $("waterHint").textContent = ""; $("waterNear").innerHTML = "";
  $("fMethod").value = r.method || defaultMethod(); updateFlyLabel();
  $("fWt").value = r.weight_lb ? String(+r.weight_lb) : ""; $("fWtHint").textContent = r.weight_lb ? wtTxt(r.weight_lb) : ""; syncWeightRow(); fillForOptions(); $("fFor").value = "";
  fillTripOptions(rec ? rec.trip_id : (r.trip_id || (tripFor($("fDate").value)?.id)));
  fillSpotOptions(r.lat != null ? { lat:+r.lat, lng:+r.lng } : null); $("fSpotLink").value = r.spot_id || $("fSpotLink").value;
  $("fMore").open = !!($("fTrip").value || $("fSpotLink").value); renderSpeciesChips();
  shareWith = rec?.share_with?.length ? new Set(rec.share_with) : null;
  exactFor = rec?.exact_for?.length ? new Set(rec.exact_for) : null;
  if(rec) setVis(rec.visibility); else renderShareRow();
  const url = photoSrc(r.photo_path), openedFor = ++formOpenSeq;
  ph2File = null; ph2Removed = false; $("fPhoto2").value = "";
  const p2 = morePaths(rec)[0]; setPh2(p2 ? photoSrc(p2) : null, p2 ? "Second photo saved · tap to replace" : "Add a second photo", !!p2);
  if(r.photo_path) setPhotoPreview(url, "Photo saved", "Choose another to replace it");
  else setPhotoPreview(null, "Add a photo", "Location and date fill in from the photo when it has them");
  // the saved photos' links may still be on their way: show them as soon as they arrive (unless a new photo was picked meanwhile)
  if(r.photo_path && !url) photoUrl(r.photo_path).then(u => { if(u && openedFor === formOpenSeq && !photoFile && !$("scrim").hidden) $("photoPv").style.backgroundImage = `url('${u}')`, $("photoPv").innerHTML = ""; });
  if(p2 && !photoSrc(p2)) photoUrl(p2).then(u => { if(u && openedFor === formOpenSeq && !ph2File && !ph2Removed && !$("scrim").hidden) setPh2(u, "Second photo saved · tap to replace", true); });
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
  if(panelFull) setFull(false);   // the map has to be showing to tap a place on it
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
/* The map is a stack of drawing layers: the open county's creeks sit over the surrounding counties' creeks, which sit over public land.
   Only the top one hears a tap, so a tap it has no use for is handed down the stack, and finally to the county itself. */
let passingTap = false;
function passTapDown(e){
  const ev = e.originalEvent; if(!ev) return false;
  const before = featureTaps;
  passingTap = true;
  try{
    for(const R of [detailRenderer, areaRenderer, accessR]){
      if(!R || !R._container || !map.hasLayer(R) || R._container === ev.target) continue;   // the layer that got the tap has had its say
      R._onClick(ev);
      if(featureTaps !== before) return true;
    }
  } finally { passingTap = false; }
  return false;
}
map.on("click", e => {
  if(passingTap) return;
  if(picking){ handlePick(e.latlng); return; }
  if(Date.now() - waterTapAt < 400) return;   // a creek, lake or public land took this tap
  if(passTapDown(e)) return;
  tapCounty(e.latlng);
});
/* computer: hovering a creek in a neighboring county lights it up, even under the open county's layer */
let hoverPassAt = 0;
map.getContainer().addEventListener("mousemove", ev => {
  if(ev.buttons || ev.timeStamp - hoverPassAt < 40) return;   // not while dragging, and only ~25 times a second
  hoverPassAt = ev.timeStamp;
  if(!detailRenderer || !areaRenderer._container || !map.hasLayer(areaRenderer) || ev.target !== detailRenderer._container) return;
  if(detailRenderer._hoveredLayer){ if(areaRenderer._hoveredLayer) areaRenderer._handleMouseOut(ev); }
  else areaRenderer._onMouseMove(ev);
  ev.target.style.cursor = !detailRenderer._hoveredLayer && areaRenderer._hoveredLayer ? "pointer" : "";
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
      notes: $("fNotes").value.trim() || null, visibility,
      share_with: visibility !== "private" && shareWith ? [...shareWith] : null,
      exact_for: visibility === "county" && exactFor && exactFor.size ? [...exactFor] : null };
    if(base.share_with && !base.share_with.length){ err.textContent = `Pick at least one friend to share this ${formKind === "spot" ? "spot" : "catch"} with, or choose All friends.`; btn.disabled = false; btn.textContent = label; return; }
    let rec, table, blob = null, second = null;
    if(formKind==="catch"){
      table = "catches";
      if(photoFile){ btn.textContent = "Preparing photo…"; blob = await shrink(photoFile); }
      rec = { ...base, species:sentenceCase($("fSpecies").value), length_in: len ? +len : null, count: Math.max(0, parseInt($("fCount").value,10) || 0),
        fly:capWords($("fFly").value), method:$("fMethod").value, weight_lb:(w => w == null || Number.isNaN(w) ? null : w)(parseWeight($("fWt").value)), water:$("fWaterName").value.trim() || null, caught_on:$("fDate").value, spot_id:$("fSpotLink").value || null, trip_id:$("fTrip").value || null,
        photo_path: editing ? (editing.photo_path || null) : null,
        photo_taken_on: photoFile ? photoDate : (editing ? (editing.photo_taken_on || null) : null),
        photo_time: photoFile ? photoTime : (editing ? (editing.photo_time || null) : null),
        photo_hash: editing ? (editing.photo_hash || null) : null, photo_meta: editing ? (editing.photo_meta || null) : null };
      if(blob){ try{ rec.photo_hash = await dhash(blob); }catch(e){ rec.photo_hash = null; } rec.photo_meta = photoMeta(photoExif, c); }
      if($("fCount").value === "") rec.count = 1;
      if(ph2File){ btn.textContent = "Preparing photos…"; const b2 = await shrink(ph2File); let h2 = null; try{ h2 = await dhash(b2); }catch(e){} second = { blob:b2, hash:h2 }; }
      else if(ph2Removed) second = { remove:true };
      if(second && !rec.photo_path && !blob && second.blob){ blob = second.blob; rec.photo_hash = second.hash; second = null; }   // only one photo: it becomes the main one
    } else {
      table = "spots";
      rec = { ...base, name:$("fName").value.trim(), water:$("fWater").value, trout_class:$("fClass").value || null, target:$("fTarget").value.trim() || null, status:$("fStatus").value };
    }
    const wasEditing = !!editing;
    if(table === "catches") lsSet("fl.method", rec.method);
    const forFriend = table === "catches" && !wasEditing ? $("fFor").value : "";
    if(forFriend){
      btn.textContent = "Sending…";
      const fname = friendsList().find(f => f.id === forFriend)?.name || "your friend";
      await sendGift(rec, blob, forFriend);
      closeForm(); toast(`Sent to ${fname}. It joins their log when they accept it.`); return;
    }
    const before = table === "catches" && !wasEditing ? catches.slice() : null;
    await saveRecord(table, rec, blob, wasEditing, second);
    if(before) setTimeout(() => celebrate(rec, before), 350);
    closeForm();
    const where = rec.county ? countyName(rec.county) : "your log";
    toast(navigator.onLine ? `${table==="catches"?"Catch":"Spot"} saved in ${where}` : `Saved on this phone. It will sync when you're back online.`);
    if(rec.lat != null && !wasEditing && !map.getBounds().pad(-.1).contains([rec.lat, rec.lng])) map.panTo([rec.lat, rec.lng]);   // show it, without jumping into the county
  }catch(e){
    console.error(e);
    err.textContent = e && e.userMessage ? e.userMessage : "Couldn't save. Check your connection and try again.";
  }finally{ btn.disabled = false; btn.textContent = label; }
});

/* species: one tap on what you usually catch, instead of typing on a phone keyboard */
function renderSpeciesChips(){
  const n = {}; catches.forEach(c => { if(c.species) n[c.species] = (n[c.species] || 0) + fishOf(c); });
  const mine = Object.entries(n).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const base = [...$("speciesList").querySelectorAll("option")].map(o => o.value || o.textContent);
  const list = [...new Set([...mine, ...base])].slice(0, 6);
  const cur = $("fSpecies").value.trim().toLowerCase();
  $("spChips").innerHTML = list.map(s => `<button type="button" class="chip sm" data-sp="${esc(s)}" aria-pressed="${s.toLowerCase() === cur}">${esc(s)}</button>`).join("");
}
$("spChips").addEventListener("click", e => { const b = e.target.closest("[data-sp]"); if(!b) return; $("fSpecies").value = b.dataset.sp; renderSpeciesChips(); $("fLen").focus({ preventScroll:true }); });
$("fSpecies").addEventListener("input", renderSpeciesChips);
/* phone keyboard: keep the field being typed in visible above it */
$("entryForm").addEventListener("focusin", e => {
  if(!e.target.matches("input:not([type=file]):not([type=checkbox]), textarea") || innerWidth > 760) return;
  setTimeout(() => e.target.scrollIntoView({ block:"center", behavior:"smooth" }), 320);
});
if(window.visualViewport) visualViewport.addEventListener("resize", () => {
  const kb = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
  document.documentElement.style.setProperty("--kb", kb > 80 ? kb + "px" : "0px");
});


/* ---------- Supabase connection ---------- */
// "Stay signed in" keeps the session in long-lived storage; otherwise it ends when the app is closed
const authStore = {
  getItem: k => { try{ return localStorage.getItem(k) ?? sessionStorage.getItem(k); }catch(e){ return null; } },
  setItem: (k, v) => { try{ if(lsGet("fl.stay", true)){ localStorage.setItem(k, v); sessionStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.removeItem(k); } }catch(e){} },
  removeItem: k => { try{ localStorage.removeItem(k); sessionStorage.removeItem(k); }catch(e){} }
};
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"fl.auth", storage:authStore }
});
try{ navigator.storage?.persist?.(); }catch(e){}
const COLS = {
  catches: ["id","trip_id","spot_id","lat","lng","county","species","length_in","count","fly","caught_on","notes","photo_path","visibility","photo_taken_on","photo_time","method","photo_hash","photo_meta","water","weight_lb","more_photos","share_with","exact_for"],
  spots: ["id","name","lat","lng","county","water","trout_class","target","notes","status","visibility","share_with","exact_for"],
  trips: ["id","name","start_date","end_date","base","notes","shared","waters"],
  outings: ["id","trip_id","fished_on","hours","water","lat","lng","county","notes","on_map"]
};
const pick = (table, r) => { const o = {}; for(const k of COLS[table]) if(k in r) o[k] = r[k] === undefined ? null : r[k]; return o; };
const listFor = t => t === "catches" ? catches : t === "spots" ? spots : t === "outings" ? outings : trips;
function setList(t, v){ if(t === "catches") catches = v; else if(t === "spots") spots = v; else if(t === "outings") outings = v; else trips = v; }

/* ---------- photo blobs waiting to upload (IndexedDB) ---------- */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("flylog", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("blobs", mode); const s = t.objectStore("blobs"); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { put:(k,v) => tx("readwrite", s => s.put(v, k)), get:k => tx("readonly", s => s.get(k)), del:k => tx("readwrite", s => s.delete(k)) };
})();

/* ---------- photo display: signed links, fetched in batches and remembered on this device ----------
   Photos are private, so each needs a signed link. A link used to be asked for only when a list or the map drew the photo;
   anything opened before the link arrived (the edit form, the big photo viewer) showed a blank and never caught up.
   Now: links are remembered for a day, every screen that shows a photo is filled in when its link arrives, a photo that fails
   to load asks for a fresh link once, and the service worker keeps photos you've seen so they open instantly and offline. */
const PH_TTL = 24 * 3600;   // seconds a signed link lasts
const photoCache = {}, pendingPhotoUrls = {}, photoWaiters = {};
let photoWant = new Set(), photoTimer = null, photoRetry = 0, photoSaveTimer = null;
const photoKey = () => "fl.ph." + (me?.id || "anon");
// out-of-date links are kept too: with no signal they still open any photo this device has saved
function loadPhotoCache(){ const saved = lsGet(photoKey(), {}); for(const [p, v] of Object.entries(saved)) if(!photoCache[p] && v && v[0]) photoCache[p] = { url:v[0], exp:v[1] || 0 }; }
function savePhotoCache(){ clearTimeout(photoSaveTimer); photoSaveTimer = setTimeout(() => { const out = {};
  for(const [p, c] of Object.entries(photoCache).filter(([, c]) => c.url && !c.url.startsWith("blob:")).sort((x, y) => (y[1].at || y[1].exp) - (x[1].at || x[1].exp)).slice(0, 400)) out[p] = [c.url, c.exp];
  lsSet(photoKey(), out); }, 400); }
// extra photo paths of a catch (own catches store [{p,h}], friends' come as plain paths)
const morePaths = c => (c && c.more_photos ? c.more_photos.map(x => typeof x === "string" ? x : x && x.p).filter(Boolean) : []);
// an <img> that fills itself in when its link arrives, and asks for a new link if it fails to load
const phImg = (path, attrs) => `<img ${attrs || ""} src="${photoSrc(path)}" data-ph="${esc(path)}">`;
// one photo, or a swipeable pair
function photoGallery(c, cls){
  const paths = [c.photo_path, ...morePaths(c)].filter(Boolean);
  const alt = esc(c.species || "Catch") + " photo";
  if(!paths.length || !paths.some(photoSrc)) return "";
  if(paths.length === 1) return phImg(paths[0], `${cls ? `class="${cls}"` : ""} alt="${alt}" loading="lazy"`);
  return `<div class="galw ${cls ? cls + "w" : ""}"><div class="gal ${cls || ""}">${paths.map((p, i) => phImg(p, `alt="${alt} ${i + 1} of ${paths.length}" loading="lazy"`)).join("")}</div><span class="galn">${paths.length} photos · swipe</span></div>`;
}
function wantPhoto(path){ photoWant.add(path); clearTimeout(photoTimer); photoTimer = setTimeout(fetchPhotoUrls, 60); }
function photoSrc(path){
  if(!path) return "";
  if(pendingPhotoUrls[path]) return pendingPhotoUrls[path];
  const c = photoCache[path], now = Date.now();
  if(c && c.exp > now) return c.url;
  if(!c || !c.failed || now - c.failed > 30000) wantPhoto(path);
  return c && c.url ? c.url : "";   // an out-of-date link still opens a photo this device has saved
}
// a promise for a working link: for screens that open once and aren't redrawn (forms, the photo viewer)
function photoUrl(path){
  if(!path) return Promise.resolve("");
  const u = photoSrc(path), c = photoCache[path];
  if(pendingPhotoUrls[path] || (c && c.exp > Date.now())) return Promise.resolve(u);
  return new Promise(res => (photoWaiters[path] ||= []).push(res));
}
function hydratePhotos(){
  for(const el of document.querySelectorAll("img[data-ph]")){ const u = photoSrc(el.dataset.ph); if(u && el.getAttribute("src") !== u) el.src = u; }
}
async function fetchPhotoUrls(){
  clearTimeout(photoTimer);
  const paths = [...photoWant].filter(p => !pendingPhotoUrls[p]);
  if(!paths.length){ photoWant = new Set(); return; }
  if(!navigator.onLine || !me) return;   // still wanted: asked again when the connection is back
  photoWant = new Set();
  try{
    const now = Date.now();
    for(let i = 0; i < paths.length; i += 100){
      const { data, error } = await sb.storage.from("photos").createSignedUrls(paths.slice(i, i + 100), PH_TTL);
      if(error) throw error;
      for(const d of data || []){ if(!d.path) continue;
        if(d.signedUrl) photoCache[d.path] = { url:d.signedUrl, exp:now + (PH_TTL - 1800) * 1000, at:now };
        else photoCache[d.path] = { url:photoCache[d.path]?.url || "", exp:0, failed:now, at:photoCache[d.path]?.at }; }
    }
    photoRetry = 0;
    for(const p of paths){ const w = photoWaiters[p]; if(w){ delete photoWaiters[p]; const u = photoCache[p]?.url || ""; w.forEach(f => f(u)); } }
    savePhotoCache(); hydratePhotos(); renderAll();
  }catch(e){
    console.warn("photo links", e);
    for(const p of paths) photoWant.add(p);
    photoRetry = Math.min(60000, (photoRetry || 2000) * 2); photoTimer = setTimeout(fetchPhotoUrls, photoRetry);
  }
}
window.addEventListener("online", () => { if(photoWant.size) fetchPhotoUrls(); });
// a photo that fails to load (an expired link, a dropped connection) asks for a fresh link once
document.addEventListener("error", e => {
  const el = e.target; if(!el || el.tagName !== "IMG" || !el.dataset.ph || el.dataset.phRetry) return;
  el.dataset.phRetry = "1"; const c = photoCache[el.dataset.ph]; if(c) c.exp = 0; wantPhoto(el.dataset.ph);
}, true);
function forgetPhotos(){ try{ localStorage.removeItem(photoKey()); }catch(e){} try{ return caches.delete("flylog-photos").catch(() => {}); }catch(e){} }

/* ---------- offline outbox ---------- */
let outbox = [];
const outboxKey = () => "fl.outbox." + (me?.id || "anon");
const cacheKey = () => "fl.cache." + (me?.id || "anon");
function saveOutbox(){ lsSet(outboxKey(), outbox); updateSync(); }
function saveCache(){ lsSet(cacheKey(), { catches, spots, trips, outings, groupTrips, friendCatches, friendSpots, friendTrips, friendships, people, profile, follows, tournaments, announcements, at:Date.now() }); }
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
          for(const p of job.more || []){
            const b = await idb.get(p);
            if(b){ const { error } = await sb.storage.from("photos").upload(p, b, { contentType:"image/jpeg", upsert:true }); if(error) throw error; }
          }
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
          if(job.oldMore?.length) await sb.storage.from("photos").remove(job.oldMore);
          for(const p of job.more || []) await idb.del(p).catch(()=>{});
          if(job.photo){ await idb.del(job.photo).catch(()=>{}); }
          const rec = listFor(job.table).find(r => r.id === job.row.id); if(rec) delete rec._pending;
        } else if(job.op === "delete"){
          const { error } = await sb.from(job.table).delete().eq("id", job.id);
          if(error) throw error;
          const gone = [job.photo, ...(job.more || [])].filter(Boolean);
          if(gone.length) await sb.storage.from("photos").remove(gone);
        }
        outbox.shift(); saveOutbox(); syncFailing = false;
      }catch(e){
        const status = e && (e.status || e.statusCode);
        const offline = !navigator.onLine || (e && /fetch|network|Load failed/i.test(String(e.message || e)));
        if(offline){ break; }
        console.error("sync", job, e);
        if(status && String(status).startsWith("4")){ outbox.shift(); saveOutbox(); toast(e && /tournament/i.test(e.message || "") ? e.message : "One change couldn't be saved and was skipped."); setTimeout(loadAll, 1500); continue; }
        syncFailing = true; break;
      }
    }
  } finally { flushing = false; updateSync(); saveCache(); renderAll(); }
}
window.addEventListener("online", () => { loadAll(); flush(); });
window.addEventListener("offline", () => { updateSync(); if(loadState === "ready") { loadState = "offline"; renderLog(); } });
setInterval(() => { if(outbox.length) flush(); }, 30000);

async function saveRecord(table, rec, blob, isEdit, second){
  if(!me) throw Object.assign(new Error("signed out"), { userMessage:"Sign in to save." });
  const job = { op:"upsert", table, row: pick(table, rec), isNew: !isEdit };
  if(blob){
    const path = `${me.id}/${rec.id}-${Date.now()}.jpg`;
    await idb.put(path, blob);
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    if(isEdit && rec.photo_path) job.oldPhoto = rec.photo_path;
    rec.photo_path = path; job.row.photo_path = path; job.photo = path;
  }
  // second photo: second = { blob, hash } to add/replace, or { remove:true }
  if(second && table === "catches"){
    const old = morePaths(isEdit ? (listFor(table).find(r => r.id === rec.id) || {}) : {});
    if(second.blob){
      const path = `${me.id}/${rec.id}-2-${Date.now()}.jpg`;
      await idb.put(path, second.blob); pendingPhotoUrls[path] = URL.createObjectURL(second.blob);
      rec.more_photos = [{ p:path, h:second.hash || null }]; job.more = [path];
    } else if(second.remove) rec.more_photos = null;
    job.row.more_photos = rec.more_photos ?? null;
    if((second.blob || second.remove) && old.length) job.oldMore = old.filter(p => !pendingPhotoUrls[p]);
  }
  // newer edits of the same record replace a waiting one
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id && !j.photo && !j.more));
  outbox.push(job); saveOutbox();
  const list = listFor(table).filter(r => r.id !== rec.id);
  const prev = listFor(table).find(r => r.id === rec.id) || {};
  list.push({ ...prev, ...rec, user_id: me.id, created_at: prev.created_at || new Date().toISOString(), _pending:true });
  setList(table, list); saveCache(); renderAll();
  flush();
}
async function removeRecord(kind, rec){
  const table = kind === "catch" ? "catches" : kind === "spot" ? "spots" : kind === "outing" ? "outings" : "trips";
  setList(table, listFor(table).filter(r => r.id !== rec.id));
  if(table === "spots") catches.forEach(c => { if(c.spot_id === rec.id) c.spot_id = null; });
  if(table === "trips") catches.forEach(c => { if(c.trip_id === rec.id) c.trip_id = null; });
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id));
  outbox.push({ op:"delete", table, id:rec.id, photo: rec.photo_path && !pendingPhotoUrls[rec.photo_path] ? rec.photo_path : null, more: morePaths(rec).filter(p => !pendingPhotoUrls[p]) });
  saveOutbox(); saveCache(); renderAll();
  toast(`${kind === "catch" ? "Catch" : kind === "spot" ? "Spot" : kind === "outing" ? "Time on the water" : "Trip"} deleted`);
  flush();
}

/* ---------- loading everything for the signed-in angler ---------- */
async function loadAll(){
  loadPhotoCache();
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
    // newer tables: a problem here must never block the rest of the app
    try{ const [o, g] = await Promise.all([sb.from("outings").select("*").order("fished_on", { ascending:false }), sb.rpc("my_group_trips")]);
      if(!o.error) outings = merge("outings", o.data || []); if(!g.error) groupTrips = g.data || []; }catch(e){}
    friendCatches = fc.data || []; friendSpots = fs.data || []; friendTrips = ft.data || [];
    friendships = fr.data || []; profile = pr.data || profile;
    const ids = [...new Set(friendships.flatMap(f => [f.requester, f.addressee]).filter(id => id !== me.id))];
    if(ids.length){ const { data } = await sb.from("profiles").select("id, display_name, avatar_path, title, username, bio").in("id", ids); people = Object.fromEntries((data || []).map(p => [p.id, p])); }
    for(const c of catches){ photoSrc(c.photo_path); morePaths(c).forEach(photoSrc); }   // ask for every photo link in one go, so nothing waits later
    loadState = "ready"; saveCache(); applyPrefs(); renderAll();
    loadTournaments();
    if(applyGate()){ routeChannel(); setTimeout(tidyPush, 4000); if(profile && !profile.onboarded) openGuide(); else checkWhatsNew(); }
    if(isStaff()){ loadStaffList(); loadFlags(); loadReports(); }
    loadBlocks(); loadConvos();
    if(pendingDeepLink && accountState() === "ok"){ const h = pendingDeepLink; pendingDeepLink = null; setTimeout(() => openDeepLink(h), 300); }
    loadInbox(); touchActive(); setTimeout(nudgeOfflineRefresh, 4000); listenFriends(); setTimeout(backfillHashes, 4000); setTimeout(backfillWaters, 6000);
    loadAvatars([...follows.map(f => f.user_id), ...friendCatches.map(c => c.user_id)].filter(id => !people[id]));
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
let accessLayer = null;
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
/* Public land shows for every county on screen once you're zoomed in, like the creeks, not only in an opened county.
   (Since tapping water stopped opening the county, public land almost never appeared.) One drawing surface is kept for good;
   when nothing is on it, taps pass straight through to the map. */
var accessGroups = {}, accessOn = new Set(), accessSeq = 0, accessR = null;
function buildAccess(rows){
  accessR ||= L.canvas({ pane:"access", tolerance:2, padding:canvasPad() });
  const g = L.layerGroup(), col = css("--pub");
  for(const [kind, name, extra, rings] of rows){
    const p = L.polygon(rings.map(r => r.map(q => [q[1], q[0]])), { renderer:accessR, color:col, weight: kind === "trout" || kind === "dnre" ? 1.4 : .8, dashArray: kind === "dnre" || kind === "trout" ? "4 3" : null, fillColor:col, fillOpacity: kind === "usfs" || kind === "cf" ? .12 : .26 });
    p.on("click", e => { if(picking){ handlePick(e.latlng); return; } waterTapAt = Date.now(); featureTaps++; L.popup({ maxWidth:280 }).setLatLng(e.latlng).setContent(accessPopup(kind, name, extra)).openOn(map); });
    g.addLayer(p);
  }
  return g;
}
async function syncAccess(){
  if(!accessGroups) return;
  const seq = ++accessSeq;
  const want = new Set(showAccess ? [...(map.getZoom() >= AREA_ZOOM ? areaWant : []), detailFor].filter(Boolean) : []);
  for(const id of [...accessOn]) if(!want.has(id)){ map.removeLayer(accessGroups[id]); accessOn.delete(id); }
  map.getPane("access").style.pointerEvents = accessOn.size ? "" : "none";
  await Promise.all([...want].map(async id => {
    if(accessOn.has(id)) return;
    if(!accessGroups[id]){ let rows; try{ rows = await getJSON(accessCache, dataUrl("access/" + id + ".json"), id); }catch(e){ return; } accessGroups[id] ||= buildAccess(rows); }
    if(seq !== accessSeq || accessOn.has(id)) return;
    accessGroups[id].addTo(map); accessOn.add(id);
  }));
  map.getPane("access").style.pointerEvents = accessOn.size ? "" : "none";
}
function loadAccess(){ syncAccess(); }
function clearAccess(){ setTimeout(syncAccess, 0); }
document.addEventListener("mapsettled", syncAccess);
// once: switch public land back on (it had been turned off on some phones while it wasn't showing anyway)
if(!lsGet("fl.accessReset1", false)){ showAccess = true; lsSet("fl.showAccess", true); lsSet("fl.accessReset1", true); }
$("accessToggle").onclick = () => {
  showAccess = !showAccess; lsSet("fl.showAccess", showAccess);
  $("accessToggle").setAttribute("aria-pressed", showAccess); $("accessToggle").textContent = showAccess ? "Public land on" : "Public land off";
  syncAccess();
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
  if(tripOpen){ const t = trips.find(x => x.id === tripOpen); if(t) return renderTrip(el, t); const g = groupTrips.find(x => x.id === tripOpen); if(g) return renderGroupTrip(el, g); tripOpen = null; }
  const today = todayStr();
  const list = [...trips].sort((a,b) => b.start_date.localeCompare(a.start_date));
  const loose = catches.filter(c => !c.trip_id).length;
  el.innerHTML = `<div class="eyebrow">Trips</div><h2>Your trips</h2>
    <p class="muted" style="margin:4px 0 12px">Catches join a trip automatically when their date falls inside it.</p>
    <div class="row2"><button class="btn ink" type="button" data-a="newtrip">${icon("i-plus")}New trip</button><button class="btn" type="button" data-a="newouting">Log time on the water</button></div>
    ${groupTrips.filter(g => g.my_status === "invited").map(g => `<div class="card reqbox" style="margin-top:12px"><b>${esc(g.owner_name)} invited you on a trip</b><p style="margin:2px 0 8px">${esc(g.name)} · ${esc(fmtRange(g.start_date, g.end_date))}</p>
      <div class="row2"><button class="btn sm ink" type="button" data-gjoin="${esc(g.id)}">Join</button><button class="btn sm" type="button" data-gtrip="${esc(g.id)}">Details</button><button class="link" type="button" data-gdecline="${esc(g.id)}">No thanks</button></div></div>`).join("")}
    <div class="stack" style="margin-top:14px">${list.length ? list.map(t => {
      const s = summarize(tripCatches(t)); const now = t.start_date <= today && today <= t.end_date;
      return `<button class="trip${now?" now":""}" data-trip="${esc(t.id)}" type="button"><small>${now?"Happening now · ":""}${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</small><b>${esc(t.name)}</b>
        <span class="tnums"><span><em>${s.fish}</em> fish</span><span>${daysBetween(t.start_date, t.end_date).length} days</span>${s.big?`<span>Biggest ${lenTxt(s.big.length_in)}</span>`:""}${(t.waters||[]).length?`<span>${t.waters.length} water${t.waters.length===1?"":"s"} planned</span>`:""}${!t.shared?"<span>Private</span>":""}${t._pending?"<span>Waiting to sync</span>":""}</span></button>`; }).join("")
      : groupTrips.some(g => g.my_status === "joined") ? "" : `<div class="empty"><b>No trips yet</b>Make one for your next outing, even a single day. Every catch you log during those dates lands in it, and you get a recap with photos, the best fly, and day-by-day notes.</div>`}</div>
    ${groupTrips.filter(g => g.my_status === "joined").length ? `<h4><span>Trips with friends</span></h4><div class="stack">${groupTrips.filter(g => g.my_status === "joined").map(g => { const now = g.start_date <= today && today <= g.end_date;
      return `<button class="trip${now?" now":""}" data-gtrip="${esc(g.id)}" type="button"><small>${now?"Happening now · ":""}${esc(fmtRange(g.start_date, g.end_date))} · with ${esc(g.owner_name)}</small><b>${esc(g.name)}</b><span class="tnums"><span>${g.people} people</span><span>${daysBetween(g.start_date, g.end_date).length} days</span></span></button>`; }).join("")}</div>` : ""}
    ${(() => { const loneOut = outings.filter(o => !anyTripFor(o.fished_on)).slice(0, 12); return loneOut.length ? `<h4><span>Time on the water</span><span>${fmtHours(outings.reduce((a, o) => a + (+o.hours || 0), 0)) || ""}</span></h4><ul class="list">${loneOut.map(o => `<li><button class="item out" type="button" data-outing="${esc(o.id)}"><span class="th">${icon("i-pin")}</span><span class="t"><b>${fmtHours(o.hours) || "Fished"}${o.water ? ` · ${esc(o.water)}` : ""}</b><small>${esc([fmtDate(o.fished_on), o.county ? countyName(o.county) : ""].filter(Boolean).join(" · "))}</small></span></button></li>`).join("")}</ul>` : ""; })()}
    ${loose && list.length ? `<p class="note">${loose} catch${loose===1?" isn't":"es aren't"} part of a trip. Edit a catch to add it to one.</p>` : ""}`;
}
function renderTrip(el, t){
  const cs = tripCatches(t), s = summarize(cs);
  const days = daysBetween(t.start_date, t.end_date);
  const photos = cs.filter(c => c.photo_path);
  const byDay = {}; cs.forEach(c => (byDay[c.caught_on] ||= []).push(c));
  const counties_ = new Set(cs.map(c => c.county).filter(Boolean));
  const g = tripGroup[t.id], gFish = g ? g.catches.reduce((a, c) => a + fishOf(c), 0) : 0, hrs = tripHours(t);
  if(!g && !tripAsked.has(t.id)){ tripAsked.add(t.id); loadTripGroup(t.id); }
  el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
    <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</div><h2>${esc(t.name)}</h2>
    <div class="stats four"><div class="stat f"><b>${s.fish}</b><span>fish</span></div><div class="stat"><b>${s.species.size}</b><span>species</span></div>
      <div class="stat"><b>${s.big ? lenTxt(s.big.length_in) : "–"}</b><span>biggest</span></div><div class="stat"><b>${days.filter(d => byDay[d]?.some(c=>fishOf(c)>0)).length}/${days.length}</b><span>days with fish</span></div></div>
    ${s.fly ? `<p style="margin:0 0 6px"><b>Best fly:</b> ${esc(s.fly[0])} (${s.fly[1]} fish)</p>` : ""}
    ${counties_.size ? `<p class="muted" style="margin:0 0 8px">${[...counties_].map(countyName).join(", ")}</p>` : ""}
    ${t.notes ? `<p style="margin:6px 0 10px">${esc(t.notes)}</p>` : ""}
    ${hrs.all ? `<p style="margin:0 0 6px"><b>On the water:</b> ${fmtHours(hrs.all)}${s.fish + gFish ? ` · ${((s.fish + gFish) / hrs.all).toFixed(1)} fish per hour` : ""}${gFish ? ` · the group caught ${gFish} more` : ""}</p>` : gFish ? `<p style="margin:0 0 6px">The group caught ${gFish} more fish.</p>` : ""}
    ${tripPeopleHtml(t, true)}
    ${tripPlanHtml(t)}
    ${tripAlbumHtml(t, photos)}
    <div class="row2" style="margin:8px 0 4px">
      <button class="btn sm fish" type="button" data-a="logtrip">${icon("i-fish")}Log a catch</button>
      <button class="btn sm" type="button" data-a="newouting">Time on the water</button>
      <button class="btn sm" type="button" data-a="fittrip">Show on map</button>
      <button class="btn sm" type="button" data-a="edittrip">Edit</button>
      <button class="btn sm" type="button" data-a="deltrip">Delete</button>
    </div><div data-slot></div>
    ${days.map(d => { const list = byDay[d] || []; const gd = groupDayHtml(t, d); const n = list.reduce((a,c)=>a+fishOf(c),0) + gd.fish;
      return `<div class="day"><h5>${esc(fmtDate(d, { weekday:"long", month:"short", day:"numeric" }))}<span>${n} fish</span></h5>
        ${list.length ? `<ul class="list">${list.map(itemCatch).join("")}</ul>` : ""}${gd.html}${!list.length && !gd.any ? `<p class="skunk">${d > todayStr() ? "Still to come" : "No fish logged"}</p>` : ""}</div>`; }).join("")}
    ${(() => { const out = cs.filter(c => !days.includes(c.caught_on)); return out.length ? `<div class="day"><h5>Outside the trip dates<span>${out.length}</span></h5><ul class="list">${out.map(itemCatch).join("")}</ul></div>` : ""; })()}
    <p class="note">${(() => { const crew = (tripGroup[t.id]?.people || []).filter(p => p.status === "joined").length;
      return t.shared ? `Friends can see this trip and the catches in it that aren't private.${crew ? " Everyone on the trip sees the whole group's log." : ""}`
        : crew ? "Only the people on this trip can see it." : "Only you can see this trip. Invite friends and they'll see it too."; })()}</p>`;
}
function openTrip(id){ expandPanel(); tripOpen = id; tab = "trips"; renderLog(); $("log").scrollTop = 0; fitTrip(); }
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
  const t = trips.find(x => x.id === tripOpen) || groupTrips.find(x => x.id === tripOpen);
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
  tInvite = new Set(); renderTripInvites(t);
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
  const rec = { id: tripEditing ? tripEditing.id : uuid(), name, start_date:a, end_date:b, base:$("tBase").value.trim() || null, notes:$("tNotes").value.trim() || null, shared:$("tShared").checked,
    waters: tripEditing ? (tripEditing.waters || []) : (pendingPlanWater ? [pendingPlanWater] : []) };
  if(!tripEditing) pendingPlanWater = null;
  const isNew = !tripEditing;
  try{
    await saveRecord("trips", rec, null, !isNew);
    // pull in catches from these dates that aren't on another trip yet
    const invited = sendTripInvites(rec.id);
    const adopt = catches.filter(c => !c.trip_id && c.caught_on >= a && c.caught_on <= b);
    for(const c of adopt){ await saveRecord("catches", { ...c, trip_id: rec.id }, null, true); }
    closeTripForm();
    toast(adopt.length ? `Trip saved. Added ${adopt.length} catch${adopt.length===1?"":"es"} from those dates.` : "Trip saved");
    invited.then(n => { if(n) toast(`Invited ${n} friend${n === 1 ? "" : "s"}`); });
    openTrip(rec.id);
  }catch(e){ err.textContent = "Couldn't save the trip. Try again."; }
});


/* ---------- trips with friends + time on the water ---------- */
const tripGroup = {}, tripAsked = new Set();                  // trip id -> { people, catches, outings } from the server
async function loadTripGroup(id){
  if(!navigator.onLine) return;
  const { data, error } = await sb.rpc("trip_group", { tid:id });
  if(error || !data || Array.isArray(data) || !data.people) return;
  tripGroup[id] = data; if(tab === "trips" && tripOpen === id) renderLog();
}
const fmtHours = h => { const n = +h; return n ? (Number.isInteger(n) ? n : n.toFixed(1)) + " h" : ""; };
const tripOf = id => trips.find(t => t.id === id) || groupTrips.find(t => t.id === id && t.my_status === "joined");
// my own trip or a joined group trip on that date
function anyTripFor(date){ return tripFor(date) || groupTrips.find(t => t.my_status === "joined" && t.start_date <= date && date <= t.end_date) || null; }

/* people on a trip */
function tripPeopleHtml(t, owner){
  const g = tripGroup[t.id];
  const ppl = g ? g.people : [];
  const joined = ppl.filter(p => p.status !== "invited"), invited = ppl.filter(p => p.status === "invited");
  const canInvite = owner && friendsList().some(f => !ppl.some(p => p.id === f.id));
  if(!g && !owner) return "";
  if(owner && ppl.length <= 1 && !canInvite) return "";
  return `<div class="card tpeople"><b>${joined.length > 1 ? `${joined.length} people on this trip` : "Just you so far"}</b>
    <div class="tpl">${joined.map(p => `<span class="tp">${avHtml(p.id, p.name, "sm", p.avatar)}${esc(p.id === me.id ? "You" : (p.name || "").split(" ")[0])}${p.status === "owner" ? ` <small>organizer</small>` : ""}${owner && p.id !== me.id ? ` <button class="link danger" type="button" data-tremove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ""}</span>`).join("")}
    ${invited.map(p => `<span class="tp inv">${avHtml(p.id, p.name, "sm", p.avatar)}${esc((p.name || "").split(" ")[0])} <small>invited</small>${owner ? ` <button class="link danger" type="button" data-tremove="${esc(p.id)}" aria-label="Cancel invite">×</button>` : ""}</span>`).join("")}</div>
    ${canInvite ? `<button class="btn sm" type="button" data-a="tinvite">Invite friends</button><div data-invslot></div>` : ""}
    ${!owner ? `<button class="link danger" type="button" data-tremove="${esc(me.id)}">Leave this trip</button>` : ""}</div>`;
}
function inviteListHtml(t){
  const ppl = tripGroup[t.id]?.people || [];
  const can = friendsList().filter(f => !ppl.some(p => p.id === f.id));
  return `<div class="chiprow">${can.map(f => `<button type="button" class="chip" data-inv="${esc(f.id)}" aria-pressed="false">${esc(f.name)}</button>`).join("")}</div>
    <button class="btn sm ink" type="button" data-a="tinvitesend">Send invites</button>`;
}

/* the group's catches and time on the water, folded into the trip's days */
function groupDayHtml(t, d){
  const g = tripGroup[t.id]; const mine = outings.filter(o => o.fished_on === d && (o.trip_id === t.id || !o.trip_id));
  const theirs = g ? g.catches.filter(c => c.caught_on === d) : [], tout = g ? g.outings.filter(o => o.fished_on === d) : [];
  const rows = [
    ...mine.map(o => `<li><button class="item out" type="button" data-outing="${esc(o.id)}"><span class="th">${icon("i-pin")}</span><span class="t"><b>${fmtHours(o.hours) || "Fished"}${o.water ? ` · ${esc(o.water)}` : ""}</b><small>${esc(["You", o.notes].filter(Boolean).join(" · "))}</small></span></button></li>`),
    ...tout.map(o => `<li><div class="item out" style="cursor:default"><span class="th">${icon("i-pin")}</span><span class="t"><b>${fmtHours(o.hours) || "Fished"}${o.water ? ` · ${esc(o.water)}` : ""}</b><small>${esc([o.display_name, o.notes].filter(Boolean).join(" · "))}</small></span></div></li>`),
    ...theirs.map(c => `<li><div class="item" style="cursor:default">${thumb(c)}<span class="t"><b>${esc(c.species || "Fish")}${c.length_in ? ` · ${lenTxt(c.length_in)}` : ""}</b><small>${esc([c.display_name, c.water, c.fly].filter(Boolean).join(" · "))}</small></span><span class="num">${fishOf(c) !== 1 ? `<span class="f">×${fishOf(c)}</span>` : ""}</span></div></li>`)];
  return { html: rows.length ? `<ul class="list">${rows.join("")}</ul>` : "", fish: theirs.reduce((a, c) => a + fishOf(c), 0), any: rows.length > 0 };
}
function tripHours(t){
  const g = tripGroup[t.id];
  const mine = outings.filter(o => o.fished_on >= t.start_date && o.fished_on <= t.end_date).reduce((a, o) => a + (+o.hours || 0), 0);
  const theirs = g ? g.outings.reduce((a, o) => a + (+o.hours || 0), 0) : 0;
  return { mine, all: mine + theirs };
}

/* trip someone else organized */
function renderGroupTrip(el, t){
  const g = tripGroup[t.id];
  if(t.my_status === "invited"){
    el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
      <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base ? ` · ${esc(t.base)}` : ""}</div><h2>${esc(t.name)}</h2>
      <p>${esc(t.owner_name)} invited you on this trip.</p>${t.notes ? `<p class="muted">${esc(t.notes)}</p>` : ""}
      <p class="note">If you join, everyone on the trip sees your catches from these dates (never private ones) and your time on the water.</p>
      <div class="row2"><button class="btn ink" type="button" data-gjoin="${esc(t.id)}">Join trip</button><button class="btn" type="button" data-gdecline="${esc(t.id)}">No thanks</button></div>`;
    return;
  }
  const days = daysBetween(t.start_date, t.end_date);
  const mineC = catches.filter(c => days.includes(c.caught_on));
  const all = [...mineC, ...(g ? g.catches : [])], s = summarize(all), hrs = tripHours(t);
  el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
    <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base ? ` · ${esc(t.base)}` : ""} · with ${esc(t.owner_name)}</div><h2>${esc(t.name)}</h2>
    <div class="stats four"><div class="stat f"><b>${s.fish}</b><span>group fish</span></div><div class="stat"><b>${s.species.size}</b><span>species</span></div>
      <div class="stat"><b>${s.big ? lenTxt(s.big.length_in) : "–"}</b><span>biggest</span></div><div class="stat"><b>${hrs.all ? fmtHours(hrs.all) : "–"}</b><span>on the water</span></div></div>
    ${s.fly ? `<p style="margin:0 0 6px"><b>Best fly:</b> ${esc(s.fly[0])} (${s.fly[1]} fish)</p>` : ""}
    ${t.notes ? `<p style="margin:6px 0 10px">${esc(t.notes)}</p>` : ""}
    ${tripPeopleHtml(t, false)}
    <div class="row2" style="margin:8px 0 4px"><button class="btn sm fish" type="button" data-a="logtrip">${icon("i-fish")}Log a catch</button><button class="btn sm" type="button" data-a="newouting">Log time on the water</button></div>
    ${tripAlbumHtml(t, mineC.filter(c => c.photo_path))}
    ${!g ? `<p class="status">Loading the group's catches…</p>` : ""}
    ${days.map(d => { const mine = mineC.filter(c => c.caught_on === d), gd = groupDayHtml(t, d), n = mine.reduce((a, c) => a + fishOf(c), 0) + gd.fish;
      return `<div class="day"><h5>${esc(fmtDate(d, { weekday:"long", month:"short", day:"numeric" }))}<span>${n} fish</span></h5>
        ${mine.length ? `<ul class="list">${mine.map(itemCatch).join("")}</ul>` : ""}${gd.html}${!mine.length && !gd.any ? `<p class="skunk">${d > todayStr() ? "Still to come" : "No fish logged"}</p>` : ""}</div>`; }).join("")}`;
}

/* actions */
let invPick = new Set();
$("log").addEventListener("click", async ev => {
  const e = ev.target;
  const gt = e.closest("[data-gtrip]"); if(gt){ expandPanel(); tripOpen = gt.dataset.gtrip; tab = "trips"; renderLog(); $("log").scrollTop = 0; loadTripGroup(tripOpen); return; }
  const j = e.closest("[data-gjoin]"); if(j){ const { error } = await sb.rpc("trip_respond", { tid:j.dataset.gjoin, accept:true }); if(error){ toast("Couldn't join. Try again."); return; }
    const t = groupTrips.find(x => x.id === j.dataset.gjoin); if(t) t.my_status = "joined"; saveCache(); toast("You're on the trip"); tripOpen = j.dataset.gjoin; renderLog(); loadTripGroup(tripOpen); return; }
  const dc = e.closest("[data-gdecline]"); if(dc){ await sb.rpc("trip_respond", { tid:dc.dataset.gdecline, accept:false }); groupTrips = groupTrips.filter(x => x.id !== dc.dataset.gdecline); saveCache(); tripOpen = null; renderLog(); return; }
  const rm = e.closest("[data-tremove]"); if(rm){
    const uid = rm.dataset.tremove, tid = tripOpen; const self = uid === me.id;
    if(!confirmTap(rm, self ? "Tap again to leave" : "Tap again to remove")) return;
    const { error } = await sb.rpc("trip_remove", { tid, uid }); if(error){ toast("Couldn't do that. Try again."); return; }
    if(self){ groupTrips = groupTrips.filter(x => x.id !== tid); tripOpen = null; saveCache(); toast("You left the trip"); renderLog(); } else loadTripGroup(tid);
    return; }
  const iv = e.closest("[data-inv]"); if(iv){ const id = iv.dataset.inv; invPick.has(id) ? invPick.delete(id) : invPick.add(id); iv.setAttribute("aria-pressed", String(invPick.has(id))); return; }
  const a = e.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "tinvite"){ const t = trips.find(x => x.id === tripOpen); const slot = $("log").querySelector("[data-invslot]"); if(t && slot){ invPick = new Set(); slot.innerHTML = inviteListHtml(t); } }
  if(a.dataset.a === "tinvitesend"){ if(!invPick.size){ toast("Tap the friends to invite."); return; } const tid = tripOpen;
    const { data, error } = await sb.rpc("trip_invite", { tid, uids:[...invPick] }); if(error){ toast("Couldn't send invites. Try again."); return; }
    toast(`Invited ${data} friend${data === 1 ? "" : "s"}`); invPick = new Set(); loadTripGroup(tid); }
  if(a.dataset.a === "newouting"){ const t = tripOf(tripOpen); openOuting(null, t ? (todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date) : null); }
  const o = e.closest("[data-outing]"); if(o){ const r = outings.find(x => x.id === o.dataset.outing); if(r) openOuting(r); }
});
// small "tap twice" guard instead of a browser confirm dialog
function confirmTap(el, label){ if(el.dataset.armed){ return true; } el.dataset.armed = "1"; const old = el.textContent; el.textContent = label; setTimeout(() => { delete el.dataset.armed; el.textContent = old; }, 3000); return false; }
document.addEventListener("click", e => { const o = e.target.closest("[data-outing]"); if(o && !$("log").contains(o)){ const r = outings.find(x => x.id === o.dataset.outing); if(r){ map.closePopup(); openOuting(r); } } });

/* invites chosen while making a trip */
let tInvite = new Set();
function renderTripInvites(t){
  const box = $("tInviteBox"), fr = friendsList();
  box.hidden = !fr.length || (t && t.user_id && t.user_id !== me.id);
  const ppl = t ? (tripGroup[t.id]?.people || []) : [];
  $("tInvite").innerHTML = fr.filter(f => !ppl.some(p => p.id === f.id)).map(f => `<button type="button" class="chip" data-tinv="${esc(f.id)}" aria-pressed="${tInvite.has(f.id)}">${esc(f.name)}</button>`).join("") || `<small class="muted">Everyone's already invited.</small>`;
}
$("tInvite").addEventListener("click", e => { const b = e.target.closest("[data-tinv]"); if(!b) return; const id = b.dataset.tinv; tInvite.has(id) ? tInvite.delete(id) : tInvite.add(id); b.setAttribute("aria-pressed", String(tInvite.has(id))); });
async function sendTripInvites(tid){
  if(!tInvite.size) return 0;
  const ids = [...tInvite]; tInvite = new Set();
  for(let i = 0; i < 20; i++){ if(!outbox.some(j => j.table === "trips" && j.row?.id === tid)) break; await new Promise(r => setTimeout(r, 500)); }   // the trip must reach the server first
  const { data, error } = await sb.rpc("trip_invite", { tid, uids:ids });
  if(error){ toast("Trip saved, but the invites didn't send. Open the trip to try again."); return 0; }
  loadTripGroup(tid); return data || 0;
}

/* time on the water form */
let outEditing = null, outCoords = null;
function openOuting(rec, date){
  if(!canWrite){ toast("Sign in to save."); return; }
  outEditing = rec || null; outCoords = rec && rec.lat != null ? { lat:+rec.lat, lng:+rec.lng } : null;
  $("outTitle").textContent = rec ? "Edit time on the water" : "Time on the water";
  $("oDate").value = rec?.fished_on || date || todayStr(); $("oHours").value = rec?.hours ? String(+rec.hours) : "";
  $("oWater").value = rec?.water || ""; $("oNotes").value = rec?.notes || ""; $("oOnMap").checked = rec ? rec.on_map !== false : true;
  $("oWhere").textContent = outCoords ? "Location saved" : ""; $("outErr").textContent = ""; $("outDel").hidden = !rec;
  $("outScrim").hidden = false;
}
function closeOuting(){ $("outScrim").hidden = true; outEditing = null; }
$("outCancel").onclick = closeOuting;
$("outScrim").addEventListener("click", e => { if(e.target === $("outScrim")) closeOuting(); });
$("oHere").onclick = () => {
  const h = $("oWhere"); h.className = "hint"; h.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(p => {
    outCoords = { lat:p.coords.latitude, lng:p.coords.longitude }; h.className = "hint ok"; h.textContent = "Location saved";
    if(!$("oWater").value.trim()) watersNear(outCoords.lat, outCoords.lng).then(list => { const w = pickWater(list); if(w && !$("oWater").value.trim()) $("oWater").value = w.name; }).catch(() => {});
  }, () => { h.className = "hint bad"; h.textContent = "Couldn't get your location."; }, { enableHighAccuracy:true, timeout:20000, maximumAge:60000 });
};
$("outDel").onclick = () => { if(!outEditing) return; if(!confirmTap($("outDel"), "Tap again to delete")) return; const r = outEditing; closeOuting(); removeRecord("outing", r); };
$("outForm").addEventListener("submit", async ev => {
  ev.preventDefault(); const err = $("outErr"); err.className = "hint bad"; err.textContent = "";
  const d = $("oDate").value, hs = $("oHours").value.trim().replace(",", "."), h = hs ? +hs : null;
  if(!d){ err.textContent = "Pick the day."; return; }
  if(hs && !(h > 0 && h <= 24)){ err.textContent = "Hours should be between 0.5 and 24, like 3 or 2.5."; $("oHours").focus(); return; }
  if(!hs && !$("oWater").value.trim() && !outCoords){ err.textContent = "Add the hours or where you fished."; return; }
  const t = anyTripFor(d);
  const rec = { id: outEditing ? outEditing.id : uuid(), fished_on:d, hours: h ? Math.round(h * 10) / 10 : null, water: capWords($("oWater").value.trim()) || null,
    lat: outCoords ? outCoords.lat : null, lng: outCoords ? outCoords.lng : null, county: outCoords ? countyAt(outCoords.lat, outCoords.lng) : null,
    notes: $("oNotes").value.trim() || null, on_map: $("oOnMap").checked, trip_id: t && trips.some(x => x.id === t.id) ? t.id : null };
  try{ await saveRecord("outings", rec, null, !!outEditing); closeOuting(); toast(t ? `Saved to ${t.name}` : "Time on the water saved"); }
  catch(e){ err.textContent = "Couldn't save. Try again."; }
});

/* places fished on my map */
let showOutings = lsGet("fl.outings", true);
function syncOutToggle(){ const b = $("outToggle"); b.setAttribute("aria-pressed", String(showOutings)); b.textContent = showOutings ? "Places fished on" : "Places fished off"; b.hidden = !outings.some(o => o.lat != null && o.on_map !== false); }
$("outToggle").onclick = () => { showOutings = !showOutings; lsSet("fl.outings", showOutings); renderAll(); };
function outingMarkers(){
  syncOutToggle();
  if(!showOutings || hidePins || mapPerson) return;
  for(const o of outings){
    if(o.lat == null || o.on_map === false) continue;
    const m = L.marker([o.lat, o.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-out" title="Fished">${o.hours ? fmtHours(o.hours).replace(" h", "h") : ""}</div>`, iconSize:[0,0] }), zIndexOffset:100, title:"Fished here" });
    m.bindPopup(() => `<div class="pop"><div class="meta" style="font-weight:700">Fished${o.hours ? ` ${fmtHours(o.hours)}` : ""}</div><h3>${esc(o.water || "Places fished")}</h3><div class="meta">${esc(fmtDate(o.fished_on))}${o.county ? ` · ${esc(countyName(o.county))}` : ""}</div>${o.notes ? `<p style="margin:6px 0">${esc(o.notes)}</p>` : ""}<div class="row"><button class="link" type="button" data-outing="${esc(o.id)}">Edit</button></div></div>`, { maxWidth:280 });
    markerLayer.addLayer(m);
  }
}

/* ---------- trip album: everyone's fish photos plus photos anyone on the trip posts ---------- */
function tripAlbumHtml(t, mineWithPhotos){
  const g = tripGroup[t.id];
  const items = [
    ...mineWithPhotos.map(c => ({ src:photoSrc(c.photo_path), go:"c:" + c.id, label:c.species || "Catch", d:c.caught_on })),
    ...(g ? g.catches.filter(c => c.photo_path).map(c => ({ src:photoSrc(c.photo_path), view:c.photo_path, cap:`${c.display_name}: ${c.species || "Fish"}${c.length_in ? " · " + lenTxt(c.length_in) : ""}`, label:c.species || "Catch", d:c.caught_on })) : []),
    ...(g ? (g.photos || []).map(p => ({ src:photoSrc(p.path), view:p.path, cap:[p.display_name, p.caption].filter(Boolean).join(": "), label:"Trip photo", d:p.taken_on, mine:p.user_id === me.id ? p.id : "" })) : [])
  ].sort((a, b) => (a.d || "").localeCompare(b.d || ""));
  const canPost = !!g && (trips.some(x => x.id === t.id) || t.my_status === "joined");
  if(!items.length && !canPost) return "";
  return `<div class="album">${items.length ? `<div class="strip">${items.map(i => `<button type="button" ${i.go ? `data-go="${esc(i.go)}"` : `data-pview="${esc(i.view)}" data-cap="${esc(i.cap || "")}" data-mine="${esc(i.mine || "")}"`} aria-label="${esc(i.label)} photo" style="background-image:url('${i.src}')"></button>`).join("")}</div>` : ""}
    ${canPost ? `<label class="btn sm" style="margin-top:6px">${icon("i-plus")}Add trip photo<input type="file" accept="image/*" class="vh" data-tphoto="${esc(t.id)}"></label><small class="muted" style="margin-left:8px">Camp, the water, the crew. 3 a day each.</small>` : ""}</div>`;
}
$("log").addEventListener("change", async e => {
  const inp = e.target.closest("[data-tphoto]"); if(!inp || !inp.files[0]) return;
  const tid = inp.dataset.tphoto, t = tripOf(tid) || trips.find(x => x.id === tid), file = inp.files[0]; inp.value = "";
  if(!navigator.onLine){ toast("Trip photos need a connection. Try again when you have signal."); return; }
  toast("Adding photo…");
  try{
    let day = null; try{ const ex = readExif(await file.arrayBuffer()); const m = ex?.date?.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m) day = `${m[1]}-${m[2]}-${m[3]}`; }catch(_){}
    if(!day || day < t.start_date || day > t.end_date) day = todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date;
    const blob = await shrink(file), path = `${me.id}/trip-${tid}-${Date.now()}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType:"image/jpeg" }); if(up.error) throw up.error;
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    const { error } = await sb.from("trip_photos").insert({ id:uuid(), trip_id:tid, path, taken_on:day });
    if(error){ sb.storage.from("photos").remove([path]); toast(/3 trip photos/.test(error.message) ? "You can post 3 trip photos per day." : "Couldn't add the photo. Try again."); return; }
    toast("Photo added to the trip"); loadTripGroup(tid);
  }catch(err){ console.error(err); toast("Couldn't add the photo. Try again."); }
});
// tap a group photo to see it big
$("log").addEventListener("click", e => {
  const b = e.target.closest("[data-pview]"); if(!b) return;
  const v = document.createElement("div"); v.className = "pview"; v.setAttribute("role", "dialog");
  v.innerHTML = `${phImg(b.dataset.pview, 'alt=""')}<div class="pcap">${esc(b.dataset.cap || "")}${b.dataset.mine ? ` <button class="link danger" type="button" data-pdel="${esc(b.dataset.mine)}">Delete my photo</button>` : ""}</div>`;
  v.addEventListener("click", async ev => {
    const d = ev.target.closest("[data-pdel]");
    if(d){ if(!confirmTap(d, "Tap again to delete")) return; const tid = tripOpen; const { error } = await sb.from("trip_photos").delete().eq("id", d.dataset.pdel);
      if(!error) sb.storage.from("photos").remove([b.dataset.pview]); toast(error ? "Couldn't delete it." : "Photo deleted"); v.remove(); loadTripGroup(tid); return; }
    v.remove();
  });
  document.body.appendChild(v);
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
  let { data, error } = await sb.rpc("my_tournaments_v2");
  if(error) ({ data, error } = await sb.rpc("my_tournaments"));   // older database: dates only
  if(!error){ tournaments = data || []; saveCache(); if(tab === "tourney") renderLog(); }
}
/* upcoming -> live (fishing) -> wrapup (fishing over, fish can still be sent in) -> finished (locked) */
function tState(t){
  if(t.starts_at && t.closes_at){ const now = Date.now(); return now < Date.parse(t.starts_at) ? "upcoming" : now <= Date.parse(t.fish_ends_at) ? "live" : now <= Date.parse(t.closes_at) ? "wrapup" : "finished"; }
  const d = todayStr(); return d < t.starts_on ? "upcoming" : d > t.ends_on ? "finished" : "live";
}
const T_STATE = { upcoming:"Upcoming", live:"Happening now", wrapup:"Fishing's over · send in your fish", finished:"Finished" };
const fmtClock = tm => { if(!tm) return ""; const [h, m] = tm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`; };
const fmtWhen = iso => new Date(iso).toLocaleString(undefined, { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZone:"America/Chicago" });
function tDates(t){
  if(!t.start_time && !t.end_time) return fmtRange(t.starts_on, t.ends_on);
  if(t.starts_on === t.ends_on) return `${fmtDate(t.starts_on)}, ${t.start_time ? fmtClock(t.start_time) : "start of day"} to ${t.end_time ? fmtClock(t.end_time) : "end of day"}`;
  return `${fmtDate(t.starts_on)}${t.start_time ? " " + fmtClock(t.start_time) : ""} to ${fmtDate(t.ends_on)}${t.end_time ? " " + fmtClock(t.end_time) : ""}`;
}
// the form's hours -> what the server stores
const tfHours = (st, en) => ({ p_start_time: st || null, p_end_time: en || null });
function tRules(t){
  const bits = [`${tDates(t)}`, t.area_label || (t.counties ? `${t.counties.length} counties` : "Anywhere in Wisconsin"),
    t.species ? (t.species.length > 3 ? `${t.species.length} species` : t.species.join(", ")) : "Any species", t.methods && t.methods.length === 1 && t.methods[0] === "fly" ? "Fly only" : t.methods ? "No fly" : "", SCORING[t.scoring]?.label];
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
  expandPanel(); tourneyOpen = id; tab = "tourney"; renderLog(); $("log").scrollTop = 0;
  const [b, p] = await Promise.all([ sb.rpc("tournament_board", { tid:id }), sb.rpc("tournament_people", { tid:id }) ]);
  tourneyBoard[id] = b.data || []; tourneyPeople[id] = p.data || [];
  loadTourneyFlags(tournaments.find(x => x.id === id));
  if(tourneyOpen === id && tab === "tourney") renderLog();
}
function renderTourneyTab(el){
  if(tourneyOpen){ const t = tournaments.find(x => x.id === tourneyOpen); if(t) return renderTourney(el, t); tourneyOpen = null; }
  const invites = tournaments.filter(t => t.my_status === "invited");
  const mine = tournaments.filter(t => t.my_status === "joined");
  const openOnes = tournaments.filter(t => t.open && !t.my_status && tState(t) !== "finished");
  const card = t => { const s = tState(t); return `<button class="trip${s==="live"?" now":""}" type="button" data-tourney="${esc(t.id)}"><small>${s==="live"?"Happening now":s==="upcoming"?"Starts "+esc(fmtDate(t.starts_on))+(t.start_time?" "+esc(fmtClock(t.start_time)):""):s==="wrapup"?"Send in fish by "+esc(fmtWhen(t.closes_at)):"Finished"} · by ${esc(t.owner_name)}${t.open?" · Open to everyone":""}</small><b>${esc(t.name)}</b>
    <span class="tnums"><span>${esc(tRules(t))}</span></span><span class="tnums"><span>${t.members} angler${t.members===1?"":"s"}</span><span>${t.entries} entr${t.entries===1?"y":"ies"}</span>${t.require_photo?"<span>Photo required</span>":""}</span></button>`; };
  markTourneyNoticesRead();
  el.innerHTML = `<div class="eyebrow">Tournaments</div><h2>Tournaments</h2>${tourneyNoticesHtml()}
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
    <div class="eyebrow">${esc(T_STATE[s])} · by ${esc(t.owner_name)}</div><h2>${esc(t.name)}</h2>
    ${t.description ? `<p style="margin:4px 0 8px">${esc(t.description)}</p>` : ""}
    <div class="card" style="margin:8px 0 4px">
      <p><b>${t.start_time || t.end_time ? "When" : "Dates"}:</b> ${esc(tDates(t))}${t.start_time || t.end_time ? " (Wisconsin time)" : ""}</p>
      ${t.closes_at && s !== "finished" ? `<p><b>Send in fish by:</b> ${esc(fmtWhen(t.closes_at))}${+t.submit_hours ? "" : " (when the fishing ends)"}. After that, entries are locked.</p>` : ""}
      <p><b>Area:</b> ${esc(t.area_label || (t.counties ? t.counties.map(id => byId[id]?.properties.name).filter(Boolean).join(", ") : "Anywhere in Wisconsin"))}</p>
      <p><b>Species:</b> ${esc(t.species ? t.species.join(", ") : "Any")}</p>
      <p><b>Method:</b> ${esc(t.methods ? (t.methods.length === 1 && t.methods[0] === "fly" ? "Fly only" : t.methods.map(m => METHODS[m]).join(", ")) : "Any")}</p>
      <p><b>Scoring:</b> ${esc(SCORING[t.scoring]?.label)}. ${esc(SCORING[t.scoring]?.how)}</p>
      ${t.require_photo ? `<p><b>Photo:</b> Each fish needs a photo taken during the tournament${t.start_time || t.end_time ? "'s hours" : " dates"}. The app checks the date${t.start_time || t.end_time ? " and time" : ""} stamp saved in the photo.</p>` : t.start_time || t.end_time ? `<p class="muted">No photos are required, so the start and end times are on the honor system. A fish logged before the start can't be entered.</p>` : ""}
    </div>
    ${t.my_status === "invited" ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button><button class="btn" type="button" data-tdecline="${esc(t.id)}">No thanks</button></div>` : ""}
    ${!t.my_status && t.open ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button></div>` : ""}
    <h4><span>${s === "finished" ? "Final standings" : "Standings"}</span><span>${SCORING[t.scoring]?.label}</span></h4>
    ${!board ? `<p class="status">Loading standings…</p>` : board.length ? `<div class="board"><ol>${board.map((r,i) => `<li class="${r.id===me?.id?"me":""}"><span class="r">${i+1}</span><span>${i===0&&s==="finished"?`<span class="pill open">Winner</span> `:""}${esc(r.name)}<small>${esc(r.sub)}</small></span><span class="v">${esc(r.txt)}</span></li>`).join("")}</ol></div>` : `<p class="muted">No entries yet.</p>`}
    ${rows && rows.length ? `<h4><span>Entries</span><span>${rows.length}</span></h4><div class="strip">${rows.filter(r => r.photo_path).map(r => `<button type="button" title="${esc(r.display_name)}: ${esc(r.species||"")} ${r.length_in?lenTxt(r.length_in):""}" style="background-image:url('${photoSrc(r.photo_path)}')" data-tphoto="${esc(r.catch_id)}"></button>`).join("")}</div>
      <ul class="list">${rows.slice().sort((a,b)=>(b.caught_on||"").localeCompare(a.caught_on||"")).map(r => `<li class="item" style="cursor:default">${thumb(r)}<span class="t"><b>${esc(r.species||"Fish")}${r.length_in?` · ${lenTxt(r.length_in)}`:""}</b><small>${esc(r.display_name)} · ${esc(fmtDate(r.caught_on))} · ${esc(countyName(r.county))}${entryFlagHtml(t.id, r.catch_id)}</small></span><span class="num" data-rmslot>${r.user_id===me?.id && s!=="finished"?`<button class="link danger" type="button" data-twithdraw="${esc(r.catch_id)}">Remove</button>`:isOwner?`<button class="link danger" type="button" data-townerrm="${esc(r.catch_id)}">Remove</button>`:""}</span></li>`).join("")}</ul>` : ""}
    ${joined && s !== "finished" ? `<h4><span>Your catches during these dates</span></h4>${myCatches.length ? `<ul class="list">${myCatches.map(c => `<li class="item" style="cursor:default">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}</b><small>${esc(fmtDate(c.caught_on))}${c.photo_taken_on?"":" · photo has no date"}</small></span><span class="num">${entered.has(c.id)?`<span class="pill fished">Entered</span>`:`<button class="btn sm" type="button" data-tenter="${esc(c.id)}">Enter</button>`}</span></li>`).join("")}</ul><span class="hint" id="tenterMsg" role="alert"></span>` : `<p class="muted">Nothing logged during the tournament yet. Catches that fit the rules are entered when you log them.</p>`}` : ""}
    <h4><span>Anglers</span><span>${ppl.filter(p => p.status === "joined").length}</span></h4>
    <p style="margin:0">${ppl.map(p => `<span class="pill${p.status==="joined"?"":" priv"}" style="margin:0 4px 4px 0">${esc(p.display_name)}${p.status==="invited"?" (invited)":""}</span>`).join("") || `<span class="muted">Loading…</span>`}</p>
    ${joined && s !== "finished" ? `<div class="row2" style="margin-top:10px"><button class="btn sm" type="button" data-a="tinvite">Invite friends</button></div><div data-invite></div>` : ""}
    ${tourneyToolsHtml(t)}
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
  $("tfStartTime").value = ""; $("tfEndTime").value = ""; $("tfSubmit").value = "24"; $("tfTimes").open = false;
  $("tfArea").value = "any"; tfCounties = new Set(); renderCountyPick();
  $("tfSpecies").value = "any"; $("tfScoring").value = "biggest"; $("tfPhoto").checked = true;
  $("tfOpenRow").hidden = !(profile?.role === "creator" || profile?.verified); $("tfOpen").checked = false; $("tfMethod").value = "any";
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
  const st = $("tfStartTime").value, en = $("tfEndTime").value;
  if(a === b && st && en && en <= st){ err.textContent = "The end time has to be after the start time."; $("tfTimes").open = true; return; }
  let ids = null, label = null;
  if(area === "pick"){ if(!tfCounties.size){ err.textContent = "Pick at least one county, or choose Anywhere."; return; } ids = [...tfCounties]; label = ids.length <= 3 ? ids.map(id => byId[id].properties.name).join(", ") + (ids.length === 1 ? " County" : " counties") : `${ids.length} counties`; }
  else if(area !== "any"){ ids = REGION_COUNTIES[area].map(n => idByName[n]).filter(Boolean); label = area; }
  const sp = $("tfSpecies").value;
  const species = sp === "any" ? null : sp === "trout" ? TROUT_SPECIES : sp === "bass" ? BASS : sp === "panfish" ? PANFISH : [sp];
  const mt = $("tfMethod").value, methods = mt === "fly" ? ["fly"] : mt === "nofly" ? ["spin","baitcast","ice","trolling","other"] : null;
  const invite = [...$("tfInvite").querySelectorAll("input:checked")].map(i => i.value);
  const btn = $("tfSave"); btn.disabled = true;
  const args = { p_name:name, p_description:$("tfDesc").value.trim() || null, p_starts:a, p_ends:b, p_counties:ids, p_area_label:label,
    p_species:species, p_scoring:$("tfScoring").value, p_require_photo:$("tfPhoto").checked, p_open:$("tfOpen").checked, p_invite:invite, p_methods:methods };
  const { data, error } = await sb.rpc("create_tournament_v2", { ...args, ...tfHours(st, en), p_submit_hours:+$("tfSubmit").value });
  btn.disabled = false;
  if(error){ err.textContent = /open tournaments|approval|end time/.test(error.message) ? error.message : "Couldn't create the tournament. Check your connection and try again."; return; }
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
  loadAvatars(findResults.map(p => p.id).filter(id => !(id in avatars)));
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
  const mine = catches.map(c => ({ ...c, before_join: beforeJoin(c), user_id: me.id, display_name: profile?.display_name || "You" }));   // decided before the name is added: beforeJoin tells mine from friends' by the missing name
  return [...mine, ...friendCatches.filter(c => c.rel !== "following")];
}
function leaderboards(p){
  const all = everyone().filter(c => inPeriod(c.caught_on, p) && fishOf(c) > 0 && !beforeJoin(c));
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
  const views = [["feed","Feed"],["people","Friends"],["messages","Messages"],["board","Leaderboard"],["forums","Forums"],["find","Find anglers"]];
  let body = "";
  if(friendsView === "feed"){
    const posts = friendCatches.slice(0, 40);
    body = posts.length ? `<div class="feed">${posts.map(c => { return `<article class="post">${photoGallery(c, "ph")}
      <div class="pb"><button type="button" class="who" data-person="${esc(c.user_id)}">${avHtml(c.user_id, c.display_name, "sm")}${esc(c.display_name)}${titlePill(c.user_id)}</button>${c.rel === "following" ? ` <span class="pill">Following</span>` : ""}<div class="what">${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</div>
      <small>${esc([fmtDate(c.caught_on), c.fly, countyName(c.county)].filter(Boolean).join(" · "))}</small>${c.trip_name?`<small>Trip: ${esc(c.trip_name)}</small>`:""}
      <div class="row2" style="margin-top:6px">${profile?.role === "creator" ? `<button class="link danger" type="button" data-hide="${esc(c.id)}">Hide from feeds</button>` : ""}${c.lat!=null?`<button class="link" type="button" data-go="f:${esc(c.id)}">Show on map</button>`:c.county?`<button class="link" type="button" data-county="${esc(c.county)}">Open ${esc(byId[c.county]?.properties.name || "")} County</button>`:""}</div></div></article>`; }).join("")}</div>`
      : `<div class="empty"><b>${accepted.length || follows.length ? "No shared catches yet" : "Add your fishing friends"}</b>${accepted.length || follows.length ? "When friends and anglers you follow log catches they share, they show up here." : "Tap Friends above to add people by friend code or name, or follow anglers from Find anglers. Their shared catches show up here and on the map."}</div>`;
    if(announcements.length) body = announcements.slice(0, 2).map(a => `<div class="card notice" style="margin-bottom:10px"><p class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">From the founder · ${esc(fmtDate(a.created_at.slice(0,10)))}</p><p>${esc(a.body)}</p></div>`).join("") + body;
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
    body = `<h4><span>Friends</span><span>${accepted.length}</span></h4>
      ${accepted.length ? `<ul class="list">${accepted.map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default"><span data-person="${esc(f.requester === me.id ? f.addressee : f.requester)}" class="pjump">${avHtml((f.requester === me.id ? f.addressee : f.requester), other(f).display_name)}</span><span class="t pjump" data-person="${esc(f.requester === me.id ? f.addressee : f.requester)}"><b>${esc(other(f).display_name)}${titlePill((f.requester === me.id ? f.addressee : f.requester))}</b><small>${friendCatches.filter(c => c.user_id === (f.requester === me.id ? f.addressee : f.requester)).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><span data-slot-${esc(f.id)} class="row2" style="margin:0;flex-wrap:nowrap"><button class="btn sm" type="button" data-pmap="${esc((f.requester === me.id ? f.addressee : f.requester))}">Map</button><button class="btn sm" type="button" data-chat="${esc((f.requester === me.id ? f.addressee : f.requester))}">Message</button><button class="link danger" type="button" data-unfriend="${esc(f.id)}">Remove</button></span></li>`).join("")}</ul>` : `<p class="muted">No friends added yet.</p>`}
      <h4><span>Following</span><span>${follows.filter(f => f.direction === "following").length}</span></h4>
      ${follows.some(f => f.direction === "following") ? `<ul class="list">${follows.filter(f => f.direction === "following").map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default"><span data-person="${esc(f.user_id)}" class="pjump">${avHtml(f.user_id, f.display_name)}</span><span class="t pjump" data-person="${esc(f.user_id)}"><b>${esc(f.display_name)}</b><small>${friendCatches.filter(c => c.user_id === f.user_id).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><span class="row2" style="margin:0;flex-wrap:nowrap"><button class="btn sm" type="button" data-pmap="${esc(f.user_id)}">Map</button><button class="link" type="button" data-unfollow="${esc(f.user_id)}">Unfollow</button></span></li>`).join("")}</ul>` : `<p class="muted">You aren't following anyone. Use Find anglers to follow people with public profiles.</p>`}
      <p class="muted" style="margin-top:10px">${follows.filter(f => f.direction === "follower").length} follower${follows.filter(f => f.direction === "follower").length===1?"":"s"}${profile?.is_public ? "" : ". Turn on a public profile in the Me tab to let people follow you."}</p>
      ${outgoing.length ? `<h4><span>Waiting on</span></h4><ul class="list">${outgoing.map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(f.addressee, other(f).display_name)}<span class="t"><b>${esc(other(f).display_name)}</b><small>Request sent</small></span><button class="link" type="button" data-decline="${esc(f.id)}">Cancel</button></li>`).join("")}</ul>` : ""}`;
  }
  if(friendsView === "messages") body = messagesHtml();
  if(friendsView === "forums") body = forumsHtml();
  if(friendsView === "find"){
    body = `<form id="findForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="findQ" placeholder="Search anglers by name" aria-label="Search anglers by name" value="${esc(findQ)}"><button class="btn" type="submit">Search</button></form>
      <p class="muted" style="margin:6px 0 10px">Follow anglers with public profiles to see the catches they share. Unlike friends, following doesn't need their OK, and they don't see your catches.</p>
      <div id="findResults">${findResults ? (findResults.length ? `<ul class="list">${findResults.map(p => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(p.id, p.display_name)}<span class="t"><b class="wrap">${esc(p.display_name)}${titlePill(p.id)}${p.featured?` <span class="pill open">Featured</span>`:""}</b><small>${p.followers} follower${p.followers===1?"":"s"} · ${p.fish} shared fish${p.bio?` · ${esc(p.bio)}`:""}</small></span><span class="row2">${profile?.role==="creator"?`<button class="link" type="button" data-feature="${esc(p.id)}" data-on="${p.featured?"0":"1"}">${p.featured?"Unfeature":"Feature"}</button>`:""}<button class="btn sm ${p.following?"":"ink"}" type="button" data-${p.following?"unfollow":"follow"}="${esc(p.id)}">${p.following?"Following":"Follow"}</button></span></li>`).join("")}</ul>` : `<p class="muted">No public anglers match that name.</p>`) : `<p class="status">Loading anglers…</p>`}</div>`;
    if(!findResults) searchAnglers(findQ);
  }
  const social = friendsView === "messages" || friendsView === "forums";
  el.innerHTML = `<div class="eyebrow">Friends</div><h2>${friendsView === "forums" ? "Forums" : friendsView === "messages" ? "Messages" : "Fishing friends"}</h2>
    ${requestsBannerHtml()}
    <div class="yearsel subnav" style="margin-top:6px">${views.map(([k,l]) => `<button type="button" data-fview="${k}" aria-pressed="${friendsView===k}">${l}${k==="people"&&incoming.length?` (${incoming.length})`:""}${k==="messages"&&unreadTotal?` (${unreadTotal})`:""}</button>`).join("")}</div>
    <div style="margin-top:10px">${friendsView !== "people" ? "" : `<div class="code" style="margin:4px 0 12px"><span>Your friend code</span><b>${esc(profile?.friend_code || "······")}</b><button class="btn sm" type="button" data-a="sharecode">Share</button></div>
    <form id="addFriendForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="friendCode" placeholder="Friend's code" autocapitalize="characters" maxlength="8" aria-label="Friend's code" style="font-family:var(--f-data);letter-spacing:.12em"><button class="btn ink" type="submit">Add</button></form>
    <span class="hint" id="friendMsg" role="alert"></span>
    <form id="nameSearchForm" class="row2" novalidate style="flex-wrap:nowrap;margin-top:8px"><input id="nameQ" type="search" placeholder="Or search by name or @username" aria-label="Search anglers by name or username" value="${esc(nameQ)}" autocomplete="off"><button class="btn" type="submit">Search</button></form>
    ${nameResultsHtml()}
    <label class="check" style="margin-top:10px"><input type="checkbox" id="showFriendsBox" ${showFriends?"checked":""}> Show friends' catches on the map</label>`}${body}</div>`;
  if($("addFriendForm")) $("addFriendForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("friendMsg"); msg.className = "hint"; msg.textContent = "Sending…";
    try{ const n = await addFriend($("friendCode").value); msg.className = "hint ok"; msg.textContent = `Request sent to ${n}. They'll see it in their Friends tab.`; $("friendCode").value = ""; }
    catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Couldn't add that friend."; }
  });
  if($("nameSearchForm")) $("nameSearchForm").addEventListener("submit", e => { e.preventDefault(); searchPeople($("nameQ").value); });
  if($("findForm")) $("findForm").addEventListener("submit", e => { e.preventDefault(); findQ = $("findQ").value.trim(); findResults = null; renderLog(); });
  if($("showFriendsBox")) $("showFriendsBox").addEventListener("change", e => { showFriends = e.target.checked; lsSet("fl.showFriends", showFriends); renderAll(); });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const fv = t.closest("[data-fview]"); if(fv){ friendsView = fv.dataset.fview; if(friendsView === "messages"){ chatWith = null; chatOpenFor = null; convos = null; } if(friendsView === "forums"){ forumThread = null; forumNew = false; forumThreads = null; } renderLog(); return; }
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
  const text = `Add me on Coulee, the Wisconsin fly fishing app. My friend code is ${profile?.friend_code}. Open ${url} on your phone and create an account. Once you're approved, enter the code in the Friends tab.`;
  if(navigator.share){ try{ await navigator.share({ title:"Coulee", text, url }); return; }catch(e){ if(e.name === "AbortError") return; } }
  try{ await navigator.clipboard.writeText(text); toast("Invite copied. Paste it into a text to a friend."); }
  catch(e){ toast(`Your code is ${profile?.friend_code}`); }
}

/* ---------- find anglers by name to add as friends ---------- */
let nameQ = "", nameResults = null, nameBusy = false;
async function searchPeople(q){
  nameQ = (q || "").trim();
  if(nameQ.length < 2){ nameResults = nameQ ? "short" : null; renderLog(); return; }
  nameBusy = true; renderLog();
  const { data, error } = await sb.rpc("search_people", { q:nameQ });
  nameBusy = false; nameResults = error ? "error" : (data || []);
  if(Array.isArray(nameResults)) nameResults.forEach(p => { avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; });
  renderLog(); setTimeout(() => $("nameResults")?.scrollIntoView({ block:"nearest", behavior:"smooth" }), 50);
}
function nameResultsHtml(){
  if(nameBusy) return `<p class="status" id="nameResults">Searching…</p>`;
  if(nameResults === null) return "";
  if(nameResults === "short") return `<p class="hint" id="nameResults">Type at least 2 letters.</p>`;
  if(nameResults === "error") return `<p class="hint bad" id="nameResults">Couldn't search right now. Try again.</p>`;
  const rel = p => p.relation === "friend" ? `<span class="pill fished">Friends</span>` : p.relation === "sent" ? `<span class="pill">Request sent</span>`
    : p.relation === "received" ? `<button class="btn sm ink" type="button" data-fview="people">Respond</button>` : `<button class="btn sm ink" type="button" data-addid="${esc(p.id)}">Add friend</button>`;
  return `<div id="nameResults" style="margin-top:8px">${nameResults.length ? `<ul class="list">${nameResults.map(p => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(p.id, p.display_name, "", p.avatar_path)}
      <span class="t"><b class="wrap">${esc(p.display_name)}${p.title ? ` <span class="pill ttl">${esc(p.title)}</span>` : ""}</b><small>${esc([p.username ? "@" + p.username : "", +p.mutual ? `${p.mutual} mutual friend${+p.mutual === 1 ? "" : "s"}` : p.username ? "" : "Coulee angler"].filter(Boolean).join(" · "))}</small></span>
      <span class="num">${rel(p)}</span></li>`).join("")}</ul>` : `<p class="muted">No anglers found for "${esc(nameQ)}". Check the spelling, or ask for their @username or friend code.</p>`}
    <button class="link" type="button" data-nameclear>Clear search</button></div>`;
}
$("log").addEventListener("click", async e => {
  if(e.target.closest("[data-nameclear]")){ nameQ = ""; nameResults = null; renderLog(); return; }
  const b = e.target.closest("[data-addid]"); if(!b) return;
  b.disabled = true;
  const p = Array.isArray(nameResults) && nameResults.find(x => x.id === b.dataset.addid);
  const ins = await sb.from("friendships").insert({ addressee:b.dataset.addid });
  if(ins.error && ins.error.code !== "23505"){ toast("Couldn't send the request. Try again."); b.disabled = false; return; }
  if(p) p.relation = "sent";
  toast(`Friend request sent${p ? ` to ${p.display_name}` : ""}. They'll see it in their Friends tab.`);
  await loadAll(); renderLog();
});

/* ---------- friend requests show up quickly: check every 30 s while the app is open ---------- */
const friendKey = list => (list || []).map(f => f.id + f.status).sort().join(",");
let friendPollBusy = false;
async function pollFriends(){
  if(friendPollBusy || !me || !navigator.onLine || document.visibilityState !== "visible" || accountState() !== "ok") return;
  friendPollBusy = true;
  try{
    const { data, error } = await sb.from("friendships").select("id, status");
    if(!error && friendKey(data) !== friendKey(friendships)){
      const before = new Set(friendships.filter(f => f.status === "pending" && f.addressee === me.id).map(f => f.id));
      await loadAll();
      const fresh = friendships.filter(f => f.status === "pending" && f.addressee === me.id && !before.has(f.id));
      if(fresh.length) toast(`${people[fresh[0].requester]?.display_name || "Someone"} sent you a friend request. Open Friends to accept.`);
    }
  }catch(e){}
  friendPollBusy = false;
}
setInterval(pollFriends, 30000);

/* requests sit at the top of the Friends tab, whatever view is open */
function requestsBannerHtml(){
  const incoming = friendships.filter(f => f.status === "pending" && f.addressee === me?.id);
  if(!incoming.length) return "";
  const nm = f => people[f.requester]?.display_name || "Someone";
  return `<div class="reqbox"><div class="reqhead">${incoming.length === 1 ? "Friend request" : `${incoming.length} friend requests`}</div>
    ${incoming.map(f => `<div class="reqrow">${avHtml(f.requester, nm(f))}<span class="t"><b class="wrap">${esc(nm(f))}</b><small>Wants to be fishing friends</small></span>
      <span class="row2" style="margin:0;flex-wrap:nowrap"><button class="btn sm ink" type="button" data-accept="${esc(f.id)}">Accept</button><button class="btn sm" type="button" data-decline="${esc(f.id)}">Decline</button></span></div>`).join("")}</div>`;
}

/* ---------- live: a friend request (or an accept) shows up within a second or two while the app is open ---------- */
let friendLive = null;
function listenFriends(){
  if(friendLive || !me || typeof sb.channel !== "function") return;
  try{
    const kick = () => setTimeout(pollFriends, 300);
    friendLive = sb.channel("friends-" + me.id)
      .on("postgres_changes", { event:"*", schema:"public", table:"friendships", filter:`addressee=eq.${me.id}` }, kick)
      .on("postgres_changes", { event:"*", schema:"public", table:"friendships", filter:`requester=eq.${me.id}` }, kick)
      .subscribe();
  }catch(e){ friendLive = null; }
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") pollFriends(); });


/* ---------- stats ---------- */
let statYear = lsGet("fl.statYear", "all");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function renderStatsTab(el){
  const years = [...new Set(catches.map(c => (c.caught_on||"").slice(0,4)).filter(Boolean))].sort().reverse();
  if(statYear !== "all" && !years.includes(statYear)) statYear = "all";
  const inYear = catches.filter(c => statYear === "all" || (c.caught_on||"").startsWith(statYear));
  const cs = inYear.filter(matchStatF);
  const withFish = cs.filter(c => fishOf(c) > 0);
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const days = new Set(cs.map(c=>c.caught_on)).size;
  const species = {}; const flies = {}; const months = Array(12).fill(0); const flyMonth = {};
  for(const c of withFish){
    const n = fishOf(c), m = +(c.caught_on||"0000-01").slice(5,7) - 1; months[m] += n;
    const spn = sentenceCase(c.species);
    if(spn){ const s = species[spn] ||= { n:0, big:null }; s.n += n; if(c.length_in != null && (!s.big || +c.length_in > +s.big.length_in)) s.big = c; }
    const fly = capWords(c.fly);   // "Copper john" and "Copper John" are one fly
    if(fly){ const f = flies[fly] ||= { n:0, months:Array(12).fill(0) }; f.n += n; f.months[m] += n; (flyMonth[m] ||= {})[fly] = ((flyMonth[m] ||= {})[fly] || 0) + n; }
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
    ${statFilterHtml(inYear)}
    <div class="stats four"><div class="stat f"><b>${fish}</b><span>fish</span></div><div class="stat"><b>${days}</b><span>days fished</span></div><div class="stat"><b>${sp.length}</b><span>species</span></div><div class="stat"><b>${tripCount}</b><span>trips</span></div></div>
    ${cs.length ? `<h4><span>Fish by month</span></h4>${chart}
    <h4><span>Species</span></h4><table class="tbl"><thead><tr><th>Species</th><th class="n">Fish</th><th class="n">Biggest</th></tr></thead><tbody>${sp.map(([k,v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.big ? lenTxt(v.big.length_in) : "–"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Add species to your catches to see them here.</td></tr>`}</tbody></table>
    ${(() => { const wt = {}; withFish.forEach(c => { if(c.water){ const k = c.water.toLowerCase(); (wt[k] ||= { name:c.water, n:0, days:new Set(), big:null }); wt[k].n += fishOf(c); wt[k].days.add(c.caught_on); if(c.length_in != null && (!wt[k].big || +c.length_in > +wt[k].big)) wt[k].big = +c.length_in; } });
      const rows = Object.entries(wt).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
      return rows.length ? `<h4><span>Best water</span></h4><table class="tbl"><thead><tr><th>Creek or lake</th><th class="n">Fish</th><th class="n">Days</th><th class="n">Biggest</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td><button class="link" type="button" data-sfwater="${esc(k)}">${esc(v.name)}</button></td><td class="n">${v.n}</td><td class="n">${v.days.size}</td><td class="n">${v.big != null ? lenTxt(v.big) : "–"}</td></tr>`).join("")}</tbody></table>` : ""; })()}
    ${titlesHtml()}
    <h4><span>${cs.some(c => c.method && c.method !== "fly") ? "Flies and lures that worked" : "Flies that worked"}</span></h4><table class="tbl"><thead><tr><th>Fly or lure</th><th class="n">Fish</th><th class="n">Best month</th></tr></thead><tbody>${fl.map(([k,v]) => { const bm = v.months.indexOf(Math.max(...v.months)); return `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${MON[bm]}</td></tr>`; }).join("") || `<tr><td colspan="3" class="muted">Add the fly to your catches to see what works.</td></tr>`}</tbody></table>
    ${bestByMonth.length ? `<h4><span>Best fly each month</span></h4><ul class="list">${bestByMonth.map(([m, [f, n]]) => `<li class="item" style="grid-template-columns:44px 1fr auto;cursor:default"><span class="muted" style="font-weight:700">${MON[m]}</span><span class="t"><b>${esc(f)}</b></span><span class="num">${n} fish</span></li>`).join("")}</ul>` : ""}
    ${statCatchListHtml(cs)}
    ${statFActive() ? "" : `<h4><span>Spots</span></h4><p style="margin:0"><span class="pill want">${st.want} want to try</span> <span class="pill scouted">${st.scouted} scouted</span> <span class="pill fished">${st.fished} fished</span></p>`}`
    : catches.length ? `<div class="empty"><b>No catches match</b>Try a different year, or clear the filters.</div>` : `${titlesHtml()}<div class="empty"><b>Nothing to count yet</b>Log a few catches with the species, length and fly, and this page fills in with your best months and flies.</div>`}`;
  restoreStatFocus();
}
$("log").addEventListener("click", ev => { const y = ev.target.closest("[data-year]"); if(y){ statYear = y.dataset.year; lsSet("fl.statYear", statYear); statShown = 50; renderLog(); } });

/* ---------- filter your catches ---------- */
const STATF0 = { q:"", species:"", method:"", county:"", water:"", trip:"", photo:"", minLen:"", sort:"new" };
let statF = { ...STATF0, ...lsGet("fl.statF", {}) }, statShown = 50, statFOpen = false, statFocus = null;
const SP_GROUPS = { "group:trout":["Brook trout","Brown trout","Rainbow trout","Tiger trout","Steelhead","Lake trout","Splake"], "group:bass":["Smallmouth bass","Largemouth bass"],
  "group:panfish":["Bluegill","Pumpkinseed","Crappie","Black crappie","White crappie","Yellow perch","Rock bass","Sunfish","Green sunfish"] };
const statFActive = () => ["q","species","method","county","water","trip","photo","minLen"].some(k => statF[k]);
function matchStatF(c){
  const f = statF, sp = (c.species || "").toLowerCase();
  if(f.species){ if(f.species === "none"){ if(sp) return false; }
    else if(SP_GROUPS[f.species]){ if(!SP_GROUPS[f.species].some(s => s.toLowerCase() === sp)) return false; }
    else if(sp !== f.species) return false; }
  if(f.method && (c.method || "fly") !== f.method) return false;
  if(f.county){ if(f.county === "out"){ if(c.county) return false; } else if(c.county !== f.county) return false; }
  if(f.water && (c.water || "").toLowerCase() !== f.water) return false;
  if(f.trip){ if(f.trip === "none"){ if(c.trip_id) return false; } else if(c.trip_id !== f.trip) return false; }
  if(f.photo === "yes" && !c.photo_path) return false;
  if(f.photo === "no" && c.photo_path) return false;
  if(f.minLen && !(+c.length_in >= +f.minLen)) return false;
  if(f.q){ const hay = [c.species, c.water, c.fly, c.notes, c.county ? countyName(c.county) : "", METHODS[c.method || "fly"], trips.find(t => t.id === c.trip_id)?.name].join(" ").toLowerCase();
    if(!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false; }
  return true;
}
function statFilterHtml(pool){
  const spMap = {}; pool.forEach(c => { const k = (c.species || "").toLowerCase(); if(k && !spMap[k]) spMap[k] = c.species; });
  const sps = Object.entries(spMap).sort((a, b) => a[1].localeCompare(b[1]));
  const methods = [...new Set(pool.map(c => c.method || "fly"))];
  const cids = [...new Set(pool.map(c => c.county).filter(Boolean))].sort((a, b) => countyName(a).localeCompare(countyName(b)));
  const wMap = {}; pool.forEach(c => { const k = (c.water || "").toLowerCase(); if(k && !wMap[k]) wMap[k] = c.water; });
  const ws = Object.entries(wMap).sort((a, b) => a[1].localeCompare(b[1]));
  const tr = trips.filter(t => pool.some(c => c.trip_id === t.id)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
  const chips = [];
  if(statF.q) chips.push(["q", `"${statF.q}"`]);
  if(statF.species) chips.push(["species", { "group:trout":"All trout", "group:bass":"All bass", "group:panfish":"All panfish", none:"No species" }[statF.species] || spMap[statF.species] || statF.species]);
  if(statF.method) chips.push(["method", METHODS[statF.method]]);
  if(statF.county) chips.push(["county", statF.county === "out" ? "Outside Wisconsin" : countyName(statF.county)]);
  if(statF.water) chips.push(["water", wMap[statF.water] || statF.water]);
  if(statF.trip) chips.push(["trip", statF.trip === "none" ? "Not on a trip" : (trips.find(t => t.id === statF.trip)?.name || "Trip")]);
  if(statF.photo) chips.push(["photo", statF.photo === "yes" ? "With photo" : "No photo"]);
  if(statF.minLen) chips.push(["minLen", `${statF.minLen}"+`]);
  return `<div class="statf">
    <div class="row2" style="flex-wrap:nowrap"><input id="sfQ" type="search" placeholder="Search creek, fly, notes…" aria-label="Search your catches" value="${esc(statF.q)}" autocomplete="off">
      <button class="btn sm${statFOpen || statFActive() ? " ink" : ""}" type="button" data-sf="toggle" aria-expanded="${statFOpen}">Filters${chips.filter(c => c[0] !== "q").length ? ` (${chips.filter(c => c[0] !== "q").length})` : ""}</button></div>
    ${statFOpen ? `<div class="sfgrid">
      <div class="field"><label for="sfSpecies">Species</label><select id="sfSpecies" data-sfk="species">${opt("", "All species", statF.species)}${opt("group:trout", "All trout", statF.species)}${opt("group:bass", "All bass", statF.species)}${opt("group:panfish", "All panfish", statF.species)}${sps.map(([k, l]) => opt(k, l, statF.species)).join("")}${opt("none", "No species", statF.species)}</select></div>
      <div class="field"><label for="sfMethod">Method</label><select id="sfMethod" data-sfk="method">${opt("", "Any method", statF.method)}${Object.entries(METHODS).filter(([k]) => methods.includes(k) || statF.method === k).map(([k, l]) => opt(k, l, statF.method)).join("")}</select></div>
      <div class="field"><label for="sfCounty">Where</label><select id="sfCounty" data-sfk="county">${opt("", "Anywhere", statF.county)}${cids.map(id => opt(id, countyName(id), statF.county)).join("")}${opt("out", "Outside Wisconsin", statF.county)}</select></div>
      <div class="field"><label for="sfWater">Water</label><select id="sfWater" data-sfk="water">${opt("", "Any water", statF.water)}${ws.map(([k, l]) => opt(k, l, statF.water)).join("")}</select></div>
      <div class="field"><label for="sfTrip">Trip</label><select id="sfTrip" data-sfk="trip">${opt("", "Any trip", statF.trip)}${tr.map(t => opt(t.id, t.name, statF.trip)).join("")}${opt("none", "Not on a trip", statF.trip)}</select></div>
      <div class="field"><label for="sfPhoto">Photo</label><select id="sfPhoto" data-sfk="photo">${opt("", "Any", statF.photo)}${opt("yes", "With photo", statF.photo)}${opt("no", "No photo", statF.photo)}</select></div>
      <div class="field"><label for="sfLen">At least (in)</label><select id="sfLen" data-sfk="minLen">${opt("", "Any length", statF.minLen)}${["10","12","14","16","18","20","24","30","40"].map(v => opt(v, v + " in", statF.minLen)).join("")}</select></div>
    </div>` : ""}
    ${chips.length ? `<div class="sfchips">${chips.map(([k, l]) => `<button type="button" class="pill" data-sfx="${k}" aria-label="Remove filter ${esc(l)}">${esc(l)} ×</button>`).join("")}<button type="button" class="link" data-sf="clear">Clear all</button></div>` : ""}
  </div>`;
}
function statCatchListHtml(cs){
  const sorters = { new:byDateDesc, old:(a, b) => -byDateDesc(a, b), long:(a, b) => (+b.length_in || 0) - (+a.length_in || 0) || byDateDesc(a, b), heavy:(a, b) => (+b.weight_lb || 0) - (+a.weight_lb || 0) || byDateDesc(a, b) };
  const list = cs.slice().sort(sorters[statF.sort] || byDateDesc);
  const fish = list.reduce((a, c) => a + fishOf(c), 0);
  return `<h4 id="statList"><span>${statFActive() ? "Matching catches" : "All your catches"}</span><span>${list.length} · ${fish} fish</span></h4>
    <div class="row2" style="justify-content:space-between;margin-bottom:6px"><select data-sfk="sort" aria-label="Sort" style="width:auto">${[["new","Newest first"],["old","Oldest first"],["long","Longest first"],["heavy","Heaviest first"]].map(([v, l]) => `<option value="${v}" ${statF.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="link" type="button" data-sf="csv">Download these (CSV)</button></div>
    <ul class="list">${list.slice(0, statShown).map(itemCatch).join("")}</ul>
    ${list.length > statShown ? `<button class="btn sm" type="button" data-sf="more" style="margin-top:8px">Show ${Math.min(50, list.length - statShown)} more</button>` : ""}`;
}
function setStatF(k, v){ statF = { ...statF, [k]:v }; lsSet("fl.statF", statF); statShown = 50; renderLog(); }
function restoreStatFocus(){ if(!statFocus) return; const el = $(statFocus.id); if(el){ el.focus({ preventScroll:true }); try{ el.setSelectionRange(statFocus.pos, statFocus.pos); }catch(e){} } statFocus = null; }
let sfT;
$("log").addEventListener("input", e => { if(e.target.id !== "sfQ") return; const v = e.target.value; clearTimeout(sfT);
  sfT = setTimeout(() => { statFocus = { id:"sfQ", pos:e.target.selectionStart }; setStatF("q", v.trim()); }, 250); });
$("log").addEventListener("change", e => { const k = e.target.dataset?.sfk; if(k) setStatF(k, e.target.value); });
$("log").addEventListener("click", e => {
  const x = e.target.closest("[data-sfx]"); if(x){ setStatF(x.dataset.sfx, ""); return; }
  const sw = e.target.closest("[data-sfwater]"); if(sw){ setStatF("water", sw.dataset.sfwater); setTimeout(() => $("statList")?.scrollIntoView({ behavior:"smooth" }), 50); return; }
  const b = e.target.closest("[data-sf]"); if(!b) return;
  if(b.dataset.sf === "toggle"){ statFOpen = !statFOpen; renderLog(); }
  if(b.dataset.sf === "clear"){ statF = { ...STATF0, sort:statF.sort }; lsSet("fl.statF", statF); statShown = 50; renderLog(); }
  if(b.dataset.sf === "more"){ statShown += 50; renderLog(); }
  if(b.dataset.sf === "csv"){
    const cs = catches.filter(c => (statYear === "all" || (c.caught_on || "").startsWith(statYear)) && matchStatF(c)).sort(byDateDesc);
    const q = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const rows = [["Date","Species","Length (in)","Weight (lb)","Fish","Method","Fly or lure","Water","County","Trip","Latitude","Longitude","Notes","Photo"],
      ...cs.map(c => [c.caught_on, c.species, c.length_in, c.weight_lb, fishOf(c), METHODS[c.method || "fly"], c.fly, c.water, c.county ? countyName(c.county) : (c.lat != null ? "Outside Wisconsin" : ""), trips.find(t => t.id === c.trip_id)?.name, c.lat, c.lng, c.notes, c.photo_path ? "yes" : ""])];
    const blob = new Blob([rows.map(r => r.map(q).join(",")).join("\n")], { type:"text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `coulee-catches-${todayStr()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
});

/* ---------- me ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let meView = "main";
function renderMeTab(el){
  if(meView === "help") return renderHelp(el);
  if(meView === "suggest") return renderSuggest(el);
  if(meView === "creator" && isStaff()) return renderCreator(el);
  if(meView === "analytics" && isFounder()) return renderAnalytics(el);
  const followers = follows.filter(f => f.direction === "follower").length;
  el.innerHTML = `<div class="eyebrow">Account${isFounder() ? ` · <span class="pill open">Founder</span>` : profile?.role === "admin" ? ` · <span class="pill scouted">Admin</span>` : ""}${profile?.verified ? ` · <span class="pill fished">Verified</span>` : ""}</div>
    <div class="mehead">${avHtml(me?.id, profile?.display_name, "lg")}<div><h2 style="margin:0">${esc(profile?.display_name || "You")}</h2>
      <p class="muted" style="margin:2px 0 6px">${esc(me?.email || "")}</p>
      <span class="row2"><label class="btn sm" for="avFile">${profile?.avatar_path ? "Change picture" : "Add a picture"}</label><input type="file" id="avFile" accept="image/*" class="vh">${profile?.avatar_path ? `<button class="link danger" type="button" data-a="avremove">Remove</button>` : ""}</span></div></div>
    ${isStaff() && (pendingCount || flagCount || reportOpenCount) ? `<div class="card notice" style="margin:4px 0 12px"><p><b>${[pendingCount ? `${pendingCount} account${pendingCount===1?"":"s"} waiting for approval` : "", reportOpenCount ? `${reportOpenCount} report${reportOpenCount===1?"":"s"}` : "", flagCount ? `${flagCount} catch flag${flagCount===1?"":"s"} to review` : ""].filter(Boolean).join(" · ")}</b></p><div class="row2"><button class="btn sm ink" type="button" data-me="creator">Review</button></div></div>` : ""}
    <form id="nameForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="meName" value="${esc(profile?.display_name || "")}" maxlength="40" aria-label="Your name"><button class="btn" type="submit">Save name</button></form>
    <span class="hint" id="nameMsg" role="alert"></span>
    <div class="row2" style="margin-top:4px"><span class="muted">${profile?.username ? `Username <b style="color:var(--ink)">@${esc(profile.username)}</b>` : "No username yet"}</span><button class="link" type="button" data-a="uname">${profile?.username ? "Change" : "Pick one"}</button></div>${titlePickerHtml()}
    <div class="row2" style="margin-top:14px">
      <button class="btn sm" type="button" data-me="help">Help</button>
      <button class="btn sm" type="button" data-me="suggest">Suggestions</button>
      <button class="btn sm" type="button" data-a="guide">Setup guide</button>
      <button class="btn sm" type="button" data-camhelp>Photo location help</button>
      ${isStaff() ? `<button class="btn sm ink" type="button" data-me="creator">${isFounder() ? "Founder tools" : "Admin tools"}</button>` : ""}
    </div>
    <h4><span>Public profile</span><span>${followers} follower${followers===1?"":"s"}</span></h4>
    <div class="card">
      <label class="check"><input type="checkbox" id="meFindable" ${profile?.findable !== false ? "checked" : ""}> Let people find me by name to send friend requests</label>
      <label class="check"><input type="checkbox" id="mePublic" ${profile?.is_public ? "checked" : ""}> Let anyone find and follow me</label>
      <p class="muted">Followers see the catches you share (County only or Exact spot), the same as friends do. Catches set to Nothing stay private, and following doesn't let anyone into your tournaments or friend list.</p>
      <div class="field"><label for="meBio">Short bio</label><textarea id="meBio" maxlength="280" placeholder="Driftless brown trout nut. Mostly dries.">${esc(profile?.bio || "")}</textarea></div>
      <div class="row2"><button class="btn sm" type="button" data-a="savepublic">Save profile</button><span class="hint" id="pubMsg" role="alert"></span></div>
    </div>
    ${!isStandalone ? `<h4><span>Put it on your home screen</span></h4><div class="card">${isIOS
      ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted">It opens full screen like an app and keeps your counties for offline use.</p>`
      : `<p>In your browser's menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ""}
    ${prefsHtml()}
    ${notifyCardHtml()}
    ${themeHtml()}
    ${offlineBlock(null)}
    ${blockedHtml()}
    <h4><span>Your data</span></h4>
    <div class="card"><p>${catches.length} catches, ${spots.length} spots and ${trips.length} trips.</p><div class="row2"><button class="btn sm" type="button" data-a="export">Download a copy</button></div></div>
    <h4><span>Map data</span></h4>
    <p class="muted" style="margin:0">Streams, lakes, trout classes, trout regulations and public lands come from the Wisconsin DNR. Regulations change; check the current DNR rules before you fish.</p>
    <div class="row2" style="margin-top:22px"><button class="btn" type="button" data-a="signout">Sign out</button></div>
    ${profile?.role === "creator" ? "" : `<div class="row2" style="margin-top:18px"><button class="link danger" type="button" data-a="delacct">Delete my account</button></div><div data-delslot></div>`}`;
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
  ["Any fish, any method", [
    "Pick the method for each catch: Fly, Spinning, Baitcasting, Ice fishing, Trolling or Other. The Fly box becomes Lure or bait for the others.",
    "Species covers trout, bass, walleye, pike, musky, panfish, salmon, catfish and more. Type any other species too.",
    "Catches outside Wisconsin are kept with their exact location in an Outside Wisconsin list on the Log tab. They'll file into the right state when Coulee adds it."]],
  ["Notifications", [
    "On iPhone, open Coulee from its Home Screen icon (iOS 16.4 or newer), then Me → Notifications → Turn on notifications, and tap Allow.",
    "Choose which alerts you want: friend requests, messages, tournament invites and changes, fish logged for you, and forum replies. Turn them off any time in the same place, or in Settings → Notifications → Coulee."]],
  ["Messages", [
    "Message any friend from Friends → Messages, or the Message button next to a friend. Messages are for anglers 16 and older, friends only.",
    "Messages are private. A reviewer only sees one if someone reports it. Block anyone from the chat; they can't message you after that."]],
  ["Forums", [
    "Friends → Forums has boards for regions, fly tying, gear, tournaments and help. Start a thread or reply; you'll get a notification when someone replies to a thread you're in.",
    "Keep exact spots general unless they're public water. Report anything out of line and a moderator will look at it. Bad language is starred out automatically."]],
  ["Map style", [
    "Terrain shading shows coulees and ridges on the map; turn it off with Terrain in the legend. Zoom in close on a trout stream and the water drifts along it.",
    "Me → Appearance switches between Auto, Light and Dark. Dark is easier on the eyes at dawn and dusk."]],
  ["Where am I", [
    "Tap the target button under the zoom buttons to see where you are and which creek you're on, then Add spot here or Log a catch here.",
    "If it says location is off: Settings → Privacy & Security → Location Services → Safari Websites (or Coulee) → While Using the App."]],
  ["Catches from before you joined", [
    "Log as much of your history as you like. Fish caught before you joined are marked Before Coulee: they count in your own stats and log, but not toward titles or friend leaderboards."]],
  ["Finding your catches", [
    "The Stats tab lists every catch. Search by creek, fly or notes, or tap Filters to narrow by species (or all trout, bass or panfish), method, county, water, trip, photo or length. The numbers above the list follow the same filters.",
    "Tap a creek in Best water to see just the fish from there. Download these saves the list as a spreadsheet file."]],
  ["Which creek it was", [
    "When a catch has a location, from the photo, the Here button or the map, Coulee fills in the creek, river or lake it's on if one is within about 650 feet (500 for lakes).",
    "You can change it or type your own. Older catches are filled in automatically when the app opens."]],
  ["Logging a friend's fish", [
    "In Log a catch, change Whose fish? to a friend. They get it in their Log tab and choose Add to my log or Not mine.",
    "It only counts for them once they accept it, so nobody can add fish to someone else's log."]],
  ["Fair play", [
    "Each new photo gets a fingerprint so the same photo can't be entered twice, even resized. Photos with no camera data, or whose date or place doesn't match the catch, are flagged for a person to look at.",
    "Flags are hints, not proof, and nothing is hidden automatically. Only the founder and admins can hide a catch, and the angler gets a notice saying why. Coulee keeps only the distance and date gap from a photo, never the photo's own location."]],
  ["Titles", [
    "Earn titles like Bass Master, Brookie Hunter and Twenty-Incher as you log fish. See them all, with progress, in the Stats tab.",
    "Pick one to show next to your name in the Me tab."]],
  ["Planning a trip", [
    "Tap a creek or lake and choose Plan a trip to add it to an upcoming trip, or start a new one.",
    "Each planned water has directions and links to the DNR regulations, trout stream maps or Lake Pages."]],
  ["Spots", [
    "Spots are water you want to fish. Mark each one Want to try, Scouted or Fished.",
    "Each spot shows when you last fished it and how many fish you've logged there. Pick the spot when you log a catch to connect them."]],
  ["Trips", [
    "Make a trip with first and last days. Any catch logged in those dates joins it automatically.",
    "Each trip shows a recap: fish, species, biggest fish, best fly, photos and a day-by-day list, including days with no fish."]],
  ["Tournaments", [
    "Anyone can start a tournament: pick dates, an area (anywhere, a region, or specific counties), species and scoring, then invite friends.",
    "Catches that fit the rules are entered automatically when you log them. You can also enter or remove catches on the tournament page.",
    "Tournaments can be fly only. After a tournament ends, entries are locked: only its creator can change details or remove entries, and members are told about every change. Use Suggest a change to ask the creator.",
    "Photo tournaments only accept fish whose photo was taken during the tournament dates. The app reads the date stamp saved in the photo, so take photos with your phone's camera rather than screenshots."]],
  ["Friends and following", [
    "Friends: search anglers by name in Friends → People and tap Add friend, or share your 6-character friend code. Once they accept, you see each other's shared catches, trips and leaderboards, and can invite each other to tournaments.",
    "Don't want to be found by name? Turn off \"Let people find me by name\" in the Me tab. Friends can still add you with your code.",
    "Following: turn on a public profile in the Me tab to let anyone follow you. You can follow public anglers from Find anglers without their OK. Followers see your shared catches but aren't on your leaderboard."]],
  ["Location not filling in from photos", [
    "Tap Photo location help in the Me tab for picture-by-picture steps and a quick photo test.",
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
    <p class="muted" style="margin:4px 0 12px">Ideas, problems, anything. They go straight to the founder of Coulee.</p>
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
function suggestionsInboxHtml(){
  return `<h4><span>Suggestions inbox</span><span>${creatorData.s.length}</span></h4>
    ${creatorData.s.length ? `<div class="stack">${creatorData.s.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(s.display_name)} · ${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)}</p><p>${esc(s.body)}</p>${triageHtml(s)}
      <div class="row2"><select data-sugstatus="${esc(s.id)}" aria-label="Status" style="width:auto">${Object.entries(SUG_STATUS).map(([k,l]) => `<option value="${k}" ${s.status===k?"selected":""}>${l}</option>`).join("")}</select></div>
      <textarea data-sugreply="${esc(s.id)}" placeholder="Reply (the sender sees this)" maxlength="1000">${esc(s.reply || "")}</textarea>
      <div class="row2"><button class="btn sm" type="button" data-sugsave="${esc(s.id)}">Save reply</button>${isFounder() ? `<button class="link danger" type="button" data-sugdel="${esc(s.id)}">Delete</button>` : ""}</div></div>`).join("")}</div>` : `<p class="muted">No suggestions yet.</p>`}`;
}
async function loadCreator(){
  const [o, s, r] = await Promise.all([ isFounder() ? sb.rpc("creator_overview") : { data:[] }, sb.rpc("all_suggestions"), sb.from("releases").select("*").order("id", { ascending:false }).limit(10) ]);
  staffList = null;
  creatorData = { o: (o.data || [])[0] || null, s: s.data || [], r: r.data || [] };
  if(tab === "me" && meView === "creator") renderLog();
}
function renderCreator(el){
  if(!creatorData){ el.innerHTML = `<p class="status">Loading tools…</p>`; loadCreator(); return; }
  const o = creatorData.o || {};
  if(!isFounder()){
    el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
      <div class="eyebrow">Admin</div><h2>Admin tools</h2>${channelHtml()}${staffAccountsHtml()}${reportQueueHtml()}${flagQueueHtml()}${suggestionsInboxHtml()}`;
    return;
  }
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Founder</div><h2>Founder tools</h2>
    ${channelHtml()}
    <div class="row2" style="margin:0 0 6px"><button class="btn sm ink" type="button" data-me="analytics">Analytics</button></div>
    ${staffAccountsHtml()}
    ${reportQueueHtml()}
    ${flagQueueHtml()}
    <h4><span>Overview</span></h4>
    <div class="stats four"><div class="stat"><b>${o.anglers ?? "–"}</b><span>anglers</span></div><div class="stat f"><b>${o.fish ?? "–"}</b><span>fish logged</span></div><div class="stat"><b>${o.tournaments ?? "–"}</b><span>tournaments</span></div><div class="stat"><b>${o.open_suggestions ?? "–"}</b><span>new suggestions</span></div></div>
    <p class="muted" style="margin:0 0 6px">${o.public_anglers ?? 0} public profiles · ${o.catches ?? 0} catches · ${o.trips ?? 0} trips</p>
    <h4><span>Post an announcement</span></h4>
    <form id="annForm" novalidate><textarea id="annBody" maxlength="1000" placeholder="Opening weekend tournament starts Saturday. Good luck!"></textarea><div class="actions"><button class="btn ink" type="submit">Post to everyone</button></div></form>
    ${announcements.length ? `<ul class="list">${announcements.map(a => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b style="white-space:normal">${esc(a.body)}</b><small>${esc(fmtDate(a.created_at.slice(0,10)))}</small></span><button class="link danger" type="button" data-delann="${esc(a.id)}">Remove</button></li>`).join("")}</ul>` : ""}
    <h4><span>Publish "What's new"</span></h4>
    <p class="muted" style="margin:0 0 6px">Everyone sees this once, the next time they open the app.</p>
    <form id="relForm" novalidate><input id="relTitle" maxlength="80" placeholder="Hatch chart and faster maps" aria-label="Update title">
      <textarea id="relItems" placeholder="One change per line" aria-label="Changes, one per line" style="margin-top:8px;min-height:90px"></textarea>
      <label class="check"><input type="checkbox" id="relStaff"> Only for founder and admins (tools and behind-the-scenes changes)</label>
      <p class="muted" style="font-size:12.5px;margin:2px 0 0">Keep notes to the big things people will notice. They show to each person once their app has this build (${CFG.build || "?"}).</p>
      <span class="hint" id="relMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Publish update notes</button></div></form>
    ${(creatorData.r || []).length ? `<ul class="list">${creatorData.r.map(r => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b class="wrap">${esc(r.title)}</b><small>${esc(fmtDate(r.published_at.slice(0,10)))} · ${r.items.length} change${r.items.length===1?"":"s"}${r.audience === "staff" ? " · founder & admins only" : ""}${r.build ? ` · build ${r.build}` : ""}</small></span><button class="link danger" type="button" data-delrel="${r.id}">Remove</button></li>`).join("")}</ul>` : ""}
    ${suggestionsInboxHtml()}
    <h4><span>Other founder powers</span></h4>
    <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Feature anglers from Friends → Find anglers. Featured anglers show first with a badge.</li>
      <li>Hide any shared catch from feeds and tournaments with Hide from feeds in the Friends feed.</li>
      <li>Make tournaments open to everyone, and delete any tournament.</li>
      <li>Make someone an Admin or Verified from Accounts above. Admins can approve accounts and answer suggestions.</li>
    </ul>`;
  if(!$("relForm")) return;
  $("relForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("relMsg"); msg.className = "hint bad";
    const title = $("relTitle").value.trim(), items = $("relItems").value.split("\n").map(x => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    if(title.length < 2){ msg.textContent = "Add a title."; return; }
    if(!items.length || items.length > 12){ msg.textContent = "Add 1 to 12 changes, one per line."; return; }
    const { error } = await sb.from("releases").insert({ title, items, build:CFG.build || null, audience: $("relStaff")?.checked ? "staff" : "all" });
    if(error){ msg.textContent = "Couldn't publish it. Try again."; return; }
    toast("Published. Everyone sees it next time they open the app."); loadCreator();
  });
  $("annForm").addEventListener("submit", async e => {
    e.preventDefault(); const body = $("annBody").value.trim(); if(body.length < 2) return;
    const { data, error } = await sb.from("announcements").insert({ body }).select().single();
    if(error){ toast("Couldn't post it."); return; }
    announcements = [data, ...announcements]; toast("Posted. Everyone sees it in their Friends feed."); renderLog();
  });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const mv = t.closest("[data-me]"); if(mv){ meView = mv.dataset.me; if(meView === "creator"){ creatorData = null; flagList = null; reportList = null; } if(meView === "analytics") statsData = null; renderLog(); $("log").scrollTop = 0; return; }
  const dr = t.closest("[data-delrel]"); if(dr){ await sb.from("releases").delete().eq("id", +dr.dataset.delrel); loadCreator(); return; }
  const da = t.closest("[data-delann]"); if(da){ await sb.from("announcements").delete().eq("id", da.dataset.delann); announcements = announcements.filter(a => a.id !== da.dataset.delann); renderLog(); return; }
  const ss = t.closest("[data-sugsave]"); if(ss){ const id = ss.dataset.sugsave;
    const status = $("log").querySelector(`[data-sugstatus="${id}"]`).value, reply = $("log").querySelector(`[data-sugreply="${id}"]`).value.trim() || null;
    const { error } = await sb.from("suggestions").update({ status, reply, updated_at:new Date().toISOString() }).eq("id", id);
    toast(error ? "Couldn't save." : "Saved. They'll see it in their Suggestions page."); loadCreator(); return; }
  const sd = t.closest("[data-sugdel]"); if(sd){ await sb.from("suggestions").delete().eq("id", sd.dataset.sugdel); loadCreator(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "guide") openGuide(true);
  if(a.dataset.a === "alltitles"){ titlesAll = !titlesAll; renderLog(); }
  if(a.dataset.a === "savepublic"){
    const is_public = $("mePublic").checked, findable = $("meFindable").checked, bio = $("meBio").value.trim() || null, msg = $("pubMsg");
    const { error } = await sb.from("profiles").update({ is_public, findable, bio }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save. Try again."; return; }
    profile = { ...profile, is_public, findable, bio }; saveCache(); msg.className = "hint ok"; msg.textContent = is_public ? "Saved. Anyone can now find and follow you." : "Saved. Your profile is private.";
  }
});
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "signout"){
    if(outbox.length){ toast("Some entries haven't synced yet. Get back online first so nothing is lost."); return; }
    try{ const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if(sub){ await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } }catch(e){}
    await forgetPhotos(); await sb.auth.signOut(); location.reload();
  }
  if(a.dataset.a === "export"){
    const blob = new Blob([JSON.stringify({ exported_at:new Date().toISOString(), profile, trips, spots, catches }, null, 2)], { type:"application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `fly-log-${todayStr()}.json`; document.body.appendChild(link); link.click(); link.remove();
  }
});


/* ---------- setup guide for new accounts ---------- */
const GUIDE = () => [
  { t:"Welcome to Coulee", b:`<p>Coulee is a map of every named creek and lake in Wisconsin, with DNR trout classes, regulations and public land, plus a log for your spots, catches and trips.</p><p class="muted">This takes about a minute. You can replay it any time from Me → Setup guide.</p>` },
  ...(!isStandalone ? [{ t:"Put it on your home screen", b: isIOS
    ? `<ol class="steps"><li>Make sure this page is open in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>From now on, open the app from that icon. It opens full screen and works offline.</li></ol>`
    : `<p>Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Then open it from the icon.</p>` }] : []),
  { t:"Let your camera save locations", b:`<p>Photos can fill in where you caught a fish, but only if your camera saves the location.</p>
      <ol class="steps"><li>Open the iPhone <b>Settings</b> app.</li><li>Tap <b>Privacy &amp; Security</b>, then <b>Location Services</b>.</li><li>Make sure <b>Location Services</b> is on.</li><li>Tap <b>Camera</b> and choose <b>While Using the App</b>.</li><li>Turn on <b>Precise Location</b>.</li></ol>
      <p class="muted">Photos you take after this carry their location. If a photo still doesn't fill it in, tap <b>Here</b> while you're at the water.</p>
      <div class="row2"><button class="btn sm ink" type="button" data-camhelp>Show me with pictures</button><span class="hint">and test a photo</span></div>` },
  { t:"Allow location for the Here button", b:`<p>When you tap <b>Here</b> while logging a catch, your phone asks to share your location with the app. Tap <b>Allow</b>.</p>
      <p>Tapped Don't Allow by mistake? Go to <b>Settings → Privacy &amp; Security → Location Services → Safari Websites</b> and choose <b>While Using the App</b>.</p>
      <div class="row2"><button class="btn sm" type="button" id="guideGps">${icon("i-gps")}Try it now</button><span class="hint" id="guideGpsMsg"></span></div>` },
  { t:"Turn on notifications", b:notifyStepHtml() },
  { t:"The map", at:"#map", b:`<p><b>Tap a county</b> to see every named creek, river and lake in it. Colored bands are DNR trout classes (green Class I, gold II, rust III), and green shading is public land.</p><p class="muted">Tap any creek for its name, season and the nearest regulation.</p>` },
  { t:"Search", at:".search", b:`<p>Type any creek or lake name to jump straight to it.</p>` },
  { t:"Where am I", at:".locbtn", b:`<p>Shows where you're standing and the creek you're on. From there, <b>Add spot here</b> or <b>Log a catch here</b> in one tap.</p>` },
  { t:"Spots and catches", at:"#addCatchBtn", also:"#addSpotBtn", b:`<p><b>Add spot</b> saves water to try. <b>Log a catch</b> takes a photo, species, length or weight, and the fly or lure; the photo fills in where and when.</p><p class="muted">No signal? Log anyway. It syncs later.</p>` },
  { t:"Trips", at:'.tabs [data-tab="trips"]', open:true, b:`<p>Set dates and every catch from those days joins the trip. Plan ahead by adding creeks and lakes you want to hit.</p>` },
  { t:"Tournaments", at:'.tabs [data-tab="tourney"]', open:true, b:`<p>Make a tournament with friends: dates, area, species and scoring. Fish that fit are entered on their own.</p>` },
  { t:"Friends", at:'.tabs [data-tab="friends"]', open:true, b:`<p>Find friends by name or friend code${profile?.friend_code ? ` (yours is <b style="font-family:var(--f-data);letter-spacing:.1em">${esc(profile.friend_code)}</b>)` : ""}. Messages and Forums are in here too.</p>` },
  { t:"Your stats", at:'.tabs [data-tab="stats"]', open:true, b:`<p>Every catch you've logged, with filters, your best water, and the titles you're working toward.</p>` },
  { t:"Me", at:'.tabs [data-tab="me"]', open:true, b:`<p>Turn on <b>notifications</b>, tell Coulee <b>how you fish</b>, add a profile picture, and find Help and Suggestions.</p>` },
  { t:"You're set", b:`<p>Tap a county to start exploring, or log your first fish.</p><p class="muted">Help and Suggestions are in the Me tab. Suggestions go straight to the founder.</p>` }
];
function notifyStepHtml(){
  const intro = `<p>Get a notification when a friend adds you, sends a message, invites you to a tournament or logs a fish for you.</p>`;
  if(!pushSupported()) return intro + (isIOS && !isStandalone
    ? `<p>On iPhone this works once Coulee is on your Home Screen (iOS 16.4 or newer). Add it, open Coulee from the icon, then turn them on in <b>Me → Notifications</b>.</p>`
    : `<p class="muted">This browser can't show notifications. On iPhone, open Coulee from the Home Screen icon. On Android, use Chrome. You can turn them on later in <b>Me → Notifications</b>.</p>`);
  if(Notification.permission === "denied") return intro + `<p>Notifications are blocked for Coulee right now. Turn them on in <b>Settings → Notifications → Coulee</b> (iPhone) or your browser's site settings, then tap below.</p>` + notifyBtn();
  return intro + `<p class="muted">Your phone will ask once. Tap <b>Allow</b>. You can pick which ones you get, or turn them off, in <b>Me → Notifications</b>.</p>` + notifyBtn();
}
const notifyBtn = () => `<div class="row2"><button class="btn sm ink" type="button" id="guideNotif">${icon("i-bell")}Turn on notifications</button><span class="hint" id="guideNotifMsg"></span></div>`;
let guideStep = 0, guideSteps = [];
function openGuide(replay){
  if(!$("guide").hidden) return;
  guideSteps = GUIDE(); guideStep = 0; renderGuide(); $("guide").hidden = false;
}
function renderGuide(){
  const s = guideSteps[guideStep];
  placeCoach(s);
  $("guideDots").innerHTML = guideSteps.map((_, i) => `<i class="${i === guideStep ? "on" : i < guideStep ? "done" : ""}"></i>`).join("");
  $("guideBody").innerHTML = `<div class="eyebrow">Step ${guideStep + 1} of ${guideSteps.length}</div><h3 id="guideTitle">${esc(s.t)}</h3><div class="gbody">${s.b}</div>`;
  $("guideBack").hidden = guideStep === 0;
  $("guideNext").textContent = guideStep === guideSteps.length - 1 ? "Start fishing" : "Next";
  $("guideSkip").hidden = guideStep === guideSteps.length - 1;
  const n = $("guideNotif");
  if(n){ refreshPushState().then(() => { if(pushStateV === "on" && $("guideNotif")){ $("guideNotif").hidden = true; $("guideNotifMsg").className = "hint ok"; $("guideNotifMsg").textContent = "Notifications are already on for this phone."; } });
    n.onclick = async () => {
      const m = $("guideNotifMsg"); n.disabled = true; m.className = "hint"; m.textContent = "Asking your phone…";
      await enablePush(); await refreshPushState();
      if(pushStateV === "on"){ n.hidden = true; m.className = "hint ok"; m.textContent = "Notifications are on. A test is on its way."; }
      else { n.disabled = false; m.className = "hint bad"; m.textContent = pushStateV === "denied" ? "Blocked. Use Settings → Notifications → Coulee, then try again." : "Not turned on. You can do it later in Me → Notifications."; }
    }; }
  const g = $("guideGps");
  if(g) g.onclick = () => {
    const m = $("guideGpsMsg"); m.className = "hint"; m.textContent = "Asking for your location…";
    if(!navigator.geolocation){ m.className = "hint bad"; m.textContent = "This browser can't share location."; return; }
    navigator.geolocation.getCurrentPosition(pos => { const cid = countyAt(pos.coords.latitude, pos.coords.longitude); m.className = "hint ok"; m.textContent = cid ? `It works. You're in ${countyName(cid)}.` : "It works."; },
      err => { m.className = "hint bad"; m.textContent = err.code === 1 ? "Location is blocked. Use the Settings steps above, then try again." : "Couldn't get a fix. Try again outside."; }, { enableHighAccuracy:true, timeout:15000 });
  };
}
async function finishGuide(){
  $("guide").hidden = true; $("coachRing").hidden = true; coachDim.hidden = true; $("guide").classList.remove("coach"); $("guide").querySelector(".sheet").style.cssText = "";
  if(profile && !profile.onboarded){ const last = await latestReleaseId().catch(() => 0); profile.onboarded = true; profile.last_seen_release = last; saveCache();
    await sb.from("profiles").update({ onboarded:true, last_seen_release:last }).eq("id", me.id); }
}
$("guideNext").onclick = () => { if(guideStep < guideSteps.length - 1){ guideStep++; renderGuide(); $("guide").querySelector(".sheet").scrollTop = 0; } else finishGuide(); };
$("guideBack").onclick = () => { if(guideStep > 0){ guideStep--; renderGuide(); } };
$("guideSkip").onclick = finishGuide;

/* coach marks: point at the real thing on screen */
// the ring's darkening must sit at the top of the page, or the app's layout clips it
document.body.appendChild($("coachRing"));
// darken everything except a hole around the item (a cut-out overlay; big box-shadows don't draw reliably everywhere)
const coachDim = document.createElement("div"); coachDim.className = "coachDim"; coachDim.hidden = true; document.body.appendChild(coachDim);
function placeCoach(s){
  const g = $("guide"), ring = $("coachRing"), sheet = g.querySelector(".sheet");
  const el = s.at && document.querySelector(s.at);
  if(!el){ g.classList.remove("coach"); ring.hidden = true; coachDim.hidden = true; sheet.style.cssText = ""; return; }
  if(s.open && typeof panelCollapsed !== "undefined" && panelCollapsed) setCollapsed(false, false);
  if(s.at === "#map" || s.at === ".search" || s.at === ".locbtn" || s.at === "#addCatchBtn"){ if(tab !== "map") setTab("map"); }
  g.classList.add("coach");
  requestAnimationFrame(() => setTimeout(() => {
    const r = el.getBoundingClientRect(), r2 = s.also ? document.querySelector(s.also)?.getBoundingClientRect() : null;
    const box = r2 ? { left:Math.min(r.left, r2.left), top:Math.min(r.top, r2.top), right:Math.max(r.right, r2.right), bottom:Math.max(r.bottom, r2.bottom) } : r;
    const pad = s.at === "#map" ? -12 : 6, vw = innerWidth, vh = innerHeight;
    Object.assign(ring.style, { left:box.left - pad + "px", top:box.top - pad + "px", width:(box.right - box.left) + pad * 2 + "px", height:(box.bottom - box.top) + pad * 2 + "px" });
    ring.hidden = false;
    const x1 = box.left - pad, y1 = box.top - pad, x2 = box.right + pad, y2 = box.bottom + pad;
    coachDim.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
    coachDim.hidden = false;
    const w = Math.min(340, vw - 32), cy = (box.top + box.bottom) / 2;
    const below = s.at === "#map" ? false : cy < vh / 2;
    sheet.style.cssText = `position:fixed;width:${w}px;left:${Math.max(16, Math.min(vw - w - 16, (box.left + box.right) / 2 - w / 2))}px;${below ? `top:${Math.min(vh - 220, box.bottom + pad + 12)}px` : `bottom:${Math.max(16, vh - (s.at === "#map" ? box.bottom - 24 : box.top - pad - 12))}px`};max-height:${Math.round(vh * .5)}px`;
    // keep the card off the thing it's pointing at: try below, above, then beside it
    if(s.at !== "#map"){
      const h = Math.min(sheet.offsetHeight || 260, vh * .5), m = 12, cx = (box.left + box.right) / 2;
      const clampX = x => Math.max(16, Math.min(vw - w - 16, x)), clampY = y => Math.max(16, Math.min(vh - h - 16, y));
      const tries = [
        { l:clampX(cx - w / 2), t:box.bottom + pad + m }, { l:clampX(cx - w / 2), t:box.top - pad - m - h },
        { l:box.left - pad - m - w, t:clampY(cy - h / 2) }, { l:box.right + pad + m, t:clampY(cy - h / 2) }];
      const hits = c => !(c.l + w <= x1 || c.l >= x2 || c.t + h <= y1 || c.t >= y2);
      const fits = c => c.l >= 8 && c.t >= 8 && c.l + w <= vw - 8 && c.t + h <= vh - 8 && !hits(c);
      const pick = (below ? tries : [tries[1], tries[0], tries[2], tries[3]]).find(fits);
      if(pick) Object.assign(sheet.style, { left:pick.l + "px", top:pick.t + "px", bottom:"auto" });
    }
  }, 280));
}
window.addEventListener("resize", () => { if(!$("guide").hidden) placeCoach(guideSteps[guideStep]); });


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


/* ---------- accounts: agreements, approval, staff roles ---------- */
const TERMS_VERSION = 1;
const thisYear = new Date().getFullYear();
const isFounder = () => profile?.role === "creator";
const isStaff = () => profile?.role === "creator" || (profile?.role === "admin" && profile?.status === "approved");
function checkBirthYear(v){
  const y = +String(v || "").trim();
  if(!/^\d{4}$/.test(String(v || "").trim()) || y < 1900 || y > thisYear) return "Enter the year you were born, like 1990.";
  if(y > thisYear - 13) return "Coulee is for people 13 and older.";
  return null;
}
function accountState(){
  if(!profile) return "ok";
  if(profile.status === "pending" || profile.status === "declined") return profile.status;
  if(profile.terms_version != null && profile.terms_version < TERMS_VERSION) return "terms";
  return "ok";
}
function applyGate(){
  const s = accountState();
  $("gate").hidden = !(s === "pending" || s === "declined");
  $("terms").hidden = s !== "terms";
  if(s === "pending") $("gateBody").innerHTML = `<h2 style="margin:0 0 8px">You're on the list</h2><p>Thanks for signing up, ${esc(profile.display_name || "angler")}. Coulee is invite-only for now, so the founder approves each new account.</p><p class="muted">You'll get in as soon as you're approved. Tap Check again, or reopen the app later.</p>`;
  if(s === "declined") $("gateBody").innerHTML = `<h2 style="margin:0 0 8px">This account isn't active</h2><p>This account hasn't been approved for Coulee. If you think that's a mistake, contact the person who invited you.</p>`;
  if(s === "terms"){ $("tYearRow").hidden = !!profile.birth_year; $("termsMsg").textContent = ""; }
  return s === "ok";
}
$("gateCheck").onclick = async () => { $("gateCheck").disabled = true; await loadAll(); $("gateCheck").disabled = false; if(accountState() === "pending") toast("Still waiting for approval."); };
$("gateOut").onclick = $("termsOut").onclick = async () => { await forgetPhotos(); await sb.auth.signOut(); location.reload(); };
$("termsOk").onclick = async () => {
  const msg = $("termsMsg"); msg.className = "hint bad";
  const upd = { terms_version:TERMS_VERSION, terms_at:new Date().toISOString() };
  if(!profile.birth_year){ const e = checkBirthYear($("tYear").value); if(e){ msg.textContent = e; $("tYear").focus(); return; } upd.birth_year = +$("tYear").value.trim(); }
  if(!$("tAgree").checked || !$("tRegs").checked){ msg.textContent = "Check both boxes to continue."; return; }
  $("termsOk").disabled = true;
  const { error } = await sb.from("profiles").update(upd).eq("id", me.id);
  $("termsOk").disabled = false;
  if(error){ msg.textContent = /13/.test(error.message) ? "Coulee is for people 13 and older." : "Couldn't save. Check your connection and try again."; return; }
  profile = { ...profile, ...upd }; saveCache();
  if(applyGate()){ if(!profile.onboarded) openGuide(); else checkWhatsNew(); }
};

/* staff: pending accounts, approvals and roles */
let staffList = null, pendingCount = 0, acctQ = "";
async function loadStaffList(){
  if(!isStaff()) return;
  let { data, error } = await sb.rpc("staff_people_v2", { q: acctQ });
  if(error) ({ data, error } = await sb.rpc("staff_people", { q: acctQ }));   // older database: the list without usernames
  if(error) return;
  staffList = data || [];
  if(!acctQ) pendingCount = staffList.filter(p => p.status === "pending").length;
  $("meDot").hidden = !(pendingCount || flagCount);
  if(tab === "me") renderLog();
}
const ACCT_PILL = { pending:`<span class="pill want">Waiting</span>`, declined:`<span class="pill priv">Declined</span>` };
function staffAccountsHtml(){
  if(!staffList){ loadStaffList(); return `<h4><span>Accounts</span></h4><p class="status">Loading accounts…</p>`; }
  return `<h4><span>Accounts</span><span>${pendingCount} waiting</span></h4>
    <form id="acctForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="acctQ" value="${esc(acctQ)}" placeholder="Search by name or username${isFounder() ? ", or email" : ""}" aria-label="Search accounts"><button class="btn" type="submit">Search</button></form>
    ${staffList.length ? `<div class="stack" style="margin-top:10px">${staffList.map(p => {
      const roleCtl = isFounder() && p.role !== "creator" && p.status === "approved"
        ? `<div class="row2"><select data-acctrole="${esc(p.id)}" aria-label="Role" style="width:auto"><option value="angler" ${p.role==="angler"?"selected":""}>Member</option><option value="admin" ${p.role==="admin"?"selected":""}>Admin</option></select>
           <label class="check" style="margin:0"><input type="checkbox" data-acctver="${esc(p.id)}" ${p.verified?"checked":""}> Verified</label>
           <button class="btn sm" type="button" data-acctsave="${esc(p.id)}">Save</button></div>` : "";
      const statusCtl = p.role === "creator" ? "" : p.status === "pending"
        ? `<button class="btn sm ink" type="button" data-acctset="${esc(p.id)}" data-to="approved">Approve</button><button class="btn sm" type="button" data-acctset="${esc(p.id)}" data-to="declined">Decline</button>`
        : p.status === "declined" ? `<button class="btn sm" type="button" data-acctset="${esc(p.id)}" data-to="approved">Approve</button>`
        : (p.role !== "admin" || isFounder()) ? `<button class="link danger" type="button" data-acctset="${esc(p.id)}" data-to="declined">Remove access</button>` : "";
      return `<div class="card acct"><div class="acct-h">${avHtml(p.id, p.display_name, "", p.avatar_path)}<span class="t"><b class="wrap">${esc(p.display_name)} ${p.role==="creator"?`<span class="pill open">Founder</span>`:p.role==="admin"?`<span class="pill scouted">Admin</span>`:""}${p.verified?` <span class="pill fished">Verified</span>`:""} ${ACCT_PILL[p.status]||""}</b>
        <small>${p.username ? "@" + esc(p.username) + " · " : ""}${p.email ? esc(p.email) + " · " : ""}joined ${esc(fmtDate(p.created_at.slice(0,10)))}</small></span></div>
        ${statusCtl ? `<div class="row2">${statusCtl}</div>` : ""}${roleCtl}</div>`; }).join("")}</div>` : `<p class="muted">No accounts match.</p>`}
    <p class="note">${isFounder() ? "Admins can approve accounts and read suggestions. They never see emails, private spots or exact locations. Verified adds a badge." : "You can approve new accounts and answer suggestions."}</p>`;
}
$("log").addEventListener("submit", e => { if(e.target.id === "acctForm"){ e.preventDefault(); acctQ = $("acctQ").value.trim(); staffList = null; renderLog(); } });
$("log").addEventListener("click", async ev => {
  const st = ev.target.closest("[data-acctset]");
  if(st){ st.disabled = true;
    const { error } = await sb.rpc("set_account_status", { uid: st.dataset.acctset, new_status: st.dataset.to });
    toast(error ? (error.message || "Couldn't update.") : st.dataset.to === "approved" ? "Approved. They can use Coulee now." : "Access removed.");
    await loadStaffList(); return; }
  const sv = ev.target.closest("[data-acctsave]");
  if(sv){ const id = sv.dataset.acctsave; sv.disabled = true;
    const role = $("log").querySelector(`[data-acctrole="${id}"]`).value, ver = $("log").querySelector(`[data-acctver="${id}"]`).checked;
    const { error } = await sb.rpc("set_account_role", { uid:id, new_role:role, is_verified:ver });
    toast(error ? (error.message || "Couldn't save.") : "Saved."); await loadStaffList(); }
});

/* ---------- profile pictures ---------- */
const AV_BASE = CFG.supabaseUrl + "/storage/v1/object/public/avatars/";
let avatars = lsGet("fl.avatars", {}), titles = lsGet("fl.titles", {});
const titleOf = id => id === me?.id ? profile?.title : (titles[id] || people[id]?.title);
const titlePill = id => titleOf(id) ? ` <span class="pill ttl">${esc(titleOf(id))}</span>` : "";
function avHtml(id, name, cls = "", path){
  const p = path !== undefined ? path : id === me?.id ? profile?.avatar_path : (avatars[id] || people[id]?.avatar_path);
  const ini = esc(((name || "?").trim()[0] || "?").toUpperCase());
  return p ? `<span class="av ${cls}"><img src="${AV_BASE}${p.split("/").map(encodeURIComponent).join("/")}" alt="" loading="lazy" onerror="this.remove()"></span>` : `<span class="av ${cls}" aria-hidden="true">${ini}</span>`;
}
async function loadAvatars(ids){
  ids = [...new Set(ids.filter(id => id && id !== me?.id))];
  if(!ids.length) return;
  const { data, error } = await sb.from("profiles").select("id, avatar_path, title").in("id", ids.slice(0, 300));
  if(error || !data) return;
  for(const p of data){ avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; }
  lsSet("fl.avatars", avatars); lsSet("fl.titles", titles);
  if(tab === "friends") renderLog();
}
async function avatarBlob(file){
  let bmp; try{ bmp = await createImageBitmap(file, { imageOrientation:"from-image" }); }catch(e){ bmp = null; }
  if(!bmp) bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(bmp.width, bmp.height), N = 320;
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  cv.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  return await new Promise(res => cv.toBlob(res, "image/jpeg", 0.85));
}
$("log").addEventListener("change", async e => {
  if(e.target.id !== "avFile" || !e.target.files[0]) return;
  if(!navigator.onLine){ toast("Connect to the internet to change your picture."); return; }
  const file = e.target.files[0]; toast("Uploading your picture…");
  try{
    const blob = await avatarBlob(file), path = `${me.id}/${Date.now()}.jpg`, old = profile.avatar_path;
    const up = await sb.storage.from("avatars").upload(path, blob, { contentType:"image/jpeg", cacheControl:"31536000" });
    if(up.error) throw up.error;
    const { error } = await sb.from("profiles").update({ avatar_path:path }).eq("id", me.id);
    if(error) throw error;
    profile = { ...profile, avatar_path:path }; saveCache(); renderLog(); toast("Picture saved.");
    if(old) sb.storage.from("avatars").remove([old]);
  }catch(err){ console.error(err); toast("Couldn't save that picture. Try a different photo."); }
});
$("log").addEventListener("click", async e => {
  if(!e.target.closest('[data-a="avremove"]')) return;
  const old = profile.avatar_path; if(!old) return;
  const { error } = await sb.from("profiles").update({ avatar_path:null }).eq("id", me.id);
  if(error){ toast("Couldn't remove it."); return; }
  profile = { ...profile, avatar_path:null }; saveCache(); renderLog(); sb.storage.from("avatars").remove([old]);
});

/* ---------- map views: field map, satellite, topo ---------- */
pane("tiles", 395, false);
const VIEWS = {
  field:{ label:"Map" },
  // Esri imagery is sharp to zoom 19; USGS imagery stops at 16 and goes soft up close
  sat:{ label:"Satellite", url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", native:19, credit:"Imagery: Esri, Maxar, Earthstar Geographics" },
  // USGS topo tiles stop at 16; on sharp phone screens ask for one level finer so contours stay crisp
  topo:{ label:"Topo", url:"https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", native:16, retina:true, credit:"Topo: USGS The National Map" }
};
let mapView = lsGet("fl.view", "field"), viewLayer = null, tileErrors = 0;
const viewCtl = L.control({ position:"topright" });
viewCtl.onAdd = () => {
  const d = L.DomUtil.create("div", "viewsw");
  d.setAttribute("role", "group"); d.setAttribute("aria-label", "Map style");
  d.innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button type="button" data-view="${k}" aria-pressed="${k === mapView}">${v.label}</button>`).join("") + `<small class="vcredit" id="viewCredit"></small>`;
  L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
  d.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if(b) setMapView(b.dataset.view); });
  return d;
};
viewCtl.addTo(map);
function setMapView(v){
  if(!VIEWS[v]) v = "field";
  mapView = v; lsSet("fl.view", v); tileErrors = 0;
  if(viewLayer){ map.removeLayer(viewLayer); viewLayer = null; }
  if(VIEWS[v].url){
    // retina: Leaflet asks for zoom+1 and lowers maxZoom by one, so offset both to stay within the tile cache and keep zoom 18
    const ret = !!VIEWS[v].retina && L.Browser.retina;
    viewLayer = L.tileLayer(VIEWS[v].url, { pane:"tiles", maxNativeZoom:VIEWS[v].native - (ret ? 1 : 0), maxZoom:ret ? 19 : 18, crossOrigin:true, detectRetina:ret, updateWhenIdle:false, keepBuffer:4 });
    viewLayer.on("tileerror", () => { if(++tileErrors === 6) toast(navigator.onLine ? `${VIEWS[v].label} tiles aren't loading right now.` : `${VIEWS[v].label} view needs a connection. Switch to Map for offline use.`); });
    viewLayer.addTo(map);
  }
  map.getPane("water").style.display = v === "field" ? "" : "none";
  document.getElementById("map").classList.toggle("imagery", v !== "field");
  document.querySelectorAll(".viewsw [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  const c = $("viewCredit"); if(c) c.textContent = VIEWS[v].credit || "";
  document.dispatchEvent(new Event("mapview"));
}
setMapView(mapView);

/* ---------- update ready banner ---------- */
let updateWaiting = false;
function appBusy(){
  const open = ["scrim", "tripScrim", "tourneyScrim", "guide", "terms"].some(id => $(id) && !$(id).hidden);
  const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value && a.type !== "checkbox" && a.id !== "q";
  return open || typing || picking || offlineBusy;
}
function showUpdateReady(){ updateWaiting = true; $("updBar").hidden = false; }
$("updGo").onclick = () => location.reload();
$("updLater").onclick = () => { $("updBar").hidden = true; };

/* the map style switch sat on top of creek cards: tuck it away while a card is open */
map.on("popupopen", () => document.getElementById("map").classList.add("popopen"));
map.on("popupclose", () => document.getElementById("map").classList.remove("popopen"));


/* ---------- the log panel ----------
   Computer: a side panel you can hide. Phone: a sheet with three stops: closed (map only), half, and full screen.
   Closed <-> half resizes the map so it stays centered. Half <-> full slides the sheet over the map without resizing it
   (the map keeps drawing at its half size underneath), so the pull is smooth and follows your finger. */
const mainEl = document.querySelector(".main"), logEl = document.querySelector("aside.log"), mapWrapEl = document.querySelector(".mapwrap");
const isPhone = () => window.matchMedia("(max-width:760px)").matches;
let panelCollapsed = isPhone() ? true : lsGet("fl.collapsed", false);   // a phone always opens on the map alone
let panelFull = false;
const mapH = () => mapWrapEl.offsetHeight;
function panelLabel(){
  $("grabLabel").textContent = panelFull ? "Pull down for the map" : "Pull up for your log";
  $("grab").setAttribute("aria-expanded", String(!panelCollapsed));
  $("grab").setAttribute("aria-label", panelFull ? "Shrink the panel to show the map" : panelCollapsed ? "Show the panel" : "Hide the panel");
}
function setCollapsed(v, save = true){
  if(v && panelFull) setFull(false, true);
  panelCollapsed = v;
  mainEl.classList.toggle("collapsed", v);
  $("panelShow").hidden = !v || isPhone();
  if(save && !isPhone()) lsSet("fl.collapsed", v);
  panelLabel();
  setTimeout(() => { map.invalidateSize(); drawLabels(); }, 280);
}
function expandPanel(){ if(panelCollapsed) setCollapsed(false); }
let liftDone = null;
function setFull(v, instant){
  if(v && (!isPhone() || panelCollapsed)) return;
  panelFull = v; mainEl.classList.toggle("full", v); panelLabel();
  if(liftDone){ logEl.removeEventListener("transitionend", liftDone); liftDone = null; }
  if(v){
    if(!mainEl.classList.contains("lift")){ logEl.style.transition = "none"; logEl.style.transform = `translateY(${mapH()}px)`; mainEl.classList.add("lift"); void logEl.offsetHeight; }
    logEl.style.transition = instant ? "none" : ""; logEl.style.transform = "translateY(0)";
    return;
  }
  if(!mainEl.classList.contains("lift")) return;
  const done = liftDone = e => { if(e && e.target !== logEl) return; logEl.removeEventListener("transitionend", done); if(liftDone === done) liftDone = null;
    mainEl.classList.remove("lift"); logEl.style.transform = ""; logEl.style.transition = ""; };
  if(instant) return done();
  logEl.style.transition = ""; logEl.style.transform = `translateY(${mapH()}px)`;
  logEl.addEventListener("transitionend", done); setTimeout(() => { if(liftDone === done) done(); }, 400);
}
// anything that needs the map (jump to a pin, open a county, pick a place) brings a full-screen panel back down first
for(const fn of ["flyTo", "fitBounds", "flyToBounds"]){ const orig = map[fn].bind(map); map[fn] = (...a) => { if(panelFull) setFull(false); return orig(...a); }; }
(() => {
  let y0 = null, x0 = 0, t0 = 0, moved = false, startEl = null, lifting = false, base = 0;
  // keep following the finger once it leaves the handle; on the tab bar only after a clear vertical pull, so taps still pick tabs
  const down = e => { y0 = e.clientY; x0 = e.clientX; t0 = performance.now(); moved = false; lifting = false; startEl = e.currentTarget; if(startEl === $("grab")) try{ startEl.setPointerCapture(e.pointerId); }catch(_){} };
  const move = e => { if(y0 == null) return; const dy = e.clientY - y0, dx = e.clientX - x0;
    if(!moved && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)){ moved = true; try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
      if(isPhone() && !panelCollapsed && (panelFull || dy < 0)){   // between half and full the sheet rides the finger
        lifting = true; base = panelFull ? 0 : mapH(); logEl.style.transition = "none";
        if(!mainEl.classList.contains("lift")){ logEl.style.transform = `translateY(${base}px)`; mainEl.classList.add("lift"); } } }
    if(lifting) logEl.style.transform = `translateY(${Math.max(0, Math.min(mapH(), base + dy))}px)`;
  };
  const up = e => {
    if(y0 == null) return;
    const dy = e.clientY - y0, dx = e.clientX - x0, fromGrab = startEl === $("grab"), fast = Math.abs(dy) / Math.max(1, performance.now() - t0) > .45; y0 = null;
    if(lifting){ lifting = false;
      if(panelFull) setFull(!(dy > 70 || (fast && dy > 24)));
      else setFull(dy < -70 || (fast && dy < -24));
      return; }
    if(moved && Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)){
      const wasClosed = panelCollapsed; setCollapsed(dy > 0);
      if(wasClosed && dy < -innerHeight * .45) setTimeout(() => setFull(true), 60);   // one long pull from closed goes all the way up
      return; }
    if(!moved && fromGrab){ if(panelFull) setFull(false); else setCollapsed(!panelCollapsed); }
  };
  const cancel = () => { if(lifting){ lifting = false; setFull(panelFull); } y0 = null; };
  for(const el of [$("grab"), document.querySelector(".tabs")]){
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", cancel);
  }
})();
// with the panel closed the tabs' red dots are hidden, so the handle carries one whenever any tab has news
(() => {
  const dots = ["reqDot", "tDot", "meDot"].map($).filter(Boolean);
  const sync = () => $("grab").classList.toggle("has-news", dots.some(d => !d.hidden));
  const mo = new MutationObserver(sync); for(const d of dots) mo.observe(d, { attributes:true, attributeFilter:["hidden"] });
  sync();
})();
$("panelHide").onclick = () => setCollapsed(true);
$("panelShow").onclick = () => setCollapsed(false);
window.matchMedia("(max-width:760px)").addEventListener?.("change", () => { if(panelFull) setFull(false, true); setCollapsed(panelCollapsed, false); });
setCollapsed(panelCollapsed, false);

/* ---------- what's new after an update ---------- */
async function checkWhatsNew(){
  if(!me || !profile || !profile.onboarded || !$("guide").hidden || !$("news").hidden) return;
  const { data, error } = await sb.from("releases").select("*").gt("id", profile.last_seen_release || 0).or(`build.is.null,build.lte.${CFG.build || 0}`).order("id", { ascending:false }).limit(5);
  if(error || !data || !data.length) return;
  $("newsTitle").textContent = data.length === 1 ? data[0].title : "Updates to Coulee";
  $("newsBody").innerHTML = data.map(r => `<div class="news-rel">${data.length > 1 ? `<h5>${esc(r.title)}</h5>` : ""}<small>${esc(fmtDate(r.published_at.slice(0,10)))}</small><ul class="steps">${r.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("");
  $("news").dataset.latest = data[0].id;
  $("news").hidden = false;
}
async function markNewsSeen(id){
  if(!id || !me) return;
  profile = { ...profile, last_seen_release: id }; saveCache();
  await sb.from("profiles").update({ last_seen_release: id }).eq("id", me.id);
}
$("newsOk").onclick = () => { $("news").hidden = true; markNewsSeen(+$("news").dataset.latest); };
$("news").addEventListener("click", e => { if(e.target === $("news")) $("newsOk").click(); });
async function latestReleaseId(){ const { data } = await sb.from("releases").select("id").or(`build.is.null,build.lte.${CFG.build || 0}`).order("id", { ascending:false }).limit(1); return data && data[0] ? data[0].id : 0; }

/* ---------- save counties for offline use ---------- */
const OFFLINE_CACHE = "flylog-data";
const countyFiles = id => [dataUrl("water/" + id + ".json"), dataUrl("water/trout/" + id + ".json"), dataUrl("access/" + id + ".json"), hdUrl(id)];
let offlineSaved = null, offlineBusy = false;
async function countSavedCounties(){
  if(!("caches" in window)) return null;
  try{ const c = await caches.open(OFFLINE_CACHE); const keys = new Set((await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search));
    const base = new URL(dataUrl("water/x.json"), location.href).pathname.replace(/x\.json$/, "");
    const hdKey = id => { const u = new URL(hdUrl(id), location.href); return u.pathname + u.search; };
    // saved = the county's map file and its detailed creek lines are both on the phone
    offlineSaved = new Set(counties.map(f => f.id).filter(id => keys.has(base + id + ".json?v=" + CFG.dataVersion) && keys.has(hdKey(id))));
  }catch(e){ offlineSaved = null; }
  return offlineSaved;
}
async function saveCountiesOffline(ids, onProgress){
  const c = await caches.open(OFFLINE_CACHE);
  const extra = [dataUrl("water/index.json"), dataUrl("geo.json"), dataUrl("gauges.json")];
  for(const u of extra){ try{ if(!(await c.match(u))){ const r = await fetch(u); if(r.ok) await c.put(u, r); } }catch(e){} }
  let done = 0, failed = 0;
  for(const id of ids){
    for(const u of countyFiles(id)){ try{ if(!(await c.match(u))){ const r = await fetch(u); if(r.ok) await c.put(u, r); else failed++; } }catch(e){ failed++; } }
    // nice to have offline too, but a county without them is still "saved": boat landings and lake facts, road crossings, stocking
    for(const u of [dataUrl("places/" + id + ".json"), dataUrl("crossings/" + id + ".json"), dataUrl("stocking/" + id + ".json")]){ try{ if(!(await c.match(u))){ const r = await fetch(u); if(r.ok) await c.put(u, r); } }catch(e){} }
    done++; onProgress && onProgress(done, ids.length);
  }
  await countSavedCounties();
  const rec = lsGet("fl.offlineIds", { v:offlineV(), ids:[] });
  lsSet("fl.offlineIds", { v:offlineV(), ids:[...new Set([...(rec.v === offlineV() ? rec.ids : []), ...ids])] });
  return failed;
}
async function offlineAction(which){
  if(offlineBusy) return;
  if(!navigator.onLine){ toast("Connect to the internet to save counties."); return; }
  offlineBusy = true;
  try{ await navigator.storage?.persist?.(); }catch(e){}
  const old = lsGet("fl.offlineIds", null);
  const ids = which === "all" ? counties.map(f => f.id) : which === "refresh" ? (old?.ids || []) : [which];
  const label = which === "all" ? "Wisconsin" : which === "refresh" ? `${ids.length} saved counties` : countyName(which);
  const failed = await saveCountiesOffline(ids, (d, n) => { const el = $("offlineProg"); if(el) el.textContent = `Saving ${d} of ${n} counties…`; });
  offlineBusy = false;
  toast(failed ? `Saved most of ${label}. A few files didn't download; try again on Wi-Fi.` : `${label} is saved for offline use.`);
  renderLog();
}
$("log").addEventListener("click", e => { const b = e.target.closest("[data-offline]"); if(b){ b.disabled = true; offlineAction(b.dataset.offline); } });
function offlineBlock(cid){
  if(!("caches" in window)) return "";
  if(offlineSaved === null){ countSavedCounties().then(() => renderLog()); return ""; }
  if(cid) return offlineSaved.has(cid) ? `<p class="note">Saved for offline: creek names, trout classes, regulations and public land work without signal.</p>`
    : `<div class="row2" style="margin-top:14px"><button class="btn sm" type="button" data-offline="${esc(cid)}">Save ${esc(byId[cid].properties.name)} County for offline</button></div>`;
  const n = offlineSaved.size, old = lsGet("fl.offlineIds", null);
  const stale = old && old.v !== offlineV() && old.ids?.length ? old.ids.filter(id => !offlineSaved.has(id)).length : 0;
  return `<h4><span>Offline maps</span><span>${n}/72 counties saved</span></h4>
    ${stale ? `<div class="card notice"><p style="margin:0 0 8px"><b>The map data was updated.</b> ${stale} of your saved counties need a refresh to keep working offline.</p><div class="row2"><button class="btn sm ink" type="button" data-offline="refresh">Refresh saved counties</button></div></div>` : ""}
    <div class="card"><p>Saved counties keep their creeks and names, trout classes, regulations and public land on this phone, so they work with no signal. Counties you open are saved automatically, and their detailed creek lines once you zoom in close. Tap Save to get everything at once. Your catches still log offline and sync later.</p>
    <div class="row2">${n < 72 ? `<button class="btn sm ink" type="button" data-offline="all">Save all of Wisconsin (about 90 MB)</button>` : `<span class="pill fished">All of Wisconsin is saved</span>`}<span class="hint" id="offlineProg">${offlineBusy ? "Saving…" : ""}</span></div>
    <p class="muted">Use Wi-Fi for the full download. The base map (state, counties and big rivers) is always saved.</p></div>`;
}

/* after a map data update, say so once instead of only showing it in Me -> Offline maps */
let offlineNudged = false;
async function nudgeOfflineRefresh(){
  if(offlineNudged || !navigator.onLine) return; offlineNudged = true;
  const old = lsGet("fl.offlineIds", null);
  if(!old || old.v === offlineV() || !old.ids?.length) return;
  await countSavedCounties();
  const stale = old.ids.filter(id => !offlineSaved?.has(id)).length;
  if(stale) toast(`Map update: ${stale} saved count${stale === 1 ? "y needs" : "ies need"} a refresh for offline use. Me → Offline maps → Refresh saved counties.`);
}


/* ---------- methods ---------- */
const METHODS = { fly:"Fly", spin:"Spinning", baitcast:"Baitcasting", ice:"Ice fishing", trolling:"Trolling", other:"Other" };
function updateFlyLabel(){
  const fly = $("fMethod").value === "fly";
  $("fFlyLbl").textContent = fly ? "Fly" : "Lure or bait";
  $("fFly").placeholder = fly ? "#16 Elk Hair Caddis" : $("fMethod").value === "ice" ? "Waxworm on a jig" : "Mepps spinner";
}
$("fMethod").addEventListener("change", updateFlyLabel);
function fillForOptions(){
  const fr = friendsList();
  $("fFor").innerHTML = `<option value="">Mine</option>` + fr.map(f => `<option value="${esc(f.id)}">${esc(f.name)}'s fish</option>`).join("");
  $("fForRow").hidden = !!editing || !fr.length;
}

/* ---------- titles and badges, worked out from your own catches ---------- */
const sameSp = (c, list) => c.species && list.some(s => c.species.toLowerCase() === s.toLowerCase());
const BASS = ["Smallmouth bass","Largemouth bass"], PANFISH = ["Bluegill","Pumpkinseed","Crappie","Black crappie","White crappie","Yellow perch","Rock bass","Sunfish","Green sunfish"];
const TROUT_ALL = ["Brook trout","Brown trout","Rainbow trout","Tiger trout","Steelhead","Lake trout","Splake"];
const nSp = (cs, list) => cs.filter(c => sameSp(c, list)).reduce((a, c) => a + fishOf(c), 0);
const BADGES = [
  { id:"first", name:"First Fish", desc:"Log your first fish.", goal:1, val:s => s.fish },
  { id:"ten", name:"Double Digits", desc:"Log 10 fish.", goal:10, val:s => s.fish },
  { id:"fifty", name:"Fifty Fish", desc:"Log 50 fish.", goal:50, val:s => s.fish },
  { id:"century", name:"Century Club", desc:"Log 100 fish.", goal:100, val:s => s.fish },
  { id:"brookie", name:"Brookie Hunter", desc:"Catch 10 brook trout.", goal:10, val:s => nSp(s.cs, ["Brook trout"]) },
  { id:"brown", name:"Brown Hound", desc:"Catch 10 brown trout.", goal:10, val:s => nSp(s.cs, ["Brown trout"]) },
  { id:"rainbow", name:"Rainbow Chaser", desc:"Catch 10 rainbow trout.", goal:10, val:s => nSp(s.cs, ["Rainbow trout","Steelhead"]) },
  { id:"bass", name:"Bass Master", desc:"Catch 10 bass.", goal:10, val:s => nSp(s.cs, BASS) },
  { id:"walleye", name:"Walleye Whisperer", desc:"Catch 10 walleye.", goal:10, val:s => nSp(s.cs, ["Walleye","Sauger"]) },
  { id:"pike", name:"Pike Patrol", desc:"Catch 5 northern pike.", goal:5, val:s => nSp(s.cs, ["Northern pike"]) },
  { id:"musky", name:"Fish of 10,000 Casts", desc:"Catch a musky.", goal:1, val:s => nSp(s.cs, ["Musky","Muskellunge"]) },
  { id:"panfish", name:"Panfish Pro", desc:"Catch 25 panfish.", goal:25, val:s => nSp(s.cs, PANFISH) },
  ...[["brookie", "Brookie", ["Brook trout"]], ["brown", "Brown Trout", ["Brown trout"]], ["rainbow", "Rainbow", ["Rainbow trout","Steelhead"]], ["bass", "Bass", BASS], ["walleye", "Walleye", ["Walleye","Sauger"]]]
    .flatMap(([k, label, list]) => [[25, "Regular"], [50, "Fanatic"], [100, "Legend"]].map(([n, word]) => ({ id:k + n, name:`${label} ${word}`, desc:`Catch ${n} ${k === "brookie" ? "brook trout" : k === "bass" ? "bass" : k === "walleye" ? "walleye" : list[0].toLowerCase()}.`, goal:n, val:s => nSp(s.cs, list) }))),
  { id:"pike25", name:"Pike Regular", desc:"Catch 25 northern pike.", goal:25, val:s => nSp(s.cs, ["Northern pike"]) },
  { id:"panfish50", name:"Panfish Fanatic", desc:"Catch 50 panfish.", goal:50, val:s => nSp(s.cs, PANFISH) },
  { id:"panfish100", name:"Panfish Legend", desc:"Catch 100 panfish.", goal:100, val:s => nSp(s.cs, PANFISH) },
  { id:"sturgeon", name:"River Dinosaur", desc:"Catch a sturgeon.", goal:1, val:s => s.cs.some(c => /sturgeon/i.test(c.species || "")) ? 1 : 0 },
  { id:"steelhead", name:"Chrome Chaser", desc:"Catch a steelhead.", goal:1, val:s => s.cs.some(c => /steelhead/i.test(c.species || "")) ? 1 : 0 },
  { id:"waters5", name:"Water Wanderer", desc:"Catch fish in 5 different creeks, rivers or lakes.", goal:5, val:s => s.waters },
  { id:"waters10", name:"Creek Collector", desc:"Catch fish in 10 different waters.", goal:10, val:s => s.waters },
  { id:"waters25", name:"Watershed Rambler", desc:"Catch fish in 25 different waters.", goal:25, val:s => s.waters },
  { id:"waters50", name:"Every Bend", desc:"Catch fish in 50 different waters.", goal:50, val:s => s.waters },
  { id:"twenty", name:"Twenty-Incher", desc:"Land a trout 20 inches or longer.", goal:1, val:s => s.cs.some(c => sameSp(c, TROUT_ALL) && +c.length_in >= 20) ? 1 : 0 },
  { id:"slam", name:"Driftless Grand Slam", desc:"Brook, brown and rainbow trout on the same day.", goal:1, val:s => s.slam ? 1 : 0 },
  { id:"species5", name:"Species Explorer", desc:"Catch 5 different species.", goal:5, val:s => s.species },
  { id:"counties10", name:"County Collector", desc:"Catch fish in 10 counties.", goal:10, val:s => s.counties },
  { id:"counties72", name:"72 Club", desc:"Catch fish in all 72 counties.", goal:72, val:s => s.counties },
  { id:"trips5", name:"Road Tripper", desc:"Take 5 trips.", goal:5, val:s => s.trips },
  { id:"ice", name:"Hard Water", desc:"Catch a fish ice fishing.", goal:1, val:s => s.cs.some(c => c.method === "ice" && fishOf(c) > 0) ? 1 : 0 }
];
function badgeStats(cs = catches){
  const withFish = cs.filter(c => fishOf(c) > 0 && countsForTitles(c));
  const byDay = {}; withFish.forEach(c => (byDay[c.caught_on] ||= new Set()).add((c.species || "").toLowerCase()));
  return { cs: withFish, fish: withFish.reduce((a, c) => a + fishOf(c), 0),
    species: new Set(withFish.map(c => (c.species || "").toLowerCase()).filter(Boolean)).size,
    counties: new Set(withFish.map(c => c.county).filter(Boolean)).size, trips: trips.length,
    waters: new Set(withFish.filter(c => c.water).map(c => c.water.trim().toLowerCase() + "|" + (c.county || ""))).size,   // the same name in two counties is two waters
    slam: Object.values(byDay).some(s => s.has("brook trout") && s.has("brown trout") && s.has("rainbow trout")) };
}
function badges(cs){ const s = badgeStats(cs); return BADGES.map(b => { const v = Math.min(b.goal, b.val(s)); return { ...b, v, earned: v >= b.goal }; }); }
let titlesAll = false;
function titlesHtml(){
  const list = badges(); const got = list.filter(b => b.earned);
  const focus = new Set((fprefs().targets || []).flatMap(t => TARGET_BADGES[t] || []));
  const next = list.filter(b => !b.earned).sort((a, b) => (focus.has(b.id) - focus.has(a.id)) || (b.v / b.goal - a.v / a.goal)).slice(0, 6);
  const hist = catches.filter(beforeJoin).length;
  return `<h4><span>Titles</span><span>${got.length}/${list.length}</span></h4>
    ${got.length ? `<div class="badges">${got.map(b => `<span class="badge on" title="${esc(b.desc)}"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></span>`).join("")}</div>` : `<p class="muted" style="margin:0 0 8px">Log fish to earn titles like Bass Master and Brookie Hunter.</p>`}
    ${hist ? `<p class="note">${hist} catch${hist === 1 ? "" : "es"} from before you joined Coulee ${hist === 1 ? "is" : "are"} in your log and stats, but titles and friend leaderboards only count fish caught since you joined.</p>` : ""}
    ${titlesAll
      ? `<p class="muted" style="margin:10px 0 6px;font-size:13px">Every title (${list.length - got.length} still to earn)</p><div class="badges">${list.filter(b => !b.earned).map(b => `<span class="badge"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><i style="--p:${Math.round(100 * b.v / b.goal)}%"></i><em>${b.v}/${b.goal}</em></span>`).join("")}</div>`
      : next.length ? `<p class="muted" style="margin:10px 0 6px;font-size:13px">Up next</p><div class="badges">${next.map(b => `<span class="badge"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><i style="--p:${Math.round(100 * b.v / b.goal)}%"></i><em>${b.v}/${b.goal}</em></span>`).join("")}</div>` : ""}
    <button class="link" type="button" data-a="alltitles" style="margin-top:6px">${titlesAll ? "Show just what's up next" : `See all ${list.length} titles`}</button>`;
}
function titlePickerHtml(){
  const got = badges().filter(b => b.earned);
  if(!got.length) return "";
  return `<div class="field" style="margin-top:10px"><label for="meTitle">Title shown with your name</label>
    <select id="meTitle"><option value="">None</option>${got.map(b => `<option ${profile?.title === b.name ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>`;
}
$("log").addEventListener("change", async e => {
  if(e.target.id !== "meTitle") return;
  const title = e.target.value || null;
  const { error } = await sb.from("profiles").update({ title }).eq("id", me.id);
  if(error){ toast("Couldn't save your title."); return; }
  profile = { ...profile, title }; saveCache(); toast(title ? `Now showing "${title}"` : "Title removed");
});

/* ---------- celebrate a new catch ---------- */
const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function celebrate(rec, before){
  const lines = [];
  if(rec.species && rec.length_in != null){
    const prev = before.filter(c => c.species && c.species.toLowerCase() === rec.species.toLowerCase() && c.length_in != null);
    if(prev.length && +rec.length_in > Math.max(...prev.map(c => +c.length_in))) lines.push(`New personal best ${rec.species.toLowerCase()}!`);
  }
  const had = new Set(badges(before).filter(b => b.earned).map(b => b.id));
  const fresh = badges().filter(b => b.earned && !had.has(b.id));
  if(rec.lat != null && !calm()){
    const m = L.marker([rec.lat, rec.lng], { interactive:false, keyboard:false, icon:L.divIcon({ className:"", html:`<div class="splash"><i></i><i></i><i></i></div>`, iconSize:[0,0] }) }).addTo(map);
    setTimeout(() => map.removeLayer(m), 1900);
  }
  if(!lines.length && !fresh.length) return;
  const el = $("cheer");
  el.innerHTML = `${fresh.length ? `<small>Title earned</small><b>${esc(fresh.map(b => b.name).join(" · "))}</b>` : ""}${lines.map(l => `<span>${esc(l)}</span>`).join("")}`;
  el.hidden = false; el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
  clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, calm() ? 3000 : 3600);
}

/* ---------- log a fish for a friend ---------- */
async function sendGift(rec, blob, friendId){
  if(!navigator.onLine) throw Object.assign(new Error("offline"), { userMessage:"Logging a friend's fish needs a connection. Try again when you have signal." });
  let photo_path = null;
  if(blob){
    photo_path = `${me.id}/gift-${uuid()}.jpg`;
    const up = await sb.storage.from("photos").upload(photo_path, blob, { contentType:"image/jpeg" });
    if(up.error) throw up.error;
  }
  const catch_ = { species:rec.species, length_in:rec.length_in, count:rec.count, fly:rec.fly, method:rec.method, caught_on:rec.caught_on,
    lat:rec.lat, lng:rec.lng, county:rec.county, notes:rec.notes, photo_taken_on:rec.photo_taken_on, photo_hash:rec.photo_hash, photo_meta:rec.photo_meta, water:rec.water };
  const { error } = await sb.from("catch_gifts").insert({ from_user:me.id, to_user:friendId, catch:catch_, photo_path });
  if(error){ if(photo_path) sb.storage.from("photos").remove([photo_path]); throw error; }
}
let gifts = [], notices = [];
async function loadInbox(){
  if(!me || !navigator.onLine) return;
  const [g, n] = await Promise.all([
    sb.from("catch_gifts").select("*").eq("to_user", me.id).eq("status", "pending").order("created_at", { ascending:false }),
    sb.from("notices").select("*").order("created_at", { ascending:false }).limit(40)
  ]);
  if(!g.error) gifts = g.data || [];
  if(!n.error) notices = n.data || [];
  if(gifts.length){ const ids = gifts.map(x => x.from_user).filter(id => !people[id]); if(ids.length) loadAvatars(ids); }
  renderLog();
}
const giftFrom = g => people[g.from_user]?.display_name || "A friend";
function inboxHtml(){
  const other = notices.filter(n => !n.kind.startsWith("tourney") && n.kind !== "gift");
  if(!gifts.length && !other.length) return "";
  return `${gifts.map(g => { const c = g.catch || {};
      return `<div class="card gift"><div class="acct-h">${avHtml(g.from_user, giftFrom(g))}<span class="t"><b class="wrap">${esc(giftFrom(g))} logged a fish for you</b><small>${esc([c.species || "Fish", c.length_in ? lenTxt(c.length_in) : "", c.caught_on ? fmtDate(c.caught_on) : "", c.county ? countyName(c.county) : "", METHODS[c.method] || ""].filter(Boolean).join(" · "))}</small></span></div>
        ${g.photo_path ? phImg(g.photo_path, `class="gph" data-giftphoto="${esc(g.photo_path)}" alt="Photo of the fish"`) : ""}
        <div class="row2"><button class="btn sm ink" type="button" data-giftyes="${esc(g.id)}">Add to my log</button><button class="btn sm" type="button" data-giftno="${esc(g.id)}">Not mine</button></div></div>`; }).join("")}
    ${other.slice(0, 5).map(n => `<div class="card notice slim"><p><b>${esc(n.title)}</b></p>${n.body ? `<p class="muted">${esc(n.body)}</p>` : ""}<button class="link" type="button" data-noticex="${esc(n.id)}">Dismiss</button></div>`).join("")}`;
}
async function giftPhotoBlob(path){
  const { data, error } = await sb.storage.from("photos").download(path);
  if(error) throw error; return data;
}
$("log").addEventListener("click", async e => {
  const yes = e.target.closest("[data-giftyes]"), no = e.target.closest("[data-giftno]"), x = e.target.closest("[data-noticex]");
  if(x){ notices = notices.filter(n => n.id !== x.dataset.noticex); renderLog(); sb.from("notices").delete().eq("id", x.dataset.noticex); return; }
  if(!yes && !no) return;
  const g = gifts.find(z => z.id === (yes || no).dataset[yes ? "giftyes" : "giftno"]); if(!g) return;
  (yes || no).disabled = true;
  try{
    if(no){ await sb.rpc("decline_gift", { gid:g.id }); toast("Removed."); }
    else{
      let path = null;
      if(g.photo_path){ const blob = await giftPhotoBlob(g.photo_path); path = `${me.id}/${uuid()}-${Date.now()}.jpg`;
        const up = await sb.storage.from("photos").upload(path, blob, { contentType:"image/jpeg" }); if(up.error) throw up.error; }
      const before = catches.slice();
      const { data:cid, error } = await sb.rpc("accept_gift", { gid:g.id, new_photo_path:path, vis:"county" });
      if(error){ if(path) sb.storage.from("photos").remove([path]); throw error; }
      const c = g.catch || {};
      const rec = { id:cid, user_id:me.id, ...c, length_in:c.length_in != null ? +c.length_in : null, count:+c.count || 1, photo_path:path, visibility:"county", created_at:new Date().toISOString() };
      catches = [...catches, rec]; saveCache();
      sb.rpc("auto_enter", { cid }).then(({ data }) => { if(data && data.length){ toast(`Entered in ${data.join(", ")}`); loadTournaments(); } });
      toast("Added to your log. It's set to County only; edit it to change that."); celebrate(rec, before);
    }
    gifts = gifts.filter(z => z.id !== g.id);
    const n = notices.find(z => z.kind === "gift" && z.ref === g.id); if(n){ notices = notices.filter(z => z !== n); sb.from("notices").delete().eq("id", n.id); }
    renderAll();
  }catch(err){ console.error(err); toast(err.message && /handled|cancelled/.test(err.message) ? err.message : "Couldn't do that. Try again."); (yes || no).disabled = false; }
});

/* ---------- tournament updates, owner edits, suggestions ---------- */
function tourneyNoticesHtml(){
  const list = notices.filter(n => n.kind.startsWith("tourney")).slice(0, 8);
  if(!list.length) return "";
  return `<h4><span>Updates</span><span>${list.filter(n => !n.read).length || ""}</span></h4><div class="stack">${list.map(n => `<div class="card notice slim${n.read ? " read" : ""}">
    <p><b>${esc(n.title)}</b> <small class="muted">${esc(fmtDate(n.created_at.slice(0, 10)))}</small></p>${n.body ? `<p>${esc(n.body)}</p>` : ""}
    <div class="row2">${n.ref && tournaments.some(t => t.id === n.ref) ? `<button class="link" type="button" data-tourney="${esc(n.ref)}">Open tournament</button>` : ""}<button class="link" type="button" data-noticex="${esc(n.id)}">Dismiss</button></div></div>`).join("")}</div>`;
}
function markTourneyNoticesRead(){
  const ids = notices.filter(n => n.kind.startsWith("tourney") && !n.read).map(n => n.id);
  if(!ids.length) return;
  setTimeout(() => { notices.forEach(n => { if(ids.includes(n.id)) n.read = true; }); sb.from("notices").update({ read:true }).in("id", ids); $("tDot").hidden = !tournaments.some(t => t.my_status === "invited"); }, 1500);
}
function tourneyToolsHtml(t){
  const isOwner = t.owner === me?.id, joined = t.my_status === "joined", over = tState(t) === "finished";
  let h = "";
  if(isOwner) h += `<button class="btn sm" type="button" data-a="tedit">Edit details</button>`;
  else if(joined) h += `<button class="btn sm" type="button" data-a="tsuggest">Suggest a change</button>`;
  return (h ? `<div class="row2" style="margin-top:10px">${h}</div>` : "") + `<div data-tedit></div>`
    + (over ? `<p class="note">${isOwner ? "This tournament is over. You can still fix the name and description or remove entries; members are told about every change." : "This tournament is over, so entries are locked. Only its creator can change it, and you'll be told if they do."}</p>` : "");
}
$("log").addEventListener("click", async e => {
  const a = e.target.closest("[data-a]"); const t = tournaments.find(x => x.id === tourneyOpen);
  const rm = e.target.closest("[data-townerrm]");
  if(rm && t){ const slot = rm.closest("li").querySelector("[data-rmslot]") || rm.parentElement;
    slot.innerHTML = `<span class="row2"><input data-rmwhy placeholder="Reason (they'll see it)" maxlength="200" style="min-width:140px"><button class="link danger" type="button" data-townerrmyes="${esc(rm.dataset.townerrm)}">Remove</button></span>`; return; }
  const rmy = e.target.closest("[data-townerrmyes]");
  if(rmy && t){ const why = rmy.parentElement.querySelector("[data-rmwhy]")?.value.trim() || null;
    const { error } = await sb.rpc("owner_remove_entry", { tid:t.id, cid:rmy.dataset.townerrmyes, reason:why });
    toast(error ? (error.message || "Couldn't remove it.") : "Entry removed. The angler was told."); openTourney(t.id); loadTournaments(); return; }
  if(!a || !t) return;
  const slot = $("log").querySelector("[data-tedit]");
  if(a.dataset.a === "tedit" && slot){
    slot.innerHTML = `<form class="card" id="teditForm" novalidate style="margin-top:8px">
      <div class="field"><label for="teName">Name</label><input id="teName" maxlength="80" value="${esc(t.name)}"></div>
      <div class="field"><label for="teDesc">Description</label><textarea id="teDesc" maxlength="1000">${esc(t.description || "")}</textarea></div>
      <div class="grid2"><div class="field"><label for="teStart">Starts</label><input id="teStart" type="date" value="${esc(t.starts_on)}"></div><div class="field"><label for="teEnd">Ends</label><input id="teEnd" type="date" value="${esc(t.ends_on)}"></div></div>
      ${"submit_hours" in t ? `<div class="grid2"><div class="field"><label for="teStartTime">Start time</label><input id="teStartTime" type="time" value="${esc((t.start_time || "").slice(0, 5))}"></div><div class="field"><label for="teEndTime">End time</label><input id="teEndTime" type="time" value="${esc((t.end_time || "").slice(0, 5))}"></div></div>
      <div class="field"><label for="teSubmit">Fish can be sent in for</label><select id="teSubmit">${[[0,"Until the fishing ends"],[1,"1 hour after it ends"],[2,"2 hours after"],[6,"6 hours after"],[12,"12 hours after"],[24,"24 hours after"],[48,"2 days after"],[72,"3 days after"]].map(([v, l]) => `<option value="${v}" ${+t.submit_hours === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
      <p class="muted" style="font-size:13px">Members get a notice describing what you changed.</p>
      <span class="hint" id="teErr" role="alert"></span>
      <div class="actions"><button class="btn" type="button" data-a="teditno">Cancel</button><button class="btn ink" type="submit">Save changes</button></div></form>`;
    $("teditForm").addEventListener("submit", async ev => {
      ev.preventDefault(); const err = $("teErr"); err.className = "hint bad";
      const name = $("teName").value.trim(), s = $("teStart").value, en = $("teEnd").value;
      if(name.length < 2){ err.textContent = "Give it a name."; return; }
      if(!s || !en || en < s){ err.textContent = "Check the dates."; return; }
      const upd = { name, description:$("teDesc").value.trim() || null, starts_on:s, ends_on:en };
      if($("teSubmit")){ const st = $("teStartTime").value || null, et = $("teEndTime").value || null;
        if(s === en && st && et && et <= st){ err.textContent = "The end time has to be after the start time."; return; }
        Object.assign(upd, { start_time:st, end_time:et, submit_hours:+$("teSubmit").value }); }
      const { error } = await sb.from("tournaments").update(upd).eq("id", t.id);
      if(error){ err.textContent = /locked/.test(error.message || "") ? "This tournament is finished, so its dates and rules are locked. You can still change the name and description." : "Couldn't save. Try again."; return; }
      toast("Saved. Members were told what changed."); await loadTournaments(); openTourney(t.id);
    });
  }
  if(a.dataset.a === "teditno" && slot) slot.innerHTML = "";
  if(a.dataset.a === "tsuggest" && slot){
    slot.innerHTML = `<form class="card" id="tsugForm" novalidate style="margin-top:8px"><div class="field"><label for="tsBody">What should change?</label><textarea id="tsBody" maxlength="1000" placeholder="My 18-inch brown from Saturday is missing"></textarea></div>
      <span class="hint" id="tsErr" role="alert"></span><div class="actions"><button class="btn" type="button" data-a="teditno">Cancel</button><button class="btn ink" type="submit">Send to ${esc(t.owner_name)}</button></div></form>`;
    $("tsugForm").addEventListener("submit", async ev => {
      ev.preventDefault(); const body = $("tsBody").value.trim();
      const { error } = await sb.rpc("suggest_tournament_change", { tid:t.id, body });
      if(error){ $("tsErr").className = "hint bad"; $("tsErr").textContent = error.message || "Couldn't send it."; return; }
      slot.innerHTML = ""; toast(`Sent to ${t.owner_name}.`);
    });
  }
});

/* ---------- trip plans ---------- */
const DNR = {
  trout:["DNR trout regulations", "https://dnr.wisconsin.gov/topic/fishing/regulations/troutregs.html"],
  streams:["DNR trout stream maps", "https://dnr.wisconsin.gov/topic/fishing/trout/streammaps.html"],
  lakes:["DNR Lake Pages", "https://apps.dnr.wi.gov/lakes/lakepages/Search.aspx"],
  regs:["DNR fishing regulations", "https://dnr.wisconsin.gov/topic/fishing/regulations/hookline.html"]
};
function dnrLinks(kind, trout){
  const l = trout ? [DNR.trout, DNR.streams] : /lake|flowage|pond/i.test(kind || "") ? [DNR.lakes, DNR.regs] : [DNR.regs];
  return l.map(([t, u]) => `<a class="link" href="${u}" target="_blank" rel="noopener">${t}</a>`).join("");
}
let pendingPlanWater = null;
function planChooserHtml(w){
  const today = todayStr();
  const up = trips.filter(t => t.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  return `<div class="planpick"><p style="margin:0 0 6px"><b>Add ${esc(w.name)} to a trip</b></p>
    ${up.map(t => `<button class="btn sm" type="button" data-planto="${esc(t.id)}">${esc(t.name)} · ${esc(fmtRange(t.start_date, t.end_date))}</button>`).join("")}
    <button class="btn sm ink" type="button" data-planto="new">${icon("i-plus")}New trip</button></div>`;
}
function addWaterToTrip(t, w){
  const list = Array.isArray(t.waters) ? t.waters.slice() : [];
  if(list.some(x => x.name === w.name && x.county === w.county)){ toast(`${w.name} is already on that trip.`); return; }
  list.push(w);
  saveRecord("trips", { ...t, waters:list }, null, true);
  toast(`Added ${w.name} to ${t.name}.`);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-planto]"); if(!b || !pendingPlanWater) return;
  map.closePopup();
  const w = pendingPlanWater;
  if(b.dataset.planto === "new"){ openTripForm(null); $("tName").value = `${w.name} trip`; return; }
  const t = trips.find(x => x.id === b.dataset.planto); if(t){ addWaterToTrip(t, w); pendingPlanWater = null; }
});
function tripPlanHtml(t){
  const ws = Array.isArray(t.waters) ? t.waters : [];
  if(!ws.length) return t.end_date >= todayStr() ? `<p class="note">Plan this trip: tap a creek or lake on the map and choose <b>Plan a trip</b>.</p>` : "";
  return `<h4><span>Planned water</span><span>${ws.length}</span></h4><ul class="list">${ws.map((w, i) => `<li class="item planw" style="cursor:default;grid-template-columns:1fr auto">
    <span class="t"><b class="wrap">${esc(w.name)}</b><small>${esc([w.kind, w.trout, w.county ? countyName(w.county) : ""].filter(Boolean).join(" · "))}</small>
      <span class="row2 links">${w.lat != null ? `<a class="link" href="${gmaps(w.lat, w.lng)}" target="_blank" rel="noopener">Directions</a><button class="link" type="button" data-planshow="${i}">Show on map</button>` : ""}${dnrLinks(w.kind, w.trout)}</span></span>
    <button class="link danger" type="button" data-planrm="${i}">Remove</button></li>`).join("")}</ul>
    <p class="note">Tap any creek or lake and choose <b>Plan a trip</b> to add more. Check the DNR regulations for each water before you go.</p>`;
}
$("log").addEventListener("click", e => {
  const t = trips.find(x => x.id === tripOpen); if(!t) return;
  const rm = e.target.closest("[data-planrm]");
  if(rm){ const list = (t.waters || []).filter((_, i) => i !== +rm.dataset.planrm); saveRecord("trips", { ...t, waters:list }, null, true); return; }
  const sh = e.target.closest("[data-planshow]");
  if(sh){ const w = (t.waters || [])[+sh.dataset.planshow]; if(!w) return;
    if(w.county && currentCounty !== w.county){ currentCounty = w.county; $("backBtn").hidden = false; setMask(w.county); showDetail(w.county); countyLayer.setStyle(countyStyle); }
    map.flyTo([w.lat, w.lng], 14, { duration:.6 }); }
});

/* ---------- catches outside Wisconsin ---------- */
const NEIGHBOR_POLYS = (GEO.neighbors.features || []).map(f => {
  const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const hit = NEIGHBOR_NAMES.find(([, la, ln]) => polys.some(p => inPoly(ln, la, p)));
  return { name: hit ? hit[0][0] + hit[0].slice(1).toLowerCase() : null, polys };
}).filter(x => x.name);
function stateAt(lat, lng){
  if(lat == null) return null;
  if(countyAt(lat, lng)) return "Wisconsin";
  const n = NEIGHBOR_POLYS.find(x => x.polys.some(p => inPoly(lng, lat, p)));
  return n ? n.name : "Somewhere else";
}
function outsideHtml(){
  const out = catches.filter(c => !c.county && c.lat != null);
  if(!out.length) return "";
  const by = {}; out.forEach(c => (by[stateAt(c.lat, c.lng)] ||= []).push(c));
  return `<h4><span>Outside Wisconsin</span><span>${out.reduce((a, c) => a + fishOf(c), 0)} fish</span></h4>
    ${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([st, cs]) => `<p class="muted" style="margin:8px 0 4px;font-weight:700">${esc(st)}</p><ul class="list">${cs.sort(byDateDesc).map(itemCatch).join("")}</ul>`).join("")}
    <p class="note">These are saved with their exact location. When Coulee adds more states, they'll file into the right state and county on their own.</p>`;
}


/* ---------- step-by-step help for saving photo locations, with a photo checker ---------- */
const CAM_PATH = { ios:"Settings → Privacy & Security → Location Services → Camera → While Using the App, and turn on Precise Location",
  android:"Camera app → Settings (gear) → Location tags (or Save location) → On" };
// a small drawing of each settings screen, with the row to tap marked
const phone = (title, rows) => `<div class="phone"><div class="ph-top"><span>${esc(title)}</span></div>${rows.map(([t, o = {}]) =>
  `<div class="ph-row${o.hit ? " hit" : ""}${o.dim ? " dim" : ""}"><span>${o.check ? "✓ " : ""}${esc(t)}</span>${o.toggle != null ? `<i class="tg${o.toggle ? " on" : ""}"></i>` : o.value ? `<em>${esc(o.value)}</em>` : o.check || (o.dim && title === "Camera") ? "" : `<b>›</b>`}</div>`).join("")}</div>`;
const CAM_STEPS = {
  ios: [
    ["Open the Settings app", "It's the gray gear on your Home Screen. Scroll down to <b>Privacy &amp; Security</b> and tap it.",
      phone("Settings", [["Screen Time"], ["General"], ["Privacy & Security", { hit:true }], ["App Store", { dim:true }]])],
    ["Tap Location Services", "It's the first row. Make sure the switch at the top of the next screen is <b>on</b>.",
      phone("Privacy & Security", [["Location Services", { hit:true, value:"On" }], ["Tracking", { dim:true }], ["Contacts", { dim:true }]])],
    ["Find Camera in the list", "Scroll down the list of apps and tap <b>Camera</b>.",
      phone("Location Services", [["Location Services", { toggle:true }], ["Calendar", { dim:true, value:"Never" }], ["Camera", { hit:true, value:"Never" }], ["Clock", { dim:true, value:"Never" }]])],
    ["Choose While Using the App", "Then turn on <b>Precise Location</b> so it pins the exact bend in the creek, not just the area.",
      phone("Camera", [["Never", { dim:true }], ["Ask Next Time", { dim:true }], ["While Using the App", { hit:true, check:true }], ["Precise Location", { hit:true, toggle:true }]])]
  ],
  android: [
    ["Open your Camera app", "Tap the <b>gear</b> (Settings) in the camera. On some phones it's under the ☰ or ⋮ menu.",
      phone("Camera", [["Photo", { dim:true }], ["Settings", { hit:true }]])],
    ["Turn on location", "Look for <b>Location tags</b>, <b>Save location</b> or <b>Geotag</b> and switch it on.",
      phone("Camera settings", [["Grid lines", { dim:true, toggle:false }], ["Location tags", { hit:true, toggle:true }], ["Shutter sound", { dim:true, toggle:true }]])],
    ["Allow location for the camera", "If your phone asks, allow location <b>While using the app</b>, with precise location on.", ""]
  ]
};
let camOs = isIOS ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "ios";
function renderCamSteps(){
  $("camOs").querySelectorAll("[data-os]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.os === camOs)));
  $("camSteps").innerHTML = `<ol class="camsteps">${CAM_STEPS[camOs].map(([t, d, pic]) => `<li><b>${t}</b><p>${d}</p>${pic}</li>`).join("")}</ol>
    <div class="campath"><small>${esc(CAM_PATH[camOs])}</small><button class="btn sm" type="button" id="camCopy">Copy steps</button></div>
    <p class="muted" style="font-size:13px;margin:6px 0 0">Your phone won't let apps open these settings for you, so switch to Settings, follow the steps, then come back.${camOs === "ios" ? " Photos you already took won't gain a location; new ones will." : ""}</p>`;
}
function openCamHelp(){ renderCamSteps(); $("camResult").innerHTML = ""; $("camTest").value = ""; $("camHelp").hidden = false; $("camHelp").querySelector(".sheet").scrollTop = 0; }
$("camOs").addEventListener("click", e => { const b = e.target.closest("[data-os]"); if(b){ camOs = b.dataset.os; renderCamSteps(); } });
$("camDone").onclick = () => { $("camHelp").hidden = true; };
$("camHelp").addEventListener("click", async e => {
  if(e.target === $("camHelp")) $("camHelp").hidden = true;
  if(e.target.id === "camCopy"){ try{ await navigator.clipboard.writeText(CAM_PATH[camOs]); toast("Copied. Open Settings and follow along."); }catch(_){ toast(CAM_PATH[camOs]); } }
});
document.addEventListener("click", e => { if(e.target.closest("[data-camhelp]")){ e.preventDefault(); openCamHelp(); } });
$("camTest").addEventListener("change", async () => {
  const f = $("camTest").files[0], out = $("camResult"); if(!f) return;
  let ex = null; try{ ex = readExif(await f.arrayBuffer()); }catch(e){}
  const gps = ex && ex.lat != null, date = ex && ex.date;
  const where = gps ? countyAt(ex.lat, ex.lng) : null;
  const line = (ok, t) => `<li class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${t}</li>`;
  out.innerHTML = `<ul class="camcheck">${line(gps, gps ? `Location saved${where ? ` (${esc(countyName(where))})` : ""}` : "No location in this photo")}${line(!!date, date ? "Date saved" : "No date in this photo")}</ul>
    <p style="margin:6px 0 0">${gps && date ? "You're all set. Catches logged with photos like this fill in on their own."
      : gps ? "The location works. The missing date usually means a screenshot or an edited copy, so use the original photo."
      : date ? "Your camera isn't saving locations yet. Follow the steps above, take a new photo, and test again. If the setting is already on and this still says no location, your phone may be removing it when the photo is picked; tap <b>Here</b> at the water instead."
      : "This photo has no camera data at all. Screenshots, downloads and photos sent through some apps lose it. Test a photo taken with your Camera app."}</p>`;
});


/* ---------- test versions: the founder and admins get new builds first; the founder releases them ---------- */
const CHANNEL = CFG.channel || "stable", BUILD = CFG.build || 0;
let liveBuild = CHANNEL === "stable" ? BUILD : null, betaBuild = CHANNEL === "beta" ? BUILD : null, gateBuild = null, betaNote = "";
async function readBuild(base){ try{ const r = await fetch(base + "build.json?t=" + Date.now(), { cache:"no-store" }); return r.ok ? (await r.json()).build : null; }catch(e){ return null; } }
const wantsBeta = () => isStaff() && lsGet("fl.useBeta", true);
async function routeChannel(){
  if(!profile || accountState() !== "ok" || !navigator.onLine) return;
  if(CHANNEL === "stable" && wantsBeta()){
    betaBuild = await readBuild("beta/");
    if(betaBuild && betaBuild > BUILD){ location.replace("beta/" + location.hash); return; }
  }
  if(CHANNEL === "beta" && !wantsBeta()){ location.replace("../" + location.hash); return; }
  if(CHANNEL === "beta"){
    liveBuild = await readBuild("../");
    try{ betaNote = (await (await fetch("build.json?t=" + Date.now(), { cache:"no-store" })).json()).note || ""; }catch(e){}
    const { data } = await sb.from("release_gate").select("approved_build").eq("id", 1).maybeSingle(); gateBuild = data?.approved_build ?? null;
    $("testPill").hidden = false; $("testPill").textContent = `Test · build ${BUILD}`;
    if(tab === "me") renderLog();
  }
}
function channelHtml(){
  const opt = `<label class="check" style="margin-top:8px"><input type="checkbox" id="useBeta" ${lsGet("fl.useBeta", true) ? "checked" : ""}> Get new versions before everyone else</label>`;
  if(CHANNEL !== "beta") return `<h4><span>Updates</span><span>build ${BUILD}</span></h4><div class="card"><p style="margin:0">You're on the same version as everyone${betaBuild && betaBuild > BUILD ? `. A test version (build ${betaBuild}) is ready.` : ". No test version is waiting."}</p>${opt}</div>`;
  const ahead = liveBuild != null && BUILD > liveBuild, approved = gateBuild != null && gateBuild >= BUILD;
  return `<h4><span>Test version</span><span>build ${BUILD}</span></h4><div class="card notice">
    <p style="margin:0 0 6px"><b>${ahead ? `You're trying build ${BUILD}. Everyone else has build ${liveBuild}.` : "This test version matches what everyone has."}</b></p>
    ${ahead && betaNote ? `<p style="margin:0 0 6px">${esc(betaNote)}${/creek/i.test(betaNote) ? ". Zoom in close on a few creeks to check them." : ""}</p>` : ""}
    ${ahead ? (approved ? `<p class="muted" style="margin:0">Approved. It reaches everyone within about 15 minutes, and their app updates the next time they open it.</p>`
      : isFounder() ? `<p class="muted" style="margin:0 0 8px">Try it out. When you're happy, release it. Until then only you and admins have it.</p><div class="row2"><button class="btn sm ink" type="button" data-approve="${BUILD}">Release build ${BUILD} to everyone</button></div>`
      : `<p class="muted" style="margin:0">Only the founder can release it to everyone.</p>`) : ""}
    ${opt}</div>`;
}
$("log").addEventListener("change", e => { if(e.target.id === "useBeta"){ lsSet("fl.useBeta", e.target.checked); toast(e.target.checked ? "You'll get new versions first." : "You'll get updates with everyone else."); setTimeout(routeChannel, 300); } });
$("log").addEventListener("click", async e => {
  const a = e.target.closest("[data-approve]"); if(!a) return;
  if(a.dataset.sure !== "1"){ a.dataset.sure = "1"; a.textContent = "Tap again to release to everyone"; return; }
  a.disabled = true;
  const { error } = await sb.rpc("approve_build", { b:+a.dataset.approve });
  if(error){ toast(error.message || "Couldn't approve."); a.disabled = false; return; }
  gateBuild = +a.dataset.approve; toast("Released. Everyone gets it within about 15 minutes."); renderLog();
});


/* ---------- tapping the map close in highlights a county instead of jumping into it ---------- */
pane("outline", 432, false);
let outlineLayer = null;
function clearOutline(){ if(outlineLayer){ map.removeLayer(outlineLayer); outlineLayer = null; } }
function outlineCounty(id){
  clearOutline();
  if(!byId[id]) return;
  outlineLayer = L.geoJSON(byId[id], { pane:"outline", interactive:false, style:{ color:css("--hl"), weight:3, opacity:.95, fill:true, fillColor:css("--hl"), fillOpacity:.06 } }).addTo(map);
}
function tapCounty(latlng){
  const id = countyAt(latlng.lat, latlng.lng);
  if(!id || id === currentCounty) return;
  if(!currentCounty && map.getZoom() < AREA_ZOOM){ openCounty(id); return; }   // statewide: a tap opens the county (the county shape's own tap usually got here first)
  outlineCounty(id);
  const s = countyStats(id);
  L.popup({ maxWidth:240, className:"cpop" }).setLatLng(latlng).setContent(`<div class="pop"><h3>${esc(countyName(id))}</h3>
    <div class="meta">${s.spots} spot${s.spots === 1 ? "" : "s"} · ${s.fish} fish</div>
    <div class="row"><button class="btn sm ink" type="button" data-opencounty="${esc(id)}">Open county</button></div></div>`).openOn(map);
}
map.on("popupclose", () => setTimeout(() => { if(!map._popup || !map.hasLayer(map._popup)) clearOutline(); }, 0));
document.addEventListener("click", e => { const b = e.target.closest("[data-opencounty]"); if(!b) return; map.closePopup(); openCounty(b.dataset.opencounty); });

/* ---------- zooming well out of an open county leaves it, like "All of Wisconsin" (without moving the map) ---------- */
map.on("zoomend", () => {
  if(!currentCounty || picking || countyOpenZoom == null) return;
  if(map.getZoom() <= countyOpenZoom - 1.5) leaveCounty();
});
function leaveCounty(){
  currentCounty = null; countyOpenZoom = null; clearDetail(); setMask(null); $("backBtn").hidden = true;
  countyLayer.setStyle(countyStyle); updateZoomLayers(); renderLog(); setTimeout(updateArea, 0);
}

/* ---------- cards stay clear of the search bar and the buttons ---------- */
L.Popup.mergeOptions({ autoPanPaddingTopLeft:L.point(16, 150), autoPanPaddingBottomRight:L.point(16, 110) });

/* ---------- phone: the map key folds down to one small button ---------- */
(() => {
  const lg = $("legend"); if(!lg) return;
  const b = document.createElement("button"); b.type = "button"; b.className = "lgkey"; lg.prepend(b);
  const small = () => window.innerWidth < 700 || window.innerHeight < 520;   // phones, upright or on their side
  let open = lsGet("fl.legendOpen", !small());
  const sync = () => { lg.classList.toggle("folded", !open); b.textContent = open ? "Hide key" : "Map key"; b.setAttribute("aria-expanded", String(open)); };
  b.onclick = () => { open = !open; lsSet("fl.legendOpen", open); sync(); };
  sync();
})();


/* ---------- delete my account (required by the App Store): removes the profile, all entries and photos ---------- */
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  const slot = $("log").querySelector("[data-delslot]");
  if(a.dataset.a === "delacct" && slot){
    slot.innerHTML = `<div class="card notice" style="margin-top:10px">
      <p><b>Delete your Coulee account?</b></p>
      <p>This permanently removes your profile, every catch, spot, trip, photo, message and forum post, your friends list and your tournament entries. It can't be undone.</p>
      <p class="muted">Want a copy first? Tap <b>Download a copy</b> above.</p>
      <label for="delConfirm">Type DELETE to confirm</label>
      <input id="delConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <span class="hint" id="delMsg" role="alert"></span>
      <div class="row2" style="margin-top:8px"><button class="btn" type="button" data-a="delcancel">Keep my account</button><button class="btn danger" type="button" data-a="delgo">Delete forever</button></div></div>`;
    setTimeout(() => $("delConfirm")?.focus(), 50);
  }
  if(a.dataset.a === "delcancel" && slot) slot.innerHTML = "";
  if(a.dataset.a === "delgo"){
    const msg = $("delMsg");
    if(($("delConfirm").value || "").trim().toUpperCase() !== "DELETE"){ msg.className = "hint bad"; msg.textContent = "Type DELETE to confirm."; return; }
    if(!navigator.onLine){ msg.className = "hint bad"; msg.textContent = "You need a connection to delete your account."; return; }
    a.disabled = true; msg.className = "hint"; msg.textContent = "Deleting your photos…";
    try{
      // photos and avatar live in folders named after the account
      for(const bucket of ["photos", "avatars"]){
        for(let round = 0; round < 50; round++){
          const { data, error } = await sb.storage.from(bucket).list(me.id, { limit:1000 });
          if(error || !data || !data.length) break;
          const paths = data.filter(f => f.name).map(f => `${me.id}/${f.name}`);
          if(!paths.length) break;
          const rm = await sb.storage.from(bucket).remove(paths); if(rm.error) break;
        }
      }
      msg.textContent = "Deleting your account…";
      const { error } = await sb.rpc("delete_my_account", { confirm:"DELETE" });
      if(error) throw error;
      try{ const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if(sub) await sub.unsubscribe(); }catch(e){}
      try{ for(const k of Object.keys(localStorage)) if(k.startsWith("fl.")) localStorage.removeItem(k); indexedDB.deleteDatabase("flylog"); }catch(e){}
      await forgetPhotos(); await sb.auth.signOut().catch(() => {});
      document.body.innerHTML = `<div style="max-width:420px;margin:20vh auto;padding:24px;font:16px/1.5 system-ui;text-align:center"><h2 style="font-family:Georgia,serif">Your account is deleted</h2><p>Everything you logged in Coulee has been removed. Thanks for fishing with us.</p><p><a href="./">Back to Coulee</a></p></div>`;
    }catch(e){
      a.disabled = false; msg.className = "hint bad";
      msg.textContent = e && /founder|DELETE|Sign in/.test(e.message || "") ? e.message : "Couldn't delete your account. Check your connection and try again.";
    }
  }
});


/* ---------- a friend's map: only what they share with you, in friend blue ---------- */

function personName(id){ return people[id]?.display_name || friendCatches.find(c => c.user_id === id)?.display_name || friendSpots.find(s => s.user_id === id)?.display_name || follows.find(f => f.user_id === id)?.display_name || "Friend"; }
function friendSpotPopup(s){
  const div = document.createElement("div"); div.className = "pop";
  div.innerHTML = `<div class="meta" style="color:var(--friend);font-weight:700">${esc(s.display_name)}'s spot</div>
    <h3>${esc(s.name || "Spot")}</h3>
    <div class="meta">${esc([s.water, s.trout_class, s.status === "want" ? "Wants to fish" : s.status === "scouted" ? "Scouted" : s.status === "fished" ? "Fished" : "", countyName(s.county)].filter(Boolean).join(" · "))}</div>
    <div class="row">${mapLinks(s.lat, s.lng)}${mapPerson ? "" : `<button class="link" type="button" data-pmap="${esc(s.user_id)}">See ${esc((s.display_name || "their").split(" ")[0])}'s map</button>`}</div>`;
  return div;
}
function openPersonMap(id){
  mapPerson = id; map.closePopup();
  document.getElementById("map").classList.add("personmode");
  setTab("map"); if(typeof setCollapsed === "function") setCollapsed(true);
  renderAll(); countyLayer.setStyle(countyStyle); personBar();
  const items = [...friendCatches, ...friendSpots].filter(x => x.user_id === id && x.lat != null);
  const pts = items.map(x => [x.lat, x.lng]), cids = [...new Set(items.map(x => x.county).filter(Boolean))];
  if(cids.length === 1){ // all in one county: open it so the creeks are there, then frame their fish
    map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom:13, padding:[60,60] });
  } else { backToState(); if(pts.length) setTimeout(() => map.fitBounds(L.latLngBounds(pts).pad(.2), { maxZoom:9, padding:[60,60] }), 300); }
}
function closePersonMap(){
  mapPerson = null; document.getElementById("map").classList.remove("personmode"); $("personBar").hidden = true; renderAll(); countyLayer.setStyle(countyStyle);
}
function personBar(){
  const b = $("personBar"); if(!mapPerson){ b.hidden = true; return; }
  const fc = friendCatches.filter(c => c.user_id === mapPerson), fs = friendSpots.filter(s => s.user_id === mapPerson);
  const fish = fc.reduce((a, c) => a + fishOf(c), 0), onMap = fc.filter(c => c.lat != null).length + fs.filter(s => s.lat != null).length;
  const byCounty = fc.length + fs.length - onMap;
  b.innerHTML = `${avHtml(mapPerson, personName(mapPerson), "sm")}<span class="t"><b>${esc(personName(mapPerson))}'s map</b><small>${fish} fish · ${fs.length} spot${fs.length === 1 ? "" : "s"} shared with you${byCounty ? ` · ${byCounty} by county only` : ""}</small></span><button class="btn sm" type="button" id="personDone">Done</button>`;
  b.hidden = false; $("personDone").onclick = closePersonMap;
}
document.addEventListener("click", e => { const p = e.target.closest("[data-pmap]"); if(p){ e.preventDefault(); openPersonMap(p.dataset.pmap); } });

/* ---------- "My pins off": hide spots, catches and county fish counts (showing a friend, planning on your phone) ---------- */
hidePins = lsGet("fl.hidePins", false);
function syncPins(){ const b = $("pinsToggle"); b.setAttribute("aria-pressed", String(!hidePins)); b.textContent = hidePins ? "My pins off" : "My pins on"; document.getElementById("map").classList.toggle("nopins", hidePins); }
$("pinsToggle").onclick = () => { hidePins = !hidePins; lsSet("fl.hidePins", hidePins); syncPins(); renderAll(); countyLayer.setStyle(countyStyle); toast(hidePins ? "Your spots and catches are hidden on the map." : "Your spots and catches are back."); };
syncPins();

/* ---------- a friend's page: picture, bio, title and the fish they share with you ---------- */
function openPerson(id){
  const pr = people[id] || follows.find(f => f.user_id === id) || {}, name = personName(id);
  const fc = friendCatches.filter(c => c.user_id === id), fs = friendSpots.filter(s => s.user_id === id);
  const fish = fc.reduce((a, c) => a + fishOf(c), 0), species = new Set(fc.map(c => c.species).filter(Boolean)).size;
  const waters = new Set(fc.map(c => c.water).filter(Boolean)).size, counties = new Set(fc.map(c => c.county).filter(Boolean)).size;
  const withPhotos = fc.filter(c => c.photo_path).slice(0, 60);
  const biggest = fc.filter(c => c.length_in).sort((a, b) => b.length_in - a.length_in)[0];
  const isFriend = friendships.some(f => f.status === "accepted" && (f.requester === id || f.addressee === id));
  const v = document.createElement("div"); v.className = "scrim"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", name);
  v.innerHTML = `<div class="sheet person">
    <div class="phead">${avHtml(id, name, "lg")}<div><h2>${esc(name)}</h2>${pr.username ? `<div class="muted">@${esc(pr.username)}</div>` : ""}${titlePill(id)}</div></div>
    ${pr.bio ? `<p class="pbio">${esc(pr.bio)}</p>` : ""}
    <div class="pstats"><div><b>${fish}</b><span>fish</span></div><div><b>${species}</b><span>species</span></div><div><b>${waters || counties}</b><span>${waters ? "waters" : "counties"}</span></div>${biggest ? `<div><b>${+biggest.length_in}"</b><span>biggest</span></div>` : ""}</div>
    ${withPhotos.length ? `<div class="pgrid">${withPhotos.map(c => `<button type="button" class="pcell" data-pcatch="${esc(c.id)}" aria-label="${esc(c.species || "Catch")}">${phImg(c.photo_path, `alt="${esc(c.species || "Catch")}" loading="lazy"`)}<span>${esc(c.species || "")}${c.length_in ? ` · ${+c.length_in}"` : ""}</span></button>`).join("")}</div>`
      : `<p class="muted">${fish ? "No photos shared with you yet." : `${esc(name.split(" ")[0])} hasn't shared any fish with you yet.`}</p>`}
    <p class="note">Only the fish and spots ${esc(name.split(" ")[0])} shares with you show here${fs.length ? `, plus ${fs.length} spot${fs.length === 1 ? "" : "s"} on their map` : ""}.</p>
    <div class="row2"><button class="btn sm" type="button" data-pmap="${esc(id)}">Their map</button>${isFriend ? `<button class="btn sm" type="button" data-chat="${esc(id)}">Message</button>` : ""}<button class="btn ink sm" type="button" data-close>Close</button></div></div>`;
  v.addEventListener("click", ev => {
    if(ev.target === v || ev.target.closest("[data-close],[data-pmap],[data-chat]")) { setTimeout(() => v.remove(), 0); return; }
    const pc = ev.target.closest("[data-pcatch]"); if(pc){ const c = fc.find(x => x.id === pc.dataset.pcatch); if(c) showPersonCatch(c, v); }
  });
  document.body.appendChild(v); hydratePhotos();
}
function showPersonCatch(c, host){
  const box = document.createElement("div"); box.className = "scrim"; box.setAttribute("role", "dialog");
  box.innerHTML = `<div class="sheet"><div class="pbig">${[c.photo_path, ...morePaths(c)].filter(Boolean).map(ph => phImg(ph, `alt="${esc(c.species || "Catch")} photo"`)).join("")}</div>
    <h3 style="margin:0">${esc(c.species || "Catch")}${c.length_in ? ` · ${+c.length_in}"` : ""}${c.weight_lb ? ` · ${wtTxt(c.weight_lb)}` : ""}</h3>
    <div class="meta">${esc([c.water, countyName(c.county), c.fly, c.caught_on ? fmtDate(c.caught_on) : ""].filter(Boolean).join(" · "))}</div>
    ${c.notes ? `<p>${esc(c.notes)}</p>` : ""}
    <div class="row2">${c.lat != null ? `<button class="btn sm" type="button" data-onmap>Show on map</button>` : ""}<button class="btn ink sm" type="button" data-close>Back</button></div></div>`;
  box.addEventListener("click", ev => {
    if(ev.target.closest("[data-onmap]")){ box.remove(); host.remove(); setTab("map"); if(typeof setCollapsed === "function") setCollapsed(true); map.setView([c.lat, c.lng], Math.max(map.getZoom(), 13)); return; }
    if(ev.target === box || ev.target.closest("[data-close]")) box.remove();
  });
  document.body.appendChild(box); hydratePhotos();
}
document.addEventListener("click", e => { const p = e.target.closest("[data-person]"); if(p && !e.target.closest("[data-pmap],[data-chat],[data-unfriend],[data-unfollow]")){ e.preventDefault(); openPerson(p.dataset.person); } });


/* ---------- where am I: show your position and mark a spot or catch right there ---------- */
pane("me", 640, true);
let hereLayer = null, hereFix = null;
const locateCtl = L.control({ position:"topright" });
locateCtl.onAdd = () => {
  const b = L.DomUtil.create("button", "locbtn");
  b.type = "button"; b.title = "Show where I am"; b.setAttribute("aria-label", "Show where I am");
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  L.DomEvent.disableClickPropagation(b);
  b.addEventListener("click", locateMe);
  return b;
};
locateCtl.addTo(map);
// keep the location button under the zoom buttons and above the map style switch
setTimeout(() => { const z = document.querySelector(".leaflet-control-zoom"), lb = document.querySelector(".locbtn"); if(z && lb) z.after(lb); }, 0);

function hereHtml(fix, near){
  const w = pickWater(near);
  return `<div class="pop"><h3>You're here</h3>
    <div class="meta">${w ? `<b>${esc(w.name)}</b> · ${esc(distTxt(w.dist))}` : near[0] ? `Nearest named water: ${esc(near[0].name)}, ${esc(distTxt(near[0].dist))}` : "No named water close by"}</div>
    <div class="meta">${fix.cid ? esc(countyName(fix.cid)) : "Outside Wisconsin"} · accurate to about ${Math.max(10, Math.round(fix.acc * 3.281 / 10) * 10)} ft</div>
    ${canWrite ? `<div class="row"><button class="btn sm" type="button" data-here="spot">${icon("i-pin")}Add spot here</button><button class="btn sm" type="button" data-here="catch">${icon("i-fish")}Log a catch here</button></div>` : ""}</div>`;
}
function locateMe(){
  const b = document.querySelector(".locbtn");
  if(!navigator.geolocation){ toast("This phone can't share its location with Coulee."); return; }
  b?.classList.add("busy");
  navigator.geolocation.getCurrentPosition(async pos => {
    b?.classList.remove("busy");
    const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy || 30;
    hereFix = { lat, lng, acc, cid:countyAt(lat, lng) };
    if(hereLayer) map.removeLayer(hereLayer);
    hereLayer = L.layerGroup([
      L.circle([lat, lng], { radius:acc, pane:"me", color:"#2F7BF5", weight:1, fillColor:"#2F7BF5", fillOpacity:.12, interactive:false }),
      L.marker([lat, lng], { pane:"me", icon:L.divIcon({ className:"", html:`<div class="hereDot"></div>`, iconSize:[18,18], iconAnchor:[9,9] }), keyboard:false })
    ]).addTo(map);
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration:.7 });
    const near = await watersNear(lat, lng).catch(() => []);
    const pop = L.popup({ className:"hpop", offset:[0, -6], maxWidth:300, autoPanPaddingTopLeft:L.point(16, 150), autoPanPaddingBottomRight:L.point(16, 90) }).setLatLng([lat, lng]).setContent(hereHtml(hereFix, near));
    setTimeout(() => pop.openOn(map), 750);
    hereLayer.eachLayer(l => l instanceof L.Marker && l.on("click", () => pop.openOn(map)));
  }, err => {
    b?.classList.remove("busy");
    if(err.code === 1) toast(isIOS ? "Location is off for Coulee. Settings → Privacy & Security → Location Services → Safari Websites (or Coulee) → While Using." : "Location is blocked. Allow it in your browser's site settings.");
    else toast("Couldn't get a fix. Try again with a clearer view of the sky.");
  }, { enableHighAccuracy:true, timeout:20000, maximumAge:15000 });
}
document.addEventListener("click", async e => {
  const h = e.target.closest("[data-here]"); if(!h || !hereFix) return;
  map.closePopup();
  const near = await watersNear(hereFix.lat, hereFix.lng).catch(() => []), w = pickWater(near);
  const t = w && hereFix.cid && troutCache[hereFix.cid]?.t?.find(x => x[0] === w.name);
  if(h.dataset.here === "spot") openForm("spot", null, { lat:hereFix.lat, lng:hereFix.lng, name:w ? w.name : "", water:w ? (/river/i.test(w.kind) ? "River" : /lake|flowage|pond/i.test(w.kind) ? "Lake" : "Creek") : "Creek", trout_class:t ? TROUT[t[1]].label : "", status:"fished" });
  else openForm("catch", null, { lat:hereFix.lat, lng:hereFix.lng });
});


/* ---------- photo fingerprints: a 64-bit "difference hash" that survives resizing and re-saving ---------- */
async function dhash(blob){
  let bmp; try{ bmp = await createImageBitmap(blob); }catch(e){ bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); }); }
  const cv = document.createElement("canvas"); cv.width = 9; cv.height = 8;
  const g = cv.getContext("2d", { willReadFrequently:true }); g.drawImage(bmp, 0, 0, 9, 8);
  const d = g.getImageData(0, 0, 9, 8).data, lum = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
  let bits = "";
  for(let y = 0; y < 8; y++) for(let x = 0; x < 8; x++) bits += lum((y * 9 + x) * 4) > lum((y * 9 + x + 1) * 4) ? "1" : "0";
  let hex = ""; for(let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
const kmBetween = (a, b) => { const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
// what the photo itself says, compared with what was logged (only distances and dates are kept, never the photo's coordinates)
function photoMeta(ex, entry){
  const gps = !!(ex && ex.lat != null), date = ex && ex.date ? (ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/) || []).slice(1).join("-") || null : null;
  return { has_exif: !!(gps || date), gps, photo_date: date,
    km_from_entry: gps && entry ? Math.round(kmBetween({ lat:ex.lat, lng:ex.lng }, entry) * 10) / 10 : null };
}
// older photos get a fingerprint in the background, a few at a time
let backfilling = false;
async function backfillHashes(){
  if(backfilling || !navigator.onLine || !me) return; backfilling = true;
  try{
    const todo = catches.filter(c => c.photo_path && !c.photo_hash && !c._pending && !pendingPhotoUrls[c.photo_path]).slice(0, 8);
    for(const c of todo){
      const { data, error } = await sb.storage.from("photos").download(c.photo_path); if(error || !data) continue;
      const h = await dhash(data);
      const u = await sb.from("catches").update({ photo_hash:h }).eq("id", c.id);
      if(!u.error) c.photo_hash = h;
    }
    if(todo.length) saveCache();
  }catch(e){ console.warn("fingerprints", e); } finally { backfilling = false; }
}
function touchActive(){
  const d = todayStr(); if(lsGet("fl.active", "") === d) return;
  sb.rpc("touch_active").then(({ error }) => { if(!error) lsSet("fl.active", d); });
}

/* ---------- review queue (founder and admins) ---------- */
const FLAG_LABEL = { duplicate:"Same photo as another catch", no_camera_data:"No camera data", location_mismatch:"Photo taken elsewhere", date_mismatch:"Photo date doesn't match" };
let flagList = null, flagCount = 0, flagShowAll = false;
async function loadFlags(){
  if(!isStaff()) return;
  const { data, error } = await sb.rpc("flag_queue", { show: flagShowAll ? "all" : "open" });
  if(error) return;
  flagList = data || [];
  if(!flagShowAll) flagCount = flagList.length;
  $("meDot").hidden = !(pendingCount || flagCount);
  if(tab === "me") renderLog();
}
function flagQueueHtml(){
  if(!flagList){ loadFlags(); return `<h4><span>Fair play review</span></h4><p class="status">Loading…</p>`; }
  const byCatch = {}; flagList.forEach(f => (byCatch[f.catch_id] ||= []).push(f));
  const groups = Object.values(byCatch);
  return `<h4><span>Fair play review</span><span>${flagCount} open</span></h4>
    <p class="muted" style="margin:0 0 8px;font-size:13.5px">Flags are hints, not proof. Phones sometimes drop photo data, and friends sometimes share one photo. Look before you hide anything.</p>
    <div class="row2" style="margin-bottom:8px"><label class="check" style="margin:0"><input type="checkbox" id="flagAll" ${flagShowAll ? "checked" : ""}> Show reviewed flags too</label></div>
    ${groups.length ? `<div class="stack">${groups.map(fs => { const f = fs[0], open = fs.some(x => x.status === "open");
      return `<div class="card flag${open ? "" : " done"}">
        <p class="muted" style="font-size:12.5px;margin:0">${esc(f.display_name)} · ${esc(f.species || "Fish")}${f.length_in ? ` · ${lenTxt(f.length_in)}` : ""} · ${esc(fmtDate(f.caught_on))} · ${esc(countyName(f.county))}${f.tournaments?.length ? ` · <b>In ${esc(f.tournaments.join(", "))}</b>` : ""}</p>
        <div class="flagpics">${f.photo_path ? `<figure>${phImg(f.photo_path, 'alt="Flagged photo" loading="lazy"')}<figcaption>This catch</figcaption></figure>` : ""}
          ${f.other_photo ? `<figure>${phImg(f.other_photo, 'alt="Matching photo" loading="lazy"')}<figcaption>Match: ${esc(f.other_name || "")}</figcaption></figure>` : ""}</div>
        <ul class="flagwhy">${fs.map(x => `<li><b>${esc(FLAG_LABEL[x.kind] || x.kind)}</b> ${esc(x.detail || "")}${x.status !== "open" ? ` <span class="pill ${x.status === "upheld" ? "priv" : "fished"}">${x.status === "upheld" ? "Hidden" : "Cleared"}</span>` : ""}</li>`).join("")}</ul>
        ${open ? `<div class="row2"><button class="btn sm" type="button" data-flagok="${esc(f.id)}">Looks fine</button><button class="btn sm" type="button" data-flaghide="${esc(f.id)}">Hide this catch…</button></div><div data-flagslot="${esc(f.id)}"></div>` : ""}</div>`; }).join("")}</div>`
      : `<p class="muted">Nothing to review. Every photo checks out.</p>`}`;
}
$("log").addEventListener("change", e => { if(e.target.id === "flagAll"){ flagShowAll = e.target.checked; flagList = null; renderLog(); } });
$("log").addEventListener("click", async e => {
  const ok = e.target.closest("[data-flagok]"), hide = e.target.closest("[data-flaghide]"), yes = e.target.closest("[data-flaghideyes]");
  if(hide){ const slot = $("log").querySelector(`[data-flagslot="${hide.dataset.flaghide}"]`);
    slot.innerHTML = `<div class="card" style="margin-top:8px"><div class="field"><label>Reason the angler will see</label><input data-flagnote maxlength="200" placeholder="Same photo as an earlier catch"></div>
      <p class="muted" style="font-size:13px">Hiding removes it from feeds, leaderboards and tournaments. It stays in their own log, and they get a notice.</p>
      <div class="row2"><button class="btn sm ink" type="button" data-flaghideyes="${esc(hide.dataset.flaghide)}">Hide catch</button></div></div>`; return; }
  if(!ok && !yes) return;
  const id = (ok || yes).dataset[ok ? "flagok" : "flaghideyes"]; (ok || yes).disabled = true;
  const note = yes ? yes.closest(".card").querySelector("[data-flagnote]")?.value.trim() || null : null;
  const { error } = await sb.rpc("review_flag", { fid:id, verdict: ok ? "cleared" : "upheld", note });
  toast(error ? (error.message || "Couldn't save.") : ok ? "Cleared." : "Hidden. The angler was told.");
  flagList = null; loadFlags();
});

/* ---------- tournament creators see flags on their entries ---------- */
let tourneyFlags = {};
async function loadTourneyFlags(t){
  if(!t || !(t.owner === me?.id || isStaff())) return;
  const { data, error } = await sb.rpc("tournament_flags", { tid:t.id });
  if(error) return;
  tourneyFlags[t.id] = {}; (data || []).forEach(f => (tourneyFlags[t.id][f.catch_id] ||= []).push(f));
  if(tourneyOpen === t.id && tab === "tourney") renderLog();
}
function entryFlagHtml(tid, cid){
  const fs = tourneyFlags[tid]?.[cid]; if(!fs || !fs.length) return "";
  return ` <span class="pill flagpill" title="${esc(fs.map(f => (FLAG_LABEL[f.kind] || f.kind) + ": " + (f.detail || "")).join("\n"))}">⚑ ${esc(FLAG_LABEL[fs[0].kind] || "Flagged")}${fs.length > 1 ? ` +${fs.length - 1}` : ""}</span>`;
}

/* ---------- founder analytics: totals and trends only, never who did what ---------- */
let statsData = null;
async function loadFounderStats(){ const { data, error } = await sb.rpc("founder_stats"); statsData = error ? { error:true } : data; if(tab === "me" && meView === "analytics") renderLog(); }
function barsSvg(vals, labels, { h = 110, color = "var(--spot)", every = 1 } = {}){
  const W = 320, n = vals.length, bw = W / n, max = Math.max(1, ...vals);
  return `<svg class="chart" viewBox="0 0 ${W} ${h + 18}" role="img"><line x1="0" y1="${h}" x2="${W}" y2="${h}" stroke="var(--line)"/>
    ${vals.map((v, i) => { const bh = Math.round(v / max * (h - 14)); return `<rect x="${i * bw + 1.5}" y="${h - bh}" width="${Math.max(1, bw - 3)}" height="${bh}" rx="1.5" fill="${v ? color : "var(--line)"}"><title>${esc(labels[i])}: ${v}</title></rect>${v && n <= 14 ? `<text x="${i * bw + bw / 2}" y="${h - bh - 3}" text-anchor="middle">${v}</text>` : ""}${i % every === 0 ? `<text x="${i * bw + bw / 2}" y="${h + 13}" text-anchor="middle">${esc(labels[i])}</text>` : ""}`; }).join("")}</svg>`;
}
function rankTable(rows, head){ return rows.length ? `<table class="tbl"><thead><tr><th>${head}</th><th class="n">Fish</th></tr></thead><tbody>${rows.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No data yet.</p>`; }
function renderAnalytics(el){
  const back = `<button class="link backlink" data-me="creator" type="button">${icon("i-back")}Founder tools</button><div class="eyebrow">Founder</div><h2>Analytics</h2>`;
  if(!statsData){ el.innerHTML = back + `<p class="status">Counting…</p>`; loadFounderStats(); return; }
  if(statsData.error){ el.innerHTML = back + `<p class="muted">Couldn't load analytics. Try again.</p>`; return; }
  const s = statsData, a = s.accounts || {}, t = s.totals || {}, tn = s.tournaments || {};
  const day = s.active_days || [], wk = s.signups_weeks || [], mo = s.catches_months || [], tm = s.tournament_months || [];
  const md = d => { const x = new Date(d + "T12:00:00"); return `${x.getMonth() + 1}/${x.getDate()}`; }, mon = m => MON[+m.slice(5, 7) - 1];
  el.innerHTML = back + `<p class="muted" style="margin:0 0 10px">Totals and trends only. Nothing here shows who did what or where anyone fishes.</p>
    <div class="stats four"><div class="stat"><b>${a.approved ?? 0}</b><span>anglers</span></div><div class="stat"><b>${s.active_7 ?? 0}</b><span>active this week</span></div><div class="stat"><b>${s.active_30 ?? 0}</b><span>active this month</span></div><div class="stat"><b>${a.pending ?? 0}</b><span>waiting</span></div></div>
    <div class="stats four"><div class="stat f"><b>${t.fish ?? 0}</b><span>fish logged</span></div><div class="stat"><b>${t.photos ?? 0}</b><span>photos</span></div><div class="stat"><b>${s.trips ?? 0}</b><span>trips</span></div><div class="stat"><b>${s.flags_open ?? 0}</b><span>open flags</span></div></div>
    <h4><span>People opening the app</span><span>last 30 days</span></h4>${barsSvg(day.map(x => x[1]), day.map(x => md(x[0])), { every:5 })}
    <h4><span>New accounts</span><span>by week</span></h4>${barsSvg(wk.map(x => x[1]), wk.map(x => md(x[0])), { every:2, color:"var(--friend)" })}
    <h4><span>Fish caught</span><span>by month</span></h4>${barsSvg(mo.map(x => x[1]), mo.map(x => mon(x[0])), { color:"var(--fish)" })}
    <h4><span>When catches get logged</span><span>hour of day</span></h4>${barsSvg(s.catch_hours || [], Array.from({ length:24 }, (_, h) => h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p"), { every:3 })}
    <h4><span>Busiest days</span></h4>${barsSvg(s.catch_weekdays || [], ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"])}
    <h4><span>Tournaments</span><span>${tn.total ?? 0} total</span></h4>
    <p style="margin:0 0 6px">${tn.live ?? 0} live · ${tn.upcoming ?? 0} upcoming · ${tn.finished ?? 0} finished · ${tn.open ?? 0} open to everyone · ${tn.entries ?? 0} entries</p>
    ${barsSvg(tm.map(x => x[1]), tm.map(x => mon(x[0])), { h:80, color:"var(--t2)" })}
    <h4><span>Top species</span></h4>${rankTable(s.species || [], "Species")}
    <h4><span>Methods</span></h4>${rankTable((s.methods || []).map(([m, n]) => [METHODS[m] || m, n]), "Method")}
    <h4><span>Busiest counties</span></h4>${rankTable((s.counties || []).map(([c, n]) => [countyName(c), n]), "County")}
    <p class="note">${a.public ?? 0} public profiles · ${a.with_picture ?? 0} with a picture · ${s.friendships ?? 0} friendships · ${s.spots ?? 0} spots · ${t.outside_wi ?? 0} catches outside Wisconsin. "Active" counts anyone who opened the app that day, once.</p>`;
}

/* ---------- suggestion triage labels ---------- */
const SUG_CAT = { bug:"Bug", idea:"Idea", question:"Question", other:"Other" };
function triageHtml(s){ return s.category || s.triage_note ? `<p class="triage">${s.category ? `<span class="pill ${s.category === "bug" ? "want" : "scouted"}">${SUG_CAT[s.category]}</span> ` : ""}${s.triage_note ? esc(s.triage_note) : ""}</p>` : ""; }

/* ---------- more on the map: boat landings, shore fishing, road crossings, lake facts, DNR stocking ----------
   One small file per county for each kind (data/places, data/crossings, data/stocking), loaded for the counties on screen.
   Landings and shore-fishing sites show from a regional zoom; road crossings only up close, and only the ones on screen. */
const placesCache = {}, crossCache = {}, stockCache = {};
const PLACE_ZOOM = 10.5, CROSS_ZOOM = 12.5;
let showLandings = lsGet("fl.landings", true), showCrossings = lsGet("fl.crossings", true);
const landingLayer = L.layerGroup(), crossLayer = L.layerGroup();
const optJSON = (cache, path, id, empty) => getJSON(cache, path, id).catch(() => (cache[id] = empty));
const getPlaces = id => optJSON(placesCache, dataUrl("places/" + id + ".json"), id, { b:[], s:[], l:[], k:[] });
// what each DNR lake type means and what the fishing is like: the same words for every lake of a type, so they're kept once
let lakeClasses = null;
const getLakeClasses = () => lakeClasses ? Promise.resolve(lakeClasses) : fetch(dataUrl("lakeclasses.json")).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => (lakeClasses = j));
const getCrossings = id => optJSON(crossCache, dataUrl("crossings/" + id + ".json"), id, []);
const getStocking = id => optJSON(stockCache, dataUrl("stocking/" + id + ".json"), id, []);
const PLACE_SVG = {
  boat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18l-2.2 4.2a2 2 0 0 1-1.8 1H7a2 2 0 0 1-1.8-1L3 15z" fill="currentColor"/><path d="M12 3v10M12 4l6 8h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  carry: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 14c3-4 16-4 19 0-3 4-16 4-19 0z" fill="currentColor"/><path d="M7 8l10 12M17 8L7 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  shore: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20L17 4M17 4c2.5 2 3 5 1 8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="18" cy="15" r="1.7" fill="currentColor"/><path d="M3 21h9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
  park: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20V4h5a4.5 4.5 0 0 1 0 9H8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cross: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9h20M2 15h20" stroke="currentColor" stroke-width="2.2"/><path d="M6 15c0-4 12-4 12 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
};
const nice = s => String(s || "").toLowerCase().replace(/\b[a-z]/g, m => m.toUpperCase()).replace(/\bDnr\b/g, "DNR").replace(/\bUs\b/g, "US").replace(/\bUsfs\b/g, "USFS");
const yesish = v => /^(y|yes|true|1)$/i.test(String(v || ""));
function landingPopup(kind, r){
  const div = document.createElement("div"); div.className = "pop";
  if(kind === "s"){
    const [lat, lng, name, water, url] = r;
    div.innerHTML = `<h3>${esc(nice(name) || "Shore fishing site")}</h3><div class="meta">Shore fishing${water ? ` · ${esc(nice(water))}` : ""}</div>
      <div class="row">${mapLinks(lat, lng)}${url && /^https?:\/\//.test(url) ? `<a class="link" href="${esc(url)}" target="_blank" rel="noopener">DNR page</a>` : ""}</div><small class="src">From the Wisconsin DNR's shore fishing sites.</small>`;
  } else {
    const [lat, lng, name, type, ramp, ada, water, owner] = r, carry = /carry/i.test(type || "");
    const bits = [carry ? "Carry-in access (no ramp)" : ramp && !/unknown|none/i.test(ramp) ? `${nice(ramp)} ramp` : /ramp/i.test(type || "") ? "Boat ramp" : "Boat access", yesish(ada) ? "Accessible features" : "", owner ? `Managed by ${nice(owner)}` : ""].filter(Boolean);
    div.innerHTML = `<h3>${esc(nice(name) || "Boat landing")}</h3><div class="meta">${carry ? "Carry-in landing" : "Boat landing"}${water ? ` · ${esc(nice(water))}` : ""}</div>
      <ul class="facts">${bits.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="row">${mapLinks(lat, lng)}</div><small class="src">From the Wisconsin DNR's boat access list. Fees and parking aren't listed; check the sign at the landing.</small>`;
  }
  return div;
}
function parkPopup(r){
  const [lat, lng, name, note] = r, div = document.createElement("div"); div.className = "pop";
  div.innerHTML = `<h3>${esc(nice(name) || "DNR parking lot")}</h3><div class="meta">DNR parking lot</div>${note ? `<p class="note" style="margin:8px 0">${esc(note)}</p>` : ""}
    <div class="row">${mapLinks(lat, lng)}</div><small class="src">From the Wisconsin DNR's list of parking lots on its lands.</small>`;
  return div;
}
function crossPopup(r){
  const [lat, lng, road, stream, cls] = r, div = document.createElement("div"); div.className = "pop";
  div.innerHTML = `<h3>${esc(road)}</h3><div class="meta">Road crossing · ${esc(stream)}${TROUT[cls] ? ` · <span class="tclass" style="background:var(${TROUT[cls].tok})">${TROUT[cls].label} trout</span>` : ""}</div>
    <p class="note" style="margin:8px 0">Public road crossings are a common way onto a stream. Park safely and legally off the road, stay in the water or within the road's right-of-way, and respect any posted signs. Not every crossing has room to park.</p>
    <div class="row">${mapLinks(lat, lng)}</div><small class="src">Worked out from U.S. Census road lines and DNR trout streams, so a few may be private or impassable.</small>`;
  div.addEventListener("click", ev => { if(ev.target.closest(".tclass")) showClassHelp(); });
  return div;
}
const placeIcon = (cls, svg, title) => L.divIcon({ className:"", html:`<div class="mk-place ${cls}" title="${esc(title)}">${svg}</div>`, iconSize:[0, 0] });
let placesSeq = 0;
/* Pins are kept from one map move to the next: only pins that left the screen are removed and only new ones are added.
   (Redrawing them all on every move closed an open card the moment the map nudged itself to fit it, and made the pins blink.) */
function keepPins(layer, store, wanted){
  for(const [k, m] of store) if(!wanted.has(k)){ layer.removeLayer(m); store.delete(k); }
  for(const [k, make] of wanted) if(!store.has(k)){ const m = make(); store.set(k, m); layer.addLayer(m); }
}
const landingPins = new Map(), crossPins = new Map();
async function syncPlaces(){
  const seq = ++placesSeq, z = map.getZoom();
  const ids = [...new Set([...areaWant, currentCounty].filter(Boolean))];
  const wantL = showLandings && !hidePins && (z >= PLACE_ZOOM || !!currentCounty) && ids.length, wantC = showCrossings && z >= CROSS_ZOOM && ids.length;
  if(!wantL) keepPins(landingLayer, landingPins, new Map());
  if(!wantC) keepPins(crossLayer, crossPins, new Map());
  if(!wantL && !wantC) return;
  const b = map.getBounds().pad(.15), inView = r => r[0] != null && b.contains([r[0], r[1]]);
  if(wantL){
    const all = await Promise.all(ids.map(getPlaces)); if(seq !== placesSeq) return;
    const want = new Map(), pin = (kind, r, cls, svg, title, zi, pop) => want.set(kind + r[0] + "," + r[1] + r[2], () => L.marker([r[0], r[1]], { icon:placeIcon(cls, svg, title), zIndexOffset:zi }).bindPopup(pop, { maxWidth:300 }));
    for(const p of all){
      for(const r of p.b || []) if(inView(r)){ const carry = /carry/i.test(r[3] || ""); pin("b", r, carry ? "carry" : "boat", PLACE_SVG[carry ? "carry" : "boat"], nice(r[2]) || "Boat landing", -200, () => landingPopup("b", r)); }
      for(const r of p.k || []) if(inView(r) && z >= 11.5) pin("k", r, "park", PLACE_SVG.park, nice(r[2]) || "DNR parking lot", -300, () => parkPopup(r));
      for(const r of p.s || []) if(inView(r)) pin("s", r, "shore", PLACE_SVG.shore, nice(r[2]) || "Shore fishing", -200, () => landingPopup("s", r));
    }
    keepPins(landingLayer, landingPins, want);
  }
  if(wantC){
    const all = await Promise.all(ids.map(getCrossings)); if(seq !== placesSeq) return;
    const want = new Map(); let n = 0;
    for(const list of all) for(const r of list){ if(n >= 220) break; if(!inView(r) || troutShow[r[4]] === false) continue; n++;
      want.set(r[0] + "," + r[1], () => L.marker([r[0], r[1]], { icon:placeIcon("cross", PLACE_SVG.cross, `${r[2]} over ${r[3]}`), zIndexOffset:-400 }).bindPopup(() => crossPopup(r), { maxWidth:300 })); }
    keepPins(crossLayer, crossPins, want);
  }
}
landingLayer.addTo(map); crossLayer.addTo(map);
document.addEventListener("mapsettled", syncPlaces);
function syncPlaceKey(){
  const a = $("landingToggle"), c = $("crossToggle");
  a.setAttribute("aria-pressed", String(showLandings)); a.textContent = showLandings ? "Boat landings on" : "Boat landings off";
  c.setAttribute("aria-pressed", String(showCrossings)); c.textContent = showCrossings ? "Road crossings on" : "Road crossings off";
}
$("landingToggle").onclick = () => { showLandings = !showLandings; lsSet("fl.landings", showLandings); syncPlaceKey(); syncPlaces(); if(showLandings && map.getZoom() < PLACE_ZOOM && !currentCounty) toast("Boat landings show when you zoom in a bit."); };
$("crossToggle").onclick = () => { showCrossings = !showCrossings; lsSet("fl.crossings", showCrossings); syncPlaceKey(); syncPlaces(); if(showCrossings && map.getZoom() < CROSS_ZOOM) toast("Road crossings show when you zoom in close to a trout stream."); };
syncPlaceKey();

/* lake facts and stocking on a water's card */
const sameWater = (a, b) => { const n = s => String(s || "").toLowerCase().replace(/\b(the|lake|creek|river|pond|flowage|branch|fork|springs?)\b|[^a-z0-9]/g, ""); const x = n(a), y = n(b); return !!x && x === y; };
function lakeFactsHtml(name, ll, cid){
  const p = placesCache[cid]; if(!p || !p.l) return "";
  const hits = p.l.filter(r => sameWater(r[2], name)); if(!hits.length) return "";
  const r = hits.sort((a, b) => (a[0] == null ? 9 : d2([a[1], a[0]], [ll.lng, ll.lat])) - (b[0] == null ? 9 : d2([b[1], b[0]], [ll.lng, ll.lat])))[0];
  const [, , , wbic, cls, acres, depth] = r, [desc, fish] = (lakeClasses && lakeClasses[cls]) || [r[7], r[8]];
  const rows = [acres ? `<div><span>Size</span>${Math.round(acres).toLocaleString()} acres</div>` : "", depth ? `<div><span>Deepest</span>${Math.round(depth)} ft</div>` : "",
    cls ? `<div><span>Lake type</span>${esc(nice(cls).replace(/-/g, ", "))}</div>` : "", fish ? `<div><span>Fishery</span>${esc(fish)}</div>` : "", desc && !fish ? `<div><span>About</span>${esc(desc)}</div>` : ""].filter(Boolean);
  return rows.length ? `<div class="regs"><b>Lake facts</b>${rows.join("")}<small>From the DNR's lake classification.${wbic ? ` <a class="link" href="https://apps.dnr.wi.gov/lakes/lakepages/LakeDetail.aspx?wbic=${encodeURIComponent(wbic)}" target="_blank" rel="noopener">DNR lake page</a>` : ""}</small></div>` : "";
}
function stockingHtml(name, cid){
  const rows = (stockCache[cid] || []).filter(r => sameWater(r[1], name) || sameWater(r[3], name)); if(!rows.length) return "";
  const yrs = [...new Set(rows.map(r => r[0]))].sort((a, b) => b - a).slice(0, 3);
  const line = r => `${r[7] != null ? Number(r[7]).toLocaleString() + " " : ""}${esc((r[4] || "fish").toLowerCase())}${r[6] ? ` (${esc(r[6].toLowerCase())}${r[8] ? `, ${Number(r[8]).toFixed(1)}″` : ""})` : r[8] ? ` (${Number(r[8]).toFixed(1)}″)` : ""}`;
  return `<div class="regs"><b>DNR stocking</b>${yrs.map(y => `<div><span>${y}</span>${rows.filter(r => r[0] === y).slice(0, 4).map(line).join("; ")}</div>`).join("")}<small>From the DNR's stocking records, posted once a year after they're checked. Private and tribal stocking isn't included.</small></div>`;
}
waterPopupExtras.push((div, info) => {
  const cid = info.cid || countyAt(info.ll.lat, info.ll.lng); if(!cid) return;
  const slot = document.createElement("div"); div.querySelector(".coords").before(slot);
  const fill = () => { slot.innerHTML = (info.isLake ? lakeFactsHtml(info.name, info.ll, cid) : "") + stockingHtml(info.name, cid); if(slot.innerHTML) refitPopup(slot); };
  Promise.all([info.isLake ? getPlaces(cid) : null, getStocking(cid), info.isLake ? getLakeClasses() : null]).then(fill);
});


/* ---------- terrain shading: soft hillshade under the field map, so coulees and ridges show ---------- */
pane("hill", 396, false);
const hillLayer = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
  { pane:"hill", minZoom:7, maxNativeZoom:16, maxZoom:18, crossOrigin:true, updateWhenIdle:false, keepBuffer:4,
    bounds:L.latLngBounds([[42.0, -93.3], [47.6, -86.2]]) });   // only Wisconsin: outside its data the service sends blank grey tiles
// the shading is blended onto what's beneath it; give it a plain paper backdrop so it never shows as grey rectangles
pane("hillbase", 379, false);   // under the land and fishing-region tints, so it only fills the background
const hillBase = L.rectangle([[-85, -180], [85, 180]], { pane:"hillbase", stroke:false, fillOpacity:1, interactive:false, className:"hillbase" });
let terrainOn = lsGet("fl.terrain", true);
function syncTerrain(){
  const on = terrainOn && mapView === "field";
  if(on && !map.hasLayer(hillLayer)){ hillBase.addTo(map); hillLayer.addTo(map); }
  if(!on && map.hasLayer(hillLayer)){ map.removeLayer(hillLayer); map.removeLayer(hillBase); }
  const b = $("terrainToggle");
  if(b){ b.hidden = mapView !== "field"; b.setAttribute("aria-pressed", String(terrainOn)); b.textContent = terrainOn ? "Terrain on" : "Terrain off"; }
}
$("terrainToggle").onclick = () => { terrainOn = !terrainOn; lsSet("fl.terrain", terrainOn); syncTerrain(); };
document.addEventListener("mapview", syncTerrain);
syncTerrain();

/* ---------- moving water: a slow drift along trout streams when zoomed in close ---------- */
pane("flow", 433, false);
const flowRenderer = L.svg({ pane:"flow", padding:.5 });
let flowLayer = null, flowKey = "";
function updateFlow(){
  const z = map.getZoom(), ids = [detailFor, ...areaOn].filter(id => id && troutCache[id]);
  const want = !calm() && z >= 13 && ids.length && mapView !== "sat";
  const key = want ? `${ids.join(",")}:${Math.round(z)}:${map.getBounds().pad(.3).toBBoxString()}` : "";
  if(key === flowKey) return; flowKey = key;
  if(flowLayer){ map.removeLayer(flowLayer); flowLayer = null; }
  if(!want) return;
  const b = map.getBounds().pad(.3), g = L.layerGroup();
  for(const [, c, , , paths] of ids.flatMap(id => troutCache[id].t)){
    if(!TROUT[c]) continue;
    for(const pa of paths){
      const ll = smoothPath(pa.map(q => [q[1], q[0]]));
      if(ll.length < 2 || !ll.some(p => b.contains(p))) continue;
      g.addLayer(L.polyline(ll, { renderer:flowRenderer, interactive:false, className:"flow", color:"#fff", weight:z >= 15 ? 2.4 : 1.8, opacity:.8, lineCap:"round" }));
    }
  }
  flowLayer = g.addTo(map);
}
document.addEventListener("mapsettled", updateFlow);
document.addEventListener("mapview", updateFlow);
document.addEventListener("areachange", updateFlow);

/* ---------- keeping the map smooth ---------- */
// The soft shadow under the state outline only shows when you can see the whole state. Zoomed in it is off screen,
// but the browser still re-blurs the whole (now enormous) shape on every zoom: so it's switched off up close.
function syncStateShadow(){ const on = map.getZoom() < 8.5; stateFill.eachLayer(l => { if(l._path) l._path.classList.toggle("state-shadow", on); }); }
map.on("zoomend", syncStateShadow); syncStateShadow();
// the drifting-water animation rests while the map is being dragged or zoomed, so the two aren't fighting for the same frames
map.on("movestart zoomstart", () => map.getContainer().classList.add("moving"));
map.on("moveend zoomend", () => map.getContainer().classList.remove("moving"));


/* ---------- weight ---------- */
function parseWeight(v){
  v = String(v || "").trim().toLowerCase(); if(!v) return null;
  let m = v.match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|#)?\s*(?:,|and)?\s*(?:(\d+(?:\.\d+)?)\s*(?:oz|ounces?))?$/);
  if(m && (m[2] || /lb|#|pound/.test(v) || !/oz/.test(v))) return Math.round((+m[1] + (m[2] ? +m[2] / 16 : 0)) * 100) / 100;
  m = v.match(/^(\d+(?:\.\d+)?)\s*(?:oz|ounces?)$/); if(m) return Math.round(+m[1] / 16 * 100) / 100;
  m = v.match(/^(\d+)\s*-\s*(\d+)$/); if(m) return Math.round((+m[1] + +m[2] / 16) * 100) / 100;
  return NaN;
}
function wtTxt(w){ w = +w; if(!w) return ""; const lb = Math.floor(w), oz = Math.round((w - lb) * 16); return lb ? `${lb} lb${oz ? ` ${oz} oz` : ""}` : `${oz} oz`; }
const TROUTISH = /trout|steelhead|splake|salmon/i;
function syncWeightRow(force){
  const sp = $("fSpecies").value, show = force || !!$("fWt").value || (sp && !TROUTISH.test(sp)) || $("fMethod").value !== "fly" || prefWantsWeight();
  $("fWtRow").hidden = !show; $("fWtAdd").hidden = show;
}
$("fWtAdd").onclick = () => { syncWeightRow(true); $("fWt").focus(); };
$("fSpecies").addEventListener("input", () => syncWeightRow());
$("fMethod").addEventListener("change", () => syncWeightRow());
$("fWt").addEventListener("input", () => { const w = parseWeight($("fWt").value), h = $("fWtHint");
  h.className = "hint" + (Number.isNaN(w) ? " bad" : ""); h.textContent = w == null ? "" : Number.isNaN(w) ? "Try 3.5 or 3 lb 8 oz" : wtTxt(w); });

/* ---------- catches from before someone joined ---------- */
const joinDay = () => profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-CA", { timeZone:"America/Chicago" }) : "0000-00-00";
const beforeJoin = c => !!c && (c.before_join === true || (!c.display_name && c.caught_on && c.caught_on < joinDay()));
const countsForTitles = c => !beforeJoin(c);

/* ---------- how you fish: tailors defaults, species and titles ---------- */
const PREF_METHODS = [["fly","Fly"],["spin","Spin & bait"],["ice","Ice"],["mix","A bit of everything"]];
const PREF_TARGETS = [["trout","Trout"],["bass","Bass"],["walleye","Walleye"],["pike","Pike & musky"],["panfish","Panfish"],["salmon","Salmon & steelhead"],["catfish","Catfish"]];
const PREF_WATERS = [["streams","Creeks & rivers"],["lakes","Lakes"],["both","Both"]];
const TARGET_SPECIES = { trout:["Brook trout","Brown trout","Rainbow trout","Tiger trout"], bass:["Smallmouth bass","Largemouth bass"], walleye:["Walleye","Sauger"],
  pike:["Northern pike","Musky"], panfish:["Bluegill","Crappie","Yellow perch","Pumpkinseed","Rock bass"], salmon:["Chinook salmon","Coho salmon","Steelhead","Lake trout"], catfish:["Channel catfish","Flathead catfish","Bullhead"] };
const TARGET_BADGES = { trout:["brookie","brown","rainbow","twenty","slam","brookie25","brown25","rainbow25","steelhead","waters5"], bass:["bass","bass25"], walleye:["walleye","walleye25"], pike:["pike","musky","pike25"], panfish:["panfish","panfish50"], salmon:["rainbow","steelhead"], catfish:[] };
const fprefs = () => profile?.fishing_prefs || {};
const prefWantsWeight = () => { const t = fprefs().targets || []; return t.some(x => x !== "trout") && !t.includes("trout") || fprefs().method === "spin" || fprefs().method === "ice"; };
function applyPrefs(){
  const p = fprefs();
  // species suggestions: what you chase first
  const dl = $("speciesList"); if(dl && !dl.dataset.base) dl.dataset.base = dl.innerHTML;
  if(dl){ const want = (p.targets || []).flatMap(t => TARGET_SPECIES[t] || []);
    const tmp = document.createElement("div"); tmp.innerHTML = dl.dataset.base;
    const opts = [...tmp.querySelectorAll("option")].map(o => o.value || o.textContent);
    const ordered = [...want, ...opts.filter(o => !want.includes(o))];
    dl.innerHTML = ordered.map(o => `<option>${esc(o)}</option>`).join(""); }
  const sub = document.querySelector(".brand-sub, .brand small, header .sub");
  if(sub) sub.textContent = !p.method || p.method === "fly" ? "Wisconsin fly fishing" : "Wisconsin fishing";
}
function defaultMethod(){ const p = fprefs().method; return p && p !== "mix" ? p : lsGet("fl.method", "fly"); }
function prefsHtml(){
  const p = fprefs(), t = new Set(p.targets || []);
  return `<h4><span>How you fish</span></h4><div class="card prefs">
    <p class="muted" style="margin:0 0 8px;font-size:13.5px">Coulee sets its defaults, species list and title goals around this. You can still log anything.</p>
    <p class="plabel">Mostly</p><div class="chips">${PREF_METHODS.map(([k, l]) => `<button type="button" class="chip" data-pm="${k}" aria-pressed="${p.method === k}">${l}</button>`).join("")}</div>
    <p class="plabel">You go after</p><div class="chips">${PREF_TARGETS.map(([k, l]) => `<button type="button" class="chip" data-pt="${k}" aria-pressed="${t.has(k)}">${l}</button>`).join("")}</div>
    <p class="plabel">Usually on</p><div class="chips">${PREF_WATERS.map(([k, l]) => `<button type="button" class="chip" data-pw="${k}" aria-pressed="${p.waters === k}">${l}</button>`).join("")}</div></div>`;
}
async function savePrefs(next){
  const fishing_prefs = { ...fprefs(), ...next };
  profile = { ...profile, fishing_prefs }; saveCache(); applyPrefs(); renderLog();
  const { error } = await sb.from("profiles").update({ fishing_prefs }).eq("id", me.id);
  if(error) toast("Couldn't save that. It'll stay on this phone for now.");
}
$("log").addEventListener("click", e => {
  const m = e.target.closest("[data-pm]"); if(m){ savePrefs({ method:m.dataset.pm }); return; }
  const w = e.target.closest("[data-pw]"); if(w){ savePrefs({ waters:w.dataset.pw }); return; }
  const t = e.target.closest("[data-pt]"); if(t){ const s = new Set(fprefs().targets || []); s.has(t.dataset.pt) ? s.delete(t.dataset.pt) : s.add(t.dataset.pt); savePrefs({ targets:[...s] }); }
});


/* ================= Phase 4: notifications, forums, messages, reports ================= */
const folks = {}; // id -> { display_name, avatar_path, title } for anyone we've shown
async function loadFolks(ids){
  ids = [...new Set(ids.filter(id => id && id !== me?.id && !folks[id]))];
  if(!ids.length) return;
  const { data } = await sb.from("profiles").select("id, display_name, avatar_path, title").in("id", ids.slice(0, 300));
  for(const p of data || []){ folks[p.id] = p; avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; }
}
const nameOf = id => id === me?.id ? (profile?.display_name || "You") : (folks[id]?.display_name || people[id]?.display_name || "Angler");
const ago = ts => { const s = (Date.now() - new Date(ts)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 604800 ? `${Math.floor(s / 86400)}d` : fmtDate(String(ts).slice(0, 10)); };
const paras = t => esc(t).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

/* ---------- blocking ---------- */
let blocks = new Set(lsGet("fl.blocks", []));
async function loadBlocks(){ const { data, error } = await sb.from("user_blocks").select("blocked"); if(!error){ blocks = new Set((data || []).map(b => b.blocked)); lsSet("fl.blocks", [...blocks]); } }
async function setBlock(id, on){
  const r = on ? await sb.from("user_blocks").insert({ blocker:me.id, blocked:id }) : await sb.from("user_blocks").delete().eq("blocker", me.id).eq("blocked", id);
  if(r.error && !/duplicate/.test(r.error.message || "")){ toast("Couldn't update. Try again."); return; }
  if(on) blocks.add(id); else blocks.delete(id); lsSet("fl.blocks", [...blocks]);
  toast(on ? `Blocked ${nameOf(id)}. They can't message you, and their posts are tucked away.` : `Unblocked ${nameOf(id)}.`); renderLog();
}

/* ---------- reports ---------- */
function reportForm(kind, ref, slot){
  slot.innerHTML = `<div class="card" style="margin-top:6px"><div class="field"><label>What's wrong?</label>
    <select data-repwhy><option>Rude or harassing</option><option>Hateful or offensive</option><option>Spam or ads</option><option>Sharing someone's private spot or info</option><option>Something else</option></select></div>
    <input data-repmore maxlength="300" placeholder="Anything else the reviewer should know (optional)">
    <div class="row2" style="margin-top:6px"><button class="btn sm ink" type="button" data-repgo="${esc(kind)}:${esc(ref)}">Send report</button><button class="link" type="button" data-repcancel>Cancel</button></div></div>`;
}
$("log").addEventListener("click", async e => {
  const r = e.target.closest("[data-report]");
  if(r){ const [kind, ref] = r.dataset.report.split(":"); const slot = r.closest("[data-rslot]")?.querySelector(".rslot") || r.parentElement.nextElementSibling; if(slot) reportForm(kind, ref, slot); return; }
  if(e.target.closest("[data-repcancel]")){ e.target.closest(".card").remove(); return; }
  const g = e.target.closest("[data-repgo]");
  if(g){ const [kind, ref] = g.dataset.repgo.split(":"), card = g.closest(".card");
    const reason = [card.querySelector("[data-repwhy]").value, card.querySelector("[data-repmore]").value.trim()].filter(Boolean).join(": ");
    const { error } = await sb.from("reports").insert({ reporter:me.id, kind, ref, reason });
    card.remove(); toast(error && !/duplicate/.test(error.message || "") ? "Couldn't send the report." : "Reported. A reviewer will take a look. Thanks."); }
});

/* ---------- push notifications ---------- */
const PUSH_CATS = [["catches","Friends' catches"],["friends","Friend requests"],["messages","Messages"],["tourneys","Tournament invites, changes and catches"],["fish","Fish logged for you, fair-play notices"],["forum","Replies to your forum threads"]];
let pushStateV = null;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
/* One notification sign-up per device. The live app and the test copy each have their own service worker, and each could hold
   its own sign-up: two sign-ups on one phone meant every notification arrived twice. So the sign-up always lives with the live
   app's worker (whichever version is open), and any sign-up found on another worker is removed. */
const deviceId = () => { let d = lsGet("fl.device", null); if(!d){ d = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)); lsSet("fl.device", d); } return d; };
const swActive = reg => reg.active ? Promise.resolve(reg) : new Promise((res, rej) => { const w = reg.installing || reg.waiting; if(!w) return rej(new Error("no worker"));
  w.addEventListener("statechange", () => { if(w.state === "activated") res(reg); else if(w.state === "redundant") rej(new Error("redundant")); }); });
async function pushReg(){
  if(CHANNEL !== "beta") return navigator.serviceWorker.ready;
  const root = new URL("../", location.href).href;
  const reg = await navigator.serviceWorker.getRegistration(root);
  return reg && reg.scope === root ? swActive(reg) : swActive(await navigator.serviceWorker.register("../sw.js", { scope:"../" }));
}
async function allPushSubs(){   // every sign-up this device holds, across the live app and the test copy
  const out = [];
  for(const reg of await navigator.serviceWorker.getRegistrations()){ try{ const sub = await reg.pushManager.getSubscription(); if(sub) out.push({ reg, sub }); }catch(e){} }
  return out;
}
async function savePushSub(sub){
  const j = sub.toJSON(), dev = deviceId();
  await sb.from("push_subscriptions").delete().eq("endpoint", j.endpoint);
  await sb.from("push_subscriptions").delete().eq("user_id", me.id).eq("device_id", dev);
  const { error } = await sb.from("push_subscriptions").insert({ user_id:me.id, endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, ua:navigator.userAgent.slice(0, 120), device_id:dev });
  if(error) throw error;
}
async function dropPushSub(sub){ try{ await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); }catch(e){} try{ await sub.unsubscribe(); }catch(e){} }
let pushTidied = false;
async function tidyPush(){
  if(pushTidied || !pushSupported() || !me || !navigator.onLine || Notification.permission !== "granted") return;
  pushTidied = true;
  try{
    const main = await pushReg(), subs = await allPushSubs();
    let keep = subs.find(x => x.reg.scope === main.scope)?.sub || null;
    const extra = subs.filter(x => x.reg.scope !== main.scope);
    if(!keep && extra.length){   // signed up only on the other copy: move it here if the phone allows it without a tap, else leave that one alone
      try{ keep = await main.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64u(CFG.vapidPublic) }); }catch(e){ keep = null; }
    }
    if(!keep) return;
    for(const x of extra) await dropPushSub(x.sub);
    const { data } = await sb.from("push_subscriptions").select("id, device_id").eq("endpoint", keep.endpoint).maybeSingle();
    if(!data || data.device_id !== deviceId()) await savePushSub(keep);
  }catch(e){ console.warn("push tidy", e); pushTidied = false; }
  refreshPushState();
}
async function refreshPushState(){
  let s;
  if(!pushSupported()) s = isIOS && !isStandalone ? "ios-install" : "unsupported";
  else if(Notification.permission === "denied") s = "denied";
  else { try{ s = (await allPushSubs()).length ? "on" : "off"; }catch(e){ s = "off"; } }
  if(s !== pushStateV){ pushStateV = s; if(tab === "me" && meView === "main") renderLog(); }
}
async function enablePush(){
  try{
    const perm = await Notification.requestPermission();
    if(perm !== "granted"){ toast(perm === "denied" ? "Notifications are blocked. Turn them on in Settings → Notifications → Coulee." : "Notifications weren't turned on."); return refreshPushState(); }
    const reg = await pushReg();
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64u(CFG.vapidPublic) });
    for(const x of await allPushSubs()) if(x.sub.endpoint !== sub.endpoint) await dropPushSub(x.sub);
    await savePushSub(sub);
    toast("Notifications are on. Sending a test…"); sb.rpc("push_test");
  }catch(e){ console.error(e); toast("Couldn't turn on notifications. Try again."); }
  refreshPushState();
}
async function disablePush(){
  try{ for(const x of await allPushSubs()) await dropPushSub(x.sub); }catch(e){}
  toast("Notifications are off on this device."); refreshPushState();
}
function notifyCardHtml(){
  if(pushStateV === null) refreshPushState();
  const p = profile?.push_prefs || {};
  const s = pushStateV;
  const body = s === "ios-install" ? `<p>On iPhone, notifications work once Coulee is on your Home Screen: in Safari tap <b>Share</b> → <b>Add to Home Screen</b>, then open Coulee from that icon and come back here. Needs iOS 16.4 or newer.</p>`
    : s === "unsupported" ? `<p>This browser can't show notifications from Coulee. On iPhone, open it from the Home Screen icon. On Android, use Chrome.</p>`
    : s === "denied" ? `<p>Notifications are blocked for Coulee. Turn them on in <b>Settings → Notifications → Coulee</b> (iPhone) or your browser's site settings, then come back.</p>`
    : s === "on" ? `<p class="muted" style="margin:0 0 6px">On for this device. Choose what you hear about:</p>
        ${PUSH_CATS.map(([k, l]) => `<label class="check"><input type="checkbox" data-pushpref="${k}" ${p[k] !== false ? "checked" : ""}> ${esc(l)}</label>`).join("")}
        ${isStaff() ? `<label class="check"><input type="checkbox" data-pushpref="staff" ${p.staff !== false ? "checked" : ""}> New accounts, reports and flagged photos</label>` : ""}
        <div class="row2" style="margin-top:8px"><button class="btn sm" type="button" data-push="test">Send a test</button><button class="link" type="button" data-push="off">Turn off on this device</button></div>`
    : `<p>Get a notification for friend requests, messages, tournament invites and more.</p><div class="row2"><button class="btn sm ink" type="button" data-push="on">Turn on notifications</button></div>`;
  const tell = p.tell_friends !== false;
  const share = `<div class="card"><label class="check"><input type="checkbox" data-pushpref="tell_friends" ${tell ? "checked" : ""}> Tell friends when I log a catch</label>
    <p class="muted" style="margin:4px 0 0">${tell ? "Friends who can see a catch get a notification about it." : "Friends can still see your catches in their feed, but won't get a notification."} Fish entered in a tournament always notify the other anglers in it.</p></div>`;
  return `<h4><span>Notifications</span></h4><div class="card">${body}</div>${share}`;
}
$("log").addEventListener("click", async e => {
  const b = e.target.closest("[data-push]"); if(!b) return;
  if(b.dataset.push === "on"){ b.disabled = true; await enablePush(); }
  if(b.dataset.push === "off") await disablePush();
  if(b.dataset.push === "test"){ const { error } = await sb.rpc("push_test"); toast(error ? "Couldn't send a test." : "Test sent. It should arrive in a few seconds."); }
});
$("log").addEventListener("change", async e => {
  const k = e.target.dataset?.pushpref; if(!k) return;
  const push_prefs = { ...(profile.push_prefs || {}), [k]:e.target.checked };
  const { error } = await sb.from("profiles").update({ push_prefs }).eq("id", me.id);
  if(error){ toast("Couldn't save."); e.target.checked = !e.target.checked; return; }
  profile = { ...profile, push_prefs }; saveCache();
  if(k === "tell_friends"){ renderLog(); toast(e.target.checked ? "Friends will hear about your catches." : "Friends won't get notified of your catches."); }
});
// a tapped notification opens the right screen
function openDeepLink(h){
  if(!h || !me) return false;
  const [k, id] = h.replace(/^#/, "").split(":");
  if(k === "friends"){ friendsView = "people"; setTab("friends"); }
  else if(k === "feed"){ friendsView = "feed"; setTab("friends"); }
  else if(k === "tourney" && id){ setTab("tourney"); openTourney(id); }
  else if(k === "log"){ setTab("map"); }
  else if(k === "messages"){ friendsView = "messages"; chatWith = id || null; setTab("friends"); }
  else if(k === "forum"){ friendsView = "forums"; forumThread = id || null; setTab("friends"); }
  else if(k === "staff" && isStaff()){ setTab("me"); meView = "creator"; creatorData = null; renderLog(); }
  else if(k === "me"){ setTab("me"); }
  else return false;
  return true;
}
navigator.serviceWorker?.addEventListener("message", e => { if(e.data?.type === "open") openDeepLink(e.data.url); });
let pendingDeepLink = /^#(friends|feed|tourney|log|messages|forum|staff|me)\b/.test(location.hash) ? location.hash : null;
if(pendingDeepLink) history.replaceState(null, "", location.pathname + location.search);

/* ---------- messages ---------- */
let convos = null, chatWith = null, chatOpenFor = null, chatMsgs = [], chatBlock = null, chatPoll = null, unreadTotal = 0;
async function loadConvos(){
  const { data, error } = await sb.rpc("my_conversations"); if(error) return;
  convos = (data || []).sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  unreadTotal = convos.reduce((a, c) => a + +c.unread, 0);
  convos.forEach(c => { folks[c.other] ||= { display_name:c.display_name, avatar_path:c.avatar_path }; avatars[c.other] = c.avatar_path || ""; });
  try{ navigator.setAppBadge?.(unreadTotal || undefined); if(!unreadTotal) navigator.clearAppBadge?.(); }catch(e){}
  if(tab === "friends") renderLog(); else $("reqDot").hidden = !(unreadTotal || friendships.some(f => f.status === "pending" && f.addressee === me?.id));
}
async function loadChat(other){
  const { data, error } = await sb.from("messages").select("*").or(`and(from_user.eq.${me.id},to_user.eq.${other}),and(from_user.eq.${other},to_user.eq.${me.id})`).order("created_at", { ascending:true }).limit(300);
  if(error) return;
  const changed = JSON.stringify(data.map(m => m.id + (m.read_at || ""))) !== JSON.stringify(chatMsgs.map(m => m.id + (m.read_at || "")));
  chatMsgs = data;
  const unread = data.filter(m => m.to_user === me.id && !m.read_at).map(m => m.id);
  if(unread.length){ await sb.from("messages").update({ read_at:new Date().toISOString() }).in("id", unread); loadConvos(); }
  if(changed && chatWith === other && tab === "friends" && friendsView === "messages"){ renderLog(); const l = $("chatList"); if(l) l.scrollTop = l.scrollHeight; }
}
async function openChat(other){
  chatWith = other; chatOpenFor = other; chatMsgs = []; chatBlock = undefined; renderLog();
  await loadFolks([other]);
  const { data } = await sb.rpc("can_message", { other }); chatBlock = data || null;
  await loadChat(other);
  clearInterval(chatPoll); chatPoll = setInterval(() => { if(chatWith === other && document.visibilityState === "visible" && tab === "friends" && friendsView === "messages") loadChat(other); }, 8000);
}
function messagesHtml(){
  if(chatWith){
    if(chatOpenFor !== chatWith){ setTimeout(() => openChat(chatWith), 0); }
    const other = chatWith, blockedByMe = blocks.has(other);
    return `<button class="link backlink" type="button" data-chatback>${icon("i-back")}All messages</button>
      <div class="chathead">${avHtml(other, nameOf(other))}<b>${esc(nameOf(other))}</b>
        <span class="row2" style="margin-left:auto"><button class="link" type="button" data-blk="${esc(other)}" data-on="${blockedByMe ? 0 : 1}">${blockedByMe ? "Unblock" : "Block"}</button></span></div>
      <div class="chat" id="chatList">${chatMsgs.length ? chatMsgs.map(m => `<div class="bub ${m.from_user === me.id ? "mine" : ""}" data-rslot><div>${paras(m.body)}</div>
          <small>${esc(ago(m.created_at))}${m.from_user === me.id && m.read_at ? " · Seen" : ""}${m.from_user !== me.id ? ` · <button class="link" type="button" data-report="message:${esc(m.id)}">Report</button>` : ` · <button class="link" type="button" data-unsend="${esc(m.id)}">Unsend</button>`}</small><div class="rslot"></div></div>`).join("")
        : `<p class="muted" style="text-align:center;margin:20px 0">${chatBlock === undefined ? "Loading…" : "No messages yet. Say hi."}</p>`}</div>
      ${chatBlock ? `<p class="note">${esc(chatBlock)}</p>` : `<form id="chatForm" class="chatin" novalidate><textarea id="chatBody" maxlength="2000" rows="1" placeholder="Message ${esc(nameOf(other))}"></textarea><button class="btn ink" type="submit">Send</button></form>`}
      <p class="note">Messages are private between you two. A reviewer only sees a message if one of you reports it.</p>`;
  }
  if(!convos){ if(convos !== false){ convos = false; setTimeout(loadConvos, 0); } return `<p class="status">Loading messages…</p>`; }
  const fr = friendsList().filter(f => !convos.some(c => c.other === f.id));
  return `${convos.length ? `<ul class="list">${convos.map(c => `<li><button class="item" type="button" data-chat="${esc(c.other)}" style="grid-template-columns:36px 1fr auto">${avHtml(c.other, c.display_name)}
      <span class="t"><b>${esc(c.display_name)}</b><small>${c.last_from_me ? "You: " : ""}${esc(c.last_body.slice(0, 70))}</small></span><span class="num">${+c.unread ? `<span class="pill fish">${c.unread}</span>` : `<small class="muted">${esc(ago(c.last_at))}</small>`}</span></button></li>`).join("")}</ul>`
      : `<div class="empty"><b>No messages yet</b>Message any friend who's 16 or older. Pick one below.</div>`}
    ${fr.length ? `<h4><span>Start a conversation</span></h4><div class="row2" style="flex-wrap:wrap">${fr.map(f => `<button class="btn sm" type="button" data-chat="${esc(f.id)}">${esc(f.name)}</button>`).join("")}</div>` : ""}
    <p class="note">Messages are for friends only, and for anglers 16 and older (by the birth year on the account). Bad language is starred out.</p>`;
}
$("log").addEventListener("click", async e => {
  const c = e.target.closest("[data-chat]"); if(c){ friendsView = "messages"; openChat(c.dataset.chat); return; }
  if(e.target.closest("[data-chatback]")){ chatWith = null; chatOpenFor = null; clearInterval(chatPoll); convos = null; renderLog(); return; }
  const bl = e.target.closest("[data-blk]"); if(bl){ await setBlock(bl.dataset.blk, bl.dataset.on === "1"); if(chatWith){ const { data } = await sb.rpc("can_message", { other:chatWith }); chatBlock = data || null; renderLog(); } return; }
  const un = e.target.closest("[data-unsend]"); if(un){ const { error } = await sb.from("messages").delete().eq("id", un.dataset.unsend); if(!error){ chatMsgs = chatMsgs.filter(m => m.id !== un.dataset.unsend); renderLog(); } return; }
});
$("log").addEventListener("submit", async e => {
  if(e.target.id !== "chatForm") return; e.preventDefault();
  const body = $("chatBody").value.trim(); if(!body || !chatWith) return;
  const btn = e.target.querySelector("button"); btn.disabled = true;
  const { error } = await sb.from("messages").insert({ from_user:me.id, to_user:chatWith, body });
  btn.disabled = false;
  if(error){ toast("Couldn't send. Check your connection."); return; }
  $("chatBody").value = ""; await loadChat(chatWith); const l = $("chatList"); if(l) l.scrollTop = l.scrollHeight;
});
$("log").addEventListener("keydown", e => { if(e.target.id === "chatBody" && e.key === "Enter" && !e.shiftKey && !isIOS){ e.preventDefault(); $("chatForm").requestSubmit(); } });

/* ---------- forums ---------- */
const BOARDS = { general:"General", driftless:"Driftless", northwoods:"Northwoods", central:"Central Sands", southeast:"Southeast & Madison", lakemichigan:"Lake Michigan & tributaries", flies:"Fly tying", gear:"Gear", tourneys:"Tournaments", help:"Help & feedback" };
let forumBoard = lsGet("fl.board", ""), forumThreads = null, forumThread = null, forumPosts = null, forumNew = false;
async function loadThreads(){
  let q = sb.from("forum_threads").select("id, board, user_id, title, created_at, last_post_at, reply_count, locked, pinned, hidden").order("pinned", { ascending:false }).order("last_post_at", { ascending:false }).limit(60);
  if(forumBoard) q = q.eq("board", forumBoard);
  const { data, error } = await q; forumThreads = error ? [] : data || [];
  await loadFolks(forumThreads.map(t => t.user_id)); if(tab === "friends" && friendsView === "forums") renderLog();
}
async function loadThread(id){
  const [t, p] = await Promise.all([ sb.from("forum_threads").select("*").eq("id", id).maybeSingle(), sb.from("forum_posts").select("*").eq("thread_id", id).order("created_at", { ascending:true }).limit(500) ]);
  forumPosts = { thread:t.data || { id, missing:true }, posts:p.data || [] };
  await loadFolks([t.data?.user_id, ...forumPosts.posts.map(x => x.user_id)]);
  if(tab === "friends" && friendsView === "forums") renderLog();
}
function postHtml(kind, x, isThread){
  const mine = x.user_id === me?.id, hid = blocks.has(x.user_id);
  if(hid) return `<div class="fpost blocked"><small class="muted">Post from someone you blocked. <button class="link" type="button" data-blk="${esc(x.user_id)}" data-on="0">Unblock</button></small></div>`;
  return `<div class="fpost${x.hidden ? " hid" : ""}" data-rslot>
    <div class="fmeta">${avHtml(x.user_id, nameOf(x.user_id), "sm")}<b>${esc(nameOf(x.user_id))}</b>${titlePill(x.user_id)}<small class="muted">${esc(ago(x.created_at))}${x.edited_at ? " · edited" : ""}${x.hidden ? " · hidden by a moderator" : ""}</small></div>
    <div class="fbody" data-fbody="${esc(x.id)}">${paras(x.body)}</div>
    <div class="row2 factions">${mine ? `<button class="link" type="button" data-fedit="${kind}:${esc(x.id)}">Edit</button>${!isThread || !x.reply_count ? `<button class="link danger" type="button" data-fdel="${kind}:${esc(x.id)}">Delete</button>` : ""}`
      : `<button class="link" type="button" data-report="${kind}:${esc(x.id)}">Report</button><button class="link" type="button" data-blk="${esc(x.user_id)}" data-on="1">Block</button>`}
      ${isStaff() && !mine ? `<button class="link danger" type="button" data-mod="${kind}:${esc(x.id)}:${x.hidden ? "unhide" : "hide"}">${x.hidden ? "Unhide" : "Hide"}</button>` : ""}</div><div class="rslot"></div></div>`;
}
function forumsHtml(){
  if(forumThread){
    if(!forumPosts || forumPosts.thread?.id !== forumThread){ forumPosts = { thread:{ id:forumThread }, posts:null }; setTimeout(() => loadThread(forumThread), 0); }
    if(forumPosts.posts === null) return `<button class="link backlink" type="button" data-fback>${icon("i-back")}${esc(BOARDS[forumBoard] || "All boards")}</button><p class="status">Loading…</p>`;
    const t = forumPosts.thread; if(!t || t.missing) return `<button class="link backlink" type="button" data-fback>${icon("i-back")}Forums</button><p class="muted">This thread was removed.</p>`;
    return `<button class="link backlink" type="button" data-fback>${icon("i-back")}${esc(BOARDS[forumBoard] || "All boards")}</button>
      <div class="eyebrow">${esc(BOARDS[t.board])}${t.pinned ? " · Pinned" : ""}${t.locked ? " · Locked" : ""}</div><h2 class="wrap">${esc(t.title)}</h2>
      ${isStaff() ? `<div class="row2" style="margin:0 0 8px"><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.pinned ? "unpin" : "pin"}">${t.pinned ? "Unpin" : "Pin"}</button><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.locked ? "unlock" : "lock"}">${t.locked ? "Unlock" : "Lock"}</button><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.hidden ? "unhide" : "hide"}">${t.hidden ? "Unhide thread" : "Hide thread"}</button></div>` : ""}
      ${postHtml("thread", t, true)}
      <h4><span>Replies</span><span>${forumPosts.posts?.length || 0}</span></h4>
      ${(forumPosts.posts || []).map(p => postHtml("post", p, false)).join("") || `<p class="muted">No replies yet.</p>`}
      ${t.locked ? `<p class="note">This thread is locked.</p>` : `<form id="replyForm" novalidate style="margin-top:10px"><textarea id="replyBody" maxlength="5000" placeholder="Write a reply"></textarea><span class="hint" id="replyMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Reply</button></div></form>`}
      <p class="note">Be decent, and don't post someone else's spot without their OK. Bad language is starred out.</p>`;
  }
  if(forumNew) return `<button class="link backlink" type="button" data-fnewx>${icon("i-back")}Forums</button><h3 style="margin:4px 0 8px">New thread</h3>
    <form id="threadForm" novalidate><div class="field"><label for="ftBoard">Board</label><select id="ftBoard">${Object.entries(BOARDS).map(([k, l]) => `<option value="${k}" ${forumBoard === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label for="ftTitle">Title</label><input id="ftTitle" maxlength="120" placeholder="Best BWO patterns for the Kinni?"></div>
      <div class="field"><label for="ftBody">Post</label><textarea id="ftBody" maxlength="5000" style="min-height:140px" placeholder="What's on your mind? Keep exact spots general unless they're public water."></textarea></div>
      <span class="hint" id="ftMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Post thread</button></div></form>`;
  if(forumThreads === null){ forumThreads = false; setTimeout(loadThreads, 0); }
  return `<div class="row2" style="justify-content:space-between;margin-bottom:8px"><select id="fBoard" aria-label="Board" style="width:auto;flex:1 1 auto"><option value="">All boards</option>${Object.entries(BOARDS).map(([k, l]) => `<option value="${k}" ${forumBoard === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><button class="btn sm ink" type="button" data-fnew>${icon("i-plus")}New thread</button></div>
    ${!forumThreads ? `<p class="status">Loading threads…</p>` : forumThreads.length ? `<ul class="list">${forumThreads.filter(t => !blocks.has(t.user_id)).map(t => `<li><button class="item" type="button" data-fthread="${esc(t.id)}" style="grid-template-columns:36px 1fr auto">${avHtml(t.user_id, nameOf(t.user_id))}
      <span class="t"><b class="wrap">${t.pinned ? "📌 " : ""}${esc(t.title)}${t.locked ? " 🔒" : ""}${t.hidden ? ` <span class="pill priv">Hidden</span>` : ""}</b><small>${esc(nameOf(t.user_id))}${forumBoard ? "" : ` · ${esc(BOARDS[t.board])}`} · ${esc(ago(t.last_post_at))}</small></span>
      <span class="num"><small class="muted">${t.reply_count} ${t.reply_count === 1 ? "reply" : "replies"}</small></span></button></li>`).join("")}</ul>`
      : `<div class="empty"><b>No threads yet</b>Start one: a hatch report, a fly pattern, a gear question.</div>`}
    <p class="note">Forums are open to every approved angler. Report anything out of line and a moderator will look at it.</p>`;
}
$("log").addEventListener("change", e => { if(e.target.id === "fBoard"){ forumBoard = e.target.value; lsSet("fl.board", forumBoard); forumThreads = null; renderLog(); } });
$("log").addEventListener("click", async e => {
  const t = e.target.closest("[data-fthread]"); if(t){ forumThread = t.dataset.fthread; forumPosts = null; renderLog(); $("log").scrollTop = 0; return; }
  if(e.target.closest("[data-fback]")){ forumThread = null; forumPosts = null; forumThreads = null; renderLog(); return; }
  if(e.target.closest("[data-fnew]")){ forumNew = true; renderLog(); return; }
  if(e.target.closest("[data-fnewx]")){ forumNew = false; renderLog(); return; }
  const ed = e.target.closest("[data-fedit]");
  if(ed){ const [kind, id] = ed.dataset.fedit.split(":"), x = kind === "thread" ? forumPosts.thread : forumPosts.posts.find(p => p.id === id);
    const box = $("log").querySelector(`[data-fbody="${id}"]`);
    box.innerHTML = `<textarea data-feditbox maxlength="5000" style="min-height:100px">${esc(x.body)}</textarea><div class="row2"><button class="btn sm ink" type="button" data-fsave="${kind}:${esc(id)}">Save</button><button class="link" type="button" data-fcancel>Cancel</button></div>`; return; }
  if(e.target.closest("[data-fcancel]")){ renderLog(); return; }
  const sv = e.target.closest("[data-fsave]");
  if(sv){ const [kind, id] = sv.dataset.fsave.split(":"), body = sv.closest(".fbody").querySelector("[data-feditbox]").value.trim(); if(!body) return;
    const { error } = await sb.from(kind === "thread" ? "forum_threads" : "forum_posts").update({ body }).eq("id", id);
    if(error){ toast("Couldn't save."); return; } loadThread(forumThread); return; }
  const dl = e.target.closest("[data-fdel]");
  if(dl){ const [kind, id] = dl.dataset.fdel.split(":");
    if(dl.dataset.sure !== "1"){ dl.dataset.sure = "1"; dl.textContent = "Tap again to delete"; return; }
    const { error } = await sb.from(kind === "thread" ? "forum_threads" : "forum_posts").delete().eq("id", id);
    if(error){ toast("Couldn't delete."); return; }
    if(kind === "thread"){ forumThread = null; forumPosts = null; forumThreads = null; renderLog(); } else loadThread(forumThread); return; }
  const md = e.target.closest("[data-mod]");
  if(md){ const [kind, ref, action] = md.dataset.mod.split(":");
    const { error } = await sb.rpc("moderate", { kind, ref, action }); toast(error ? (error.message || "Couldn't do that.") : "Done.");
    if(forumThread) loadThread(forumThread); if(md.closest(".rep")) { reportList = null; renderLog(); } return; }
});
$("log").addEventListener("submit", async e => {
  if(e.target.id === "threadForm"){ e.preventDefault(); const msg = $("ftMsg"); msg.className = "hint bad";
    const title = $("ftTitle").value.trim(), body = $("ftBody").value.trim(), board = $("ftBoard").value;
    if(title.length < 3){ msg.textContent = "Give it a title."; return; } if(!body){ msg.textContent = "Write something."; return; }
    const { data, error } = await sb.from("forum_threads").insert({ board, title, body, user_id:me.id }).select("id").single();
    if(error){ msg.textContent = "Couldn't post it. Try again."; return; }
    forumNew = false; forumBoard = board; lsSet("fl.board", board); forumThread = data.id; forumPosts = null; renderLog(); }
  if(e.target.id === "replyForm"){ e.preventDefault(); const body = $("replyBody").value.trim(); if(!body) return;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const { error } = await sb.from("forum_posts").insert({ thread_id:forumThread, user_id:me.id, body });
    btn.disabled = false; if(error){ $("replyMsg").className = "hint bad"; $("replyMsg").textContent = "Couldn't post. Try again."; return; }
    loadThread(forumThread); }
});

/* ---------- reports queue for the founder and admins ---------- */
let reportList = null, reportOpenCount = 0;
async function loadReports(){
  if(!isStaff()) return;
  const { data, error } = await sb.rpc("report_queue"); if(error) return;
  reportList = data || []; reportOpenCount = reportList.filter(r => r.status === "open").length;
  $("meDot").hidden = !(pendingCount || flagCount || reportOpenCount);
  if(tab === "me") renderLog();
}
function reportQueueHtml(){
  if(!reportList){ if(reportList !== false){ reportList = false; setTimeout(loadReports, 0); } return `<h4><span>Reports</span></h4><p class="status">Loading…</p>`; }
  const open = reportList.filter(r => r.status === "open");
  const seen = new Set(), uniq = open.filter(r => { const k = r.kind + r.ref; if(seen.has(k)) return false; seen.add(k); return true; });
  return `<h4><span>Reports</span><span>${uniq.length} open</span></h4>
    ${uniq.length ? `<div class="stack">${uniq.map(r => `<div class="card rep"><p class="muted" style="font-size:12.5px;margin:0">${esc(r.kind === "post" ? "Forum reply" : r.kind === "thread" ? "Forum thread" : r.kind === "message" ? "Private message" : "Account")} by <b>${esc(r.author_name)}</b>${r.context ? ` · ${esc(r.context)}` : ""} · ${r.reports} report${+r.reports === 1 ? "" : "s"}</p>
        <blockquote>${esc((r.content || "").slice(0, 600)) || "<i>(no text)</i>"}</blockquote><p class="muted" style="font-size:13px;margin:0">Reason: ${esc(r.reason || "not given")} · from ${esc(r.reporter_name)}</p>
        <div class="row2">${r.kind !== "user" ? `<button class="btn sm ink" type="button" data-mod="${esc(r.kind)}:${esc(r.ref)}:hide">Hide it</button>` : ""}${r.kind === "thread" ? `<button class="btn sm" type="button" data-mod="thread:${esc(r.ref)}:lock">Lock</button>` : ""}<button class="btn sm" type="button" data-mod="${esc(r.kind)}:${esc(r.ref)}:close">Looks fine</button></div></div>`).join("")}</div>`
      : `<p class="muted">No open reports.</p>`}`;
}

/* ---------- appearance ---------- */
function themeHtml(){
  const t = lsGet("fl.theme", "auto");
  return `<h4><span>Appearance</span></h4><div class="seg" role="group" aria-label="Appearance" style="max-width:320px">${[["auto","Auto"],["light","Light"],["dark","Dark"]].map(([k, l]) => `<button type="button" class="ink" data-theme-set="${k}" aria-pressed="${t === k}">${l}</button>`).join("")}</div>
    <p class="muted" style="margin:6px 0 0;font-size:13px">Dark is easier on the eyes at dawn and dusk. Auto follows your phone.</p>`;
}
function applyTheme(t){ if(t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
$("log").addEventListener("click", e => { const b = e.target.closest("[data-theme-set]"); if(!b) return; lsSet("fl.theme", b.dataset.themeSet); applyTheme(b.dataset.themeSet); renderLog(); });
function blockedHtml(){
  if(!blocks.size) return "";
  return `<h4><span>Blocked</span><span>${blocks.size}</span></h4><ul class="list">${[...blocks].map(id => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(nameOf(id))}</b></span><button class="link" type="button" data-blk="${esc(id)}" data-on="0">Unblock</button></li>`).join("")}</ul>`;
}


/* ---------- unique @usernames: everyone picks one; friends can find you by it ---------- */
function suggestUsername(){
  const base = (profile?.display_name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 16);
  return base.length >= 3 ? base : "";
}
let unameTimer = null, unameRequired = false;
function openUsername(required){
  unameRequired = !!required;
  $("unameTitle").textContent = profile?.username ? "Change your username" : "Pick your username";
  $("unameLater").hidden = unameRequired;
  $("unameIn").value = profile?.username || suggestUsername();
  $("unameMsg").className = "hint"; $("unameMsg").textContent = "3 to 20 letters, numbers, _ or .";
  $("unameScrim").hidden = false; setTimeout(() => { $("unameIn").focus(); checkUname(); }, 60);
}
function closeUsername(){ $("unameScrim").hidden = true; }
const cleanUname = v => v.toLowerCase().replace(/^@+/, "").replace(/\s+/g, "");
async function checkUname(){
  const v = cleanUname($("unameIn").value), msg = $("unameMsg");
  if(!v || v === profile?.username){ msg.className = "hint"; msg.textContent = "3 to 20 letters, numbers, _ or ."; return; }
  const { data, error } = await sb.rpc("username_check", { u:v });
  if(cleanUname($("unameIn").value) !== v || error) return;
  msg.className = data ? "hint bad" : "hint ok"; msg.textContent = data || `@${v} is available.`;
}
$("unameIn").addEventListener("input", () => {
  const el = $("unameIn"), v = cleanUname(el.value); if(v !== el.value) el.value = v;
  clearTimeout(unameTimer); unameTimer = setTimeout(checkUname, 350);
});
$("unameLater").onclick = closeUsername;
$("unameScrim").addEventListener("click", e => { if(e.target === $("unameScrim") && !unameRequired) closeUsername(); });
$("unameForm").addEventListener("submit", async e => {
  e.preventDefault(); const v = cleanUname($("unameIn").value), msg = $("unameMsg"), btn = $("unameSave");
  if(v === profile?.username){ closeUsername(); return; }
  btn.disabled = true;
  const { data, error } = await sb.rpc("set_username", { u:v });
  btn.disabled = false;
  if(error){ msg.className = "hint bad"; msg.textContent = /taken|reserved|Use |Start|period|Pick/.test(error.message) ? error.message : "Couldn't save it. Check your connection and try again."; return; }
  profile = { ...profile, username:data }; saveCache(); closeUsername(); toast(`You're @${data}`); renderLog();
});
document.addEventListener("click", e => { if(e.target.closest('[data-a="uname"]')) openUsername(false); });
// existing accounts pick one the next time the app opens (after the What's new / setup screens are out of the way)
let unameAsked = false;
setInterval(() => {
  if(unameAsked || !me || !profile || profile.username || profile.status !== "approved" || !navigator.onLine) return;
  if([...document.querySelectorAll(".scrim")].some(s => !s.hidden)) return;
  unameAsked = true; openUsername(true);
}, 2000);


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

/* ---------- stream flows (USGS gauges) and the forecast at the stream (National Weather Service) ----------
   data/gauges.json lists Wisconsin's live stream gauges (name and place). Readings come straight from the USGS when the map
   needs them, are kept for 15 minutes, and the last ones are remembered so a gauge still shows something with no signal. */
const USGS = "https://api.waterdata.usgs.gov/";
const FLOW_TTL = 15 * 60000, GAUGE_ZOOM = 10.5;
let gauges = null, flowNow = lsGet("fl.flows", { at:0, q:{}, t:{} }), flowBusy = null, showGauges = lsGet("fl.gauges", true);
const gaugeLayer = L.layerGroup().addTo(map), gaugeDetail = {}, wxCache = {};
const usgs = async (path, params) => { const r = await fetch(USGS + path + "?" + new URLSearchParams(params)); if(!r.ok) throw new Error("usgs " + r.status); return r.json(); };
// what's normal for each gauge at each week of the year: [p10, p25, p75, p90], from the monthly data refresh
let flowNorms = null;
async function loadNorms(){ if(!flowNorms){ try{ const r = await fetch(dataUrl("flownorms.json")); flowNorms = r.ok ? await r.json() : {}; }catch(e){ flowNorms = {}; } } return flowNorms; }
function normFor(id){
  const w = flowNorms && flowNorms[id]; if(!w) return null;
  const d = new Date(), doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000), r = w[Math.min(52, Math.floor(doy / 7))];
  return r && r.every(Number.isFinite) ? { 10:r[0], 25:r[1], 75:r[2], 90:r[3] } : null;
}
async function loadGauges(){ if(!gauges){ try{ const r = await fetch(dataUrl("gauges.json")); gauges = r.ok ? await r.json() : []; }catch(e){ gauges = []; } await loadNorms(); } return gauges; }
async function loadFlows(){
  if(Date.now() - flowNow.at < FLOW_TTL || !navigator.onLine) return flowNow;
  return (flowBusy ||= (async () => {
    try{
      const get = code => usgs("ogcapi/v0/collections/latest-continuous/items", { f:"json", state_name:"Wisconsin", parameter_code:code, limit:"2000", properties:"monitoring_location_id,time,value", skipGeometry:"true" });
      const [q, t] = await Promise.all([get("00060"), get("00010").catch(() => ({ features:[] }))]);
      const fresh = Date.now() - 3 * 86400000, pick = fc => { const o = {}; for(const f of fc.features || []){ const p = f.properties, at = Date.parse(p.time), v = parseFloat(p.value);
        if(at > fresh && Number.isFinite(v) && (!o[p.monitoring_location_id] || at > o[p.monitoring_location_id][1])) o[p.monitoring_location_id] = [v, at]; } return o; };
      flowNow = { at:Date.now(), q:pick(q), t:pick(t) }; lsSet("fl.flows", flowNow);
    }catch(e){ console.warn("flows", e); }
    flowBusy = null; return flowNow;
  })());
}
const cfs = v => v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(0) : v.toFixed(1);
const readAgo = at => { const m = Math.round((Date.now() - at) / 60000); return m < 90 ? `${Math.max(1, m)} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const toF = c => c * 9 / 5 + 32;
// where today's flow sits against every year on record for this date
function flowBand(v, pct){
  if(!pct) return null;
  const at = p => pct[p];
  return v < at(10) ? { k:"low", t:"Very low for this date" } : v < at(25) ? { k:"low", t:"Low for this date" } : v <= at(75) ? { k:"ok", t:"Normal for this date" } : v <= at(90) ? { k:"high", t:"High for this date" } : { k:"high", t:"Very high for this date" };
}
async function gaugeDetails(id){
  const c = gaugeDetail[id]; if(c && Date.now() - c.at < 30 * 60000) return c;
  const d = new Date(), md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await loadNorms();
  const local = normFor(id);
  const [series, stats] = await Promise.all([
    usgs("ogcapi/v0/collections/continuous/items", { f:"json", monitoring_location_id:id, parameter_code:"00060", time:"P7D", limit:"3000", properties:"time,value", skipGeometry:"true" }).catch(() => null),
    local ? null : usgs("statistics/v0/observationNormals", { monitoring_location_id:id, parameter_code:"00060", computation_type:"percentile", start_date:md, end_date:md }).catch(() => null) ]);
  const pts = ((series && series.features) || []).map(f => [Date.parse(f.properties.time), parseFloat(f.properties.value)]).filter(p => Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  let pct = local;
  if(!pct) try{ const v = stats.features[0].properties.data[0].values[0]; pct = {}; v.percentiles.forEach((p, i) => pct[+p] = parseFloat(v.values[i])); if(!Number.isFinite(pct[10]) || !Number.isFinite(pct[90])) pct = null; }catch(e){}
  return (gaugeDetail[id] = { at:Date.now(), pts, pct });
}
function sparkline(pts, pct){
  if(pts.length < 8) return "";
  const W = 260, H = 64, t0 = pts[0][0], t1 = pts[pts.length - 1][0], vs = pts.map(p => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs); if(pct){ lo = Math.min(lo, pct[25]); hi = Math.max(hi, pct[75]); } if(hi - lo < 1e-6) hi = lo + 1; const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const x = t => (t - t0) / (t1 - t0 || 1) * W, y = v => H - (v - lo) / (hi - lo) * H;
  const step = Math.max(1, Math.floor(pts.length / 130)), line = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const band = pct ? `<rect x="0" y="${y(pct[75]).toFixed(1)}" width="${W}" height="${Math.max(1, y(pct[25]) - y(pct[75])).toFixed(1)}" class="norm"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Flow over the last 7 days">${band}<path d="${line}"/><circle cx="${W - 1.5}" cy="${y(vs[vs.length - 1]).toFixed(1)}" r="3"/></svg><div class="sparkx"><span>7 days ago</span>${pct ? `<span class="normk">shaded: normal range</span>` : ""}<span>now</span></div>`;
}
function trendText(pts){
  if(pts.length < 8) return "";
  const now = pts[pts.length - 1], dayAgo = pts.filter(p => p[0] <= now[0] - 86400000).pop(), wk = pts[0];
  const ch = (a, b) => (b - a) / Math.max(a, .01);
  const d = dayAgo ? ch(dayAgo[1], now[1]) : 0, w = ch(wk[1], now[1]);
  return d > .15 ? `Rising: up ${Math.round(d * 100)}% since yesterday` : d < -.15 ? `Dropping: down ${Math.round(-d * 100)}% since yesterday` : w > .3 ? `Up ${Math.round(w * 100)}% over the week, steady today` : w < -.3 ? `Down ${Math.round(-w * 100)}% over the week, steady today` : "Steady this week";
}
function gaugeBody(g, det){
  const q = flowNow.q[g[0]], t = flowNow.t[g[0]], band = q ? flowBand(q[0], det ? det.pct : normFor(g[0])) : null, f = t ? toF(t[0]) : null;
  return `${q ? `<div class="flowbig"><b>${cfs(q[0])}</b> cfs${band ? ` <span class="pill flow-${band.k}">${band.t}</span>` : ""}</div><div class="meta">Read ${readAgo(q[1])}${det && det.pts.length ? " · " + esc(trendText(det.pts)) : ""}</div>` : `<p class="muted">No recent reading from this gauge.</p>`}
    ${f != null ? `<div class="meta${f >= 68 ? " warm" : ""}">Water ${Math.round(f)}°F${f >= 68 ? ". Warm for trout: fish early, or give them a rest" : ""}</div>` : ""}
    ${det ? sparkline(det.pts, det.pct) : q ? `<p class="status">Loading the last 7 days…</p>` : ""}`;
}
function gaugePopup(g){
  const div = document.createElement("div"); div.className = "pop";
  const paint = det => { div.innerHTML = `<h3>${esc(g[1])}</h3><div class="meta">USGS stream gauge${g[4] ? ` · drains ${Math.round(g[4]).toLocaleString()} sq mi` : ""}</div>${gaugeBody(g, det)}
      <div data-wx></div><div class="row"><button class="link" type="button" data-a="wx">Forecast here</button><a class="link" href="https://waterdata.usgs.gov/monitoring-location/${esc(g[0])}/" target="_blank" rel="noopener">USGS page</a></div>
      <small class="src">Provisional data from the U.S. Geological Survey. cfs = cubic feet of water per second.</small>`; refitPopup(div); };
  paint(gaugeDetail[g[0]] || null);
  if(navigator.onLine) loadFlows().then(() => gaugeDetails(g[0])).then(paint).catch(() => {});
  div.addEventListener("click", ev => { const b = ev.target.closest('[data-a="wx"]'); if(b){ b.hidden = true; showForecast(div.querySelector("[data-wx]"), g[2], g[3]); } });
  return div;
}
const gaugePins = new Map();
async function syncGauges(){
  const on = () => showGauges && map.getZoom() >= GAUGE_ZOOM;
  if(!on()){ keepPins(gaugeLayer, gaugePins, new Map()); return; }
  const list = await loadGauges(); await loadFlows();
  if(!on()){ keepPins(gaugeLayer, gaugePins, new Map()); return; }
  const b = map.getBounds().pad(.1), want = new Map();
  for(const g of list){ if(!b.contains([g[2], g[3]])) continue; const q = flowNow.q[g[0]], label = q ? `<b>${cfs(q[0])}</b> cfs` : "gauge";
    want.set(g[0] + label, () => L.marker([g[2], g[3]], { icon:L.divIcon({ className:"", html:`<div class="mk-gauge" title="${esc(g[1])}">${label}</div>`, iconSize:[0, 0] }), zIndexOffset:-100 }).bindPopup(() => gaugePopup(g), { maxWidth:300, minWidth:240 })); }
  keepPins(gaugeLayer, gaugePins, want);
}
document.addEventListener("mapsettled", syncGauges);
function syncGaugeKey(){ const b = $("gaugeToggle"); b.setAttribute("aria-pressed", String(showGauges)); b.textContent = showGauges ? "Stream flows on" : "Stream flows off"; }
$("gaugeToggle").onclick = () => { showGauges = !showGauges; lsSet("fl.gauges", showGauges); syncGaugeKey(); syncGauges(); };
syncGaugeKey();

/* the nearest gauge on a stream's own card: same river if there is one within about 40 miles, else nothing (a gauge on other water would mislead) */
function nearestGauge(name, ll){
  if(!gauges || !gauges.length) return null;
  const base = String(name || "").toLowerCase().replace(/,.*$/, "").trim(); if(!base) return null;
  let best = null, bd = 1e9;
  for(const g of gauges){ if(!g[1].toLowerCase().startsWith(base)) continue; const d = Math.sqrt(d2([g[3], g[2]], [ll.lng, ll.lat])) * 69; if(d < bd){ bd = d; best = g; } }
  return best && bd <= 40 ? { g:best, mi:bd } : null;
}
waterPopupExtras.push((div, info) => {
  if(info.isLake) return;
  const slot = document.createElement("div"); div.querySelector(".coords").before(slot);
  loadGauges().then(async () => {
    const hit = nearestGauge(info.name, info.ll); if(!hit) return;
    await loadFlows(); const q = flowNow.q[hit.g[0]]; if(!q) return;
    const paint = det => { const band = flowBand(q[0], det ? det.pct : normFor(hit.g[0])), t = flowNow.t[hit.g[0]], f = t ? toF(t[0]) : null;
      slot.innerHTML = `<div class="regs"><b>Flow</b><div><span>Now</span>${cfs(q[0])} cfs${band ? ` · ${band.t.toLowerCase()}` : ""}</div>${det && det.pts.length ? `<div><span>Trend</span>${esc(trendText(det.pts))}</div>` : ""}${f != null ? `<div><span>Water</span>${Math.round(f)}°F${f >= 68 ? " (warm for trout)" : ""}</div>` : ""}
        <small>${esc(hit.g[1])}, ${hit.mi < 1 ? "right here" : Math.round(hit.mi) + " mi away"} · read ${readAgo(q[1])} · <button class="link" type="button" data-gauge="${esc(hit.g[0])}">7-day chart</button></small></div>`; refitPopup(slot); };
    paint(gaugeDetail[hit.g[0]] || null); if(navigator.onLine) gaugeDetails(hit.g[0]).then(paint).catch(() => {});
  });
  const wx = document.createElement("div"); wx.className = "row"; wx.innerHTML = `<button class="link" type="button" data-a="wx">Forecast here</button>`; const wslot = document.createElement("div"); div.appendChild(wslot); div.appendChild(wx);
  div.addEventListener("click", ev => {
    if(ev.target.closest('[data-a="wx"]')){ wx.hidden = true; showForecast(wslot, info.ll.lat, info.ll.lng); }
    const gb = ev.target.closest("[data-gauge]"); if(gb){ const g = gauges.find(x => x[0] === gb.dataset.gauge); if(g) L.popup({ maxWidth:300, minWidth:240 }).setLatLng([g[2], g[3]]).setContent(gaugePopup(g)).openOn(map); }
  });
});

/* forecast: National Weather Service, for the exact point */
async function forecastAt(lat, lng){
  const key = lat.toFixed(2) + "," + lng.toFixed(2), c = wxCache[key]; if(c && Date.now() - c.at < 30 * 60000) return c.periods;
  const pt = await (await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, { headers:{ Accept:"application/geo+json" } })).json();
  const fc = await (await fetch(pt.properties.forecast, { headers:{ Accept:"application/geo+json" } })).json();
  const periods = (fc.properties.periods || []).slice(0, 4).map(p => ({ name:p.name, temp:p.temperature, unit:p.temperatureUnit, wind:`${p.windSpeed || ""} ${p.windDirection || ""}`.trim(), text:p.shortForecast, rain:p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value }));
  wxCache[key] = { at:Date.now(), periods }; return periods;
}
async function showForecast(slot, lat, lng){
  if(!navigator.onLine){ slot.innerHTML = `<p class="muted">The forecast needs a signal.</p>`; return; }
  slot.innerHTML = `<p class="status">Getting the forecast…</p>`; refitPopup(slot);
  try{
    const ps = await forecastAt(lat, lng); if(!ps.length) throw new Error("empty");
    slot.innerHTML = `<div class="regs wx"><b>Forecast here</b>${ps.map(p => `<div><span>${esc(p.name)}</span>${p.temp != null ? `${p.temp}°${esc(p.unit || "F")} · ` : ""}${esc(p.text || "")}${p.rain ? ` · ${p.rain}% rain` : ""}${p.wind ? ` · wind ${esc(p.wind)}` : ""}</div>`).join("")}<small>National Weather Service</small></div>`;
  }catch(e){ slot.innerHTML = `<p class="muted">Couldn't get the forecast just now.</p>`; }
  refitPopup(slot);
}

/* iPhone page zoom: block pinching the app's panels and buttons (the map keeps its own pinch), and if a text box zoomed the
   page anyway, snap it back when you leave the box. */
document.addEventListener("gesturestart", e => { if(!(e.target.closest && e.target.closest("#map"))) e.preventDefault(); }, { passive:false });
document.addEventListener("focusout", e => {
  if(!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !window.visualViewport || visualViewport.scale <= 1.01) return;
  const m = document.querySelector('meta[name=viewport]'); if(!m) return;
  const c = m.content; m.content = c + ",user-scalable=no"; setTimeout(() => { m.content = c; }, 300);
});


/* ---------- sign in ---------- */
let authMode = "in";
function setAuthMode(m){
  authMode = m;
  $("authInTab").setAttribute("aria-pressed", m === "in"); $("authUpTab").setAttribute("aria-pressed", m === "up");
  $("nameRow").hidden = $("yearRow").hidden = $("agreeRow").hidden = m !== "up";
  $("pwRow").hidden = m === "reset";
  $("aEmail").closest(".field").hidden = m === "newpw";
  $("aPw").autocomplete = m === "in" ? "current-password" : "new-password";
  // signing in takes an email or a username; everything else needs the email itself
  const em = $("aEmail"); em.type = m === "in" ? "text" : "email"; em.autocomplete = m === "in" ? "username" : "email";
  em.placeholder = m === "in" ? "you@example.com or your username" : "you@example.com";
  document.querySelector('label[for="aEmail"]').textContent = m === "in" ? "Email or username" : "Email";
  $("pwRow").querySelector("label").textContent = m === "newpw" ? "New password" : "Password";
  $("authGo").textContent = { in:"Sign in", up:"Create account", reset:"Send reset link", newpw:"Save new password" }[m];
  $("forgotBtn").hidden = m !== "in";
  $("stayRow").hidden = m === "reset" || m === "newpw";
  $("authMsg").textContent = ""; $("authMsg").className = "hint";
}
try{ $("aStay").checked = lsGet("fl.stay", true); }catch(e){}
$("pwShow").onclick = () => {
  const show = $("aPw").type === "password";
  $("aPw").type = show ? "text" : "password";
  $("pwShow").textContent = show ? "Hide" : "Show";
  $("pwShow").setAttribute("aria-pressed", String(show)); $("pwShow").setAttribute("aria-label", show ? "Hide password" : "Show password");
  $("aPw").focus({ preventScroll:true });
};
$("authInTab").onclick = () => setAuthMode("in");
$("authUpTab").onclick = () => setAuthMode("up");
$("forgotBtn").onclick = () => setAuthMode("reset");
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("authMsg"), pw = $("aPw").value, go = $("authGo");
  // forgive small typing slips: spaces (and invisible ones), a comma for a dot, a stray dot at the end, capitals
  const email = $("aEmail").value.replace(/[\s​-‍⁠﻿]+/g, "").replace(/,/g, ".").replace(/\.+$/, "").toLowerCase();
  if(email && email !== $("aEmail").value) $("aEmail").value = email;
  msg.className = "hint bad";
  // no @ sign (or only a leading one) when signing in: it's a username
  const uname = authMode === "in" && !/.@/.test(email) ? email.replace(/^@+/, "") : null;
  if(uname !== null && !/^[a-z0-9][a-z0-9_.]{2,19}$/.test(uname)){ msg.textContent = uname ? "That doesn't look like an email or a username." : "Enter your email or username."; $("aEmail").focus(); return; }
  if(uname === null && authMode !== "newpw" && !/^[^@]+@[^@]+\.[^@.]{2,}$/.test(email)){
    msg.textContent = !email ? "Enter your email address."
      : !email.includes("@") ? "That email is missing the @ sign."
      : (email.match(/@/g) || []).length > 1 ? "That email has more than one @ sign."
      : `That email is missing its ending, like .com. You typed: ${email}`;
    $("aEmail").focus(); return; }
  if(authMode !== "reset" && pw.length < 8){ msg.textContent = "Passwords need at least 8 characters."; $("aPw").focus(); return; }
  if(authMode === "up" && !$("aName").value.trim()){ msg.textContent = "Add your name so friends know who you are."; $("aName").focus(); return; }
  if(authMode === "up"){ const ye = checkBirthYear($("aYear").value); if(ye){ msg.textContent = ye; $("aYear").focus(); return; }
    if(!$("aAgree").checked || !$("aRegs").checked){ msg.textContent = "Check both boxes to create your account."; return; } }
  go.disabled = true;
  lsSet("fl.stay", $("aStay").checked);
  const redirect = location.origin + location.pathname;
  try{
    if(authMode === "in" && uname !== null){
      // the server finds the account for this username and signs in; the app never learns anyone's email from a username
      const { data, error } = await sb.functions.invoke("signin", { body:{ username:uname, password:pw } });
      const why = error ? "down" : data?.error;
      if(why === "wait") throw new Error("Too many tries. Wait 15 minutes, or sign in with your email.");
      if(why === "confirm") throw new Error("Confirm your email first. Check your inbox for the link.");
      if(why === "down") throw new Error("Couldn't check that username right now. Try again, or sign in with your email.");
      if(why || !data?.access_token) throw new Error("That username and password don't match.");
      const set = await sb.auth.setSession({ access_token:data.access_token, refresh_token:data.refresh_token });
      if(set.error) throw new Error("Couldn't finish signing in. Try again, or sign in with your email.");
    } else if(authMode === "in"){
      const { error } = await sb.auth.signInWithPassword({ email, password:pw });
      if(error) throw new Error(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match.");
    } else if(authMode === "up"){
      const { data, error } = await sb.auth.signUp({ email, password:pw, options:{ data:{ display_name:$("aName").value.trim(), birth_year:$("aYear").value.trim(), terms_version:String(TERMS_VERSION) }, emailRedirectTo:redirect } });
      if(error) throw new Error(/registered/i.test(error.message) ? "That email already has an account. Sign in instead." : /database|saving new user/i.test(error.message) ? "Couldn't create the account. Coulee is for people 13 and older." : error.message);
      if(!data.session){ setAuthMode("in"); $("aEmail").value = email; msg.className = "hint ok"; msg.textContent = "Check your email and tap the confirmation link, then sign in here."; }
    } else if(authMode === "reset"){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:redirect });
      if(error) throw new Error("Couldn't send the email. Wait a minute and try again.");
      msg.className = "hint ok"; msg.textContent = "Check your email for a link to set a new password.";
    } else {
      const { error } = await sb.auth.updateUser({ password:pw });
      if(error) throw new Error("Couldn't save the new password. Try again.");
      $("auth").hidden = true; toast("Password updated. You're signed in."); history.replaceState(null, "", location.pathname);
    }
  }catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Something went wrong. Try again."; }
  finally{ go.disabled = false; }
});

let recoveryShown = false;
function showNewPassword(){ if(recoveryShown) return; recoveryShown = true; $("auth").hidden = false; setAuthMode("newpw"); $("authMsg").className = "hint ok"; $("authMsg").textContent = "Choose a new password for your account."; }
async function startSession(user){
  if(RECOVERY_LINK) showNewPassword();
  if(me && me.id === user.id) return;
  me = { id:user.id, email:user.email };
  outbox = lsGet(outboxKey(), []);
  const cache = lsGet(cacheKey(), null);
  if(cache){ ({ catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile } = { ...cache }); follows = cache.follows || []; outings = cache.outings || []; groupTrips = cache.groupTrips || []; tournaments = cache.tournaments || []; announcements = cache.announcements || [];
    for(const j of outbox) if(j.photo){ idb.get(j.photo).then(b => { if(b){ pendingPhotoUrls[j.photo] = URL.createObjectURL(b); renderAll(); } }).catch(()=>{}); } }
  loadState = navigator.onLine ? "loading" : "offline";
  if(!recoveryShown) $("auth").hidden = true; canWrite = true;
  applyPrefs(); renderAll(); updateSync(); applyGate();
  await loadAll(); flush();
}
function showAuth(){ me = null; $("auth").hidden = false; setAuthMode("in"); }
sb.auth.onAuthStateChange((event, session) => {
  if(event === "PASSWORD_RECOVERY"){ showNewPassword(); if(session?.user) startSession(session.user); return; }
  if(session?.user) startSession(session.user);
  else if(event === "SIGNED_OUT" && !storedUser()) showAuth();
});

/* ---------- start ---------- */
tab = lsGet("fl.tab", "map");
renderAll();
// Open straight from the sign-in saved on this phone, so the app works with no signal.
// Checking it with the server can take a while (or fail) offline; that must never sign anyone out.
function storedUser(){ try{ const s = JSON.parse(authStore.getItem("fl.auth") || "null"); return s?.user?.id ? s.user : null; }catch(e){ return null; } }
let offlineAuth = false;
const saved = storedUser();
if(saved) startSession(saved);
const { data:{ session } } = await Promise.race([
  sb.auth.getSession().catch(() => ({ data:{ session:null }, failed:true })),
  new Promise(r => setTimeout(() => r({ data:{ session:null }, slow:true }), saved ? 4000 : 15000))
]);
if(session?.user) startSession(session.user);
else if(storedUser()) offlineAuth = true;            // couldn't reach the server: keep going from this phone
else if(saved){ me = null; showAuth(); }              // the server rejected the saved sign-in
else { showAuth(); if(LINK_ERROR){ $("authMsg").className = "hint bad"; $("authMsg").textContent = /expired|invalid/i.test(decodeURIComponent(LINK_ERROR)) ? "That email link has expired or was already used. Request a new one." : decodeURIComponent(LINK_ERROR.replace(/\+/g, " ")); } }

async function recheckAuth(){
  if(!offlineAuth || !navigator.onLine) return;
  const { data:{ session } } = await sb.auth.getSession().catch(() => ({ data:{ session:null } }));
  if(session?.user){ offlineAuth = false; loadAll(); flush(); }
  else if(!storedUser()){ offlineAuth = false; me = null; showAuth(); }
}
window.addEventListener("online", recheckAuth);
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") recheckAuth(); });

if("serviceWorker" in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(reg => {
    // look for a new version whenever the app comes back to the front
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(e => console.warn("offline support unavailable", e));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading || !hadController) return;
    // never pull the page out from under someone mid-entry: offer a refresh instead
    if(appBusy()) showUpdateReady(); else { reloading = true; location.reload(); }
  });
}
})().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<div style="position:fixed;inset:auto 16px 16px;padding:12px 14px;border-radius:12px;background:#2C2922;color:#FAF6EB;z-index:3000;font:15px system-ui">The map couldn't start. Check your connection and reopen the app.</div>`);
});

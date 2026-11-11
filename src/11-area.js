
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

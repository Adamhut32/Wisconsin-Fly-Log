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

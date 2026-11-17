
/* ---------- creek & lake search ---------- */
let nameIndex = null, qSel = 0, qList = [];
async function loadIndex(){ if(nameIndex) return nameIndex; try{ const r = await fetch(dataUrl("water/index.json")); nameIndex = await r.json(); }catch(e){ nameIndex = []; } return nameIndex; }
function renderQ(){
  const ul = $("qres");
  if(!qList.length){ ul.hidden = !$("q").value.trim(); ul.innerHTML = $("q").value.trim() ? `<li><button disabled>No creeks, lakes or stocked fish by that name</button></li>` : ""; return; }
  ul.hidden = false;
  ul.innerHTML = qList.map((r,i) => {
    if(r.stockHead) return `<li class="stockcard"><div class="sctop"><b>${esc(cap(r.label))}</b> stocked in <b>${r.n}</b> water${r.n === 1 ? "" : "s"}<small>Wisconsin DNR stocking, last 3 years</small></div>
      <button class="btn sm ink" type="button" data-i="${i}">Show them on the map</button></li>`;
    if(r.sub) return `<li class="qsub">${esc(r.sub)}</li>`;
    if(r.back) return `<li><button class="stockback" data-i="${i}">‹ Back to search</button></li>`;
    if(r.more) return `<li><button class="stockmore" data-i="${i}">${esc(r.text)}</button></li>`;
    if(r.stocked) return `<li><button class="srow ${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)}${r.dist ? ` · ${esc(r.dist)}` : ""}<br>${esc(r.what)}</small></button></li>`;
    return `<li><button class="${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)}</small></button></li>`;
  }).join("");
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

/* ---------- stocked fish: type a fish (brook trout, walleye, musky…) to see where the DNR stocked it ----------
   Build 38 hid this behind a header you had to tap, the list closed itself on that tap, it sat under the map style
   buttons on phones, and "nearest" meant nearest the middle of the map without saying so. Now the closest waters show
   right away with distances, and "Show them on the map" puts every one on the map. */
let stockIdx = null, stockAll = 5;
async function loadStockIdx(){ if(stockIdx) return stockIdx; try{ stockIdx = await (await fetch(dataUrl("stocking/index.json"))).json(); }catch(e){ stockIdx = {}; } return stockIdx; }
const SP_ALIASES = [["brook trout","Brook Trout"],["brookie","Brook Trout"],["brown trout","Brown Trout"],["brownie","Brown Trout"],["rainbow trout","Rainbow Trout"],["rainbow","Rainbow Trout"],["bow","Rainbow Trout"],["steelhead","Rainbow Trout"],
  ["trout",["Brook Trout","Brown Trout","Rainbow Trout"]],["walleye","Walleye"],["tiger musk","Northern Pike X Muskellunge"],["musky","Muskellunge"],["muskie","Muskellunge"],["muskellunge","Muskellunge"],["yellow perch","Yellow Perch"],["perch","Yellow Perch"],
  ["crappie","Black Crappie"],["bluegill","Bluegill"],["panfish",["Bluegill","Black Crappie","Yellow Perch","Pumpkinseed"]],["largemouth","Largemouth Bass"],["smallmouth","Smallmouth Bass"],["smallie","Smallmouth Bass"],["bass",["Largemouth Bass","Smallmouth Bass"]],["northern pike","Northern Pike"],["northern","Northern Pike"],["pike","Northern Pike"],
  ["catfish","Channel Catfish"],["salmon",["Chinook Salmon","Coho Salmon"]],["chinook","Chinook Salmon"],["king salmon","Chinook Salmon"],["king","Chinook Salmon"],["coho","Coho Salmon"],["sturgeon","Lake Sturgeon"],["lake trout","Lake Trout"],["laker","Lake Trout"],["splake","Splake"]];
const SP_LABEL = { "Brook Trout,Brown Trout,Rainbow Trout":"trout", "Largemouth Bass,Smallmouth Bass":"bass", "Chinook Salmon,Coho Salmon":"salmon", "Bluegill,Black Crappie,Yellow Perch,Pumpkinseed":"panfish" };
function stockSpecies(q){
  q = q.replace(/^stocked( with)?\s*/, "").replace(/\s*stocked$/, "").replace(/s$/, "").trim(); if(q.length < 3) return null;
  for(const [k, v] of SP_ALIASES){ const kk = k.replace(/s$/, ""); if(q === kk || (q.length >= 4 && kk.startsWith(q)) || q.startsWith(kk + " ")) return [].concat(v); }
  return null;
}
// where distances are measured from: you (if Coulee has your location), else the map when you're zoomed in on an area
function stockFrom(){
  if(typeof hereFix !== "undefined" && hereFix && hereFix.cid) return { ll:L.latLng(hereFix.lat, hereFix.lng), you:true };
  if(map.getZoom() >= 8.5 || currentCounty) return { ll:map.getCenter(), you:false };
  return null;
}
function stockedList(species){
  const idx = stockIdx || {}, from = stockFrom(), byKey = new Map();
  for(const sp of species) for(const e of idx[sp] || []){ const k = e[0] + "|" + e[1]; const o = byKey.get(k) || { e, sps:[], year:0, fish:0 }; o.sps.push(sp); o.year = Math.max(o.year, e[2]); o.fish += e[3]; byKey.set(k, o); }
  const where = o => { const hit = o.e[5] && (nameIndex || []).find(x => x[0] === o.e[0]); const p = hit && hit[1].find(q => q[0] === o.e[1]);
    if(p) return { places:[p], ll:L.latLng((p[2] + p[4]) / 2, (p[1] + p[3]) / 2) };
    const b = countyBounds && countyBounds[o.e[1]]; return { places:null, ll: b ? b.getCenter() : null }; };
  return [...byKey.values()].map(o => { const w = where(o), d = from && w.ll ? map.distance(from.ll, w.ll) : null;
      return { stocked:true, name:o.e[0], cid:o.e[1], places:w.places, ll:w.ll, year:o.year, fish:o.fish, d,
        counties: countyName(o.e[1]) || "", dist: d == null ? "" : `${Math.max(1, Math.round(d / 1609))} mi${from.you ? " away" : ""}`,
        what: `${species.length > 1 ? o.sps.map(x => x.replace(/ (Trout|Bass|Salmon)$/, "")).join(", ") + " · " : ""}Stocked ${o.year}${o.fish ? ` · ${o.fish.toLocaleString()} fish` : ""}` }; })
    .sort((a, b) => from ? (a.d ?? 1e12) - (b.d ?? 1e12) : b.year - a.year || b.fish - a.fish);
}
function stockSortNote(){ const f = stockFrom(); return f ? (f.you ? "Closest to you" : "Closest to the part of the map you're looking at") : "Most recently stocked (zoom in or tap the location button to sort by distance)"; }
function showStockedList(head){
  const all = stockedList(head.species);
  qList = [{ back:true }, head, { sub:stockSortNote() }, ...all.slice(0, stockAll)]; if(all.length > stockAll) qList.push({ more:true, all:true, head, text:`Show ${Math.min(40, all.length - stockAll)} more` });
  qSel = -1; renderQ(); $("qres").scrollTop = 0;
}
$("q").addEventListener("focus", loadIndex);
$("q").addEventListener("input", async () => {
  const q = $("q").value.trim().toLowerCase(); const idx = await loadIndex();
  if(q.length < 2){ qList = []; renderQ(); return; }
  const sp = stockSpecies(q), out = [], names = [];
  for(const [name, places] of idx){ if(name === "NA" || name === "Unnamed") continue; const n = name.toLowerCase(); const k = n.startsWith(q) ? 0 : n.includes(" " + q) ? 1 : n.includes(q) ? 2 : -1; if(k < 0) continue;
    names.push({ k, name, places, counties: places.map(p => byId[p[0]]?.properties.name).filter(Boolean).slice(0,3).join(", ") + (places.length > 3 ? "…" : "") }); }
  names.sort((a,b)=>a.k-b.k||a.name.length-b.name.length||a.name.localeCompare(b.name));
  if(sp){ await loadStockIdx(); if($("q").value.trim().toLowerCase() !== q) return;
    const all = stockedList(sp);
    if(all.length){ const head = { stockHead:true, species:sp, label:SP_LABEL[sp.join(",")] || sp[0].toLowerCase(), n:all.length };
      stockAll = 5; out.push(head, { sub:stockSortNote() }, ...all.slice(0, 3));
      if(all.length > 3) out.push({ more:true, head, text:`See all ${all.length} in a list` });
      if(names.length) out.push({ sub:"Creeks and lakes by that name" }); } }
  out.push(...names.slice(0, sp ? 6 : 11));
  qList = out; qSel = out.findIndex(r => !r.sub && !r.stockHead && !r.more); renderQ();
});
$("q").addEventListener("keydown", e => {
  const ok = i => qList[i] && !qList[i].sub;
  if(e.key === "ArrowDown"){ let i = qSel; do i++; while(i < qList.length && !ok(i)); if(ok(i)){ qSel = i; renderQ(); } e.preventDefault(); }
  if(e.key === "ArrowUp"){ let i = qSel; do i--; while(i >= 0 && !ok(i)); if(ok(i)){ qSel = i; renderQ(); } e.preventDefault(); }
  if(e.key === "Enter" && qList[qSel]){ pickQ(qList[qSel]); e.preventDefault(); }
  if(e.key === "Escape"){ $("qres").hidden = true; $("q").blur(); }
});
$("qres").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if(b){ e.stopPropagation(); pickQ(qList[+b.dataset.i]); } });
function pickQ(r){
  if(!r || r.sub) return;
  if(r.stockHead) return showStockMap(r);
  if(r.more){ stockAll = r.all ? stockAll + 40 : 40; showStockedList(r.head); return; }
  if(r.back){ $("q").dispatchEvent(new Event("input")); return; }
  if(r.stocked) return goStocked(r);
  goTo(r);
}
function goStocked(r){
  const note = `${r.what}`;
  if(r.places) return goTo({ name:r.name, places:r.places }, note);
  $("qres").hidden = true; $("q").blur(); openCounty(r.cid); toast(`${r.name} isn't drawn on the map under that name. It's in ${countyName(r.cid)}. ${note}.`);
}
// a tap that re-draws the list replaces the button that was tapped; that must not count as a tap outside the search
document.addEventListener("click", e => { if(!e.target.isConnected) return; if(!e.target.closest(".search") && !e.target.closest("#qres")) $("qres").hidden = true; });

/* every stocked water on the map, with a bar under the search to clear them */
pane("stockpins", 615, true);
var stockLayer = null, stockRows = [], stockR = null;
function showStockMap(head){
  clearStockMap();
  const rows = stockedList(head.species).filter(r => r.places);
  if(!rows.length){ toast("None of those waters are drawn on the map."); return; }
  stockRows = rows; stockR ||= L.canvas({ pane:"stockpins", padding:.3, tolerance:8 });
  stockLayer = L.layerGroup(rows.map((r, i) => L.circleMarker(r.ll, { renderer:stockR, radius:7, weight:2, color:"#FFFFFF", fillColor:"#C2571B", fillOpacity:.95 })
    .bindPopup(() => `<div class="pop"><h3>${esc(r.name)}</h3><div class="meta">${esc(r.counties)}${r.dist ? ` · ${esc(r.dist)}` : ""}</div><div class="meta">${esc(cap(head.label))}: ${esc(r.what)}</div>
      <div class="row"><button class="btn sm ink" type="button" data-stockgo="${i}">Go to this water</button></div></div>`, { maxWidth:280 }))).addTo(map);
  let chip = $("stockChip"); if(!chip){ chip = document.createElement("div"); chip.id = "stockChip"; chip.className = "stockchip"; document.querySelector(".crumb").appendChild(chip); }
  chip.innerHTML = `<span>${esc(cap(head.label))} stocked · ${rows.length} waters</span><button type="button" aria-label="Clear stocked waters" data-stockclear>✕</button>`;
  chip.hidden = false;
  $("qres").hidden = true; $("q").blur();
  if(currentCounty) leaveCounty();
  map.fitBounds(L.latLngBounds(rows.map(r => r.ll)), { padding:[40, 40], maxZoom:11 });
}
function clearStockMap(){ if(stockLayer){ map.removeLayer(stockLayer); stockLayer = null; } if(stockR){ dropCanvas(stockR); stockR = null; } const c = $("stockChip"); if(c) c.hidden = true; }
document.addEventListener("click", e => {
  if(e.target.closest("[data-stockclear]")){ clearStockMap(); return; }
  const g = e.target.closest("[data-stockgo]"); if(g){ const r = stockRows[+g.dataset.stockgo]; map.closePopup(); if(r) goStocked(r); }
});
async function goTo(r, note){
  $("qres").hidden = true; $("q").value = r.name; $("q").blur();
  // the place with the biggest stretch of this water
  const p = r.places.slice().sort((a,b)=>((b[3]-b[1])*(b[4]-b[2]))-((a[3]-a[1])*(a[4]-a[2])))[0];
  const cid = p[0];
  if(currentCounty !== cid){ openCounty(cid); await new Promise(r => { map.once("moveend", r); setTimeout(r, 1500); }); }
  await showDetail(cid);
  const b = L.latLngBounds([p[2],p[1]],[p[4],p[3]]);
  map.fitBounds(b, { padding:[50,50], maxZoom:14 });
  map.once("moveend", () => { if(p[5] === "s"){ setHover(r.name); clearTimeout(flashT); flashT = setTimeout(() => setHover(null), 3200); }
    else { const l = detailLakes.find(x => x.name === r.name); if(l){ l.poly.setStyle({ color:css("--hl"), weight:4 }); setTimeout(() => l.poly.setStyle({ color:css("--stream"), weight:.7 }), 3200); } }
    if(note) waterNote(r.name, p, note); });
}

// after going to a stocked water: a small card on the water itself, so you can see which one it is and what was stocked
function waterNote(name, p, note){
  const c = L.latLng((p[2] + p[4]) / 2, (p[1] + p[3]) / 2);
  let at = c, best = Infinity;
  const l = p[5] !== "s" && detailLakes.find(x => x.name === name);
  if(l) at = l.poly.getBounds().getCenter();
  else for(const s of detailStreams) if(s.name === name) for(const line of s.ll) for(const q of line){ const d = map.distance(c, q); if(d < best){ best = d; at = L.latLng(q[0], q[1]); } }
  L.popup({ maxWidth:260, className:"stocknote" }).setLatLng(at).setContent(`<div class="pop"><h3>${esc(name)}</h3><div class="meta">${esc(note)}</div></div>`).openOn(map);
}

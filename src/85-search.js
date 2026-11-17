
/* ---------- creek & lake search ---------- */
let nameIndex = null, qSel = 0, qList = [];
async function loadIndex(){ if(nameIndex) return nameIndex; try{ const r = await fetch(dataUrl("water/index.json")); nameIndex = await r.json(); }catch(e){ nameIndex = []; } return nameIndex; }
function renderQ(){
  const ul = $("qres");
  if(!qList.length){ ul.hidden = !$("q").value.trim(); ul.innerHTML = $("q").value.trim() ? `<li><button disabled>No creeks or lakes by that name</button></li>` : ""; return; }
  ul.hidden = false;
  ul.innerHTML = qList.map((r,i) => {
    if(r.stockHead) return `<li><button class="stockhead ${i===qSel?"on":""}" data-i="${i}"><span class="wname">Waters stocked with ${esc(r.label)}</span><small>${r.n} waters the DNR stocked in the last 3 years · nearest first</small></button></li>`;
    if(r.back) return `<li><button class="stockback" data-i="${i}">‹ Back to search</button></li>`;
    if(r.more) return `<li><button class="stockmore" data-i="${i}">Show ${r.more} more</button></li>`;
    if(r.stocked) return `<li><button class="${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)} · ${esc(r.what)}</small></button></li>`;
    return `<li><button class="${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)}</small></button></li>`;
  }).join("");
}

/* ---------- "stocked with ...": type a fish (brook trout, walleye, musky…) to list the waters the DNR stocked with it ---------- */
let stockIdx = null, stockShown = 40;
async function loadStockIdx(){ if(stockIdx) return stockIdx; try{ stockIdx = await (await fetch(dataUrl("stocking/index.json"))).json(); }catch(e){ stockIdx = {}; } return stockIdx; }
const SP_ALIASES = [["brook trout","Brook Trout"],["brookie","Brook Trout"],["brookies","Brook Trout"],["brown trout","Brown Trout"],["rainbow trout","Rainbow Trout"],["rainbow","Rainbow Trout"],["steelhead","Rainbow Trout"],
  ["trout",["Brook Trout","Brown Trout","Rainbow Trout"]],["walleye","Walleye"],["tiger musk","Northern Pike X Muskellunge"],["musky","Muskellunge"],["muskie","Muskellunge"],["muskellunge","Muskellunge"],["yellow perch","Yellow Perch"],["perch","Yellow Perch"],
  ["crappie","Black Crappie"],["bluegill","Bluegill"],["largemouth","Largemouth Bass"],["smallmouth","Smallmouth Bass"],["bass",["Largemouth Bass","Smallmouth Bass"]],["northern pike","Northern Pike"],["pike","Northern Pike"],
  ["catfish","Channel Catfish"],["salmon",["Chinook Salmon","Coho Salmon"]],["chinook","Chinook Salmon"],["king salmon","Chinook Salmon"],["coho","Coho Salmon"],["sturgeon","Lake Sturgeon"],["lake trout","Lake Trout"],["splake","Splake"]];
function stockSpecies(q){
  q = q.replace(/^stocked( with)?\s*/, "").replace(/s$/, "").trim(); if(q.length < 4) return null;
  for(const [k, v] of SP_ALIASES){ const kk = k.replace(/s$/, ""); if(q === kk || kk.startsWith(q) || q.startsWith(kk + " ")) return [].concat(v); }
  return null;
}
function stockedList(species){
  const idx = stockIdx || {}, c = (typeof hereFix !== "undefined" && hereFix) ? L.latLng(hereFix.lat, hereFix.lng) : map.getCenter(), byKey = new Map();
  for(const sp of species) for(const e of idx[sp] || []){ const k = e[0] + "|" + e[1]; const o = byKey.get(k) || { e, sps:[], year:0, fish:0 }; o.sps.push(sp); o.year = Math.max(o.year, e[2]); o.fish += e[3]; byKey.set(k, o); }
  const where = o => { const hit = o.e[5] && (nameIndex || []).find(x => x[0] === o.e[0]); const p = hit && hit[1].find(q => q[0] === o.e[1]);
    if(p) return { places:[p], ll:[(p[2] + p[4]) / 2, (p[1] + p[3]) / 2] };
    const b = byId[o.e[1]] && L.geoJSON(byId[o.e[1]]).getBounds(); return { places:null, ll: b ? [b.getCenter().lat, b.getCenter().lng] : [c.lat, c.lng] }; };
  return [...byKey.values()].map(o => { const w = where(o); return { stocked:true, name:o.e[0], cid:o.e[1], places:w.places,
      counties: byId[o.e[1]]?.properties.name || "", d: map.distance(c, w.ll),
      what: `${species.length > 1 ? o.sps.map(x => x.replace(/ (Trout|Bass|Salmon)$/, "")).join(", ") + " · " : ""}${o.year}${o.fish ? ` · ${o.fish.toLocaleString()} fish` : ""}` }; })
    .sort((a, b) => a.d - b.d);
}
function showStocked(species, label){
  const all = stockedList(species);
  qList = [{ back:true }, ...all.slice(0, stockShown)]; if(all.length > stockShown) qList.push({ more: all.length - stockShown, species, label });
  qSel = 1; renderQ();
}
$("q").addEventListener("focus", loadIndex);
$("q").addEventListener("input", async () => {
  const q = $("q").value.trim().toLowerCase(); const idx = await loadIndex();
  if(q.length < 2){ qList = []; renderQ(); return; }
  const sp = stockSpecies(q), out = [];
  if(sp){ await loadStockIdx(); const n = new Set(sp.flatMap(x => (stockIdx[x] || []).map(e => e[0] + "|" + e[1]))).size;
    if(n){ stockShown = 40; const label = sp.length > 1 ? (q.includes("salmon") ? "salmon" : q.includes("bass") ? "bass" : "trout") : sp[0].toLowerCase(); out.push({ k:-1, stockHead:true, species:sp, label, n }); } }
  for(const [name, places] of idx){ const n = name.toLowerCase(); const k = n.startsWith(q) ? 0 : n.includes(" " + q) ? 1 : n.includes(q) ? 2 : -1; if(k < 0) continue;
    out.push({ k, name, places, counties: places.map(p => byId[p[0]]?.properties.name).filter(Boolean).slice(0,3).join(", ") + (places.length > 3 ? "…" : "") }); }
  out.sort((a,b)=>a.k-b.k||a.name.length-b.name.length||a.name.localeCompare(b.name));
  qList = out.slice(0, 11); qSel = 0; renderQ();
});
$("q").addEventListener("keydown", e => {
  if(e.key === "ArrowDown"){ qSel = Math.min(qSel+1, qList.length-1); renderQ(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ qSel = Math.max(qSel-1, 0); renderQ(); e.preventDefault(); }
  if(e.key === "Enter" && qList[qSel]){ pickQ(qList[qSel]); e.preventDefault(); }
  if(e.key === "Escape"){ $("qres").hidden = true; $("q").blur(); }
});
$("qres").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if(b) pickQ(qList[+b.dataset.i]); });
function pickQ(r){
  if(!r) return;
  if(r.stockHead){ stockShown = 40; showStocked(r.species, r.label); lastStock = r; return; }
  if(r.more){ stockShown += 40; showStocked(r.species, r.label); return; }
  if(r.back){ $("q").dispatchEvent(new Event("input")); return; }
  if(r.stocked){
    if(r.places) return goTo({ name:r.name, places:r.places });
    $("qres").hidden = true; $("q").blur(); openCounty(r.cid); toast(`${r.name} isn't drawn on the map by that name; it's in ${countyName(r.cid)}.`); return;
  }
  goTo(r);
}
let lastStock = null;
document.addEventListener("click", e => { if(!e.target.closest(".search") && !e.target.closest("#qres")) $("qres").hidden = true; });
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

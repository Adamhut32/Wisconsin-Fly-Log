
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
    markerLayer.addLayer(m); markerIndex["c:"+c.id] = m;
  }
  for(const c of friendCatches){
    if(c.lat == null || (mapPerson && c.user_id !== mapPerson)) continue;
    const first = (c.display_name || "Friend").split(" ")[0];
    const url = photoSrc(c.photo_path);
    const html = `<div class="mk-fish friend${url ? " ph" : ""}" ${url ? `style="background-image:url('${url}')"` : ""}>${url ? "" : icon("i-fish")}${fishOf(c)>1?`<span class="n">${fishOf(c)}</span>`:""}${mapPerson ? "" : `<span class="mk-name">${esc(first)}</span>`}</div>`;
    const m = L.marker([c.lat,c.lng], { icon:L.divIcon({ className:"", html, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:300, title:`${c.display_name}: ${c.species||"Catch"}` });
    m.bindPopup(() => friendCatchPopup(c), { maxWidth:320, autoPanPadding:[20,20] });
    friendLayer.addLayer(m); markerIndex["f:"+c.id] = m;
  }
  for(const s of friendSpots){
    if(s.lat == null || (mapPerson ? s.user_id !== mapPerson : !showFriends)) continue;
    const m = L.marker([s.lat,s.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-spot friend ${esc(s.status || "")}"></div>`, iconSize:[0,0] }), riseOnHover:true, zIndexOffset:200, title:`${s.display_name}: ${s.name || "Spot"}` });
    m.bindPopup(() => friendSpotPopup(s), { maxWidth:300, autoPanPadding:[20,20] });
    friendLayer.addLayer(m); markerIndex["fs:"+s.id] = m;
  }
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
    ${url?`<img src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
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
    ${url?`<img src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
    ${c.notes?`<p style="margin:6px 0">${esc(c.notes)}</p>`:""}
    <div class="row">${c.lat!=null?`<a class="link" href="${gmaps(c.lat,c.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>`:""}${mapPerson ? "" : `<button class="link" type="button" data-pmap="${esc(c.user_id)}">See ${esc((c.display_name || "their").split(" ")[0])}'s map</button>`}</div>`;
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
  map.flyTo(ll, Math.max(map.getZoom(), 12), { duration:.6 });
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

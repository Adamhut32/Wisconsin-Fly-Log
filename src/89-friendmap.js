
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
    ${withPhotos.length ? `<div class="pgrid">${withPhotos.map(c => `<button type="button" class="pcell" data-pcatch="${esc(c.id)}" aria-label="${esc(c.species || "Fish")}">${phImg(c.photo_path, `alt="" loading="lazy"`)}<span>${esc([c.species || "Fish", c.length_in ? `${+c.length_in}"` : ""].filter(Boolean).join(" · "))}</span></button>`).join("")}</div>`
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

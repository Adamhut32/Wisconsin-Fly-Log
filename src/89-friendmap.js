
/* ---------- a friend's map: only what they share with you, in friend blue ---------- */

function personName(id){ return people[id]?.display_name || friendCatches.find(c => c.user_id === id)?.display_name || friendSpots.find(s => s.user_id === id)?.display_name || follows.find(f => f.user_id === id)?.display_name || "Friend"; }
function friendSpotPopup(s){
  const div = document.createElement("div"); div.className = "pop";
  div.innerHTML = `<div class="meta" style="color:var(--friend);font-weight:700">${esc(s.display_name)}'s spot</div>
    <h3>${esc(s.name || "Spot")}</h3>
    <div class="meta">${esc([s.water, s.trout_class, s.status === "want" ? "Wants to fish" : s.status === "scouted" ? "Scouted" : s.status === "fished" ? "Fished" : "", countyName(s.county)].filter(Boolean).join(" · "))}</div>
    <div class="row"><a class="link" href="${gmaps(s.lat, s.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>${mapPerson ? "" : `<button class="link" type="button" data-pmap="${esc(s.user_id)}">See ${esc((s.display_name || "their").split(" ")[0])}'s map</button>`}</div>`;
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
    openCounty(cids[0]); setTimeout(() => map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom:13, padding:[60,60] }), 700);
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

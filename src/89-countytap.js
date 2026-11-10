
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
  if(Date.now() - waterTapAt < 400) return;            // the tap landed on a creek or lake: its card already has "Open county"
  const id = countyAt(latlng.lat, latlng.lng);
  if(!id || id === currentCounty) return;
  if(!currentCounty && map.getZoom() < AREA_ZOOM) return; // statewide: the county polygon's own tap opens it
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
  const small = () => window.innerWidth < 700;
  let open = lsGet("fl.legendOpen", !small());
  const sync = () => { lg.classList.toggle("folded", !open); b.textContent = open ? "Hide key" : "Map key"; b.setAttribute("aria-expanded", String(open)); };
  b.onclick = () => { open = !open; lsSet("fl.legendOpen", open); sync(); };
  sync();
})();

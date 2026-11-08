
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
    if(hereFix.cid && currentCounty !== hereFix.cid) openCounty(hereFix.cid);
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

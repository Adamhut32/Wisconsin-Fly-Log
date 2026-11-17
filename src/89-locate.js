
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
    <div class="meta">${fix.cid ? esc(countyName(fix.cid)) : "Outside Wisconsin"} · accurate to about ${fix.acc > 1600 ? `${(fix.acc / 1609).toFixed(1)} mi` : `${Math.max(10, Math.round(fix.acc * 3.281 / 10) * 10)} ft`}${fix.settling ? ` · <span class="settle">narrowing down…</span>` : ""}</div>
    ${canWrite ? `<div class="row"><button class="btn sm" type="button" data-here="spot">${icon("i-pin")}Add spot here</button><button class="btn sm" type="button" data-here="catch">${icon("i-fish")}Log a catch here</button></div>` : ""}</div>`;
}
/* Keep listening to the GPS and pass on each better reading until it's within goodM meters or time runs out.
   Without a phone or Wi-Fi signal (offline) the first answer is often a rough guess; the real GPS fix can take
   20-40 seconds to arrive, so the first reading alone put people in the wrong place. */
function bestFix(onFix, onDone, onErr, { maxMs = 90000, okMs = 45000, okM = 100, goodM = 20 } = {}){
  let best = null, done = false;
  // after 45 seconds settle for anything within about 300 ft; a phone with no signal at all gets up to 90 seconds to find the satellites
  const okT = setTimeout(() => { if(best && best.coords.accuracy <= okM) finish(); }, okMs);
  const finish = () => { if(done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(t); clearTimeout(okT); best ? onDone(best) : onErr({ code:3 }); };
  const id = navigator.geolocation.watchPosition(p => {
    if(done) return;
    if(!best || p.coords.accuracy < best.coords.accuracy){ best = p; onFix(p, p.coords.accuracy <= goodM); }
    if(p.coords.accuracy <= goodM) finish();
  }, e => { if(e.code === 1 || !best){ done = true; navigator.geolocation.clearWatch(id); clearTimeout(t); onErr(e); } }, { enableHighAccuracy:true, maximumAge:0, timeout:maxMs });
  const t = setTimeout(finish, maxMs);
  return finish;
}
function locateMe(){
  const b = document.querySelector(".locbtn");
  if(!navigator.geolocation){ toast("This phone can't share its location with Coulee."); return; }
  b?.classList.add("busy");
  let pop = null, first = true, near = [];
  const show = async (pos, settled) => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy || 30;
    hereFix = { lat, lng, acc, cid:countyAt(lat, lng), settling:!settled };
    if(hereLayer) map.removeLayer(hereLayer);
    hereLayer = L.layerGroup([
      L.circle([lat, lng], { radius:acc, pane:"me", color:"#2F7BF5", weight:1, fillColor:"#2F7BF5", fillOpacity:.12, interactive:false }),
      L.marker([lat, lng], { pane:"me", icon:L.divIcon({ className:"", html:`<div class="hereDot${settled ? "" : " settling"}"></div>`, iconSize:[18,18], iconAnchor:[9,9] }), keyboard:false })
    ]).addTo(map);
    hereLayer.eachLayer(l => l instanceof L.Marker && l.on("click", () => pop && pop.openOn(map)));
    if(first){ first = false; map.flyTo([lat, lng], Math.max(map.getZoom(), acc > 300 ? 12 : 14), { duration:.7 }); }
    else if(!map.getBounds().pad(-.2).contains([lat, lng])) map.panTo([lat, lng]);
    near = await watersNear(lat, lng).catch(() => near);
    if(!pop){ pop = L.popup({ className:"hpop", offset:[0, -6], maxWidth:300, autoPanPaddingTopLeft:L.point(16, 150), autoPanPaddingBottomRight:L.point(16, 90) }); setTimeout(() => pop.openOn(map), 750); }
    pop.setLatLng([lat, lng]).setContent(hereHtml(hereFix, near));
  };
  bestFix(show, pos => { b?.classList.remove("busy"); show(pos, true); }, err => {
    b?.classList.remove("busy");
    if(err.code === 1) toast(isIOS ? "Location is off for Coulee. Settings → Privacy & Security → Location Services → Safari Websites (or Coulee) → While Using." : "Location is blocked. Allow it in your browser's site settings.");
    else toast("Couldn't get a fix. Try again with a clearer view of the sky.");
  });
}
document.addEventListener("click", async e => {
  const h = e.target.closest("[data-here]"); if(!h || !hereFix) return;
  map.closePopup();
  const near = await watersNear(hereFix.lat, hereFix.lng).catch(() => []), w = pickWater(near);
  const t = w && hereFix.cid && troutCache[hereFix.cid]?.t?.find(x => x[0] === w.name);
  if(h.dataset.here === "spot") openForm("spot", null, { lat:hereFix.lat, lng:hereFix.lng, name:w ? w.name : "", water:w ? (/river/i.test(w.kind) ? "River" : /lake|flowage|pond/i.test(w.kind) ? "Lake" : "Creek") : "Creek", trout_class:t ? TROUT[t[1]].label : "", status:"fished" });
  else openForm("catch", null, { lat:hereFix.lat, lng:hereFix.lng });
});

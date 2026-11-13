
/* ---------- EXIF (JPEG GPS + date) ---------- */
function readExif(buf){
  const v = new DataView(buf); if(v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while(off < v.byteLength - 4){
    const marker = v.getUint16(off); const size = v.getUint16(off+2);
    if(marker === 0xFFE1 && v.getUint32(off+4) === 0x45786966) return parseTiff(v, off+10);
    if((marker & 0xFF00) !== 0xFF00) break;
    off += 2 + size;
  }
  return null;
}
function parseTiff(v, start){
  const le = v.getUint16(start) === 0x4949;
  const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const out = {};
  function ifd(o){ const tags={}; const n=u16(o); for(let i=0;i<n;i++){ const e=o+2+i*12; tags[u16(e)] = { type:u16(e+2), count:u32(e+4), valOff:e+8 }; } return tags; }
  const rat = (o) => u32(o) / (u32(o+4) || 1);
  const str = (t) => { const p = t.count > 4 ? start + u32(t.valOff) : t.valOff; let s=""; for(let i=0;i<t.count-1;i++) s += String.fromCharCode(v.getUint8(p+i)); return s; };
  try{
    const ifd0 = ifd(start + u32(start+4));
    if(ifd0[0x8769]){ const ex = ifd(start + u32(ifd0[0x8769].valOff)); const t = ex[0x9003] || ex[0x9004]; if(t) out.date = str(t); }
    if(!out.date && ifd0[0x0132]) out.date = str(ifd0[0x0132]);
    if(ifd0[0x8825]){
      const g = ifd(start + u32(ifd0[0x8825].valOff));
      if(g[2] && g[4]){
        const tri = t => { const p = start + u32(t.valOff); return rat(p) + rat(p+8)/60 + rat(p+16)/3600; };
        let lat = tri(g[2]), lng = tri(g[4]);
        if(g[1] && String.fromCharCode(v.getUint8(g[1].valOff)) === "S") lat = -lat;
        if(g[3] && String.fromCharCode(v.getUint8(g[3].valOff)) === "W") lng = -lng;
        if(isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
      }
    }
  }catch(e){}
  return out;
}

/* ---------- catch / spot form ---------- */
let photoDate = null, photoTime = null, photoExif = null, ph2File = null, ph2Url = null, ph2Removed = false;
let formOpenSeq = 0;
function setPh2(url, title, has){
  $("ph2Pv").style.backgroundImage = url ? `url('${url}')` : ""; $("ph2Pv").textContent = url ? "" : "+";
  $("ph2Title").textContent = title; $("ph2Del").hidden = !(url || has);
}
$("fPhoto2").addEventListener("change", () => {
  const f = $("fPhoto2").files[0]; if(!f) return;
  ph2File = f; ph2Removed = false; if(ph2Url) URL.revokeObjectURL(ph2Url); ph2Url = URL.createObjectURL(f);
  setPh2(ph2Url, "Second photo added");
});
$("ph2Del").onclick = () => { ph2File = null; ph2Removed = true; $("fPhoto2").value = ""; setPh2(null, "Add a second photo"); };
let formKind = "catch", editing = null, photoFile = null, photoPreviewUrl = null, picking = false, pickMarker = null, tripTouched = false, visibility = "county";
function setKind(k){
  formKind = k;
  $("segFish").setAttribute("aria-pressed", k==="catch"); $("segSpot").setAttribute("aria-pressed", k==="spot");
  $("catchFields").hidden = k!=="catch"; $("catchFields2").hidden = k!=="catch";
  $("spotFields").hidden = k!=="spot"; $("nameField").hidden = k!=="spot";
  $("formTitle").textContent = editing ? (k==="catch"?"Edit catch":"Edit spot") : (k==="catch"?"Log a catch":"Add a spot");
  $("saveBtn").textContent = k==="catch" ? "Save catch" : "Save spot";
  $("saveBtn").className = "btn " + (k==="catch"?"fish":"spot");
  $("segFish").disabled = $("segSpot").disabled = !!editing;
  if(!editing) setVis(k === "spot" ? "private" : "county");
}
$("segFish").onclick = () => setKind("catch");
$("segSpot").onclick = () => setKind("spot");
function setVis(v){ visibility = v; $("visSeg").querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); renderShareRow(); }
/* spots and catches can go to only some friends, and chosen friends can get the exact place when everyone else sees the county */
let shareWith = null; // null = all friends, otherwise a Set of friend ids
let exactFor = null;  // null = nobody extra, otherwise a Set of friend ids who see the exact place
function myFriends(){ return friendships.filter(f => f.status === "accepted").map(f => f.requester === me?.id ? f.addressee : f.requester).map(id => ({ id, name:people[id]?.display_name || "Friend" })).sort((a, b) => a.name.localeCompare(b.name)); }
function renderShareRow(){
  const el = $("shareRow"); if(!el) return;
  const fr = myFriends(), what = formKind === "spot" ? "spot" : "catch";
  if(visibility === "private" || !fr.length){ el.hidden = true; return; }
  el.hidden = false;
  const pool = shareWith ? fr.filter(f => shareWith.has(f.id)) : fr;
  if(exactFor) for(const id of [...exactFor]) if(!pool.some(f => f.id === id)) exactFor.delete(id);
  el.innerHTML = `<div class="seg vis sm" role="group" aria-label="Which friends"><button type="button" data-sw="all" aria-pressed="${!shareWith}">All friends</button><button type="button" data-sw="some" aria-pressed="${!!shareWith}">Only some</button></div>
    ${shareWith ? `<div class="chips">${fr.map(f => `<button type="button" class="chip" data-swid="${esc(f.id)}" aria-pressed="${shareWith.has(f.id)}">${esc(f.name)}</button>`).join("")}</div>
    <small class="hint">${shareWith.size ? `Only ${shareWith.size === 1 ? "this friend sees" : `these ${shareWith.size} friends see`} this ${what}. Followers don't.` : `Pick at least one friend, or nobody sees this ${what}.`}</small>` : ""}
    ${visibility === "county" && pool.length ? `<div class="exactrow"><span class="lbl">Exact spot for</span><div class="seg vis sm" role="group" aria-label="Who sees the exact spot"><button type="button" data-ex="none" aria-pressed="${!exactFor}">Nobody</button><button type="button" data-ex="some" aria-pressed="${!!exactFor}">Some friends</button></div>
      ${exactFor ? `<div class="chips">${pool.map(f => `<button type="button" class="chip" data-exid="${esc(f.id)}" aria-pressed="${exactFor.has(f.id)}">${esc(f.name)}</button>`).join("")}</div>
      <small class="hint">${exactFor.size ? `${exactFor.size === 1 ? "This friend gets" : `These ${exactFor.size} friends get`} the exact place, water and notes. Everyone else sees the county.` : "Pick the friends who get the exact place."}</small>` : ""}</div>` : ""}`;
}
$("shareRow").addEventListener("click", e => {
  const a = e.target.closest("[data-sw]"); if(a){ shareWith = a.dataset.sw === "some" ? new Set(shareWith || []) : null; renderShareRow(); return; }
  const c = e.target.closest("[data-swid]"); if(c){ shareWith.has(c.dataset.swid) ? shareWith.delete(c.dataset.swid) : shareWith.add(c.dataset.swid); renderShareRow(); return; }
  const x = e.target.closest("[data-ex]"); if(x){ exactFor = x.dataset.ex === "some" ? new Set(exactFor || []) : null; renderShareRow(); return; }
  const y = e.target.closest("[data-exid]"); if(y){ exactFor.has(y.dataset.exid) ? exactFor.delete(y.dataset.exid) : exactFor.add(y.dataset.exid); renderShareRow(); }
});
$("visSeg").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if(b) setVis(b.dataset.v); });

function parseCoords(s){
  const m = String(s).match(/(-?\d+(?:\.\d+)?)\s*[°]?\s*([NS])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[°]?\s*([EW])?/i);
  if(!m) return null;
  let lat = parseFloat(m[1]), lng = parseFloat(m[3]);
  if(m[2] && m[2].toUpperCase()==="S") lat = -Math.abs(lat);
  if(m[4] && m[4].toUpperCase()==="W") lng = -Math.abs(lng);
  if(!m[4] && lng > 80 && lng < 95) lng = -lng; // "43.6, 90.9" → western hemisphere
  if(Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function coordHint(){
  const h = $("coordHint"); const c = parseCoords($("fCoords").value);
  if(!$("fCoords").value.trim()){ h.className="hint"; h.textContent="Use your location, pick on the map, or paste coordinates."; fillSpotOptions(null); return; }
  if(!c){ h.className="hint bad"; h.textContent="Use decimal coordinates like 43.6120, -90.9081."; return; }
  const cid = countyAt(c.lat, c.lng);
  h.className = cid ? "hint ok" : "hint bad";
  h.textContent = cid ? `In ${countyName(cid)}.` : "That point is outside Wisconsin. It will save, but won't count toward a county.";
  fillSpotOptions(c);
  clearTimeout(updateWaterFromCoords._t); updateWaterFromCoords._t = setTimeout(updateWaterFromCoords, 150);
}
$("fCoords").addEventListener("input", coordHint);

function fillSpotOptions(c){
  const sel = $("fSpotLink"); const keep = sel.value;
  const d = s => c ? Math.hypot((s.lat-c.lat)*111, (s.lng-c.lng)*111*Math.cos(c.lat*Math.PI/180)) : 0;
  const list = [...spots].sort((a,b)=>d(a)-d(b) || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">None</option>` + list.map(s=>`<option value="${esc(s.id)}">${esc(s.name||"Unnamed spot")}${c?` (${(d(s)*0.621).toFixed(1)} mi)`:""}</option>`).join("");
  if(keep && list.some(s=>s.id===keep)) sel.value = keep;
  else if(c && list.length && d(list[0]) < 1.5 && !editing) sel.value = list[0].id;
}
function tripFor(date){ return trips.filter(t => t.start_date <= date && date <= t.end_date).sort((a,b) => b.start_date.localeCompare(a.start_date))[0] || null; }
function fillTripOptions(selected){
  const sel = $("fTrip");
  const list = [...trips].sort((a,b) => b.start_date.localeCompare(a.start_date));
  sel.innerHTML = `<option value="">No trip</option>` + list.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(fmtRange(t.start_date, t.end_date))})</option>`).join("");
  sel.value = selected && list.some(t => t.id === selected) ? selected : "";
}
$("fTrip").addEventListener("change", () => { tripTouched = true; });
$("fDate").addEventListener("change", () => { if(!tripTouched){ const t = tripFor($("fDate").value); $("fTrip").value = t ? t.id : ""; } });

function setPhotoPreview(url, title, sub){
  $("photoPv").style.backgroundImage = url ? `url('${url}')` : ""; $("photoPv").innerHTML = url ? "" : icon("i-fish");
  $("photoTitle").textContent = title; $("photoSub").textContent = sub;
}
$("fPhoto").addEventListener("change", async () => {
  const file = $("fPhoto").files[0]; if(!file) return;
  photoFile = file; photoDate = null; photoTime = null;
  if(photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  let ex = null; try{ ex = readExif(await file.arrayBuffer()); }catch(e){}
  photoExif = ex;
  const found = [];
  if(ex && ex.lat != null){ $("fCoords").value = `${ex.lat.toFixed(5)}, ${ex.lng.toFixed(5)}`; coordHint(); found.push("location"); }
  if(ex && ex.date){ const m = ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m){ photoDate = `${m[1]}-${m[2]}-${m[3]}`; const tm = ex.date.match(/[ T](\d{2}):(\d{2})(?::(\d{2}))?/); photoTime = tm ? `${tm[1]}:${tm[2]}:${tm[3] || "00"}` : null; $("fDate").value = photoDate; $("fDate").dispatchEvent(new Event("change")); found.push("date"); } }
  setPhotoPreview(photoPreviewUrl, file.name || "Photo",
    (found.length ? `Filled ${found.join(" and ")} from the photo.` : "No location in this photo. Tap Here or Map below.") + (photoDate ? "" : " It has no date stamp, so it can't count in photo tournaments."));
  $("photoSub").style.color = found.includes("location") ? "var(--spot)" : "var(--danger)";
  $("camFixBtn").hidden = found.includes("location");
});

/* phone GPS */
$("gpsBtn").onclick = () => {
  const h = $("coordHint");
  if(!navigator.geolocation){ h.className = "hint bad"; h.textContent = "This browser can't share your location. Pick on the map instead."; return; }
  h.className = "hint"; h.textContent = "Finding your location…"; $("gpsBtn").disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $("gpsBtn").disabled = false;
    $("fCoords").value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`; coordHint();
    if(pos.coords.accuracy > 100) h.textContent += ` Accurate to about ${Math.round(pos.coords.accuracy * 3.28)} ft.`;
  }, err => {
    $("gpsBtn").disabled = false; h.className = "hint bad";
    h.textContent = err.code === 1 ? "Location is turned off for this app. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using." : "Couldn't get a GPS fix. Try again in the open, or pick on the map.";
  }, { enableHighAccuracy:true, timeout:20000, maximumAge:30000 });
};

function openForm(kind, rec, prefill){
  if(!canWrite){ toast("Sign in to save entries."); return; }
  editing = rec || null; photoFile = null; photoDate = null; photoTime = null; tripTouched = !!rec; $("fPhoto").value = ""; $("formErr").textContent = ""; $("photoSub").style.color = ""; $("camFixBtn").hidden = true;
  setKind(kind);
  const r = rec || prefill || {};
  $("fCoords").value = (r.lat != null) ? `${(+r.lat).toFixed(5)}, ${(+r.lng).toFixed(5)}` : "";
  $("fName").value = r.name || ""; $("fWater").value = r.water || "Creek"; $("fClass").value = r.trout_class || ""; $("fTarget").value = r.target || ""; $("fStatus").value = r.status || "want";
  $("fSpecies").value = r.species || ""; $("fLen").value = r.length_in ?? ""; $("fCount").value = r.count ?? 1; $("fFly").value = r.fly || "";
  $("fDate").value = r.caught_on || todayStr(); $("fNotes").value = r.notes || "";
  $("fWaterName").value = r.water || ""; waterTouched = !!(rec && rec.water); $("waterHint").textContent = ""; $("waterNear").innerHTML = "";
  $("fMethod").value = r.method || defaultMethod(); updateFlyLabel();
  $("fWt").value = r.weight_lb ? String(+r.weight_lb) : ""; $("fWtHint").textContent = r.weight_lb ? wtTxt(r.weight_lb) : ""; syncWeightRow(); fillForOptions(); $("fFor").value = "";
  fillTripOptions(rec ? rec.trip_id : (r.trip_id || (tripFor($("fDate").value)?.id)));
  fillSpotOptions(r.lat != null ? { lat:+r.lat, lng:+r.lng } : null); $("fSpotLink").value = r.spot_id || $("fSpotLink").value;
  $("fMore").open = !!($("fTrip").value || $("fSpotLink").value); renderSpeciesChips();
  shareWith = rec?.share_with?.length ? new Set(rec.share_with) : null;
  exactFor = rec?.exact_for?.length ? new Set(rec.exact_for) : null;
  if(rec) setVis(rec.visibility); else renderShareRow();
  const url = photoSrc(r.photo_path), openedFor = ++formOpenSeq;
  ph2File = null; ph2Removed = false; $("fPhoto2").value = "";
  const p2 = morePaths(rec)[0]; setPh2(p2 ? photoSrc(p2) : null, p2 ? "Second photo saved · tap to replace" : "Add a second photo", !!p2);
  if(r.photo_path) setPhotoPreview(url, "Photo saved", "Choose another to replace it");
  else setPhotoPreview(null, "Add a photo", "Location and date fill in from the photo when it has them");
  // the saved photos' links may still be on their way: show them as soon as they arrive (unless a new photo was picked meanwhile)
  if(r.photo_path && !url) photoUrl(r.photo_path).then(u => { if(u && openedFor === formOpenSeq && !photoFile && !$("scrim").hidden) $("photoPv").style.backgroundImage = `url('${u}')`, $("photoPv").innerHTML = ""; });
  if(p2 && !photoSrc(p2)) photoUrl(p2).then(u => { if(u && openedFor === formOpenSeq && !ph2File && !ph2Removed && !$("scrim").hidden) setPh2(u, "Second photo saved · tap to replace", true); });
  coordHint();
  $("scrim").hidden = false;
}
function closeForm(){ $("scrim").hidden = true; editing = null; }
$("addCatchBtn").onclick = () => openForm("catch");
$("addSpotBtn").onclick = () => openForm("spot");
$("cancelBtn").onclick = closeForm;
$("scrim").addEventListener("click", e => { if(e.target === $("scrim")) closeForm(); });
document.addEventListener("keydown", e => { if(e.key === "Escape"){ if(picking) endPick(); else if(!$("scrim").hidden) closeForm(); else if(!$("tripScrim").hidden) closeTripForm(); } });

/* pick on map */
$("pickBtn").onclick = () => {
  picking = true; $("scrim").hidden = true; $("pickbar").hidden = false; $("fab").hidden = true;
  if(panelFull) setFull(false);   // the map has to be showing to tap a place on it
  map.getContainer().style.cursor = "crosshair";
};
function endPick(){ picking = false; $("pickbar").hidden = true; $("fab").hidden = false; map.getContainer().style.cursor = ""; $("scrim").hidden = false; }
$("pickCancel").onclick = endPick;
function handlePick(ll){
  $("fCoords").value = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  if(pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.circleMarker(ll, { radius:7, color:css("--ink"), weight:2, fillColor:css("--paper"), fillOpacity:1 }).addTo(map);
  setTimeout(() => { if(pickMarker){ map.removeLayer(pickMarker); pickMarker = null; } }, 2500);
  endPick(); coordHint();
}
/* The map is a stack of drawing layers: the open county's creeks sit over the surrounding counties' creeks, which sit over public land.
   Only the top one hears a tap, so a tap it has no use for is handed down the stack, and finally to the county itself. */
let passingTap = false;
function passTapDown(e){
  const ev = e.originalEvent; if(!ev) return false;
  const before = featureTaps;
  passingTap = true;
  try{
    for(const R of [detailRenderer, areaRenderer, accessR]){
      if(!R || !R._container || !map.hasLayer(R) || R._container === ev.target) continue;   // the layer that got the tap has had its say
      R._onClick(ev);
      if(featureTaps !== before) return true;
    }
  } finally { passingTap = false; }
  return false;
}
map.on("click", e => {
  if(passingTap) return;
  if(picking){ handlePick(e.latlng); return; }
  if(Date.now() - waterTapAt < 400) return;   // a creek, lake or public land took this tap
  if(passTapDown(e)) return;
  tapCounty(e.latlng);
});
/* computer: hovering a creek in a neighboring county lights it up, even under the open county's layer */
let hoverPassAt = 0;
map.getContainer().addEventListener("mousemove", ev => {
  if(ev.buttons || ev.timeStamp - hoverPassAt < 40) return;   // not while dragging, and only ~25 times a second
  hoverPassAt = ev.timeStamp;
  if(!detailRenderer || !areaRenderer._container || !map.hasLayer(areaRenderer) || ev.target !== detailRenderer._container) return;
  if(detailRenderer._hoveredLayer){ if(areaRenderer._hoveredLayer) areaRenderer._handleMouseOut(ev); }
  else areaRenderer._onMouseMove(ev);
  ev.target.style.cursor = !detailRenderer._hoveredLayer && areaRenderer._hoveredLayer ? "pointer" : "";
});

/* shrink photos before upload; re-encoding also drops the photo's hidden GPS data */
async function shrink(file){
  const MAX = 1600;
  let bmp; try{ bmp = await createImageBitmap(file, { imageOrientation:"from-image" }); }catch(e){ bmp = null; }
  if(!bmp){
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height, k = Math.min(1, MAX / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.round(w*k); cv.height = Math.round(h*k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return await new Promise(res => cv.toBlob(res, "image/jpeg", 0.82));
}

$("entryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("formErr"); err.className = "hint bad"; err.textContent = "";
  const c = parseCoords($("fCoords").value);
  if(formKind==="spot" && !c){ err.textContent = "Add a location: tap Here, pick on the map, or paste coordinates."; $("fCoords").focus(); return; }
  if(formKind==="catch" && !c && $("fCoords").value.trim()){ err.textContent = "Those coordinates don't look right. Use a format like 43.6120, -90.9081."; return; }
  if(formKind==="spot" && !$("fName").value.trim()){ err.textContent = "Give the spot a name."; $("fName").focus(); return; }
  const len = $("fLen").value.trim();
  if(formKind==="catch" && len && !(+len >= 0 && +len <= 80)){ err.textContent = "Length should be in inches, like 14 or 15.5."; $("fLen").focus(); return; }
  if(formKind==="catch" && !$("fDate").value){ err.textContent = "Add the date you caught it."; $("fDate").focus(); return; }
  const btn = $("saveBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Saving…";
  try{
    const base = { id: editing ? editing.id : uuid(), lat: c ? c.lat : null, lng: c ? c.lng : null, county: c ? countyAt(c.lat,c.lng) : (editing?.county || null),
      notes: $("fNotes").value.trim() || null, visibility,
      share_with: visibility !== "private" && shareWith ? [...shareWith] : null,
      exact_for: visibility === "county" && exactFor && exactFor.size ? [...exactFor] : null };
    if(base.share_with && !base.share_with.length){ err.textContent = `Pick at least one friend to share this ${formKind === "spot" ? "spot" : "catch"} with, or choose All friends.`; btn.disabled = false; btn.textContent = label; return; }
    let rec, table, blob = null, second = null;
    if(formKind==="catch"){
      table = "catches";
      if(photoFile){ btn.textContent = "Preparing photo…"; blob = await shrink(photoFile); }
      rec = { ...base, species:sentenceCase($("fSpecies").value), length_in: len ? +len : null, count: Math.max(0, parseInt($("fCount").value,10) || 0),
        fly:capWords($("fFly").value), method:$("fMethod").value, weight_lb:(w => w == null || Number.isNaN(w) ? null : w)(parseWeight($("fWt").value)), water:$("fWaterName").value.trim() || null, caught_on:$("fDate").value, spot_id:$("fSpotLink").value || null, trip_id:$("fTrip").value || null,
        photo_path: editing ? (editing.photo_path || null) : null,
        photo_taken_on: photoFile ? photoDate : (editing ? (editing.photo_taken_on || null) : null),
        photo_time: photoFile ? photoTime : (editing ? (editing.photo_time || null) : null),
        photo_hash: editing ? (editing.photo_hash || null) : null, photo_meta: editing ? (editing.photo_meta || null) : null };
      if(blob){ try{ rec.photo_hash = await dhash(blob); }catch(e){ rec.photo_hash = null; } rec.photo_meta = photoMeta(photoExif, c); }
      if($("fCount").value === "") rec.count = 1;
      if(ph2File){ btn.textContent = "Preparing photos…"; const b2 = await shrink(ph2File); let h2 = null; try{ h2 = await dhash(b2); }catch(e){} second = { blob:b2, hash:h2 }; }
      else if(ph2Removed) second = { remove:true };
      if(second && !rec.photo_path && !blob && second.blob){ blob = second.blob; rec.photo_hash = second.hash; second = null; }   // only one photo: it becomes the main one
    } else {
      table = "spots";
      rec = { ...base, name:$("fName").value.trim(), water:$("fWater").value, trout_class:$("fClass").value || null, target:$("fTarget").value.trim() || null, status:$("fStatus").value };
    }
    const wasEditing = !!editing;
    if(table === "catches") lsSet("fl.method", rec.method);
    const forFriend = table === "catches" && !wasEditing ? $("fFor").value : "";
    if(forFriend){
      btn.textContent = "Sending…";
      const fname = friendsList().find(f => f.id === forFriend)?.name || "your friend";
      await sendGift(rec, blob, forFriend);
      closeForm(); toast(`Sent to ${fname}. It joins their log when they accept it.`); return;
    }
    const before = table === "catches" && !wasEditing ? catches.slice() : null;
    await saveRecord(table, rec, blob, wasEditing, second);
    if(before) setTimeout(() => celebrate(rec, before), 350);
    closeForm();
    const where = rec.county ? countyName(rec.county) : "your log";
    toast(navigator.onLine ? `${table==="catches"?"Catch":"Spot"} saved in ${where}` : `Saved on this phone. It will sync when you're back online.`);
    if(rec.lat != null && !wasEditing && !map.getBounds().pad(-.1).contains([rec.lat, rec.lng])) map.panTo([rec.lat, rec.lng]);   // show it, without jumping into the county
  }catch(e){
    console.error(e);
    err.textContent = e && e.userMessage ? e.userMessage : "Couldn't save. Check your connection and try again.";
  }finally{ btn.disabled = false; btn.textContent = label; }
});

/* species: one tap on what you usually catch, instead of typing on a phone keyboard */
function renderSpeciesChips(){
  const n = {}; catches.forEach(c => { if(c.species) n[c.species] = (n[c.species] || 0) + fishOf(c); });
  const mine = Object.entries(n).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const base = [...$("speciesList").querySelectorAll("option")].map(o => o.value || o.textContent);
  const list = [...new Set([...mine, ...base])].slice(0, 6);
  const cur = $("fSpecies").value.trim().toLowerCase();
  $("spChips").innerHTML = list.map(s => `<button type="button" class="chip sm" data-sp="${esc(s)}" aria-pressed="${s.toLowerCase() === cur}">${esc(s)}</button>`).join("");
}
$("spChips").addEventListener("click", e => { const b = e.target.closest("[data-sp]"); if(!b) return; $("fSpecies").value = b.dataset.sp; renderSpeciesChips(); $("fLen").focus({ preventScroll:true }); });
$("fSpecies").addEventListener("input", renderSpeciesChips);
/* phone keyboard: keep the field being typed in visible above it */
$("entryForm").addEventListener("focusin", e => {
  if(!e.target.matches("input:not([type=file]):not([type=checkbox]), textarea") || innerWidth > 760) return;
  setTimeout(() => e.target.scrollIntoView({ block:"center", behavior:"smooth" }), 320);
});
if(window.visualViewport) visualViewport.addEventListener("resize", () => {
  const kb = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
  document.documentElement.style.setProperty("--kb", kb > 80 ? kb + "px" : "0px");
});

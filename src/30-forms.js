
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
let photoDate = null, photoExif = null;
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
/* spots can go to only some friends */
let shareWith = null; // null = all friends, otherwise a Set of friend ids
function myFriends(){ return friendships.filter(f => f.status === "accepted").map(f => f.requester === me?.id ? f.addressee : f.requester).map(id => ({ id, name:people[id]?.display_name || "Friend" })).sort((a, b) => a.name.localeCompare(b.name)); }
function renderShareRow(){
  const el = $("shareRow"); if(!el) return;
  const fr = myFriends();
  if(formKind !== "spot" || visibility === "private" || !fr.length){ el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="seg vis sm" role="group" aria-label="Which friends"><button type="button" data-sw="all" aria-pressed="${!shareWith}">All friends</button><button type="button" data-sw="some" aria-pressed="${!!shareWith}">Only some</button></div>
    ${shareWith ? `<div class="chips">${fr.map(f => `<button type="button" class="chip" data-swid="${esc(f.id)}" aria-pressed="${shareWith.has(f.id)}">${esc(f.name)}</button>`).join("")}</div>
    <small class="hint">${shareWith.size ? `Only ${shareWith.size === 1 ? "this friend sees" : `these ${shareWith.size} friends see`} it. Followers don't.` : "Pick at least one friend, or nobody sees it."}</small>` : ""}`;
}
$("shareRow").addEventListener("click", e => {
  const a = e.target.closest("[data-sw]"); if(a){ shareWith = a.dataset.sw === "some" ? new Set(shareWith || []) : null; renderShareRow(); return; }
  const c = e.target.closest("[data-swid]"); if(c){ shareWith.has(c.dataset.swid) ? shareWith.delete(c.dataset.swid) : shareWith.add(c.dataset.swid); renderShareRow(); }
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
  photoFile = file; photoDate = null;
  if(photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  let ex = null; try{ ex = readExif(await file.arrayBuffer()); }catch(e){}
  photoExif = ex;
  const found = [];
  if(ex && ex.lat != null){ $("fCoords").value = `${ex.lat.toFixed(5)}, ${ex.lng.toFixed(5)}`; coordHint(); found.push("location"); }
  if(ex && ex.date){ const m = ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m){ photoDate = `${m[1]}-${m[2]}-${m[3]}`; $("fDate").value = photoDate; $("fDate").dispatchEvent(new Event("change")); found.push("date"); } }
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
  editing = rec || null; photoFile = null; photoDate = null; tripTouched = !!rec; $("fPhoto").value = ""; $("formErr").textContent = ""; $("photoSub").style.color = ""; $("camFixBtn").hidden = true;
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
  shareWith = rec?.share_with?.length ? new Set(rec.share_with) : null;
  if(rec) setVis(rec.visibility); else renderShareRow();
  const url = photoSrc(r.photo_path);
  if(r.photo_path) setPhotoPreview(url, "Photo saved", "Choose another to replace it");
  else setPhotoPreview(null, "Add a photo", "Location and date fill in from the photo when it has them");
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
map.on("click", e => {
  if(picking){ handlePick(e.latlng); return; }
  if(currentCounty){ const cid = countyAt(e.latlng.lat, e.latlng.lng); if(cid && cid !== currentCounty) openCounty(cid); }
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
      notes: $("fNotes").value.trim() || null, visibility };
    let rec, table, blob = null;
    if(formKind==="catch"){
      table = "catches";
      if(photoFile){ btn.textContent = "Preparing photo…"; blob = await shrink(photoFile); }
      rec = { ...base, species:sentenceCase($("fSpecies").value), length_in: len ? +len : null, count: Math.max(0, parseInt($("fCount").value,10) || 0),
        fly:capWords($("fFly").value), method:$("fMethod").value, weight_lb:(w => w == null || Number.isNaN(w) ? null : w)(parseWeight($("fWt").value)), water:$("fWaterName").value.trim() || null, caught_on:$("fDate").value, spot_id:$("fSpotLink").value || null, trip_id:$("fTrip").value || null,
        photo_path: editing ? (editing.photo_path || null) : null,
        photo_taken_on: photoFile ? photoDate : (editing ? (editing.photo_taken_on || null) : null),
        photo_hash: editing ? (editing.photo_hash || null) : null, photo_meta: editing ? (editing.photo_meta || null) : null };
      if(blob){ try{ rec.photo_hash = await dhash(blob); }catch(e){ rec.photo_hash = null; } rec.photo_meta = photoMeta(photoExif, c); }
      if($("fCount").value === "") rec.count = 1;
    } else {
      table = "spots";
      rec = { ...base, name:$("fName").value.trim(), water:$("fWater").value, trout_class:$("fClass").value || null, target:$("fTarget").value.trim() || null, status:$("fStatus").value, share_with: visibility !== "private" && shareWith ? [...shareWith] : null };
      if(rec.share_with && !rec.share_with.length){ err.textContent = "Pick at least one friend to share this spot with, or choose All friends."; btn.disabled = false; btn.textContent = label; return; }
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
    await saveRecord(table, rec, blob, wasEditing);
    if(before) setTimeout(() => celebrate(rec, before), 350);
    closeForm();
    const where = rec.county ? countyName(rec.county) : "your log";
    toast(navigator.onLine ? `${table==="catches"?"Catch":"Spot"} saved in ${where}` : `Saved on this phone. It will sync when you're back online.`);
    if(rec.county && !currentCounty && !wasEditing) openCounty(rec.county);
  }catch(e){
    console.error(e);
    err.textContent = e && e.userMessage ? e.userMessage : "Couldn't save. Check your connection and try again.";
  }finally{ btn.disabled = false; btn.textContent = label; }
});

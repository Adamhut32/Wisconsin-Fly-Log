
/* ---------- trips with friends + time on the water ---------- */
const tripGroup = {}, tripAsked = new Set();                  // trip id -> { people, catches, outings } from the server
async function loadTripGroup(id){
  if(!navigator.onLine) return;
  const { data, error } = await sb.rpc("trip_group", { tid:id });
  if(error || !data || Array.isArray(data) || !data.people) return;
  tripGroup[id] = data; if(tab === "trips" && tripOpen === id) renderLog();
}
const fmtHours = h => { const n = +h; return n ? (Number.isInteger(n) ? n : n.toFixed(1)) + " h" : ""; };
const tripOf = id => trips.find(t => t.id === id) || groupTrips.find(t => t.id === id && t.my_status === "joined");
// my own trip or a joined group trip on that date
function anyTripFor(date){ return tripFor(date) || groupTrips.find(t => t.my_status === "joined" && t.start_date <= date && date <= t.end_date) || null; }

/* people on a trip */
function tripPeopleHtml(t, owner){
  const g = tripGroup[t.id];
  const ppl = g ? g.people : [];
  const joined = ppl.filter(p => p.status !== "invited"), invited = ppl.filter(p => p.status === "invited");
  const canInvite = owner && friendsList().some(f => !ppl.some(p => p.id === f.id));
  if(!g && !owner) return "";
  if(owner && ppl.length <= 1 && !canInvite) return "";
  return `<div class="card tpeople"><b>${joined.length > 1 ? `${joined.length} people on this trip` : "Just you so far"}</b>
    <div class="tpl">${joined.map(p => `<span class="tp">${avHtml(p.id, p.name, "sm", p.avatar)}${esc(p.id === me.id ? "You" : (p.name || "").split(" ")[0])}${p.status === "owner" ? ` <small>organizer</small>` : ""}${owner && p.id !== me.id ? ` <button class="link danger" type="button" data-tremove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ""}</span>`).join("")}
    ${invited.map(p => `<span class="tp inv">${avHtml(p.id, p.name, "sm", p.avatar)}${esc((p.name || "").split(" ")[0])} <small>invited</small>${owner ? ` <button class="link danger" type="button" data-tremove="${esc(p.id)}" aria-label="Cancel invite">×</button>` : ""}</span>`).join("")}</div>
    ${canInvite ? `<button class="btn sm" type="button" data-a="tinvite">Invite friends</button><div data-invslot></div>` : ""}
    ${!owner ? `<button class="link danger" type="button" data-tremove="${esc(me.id)}">Leave this trip</button>` : ""}</div>`;
}
function inviteListHtml(t){
  const ppl = tripGroup[t.id]?.people || [];
  const can = friendsList().filter(f => !ppl.some(p => p.id === f.id));
  return `<div class="chiprow">${can.map(f => `<button type="button" class="chip" data-inv="${esc(f.id)}" aria-pressed="false">${esc(f.name)}</button>`).join("")}</div>
    <button class="btn sm ink" type="button" data-a="tinvitesend">Send invites</button>`;
}

/* the group's catches and time on the water, folded into the trip's days */
function groupDayHtml(t, d){
  const g = tripGroup[t.id]; const mine = outings.filter(o => o.fished_on === d && (o.trip_id === t.id || !o.trip_id));
  const theirs = g ? g.catches.filter(c => c.caught_on === d) : [], tout = g ? g.outings.filter(o => o.fished_on === d) : [];
  const rows = [
    ...mine.map(o => `<li><button class="item out" type="button" data-outing="${esc(o.id)}"><span class="th">${icon("i-pin")}</span><span class="t"><b>${fmtHours(o.hours) || "Fished"}${o.water ? ` · ${esc(o.water)}` : ""}</b><small>${esc(["You", o.notes].filter(Boolean).join(" · "))}</small></span></button></li>`),
    ...tout.map(o => `<li><div class="item out" style="cursor:default"><span class="th">${icon("i-pin")}</span><span class="t"><b>${fmtHours(o.hours) || "Fished"}${o.water ? ` · ${esc(o.water)}` : ""}</b><small>${esc([o.display_name, o.notes].filter(Boolean).join(" · "))}</small></span></div></li>`),
    ...theirs.map(c => `<li><div class="item" style="cursor:default">${thumb(c)}<span class="t"><b>${esc(c.species || "Fish")}${c.length_in ? ` · ${lenTxt(c.length_in)}` : ""}</b><small>${esc([c.display_name, c.water, c.fly].filter(Boolean).join(" · "))}</small></span><span class="num">${fishOf(c) !== 1 ? `<span class="f">×${fishOf(c)}</span>` : ""}</span></div></li>`)];
  return { html: rows.length ? `<ul class="list">${rows.join("")}</ul>` : "", fish: theirs.reduce((a, c) => a + fishOf(c), 0), any: rows.length > 0 };
}
function tripHours(t){
  const g = tripGroup[t.id];
  const mine = outings.filter(o => o.fished_on >= t.start_date && o.fished_on <= t.end_date).reduce((a, o) => a + (+o.hours || 0), 0);
  const theirs = g ? g.outings.reduce((a, o) => a + (+o.hours || 0), 0) : 0;
  return { mine, all: mine + theirs };
}

/* trip someone else organized */
function renderGroupTrip(el, t){
  const g = tripGroup[t.id];
  if(t.my_status === "invited"){
    el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
      <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base ? ` · ${esc(t.base)}` : ""}</div><h2>${esc(t.name)}</h2>
      <p>${esc(t.owner_name)} invited you on this trip.</p>${t.notes ? `<p class="muted">${esc(t.notes)}</p>` : ""}
      <p class="note">If you join, everyone on the trip sees your catches from these dates (never private ones) and your time on the water.</p>
      <div class="row2"><button class="btn ink" type="button" data-gjoin="${esc(t.id)}">Join trip</button><button class="btn" type="button" data-gdecline="${esc(t.id)}">No thanks</button></div>`;
    return;
  }
  const days = daysBetween(t.start_date, t.end_date);
  const mineC = catches.filter(c => days.includes(c.caught_on));
  const all = [...mineC, ...(g ? g.catches : [])], s = summarize(all), hrs = tripHours(t);
  el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
    <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base ? ` · ${esc(t.base)}` : ""} · with ${esc(t.owner_name)}</div><h2>${esc(t.name)}</h2>
    <div class="stats four"><div class="stat f"><b>${s.fish}</b><span>group fish</span></div><div class="stat"><b>${s.species.size}</b><span>species</span></div>
      <div class="stat"><b>${s.big ? lenTxt(s.big.length_in) : "–"}</b><span>biggest</span></div><div class="stat"><b>${hrs.all ? fmtHours(hrs.all) : "–"}</b><span>on the water</span></div></div>
    ${s.fly ? `<p style="margin:0 0 6px"><b>Best fly:</b> ${esc(s.fly[0])} (${s.fly[1]} fish)</p>` : ""}
    ${t.notes ? `<p style="margin:6px 0 10px">${esc(t.notes)}</p>` : ""}
    ${tripPeopleHtml(t, false)}
    <div class="row2" style="margin:8px 0 4px"><button class="btn sm fish" type="button" data-a="logtrip">${icon("i-fish")}Log a catch</button><button class="btn sm" type="button" data-a="newouting">Log time on the water</button></div>
    ${tripAlbumHtml(t, mineC.filter(c => c.photo_path))}
    ${!g ? `<p class="status">Loading the group's catches…</p>` : ""}
    ${days.map(d => { const mine = mineC.filter(c => c.caught_on === d), gd = groupDayHtml(t, d), n = mine.reduce((a, c) => a + fishOf(c), 0) + gd.fish;
      return `<div class="day"><h5>${esc(fmtDate(d, { weekday:"long", month:"short", day:"numeric" }))}<span>${n} fish</span></h5>
        ${mine.length ? `<ul class="list">${mine.map(itemCatch).join("")}</ul>` : ""}${gd.html}${!mine.length && !gd.any ? `<p class="skunk">${d > todayStr() ? "Still to come" : "No fish logged"}</p>` : ""}</div>`; }).join("")}`;
}

/* actions */
let invPick = new Set();
$("log").addEventListener("click", async ev => {
  const e = ev.target;
  const gt = e.closest("[data-gtrip]"); if(gt){ expandPanel(); tripOpen = gt.dataset.gtrip; tab = "trips"; renderLog(); $("log").scrollTop = 0; loadTripGroup(tripOpen); return; }
  const j = e.closest("[data-gjoin]"); if(j){ const { error } = await sb.rpc("trip_respond", { tid:j.dataset.gjoin, accept:true }); if(error){ toast("Couldn't join. Try again."); return; }
    const t = groupTrips.find(x => x.id === j.dataset.gjoin); if(t) t.my_status = "joined"; saveCache(); toast("You're on the trip"); tripOpen = j.dataset.gjoin; renderLog(); loadTripGroup(tripOpen); return; }
  const dc = e.closest("[data-gdecline]"); if(dc){ await sb.rpc("trip_respond", { tid:dc.dataset.gdecline, accept:false }); groupTrips = groupTrips.filter(x => x.id !== dc.dataset.gdecline); saveCache(); tripOpen = null; renderLog(); return; }
  const rm = e.closest("[data-tremove]"); if(rm){
    const uid = rm.dataset.tremove, tid = tripOpen; const self = uid === me.id;
    if(!confirmTap(rm, self ? "Tap again to leave" : "Tap again to remove")) return;
    const { error } = await sb.rpc("trip_remove", { tid, uid }); if(error){ toast("Couldn't do that. Try again."); return; }
    if(self){ groupTrips = groupTrips.filter(x => x.id !== tid); tripOpen = null; saveCache(); toast("You left the trip"); renderLog(); } else loadTripGroup(tid);
    return; }
  const iv = e.closest("[data-inv]"); if(iv){ const id = iv.dataset.inv; invPick.has(id) ? invPick.delete(id) : invPick.add(id); iv.setAttribute("aria-pressed", String(invPick.has(id))); return; }
  const a = e.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "tinvite"){ const t = trips.find(x => x.id === tripOpen); const slot = $("log").querySelector("[data-invslot]"); if(t && slot){ invPick = new Set(); slot.innerHTML = inviteListHtml(t); } }
  if(a.dataset.a === "tinvitesend"){ if(!invPick.size){ toast("Tap the friends to invite."); return; } const tid = tripOpen;
    const { data, error } = await sb.rpc("trip_invite", { tid, uids:[...invPick] }); if(error){ toast("Couldn't send invites. Try again."); return; }
    toast(`Invited ${data} friend${data === 1 ? "" : "s"}`); invPick = new Set(); loadTripGroup(tid); }
  if(a.dataset.a === "newouting"){ const t = tripOf(tripOpen); openOuting(null, t ? (todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date) : null); }
  const o = e.closest("[data-outing]"); if(o){ const r = outings.find(x => x.id === o.dataset.outing); if(r) openOuting(r); }
});
// small "tap twice" guard instead of a browser confirm dialog
function confirmTap(el, label){ if(el.dataset.armed){ return true; } el.dataset.armed = "1"; const old = el.textContent; el.textContent = label; setTimeout(() => { delete el.dataset.armed; el.textContent = old; }, 3000); return false; }
document.addEventListener("click", e => { const o = e.target.closest("[data-outing]"); if(o && !$("log").contains(o)){ const r = outings.find(x => x.id === o.dataset.outing); if(r){ map.closePopup(); openOuting(r); } } });

/* invites chosen while making a trip */
let tInvite = new Set();
function renderTripInvites(t){
  const box = $("tInviteBox"), fr = friendsList();
  box.hidden = !fr.length || (t && t.user_id && t.user_id !== me.id);
  const ppl = t ? (tripGroup[t.id]?.people || []) : [];
  $("tInvite").innerHTML = fr.filter(f => !ppl.some(p => p.id === f.id)).map(f => `<button type="button" class="chip" data-tinv="${esc(f.id)}" aria-pressed="${tInvite.has(f.id)}">${esc(f.name)}</button>`).join("") || `<small class="muted">Everyone's already invited.</small>`;
}
$("tInvite").addEventListener("click", e => { const b = e.target.closest("[data-tinv]"); if(!b) return; const id = b.dataset.tinv; tInvite.has(id) ? tInvite.delete(id) : tInvite.add(id); b.setAttribute("aria-pressed", String(tInvite.has(id))); });
async function sendTripInvites(tid){
  if(!tInvite.size) return 0;
  const ids = [...tInvite]; tInvite = new Set();
  for(let i = 0; i < 20; i++){ if(!outbox.some(j => j.table === "trips" && j.row?.id === tid)) break; await new Promise(r => setTimeout(r, 500)); }   // the trip must reach the server first
  const { data, error } = await sb.rpc("trip_invite", { tid, uids:ids });
  if(error){ toast("Trip saved, but the invites didn't send. Open the trip to try again."); return 0; }
  loadTripGroup(tid); return data || 0;
}

/* time on the water form */
let outEditing = null, outCoords = null;
function openOuting(rec, date){
  if(!canWrite){ toast("Sign in to save."); return; }
  outEditing = rec || null; outCoords = rec && rec.lat != null ? { lat:+rec.lat, lng:+rec.lng } : null;
  $("outTitle").textContent = rec ? "Edit time on the water" : "Time on the water";
  $("oDate").value = rec?.fished_on || date || todayStr(); $("oHours").value = rec?.hours ? String(+rec.hours) : "";
  $("oWater").value = rec?.water || ""; $("oNotes").value = rec?.notes || ""; $("oOnMap").checked = rec ? rec.on_map !== false : true;
  $("oWhere").textContent = outCoords ? "Location saved" : ""; $("outErr").textContent = ""; $("outDel").hidden = !rec;
  $("outScrim").hidden = false;
}
function closeOuting(){ $("outScrim").hidden = true; outEditing = null; }
$("outCancel").onclick = closeOuting;
$("outScrim").addEventListener("click", e => { if(e.target === $("outScrim")) closeOuting(); });
$("oHere").onclick = () => {
  const h = $("oWhere"); h.className = "hint"; h.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(p => {
    outCoords = { lat:p.coords.latitude, lng:p.coords.longitude }; h.className = "hint ok"; h.textContent = "Location saved";
    if(!$("oWater").value.trim()) watersNear(outCoords.lat, outCoords.lng).then(list => { const w = pickWater(list); if(w && !$("oWater").value.trim()) $("oWater").value = w.name; }).catch(() => {});
  }, () => { h.className = "hint bad"; h.textContent = "Couldn't get your location."; }, { enableHighAccuracy:true, timeout:20000, maximumAge:60000 });
};
$("outDel").onclick = () => { if(!outEditing) return; if(!confirmTap($("outDel"), "Tap again to delete")) return; const r = outEditing; closeOuting(); removeRecord("outing", r); };
$("outForm").addEventListener("submit", async ev => {
  ev.preventDefault(); const err = $("outErr"); err.className = "hint bad"; err.textContent = "";
  const d = $("oDate").value, hs = $("oHours").value.trim().replace(",", "."), h = hs ? +hs : null;
  if(!d){ err.textContent = "Pick the day."; return; }
  if(hs && !(h > 0 && h <= 24)){ err.textContent = "Hours should be between 0.5 and 24, like 3 or 2.5."; $("oHours").focus(); return; }
  if(!hs && !$("oWater").value.trim() && !outCoords){ err.textContent = "Add the hours or where you fished."; return; }
  const t = anyTripFor(d);
  const rec = { id: outEditing ? outEditing.id : uuid(), fished_on:d, hours: h ? Math.round(h * 10) / 10 : null, water: capWords($("oWater").value.trim()) || null,
    lat: outCoords ? outCoords.lat : null, lng: outCoords ? outCoords.lng : null, county: outCoords ? countyAt(outCoords.lat, outCoords.lng) : null,
    notes: $("oNotes").value.trim() || null, on_map: $("oOnMap").checked, trip_id: t && trips.some(x => x.id === t.id) ? t.id : null };
  try{ await saveRecord("outings", rec, null, !!outEditing); closeOuting(); toast(t ? `Saved to ${t.name}` : "Time on the water saved"); }
  catch(e){ err.textContent = "Couldn't save. Try again."; }
});

/* places fished on my map */
let showOutings = lsGet("fl.outings", true);
function syncOutToggle(){ const b = $("outToggle"); b.setAttribute("aria-pressed", String(showOutings)); b.textContent = showOutings ? "Places fished on" : "Places fished off"; b.hidden = !outings.some(o => o.lat != null && o.on_map !== false); }
$("outToggle").onclick = () => { showOutings = !showOutings; lsSet("fl.outings", showOutings); renderAll(); };
function outingMarkers(){
  syncOutToggle();
  if(!showOutings || hidePins || mapPerson) return;
  for(const o of outings){
    if(o.lat == null || o.on_map === false) continue;
    const m = L.marker([o.lat, o.lng], { icon:L.divIcon({ className:"", html:`<div class="mk-out" title="Fished">${o.hours ? fmtHours(o.hours).replace(" h", "h") : ""}</div>`, iconSize:[0,0] }), zIndexOffset:100, title:"Fished here" });
    m.bindPopup(() => `<div class="pop"><div class="meta" style="font-weight:700">Fished${o.hours ? ` ${fmtHours(o.hours)}` : ""}</div><h3>${esc(o.water || "Places fished")}</h3><div class="meta">${esc(fmtDate(o.fished_on))}${o.county ? ` · ${esc(countyName(o.county))}` : ""}</div>${o.notes ? `<p style="margin:6px 0">${esc(o.notes)}</p>` : ""}<div class="row"><button class="link" type="button" data-outing="${esc(o.id)}">Edit</button></div></div>`, { maxWidth:280 });
    markerLayer.addLayer(m);
  }
}

/* ---------- trip album: everyone's fish photos plus photos anyone on the trip posts ---------- */
function tripAlbumHtml(t, mineWithPhotos){
  const g = tripGroup[t.id];
  const items = [
    ...mineWithPhotos.map(c => ({ src:photoSrc(c.photo_path), go:"c:" + c.id, label:c.species || "Catch", d:c.caught_on })),
    ...(g ? g.catches.filter(c => c.photo_path).map(c => ({ src:photoSrc(c.photo_path), view:c.photo_path, cap:`${c.display_name}: ${c.species || "Fish"}${c.length_in ? " · " + lenTxt(c.length_in) : ""}`, label:c.species || "Catch", d:c.caught_on })) : []),
    ...(g ? (g.photos || []).map(p => ({ src:photoSrc(p.path), view:p.path, cap:[p.display_name, p.caption].filter(Boolean).join(": "), label:"Trip photo", d:p.taken_on, mine:p.user_id === me.id ? p.id : "" })) : [])
  ].sort((a, b) => (a.d || "").localeCompare(b.d || ""));
  const canPost = !!g && (trips.some(x => x.id === t.id) || t.my_status === "joined");
  if(!items.length && !canPost) return "";
  return `<div class="album">${items.length ? `<div class="strip">${items.map(i => `<button type="button" ${i.go ? `data-go="${esc(i.go)}"` : `data-pview="${esc(i.view)}" data-cap="${esc(i.cap || "")}" data-mine="${esc(i.mine || "")}"`} aria-label="${esc(i.label)} photo" style="background-image:url('${i.src}')"></button>`).join("")}</div>` : ""}
    ${canPost ? `<label class="btn sm" style="margin-top:6px">${icon("i-plus")}Add trip photo<input type="file" accept="image/*" class="vh" data-tphoto="${esc(t.id)}"></label><small class="muted" style="margin-left:8px">Camp, the water, the crew. 3 a day each.</small>` : ""}</div>`;
}
$("log").addEventListener("change", async e => {
  const inp = e.target.closest("[data-tphoto]"); if(!inp || !inp.files[0]) return;
  const tid = inp.dataset.tphoto, t = tripOf(tid) || trips.find(x => x.id === tid), file = inp.files[0]; inp.value = "";
  if(!navigator.onLine){ toast("Trip photos need a connection. Try again when you have signal."); return; }
  toast("Adding photo…");
  try{
    let day = null; try{ const ex = readExif(await file.arrayBuffer()); const m = ex?.date?.match(/^(\d{4}):(\d{2}):(\d{2})/); if(m) day = `${m[1]}-${m[2]}-${m[3]}`; }catch(_){}
    if(!day || day < t.start_date || day > t.end_date) day = todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date;
    const blob = await shrink(file), path = `${me.id}/trip-${tid}-${Date.now()}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType:"image/jpeg" }); if(up.error) throw up.error;
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    const { error } = await sb.from("trip_photos").insert({ id:uuid(), trip_id:tid, path, taken_on:day });
    if(error){ sb.storage.from("photos").remove([path]); toast(/3 trip photos/.test(error.message) ? "You can post 3 trip photos per day." : "Couldn't add the photo. Try again."); return; }
    toast("Photo added to the trip"); loadTripGroup(tid);
  }catch(err){ console.error(err); toast("Couldn't add the photo. Try again."); }
});
// tap a group photo to see it big
$("log").addEventListener("click", e => {
  const b = e.target.closest("[data-pview]"); if(!b) return;
  const v = document.createElement("div"); v.className = "pview"; v.setAttribute("role", "dialog");
  v.innerHTML = `${phImg(b.dataset.pview, 'alt=""')}<div class="pcap">${esc(b.dataset.cap || "")}${b.dataset.mine ? ` <button class="link danger" type="button" data-pdel="${esc(b.dataset.mine)}">Delete my photo</button>` : ""}</div>`;
  v.addEventListener("click", async ev => {
    const d = ev.target.closest("[data-pdel]");
    if(d){ if(!confirmTap(d, "Tap again to delete")) return; const tid = tripOpen; const { error } = await sb.from("trip_photos").delete().eq("id", d.dataset.pdel);
      if(!error) sb.storage.from("photos").remove([b.dataset.pview]); toast(error ? "Couldn't delete it." : "Photo deleted"); v.remove(); loadTripGroup(tid); return; }
    v.remove();
  });
  document.body.appendChild(v);
});

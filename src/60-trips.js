
/* ---------- trips ---------- */
function tripCatches(t){ return catches.filter(c => c.trip_id === t.id).sort((a,b) => (a.caught_on||"").localeCompare(b.caught_on||"") || (a.created_at||"").localeCompare(b.created_at||"")); }
function daysBetween(a, b){ const out = []; const d = new Date(a + "T12:00:00"), e = new Date(b + "T12:00:00"); while(d <= e && out.length < 60){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); } return out; }
function summarize(cs){
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const species = new Set(cs.filter(c=>fishOf(c)>0).map(c=>c.species).filter(Boolean));
  const big = cs.filter(c => c.length_in != null).sort((a,b) => b.length_in - a.length_in)[0] || null;
  const flies = {}; cs.forEach(c => { if(c.fly && fishOf(c)>0) flies[c.fly] = (flies[c.fly]||0) + fishOf(c); });
  const fly = Object.entries(flies).sort((a,b)=>b[1]-a[1])[0] || null;
  return { fish, species, big, fly };
}
function renderTripsTab(el){
  if(tripOpen){ const t = trips.find(x => x.id === tripOpen); if(t) return renderTrip(el, t); tripOpen = null; }
  const today = todayStr();
  const list = [...trips].sort((a,b) => b.start_date.localeCompare(a.start_date));
  const loose = catches.filter(c => !c.trip_id).length;
  el.innerHTML = `<div class="eyebrow">Trips</div><h2>Your trips</h2>
    <p class="muted" style="margin:4px 0 12px">Catches join a trip automatically when their date falls inside it.</p>
    <button class="btn ink" type="button" data-a="newtrip">${icon("i-plus")}New trip</button>
    <div class="stack" style="margin-top:14px">${list.length ? list.map(t => {
      const s = summarize(tripCatches(t)); const now = t.start_date <= today && today <= t.end_date;
      return `<button class="trip${now?" now":""}" data-trip="${esc(t.id)}" type="button"><small>${now?"Happening now · ":""}${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</small><b>${esc(t.name)}</b>
        <span class="tnums"><span><em>${s.fish}</em> fish</span><span>${daysBetween(t.start_date, t.end_date).length} days</span>${s.big?`<span>Biggest ${lenTxt(s.big.length_in)}</span>`:""}${(t.waters||[]).length?`<span>${t.waters.length} water${t.waters.length===1?"":"s"} planned</span>`:""}${!t.shared?"<span>Private</span>":""}${t._pending?"<span>Waiting to sync</span>":""}</span></button>`; }).join("")
      : `<div class="empty"><b>No trips yet</b>Make one for your next outing, even a single day. Every catch you log during those dates lands in it, and you get a recap with photos, the best fly, and day-by-day notes.</div>`}</div>
    ${loose && list.length ? `<p class="note">${loose} catch${loose===1?" isn't":"es aren't"} part of a trip. Edit a catch to add it to one.</p>` : ""}`;
}
function renderTrip(el, t){
  const cs = tripCatches(t), s = summarize(cs);
  const days = daysBetween(t.start_date, t.end_date);
  const photos = cs.filter(c => c.photo_path);
  const byDay = {}; cs.forEach(c => (byDay[c.caught_on] ||= []).push(c));
  const counties_ = new Set(cs.map(c => c.county).filter(Boolean));
  el.innerHTML = `<button class="link backlink" data-a="trips" type="button">${icon("i-back")}All trips</button>
    <div class="eyebrow">${esc(fmtRange(t.start_date, t.end_date))}${t.base?` · ${esc(t.base)}`:""}</div><h2>${esc(t.name)}</h2>
    <div class="stats four"><div class="stat f"><b>${s.fish}</b><span>fish</span></div><div class="stat"><b>${s.species.size}</b><span>species</span></div>
      <div class="stat"><b>${s.big ? lenTxt(s.big.length_in) : "–"}</b><span>biggest</span></div><div class="stat"><b>${days.filter(d => byDay[d]?.some(c=>fishOf(c)>0)).length}/${days.length}</b><span>days with fish</span></div></div>
    ${s.fly ? `<p style="margin:0 0 6px"><b>Best fly:</b> ${esc(s.fly[0])} (${s.fly[1]} fish)</p>` : ""}
    ${counties_.size ? `<p class="muted" style="margin:0 0 8px">${[...counties_].map(countyName).join(", ")}</p>` : ""}
    ${t.notes ? `<p style="margin:6px 0 10px">${esc(t.notes)}</p>` : ""}
    ${tripPlanHtml(t)}
    ${photos.length ? `<div class="strip">${photos.map(c => `<button type="button" data-go="c:${esc(c.id)}" aria-label="${esc(c.species||"Catch")} photo" style="background-image:url('${photoSrc(c.photo_path)}')"></button>`).join("")}</div>` : ""}
    <div class="row2" style="margin:8px 0 4px">
      <button class="btn sm fish" type="button" data-a="logtrip">${icon("i-fish")}Log a catch</button>
      <button class="btn sm" type="button" data-a="fittrip">Show on map</button>
      <button class="btn sm" type="button" data-a="edittrip">Edit</button>
      <button class="btn sm" type="button" data-a="deltrip">Delete</button>
    </div><div data-slot></div>
    ${days.map(d => { const list = byDay[d] || []; const n = list.reduce((a,c)=>a+fishOf(c),0);
      return `<div class="day"><h5>${esc(fmtDate(d, { weekday:"long", month:"short", day:"numeric" }))}<span>${n} fish</span></h5>
        ${list.length ? `<ul class="list">${list.map(itemCatch).join("")}</ul>` : `<p class="skunk">${d > todayStr() ? "Still to come" : "No fish logged"}</p>`}</div>`; }).join("")}
    ${(() => { const out = cs.filter(c => !days.includes(c.caught_on)); return out.length ? `<div class="day"><h5>Outside the trip dates<span>${out.length}</span></h5><ul class="list">${out.map(itemCatch).join("")}</ul></div>` : ""; })()}
    <p class="note">${t.shared ? "Friends can see this trip and the catches in it that aren't private." : "This trip is private."}</p>`;
}
function openTrip(id){ expandPanel(); tripOpen = id; tab = "trips"; renderLog(); $("log").scrollTop = 0; fitTrip(); }
function fitTrip(){
  const t = trips.find(x => x.id === tripOpen); if(!t) return;
  const pts = tripCatches(t).filter(c => c.lat != null).map(c => [c.lat, c.lng]);
  if(!pts.length) return;
  const cid = tripCatches(t).map(c => c.county).filter(Boolean)[0];
  if(cid && currentCounty !== cid){ currentCounty = cid; $("backBtn").hidden = false; setMask(cid); showDetail(cid); countyLayer.setStyle(countyStyle); }
  map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom:13, padding:[40,40] });
}
$("log").addEventListener("click", ev => {
  const tb = ev.target.closest("[data-trip]"); if(tb){ openTrip(tb.dataset.trip); return; }
  const a = ev.target.closest("[data-a]"); if(!a) return;
  const t = trips.find(x => x.id === tripOpen);
  switch(a.dataset.a){
    case "newtrip": openTripForm(); break;
    case "trips": tripOpen = null; renderLog(); break;
    case "edittrip": if(t) openTripForm(t); break;
    case "fittrip": fitTrip(); break;
    case "logtrip": if(t){ const d = todayStr() >= t.start_date && todayStr() <= t.end_date ? todayStr() : t.start_date; openForm("catch", null, { caught_on:d, trip_id:t.id }); tripTouched = true; } break;
    case "deltrip": { const slot = $("log").querySelector("[data-slot]"); if(slot) slot.innerHTML = `<div class="confirm">Delete this trip? Its catches stay in your log.<button class="link danger" data-a="deltripyes" type="button">Delete trip</button><button class="link" data-a="deltripno" type="button">Keep</button></div>`; break; }
    case "deltripno": { const slot = $("log").querySelector("[data-slot]"); if(slot) slot.innerHTML = ""; break; }
    case "deltripyes": if(t){ tripOpen = null; removeRecord("trip", t); } break;
  }
});

/* trip form */
let tripEditing = null;
function openTripForm(t){
  if(!canWrite){ toast("Sign in to save trips."); return; }
  tripEditing = t || null;
  $("tripTitle").textContent = t ? "Edit trip" : "New trip"; $("tripErr").textContent = "";
  $("tName").value = t?.name || ""; $("tStart").value = t?.start_date || todayStr(); $("tEnd").value = t?.end_date || todayStr();
  $("tBase").value = t?.base || ""; $("tNotes").value = t?.notes || ""; $("tShared").checked = t ? t.shared : true;
  $("tripScrim").hidden = false; setTimeout(() => $("tName").focus({ preventScroll:true }), 50);
}
function closeTripForm(){ $("tripScrim").hidden = true; tripEditing = null; }
$("tripCancel").onclick = closeTripForm;
$("tripScrim").addEventListener("click", e => { if(e.target === $("tripScrim")) closeTripForm(); });
$("tStart").addEventListener("change", () => { if($("tEnd").value < $("tStart").value) $("tEnd").value = $("tStart").value; });
$("tripForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("tripErr"); err.className = "hint bad"; err.textContent = "";
  const name = $("tName").value.trim(), a = $("tStart").value, b = $("tEnd").value;
  if(!name){ err.textContent = "Give the trip a name."; $("tName").focus(); return; }
  if(!a || !b){ err.textContent = "Add the first and last day."; return; }
  if(b < a){ err.textContent = "The last day can't be before the first day."; $("tEnd").focus(); return; }
  if(daysBetween(a, b).length > 45){ err.textContent = "Trips can be up to 45 days long."; return; }
  const rec = { id: tripEditing ? tripEditing.id : uuid(), name, start_date:a, end_date:b, base:$("tBase").value.trim() || null, notes:$("tNotes").value.trim() || null, shared:$("tShared").checked,
    waters: tripEditing ? (tripEditing.waters || []) : (pendingPlanWater ? [pendingPlanWater] : []) };
  if(!tripEditing) pendingPlanWater = null;
  const isNew = !tripEditing;
  try{
    await saveRecord("trips", rec, null, !isNew);
    // pull in catches from these dates that aren't on another trip yet
    const adopt = catches.filter(c => !c.trip_id && c.caught_on >= a && c.caught_on <= b);
    for(const c of adopt){ await saveRecord("catches", { ...c, trip_id: rec.id }, null, true); }
    closeTripForm();
    toast(adopt.length ? `Trip saved. Added ${adopt.length} catch${adopt.length===1?"":"es"} from those dates.` : "Trip saved");
    openTrip(rec.id);
  }catch(e){ err.textContent = "Couldn't save the trip. Try again."; }
});

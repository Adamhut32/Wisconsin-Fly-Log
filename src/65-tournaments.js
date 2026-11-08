
/* ---------- tournaments ---------- */
const REGION_COUNTIES = {
  "Driftless Area": ["Vernon","Crawford","Richland","Grant","Iowa","La Crosse","Monroe","Buffalo","Trempealeau","Pepin","Pierce","Lafayette","Sauk","Jackson"],
  "Northwoods": ["Vilas","Oneida","Forest","Florence","Iron","Price","Lincoln","Langlade","Sawyer","Ashland","Bayfield","Douglas","Washburn","Burnett","Taylor","Rusk"],
  "Central Sands": ["Adams","Waushara","Portage","Wood","Marquette","Juneau","Green Lake"]
};
const idByName = {}; counties.forEach(f => idByName[f.properties.name] = f.id);
const TROUT_SPECIES = ["Brook trout","Brown trout","Rainbow trout","Tiger trout"];
const SCORING = {
  biggest: { label:"Biggest fish", how:"Longest single fish wins." },
  top3:    { label:"Top 3 total", how:"Add up each angler's three longest fish." },
  most:    { label:"Most fish", how:"Most fish caught wins." },
  species: { label:"Most species", how:"Most different species wins." }
};
let tourneyOpen = null, tourneyBoard = {}, tourneyPeople = {};
async function loadTournaments(){
  if(!me || !navigator.onLine) return;
  const { data, error } = await sb.rpc("my_tournaments");
  if(!error){ tournaments = data || []; saveCache(); if(tab === "tourney") renderLog(); }
}
function tState(t){ const d = todayStr(); return d < t.starts_on ? "upcoming" : d > t.ends_on ? "finished" : "live"; }
function tRules(t){
  const bits = [`${fmtRange(t.starts_on, t.ends_on)}`, t.area_label || (t.counties ? `${t.counties.length} counties` : "Anywhere in Wisconsin"),
    t.species ? (t.species.length > 3 ? `${t.species.length} species` : t.species.join(", ")) : "Any species", t.methods && t.methods.length === 1 && t.methods[0] === "fly" ? "Fly only" : t.methods ? "No fly" : "", SCORING[t.scoring]?.label];
  return bits.filter(Boolean).join(" · ");
}
function standings(t, rows){
  const by = {};
  for(const r of rows){ const u = by[r.user_id] ||= { id:r.user_id, name:r.display_name, rows:[] }; u.rows.push(r); }
  const list = Object.values(by).map(u => {
    const lens = u.rows.map(r => +r.length_in || 0).sort((a,b) => b-a);
    const v = t.scoring === "biggest" ? lens[0] || 0 : t.scoring === "top3" ? lens.slice(0,3).reduce((a,b)=>a+b,0)
      : t.scoring === "most" ? u.rows.reduce((a,r)=>a+fishOf(r),0) : new Set(u.rows.map(r => (r.species||"").toLowerCase()).filter(Boolean)).size;
    const txt = t.scoring === "biggest" || t.scoring === "top3" ? `${Math.round(v*10)/10}″` : `${v}`;
    return { ...u, v, txt, sub: `${u.rows.length} entr${u.rows.length===1?"y":"ies"}` };
  });
  return list.sort((a,b) => b.v - a.v);
}
async function openTourney(id){
  expandPanel(); tourneyOpen = id; tab = "tourney"; renderLog(); $("log").scrollTop = 0;
  const [b, p] = await Promise.all([ sb.rpc("tournament_board", { tid:id }), sb.rpc("tournament_people", { tid:id }) ]);
  tourneyBoard[id] = b.data || []; tourneyPeople[id] = p.data || [];
  if(tourneyOpen === id && tab === "tourney") renderLog();
}
function renderTourneyTab(el){
  if(tourneyOpen){ const t = tournaments.find(x => x.id === tourneyOpen); if(t) return renderTourney(el, t); tourneyOpen = null; }
  const invites = tournaments.filter(t => t.my_status === "invited");
  const mine = tournaments.filter(t => t.my_status === "joined");
  const openOnes = tournaments.filter(t => t.open && !t.my_status && tState(t) !== "finished");
  const card = t => { const s = tState(t); return `<button class="trip${s==="live"?" now":""}" type="button" data-tourney="${esc(t.id)}"><small>${s==="live"?"Happening now":s==="upcoming"?"Starts "+esc(fmtDate(t.starts_on)):"Finished"} · by ${esc(t.owner_name)}${t.open?" · Open to everyone":""}</small><b>${esc(t.name)}</b>
    <span class="tnums"><span>${esc(tRules(t))}</span></span><span class="tnums"><span>${t.members} angler${t.members===1?"":"s"}</span><span>${t.entries} entr${t.entries===1?"y":"ies"}</span>${t.require_photo?"<span>Photo required</span>":""}</span></button>`; };
  markTourneyNoticesRead();
  el.innerHTML = `<div class="eyebrow">Tournaments</div><h2>Tournaments</h2>${tourneyNoticesHtml()}
    <p class="muted" style="margin:4px 0 12px">Set the dates, area and how it's scored, then invite friends. Catches that fit the rules are entered automatically when you log them.</p>
    <button class="btn ink" type="button" data-a="newtourney">${icon("i-plus")}New tournament</button>
    ${invites.length ? `<h4><span>Invitations</span></h4><div class="stack">${invites.map(t => `<div class="card"><p><b>${esc(t.name)}</b></p><p class="muted">${esc(t.owner_name)} invited you · ${esc(tRules(t))}</p><div class="row2"><button class="btn sm ink" type="button" data-tjoin="${esc(t.id)}">Join</button><button class="btn sm" type="button" data-tdecline="${esc(t.id)}">No thanks</button></div></div>`).join("")}</div>` : ""}
    <h4><span>Your tournaments</span></h4>
    ${mine.length ? `<div class="stack">${mine.map(card).join("")}</div>` : `<div class="empty"><b>No tournaments yet</b>Start one for a weekend or a whole season, limit it to a county or region if you like, and invite your fishing friends.</div>`}
    ${openOnes.length ? `<h4><span>Open to everyone</span></h4><div class="stack">${openOnes.map(card).join("")}</div>` : ""}`;
}
function renderTourney(el, t){
  const rows = tourneyBoard[t.id], ppl = tourneyPeople[t.id] || [];
  const s = tState(t), isOwner = t.owner === me?.id, joined = t.my_status === "joined";
  const board = rows ? standings(t, rows) : null;
  const myCatches = catches.filter(c => c.caught_on >= t.starts_on && c.caught_on <= t.ends_on);
  const entered = new Set((rows || []).map(r => r.catch_id));
  el.innerHTML = `<button class="link backlink" data-a="tourneys" type="button">${icon("i-back")}All tournaments</button>
    <div class="eyebrow">${s === "live" ? "Happening now" : s === "upcoming" ? "Upcoming" : "Finished"} · by ${esc(t.owner_name)}</div><h2>${esc(t.name)}</h2>
    ${t.description ? `<p style="margin:4px 0 8px">${esc(t.description)}</p>` : ""}
    <div class="card" style="margin:8px 0 4px">
      <p><b>Dates:</b> ${esc(fmtRange(t.starts_on, t.ends_on))}</p>
      <p><b>Area:</b> ${esc(t.area_label || (t.counties ? t.counties.map(id => byId[id]?.properties.name).filter(Boolean).join(", ") : "Anywhere in Wisconsin"))}</p>
      <p><b>Species:</b> ${esc(t.species ? t.species.join(", ") : "Any")}</p>
      <p><b>Method:</b> ${esc(t.methods ? (t.methods.length === 1 && t.methods[0] === "fly" ? "Fly only" : t.methods.map(m => METHODS[m]).join(", ")) : "Any")}</p>
      <p><b>Scoring:</b> ${esc(SCORING[t.scoring]?.label)}. ${esc(SCORING[t.scoring]?.how)}</p>
      ${t.require_photo ? `<p><b>Photo:</b> Each fish needs a photo taken during the tournament dates. The app checks the date stamp saved in the photo.</p>` : ""}
    </div>
    ${t.my_status === "invited" ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button><button class="btn" type="button" data-tdecline="${esc(t.id)}">No thanks</button></div>` : ""}
    ${!t.my_status && t.open ? `<div class="row2" style="margin:10px 0"><button class="btn ink" type="button" data-tjoin="${esc(t.id)}">Join tournament</button></div>` : ""}
    <h4><span>${s === "finished" ? "Final standings" : "Standings"}</span><span>${SCORING[t.scoring]?.label}</span></h4>
    ${!board ? `<p class="status">Loading standings…</p>` : board.length ? `<div class="board"><ol>${board.map((r,i) => `<li class="${r.id===me?.id?"me":""}"><span class="r">${i+1}</span><span>${i===0&&s==="finished"?`<span class="pill open">Winner</span> `:""}${esc(r.name)}<small>${esc(r.sub)}</small></span><span class="v">${esc(r.txt)}</span></li>`).join("")}</ol></div>` : `<p class="muted">No entries yet.</p>`}
    ${rows && rows.length ? `<h4><span>Entries</span><span>${rows.length}</span></h4><div class="strip">${rows.filter(r => r.photo_path).map(r => `<button type="button" title="${esc(r.display_name)}: ${esc(r.species||"")} ${r.length_in?lenTxt(r.length_in):""}" style="background-image:url('${photoSrc(r.photo_path)}')" data-tphoto="${esc(r.catch_id)}"></button>`).join("")}</div>
      <ul class="list">${rows.slice().sort((a,b)=>(b.caught_on||"").localeCompare(a.caught_on||"")).map(r => `<li class="item" style="cursor:default">${thumb(r)}<span class="t"><b>${esc(r.species||"Fish")}${r.length_in?` · ${lenTxt(r.length_in)}`:""}</b><small>${esc(r.display_name)} · ${esc(fmtDate(r.caught_on))} · ${esc(countyName(r.county))}</small></span><span class="num" data-rmslot>${r.user_id===me?.id && s!=="finished"?`<button class="link danger" type="button" data-twithdraw="${esc(r.catch_id)}">Remove</button>`:isOwner?`<button class="link danger" type="button" data-townerrm="${esc(r.catch_id)}">Remove</button>`:""}</span></li>`).join("")}</ul>` : ""}
    ${joined && s !== "finished" ? `<h4><span>Your catches during these dates</span></h4>${myCatches.length ? `<ul class="list">${myCatches.map(c => `<li class="item" style="cursor:default">${thumb(c)}<span class="t"><b>${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}</b><small>${esc(fmtDate(c.caught_on))}${c.photo_taken_on?"":" · photo has no date"}</small></span><span class="num">${entered.has(c.id)?`<span class="pill fished">Entered</span>`:`<button class="btn sm" type="button" data-tenter="${esc(c.id)}">Enter</button>`}</span></li>`).join("")}</ul><span class="hint" id="tenterMsg" role="alert"></span>` : `<p class="muted">Nothing logged during the tournament yet. Catches that fit the rules are entered when you log them.</p>`}` : ""}
    <h4><span>Anglers</span><span>${ppl.filter(p => p.status === "joined").length}</span></h4>
    <p style="margin:0">${ppl.map(p => `<span class="pill${p.status==="joined"?"":" priv"}" style="margin:0 4px 4px 0">${esc(p.display_name)}${p.status==="invited"?" (invited)":""}</span>`).join("") || `<span class="muted">Loading…</span>`}</p>
    ${joined && s !== "finished" ? `<div class="row2" style="margin-top:10px"><button class="btn sm" type="button" data-a="tinvite">Invite friends</button></div><div data-invite></div>` : ""}
    ${tourneyToolsHtml(t)}
    <div class="row2" style="margin-top:16px">${isOwner || profile?.role === "creator" ? `<button class="btn sm" type="button" data-a="tdelete">Delete tournament</button>` : joined ? `<button class="btn sm" type="button" data-tdecline="${esc(t.id)}">Leave tournament</button>` : ""}</div><div data-tslot></div>`;
}
function friendsList(){ return friendships.filter(f => f.status === "accepted").map(f => { const id = f.requester === me.id ? f.addressee : f.requester; return { id, name: people[id]?.display_name || "Friend" }; }); }
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const card = t.closest("[data-tourney]"); if(card){ openTourney(card.dataset.tourney); return; }
  const j = t.closest("[data-tjoin]"); if(j){ j.disabled = true; const { error } = await sb.rpc("respond_tournament", { tid:j.dataset.tjoin, accept:true }); if(error){ toast(error.message); j.disabled = false; return; }
    toast("You're in. Catches that fit will be entered as you log them."); await loadTournaments();
    for(const c of catches) await sb.rpc("auto_enter", { cid:c.id }); openTourney(j.dataset.tjoin); return; }
  const d = t.closest("[data-tdecline]"); if(d){ const { error } = await sb.rpc("respond_tournament", { tid:d.dataset.tdecline, accept:false }); if(error){ toast(error.message); return; } tourneyOpen = null; await loadTournaments(); renderLog(); return; }
  const en = t.closest("[data-tenter]"); if(en){ en.disabled = true; const { data, error } = await sb.rpc("enter_catch", { tid:tourneyOpen, cid:en.dataset.tenter });
    const msg = $("tenterMsg"); if(error || data){ if(msg){ msg.className = "hint bad"; msg.textContent = error ? "Couldn't enter it. Try again." : data; } en.disabled = false; return; }
    toast("Catch entered"); openTourney(tourneyOpen); loadTournaments(); return; }
  const w = t.closest("[data-twithdraw]"); if(w){ await sb.rpc("withdraw_catch", { tid:tourneyOpen, cid:w.dataset.twithdraw }); toast("Entry removed"); openTourney(tourneyOpen); loadTournaments(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "newtourney") openTourneyForm();
  if(a.dataset.a === "tourneys"){ tourneyOpen = null; renderLog(); }
  if(a.dataset.a === "tinvite"){
    const slot = $("log").querySelector("[data-invite]"); const inT = new Set((tourneyPeople[tourneyOpen]||[]).map(p => p.user_id));
    const fr = friendsList().filter(f => !inT.has(f.id));
    slot.innerHTML = fr.length ? `<div class="card" style="margin-top:8px">${fr.map(f => `<label class="check"><input type="checkbox" value="${esc(f.id)}"> ${esc(f.name)}</label>`).join("")}<div class="row2"><button class="btn sm ink" type="button" data-a="tinvitego">Send invites</button></div></div>` : `<p class="muted">All your friends are already in, or you haven't added any friends yet.</p>`;
  }
  if(a.dataset.a === "tinvitego"){
    const ids = [...$("log").querySelectorAll("[data-invite] input:checked")].map(i => i.value); if(!ids.length) return;
    const { error } = await sb.rpc("invite_to_tournament", { tid:tourneyOpen, p_invite:ids }); if(error){ toast(error.message); return; }
    toast(`Invited ${ids.length} friend${ids.length===1?"":"s"}`); openTourney(tourneyOpen);
  }
  if(a.dataset.a === "tdelete"){ const slot = $("log").querySelector("[data-tslot]"); slot.innerHTML = `<div class="confirm">Delete this tournament for everyone? Catches stay in each angler's log.<button class="link danger" type="button" data-a="tdeleteyes">Delete</button><button class="link" type="button" data-a="tdeleteno">Keep</button></div>`; }
  if(a.dataset.a === "tdeleteno"){ $("log").querySelector("[data-tslot]").innerHTML = ""; }
  if(a.dataset.a === "tdeleteyes"){ const { error } = await sb.from("tournaments").delete().eq("id", tourneyOpen); if(error){ toast("Couldn't delete it. Try again."); return; } toast("Tournament deleted"); tourneyOpen = null; await loadTournaments(); renderLog(); }
});

/* tournament form */
let tfCounties = new Set();
function openTourneyForm(){
  if(!navigator.onLine){ toast("Get back online to start a tournament."); return; }
  $("tfErr").textContent = ""; $("tfName").value = ""; $("tfDesc").value = "";
  const d = new Date(); const sat = new Date(d); sat.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  const iso = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  const sun = new Date(sat); sun.setDate(sat.getDate()+1);
  $("tfStart").value = iso(sat); $("tfEnd").value = iso(sun);
  $("tfArea").value = "any"; tfCounties = new Set(); renderCountyPick();
  $("tfSpecies").value = "any"; $("tfScoring").value = "biggest"; $("tfPhoto").checked = true;
  $("tfOpenRow").hidden = !(profile?.role === "creator" || profile?.verified); $("tfOpen").checked = false; $("tfMethod").value = "any";
  const fr = friendsList();
  $("tfInvite").innerHTML = fr.length ? fr.map(f => `<label class="check"><input type="checkbox" value="${esc(f.id)}"> ${esc(f.name)}</label>`).join("") : `<p class="muted" style="margin:0">Add friends in the Friends tab to invite them. You can invite people later too.</p>`;
  $("tourneyScrim").hidden = false;
}
function renderCountyPick(){
  const area = $("tfArea").value;
  $("tfCountyBox").hidden = area !== "pick";
  if(area !== "pick") return;
  const q = $("tfCountyQ").value.trim().toLowerCase();
  const names = counties.map(f => f.properties.name).sort().filter(n => !q || n.toLowerCase().includes(q));
  $("tfCountyList").innerHTML = names.map(n => `<label class="check"><input type="checkbox" value="${esc(idByName[n])}" ${tfCounties.has(idByName[n])?"checked":""}> ${esc(n)}</label>`).join("");
  $("tfCountyCount").textContent = `${tfCounties.size} selected`;
}
$("tfArea").addEventListener("change", renderCountyPick);
$("tfCountyQ").addEventListener("input", renderCountyPick);
$("tfCountyList").addEventListener("change", e => { const i = e.target; if(i.type !== "checkbox") return; if(i.checked) tfCounties.add(i.value); else tfCounties.delete(i.value); $("tfCountyCount").textContent = `${tfCounties.size} selected`; });
$("tfCancel").onclick = () => { $("tourneyScrim").hidden = true; };
$("tourneyScrim").addEventListener("click", e => { if(e.target === $("tourneyScrim")) $("tourneyScrim").hidden = true; });
$("tourneyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("tfErr"); err.className = "hint bad"; err.textContent = "";
  const name = $("tfName").value.trim(), a = $("tfStart").value, b = $("tfEnd").value, area = $("tfArea").value;
  if(name.length < 2){ err.textContent = "Give the tournament a name."; $("tfName").focus(); return; }
  if(!a || !b){ err.textContent = "Add a start and end date."; return; }
  if(b < a){ err.textContent = "The end date can't be before the start date."; return; }
  if(daysBetween(a, b).length > 121){ err.textContent = "Tournaments can run up to about four months."; return; }
  let ids = null, label = null;
  if(area === "pick"){ if(!tfCounties.size){ err.textContent = "Pick at least one county, or choose Anywhere."; return; } ids = [...tfCounties]; label = ids.length <= 3 ? ids.map(id => byId[id].properties.name).join(", ") + (ids.length === 1 ? " County" : " counties") : `${ids.length} counties`; }
  else if(area !== "any"){ ids = REGION_COUNTIES[area].map(n => idByName[n]).filter(Boolean); label = area; }
  const sp = $("tfSpecies").value;
  const species = sp === "any" ? null : sp === "trout" ? TROUT_SPECIES : sp === "bass" ? BASS : sp === "panfish" ? PANFISH : [sp];
  const mt = $("tfMethod").value, methods = mt === "fly" ? ["fly"] : mt === "nofly" ? ["spin","baitcast","ice","trolling","other"] : null;
  const invite = [...$("tfInvite").querySelectorAll("input:checked")].map(i => i.value);
  const btn = $("tfSave"); btn.disabled = true;
  const { data, error } = await sb.rpc("create_tournament", { p_name:name, p_description:$("tfDesc").value.trim() || null, p_starts:a, p_ends:b, p_counties:ids, p_area_label:label,
    p_species:species, p_scoring:$("tfScoring").value, p_require_photo:$("tfPhoto").checked, p_open:$("tfOpen").checked, p_invite:invite, p_methods:methods });
  btn.disabled = false;
  if(error){ err.textContent = /open tournaments|approval/.test(error.message) ? error.message : "Couldn't create the tournament. Check your connection and try again."; return; }
  $("tourneyScrim").hidden = true;
  toast(invite.length ? `Tournament created. Invited ${invite.length} friend${invite.length===1?"":"s"}.` : "Tournament created");
  await loadTournaments();
  for(const c of catches.filter(c => c.caught_on >= a && c.caught_on <= b)) await sb.rpc("auto_enter", { cid:c.id });
  openTourney(data);
});

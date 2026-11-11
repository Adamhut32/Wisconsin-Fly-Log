
/* ---------- methods ---------- */
const METHODS = { fly:"Fly", spin:"Spinning", baitcast:"Baitcasting", ice:"Ice fishing", trolling:"Trolling", other:"Other" };
function updateFlyLabel(){
  const fly = $("fMethod").value === "fly";
  $("fFlyLbl").textContent = fly ? "Fly" : "Lure or bait";
  $("fFly").placeholder = fly ? "#16 Elk Hair Caddis" : $("fMethod").value === "ice" ? "Waxworm on a jig" : "Mepps spinner";
}
$("fMethod").addEventListener("change", updateFlyLabel);
function fillForOptions(){
  const fr = friendsList();
  $("fFor").innerHTML = `<option value="">Mine</option>` + fr.map(f => `<option value="${esc(f.id)}">${esc(f.name)}'s fish</option>`).join("");
  $("fForRow").hidden = !!editing || !fr.length;
}

/* ---------- titles and badges, worked out from your own catches ---------- */
const sameSp = (c, list) => c.species && list.some(s => c.species.toLowerCase() === s.toLowerCase());
const BASS = ["Smallmouth bass","Largemouth bass"], PANFISH = ["Bluegill","Pumpkinseed","Crappie","Black crappie","White crappie","Yellow perch","Rock bass","Sunfish","Green sunfish"];
const TROUT_ALL = ["Brook trout","Brown trout","Rainbow trout","Tiger trout","Steelhead","Lake trout","Splake"];
const nSp = (cs, list) => cs.filter(c => sameSp(c, list)).reduce((a, c) => a + fishOf(c), 0);
const BADGES = [
  { id:"first", name:"First Fish", desc:"Log your first fish.", goal:1, val:s => s.fish },
  { id:"ten", name:"Double Digits", desc:"Log 10 fish.", goal:10, val:s => s.fish },
  { id:"fifty", name:"Fifty Fish", desc:"Log 50 fish.", goal:50, val:s => s.fish },
  { id:"century", name:"Century Club", desc:"Log 100 fish.", goal:100, val:s => s.fish },
  { id:"brookie", name:"Brookie Hunter", desc:"Catch 10 brook trout.", goal:10, val:s => nSp(s.cs, ["Brook trout"]) },
  { id:"brown", name:"Brown Hound", desc:"Catch 10 brown trout.", goal:10, val:s => nSp(s.cs, ["Brown trout"]) },
  { id:"rainbow", name:"Rainbow Chaser", desc:"Catch 10 rainbow trout.", goal:10, val:s => nSp(s.cs, ["Rainbow trout","Steelhead"]) },
  { id:"bass", name:"Bass Master", desc:"Catch 10 bass.", goal:10, val:s => nSp(s.cs, BASS) },
  { id:"walleye", name:"Walleye Whisperer", desc:"Catch 10 walleye.", goal:10, val:s => nSp(s.cs, ["Walleye","Sauger"]) },
  { id:"pike", name:"Pike Patrol", desc:"Catch 5 northern pike.", goal:5, val:s => nSp(s.cs, ["Northern pike"]) },
  { id:"musky", name:"Fish of 10,000 Casts", desc:"Catch a musky.", goal:1, val:s => nSp(s.cs, ["Musky","Muskellunge"]) },
  { id:"panfish", name:"Panfish Pro", desc:"Catch 25 panfish.", goal:25, val:s => nSp(s.cs, PANFISH) },
  ...[["brookie", "Brookie", ["Brook trout"]], ["brown", "Brown Trout", ["Brown trout"]], ["rainbow", "Rainbow", ["Rainbow trout","Steelhead"]], ["bass", "Bass", BASS], ["walleye", "Walleye", ["Walleye","Sauger"]]]
    .flatMap(([k, label, list]) => [[25, "Regular"], [50, "Fanatic"], [100, "Legend"]].map(([n, word]) => ({ id:k + n, name:`${label} ${word}`, desc:`Catch ${n} ${k === "brookie" ? "brook trout" : k === "bass" ? "bass" : k === "walleye" ? "walleye" : list[0].toLowerCase()}.`, goal:n, val:s => nSp(s.cs, list) }))),
  { id:"pike25", name:"Pike Regular", desc:"Catch 25 northern pike.", goal:25, val:s => nSp(s.cs, ["Northern pike"]) },
  { id:"panfish50", name:"Panfish Fanatic", desc:"Catch 50 panfish.", goal:50, val:s => nSp(s.cs, PANFISH) },
  { id:"panfish100", name:"Panfish Legend", desc:"Catch 100 panfish.", goal:100, val:s => nSp(s.cs, PANFISH) },
  { id:"sturgeon", name:"River Dinosaur", desc:"Catch a sturgeon.", goal:1, val:s => s.cs.some(c => /sturgeon/i.test(c.species || "")) ? 1 : 0 },
  { id:"steelhead", name:"Chrome Chaser", desc:"Catch a steelhead.", goal:1, val:s => s.cs.some(c => /steelhead/i.test(c.species || "")) ? 1 : 0 },
  { id:"waters5", name:"Water Wanderer", desc:"Catch fish in 5 different creeks, rivers or lakes.", goal:5, val:s => s.waters },
  { id:"waters10", name:"Creek Collector", desc:"Catch fish in 10 different waters.", goal:10, val:s => s.waters },
  { id:"waters25", name:"Watershed Rambler", desc:"Catch fish in 25 different waters.", goal:25, val:s => s.waters },
  { id:"waters50", name:"Every Bend", desc:"Catch fish in 50 different waters.", goal:50, val:s => s.waters },
  { id:"twenty", name:"Twenty-Incher", desc:"Land a trout 20 inches or longer.", goal:1, val:s => s.cs.some(c => sameSp(c, TROUT_ALL) && +c.length_in >= 20) ? 1 : 0 },
  { id:"slam", name:"Driftless Grand Slam", desc:"Brook, brown and rainbow trout on the same day.", goal:1, val:s => s.slam ? 1 : 0 },
  { id:"species5", name:"Species Explorer", desc:"Catch 5 different species.", goal:5, val:s => s.species },
  { id:"counties10", name:"County Collector", desc:"Catch fish in 10 counties.", goal:10, val:s => s.counties },
  { id:"counties72", name:"72 Club", desc:"Catch fish in all 72 counties.", goal:72, val:s => s.counties },
  { id:"trips5", name:"Road Tripper", desc:"Take 5 trips.", goal:5, val:s => s.trips },
  { id:"ice", name:"Hard Water", desc:"Catch a fish ice fishing.", goal:1, val:s => s.cs.some(c => c.method === "ice" && fishOf(c) > 0) ? 1 : 0 }
];
function badgeStats(cs = catches){
  const withFish = cs.filter(c => fishOf(c) > 0 && countsForTitles(c));
  const byDay = {}; withFish.forEach(c => (byDay[c.caught_on] ||= new Set()).add((c.species || "").toLowerCase()));
  return { cs: withFish, fish: withFish.reduce((a, c) => a + fishOf(c), 0),
    species: new Set(withFish.map(c => (c.species || "").toLowerCase()).filter(Boolean)).size,
    counties: new Set(withFish.map(c => c.county).filter(Boolean)).size, trips: trips.length,
    waters: new Set(withFish.filter(c => c.water).map(c => c.water.trim().toLowerCase() + "|" + (c.county || ""))).size,   // the same name in two counties is two waters
    slam: Object.values(byDay).some(s => s.has("brook trout") && s.has("brown trout") && s.has("rainbow trout")) };
}
function badges(cs){ const s = badgeStats(cs); return BADGES.map(b => { const v = Math.min(b.goal, b.val(s)); return { ...b, v, earned: v >= b.goal }; }); }
let titlesAll = false;
function titlesHtml(){
  const list = badges(); const got = list.filter(b => b.earned);
  const focus = new Set((fprefs().targets || []).flatMap(t => TARGET_BADGES[t] || []));
  const next = list.filter(b => !b.earned).sort((a, b) => (focus.has(b.id) - focus.has(a.id)) || (b.v / b.goal - a.v / a.goal)).slice(0, 6);
  const hist = catches.filter(beforeJoin).length;
  return `<h4><span>Titles</span><span>${got.length}/${list.length}</span></h4>
    ${got.length ? `<div class="badges">${got.map(b => `<span class="badge on" title="${esc(b.desc)}"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></span>`).join("")}</div>` : `<p class="muted" style="margin:0 0 8px">Log fish to earn titles like Bass Master and Brookie Hunter.</p>`}
    ${hist ? `<p class="note">${hist} catch${hist === 1 ? "" : "es"} from before you joined Coulee ${hist === 1 ? "is" : "are"} in your log and stats, but titles and friend leaderboards only count fish caught since you joined.</p>` : ""}
    ${titlesAll
      ? `<p class="muted" style="margin:10px 0 6px;font-size:13px">Every title (${list.length - got.length} still to earn)</p><div class="badges">${list.filter(b => !b.earned).map(b => `<span class="badge"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><i style="--p:${Math.round(100 * b.v / b.goal)}%"></i><em>${b.v}/${b.goal}</em></span>`).join("")}</div>`
      : next.length ? `<p class="muted" style="margin:10px 0 6px;font-size:13px">Up next</p><div class="badges">${next.map(b => `<span class="badge"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><i style="--p:${Math.round(100 * b.v / b.goal)}%"></i><em>${b.v}/${b.goal}</em></span>`).join("")}</div>` : ""}
    <button class="link" type="button" data-a="alltitles" style="margin-top:6px">${titlesAll ? "Show just what's up next" : `See all ${list.length} titles`}</button>`;
}
function titlePickerHtml(){
  const got = badges().filter(b => b.earned);
  if(!got.length) return "";
  return `<div class="field" style="margin-top:10px"><label for="meTitle">Title shown with your name</label>
    <select id="meTitle"><option value="">None</option>${got.map(b => `<option ${profile?.title === b.name ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>`;
}
$("log").addEventListener("change", async e => {
  if(e.target.id !== "meTitle") return;
  const title = e.target.value || null;
  const { error } = await sb.from("profiles").update({ title }).eq("id", me.id);
  if(error){ toast("Couldn't save your title."); return; }
  profile = { ...profile, title }; saveCache(); toast(title ? `Now showing "${title}"` : "Title removed");
});

/* ---------- celebrate a new catch ---------- */
const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function celebrate(rec, before){
  const lines = [];
  if(rec.species && rec.length_in != null){
    const prev = before.filter(c => c.species && c.species.toLowerCase() === rec.species.toLowerCase() && c.length_in != null);
    if(prev.length && +rec.length_in > Math.max(...prev.map(c => +c.length_in))) lines.push(`New personal best ${rec.species.toLowerCase()}!`);
  }
  const had = new Set(badges(before).filter(b => b.earned).map(b => b.id));
  const fresh = badges().filter(b => b.earned && !had.has(b.id));
  if(rec.lat != null && !calm()){
    const m = L.marker([rec.lat, rec.lng], { interactive:false, keyboard:false, icon:L.divIcon({ className:"", html:`<div class="splash"><i></i><i></i><i></i></div>`, iconSize:[0,0] }) }).addTo(map);
    setTimeout(() => map.removeLayer(m), 1900);
  }
  if(!lines.length && !fresh.length) return;
  const el = $("cheer");
  el.innerHTML = `${fresh.length ? `<small>Title earned</small><b>${esc(fresh.map(b => b.name).join(" · "))}</b>` : ""}${lines.map(l => `<span>${esc(l)}</span>`).join("")}`;
  el.hidden = false; el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
  clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, calm() ? 3000 : 3600);
}

/* ---------- log a fish for a friend ---------- */
async function sendGift(rec, blob, friendId){
  if(!navigator.onLine) throw Object.assign(new Error("offline"), { userMessage:"Logging a friend's fish needs a connection. Try again when you have signal." });
  let photo_path = null;
  if(blob){
    photo_path = `${me.id}/gift-${uuid()}.jpg`;
    const up = await sb.storage.from("photos").upload(photo_path, blob, { contentType:"image/jpeg" });
    if(up.error) throw up.error;
  }
  const catch_ = { species:rec.species, length_in:rec.length_in, count:rec.count, fly:rec.fly, method:rec.method, caught_on:rec.caught_on,
    lat:rec.lat, lng:rec.lng, county:rec.county, notes:rec.notes, photo_taken_on:rec.photo_taken_on, photo_hash:rec.photo_hash, photo_meta:rec.photo_meta, water:rec.water };
  const { error } = await sb.from("catch_gifts").insert({ from_user:me.id, to_user:friendId, catch:catch_, photo_path });
  if(error){ if(photo_path) sb.storage.from("photos").remove([photo_path]); throw error; }
}
let gifts = [], notices = [];
async function loadInbox(){
  if(!me || !navigator.onLine) return;
  const [g, n] = await Promise.all([
    sb.from("catch_gifts").select("*").eq("to_user", me.id).eq("status", "pending").order("created_at", { ascending:false }),
    sb.from("notices").select("*").order("created_at", { ascending:false }).limit(40)
  ]);
  if(!g.error) gifts = g.data || [];
  if(!n.error) notices = n.data || [];
  if(gifts.length){ const ids = gifts.map(x => x.from_user).filter(id => !people[id]); if(ids.length) loadAvatars(ids); }
  renderLog();
}
const giftFrom = g => people[g.from_user]?.display_name || "A friend";
function inboxHtml(){
  const other = notices.filter(n => !n.kind.startsWith("tourney") && n.kind !== "gift");
  if(!gifts.length && !other.length) return "";
  return `${gifts.map(g => { const c = g.catch || {};
      return `<div class="card gift"><div class="acct-h">${avHtml(g.from_user, giftFrom(g))}<span class="t"><b class="wrap">${esc(giftFrom(g))} logged a fish for you</b><small>${esc([c.species || "Fish", c.length_in ? lenTxt(c.length_in) : "", c.caught_on ? fmtDate(c.caught_on) : "", c.county ? countyName(c.county) : "", METHODS[c.method] || ""].filter(Boolean).join(" · "))}</small></span></div>
        ${g.photo_path ? phImg(g.photo_path, `class="gph" data-giftphoto="${esc(g.photo_path)}" alt="Photo of the fish"`) : ""}
        <div class="row2"><button class="btn sm ink" type="button" data-giftyes="${esc(g.id)}">Add to my log</button><button class="btn sm" type="button" data-giftno="${esc(g.id)}">Not mine</button></div></div>`; }).join("")}
    ${other.slice(0, 5).map(n => `<div class="card notice slim"><p><b>${esc(n.title)}</b></p>${n.body ? `<p class="muted">${esc(n.body)}</p>` : ""}<button class="link" type="button" data-noticex="${esc(n.id)}">Dismiss</button></div>`).join("")}`;
}
async function giftPhotoBlob(path){
  const { data, error } = await sb.storage.from("photos").download(path);
  if(error) throw error; return data;
}
$("log").addEventListener("click", async e => {
  const yes = e.target.closest("[data-giftyes]"), no = e.target.closest("[data-giftno]"), x = e.target.closest("[data-noticex]");
  if(x){ notices = notices.filter(n => n.id !== x.dataset.noticex); renderLog(); sb.from("notices").delete().eq("id", x.dataset.noticex); return; }
  if(!yes && !no) return;
  const g = gifts.find(z => z.id === (yes || no).dataset[yes ? "giftyes" : "giftno"]); if(!g) return;
  (yes || no).disabled = true;
  try{
    if(no){ await sb.rpc("decline_gift", { gid:g.id }); toast("Removed."); }
    else{
      let path = null;
      if(g.photo_path){ const blob = await giftPhotoBlob(g.photo_path); path = `${me.id}/${uuid()}-${Date.now()}.jpg`;
        const up = await sb.storage.from("photos").upload(path, blob, { contentType:"image/jpeg" }); if(up.error) throw up.error; }
      const before = catches.slice();
      const { data:cid, error } = await sb.rpc("accept_gift", { gid:g.id, new_photo_path:path, vis:"county" });
      if(error){ if(path) sb.storage.from("photos").remove([path]); throw error; }
      const c = g.catch || {};
      const rec = { id:cid, user_id:me.id, ...c, length_in:c.length_in != null ? +c.length_in : null, count:+c.count || 1, photo_path:path, visibility:"county", created_at:new Date().toISOString() };
      catches = [...catches, rec]; saveCache();
      sb.rpc("auto_enter", { cid }).then(({ data }) => { if(data && data.length){ toast(`Entered in ${data.join(", ")}`); loadTournaments(); } });
      toast("Added to your log. It's set to County only; edit it to change that."); celebrate(rec, before);
    }
    gifts = gifts.filter(z => z.id !== g.id);
    const n = notices.find(z => z.kind === "gift" && z.ref === g.id); if(n){ notices = notices.filter(z => z !== n); sb.from("notices").delete().eq("id", n.id); }
    renderAll();
  }catch(err){ console.error(err); toast(err.message && /handled|cancelled/.test(err.message) ? err.message : "Couldn't do that. Try again."); (yes || no).disabled = false; }
});

/* ---------- tournament updates, owner edits, suggestions ---------- */
function tourneyNoticesHtml(){
  const list = notices.filter(n => n.kind.startsWith("tourney")).slice(0, 8);
  if(!list.length) return "";
  return `<h4><span>Updates</span><span>${list.filter(n => !n.read).length || ""}</span></h4><div class="stack">${list.map(n => `<div class="card notice slim${n.read ? " read" : ""}">
    <p><b>${esc(n.title)}</b> <small class="muted">${esc(fmtDate(n.created_at.slice(0, 10)))}</small></p>${n.body ? `<p>${esc(n.body)}</p>` : ""}
    <div class="row2">${n.ref && tournaments.some(t => t.id === n.ref) ? `<button class="link" type="button" data-tourney="${esc(n.ref)}">Open tournament</button>` : ""}<button class="link" type="button" data-noticex="${esc(n.id)}">Dismiss</button></div></div>`).join("")}</div>`;
}
function markTourneyNoticesRead(){
  const ids = notices.filter(n => n.kind.startsWith("tourney") && !n.read).map(n => n.id);
  if(!ids.length) return;
  setTimeout(() => { notices.forEach(n => { if(ids.includes(n.id)) n.read = true; }); sb.from("notices").update({ read:true }).in("id", ids); $("tDot").hidden = !tournaments.some(t => t.my_status === "invited"); }, 1500);
}
function tourneyToolsHtml(t){
  const isOwner = t.owner === me?.id, joined = t.my_status === "joined", over = tState(t) === "finished";
  let h = "";
  if(isOwner) h += `<button class="btn sm" type="button" data-a="tedit">Edit details</button>`;
  else if(joined) h += `<button class="btn sm" type="button" data-a="tsuggest">Suggest a change</button>`;
  return (h ? `<div class="row2" style="margin-top:10px">${h}</div>` : "") + `<div data-tedit></div>`
    + (over ? `<p class="note">${isOwner ? "This tournament is over. You can still fix the details or remove entries; members are told about every change." : "This tournament is over, so entries are locked. Only its creator can change it, and you'll be told if they do."}</p>` : "");
}
$("log").addEventListener("click", async e => {
  const a = e.target.closest("[data-a]"); const t = tournaments.find(x => x.id === tourneyOpen);
  const rm = e.target.closest("[data-townerrm]");
  if(rm && t){ const slot = rm.closest("li").querySelector("[data-rmslot]") || rm.parentElement;
    slot.innerHTML = `<span class="row2"><input data-rmwhy placeholder="Reason (they'll see it)" maxlength="200" style="min-width:140px"><button class="link danger" type="button" data-townerrmyes="${esc(rm.dataset.townerrm)}">Remove</button></span>`; return; }
  const rmy = e.target.closest("[data-townerrmyes]");
  if(rmy && t){ const why = rmy.parentElement.querySelector("[data-rmwhy]")?.value.trim() || null;
    const { error } = await sb.rpc("owner_remove_entry", { tid:t.id, cid:rmy.dataset.townerrmyes, reason:why });
    toast(error ? (error.message || "Couldn't remove it.") : "Entry removed. The angler was told."); openTourney(t.id); loadTournaments(); return; }
  if(!a || !t) return;
  const slot = $("log").querySelector("[data-tedit]");
  if(a.dataset.a === "tedit" && slot){
    slot.innerHTML = `<form class="card" id="teditForm" novalidate style="margin-top:8px">
      <div class="field"><label for="teName">Name</label><input id="teName" maxlength="80" value="${esc(t.name)}"></div>
      <div class="field"><label for="teDesc">Description</label><textarea id="teDesc" maxlength="1000">${esc(t.description || "")}</textarea></div>
      <div class="grid2"><div class="field"><label for="teStart">Starts</label><input id="teStart" type="date" value="${esc(t.starts_on)}"></div><div class="field"><label for="teEnd">Ends</label><input id="teEnd" type="date" value="${esc(t.ends_on)}"></div></div>
      <p class="muted" style="font-size:13px">Members get a notice describing what you changed.</p>
      <span class="hint" id="teErr" role="alert"></span>
      <div class="actions"><button class="btn" type="button" data-a="teditno">Cancel</button><button class="btn ink" type="submit">Save changes</button></div></form>`;
    $("teditForm").addEventListener("submit", async ev => {
      ev.preventDefault(); const err = $("teErr"); err.className = "hint bad";
      const name = $("teName").value.trim(), s = $("teStart").value, en = $("teEnd").value;
      if(name.length < 2){ err.textContent = "Give it a name."; return; }
      if(!s || !en || en < s){ err.textContent = "Check the dates."; return; }
      const { error } = await sb.from("tournaments").update({ name, description:$("teDesc").value.trim() || null, starts_on:s, ends_on:en }).eq("id", t.id);
      if(error){ err.textContent = "Couldn't save. Try again."; return; }
      toast("Saved. Members were told what changed."); await loadTournaments(); openTourney(t.id);
    });
  }
  if(a.dataset.a === "teditno" && slot) slot.innerHTML = "";
  if(a.dataset.a === "tsuggest" && slot){
    slot.innerHTML = `<form class="card" id="tsugForm" novalidate style="margin-top:8px"><div class="field"><label for="tsBody">What should change?</label><textarea id="tsBody" maxlength="1000" placeholder="My 18-inch brown from Saturday is missing"></textarea></div>
      <span class="hint" id="tsErr" role="alert"></span><div class="actions"><button class="btn" type="button" data-a="teditno">Cancel</button><button class="btn ink" type="submit">Send to ${esc(t.owner_name)}</button></div></form>`;
    $("tsugForm").addEventListener("submit", async ev => {
      ev.preventDefault(); const body = $("tsBody").value.trim();
      const { error } = await sb.rpc("suggest_tournament_change", { tid:t.id, body });
      if(error){ $("tsErr").className = "hint bad"; $("tsErr").textContent = error.message || "Couldn't send it."; return; }
      slot.innerHTML = ""; toast(`Sent to ${t.owner_name}.`);
    });
  }
});

/* ---------- trip plans ---------- */
const DNR = {
  trout:["DNR trout regulations", "https://dnr.wisconsin.gov/topic/fishing/regulations/troutregs.html"],
  streams:["DNR trout stream maps", "https://dnr.wisconsin.gov/topic/fishing/trout/streammaps.html"],
  lakes:["DNR Lake Pages", "https://apps.dnr.wi.gov/lakes/lakepages/Search.aspx"],
  regs:["DNR fishing regulations", "https://dnr.wisconsin.gov/topic/fishing/regulations/hookline.html"]
};
function dnrLinks(kind, trout){
  const l = trout ? [DNR.trout, DNR.streams] : /lake|flowage|pond/i.test(kind || "") ? [DNR.lakes, DNR.regs] : [DNR.regs];
  return l.map(([t, u]) => `<a class="link" href="${u}" target="_blank" rel="noopener">${t}</a>`).join("");
}
let pendingPlanWater = null;
function planChooserHtml(w){
  const today = todayStr();
  const up = trips.filter(t => t.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  return `<div class="planpick"><p style="margin:0 0 6px"><b>Add ${esc(w.name)} to a trip</b></p>
    ${up.map(t => `<button class="btn sm" type="button" data-planto="${esc(t.id)}">${esc(t.name)} · ${esc(fmtRange(t.start_date, t.end_date))}</button>`).join("")}
    <button class="btn sm ink" type="button" data-planto="new">${icon("i-plus")}New trip</button></div>`;
}
function addWaterToTrip(t, w){
  const list = Array.isArray(t.waters) ? t.waters.slice() : [];
  if(list.some(x => x.name === w.name && x.county === w.county)){ toast(`${w.name} is already on that trip.`); return; }
  list.push(w);
  saveRecord("trips", { ...t, waters:list }, null, true);
  toast(`Added ${w.name} to ${t.name}.`);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-planto]"); if(!b || !pendingPlanWater) return;
  map.closePopup();
  const w = pendingPlanWater;
  if(b.dataset.planto === "new"){ openTripForm(null); $("tName").value = `${w.name} trip`; return; }
  const t = trips.find(x => x.id === b.dataset.planto); if(t){ addWaterToTrip(t, w); pendingPlanWater = null; }
});
function tripPlanHtml(t){
  const ws = Array.isArray(t.waters) ? t.waters : [];
  if(!ws.length) return t.end_date >= todayStr() ? `<p class="note">Plan this trip: tap a creek or lake on the map and choose <b>Plan a trip</b>.</p>` : "";
  return `<h4><span>Planned water</span><span>${ws.length}</span></h4><ul class="list">${ws.map((w, i) => `<li class="item planw" style="cursor:default;grid-template-columns:1fr auto">
    <span class="t"><b class="wrap">${esc(w.name)}</b><small>${esc([w.kind, w.trout, w.county ? countyName(w.county) : ""].filter(Boolean).join(" · "))}</small>
      <span class="row2 links">${w.lat != null ? `<a class="link" href="${gmaps(w.lat, w.lng)}" target="_blank" rel="noopener">Directions</a><button class="link" type="button" data-planshow="${i}">Show on map</button>` : ""}${dnrLinks(w.kind, w.trout)}</span></span>
    <button class="link danger" type="button" data-planrm="${i}">Remove</button></li>`).join("")}</ul>
    <p class="note">Tap any creek or lake and choose <b>Plan a trip</b> to add more. Check the DNR regulations for each water before you go.</p>`;
}
$("log").addEventListener("click", e => {
  const t = trips.find(x => x.id === tripOpen); if(!t) return;
  const rm = e.target.closest("[data-planrm]");
  if(rm){ const list = (t.waters || []).filter((_, i) => i !== +rm.dataset.planrm); saveRecord("trips", { ...t, waters:list }, null, true); return; }
  const sh = e.target.closest("[data-planshow]");
  if(sh){ const w = (t.waters || [])[+sh.dataset.planshow]; if(!w) return;
    if(w.county && currentCounty !== w.county){ currentCounty = w.county; $("backBtn").hidden = false; setMask(w.county); showDetail(w.county); countyLayer.setStyle(countyStyle); }
    map.flyTo([w.lat, w.lng], 14, { duration:.6 }); }
});

/* ---------- catches outside Wisconsin ---------- */
const NEIGHBOR_POLYS = (GEO.neighbors.features || []).map(f => {
  const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const hit = NEIGHBOR_NAMES.find(([, la, ln]) => polys.some(p => inPoly(ln, la, p)));
  return { name: hit ? hit[0][0] + hit[0].slice(1).toLowerCase() : null, polys };
}).filter(x => x.name);
function stateAt(lat, lng){
  if(lat == null) return null;
  if(countyAt(lat, lng)) return "Wisconsin";
  const n = NEIGHBOR_POLYS.find(x => x.polys.some(p => inPoly(lng, lat, p)));
  return n ? n.name : "Somewhere else";
}
function outsideHtml(){
  const out = catches.filter(c => !c.county && c.lat != null);
  if(!out.length) return "";
  const by = {}; out.forEach(c => (by[stateAt(c.lat, c.lng)] ||= []).push(c));
  return `<h4><span>Outside Wisconsin</span><span>${out.reduce((a, c) => a + fishOf(c), 0)} fish</span></h4>
    ${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([st, cs]) => `<p class="muted" style="margin:8px 0 4px;font-weight:700">${esc(st)}</p><ul class="list">${cs.sort(byDateDesc).map(itemCatch).join("")}</ul>`).join("")}
    <p class="note">These are saved with their exact location. When Coulee adds more states, they'll file into the right state and county on their own.</p>`;
}

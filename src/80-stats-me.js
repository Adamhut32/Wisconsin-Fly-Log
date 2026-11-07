
/* ---------- stats ---------- */
let statYear = lsGet("fl.statYear", "all");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function renderStatsTab(el){
  const years = [...new Set(catches.map(c => (c.caught_on||"").slice(0,4)).filter(Boolean))].sort().reverse();
  if(statYear !== "all" && !years.includes(statYear)) statYear = "all";
  const cs = catches.filter(c => statYear === "all" || (c.caught_on||"").startsWith(statYear));
  const withFish = cs.filter(c => fishOf(c) > 0);
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const days = new Set(cs.map(c=>c.caught_on)).size;
  const species = {}; const flies = {}; const months = Array(12).fill(0); const flyMonth = {};
  for(const c of withFish){
    const n = fishOf(c), m = +(c.caught_on||"0000-01").slice(5,7) - 1; months[m] += n;
    if(c.species){ const s = species[c.species] ||= { n:0, big:null }; s.n += n; if(c.length_in != null && (!s.big || +c.length_in > +s.big.length_in)) s.big = c; }
    if(c.fly){ const f = flies[c.fly] ||= { n:0, months:Array(12).fill(0) }; f.n += n; f.months[m] += n; (flyMonth[m] ||= {})[c.fly] = ((flyMonth[m] ||= {})[c.fly] || 0) + n; }
  }
  const max = Math.max(1, ...months);
  const W = 320, H = 130, bw = W/12;
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H+18}" role="img" aria-label="Fish caught by month"><title>Fish caught by month</title>
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)" stroke-width="1"/>
    ${months.map((v,i) => { const h = Math.round((v/max)*(H-16)); return `<rect x="${i*bw+4}" y="${H-h}" width="${bw-8}" height="${h}" rx="2" fill="${v?"var(--fish)":"var(--line)"}"/>${v?`<text x="${i*bw+bw/2}" y="${H-h-4}" text-anchor="middle">${v}</text>`:""}<text x="${i*bw+bw/2}" y="${H+13}" text-anchor="middle">${MON[i][0]}</text>`; }).join("")}</svg>`;
  const sp = Object.entries(species).sort((a,b)=>b[1].n-a[1].n);
  const fl = Object.entries(flies).sort((a,b)=>b[1].n-a[1].n).slice(0, 12);
  const bestByMonth = Object.entries(flyMonth).map(([m, o]) => [+m, Object.entries(o).sort((a,b)=>b[1]-a[1])[0]]).sort((a,b)=>a[0]-b[0]);
  const st = { want:0, scouted:0, fished:0 }; spots.forEach(s => st[s.status] = (st[s.status]||0) + 1);
  const tripCount = trips.filter(t => statYear === "all" || t.start_date.startsWith(statYear) || t.end_date.startsWith(statYear)).length;
  el.innerHTML = `<div class="eyebrow">Stats</div><h2>${statYear === "all" ? "All time" : statYear}</h2>
    <div class="yearsel"><button type="button" data-year="all" aria-pressed="${statYear==="all"}">All time</button>${years.map(y => `<button type="button" data-year="${y}" aria-pressed="${statYear===y}">${y}</button>`).join("")}</div>
    <div class="stats four"><div class="stat f"><b>${fish}</b><span>fish</span></div><div class="stat"><b>${days}</b><span>days fished</span></div><div class="stat"><b>${sp.length}</b><span>species</span></div><div class="stat"><b>${tripCount}</b><span>trips</span></div></div>
    ${cs.length ? `<h4><span>Fish by month</span></h4>${chart}
    <h4><span>Species</span></h4><table class="tbl"><thead><tr><th>Species</th><th class="n">Fish</th><th class="n">Biggest</th></tr></thead><tbody>${sp.map(([k,v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.big ? lenTxt(v.big.length_in) : "–"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Add species to your catches to see them here.</td></tr>`}</tbody></table>
    <h4><span>Flies that worked</span></h4><table class="tbl"><thead><tr><th>Fly</th><th class="n">Fish</th><th class="n">Best month</th></tr></thead><tbody>${fl.map(([k,v]) => { const bm = v.months.indexOf(Math.max(...v.months)); return `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${MON[bm]}</td></tr>`; }).join("") || `<tr><td colspan="3" class="muted">Add the fly to your catches to see what works.</td></tr>`}</tbody></table>
    ${bestByMonth.length ? `<h4><span>Best fly each month</span></h4><ul class="list">${bestByMonth.map(([m, [f, n]]) => `<li class="item" style="grid-template-columns:44px 1fr auto;cursor:default"><span class="muted" style="font-weight:700">${MON[m]}</span><span class="t"><b>${esc(f)}</b></span><span class="num">${n} fish</span></li>`).join("")}</ul>` : ""}
    <h4><span>Spots</span></h4><p style="margin:0"><span class="pill want">${st.want} want to try</span> <span class="pill scouted">${st.scouted} scouted</span> <span class="pill fished">${st.fished} fished</span></p>`
    : `<div class="empty"><b>Nothing to count yet</b>Log a few catches with the species, length and fly, and this page fills in with your best months and flies.</div>`}`;
}
$("log").addEventListener("click", ev => { const y = ev.target.closest("[data-year]"); if(y){ statYear = y.dataset.year; lsSet("fl.statYear", statYear); renderLog(); } });

/* ---------- me ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let meView = "main";
function renderMeTab(el){
  if(meView === "help") return renderHelp(el);
  if(meView === "suggest") return renderSuggest(el);
  if(meView === "creator" && profile?.role === "creator") return renderCreator(el);
  const followers = follows.filter(f => f.direction === "follower").length;
  el.innerHTML = `<div class="eyebrow">Account${profile?.role === "creator" ? ` · <span class="pill open">Founder</span>` : ""}</div><h2>${esc(profile?.display_name || "You")}</h2>
    <p class="muted" style="margin:0 0 12px">${esc(me?.email || "")}</p>
    <form id="nameForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="meName" value="${esc(profile?.display_name || "")}" maxlength="40" aria-label="Your name"><button class="btn" type="submit">Save name</button></form>
    <span class="hint" id="nameMsg" role="alert"></span>
    <div class="row2" style="margin-top:14px">
      <button class="btn sm" type="button" data-me="help">Help</button>
      <button class="btn sm" type="button" data-me="suggest">Suggestions</button>
      <button class="btn sm" type="button" data-a="guide">Setup guide</button>
      ${profile?.role === "creator" ? `<button class="btn sm ink" type="button" data-me="creator">Founder tools</button>` : ""}
    </div>
    <h4><span>Public profile</span><span>${followers} follower${followers===1?"":"s"}</span></h4>
    <div class="card">
      <label class="check"><input type="checkbox" id="mePublic" ${profile?.is_public ? "checked" : ""}> Let anyone find and follow me</label>
      <p class="muted">Followers see the catches you share (County only or Exact spot), the same as friends do. Catches set to Nothing stay private, and following doesn't let anyone into your tournaments or friend list.</p>
      <div class="field"><label for="meBio">Short bio</label><textarea id="meBio" maxlength="280" placeholder="Driftless brown trout nut. Mostly dries.">${esc(profile?.bio || "")}</textarea></div>
      <div class="row2"><button class="btn sm" type="button" data-a="savepublic">Save profile</button><span class="hint" id="pubMsg" role="alert"></span></div>
    </div>
    ${!isStandalone ? `<h4><span>Put it on your home screen</span></h4><div class="card">${isIOS
      ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted">It opens full screen like an app and keeps your counties for offline use.</p>`
      : `<p>In your browser's menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ""}
    ${offlineBlock(null)}
    <h4><span>Your data</span></h4>
    <div class="card"><p>${catches.length} catches, ${spots.length} spots and ${trips.length} trips.</p><div class="row2"><button class="btn sm" type="button" data-a="export">Download a copy</button></div></div>
    <h4><span>Map data</span></h4>
    <p class="muted" style="margin:0">Streams, lakes, trout classes, trout regulations and public lands come from the Wisconsin DNR. Regulations change; check the current DNR rules before you fish.</p>
    <div class="row2" style="margin-top:22px"><button class="btn" type="button" data-a="signout">Sign out</button></div>`;
  $("nameForm").addEventListener("submit", async e => {
    e.preventDefault(); const v = $("meName").value.trim(); const msg = $("nameMsg");
    if(!v){ msg.className = "hint bad"; msg.textContent = "Enter a name."; return; }
    const { error } = await sb.from("profiles").update({ display_name:v }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save your name. Try again."; return; }
    profile = { ...profile, display_name:v }; saveCache(); msg.className = "hint ok"; msg.textContent = "Name saved. Friends will see it on your catches.";
  });
}
const HELP = [
  ["Getting around the map", [
    "Tap a county to zoom in. Every named creek, river and lake appears, with DNR trout classes as colored bands: green for Class I, gold for Class II, rust for Class III.",
    "Tap a creek to see its name, trout class, season status and the nearest DNR regulation. Tap Add as spot to save it.",
    "Green shading is public land: DNR properties, fishing easements, county forests and the national forest. Dashed outlines are easements, where access is usually limited to the stream corridor. Turn it off with the Public land button in the legend.",
    "Search for any creek or lake by name from the box at the top of the map."]],
  ["Logging catches", [
    "Tap Log a catch. Add a photo first; if it has location and date saved in it, they fill in for you.",
    "No location in the photo? Tap Here to use your phone's GPS, or Map to tap the spot.",
    "Friends see shows what others can see: Exact spot, County only, or Nothing.",
    "No signal? Log anyway. The catch is saved on your phone and syncs when you're back in range."]],
  ["Spots", [
    "Spots are water you want to fish. Mark each one Want to try, Scouted or Fished.",
    "Each spot shows when you last fished it and how many fish you've logged there. Pick the spot when you log a catch to connect them."]],
  ["Trips", [
    "Make a trip with first and last days. Any catch logged in those dates joins it automatically.",
    "Each trip shows a recap: fish, species, biggest fish, best fly, photos and a day-by-day list, including days with no fish."]],
  ["Tournaments", [
    "Anyone can start a tournament: pick dates, an area (anywhere, a region, or specific counties), species and scoring, then invite friends.",
    "Catches that fit the rules are entered automatically when you log them. You can also enter or remove catches on the tournament page.",
    "Photo tournaments only accept fish whose photo was taken during the tournament dates. The app reads the date stamp saved in the photo, so take photos with your phone's camera rather than screenshots."]],
  ["Friends and following", [
    "Friends: share your 6-character friend code. Once they accept, you see each other's shared catches, trips and leaderboards, and can invite each other to tournaments.",
    "Following: turn on a public profile in the Me tab to let anyone follow you. You can follow public anglers from Find anglers without their OK. Followers see your shared catches but aren't on your leaderboard."]],
  ["Location not filling in from photos", [
    "On iPhone: Settings → Privacy & Security → Location Services → Camera → While Using the App, with Precise Location on. New photos will then carry their location.",
    "Some ways of choosing a photo strip the location. If it doesn't fill in, tap Here while you're at the spot, or Map."]],
  ["Phone location for the Here button", [
    "When the app asks to use your location, tap Allow.",
    "If you tapped Don't Allow: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App."]],
  ["Install it like an app", [
    "In Safari, tap Share → Add to Home Screen → Add. Open it from the icon from then on.",
    "Updates arrive on their own the next time you open it."]]
];
function renderHelp(el){
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Help</div><h2>How it works</h2>
    ${HELP.map(([h, items]) => `<h4><span>${esc(h)}</span></h4><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}
    <div class="row2" style="margin-top:18px"><button class="btn sm" type="button" data-a="guide">Replay setup guide</button><button class="btn sm" type="button" data-me="suggest">Send a suggestion</button></div>`;
}
const SUG_STATUS = { new:"Received", planned:"Planned", done:"Done", declined:"Not planned" };
function renderSuggest(el){
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Suggestions</div><h2>Send a suggestion</h2>
    <p class="muted" style="margin:4px 0 12px">Ideas, problems, anything. They go straight to the founder of Coulee.</p>
    <form id="sugForm" novalidate>
      <div class="seg" role="group" aria-label="Type" id="sugKind"><button type="button" class="ink" data-k="idea" aria-pressed="true">Idea</button><button type="button" class="ink" data-k="problem" aria-pressed="false">Problem</button><button type="button" class="ink" data-k="other" aria-pressed="false">Other</button></div>
      <div class="field"><label for="sugBody">Your suggestion</label><textarea id="sugBody" maxlength="2000" placeholder="It would help if…" style="min-height:110px"></textarea></div>
      <span class="hint" id="sugMsg" role="alert"></span>
      <div class="actions"><button class="btn ink" type="submit">Send</button></div>
    </form>
    <h4><span>Your suggestions</span><span>${mySuggestions.length}</span></h4>
    ${mySuggestions.length ? `<div class="stack">${mySuggestions.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)} · <span class="pill ${s.status==="done"?"fished":s.status==="planned"?"scouted":""}">${SUG_STATUS[s.status]}</span></p><p>${esc(s.body)}</p>${s.reply?`<p style="border-left:3px solid var(--line);padding-left:10px"><b>Reply:</b> ${esc(s.reply)}</p>`:""}</div>`).join("")}</div>` : `<p class="muted">Nothing sent yet.</p>`}`;
  let kind = "idea";
  $("sugKind").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if(!b) return; kind = b.dataset.k; $("sugKind").querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("sugForm").addEventListener("submit", async e => {
    e.preventDefault(); const body = $("sugBody").value.trim(), msg = $("sugMsg");
    if(body.length < 3){ msg.className = "hint bad"; msg.textContent = "Write a few words first."; return; }
    const { data, error } = await sb.from("suggestions").insert({ kind, body }).select().single();
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't send it. Check your connection and try again."; return; }
    mySuggestions = [data, ...mySuggestions]; toast("Suggestion sent. Thanks!"); renderLog();
  });
}
let creatorData = null;
async function loadCreator(){
  const [o, s, r] = await Promise.all([ sb.rpc("creator_overview"), sb.rpc("all_suggestions"), sb.from("releases").select("*").order("id", { ascending:false }).limit(10) ]);
  creatorData = { o: (o.data || [])[0] || null, s: s.data || [], r: r.data || [] };
  if(tab === "me" && meView === "creator") renderLog();
}
function renderCreator(el){
  if(!creatorData){ el.innerHTML = `<p class="status">Loading creator tools…</p>`; loadCreator(); return; }
  const o = creatorData.o || {};
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Founder</div><h2>Founder tools</h2>
    <div class="stats four"><div class="stat"><b>${o.anglers ?? "–"}</b><span>anglers</span></div><div class="stat f"><b>${o.fish ?? "–"}</b><span>fish logged</span></div><div class="stat"><b>${o.tournaments ?? "–"}</b><span>tournaments</span></div><div class="stat"><b>${o.open_suggestions ?? "–"}</b><span>new suggestions</span></div></div>
    <p class="muted" style="margin:0 0 6px">${o.public_anglers ?? 0} public profiles · ${o.catches ?? 0} catches · ${o.trips ?? 0} trips</p>
    <h4><span>Post an announcement</span></h4>
    <form id="annForm" novalidate><textarea id="annBody" maxlength="1000" placeholder="Opening weekend tournament starts Saturday. Good luck!"></textarea><div class="actions"><button class="btn ink" type="submit">Post to everyone</button></div></form>
    ${announcements.length ? `<ul class="list">${announcements.map(a => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b style="white-space:normal">${esc(a.body)}</b><small>${esc(fmtDate(a.created_at.slice(0,10)))}</small></span><button class="link danger" type="button" data-delann="${esc(a.id)}">Remove</button></li>`).join("")}</ul>` : ""}
    <h4><span>Publish "What's new"</span></h4>
    <p class="muted" style="margin:0 0 6px">Everyone sees this once, the next time they open the app.</p>
    <form id="relForm" novalidate><input id="relTitle" maxlength="80" placeholder="Hatch chart and faster maps" aria-label="Update title">
      <textarea id="relItems" placeholder="One change per line" aria-label="Changes, one per line" style="margin-top:8px;min-height:90px"></textarea>
      <span class="hint" id="relMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Publish update notes</button></div></form>
    ${(creatorData.r || []).length ? `<ul class="list">${creatorData.r.map(r => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b class="wrap">${esc(r.title)}</b><small>${esc(fmtDate(r.published_at.slice(0,10)))} · ${r.items.length} change${r.items.length===1?"":"s"}</small></span><button class="link danger" type="button" data-delrel="${r.id}">Remove</button></li>`).join("")}</ul>` : ""}
    <h4><span>Suggestions inbox</span><span>${creatorData.s.length}</span></h4>
    ${creatorData.s.length ? `<div class="stack">${creatorData.s.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(s.display_name)} · ${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)}</p><p>${esc(s.body)}</p>
      <div class="row2"><select data-sugstatus="${esc(s.id)}" aria-label="Status" style="width:auto">${Object.entries(SUG_STATUS).map(([k,l]) => `<option value="${k}" ${s.status===k?"selected":""}>${l}</option>`).join("")}</select></div>
      <textarea data-sugreply="${esc(s.id)}" placeholder="Reply (the sender sees this)" maxlength="1000">${esc(s.reply || "")}</textarea>
      <div class="row2"><button class="btn sm" type="button" data-sugsave="${esc(s.id)}">Save reply</button><button class="link danger" type="button" data-sugdel="${esc(s.id)}">Delete</button></div></div>`).join("")}</div>` : `<p class="muted">No suggestions yet.</p>`}
    <h4><span>Other founder powers</span></h4>
    <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Feature anglers from Friends → Find anglers. Featured anglers show first with a badge.</li>
      <li>Hide any shared catch from feeds and tournaments with Hide from feeds in the Friends feed.</li>
      <li>Make tournaments open to everyone, and delete any tournament.</li>
    </ul>`;
  $("relForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("relMsg"); msg.className = "hint bad";
    const title = $("relTitle").value.trim(), items = $("relItems").value.split("\n").map(x => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    if(title.length < 2){ msg.textContent = "Add a title."; return; }
    if(!items.length || items.length > 12){ msg.textContent = "Add 1 to 12 changes, one per line."; return; }
    const { error } = await sb.from("releases").insert({ title, items });
    if(error){ msg.textContent = "Couldn't publish it. Try again."; return; }
    toast("Published. Everyone sees it next time they open the app."); loadCreator();
  });
  $("annForm").addEventListener("submit", async e => {
    e.preventDefault(); const body = $("annBody").value.trim(); if(body.length < 2) return;
    const { data, error } = await sb.from("announcements").insert({ body }).select().single();
    if(error){ toast("Couldn't post it."); return; }
    announcements = [data, ...announcements]; toast("Posted. Everyone sees it in their Friends feed."); renderLog();
  });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const mv = t.closest("[data-me]"); if(mv){ meView = mv.dataset.me; if(meView === "creator") creatorData = null; renderLog(); $("log").scrollTop = 0; return; }
  const dr = t.closest("[data-delrel]"); if(dr){ await sb.from("releases").delete().eq("id", +dr.dataset.delrel); loadCreator(); return; }
  const da = t.closest("[data-delann]"); if(da){ await sb.from("announcements").delete().eq("id", da.dataset.delann); announcements = announcements.filter(a => a.id !== da.dataset.delann); renderLog(); return; }
  const ss = t.closest("[data-sugsave]"); if(ss){ const id = ss.dataset.sugsave;
    const status = $("log").querySelector(`[data-sugstatus="${id}"]`).value, reply = $("log").querySelector(`[data-sugreply="${id}"]`).value.trim() || null;
    const { error } = await sb.from("suggestions").update({ status, reply, updated_at:new Date().toISOString() }).eq("id", id);
    toast(error ? "Couldn't save." : "Saved. They'll see it in their Suggestions page."); loadCreator(); return; }
  const sd = t.closest("[data-sugdel]"); if(sd){ await sb.from("suggestions").delete().eq("id", sd.dataset.sugdel); loadCreator(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "guide") openGuide(true);
  if(a.dataset.a === "savepublic"){
    const is_public = $("mePublic").checked, bio = $("meBio").value.trim() || null, msg = $("pubMsg");
    const { error } = await sb.from("profiles").update({ is_public, bio }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save. Try again."; return; }
    profile = { ...profile, is_public, bio }; saveCache(); msg.className = "hint ok"; msg.textContent = is_public ? "Saved. Anyone can now find and follow you." : "Saved. Your profile is private.";
  }
});
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "signout"){
    if(outbox.length){ toast("Some entries haven't synced yet. Get back online first so nothing is lost."); return; }
    await sb.auth.signOut(); location.reload();
  }
  if(a.dataset.a === "export"){
    const blob = new Blob([JSON.stringify({ exported_at:new Date().toISOString(), profile, trips, spots, catches }, null, 2)], { type:"application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `fly-log-${todayStr()}.json`; document.body.appendChild(link); link.click(); link.remove();
  }
});

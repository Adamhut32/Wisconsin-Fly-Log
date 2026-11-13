
/* ---------- stats ---------- */
let statYear = lsGet("fl.statYear", "all");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function renderStatsTab(el){
  const years = [...new Set(catches.map(c => (c.caught_on||"").slice(0,4)).filter(Boolean))].sort().reverse();
  if(statYear !== "all" && !years.includes(statYear)) statYear = "all";
  const inYear = catches.filter(c => statYear === "all" || (c.caught_on||"").startsWith(statYear));
  const cs = inYear.filter(matchStatF);
  const withFish = cs.filter(c => fishOf(c) > 0);
  const fish = cs.reduce((a,c)=>a+fishOf(c),0);
  const days = new Set(cs.map(c=>c.caught_on)).size;
  const species = {}; const flies = {}; const months = Array(12).fill(0); const flyMonth = {};
  for(const c of withFish){
    const n = fishOf(c), m = +(c.caught_on||"0000-01").slice(5,7) - 1; months[m] += n;
    const spn = sentenceCase(c.species);
    if(spn){ const s = species[spn] ||= { n:0, big:null }; s.n += n; if(c.length_in != null && (!s.big || +c.length_in > +s.big.length_in)) s.big = c; }
    const fly = capWords(c.fly);   // "Copper john" and "Copper John" are one fly
    if(fly){ const f = flies[fly] ||= { n:0, months:Array(12).fill(0) }; f.n += n; f.months[m] += n; (flyMonth[m] ||= {})[fly] = ((flyMonth[m] ||= {})[fly] || 0) + n; }
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
    ${statFilterHtml(inYear)}
    ${statFActive() ? "" : `${countdownHtml()}${seasonRecapHtml(statYear === "all" ? String(new Date().getFullYear()) : statYear)}`}
    <div class="stats four"><div class="stat f"><b>${fish}</b><span>fish</span></div><div class="stat"><b>${days}</b><span>days fished</span></div><div class="stat"><b>${sp.length}</b><span>species</span></div><div class="stat"><b>${tripCount}</b><span>trips</span></div></div>
    ${statFActive() ? "" : challengesHtml() + streakHtml() + countyCompletionHtml()}
    ${cs.length ? `<h4><span>Fish by month</span></h4>${chart}
    <h4><span>Species</span></h4><table class="tbl"><thead><tr><th>Species</th><th class="n">Fish</th><th class="n">Biggest</th></tr></thead><tbody>${sp.map(([k,v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.big ? lenTxt(v.big.length_in) : "–"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Add species to your catches to see them here.</td></tr>`}</tbody></table>
    ${(() => { const wt = {}; withFish.forEach(c => { if(c.water){ const k = c.water.toLowerCase(); (wt[k] ||= { name:c.water, n:0, days:new Set(), big:null }); wt[k].n += fishOf(c); wt[k].days.add(c.caught_on); if(c.length_in != null && (!wt[k].big || +c.length_in > +wt[k].big)) wt[k].big = +c.length_in; } });
      const rows = Object.entries(wt).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
      return rows.length ? `<h4><span>Best water</span></h4><table class="tbl"><thead><tr><th>Creek or lake</th><th class="n">Fish</th><th class="n">Days</th><th class="n">Biggest</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td><button class="link" type="button" data-sfwater="${esc(k)}">${esc(v.name)}</button></td><td class="n">${v.n}</td><td class="n">${v.days.size}</td><td class="n">${v.big != null ? lenTxt(v.big) : "–"}</td></tr>`).join("")}</tbody></table>` : ""; })()}
    ${titlesHtml()}
    <h4><span>${cs.some(c => c.method && c.method !== "fly") ? "Flies and lures that worked" : "Flies that worked"}</span></h4><table class="tbl"><thead><tr><th>Fly or lure</th><th class="n">Fish</th><th class="n">Best month</th></tr></thead><tbody>${fl.map(([k,v]) => { const bm = v.months.indexOf(Math.max(...v.months)); return `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${MON[bm]}</td></tr>`; }).join("") || `<tr><td colspan="3" class="muted">Add the fly to your catches to see what works.</td></tr>`}</tbody></table>
    ${bestByMonth.length ? `<h4><span>Best fly each month</span></h4><ul class="list">${bestByMonth.map(([m, [f, n]]) => `<li class="item" style="grid-template-columns:44px 1fr auto;cursor:default"><span class="muted" style="font-weight:700">${MON[m]}</span><span class="t"><b>${esc(f)}</b></span><span class="num">${n} fish</span></li>`).join("")}</ul>` : ""}
    ${statCatchListHtml(cs)}
    ${statFActive() ? "" : `<h4><span>Spots</span></h4><p style="margin:0"><span class="pill want">${st.want} want to try</span> <span class="pill scouted">${st.scouted} scouted</span> <span class="pill fished">${st.fished} fished</span></p>`}`
    : catches.length ? `<div class="empty"><b>No catches match</b>Try a different year, or clear the filters.</div>` : `${titlesHtml()}<div class="empty"><b>Nothing to count yet</b>Log a few catches with the species, length and fly, and this page fills in with your best months and flies.</div>`}`;
  restoreStatFocus();
}
$("log").addEventListener("click", ev => { const y = ev.target.closest("[data-year]"); if(y){ statYear = y.dataset.year; lsSet("fl.statYear", statYear); statShown = 50; renderLog(); } });

/* ---------- filter your catches ---------- */
const STATF0 = { q:"", species:"", method:"", county:"", water:"", trip:"", photo:"", minLen:"", sort:"new" };
let statF = { ...STATF0, ...lsGet("fl.statF", {}) }, statShown = 50, statFOpen = false, statFocus = null;
const SP_GROUPS = { "group:trout":["Brook trout","Brown trout","Rainbow trout","Tiger trout","Steelhead","Lake trout","Splake"], "group:bass":["Smallmouth bass","Largemouth bass"],
  "group:panfish":["Bluegill","Pumpkinseed","Crappie","Black crappie","White crappie","Yellow perch","Rock bass","Sunfish","Green sunfish"] };
const statFActive = () => ["q","species","method","county","water","trip","photo","minLen"].some(k => statF[k]);
function matchStatF(c){
  const f = statF, sp = (c.species || "").toLowerCase();
  if(f.species){ if(f.species === "none"){ if(sp) return false; }
    else if(SP_GROUPS[f.species]){ if(!SP_GROUPS[f.species].some(s => s.toLowerCase() === sp)) return false; }
    else if(sp !== f.species) return false; }
  if(f.method && (c.method || "fly") !== f.method) return false;
  if(f.county){ if(f.county === "out"){ if(c.county) return false; } else if(c.county !== f.county) return false; }
  if(f.water && (c.water || "").toLowerCase() !== f.water) return false;
  if(f.trip){ if(f.trip === "none"){ if(c.trip_id) return false; } else if(c.trip_id !== f.trip) return false; }
  if(f.photo === "yes" && !c.photo_path) return false;
  if(f.photo === "no" && c.photo_path) return false;
  if(f.minLen && !(+c.length_in >= +f.minLen)) return false;
  if(f.q){ const hay = [c.species, c.water, c.fly, c.notes, c.county ? countyName(c.county) : "", METHODS[c.method || "fly"], trips.find(t => t.id === c.trip_id)?.name].join(" ").toLowerCase();
    if(!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false; }
  return true;
}
function statFilterHtml(pool){
  const spMap = {}; pool.forEach(c => { const k = (c.species || "").toLowerCase(); if(k && !spMap[k]) spMap[k] = c.species; });
  const sps = Object.entries(spMap).sort((a, b) => a[1].localeCompare(b[1]));
  const methods = [...new Set(pool.map(c => c.method || "fly"))];
  const cids = [...new Set(pool.map(c => c.county).filter(Boolean))].sort((a, b) => countyName(a).localeCompare(countyName(b)));
  const wMap = {}; pool.forEach(c => { const k = (c.water || "").toLowerCase(); if(k && !wMap[k]) wMap[k] = c.water; });
  const ws = Object.entries(wMap).sort((a, b) => a[1].localeCompare(b[1]));
  const tr = trips.filter(t => pool.some(c => c.trip_id === t.id)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
  const chips = [];
  if(statF.q) chips.push(["q", `"${statF.q}"`]);
  if(statF.species) chips.push(["species", { "group:trout":"All trout", "group:bass":"All bass", "group:panfish":"All panfish", none:"No species" }[statF.species] || spMap[statF.species] || statF.species]);
  if(statF.method) chips.push(["method", METHODS[statF.method]]);
  if(statF.county) chips.push(["county", statF.county === "out" ? "Outside Wisconsin" : countyName(statF.county)]);
  if(statF.water) chips.push(["water", wMap[statF.water] || statF.water]);
  if(statF.trip) chips.push(["trip", statF.trip === "none" ? "Not on a trip" : (trips.find(t => t.id === statF.trip)?.name || "Trip")]);
  if(statF.photo) chips.push(["photo", statF.photo === "yes" ? "With photo" : "No photo"]);
  if(statF.minLen) chips.push(["minLen", `${statF.minLen}"+`]);
  return `<div class="statf">
    <div class="row2" style="flex-wrap:nowrap"><input id="sfQ" type="search" placeholder="Search creek, fly, notes…" aria-label="Search your catches" value="${esc(statF.q)}" autocomplete="off">
      <button class="btn sm${statFOpen || statFActive() ? " ink" : ""}" type="button" data-sf="toggle" aria-expanded="${statFOpen}">Filters${chips.filter(c => c[0] !== "q").length ? ` (${chips.filter(c => c[0] !== "q").length})` : ""}</button></div>
    ${statFOpen ? `<div class="sfgrid">
      <div class="field"><label for="sfSpecies">Species</label><select id="sfSpecies" data-sfk="species">${opt("", "All species", statF.species)}${opt("group:trout", "All trout", statF.species)}${opt("group:bass", "All bass", statF.species)}${opt("group:panfish", "All panfish", statF.species)}${sps.map(([k, l]) => opt(k, l, statF.species)).join("")}${opt("none", "No species", statF.species)}</select></div>
      <div class="field"><label for="sfMethod">Method</label><select id="sfMethod" data-sfk="method">${opt("", "Any method", statF.method)}${Object.entries(METHODS).filter(([k]) => methods.includes(k) || statF.method === k).map(([k, l]) => opt(k, l, statF.method)).join("")}</select></div>
      <div class="field"><label for="sfCounty">Where</label><select id="sfCounty" data-sfk="county">${opt("", "Anywhere", statF.county)}${cids.map(id => opt(id, countyName(id), statF.county)).join("")}${opt("out", "Outside Wisconsin", statF.county)}</select></div>
      <div class="field"><label for="sfWater">Water</label><select id="sfWater" data-sfk="water">${opt("", "Any water", statF.water)}${ws.map(([k, l]) => opt(k, l, statF.water)).join("")}</select></div>
      <div class="field"><label for="sfTrip">Trip</label><select id="sfTrip" data-sfk="trip">${opt("", "Any trip", statF.trip)}${tr.map(t => opt(t.id, t.name, statF.trip)).join("")}${opt("none", "Not on a trip", statF.trip)}</select></div>
      <div class="field"><label for="sfPhoto">Photo</label><select id="sfPhoto" data-sfk="photo">${opt("", "Any", statF.photo)}${opt("yes", "With photo", statF.photo)}${opt("no", "No photo", statF.photo)}</select></div>
      <div class="field"><label for="sfLen">At least (in)</label><select id="sfLen" data-sfk="minLen">${opt("", "Any length", statF.minLen)}${["10","12","14","16","18","20","24","30","40"].map(v => opt(v, v + " in", statF.minLen)).join("")}</select></div>
    </div>` : ""}
    ${chips.length ? `<div class="sfchips">${chips.map(([k, l]) => `<button type="button" class="pill" data-sfx="${k}" aria-label="Remove filter ${esc(l)}">${esc(l)} ×</button>`).join("")}<button type="button" class="link" data-sf="clear">Clear all</button></div>` : ""}
  </div>`;
}
function statCatchListHtml(cs){
  const sorters = { new:byDateDesc, old:(a, b) => -byDateDesc(a, b), long:(a, b) => (+b.length_in || 0) - (+a.length_in || 0) || byDateDesc(a, b), heavy:(a, b) => (+b.weight_lb || 0) - (+a.weight_lb || 0) || byDateDesc(a, b) };
  const list = cs.slice().sort(sorters[statF.sort] || byDateDesc);
  const fish = list.reduce((a, c) => a + fishOf(c), 0);
  return `<h4 id="statList"><span>${statFActive() ? "Matching catches" : "All your catches"}</span><span>${list.length} · ${fish} fish</span></h4>
    <div class="row2" style="justify-content:space-between;margin-bottom:6px"><select data-sfk="sort" aria-label="Sort" style="width:auto">${[["new","Newest first"],["old","Oldest first"],["long","Longest first"],["heavy","Heaviest first"]].map(([v, l]) => `<option value="${v}" ${statF.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="link" type="button" data-sf="csv">Download these (CSV)</button></div>
    <ul class="list">${list.slice(0, statShown).map(itemCatch).join("")}</ul>
    ${list.length > statShown ? `<button class="btn sm" type="button" data-sf="more" style="margin-top:8px">Show ${Math.min(50, list.length - statShown)} more</button>` : ""}`;
}
function setStatF(k, v){ statF = { ...statF, [k]:v }; lsSet("fl.statF", statF); statShown = 50; renderLog(); }
function restoreStatFocus(){ if(!statFocus) return; const el = $(statFocus.id); if(el){ el.focus({ preventScroll:true }); try{ el.setSelectionRange(statFocus.pos, statFocus.pos); }catch(e){} } statFocus = null; }
let sfT;
$("log").addEventListener("input", e => { if(e.target.id !== "sfQ") return; const v = e.target.value; clearTimeout(sfT);
  sfT = setTimeout(() => { statFocus = { id:"sfQ", pos:e.target.selectionStart }; setStatF("q", v.trim()); }, 250); });
$("log").addEventListener("change", e => { const k = e.target.dataset?.sfk; if(k) setStatF(k, e.target.value); });
$("log").addEventListener("click", e => {
  const x = e.target.closest("[data-sfx]"); if(x){ setStatF(x.dataset.sfx, ""); return; }
  const sw = e.target.closest("[data-sfwater]"); if(sw){ setStatF("water", sw.dataset.sfwater); setTimeout(() => $("statList")?.scrollIntoView({ behavior:"smooth" }), 50); return; }
  const b = e.target.closest("[data-sf]"); if(!b) return;
  if(b.dataset.sf === "toggle"){ statFOpen = !statFOpen; renderLog(); }
  if(b.dataset.sf === "clear"){ statF = { ...STATF0, sort:statF.sort }; lsSet("fl.statF", statF); statShown = 50; renderLog(); }
  if(b.dataset.sf === "more"){ statShown += 50; renderLog(); }
  if(b.dataset.sf === "csv"){
    const cs = catches.filter(c => (statYear === "all" || (c.caught_on || "").startsWith(statYear)) && matchStatF(c)).sort(byDateDesc);
    const q = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const rows = [["Date","Species","Length (in)","Weight (lb)","Fish","Method","Fly or lure","Water","County","Trip","Latitude","Longitude","Notes","Photo"],
      ...cs.map(c => [c.caught_on, c.species, c.length_in, c.weight_lb, fishOf(c), METHODS[c.method || "fly"], c.fly, c.water, c.county ? countyName(c.county) : (c.lat != null ? "Outside Wisconsin" : ""), trips.find(t => t.id === c.trip_id)?.name, c.lat, c.lng, c.notes, c.photo_path ? "yes" : ""])];
    const blob = new Blob([rows.map(r => r.map(q).join(",")).join("\n")], { type:"text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `coulee-catches-${todayStr()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
});

/* ---------- me ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let meView = "main";
function renderMeTab(el){
  if(meView === "help") return renderHelp(el);
  if(meView === "suggest") return renderSuggest(el);
  if(meView === "creator" && isStaff()) return renderCreator(el);
  if(meView === "analytics" && isFounder()) return renderAnalytics(el);
  const followers = follows.filter(f => f.direction === "follower").length;
  el.innerHTML = `<div class="eyebrow">Account${isFounder() ? ` · <span class="pill open">Founder</span>` : profile?.role === "admin" ? ` · <span class="pill scouted">Admin</span>` : ""}${profile?.verified ? ` · <span class="pill fished">Verified</span>` : ""}</div>
    <div class="mehead">${avHtml(me?.id, profile?.display_name, "lg")}<div><h2 style="margin:0">${esc(profile?.display_name || "You")}</h2>
      <p class="muted" style="margin:2px 0 6px">${esc(me?.email || "")}</p>
      <span class="row2"><label class="btn sm" for="avFile">${profile?.avatar_path ? "Change picture" : "Add a picture"}</label><input type="file" id="avFile" accept="image/*" class="vh">${profile?.avatar_path ? `<button class="link danger" type="button" data-a="avremove">Remove</button>` : ""}</span></div></div>
    ${isStaff() && (pendingCount || flagCount || reportOpenCount) ? `<div class="card notice" style="margin:4px 0 12px"><p><b>${[pendingCount ? `${pendingCount} account${pendingCount===1?"":"s"} waiting for approval` : "", reportOpenCount ? `${reportOpenCount} report${reportOpenCount===1?"":"s"}` : "", flagCount ? `${flagCount} catch flag${flagCount===1?"":"s"} to review` : ""].filter(Boolean).join(" · ")}</b></p><div class="row2"><button class="btn sm ink" type="button" data-me="creator">Review</button></div></div>` : ""}
    <form id="nameForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="meName" value="${esc(profile?.display_name || "")}" maxlength="40" aria-label="Your name"><button class="btn" type="submit">Save name</button></form>
    <span class="hint" id="nameMsg" role="alert"></span>
    <div class="row2" style="margin-top:4px"><span class="muted">${profile?.username ? `Username <b style="color:var(--ink)">@${esc(profile.username)}</b>` : "No username yet"}</span><button class="link" type="button" data-a="uname">${profile?.username ? "Change" : "Pick one"}</button></div>${titlePickerHtml()}
    <div class="row2" style="margin-top:14px">
      <button class="btn sm" type="button" data-me="help">Help</button>
      <button class="btn sm" type="button" data-me="suggest">Suggestions</button>
      <button class="btn sm" type="button" data-a="guide">Setup guide</button>
      <button class="btn sm" type="button" data-camhelp>Photo location help</button>
      ${isStaff() ? `<button class="btn sm ink" type="button" data-me="creator">${isFounder() ? "Founder tools" : "Admin tools"}</button>` : ""}
    </div>
    <h4><span>Public profile</span><span>${followers} follower${followers===1?"":"s"}</span></h4>
    <div class="card">
      <label class="check"><input type="checkbox" id="meFindable" ${profile?.findable !== false ? "checked" : ""}> Let people find me by name to send friend requests</label>
      <label class="check"><input type="checkbox" id="mePublic" ${profile?.is_public ? "checked" : ""}> Let anyone find and follow me</label>
      <p class="muted">Followers see the catches you share (County only or Exact spot), the same as friends do. Catches set to Nothing stay private, and following doesn't let anyone into your tournaments or friend list.</p>
      <div class="field"><label for="meBio">Short bio</label><textarea id="meBio" maxlength="280" placeholder="Driftless brown trout nut. Mostly dries.">${esc(profile?.bio || "")}</textarea></div>
      <div class="row2"><button class="btn sm" type="button" data-a="savepublic">Save profile</button><span class="hint" id="pubMsg" role="alert"></span></div>
    </div>
    ${!isStandalone ? `<h4><span>Put it on your home screen</span></h4><div class="card">${isIOS
      ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted">It opens full screen like an app and keeps your counties for offline use.</p>`
      : `<p>In your browser's menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ""}
    ${prefsHtml()}
    ${notifyCardHtml()}
    ${themeHtml()}
    ${offlineBlock(null)}
    ${blockedHtml()}
    <h4><span>Your data</span></h4>
    <div class="card"><p>${catches.length} catches, ${spots.length} spots and ${trips.length} trips.</p><div class="row2"><button class="btn sm" type="button" data-a="export">Download a copy</button></div></div>
    <h4><span>Map data</span></h4>
    <p class="muted" style="margin:0">Streams, lakes, trout classes, trout regulations and public lands come from the Wisconsin DNR. Regulations change; check the current DNR rules before you fish.</p>
    <div class="row2" style="margin-top:22px"><button class="btn" type="button" data-a="signout">Sign out</button></div>
    ${profile?.role === "creator" ? "" : `<div class="row2" style="margin-top:18px"><button class="link danger" type="button" data-a="delacct">Delete my account</button></div><div data-delslot></div>`}`;
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
  ["Any fish, any method", [
    "Pick the method for each catch: Fly, Spinning, Baitcasting, Ice fishing, Trolling or Other. The Fly box becomes Lure or bait for the others.",
    "Species covers trout, bass, walleye, pike, musky, panfish, salmon, catfish and more. Type any other species too.",
    "Catches outside Wisconsin are kept with their exact location in an Outside Wisconsin list on the Log tab. They'll file into the right state when Coulee adds it."]],
  ["Notifications", [
    "On iPhone, open Coulee from its Home Screen icon (iOS 16.4 or newer), then Me → Notifications → Turn on notifications, and tap Allow.",
    "Choose which alerts you want: friend requests, messages, tournament invites and changes, fish logged for you, and forum replies. Turn them off any time in the same place, or in Settings → Notifications → Coulee."]],
  ["Messages", [
    "Message any friend from Friends → Messages, or the Message button next to a friend. Messages are for anglers 16 and older, friends only.",
    "Messages are private. A reviewer only sees one if someone reports it. Block anyone from the chat; they can't message you after that."]],
  ["Forums", [
    "Friends → Forums has boards for regions, fly tying, gear, tournaments and help. Start a thread or reply; you'll get a notification when someone replies to a thread you're in.",
    "Keep exact spots general unless they're public water. Report anything out of line and a moderator will look at it. Bad language is starred out automatically."]],
  ["Map style", [
    "Terrain shading shows coulees and ridges on the map; turn it off with Terrain in the legend. Zoom in close on a trout stream and the water drifts along it.",
    "Me → Appearance switches between Auto, Light and Dark. Dark is easier on the eyes at dawn and dusk."]],
  ["Where am I", [
    "Tap the target button under the zoom buttons to see where you are and which creek you're on, then Add spot here or Log a catch here.",
    "If it says location is off: Settings → Privacy & Security → Location Services → Safari Websites (or Coulee) → While Using the App."]],
  ["Catches from before you joined", [
    "Log as much of your history as you like. Fish caught before you joined are marked Before Coulee: they count in your own stats and log, but not toward titles or friend leaderboards."]],
  ["Finding your catches", [
    "The Stats tab lists every catch. Search by creek, fly or notes, or tap Filters to narrow by species (or all trout, bass or panfish), method, county, water, trip, photo or length. The numbers above the list follow the same filters.",
    "Tap a creek in Best water to see just the fish from there. Download these saves the list as a spreadsheet file."]],
  ["Which creek it was", [
    "When a catch has a location, from the photo, the Here button or the map, Coulee fills in the creek, river or lake it's on if one is within about 650 feet (500 for lakes).",
    "You can change it or type your own. Older catches are filled in automatically when the app opens."]],
  ["Logging a friend's fish", [
    "In Log a catch, change Whose fish? to a friend. They get it in their Log tab and choose Add to my log or Not mine.",
    "It only counts for them once they accept it, so nobody can add fish to someone else's log."]],
  ["Fair play", [
    "Each new photo gets a fingerprint so the same photo can't be entered twice, even resized. Photos with no camera data, or whose date or place doesn't match the catch, are flagged for a person to look at.",
    "Flags are hints, not proof, and nothing is hidden automatically. Only the founder and admins can hide a catch, and the angler gets a notice saying why. Coulee keeps only the distance and date gap from a photo, never the photo's own location."]],
  ["Titles", [
    "Earn titles like Bass Master, Brookie Hunter and Twenty-Incher as you log fish. See them all, with progress, in the Stats tab.",
    "Pick one to show next to your name in the Me tab."]],
  ["Planning a trip", [
    "Tap a creek or lake and choose Plan a trip to add it to an upcoming trip, or start a new one.",
    "Each planned water has directions and links to the DNR regulations, trout stream maps or Lake Pages."]],
  ["Spots", [
    "Spots are water you want to fish. Mark each one Want to try, Scouted or Fished.",
    "Each spot shows when you last fished it and how many fish you've logged there. Pick the spot when you log a catch to connect them."]],
  ["Trips", [
    "Make a trip with first and last days. Any catch logged in those dates joins it automatically.",
    "Each trip shows a recap: fish, species, biggest fish, best fly, photos and a day-by-day list, including days with no fish."]],
  ["Tournaments", [
    "Anyone can start a tournament: pick dates, an area (anywhere, a region, or specific counties), species and scoring, then invite friends.",
    "Catches that fit the rules are entered automatically when you log them. You can also enter or remove catches on the tournament page.",
    "Tournaments can be fly only. After a tournament ends, entries are locked: only its creator can change details or remove entries, and members are told about every change. Use Suggest a change to ask the creator.",
    "Photo tournaments only accept fish whose photo was taken during the tournament dates. The app reads the date stamp saved in the photo, so take photos with your phone's camera rather than screenshots."]],
  ["Friends and following", [
    "Friends: search anglers by name in Friends → People and tap Add friend, or share your 6-character friend code. Once they accept, you see each other's shared catches, trips and leaderboards, and can invite each other to tournaments.",
    "Don't want to be found by name? Turn off \"Let people find me by name\" in the Me tab. Friends can still add you with your code.",
    "Following: turn on a public profile in the Me tab to let anyone follow you. You can follow public anglers from Find anglers without their OK. Followers see your shared catches but aren't on your leaderboard."]],
  ["Location not filling in from photos", [
    "Tap Photo location help in the Me tab for picture-by-picture steps and a quick photo test.",
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
function suggestionsInboxHtml(){
  return `<h4><span>Suggestions inbox</span><span>${creatorData.s.length}</span></h4>
    ${creatorData.s.length ? `<div class="stack">${creatorData.s.map(s => `<div class="card"><p class="muted" style="font-size:12.5px">${esc(s.display_name)} · ${esc(fmtDate(s.created_at.slice(0,10)))} · ${esc(s.kind)}</p><p>${esc(s.body)}</p>${triageHtml(s)}
      <div class="row2"><select data-sugstatus="${esc(s.id)}" aria-label="Status" style="width:auto">${Object.entries(SUG_STATUS).map(([k,l]) => `<option value="${k}" ${s.status===k?"selected":""}>${l}</option>`).join("")}</select></div>
      <textarea data-sugreply="${esc(s.id)}" placeholder="Reply (the sender sees this)" maxlength="1000">${esc(s.reply || "")}</textarea>
      <div class="row2"><button class="btn sm" type="button" data-sugsave="${esc(s.id)}">Save reply</button>${isFounder() ? `<button class="link danger" type="button" data-sugdel="${esc(s.id)}">Delete</button>` : ""}</div></div>`).join("")}</div>` : `<p class="muted">No suggestions yet.</p>`}`;
}
async function loadCreator(){
  const [o, s, r] = await Promise.all([ isFounder() ? sb.rpc("creator_overview") : { data:[] }, sb.rpc("all_suggestions"), sb.from("releases").select("*").order("id", { ascending:false }).limit(10) ]);
  staffList = null;
  creatorData = { o: (o.data || [])[0] || null, s: s.data || [], r: r.data || [] };
  if(tab === "me" && meView === "creator") renderLog();
}
function renderCreator(el){
  if(!creatorData){ el.innerHTML = `<p class="status">Loading tools…</p>`; loadCreator(); return; }
  const o = creatorData.o || {};
  if(!isFounder()){
    el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
      <div class="eyebrow">Admin</div><h2>Admin tools</h2>${channelHtml()}${staffAccountsHtml()}${reportQueueHtml()}${flagQueueHtml()}${suggestionsInboxHtml()}`;
    return;
  }
  el.innerHTML = `<button class="link backlink" data-me="main" type="button">${icon("i-back")}Account</button>
    <div class="eyebrow">Founder</div><h2>Founder tools</h2>
    ${channelHtml()}
    <div class="row2" style="margin:0 0 6px"><button class="btn sm ink" type="button" data-me="analytics">Analytics</button></div>
    ${staffAccountsHtml()}
    ${reportQueueHtml()}
    ${flagQueueHtml()}
    <h4><span>Overview</span></h4>
    <div class="stats four"><div class="stat"><b>${o.anglers ?? "–"}</b><span>anglers</span></div><div class="stat f"><b>${o.fish ?? "–"}</b><span>fish logged</span></div><div class="stat"><b>${o.tournaments ?? "–"}</b><span>tournaments</span></div><div class="stat"><b>${o.open_suggestions ?? "–"}</b><span>new suggestions</span></div></div>
    <p class="muted" style="margin:0 0 6px">${o.public_anglers ?? 0} public profiles · ${o.catches ?? 0} catches · ${o.trips ?? 0} trips</p>
    <h4><span>Post an announcement</span></h4>
    <form id="annForm" novalidate><textarea id="annBody" maxlength="1000" placeholder="Opening weekend tournament starts Saturday. Good luck!"></textarea><div class="actions"><button class="btn ink" type="submit">Post to everyone</button></div></form>
    ${announcements.length ? `<ul class="list">${announcements.map(a => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b style="white-space:normal">${esc(a.body)}</b><small>${esc(fmtDate(a.created_at.slice(0,10)))}</small></span><button class="link danger" type="button" data-delann="${esc(a.id)}">Remove</button></li>`).join("")}</ul>` : ""}
    <h4><span>Publish "What's new"</span></h4>
    <p class="muted" style="margin:0 0 6px">Everyone sees this once, the next time they open the app.</p>
    <form id="relForm" novalidate><input id="relTitle" maxlength="80" placeholder="Hatch chart and faster maps" aria-label="Update title">
      <textarea id="relItems" placeholder="One change per line" aria-label="Changes, one per line" style="margin-top:8px;min-height:90px"></textarea>
      <label class="check"><input type="checkbox" id="relStaff"> Only for founder and admins (tools and behind-the-scenes changes)</label>
      <p class="muted" style="font-size:12.5px;margin:2px 0 0">Keep notes to the big things people will notice. They show to each person once their app has this build (${CFG.build || "?"}).</p>
      <span class="hint" id="relMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Publish update notes</button></div></form>
    ${(creatorData.r || []).length ? `<ul class="list">${creatorData.r.map(r => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b class="wrap">${esc(r.title)}</b><small>${esc(fmtDate(r.published_at.slice(0,10)))} · ${r.items.length} change${r.items.length===1?"":"s"}${r.audience === "staff" ? " · founder & admins only" : ""}${r.build ? ` · build ${r.build}` : ""}</small></span><button class="link danger" type="button" data-delrel="${r.id}">Remove</button></li>`).join("")}</ul>` : ""}
    ${suggestionsInboxHtml()}
    <h4><span>Other founder powers</span></h4>
    <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Feature anglers from Friends → Find anglers. Featured anglers show first with a badge.</li>
      <li>Hide any shared catch from feeds and tournaments with Hide from feeds in the Friends feed.</li>
      <li>Make tournaments open to everyone, and delete any tournament.</li>
      <li>Make someone an Admin or Verified from Accounts above. Admins can approve accounts and answer suggestions.</li>
    </ul>`;
  if(!$("relForm")) return;
  $("relForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("relMsg"); msg.className = "hint bad";
    const title = $("relTitle").value.trim(), items = $("relItems").value.split("\n").map(x => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    if(title.length < 2){ msg.textContent = "Add a title."; return; }
    if(!items.length || items.length > 12){ msg.textContent = "Add 1 to 12 changes, one per line."; return; }
    const { error } = await sb.from("releases").insert({ title, items, build:CFG.build || null, audience: $("relStaff")?.checked ? "staff" : "all" });
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
  const mv = t.closest("[data-me]"); if(mv){ meView = mv.dataset.me; if(meView === "creator"){ creatorData = null; flagList = null; reportList = null; } if(meView === "analytics") statsData = null; renderLog(); $("log").scrollTop = 0; return; }
  const dr = t.closest("[data-delrel]"); if(dr){ await sb.from("releases").delete().eq("id", +dr.dataset.delrel); loadCreator(); return; }
  const da = t.closest("[data-delann]"); if(da){ await sb.from("announcements").delete().eq("id", da.dataset.delann); announcements = announcements.filter(a => a.id !== da.dataset.delann); renderLog(); return; }
  const ss = t.closest("[data-sugsave]"); if(ss){ const id = ss.dataset.sugsave;
    const status = $("log").querySelector(`[data-sugstatus="${id}"]`).value, reply = $("log").querySelector(`[data-sugreply="${id}"]`).value.trim() || null;
    const { error } = await sb.from("suggestions").update({ status, reply, updated_at:new Date().toISOString() }).eq("id", id);
    toast(error ? "Couldn't save." : "Saved. They'll see it in their Suggestions page."); loadCreator(); return; }
  const sd = t.closest("[data-sugdel]"); if(sd){ await sb.from("suggestions").delete().eq("id", sd.dataset.sugdel); loadCreator(); return; }
  const a = t.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "guide") openGuide(true);
  if(a.dataset.a === "alltitles"){ titlesAll = !titlesAll; renderLog(); }
  if(a.dataset.a === "savepublic"){
    const is_public = $("mePublic").checked, findable = $("meFindable").checked, bio = $("meBio").value.trim() || null, msg = $("pubMsg");
    const { error } = await sb.from("profiles").update({ is_public, findable, bio }).eq("id", me.id);
    if(error){ msg.className = "hint bad"; msg.textContent = "Couldn't save. Try again."; return; }
    profile = { ...profile, is_public, findable, bio }; saveCache(); msg.className = "hint ok"; msg.textContent = is_public ? "Saved. Anyone can now find and follow you." : "Saved. Your profile is private.";
  }
});
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "signout"){
    if(outbox.length){ toast("Some entries haven't synced yet. Get back online first so nothing is lost."); return; }
    try{ const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if(sub){ await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } }catch(e){}
    await forgetPhotos(); await sb.auth.signOut(); location.reload();
  }
  if(a.dataset.a === "export"){
    const blob = new Blob([JSON.stringify({ exported_at:new Date().toISOString(), profile, trips, spots, catches }, null, 2)], { type:"application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `fly-log-${todayStr()}.json`; document.body.appendChild(link); link.click(); link.remove();
  }
});


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
function renderMeTab(el){
  el.innerHTML = `<div class="eyebrow">Account</div><h2>${esc(profile?.display_name || "You")}</h2>
    <p class="muted" style="margin:0 0 12px">${esc(me?.email || "")}</p>
    <form id="nameForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="meName" value="${esc(profile?.display_name || "")}" maxlength="40" aria-label="Your name"><button class="btn" type="submit">Save name</button></form>
    <span class="hint" id="nameMsg" role="alert"></span>
    ${!isStandalone ? `<h4><span>Put it on your home screen</span></h4><div class="card">${isIOS
      ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted">It opens full screen like an app and keeps your counties for offline use.</p>`
      : `<p>In your browser's menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ""}
    <h4><span>Offline</span></h4>
    <div class="card"><p>Counties you've opened are saved on this device, so the map and creeks work without signal. Catches you log offline are kept on the phone and sync when you're back in range.</p></div>
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

/* ---------- the season: out-of-season flags, opener countdown, season recap, challenges, streaks,
   county completion, and measuring along a creek ----------
   Everything here is worked out on the phone from your own log; nothing new is stored.
   Only function declarations and `var` at the top level: the log can draw before this file has run. */

/* ----- trout season on the day of a catch ----- */
function isSeasonTrout(sp){ sp = sp || ""; return /trout|brookie|brown|rainbow/i.test(sp) && !/lake trout|steelhead|splake|salmon/i.test(sp); }
function catchSeason(c){
  if(!c || !c.caught_on || !isSeasonTrout(c.species)) return null;
  if(c.county && !/^55/.test(String(c.county))) return null;                  // Wisconsin inland trout only
  let reg = null;
  try{ if(c.lat != null && c.county && troutCache[c.county]) reg = nearestReg(c.water || "", { lat:+c.lat, lng:+c.lng }, c.county); }catch(e){}
  const day = new Date(c.caught_on + "T12:00:00");
  const st = (reg && seasonStatus(reg, day)) || seasonStatus(GENERAL_REG, day);
  return st && st.kind !== "open" ? { kind:st.kind, special:!!reg } : null;
}
function seasonPill(c){
  const s = catchSeason(c); if(!s) return "";
  return s.kind === "early" ? ` <span class="pill early" title="Early catch-and-release season">Early season</span>`
    : ` <span class="pill closed" title="Trout season looks closed on this date">Out of season?</span>`;
}
function seasonNote(c){
  const s = catchSeason(c); if(!s) return "";
  return s.kind === "early" ? `<div class="meta seasonnote">Caught in the early season: catch and release, artificial lures only on most streams.</div>`
    : `<div class="meta seasonnote warn">Trout season looks closed here on this date${s.special ? "" : " (general inland season)"}. If this water has a different season, or the date is off, you can ignore this.</div>`;
}

/* ----- opener countdown ----- */
function firstSaturday(y, m){ const d = new Date(y, m, 1); while(d.getDay() !== 6) d.setDate(d.getDate() + 1); return d; }
function seasonCountdown(now = new Date()){
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate()), y = t.getFullYear(), day = 864e5;
  const fmt = d => d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
  const early = [firstSaturday(y, 0), firstSaturday(y + 1, 0)], reg = firstSaturday(y, 4), close = new Date(y, 9, 15);
  const days = d => Math.round((d - t) / day);
  if(t >= reg && t <= close){ const n = days(close); return n <= 21 ? { kind:"open", text: n ? `Trout season closes in ${n} day${n === 1 ? "" : "s"} (Oct 15)` : "Last day of trout season" } : null; }
  if(t >= early[0] && t < reg){ const n = days(reg); return { kind:"early", text:`Early season is on (catch and release). The regular opener is in ${n} day${n === 1 ? "" : "s"}, ${fmt(reg)}.` }; }
  const nextEarly = t < early[0] ? early[0] : early[1], n = days(nextEarly);
  return { kind:"closed", text: n === 0 ? "Early trout season opens today" : `Early trout season opens in ${n} day${n === 1 ? "" : "s"}, ${fmt(nextEarly)}. Regular opener: ${fmt(firstSaturday(nextEarly.getFullYear(), 4))}.` };
}
function countdownHtml(){
  const c = seasonCountdown(); if(!c) return "";
  return `<div class="countdown ${c.kind}"><span class="pill ${c.kind === "closed" ? "closed" : c.kind}">${c.kind === "closed" ? "Closed season" : c.kind === "early" ? "Early season" : "Open"}</span> ${esc(c.text)}</div>`;
}

/* ----- your season recap ----- */
function dayKey(c){ return c.caught_on || ""; }
function seasonRecapHtml(year){
  const mine = catches.filter(c => (c.caught_on || "").startsWith(year) && fishOf(c) > 0);
  const outs = (typeof outings !== "undefined" ? outings : []).filter(o => (o.fished_on || "").startsWith(year));
  if(!mine.length && !outs.length) return "";
  const fish = mine.reduce((a, c) => a + fishOf(c), 0), daysOut = new Set([...mine.map(dayKey), ...outs.map(o => o.fished_on)]).size;
  const sp = {}, wt = {}, fl = {}, mo = Array(12).fill(0), byDay = {};
  for(const c of mine){ const n = fishOf(c); if(c.species) sp[sentenceCase(c.species)] = (sp[sentenceCase(c.species)] || 0) + n;
    if(c.water) wt[c.water] = (wt[c.water] || 0) + n; if(c.fly) fl[capWords(c.fly)] = (fl[capWords(c.fly)] || 0) + n;
    mo[+c.caught_on.slice(5, 7) - 1] += n; byDay[c.caught_on] = (byDay[c.caught_on] || 0) + n; }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
  const big = mine.filter(c => c.length_in).sort((a, b) => b.length_in - a.length_in)[0];
  const before = new Set(catches.filter(c => (c.caught_on || "") < year && c.species).map(c => sentenceCase(c.species)));
  const newSp = Object.keys(sp).filter(s => !before.has(s));
  const bestDay = top(byDay), bestMonth = mo.indexOf(Math.max(...mo)), first = [...mine].sort((a, b) => dayKey(a).localeCompare(dayKey(b)))[0];
  const M = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const line = (k, v) => v ? `<li><span>${k}</span><b>${v}</b></li>` : "";
  return `<div class="card recap"><div class="eyebrow">Your ${year} season in Coulee</div>
    <div class="recapbig"><div><b>${fish}</b><span>fish</span></div><div><b>${daysOut}</b><span>days out</span></div><div><b>${Object.keys(sp).length}</b><span>species</span></div><div><b>${Object.keys(wt).length}</b><span>waters</span></div></div>
    <ul class="recaplist">
      ${line("Biggest fish", big ? `${esc(sentenceCase(big.species || "Fish"))}, ${lenTxt(big.length_in)}${big.water ? ` · ${esc(big.water)}` : ""}` : "")}
      ${line("Best day", bestDay && bestDay[1] > 1 ? `${bestDay[1]} fish on ${esc(fmtDate(bestDay[0]))}` : "")}
      ${line("Best month", fish ? `${M[bestMonth]} (${mo[bestMonth]} fish)` : "")}
      ${line("Home water", top(wt) ? `${esc(top(wt)[0])} (${top(wt)[1]} fish)` : "")}
      ${line("Go-to fly", top(fl) ? `${esc(top(fl)[0])} (${top(fl)[1]} fish)` : "")}
      ${line("First fish", first ? `${esc(sentenceCase(first.species || "Fish"))}, ${esc(fmtDate(first.caught_on))}` : "")}
      ${line("New species", newSp.length && before.size ? esc(newSp.join(", ")) : "")}
    </ul></div>`;
}

/* ----- challenges: three a month, one a week; nothing is lost if you miss one ----- */
var CHALLENGES = [
  { id:"sp3", t:"Catch 3 different species", need:3, f:cs => new Set(cs.map(c => sentenceCase(c.species)).filter(Boolean)).size },
  { id:"wt3", t:"Fish 3 different waters", need:3, f:cs => new Set(cs.map(c => (c.water || "").toLowerCase()).filter(Boolean)).size },
  { id:"d4", t:"Get out on 4 different days", need:4, f:(cs, os) => new Set([...cs.map(dayKey), ...os.map(o => o.fished_on)]).size },
  { id:"big", t:"Land a fish 14 inches or longer", need:1, f:cs => cs.some(c => +c.length_in >= 14) ? 1 : 0 },
  { id:"ph5", t:"Log 5 fish with photos", need:5, f:cs => cs.filter(c => c.photo_path).reduce((a, c) => a + fishOf(c), 0) },
  { id:"newwt", t:"Catch a fish in water you've never fished", need:1, f:(cs, os, all) => { const old = new Set(all.filter(c => !cs.includes(c) && c.water).map(c => c.water.toLowerCase())); return cs.some(c => c.water && !old.has(c.water.toLowerCase())) ? 1 : 0; } },
  { id:"newcty", t:"Catch a fish in a new county", need:1, f:(cs, os, all) => { const old = new Set(all.filter(c => !cs.includes(c) && c.county).map(c => c.county)); return cs.some(c => c.county && !old.has(c.county)) ? 1 : 0; } },
  { id:"fly3", t:"Catch fish on 3 different flies or lures", need:3, f:cs => new Set(cs.map(c => (c.fly || "").toLowerCase()).filter(Boolean)).size },
  { id:"f10", t:"Catch 10 fish", need:10, f:cs => cs.reduce((a, c) => a + fishOf(c), 0) },
];
function challengesHtml(now = new Date()){
  const y = now.getFullYear(), m = now.getMonth(), key = `${y}-${String(m + 1).padStart(2, "0")}`;
  const mine = catches.filter(c => fishOf(c) > 0 && !beforeJoin(c)), os = typeof outings !== "undefined" ? outings : [];
  const inMonth = mine.filter(c => (c.caught_on || "").startsWith(key)), outM = os.filter(o => (o.fished_on || "").startsWith(key));
  const base = y * 12 + m, list = [0, 3, 6].map(i => CHALLENGES[(base + i) % CHALLENGES.length]);   // a different three each month
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7)); const wk = mon.toISOString().slice(0, 10);
  const weekOut = mine.some(c => c.caught_on >= wk) || os.some(o => o.fished_on >= wk);
  const bar = (n, need) => `<span class="cbar"><i style="width:${Math.min(100, Math.round(100 * n / need))}%"></i></span>`;
  const M = now.toLocaleDateString(undefined, { month:"long" });
  return `<h4><span>${esc(M)} challenges</span><span>just for fun</span></h4><ul class="chal">
    ${list.map(c => { const n = c.f(inMonth, outM, mine); const done = n >= c.need; return `<li class="${done ? "done" : ""}"><b>${done ? "✓ " : ""}${esc(c.t)}</b>${bar(n, c.need)}<small>${Math.min(n, c.need)} of ${c.need}</small></li>`; }).join("")}
    <li class="${weekOut ? "done" : ""}"><b>${weekOut ? "✓ " : ""}This week: log a fish or a day on the water</b>${bar(weekOut ? 1 : 0, 1)}<small>${weekOut ? "Done" : "Not yet"}</small></li></ul>
    <p class="note">New challenges each month. Missing one costs nothing.</p>`;
}

/* ----- fishing streak in weeks; weeks in the closed trout season don't break it ----- */
function weekStart(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function streakInfo(now = new Date()){
  const days = new Set([...catches.filter(c => !beforeJoin(c)).map(dayKey), ...(typeof outings !== "undefined" ? outings : []).map(o => o.fished_on)].filter(Boolean));
  if(!days.size) return null;
  const weeks = new Set([...days].map(d => weekStart(new Date(d + "T12:00:00")).getTime()));
  const closedWeek = w => { const d = new Date(w + 3 * 864e5); const st = seasonStatus(GENERAL_REG, d); return st && st.kind === "closed"; };
  const wk = 7 * 864e5, first = Math.min(...weeks); let cur = 0, best = 0, run = 0;
  for(let w = first; w <= weekStart(now).getTime(); w += wk){
    if(weeks.has(w)) run++;
    else if(!closedWeek(w) && w !== weekStart(now).getTime()) run = 0;   // a closed-season week or this unfinished week never breaks it
    best = Math.max(best, run);
  }
  cur = run;
  return { cur, best, weeks: weeks.size };
}
function streakHtml(){
  const s = streakInfo(); if(!s) return "";
  return `<div class="streak"><div><b>${s.cur}</b><span>week streak</span></div><div><b>${s.best}</b><span>best streak</span></div><div><b>${s.weeks}</b><span>weeks fished</span></div></div>
    <p class="note">A streak counts weeks with a catch or a day on the water. Closed-season weeks and the week you're in never break it.</p>`;
}

/* ----- county completion ----- */
var countyModeOn = false;
function myCounties(){ return new Set(catches.filter(c => fishOf(c) > 0 && c.county).map(c => String(c.county)).filter(id => counties.some(f => f.id === id))); }
function countyCompletionHtml(){
  const mine = myCounties(), n = mine.size;
  return `<h4><span>Counties fished</span><span>${n} of 72</span></h4><div class="cdone"><span class="cbar big"><i style="width:${Math.round(100 * n / 72)}%"></i></span>
    <button class="btn sm" type="button" data-a="countymode">${countyModeOn ? "Hide on map" : "Show on map"}</button></div>`;
}
function countyMode(f){
  if(!countyModeOn) return null;
  const has = myCounties().has(f.id);
  if(currentCounty === f.id) return null;
  return { color: css("--county-edge"), weight: .9, fillColor: has ? css("--fish") : css("--ink"), fillOpacity: has ? .5 : .06 };
}
function setCountyMode(on){
  countyModeOn = on; countyLayer.setStyle(countyStyle);
  let chip = $("cmodeChip");
  if(on){
    if(!chip){ chip = document.createElement("div"); chip.id = "cmodeChip"; chip.className = "cmode"; document.querySelector(".mapwrap, #map").after(chip); }
    chip.innerHTML = `<b>Your counties</b> ${myCounties().size} of 72 <button type="button" class="link" data-a="countymode-off">Done</button>`;
    chip.hidden = false; setTab("map"); if(typeof setCollapsed === "function") setCollapsed(true); if(currentCounty) backToState(); else fitState();
  } else if(chip) chip.hidden = true;
  renderLog();
}
document.addEventListener("click", e => {
  if(e.target.closest('[data-a="countymode"]')) setCountyMode(!countyModeOn);
  else if(e.target.closest('[data-a="countymode-off"]')) setCountyMode(false);
});

/* ----- measure along a creek ----- */
var measuring = null, measureLayer = null;
function havMi(a, b){ const R = 3958.8, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function streamGraph(name){
  const lc = name.toLowerCase(), paths = [];
  for(const id in waterCache){ const w = waterCache[id]; if(!w || !w.s) continue; for(const s of w.s) if((s[0] || "").toLowerCase() === lc) for(const p of s[2]) paths.push(p); }
  const key = q => q[0].toFixed(5) + "," + q[1].toFixed(5), pts = new Map(), adj = new Map(), grid = new Map();
  const add = q => { const k = key(q); if(!pts.has(k)){ pts.set(k, q); adj.set(k, []); const g = Math.floor(q[0] * 1000) + ":" + Math.floor(q[1] * 1000); (grid.get(g) || grid.set(g, []).get(g)).push(k); } return k; };
  const link = (a, b) => { const d = havMi(pts.get(a), pts.get(b)); adj.get(a).push([b, d]); adj.get(b).push([a, d]); };
  for(const p of paths) for(let i = 1; i < p.length; i++){ const a = add(p[i - 1]), b = add(p[i]); if(a !== b) link(a, b); }
  // join line ends that touch another piece of the same creek (county edges, braids)
  for(const p of paths) for(const q of [p[0], p[p.length - 1]]){ const k = key(q), gx = Math.floor(q[0] * 1000), gy = Math.floor(q[1] * 1000);
    for(let dx = -1; dx <= 1; dx++) for(let dy = -1; dy <= 1; dy++) for(const o of grid.get((gx + dx) + ":" + (gy + dy)) || []){
      if(o !== k && havMi(q, pts.get(o)) < .04 && !adj.get(k).some(e => e[0] === o)) link(k, o); } }
  return { pts, adj };
}
function nearestNode(G, ll){ let best = null, bd = Infinity; const q = [ll.lng, ll.lat]; for(const [k, p] of G.pts){ const d = havMi(q, p); if(d < bd){ bd = d; best = k; } } return { k:best, mi:bd }; }
function shortestPath(G, s, t){
  const dist = new Map([[s, 0]]), prev = new Map(), heap = [[0, s]], done = new Set();
  const push = x => { heap.push(x); let i = heap.length - 1; while(i){ const p = (i - 1) >> 1; if(heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if(heap.length){ heap[0] = last; let i = 0; for(;;){ const l = 2 * i + 1, r = l + 1; let m = i;
    if(l < heap.length && heap[l][0] < heap[m][0]) m = l; if(r < heap.length && heap[r][0] < heap[m][0]) m = r; if(m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while(heap.length){ const [d, u] = pop(); if(done.has(u)) continue; done.add(u); if(u === t) break;
    for(const [v, w] of G.adj.get(u)){ const nd = d + w; if(nd < (dist.get(v) ?? Infinity)){ dist.set(v, nd); prev.set(v, u); push([nd, v]); } } }
  if(!dist.has(t)) return null;
  const path = []; for(let u = t; u; u = prev.get(u)){ path.push(G.pts.get(u)); if(u === s) break; }
  return { mi: dist.get(t), path: path.reverse() };
}
function measurePane(){ if(!map.getPane("measure")){ map.createPane("measure").style.zIndex = 455; map.getPane("measure").style.pointerEvents = "none"; } return L.svg({ pane:"measure" }); }
var measureRenderer = null;
function clearMeasure(){ if(measureLayer){ map.removeLayer(measureLayer); measureLayer = null; } }
function stopMeasure(){ measuring = null; picking = false; const b = $("measureBar"); if(b) b.hidden = true; map.getContainer().style.cursor = ""; }
function measureBar(html){
  let b = $("measureBar"); if(!b){ b = document.createElement("div"); b.id = "measureBar"; b.className = "measurebar"; document.body.appendChild(b);
    b.addEventListener("click", e => { if(e.target.closest("[data-mclose]")){ stopMeasure(); clearMeasure(); } }); }
  b.innerHTML = html + ` <button type="button" class="link" data-mclose>${measuring ? "Cancel" : "Clear"}</button>`; b.hidden = false;
}
function startMeasure(name, lat, lng){
  map.closePopup(); clearMeasure(); measureRenderer ||= measurePane();
  measuring = { name, a:L.latLng(lat, lng) }; picking = true; map.getContainer().style.cursor = "crosshair";
  measureLayer = L.layerGroup([L.circleMarker(measuring.a, { radius:6, color:css("--ink"), weight:2, fillColor:css("--paper"), fillOpacity:1 })]).addTo(map);
  measureBar(`Tap a second point on <b>${esc(name)}</b>`);
}
function measureTo(ll){
  const m = measuring; if(!m) return;
  const G = streamGraph(m.name), A = nearestNode(G, m.a), B = nearestNode(G, ll);
  if(!B.k || B.mi > .35){ measureBar(`Tap closer to <b>${esc(m.name)}</b>`); return; }
  stopMeasure();
  const r = A.k && shortestPath(G, A.k, B.k);
  const ink = css("--fish");
  if(r && r.path.length > 1){
    measureLayer.addLayer(L.polyline(r.path.map(q => [q[1], q[0]]), { renderer:measureRenderer, pane:"measure", color:ink, weight:6, opacity:.9, interactive:false }));
    measureLayer.addLayer(L.circleMarker(ll, { radius:6, color:css("--ink"), weight:2, fillColor:css("--paper"), fillOpacity:1 }));
    const miles = r.mi < .1 ? `${Math.round(r.mi * 5280).toLocaleString()} ft` : `${r.mi.toFixed(r.mi < 10 ? 1 : 0)} mi`;
    measureBar(`<b>${miles}</b> along ${esc(m.name)} <small>(${havMi([m.a.lng, m.a.lat], [ll.lng, ll.lat]).toFixed(1)} mi straight)</small>`);
  } else {
    measureLayer.addLayer(L.polyline([m.a, ll], { renderer:measureRenderer, pane:"measure", color:ink, weight:3, dashArray:"6 6", interactive:false }));
    measureBar(`<b>${havMi([m.a.lng, m.a.lat], [ll.lng, ll.lat]).toFixed(1)} mi</b> straight line <small>(couldn't follow the creek between these points; zoom out so both ends are loaded)</small>`);
  }
}
document.addEventListener("click", e => { const b = e.target.closest('[data-a="measure"]'); if(b){ e.preventDefault(); startMeasure(b.dataset.name, +b.dataset.lat, +b.dataset.lng); } });

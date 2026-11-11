
/* ---------- trout season status from DNR regulation text ---------- */
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function parseDay(txt, year){
  if(!txt) return null;
  let m = txt.match(/first\s+saturday\s+in\s+([a-z]+)/i);
  if(m){ const mi = MONTHS.indexOf(m[1].slice(0,3).toLowerCase()); if(mi < 0) return null; const d = new Date(year, mi, 1); while(d.getDay() !== 6) d.setDate(d.getDate()+1); return d; }
  m = txt.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if(m) return new Date(year, MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  return null;
}
function parseRange(txt, year){
  if(!txt) return null;
  const parts = txt.split(/\bto\b|\bthrough\b|–/i);
  if(parts.length < 2) return null;
  const a = parseDay(parts[0], year), b = parseDay(parts[1], year);
  if(!a || !b) return null;
  if(b < a) b.setFullYear(year + 1);
  return [a, b];
}
function seasonStatus(reg, now = new Date()){
  const season = reg[3] || "", early = reg[4] || "";
  if(/open all year|year[- ]round|no closed season/i.test(season)) return { kind:"open", label:"Open now", note:"Open all year" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const ranges = [];
  for(const yy of [y - 1, y, y + 1]){
    const r = parseRange(season, yy); if(r) ranges.push({ kind:"open", a:r[0], b:r[1], end:"inclusive" });
    const e = parseRange(early, yy); if(e) ranges.push({ kind:"early", a:e[0], b:e[1], end:"exclusive" });
  }
  if(!ranges.length) return null;
  const inR = r => today >= r.a && (r.end === "inclusive" ? today <= r.b : today < r.b);
  const cur = ranges.find(r => r.kind === "open" && inR(r)) || ranges.find(r => r.kind === "early" && inR(r));
  const f = d => d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
  if(cur && cur.kind === "open") return { kind:"open", label:"Open now", note:`Regular season through ${f(cur.b)}` };
  if(cur) return { kind:"early", label:"Early season", note:"Catch and release, artificial lures only (check the rule below)" };
  const next = ranges.filter(r => r.a > today).sort((p, q) => p.a - q.a)[0];
  return { kind:"closed", label:"Closed", note: next ? `Opens ${f(next.a)}${next.a.getFullYear() !== y ? " " + next.a.getFullYear() : ""}${next.kind === "early" ? " (early catch-and-release season)" : ""}` : "" };
}
function seasonHtml(reg){
  const s = reg && seasonStatus(reg);
  if(!s) return "";
  return `<div class="season"><span><span class="pill ${s.kind}">${s.label}</span></span>${s.note?`<small>${esc(s.note)}</small>`:""}</div>`;
}
async function regNear(cid, lat, lng, name){
  if(!cid || lat == null) return null;
  const t = await getJSON(troutCache, dataUrl("water/trout/" + cid + ".json"), cid).catch(() => null);
  if(!t) return null;
  const p = [lng, lat]; let best = null, bd = Infinity;
  const nm = (name || "").toLowerCase();
  for(const r of t.r){ const same = r[0] && nm.includes(r[0].toLowerCase().replace(/\s*\(.*\)/, ""));
    for(const pa of r[7]) for(const q of pa){ const d = d2(p, q) * (same ? .25 : 1); if(d < bd){ bd = d; best = r; } } }
  return bd < 0.0004 ? best : null;
}

/* ---------- public land and easements ---------- */
map.createPane("access"); map.getPane("access").style.zIndex = 410;
const accessCache = {};
let accessLayer = null, accessRenderer = null;
const ACCESS = {
  dnr:   { title:"DNR land", note:"Owned by the DNR and open to the public." },
  dnre:  { title:"DNR easement", note:"Public access through a DNR easement. On stream easements, access is usually limited to the stream corridor." },
  trout: { title:"Trout fishing easement", note:"Fishing access along the stream on private land. Stay near the water and respect the landowner." },
  cf:    { title:"County forest", note:"County forest land, open to the public." },
  usfs:  { title:"National forest", note:"Chequamegon-Nicolet National Forest, open to the public." },
  nps:   { title:"National Park Service land", note:"Federal land, generally open to the public." }
};
function accessPopup(kind, name, extra){
  const a = ACCESS[kind] || ACCESS.dnr;
  return `<div class="pop"><h3>${esc(name || a.title)}</h3><div class="meta">${esc(a.title)}${extra?` · ${esc(extra)}`:""}</div><p style="margin:8px 0 4px">${esc(a.note)}</p><small class="muted">From DNR's public lands maps. Check posted signs and property rules before you go.</small></div>`;
}
let accessSeq = 0;
async function loadAccess(id){
  clearAccess();
  if(!showAccess) return;
  const seq = ++accessSeq;
  let rows;
  try{ rows = await getJSON(accessCache, dataUrl("access/" + id + ".json"), id); }catch(e){ return; }
  if(detailFor !== id || !showAccess || seq !== accessSeq) return;   // a newer request (another county, the toggle) won
  const R = accessRenderer = L.canvas({ pane:"access", tolerance:2 });
  const g = accessLayer = L.layerGroup();
  const col = css("--pub");
  for(const [kind, name, extra, rings] of rows){
    const p = L.polygon(rings.map(r => r.map(q => [q[1], q[0]])), { renderer:R, color:col, weight: kind === "trout" || kind === "dnre" ? 1.4 : .8, dashArray: kind === "dnre" || kind === "trout" ? "4 3" : null, fillColor:col, fillOpacity: kind === "usfs" || kind === "cf" ? .12 : .26 });
    p.on("click", e => { if(picking){ handlePick(e.latlng); return; } waterTapAt = Date.now(); featureTaps++; L.popup({ maxWidth:280 }).setLatLng(e.latlng).setContent(accessPopup(kind, name, extra)).openOn(map); });
    g.addLayer(p);
  }
  g.addTo(map);
}
function clearAccess(){
  if(accessLayer){ map.removeLayer(accessLayer); accessLayer = null; }
  if(accessRenderer){ dropCanvas(accessRenderer); accessRenderer = null; }
}
$("accessToggle").onclick = () => {
  showAccess = !showAccess; lsSet("fl.showAccess", showAccess);
  $("accessToggle").setAttribute("aria-pressed", showAccess); $("accessToggle").textContent = showAccess ? "Public land on" : "Public land off";
  if(showAccess && detailFor) loadAccess(detailFor); else clearAccess();
};
$("accessToggle").setAttribute("aria-pressed", showAccess); $("accessToggle").textContent = showAccess ? "Public land on" : "Public land off";

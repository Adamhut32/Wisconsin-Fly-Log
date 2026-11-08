
/* ---------- collapsible panel: drag the handle down for a full-screen map ---------- */
const mainEl = document.querySelector(".main");
let panelCollapsed = lsGet("fl.collapsed", false);
function setCollapsed(v, save = true){
  panelCollapsed = v;
  mainEl.classList.toggle("collapsed", v);
  $("grab").setAttribute("aria-expanded", String(!v));
  $("panelShow").hidden = !v || window.matchMedia("(max-width:760px)").matches;
  if(save) lsSet("fl.collapsed", v);
  setTimeout(() => { map.invalidateSize(); drawLabels(); }, 280);
}
function expandPanel(){ if(panelCollapsed) setCollapsed(false); }
(() => {
  let y0 = null, x0 = 0, moved = false, startEl = null;
  // keep following the finger once it leaves the handle; on the tab bar only after a clear vertical pull, so taps still pick tabs
  const down = e => { y0 = e.clientY; x0 = e.clientX; moved = false; startEl = e.currentTarget; if(startEl === $("grab")) try{ startEl.setPointerCapture(e.pointerId); }catch(_){} };
  const move = e => { if(y0 == null) return; const dy = e.clientY - y0, dx = e.clientX - x0;
    if(!moved && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)){ moved = true; try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){} } };
  const up = e => {
    if(y0 == null) return;
    const dy = e.clientY - y0, dx = e.clientX - x0; const fromGrab = startEl === $("grab"); y0 = null;
    if(moved && Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)){ setCollapsed(dy > 0); return; }
    if(!moved && fromGrab) setCollapsed(!panelCollapsed);
  };
  for(const el of [$("grab"), document.querySelector(".tabs")]){
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", () => { y0 = null; });
  }
})();
$("panelHide").onclick = () => setCollapsed(true);
$("panelShow").onclick = () => setCollapsed(false);
window.matchMedia("(max-width:760px)").addEventListener?.("change", () => setCollapsed(panelCollapsed, false));
setCollapsed(panelCollapsed, false);

/* ---------- what's new after an update ---------- */
async function checkWhatsNew(){
  if(!me || !profile || !profile.onboarded || !$("guide").hidden || !$("news").hidden) return;
  const { data, error } = await sb.from("releases").select("*").gt("id", profile.last_seen_release || 0).or(`build.is.null,build.lte.${CFG.build || 0}`).order("id", { ascending:false }).limit(5);
  if(error || !data || !data.length) return;
  $("newsTitle").textContent = data.length === 1 ? data[0].title : "Updates to Coulee";
  $("newsBody").innerHTML = data.map(r => `<div class="news-rel">${data.length > 1 ? `<h5>${esc(r.title)}</h5>` : ""}<small>${esc(fmtDate(r.published_at.slice(0,10)))}</small><ul class="steps">${r.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("");
  $("news").dataset.latest = data[0].id;
  $("news").hidden = false;
}
async function markNewsSeen(id){
  if(!id || !me) return;
  profile = { ...profile, last_seen_release: id }; saveCache();
  await sb.from("profiles").update({ last_seen_release: id }).eq("id", me.id);
}
$("newsOk").onclick = () => { $("news").hidden = true; markNewsSeen(+$("news").dataset.latest); };
$("news").addEventListener("click", e => { if(e.target === $("news")) $("newsOk").click(); });
async function latestReleaseId(){ const { data } = await sb.from("releases").select("id").or(`build.is.null,build.lte.${CFG.build || 0}`).order("id", { ascending:false }).limit(1); return data && data[0] ? data[0].id : 0; }

/* ---------- save counties for offline use ---------- */
const OFFLINE_CACHE = "flylog-data";
const countyFiles = id => [dataUrl("water/" + id + ".json"), dataUrl("water/trout/" + id + ".json"), dataUrl("access/" + id + ".json"), hdUrl(id)];
let offlineSaved = null, offlineBusy = false;
async function countSavedCounties(){
  if(!("caches" in window)) return null;
  try{ const c = await caches.open(OFFLINE_CACHE); const keys = new Set((await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search));
    const base = new URL(dataUrl("water/x.json"), location.href).pathname.replace(/x\.json$/, "");
    const hdKey = id => { const u = new URL(hdUrl(id), location.href); return u.pathname + u.search; };
    // saved = the county's map file and its detailed creek lines are both on the phone
    offlineSaved = new Set(counties.map(f => f.id).filter(id => keys.has(base + id + ".json?v=" + CFG.dataVersion) && keys.has(hdKey(id))));
  }catch(e){ offlineSaved = null; }
  return offlineSaved;
}
async function saveCountiesOffline(ids, onProgress){
  const c = await caches.open(OFFLINE_CACHE);
  const extra = [dataUrl("water/index.json"), dataUrl("geo.json")];
  for(const u of extra){ try{ if(!(await c.match(u))){ const r = await fetch(u); if(r.ok) await c.put(u, r); } }catch(e){} }
  let done = 0, failed = 0;
  for(const id of ids){
    for(const u of countyFiles(id)){ try{ if(!(await c.match(u))){ const r = await fetch(u); if(r.ok) await c.put(u, r); else failed++; } }catch(e){ failed++; } }
    done++; onProgress && onProgress(done, ids.length);
  }
  await countSavedCounties();
  const rec = lsGet("fl.offlineIds", { v:offlineV(), ids:[] });
  lsSet("fl.offlineIds", { v:offlineV(), ids:[...new Set([...(rec.v === offlineV() ? rec.ids : []), ...ids])] });
  return failed;
}
async function offlineAction(which){
  if(offlineBusy) return;
  if(!navigator.onLine){ toast("Connect to the internet to save counties."); return; }
  offlineBusy = true;
  try{ await navigator.storage?.persist?.(); }catch(e){}
  const old = lsGet("fl.offlineIds", null);
  const ids = which === "all" ? counties.map(f => f.id) : which === "refresh" ? (old?.ids || []) : [which];
  const label = which === "all" ? "Wisconsin" : which === "refresh" ? `${ids.length} saved counties` : countyName(which);
  const failed = await saveCountiesOffline(ids, (d, n) => { const el = $("offlineProg"); if(el) el.textContent = `Saving ${d} of ${n} counties…`; });
  offlineBusy = false;
  toast(failed ? `Saved most of ${label}. A few files didn't download; try again on Wi-Fi.` : `${label} is saved for offline use.`);
  renderLog();
}
$("log").addEventListener("click", e => { const b = e.target.closest("[data-offline]"); if(b){ b.disabled = true; offlineAction(b.dataset.offline); } });
function offlineBlock(cid){
  if(!("caches" in window)) return "";
  if(offlineSaved === null){ countSavedCounties().then(() => renderLog()); return ""; }
  if(cid) return offlineSaved.has(cid) ? `<p class="note">Saved for offline: creek names, trout classes, regulations and public land work without signal.</p>`
    : `<div class="row2" style="margin-top:14px"><button class="btn sm" type="button" data-offline="${esc(cid)}">Save ${esc(byId[cid].properties.name)} County for offline</button></div>`;
  const n = offlineSaved.size, old = lsGet("fl.offlineIds", null);
  const stale = old && old.v !== offlineV() && old.ids?.length ? old.ids.filter(id => !offlineSaved.has(id)).length : 0;
  return `<h4><span>Offline maps</span><span>${n}/72 counties saved</span></h4>
    ${stale ? `<div class="card notice"><p style="margin:0 0 8px"><b>The map data was updated.</b> ${stale} of your saved counties need a refresh to keep working offline.</p><div class="row2"><button class="btn sm ink" type="button" data-offline="refresh">Refresh saved counties</button></div></div>` : ""}
    <div class="card"><p>Saved counties keep their creeks and names, trout classes, regulations and public land on this phone, so they work with no signal. Counties you open are saved automatically, and their detailed creek lines once you zoom in close. Tap Save to get everything at once. Your catches still log offline and sync later.</p>
    <div class="row2">${n < 72 ? `<button class="btn sm ink" type="button" data-offline="all">Save all of Wisconsin (about 90 MB)</button>` : `<span class="pill fished">All of Wisconsin is saved</span>`}<span class="hint" id="offlineProg">${offlineBusy ? "Saving…" : ""}</span></div>
    <p class="muted">Use Wi-Fi for the full download. The base map (state, counties and big rivers) is always saved.</p></div>`;
}

/* after a map data update, say so once instead of only showing it in Me -> Offline maps */
let offlineNudged = false;
async function nudgeOfflineRefresh(){
  if(offlineNudged || !navigator.onLine) return; offlineNudged = true;
  const old = lsGet("fl.offlineIds", null);
  if(!old || old.v === offlineV() || !old.ids?.length) return;
  await countSavedCounties();
  const stale = old.ids.filter(id => !offlineSaved?.has(id)).length;
  if(stale) toast(`Map update: ${stale} saved count${stale === 1 ? "y needs" : "ies need"} a refresh for offline use. Me → Offline maps → Refresh saved counties.`);
}

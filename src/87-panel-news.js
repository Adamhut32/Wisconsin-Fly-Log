
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
  const { data, error } = await sb.from("releases").select("*").gt("id", profile.last_seen_release || 0).order("id", { ascending:false }).limit(5);
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
async function latestReleaseId(){ const { data } = await sb.from("releases").select("id").order("id", { ascending:false }).limit(1); return data && data[0] ? data[0].id : 0; }

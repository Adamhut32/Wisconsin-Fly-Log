
/* ---------- test versions: the founder and admins get new builds first; the founder releases them ---------- */
const CHANNEL = CFG.channel || "stable", BUILD = CFG.build || 0;
let liveBuild = CHANNEL === "stable" ? BUILD : null, betaBuild = CHANNEL === "beta" ? BUILD : null, gateBuild = null, betaNote = "";
async function readBuild(base){ try{ const r = await fetch(base + "build.json?t=" + Date.now(), { cache:"no-store" }); return r.ok ? (await r.json()).build : null; }catch(e){ return null; } }
const wantsBeta = () => isStaff() && lsGet("fl.useBeta", true);
async function routeChannel(){
  if(!profile || accountState() !== "ok" || !navigator.onLine) return;
  if(CHANNEL === "stable" && wantsBeta()){
    betaBuild = await readBuild("beta/");
    if(betaBuild && betaBuild > BUILD){ location.replace("beta/" + location.hash); return; }
  }
  if(CHANNEL === "beta" && !wantsBeta()){ location.replace("../" + location.hash); return; }
  if(CHANNEL === "beta"){
    liveBuild = await readBuild("../");
    try{ betaNote = (await (await fetch("build.json?t=" + Date.now(), { cache:"no-store" })).json()).note || ""; }catch(e){}
    const { data } = await sb.from("release_gate").select("approved_build").eq("id", 1).maybeSingle(); gateBuild = data?.approved_build ?? null;
    $("testPill").hidden = false; $("testPill").textContent = `Test · build ${BUILD}`;
    if(tab === "me") renderLog();
  }
}
function channelHtml(){
  const opt = `<label class="check" style="margin-top:8px"><input type="checkbox" id="useBeta" ${lsGet("fl.useBeta", true) ? "checked" : ""}> Get new versions before everyone else</label>`;
  if(CHANNEL !== "beta") return `<h4><span>Updates</span><span>build ${BUILD}</span></h4><div class="card"><p style="margin:0">You're on the same version as everyone${betaBuild && betaBuild > BUILD ? `. A test version (build ${betaBuild}) is ready.` : ". No test version is waiting."}</p>${opt}</div>`;
  const ahead = liveBuild != null && BUILD > liveBuild, approved = gateBuild != null && gateBuild >= BUILD;
  return `<h4><span>Test version</span><span>build ${BUILD}</span></h4><div class="card notice">
    <p style="margin:0 0 6px"><b>${ahead ? `You're trying build ${BUILD}. Everyone else has build ${liveBuild}.` : "This test version matches what everyone has."}</b></p>
    ${ahead && betaNote ? `<p style="margin:0 0 6px">${esc(betaNote)}${/creek/i.test(betaNote) ? ". Zoom in close on a few creeks to check them." : ""}</p>` : ""}
    ${ahead ? (approved ? `<p class="muted" style="margin:0">Approved. It reaches everyone within about 15 minutes, and their app updates the next time they open it.</p>`
      : isFounder() ? `<p class="muted" style="margin:0 0 8px">Try it out. When you're happy, release it. Until then only you and admins have it.</p><div class="row2"><button class="btn sm ink" type="button" data-approve="${BUILD}">Release build ${BUILD} to everyone</button></div>`
      : `<p class="muted" style="margin:0">Only the founder can release it to everyone.</p>`) : ""}
    ${opt}</div>`;
}
$("log").addEventListener("change", e => { if(e.target.id === "useBeta"){ lsSet("fl.useBeta", e.target.checked); toast(e.target.checked ? "You'll get new versions first." : "You'll get updates with everyone else."); setTimeout(routeChannel, 300); } });
$("log").addEventListener("click", async e => {
  const a = e.target.closest("[data-approve]"); if(!a) return;
  if(a.dataset.sure !== "1"){ a.dataset.sure = "1"; a.textContent = "Tap again to release to everyone"; return; }
  a.disabled = true;
  const { error } = await sb.rpc("approve_build", { b:+a.dataset.approve });
  if(error){ toast(error.message || "Couldn't approve."); a.disabled = false; return; }
  gateBuild = +a.dataset.approve; toast("Released. Everyone gets it within about 15 minutes."); renderLog();
});

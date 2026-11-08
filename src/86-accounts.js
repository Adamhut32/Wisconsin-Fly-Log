
/* ---------- accounts: agreements, approval, staff roles ---------- */
const TERMS_VERSION = 1;
const thisYear = new Date().getFullYear();
const isFounder = () => profile?.role === "creator";
const isStaff = () => profile?.role === "creator" || (profile?.role === "admin" && profile?.status === "approved");
function checkBirthYear(v){
  const y = +String(v || "").trim();
  if(!/^\d{4}$/.test(String(v || "").trim()) || y < 1900 || y > thisYear) return "Enter the year you were born, like 1990.";
  if(y > thisYear - 13) return "Coulee is for people 13 and older.";
  return null;
}
function accountState(){
  if(!profile) return "ok";
  if(profile.status === "pending" || profile.status === "declined") return profile.status;
  if(profile.terms_version != null && profile.terms_version < TERMS_VERSION) return "terms";
  return "ok";
}
function applyGate(){
  const s = accountState();
  $("gate").hidden = !(s === "pending" || s === "declined");
  $("terms").hidden = s !== "terms";
  if(s === "pending") $("gateBody").innerHTML = `<h2 style="margin:0 0 8px">You're on the list</h2><p>Thanks for signing up, ${esc(profile.display_name || "angler")}. Coulee is invite-only for now, so the founder approves each new account.</p><p class="muted">You'll get in as soon as you're approved. Tap Check again, or reopen the app later.</p>`;
  if(s === "declined") $("gateBody").innerHTML = `<h2 style="margin:0 0 8px">This account isn't active</h2><p>This account hasn't been approved for Coulee. If you think that's a mistake, contact the person who invited you.</p>`;
  if(s === "terms"){ $("tYearRow").hidden = !!profile.birth_year; $("termsMsg").textContent = ""; }
  return s === "ok";
}
$("gateCheck").onclick = async () => { $("gateCheck").disabled = true; await loadAll(); $("gateCheck").disabled = false; if(accountState() === "pending") toast("Still waiting for approval."); };
$("gateOut").onclick = $("termsOut").onclick = async () => { await sb.auth.signOut(); location.reload(); };
$("termsOk").onclick = async () => {
  const msg = $("termsMsg"); msg.className = "hint bad";
  const upd = { terms_version:TERMS_VERSION, terms_at:new Date().toISOString() };
  if(!profile.birth_year){ const e = checkBirthYear($("tYear").value); if(e){ msg.textContent = e; $("tYear").focus(); return; } upd.birth_year = +$("tYear").value.trim(); }
  if(!$("tAgree").checked || !$("tRegs").checked){ msg.textContent = "Check both boxes to continue."; return; }
  $("termsOk").disabled = true;
  const { error } = await sb.from("profiles").update(upd).eq("id", me.id);
  $("termsOk").disabled = false;
  if(error){ msg.textContent = /13/.test(error.message) ? "Coulee is for people 13 and older." : "Couldn't save. Check your connection and try again."; return; }
  profile = { ...profile, ...upd }; saveCache();
  if(applyGate()){ if(!profile.onboarded) openGuide(); else checkWhatsNew(); }
};

/* staff: pending accounts, approvals and roles */
let staffList = null, pendingCount = 0, acctQ = "";
async function loadStaffList(){
  if(!isStaff()) return;
  const { data, error } = await sb.rpc("staff_people", { q: acctQ });
  if(error) return;
  staffList = data || [];
  if(!acctQ) pendingCount = staffList.filter(p => p.status === "pending").length;
  $("meDot").hidden = !(pendingCount || flagCount);
  if(tab === "me") renderLog();
}
const ACCT_PILL = { pending:`<span class="pill want">Waiting</span>`, declined:`<span class="pill priv">Declined</span>` };
function staffAccountsHtml(){
  if(!staffList){ loadStaffList(); return `<h4><span>Accounts</span></h4><p class="status">Loading accounts…</p>`; }
  return `<h4><span>Accounts</span><span>${pendingCount} waiting</span></h4>
    <form id="acctForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="acctQ" value="${esc(acctQ)}" placeholder="Search by name${isFounder() ? " or email" : ""}" aria-label="Search accounts"><button class="btn" type="submit">Search</button></form>
    ${staffList.length ? `<div class="stack" style="margin-top:10px">${staffList.map(p => {
      const roleCtl = isFounder() && p.role !== "creator" && p.status === "approved"
        ? `<div class="row2"><select data-acctrole="${esc(p.id)}" aria-label="Role" style="width:auto"><option value="angler" ${p.role==="angler"?"selected":""}>Member</option><option value="admin" ${p.role==="admin"?"selected":""}>Admin</option></select>
           <label class="check" style="margin:0"><input type="checkbox" data-acctver="${esc(p.id)}" ${p.verified?"checked":""}> Verified</label>
           <button class="btn sm" type="button" data-acctsave="${esc(p.id)}">Save</button></div>` : "";
      const statusCtl = p.role === "creator" ? "" : p.status === "pending"
        ? `<button class="btn sm ink" type="button" data-acctset="${esc(p.id)}" data-to="approved">Approve</button><button class="btn sm" type="button" data-acctset="${esc(p.id)}" data-to="declined">Decline</button>`
        : p.status === "declined" ? `<button class="btn sm" type="button" data-acctset="${esc(p.id)}" data-to="approved">Approve</button>`
        : (p.role !== "admin" || isFounder()) ? `<button class="link danger" type="button" data-acctset="${esc(p.id)}" data-to="declined">Remove access</button>` : "";
      return `<div class="card acct"><div class="acct-h">${avHtml(p.id, p.display_name, "", p.avatar_path)}<span class="t"><b class="wrap">${esc(p.display_name)} ${p.role==="creator"?`<span class="pill open">Founder</span>`:p.role==="admin"?`<span class="pill scouted">Admin</span>`:""}${p.verified?` <span class="pill fished">Verified</span>`:""} ${ACCT_PILL[p.status]||""}</b>
        <small>${p.email ? esc(p.email) + " · " : ""}joined ${esc(fmtDate(p.created_at.slice(0,10)))}</small></span></div>
        ${statusCtl ? `<div class="row2">${statusCtl}</div>` : ""}${roleCtl}</div>`; }).join("")}</div>` : `<p class="muted">No accounts match.</p>`}
    <p class="note">${isFounder() ? "Admins can approve accounts and read suggestions. They never see emails, private spots or exact locations. Verified adds a badge." : "You can approve new accounts and answer suggestions."}</p>`;
}
$("log").addEventListener("submit", e => { if(e.target.id === "acctForm"){ e.preventDefault(); acctQ = $("acctQ").value.trim(); staffList = null; renderLog(); } });
$("log").addEventListener("click", async ev => {
  const st = ev.target.closest("[data-acctset]");
  if(st){ st.disabled = true;
    const { error } = await sb.rpc("set_account_status", { uid: st.dataset.acctset, new_status: st.dataset.to });
    toast(error ? (error.message || "Couldn't update.") : st.dataset.to === "approved" ? "Approved. They can use Coulee now." : "Access removed.");
    await loadStaffList(); return; }
  const sv = ev.target.closest("[data-acctsave]");
  if(sv){ const id = sv.dataset.acctsave; sv.disabled = true;
    const role = $("log").querySelector(`[data-acctrole="${id}"]`).value, ver = $("log").querySelector(`[data-acctver="${id}"]`).checked;
    const { error } = await sb.rpc("set_account_role", { uid:id, new_role:role, is_verified:ver });
    toast(error ? (error.message || "Couldn't save.") : "Saved."); await loadStaffList(); }
});

/* ---------- profile pictures ---------- */
const AV_BASE = CFG.supabaseUrl + "/storage/v1/object/public/avatars/";
let avatars = lsGet("fl.avatars", {}), titles = lsGet("fl.titles", {});
const titleOf = id => id === me?.id ? profile?.title : (titles[id] || people[id]?.title);
const titlePill = id => titleOf(id) ? ` <span class="pill ttl">${esc(titleOf(id))}</span>` : "";
function avHtml(id, name, cls = "", path){
  const p = path !== undefined ? path : id === me?.id ? profile?.avatar_path : (avatars[id] || people[id]?.avatar_path);
  const ini = esc(((name || "?").trim()[0] || "?").toUpperCase());
  return p ? `<span class="av ${cls}"><img src="${AV_BASE}${p.split("/").map(encodeURIComponent).join("/")}" alt="" loading="lazy" onerror="this.remove()"></span>` : `<span class="av ${cls}" aria-hidden="true">${ini}</span>`;
}
async function loadAvatars(ids){
  ids = [...new Set(ids.filter(id => id && id !== me?.id))];
  if(!ids.length) return;
  const { data, error } = await sb.from("profiles").select("id, avatar_path, title").in("id", ids.slice(0, 300));
  if(error || !data) return;
  for(const p of data){ avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; }
  lsSet("fl.avatars", avatars); lsSet("fl.titles", titles);
  if(tab === "friends") renderLog();
}
async function avatarBlob(file){
  let bmp; try{ bmp = await createImageBitmap(file, { imageOrientation:"from-image" }); }catch(e){ bmp = null; }
  if(!bmp) bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(bmp.width, bmp.height), N = 320;
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  cv.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  return await new Promise(res => cv.toBlob(res, "image/jpeg", 0.85));
}
$("log").addEventListener("change", async e => {
  if(e.target.id !== "avFile" || !e.target.files[0]) return;
  if(!navigator.onLine){ toast("Connect to the internet to change your picture."); return; }
  const file = e.target.files[0]; toast("Uploading your picture…");
  try{
    const blob = await avatarBlob(file), path = `${me.id}/${Date.now()}.jpg`, old = profile.avatar_path;
    const up = await sb.storage.from("avatars").upload(path, blob, { contentType:"image/jpeg", cacheControl:"31536000" });
    if(up.error) throw up.error;
    const { error } = await sb.from("profiles").update({ avatar_path:path }).eq("id", me.id);
    if(error) throw error;
    profile = { ...profile, avatar_path:path }; saveCache(); renderLog(); toast("Picture saved.");
    if(old) sb.storage.from("avatars").remove([old]);
  }catch(err){ console.error(err); toast("Couldn't save that picture. Try a different photo."); }
});
$("log").addEventListener("click", async e => {
  if(!e.target.closest('[data-a="avremove"]')) return;
  const old = profile.avatar_path; if(!old) return;
  const { error } = await sb.from("profiles").update({ avatar_path:null }).eq("id", me.id);
  if(error){ toast("Couldn't remove it."); return; }
  profile = { ...profile, avatar_path:null }; saveCache(); renderLog(); sb.storage.from("avatars").remove([old]);
});

/* ---------- map views: field map, satellite, topo ---------- */
pane("tiles", 395, false);
const VIEWS = {
  field:{ label:"Map" },
  sat:{ label:"Satellite", url:"https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}", credit:"Imagery: USGS The National Map" },
  topo:{ label:"Topo", url:"https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", credit:"Topo: USGS The National Map" }
};
let mapView = lsGet("fl.view", "field"), viewLayer = null, tileErrors = 0;
const viewCtl = L.control({ position:"topright" });
viewCtl.onAdd = () => {
  const d = L.DomUtil.create("div", "viewsw");
  d.setAttribute("role", "group"); d.setAttribute("aria-label", "Map style");
  d.innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button type="button" data-view="${k}" aria-pressed="${k === mapView}">${v.label}</button>`).join("") + `<small class="vcredit" id="viewCredit"></small>`;
  L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
  d.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if(b) setMapView(b.dataset.view); });
  return d;
};
viewCtl.addTo(map);
function setMapView(v){
  if(!VIEWS[v]) v = "field";
  mapView = v; lsSet("fl.view", v); tileErrors = 0;
  if(viewLayer){ map.removeLayer(viewLayer); viewLayer = null; }
  if(VIEWS[v].url){
    viewLayer = L.tileLayer(VIEWS[v].url, { pane:"tiles", maxNativeZoom:16, maxZoom:16, crossOrigin:true });
    viewLayer.on("tileerror", () => { if(++tileErrors === 6) toast(navigator.onLine ? `${VIEWS[v].label} tiles aren't loading right now.` : `${VIEWS[v].label} view needs a connection. Switch to Map for offline use.`); });
    viewLayer.addTo(map);
  }
  map.getPane("water").style.display = v === "field" ? "" : "none";
  document.getElementById("map").classList.toggle("imagery", v !== "field");
  document.querySelectorAll(".viewsw [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  const c = $("viewCredit"); if(c) c.textContent = VIEWS[v].credit || "";
}
setMapView(mapView);

/* ---------- update ready banner ---------- */
let updateWaiting = false;
function appBusy(){
  const open = ["scrim", "tripScrim", "tourneyScrim", "guide", "terms"].some(id => $(id) && !$(id).hidden);
  const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value && a.type !== "checkbox" && a.id !== "q";
  return open || typing || picking || offlineBusy;
}
function showUpdateReady(){ updateWaiting = true; $("updBar").hidden = false; }
$("updGo").onclick = () => location.reload();
$("updLater").onclick = () => { $("updBar").hidden = true; };

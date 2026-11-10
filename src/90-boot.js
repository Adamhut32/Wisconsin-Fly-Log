
/* ---------- sign in ---------- */
let authMode = "in";
function setAuthMode(m){
  authMode = m;
  $("authInTab").setAttribute("aria-pressed", m === "in"); $("authUpTab").setAttribute("aria-pressed", m === "up");
  $("nameRow").hidden = $("yearRow").hidden = $("agreeRow").hidden = m !== "up";
  $("pwRow").hidden = m === "reset";
  $("aEmail").closest(".field").hidden = m === "newpw";
  $("aPw").autocomplete = m === "in" ? "current-password" : "new-password";
  $("pwRow").querySelector("label").textContent = m === "newpw" ? "New password" : "Password";
  $("authGo").textContent = { in:"Sign in", up:"Create account", reset:"Send reset link", newpw:"Save new password" }[m];
  $("forgotBtn").hidden = m !== "in";
  $("stayRow").hidden = m === "reset" || m === "newpw";
  $("authMsg").textContent = ""; $("authMsg").className = "hint";
}
try{ $("aStay").checked = lsGet("fl.stay", true); }catch(e){}
$("pwShow").onclick = () => {
  const show = $("aPw").type === "password";
  $("aPw").type = show ? "text" : "password";
  $("pwShow").textContent = show ? "Hide" : "Show";
  $("pwShow").setAttribute("aria-pressed", String(show)); $("pwShow").setAttribute("aria-label", show ? "Hide password" : "Show password");
  $("aPw").focus({ preventScroll:true });
};
$("authInTab").onclick = () => setAuthMode("in");
$("authUpTab").onclick = () => setAuthMode("up");
$("forgotBtn").onclick = () => setAuthMode("reset");
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("authMsg"), pw = $("aPw").value, go = $("authGo");
  // forgive small typing slips: spaces (and invisible ones), a comma for a dot, a stray dot at the end, capitals
  const email = $("aEmail").value.replace(/[\s​-‍⁠﻿]+/g, "").replace(/,/g, ".").replace(/\.+$/, "").toLowerCase();
  if(email && email !== $("aEmail").value) $("aEmail").value = email;
  msg.className = "hint bad";
  if(authMode !== "newpw" && !/^[^@]+@[^@]+\.[^@.]{2,}$/.test(email)){
    msg.textContent = !email ? "Enter your email address."
      : !email.includes("@") ? "That email is missing the @ sign."
      : (email.match(/@/g) || []).length > 1 ? "That email has more than one @ sign."
      : `That email is missing its ending, like .com. You typed: ${email}`;
    $("aEmail").focus(); return; }
  if(authMode !== "reset" && pw.length < 8){ msg.textContent = "Passwords need at least 8 characters."; $("aPw").focus(); return; }
  if(authMode === "up" && !$("aName").value.trim()){ msg.textContent = "Add your name so friends know who you are."; $("aName").focus(); return; }
  if(authMode === "up"){ const ye = checkBirthYear($("aYear").value); if(ye){ msg.textContent = ye; $("aYear").focus(); return; }
    if(!$("aAgree").checked || !$("aRegs").checked){ msg.textContent = "Check both boxes to create your account."; return; } }
  go.disabled = true;
  lsSet("fl.stay", $("aStay").checked);
  const redirect = location.origin + location.pathname;
  try{
    if(authMode === "in"){
      const { error } = await sb.auth.signInWithPassword({ email, password:pw });
      if(error) throw new Error(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match.");
    } else if(authMode === "up"){
      const { data, error } = await sb.auth.signUp({ email, password:pw, options:{ data:{ display_name:$("aName").value.trim(), birth_year:$("aYear").value.trim(), terms_version:String(TERMS_VERSION) }, emailRedirectTo:redirect } });
      if(error) throw new Error(/registered/i.test(error.message) ? "That email already has an account. Sign in instead." : /database|saving new user/i.test(error.message) ? "Couldn't create the account. Coulee is for people 13 and older." : error.message);
      if(!data.session){ setAuthMode("in"); $("aEmail").value = email; msg.className = "hint ok"; msg.textContent = "Check your email and tap the confirmation link, then sign in here."; }
    } else if(authMode === "reset"){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:redirect });
      if(error) throw new Error("Couldn't send the email. Wait a minute and try again.");
      msg.className = "hint ok"; msg.textContent = "Check your email for a link to set a new password.";
    } else {
      const { error } = await sb.auth.updateUser({ password:pw });
      if(error) throw new Error("Couldn't save the new password. Try again.");
      $("auth").hidden = true; toast("Password updated. You're signed in."); history.replaceState(null, "", location.pathname);
    }
  }catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Something went wrong. Try again."; }
  finally{ go.disabled = false; }
});

let recoveryShown = false;
function showNewPassword(){ if(recoveryShown) return; recoveryShown = true; $("auth").hidden = false; setAuthMode("newpw"); $("authMsg").className = "hint ok"; $("authMsg").textContent = "Choose a new password for your account."; }
async function startSession(user){
  if(RECOVERY_LINK) showNewPassword();
  if(me && me.id === user.id) return;
  me = { id:user.id, email:user.email };
  outbox = lsGet(outboxKey(), []);
  const cache = lsGet(cacheKey(), null);
  if(cache){ ({ catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile } = { ...cache }); follows = cache.follows || []; outings = cache.outings || []; groupTrips = cache.groupTrips || []; tournaments = cache.tournaments || []; announcements = cache.announcements || [];
    for(const j of outbox) if(j.photo){ idb.get(j.photo).then(b => { if(b){ pendingPhotoUrls[j.photo] = URL.createObjectURL(b); renderAll(); } }).catch(()=>{}); } }
  loadState = navigator.onLine ? "loading" : "offline";
  if(!recoveryShown) $("auth").hidden = true; canWrite = true;
  applyPrefs(); renderAll(); updateSync(); applyGate();
  await loadAll(); flush();
}
function showAuth(){ me = null; $("auth").hidden = false; setAuthMode("in"); }
sb.auth.onAuthStateChange((event, session) => {
  if(event === "PASSWORD_RECOVERY"){ showNewPassword(); if(session?.user) startSession(session.user); return; }
  if(session?.user) startSession(session.user);
  else if(event === "SIGNED_OUT" && !storedUser()) showAuth();
});

/* ---------- start ---------- */
tab = lsGet("fl.tab", "map");
renderAll();
// Open straight from the sign-in saved on this phone, so the app works with no signal.
// Checking it with the server can take a while (or fail) offline; that must never sign anyone out.
function storedUser(){ try{ const s = JSON.parse(authStore.getItem("fl.auth") || "null"); return s?.user?.id ? s.user : null; }catch(e){ return null; } }
let offlineAuth = false;
const saved = storedUser();
if(saved) startSession(saved);
const { data:{ session } } = await Promise.race([
  sb.auth.getSession().catch(() => ({ data:{ session:null }, failed:true })),
  new Promise(r => setTimeout(() => r({ data:{ session:null }, slow:true }), saved ? 4000 : 15000))
]);
if(session?.user) startSession(session.user);
else if(storedUser()) offlineAuth = true;            // couldn't reach the server: keep going from this phone
else if(saved){ me = null; showAuth(); }              // the server rejected the saved sign-in
else { showAuth(); if(LINK_ERROR){ $("authMsg").className = "hint bad"; $("authMsg").textContent = /expired|invalid/i.test(decodeURIComponent(LINK_ERROR)) ? "That email link has expired or was already used. Request a new one." : decodeURIComponent(LINK_ERROR.replace(/\+/g, " ")); } }

async function recheckAuth(){
  if(!offlineAuth || !navigator.onLine) return;
  const { data:{ session } } = await sb.auth.getSession().catch(() => ({ data:{ session:null } }));
  if(session?.user){ offlineAuth = false; loadAll(); flush(); }
  else if(!storedUser()){ offlineAuth = false; me = null; showAuth(); }
}
window.addEventListener("online", recheckAuth);
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") recheckAuth(); });

if("serviceWorker" in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(reg => {
    // look for a new version whenever the app comes back to the front
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(e => console.warn("offline support unavailable", e));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading || !hadController) return;
    // never pull the page out from under someone mid-entry: offer a refresh instead
    if(appBusy()) showUpdateReady(); else { reloading = true; location.reload(); }
  });
}
})().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<div style="position:fixed;inset:auto 16px 16px;padding:12px 14px;border-radius:12px;background:#2C2922;color:#FAF6EB;z-index:3000;font:15px system-ui">The map couldn't start. Check your connection and reopen the app.</div>`);
});


/* ---------- Supabase connection ---------- */
// "Stay signed in" keeps the session in long-lived storage; otherwise it ends when the app is closed
const authStore = {
  getItem: k => { try{ return localStorage.getItem(k) ?? sessionStorage.getItem(k); }catch(e){ return null; } },
  setItem: (k, v) => { try{ if(lsGet("fl.stay", true)){ localStorage.setItem(k, v); sessionStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.removeItem(k); } }catch(e){} },
  removeItem: k => { try{ localStorage.removeItem(k); sessionStorage.removeItem(k); }catch(e){} }
};
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"fl.auth", storage:authStore }
});
try{ navigator.storage?.persist?.(); }catch(e){}
const COLS = {
  catches: ["id","trip_id","spot_id","lat","lng","county","species","length_in","count","fly","caught_on","notes","photo_path","visibility","photo_taken_on","photo_time","method","photo_hash","photo_meta","water","weight_lb","more_photos","share_with","exact_for"],
  spots: ["id","name","lat","lng","county","water","trout_class","target","notes","status","visibility","share_with","exact_for"],
  trips: ["id","name","start_date","end_date","base","notes","shared","waters"],
  outings: ["id","trip_id","fished_on","hours","water","lat","lng","county","notes","on_map"]
};
const pick = (table, r) => { const o = {}; for(const k of COLS[table]) if(k in r) o[k] = r[k] === undefined ? null : r[k]; return o; };
const listFor = t => t === "catches" ? catches : t === "spots" ? spots : t === "outings" ? outings : trips;
function setList(t, v){ if(t === "catches") catches = v; else if(t === "spots") spots = v; else if(t === "outings") outings = v; else trips = v; }

/* ---------- photo blobs waiting to upload (IndexedDB) ---------- */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("flylog", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("blobs", mode); const s = t.objectStore("blobs"); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { put:(k,v) => tx("readwrite", s => s.put(v, k)), get:k => tx("readonly", s => s.get(k)), del:k => tx("readwrite", s => s.delete(k)) };
})();

/* ---------- photo display: signed links, fetched in batches and remembered on this device ----------
   Photos are private, so each needs a signed link. A link used to be asked for only when a list or the map drew the photo;
   anything opened before the link arrived (the edit form, the big photo viewer) showed a blank and never caught up.
   Now: links are remembered for a day, every screen that shows a photo is filled in when its link arrives, a photo that fails
   to load asks for a fresh link once, and the service worker keeps photos you've seen so they open instantly and offline. */
const PH_TTL = 24 * 3600;   // seconds a signed link lasts
const photoCache = {}, pendingPhotoUrls = {}, photoWaiters = {};
let photoWant = new Set(), photoTimer = null, photoRetry = 0, photoSaveTimer = null;
const photoKey = () => "fl.ph." + (me?.id || "anon");
// out-of-date links are kept too: with no signal they still open any photo this device has saved
function loadPhotoCache(){ const saved = lsGet(photoKey(), {}); for(const [p, v] of Object.entries(saved)) if(!photoCache[p] && v && v[0]) photoCache[p] = { url:v[0], exp:v[1] || 0 }; }
function savePhotoCache(){ clearTimeout(photoSaveTimer); photoSaveTimer = setTimeout(() => { const out = {};
  for(const [p, c] of Object.entries(photoCache).filter(([, c]) => c.url && !c.url.startsWith("blob:")).sort((x, y) => (y[1].at || y[1].exp) - (x[1].at || x[1].exp)).slice(0, 400)) out[p] = [c.url, c.exp];
  lsSet(photoKey(), out); }, 400); }
// extra photo paths of a catch (own catches store [{p,h}], friends' come as plain paths)
const morePaths = c => (c && c.more_photos ? c.more_photos.map(x => typeof x === "string" ? x : x && x.p).filter(Boolean) : []);
// an <img> that fills itself in when its link arrives, and asks for a new link if it fails to load
const phImg = (path, attrs) => `<img ${attrs || ""} src="${photoSrc(path)}" data-ph="${esc(path)}">`;
// one photo, or a swipeable pair
function photoGallery(c, cls){
  const paths = [c.photo_path, ...morePaths(c)].filter(Boolean);
  const alt = esc(c.species || "Catch") + " photo";
  if(!paths.length || !paths.some(photoSrc)) return "";
  if(paths.length === 1) return phImg(paths[0], `${cls ? `class="${cls}"` : ""} alt="${alt}" loading="lazy"`);
  return `<div class="galw ${cls ? cls + "w" : ""}"><div class="gal ${cls || ""}">${paths.map((p, i) => phImg(p, `alt="${alt} ${i + 1} of ${paths.length}" loading="lazy"`)).join("")}</div><span class="galn">${paths.length} photos · swipe</span></div>`;
}
function wantPhoto(path){ photoWant.add(path); clearTimeout(photoTimer); photoTimer = setTimeout(fetchPhotoUrls, 60); }
function photoSrc(path){
  if(!path) return "";
  if(pendingPhotoUrls[path]) return pendingPhotoUrls[path];
  const c = photoCache[path], now = Date.now();
  if(c && c.exp > now) return c.url;
  if(!c || !c.failed || now - c.failed > 30000) wantPhoto(path);
  return c && c.url ? c.url : "";   // an out-of-date link still opens a photo this device has saved
}
// a promise for a working link: for screens that open once and aren't redrawn (forms, the photo viewer)
function photoUrl(path){
  if(!path) return Promise.resolve("");
  const u = photoSrc(path), c = photoCache[path];
  if(pendingPhotoUrls[path] || (c && c.exp > Date.now())) return Promise.resolve(u);
  return new Promise(res => (photoWaiters[path] ||= []).push(res));
}
function hydratePhotos(){
  for(const el of document.querySelectorAll("img[data-ph]")){ const u = photoSrc(el.dataset.ph); if(u && el.getAttribute("src") !== u) el.src = u; }
}
async function fetchPhotoUrls(){
  clearTimeout(photoTimer);
  const paths = [...photoWant].filter(p => !pendingPhotoUrls[p]);
  if(!paths.length){ photoWant = new Set(); return; }
  if(!navigator.onLine || !me) return;   // still wanted: asked again when the connection is back
  photoWant = new Set();
  try{
    const now = Date.now();
    for(let i = 0; i < paths.length; i += 100){
      const { data, error } = await sb.storage.from("photos").createSignedUrls(paths.slice(i, i + 100), PH_TTL);
      if(error) throw error;
      for(const d of data || []){ if(!d.path) continue;
        if(d.signedUrl) photoCache[d.path] = { url:d.signedUrl, exp:now + (PH_TTL - 1800) * 1000, at:now };
        else photoCache[d.path] = { url:photoCache[d.path]?.url || "", exp:0, failed:now, at:photoCache[d.path]?.at }; }
    }
    photoRetry = 0;
    for(const p of paths){ const w = photoWaiters[p]; if(w){ delete photoWaiters[p]; const u = photoCache[p]?.url || ""; w.forEach(f => f(u)); } }
    savePhotoCache(); hydratePhotos(); renderAll();
  }catch(e){
    console.warn("photo links", e);
    for(const p of paths) photoWant.add(p);
    photoRetry = Math.min(60000, (photoRetry || 2000) * 2); photoTimer = setTimeout(fetchPhotoUrls, photoRetry);
  }
}
window.addEventListener("online", () => { if(photoWant.size) fetchPhotoUrls(); });
// a photo that fails to load (an expired link, a dropped connection) asks for a fresh link once
document.addEventListener("error", e => {
  const el = e.target; if(!el || el.tagName !== "IMG" || !el.dataset.ph || el.dataset.phRetry) return;
  el.dataset.phRetry = "1"; const c = photoCache[el.dataset.ph]; if(c) c.exp = 0; wantPhoto(el.dataset.ph);
}, true);
function forgetPhotos(){ try{ localStorage.removeItem(photoKey()); }catch(e){} try{ return caches.delete("flylog-photos").catch(() => {}); }catch(e){} }

/* ---------- offline outbox ---------- */
let outbox = [];
const outboxKey = () => "fl.outbox." + (me?.id || "anon");
const cacheKey = () => "fl.cache." + (me?.id || "anon");
function saveOutbox(){ lsSet(outboxKey(), outbox); updateSync(); }
function saveCache(){ lsSet(cacheKey(), { catches, spots, trips, outings, groupTrips, friendCatches, friendSpots, friendTrips, friendships, people, profile, follows, tournaments, announcements, at:Date.now() }); }
function updateSync(){
  const el = $("sync"); const n = outbox.length;
  if(!navigator.onLine){ el.hidden = false; el.className = "sync"; el.innerHTML = `${icon("i-cloud-off")}Offline${n?` · ${n} to sync`:""}`; return; }
  if(n){ el.hidden = false; el.className = "sync" + (syncFailing ? " warn" : ""); el.textContent = syncFailing ? `${n} not synced yet` : `Syncing ${n}…`; return; }
  el.hidden = true;
}
let flushing = false, syncFailing = false;
async function flush(){
  if(flushing || !me || !navigator.onLine) { updateSync(); return; }
  flushing = true; updateSync();
  try{
    while(outbox.length){
      const job = outbox[0];
      try{
        if(job.op === "upsert"){
          for(const p of job.more || []){
            const b = await idb.get(p);
            if(b){ const { error } = await sb.storage.from("photos").upload(p, b, { contentType:"image/jpeg", upsert:true }); if(error) throw error; }
          }
          if(job.photo){
            const blob = await idb.get(job.photo);
            if(blob){
              const { error } = await sb.storage.from("photos").upload(job.photo, blob, { contentType:"image/jpeg", upsert:true });
              if(error) throw error;
            }
          }
          const { error } = await sb.from(job.table).upsert(job.row);
          if(error) throw error;
          if(job.table === "catches"){
            sb.rpc("auto_enter", { cid: job.row.id }).then(({ data }) => {
              if(job.isNew && data && data.length) toast(`Entered in ${data.join(", ")}`);
              if(data && data.length) loadTournaments();
            });
          }
          if(job.oldPhoto) await sb.storage.from("photos").remove([job.oldPhoto]);
          if(job.oldMore?.length) await sb.storage.from("photos").remove(job.oldMore);
          for(const p of job.more || []) await idb.del(p).catch(()=>{});
          if(job.photo){ await idb.del(job.photo).catch(()=>{}); }
          const rec = listFor(job.table).find(r => r.id === job.row.id); if(rec) delete rec._pending;
        } else if(job.op === "delete"){
          const { error } = await sb.from(job.table).delete().eq("id", job.id);
          if(error) throw error;
          const gone = [job.photo, ...(job.more || [])].filter(Boolean);
          if(gone.length) await sb.storage.from("photos").remove(gone);
        }
        outbox.shift(); saveOutbox(); syncFailing = false;
      }catch(e){
        const status = e && (e.status || e.statusCode);
        const offline = !navigator.onLine || (e && /fetch|network|Load failed/i.test(String(e.message || e)));
        if(offline){ break; }
        console.error("sync", job, e);
        if(status && String(status).startsWith("4")){ outbox.shift(); saveOutbox(); toast(e && /tournament/i.test(e.message || "") ? e.message : "One change couldn't be saved and was skipped."); setTimeout(loadAll, 1500); continue; }
        syncFailing = true; break;
      }
    }
  } finally { flushing = false; updateSync(); saveCache(); renderAll(); }
}
window.addEventListener("online", () => { loadAll(); flush(); });
window.addEventListener("offline", () => { updateSync(); if(loadState === "ready") { loadState = "offline"; renderLog(); } });
setInterval(() => { if(outbox.length) flush(); }, 30000);

async function saveRecord(table, rec, blob, isEdit, second){
  if(!me) throw Object.assign(new Error("signed out"), { userMessage:"Sign in to save." });
  const job = { op:"upsert", table, row: pick(table, rec), isNew: !isEdit };
  if(blob){
    const path = `${me.id}/${rec.id}-${Date.now()}.jpg`;
    await idb.put(path, blob);
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    if(isEdit && rec.photo_path) job.oldPhoto = rec.photo_path;
    rec.photo_path = path; job.row.photo_path = path; job.photo = path;
  }
  // second photo: second = { blob, hash } to add/replace, or { remove:true }
  if(second && table === "catches"){
    const old = morePaths(isEdit ? (listFor(table).find(r => r.id === rec.id) || {}) : {});
    if(second.blob){
      const path = `${me.id}/${rec.id}-2-${Date.now()}.jpg`;
      await idb.put(path, second.blob); pendingPhotoUrls[path] = URL.createObjectURL(second.blob);
      rec.more_photos = [{ p:path, h:second.hash || null }]; job.more = [path];
    } else if(second.remove) rec.more_photos = null;
    job.row.more_photos = rec.more_photos ?? null;
    if((second.blob || second.remove) && old.length) job.oldMore = old.filter(p => !pendingPhotoUrls[p]);
  }
  // newer edits of the same record replace a waiting one
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id && !j.photo && !j.more));
  outbox.push(job); saveOutbox();
  const list = listFor(table).filter(r => r.id !== rec.id);
  const prev = listFor(table).find(r => r.id === rec.id) || {};
  list.push({ ...prev, ...rec, user_id: me.id, created_at: prev.created_at || new Date().toISOString(), _pending:true });
  setList(table, list); saveCache(); renderAll();
  flush();
}
async function removeRecord(kind, rec){
  const table = kind === "catch" ? "catches" : kind === "spot" ? "spots" : kind === "outing" ? "outings" : "trips";
  setList(table, listFor(table).filter(r => r.id !== rec.id));
  if(table === "spots") catches.forEach(c => { if(c.spot_id === rec.id) c.spot_id = null; });
  if(table === "trips") catches.forEach(c => { if(c.trip_id === rec.id) c.trip_id = null; });
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id));
  outbox.push({ op:"delete", table, id:rec.id, photo: rec.photo_path && !pendingPhotoUrls[rec.photo_path] ? rec.photo_path : null, more: morePaths(rec).filter(p => !pendingPhotoUrls[p]) });
  saveOutbox(); saveCache(); renderAll();
  toast(`${kind === "catch" ? "Catch" : kind === "spot" ? "Spot" : kind === "outing" ? "Time on the water" : "Trip"} deleted`);
  flush();
}

/* ---------- loading everything for the signed-in angler ---------- */
async function loadAll(){
  loadPhotoCache();
  if(!me || !navigator.onLine) return;
  try{
    const [c, s, t, fc, fs, ft, fr, pr, fo, an, su] = await Promise.all([
      sb.from("catches").select("*").order("caught_on", { ascending:false }),
      sb.from("spots").select("*"),
      sb.from("trips").select("*").order("start_date", { ascending:false }),
      sb.rpc("friend_catches"), sb.rpc("friend_spots"), sb.rpc("friend_trips"),
      sb.from("friendships").select("*"),
      sb.from("profiles").select("*").eq("id", me.id).maybeSingle(),
      sb.rpc("my_follows"),
      sb.from("announcements").select("*").order("created_at", { ascending:false }).limit(5),
      sb.from("suggestions").select("*").eq("user_id", me.id).order("created_at", { ascending:false })
    ]);
    for(const r of [c, s, t, fc, fs, ft, fr, pr, fo, an, su]) if(r.error) throw r.error;
    follows = fo.data || []; announcements = an.data || []; mySuggestions = su.data || [];
    // keep local changes that haven't reached the server yet
    const merge = (table, rows) => {
      const pend = outbox.filter(j => j.table === table);
      const dels = new Set(pend.filter(j => j.op === "delete").map(j => j.id));
      const ups = pend.filter(j => j.op === "upsert").map(j => listFor(table).find(r => r.id === j.row.id)).filter(Boolean);
      const upIds = new Set(ups.map(r => r.id));
      return [...rows.filter(r => !dels.has(r.id) && !upIds.has(r.id)), ...ups];
    };
    catches = merge("catches", c.data); spots = merge("spots", s.data); trips = merge("trips", t.data);
    // newer tables: a problem here must never block the rest of the app
    try{ const [o, g] = await Promise.all([sb.from("outings").select("*").order("fished_on", { ascending:false }), sb.rpc("my_group_trips")]);
      if(!o.error) outings = merge("outings", o.data || []); if(!g.error) groupTrips = g.data || []; }catch(e){}
    friendCatches = fc.data || []; friendSpots = fs.data || []; friendTrips = ft.data || [];
    friendships = fr.data || []; profile = pr.data || profile;
    const ids = [...new Set(friendships.flatMap(f => [f.requester, f.addressee]).filter(id => id !== me.id))];
    if(ids.length){ const { data } = await sb.from("profiles").select("id, display_name, avatar_path, title, username, bio").in("id", ids); people = Object.fromEntries((data || []).map(p => [p.id, p])); }
    for(const c of catches){ photoSrc(c.photo_path); morePaths(c).forEach(photoSrc); }   // ask for every photo link in one go, so nothing waits later
    loadState = "ready"; saveCache(); applyPrefs(); renderAll();
    loadTournaments();
    if(applyGate()){ routeChannel(); setTimeout(tidyPush, 4000); if(profile && !profile.onboarded) openGuide(); else checkWhatsNew(); }
    if(isStaff()){ loadStaffList(); loadFlags(); loadReports(); }
    loadBlocks(); loadConvos();
    if(pendingDeepLink && accountState() === "ok"){ const h = pendingDeepLink; pendingDeepLink = null; setTimeout(() => openDeepLink(h), 300); }
    loadInbox(); touchActive(); setTimeout(nudgeOfflineRefresh, 4000); listenFriends(); setTimeout(backfillHashes, 4000); setTimeout(backfillWaters, 6000);
    loadAvatars([...follows.map(f => f.user_id), ...friendCatches.map(c => c.user_id)].filter(id => !people[id]));
  }catch(e){
    console.error("load", e);
    if(loadState === "loading") loadState = navigator.onLine ? "ready" : "offline";
    renderAll();
  }
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && me){ loadAll(); flush(); } });

/* ---------- friends ---------- */
async function addFriend(code){
  code = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if(code.length !== 6) throw new Error("Friend codes are 6 letters and numbers.");
  if(code === profile?.friend_code) throw new Error("That's your own code. Share it with a friend instead.");
  const { data, error } = await sb.from("profiles").select("id, display_name").eq("friend_code", code).maybeSingle();
  if(error) throw new Error("Couldn't look up that code. Check your connection and try again.");
  if(!data) throw new Error("No one has that friend code. Check it and try again.");
  const ins = await sb.from("friendships").insert({ addressee: data.id });
  if(ins.error){ if(ins.error.code === "23505") throw new Error(`You and ${data.display_name} are already connected or have a request waiting.`); throw new Error("Couldn't send the request. Try again."); }
  await loadAll();
  return data.display_name;
}
async function answerRequest(id, accept){
  const r = accept ? await sb.from("friendships").update({ status:"accepted" }).eq("id", id) : await sb.from("friendships").delete().eq("id", id);
  if(r.error) throw r.error;
  await loadAll();
}

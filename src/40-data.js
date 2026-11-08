
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
  catches: ["id","trip_id","spot_id","lat","lng","county","species","length_in","count","fly","caught_on","notes","photo_path","visibility","photo_taken_on","method"],
  spots: ["id","name","lat","lng","county","water","trout_class","target","notes","status","visibility"],
  trips: ["id","name","start_date","end_date","base","notes","shared","waters"]
};
const pick = (table, r) => { const o = {}; for(const k of COLS[table]) if(k in r) o[k] = r[k] === undefined ? null : r[k]; return o; };
const listFor = t => t === "catches" ? catches : t === "spots" ? spots : trips;
function setList(t, v){ if(t === "catches") catches = v; else if(t === "spots") spots = v; else trips = v; }

/* ---------- photo blobs waiting to upload (IndexedDB) ---------- */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("flylog", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("blobs", mode); const s = t.objectStore("blobs"); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { put:(k,v) => tx("readwrite", s => s.put(v, k)), get:k => tx("readonly", s => s.get(k)), del:k => tx("readwrite", s => s.delete(k)) };
})();

/* ---------- photo display: short-lived signed links, fetched in batches ---------- */
const photoCache = {}, pendingPhotoUrls = {};
let photoWant = new Set(), photoTimer = null;
function photoSrc(path){
  if(!path) return "";
  if(pendingPhotoUrls[path]) return pendingPhotoUrls[path];
  const c = photoCache[path];
  if(c && c.exp > Date.now()) return c.url;
  if(!c || !c.failed){ photoWant.add(path); clearTimeout(photoTimer); photoTimer = setTimeout(fetchPhotoUrls, 60); }
  return c ? c.url : "";
}
async function fetchPhotoUrls(){
  const paths = [...photoWant]; photoWant = new Set();
  if(!paths.length || !navigator.onLine || !me) return;
  try{
    const { data, error } = await sb.storage.from("photos").createSignedUrls(paths, 60*60*6);
    if(error) throw error;
    for(const d of data){ if(d.signedUrl) photoCache[d.path] = { url:d.signedUrl, exp:Date.now() + 5.5*3600*1000 }; else photoCache[d.path] = { url:"", exp:0, failed:true }; }
    renderAll();
  }catch(e){ console.warn("photo links", e); }
}

/* ---------- offline outbox ---------- */
let outbox = [];
const outboxKey = () => "fl.outbox." + (me?.id || "anon");
const cacheKey = () => "fl.cache." + (me?.id || "anon");
function saveOutbox(){ lsSet(outboxKey(), outbox); updateSync(); }
function saveCache(){ lsSet(cacheKey(), { catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile, follows, tournaments, announcements, at:Date.now() }); }
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
          if(job.photo){ await idb.del(job.photo).catch(()=>{}); }
          const rec = listFor(job.table).find(r => r.id === job.row.id); if(rec) delete rec._pending;
        } else if(job.op === "delete"){
          const { error } = await sb.from(job.table).delete().eq("id", job.id);
          if(error) throw error;
          if(job.photo) await sb.storage.from("photos").remove([job.photo]);
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

async function saveRecord(table, rec, blob, isEdit){
  if(!me) throw Object.assign(new Error("signed out"), { userMessage:"Sign in to save." });
  const job = { op:"upsert", table, row: pick(table, rec), isNew: !isEdit };
  if(blob){
    const path = `${me.id}/${rec.id}-${Date.now()}.jpg`;
    await idb.put(path, blob);
    pendingPhotoUrls[path] = URL.createObjectURL(blob);
    if(isEdit && rec.photo_path) job.oldPhoto = rec.photo_path;
    rec.photo_path = path; job.row.photo_path = path; job.photo = path;
  }
  // newer edits of the same record replace a waiting one
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id && !j.photo));
  outbox.push(job); saveOutbox();
  const list = listFor(table).filter(r => r.id !== rec.id);
  const prev = listFor(table).find(r => r.id === rec.id) || {};
  list.push({ ...prev, ...rec, user_id: me.id, created_at: prev.created_at || new Date().toISOString(), _pending:true });
  setList(table, list); saveCache(); renderAll();
  flush();
}
async function removeRecord(kind, rec){
  const table = kind === "catch" ? "catches" : kind === "spot" ? "spots" : "trips";
  setList(table, listFor(table).filter(r => r.id !== rec.id));
  if(table === "spots") catches.forEach(c => { if(c.spot_id === rec.id) c.spot_id = null; });
  if(table === "trips") catches.forEach(c => { if(c.trip_id === rec.id) c.trip_id = null; });
  outbox = outbox.filter(j => !(j.op === "upsert" && j.table === table && j.row.id === rec.id));
  outbox.push({ op:"delete", table, id:rec.id, photo: rec.photo_path && !pendingPhotoUrls[rec.photo_path] ? rec.photo_path : null });
  saveOutbox(); saveCache(); renderAll();
  toast(`${kind === "catch" ? "Catch" : kind === "spot" ? "Spot" : "Trip"} deleted`);
  flush();
}

/* ---------- loading everything for the signed-in angler ---------- */
async function loadAll(){
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
    friendCatches = fc.data || []; friendSpots = fs.data || []; friendTrips = ft.data || [];
    friendships = fr.data || []; profile = pr.data || profile;
    const ids = [...new Set(friendships.flatMap(f => [f.requester, f.addressee]).filter(id => id !== me.id))];
    if(ids.length){ const { data } = await sb.from("profiles").select("id, display_name, avatar_path, title").in("id", ids); people = Object.fromEntries((data || []).map(p => [p.id, p])); }
    loadState = "ready"; saveCache(); renderAll();
    loadTournaments();
    if(applyGate()){ if(profile && !profile.onboarded) openGuide(); else checkWhatsNew(); }
    if(isStaff()) loadStaffList();
    loadInbox();
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

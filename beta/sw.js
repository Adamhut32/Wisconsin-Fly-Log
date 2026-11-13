// Offline support: the app itself is fetched fresh when online (falling back to the
// saved copy offline); map data is kept once loaded, so opened counties work offline.
const VERSION = "flylog-beta-v33";
const SHELL = ["./", "index.html", "css/app.css", "js/config.js", "js/app.js", "../vendor/leaflet.js", "../vendor/leaflet.css", "../vendor/supabase.js",
  "manifest.webmanifest", "../icons/icon-192.png", "../icons/apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION + "-shell").then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(VERSION.replace(/\d+$/, "")) && !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  // map data and fonts: keep the first copy (data URLs carry a version number)
  if((url.origin === location.origin && url.pathname.includes("/data/")) || url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com"){
    e.respondWith(caches.open("flylog-data").then(async c => {
      const hit = await c.match(req); if(hit) return hit;
      const res = await fetch(req); if(res.ok || res.type === "opaque") c.put(req, res.clone()); return res;
    }));
    return;
  }
  // catch and trip photos: keep each one after its first load, so it opens instantly and with no signal.
  // A photo's address never changes; only the short-lived key on the end does, so the saved copy is found by address alone.
  if(url.hostname.endsWith(".supabase.co") && url.pathname.includes("/storage/v1/object/sign/photos/")){
    e.respondWith(photo(req, url));
    return;
  }
  // the app itself: network first, saved copy when offline
  if(url.origin === location.origin){
    e.respondWith(fetch(req).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(VERSION + "-shell").then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch:true })) || (req.mode === "navigate" ? caches.match("index.html") : Response.error())));
  }
});

const PHOTO_CACHE = "flylog-photos", PHOTO_KEEP = 150;
async function photo(req, url){
  const key = url.origin + url.pathname;
  let c = null;
  try{ c = await caches.open(PHOTO_CACHE); const hit = await c.match(key); if(hit) return hit; }catch(_){}
  let res;
  try{ res = await fetch(req.url, { mode:"cors", credentials:"omit" }); }catch(_){ return fetch(req); }
  if(res.ok && c){
    c.put(key, res.clone()).then(async () => { const keys = await c.keys(); for(const k of keys.slice(0, Math.max(0, keys.length - PHOTO_KEEP))) await c.delete(k); }).catch(() => {});
  }
  return res;
}

// push notifications: show them, and open the right screen when tapped
self.addEventListener("push", e => {
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){ d = { title:"Coulee", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Coulee", { body: d.body || "", tag: d.tag || "coulee", renotify: d.tag === "message",
    icon: "../icons/icon-192.png", badge: "../icons/icon-192.png", data: { url: d.url || "" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "";
  e.waitUntil(self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(list => {
    for(const c of list){ if("focus" in c){ c.postMessage({ type:"open", url }); return c.focus(); } }
    return self.clients.openWindow("./" + url);
  }));
});

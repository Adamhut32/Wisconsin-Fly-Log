
/* ---------- setup guide for new accounts ---------- */
const GUIDE = () => [
  { t:"Welcome to Coulee", b:`<p>Coulee is a map of every named creek and lake in Wisconsin, with DNR trout classes, regulations and public land, plus a log for your spots, catches and trips.</p><p class="muted">This takes about a minute. You can replay it any time from Me → Setup guide.</p>` },
  ...(!isStandalone ? [{ t:"Put it on your home screen", b: isIOS
    ? `<ol class="steps"><li>Make sure this page is open in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>From now on, open the app from that icon. It opens full screen and works offline.</li></ol>`
    : `<p>Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Then open it from the icon.</p>` }] : []),
  { t:"Let your camera save locations", b:`<p>Photos can fill in where you caught a fish, but only if your camera saves the location.</p>
      <ol class="steps"><li>Open the iPhone <b>Settings</b> app.</li><li>Tap <b>Privacy &amp; Security</b>, then <b>Location Services</b>.</li><li>Make sure <b>Location Services</b> is on.</li><li>Tap <b>Camera</b> and choose <b>While Using the App</b>.</li><li>Turn on <b>Precise Location</b>.</li></ol>
      <p class="muted">Photos you take after this carry their location. If a photo still doesn't fill it in, tap <b>Here</b> while you're at the water.</p>
      <div class="row2"><button class="btn sm ink" type="button" data-camhelp>Show me with pictures</button><span class="hint">and test a photo</span></div>` },
  { t:"Allow location for the Here button", b:`<p>When you tap <b>Here</b> while logging a catch, your phone asks to share your location with the app. Tap <b>Allow</b>.</p>
      <p>Tapped Don't Allow by mistake? Go to <b>Settings → Privacy &amp; Security → Location Services → Safari Websites</b> and choose <b>While Using the App</b>.</p>
      <div class="row2"><button class="btn sm" type="button" id="guideGps">${icon("i-gps")}Try it now</button><span class="hint" id="guideGpsMsg"></span></div>` },
  { t:"Turn on notifications", b:notifyStepHtml() },
  { t:"The map", at:"#map", b:`<p><b>Tap a county</b> to see every named creek, river and lake in it. Colored bands are DNR trout classes (green Class I, gold II, rust III), and green shading is public land.</p><p class="muted">Tap any creek for its name, season and the nearest regulation.</p>` },
  { t:"Search", at:".search", b:`<p>Type any creek or lake name to jump straight to it.</p>` },
  { t:"Where am I", at:".locbtn", b:`<p>Shows where you're standing and the creek you're on. From there, <b>Add spot here</b> or <b>Log a catch here</b> in one tap.</p>` },
  { t:"Spots and catches", at:"#addCatchBtn", also:"#addSpotBtn", b:`<p><b>Add spot</b> saves water to try. <b>Log a catch</b> takes a photo, species, length or weight, and the fly or lure; the photo fills in where and when.</p><p class="muted">No signal? Log anyway. It syncs later.</p>` },
  { t:"Trips", at:'.tabs [data-tab="trips"]', open:true, b:`<p>Set dates and every catch from those days joins the trip. Plan ahead by adding creeks and lakes you want to hit.</p>` },
  { t:"Tournaments", at:'.tabs [data-tab="tourney"]', open:true, b:`<p>Make a tournament with friends: dates, area, species and scoring. Fish that fit are entered on their own.</p>` },
  { t:"Friends", at:'.tabs [data-tab="friends"]', open:true, b:`<p>Find friends by name or friend code${profile?.friend_code ? ` (yours is <b style="font-family:var(--f-data);letter-spacing:.1em">${esc(profile.friend_code)}</b>)` : ""}. Messages and Forums are in here too.</p>` },
  { t:"Your stats", at:'.tabs [data-tab="stats"]', open:true, b:`<p>Every catch you've logged, with filters, your best water, and the titles you're working toward.</p>` },
  { t:"Me", at:'.tabs [data-tab="me"]', open:true, b:`<p>Turn on <b>notifications</b>, tell Coulee <b>how you fish</b>, add a profile picture, and find Help and Suggestions.</p>` },
  { t:"You're set", b:`<p>Tap a county to start exploring, or log your first fish.</p><p class="muted">Help and Suggestions are in the Me tab. Suggestions go straight to the founder.</p>` }
];
function notifyStepHtml(){
  const intro = `<p>Get a notification when a friend adds you, sends a message, invites you to a tournament or logs a fish for you.</p>`;
  if(!pushSupported()) return intro + (isIOS && !isStandalone
    ? `<p>On iPhone this works once Coulee is on your Home Screen (iOS 16.4 or newer). Add it, open Coulee from the icon, then turn them on in <b>Me → Notifications</b>.</p>`
    : `<p class="muted">This browser can't show notifications. On iPhone, open Coulee from the Home Screen icon. On Android, use Chrome. You can turn them on later in <b>Me → Notifications</b>.</p>`);
  if(Notification.permission === "denied") return intro + `<p>Notifications are blocked for Coulee right now. Turn them on in <b>Settings → Notifications → Coulee</b> (iPhone) or your browser's site settings, then tap below.</p>` + notifyBtn();
  return intro + `<p class="muted">Your phone will ask once. Tap <b>Allow</b>. You can pick which ones you get, or turn them off, in <b>Me → Notifications</b>.</p>` + notifyBtn();
}
const notifyBtn = () => `<div class="row2"><button class="btn sm ink" type="button" id="guideNotif">${icon("i-bell")}Turn on notifications</button><span class="hint" id="guideNotifMsg"></span></div>`;
let guideStep = 0, guideSteps = [];
function openGuide(replay){
  if(!$("guide").hidden) return;
  guideSteps = GUIDE(); guideStep = 0; renderGuide(); $("guide").hidden = false;
}
function renderGuide(){
  const s = guideSteps[guideStep];
  placeCoach(s);
  $("guideDots").innerHTML = guideSteps.map((_, i) => `<i class="${i === guideStep ? "on" : i < guideStep ? "done" : ""}"></i>`).join("");
  $("guideBody").innerHTML = `<div class="eyebrow">Step ${guideStep + 1} of ${guideSteps.length}</div><h3 id="guideTitle">${esc(s.t)}</h3><div class="gbody">${s.b}</div>`;
  $("guideBack").hidden = guideStep === 0;
  $("guideNext").textContent = guideStep === guideSteps.length - 1 ? "Start fishing" : "Next";
  $("guideSkip").hidden = guideStep === guideSteps.length - 1;
  const n = $("guideNotif");
  if(n){ refreshPushState().then(() => { if(pushStateV === "on" && $("guideNotif")){ $("guideNotif").hidden = true; $("guideNotifMsg").className = "hint ok"; $("guideNotifMsg").textContent = "Notifications are already on for this phone."; } });
    n.onclick = async () => {
      const m = $("guideNotifMsg"); n.disabled = true; m.className = "hint"; m.textContent = "Asking your phone…";
      await enablePush(); await refreshPushState();
      if(pushStateV === "on"){ n.hidden = true; m.className = "hint ok"; m.textContent = "Notifications are on. A test is on its way."; }
      else { n.disabled = false; m.className = "hint bad"; m.textContent = pushStateV === "denied" ? "Blocked. Use Settings → Notifications → Coulee, then try again." : "Not turned on. You can do it later in Me → Notifications."; }
    }; }
  const g = $("guideGps");
  if(g) g.onclick = () => {
    const m = $("guideGpsMsg"); m.className = "hint"; m.textContent = "Asking for your location…";
    if(!navigator.geolocation){ m.className = "hint bad"; m.textContent = "This browser can't share location."; return; }
    navigator.geolocation.getCurrentPosition(pos => { const cid = countyAt(pos.coords.latitude, pos.coords.longitude); m.className = "hint ok"; m.textContent = cid ? `It works. You're in ${countyName(cid)}.` : "It works."; },
      err => { m.className = "hint bad"; m.textContent = err.code === 1 ? "Location is blocked. Use the Settings steps above, then try again." : "Couldn't get a fix. Try again outside."; }, { enableHighAccuracy:true, timeout:15000 });
  };
}
async function finishGuide(){
  $("guide").hidden = true; $("coachRing").hidden = true; coachDim.hidden = true; $("guide").classList.remove("coach"); $("guide").querySelector(".sheet").style.cssText = "";
  if(profile && !profile.onboarded){ const last = await latestReleaseId().catch(() => 0); profile.onboarded = true; profile.last_seen_release = last; saveCache();
    await sb.from("profiles").update({ onboarded:true, last_seen_release:last }).eq("id", me.id); }
}
$("guideNext").onclick = () => { if(guideStep < guideSteps.length - 1){ guideStep++; renderGuide(); $("guide").querySelector(".sheet").scrollTop = 0; } else finishGuide(); };
$("guideBack").onclick = () => { if(guideStep > 0){ guideStep--; renderGuide(); } };
$("guideSkip").onclick = finishGuide;

/* coach marks: point at the real thing on screen */
// the ring's darkening must sit at the top of the page, or the app's layout clips it
document.body.appendChild($("coachRing"));
// darken everything except a hole around the item (a cut-out overlay; big box-shadows don't draw reliably everywhere)
const coachDim = document.createElement("div"); coachDim.className = "coachDim"; coachDim.hidden = true; document.body.appendChild(coachDim);
function placeCoach(s){
  const g = $("guide"), ring = $("coachRing"), sheet = g.querySelector(".sheet");
  const el = s.at && document.querySelector(s.at);
  if(!el){ g.classList.remove("coach"); ring.hidden = true; coachDim.hidden = true; sheet.style.cssText = ""; return; }
  if(s.open && typeof panelCollapsed !== "undefined" && panelCollapsed) setCollapsed(false, false);
  if(s.at === "#map" || s.at === ".search" || s.at === ".locbtn" || s.at === "#addCatchBtn"){ if(tab !== "map") setTab("map"); }
  g.classList.add("coach");
  requestAnimationFrame(() => setTimeout(() => {
    const r = el.getBoundingClientRect(), r2 = s.also ? document.querySelector(s.also)?.getBoundingClientRect() : null;
    const box = r2 ? { left:Math.min(r.left, r2.left), top:Math.min(r.top, r2.top), right:Math.max(r.right, r2.right), bottom:Math.max(r.bottom, r2.bottom) } : r;
    const pad = s.at === "#map" ? -12 : 6, vw = innerWidth, vh = innerHeight;
    Object.assign(ring.style, { left:box.left - pad + "px", top:box.top - pad + "px", width:(box.right - box.left) + pad * 2 + "px", height:(box.bottom - box.top) + pad * 2 + "px" });
    ring.hidden = false;
    const x1 = box.left - pad, y1 = box.top - pad, x2 = box.right + pad, y2 = box.bottom + pad;
    coachDim.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
    coachDim.hidden = false;
    const w = Math.min(340, vw - 32), cy = (box.top + box.bottom) / 2;
    const below = s.at === "#map" ? false : cy < vh / 2;
    sheet.style.cssText = `position:fixed;width:${w}px;left:${Math.max(16, Math.min(vw - w - 16, (box.left + box.right) / 2 - w / 2))}px;${below ? `top:${Math.min(vh - 220, box.bottom + pad + 12)}px` : `bottom:${Math.max(16, vh - (s.at === "#map" ? box.bottom - 24 : box.top - pad - 12))}px`};max-height:${Math.round(vh * .5)}px`;
    // keep the card off the thing it's pointing at: try below, above, then beside it
    if(s.at !== "#map"){
      const h = Math.min(sheet.offsetHeight || 260, vh * .5), m = 12, cx = (box.left + box.right) / 2;
      const clampX = x => Math.max(16, Math.min(vw - w - 16, x)), clampY = y => Math.max(16, Math.min(vh - h - 16, y));
      const tries = [
        { l:clampX(cx - w / 2), t:box.bottom + pad + m }, { l:clampX(cx - w / 2), t:box.top - pad - m - h },
        { l:box.left - pad - m - w, t:clampY(cy - h / 2) }, { l:box.right + pad + m, t:clampY(cy - h / 2) }];
      const hits = c => !(c.l + w <= x1 || c.l >= x2 || c.t + h <= y1 || c.t >= y2);
      const fits = c => c.l >= 8 && c.t >= 8 && c.l + w <= vw - 8 && c.t + h <= vh - 8 && !hits(c);
      const pick = (below ? tries : [tries[1], tries[0], tries[2], tries[3]]).find(fits);
      if(pick) Object.assign(sheet.style, { left:pick.l + "px", top:pick.t + "px", bottom:"auto" });
    }
  }, 280));
}
window.addEventListener("resize", () => { if(!$("guide").hidden) placeCoach(guideSteps[guideStep]); });

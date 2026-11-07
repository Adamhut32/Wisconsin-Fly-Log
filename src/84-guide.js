
/* ---------- setup guide for new accounts ---------- */
const GUIDE = () => [
  { t:"Welcome to Coulee", b:`<p>Coulee is a map of every named creek and lake in Wisconsin, with DNR trout classes, regulations and public land, plus a log for your spots, catches and trips.</p><p class="muted">This takes about a minute. You can replay it any time from Me → Setup guide.</p>` },
  ...(!isStandalone ? [{ t:"Put it on your home screen", b: isIOS
    ? `<ol class="steps"><li>Make sure this page is open in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>From now on, open the app from that icon. It opens full screen and works offline.</li></ol>`
    : `<p>Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Then open it from the icon.</p>` }] : []),
  { t:"Let your camera save locations", b:`<p>Photos can fill in where you caught a fish, but only if your camera saves the location.</p>
      <ol class="steps"><li>Open the iPhone <b>Settings</b> app.</li><li>Tap <b>Privacy &amp; Security</b>, then <b>Location Services</b>.</li><li>Make sure <b>Location Services</b> is on.</li><li>Tap <b>Camera</b> and choose <b>While Using the App</b>.</li><li>Turn on <b>Precise Location</b>.</li></ol>
      <p class="muted">Photos you take after this carry their location. If a photo still doesn't fill it in, tap <b>Here</b> while you're at the water.</p>` },
  { t:"Allow location for the Here button", b:`<p>When you tap <b>Here</b> while logging a catch, your phone asks to share your location with the app. Tap <b>Allow</b>.</p>
      <p>Tapped Don't Allow by mistake? Go to <b>Settings → Privacy &amp; Security → Location Services → Safari Websites</b> and choose <b>While Using the App</b>.</p>
      <div class="row2"><button class="btn sm" type="button" id="guideGps">${icon("i-gps")}Try it now</button><span class="hint" id="guideGpsMsg"></span></div>` },
  { t:"Find water", b:`<ul class="steps"><li><b>Tap a county</b> to see every named creek, river and lake in it.</li><li><b>Colored bands</b> are DNR trout classes: green Class I, gold Class II, rust Class III.</li><li><b>Tap a creek</b> for its name, the trout season status and the nearest regulation.</li><li><b>Green shading</b> is public land and fishing easements.</li><li><b>Search</b> any creek or lake by name at the top of the map.</li></ul>` },
  { t:"Log spots and catches", b:`<ul class="steps"><li><b>Add spot</b> saves water to try. Mark it Want to try, Scouted or Fished.</li><li><b>Log a catch</b> with a photo, species, length and fly.</li><li><b>Friends see</b> lets you choose Exact spot, County only or Nothing for every entry. Spots start private.</li><li>No signal? Log anyway. It syncs when you're back in range.</li></ul>` },
  { t:"Trips and tournaments", b:`<ul class="steps"><li><b>Trips</b>: set the dates and every catch from those days joins the trip, with a recap at the end.</li><li><b>Tournaments</b>: pick dates, an area, species and scoring, and invite friends. Fish that fit are entered automatically. Photo tournaments only accept photos taken during the tournament.</li></ul>` },
  { t:"Friends and following", b:`<ul class="steps"><li><b>Friends</b>: share your friend code${profile?.friend_code ? ` (<b style="font-family:var(--f-data);letter-spacing:.1em">${esc(profile.friend_code)}</b>)` : ""}. Friends see each other's shared catches and leaderboards.</li><li><b>Following</b>: follow anglers with public profiles without needing their OK. Turn on your own public profile in the Me tab if you want followers.</li></ul>` },
  { t:"You're set", b:`<p>Tap a county to start exploring, or log your first fish.</p><p class="muted">Help and Suggestions are in the Me tab. Suggestions go straight to the founder.</p>` }
];
let guideStep = 0, guideSteps = [];
function openGuide(replay){
  if(!$("guide").hidden) return;
  guideSteps = GUIDE(); guideStep = 0; renderGuide(); $("guide").hidden = false;
}
function renderGuide(){
  const s = guideSteps[guideStep];
  $("guideDots").innerHTML = guideSteps.map((_, i) => `<i class="${i === guideStep ? "on" : i < guideStep ? "done" : ""}"></i>`).join("");
  $("guideBody").innerHTML = `<div class="eyebrow">Step ${guideStep + 1} of ${guideSteps.length}</div><h3 id="guideTitle">${esc(s.t)}</h3><div class="gbody">${s.b}</div>`;
  $("guideBack").hidden = guideStep === 0;
  $("guideNext").textContent = guideStep === guideSteps.length - 1 ? "Start fishing" : "Next";
  $("guideSkip").hidden = guideStep === guideSteps.length - 1;
  const g = $("guideGps");
  if(g) g.onclick = () => {
    const m = $("guideGpsMsg"); m.className = "hint"; m.textContent = "Asking for your location…";
    if(!navigator.geolocation){ m.className = "hint bad"; m.textContent = "This browser can't share location."; return; }
    navigator.geolocation.getCurrentPosition(pos => { const cid = countyAt(pos.coords.latitude, pos.coords.longitude); m.className = "hint ok"; m.textContent = cid ? `It works. You're in ${countyName(cid)}.` : "It works."; },
      err => { m.className = "hint bad"; m.textContent = err.code === 1 ? "Location is blocked. Use the Settings steps above, then try again." : "Couldn't get a fix. Try again outside."; }, { enableHighAccuracy:true, timeout:15000 });
  };
}
async function finishGuide(){
  $("guide").hidden = true;
  if(profile && !profile.onboarded){ const last = await latestReleaseId().catch(() => 0); profile.onboarded = true; profile.last_seen_release = last; saveCache();
    await sb.from("profiles").update({ onboarded:true, last_seen_release:last }).eq("id", me.id); }
}
$("guideNext").onclick = () => { if(guideStep < guideSteps.length - 1){ guideStep++; renderGuide(); $("guide").querySelector(".sheet").scrollTop = 0; } else finishGuide(); };
$("guideBack").onclick = () => { if(guideStep > 0){ guideStep--; renderGuide(); } };
$("guideSkip").onclick = finishGuide;

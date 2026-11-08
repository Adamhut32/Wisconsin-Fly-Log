
/* ---------- step-by-step help for saving photo locations, with a photo checker ---------- */
const CAM_PATH = { ios:"Settings → Privacy & Security → Location Services → Camera → While Using the App, and turn on Precise Location",
  android:"Camera app → Settings (gear) → Location tags (or Save location) → On" };
// a small drawing of each settings screen, with the row to tap marked
const phone = (title, rows) => `<div class="phone"><div class="ph-top"><span>${esc(title)}</span></div>${rows.map(([t, o = {}]) =>
  `<div class="ph-row${o.hit ? " hit" : ""}${o.dim ? " dim" : ""}"><span>${o.check ? "✓ " : ""}${esc(t)}</span>${o.toggle != null ? `<i class="tg${o.toggle ? " on" : ""}"></i>` : o.value ? `<em>${esc(o.value)}</em>` : o.check || (o.dim && title === "Camera") ? "" : `<b>›</b>`}</div>`).join("")}</div>`;
const CAM_STEPS = {
  ios: [
    ["Open the Settings app", "It's the gray gear on your Home Screen. Scroll down to <b>Privacy &amp; Security</b> and tap it.",
      phone("Settings", [["Screen Time"], ["General"], ["Privacy & Security", { hit:true }], ["App Store", { dim:true }]])],
    ["Tap Location Services", "It's the first row. Make sure the switch at the top of the next screen is <b>on</b>.",
      phone("Privacy & Security", [["Location Services", { hit:true, value:"On" }], ["Tracking", { dim:true }], ["Contacts", { dim:true }]])],
    ["Find Camera in the list", "Scroll down the list of apps and tap <b>Camera</b>.",
      phone("Location Services", [["Location Services", { toggle:true }], ["Calendar", { dim:true, value:"Never" }], ["Camera", { hit:true, value:"Never" }], ["Clock", { dim:true, value:"Never" }]])],
    ["Choose While Using the App", "Then turn on <b>Precise Location</b> so it pins the exact bend in the creek, not just the area.",
      phone("Camera", [["Never", { dim:true }], ["Ask Next Time", { dim:true }], ["While Using the App", { hit:true, check:true }], ["Precise Location", { hit:true, toggle:true }]])]
  ],
  android: [
    ["Open your Camera app", "Tap the <b>gear</b> (Settings) in the camera. On some phones it's under the ☰ or ⋮ menu.",
      phone("Camera", [["Photo", { dim:true }], ["Settings", { hit:true }]])],
    ["Turn on location", "Look for <b>Location tags</b>, <b>Save location</b> or <b>Geotag</b> and switch it on.",
      phone("Camera settings", [["Grid lines", { dim:true, toggle:false }], ["Location tags", { hit:true, toggle:true }], ["Shutter sound", { dim:true, toggle:true }]])],
    ["Allow location for the camera", "If your phone asks, allow location <b>While using the app</b>, with precise location on.", ""]
  ]
};
let camOs = isIOS ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "ios";
function renderCamSteps(){
  $("camOs").querySelectorAll("[data-os]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.os === camOs)));
  $("camSteps").innerHTML = `<ol class="camsteps">${CAM_STEPS[camOs].map(([t, d, pic]) => `<li><b>${t}</b><p>${d}</p>${pic}</li>`).join("")}</ol>
    <div class="campath"><small>${esc(CAM_PATH[camOs])}</small><button class="btn sm" type="button" id="camCopy">Copy steps</button></div>
    <p class="muted" style="font-size:13px;margin:6px 0 0">Your phone won't let apps open these settings for you, so switch to Settings, follow the steps, then come back.${camOs === "ios" ? " Photos you already took won't gain a location; new ones will." : ""}</p>`;
}
function openCamHelp(){ renderCamSteps(); $("camResult").innerHTML = ""; $("camTest").value = ""; $("camHelp").hidden = false; $("camHelp").querySelector(".sheet").scrollTop = 0; }
$("camOs").addEventListener("click", e => { const b = e.target.closest("[data-os]"); if(b){ camOs = b.dataset.os; renderCamSteps(); } });
$("camDone").onclick = () => { $("camHelp").hidden = true; };
$("camHelp").addEventListener("click", async e => {
  if(e.target === $("camHelp")) $("camHelp").hidden = true;
  if(e.target.id === "camCopy"){ try{ await navigator.clipboard.writeText(CAM_PATH[camOs]); toast("Copied. Open Settings and follow along."); }catch(_){ toast(CAM_PATH[camOs]); } }
});
document.addEventListener("click", e => { if(e.target.closest("[data-camhelp]")){ e.preventDefault(); openCamHelp(); } });
$("camTest").addEventListener("change", async () => {
  const f = $("camTest").files[0], out = $("camResult"); if(!f) return;
  let ex = null; try{ ex = readExif(await f.arrayBuffer()); }catch(e){}
  const gps = ex && ex.lat != null, date = ex && ex.date;
  const where = gps ? countyAt(ex.lat, ex.lng) : null;
  const line = (ok, t) => `<li class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${t}</li>`;
  out.innerHTML = `<ul class="camcheck">${line(gps, gps ? `Location saved${where ? ` (${esc(countyName(where))})` : ""}` : "No location in this photo")}${line(!!date, date ? "Date saved" : "No date in this photo")}</ul>
    <p style="margin:6px 0 0">${gps && date ? "You're all set. Catches logged with photos like this fill in on their own."
      : gps ? "The location works. The missing date usually means a screenshot or an edited copy, so use the original photo."
      : date ? "Your camera isn't saving locations yet. Follow the steps above, take a new photo, and test again. If the setting is already on and this still says no location, your phone may be removing it when the photo is picked; tap <b>Here</b> at the water instead."
      : "This photo has no camera data at all. Screenshots, downloads and photos sent through some apps lose it. Test a photo taken with your Camera app."}</p>`;
});

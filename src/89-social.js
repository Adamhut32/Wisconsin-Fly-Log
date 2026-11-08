
/* ================= Phase 4: notifications, forums, messages, reports ================= */
const folks = {}; // id -> { display_name, avatar_path, title } for anyone we've shown
async function loadFolks(ids){
  ids = [...new Set(ids.filter(id => id && id !== me?.id && !folks[id]))];
  if(!ids.length) return;
  const { data } = await sb.from("profiles").select("id, display_name, avatar_path, title").in("id", ids.slice(0, 300));
  for(const p of data || []){ folks[p.id] = p; avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; }
}
const nameOf = id => id === me?.id ? (profile?.display_name || "You") : (folks[id]?.display_name || people[id]?.display_name || "Angler");
const ago = ts => { const s = (Date.now() - new Date(ts)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 604800 ? `${Math.floor(s / 86400)}d` : fmtDate(String(ts).slice(0, 10)); };
const paras = t => esc(t).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

/* ---------- blocking ---------- */
let blocks = new Set(lsGet("fl.blocks", []));
async function loadBlocks(){ const { data, error } = await sb.from("user_blocks").select("blocked"); if(!error){ blocks = new Set((data || []).map(b => b.blocked)); lsSet("fl.blocks", [...blocks]); } }
async function setBlock(id, on){
  const r = on ? await sb.from("user_blocks").insert({ blocker:me.id, blocked:id }) : await sb.from("user_blocks").delete().eq("blocker", me.id).eq("blocked", id);
  if(r.error && !/duplicate/.test(r.error.message || "")){ toast("Couldn't update. Try again."); return; }
  if(on) blocks.add(id); else blocks.delete(id); lsSet("fl.blocks", [...blocks]);
  toast(on ? `Blocked ${nameOf(id)}. They can't message you, and their posts are tucked away.` : `Unblocked ${nameOf(id)}.`); renderLog();
}

/* ---------- reports ---------- */
function reportForm(kind, ref, slot){
  slot.innerHTML = `<div class="card" style="margin-top:6px"><div class="field"><label>What's wrong?</label>
    <select data-repwhy><option>Rude or harassing</option><option>Hateful or offensive</option><option>Spam or ads</option><option>Sharing someone's private spot or info</option><option>Something else</option></select></div>
    <input data-repmore maxlength="300" placeholder="Anything else the reviewer should know (optional)">
    <div class="row2" style="margin-top:6px"><button class="btn sm ink" type="button" data-repgo="${esc(kind)}:${esc(ref)}">Send report</button><button class="link" type="button" data-repcancel>Cancel</button></div></div>`;
}
$("log").addEventListener("click", async e => {
  const r = e.target.closest("[data-report]");
  if(r){ const [kind, ref] = r.dataset.report.split(":"); const slot = r.closest("[data-rslot]")?.querySelector(".rslot") || r.parentElement.nextElementSibling; if(slot) reportForm(kind, ref, slot); return; }
  if(e.target.closest("[data-repcancel]")){ e.target.closest(".card").remove(); return; }
  const g = e.target.closest("[data-repgo]");
  if(g){ const [kind, ref] = g.dataset.repgo.split(":"), card = g.closest(".card");
    const reason = [card.querySelector("[data-repwhy]").value, card.querySelector("[data-repmore]").value.trim()].filter(Boolean).join(": ");
    const { error } = await sb.from("reports").insert({ reporter:me.id, kind, ref, reason });
    card.remove(); toast(error && !/duplicate/.test(error.message || "") ? "Couldn't send the report." : "Reported. A reviewer will take a look. Thanks."); }
});

/* ---------- push notifications ---------- */
const PUSH_CATS = [["catches","Friends' catches"],["friends","Friend requests"],["messages","Messages"],["tourneys","Tournament invites, changes and catches"],["fish","Fish logged for you, fair-play notices"],["forum","Replies to your forum threads"]];
let pushStateV = null;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function refreshPushState(){
  let s;
  if(!pushSupported()) s = isIOS && !isStandalone ? "ios-install" : "unsupported";
  else if(Notification.permission === "denied") s = "denied";
  else { try{ const reg = await navigator.serviceWorker.ready; s = (await reg.pushManager.getSubscription()) ? "on" : "off"; }catch(e){ s = "off"; } }
  if(s !== pushStateV){ pushStateV = s; if(tab === "me" && meView === "main") renderLog(); }
}
async function enablePush(){
  try{
    const perm = await Notification.requestPermission();
    if(perm !== "granted"){ toast(perm === "denied" ? "Notifications are blocked. Turn them on in Settings → Notifications → Coulee." : "Notifications weren't turned on."); return refreshPushState(); }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64u(CFG.vapidPublic) });
    const j = sub.toJSON();
    await sb.from("push_subscriptions").delete().eq("endpoint", j.endpoint);
    const { error } = await sb.from("push_subscriptions").insert({ user_id:me.id, endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, ua:navigator.userAgent.slice(0, 120) });
    if(error) throw error;
    toast("Notifications are on. Sending a test…"); sb.rpc("push_test");
  }catch(e){ console.error(e); toast("Couldn't turn on notifications. Try again."); }
  refreshPushState();
}
async function disablePush(){
  try{ const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if(sub){ await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } }catch(e){}
  toast("Notifications are off on this device."); refreshPushState();
}
function notifyCardHtml(){
  if(pushStateV === null) refreshPushState();
  const p = profile?.push_prefs || {};
  const s = pushStateV;
  const body = s === "ios-install" ? `<p>On iPhone, notifications work once Coulee is on your Home Screen: in Safari tap <b>Share</b> → <b>Add to Home Screen</b>, then open Coulee from that icon and come back here. Needs iOS 16.4 or newer.</p>`
    : s === "unsupported" ? `<p>This browser can't show notifications from Coulee. On iPhone, open it from the Home Screen icon. On Android, use Chrome.</p>`
    : s === "denied" ? `<p>Notifications are blocked for Coulee. Turn them on in <b>Settings → Notifications → Coulee</b> (iPhone) or your browser's site settings, then come back.</p>`
    : s === "on" ? `<p class="muted" style="margin:0 0 6px">On for this device. Choose what you hear about:</p>
        ${PUSH_CATS.map(([k, l]) => `<label class="check"><input type="checkbox" data-pushpref="${k}" ${p[k] !== false ? "checked" : ""}> ${esc(l)}</label>`).join("")}
        ${isStaff() ? `<label class="check"><input type="checkbox" data-pushpref="staff" ${p.staff !== false ? "checked" : ""}> New accounts, reports and flagged photos</label>` : ""}
        <div class="row2" style="margin-top:8px"><button class="btn sm" type="button" data-push="test">Send a test</button><button class="link" type="button" data-push="off">Turn off on this device</button></div>`
    : `<p>Get a notification for friend requests, messages, tournament invites and more.</p><div class="row2"><button class="btn sm ink" type="button" data-push="on">Turn on notifications</button></div>`;
  const tell = p.tell_friends !== false;
  const share = `<div class="card"><label class="check"><input type="checkbox" data-pushpref="tell_friends" ${tell ? "checked" : ""}> Tell friends when I log a catch</label>
    <p class="muted" style="margin:4px 0 0">${tell ? "Friends who can see a catch get a notification about it." : "Friends can still see your catches in their feed, but won't get a notification."} Fish entered in a tournament always notify the other anglers in it.</p></div>`;
  return `<h4><span>Notifications</span></h4><div class="card">${body}</div>${share}`;
}
$("log").addEventListener("click", async e => {
  const b = e.target.closest("[data-push]"); if(!b) return;
  if(b.dataset.push === "on"){ b.disabled = true; await enablePush(); }
  if(b.dataset.push === "off") await disablePush();
  if(b.dataset.push === "test"){ const { error } = await sb.rpc("push_test"); toast(error ? "Couldn't send a test." : "Test sent. It should arrive in a few seconds."); }
});
$("log").addEventListener("change", async e => {
  const k = e.target.dataset?.pushpref; if(!k) return;
  const push_prefs = { ...(profile.push_prefs || {}), [k]:e.target.checked };
  const { error } = await sb.from("profiles").update({ push_prefs }).eq("id", me.id);
  if(error){ toast("Couldn't save."); e.target.checked = !e.target.checked; return; }
  profile = { ...profile, push_prefs }; saveCache();
  if(k === "tell_friends"){ renderLog(); toast(e.target.checked ? "Friends will hear about your catches." : "Friends won't get notified of your catches."); }
});
// a tapped notification opens the right screen
function openDeepLink(h){
  if(!h || !me) return false;
  const [k, id] = h.replace(/^#/, "").split(":");
  if(k === "friends"){ friendsView = "people"; setTab("friends"); }
  else if(k === "feed"){ friendsView = "feed"; setTab("friends"); }
  else if(k === "tourney" && id){ setTab("tourney"); openTourney(id); }
  else if(k === "log"){ setTab("map"); }
  else if(k === "messages"){ friendsView = "messages"; chatWith = id || null; setTab("friends"); }
  else if(k === "forum"){ friendsView = "forums"; forumThread = id || null; setTab("friends"); }
  else if(k === "staff" && isStaff()){ setTab("me"); meView = "creator"; creatorData = null; renderLog(); }
  else if(k === "me"){ setTab("me"); }
  else return false;
  return true;
}
navigator.serviceWorker?.addEventListener("message", e => { if(e.data?.type === "open") openDeepLink(e.data.url); });
let pendingDeepLink = /^#(friends|feed|tourney|log|messages|forum|staff|me)\b/.test(location.hash) ? location.hash : null;
if(pendingDeepLink) history.replaceState(null, "", location.pathname + location.search);

/* ---------- messages ---------- */
let convos = null, chatWith = null, chatOpenFor = null, chatMsgs = [], chatBlock = null, chatPoll = null, unreadTotal = 0;
async function loadConvos(){
  const { data, error } = await sb.rpc("my_conversations"); if(error) return;
  convos = (data || []).sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  unreadTotal = convos.reduce((a, c) => a + +c.unread, 0);
  convos.forEach(c => { folks[c.other] ||= { display_name:c.display_name, avatar_path:c.avatar_path }; avatars[c.other] = c.avatar_path || ""; });
  try{ navigator.setAppBadge?.(unreadTotal || undefined); if(!unreadTotal) navigator.clearAppBadge?.(); }catch(e){}
  if(tab === "friends") renderLog(); else $("reqDot").hidden = !(unreadTotal || friendships.some(f => f.status === "pending" && f.addressee === me?.id));
}
async function loadChat(other){
  const { data, error } = await sb.from("messages").select("*").or(`and(from_user.eq.${me.id},to_user.eq.${other}),and(from_user.eq.${other},to_user.eq.${me.id})`).order("created_at", { ascending:true }).limit(300);
  if(error) return;
  const changed = JSON.stringify(data.map(m => m.id + (m.read_at || ""))) !== JSON.stringify(chatMsgs.map(m => m.id + (m.read_at || "")));
  chatMsgs = data;
  const unread = data.filter(m => m.to_user === me.id && !m.read_at).map(m => m.id);
  if(unread.length){ await sb.from("messages").update({ read_at:new Date().toISOString() }).in("id", unread); loadConvos(); }
  if(changed && chatWith === other && tab === "friends" && friendsView === "messages"){ renderLog(); const l = $("chatList"); if(l) l.scrollTop = l.scrollHeight; }
}
async function openChat(other){
  chatWith = other; chatOpenFor = other; chatMsgs = []; chatBlock = undefined; renderLog();
  await loadFolks([other]);
  const { data } = await sb.rpc("can_message", { other }); chatBlock = data || null;
  await loadChat(other);
  clearInterval(chatPoll); chatPoll = setInterval(() => { if(chatWith === other && document.visibilityState === "visible" && tab === "friends" && friendsView === "messages") loadChat(other); }, 8000);
}
function messagesHtml(){
  if(chatWith){
    if(chatOpenFor !== chatWith){ setTimeout(() => openChat(chatWith), 0); }
    const other = chatWith, blockedByMe = blocks.has(other);
    return `<button class="link backlink" type="button" data-chatback>${icon("i-back")}All messages</button>
      <div class="chathead">${avHtml(other, nameOf(other))}<b>${esc(nameOf(other))}</b>
        <span class="row2" style="margin-left:auto"><button class="link" type="button" data-blk="${esc(other)}" data-on="${blockedByMe ? 0 : 1}">${blockedByMe ? "Unblock" : "Block"}</button></span></div>
      <div class="chat" id="chatList">${chatMsgs.length ? chatMsgs.map(m => `<div class="bub ${m.from_user === me.id ? "mine" : ""}" data-rslot><div>${paras(m.body)}</div>
          <small>${esc(ago(m.created_at))}${m.from_user === me.id && m.read_at ? " · Seen" : ""}${m.from_user !== me.id ? ` · <button class="link" type="button" data-report="message:${esc(m.id)}">Report</button>` : ` · <button class="link" type="button" data-unsend="${esc(m.id)}">Unsend</button>`}</small><div class="rslot"></div></div>`).join("")
        : `<p class="muted" style="text-align:center;margin:20px 0">${chatBlock === undefined ? "Loading…" : "No messages yet. Say hi."}</p>`}</div>
      ${chatBlock ? `<p class="note">${esc(chatBlock)}</p>` : `<form id="chatForm" class="chatin" novalidate><textarea id="chatBody" maxlength="2000" rows="1" placeholder="Message ${esc(nameOf(other))}"></textarea><button class="btn ink" type="submit">Send</button></form>`}
      <p class="note">Messages are private between you two. A reviewer only sees a message if one of you reports it.</p>`;
  }
  if(!convos){ if(convos !== false){ convos = false; setTimeout(loadConvos, 0); } return `<p class="status">Loading messages…</p>`; }
  const fr = friendsList().filter(f => !convos.some(c => c.other === f.id));
  return `${convos.length ? `<ul class="list">${convos.map(c => `<li><button class="item" type="button" data-chat="${esc(c.other)}" style="grid-template-columns:36px 1fr auto">${avHtml(c.other, c.display_name)}
      <span class="t"><b>${esc(c.display_name)}</b><small>${c.last_from_me ? "You: " : ""}${esc(c.last_body.slice(0, 70))}</small></span><span class="num">${+c.unread ? `<span class="pill fish">${c.unread}</span>` : `<small class="muted">${esc(ago(c.last_at))}</small>`}</span></button></li>`).join("")}</ul>`
      : `<div class="empty"><b>No messages yet</b>Message any friend who's 16 or older. Pick one below.</div>`}
    ${fr.length ? `<h4><span>Start a conversation</span></h4><div class="row2" style="flex-wrap:wrap">${fr.map(f => `<button class="btn sm" type="button" data-chat="${esc(f.id)}">${esc(f.name)}</button>`).join("")}</div>` : ""}
    <p class="note">Messages are for friends only, and for anglers 16 and older (by the birth year on the account). Bad language is starred out.</p>`;
}
$("log").addEventListener("click", async e => {
  const c = e.target.closest("[data-chat]"); if(c){ friendsView = "messages"; openChat(c.dataset.chat); return; }
  if(e.target.closest("[data-chatback]")){ chatWith = null; chatOpenFor = null; clearInterval(chatPoll); convos = null; renderLog(); return; }
  const bl = e.target.closest("[data-blk]"); if(bl){ await setBlock(bl.dataset.blk, bl.dataset.on === "1"); if(chatWith){ const { data } = await sb.rpc("can_message", { other:chatWith }); chatBlock = data || null; renderLog(); } return; }
  const un = e.target.closest("[data-unsend]"); if(un){ const { error } = await sb.from("messages").delete().eq("id", un.dataset.unsend); if(!error){ chatMsgs = chatMsgs.filter(m => m.id !== un.dataset.unsend); renderLog(); } return; }
});
$("log").addEventListener("submit", async e => {
  if(e.target.id !== "chatForm") return; e.preventDefault();
  const body = $("chatBody").value.trim(); if(!body || !chatWith) return;
  const btn = e.target.querySelector("button"); btn.disabled = true;
  const { error } = await sb.from("messages").insert({ from_user:me.id, to_user:chatWith, body });
  btn.disabled = false;
  if(error){ toast("Couldn't send. Check your connection."); return; }
  $("chatBody").value = ""; await loadChat(chatWith); const l = $("chatList"); if(l) l.scrollTop = l.scrollHeight;
});
$("log").addEventListener("keydown", e => { if(e.target.id === "chatBody" && e.key === "Enter" && !e.shiftKey && !isIOS){ e.preventDefault(); $("chatForm").requestSubmit(); } });

/* ---------- forums ---------- */
const BOARDS = { general:"General", driftless:"Driftless", northwoods:"Northwoods", central:"Central Sands", southeast:"Southeast & Madison", lakemichigan:"Lake Michigan & tributaries", flies:"Fly tying", gear:"Gear", tourneys:"Tournaments", help:"Help & feedback" };
let forumBoard = lsGet("fl.board", ""), forumThreads = null, forumThread = null, forumPosts = null, forumNew = false;
async function loadThreads(){
  let q = sb.from("forum_threads").select("id, board, user_id, title, created_at, last_post_at, reply_count, locked, pinned, hidden").order("pinned", { ascending:false }).order("last_post_at", { ascending:false }).limit(60);
  if(forumBoard) q = q.eq("board", forumBoard);
  const { data, error } = await q; forumThreads = error ? [] : data || [];
  await loadFolks(forumThreads.map(t => t.user_id)); if(tab === "friends" && friendsView === "forums") renderLog();
}
async function loadThread(id){
  const [t, p] = await Promise.all([ sb.from("forum_threads").select("*").eq("id", id).maybeSingle(), sb.from("forum_posts").select("*").eq("thread_id", id).order("created_at", { ascending:true }).limit(500) ]);
  forumPosts = { thread:t.data || { id, missing:true }, posts:p.data || [] };
  await loadFolks([t.data?.user_id, ...forumPosts.posts.map(x => x.user_id)]);
  if(tab === "friends" && friendsView === "forums") renderLog();
}
function postHtml(kind, x, isThread){
  const mine = x.user_id === me?.id, hid = blocks.has(x.user_id);
  if(hid) return `<div class="fpost blocked"><small class="muted">Post from someone you blocked. <button class="link" type="button" data-blk="${esc(x.user_id)}" data-on="0">Unblock</button></small></div>`;
  return `<div class="fpost${x.hidden ? " hid" : ""}" data-rslot>
    <div class="fmeta">${avHtml(x.user_id, nameOf(x.user_id), "sm")}<b>${esc(nameOf(x.user_id))}</b>${titlePill(x.user_id)}<small class="muted">${esc(ago(x.created_at))}${x.edited_at ? " · edited" : ""}${x.hidden ? " · hidden by a moderator" : ""}</small></div>
    <div class="fbody" data-fbody="${esc(x.id)}">${paras(x.body)}</div>
    <div class="row2 factions">${mine ? `<button class="link" type="button" data-fedit="${kind}:${esc(x.id)}">Edit</button>${!isThread || !x.reply_count ? `<button class="link danger" type="button" data-fdel="${kind}:${esc(x.id)}">Delete</button>` : ""}`
      : `<button class="link" type="button" data-report="${kind}:${esc(x.id)}">Report</button><button class="link" type="button" data-blk="${esc(x.user_id)}" data-on="1">Block</button>`}
      ${isStaff() && !mine ? `<button class="link danger" type="button" data-mod="${kind}:${esc(x.id)}:${x.hidden ? "unhide" : "hide"}">${x.hidden ? "Unhide" : "Hide"}</button>` : ""}</div><div class="rslot"></div></div>`;
}
function forumsHtml(){
  if(forumThread){
    if(!forumPosts || forumPosts.thread?.id !== forumThread){ forumPosts = { thread:{ id:forumThread }, posts:null }; setTimeout(() => loadThread(forumThread), 0); }
    if(forumPosts.posts === null) return `<button class="link backlink" type="button" data-fback>${icon("i-back")}${esc(BOARDS[forumBoard] || "All boards")}</button><p class="status">Loading…</p>`;
    const t = forumPosts.thread; if(!t || t.missing) return `<button class="link backlink" type="button" data-fback>${icon("i-back")}Forums</button><p class="muted">This thread was removed.</p>`;
    return `<button class="link backlink" type="button" data-fback>${icon("i-back")}${esc(BOARDS[forumBoard] || "All boards")}</button>
      <div class="eyebrow">${esc(BOARDS[t.board])}${t.pinned ? " · Pinned" : ""}${t.locked ? " · Locked" : ""}</div><h2 class="wrap">${esc(t.title)}</h2>
      ${isStaff() ? `<div class="row2" style="margin:0 0 8px"><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.pinned ? "unpin" : "pin"}">${t.pinned ? "Unpin" : "Pin"}</button><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.locked ? "unlock" : "lock"}">${t.locked ? "Unlock" : "Lock"}</button><button class="btn sm" type="button" data-mod="thread:${esc(t.id)}:${t.hidden ? "unhide" : "hide"}">${t.hidden ? "Unhide thread" : "Hide thread"}</button></div>` : ""}
      ${postHtml("thread", t, true)}
      <h4><span>Replies</span><span>${forumPosts.posts?.length || 0}</span></h4>
      ${(forumPosts.posts || []).map(p => postHtml("post", p, false)).join("") || `<p class="muted">No replies yet.</p>`}
      ${t.locked ? `<p class="note">This thread is locked.</p>` : `<form id="replyForm" novalidate style="margin-top:10px"><textarea id="replyBody" maxlength="5000" placeholder="Write a reply"></textarea><span class="hint" id="replyMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Reply</button></div></form>`}
      <p class="note">Be decent, and don't post someone else's spot without their OK. Bad language is starred out.</p>`;
  }
  if(forumNew) return `<button class="link backlink" type="button" data-fnewx>${icon("i-back")}Forums</button><h3 style="margin:4px 0 8px">New thread</h3>
    <form id="threadForm" novalidate><div class="field"><label for="ftBoard">Board</label><select id="ftBoard">${Object.entries(BOARDS).map(([k, l]) => `<option value="${k}" ${forumBoard === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label for="ftTitle">Title</label><input id="ftTitle" maxlength="120" placeholder="Best BWO patterns for the Kinni?"></div>
      <div class="field"><label for="ftBody">Post</label><textarea id="ftBody" maxlength="5000" style="min-height:140px" placeholder="What's on your mind? Keep exact spots general unless they're public water."></textarea></div>
      <span class="hint" id="ftMsg" role="alert"></span><div class="actions"><button class="btn ink" type="submit">Post thread</button></div></form>`;
  if(forumThreads === null){ forumThreads = false; setTimeout(loadThreads, 0); }
  return `<div class="row2" style="justify-content:space-between;margin-bottom:8px"><select id="fBoard" aria-label="Board" style="width:auto;flex:1 1 auto"><option value="">All boards</option>${Object.entries(BOARDS).map(([k, l]) => `<option value="${k}" ${forumBoard === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><button class="btn sm ink" type="button" data-fnew>${icon("i-plus")}New thread</button></div>
    ${!forumThreads ? `<p class="status">Loading threads…</p>` : forumThreads.length ? `<ul class="list">${forumThreads.filter(t => !blocks.has(t.user_id)).map(t => `<li><button class="item" type="button" data-fthread="${esc(t.id)}" style="grid-template-columns:36px 1fr auto">${avHtml(t.user_id, nameOf(t.user_id))}
      <span class="t"><b class="wrap">${t.pinned ? "📌 " : ""}${esc(t.title)}${t.locked ? " 🔒" : ""}${t.hidden ? ` <span class="pill priv">Hidden</span>` : ""}</b><small>${esc(nameOf(t.user_id))}${forumBoard ? "" : ` · ${esc(BOARDS[t.board])}`} · ${esc(ago(t.last_post_at))}</small></span>
      <span class="num"><small class="muted">${t.reply_count} ${t.reply_count === 1 ? "reply" : "replies"}</small></span></button></li>`).join("")}</ul>`
      : `<div class="empty"><b>No threads yet</b>Start one: a hatch report, a fly pattern, a gear question.</div>`}
    <p class="note">Forums are open to every approved angler. Report anything out of line and a moderator will look at it.</p>`;
}
$("log").addEventListener("change", e => { if(e.target.id === "fBoard"){ forumBoard = e.target.value; lsSet("fl.board", forumBoard); forumThreads = null; renderLog(); } });
$("log").addEventListener("click", async e => {
  const t = e.target.closest("[data-fthread]"); if(t){ forumThread = t.dataset.fthread; forumPosts = null; renderLog(); $("log").scrollTop = 0; return; }
  if(e.target.closest("[data-fback]")){ forumThread = null; forumPosts = null; forumThreads = null; renderLog(); return; }
  if(e.target.closest("[data-fnew]")){ forumNew = true; renderLog(); return; }
  if(e.target.closest("[data-fnewx]")){ forumNew = false; renderLog(); return; }
  const ed = e.target.closest("[data-fedit]");
  if(ed){ const [kind, id] = ed.dataset.fedit.split(":"), x = kind === "thread" ? forumPosts.thread : forumPosts.posts.find(p => p.id === id);
    const box = $("log").querySelector(`[data-fbody="${id}"]`);
    box.innerHTML = `<textarea data-feditbox maxlength="5000" style="min-height:100px">${esc(x.body)}</textarea><div class="row2"><button class="btn sm ink" type="button" data-fsave="${kind}:${esc(id)}">Save</button><button class="link" type="button" data-fcancel>Cancel</button></div>`; return; }
  if(e.target.closest("[data-fcancel]")){ renderLog(); return; }
  const sv = e.target.closest("[data-fsave]");
  if(sv){ const [kind, id] = sv.dataset.fsave.split(":"), body = sv.closest(".fbody").querySelector("[data-feditbox]").value.trim(); if(!body) return;
    const { error } = await sb.from(kind === "thread" ? "forum_threads" : "forum_posts").update({ body }).eq("id", id);
    if(error){ toast("Couldn't save."); return; } loadThread(forumThread); return; }
  const dl = e.target.closest("[data-fdel]");
  if(dl){ const [kind, id] = dl.dataset.fdel.split(":");
    if(dl.dataset.sure !== "1"){ dl.dataset.sure = "1"; dl.textContent = "Tap again to delete"; return; }
    const { error } = await sb.from(kind === "thread" ? "forum_threads" : "forum_posts").delete().eq("id", id);
    if(error){ toast("Couldn't delete."); return; }
    if(kind === "thread"){ forumThread = null; forumPosts = null; forumThreads = null; renderLog(); } else loadThread(forumThread); return; }
  const md = e.target.closest("[data-mod]");
  if(md){ const [kind, ref, action] = md.dataset.mod.split(":");
    const { error } = await sb.rpc("moderate", { kind, ref, action }); toast(error ? (error.message || "Couldn't do that.") : "Done.");
    if(forumThread) loadThread(forumThread); if(md.closest(".rep")) { reportList = null; renderLog(); } return; }
});
$("log").addEventListener("submit", async e => {
  if(e.target.id === "threadForm"){ e.preventDefault(); const msg = $("ftMsg"); msg.className = "hint bad";
    const title = $("ftTitle").value.trim(), body = $("ftBody").value.trim(), board = $("ftBoard").value;
    if(title.length < 3){ msg.textContent = "Give it a title."; return; } if(!body){ msg.textContent = "Write something."; return; }
    const { data, error } = await sb.from("forum_threads").insert({ board, title, body, user_id:me.id }).select("id").single();
    if(error){ msg.textContent = "Couldn't post it. Try again."; return; }
    forumNew = false; forumBoard = board; lsSet("fl.board", board); forumThread = data.id; forumPosts = null; renderLog(); }
  if(e.target.id === "replyForm"){ e.preventDefault(); const body = $("replyBody").value.trim(); if(!body) return;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const { error } = await sb.from("forum_posts").insert({ thread_id:forumThread, user_id:me.id, body });
    btn.disabled = false; if(error){ $("replyMsg").className = "hint bad"; $("replyMsg").textContent = "Couldn't post. Try again."; return; }
    loadThread(forumThread); }
});

/* ---------- reports queue for the founder and admins ---------- */
let reportList = null, reportOpenCount = 0;
async function loadReports(){
  if(!isStaff()) return;
  const { data, error } = await sb.rpc("report_queue"); if(error) return;
  reportList = data || []; reportOpenCount = reportList.filter(r => r.status === "open").length;
  $("meDot").hidden = !(pendingCount || flagCount || reportOpenCount);
  if(tab === "me") renderLog();
}
function reportQueueHtml(){
  if(!reportList){ if(reportList !== false){ reportList = false; setTimeout(loadReports, 0); } return `<h4><span>Reports</span></h4><p class="status">Loading…</p>`; }
  const open = reportList.filter(r => r.status === "open");
  const seen = new Set(), uniq = open.filter(r => { const k = r.kind + r.ref; if(seen.has(k)) return false; seen.add(k); return true; });
  return `<h4><span>Reports</span><span>${uniq.length} open</span></h4>
    ${uniq.length ? `<div class="stack">${uniq.map(r => `<div class="card rep"><p class="muted" style="font-size:12.5px;margin:0">${esc(r.kind === "post" ? "Forum reply" : r.kind === "thread" ? "Forum thread" : r.kind === "message" ? "Private message" : "Account")} by <b>${esc(r.author_name)}</b>${r.context ? ` · ${esc(r.context)}` : ""} · ${r.reports} report${+r.reports === 1 ? "" : "s"}</p>
        <blockquote>${esc((r.content || "").slice(0, 600)) || "<i>(no text)</i>"}</blockquote><p class="muted" style="font-size:13px;margin:0">Reason: ${esc(r.reason || "not given")} · from ${esc(r.reporter_name)}</p>
        <div class="row2">${r.kind !== "user" ? `<button class="btn sm ink" type="button" data-mod="${esc(r.kind)}:${esc(r.ref)}:hide">Hide it</button>` : ""}${r.kind === "thread" ? `<button class="btn sm" type="button" data-mod="thread:${esc(r.ref)}:lock">Lock</button>` : ""}<button class="btn sm" type="button" data-mod="${esc(r.kind)}:${esc(r.ref)}:close">Looks fine</button></div></div>`).join("")}</div>`
      : `<p class="muted">No open reports.</p>`}`;
}

/* ---------- appearance ---------- */
function themeHtml(){
  const t = lsGet("fl.theme", "auto");
  return `<h4><span>Appearance</span></h4><div class="seg" role="group" aria-label="Appearance" style="max-width:320px">${[["auto","Auto"],["light","Light"],["dark","Dark"]].map(([k, l]) => `<button type="button" class="ink" data-theme-set="${k}" aria-pressed="${t === k}">${l}</button>`).join("")}</div>
    <p class="muted" style="margin:6px 0 0;font-size:13px">Dark is easier on the eyes at dawn and dusk. Auto follows your phone.</p>`;
}
function applyTheme(t){ if(t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
$("log").addEventListener("click", e => { const b = e.target.closest("[data-theme-set]"); if(!b) return; lsSet("fl.theme", b.dataset.themeSet); applyTheme(b.dataset.themeSet); renderLog(); });
function blockedHtml(){
  if(!blocks.size) return "";
  return `<h4><span>Blocked</span><span>${blocks.size}</span></h4><ul class="list">${[...blocks].map(id => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(nameOf(id))}</b></span><button class="link" type="button" data-blk="${esc(id)}" data-on="0">Unblock</button></li>`).join("")}</ul>`;
}

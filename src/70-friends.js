
/* ---------- friends, feed and leaderboard ---------- */
let boardPeriod = lsGet("fl.boardPeriod", "year");
let friendsView = "feed", findQ = "", findResults = null;
async function searchAnglers(q){
  const { data, error } = await sb.rpc("find_anglers", { q });
  findResults = error ? [] : (data || []); if(tab === "friends" && friendsView === "find") renderLog();
  loadAvatars(findResults.map(p => p.id).filter(id => !(id in avatars)));
}
async function refreshFollows(){ const { data } = await sb.rpc("my_follows"); follows = data || []; const fc = await sb.rpc("friend_catches"); if(!fc.error) friendCatches = fc.data || []; renderAll(); }
function inPeriod(d, p){
  if(p === "all") return true;
  const now = new Date();
  if(p === "year") return d && d.slice(0,4) === String(now.getFullYear());
  if(p === "month") return d && d.slice(0,7) === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  return true;
}
function everyone(){
  // my catches (all of them, since this is my own view) plus what friends share with me
  const mine = catches.map(c => ({ ...c, user_id: me.id, display_name: profile?.display_name || "You" }));
  return [...mine, ...friendCatches.filter(c => c.rel !== "following")];
}
function leaderboards(p){
  const all = everyone().filter(c => inPeriod(c.caught_on, p) && fishOf(c) > 0 && !beforeJoin(c));
  const by = {}; const name = {};
  for(const c of all){ (by[c.user_id] ||= []).push(c); name[c.user_id] = c.display_name; }
  if(me && !by[me.id]){ by[me.id] = []; name[me.id] = profile?.display_name || "You"; }
  const ppl = Object.keys(by);
  const rank = (fn, fmt) => ppl.map(id => ({ id, name:name[id], v:fn(by[id]) })).filter(r => r.v > 0).sort((a,b) => b.v - a.v).slice(0, 10).map(r => ({ ...r, txt:fmt(r.v) }));
  const biggest = all.filter(c => c.length_in != null).sort((a,b) => b.length_in - a.length_in).slice(0, 10)
    .map(c => ({ id:c.user_id, name:c.display_name, v:+c.length_in, txt:lenTxt(c.length_in), sub:[c.species, fmtDate(c.caught_on), countyName(c.county)].filter(Boolean).join(" · ") }));
  const species = {};
  for(const c of all) if(c.species && c.length_in != null){ const k = c.species; if(!species[k] || +c.length_in > +species[k].length_in) species[k] = c; }
  const perSpecies = Object.entries(species).sort((a,b) => b[1].length_in - a[1].length_in).map(([k, c]) => ({ id:c.user_id, name:k, v:+c.length_in, txt:lenTxt(c.length_in), sub:`${c.display_name} · ${fmtDate(c.caught_on)}` }));
  return {
    biggest,
    perSpecies,
    fish: rank(cs => cs.reduce((a,c)=>a+fishOf(c),0), v => `${v}`),
    species: rank(cs => new Set(cs.map(c=>c.species).filter(Boolean)).size, v => `${v}`),
    counties: rank(cs => new Set(cs.map(c=>c.county).filter(Boolean)).size, v => `${v}`),
    friendsCount: ppl.length - 1
  };
}
function boardHtml(title, rows, unit, emptyTxt){
  return `<div class="board"><h5>${esc(title)}</h5>${rows.length ? `<ol>${rows.map((r,i) => `<li class="${r.id === me?.id && !r.sub ? "me" : r.id === me?.id ? "me" : ""}"><span class="r">${i+1}</span><span>${esc(r.name)}${r.sub?`<small>${esc(r.sub)}</small>`:""}</span><span class="v">${esc(r.txt)}${unit?` ${unit}`:""}</span></li>`).join("")}</ol>` : `<p class="muted" style="margin:0;padding:10px 12px;font-size:13.5px">${esc(emptyTxt)}</p>`}</div>`;
}
function renderFriendsTab(el){
  const accepted = friendships.filter(f => f.status === "accepted");
  const incoming = friendships.filter(f => f.status === "pending" && f.addressee === me?.id);
  const outgoing = friendships.filter(f => f.status === "pending" && f.requester === me?.id);
  const other = f => people[f.requester === me?.id ? f.addressee : f.requester] || { display_name:"Someone" };
  const views = [["feed","Feed"],["messages","Messages"],["forums","Forums"],["board","Leaderboard"],["people","People"],["find","Find anglers"]];
  let body = "";
  if(friendsView === "feed"){
    const posts = friendCatches.slice(0, 40);
    body = posts.length ? `<div class="feed">${posts.map(c => { const url = photoSrc(c.photo_path); return `<article class="post">${url?`<img class="ph" src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
      <div class="pb"><span class="who">${avHtml(c.user_id, c.display_name, "sm")}${esc(c.display_name)}${titlePill(c.user_id)}</span>${c.rel === "following" ? ` <span class="pill">Following</span>` : ""}<div class="what">${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</div>
      <small>${esc([fmtDate(c.caught_on), c.fly, countyName(c.county)].filter(Boolean).join(" · "))}</small>${c.trip_name?`<small>Trip: ${esc(c.trip_name)}</small>`:""}
      <div class="row2" style="margin-top:6px">${profile?.role === "creator" ? `<button class="link danger" type="button" data-hide="${esc(c.id)}">Hide from feeds</button>` : ""}${c.lat!=null?`<button class="link" type="button" data-go="f:${esc(c.id)}">Show on map</button>`:c.county?`<button class="link" type="button" data-county="${esc(c.county)}">Open ${esc(byId[c.county]?.properties.name || "")} County</button>`:""}</div></div></article>`; }).join("")}</div>`
      : `<div class="empty"><b>${accepted.length || follows.length ? "No shared catches yet" : "Add your fishing friends"}</b>${accepted.length || follows.length ? "When friends and anglers you follow log catches they share, they show up here." : "Share your friend code above, or follow anglers from Find anglers. Their shared catches show up here and on the map."}</div>`;
    if(announcements.length) body = announcements.slice(0, 2).map(a => `<div class="card notice" style="margin-bottom:10px"><p class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">From the founder · ${esc(fmtDate(a.created_at.slice(0,10)))}</p><p>${esc(a.body)}</p></div>`).join("") + body;
  } else if(friendsView === "board"){
    const b = leaderboards(boardPeriod);
    const periods = [["month","This month"],["year","This year"],["all","All time"]];
    body = `<div class="yearsel">${periods.map(([k,l]) => `<button type="button" data-period="${k}" aria-pressed="${boardPeriod===k}">${l}</button>`).join("")}</div>
      <div class="boards">
      ${boardHtml("Biggest fish", b.biggest, "", "Log a length with your catches to get on this board.")}
      ${boardHtml("Record by species", b.perSpecies, "", "Species records show up once catches have lengths.")}
      ${boardHtml("Most fish", b.fish, "fish", "No fish logged in this period.")}
      ${boardHtml("Most species", b.species, "", "No species logged in this period.")}
      ${boardHtml("Most counties fished", b.counties, "", "No counties logged in this period.")}
      </div><p class="note">Boards count your catches and what friends share with you. Private catches don't count toward anyone else's view.</p>`;
  } else {
    body = `${incoming.length ? `<h4><span>Requests</span></h4><ul class="list">${incoming.map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(f.requester, other(f).display_name)}<span class="t"><b>${esc(other(f).display_name)}</b><small>Wants to share catches with you</small></span><span class="row2"><button class="btn sm ink" type="button" data-accept="${esc(f.id)}">Accept</button><button class="btn sm" type="button" data-decline="${esc(f.id)}">Decline</button></span></li>`).join("")}</ul>` : ""}
      <h4><span>Friends</span><span>${accepted.length}</span></h4>
      ${accepted.length ? `<ul class="list">${accepted.map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml((f.requester === me.id ? f.addressee : f.requester), other(f).display_name)}<span class="t"><b>${esc(other(f).display_name)}${titlePill((f.requester === me.id ? f.addressee : f.requester))}</b><small>${friendCatches.filter(c => c.user_id === (f.requester === me.id ? f.addressee : f.requester)).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><span data-slot-${esc(f.id)} class="row2" style="margin:0;flex-wrap:nowrap"><button class="btn sm" type="button" data-chat="${esc((f.requester === me.id ? f.addressee : f.requester))}">Message</button><button class="link danger" type="button" data-unfriend="${esc(f.id)}">Remove</button></span></li>`).join("")}</ul>` : `<p class="muted">No friends added yet.</p>`}
      <h4><span>Following</span><span>${follows.filter(f => f.direction === "following").length}</span></h4>
      ${follows.some(f => f.direction === "following") ? `<ul class="list">${follows.filter(f => f.direction === "following").map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(f.user_id, f.display_name)}<span class="t"><b>${esc(f.display_name)}</b><small>${friendCatches.filter(c => c.user_id === f.user_id).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><button class="link" type="button" data-unfollow="${esc(f.user_id)}">Unfollow</button></li>`).join("")}</ul>` : `<p class="muted">You aren't following anyone. Use Find anglers to follow people with public profiles.</p>`}
      <p class="muted" style="margin-top:10px">${follows.filter(f => f.direction === "follower").length} follower${follows.filter(f => f.direction === "follower").length===1?"":"s"}${profile?.is_public ? "" : ". Turn on a public profile in the Me tab to let people follow you."}</p>
      ${outgoing.length ? `<h4><span>Waiting on</span></h4><ul class="list">${outgoing.map(f => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(f.addressee, other(f).display_name)}<span class="t"><b>${esc(other(f).display_name)}</b><small>Request sent</small></span><button class="link" type="button" data-decline="${esc(f.id)}">Cancel</button></li>`).join("")}</ul>` : ""}`;
  }
  if(friendsView === "messages") body = messagesHtml();
  if(friendsView === "forums") body = forumsHtml();
  if(friendsView === "find"){
    body = `<form id="findForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="findQ" placeholder="Search anglers by name" aria-label="Search anglers by name" value="${esc(findQ)}"><button class="btn" type="submit">Search</button></form>
      <p class="muted" style="margin:6px 0 10px">Follow anglers with public profiles to see the catches they share. Unlike friends, following doesn't need their OK, and they don't see your catches.</p>
      <div id="findResults">${findResults ? (findResults.length ? `<ul class="list">${findResults.map(p => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(p.id, p.display_name)}<span class="t"><b class="wrap">${esc(p.display_name)}${titlePill(p.id)}${p.featured?` <span class="pill open">Featured</span>`:""}</b><small>${p.followers} follower${p.followers===1?"":"s"} · ${p.fish} shared fish${p.bio?` · ${esc(p.bio)}`:""}</small></span><span class="row2">${profile?.role==="creator"?`<button class="link" type="button" data-feature="${esc(p.id)}" data-on="${p.featured?"0":"1"}">${p.featured?"Unfeature":"Feature"}</button>`:""}<button class="btn sm ${p.following?"":"ink"}" type="button" data-${p.following?"unfollow":"follow"}="${esc(p.id)}">${p.following?"Following":"Follow"}</button></span></li>`).join("")}</ul>` : `<p class="muted">No public anglers match that name.</p>`) : `<p class="status">Loading anglers…</p>`}</div>`;
    if(!findResults) searchAnglers(findQ);
  }
  const social = friendsView === "messages" || friendsView === "forums";
  el.innerHTML = `<div class="eyebrow">Friends</div><h2>${friendsView === "forums" ? "Forums" : friendsView === "messages" ? "Messages" : "Fishing friends"}</h2>
    ${social ? "" : `<div class="code" style="margin:10px 0 12px"><span>Your friend code</span><b>${esc(profile?.friend_code || "······")}</b><button class="btn sm" type="button" data-a="sharecode">Share</button></div>
    <form id="addFriendForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="friendCode" placeholder="Friend's code" autocapitalize="characters" maxlength="8" aria-label="Friend's code" style="font-family:var(--f-data);letter-spacing:.12em"><button class="btn ink" type="submit">Add</button></form>
    <span class="hint" id="friendMsg" role="alert"></span>
    <form id="nameSearchForm" class="row2" novalidate style="flex-wrap:nowrap;margin-top:8px"><input id="nameQ" type="search" placeholder="Or search anglers by name" aria-label="Search anglers by name" value="${esc(nameQ)}" autocomplete="off"><button class="btn" type="submit">Search</button></form>
    ${nameResultsHtml()}
    <label class="check" style="margin-top:10px"><input type="checkbox" id="showFriendsBox" ${showFriends?"checked":""}> Show friends' catches on the map</label>`}
    <div class="yearsel" style="margin-top:${social ? 6 : 14}px">${views.map(([k,l]) => `<button type="button" data-fview="${k}" aria-pressed="${friendsView===k}">${l}${k==="people"&&incoming.length?` (${incoming.length})`:""}${k==="messages"&&unreadTotal?` (${unreadTotal})`:""}</button>`).join("")}</div>
    <div style="margin-top:10px">${body}</div>`;
  if($("addFriendForm")) $("addFriendForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("friendMsg"); msg.className = "hint"; msg.textContent = "Sending…";
    try{ const n = await addFriend($("friendCode").value); msg.className = "hint ok"; msg.textContent = `Request sent to ${n}. They'll see it in their Friends tab.`; $("friendCode").value = ""; }
    catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Couldn't add that friend."; }
  });
  if($("nameSearchForm")) $("nameSearchForm").addEventListener("submit", e => { e.preventDefault(); searchPeople($("nameQ").value); });
  if($("findForm")) $("findForm").addEventListener("submit", e => { e.preventDefault(); findQ = $("findQ").value.trim(); findResults = null; renderLog(); });
  if($("showFriendsBox")) $("showFriendsBox").addEventListener("change", e => { showFriends = e.target.checked; lsSet("fl.showFriends", showFriends); renderAll(); });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const fv = t.closest("[data-fview]"); if(fv){ friendsView = fv.dataset.fview; if(friendsView === "messages"){ chatWith = null; chatOpenFor = null; convos = null; } if(friendsView === "forums"){ forumThread = null; forumNew = false; forumThreads = null; } renderLog(); return; }
  const pe = t.closest("[data-period]"); if(pe){ boardPeriod = pe.dataset.period; lsSet("fl.boardPeriod", boardPeriod); renderLog(); return; }
  const ac = t.closest("[data-accept]"); if(ac){ ac.disabled = true; try{ await answerRequest(ac.dataset.accept, true); toast("Friend added"); }catch(e){ toast("Couldn't accept. Try again."); } return; }
  const de = t.closest("[data-decline]"); if(de){ de.disabled = true; try{ await answerRequest(de.dataset.decline, false); }catch(e){ toast("Couldn't update. Try again."); } return; }
  const un = t.closest("[data-unfriend]"); if(un){ const slot = un.parentElement; slot.innerHTML = `<span class="row2"><button class="link danger" type="button" data-unfriendyes="${esc(un.dataset.unfriend)}">Remove friend</button><button class="link" type="button" data-fview="people">Keep</button></span>`; return; }
  const uy = t.closest("[data-unfriendyes]"); if(uy){ try{ await answerRequest(uy.dataset.unfriendyes, false); toast("Friend removed"); }catch(e){ toast("Couldn't remove. Try again."); } return; }
  if(t.closest('[data-a="sharecode"]')) shareCode();
  const fo = t.closest("[data-follow]"); if(fo){ fo.disabled = true; const { error } = await sb.from("follows").insert({ followee: fo.dataset.follow }); if(error){ toast("Couldn't follow. Try again."); fo.disabled = false; return; } toast("Following"); findResults = null; await refreshFollows(); return; }
  const uf = t.closest("[data-unfollow]"); if(uf){ uf.disabled = true; await sb.from("follows").delete().eq("follower", me.id).eq("followee", uf.dataset.unfollow); toast("Unfollowed"); findResults = null; await refreshFollows(); return; }
  const ft = t.closest("[data-feature]"); if(ft){ const { error } = await sb.from("profiles").update({ featured: ft.dataset.on === "1" }).eq("id", ft.dataset.feature); toast(error ? "Couldn't update." : ft.dataset.on === "1" ? "Featured" : "No longer featured"); findResults = null; renderLog(); return; }
  const hd = t.closest("[data-hide]"); if(hd){ const { error } = await sb.rpc("creator_hide_catch", { catch_id: hd.dataset.hide, hide:true }); if(error){ toast("Couldn't hide it."); return; } friendCatches = friendCatches.filter(c => c.id !== hd.dataset.hide); toast("Hidden from all feeds and tournaments"); renderAll(); return; }
});
async function shareCode(){
  const url = location.origin + location.pathname;
  const text = `Add me on Coulee, the Wisconsin fly fishing app. My friend code is ${profile?.friend_code}. Open ${url} on your phone and create an account. Once you're approved, enter the code in the Friends tab.`;
  if(navigator.share){ try{ await navigator.share({ title:"Coulee", text, url }); return; }catch(e){ if(e.name === "AbortError") return; } }
  try{ await navigator.clipboard.writeText(text); toast("Invite copied. Paste it into a text to a friend."); }
  catch(e){ toast(`Your code is ${profile?.friend_code}`); }
}

/* ---------- find anglers by name to add as friends ---------- */
let nameQ = "", nameResults = null, nameBusy = false;
async function searchPeople(q){
  nameQ = (q || "").trim();
  if(nameQ.length < 2){ nameResults = nameQ ? "short" : null; renderLog(); return; }
  nameBusy = true; renderLog();
  const { data, error } = await sb.rpc("search_people", { q:nameQ });
  nameBusy = false; nameResults = error ? "error" : (data || []);
  if(Array.isArray(nameResults)) nameResults.forEach(p => { avatars[p.id] = p.avatar_path || ""; titles[p.id] = p.title || ""; });
  renderLog(); setTimeout(() => $("nameResults")?.scrollIntoView({ block:"nearest", behavior:"smooth" }), 50);
}
function nameResultsHtml(){
  if(nameBusy) return `<p class="status" id="nameResults">Searching…</p>`;
  if(nameResults === null) return "";
  if(nameResults === "short") return `<p class="hint" id="nameResults">Type at least 2 letters.</p>`;
  if(nameResults === "error") return `<p class="hint bad" id="nameResults">Couldn't search right now. Try again.</p>`;
  const rel = p => p.relation === "friend" ? `<span class="pill fished">Friends</span>` : p.relation === "sent" ? `<span class="pill">Request sent</span>`
    : p.relation === "received" ? `<button class="btn sm ink" type="button" data-fview="people">Respond</button>` : `<button class="btn sm ink" type="button" data-addid="${esc(p.id)}">Add friend</button>`;
  return `<div id="nameResults" style="margin-top:8px">${nameResults.length ? `<ul class="list">${nameResults.map(p => `<li class="item" style="grid-template-columns:36px 1fr auto;cursor:default">${avHtml(p.id, p.display_name, "", p.avatar_path)}
      <span class="t"><b class="wrap">${esc(p.display_name)}${p.title ? ` <span class="pill ttl">${esc(p.title)}</span>` : ""}</b><small>${+p.mutual ? `${p.mutual} mutual friend${+p.mutual === 1 ? "" : "s"}` : "Coulee angler"}</small></span>
      <span class="num">${rel(p)}</span></li>`).join("")}</ul>` : `<p class="muted">No anglers named "${esc(nameQ)}". Check the spelling, or ask for their friend code.</p>`}
    <button class="link" type="button" data-nameclear>Clear search</button></div>`;
}
$("log").addEventListener("click", async e => {
  if(e.target.closest("[data-nameclear]")){ nameQ = ""; nameResults = null; renderLog(); return; }
  const b = e.target.closest("[data-addid]"); if(!b) return;
  b.disabled = true;
  const p = Array.isArray(nameResults) && nameResults.find(x => x.id === b.dataset.addid);
  const ins = await sb.from("friendships").insert({ addressee:b.dataset.addid });
  if(ins.error && ins.error.code !== "23505"){ toast("Couldn't send the request. Try again."); b.disabled = false; return; }
  if(p) p.relation = "sent";
  toast(`Friend request sent${p ? ` to ${p.display_name}` : ""}. They'll see it in their Friends tab.`);
  await loadAll(); renderLog();
});

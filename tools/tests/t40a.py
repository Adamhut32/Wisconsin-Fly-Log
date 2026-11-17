# Build 40: roads for counties saved before roads existed. Offline saving switched on (real service worker).
# A phone with saved counties but no roads sees a "Roads aren't saved yet" card with "Save roads now"; a saved county
# without roads offers "Save roads too"; the quiet top-up still runs; then with no signal the roads show.
import asyncio, os, pathlib
os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent; REPO = HERE.parent.parent
MOCK = (HERE / "mock-supabase.js").read_text(); PATCH = (HERE / "patch.js").read_text()
SP = "/tmp/claude-0/-home-claude/f52d0cb2-d74a-5f6a-85a7-0769f32453dd/scratchpad/rev/"
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
async def run(b, w, h):
    global ok
    ctx = await b.new_context(viewport={"width":w,"height":h}, service_workers="allow", is_mobile=w < 500, has_touch=w < 500)
    await ctx.add_init_script(PATCH)
    await ctx.route("**/vendor/supabase.js", lambda r: r.fulfill(body=MOCK, content_type="text/javascript"))
    async def appjs(r):
        body = (REPO / "beta/js/app.js").read_text().replace('"use strict";', '"use strict"; window.__dbg = s => eval(s);', 1)
        await r.fulfill(body=body, content_type="text/javascript")
    await ctx.route("**/js/app.js*", appjs)
    await ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    await ctx.route("**/basemap.nationalmap.gov/**", lambda r: r.abort())
    pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    D = lambda s: pg.evaluate("s => __dbg(s)", s)
    await pg.goto("http://localhost:8790/beta/"); await pg.wait_for_timeout(3500); await pg.reload(); await pg.wait_for_timeout(3500)
    check(f"{w}: offline saving is running", await pg.evaluate("!!navigator.serviceWorker.controller"))
    # a phone that saved counties before roads existed
    await D("""(async () => { const c = await caches.open(OFFLINE_CACHE); for(const id of ['55123','55063','55081']) for(const u of countyFiles(id)){ const r = await fetch(u); if(r.ok) await c.put(u, r); }
       for(const k of await c.keys()) if(k.url.includes('/roads/')) await c.delete(k); return 1; })()""")
    await pg.reload(); await pg.wait_for_timeout(3000)
    await D("profile.username = 'adamh'; closeUsername(); 1")
    await D("countSavedCounties().then(() => { setTab('me'); }); 1"); await pg.wait_for_timeout(1500)
    card = pg.locator("#log .card.notice", has_text="Roads aren't saved yet")
    if await card.count(): await card.scroll_into_view_if_needed()
    t = " ".join(((await card.text_content()) if await card.count() else "").split())
    check(f"{w}: Me shows that 3 saved counties don't have roads yet, with a button", await card.count() == 1 and await card.is_visible() and "3 of your saved counties" in t, t[:140])
    await pg.screenshot(path=SP + f"t40_card_{w}.png")
    await card.locator("[data-offline='roads']").click(); await pg.wait_for_timeout(4000)
    n = await D("caches.open(OFFLINE_CACHE).then(c => c.keys()).then(k => k.filter(r => r.url.includes('/roads/')).length)")
    check(f"{w}: Save roads now saves them and the card goes away", n >= 3 and await pg.locator("#log .card.notice", has_text="Roads aren't saved yet").count() == 0, f"{n} roads files")
    # a county saved without roads offers to save them
    await D("""(async () => { const c = await caches.open(OFFLINE_CACHE); await c.delete(dataUrl('roads/55123.json')); await countSavedCounties(); return 1; })()""")
    await D("openCounty('55123'); setTab('map'); 1"); await pg.wait_for_timeout(2500)
    b2 = pg.locator("#log [data-offline='55123']", has_text="Save roads too")
    if await b2.count(): await b2.scroll_into_view_if_needed()
    check(f"{w}: a saved county without roads says so and offers to save them", await b2.count() == 1 and await b2.is_visible())
    await pg.screenshot(path=SP + f"t40_county_{w}.png")
    await b2.click(); await pg.wait_for_timeout(2500)
    note = await pg.evaluate("(() => { const e = [...document.querySelectorAll('#log .note')].find(n => /offline/i.test(n.textContent)); return e ? e.textContent : ''; })()")
    check(f"{w}: after saving, the county says roads work offline", "roads work without signal" in note, note[:90])
    # the quiet top-up still works on its own
    await D("""(async () => { const c = await caches.open(OFFLINE_CACHE); await c.delete(dataUrl('roads/55063.json')); return 1; })()""")
    await D("topUpSavedRoads()"); await pg.wait_for_timeout(2500)
    check(f"{w}: the quiet top-up adds roads too", await D("caches.open(OFFLINE_CACHE).then(c => c.match(dataUrl('roads/55063.json'))).then(r => !!r)"))
    # no signal: the roads still show
    await ctx.set_offline(True); await pg.reload(); await pg.wait_for_timeout(4500)
    await D("profile.username = 'adamh'; closeUsername(); map.setView([43.555, -90.885], 13); 1"); await pg.wait_for_timeout(4000)
    check(f"{w}: with no signal, roads show in a saved county", await D("!navigator.onLine && roadOn.has('55123')"))
    await pg.screenshot(path=SP + f"t40_offline_{w}.png")
    print("errors", errs); ok = ok and not errs
    await ctx.close()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        for w, h in [(390, 844), (1280, 820)]: await run(b, w, h)
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

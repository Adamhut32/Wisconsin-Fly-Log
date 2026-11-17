# Build 39 (offline roads): roads save with a county, counties saved before roads existed get them added quietly when online,
# and the Offline maps section says roads are included.
exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
SP = "/tmp/claude-0/-home-claude/f52d0cb2-d74a-5f6a-85a7-0769f32453dd/scratchpad/rev/"
async def main():
    global ok
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h, ctxargs=dict(is_mobile=w < 500, has_touch=w < 500, device_scale_factor=1)); D = pg.dbg
            await D("profile.username = 'adamh'; closeUsername(); 1")
            has = lambda id: D(f"caches.open(OFFLINE_CACHE).then(c => c.match(dataUrl('roads/{id}.json'))).then(r => !!r)")
            # 1. a county saved before roads existed: its files are on the phone, its roads aren't
            await D("""(async () => { const c = await caches.open(OFFLINE_CACHE); for(const u of countyFiles('55063')){ const r = await fetch(u); if(r.ok) await c.put(u, r); } return 1; })()""")
            check(f"{w}: old saved county starts without roads", not await has("55063"))
            await D("topUpSavedRoads()"); await pg.wait_for_timeout(1500)
            check(f"{w}: roads are added to it quietly when online", await has("55063"))
            # 2. Save county button now includes roads
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(2500)
            await pg.evaluate("document.querySelector(\".tabs [data-tab='map']\").click()"); await pg.wait_for_timeout(800)
            btn = pg.locator("[data-offline='55123']")
            if await btn.count():
                await btn.scroll_into_view_if_needed(); await btn.click(); await pg.wait_for_timeout(4000)
            check(f"{w}: Save county saves its roads too", await has("55123"))
            note = await pg.evaluate("(() => { const e = [...document.querySelectorAll('#log .note')].find(n => /offline/i.test(n.textContent)); return e ? e.textContent : ''; })()")
            check(f"{w}: the county says roads work offline", "roads" in note, note[:120])
            await pg.screenshot(path=SP + f"off_county_{w}.png")
            # 3. Offline maps section text and size
            await D("leaveCounty(); setTab('me'); renderLog(); 1"); await pg.wait_for_timeout(1500)
            card = pg.locator("#log .card", has_text="Saved counties keep")
            await card.scroll_into_view_if_needed(); t = " ".join((await card.text_content()).split())
            check(f"{w}: Offline maps mentions roads and the new size, and is visible", await card.is_visible() and "public land and roads" in t and "105 MB" in t, t[:200])
            await pg.screenshot(path=SP + f"off_me_{w}.png")
            # 4. offline: the top-up does nothing and doesn't throw
            await pg.context.set_offline(True); await D("topUpSavedRoads()"); await pg.wait_for_timeout(500); await pg.context.set_offline(False)
            print("errors", pg.errs); ok = ok and not pg.errs
            await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

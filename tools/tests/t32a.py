exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
BIO = "window.__mockPatch = Object.assign(window.__mockPatch || {}, {});"
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h, ctxargs={"user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"} if w < 760 else None); D = pg.dbg
            await D("people['22222222-2222-4222-8222-222222222222'].bio = 'Driftless brown trout nut. Mostly dries.'; friendCatches.forEach((c, i) => c.photo_path = 'bo/p' + i + '.jpg'); 1")
            # 1. Apple Maps link on an iPhone, only Google on desktop
            await D("map.setView([43.60,-90.90],12); 1"); await pg.wait_for_timeout(800)
            await D("L.popup().setLatLng([43.6,-90.9]).setContent(`<div class='pop'>${mapLinks(43.6,-90.9)}</div>`).openOn(map); 1"); await pg.wait_for_timeout(300)
            t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: map links", ("Apple Maps" in t) == (w < 760) and "Google Maps" in t, t)
            await D("map.closePopup(); 1")
            # 2. catch form: only some friends, exact spot for one
            await D("openForm('catch'); 1"); await pg.wait_for_timeout(500)
            await pg.click('#visSeg [data-v="county"]')
            vis = await pg.is_visible("#shareRow"); check(f"{w}: sharing row shows for catches", vis)
            await pg.click('#shareRow [data-sw="some"]'); await pg.click('#shareRow [data-swid]')
            await pg.click('#shareRow [data-ex="some"]'); await pg.click('#shareRow [data-exid]')
            hint = await pg.text_content("#shareRow"); check(f"{w}: exact-for chooser", "exact place" in hint, hint[-120:])
            await D("$('fSpecies').value = 'Brown trout'; $('fCoords').value = '43.60, -90.90'; $('fCoords').dispatchEvent(new Event('input')); 1")
            await pg.click("#saveBtn"); await pg.wait_for_timeout(1500)
            rec = await D("JSON.stringify(catches.find(c => c.species === 'Brown trout' && c.share_with) || null)")
            check(f"{w}: saved with share_with and exact_for", rec != "null" and '"exact_for":["2222' in rec and '"share_with":["2222' in rec, (rec or "")[:200])
            # 3. friend's page
            await D("setTab('friends'); 1"); await pg.wait_for_timeout(600)
            if await pg.locator('[data-ftab="friends"], [data-sub="friends"]').count(): await pg.locator('[data-ftab="friends"], [data-sub="friends"]').first.click(); await pg.wait_for_timeout(400)
            el = pg.locator("[data-person]").first
            if not await el.count():
                await D("renderFriends && renderFriends(); 1")
            n = await pg.locator("[data-person]").count(); check(f"{w}: friend names open a page", n > 0, str(n))
            if n:
                await pg.locator("[data-person]").first.click(); await pg.wait_for_timeout(1200)
                t = await pg.text_content(".sheet.person") if await pg.locator(".sheet.person").count() else ""
                check(f"{w}: friend page shows name, bio, stats", "Bo Larson" in t and "Mostly dries" in t and "fish" in t, " ".join(t.split())[:200])
                await pg.screenshot(path=f"t32_person_{w}.png")
                cells = await pg.locator(".pcell").count()
                if cells:
                    await pg.locator(".pcell").first.click(); await pg.wait_for_timeout(800)
                    check(f"{w}: tapping a fish opens it", await pg.locator(".pbig").count() > 0)
                    await pg.screenshot(path=f"t32_fish_{w}.png")
                else: print("     (no photos on the friend's fish in the stand-in data)")
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h); D = pg.dbg
            await D("profile.username = profile.username || 'adamh'; closeUsername(); 1")
            # a fish since joining in Vernon, and one from before joining in Sauk
            await D("""(() => { catches.push({ id:'n1', user_id: me.id, species:'Brown trout', count:1, county:'55123', caught_on:'2026-10-01', lat:43.6, lng:-90.9 },
                                          { id:'h1', user_id: me.id, species:'Brown trout', count:1, county:'55111', caught_on:'2025-05-01', lat:43.4, lng:-89.9 });
                titlesAll = true; setTab('stats'); renderLog(); return 1; })()""")
            await pg.wait_for_timeout(400)
            check(f"{w}: no county list under Counties fished anymore", await pg.locator(".clist").count() == 0)
            btn = pg.locator('[data-a="club72"]'); check(f"{w}: 72 Club title has See counties", await btn.count() == 1)
            await btn.first.scroll_into_view_if_needed(); await btn.first.click(); await pg.wait_for_timeout(400)
            t = " ".join((await pg.text_content("#club72")).split())
            check(f"{w}: 72 Club list counts only fish since joining", "✓ Vernon" in t and "✓ Sauk" not in t and "Sauk" in t and "before you joined" in t, t[:220])
            await pg.screenshot(path=f"t37_{w}.png")
            await pg.click('[data-a="club72map"]'); await pg.wait_for_timeout(900)
            chip = (await pg.text_content("#cmodeChip")) or ""
            sty = await D("JSON.stringify([countyStyle(counties.find(f => f.id === '55123')).fillOpacity, countyStyle(counties.find(f => f.id === '55111')).fillOpacity])")
            check(f"{w}: 72 Club on the map shades Vernon, not Sauk", "72 Club" in chip and sty == "[0.5,0.06]", chip + " " + sty)
            await pg.click('[data-a="countymode-off"]'); await D("setTab('stats'); renderLog(); 1"); await pg.wait_for_timeout(300)
            await pg.click('[data-a="countymode"]'); await pg.wait_for_timeout(800)
            sty2 = await D("JSON.stringify([countyStyle(counties.find(f => f.id === '55111')).fillOpacity])")
            check(f"{w}: Counties fished on the map still includes before-Coulee fish", sty2 == "[0.5]", sty2)
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

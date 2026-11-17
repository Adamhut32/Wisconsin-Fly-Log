exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
GEO = """
window.__geo = { cb:null };
Object.defineProperty(navigator, 'geolocation', { value: {
  watchPosition(ok, err, o){ window.__geo.cb = ok; let i = 0; const pts = [[43.70, -90.60, 2500], [43.6105, -90.8805, 120], [43.6101, -90.8801, 12]];
    const t = setInterval(() => { const p = pts[i++]; if(!p){ clearInterval(t); return; } ok({ coords:{ latitude:p[0], longitude:p[1], accuracy:p[2] }, timestamp:Date.now() }); }, 700); return 7; },
  clearWatch(){}, getCurrentPosition(ok){ ok({ coords:{ latitude:43.61, longitude:-90.88, accuracy:12 } }); } }, configurable:true });
"""
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h, extra=GEO); D = pg.dbg
            await D("profile.username = profile.username || 'adamh'; closeUsername(); 1")
            # 1. stocked search
            await pg.fill("#q", "brook trout"); await pg.wait_for_timeout(900)
            head = await pg.locator("#qres .stockhead").count()
            check(f"{w}: search shows 'Waters stocked with brook trout'", head == 1, (await pg.text_content("#qres"))[:120])
            await pg.click("#qres .stockhead"); await pg.wait_for_timeout(400)
            items = await pg.locator("#qres li").count(); txt = " ".join((await pg.text_content("#qres")).split())
            check(f"{w}: stocked list with years and counts", items > 10 and "fish" in txt and "Back to search" in txt, txt[:200])
            await pg.evaluate("document.querySelectorAll(\"#qres li button\")[1].click()"); await pg.wait_for_timeout(3000)
            check(f"{w}: tapping a stocked water opens its county", (await D("currentCounty")) is not None, str(await D("currentCounty")))
            await pg.fill("#q", "musky"); await pg.wait_for_timeout(700)
            check(f"{w}: other species too (musky)", "stocked with muskellunge" in (await pg.text_content("#qres")).lower())
            await pg.fill("#q", ""); await D("$('qres').hidden = true; 1")
            # 2. tapping another county while in one switches to it
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(2500)
            await D("tapCounty(L.latLng(43.95, -90.62)); 1"); await pg.wait_for_timeout(1500)
            check(f"{w}: tap on Monroe while in Vernon switches", await D("currentCounty") == "55081", str(await D("currentCounty")))
            # 3. roads
            r1 = await D("!!roadsLayer"); await D("setMapView('topo'); 1"); r2 = await D("!!roadsLayer"); await D("setMapView('sat'); 1"); r3 = await D("!!roadsLayer")
            await pg.evaluate("document.getElementById('roadsToggle').click()"); r4 = await D("!!roadsLayer"); await pg.evaluate("document.getElementById('roadsToggle').click()")
            check(f"{w}: roads on Map and Satellite, not Topo, switch works", [r1, r2, r3, r4] == [True, False, True, False], str([r1, r2, r3, r4]))
            await D("setMapView('field'); 1")
            # 4. location keeps narrowing down
            await D("locateMe(); 1"); await pg.wait_for_timeout(1300)
            a1 = await D("JSON.stringify(hereFix)"); t1 = (await pg.text_content(".hpop")) if await pg.locator(".hpop").count() else ""
            await pg.wait_for_timeout(2500)
            a2 = await D("JSON.stringify(hereFix)"); t2 = " ".join(((await pg.text_content(".hpop")) if await pg.locator(".hpop").count() else "").split())
            check(f"{w}: location narrows from a rough guess to a close fix", '"acc":2500' in a1 or '"acc":120' in a1, a1)
            check(f"{w}: final fix is the accurate one", '"acc":12' in a2 and "narrowing" not in t2, a2 + " | " + t2[:120])
            # 5. analytics bars
            await D("""(() => { statsData = { accounts:{}, totals:{}, tournaments:{}, active_days:[['2026-11-07',4],['2026-11-08',9],['2026-11-09',7]], signups_weeks:[['2026-11-02',3]], catches_months:[['2026-11',12]], tournament_months:[], catch_hours:Array(24).fill(1), catch_weekdays:[1,2,3,4,5,6,7] };
               setTab('me'); const el = document.getElementById('log'); renderAnalytics(el); return 1; })()""")
            await pg.wait_for_timeout(300)
            g = pg.locator(".chartwrap .bar").nth(1); await g.scroll_into_view_if_needed(); await g.click(); await pg.wait_for_timeout(200)
            rd = await pg.locator(".chartread").first.text_content()
            check(f"{w}: tapping a bar shows its date and number", "Nov 8" in rd and "9 people" in rd, rd)
            await pg.screenshot(path=f"t38_chart_{w}.png")
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

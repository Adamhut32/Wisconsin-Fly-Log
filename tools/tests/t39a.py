# Build 39: stocked-fish search redone (results right away, list that stays open, on-the-map view), Coulee's own public roads
# (no outside road pictures), county switching, location, analytics bars, unnamed creeks.
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
    global ok
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h, extra=GEO, ctxargs=dict(is_mobile=w < 500, has_touch=w < 500)); D = pg.dbg
            esri = []; pg.on("request", lambda r: esri.append(r.url) if "arcgisonline.com/ArcGIS/rest/services/Reference" in r.url else None)
            await D("profile.username = profile.username || 'adamh'; closeUsername(); 1")
            # stocked search: results right away, above the map buttons
            await pg.click("#q"); await pg.type("#q", "brown", delay=40); await pg.wait_for_timeout(900)
            txt = " ".join((await pg.text_content("#qres")).split())
            check(f"{w}: 'brown' shows the stocked card and closest waters right away", "Brown trout stocked in" in txt and "Stocked 20" in txt and "Creeks and lakes by that name" in txt, txt[:160])
            box = await pg.locator("#qres .stockcard").bounding_box()
            top = await pg.evaluate(f"(() => {{ const e = document.elementFromPoint({box['x'] + box['width'] - 12}, {box['y'] + 12}); return !!e.closest('#qres'); }})()")
            check(f"{w}: results are on top of the map buttons", top)
            await pg.locator("#qres .stockmore").first.click(); await pg.wait_for_timeout(400)
            vis = await pg.is_visible("#qres"); n1 = await pg.locator("#qres .srow").count()
            check(f"{w}: 'See all' opens the list and it stays open", vis and n1 >= 5 and await pg.locator("#qres .stockback").count() == 1, f"rows {n1}")
            await pg.locator("#qres .stockmore").first.click(); await pg.wait_for_timeout(300)
            n2 = await pg.locator("#qres .srow").count(); check(f"{w}: 'Show more' adds rows", n2 > n1 and await pg.is_visible("#qres"), f"{n1}->{n2}")
            await pg.locator("#qres .srow").nth(0).click(); await pg.wait_for_timeout(4500)
            note = " ".join(((await pg.text_content(".stocknote")) if await pg.locator(".stocknote").count() else "").split())
            check(f"{w}: going to a stocked water shows what was stocked there", "Stocked 20" in note, note[:120])
            # every stocked water on the map
            await pg.fill("#q", "trout"); await pg.wait_for_timeout(800)
            await pg.locator("#qres .stockcard button").click(); await pg.wait_for_timeout(1500)
            chip = " ".join(((await pg.text_content("#stockChip")) if await pg.is_visible("#stockChip") else "").split())
            nm = await D("stockLayer ? stockLayer.getLayers().length : 0")
            check(f"{w}: 'Show them on the map' puts the waters on the map with a bar to clear them", nm > 100 and "Trout stocked" in chip and "waters" in chip and not await pg.is_visible("#qres"), f"{nm} | {chip}")
            await D("stockLayer.getLayers()[0].openPopup(); 1"); await pg.wait_for_timeout(300)
            check(f"{w}: a stocked pin's card says what and when", "Stocked 20" in (await pg.text_content(".leaflet-popup-content")))
            await pg.locator("[data-stockgo]").click(); await pg.wait_for_timeout(4500)
            check(f"{w}: 'Go to this water' opens it", (await D("currentCounty")) is not None)
            await pg.click("[data-stockclear]"); await pg.wait_for_timeout(200)
            check(f"{w}: the clear button removes them", await D("stockLayer === null") and not await pg.is_visible("#stockChip"))
            for q, want in [("bows", "Rainbow trout"), ("smallies", "Smallmouth bass"), ("panfish", "Panfish"), ("musky", "Muskellunge"), ("brookies", "Brook trout")]:
                await pg.fill("#q", q); await pg.wait_for_timeout(500)
                t = await pg.evaluate("document.querySelector('#qres .stockcard') ? document.querySelector('#qres .stockcard').textContent : ''")
                check(f"{w}: '{q}' finds {want}", want in t, " ".join(t.split())[:60])
            await pg.fill("#q", "na"); await pg.wait_for_timeout(500)
            check(f"{w}: unnamed creeks don't show up as 'NA'", ">NA<" not in (await pg.inner_html("#qres")))
            await pg.fill("#q", ""); await D("$('qres').hidden = true; 1")
            # roads: Coulee's own lines, none from the outside service
            await D("setMapView('field'); map.setView([43.555, -90.885], 13); 1"); await pg.wait_for_timeout(3000)
            r1 = await D("roadOn.has('55123') && Object.keys(roadGroups['55123'].parts).length === 3")
            await D("map.setZoom(11); 1"); await pg.wait_for_timeout(2500)
            r2 = await D("roadOn.has('55123') && !roadGroups['55123'].group.hasLayer(roadGroups['55123'].parts[3])")
            await D("setMapView('topo'); 1"); await pg.wait_for_timeout(600); r3 = await D("roadOn.size === 0") and await D("$('roadsToggle').hidden")
            await D("setMapView('field'); 1"); await pg.wait_for_timeout(1200)
            await pg.evaluate("document.getElementById('roadsToggle').click()"); await pg.wait_for_timeout(400); r4 = await D("roadOn.size === 0 && roadR === null")
            await pg.evaluate("document.getElementById('roadsToggle').click()"); await pg.wait_for_timeout(1500); r5 = await D("roadOn.size > 0")
            check(f"{w}: roads load per county, local roads only up close, off on Topo and with the switch", [r1, r2, r3, r4, r5] == [True] * 5, str([r1, r2, r3, r4, r5]))
            await D("map.setView([43.555, -90.885], 14.5); 1"); await pg.wait_for_timeout(2500)
            check(f"{w}: no road pictures from the outside map service", not esri, str(esri[:1]))
            await pg.screenshot(path=f"t39_roads_{w}.png")
            # county switching
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(2500)
            await D("tapCounty(L.latLng(43.95, -90.62)); 1"); await pg.wait_for_timeout(1500)
            check(f"{w}: tap on Monroe while in Vernon switches", await D("currentCounty") == "55081")
            # location
            await D("locateMe(); 1"); await pg.wait_for_timeout(4200)
            fx = await D("JSON.stringify(hereFix)"); t2 = " ".join(((await pg.text_content(".hpop")) if await pg.locator(".hpop").count() else "").split())
            check(f"{w}: location settles on the accurate fix", '"acc":12' in fx and "narrowing" not in t2, fx)
            check(f"{w}: 'Where am I' never names a creek 'NA'", "water: NA," not in t2 and "<b>NA</b>" not in t2, t2[:100])
            # analytics bars
            await D("""(() => { statsData = { accounts:{}, totals:{}, tournaments:{}, active_days:[['2026-10-01',4],['2026-10-02',9],['2026-10-03',7]], signups_weeks:[['2026-11-02',3]], catches_months:[['2026-11',12]], tournament_months:[], catch_hours:Array(24).fill(1), catch_weekdays:[1,2,3,4,5,6,7] }; setTab('me'); return 1; })()""")
            await pg.wait_for_timeout(1200); await D("renderAnalytics(document.getElementById('log')); 1"); await pg.wait_for_timeout(400)
            await pg.evaluate("document.querySelectorAll('.chartwrap .bar')[1].dispatchEvent(new MouseEvent('click', {bubbles:true}))"); await pg.wait_for_timeout(200)
            rd = await pg.locator(".chartread").first.text_content()
            anchor = await pg.evaluate("[...document.querySelectorAll('.chartwrap svg text')].some(t => t.getAttribute('text-anchor') === 'start') ? 'start' : 'none'")
            check(f"{w}: tapping a bar shows date and number; first date isn't cut off", "Oct 2" in rd and "9 people" in rd and anchor == "start", f"{rd} {anchor}")
            print("errors", pg.errs); ok = ok and not pg.errs
            await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

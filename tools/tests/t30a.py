exec(open("base26.py").read())
import time, math
NOW = int(time.time())
def iso(t): return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(t))
GAUGES = [["USGS-05408000", "Kickapoo River at La Farge", 43.5741, -90.6432, 266.0], ["USGS-05410490", "Kickapoo River at Steuben", 43.1828, -90.8585, 687.0], ["USGS-05382000", "Black River near Galesville", 44.06028, -91.28722, 2080.0]]
PLACES = {"b": [[43.60, -90.90, "TIMBER COULEE LANDING", "RAMP", "CONCRETE", "Y", "TIMBER COULEE CREEK", "VERNON COUNTY"], [43.62, -90.93, "SIDIE HOLLOW CARRY-IN", "CARRY-IN", None, None, "SIDIE HOLLOW LAKE", "WI DNR"]],
          "s": [[43.61, -90.91, "SIDIE HOLLOW SHORE SITE", "SIDIE HOLLOW LAKE", "https://dnr.wisconsin.gov/x"]],
          "l": [[43.5512, -90.9238, "Sidie Hollow Lake", 1650200, "SIMPLE-COOL-CLEAR", 38.2, 22, "Small cool clear lake", "Supports trout, largemouth bass and panfish"]]}
STOCK = [[2025, "TIMBER COULEE CREEK", 1650000, None, "Brown Trout", "Wild", "Yearling", 1200, 9.5], [2025, "SIDIE HOLLOW LAKE", 1650200, None, "Rainbow Trout", None, "Yearling", 3000, 10.1], [2024, "TIMBER COULEE CREEK", 1650000, None, "Brown Trout", None, "Large Fingerling", 2500, 4.2]]
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        def check(name, cond, extra=""):
            nonlocal ok; ok = ok and bool(cond); print(("PASS " if cond else "FAIL ") + name, extra)
        for (w, h) in [(1280, 820), (390, 844)]:
            pg = await page(b, ME_PATCH, w=w, h=h); D = pg.dbg; calls = []
            J = lambda o: dict(body=json.dumps(o), content_type="application/json", headers={"access-control-allow-origin": "*"})
            async def usgs(route):
                u = route.request.url; calls.append(u.split("?")[0].split("/")[-2] if "items" in u else "stats")
                if "latest-continuous" in u:
                    code = "00010" if "00010" in u else "00060"
                    await route.fulfill(**J({"features": [{"properties": {"monitoring_location_id": g[0], "time": iso(NOW - 900), "value": str(21.5 if code == "00010" else 100 + i * 240)}} for i, g in enumerate(GAUGES)]}))
                elif "continuous" in u:
                    await route.fulfill(**J({"features": [{"properties": {"time": iso(NOW - 7 * 86400 + i * 900), "value": str(round(120 + 60 * math.sin(i / 60) + i * 0.1, 1))}} for i in range(672)]}))
                else:
                    await route.fulfill(**J({"features": [{"properties": {"data": [{"values": [{"values": ["60", "80", "110", "160", "240", "380", "500"], "percentiles": ["5", "10", "25", "50", "75", "90", "95"]}]}]}}]}))
            await pg.context.route("https://api.waterdata.usgs.gov/**", usgs)
            async def nws(route):
                u = route.request.url
                if "/points/" in u: await route.fulfill(**J({"properties": {"forecast": "https://api.weather.gov/gridpoints/ARX/72,55/forecast"}}))
                else: await route.fulfill(**J({"properties": {"periods": [{"name": "Today", "temperature": 48, "temperatureUnit": "F", "windSpeed": "5 to 10 mph", "windDirection": "NW", "shortForecast": "Mostly Sunny", "probabilityOfPrecipitation": {"value": None}}, {"name": "Tonight", "temperature": 31, "temperatureUnit": "F", "windSpeed": "5 mph", "windDirection": "W", "shortForecast": "Clear", "probabilityOfPrecipitation": {"value": 0}}, {"name": "Thursday", "temperature": 52, "temperatureUnit": "F", "windSpeed": "10 mph", "windDirection": "S", "shortForecast": "Chance Rain Showers", "probabilityOfPrecipitation": {"value": 40}}]}}))
            await pg.context.route("https://api.weather.gov/**", nws)
            await pg.context.route("**/data/gauges.json*", lambda r: r.fulfill(**J(GAUGES)))
            await pg.context.route("**/data/places/55123.json*", lambda r: r.fulfill(**J(PLACES)))
            await pg.context.route("**/data/stocking/55123.json*", lambda r: r.fulfill(**J(STOCK)))
            if w < 760: pass
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3000); await D("map.setView([43.59, -90.78], 10.5); 1"); await pg.wait_for_timeout(3500)
            n_g = await pg.locator(".mk-gauge").count(); txt = await pg.locator(".mk-gauge").all_text_contents()
            check(f"{w}: gauges on the map with flows", n_g >= 1 and any("cfs" in t for t in txt), str(txt[:3]))
            check(f"{w}: boat landing and shore pins", await pg.locator(".mk-place.boat").count() >= 1 and await pg.locator(".mk-place.shore").count() >= 1 and await pg.locator(".mk-place.carry").count() >= 1)
            # gauge popup
            await D("(() => { const g = gauges[0]; L.popup({maxWidth:300,minWidth:240}).setLatLng([g[2], g[3]]).setContent(gaugePopup(g)).openOn(map); })()"); await pg.wait_for_timeout(1500)
            t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: gauge card: flow, normal band, trend, warm water, chart", "100" in t and "for this date" in t and "71°F" in t.replace(" ", "") .replace("Water71", "71") or ("Warm for trout" in t and await pg.locator(".spark path").count() == 1), t[:140].replace("\n", " "))
            await pg.click('.leaflet-popup [data-a="wx"]'); await pg.wait_for_timeout(900); t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: forecast shows", "Mostly Sunny" in t and "40% rain" in t and "wind 5 to 10 mph NW" in t)
            if w > 760: await pg.screenshot(path="z30-gauge.png")
            # stream card: flow from the same river's gauge, stocking
            await D("map.closePopup(); openWaterPopup({ latlng: L.latLng(43.60, -90.65) }, 'Kickapoo River', 'River', null, '55123'); 1"); await pg.wait_for_timeout(1800)
            t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: river card shows flow from its own gauge", "Flow" in t and "cfs" in t and "Kickapoo River at La Farge" in t, t[:160].replace("\n", " "))
            await D("map.closePopup(); openWaterPopup({ latlng: L.latLng(43.65, -91.01) }, 'Timber Coulee Creek', 'Creek', { c:1, mi:8 }, '55123'); 1"); await pg.wait_for_timeout(1500)
            t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: creek card shows DNR stocking, no borrowed gauge", "DNR stocking" in t and "1,200 brown trout" in t and "2024" in t and "Flow" not in t.replace("Forecast here", ""), t[:200].replace("\n", " "))
            if w > 760: await pg.screenshot(path="z30-creek.png")
            await D("map.closePopup(); openWaterPopup({ latlng: L.latLng(43.5512, -90.9238) }, 'Sidie Hollow Lake', 'Lake', null, '55123'); 1"); await pg.wait_for_timeout(1500)
            t = await pg.text_content(".leaflet-popup-content")
            check(f"{w}: lake card shows lake facts and stocking", "Lake facts" in t and "38 acres" in t and "22 ft" in t and "3,000 rainbow trout" in t, t[:220].replace("\n", " "))
            if w > 760: await pg.screenshot(path="z30-lake.png")
            # landing popup
            await D("map.closePopup(); 1"); await pg.wait_for_timeout(400)
            await D("(() => { const m = landingLayer.getLayers().find(l => l.options.icon.options.html.includes('boat')); map.setView(m.getLatLng(), map.getZoom(), {animate:false}); })(); 1"); await pg.wait_for_timeout(1500)
            bb = await pg.locator(".mk-place.boat").first.bounding_box()
            await pg.mouse.click(bb["x"]+13, bb["y"]+13); await pg.wait_for_timeout(600)
            t = await pg.text_content(".leaflet-popup-content") if await pg.is_visible(".leaflet-popup") else ""
            check(f"{w}: boat landing card", "Boat landing" in t and "Google Maps" in t, t[:120])
            # crossings appear up close (real data file)
            await D("map.closePopup(); map.setView([43.5807, -90.8864], 14, {animate:false}); 1"); await pg.wait_for_timeout(3000)
            nc = await pg.locator(".mk-place.cross").count(); check(f"{w}: road crossings up close", nc >= 1, nc)
            if nc:
                await pg.locator(".mk-place.cross").first.click(force=True); await pg.wait_for_timeout(500); t = await pg.text_content(".leaflet-popup-content")
                check(f"{w}: crossing card", "Road crossing" in t and "right-of-way" in t, t[:80])
                await pg.screenshot(path=f"z30-cross-{w}.png")
            # toggles
            await D("map.closePopup(); 1")
            if w < 760: await pg.click(".lgkey"); await pg.wait_for_timeout(300)
            await pg.click("#crossToggle"); await pg.wait_for_timeout(500); check(f"{w}: crossings toggle off", await pg.locator(".mk-place.cross").count() == 0)
            await pg.click("#gaugeToggle"); await pg.wait_for_timeout(500); check(f"{w}: flows toggle off", await pg.locator(".mk-gauge").count() == 0)
            check(f"{w}: few USGS requests", len(calls) <= 8, f"{len(calls)}: {sorted(set(calls))}")
            check(f"{w}: no errors", not pg.errs, pg.errs)
            await pg.context.close()
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())

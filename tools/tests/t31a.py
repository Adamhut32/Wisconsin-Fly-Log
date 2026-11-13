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
        for (w, h) in [(390, 844), (1280, 820)]:
            pg = await page(b, ME_PATCH, w=w, h=h, extra="localStorage.setItem('fl.showAccess','false');", ctxargs=(dict(has_touch=True, is_mobile=True, device_scale_factor=3) if w < 760 else None)); D = pg.dbg; calls = []
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

            # 1. public land without opening a county, zoomed in (it had been switched off on this phone: comes back on once)
            await D("map.setView([43.60, -90.90], 11); 1"); await pg.wait_for_timeout(4500)
            check(f"{w}: public land shows zoomed in with no county open", await D("accessOn.size") >= 1 and await D("detailFor") is None, str(await D("[...accessOn].join(',')")))
            check(f"{w}: public land switch reads on", "on" in (await pg.text_content("#accessToggle")))
            await D("map.setView([44.5, -89.9], 7.5); 1"); await pg.wait_for_timeout(2500)
            check(f"{w}: zoomed out: no public land, no flow pins", await D("accessOn.size") == 0 and await pg.locator(".mk-gauge").count() == 0, str(await pg.locator(".mk-gauge").count()))
            check(f"{w}: county taps still work zoomed out (empty public land layer lets taps through)", await D("map.getPane('access').style.pointerEvents") == "none")
            # 2. flow pins appear once zoomed to creek level, and a tap on one opens its card
            g = GAUGES[0]
            await D(f"map.setView([{g[2]}, {g[3]}], 11); 1"); await pg.wait_for_timeout(4000)
            n = await pg.locator(".mk-gauge").count(); check(f"{w}: flow pins at creek zoom", n >= 1, str(n))
            box = await pg.locator(".mk-gauge").first.bounding_box()
            if w < 760: await pg.touchscreen.tap(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            else: await pg.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            await pg.wait_for_timeout(1500)
            t = (await pg.text_content(".leaflet-popup-content")) if await pg.locator(".leaflet-popup-content").count() else ""
            check(f"{w}: tapping a flow pin opens its card", "cfs" in t or "Kickapoo" in t, t[:80].replace("\n"," "))
            await pg.screenshot(path=f"t31_{w}.png")
            # 3. search box doesn't zoom the page
            if w < 760:
                fs = await D("getComputedStyle(document.querySelector('.search input')).fontSize"); check("phone: search box is 16px (no page zoom)", fs == "16px", fs)
            print("errors", pg.errs)
            await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

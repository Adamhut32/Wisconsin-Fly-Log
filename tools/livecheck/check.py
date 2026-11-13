# Opens the app (with a stand-in account, real outside services) on a phone-size screen, zooms to a few rivers,
# and records what the stream-flow pins and cards do. Run by .github/workflows/live-check.yml; results land in tools/probe/live/.
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright
H = pathlib.Path(__file__).parent; OUT = pathlib.Path("tools/probe/live"); OUT.mkdir(parents=True, exist_ok=True)
MOCK = (H / "mock-supabase.js").read_text(); PATCH = (H / "patch.js").read_text()
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8790/"
async def main():
    log = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, args in [("phone", dict(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1")), ("desktop", dict(viewport={"width":1280,"height":820}))]:
            ctx = await b.new_context(service_workers="block", **args); pg = await ctx.new_page()
            pg.on("console", lambda m, n=name: log.append(f"{n} console {m.type}: {m.text}"[:400]))
            pg.on("pageerror", lambda e, n=name: log.append(f"{n} ERROR {e}"[:600]))
            pg.on("response", lambda r, n=name: log.append(f"{n} {r.status} {r.url[:200]}") if ("waterdata" in r.url or "weather.gov" in r.url or "gauges" in r.url or "flownorms" in r.url) else None)
            pg.on("requestfailed", lambda r, n=name: log.append(f"{n} FAILED {r.url[:200]} {r.failure}"))
            await pg.add_init_script(PATCH)
            await pg.route("**/vendor/supabase.js", lambda r: r.fulfill(body=MOCK, content_type="text/javascript"))
            async def appjs(r):
                resp = await r.fetch(); body = (await resp.text()).replace('"use strict";', '"use strict"; window.__dbg = s => eval(s);', 1)
                await r.fulfill(body=body, content_type="text/javascript")
            await pg.route("**/js/app.js*", appjs)
            await pg.goto(URL); await pg.wait_for_timeout(4000)
            for sel in ["#newsOk"]:
                if await pg.is_visible(sel): await pg.click(sel)
            if await pg.is_visible("#unameScrim"): await pg.fill("#unameIn", "checker"); await pg.click("#unameSave")
            D = lambda s: pg.evaluate("s => __dbg(s)", s)
            for i, (lat, lng, z) in enumerate([(43.30, -90.36, 9.5), (43.30, -90.36, 10.6), (43.55, -90.65, 11.5), (43.05, -89.40, 12)]):
                await D(f"map.setView([{lat},{lng}],{z}); 1"); await pg.wait_for_timeout(9000)
                st = await D("JSON.stringify({zoom: map.getZoom(), showGauges, gauges: gauges ? gauges.length : null, flowsAt: flowNow.at, nFlows: Object.keys(flowNow.q||{}).length, pins: gaugeLayer.getLayers().length, shown: document.querySelectorAll('.mk-gauge').length, sample: [...document.querySelectorAll('.mk-gauge')].slice(0,4).map(e => e.textContent)})")
                log.append(f"{name} view{i}: {st}")
                await pg.screenshot(path=str(OUT / f"{name}-{i}.png"))
            n = await pg.locator(".mk-gauge").count()
            if n:
                box = await pg.locator(".mk-gauge").first.bounding_box()
                if name == "phone": await pg.touchscreen.tap(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
                else: await pg.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
                await pg.wait_for_timeout(8000)
                t = await pg.locator(".leaflet-popup-content").first.text_content() if await pg.locator(".leaflet-popup-content").count() else "NO CARD"
                log.append(f"{name} card: {' '.join(t.split())[:500]}")
                await pg.screenshot(path=str(OUT / f"{name}-card.png"))
            await ctx.close()
        await b.close()
    (OUT / "log.txt").write_text("\n".join(log))
asyncio.run(main())

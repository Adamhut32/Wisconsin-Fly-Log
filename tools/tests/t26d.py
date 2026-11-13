import asyncio, os, base64
os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
from playwright.async_api import async_playwright
GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(service_workers="allow")
        hits = []
        async def photo(route):
            url = route.request.url; hits.append(url)
            if "token=good" in url: await route.fulfill(status=200, body=GIF, content_type="image/gif", headers={"access-control-allow-origin":"*"})
            else: await route.fulfill(status=400, body="expired", headers={"access-control-allow-origin":"*"})
        await ctx.route("https://acufuumrjbzbiktodojz.supabase.co/storage/**", photo)
        pg = await ctx.new_page()
        # a bare page in the test copy's folder is enough to exercise its service worker
        await ctx.route("**/beta/swtest.html", lambda r: r.fulfill(body="<!doctype html><title>t</title>ok", content_type="text/html"))
        await pg.goto("http://localhost:8790/beta/swtest.html")
        await pg.evaluate("navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)")
        await pg.wait_for_timeout(1500); await pg.reload(); await pg.wait_for_timeout(800)
        print("controlled by worker:", await pg.evaluate("!!navigator.serviceWorker.controller"))
        load = """u => new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('failed'); i.src = u; })"""
        base = "https://acufuumrjbzbiktodojz.supabase.co/storage/v1/object/sign/photos/u1/c1-1.jpg"
        r1 = await pg.evaluate(load, base + "?token=good"); n1 = len(hits)
        await pg.wait_for_timeout(300)
        r2 = await pg.evaluate(load, base + "?token=expired"); n2 = len(hits)
        await ctx.set_offline(True)
        r3 = await pg.evaluate(load, base + "?token=whatever"); 
        r4 = await pg.evaluate(load, base.replace("c1-1", "never-seen") + "?token=good")
        await ctx.set_offline(False)
        r5 = await pg.evaluate(load, base.replace("c1-1", "c9") + "?token=expired")
        keys = await pg.evaluate("caches.open('flylog-photos').then(c => c.keys()).then(k => k.map(r => r.url))")
        print("first load:", r1, "| network requests:", n1)
        print("same photo, expired key:", r2, "| new network requests:", n2 - n1)
        print("same photo, offline:", r3, "| unseen photo offline:", r4, "| expired key, never saved:", r5)
        print("saved:", keys)
        ok = r1 == "loaded" and r2 == "loaded" and n2 == n1 and r3 == "loaded" and r4 == "failed" and r5 == "failed" and len(keys) == 1 and "token" not in keys[0]
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())

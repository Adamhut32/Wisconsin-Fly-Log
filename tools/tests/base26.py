# Test helper: opens the app in a headless browser with a stand-in server (mock-supabase.js) and a signed-in stand-in account
# (patch.js), and gives each test page a `pg.dbg("js")` hook into the app's own code.
# Run tests from this folder, with the site served from the repo root:  (cd ../.. && python3 -m http.server 8790 &)  then  python3 t34a.py
import asyncio, re, json, sys, pathlib, os, shutil
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
MOCK = (HERE / "mock-supabase.js").read_text()
ME_PATCH = (HERE / "patch.js").read_text()
async def page(b, patch=None, extra="", w=390, h=844, geo=None, url="http://localhost:8790/beta/", mock=None, ctxargs=None, tiles=False):
    patch = ME_PATCH if patch is None else patch
    ctx = await b.new_context(viewport={"width":w,"height":h}, service_workers="block", geolocation=geo, permissions=["geolocation"] if geo else [], **(ctxargs or {}))
    pg = await ctx.new_page(); pg.errs=[]; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.add_init_script(patch + extra)
    await pg.route("**/vendor/supabase.js", lambda r: r.fulfill(body=mock or MOCK, content_type="text/javascript"))
    async def appjs(r):
        rel = "beta/js/app.js" if "/beta/" in r.request.url else "js/app.js"
        body = (REPO / rel).read_text().replace('"use strict";', '"use strict"; window.__dbg = s => eval(s);', 1)
        await r.fulfill(body=body, content_type="text/javascript")
    await pg.route("**/js/app.js*", appjs)
    await pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    if not tiles: await pg.route("**/basemap.nationalmap.gov/**", lambda r: r.abort())
    await pg.goto(url); await pg.wait_for_timeout(2500)
    if await pg.is_visible("#newsOk"): await pg.click("#newsOk")
    if await pg.is_visible("#unameScrim"): await pg.fill("#unameIn","adamh"); await pg.click("#unameSave"); await pg.wait_for_timeout(300)
    pg.dbg = lambda s: pg.evaluate("s => __dbg(s)", s)
    return pg
async def launch(p):
    chrome = os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)
    return await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch(args=["--no-sandbox"])

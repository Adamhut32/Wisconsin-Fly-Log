exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h); D = pg.dbg
            await D("profile.username = profile.username || 'adamh'; closeUsername(); setTab('me'); renderLog(); 1"); await pg.wait_for_timeout(500)
            await D("typeof loadCreator === 'function' && loadCreator(); 1"); await pg.wait_for_timeout(1200)
            if not await pg.locator("#relItems").count():
                for sel in ['[data-me="creator"]', 'text=Founder tools']:
                    if await pg.locator(sel).count(): await pg.locator(sel).first.click(); await pg.wait_for_timeout(800); break
            check(f"{w}: composer found", await pg.locator("#relItems").count() > 0)
            await pg.fill("#relTitle", "Season fixes")
            await pg.fill("#relItems", "Measure along a creek\nFounder tools: release notes sort themselves\nFaster photo loading behind the scenes\nNew accounts are approved by the founder")
            await pg.wait_for_timeout(200)
            labels = [x.strip() for x in await pg.locator(".relaud").all_text_contents()]
            check(f"{w}: lines sorted automatically", labels == ["Everyone", "Founder & admins", "Founder & admins", "Everyone"], str(labels))
            await pg.locator(".relaud").nth(2).click(); await pg.wait_for_timeout(100)
            labels2 = [x.strip() for x in await pg.locator(".relaud").all_text_contents()]
            check(f"{w}: tap switches a line", labels2[2] == "Everyone", str(labels2))
            await pg.locator(".relaud").nth(2).click()
            await pg.locator("#relSort").scroll_into_view_if_needed(); await pg.screenshot(path=f"t36_{w}.png")
            await D("window.__ins = []; const f = sb.from; sb.from = t => { const q = f.call(sb, t); if(t === 'releases'){ const i = q.insert; q.insert = rows => { window.__ins.push(rows); return Promise.resolve({ error:null }); }; } return q; }; 1")
            await pg.click("#relForm button[type=submit]"); await pg.wait_for_timeout(600)
            ins = await D("JSON.stringify(window.__ins)")
            check(f"{w}: publishes an everyone note and a founder-and-admins note", '"audience":"all"' in ins and '"audience":"staff"' in ins and '"Behind the scenes"' in ins, ins[:300])
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

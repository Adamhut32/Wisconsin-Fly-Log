exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            # 1. right after a sign-in, the setup guide opens even for an account that already finished it
            pg = await page(b, w=w, h=h, extra="if(!sessionStorage.getItem('t35')){ localStorage.setItem('fl.guideNext','true'); sessionStorage.setItem('t35','1'); }"); D = pg.dbg
            for i in range(20):
                if await pg.is_visible("#unameScrim"):
                    check(f"{w}: guide waits behind the username question", not await pg.is_visible("#guide"))
                    await pg.fill("#unameIn", "adamh"); await pg.click("#unameSave")
                if await pg.is_visible("#guide"): break
                await pg.wait_for_timeout(500)
            vis = await pg.is_visible("#guide"); onb = await D("profile.onboarded")
            check(f"{w}: guide opens after sign-in (account already onboarded={onb})", vis)
            if vis: await pg.click("#guideSkip"); await pg.wait_for_timeout(500)
            check(f"{w}: closing it clears the flag", await D("lsGet('fl.guideNext', false)") is False)
            await pg.reload(); await pg.wait_for_timeout(3500)
            check(f"{w}: next app open: no guide", not await pg.is_visible("#guide"))
            # 2. which counties are done and which aren't
            await D("profile.username = profile.username || 'adamh'; closeUsername(); 1")
            await D("""(() => { catches.push({ id:'x1', user_id: me.id, species:'Brown trout', count:1, county:'55123', caught_on:'2026-06-01', lat:43.6, lng:-90.9 }); setTab('stats'); renderLog(); return 1; })()""")
            await pg.wait_for_timeout(400)
            await pg.click(".clist summary"); await pg.wait_for_timeout(300)
            t = " ".join((await pg.text_content(".clist")).split())
            check(f"{w}: counties list", "✓ Vernon" in t and "Not yet" in t and "Dane" in t, t[:160])
            await pg.locator(".clist").scroll_into_view_if_needed(); await pg.screenshot(path=f"t35_counties_{w}.png")
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())

exec(open("base26.py").read())
from PIL import Image
SIZES = [("small-iphone",320,568,{}),("iphone",390,844,{}),("big-android",412,915,{}),("tablet",820,1180,{}),("laptop",1366,768,{}),("wide",1920,1080,{}),("iphone-dark",390,844,{"color_scheme":"dark"}),("landscape-phone",844,390,{})]
async def main():
    async with async_playwright() as p:
        b = await launch(p); out = []
        for name,w,h,ca in SIZES:
            pg = await page(b, w=w, h=h, ctxargs=ca); D = pg.dbg
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3200)
            f1 = f"sz-{name}-1.png"; await pg.screenshot(path=f1)
            if w <= 760 or name == "landscape-phone":
                if await D("panelCollapsed"): await pg.click("#grab"); await pg.wait_for_timeout(600)
            f2 = f"sz-{name}-2.png"; await pg.screenshot(path=f2)
            await pg.click("#addCatchBtn"); await pg.wait_for_timeout(500)
            f3 = f"sz-{name}-3.png"; await pg.screenshot(path=f3)
            ov = await pg.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
            print(name, "sideways overflow:", ov, "errors:", pg.errs)
            out.append((name,[f1,f2,f3])); await pg.context.close()
        for name, fs in out:
            ims = [Image.open(f) for f in fs]; hh = max(i.size[1] for i in ims)
            m = Image.new("RGB", (sum(i.size[0] for i in ims) + 20*(len(ims)-1), hh), "white"); x = 0
            for i in ims: m.paste(i, (x, 0)); x += i.size[0] + 20
            m.thumbnail((1800, 1100)); m.save(f"szsheet-{name}.png")
        await b.close()
asyncio.run(main())

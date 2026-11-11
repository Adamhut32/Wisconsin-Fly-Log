#!/usr/bin/env python3
"""Build Coulee.

  python3 build.py --beta N [--note "text"]
                                build test version N into beta/ (founder and admins get it first)
  python3 build.py --promote    copy the approved test version in beta/ over the live app

The live app sits at the site root; the test copy sits in beta/ and shares the root's
data/, vendor/ and icons/ folders. Promoting reverses exactly the path changes --beta makes.

Everything the app is made of is edited in src/: the scripts in src/*.js, and the page, styles,
service worker and terms in src/static/. The copies at the site root (index.html, css/app.css,
sw.js, terms.html, js/app.js) are what everyone is running; they change only when a test
version is released, so never edit them by hand.
If data-next/water/hd/ exists (from the monthly DNR refresh), the test copy reads detailed creek
lines from there, and promoting moves them over data/water/hd/ and bumps hdVersion.
"""
import json, pathlib, re, shutil, sys

root = pathlib.Path(__file__).parent
beta = root / "beta"
static = root / "src" / "static"

def joined():
    parts = sorted((root / "src").glob("*.js"))
    js = "\n".join(p.read_text() for p in parts)
    check(js)
    return js, [p.name for p in parts]

def check(js):
    """Refuse to build an app that can't start: run Node's syntax check when Node is available."""
    import shutil as _sh, subprocess, tempfile
    if not _sh.which("node"): return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f: f.write(js)
    r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
    pathlib.Path(f.name).unlink()
    if r.returncode: sys.exit("build stopped, the app has a syntax error:\n" + r.stderr.strip()[:800])

BETA_MARK = "\n// --- test version settings (removed when released) ---\n"
SHARED = ("vendor/", "icons/")

def to_beta(text):
    for d in SHARED:
        text = text.replace(f'"{d}', f'"../{d}')
    return text

def from_beta(text):
    for d in SHARED:
        text = text.replace(f'"../{d}', f'"{d}')
    return text

def build_live():
    js, names = joined()
    (root / "js" / "app.js").write_text(js)
    print("built js/app.js from", ", ".join(names))

NEXT_HD = root / "data-next" / "water" / "hd"
LIVE_HD = root / "data" / "water" / "hd"

def build_beta(n, note=None):
    live = json.loads((root / "build.json").read_text())["build"]
    if n <= live:
        sys.exit(f"test build {n} must be newer than the live build {live}")
    js, _ = joined()
    (beta / "js").mkdir(parents=True, exist_ok=True); (beta / "css").mkdir(exist_ok=True)
    (beta / "js" / "app.js").write_text(js)
    shutil.copy(static / "app.css", beta / "css" / "app.css")
    shutil.copy(static / "terms.html", beta / "terms.html")
    cfg = (root / "js" / "config.js").read_text()
    cfg = re.sub(r"build: \d+", f"build: {n}", cfg)
    cfg += BETA_MARK + 'window.FLYLOG_CONFIG.channel = "beta";\nwindow.FLYLOG_CONFIG.dataBase = "../data/";\n'
    if NEXT_HD.exists():  # try the refreshed DNR creek lines before everyone gets them
        cfg += 'window.FLYLOG_CONFIG.hdBase = "../data-next/water/hd/";\nwindow.FLYLOG_CONFIG.hdVersion = "next";\n'
    (beta / "js" / "config.js").write_text(cfg)
    (beta / "index.html").write_text(to_beta((static / "index.html").read_text()))
    sw = (static / "sw.js").read_text()
    sw = re.sub(r'const VERSION = "flylog-v\d+";', f'const VERSION = "flylog-beta-v{n}";', sw)
    (beta / "sw.js").write_text(to_beta(sw))
    man = json.loads((root / "manifest.webmanifest").read_text())
    man["name"] = "Coulee (test)"
    for i in man["icons"]: i["src"] = "../" + i["src"]
    (beta / "manifest.webmanifest").write_text(json.dumps(man, indent=2) + "\n")
    info = {"build": n}
    if note: info["note"] = note
    (beta / "build.json").write_text(json.dumps(info) + "\n")
    print(f"built test version {n} in beta/ (live is {live})")

def promote():
    n = json.loads((beta / "build.json").read_text())["build"]
    live = json.loads((root / "build.json").read_text())["build"]
    if n <= live:
        print(f"nothing to release: test build {n}, live build {live}"); return
    shutil.copy(beta / "js" / "app.js", root / "js" / "app.js")
    shutil.copy(beta / "css" / "app.css", root / "css" / "app.css")
    shutil.copy(beta / "terms.html", root / "terms.html")
    cfg = (beta / "js" / "config.js").read_text().split(BETA_MARK)[0]
    (root / "js" / "config.js").write_text(cfg)
    (root / "index.html").write_text(from_beta((beta / "index.html").read_text()))
    sw = (beta / "sw.js").read_text().replace(f'const VERSION = "flylog-beta-v{n}";', f'const VERSION = "flylog-v{n}";')
    (root / "sw.js").write_text(from_beta(sw))
    if NEXT_HD.exists():  # refreshed creek lines go live with this release
        if LIVE_HD.exists(): shutil.rmtree(LIVE_HD)
        shutil.move(str(NEXT_HD), str(LIVE_HD))
        shutil.rmtree(root / "data-next")
        cfg = (root / "js" / "config.js").read_text()
        v = int((re.search(r'hdVersion: "(\d+)"', cfg) or [None, "1"])[1]) + 1
        (root / "js" / "config.js").write_text(re.sub(r'hdVersion: "\d+"', f'hdVersion: "{v}"', cfg))
        print(f"released the refreshed DNR creek lines (hdVersion {v})")
    (root / "build.json").write_text(json.dumps({"build": n}) + "\n")
    print(f"released build {n} to everyone (was {live})")

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--beta"]: build_beta(int(a[1]), a[3] if a[2:3] == ["--note"] else None)
    elif a[:1] == ["--promote"]: promote()
    elif a[:1] == ["--live-unreleased"]: build_live()   # writes the live app directly, skipping the test version: emergencies only
    else: sys.exit(__doc__)

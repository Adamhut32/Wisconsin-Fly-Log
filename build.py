#!/usr/bin/env python3
"""Build Coulee.

  python3 build.py              join src/*.js into js/app.js (the live app everyone uses)
  python3 build.py --beta N     build test version N into beta/ (founder and admins get it first)
  python3 build.py --promote    copy the approved test version in beta/ over the live app

The live app sits at the site root; the test copy sits in beta/ and shares the root's
data/, vendor/ and icons/ folders. Promoting reverses exactly the path changes --beta makes.
"""
import json, pathlib, re, shutil, sys

root = pathlib.Path(__file__).parent
beta = root / "beta"

def joined():
    parts = sorted((root / "src").glob("*.js"))
    return "\n".join(p.read_text() for p in parts), [p.name for p in parts]

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

def build_beta(n):
    live = json.loads((root / "build.json").read_text())["build"]
    if n <= live:
        sys.exit(f"test build {n} must be newer than the live build {live}")
    js, _ = joined()
    (beta / "js").mkdir(parents=True, exist_ok=True); (beta / "css").mkdir(exist_ok=True)
    (beta / "js" / "app.js").write_text(js)
    shutil.copy(root / "css" / "app.css", beta / "css" / "app.css")
    shutil.copy(root / "terms.html", beta / "terms.html")
    cfg = (root / "js" / "config.js").read_text()
    cfg = re.sub(r"build: \d+", f"build: {n}", cfg)
    cfg += BETA_MARK + 'window.FLYLOG_CONFIG.channel = "beta";\nwindow.FLYLOG_CONFIG.dataBase = "../data/";\n'
    (beta / "js" / "config.js").write_text(cfg)
    (beta / "index.html").write_text(to_beta((root / "index.html").read_text()))
    sw = (root / "sw.js").read_text()
    sw = re.sub(r'const VERSION = "flylog-v\d+";', f'const VERSION = "flylog-beta-v{n}";', sw)
    (beta / "sw.js").write_text(to_beta(sw))
    man = json.loads((root / "manifest.webmanifest").read_text())
    man["name"] = "Coulee (test)"
    for i in man["icons"]: i["src"] = "../" + i["src"]
    (beta / "manifest.webmanifest").write_text(json.dumps(man, indent=2) + "\n")
    (beta / "build.json").write_text(json.dumps({"build": n}) + "\n")
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
    (root / "build.json").write_text(json.dumps({"build": n}) + "\n")
    print(f"released build {n} to everyone (was {live})")

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--beta"]: build_beta(int(a[1]))
    elif a[:1] == ["--promote"]: promote()
    else: build_live()

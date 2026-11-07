#!/usr/bin/env python3
"""Join the app's source files (src/*.js, in name order) into js/app.js."""
import pathlib
root = pathlib.Path(__file__).parent
parts = sorted((root / "src").glob("*.js"))
(root / "js" / "app.js").write_text("\n".join(p.read_text() for p in parts))
print("built js/app.js from", ", ".join(p.name for p in parts))

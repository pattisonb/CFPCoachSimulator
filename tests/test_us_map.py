import json, re, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
js = (ROOT / "web" / "us-states.js").read_text()
paths = json.loads(re.search(r"paths\s*:\s*(\{.*\})\s*\}\s*;?\s*$", js, re.S).group(1))
assert len(paths) == 51 and {"TX", "AK", "HI", "DC"} <= set(paths)
assert all(p.startswith("M") for p in paths.values()) and len(js) < 200_000
print("us map ok: 51 state outlines,", len(js), "bytes")

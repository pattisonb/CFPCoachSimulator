"""Find real names left in a generic build: `leaks(root, terms)` reads the staged, swapped project at `root` (what
ships: the game's packages, its data and the app's source) and reports every real name in `terms` (scrub.terms of
the real project) it still holds, as {kind: {name: where it was first seen}}."""
from __future__ import annotations

import json
import re
from pathlib import Path

SOURCE = {".py", ".ts", ".tsx", ".html", ".css"}
_NAME = re.compile(r"[A-Z][\w'’.\-]*(?: [A-Z][\w'’.\-]*){1,4}")


def _strings(node, out: set[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            out.add(k)
            _strings(v, out)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    elif isinstance(node, str):
        out.add(node)


def shipped(root: Path, files: list[str] | None = None) -> list[Path]:
    """The files a build ships from the staged project: `files` (game.zip's paths) and the app's source."""
    root = Path(root)
    if files is None:
        files = [p.relative_to(root).as_posix() for p in root.rglob("*") if p.suffix in SOURCE | {".json"}
                 and "node_modules" not in p.parts and "ui" not in p.relative_to(root).parts[:1]]
    out = [root / f for f in files]
    ui = root / "ui"
    if ui.is_dir():
        out += [p for p in sorted(ui.rglob("*")) if p.suffix in SOURCE and "node_modules" not in p.parts and "dist" not in p.parts]
    return out


def leaks(root: Path, terms: dict[str, set[str]], files: list[str] | None = None) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {"people": {}, "phrases": {}, "words": {}, "slugs": {}, "player_slugs": {}}
    phrase = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(k) for k in sorted(terms["phrases"], key=len, reverse=True)) + r")(?![A-Za-z0-9_])")
    word = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(k) for k in sorted(terms["words"])) + r")(?![A-Za-z0-9_])")
    for path in shipped(root, files):
        where = path.relative_to(root).as_posix()
        if path.suffix == ".json" and where.startswith("cfb_sim_data/faces/"):
            # a team's preset faces: the names in it are who each face belongs to (a player's id, a coach's name). The
            # faces themselves are part ids from the face library the app ships anyway, and one hair color there is
            # spelled like a school's id, so only the owners are read
            doc = json.loads(path.read_text(encoding="utf-8"))
            strings = {k[6:] if k.startswith("coach:") else k for group in doc.values() if isinstance(group, dict) for k in group}
        elif path.suffix == ".json":
            strings: set[str] = set()
            _strings(json.loads(path.read_text(encoding="utf-8")), strings)
        else:
            text = path.read_text(encoding="utf-8")
            if path.suffix in (".ts", ".tsx", ".css"):       # comments never reach the built app
                text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
                text = re.sub(r"(?m)(^|\s)//.*$", " ", text)
            strings = {text}
        for s in strings:
            if s in terms["slugs"]:
                found["slugs"].setdefault(s, where)
            if s in terms["player_slugs"]:
                found["player_slugs"].setdefault(s, where)
            if len(s) < 3 or not any(ch.isupper() for ch in s):
                continue
            for m in phrase.finditer(s):
                found["phrases"].setdefault(m.group(0), where)
            for m in word.finditer(s):
                found["words"].setdefault(m.group(0), where)
            for m in _NAME.finditer(s):
                parts = m.group(0).split(" ")
                for i in range(len(parts)):
                    for j in range(i + 2, min(len(parts), i + 4) + 1):
                        cand = " ".join(parts[i:j])
                        if cand in terms["people"]:
                            found["people"].setdefault(cand, where)
    return {k: v for k, v in found.items() if v}

"""Title Case where the house rules ask for it (CLAUDE.md "Copy and casing"): kickers, tags, buttons,
column headers, headings, option labels, menu items and stat labels on the page, and the engine's
title tables (stage names, tier words, role names, rating labels, grade words, week labels, moods).
A title whose words start lowercase fails, except the small words inside it (a, an, the, of, to, for,
and, or, in, on, at, by), words with digits, abbreviations and the few titles in copy_case_allow.txt.
Native and fast: a regex over the sources, no browser. `python3 tests/test_copy_case.py`"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
WEB = ROOT / "web"

# TODO(pass 2): web/recruiting.js and web/scouting.js (and coach_career/scenes.py, coach_career/prospects.py)
# are being edited by other workers; add them here once their Title Case pass lands.
PAGES = ["season.js", "offseason.js", "coach.js", "gameview.js", "us-map.js", "index.html", "coach.html", "depth/depth.js"]

SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"}
ALLOW = {line.strip() for line in (ROOT / "tests" / "copy_case_allow.txt").read_text(encoding="utf-8").splitlines()
         if line.strip() and not line.startswith("#")}

STR = r'(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)'       # a JS string or template literal, its body in group 1 or 2
JS_PATTERNS = [
    ("kicker/tag", re.compile(r'class:\s*(?:"go-(?:kicker|tag)[^"]*"|`go-(?:kicker|tag)[^`]*`)[^}\n]*?\btext:\s*' + STR)),
    ("button", re.compile(r'el\("button",\s*\{[^}\n]*?\btext:\s*' + STR)),
    ("th/heading/option", re.compile(r'el\("(?:th|h[1-4]|option|summary|legend)",\s*\{[^}\n]*?\btext:\s*' + STR)),
    ("btn()", re.compile(r'\bbtn\("[a-z0-9 ]*",\s*' + STR)),          # season.js: btn(classes, label, ...)
    ("btn() label", re.compile(r'\bbtn\("([A-Z][^"]*)",')),              # offseason.js: btn(label, sub, ...)
    ("step()", re.compile(r'\bstep\(\d+,\s*' + STR)),
    ("settings row", re.compile(r'\brow\(' + STR)),
    ("stat()", re.compile(r'\bstat\(' + STR)),
    ("modal title", re.compile(r'openModal\(\s*' + STR)),
    ("label/name", re.compile(r'\b(?:label|name|heading):\s*' + STR)),
]
HTML_PATTERNS = [
    ("button", re.compile(r"<button[^>]*>([^<]+)</button>")),
    ("th", re.compile(r"<th[^>]*>([^<]+)")),
    ("heading", re.compile(r"<h[1-4][^>]*>([^<]+)")),
    ("nav", re.compile(r"<a [^>]*data-nav[^>]*>([^<]+)</a>")),
    ("option", re.compile(r"<option[^>]*>([^<]+)")),
]
WORD = re.compile(r"\w[\w'’.+/-]*")          # "1st", "3rd%" and "20+" are words too: they never fail


def flatten(text: str) -> str:
    """A template literal's static words, each `${...}` a stand-in word so position (first, last) survives."""
    while "${" in text:
        text, n = re.subn(r"\$\{(?:[^{}]|\{[^{}]*\})*\}", "X", text)
        if not n:                              # a template cut short (a nested literal): drop the open tail
            text = text[:text.index("${")]
    return text.replace("\\n", " ").strip()


def bad_words(title: str) -> list[str]:
    """The words of a title that break Title Case."""
    if title in ALLOW:
        return []
    words = WORD.findall(title)
    out = []
    for i, w in enumerate(words):
        if not w[0].islower():
            continue
        if any(ch.isdigit() for ch in w):
            continue
        if w in SMALL and 0 < i < len(words) - 1:
            continue
        out.append(w)
    return out


def page_titles() -> list[tuple[str, str, str]]:
    """(file:line, kind, title) for every title-bearing literal in the pass's page sources."""
    found = []
    for name in PAGES:
        src = (WEB / name).read_text(encoding="utf-8")
        patterns = HTML_PATTERNS if name.endswith(".html") else JS_PATTERNS
        for kind, rx in patterns:
            for m in rx.finditer(src):
                raw = next((g for g in m.groups() if g is not None), "")
                title = flatten(raw)
                if not WORD.search(title):
                    continue
                line = src.count("\n", 0, m.start()) + 1
                found.append((f"web/{name}:{line}", kind, title))
    return found


def engine_titles() -> list[tuple[str, str, str]]:
    """(where, kind, title) for the engine's title tables that reach the page as names, tags and labels."""
    from coach_career import offseason, programs, recruiting, carousel
    from sim import season, coaches
    tables = [
        ("coach_career/offseason.py STAGE_NAMES", offseason.STAGE_NAMES.values()),
        ("coach_career/offseason.py RATING_WORDS", offseason.RATING_WORDS.values()),
        ("coach_career/offseason.py ROLE_NAMES", offseason.ROLE_NAMES.values()),
        ("coach_career/offseason.py HONOR_NAMES", offseason.HONOR_NAMES.values()),
        ("coach_career/offseason.py _chance_word", [offseason._chance_word(c) for c in (0.9, 0.5, 0.3, 0.0)]),
        ("coach_career/programs.py TIER_NAMES", programs.TIER_NAMES.values()),
        ("coach_career/recruiting.py WORDS", recruiting.WORDS),
        ("coach_career/recruiting.py COACHABILITY_POINTS", recruiting.COACHABILITY_POINTS.keys()),
        ("coach_career/carousel.py mood", [carousel.mood(s) for s in (95, 70, 50, 10)]),
        ("sim/season.py RATING_LABELS", [lbl for _, lbl in season.RATING_LABELS]),
        ("sim/season.py BOWL_WEEK_LABELS", season.BOWL_WEEK_LABELS.values()),
        ("sim/season.py week_label", [season.week_label(w) for w in (season.CCG_WEEK, season.SELECTION_WEEK)]),
        ("sim/season.py DEV_TRAITS", season.DEV_TRAITS),
        ("sim/coaches.py RATING_LABELS", coaches.RATING_LABELS.values()),
    ]
    return [(where, "engine", t) for where, values in tables for t in values]


if __name__ == "__main__":
    os.environ.setdefault("SIM_WORKERS", "1")
    titles = page_titles() + engine_titles()
    assert len(titles) > 200, f"the sweep found only {len(titles)} titles: a pattern broke"
    failures = [(where, kind, title, bad) for where, kind, title in titles for bad in [bad_words(title)] if bad]
    for where, kind, title, bad in failures:
        print(f"{where}  [{kind}]  {title!r}  lowercase: {bad}")
    assert not failures, f"{len(failures)} titles are not Title Case"
    print(f"copy case ok: {len(titles)} titles over {len(PAGES)} page sources and the engine's title tables")

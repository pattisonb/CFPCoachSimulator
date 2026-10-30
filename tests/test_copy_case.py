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

PAGES = ["season.js", "offseason.js", "coach.js", "gameview.js", "us-map.js", "recruiting.js", "scouting.js", "index.html", "coach.html"]

SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"}
ALLOW = {line.strip() for line in (ROOT / "tests" / "copy_case_allow.txt").read_text(encoding="utf-8").splitlines()
         if line.strip() and not line.startswith("#")}

STR = r'(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)'       # a JS string or template literal, its body in group 1 or 2
JS_PATTERNS = [
    ("kicker/tag/chip/badge", re.compile(r'class:\s*(?:"(?:go-(?:kicker|tag|chip|badge|pill|display)|sc-sr)[^"]*"|`go-(?:kicker|tag|chip|badge|pill|display)[^`]*`)[^}\n]*?\btext:\s*' + STR)),
    ("button", re.compile(r'el\("button",\s*\{[^}\n]*?\btext:\s*' + STR)),
    ("th/heading/option", re.compile(r'el\("(?:th|h[1-4]|option|summary|legend)",\s*\{[^}\n]*?\btext:\s*' + STR)),
    ("btn()", re.compile(r'\bbtn\("[a-z0-9 ]*",\s*' + STR)),          # season.js: btn(classes, label, ...)
    ("btn() label", re.compile(r'\bbtn\("([A-Z][^"]*)",')),              # offseason.js: btn(label, sub, ...)
    ("step()", re.compile(r'\bstep\([^,\n]+,\s*' + STR)),                 # season.js step(n, label); recruiting.js step(mark, title, sub, ...)
    ("th()", re.compile(r'\bth\("[a-z]+",\s*' + STR)),                   # scouting.js: th(cls, label, sortKey)
    ("meter()", re.compile(r'\bmeter\(' + STR)),                           # recruiting.js: meter(label, value, total)
    # [key, label] pairs (and [key, label, tip] triples) with a lowercase key: options, tabs, chips, segments, columns
    ("pair label", re.compile(r'\[\s*"[a-z_0-9]*",\s*"((?=[^"]*[A-Z ])[^"]+)"(?:,\s*"[^"]*")?\s*\]')),   # a label has a capital or a space; ["chance", "rank"] is data
    ("settings row", re.compile(r'\brow\(' + STR)),
    ("stat()", re.compile(r'\bstat\(' + STR)),
    ("modal title", re.compile(r'openModal\(\s*' + STR)),
    ("label/name", re.compile(r'(?<!"radio", )\b(?:label|name|heading):\s*' + STR)),   # not a radio group's name attribute
]
# a button relabeled in place: more.textContent = open ? "Show Fewer" : `Show All ${n}`; every literal in it is a title
BUTTON_RELABEL = re.compile(r'\b(?:more|tBtn|finishBtn|add|onBoard|toggle)\.textContent\s*=\s*([^;\n]+)')
# a list of column headers mapped onto th cells: ["Program", "Standing", ...].map((h) => el("th", ...)); every entry is a title
TH_LIST = re.compile(r'(\[(?:"[^"]*",\s*)+"[^"]*"\])\.map\(\(\w+\)\s*=>\s*el\("th"')
# the page's name tables (PITCH_NAMES, GROUP_NAMES, ACTION_NAMES, GRADE_NAMES, FLAGS): every value a title shown as a tag, an
# option or a kicker; ATTR_NAMES and LINE_LABELS are sentence words and stat abbreviations, not titles
NAME_TABLE = re.compile(r'const (?!ATTR_)(\w+_NAMES|FLAGS)\s*=\s*\{([^}]*)\}')
NAME_VALUE = re.compile(r':\s*\[?"([^"]*)"')
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
        if name.endswith(".js"):
            for m in TH_LIST.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                found.extend((f"web/{name}:{line}", "th list", t) for t in re.findall(r'"([^"]*)"', m.group(1)) if WORD.search(t))
            for m in BUTTON_RELABEL.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                for g1, g2 in re.findall(STR, re.sub(r'[!=]==\s*"[^"]*"', "", m.group(1))):   # not the operand of a comparison
                    t = flatten(g1 or g2)
                    if WORD.search(t):
                        found.append((f"web/{name}:{line}", "button relabel", t))
            for m in NAME_TABLE.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                found.extend((f"web/{name}:{line}", f"{m.group(1)} value", t) for t in NAME_VALUE.findall(m.group(2)) if WORD.search(t))
    return found


def engine_titles() -> list[tuple[str, str, str]]:
    """(where, kind, title) for the engine's title tables that reach the page as names, tags and labels."""
    from coach_career import offseason, programs, recruiting, carousel, prospects, scenes
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
        ("coach_career/prospects.py ROLE_NAMES", prospects.ROLE_NAMES.values()),
        ("coach_career/prospects.py STANDING_WORDS", prospects.STANDING_WORDS.values()),
        ("coach_career/prospects.py CERTAINTY", [label for _, label in prospects.CERTAINTY]),
        ("coach_career/prospects.py _role", [prospects._role(pt) for pt in (1.0, 0.5, 0.1)]),
        ("coach_career/offseason.py PT_NAMES", offseason.PT_NAMES.values()),
        ("coach_career/scenes.py ANSWER_LABELS", scenes.ANSWER_LABELS.values()),
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
    # the answer buttons' labels: the page keeps a copy of scenes.ANSWER_LABELS, and the two must agree
    from coach_career import scenes
    js = re.search(r"const ANSWER_LABELS = \{([^}]*)\}", (WEB / "recruiting.js").read_text(encoding="utf-8"))
    assert js and dict(re.findall(r'(\w+):\s*"([^"]*)"', js.group(1))) == scenes.ANSWER_LABELS, "web/recruiting.js ANSWER_LABELS differs from coach_career/scenes.py"
    print(f"copy case ok: {len(titles)} titles over {len(PAGES)} page sources and the engine's title tables")

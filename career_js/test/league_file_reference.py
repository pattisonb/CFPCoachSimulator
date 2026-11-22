"""Python's answers for career_js/league_file.js (the port of coach_career/league_file.py):
python3 career_js/test/league_file_reference.py OUTDIR   (then: node career_js/test/league_file_compare.mjs OUTDIR)

Writes, as JSON in OUTDIR (keep it out of the repo: about 80 MB):
  setup.json        what the JavaScript's stand-ins for the modules not ported yet answer with (league's metas, ...)
  base_league.json  league.from_base(YEAR + 1), the stand-in league module's answer
  export_norm.txt   the built-in export's bytes (a whole float written as a whole number, the one thing JavaScript cannot keep)
  small.json        the small helpers on hand-made values
  json_fuzz.json    texts, broken and whole, and what parse() makes of each
  fuzz.json         league files with one thing changed each, and the whole pipeline's answers (parse, rivalry_names,
                    problems, validate, merge, divisions, conference_names, schedule_rules, engine_name)
  calls.json        every call the repo's own league tests make of this module's functions (inputs and answers)
  checks.json       check() runs: the file, the answers of the modules not ported yet in the order asked, the result
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import base64
import copy
import importlib.util
import json
import random
import time
from collections import defaultdict

from coach_career import coach_names, league, league_file as lf, league_fill, offseason, recruits
from sim import coaches as sim_coaches, schedule_gen, season
from teamdata import game_scale, ratings as rv

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def write(name, data):
    (OUT / name).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")      # (escaped: a text here can hold half a surrogate pair)


def whole(v):
    """`v` with every whole float as a whole number (3.0 -> 3): JavaScript has one kind of number."""
    if isinstance(v, float) and v == v and abs(v) != float("inf") and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: whole(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [whole(x) for x in v]
    return v


def text_of(v):
    return json.dumps(whole(v), ensure_ascii=False, separators=(",", ":"))


ATTRS = game_scale.keys()
YEAR = lf.YEAR

# ---- setup: the stand-in modules' answers -----------------------------------------------------------------------
write("setup.json", {
    "FIRST_YEAR": league.FIRST_YEAR, "CLASSES": list(league.CLASSES), "base_slugs": list(league.base_slugs()),
    "base_meta": {s: league.base_meta(s) for s in league.base_slugs()}, "ROSTER_LIMIT": offseason.ROSTER_LIMIT,
    "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF,
    "words": {k: (sorted(v) if isinstance(v, frozenset) else v) for k, v in lf._words().items()},
    "UNTOUCHED_LINE": lf.UNTOUCHED_LINE, "YEAR": lf.YEAR,
    "builtin": {k: (sorted(v) if isinstance(v, set) else v) for k, v in lf._builtin().items()},
    "builtin_rosters": lf._builtin_rosters(), "base_members": lf._base_members(),
})
(OUT / "base_league.json").write_text(json.dumps(league.from_base(YEAR + 1), ensure_ascii=False), encoding="utf-8")
EXPORT = lf.export_document()
EXPORT_BYTES = lf.builtin_bytes()
assert EXPORT_BYTES == lf.dumps(EXPORT)
(OUT / "export_norm.txt").write_bytes((text_of(EXPORT) + "\n").encode("utf-8"))
(OUT / "export_py.txt").write_bytes(EXPORT_BYTES)
BASE = {t["slug"]: t for t in copy.deepcopy(EXPORT["teams"])}      # our own copy of _builtin_docs (check() drops the module's)
assert BASE == lf._builtin_docs()
log("setup written")


# ---- slimming: a built-in team's 170 KB doc as a marker the JavaScript fills in from its own built-in docs ----------
def slim_team(t):
    if isinstance(t, dict) and isinstance(t.get("slug"), str) and t["slug"] in BASE and BASE[t["slug"]] == t:
        return {"=base": t["slug"]}
    return t


def slim_doc(doc):
    if isinstance(doc, dict) and isinstance(doc.get("teams"), list):
        return {**doc, "teams": [slim_team(t) for t in doc["teams"]]}
    return doc


def slim_merged(m):
    if isinstance(m, dict) and isinstance(m.get("teams"), dict):
        return {**m, "teams": {s: slim_team(m["teams"][s]) for s in sorted(m["teams"])}}       # (Python's own order is by hash)
    return m


TEAM_KEYS = ("name", "school", "abbreviation", "mascot", "city", "conference", "fictional")


def slim_teams(teams):
    return {s: {k: t[k] for k in TEAM_KEYS if k in t} for s, t in teams.items()}


def slim_lgd(lgd):
    out = {}
    for k, v in lgd.items():
        if k == "teams":
            out[k] = {s: {"roster": [0] * len(t["roster"])} for s, t in v.items()}
        else:
            out[k] = v if len(json.dumps(v)) < 300000 else "<big>"
    return out


def slim_engine(engine):
    return {k: (slim_teams(v) if k == "teams" else v if len(json.dumps(v)) < 300000 else "<big>") for k, v in engine.items()}


# ---- small helpers -------------------------------------------------------------------------------------------------
NAMES = ["American Athletic Conference", "Big 12", "Pac-12", "  SEC  ", "FBS Independent", "Mid-American (MAC)", "", "---", "A&M--West", "Éire Ligue",
         "İstanbul", "ΣΟΦΟΣ", "big_sky.east", 12, None, True, 1.5, "Straße 9", "a\nb", "ǅungla"]
small = {
    "conference_id": [[n, lf.conference_id(n)] for n in NAMES],
    "_or": [[w, lf._or(w)] for w in (["A"], ["A", "B"], ["A", "B", "C"], list(lf.POSITIONS))],
    "_num_text": [[x, lf._num_text(x)] for x in (0.3, 1.3, 2.0, 0.0001, 0.00001234, 123456.0, 1234567.0, 100.0, 0.1 + 0.2, 1e-7, 99999.95, 12.5, 1e21, 0.30000004)],
    "_is_int": [[v, lo, hi, lf._is_int(v, lo, hi)] for v in (1, 0, 99, 100, -1, 1.5, 3.0, True, False, None, "3", [], {}, 1e30) for lo, hi in ((0, 99), (1, 99))],
    "_is_num": [[v, lo, hi, lf._is_num(v, lo, hi)] for v in (1, 0, 99, 100.5, -1, 1.5, 3.0, True, None, "3", [], {}) for lo, hi in ((0, 100), (-90, 90))],
    "_say": [[v, lf._say(v)] for v in ("x", "", 1, None, True, [1], {"a": 1})],
    "_count": [[n, lf._count(n, "player", "players")] for n in (0, 1, 2, 85)],
    "_capped": [[n, lf._capped([f"Problem {i}." for i in range(n)])] for n in (0, 1, 49, 50, 51, 120)],
    "_failed": [[n, tot, lf._failed([f"Problem {i}." for i in range(n)], tot)] for n in (1, 50, 51, 77) for tot in (None, 500)],
    "_new_rule": [[n, g, lf._new_rule(n, g)] for n in (1, 2, 8, 9, 10, 14) for g in (0, 1, 7, 8, 9)],
    "checks_label": [[s, lf.checks_label([["Alder Tech", {}, "alder-tech", False], ["Rice", {}, "rice", True]], s)] for s in ("rice", "alder-tech", "zzz")],
    "constants": {k: getattr(lf, k) for k in (
        "MAX_LEAGUE_BYTES", "MAX_TEAMS", "MAX_ERRORS", "MAX_CONFERENCE_GAMES", "POSITIONS", "POS_IN", "STRENGTH_WORDS", "FORMAT", "NAME", "YEAR",
        "LEVEL", "_COACH_ROLES", "_FILE_POS", "_GAME_POS", "_MB", "HOME_FIELD_RANGE", "STADIUM_CAPACITY_MAX", "SURFACES", "YEARS_RANGE",
        "TARGET_SHARE_MIN", "JERSEY_RANGE", "MAX_HOMETOWN", "UNIT_PLAYERS", "FORMATION_ROLES", "ABILITY_TIERS", "_ROLE_WORD", "_COACH_RATINGS",
        "_COACH_TENDENCIES", "_COACH_SCHEMES", "_COACH_TEXT", "_COACH_FLAGS", "DEFAULT_NAME", "NEW_CONFERENCE_POWER_ROAD",
        "NEW_CONFERENCE_FCS_MAX", "UNTOUCHED_LINE", "RIVALRY_NAME_MAX")},
    "slug_re": [[s, bool(lf._SLUG.match(s))] for s in ("a", "a-b", "a--b", "-a", "a-", "A", "a\n", "a\n\n", "12", "", "a b", "é")],
    "hex_re": [[s, bool(lf._HEX.match(s))] for s in ("#0B6E4F", "#0b6e4f", "#0B6E4", "0B6E4F", "#0B6E4F\n", "#0B6E4G", "#0B6E4F0")],
}
write("small.json", small)


# ---- parse(): texts, broken and whole ---------------------------------------------------------------------------
def parsed(blob):
    try:
        doc = lf.parse(blob)
    except lf.LeagueFileError as e:
        return {"errors": e.errors, "message": str(e)}
    return {"doc": text_of(doc)}


def blob_of(spec):
    if "b64" in spec:
        return base64.b64decode(spec["b64"])
    return "".join(s * n for s, n in spec["parts"]).encode("utf-8")


def spec_text(text):
    try:
        text.encode("utf-8")
        return {"parts": [[text, 1]]}
    except UnicodeEncodeError:          # a lone surrogate cannot be written; skip
        return None


def spec_bytes(b):
    return {"b64": base64.b64encode(b).decode("ascii")}


F = '"format":"cfp-league/1"'
PLAYER_ATTRS = ATTRS[:6]
W = lf._words()
ARCH = sorted(W["archetype"])[0]
TRAIT = sorted(W["ability"])[0]


def full_player(i, pos, cls, **kw):
    p = {"id": f"alder-p{i}", "name": f"Player {i} O'Neil", "pos": pos, "class": cls, "overall": 70, "stars": 3,
         "ratings": {k: 60 + i for k in PLAYER_ATTRS}, "potential": {k: 70 + i for k in PLAYER_ATTRS[:3]}, "height": 74, "weight": 210.5,
         "jersey": i, "archetype": ARCH, "dev": "Normal", "abilities": [{"name": TRAIT, "tier": "Gold"}],
         "coachability": W["coachability"][0], "hometown": "OR", "years": 2, "target_share": 1.0}
    p.update(kw)
    return p


def fuzz_doc():
    rice = copy.deepcopy(BASE["rice"])
    coaches = copy.deepcopy(rice["coaches"])
    for k in ("head", "oc", "dc"):
        coaches[k]["name"] = f"Coach {k.upper()} Alder"
    alder = {"slug": "alder-tech", "name": "Alder Tech University", "short_name": "Alder Tech", "abbreviation": "ATU", "mascot": "Owls",
             "city": "Bend", "state": "OR", "lat": 44.05, "lon": -121.31, "conference": "big-sky-east", "level": "FBS",
             "colors": {"primary": {"name": "Green", "hex": "#0B6E4F"}, "secondary": {"name": "White", "hex": "#FFFFFF"}, "accent": {"hex": "#000000"}},
             "stadium": {"name": "Owl Field", "capacity": 30000, "surface": "turf"}, "home_field": 55, "style": "boise-state",
             "strength": "Average", "prestige": 40, "formation": copy.deepcopy(rice["formation"]), "coaches": coaches,
             "rivals": ["oregon-state", {"slug": "bse-1", "name": "The Pine Game", "every_year": True, "rivalry_week": True},
                        {"slug": "bse-2", "every_year": False}],
             "roster": [full_player(1, "QB", "JR"), full_player(2, "WR", "SO", jersey="7"), full_player(3, "RB", "FR"), full_player(4, "FB", "SRRS")],
             "depth_chart": {"QB": ["Player 1 O'Neil"], "WR": ["player 2 o'neil "], "HB": ["Player 3 O'Neil"]}}
    edit = {"slug": "rice", "prestige": 50.5, "strength": 80, "home_field": 60,
            "coaches": {"head": {"name": "New Rice Coach", "rating": 80, "ratings": {"overall": 80, "offense": 75}, "tendencies": {"aggressiveness": 55.5},
                                 "scheme": {"offensive_philosophy": W["offense"][0], "defensive_philosophy": W["defense"][0]}, "since": 2020,
                                 "is_interim": False, "notes": "A note.", "role": "head_coach"},
                        "oc": {"ratings": {"play_calling": 70}, "tendencies": {"pass_rate": 60}, "scheme": {"offensive_scheme": W["offense"][1]}},
                        "dc": {"scheme": {"defensive_scheme": W["defense"][1]}, "vacant": False}, "offense": W["offense"][0], "defense": W["defense"][0]},
            "roster": [full_player(11, "QB", "SR", id="rice-new-qb"), full_player(12, "K", "JR", id="rice-new-k")],
            "depth_chart": {"QB": ["Player 11 O'Neil"], "K": ["Player 12 O'Neil"]}, "rivals": ["houston", "alder-tech"]}
    kept = {"slug": "tulsa", "depth_chart": {"QB": [BASE["tulsa"]["roster"][0]["name"]]}, "colors": {"primary": {"hex": "#112233"}},
            "stadium": {"capacity": 25000}, "conference": "American Athletic Conference"}
    moved = {"slug": "troy", "conference": "big-sky-east"}
    members = [{"slug": f"bse-{i}", "name": f"Big Sky {i}", "conference": "big-sky-east", "state": "ID"} for i in range(1, 8)]
    return {"format": "cfp-league/1", "name": "Fuzz League", "year": 2026, "remove": ["kent-state"],
            "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8},
                            {"id": "sec", "name": "Southeastern"}, {"id": "empty-one", "name": "Nobody Home", "games": 0}],
            "teams": [alder, edit, kept, moved] + members}


FUZZ_DOC = fuzz_doc()
assert lf.rivalry_names(copy.deepcopy(FUZZ_DOC))[1] == []
_d = copy.deepcopy(FUZZ_DOC)
lf.rivalry_names(_d)
assert lf.problems(_d) == [], lf.problems(_d)

rng = random.Random("league-file-json-fuzz")
SMALL_DOC = {"format": "cfp-league/1", "name": "Ünï \"quoted\" 😀 \\ league", "year": 2026, "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "games": 8}],
             "teams": [{"slug": "alder-tech", "name": "Alder\tTech", "lat": 44.05, "lon": -121.31, "prestige": 4e1, "x": [True, False, None, -0.5, 1e-7, 12345678901234]}]}
texts = []
for base_text in (json.dumps(SMALL_DOC, ensure_ascii=False, indent=1), json.dumps(SMALL_DOC), json.dumps(SMALL_DOC, ensure_ascii=False, separators=(",", ":"))):
    texts.append(base_text)
    chars = list('{}[],:"\\ \n\t\rabcu01.-+eENI/') + ["é", "😀", "\x01", " ", "null", "true", "tru", "NaN", "Infinity", "-Infinity", "\\u00e9", "\\ud83d", "\\uZZZZ", "\\x"]
    for _ in range(700):
        t = base_text
        for _ in range(rng.choice((1, 1, 1, 2))):
            i = rng.randrange(len(t) + 1)
            how = rng.random()
            if how < 0.3:
                t = t[:i] + t[i + 1:]
            elif how < 0.6:
                t = t[:i] + rng.choice(chars) + t[i:]
            elif how < 0.8:
                t = t[:i] + rng.choice(chars) + t[i + 1:]
            else:
                t = t[:i]
        texts.append(t)
HAND = ['', '  ', '[1,]', '{"a":1,}', '{"a":1 "b"}', '[1 2]', '{a:1}', '"abc', '"a\\x"', '"a\\u12"', '"a\\u12G4"', '[1] x', '﻿{}', 'NaN', '[-Infinity]',
        '{"x":Infinity}', '-', '01', '1.', '1e', '-x', '{"a"}', '{"a":}', '["a\tb"]', 'tru', '[', '{', '{"a":1', '"\\', '"\\u123', '"\\u1234', '"\\u1234"',
        '9' * 5000, '-' + '9' * 4301, '[' + '9' * 4300 + ']', '1e999', '[1,2', "{'a':1}", '[1,\n 2,\n  x]', '["😀", x]', '\n\n{"format":\n"cfp-league/1",}', 'null', 'true',
        '[]', '{}', '"cfp-league/1"', '{"format":"cfp-league/2"}', '{"format":12}', '{"format":null}', '{"format":["cfp-league/1"]}', '{"Format":"cfp-league/1"}',
        '{%s}' % F, ' \t\r\n{%s} \n' % F, '{%s,"format":"x"}' % F, '{"format":"x",%s}' % F, '{%s}{}' % F, '{%s,"a":"\\ud83d\\ude00\\u00e9\\n\\/\\b\\f\\r\\t\\"\\\\"}' % F,
        '{%s,"a":"\\ud83d"}' % F, '{%s,"a":"\\ud83d\\u00e9"}' % F, '{%s,"a":"\\ud83d\\uZZZZ"}' % F, '{%s,"12":1,"3":2,"a":3,"1":4,"007":5,"-1":6,"4294967295":7,"1.5":8}' % F,
        '{%s,"__proto__":{"x":1},"constructor":2,"toString":3,"a":{"__proto__":1}}' % F, '{%s,"a":1,"b":2,"a":3,"2":1,"1":2,"2":3}' % F,
        '{%s,"year":2026.0,"n":[1.0,2.50,1E2,1e+2,-0.0,-0,0.1e-6,123456789012345680000,1.7976931348623157e308,5e-324]}' % F, '{%s,"a":"\x7f  "}' % F,
        '{%s,"a":"\x1f"}' % F, '{%s,"a":"\r"}' % F, '{%s} \x0b' % F, '{%s} ' % F, '{%s,"a":[[[[[[[[[[1]]]]]]]]]]}' % F, '﻿﻿{%s}' % F]
texts += HAND
json_fuzz = []
for t in texts:
    spec = spec_text(t)
    if spec:
        json_fuzz.append({"blob": spec, "expect": parsed(blob_of(spec))})
BYTES = [b"\xef\xbb\xbf{" + F.encode() + b"}", b"\xef\xbb\xbf\xef\xbb\xbf{" + F.encode() + b"}", b"\xff\xfe{}", b"{" + F.encode() + b',"a":"\xc3"}', b"\xed\xa0\x80", b"\xc0\xaf",
         b"{" + F.encode() + b',"a":"\xf0\x9f\x98\x80"}', b"\xf4\x90\x80\x80", b"{" + F.encode() + b"}\x00", b"\x00", b"\xef\xbb{}", "{%s}" % F.encode("utf-16").decode("latin-1") and "{}".encode("utf-16")]
for b in BYTES:
    json_fuzz.append({"blob": spec_bytes(b), "expect": parsed(b)})
for parts in ([["[", 9998], ["]", 9998]], [["[", 9999], ["]", 9999]], [['{"a":', 9998], ["1", 1], ["}", 9998]], [['{"a":', 9999], ["1", 1], ["}", 9999]],
              [['[{"a":', 4999], ["[]", 1], ["}]", 4999]], [['[{"a":', 4999], ["{}", 1], ["}]", 4999]], [['[{"a":', 4999], ["[1]", 1], ["}]", 4999]],
              [["[", 9997], ["[", 1], ["1,", 3], ["]", 2]], [["[", 20000]], [[" ", lf.MAX_LEAGUE_BYTES], ["{}", 1]], [[" ", lf.MAX_LEAGUE_BYTES - 2], ["{}", 1]],
              [["é", lf.MAX_LEAGUE_BYTES // 2], ["x", 1]], [[" ", 70 * 1024 * 1024 + 123456]]):
    spec = {"parts": parts}
    r = parsed(blob_of(spec))
    if "doc" in r and len(r["doc"]) > 100000:
        r = {"doc_length": len(r["doc"])}
    json_fuzz.append({"blob": spec, "expect": r})
write("json_fuzz.json", json_fuzz)
log("json fuzz:", len(json_fuzz), "texts;", sum("errors" in c["expect"] for c in json_fuzz), "errors")


# ---- recording the calls the repo's own tests make ------------------------------------------------------------------
CALLS = defaultdict(list)
SEEN = set()
RECORD = {"on": False}
COUNT = defaultdict(int)


def record(name, inp, out, cap):
    COUNT[name] += 1
    if len(CALLS[name]) >= cap:
        return
    key = name + json.dumps([inp, out], sort_keys=True, default=str)
    h = hash(key)
    if h in SEEN:
        return
    SEEN.add(h)
    CALLS[name].append({"in": inp, "out": out})


def wrap(name, slim_in, slim_out=lambda r: copy.deepcopy(r), cap=250, after=None):
    real = getattr(lf, name)

    def w(*a, **k):
        if not RECORD["on"]:
            return real(*a, **k)
        assert not k, (name, k)
        inp = copy.deepcopy(slim_in(*a))
        try:
            res = real(*a)
        except Exception as e:  # noqa: BLE001
            record(name, inp, {"raise": type(e).__name__, "errors": getattr(e, "errors", None)}, cap)
            raise
        out = {"result": slim_out(res)}
        if after:
            out["after"] = copy.deepcopy(after(*a))
        record(name, inp, out, cap)
        return res
    w.__wrapped__ = real
    setattr(lf, name, w)


def attrs_in(x, attrs):
    return [x, "=attrs" if list(attrs) == list(ATTRS) else list(attrs)]


wrap("problems", lambda doc: [slim_doc(doc)])
wrap("validate", lambda doc: [slim_doc(doc)])
wrap("rivalry_names", lambda doc: [slim_doc(doc)], after=lambda doc: slim_doc(doc))
wrap("merge", lambda doc: [slim_doc(doc)], slim_out=lambda m: copy.deepcopy(slim_merged(m)), cap=120)
for _n in ("divisions", "conference_names", "schedule_rules"):
    wrap(_n, lambda m: [slim_merged(m)], cap=120)
wrap("engine_name", lambda m, cid: [{"conferences": m["conferences"]}, cid])
wrap("_conf_changed", lambda m, cid: [{"conferences": m["conferences"]}, cid])
wrap("_trimmed_rule", lambda base, c, divs, name: [base, c, divs, name])
wrap("_protect_fits", lambda rule, games, pair: [rule, games, pair])
wrap("_deep_merge", lambda base, over: [base, over])
wrap("_merge_coaches", lambda base, given: [base, given])
wrap("_plain", lambda reason, teams, names=None: [str(reason), slim_teams(teams), names])
wrap("player_doc", attrs_in, cap=400)
wrap("player_compact", attrs_in, cap=400)
wrap("to_league_team", attrs_in, cap=12)
wrap("parse", lambda blob: [spec_bytes(bytes(blob)) if len(blob) < 200000 else None], slim_out=lambda d: text_of(slim_doc(d)), cap=200)

# check(): what the modules not ported yet answered, in the order asked
CHECKS = []
LOG = {"now": None}
FORCE = {}


def patch(mod, name, args_of, result_of):
    real = getattr(mod, name)

    def w(*a, **k):
        if LOG["now"] is None:
            return real(*a, **k)
        entry = {"fn": name, "args": copy.deepcopy(args_of(*a, **k))}
        try:
            if name in FORCE:
                raise FORCE[name]
            res = real(*a, **k)
        except league_fill.TeamBuildError as e:
            entry["raise"] = {"type": "TeamBuildError", "slug": e.slug, "label": e.label}
            LOG["now"].append(entry)
            raise
        except schedule_gen.ScheduleError as e:
            entry["raise"] = {"type": "ScheduleError", "message": str(e)}
            LOG["now"].append(entry)
            raise
        except Exception as e:  # noqa: BLE001
            entry["raise"] = {"type": "Exception", "message": str(e)}
            LOG["now"].append(entry)
            raise
        entry["result"] = copy.deepcopy(result_of(res))
        LOG["now"].append(entry)
        return res
    setattr(mod, name, w)


def first_draw(rng_):
    r2 = random.Random()
    r2.setstate(rng_.getstate())
    return r2.random()


patch(league_fill, "league_seed", lambda blob, seed: [seed], lambda r: r)
patch(league_fill, "to_league", lambda merged, seed: [slim_merged(merged), seed], lambda r: [slim_lgd(r[0]), list(r[1])])
patch(coach_names, "distinct", lambda state, built=False: [sorted(state)], lambda r: None)
patch(league, "build", lambda lgd, me=None: [sorted(lgd["teams"])], slim_engine)
patch(schedule_gen, "empty_history", lambda: [], lambda r: r)
patch(schedule_gen, "generate", lambda year, teams, hist, rng_, rules=None: [year, slim_teams(teams), hist, first_draw(rng_), rules], lambda r: [r[0], r[1]])

real_check = lf.check


def check(blob, seed=None):
    if LOG["now"] is not None:
        return real_check(blob, seed)
    LOG["now"] = []
    try:
        out = real_check(blob, seed)
    finally:
        entries, LOG["now"] = LOG["now"], None
    small_blob = len(blob) < 400000
    if (small_blob or sum(1 for c in CHECKS if c["blob"] == "=export") < 1) and len(CHECKS) < 70:
        exp = dict(out)
        if exp.get("league") is not None:
            exp["league"] = slim_lgd(exp["league"])
        if exp.get("engine") is not None:
            exp["engine"] = slim_engine(exp["engine"])
        if small_blob or bytes(blob) == EXPORT_BYTES:
            CHECKS.append({"blob": spec_bytes(bytes(blob)) if small_blob else "=export", "seed": seed, "log": entries, "expect": copy.deepcopy(exp)})
    return out


lf.check = check


# ---- the pipeline on league files with one thing changed ----------------------------------------------------------
def pipeline(blob):
    out = {}
    try:
        doc = lf.parse(blob)
    except lf.LeagueFileError as e:
        return {"parse_errors": e.errors}
    try:
        names, nerrs = lf.rivalry_names(doc)
    except Exception as e:  # noqa: BLE001
        return {"rivalry_names_raise": type(e).__name__}
    out["names"], out["name_errs"], out["finales"] = names, nerrs, copy.deepcopy(doc.get("_finales"))
    out["rivals_after"] = [t.get("rivals") if isinstance(t, dict) else None for t in doc["teams"]] if isinstance(doc.get("teams"), list) else None
    try:
        probs = lf.problems(doc)
    except Exception as e:  # noqa: BLE001
        out["problems_raise"] = type(e).__name__
        return out
    out["problems"], out["validate"] = probs, lf.validate(doc)
    if not probs and not nerrs:
        m = lf.merge(doc)
        m["finales"] = [sorted(f) for f in doc.get("_finales") or []]
        out["merged"] = slim_merged(m)
        out["divisions"] = lf.divisions(m)
        out["conference_names"] = lf.conference_names(m)
        out["schedule_rules"] = lf.schedule_rules(m)
        out["engine_names"] = [[cid, lf.engine_name(m, cid)] for cid in list(m["conferences"]) + ["nope", "12"]]
        out["conf_changed"] = [[cid, lf._conf_changed(m, cid)] for cid in list(lf._builtin()["conf_names"]) + ["nope"]]
    return copy.deepcopy(out)


class Raw(str):
    """JSON text put into a document as it is (2026.0, NaN, ...)."""


def dump(v):
    if isinstance(v, Raw):
        return str(v)
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + dump(x) for k, x in v.items()) + "}"
    if isinstance(v, list):
        return "[" + ",".join(dump(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def paths(v, at=()):
    yield at
    if isinstance(v, dict):
        for k, x in v.items():
            yield from paths(x, at + (k,))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from paths(x, at + (i,))


def with_at(doc, path, value, delete=False, insert=None):
    doc = copy.deepcopy(doc)
    if not path:
        return value
    o = doc
    for k in path[:-1]:
        o = o[k]
    if delete:
        del o[path[-1]]
    elif insert is not None:
        o[path[-1]][insert] = value
    else:
        o[path[-1]] = value
    return doc


BAD = [None, True, False, 0, -1, 1, 5, 12, 50, 99, 100, 101, 1.5, 80.0, 1e9, -200.25, "", "  ", "x", "QB", "FB", "HB", "SR", "Elite", "FBS", "FCS", "OR", "ZZ", "turf",
       "sec", "SEC", "Sun Belt", "sun-belt", "rice", "alder-tech", "kent-state", "bse-1", "constructor", "12", "Alder Tech", "#ABCDEF", "#abc", "Player 1 O'Neil",
       "x" * 41, "x" * 61, "  The Name  ", "7", "07", "123", "٣", "Ünï 😀", "a-b\n", [], {}, [1], ["x"], ["rice"], ["rice", "rice"], {"a": 1}, {"slug": "rice"}, {"name": "N"},
       {"12": 1, "3": 2}, {"constructor": 1}, [[]], [None], [{}], Raw("2026.0"), Raw("2025.0"), Raw("1e2"), Raw("-0"), Raw("0.30"), Raw("1E400"), Raw("11.0"), Raw("3.0")]
FICT = sorted(lf._builtin()["fict_slugs"])
FICT_CONF = sorted(lf._builtin()["fict_conf"])
BAD += [FICT[0], FICT_CONF[0], FICT_CONF[-1], league.base_meta(FICT[0])["conference"]]

fuzz = []


def add_fuzz(note, text):
    spec = spec_text(text)
    if spec is None:
        return
    blob = blob_of(spec)
    fuzz.append({"note": note, "blob": spec, "expect": pipeline(blob)})


rng = random.Random("league-file-fuzz")
ALL_PATHS = list(paths(FUZZ_DOC))
add_fuzz("whole", dump(FUZZ_DOC))
for p in ALL_PATHS[1:]:
    add_fuzz(f"del {p}", dump(with_at(FUZZ_DOC, p, None, delete=True)))
    for v in rng.sample(BAD, 5):
        add_fuzz(f"set {p} {v!r:.30}", dump(with_at(FUZZ_DOC, p, v)))
    target = FUZZ_DOC
    for k in p:
        target = target[k]
    if isinstance(target, dict):
        for k, v in rng.sample([("constructor", 1), ("12", 5), ("3", "x"), ("zzz", None), ("LB", 2), ("QB", ["Nobody"]), ("FB", "x"), ("speed", 150), ("overall", 50.5),
                                ("tempo", -1), ("KR", 1), ("accent", "red"), ("games", Raw("8.0")), ("year", Raw("2027")), ("__proto__", {"slug": "x"})], 4):
            add_fuzz(f"ins {p} {k}", dump(with_at(FUZZ_DOC, p, v, insert=k)))
    elif isinstance(target, list) and target:
        d = with_at(FUZZ_DOC, p, target + [copy.deepcopy(target[0])])
        add_fuzz(f"dup {p}", dump(d))
log("fuzz: single changes", len(fuzz))


def variant(note, fn):
    d = copy.deepcopy(FUZZ_DOC)
    r = fn(d)
    add_fuzz(note, dump(d if r is None else r))


def top(**kw):
    return lambda d: d.update(kw)


for y in (Raw("2026"), Raw("2026.0"), Raw("2.026e3"), Raw("2025"), Raw("2025.0"), Raw("2025.5"), Raw("-0"), Raw("0"), Raw("1e3"), Raw("20260000000000000000000"),
          Raw("12345678901234567890"), Raw("1e400"), True, False, "2026", None, [2026], Raw("-2026"), Raw("2026.0000000000001"), Raw("99999999999999999")):
    variant(f"year {y}", top(year=y))
for nm in ("", "   ", "My League", 5, None, " Padded "):
    variant(f"name {nm!r}", top(name=nm))
variant("no teams", lambda d: d.pop("teams"))
variant("no conferences", lambda d: d.pop("conferences"))
variant("remove all sun belt but one", top(remove=[s for s, c in lf._builtin()["team_conf"].items() if c == "sun-belt"][1:]))
variant("remove half the sun belt east", top(remove=["app-st", "c-carolina", "ga-southern", "kent-state"]))
variant("remove sun belt east", top(remove=list(season.DIVISIONS["Sun Belt"]["East"])))
variant("remove many", top(remove=sorted(lf._builtin()["slugs"])[:60]))
variant("remove dup and odd", top(remove=["kent-state", "kent-state", "nope", FICT[0], 5, None, "rice"]))
variant("sun belt games 9", lambda d: d["conferences"].append({"id": "sun-belt", "name": "Sun Belt", "games": 9}))
variant("sun belt games 3", lambda d: d["conferences"].append({"id": "sun-belt", "name": "Sun Belt", "games": 3}))
variant("mac games 9", lambda d: d["conferences"].append({"id": "mac", "name": "MAC", "games": 9}))
variant("pac-12 games 5", lambda d: d["conferences"].append({"id": "pac-12", "name": "Pac-12", "games": 5}))
variant("acc renamed with games", lambda d: d["conferences"].append({"id": "acc", "name": "Atlantic Coast", "games": 8, "level": "FBS"}))
variant("independents get games", lambda d: d["conferences"].append({"id": "fbs-independent", "name": "Indies", "games": 2}))
variant("conference twin name", lambda d: d["conferences"].append({"id": "bse-two", "name": " big sky EAST "}))
variant("conference builtin name", lambda d: d["conferences"].append({"id": "new-sec", "name": "sec"}))
variant("conference builtin name by other builtin", lambda d: d["conferences"].append({"id": "acc", "name": "Big Ten"}))
variant("conference eszett", lambda d: d["conferences"].extend([{"id": "c-a", "name": "Straße"}, {"id": "c-b", "name": "STRASSE"}]))
variant("conference sigma", lambda d: d["conferences"].extend([{"id": "c-a", "name": "ΟΔΟΣ"}, {"id": "c-b", "name": "οδος"}]))
variant("conference number ids", lambda d: (d["conferences"].extend([{"id": "12", "name": "Twelve", "games": 1}, {"id": "3", "name": "Three", "games": 1}]),
                                            d["teams"].extend([{"slug": "t12a", "name": "T12 A", "conference": "12"}, {"slug": "t12b", "name": "T12 B", "conference": "Twelve"},
                                                               {"slug": "9", "name": "Nine", "conference": "3", "rivals": ["77"]}, {"slug": "77", "name": "Seven Seven", "conference": "3"}]))[0])
variant("conference id constructor", lambda d: (d["conferences"].append({"id": "constructor", "name": "Builders", "games": 1}),
                                                d["teams"].extend([{"slug": "constructor", "name": "Con", "conference": "constructor"}, {"slug": "tostring", "name": "To", "conference": "Builders"}]))[0])
variant("team in conference by name", lambda d: d["teams"].append({"slug": "by-name", "name": "By Name", "conference": "Big Sky East"}))
variant("team in builtin conference by name", lambda d: d["teams"].append({"slug": "by-name", "name": "By Name", "conference": "Sun Belt", "rivals": ["troy", "rice"]}))
variant("two sun belt adds with rivals", lambda d: d["teams"].extend([{"slug": "sb-a", "name": "SB A", "conference": "sun-belt", "rivals": ["sb-b", "troy", "app-st"]},
                                                                      {"slug": "sb-b", "name": "SB B", "conference": "sun-belt", "rivals": [{"slug": "sb-a", "rivalry_week": True}]}]))
variant("big ten rivals added", lambda d: d["teams"].extend([{"slug": "ohio-state", "rivals": ["michigan", "penn-state", "usc", "rice", "alder-tech"]},
                                                             {"slug": "michigan", "conference": "sec", "rivals": [{"slug": "alabama", "name": "New Game", "rivalry_week": True}]}]))
variant("many teams", lambda d: d["teams"].extend([{"slug": f"x-{i}", "name": f"X {i}", "conference": "big-sky-east"} for i in range(130)]))
variant("many errors", lambda d: d["teams"].extend([{"slug": f"x-{i}", "conference": "nope", "state": "ZZ", "lat": 100} for i in range(40)]))
variant("roster over the limit", lambda d: d["teams"][0].update(roster=[full_player(i, "WR", "FR", id=None) for i in range(1, 90)]))
variant("player ids clash with built in", lambda d: d["teams"][0]["roster"][0].update(id=BASE["tulsa"]["roster"][0]["id"]))
variant("player ids clash with replaced", lambda d: d["teams"][0]["roster"][0].update(id=BASE["rice"]["roster"][0]["id"]))
variant("player ids clash in file", lambda d: d["teams"][1]["roster"][0].update(id="alder-p1"))
variant("names clash", lambda d: d["teams"][0]["roster"][1].update(name=" player 1 o'neil"))
variant("strength with the built in roster", lambda d: d["teams"].append({"slug": "tulane", "strength": "Elite", "roster": copy.deepcopy(BASE["tulane"]["roster"])}))
variant("strength with a changed roster", lambda d: d["teams"].append({"slug": "tulane", "strength": "Elite", "roster": copy.deepcopy(BASE["tulane"]["roster"])[:-1]}))
variant("whole built in team", lambda d: d["teams"].append(copy.deepcopy(BASE["tulane"])))
variant("whole built in team, a coach changed", lambda d: (d["teams"].append(copy.deepcopy(BASE["tulane"])), d["teams"][-1]["coaches"]["oc"].update(name="Somebody Else"))[0])
variant("whole built in team, keys another way round", lambda d: d["teams"].append(dict(reversed(list(copy.deepcopy(BASE["tulane"]).items())))))
variant("coaches all null", lambda d: d["teams"][1].update(coaches={"head": None, "oc": None, "dc": None, "offense": None}))
variant("rivalry week twice", lambda d: d["teams"][0].update(rivals=[{"slug": "bse-1", "rivalry_week": True}, {"slug": "bse-2", "rivalry_week": True}]))
variant("rivalry both sides", lambda d: (d["teams"][0].update(rivals=[{"slug": "bse-1", "name": "A Game"}]), d["teams"][4].update(rivals=[{"slug": "alder-tech", "name": "B Game", "rivalry_week": True}]))[0])
variant("rivalry odd entries", lambda d: d["teams"][0].update(rivals=[{"slug": ""}, {"slug": 5}, {"name": "x"}, {"slug": "bse-1", "name": 5}, {"slug": "bse-1", "name": "n" * 61},
                                                                      {"slug": "bse-2", "name": "  " + "n" * 60 + "  "}, {"slug": "bse-3", "name": "   ", "every_year": False},
                                                                      {"slug": "bse-4", "every_year": 0}, {"slug": "bse-5", "every_year": None, "rivalry_week": 1}, {"slug": "rice", "every_year": False},
                                                                      {"slug": "unknown-u", "every_year": False}, 5, None, "bse-6"]))
variant("rivalry, team name not text", lambda d: (d["teams"][0].update(name=5, short_name=None, rivals=[{"slug": ""}, {"slug": "bse-1", "every_year": False}]))[0] if False else d["teams"][0].update(name=5, short_name=None, rivals=[{"slug": ""}, {"slug": "bse-1", "every_year": False}]))
variant("rivalry, team name a list", lambda d: d["teams"][0].update(name=["a", 'b"c', "d'e", 1.5, None, True, {"k": [1]}], rivals=[{"slug": ""}]))
variant("rivalry, slug a number", lambda d: d["teams"][0].update(slug=5, rivals=[{"slug": "bse-1"}]))
variant("rivalry, slug a list", lambda d: d["teams"][0].update(slug=["a"], rivals=[{"slug": "bse-1"}]))
variant("rivalry, no slug", lambda d: (d["teams"][0].pop("slug"), d["teams"][0].update(rivals=[{"slug": "bse-1", "name": "Named", "rivalry_week": True}]))[0] and None)
variant("_finales given", top(_finales=[["alder-tech", "zzz"]]))
variant("_finales null", top(_finales=None))
variant("teams not dicts", top(teams=[5, None, "x", [], {"slug": "rice"}]))
variant("only a built in edit", lambda d: {"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 51}]})
variant("nothing changed", lambda d: {"format": "cfp-league/1", "teams": [{"slug": "rice"}, {"slug": "tulsa", "prestige": BASE["tulsa"]["prestige"], "rivals": None}]})
variant("only a rename", lambda d: {"format": "cfp-league/1", "conferences": [{"id": "sec", "name": "Southeastern", "games": 9}]})
variant("only a level word", lambda d: {"format": "cfp-league/1", "conferences": [{"id": "sec", "name": "SEC", "level": "FBS"}]})
variant("troy leaves, keeps rivals", lambda d: {"format": "cfp-league/1", "teams": [{"slug": "troy", "conference": "sec"}, {"slug": "texas", "conference": "big-12", "rivals": ["oklahoma", "texas-am", "arkansas"]}]})
variant("pac-12 grows", lambda d: {"format": "cfp-league/1", "teams": [{"slug": "pac-x", "name": "Pac X", "conference": "pac-12", "rivals": ["oregon-state"]}]})
variant("pac-12 shrinks", lambda d: {"format": "cfp-league/1", "remove": ["oregon-state"]})
variant("acc loses clemson", lambda d: {"format": "cfp-league/1", "remove": ["clemson", "georgia-tech"]})
variant("mac shrinks under nine", lambda d: {"format": "cfp-league/1", "remove": [s for s, c in lf._builtin()["team_conf"].items() if c == "mac"][:4], "conferences": [{"id": "mac", "name": "MAC", "games": 8}]})
variant("mac too small", lambda d: {"format": "cfp-league/1", "remove": [s for s, c in lf._builtin()["team_conf"].items() if c == "mac"][:8]})
variant("one team conference", lambda d: {"format": "cfp-league/1", "conferences": [{"id": "solo", "name": "Solo", "games": 0}], "teams": [{"slug": "solo-u", "name": "Solo U", "conference": "solo", "rivals": ["rice"]}]})
variant("independent added with rivals", lambda d: {"format": "cfp-league/1", "teams": [{"slug": "indy-u", "name": "Indy U", "conference": "fbs-independent", "rivals": ["notre-dame", "rice"]}]})
write("fuzz.json", fuzz)
log("fuzz:", len(fuzz), "files;", sum("merged" in c["expect"] for c in fuzz), "merged;", sum("parse_errors" in c["expect"] for c in fuzz), "parse errors;",
    sum("rivalry_names_raise" in c["expect"] for c in fuzz), "rivalry_names raised;", sum("problems_raise" in c["expect"] for c in fuzz), "problems raised")

# ---- the repo's own tests, their calls recorded -------------------------------------------------------------------
RECORD["on"] = True
ran, failed = 0, []
for file, only in (("test_league_file.py", None), ("test_league_schedule.py", None), ("test_league_career.py", ("test_plain_reasons",))):
    spec = importlib.util.spec_from_file_location("ref_" + file[:-3], ROOT / "tests" / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for n, f in sorted(vars(mod).items()):
        if n.startswith("test_") and callable(f) and (only is None or n in only):
            try:
                f()
                ran += 1
            except Exception as e:  # noqa: BLE001 - a test that fails here still made its calls
                failed.append(f"{file}:{n}: {type(e).__name__}: {str(e)[:200]}")
    log(file, "run")
log("tests run:", ran, "failed:", failed)

# ---- check(): our own runs ------------------------------------------------------------------------------------------
doc = copy.deepcopy(FUZZ_DOC)
blob = dump(doc).encode("utf-8")
lf.check(blob)
lf.check(blob, 7)
lf.check(EXPORT_BYTES)
ten = {"format": "cfp-league/1", "name": "Big Sky East League", "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}, {"id": "ghost", "name": " Ghost "}],
       "teams": [{"slug": f"bse-{i}", "name": f"Big Sky {i}", "state": "OR", "conference": "big-sky-east",
                  **({"rivals": ["oregon-state", {"slug": "bse-1", "name": "The Pine Game", "rivalry_week": True}]} if i == 0 else {})} for i in range(10)]}
ten_blob = json.dumps(ten).encode("utf-8")
lf.check(ten_blob, 3)
for name, exc in (("to_league", league_fill.TeamBuildError("bse-3", "Big Sky 3")), ("to_league", RuntimeError("boom")), ("build", KeyError("x")),
                  ("generate", schedule_gen.ScheduleError("no Big Sky East slate for 2026")),
                  ("generate", schedule_gen.ScheduleError(f"2 teams without 12 games in 2026: ['{FICT[0]}', 'bse-3', \"rice\"]; can't fit ohio-state or no SEC slate.")),
                  ("generate", schedule_gen.ScheduleError("")), ("league_seed", ValueError("bad seed"))):
    FORCE[name] = exc
    lf.check(ten_blob, 3)
    FORCE.clear()
lf.check(json.dumps({"format": "cfp-league/1", "conferences": [{"id": "sec", "name": "Southeastern"}]}).encode("utf-8"))
lf.check(json.dumps({"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 51, "rivals": [{"slug": "houston", "name": "The Bayou Bucket Game"}]}]}).encode("utf-8"), 11)
for c in rng.sample(fuzz, 30) + [c for c in fuzz if "raise" in json.dumps(list(c["expect"]))][:8]:
    lf.check(blob_of(c["blob"]))
for c in rng.sample(json_fuzz[:2000], 12):
    lf.check(blob_of(c["blob"]))
RECORD["on"] = False
write("checks.json", CHECKS)
write("calls.json", CALLS)
log("checks:", len(CHECKS), {k: sum(1 for c in CHECKS if (c["expect"].get("builtin") if c["expect"]["ok"] else "failed") == k) for k in (True, False, "failed")})
log("calls recorded:", {k: f"{len(v)} of {COUNT[k]}" for k, v in CALLS.items()})

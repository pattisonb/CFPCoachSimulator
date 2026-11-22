"""Python's answers for sim_js/bowls.js, teamnames.js, fcs_names.js and coaches.js, written as JSON for
small_modules_compare.mjs to hold the JavaScript to:

    python3 sim_js/test/small_modules_reference.py out.json && node sim_js/test/small_modules_compare.mjs out.json

It plays two seasons to their end to record every call the season makes into sim/bowls.py (a few minutes each, side
by side; it needs `node` on the path for the games). `--no-seasons` leaves them out, `--seeds 11,23` names them.
"""
import codecs
import copy
import hashlib
import json
import os
import random
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

os.environ["SIM_WORKERS"] = "1"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sim import bowls, coaches, fcs_names, teamnames    # noqa: E402

SEASON_TEAM = "smu"
N_SYNTHETIC = 40      # made-up final standings for select_bowls, and seedings for playoff_sites


def attempt(fn, *args):
    """What a call gave: its value, a ValueError's message, or the name of anything else it raised."""
    try:
        return {"ok": fn(*args)}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:      # noqa: BLE001
        return {"raises": type(e).__name__}


def pairs(d: dict) -> list:
    """A dict as [key, value] pairs: its order survives any JSON reader."""
    return [[k, v] for k, v in d.items()]


def slim(teams: dict) -> dict:
    """The two fields select_bowls reads of a team, every team in the dict's order."""
    return {slug: {"fictional": t["fictional"], "conference": t["conference"]} for slug, t in teams.items()}


# ---- bowls: the calls a season makes ----
def play_season(seed: int) -> dict:
    """A season played to its end with every call into sim/bowls.py recorded (each different call once)."""
    os.environ["SIM_WORKERS"] = "1"
    from sim import season
    seen: dict = {}
    counts: dict = {}
    real = {name: getattr(bowls, name) for name in ("load_bowls", "bowl_week", "_payout", "ordered_bowls", "tie_ins_for",
                                                    "select_bowls", "playoff_sites")}

    def wrap(name):
        def inner(*args, **kwargs):
            assert not kwargs, name
            if name == "select_bowls":
                records, teams, field, order, ratings = args
                shown = [records, slim(teams), sorted(field), order, ratings]
            else:
                shown = list(args)
            given = json.loads(json.dumps(shown))
            result = real[name](*args)
            counts[name] = counts.get(name, 0) + 1
            key = json.dumps([name, given])
            if key not in seen:
                seen[key] = {"fn": name, "args": given, "result": json.loads(json.dumps(result))}
            return result
        return inner

    for name in real:
        setattr(bowls, name, wrap(name))
    st = season.new_season(SEASON_TEAM, "full", seed=seed, career=True)
    season.advance_to(st, season.FINAL_WEEK)
    for name, fn in real.items():
        setattr(bowls, name, fn)
    return {"seed": seed, "counts": counts, "calls": list(seen.values()),
            "bowls_played": len([b for b in st.get("bowls", []) if not b.get("unfilled")])}


def bowls_reference(engine_teams: dict, seeds: list[int]) -> dict:
    out: dict = {
        "PRIORITY": bowls.PRIORITY, "DEFAULT_TIE_INS": pairs(bowls.DEFAULT_TIE_INS), "G5": sorted(bowls.G5),
        "INDEPENDENT": sorted(bowls.INDEPENDENT), "BOWLS_FILE": bowls.BOWLS_FILE.relative_to(ROOT).as_posix(),
    }
    data = bowls.load_bowls()
    out["load_bowls"] = data
    dates = [g.get("date") for g in data["bowls"] + data["playoff"]]
    dates += [None, "", "Dec 24", "Dec 25", "Dec 26", "December 24", "December 31", "Dec. 20", "Jan 1", "January 12", "Jan", "Dec",
              "Nov 30", "Saturday, Dec 20", "Dec  7", "Dec\t19", "Dec20", "Decem ber 9", "Jan 0", "Dec 024", "dec 20", "Dec 20-21", 0]
    out["bowl_week"] = [[d, bowls.bowl_week(d)] for d in dates]
    payouts = [{"payout": g.get("payout")} for g in data["bowls"] + data["playoff"]] + [{}] + [{"payout": p} for p in (
        None, "", "$1,200,000", "$3.5M", "$3.5 m", "$2 Million", "$4 MILLION (2019)", "US$ 825,000", "US$825,000 (2019)", "$750,000 and $1 million",
        "$.", "$,", "$1.2.3", "$1,2,3.5 million", "$5.", "$.5M", "about $ 6", "$6.67 million ($20 million aggregate)", "$1e6", "$12 millions",
        "$7\tmillion", "$7 \n M", "$1.5Mil", "$0", "$0.0 million", "$100", "100", "£5 million")]
    out["_payout"] = [[b, attempt(bowls._payout, b)] for b in payouts]
    out["ordered_bowls"] = [b["bowl"] for b in bowls.ordered_bowls(data)]
    # the same bowls in another order, some renamed off the priority list (their payouts decide), ties among them
    rng = random.Random("bowls-ref-order")
    mixed = copy.deepcopy(data["bowls"])
    rng.shuffle(mixed)
    for i, b in enumerate(mixed[:14]):
        b["bowl"] = f"Unlisted Bowl {i}"
        b["payout"] = ["$1 million", "$1,000,000", "$2M", None, "$2.5 million", "US$ 4 million", "$900,000"][i % 7]
    out["ordered_bowls_mixed"] = {"data": {"bowls": mixed}, "want": bowls.ordered_bowls({"bowls": mixed})}
    ties = [{"bowl": b["bowl"], "tie_ins": b.get("tie_ins")} for b in data["bowls"] + data["playoff"]] + [
        {"bowl": "No Such Bowl"}, {"bowl": "No Such Bowl", "tie_ins": None}, {"bowl": "No Such Bowl", "tie_ins": []},
        {"bowl": "No Such Bowl", "tie_ins": ["SEC"]}, {"bowl": "No Such Bowl", "tie_ins": ["SEC", "SEC", "", None, "ACC", "MAC"]},
        {"bowl": "No Such Bowl", "tie_ins": ["MAC", "Sun Belt", "ACC"]}, {"bowl": "Citrus Bowl", "tie_ins": ["MAC", "Sun Belt"]}]
    out["tie_ins_for"] = [[b, bowls.tie_ins_for(b)] for b in ties]

    # select_bowls on made-up final standings of the real teams
    teams = slim(engine_teams)
    slugs = list(teams)
    real = [s for s in slugs if not teams[s]["fictional"]]
    ratings = {slug: t["team_ratings"]["overall"] for slug, t in engine_teams.items()}
    select = []
    for i in range(N_SYNTHETIC):
        rng = random.Random(f"bowls-ref-select-{i}")
        kind = i % 5
        records = {}
        for s in slugs:
            if kind == 1:        # few teams with six wins: five-win teams fill in and bowls go unfilled
                wins = rng.choice([2, 3, 4, 4, 5, 5, 5, 6, 7])
            elif kind == 2:      # nearly nobody eligible
                wins = rng.choice([0, 1, 2, 3, 3, 4, 4, 5, 6])
            else:
                wins = max(0, min(12, round(rng.gauss(6.2, 2.6))))
            games = 12 if kind != 3 else rng.choice([0, 11, 12, 13])
            records[s] = {"wins": min(wins, games), "losses": games - min(wins, games)}
        ranked = sorted(real, key=lambda s: (-records[s]["wins"], -ratings[s], rng.random()))
        order = [] if kind == 4 else ranked[:rng.choice([25, 40, len(ranked)])]
        field = [] if kind == 4 and i % 2 else ranked[:12]
        given_ratings = dict(ratings)
        if kind == 3:
            for s in rng.sample(slugs, 30):
                del given_ratings[s]
        select.append({"args": [records, teams, sorted(field), order, given_ratings],
                       "result": bowls.select_bowls(records, teams, set(field), order, given_ratings)})
    out["select_bowls"] = select

    conf_of = {slug: t["conference"] for slug, t in teams.items()}
    sites = []
    for i in range(N_SYNTHETIC):
        rng = random.Random(f"bowls-ref-sites-{i}")
        top = rng.sample(real, 4)
        seeds_ = {n + 1: s for n, s in enumerate(top)}
        if i % 8 == 5:
            del seeds_[rng.choice([1, 2, 3, 4])]
        if i % 8 == 6:
            seeds_[2] = "no-such-team"
        if i % 8 == 7:
            seeds_ = {}
        sites.append({"seeds": [[k, v] for k, v in seeds_.items()], "result": bowls.playoff_sites(seeds_, conf_of)})
    out["playoff_sites"] = {"conference_of": conf_of, "cases": sites}

    if seeds:
        with ProcessPoolExecutor(max_workers=len(seeds)) as pool:
            out["seasons"] = list(pool.map(play_season, seeds))
    else:
        out["seasons"] = []
    return out


# ---- teamnames ----
def teamnames_reference(engine_teams: dict, team_files: dict) -> dict:
    engine = {slug: {"name": t["name"], "school": t["school"], "abbreviation": t["abbreviation"], "fictional": t["fictional"]}
              for slug, t in engine_teams.items()}
    # the team files name the same fields differently (short_name, school_name)
    files = {slug: {"name": t["short_name"], "school": t["school_name"], "abbreviation": t["abbreviation"], "fictional": t.get("fictional", False)}
             for slug, t in team_files.items()}
    some = {slug: t for i, (slug, t) in enumerate(engine.items()) if i % 3 == 0}
    names: list = []
    for group in (engine, files):
        for slug, t in group.items():
            names += [slug, slug.replace("-", " "), t["name"], t["school"], t["abbreviation"]]
    for t in team_files.values():
        names += [t.get("mascot") or "", f"{t['short_name']} {t.get('mascot') or ''}"]
    names += list(teamnames.ALIASES) + list(teamnames.ALIASES.values())
    base = list(dict.fromkeys(names))
    for n in base:
        names += [n.upper(), f"  {n}  ", n.replace(" ", "   "), n.replace("State", "St."), n.replace("State", "St"), f"{n} St", f"{n} St."]
    names += ["", " ", "nonexistent", "Ohio St.", "OHIO ST", "Kent St", "Miami (OH)", "Miami (Fla.)", "Hawai'i", "Texas A&M", "St John's St",
              "east st st", "\tPenn State\n", "Penn\x85State", "Penn\x1fState", "Penn　State", "Penn St", "Penn​State",
              "Penn﻿State", "\x1cOhio State\x1e", "İstanbul St.", "ΣΟΦΟΣ", "Straße", "ǅemal", "San José St.",
              "O'Brien's  .St.", "...", "st", " st", "a st", "A.S.T."]
    names = list(dict.fromkeys(names))
    lookups = {"engine": teamnames.build_matcher(engine), "files": teamnames.build_matcher(files), "some": teamnames.build_matcher(some)}
    return {
        "ALIASES": pairs(teamnames.ALIASES),
        "teams": {"engine": engine, "files": files, "some": some},
        "build_matcher": {k: pairs(v) for k, v in lookups.items()},
        "names": names,
        "norm": [teamnames.norm(n) for n in names],
        "match": {k: [teamnames.match(n, v) for n in names] for k, v in lookups.items()},
    }


# ---- fcs_names ----
def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fcs_names_reference(engine_teams: dict) -> dict:
    r = lambda s: codecs.decode(s, "rot13")    # noqa: E731
    pat, to = fcs_names._table()
    olds = list(to)
    out: dict = {
        "_OLD": pairs({k: list(v) for k, v in fcs_names._OLD.items()}), "_OLD_CONFERENCE": fcs_names._OLD_CONFERENCE,
        "regions": [[region, fcs_names.new_slug(region), fcs_names.label(region)] for region in list(fcs_names._OLD) + ["Deep South", "x", ""]],
        "_r": [[s, fcs_names._r(s)] for s in ["Pnyqre Fcevatf", "abcxyz ABCXYZ nm NM 0189 -.,", "", "café üñ"]],
        "pattern": pat.pattern, "table": pairs(to), "NEW_SLUGS": pairs(fcs_names.NEW_SLUGS),
    }
    texts: list = []
    # every old token by itself, in a sentence, as a JSON key and as a JSON value
    for tok in olds:
        texts += [tok, f"x {tok} y {tok}.", json.dumps({"k": tok, tok: 1}), json.dumps([tok.upper(), tok.lower(), tok])]
    old0, old1, old2 = olds[0], olds[1], olds[5]
    # a stand-in's team as a save from before the rename held it: today's team with the old slug, names, mascot and town
    for region, (slug, names, mascot, stadium) in fcs_names._OLD.items():
        team = {k: v for k, v in engine_teams[fcs_names.new_slug(region)].items()}
        text = json.dumps(team)
        text = text.replace(f"{fcs_names.label(region)} Stadium", r(stadium)).replace(fcs_names.label(region), r(names[-1]))
        text = text.replace(fcs_names.new_slug(region), r(slug))
        old = json.loads(text)
        old.update(school=r(names[0]), mascot=r(mascot) if mascot else "Elk", city="Smalltown", abbreviation="XYZ")
        texts += [json.dumps(old), json.dumps(old, indent=1), json.dumps({"teams": {r(slug): old}, "week": 3}, separators=(",", ":"))]
    q = json.dumps(old0)
    # numbers as Python writes them back
    texts.append('{"old": %s, "n": [1.0, -0.0, -0, 0, 1e-7, 1E-5, 0.0001, 0.00012345, 1e15, 1e16, 9999999999999998.0, 123456789012345678, 1.5e300, '
                 '1e999, -1e999, 5e-324, 2.5, 0.1, 1e21, 1e22, 123456789.123456789, NaN, Infinity, -Infinity, 12345678901234567890123, '
                 '1.7976931348623157e308, 9007199254740993, 0.30000000000000004, 100.0, 1e2, 1E+2, 4.35, 2.675e-5, 1234567.0e10, -12.50, '
                 '0.000001, 0e0, -0e-5, 1.0e+0, 123456789012345.6, 1234567890123456.7, 0.1e-3, 9.999999999999999e22, 2e-4, 10E15, 72, -3]}' % q)
    # keys: number-like ones out of order, a repeated one, empty, odd
    texts.append('{"10": %s, "2": 2, "1": 3, "b": {"3": 0, "a": 1, "-1": 2, "0": [], "": {}}, "2": "again", "__proto__": 4, "constructor": {"slug": 5}}' % q)
    # text: accents, a pair, a lone surrogate, control characters, every escape
    texts.append('{"a": %s, "b": "café \U0001f3c8 \\u00e9 \\ud83c\\udfc8 \\ud83d x \\udfc8 \\u0001 \u007f \\/ \\b\\f\\n\\r\\t \\" \\\\  ", "ü\\u00FC": null}' % q)
    texts.append(' \n\t{ "a" :\r\n[ %s ,true , false,null ] , "e":[ ], "o":{ } }  \n' % q)
    texts += [q, " " + q + "\n", "[]" + old0, json.dumps([[[[old0]]], {}, [], "", 0])]
    # not JSON (as Python reads it): the names are replaced and the text is otherwise as it was
    bad = ['[%s,]', '{"a": %s,}', "{'a': %s}", '[%s', '[%s]x', '[01, %s]', '[%s, 1.]', '[%s, .5]', '[%s, -]', '[%s, +1]', '[%s, 1e]', '[%s, 0x10]',
           '[%s, "a\x01b"]', '[%s, "a\tb"]', '[%s, "\\x41"]', '[%s, "\\u12"]', '[%s, "\\u12G4"]', '﻿[%s]', '[%s, nan]', '[%s, -NaN]', '[%s, -Infinity]',
           '[%s]\x0c', '[%s, True]', '[%s, nul]', '{%s}', '{%s: 1}', '{1: %s}', '{"a" %s}', '[%s "a"]', '[%s, "unterminated]', '[%s, 1 2]', '[%s,, 1]',
           '[%s, -01]', '[%s, 1.5e+]', '[%s, Infinity1]', '[%s, "\\ud83d\\u12"]', ' [%s]', '[%s, ' + "9" * 4300 + ']', '[%s, ' + "9" * 4301 + ']',
           '[%s, -' + "1" * 4301 + ']', '[%s, ' + "9" * 5000 + '.5]', '[%s, 1' + "0" * 400 + ']', '[%s, 1' + "0" * 400 + '.0]']
    texts += [b % q for b in bad]
    # a stand-in's own record anywhere in the save
    rec = {"slug": "fcs-southeast", "fictional": True, "name": "A", "short_name": "B", "school": "C", "school_name": "D", "abbreviation": "ABC",
           "mascot": "M", "city": "Town", "note": old1,
           "nested": [{"slug": "fcs-plains", "mascot": "q", "name": 5}, {"slug": "fcs-plains", "name": "no marker"}, {"slug": 7, "mascot": "x"},
                      {"slug": ["fcs-plains"], "fictional": 1}, {"slug": "smu", "fictional": False, "name": "SMU", "city": "Dallas"},
                      {"slug": "fcs-new-england", "school_name": None, "city": None, "kids": {"slug": "fcs-gulf-coast", "short_name": "x", "abbreviation": 1}}]}
    texts += [json.dumps(rec), json.dumps([rec, rec]), json.dumps({"slug": r(fcs_names._OLD["Plains"][0]), "mascot": "Elk", "name": old2, "city": "T"})]
    # nothing old in it: the same text back
    texts += ["", "plain text", "{not json", '{"a": 1.0,   "b": [1e5]}', json.dumps(engine_teams["fcs-plains"]["coaches"]), "FCS Southeast fcs-southeast"]
    out["texts"] = [{"text": t, "has_old": fcs_names.has_old(t), "out": fcs_names.rewrite_text(t)} for t in texts]

    # the real files: as they are (nothing old in them), and inside a save that holds an old name (so every number and
    # every name in them is read and written back as Python does); the answers by their hash
    files = sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json")) + [ROOT / "data" / "engine_teams.json", ROOT / "data" / "bowls.json"]
    big = []
    for i, p in enumerate(files):
        raw = p.read_text(encoding="utf-8")
        tok = olds[i % len(olds)]
        wrapped = '{"old": %s, "file": %s}' % (json.dumps(tok), raw)
        res = fcs_names.rewrite_text(wrapped)
        big.append({"path": p.relative_to(ROOT).as_posix(), "has_old": fcs_names.has_old(raw), "same": fcs_names.rewrite_text(raw) == raw,
                    "old": tok, "len": len(res), "sha": sha(res)})
    out["files"] = big

    fixes = [rec, [rec, {"a": rec}], {"slug": "fcs-plains"}, {"slug": "fcs-plains", "short_name": 1, "abbreviation": "X", "city": "c"}, 5, "s", None,
             [1, [2, {"slug": "fcs-great-lakes", "mascot": "m"}]]]
    out["_fix_records"] = [[copy.deepcopy(o), fcs_names._fix_records(copy.deepcopy(o))] for o in fixes]
    return out


# ---- coaches ----
def coaches_reference(engine_teams: dict) -> dict:
    out: dict = {"consts": {name: getattr(coaches, name) for name in (
        "OFFENSE_SCHEMES", "DEFENSE_SCHEMES", "ARCHETYPES", "RATING_KEYS", "RATING_LABELS", "RATING_ABOUT", "RATING_BUDGET", "RATING_LIVE",
        "STYLE", "POSITIONS_PLAYED", "PLAYING_LEVELS", "LOOK", "FACE_MAX_FIELDS")}}
    out["consts"]["FACE_ID"] = coaches.FACE_ID.pattern
    out["consts"]["FACE_KEY"] = coaches.FACE_KEY.pattern
    out["consts"]["COACHES_DIR"] = coaches.COACHES_DIR.relative_to(ROOT).as_posix()
    out["blank"] = coaches.blank()
    out["options"] = coaches.options()

    good = {**coaches.blank(), "first_name": "Pat", "last_name": "Day"}
    low = {k: 60 for k in coaches.RATING_KEYS}
    faces = [None, [], "face", 5, {}, {"hair": "short_01", "hairFade": True, "flip": ["hair", "brow_2", "Bad-Id", 5, None, "a" * 41]},
             {"hairFade": 1}, {"hairFade": "true"}, {"hairFade": False}, {"hairFade": None}, {"flip": "hair"}, {"flip": None}, {"flip": {"a": 1}},
             {"flip": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]}, {"flip": [["a"], {"b": 1}, True, "", "ok_1"]},
             {"hair_1": "x", "": "x", "a" * 31: "x", "a" * 30: "x", "Skin": None, "eyes": "Bad-ID", "nose": 5, "ear": "a" * 41, "jaw": "a" * 40, "brow": "",
              "12": "x", "7": None, "mouth": True, "chin": 1.5, "cheek": ["a"], "éye": "x", "eye\n": "x", "lip": "x\n", "lid": "ABC"},
             {**{"f" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"[i]: f"id_{i}" for i in range(40)}, "hairFade": True, "flip": ["z"]},
             {**{"1": "a", "2": "b"}, **{"g" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"[i]: (None if i % 3 else "BAD") for i in range(36)}}]
    out["_clean_face"] = [[f, coaches._clean_face(f)] for f in faces]

    cases = [good, {}, {"first_name": "Pat"}, {**good, "first_name": "   ", "last_name": "\t"}, {**good, "first_name": None},
             {**good, "first_name": "  Pat ", "last_name": "\x1fDay\x85　"}, {**good, "first_name": "P" * 40, "last_name": "\U0001f3c8" * 35},
             {**good, "first_name": 123, "last_name": True}, {**good, "first_name": 4.5, "last_name": 0}, {**good, "first_name": 12, "last_name": -3},
             {**good, "first_name": "José", "last_name": "O'Brien-Smith"}, {**good, "extra": 1, "updated_at": "x"},
             {**good, "first_name": " " * 29 + "ab   ", "last_name": "a" * 29 + " " + "b"}]
    for age in ("50", 20, 99, 0, None, "x", 45.7, 45.2, "4_5", " 61\n", [], [1], {"a": 1}, {}, "", True, False, "-5", "+33", "33.0", "0x21", "1e2", "٣٣",
                28, 75, 76, 27, -40, "  ", "3 3", "_33", "33_", "3__3", 1e20, "9" * 30):
        cases.append({**good, "age": age})
    for home in ("  Dallas, Texas  ", "x" * 70, None, 0, 77, ["a"]):
        cases.append({**good, "hometown": home})
    for alma in ("", None, "smu", "x" * 70, 0, 12, "  padded  ", False, True, 3.5):
        cases.append({**good, "alma_mater": alma})
    for back in ("  story  ", "s" * 2000, None, 9):
        cases.append({**good, "background": back})
    for arch in list(coaches.ARCHETYPES) + [None, "", "Nope", "offensive guru", 5, "constructor", "toString"]:
        cases.append({**good, "archetype": arch, "ratings": None})
        cases.append({**good, "archetype": arch, "ratings": {}})
    for rt in ({"offense": "85"}, {"offense": " 70 "}, {"defense": 70.9}, {"motivation": True}, {"offense": None}, {"offense": "abc"}, {"discipline": [1]},
               {"offense": 10, "defense": 150}, {**low, "offense": 99, "defense": 99}, {k: 75 for k in coaches.RATING_KEYS}, {k: 99 for k in coaches.RATING_KEYS},
               {**{k: 75 for k in coaches.RATING_KEYS}, "offense": 76}, {**low, "unknown": "x"}, {"recruiting": ""}, {"recruiting": "7.5"}, {"game_management": {}},
               {"player_development": -5}, {"offense": 99, "defense": 99, "recruiting": 99}, {"offense": 71.5, "defense": "68"}):
        cases.append({**good, "ratings": rt})
    for played, level in (("QB", "NFL"), ("K/P", "All-American"), ("qb", "nfl"), (None, None), (5, 6), ("Did not play", "Walk-on"), ("", ""), ("DB", "College starter")):
        cases.append({**good, "played": played, "playing_level": level})
    for off in list(coaches.OFFENSE_SCHEMES) + [None, "Wishbone", 3]:
        cases.append({**good, "offense_scheme": off})
    for de in list(coaches.DEFENSE_SCHEMES) + [None, "46", 43]:
        cases.append({**good, "defense_scheme": de})
    for co, cd in ((1, 0), ("yes", ""), ([], {}), ("0", "false"), (None, None), ([0], {"a": 0}), (0.0, 2.5), (True, True), (False, False)):
        cases.append({**good, "calls_offense": co, "calls_defense": cd})
    for st in (None, {}, {"pass_rate": 80}, {"pass_rate": "65", "tempo": 101, "blitz_rate": -4}, {"tempo": None}, {"press_rate": "x"}, {"deep_shot_rate": 33.9},
               {"fourth_down_go_rate": True, "man_coverage_rate": " 12 "}, {"play_action_rate": []}, {k: 0 for k in coaches.STYLE}, {k: 100 for k in coaches.STYLE},
               {"unknown": 5}, {"blitz_rate": "1_0"}, {"blitz_rate": ""}):
        cases.append({**good, "style": st})
    for look in (None, {}, {"skin": coaches.LOOK["skin"][4], "hair": "curly", "hair_color": "#9a9a9a", "facial_hair": "beard", "glasses": "round",
                            "headwear": "visor", "outfit": "suit"}, {"skin": "#000000", "hair": "mohawk", "outfit": None}, {"hair": 5, "glasses": ["round"]},
                 {"unknown": "x", "headwear": "none"}):
        cases.append({**good, "look": look})
    for cid in ("abc", "", None, 0, "0123456789ab", 55):
        cases.append({**good, "id": cid})
    for f in faces:
        cases.append({**good, "face": f})
    # shapes the page never sends (Python stops with something other than a ValueError)
    cases += [{**good, "ratings": [1, 2]}, {**good, "style": "fast"}, {**good, "look": [1]}, {**good, "archetype": ["Program Builder"]}]
    out["clean"] = [[c, attempt(coaches.clean, copy.deepcopy(c))] for c in cases]

    ids = ["0123456789ab", "abcdef012345", "", None, "0123456789AB", "0123456789abc", "0123456789a", "../../etc/pw", "0123456789a\n", "ghijklmnopqr"]
    out["_path"] = [[i, attempt(lambda x: coaches._path(x).relative_to(ROOT).as_posix(), i)] for i in ids]

    made = [
        coaches.clean({**good, "calls_offense": True, "calls_defense": False, "offense_scheme": "Air Raid", "archetype": "Offensive Guru", "ratings": None,
                       "style": {"pass_rate": 78, "tempo": 70, "deep_shot_rate": 66, "play_action_rate": 20, "fourth_down_go_rate": 71}}),
        coaches.clean({**good, "first_name": "José", "last_name": "Núñez", "calls_offense": False, "calls_defense": True, "defense_scheme": "3-3-5",
                       "archetype": "Defensive Mastermind", "ratings": None, "style": {"blitz_rate": 85, "man_coverage_rate": 15, "press_rate": 60}}),
        coaches.clean({**good, "calls_offense": True, "calls_defense": True, "offense_scheme": "Spread Option", "defense_scheme": "Tite Front 3-4",
                       "archetype": "Game-Day CEO", "ratings": {"offense": 73, "defense": 74, "discipline": 41},
                       "style": {k: 5 + 11 * i for i, k in enumerate(coaches.STYLE)}}),
        coaches.clean({**good, "calls_offense": False, "calls_defense": False, "archetype": "Players' Coach", "ratings": None}),
        coaches.clean({**good, "calls_offense": True, "calls_defense": False, "offense_scheme": "Flexbone Triple Option", "archetype": "Recruiting Ace",
                       "ratings": {"offense": 68, "defense": 67, "recruiting": 91, "discipline": 99, "motivation": 40}, "style": {"fourth_down_go_rate": 100}}),
    ]
    out["made"] = made
    odd_teams = [{}, {"coaches": None}, {"coaches": {}}, {"coaches": {"head_coach": None, "offensive_coordinator": {"name": ""}, "defensive_coordinator": {"scheme": None}}},
                 {"coaches": {"head_coach": {"scheme": {"offensive_philosophy": "Pro Style", "defensive_philosophy": "4-3"}},
                              "offensive_coordinator": {"name": "A B", "scheme": {"offensive_scheme": ""}}, "defensive_coordinator": {"name": "C D", "scheme": {}}}}]
    slugs = list(engine_teams)
    out["staff"] = {
        "teams": [[slug, [coaches._coordinator(t, "offense"), coaches._coordinator(t, "defense"), coaches.staff(None, t)] + [coaches.staff(c, t) for c in made]]
                  for slug, t in engine_teams.items()],
        "odd": [[t, [coaches._coordinator(t, "offense"), coaches._coordinator(t, "defense"), coaches.staff(None, t), coaches.staff({}, t)]
                 + [coaches.staff(c, t) for c in made]] for t in odd_teams],
    }

    def shown(t: dict) -> dict:
        return {k: v for k, v in t.items() if k not in ("offense", "defense")}

    applied = []
    for slug in slugs:
        team = engine_teams[slug]
        before = json.dumps(team)
        row = []
        for c in made:
            t = coaches.apply_coach(team, c)
            row.append({"team": shown(t), "keys": list(t), "players": t["offense"] is team["offense"] and t["defense"] is team["defense"]})
        assert json.dumps(team) == before
        applied.append([slug, row, coaches.apply_coach(team, None) is team, coaches.apply_coach(team, {}) is team])
    out["apply_coach"] = applied
    bare = [{"offense": [], "defense": []}, {"offense": [], "defense": [], "coaches": None, "tendencies": None},
            {"offense": [], "defense": [], "coaches": {"head_coach": {"ratings": None}, "offensive_coordinator": {}}, "tendencies": {"qb_run_share": 30, "discipline": 97}},
            {"offense": [], "defense": [], "coaches": {"head_coach": {"ratings": {"discipline": 95}}, "defensive_coordinator": {"name": "X", "scheme": None}},
             "tendencies": {"qb_run_share": 30.5, "discipline": 3.5}}]
    out["apply_coach_bare"] = [[t, [coaches.apply_coach(copy.deepcopy(t), c) for c in made]] for t in bare]

    # the saved coaches, in a directory of their own
    real_dir = coaches.COACHES_DIR
    with tempfile.TemporaryDirectory() as tmp:
        coaches.COACHES_DIR = Path(tmp) / "coaches"
        store: dict = {"list_empty": coaches.list_all(), "load_empty": coaches.load("0123456789ab")}

        def text_of(cid):
            return (coaches.COACHES_DIR / f"{cid}.json").read_text(encoding="utf-8")

        steps = []
        new = {**made[1], "id": None, "background": "Line one\nLine \"two\" — café \U0001f3c8 \x7f"}
        a = coaches.save(copy.deepcopy(new))
        steps.append({"do": "save", "arg": new, "result": {**a, "id": "<ID>", "updated_at": "<AT>"},
                      "text": text_of(a["id"]).replace(a["id"], "<ID>").replace(a["updated_at"], "<AT>")})
        given = {**made[2], "id": "0123456789ab", "face": {"hair": "short_01", "hairFade": True, "flip": ["hair"], "skin": None}}
        b = coaches.save(copy.deepcopy(given))
        steps.append({"do": "save", "arg": given, "result": {**b, "updated_at": "<AT>"}, "text": text_of(b["id"]).replace(b["updated_at"], "<AT>")})
        for bad in ({**made[0], "id": "xyz"}, {**made[0], "id": "0123456789AB"}, {**made[0], "last_name": ""}):
            steps.append({"do": "save", "arg": bad, "result": attempt(coaches.save, copy.deepcopy(bad))})
        steps.append({"do": "load", "arg": "0123456789ab", "result": {**coaches.load("0123456789ab"), "updated_at": "<AT>"}})
        for cid in ("nope", "ffffffffffff", "", None):
            steps.append({"do": "load", "arg": cid, "result": coaches.load(cid)})
        store["steps"] = steps
        (coaches.COACHES_DIR / f"{a['id']}.json").unlink()
        (coaches.COACHES_DIR / "0123456789ab.json").unlink()
        # files as an older game left them: one from before the stand-ins' rename, dates apart, one with no date
        r = lambda s: codecs.decode(s, "rot13")    # noqa: E731
        old_name = r(fcs_names._OLD["Plains"][1][0])
        files = {
            "aaaaaaaaaaaa": json.dumps({**made[0], "id": "aaaaaaaaaaaa", "alma_mater": r(fcs_names._OLD["Plains"][0]), "hometown": old_name,
                                        "updated_at": "2026-03-01T10:00:00"}, indent=1),
            "bbbbbbbbbbbb": json.dumps({**made[1], "id": "bbbbbbbbbbbb", "updated_at": "2026-05-01T10:00:00"}, indent=1),
            "cccccccccccc": json.dumps({**made[2], "id": "cccccccccccc"}, indent=1),
            "dddddddddddd": json.dumps({**made[3], "id": "dddddddddddd", "updated_at": "2026-04-01T09:30:00"}),
            "eeeeeeeeeeee": json.dumps({**made[4], "id": "eeeeeeeeeeee", "updated_at": "2026-04-01T09:30:01", "ratings": {"offense": 68.0}}, indent=1),
        }
        for cid, text in files.items():
            (coaches.COACHES_DIR / f"{cid}.json").write_text(text, encoding="utf-8")
        store["files"] = files
        store["list_all"] = coaches.list_all()
        store["loads"] = [[cid, coaches.load(cid)] for cid in files]
        store["deletes"] = [[cid, attempt(coaches.delete, cid)] for cid in ("bbbbbbbbbbbb", "bbbbbbbbbbbb", "ffffffffffff", "bad", "", None)]
        store["list_after"] = coaches.list_all()
        out["store"] = store
    coaches.COACHES_DIR = real_dir
    return out


def main(argv: list[str]) -> None:
    args = [a for a in argv if not a.startswith("--")]
    seeds = [11, 23]
    for a in argv:
        if a.startswith("--seeds"):
            seeds = [int(x) for x in a.split("=", 1)[1].split(",")] if "=" in a else [int(x) for x in argv[argv.index(a) + 1].split(",")]
            if "=" not in a:
                args.remove(argv[argv.index(a) + 1])
    if "--no-seasons" in argv:
        seeds = []
    out_path = args[0]
    engine_teams = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    team_files = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json"))}
    out = {
        "teamnames": teamnames_reference(engine_teams, team_files),
        "fcs_names": fcs_names_reference(engine_teams),
        "coaches": coaches_reference(engine_teams),
        "bowls": bowls_reference(engine_teams, seeds),
    }
    Path(out_path).write_text(json.dumps(out, allow_nan=False), encoding="utf-8")    # plain JSON: Node reads it
    b = out["bowls"]
    print(f"wrote {out_path}: bowls {len(b['select_bowls'])} standings, {len(b['playoff_sites']['cases'])} seedings, "
          f"{[(s['seed'], s['counts']) for s in b['seasons']]}; teamnames {len(out['teamnames']['names'])} names; "
          f"fcs_names {len(out['fcs_names']['texts'])} texts, {len(out['fcs_names']['files'])} files; coaches {len(out['coaches']['clean'])} coaches")


if __name__ == "__main__":
    main(sys.argv[1:])

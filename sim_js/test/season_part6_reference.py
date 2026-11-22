"""sim/season.py from "player profiles" to the end (sim_js/season/part6.js): real inputs and Python's answers, as
JSON, for season_part6_compare.mjs. Run: python3 sim_js/test/season_part6_reference.py <out.json> [last week, 17]
(it plays the season to that week: morale after every game of the first five weeks, then the views)."""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp())
from sim import season
from coach_career import ability_goals, promises, recruiting, league, grades

TEAM = "ohio-state"
RECORD = None          # what the part asks the rest of the season file and the modules not ported yet, while a case runs
MORALE = []            # _update_morale: the slices it reads and what it left
DECAY = []
MORALE_WEEKS = 5


def slug_of(p):
    return p.get("slug") if isinstance(p, dict) else p


def wrap(mod, name, keyfn, keep=copy.deepcopy):
    orig = getattr(mod, name)

    def w(*a, **k):
        out = orig(*a, **k)
        if RECORD is not None:
            RECORD[f"{name}:" + json.dumps(keyfn(*a, **k), separators=(",", ":"))] = keep(out)
        return out
    setattr(mod, name, w)


def hooks():
    wrap(season, "display_rating", lambda p, key, value=None: [slug_of(p), key, value])
    wrap(season, "shown_overall", lambda p, base=None: [slug_of(p), base is not None])
    wrap(season, "house_value", lambda pos, key, v: [pos, key, v] if isinstance(v, int) else ["float"])
    wrap(season, "same_group", lambda a, b: [a, b])
    wrap(season, "redshirt_status", lambda state, slug, p: [slug, slug_of(p)])
    wrap(season, "_records", lambda state, through_week=None, include_playoff=False: [through_week, include_playoff])
    wrap(season, "position_changes", lambda state, slug: [slug])
    wrap(season, "_clear_on", lambda: [])
    wrap(season, "season_year", lambda state: [])
    wrap(season, "engine_rating", lambda p, key, ours: [slug_of(p), key, ours])
    wrap(ability_goals, "on", lambda: [])
    wrap(ability_goals, "merged_traits", lambda state, team, key, base: [team, key])
    wrap(ability_goals, "upgrades_view", lambda state, team, key, base: [team, key])
    wrap(ability_goals, "goal_view", lambda state, team, key, position, base: [team, key])
    wrap(promises, "tags_now", lambda state: [])
    wrap(recruiting, "word", lambda points: [points])
    wrap(league, "base_development", lambda: [])
    wrap(grades, "letter", lambda value, fine=False: [value, fine])
    # (the built-in league is every team's roster: the part reads your own)
    wrap(league, "from_base", lambda: [], lambda lgd: {"attrs": lgd.get("attrs"), "teams": {TEAM: lgd["teams"][TEAM]}})

    upd, dec = season._update_morale, season._decay_morale

    def update(state, g, lines, before):
        if state["current_week"] > MORALE_WEEKS or not season.morale_on(state) or g.get("real"):
            return upd(state, g, lines, before)
        m = season._morale_store(state)
        sl = [g["home"], g["away"]]

        def cut():
            # (each in the store's own order: a team met before stays where it was)
            return {"teams": {s: v for s, v in m["teams"].items() if s in sl}, "players": {s: v for s, v in m["players"].items() if s in sl},
                    **({"fcs_lines": {s: v for s, v in m["fcs_lines"].items() if s in sl}} if "fcs_lines" in m else {}),
                    **({"z_mean": m["z_mean"]} if "z_mean" in m else {})}
        row = {"g": copy.deepcopy(g), "lines": {s: {"players": lines[s].get("players", [])} for s in ("home", "away")},
               "season_stats": {s: {"players": (state.get("season_stats") or {}).get(s, {}).get("players")} for s in sl if s in (state.get("season_stats") or {})},
               "before": copy.deepcopy(cut())}
        row = json.loads(json.dumps(row))
        upd(state, g, lines, before)
        row["after"] = copy.deepcopy(cut())
        MORALE.append(row)

    def decay(state):
        if state["current_week"] > MORALE_WEEKS + 1:
            return dec(state)
        before = copy.deepcopy(state.get("morale"))
        dec(state)
        DECAY.append({"before": before, "after": copy.deepcopy(state.get("morale"))})
    season._update_morale, season._decay_morale = update, decay


def err(fn):
    try:
        return {"ok": fn()}
    except ValueError as e:
        return {"error": str(e)}


def case(state, calls):
    """Run `calls` ([name, args]) against a copy of `state` with the recorder on."""
    global RECORD
    RECORD = {}
    st = copy.deepcopy(state)
    out = {"state": copy.deepcopy(st), "calls": []}
    for name, args in calls:
        res = err(lambda: getattr(season, name)(st, *args))
        out["calls"].append({"name": name, "args": args, "result": copy.deepcopy(res),
                             "player_edits": copy.deepcopy(st.get("player_edits")), "player_faces": copy.deepcopy(st.get("player_faces")),
                             "settings": copy.deepcopy(st.get("settings"))})
    out["record"] = RECORD
    RECORD = None
    return out


def pure(state, slugs):
    teams = season.load_teams()
    ss = state.get("season_stats") or {}
    keys = sorted({k for specs in season.RANK_STATS.values() for k, _ in specs} | {"snaps", "nope"})
    out = {"perf": {}, "derived": {}, "skills": {}, "ours": {}, "stars": {}, "morale": {}, "payload": {}, "edits": {}}
    for slug, ts in ss.items():
        out["perf"][slug] = [season._perf_score(p["position"], p["stats"]) for p in ts["players"].values()]
        out["derived"][slug] = [[season.derived_stat(p["stats"], k) for k in keys] for p in ts["players"].values()]
    out["derived_keys"] = keys
    for slug in slugs:
        roster = teams[slug]["offense"] + teams[slug]["defense"]
        out["skills"][slug] = [season.all_skills(p) for p in roster]
        out["ours"][slug] = [[season.our_rating(k, dict(zip(["speed", "agility", "strength", "awareness", "kick_power"], (p.get("skills") or [])[:5])), p.get("slug"), None)
                              for k in season.OUR_RATINGS] for p in roster[:12]]
        out["stars"][slug] = [season.recruit_stars(p) for p in roster]
        out["morale"][slug] = [[season.morale_view(state, slug, p["name"], p["position"]), season.morale_factor(state, slug, p["name"], p["position"]),
                                season.player_form(state, slug, p["name"], p["position"])] for p in roster]
        out["payload"][slug] = [season.morale_payload(state, slug), season.team_morale(state, slug), season.team_edits(state, slug), season.player_faces(state, slug)]
    out["star_cuts"] = season._STAR_CUTS
    out["ours_none"] = [season.our_rating(k, {}, None) for k in season.OUR_RATINGS]
    out["faces"] = {s: season.preset_faces(s) for s in slugs + ["no-such-team", "bad/slug"]}
    out["all_faces"] = season.all_preset_faces()
    out["settings"] = [season.settings(state), season.settings({}), season.morale_on(state), season.morale_on({})]
    return out


def honored(state):
    """(team, name) of everyone the season's awards name."""
    found = set()

    def walk(v):
        if isinstance(v, dict):
            if isinstance(v.get("team"), str) and isinstance(v.get("name"), str):
                found.add((v["team"], v["name"]))
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(state.get("awards") or {})
    return sorted(found)


def views(state, slugs):
    teams = season.load_teams()
    me = state["team"]
    out = {"honors": [], "ranks": [], "log": []}
    for team, name in honored(state)[:400]:
        out["honors"].append([team, name, season.player_honors(state, team, name)])
    for slug in slugs + [me]:
        for p in teams[slug]["offense"] + teams[slug]["defense"]:
            out["ranks"].append([slug, p["name"], p["position"], season.player_ranks(state, teams, slug, p["name"], p["position"])])
            out["log"].append([slug, p["name"], p["position"], season.player_game_log(state, slug, p["name"], p["position"])])
    return out


def profile_calls(state, slugs):
    teams = season.load_teams()
    me = state["team"]
    calls = []
    roster = teams[me]["offense"] + teams[me]["defense"]
    seen = set()
    for p in roster:                                   # your own: the first two at every role, and the returners
        k = p.get("role") or p["position"]
        if (k, 1) in seen:
            continue
        seen.add((k, 1) if (k, 0) in seen else (k, 0))
        calls.append(["player_profile", [me, p["name"], p["position"]]])
    for r in ("kick_returner", "punt_returner"):
        calls.append(["player_profile", [me, None, None, teams[me].get(r)]])
    for slug in slugs:
        for p in (teams[slug]["offense"][:3] + teams[slug]["defense"][:3]):
            calls.append(["player_profile", [slug, None, None, p["slug"]]])
            calls.append(["player_profile", [None, None, None, p["slug"]]])
            calls.append(["player_profile", [me, p["name"], None, p["slug"]]])       # a team he is not on: found by his slug
        calls.append(["player_profile", [slug, teams[slug]["offense"][0]["name"]]])
    for team, name in honored(state)[:25]:
        calls.append(["player_profile", [team, name]])
    calls += [["player_profile", [me, "No Such Player", "QB"]], ["player_profile", [None]], ["player_profile", [None, None, None, "no-such-slug"]],
              ["player_profile", ["no-such-team", "X"]]]
    return calls


def edit_calls(state):
    teams = season.load_teams()
    me = state["team"]
    off, de = teams[me]["offense"], teams[me]["defense"]
    qb = next(p for p in off if p["position"] == "QB")
    wr = next(p for p in off if p["position"] == "WR")
    lb = next(p for p in de if p["position"] == "MLB")
    k = next(p for p in off if p["position"] == "K")
    a_qb, a_wr, a_lb = (list((p.get("attributes") or {}).keys()) for p in (qb, wr, lb))
    calls = [
        ["update_settings", [{"god_mode": 1, "morale": None, "nope": True}]],
        ["edit_player", [me, qb["slug"], {"passing": 99, "speed": "71.5", "class": "SR", "weight": "231", "jersey": 7, "height": " 6-4 ", "dev_trait": "Elite"}]],
        ["edit_player", [me, qb["slug"], {"attributes": {a_qb[0]: 99, a_qb[1]: "12", a_qb[-1]: 55.5}}]],
        ["edit_player", [me, wr["slug"], {"attributes": {k_: 90 for k_ in a_wr[:6]}, "hands": 150, "strength": -4}]],
        ["edit_player", [me, wr["slug"], {"attributes": {k_: (wr["attributes"][k_] if i % 2 else 35) for i, k_ in enumerate(a_wr[:6])}}]],
        ["edit_player", [me, lb["slug"], {"tackling": 80.5, "weight": 999, "jersey": "0123456789ABCDEF", "class": lb.get("class")}]],
        ["edit_player", [me, lb["slug"], {"attributes": {a_lb[2]: lb["attributes"][a_lb[2]]}}]],
        ["edit_player", [me, k["slug"], {"kick_power": True, "kick_accuracy": "88"}]],
        ["edit_player", [me, k["slug"], {"passing": 50}]],
        ["edit_player", [me, qb["slug"], {"name": "X"}]],
        ["edit_player", [me, qb["slug"], {"passing": "abc"}]],
        ["edit_player", [me, qb["slug"], {"passing": None}]],
        ["edit_player", [me, qb["slug"], {"passing": "nan"}]],
        ["edit_player", [me, qb["slug"], {"class": "XX"}]],
        ["edit_player", [me, qb["slug"], {"dev_trait": "Superstar"}]],
        ["edit_player", [me, qb["slug"], {"weight": "23.5"}]],
        ["edit_player", [me, qb["slug"], {"weight": None}]],
        ["edit_player", [me, qb["slug"], {"attributes": [1]}]],
        ["edit_player", [me, qb["slug"], {"attributes": {"no_such": 5}}]],
        ["edit_player", [me, qb["slug"], {"attributes": {a_qb[0]: "x"}}]],
        ["edit_player", [me, "no-such-player", {}]],
        ["edit_player", ["no-such-team", "x", {}]],
        ["set_player_face", [me, qb["slug"], {"skin": 2, "hair": "short", "eyes": [1, 2, 3]}]],
        ["set_player_face", [me, wr["slug"], {"big": "x" * 4100}]],
        ["set_player_face", [me, wr["slug"], [1, 2]]],
        ["set_player_face", [me, "no-such-player", {}]],
        ["set_player_face", ["no-such-team", "x", {}]],
        ["set_player_face", [me, qb["slug"], None]],
        ["team_edits", [me]],
        ["player_edits", [me]],
    ]
    for p in (qb, wr, lb, k):
        calls.append(["player_profile", [me, None, None, p["slug"]]])
    return calls, [qb["slug"], wr["slug"], lb["slug"], k["slug"]]


if __name__ == "__main__":
    last = int(sys.argv[2]) if len(sys.argv) > 2 else 17
    slugs = ["michigan", "army", "boise-state", "alabama"]
    hooks()
    st = season.new_season(TEAM, "full", seed=11)
    cases = []
    season.advance_to(st, MORALE_WEEKS)
    for target in (MORALE_WEEKS, last):
        if target > st["current_week"]:
            season.advance_to(st, target)
        season._STAR_CUTS = None                       # so the recorder sees every player's overall once
        common = case(st, [["player_profile", [st["team"], None, None, season.load_teams()[st["team"]]["offense"][0]["slug"]]]])["record"]
        calls, edited = edit_calls(st)
        c = {"name": f"week {st['current_week']}", "common": common, "profiles": case(st, profile_calls(st, slugs)), "edits": case(st, calls),
             "pure": pure(st, slugs), "views": views(st, slugs)}
        s2 = copy.deepcopy(st)
        for name, args in calls:
            if name == "edit_player":
                err(lambda: season.edit_player(s2, *args))
        c["team_data"] = [p for p in season.team_data(s2, st["team"])["offense"] + season.team_data(s2, st["team"])["defense"] if p["slug"] in edited]
        c["team_data_state"] = {"team": s2["team"], "player_edits": s2.get("player_edits"), "coach": s2.get("coach"), "position_changes": s2.get("position_changes")}
        cases.append(c)
    out = {"cases": cases, "morale": MORALE, "decay": DECAY, "teams": season.load_teams(), "teams_meta": season._teams_meta,
           "RATING_KEY": season.RATING_KEY,
           "constants": {k: getattr(season, k) for k in ("POSITION_RATINGS", "RATING_LABELS", "CLASS_NAMES", "DEFAULT_SETTINGS", "DEV_TRAITS",
                                                         "EDITABLE_RATINGS", "EDITABLE_FIELDS", "MORALE_PLAYER_EFFECT", "MORALE_TEAM_EFFECT",
                                                         "MORALE_WEEKLY_DECAY", "MORALE_HOT", "MORALE_RESULT", "MORALE_BLOWOUT", "MORALE_Z_TRACK",
                                                         "MAX_FACE_BYTES", "RANK_STATS", "RANK_MINIMUM", "SKILL_GROUPS", "EVEN_GROUPS", "OUR_RATINGS",
                                                         "OUR_SPREAD")},
           "LOWER_IS_BETTER": sorted(season.LOWER_IS_BETTER)}
    Path(sys.argv[1]).write_text(json.dumps(out), encoding="utf-8")
    print("written", sys.argv[1], "morale games", len(MORALE), "decays", len(DECAY))

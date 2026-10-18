"""The real 2026 season as a read-only season the season page can show.

It starts from the game's "rest of season" setup (every real result through the last
completed week, the real AP polls with their vote points), then fills the season stats
from the real NCAA.com box scores (data/boxscores, tools/fetch_boxscores.py) so the Stats,
Awards and player pages show real numbers. Every real box score is saved with the season
so any game opens. Players are matched to the rosters by name and jersey number.

    python realdata.py                 # rebuild data/seasons/real-2026.json from the data on disk
    python realdata.py --fetch         # download the latest results, box scores and polls first

The server rebuilds it on demand when the data on disk is newer than the saved season.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import season
from teamnames import build_matcher, match

ROOT = Path(__file__).resolve().parent
REAL_ID = "real-2026"
GAMES_FILE = ROOT / "data" / "season_games.json"
BOX_DIR = ROOT / "data" / "boxscores"
SOURCES = [ROOT / "data" / "schedules.json", GAMES_FILE, ROOT / "data" / "history" / "polls.json", ROOT / "data" / "engine_teams.json"]
DEFAULT_FOLLOW = "ohio-state"

SUFFIX = {"JR", "SR", "II", "III", "IV", "V"}
DEF_POSITIONS = {"DL", "MLB", "ROLB", "LOLB", "CB", "S"}


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def norm_name(name: str) -> str:
    """'Kenyatta Jackson Jr.' and 'KENYATTA JACKSON JR.' -> 'KENYATTA JACKSON'."""
    words = re.sub(r"[.,'’\-]", " ", name.upper()).split()
    return " ".join(w for w in words if w not in SUFFIX)


class RosterMatcher:
    """A team's real box score names -> its roster players (name, then jersey and last name)."""

    def __init__(self, team: dict):
        self.players = team["offense"] + team["defense"]
        self.by_name = {}
        self.by_jersey_last = {}
        for p in self.players:
            n = norm_name(p["name"])
            self.by_name.setdefault(n, p)
            if p.get("jersey"):
                self.by_jersey_last.setdefault((str(p["jersey"]), n.split()[-1] if n else ""), p)

    def find(self, first: str, last: str, number) -> Optional[dict]:
        n = norm_name(f"{first} {last}")
        if n in self.by_name:
            return self.by_name[n]
        last_n = norm_name(last).split()[-1] if norm_name(last) else ""
        if number is not None and (str(number), last_n) in self.by_jersey_last:
            return self.by_jersey_last[(str(number), last_n)]
        return None


STAT_MAP = {
    "passing": {"passingAttempts": "pass_attempts", "passingCompletions": "completions", "passingYards": "pass_yards",
                "passingTDs": "passing_touchdowns", "passingInterceptions": "interceptions_thrown", "passingLong": "long_pass"},
    "rushing": {"rushingAttempts": "carries", "rushingYards": "rush_yards", "rushingTDs": "rushing_touchdowns", "rushingLong": "long_rush"},
    "receiving": {"receivingReceptions": "receptions", "receivingYards": "receiving_yards", "receivingTDs": "receiving_touchdowns",
                  "receivingLong": "long_reception"},
    "defense": {"soloTackles": "solo_tackles", "lossTackles": "tackles_for_loss", "sacks": "sacks", "defenseInterceptions": "interceptions",
                "fumblesForced": "forced_fumbles", "fumblesRecovered": "fumble_recoveries"},
    "kicking": {"fieldGoalsAttempted": "fg_attempted", "fieldGoalsMade": "fg_made", "fieldGoalsLong": "long_fg",
                "patAttempted": "pat_attempts", "patMade": "pat_made"},
    "punting": {"puntingPunts": "punts", "puntingYards": "punt_yards", "puntingLong": "long_punt"},
    "kickReturn": {"kickReturns": "kickoff_returns", "kickReturnsYards": "kickoff_return_yards", "kickReturnsTDs": "kickoff_return_touchdowns",
                   "kickReturnsLong": "long_kick_return"},
    "puntReturn": {"puntReturns": "punt_returns", "puntReturnsYards": "punt_return_yards", "puntReturnsTDs": "punt_return_touchdowns",
                   "puntReturnsLong": "long_punt_return"},
}
GUESS_POSITION = {"passing": "QB", "rushing": "RB", "receiving": "WR", "defense": "S", "kicking": "K", "punting": "P",
                  "kickReturn": "WR", "puntReturn": "WR"}


def team_side(box: dict, slug_of) -> dict:
    """{teamId: slug} for the two teams in a box score."""
    out = {}
    for t in box["teams"]:
        out[str(t["teamId"])] = slug_of(t.get("nameShort") or "") or slug_of(t.get("seoname") or "") or slug_of(t.get("nameFull") or "")
    return out


def player_lines(tb: dict, roster: Optional[RosterMatcher]) -> list[dict]:
    """One team's players from a real box score, in the game's stat keys."""
    players: dict[tuple, dict] = {}
    for r in tb["playerStats"]:
        cat = r.get("category")
        if cat not in STAT_MAP:
            continue
        first, last, number = (r.get("firstName") or "").strip(), (r.get("lastName") or "").strip(), r.get("number")
        key = (norm_name(f"{first} {last}"), number)
        rec = players.get(key)
        if rec is None:
            found = roster.find(first, last, number) if roster else None
            name = found["name"] if found else " ".join(w.capitalize() for w in f"{first} {last}".split())
            rec = {"name": name, "position": found["position"] if found else GUESS_POSITION[cat], "matched": bool(found),
                   "slug": found.get("slug") if found else None, "number": number, "stats": {}, "cats": set()}
            players[key] = rec
        rec["cats"].add(cat)
        for src, dst in STAT_MAP[cat].items():
            v = num(r.get(src))
            if dst.startswith("long_"):
                rec["stats"][dst] = max(rec["stats"].get(dst, 0), int(v))
            elif v:
                rec["stats"][dst] = rec["stats"].get(dst, 0) + (v if dst == "sacks" else int(v))
        if cat == "defense":
            total = num(r.get("totalTackles"))
            solo = num(r.get("soloTackles"))
            if total > solo:
                rec["stats"]["assisted_tackles"] = rec["stats"].get("assisted_tackles", 0) + int(total - solo)
        if cat == "kicking":
            fgm = num(r.get("fieldGoalsMade"))
            if fgm and num(r.get("fieldGoalsLong")) >= 50:
                rec["stats"]["fg_50_made"] = rec["stats"].get("fg_50_made", 0) + 1
    out = []
    for rec in players.values():
        if not rec["matched"] and rec["position"] == "QB" and rec["stats"].get("pass_attempts", 0) < 3:
            rec["position"] = "RB" if "rushing" in rec["cats"] else "WR"     # a trick-play pass by a skill player
        unit = "defense" if rec["position"] in DEF_POSITIONS else "special" if rec["position"] in ("K", "P") else "offense"
        out.append({"name": rec["name"], "position": rec["position"], "unit": unit, "number": rec["number"], "slug": rec["slug"],
                    "matched": rec["matched"], "stats": {k: v for k, v in rec["stats"].items() if v}})
    return out


def compact_side(tb: dict, players: list[dict], score: int, opp_tb: dict) -> dict:
    """A team's game in the shape season._accumulate_stats takes."""
    ts = tb["teamStats"]
    sub = lambda k: ts.get(k) or {}
    pas, rush, rec = sub("TeamPassingStats"), sub("TeamRushingStats"), sub("TeamReceivingStats")
    dfn, kr, pr, pun = sub("TeamDefenseStats"), sub("TeamKickReturnsStats"), sub("TeamPuntReturnsStats"), sub("TeamPuntingStats")
    psum = lambda key: sum(p["stats"].get(key, 0) for p in players)
    team = {
        "Pass Attempts": num(pas.get("passingAttempts")), "Completions": num(pas.get("passingCompletions")),
        "Pass Yards": num(pas.get("passingYards")), "Interceptions Thrown": num(pas.get("passingInterceptions")),
        "Sacks Taken": num(((opp_tb.get("teamStats") or {}).get("TeamDefenseStats") or {}).get("sacks")),
        "Carries": num(rush.get("rushingAttempts")), "Rush Yards": num(rush.get("rushingYards")), "Fumbles": num(ts.get("fumbles")),
        "Receptions": num(rec.get("receivingReceptions")), "Receiving Yards": num(rec.get("receivingYards")), "Targets": 0,
        "Passing Touchdowns": num(pas.get("passingTDs")), "Receiving Touchdowns": num(rec.get("receivingTDs")),
        "Rushing Touchdowns": num(rush.get("rushingTDs")), "Solo Tackles": num(dfn.get("soloTackles")),
        "Assisted Tackles": max(0.0, num(dfn.get("totalTackles")) - num(dfn.get("soloTackles"))), "Sacks": num(dfn.get("sacks")),
        "Interceptions": num(dfn.get("defenseInterceptions")), "Forced Fumbles": num(dfn.get("fumblesForced")),
        "PATs Made": psum("pat_made"), "PATS Attempted": psum("pat_attempts"), "Field Goals Made": psum("fg_made"),
        "Field Goals Attempted": psum("fg_attempted"), "Punts": num(pun.get("puntingPunts")), "Punt Yards": num(pun.get("puntingYards")),
        "Kickoff Returns": num(kr.get("kickReturns")), "Kickoff Return Yards": num(kr.get("kickReturnYards")),
        "Kickoff Return Touchdowns": psum("kickoff_return_touchdowns"), "Punt Returns": num(pr.get("puntReturns")),
        "Punt Return Yards": num(pr.get("puntReturnYards")), "Punt Return Touchdowns": psum("punt_return_touchdowns"),
        "Defensive Touchdowns": 0, "Fumble Recoveries": num(dfn.get("fumblesRecovered")),
    }
    events = {"first_downs": num(ts.get("firstDowns")), "third_downs": num(ts.get("thirdDownAttempts")),
              "third_down_conversions": num(ts.get("thirdDowns")), "fourth_down_attempts": num(ts.get("fourthDownAttempts")),
              "fourth_down_conversions": num(ts.get("fourthDowns")), "penalties": num(ts.get("penalty")),
              "penalty_yards": num(ts.get("penaltyYards")), "fumbles_lost": num(ts.get("fumblesLost"))}
    return {"score": score, "team": team, "events": events, "personnel": {}, "schemes": {}, "plays": num(ts.get("teamPlays")), "top": 0,
            "players": [{"name": p["name"], "position": p["position"], "unit": p["unit"], "stats": p["stats"]} for p in players]}


def _ncaa_index(lookup: dict) -> dict:
    """frozenset(slugs) -> [(date, contest_id)] for every final NCAA game with a saved box score."""
    out: dict = {}
    if not GAMES_FILE.exists():
        return out
    for g in json.loads(GAMES_FILE.read_text(encoding="utf-8")):
        if not g.get("final") or not (BOX_DIR / f"{g['contest_id']}.json").exists():
            continue
        h = match(g["home_name"], lookup) or match(g["home_seo"], lookup)
        a = match(g["away_name"], lookup) or match(g["away_seo"], lookup)
        if h and a and h != a:
            out.setdefault(frozenset((h, a)), []).append((datetime.strptime(g["date"], "%m/%d/%Y"), g["contest_id"]))
    return out


def build(follow: str = DEFAULT_FOLLOW) -> dict:
    """The real season as a season state, saved as data/seasons/real-2026.json."""
    teams = season.load_teams()
    if follow not in teams or teams[follow]["fictional"]:
        follow = DEFAULT_FOLLOW
    st = season.new_season(follow, "remaining")
    st.update(id=REAL_ID, mode="real", settings={"god_mode": False, "morale": False}, season_stats={}, my_boxes={},
              real_built_at=datetime.now().isoformat(timespec="seconds"))
    lookup = build_matcher(teams)
    index = _ncaa_index(lookup)
    rosters = {slug: RosterMatcher(t) for slug, t in teams.items() if not t["fictional"]}
    box_dir = season.box_dir(st)
    box_dir.mkdir(parents=True, exist_ok=True)
    for old in box_dir.glob("*.json"):
        old.unlink()
    n_box = n_players = n_matched = 0
    for eid, g in sorted(st["games"].items(), key=lambda kv: kv[1]["week"]):
        if not g["played"]:
            continue
        cands = index.get(frozenset((g["home"], g["away"])), [])
        if not cands:
            continue
        gdate = datetime.strptime(g["date"][:10], "%Y-%m-%d") if g.get("date") else None
        cid = min(cands, key=lambda c: abs((c[0] - gdate).days) if gdate else 0)[1]
        box = json.loads((BOX_DIR / f"{cid}.json").read_text(encoding="utf-8"))["data"]["boxscore"]
        side_slug = team_side(box, lambda n: match(n, lookup))
        sides = {}
        for tb in box["teamBoxscore"]:
            slug = side_slug.get(str(tb["teamId"]))
            if slug == g["home"]:
                sides["home"] = tb
            elif slug == g["away"]:
                sides["away"] = tb
        if set(sides) != {"home", "away"}:
            continue
        lines, real_box = {}, {"real_box": True, "contest_id": cid, "event_id": eid}
        for side, opp in (("home", "away"), ("away", "home")):
            players = player_lines(sides[side], rosters.get(g[side]))
            n_players += len(players)
            n_matched += sum(1 for p in players if p["matched"])
            score = g[f"{side}_score"]
            lines[side] = compact_side(sides[side], players, score, sides[opp])
            real_box[side] = {"slug": g[side], "name": teams[g[side]]["name"], "score": score,
                              "team": lines[side]["team"], "events": lines[side]["events"], "plays": lines[side]["plays"],
                              "players": [{k: v for k, v in p.items() if k != "matched"} for p in players]}
        season._accumulate_stats(st, g, lines)
        (box_dir / f"{eid}.json").write_text(json.dumps(real_box), encoding="utf-8")
        n_box += 1
    st["real_summary"] = {"box_scores": n_box, "players": n_players, "matched": n_matched,
                          "played": sum(1 for g in st["games"].values() if g["played"])}
    season.save_season(st)
    return st


def stale() -> bool:
    """True when the saved real season is older than any of the data it is built from."""
    path = season.SEASONS_DIR / f"{REAL_ID}.json"
    if not path.exists():
        return True
    built = path.stat().st_mtime
    return any(src.exists() and src.stat().st_mtime > built for src in SOURCES) or \
        any(f.stat().st_mtime > built for f in BOX_DIR.glob("*.json"))


def fetch() -> None:
    """Download the latest real results, box scores and polls."""
    for name, args in (("fetch_schedules.py", []), ("fetch_results.py", []), ("fetch_boxscores.py", []), ("fetch_polls.py", ["2026"])):
        print(f"--- {name}")
        subprocess.run([sys.executable, str(ROOT / "tools" / name), *args], cwd=ROOT, check=True)


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
    st = build()
    s = st["real_summary"]
    print(f"real 2026 season through week {st['current_week']}: {s['played']} games played, {s['box_scores']} with a box score, "
          f"{s['players']} player lines ({100 * s['matched'] / max(1, s['players']):.0f}% matched to a roster player)")

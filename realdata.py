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
import unicodedata
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
LOST = "\ufffd"                 # a letter the NCAA feed lost (Öhrström arrives as "\ufffdHRSTR\ufffdM")
NICKNAME = re.compile(r"[\"“”][^\"“”]*[\"“”]")
# NCAA box scores list no punt touchbacks. FBS punts end in the end zone about 7% of the
# time, so real net punting is charged 20 yards on that share of punts (the official net
# charges 20 per touchback, as the engine does).
PUNT_TOUCHBACK_RATE = 0.07
# _ncaa_index files a game against an FCS school under this in place of the FCS team's slug.
FCS = "fcs"
# Season dates are in UTC, NCAA dates local; a game against an FCS school must be this close.
FCS_DATE_DAYS = 2


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def norm_name(name: str) -> str:
    """'Kenyatta Jackson Jr.' -> 'KENYATTA JACKSON'. Accents and apostrophes are dropped
    ("Ja'Bari" -> 'JABARI', 'Öhrström' -> 'OHRSTROM') and quoted nicknames removed
    ('Ethan "Boobie" Feaster' -> 'ETHAN FEASTER')."""
    s = unicodedata.normalize("NFKD", NICKNAME.sub(" ", name))
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    words = re.sub(r"[.,\-]", " ", re.sub(r"['’‘`]", "", s)).split()
    return " ".join(w for w in words if w not in SUFFIX)


def letters(s: str) -> str:
    """Only the capital letters (and lost letters) of a normalized name."""
    return re.sub(rf"[^A-Z{LOST}]", "", s)


def compact(name: str) -> str:
    """The normalized name without spaces or hyphens, so 'Jaron-Keawe' and 'Jaron Keawe' agree."""
    return letters(norm_name(name))


def last_word(name: str) -> str:
    n = norm_name(name).split()
    return letters(n[-1]) if n else ""


def nickname(name: str) -> Optional[str]:
    m = NICKNAME.search(name)
    return m.group(0)[1:-1].strip() if m else None


def same(a: str, b: str) -> bool:
    """Two compact names agree; a lost letter in `a` stands for one or two letters of `b`."""
    if LOST not in a:
        return a == b
    return re.fullmatch("".join(".{1,2}" if c == LOST else re.escape(c) for c in a), b) is not None


def same_first(box_first: str, roster_name: str) -> bool:
    """A box score first name (compact) that can be the roster player's: missing, a short
    form ('CAM' / 'Cameron'), the same first four letters ('WILLIE' / 'William') or initials
    ('BJ' / 'Boubacar')."""
    words = norm_name(roster_name).split()
    first = letters(words[0]) if words else ""
    a, b = box_first, first
    return (not a or a.startswith(b) or b.startswith(a) or (len(a) >= 4 and a[:4] == b[:4])
            or (len(a) <= 2 and b[:1] == a[:1]))


def unit_of(position: str) -> str:
    """The side of the ball an engine position plays on: offense, defense or special."""
    if position in DEF_POSITIONS:
        return "defense"
    if position in ("K", "P"):
        return "special"
    return "offense"


def team_stat(tb: dict, group: str, key: str) -> float:
    """One number from a team box score's team stats (0 when missing), e.g.
    team_stat(tb, "TeamPuntReturnsStats", "puntReturnYards")."""
    return num(((tb.get("teamStats") or {}).get(group) or {}).get(key))


# The side of the ball each box score category belongs to (a returner can be anyone).
CATEGORY_SIDE = {"passing": "offense", "rushing": "offense", "receiving": "offense", "defense": "defense",
                 "kicking": "special", "punting": "special", "kickReturn": None, "puntReturn": None}


class RosterMatcher:
    """A team's real box score names -> its roster players.

    In order: the full name (accents, apostrophes, suffixes and nicknames ignored; a quoted
    nickname is also tried as the first name), then jersey number and last name, then a last
    name only one player has whose first name fits (same_first). The number and last-name steps look only at players on the side
    of the ball the stat belongs to, and they overrule a name match from the other side: NCAA
    stat crews give two players who share a number one name, so USC's #0 receiver reads as
    CB Jontez Williams, and his catches belong to WR Zacharyus Williams (also #0)."""

    def __init__(self, team: dict):
        self.players = team["offense"] + team["defense"]
        self.by_name: dict[str, list[dict]] = {}
        for p in self.players:
            self.by_name.setdefault(compact(p["name"]), []).append(p)

    def _named(self, first: str, last: str) -> list[dict]:
        keys = [compact(f"{first} {last}")]
        nick = nickname(first)
        if nick:
            keys.append(compact(f"{nick} {last}"))
        for k in keys:
            if not k:
                continue
            hits = [p for n, ps in self.by_name.items() if same(k, n) for p in ps] if LOST in k else self.by_name.get(k, [])
            if hits:
                return hits
        return []

    def find(self, first: str, last: str, number, side: Optional[str] = None) -> Optional[dict]:
        named = self._named(first, last)
        on_side = [p for p in named if side is None or unit_of(p["position"]) == side]
        if on_side:
            return next((p for p in on_side if number is not None and str(p.get("jersey")) == str(number)), on_side[0])
        pool = [p for p in self.players if side is None or unit_of(p["position"]) == side]
        last_n = last_word(last)
        if last_n and number is not None:
            hits = [p for p in pool if str(p.get("jersey")) == str(number) and same(last_n, last_word(p["name"]))]
            if len(hits) == 1:
                return hits[0]
        if named:
            return named[0]                    # a two-way player: right name, not his usual side
        if last_n:
            first_n = compact(first)
            hits = [p for p in pool if same(last_n, last_word(p["name"])) and same_first(first_n, p["name"])]
            if len(hits) == 1:
                return hits[0]                 # 'Jr. Soares' (first name lost), 'Cam' for 'Cameron', 'BJ' for 'Boubacar'
        return None


STAT_MAP = {
    "passing": {"passingAttempts": "pass_attempts", "passingCompletions": "completions", "passingYards": "pass_yards",
                "passingTDs": "passing_touchdowns", "passingInterceptions": "interceptions_thrown", "passingLong": "long_pass"},
    "rushing": {"rushingAttempts": "carries", "rushingYards": "rush_yards", "rushingTDs": "rushing_touchdowns", "rushingLong": "long_rush"},
    "receiving": {"receivingReceptions": "receptions", "receivingYards": "receiving_yards", "receivingTDs": "receiving_touchdowns",
                  "receivingLong": "long_reception"},
    "defense": {"soloTackles": "solo_tackles", "lossTackles": "tackles_for_loss", "sacks": "sacks", "defenseInterceptions": "interceptions",
                "fumblesForced": "forced_fumbles", "fumblesRecovered": "fumble_recoveries"},
    # patAttempted is 0 on every NCAA kicking line; attempts are filled in fill_special_teams
    "kicking": {"fieldGoalsAttempted": "fg_attempted", "fieldGoalsMade": "fg_made", "fieldGoalsLong": "long_fg", "patMade": "pat_made"},
    "punting": {"puntingPunts": "punts", "puntingYards": "punt_yards", "puntingLong": "long_punt"},
    "kickReturn": {"kickReturns": "kickoff_returns", "kickReturnsYards": "kickoff_return_yards", "kickReturnsTDs": "kickoff_return_touchdowns",
                   "kickReturnsLong": "long_kick_return"},
    "puntReturn": {"puntReturns": "punt_returns", "puntReturnsYards": "punt_return_yards", "puntReturnsTDs": "punt_return_touchdowns",
                   "puntReturnsLong": "long_punt_return"},
}


def guess_position(stats: dict, number) -> str:
    """A position for a player missing from the roster, from everything he did (one game's
    line, or his whole season): a kicker or punter if kicking is most of his work, a
    quarterback if he threw 5 or more passes, then the bigger of his offensive and defensive
    work. Defenders go by jersey number: 60 and up a lineman, 40-59 a linebacker (a lineman
    if sacks and tackles for loss are half his tackles), under 40 a safety."""
    def g(k: str) -> float:
        return stats.get(k, 0)

    offense = g("pass_attempts") + g("carries") + g("receptions")
    tackles = g("solo_tackles") + g("assisted_tackles") + g("sacks") + g("interceptions")
    kicks, punts = g("fg_attempted") + g("pat_made"), g("punts")
    if (kicks or punts) and kicks + punts >= offense + tackles:
        return "K" if kicks >= punts else "P"
    if g("pass_attempts") >= 5 and offense >= tackles:
        return "QB"
    if offense and offense >= tackles:
        return "RB" if g("carries") >= g("receptions") else "WR"
    if tackles:
        n = int(num(number)) if number is not None else 0
        if n >= 60 or (n >= 40 and 2 * (g("sacks") + g("tackles_for_loss")) >= tackles):
            return "DL"
        return "MLB" if n >= 40 else "S"
    return "WR"                                 # returns only


def display_name(first: str, last: str) -> str:
    """'JR.' 'SOARES' -> 'Soares Jr.'; a quoted nickname is left out."""
    first = NICKNAME.sub(" ", first).strip()
    if first.upper().rstrip(".") in SUFFIX:
        first, last = "", f"{last} {first}"

    def word(w: str) -> str:
        if w.upper() in ("II", "III", "IV"):
            return w.upper()
        return "-".join(x.capitalize() for x in w.split("-"))

    return " ".join(word(w) for w in f"{first} {last}".split())


def team_side(box: dict, slug_of) -> dict:
    """{teamId: slug} for the two teams in a box score."""
    out = {}
    for t in box["teams"]:
        out[str(t["teamId"])] = slug_of(t.get("nameShort") or "") or slug_of(t.get("seoname") or "") or slug_of(t.get("nameFull") or "")
    return out


def player_lines(tb: dict, roster: Optional[RosterMatcher]) -> list[dict]:
    """One team's players from a real box score, in the game's stat keys. Each stat row is
    matched on its own, against the side of the ball it belongs to. An unmatched player's
    position comes from his whole line, read after every row (import_real_boxes then gives
    him one position for the season)."""
    players: dict[tuple, dict] = {}
    for r in tb["playerStats"]:
        cat = r.get("category")
        if cat not in STAT_MAP:
            continue
        first, last, number = (r.get("firstName") or "").strip(), (r.get("lastName") or "").strip(), r.get("number")
        found = roster.find(first, last, number, CATEGORY_SIDE[cat]) if roster else None
        key = ("slug", found["slug"]) if found else ("name", compact(f"{first} {last}") or display_name(first, last))
        rec = players.get(key)
        if rec is None:
            if found:
                name, position, slug = found["name"], found["position"], found.get("slug")
            else:
                name, position, slug = display_name(first, last), None, None
            rec = {"name": name, "position": position, "matched": bool(found), "slug": slug, "number": number, "key": key[1], "stats": {}}
            players[key] = rec
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
        position = rec["position"] or guess_position(rec["stats"], rec["number"])
        out.append({"name": rec["name"], "position": position, "unit": unit_of(position), "number": rec["number"], "slug": rec["slug"],
                    "matched": rec["matched"], "key": rec["key"], "stats": {k: v for k, v in rec["stats"].items() if v}})
    return out


def touchdowns(tb: dict) -> int:
    """A team's offensive and return touchdowns in a box score (defensive scores are not listed)."""
    ts = tb["teamStats"]
    n = num((ts.get("TeamPassingStats") or {}).get("passingTDs")) + num((ts.get("TeamRushingStats") or {}).get("rushingTDs"))
    n += sum(num(r.get("kickReturnsTDs")) + num(r.get("puntReturnsTDs")) for r in tb["playerStats"]
             if r.get("category") in ("kickReturn", "puntReturn"))
    return int(n)


def kicking_listed(tb: dict) -> bool:
    """NCAA box scores have a kicking line only for kickers who tried a field goal (all 687 such
    lines do). A team without one tried no field goal, a true zero, but its extra points are
    not listed anywhere."""
    return any(r.get("category") == "kicking" for r in tb["playerStats"])


def fill_special_teams(players: list[dict], opp_tb: dict) -> None:
    """Two numbers NCAA box scores leave out, filled in so real weeks read like simulated ones:
    extra-point attempts (only makes are listed, so each make counts as one attempt; a missed
    kick cannot be told from a failed two-point try in the score) and net punt yards (a
    punter's yards less the opponent's punt return yards, shared out by punts, less 20 yards
    on the expected share of touchbacks, PUNT_TOUCHBACK_RATE, since touchbacks are not listed)."""
    for p in players:
        st = p["stats"]
        if st.get("pat_made") and not st.get("pat_attempts"):
            st["pat_attempts"] = st["pat_made"]
    punters = [p for p in players if p["stats"].get("punts")]
    total = sum(p["stats"]["punts"] for p in punters)
    if not total:
        return
    returned = team_stat(opp_tb, "TeamPuntReturnsStats", "puntReturnYards")
    for p in punters:
        st = p["stats"]
        st["punt_net_yards"] = int(round(st.get("punt_yards", 0) - returned * st["punts"] / total - 20 * PUNT_TOUCHBACK_RATE * st["punts"]))


def compact_side(tb: dict, players: list[dict], score: int, opp_tb: dict) -> dict:
    """A team's game in the shape season._accumulate_stats takes.

    Field goals are 0 when no kicker line is listed (none was tried). Extra points are then
    missing, not 0: the PAT keys are left out and events["pats_listed"] is 0, so a per-game
    PAT figure divides by the games that list them. "Fumbles" is every fumble, as in the
    engine (which counts each one before the recovery); events["fumbles_lost"] is the ones
    the other team recovered, also as in the engine."""
    ts = tb["teamStats"]

    def sub(k: str) -> dict:
        return ts.get(k) or {}

    def psum(key: str) -> float:
        """The players' total of one stat."""
        return sum(p["stats"].get(key, 0) for p in players)

    pas, rush, rec = sub("TeamPassingStats"), sub("TeamRushingStats"), sub("TeamReceivingStats")
    dfn, kr, pr, pun = sub("TeamDefenseStats"), sub("TeamKickReturnsStats"), sub("TeamPuntReturnsStats"), sub("TeamPuntingStats")
    listed = kicking_listed(tb)
    pats_listed = listed or (score == 0 and not touchdowns(tb))
    punts, punt_yards = num(pun.get("puntingPunts")), num(pun.get("puntingYards"))
    returned = team_stat(opp_tb, "TeamPuntReturnsStats", "puntReturnYards")
    team = {
        "Pass Attempts": num(pas.get("passingAttempts")), "Completions": num(pas.get("passingCompletions")),
        "Pass Yards": num(pas.get("passingYards")), "Interceptions Thrown": num(pas.get("passingInterceptions")),
        "Sacks Taken": team_stat(opp_tb, "TeamDefenseStats", "sacks"),
        "Carries": num(rush.get("rushingAttempts")), "Rush Yards": num(rush.get("rushingYards")), "Fumbles": num(ts.get("fumbles")),
        "Receptions": num(rec.get("receivingReceptions")), "Receiving Yards": num(rec.get("receivingYards")), "Targets": 0,
        "Passing Touchdowns": num(pas.get("passingTDs")), "Receiving Touchdowns": num(rec.get("receivingTDs")),
        "Rushing Touchdowns": num(rush.get("rushingTDs")), "Solo Tackles": num(dfn.get("soloTackles")),
        "Assisted Tackles": max(0.0, num(dfn.get("totalTackles")) - num(dfn.get("soloTackles"))), "Sacks": num(dfn.get("sacks")),
        "Interceptions": num(dfn.get("defenseInterceptions")), "Forced Fumbles": num(dfn.get("fumblesForced")),
        "Field Goals Made": psum("fg_made"), "Field Goals Attempted": psum("fg_attempted"), "Punts": punts, "Punt Yards": punt_yards,
        "Punt Net Yards": round(punt_yards - returned - 20 * PUNT_TOUCHBACK_RATE * punts) if punts else 0,
        "Kickoff Returns": num(kr.get("kickReturns")), "Kickoff Return Yards": num(kr.get("kickReturnYards")),
        "Kickoff Return Touchdowns": psum("kickoff_return_touchdowns"), "Punt Returns": num(pr.get("puntReturns")),
        "Punt Return Yards": num(pr.get("puntReturnYards")), "Punt Return Touchdowns": psum("punt_return_touchdowns"),
        "Defensive Touchdowns": 0, "Fumble Recoveries": num(dfn.get("fumblesRecovered")),
    }
    if pats_listed:
        team["PATs Made"], team["PATS Attempted"] = psum("pat_made"), psum("pat_attempts")
    events = {"first_downs": num(ts.get("firstDowns")), "third_downs": num(ts.get("thirdDownAttempts")),
              "third_down_conversions": num(ts.get("thirdDowns")), "fourth_down_attempts": num(ts.get("fourthDownAttempts")),
              "fourth_down_conversions": num(ts.get("fourthDowns")), "penalties": num(ts.get("penalty")),
              "penalty_yards": num(ts.get("penaltyYards")), "fumbles_lost": num(ts.get("fumblesLost")),
              "kicking_listed": int(listed), "pats_listed": int(pats_listed)}
    return {"score": score, "team": team, "events": events, "personnel": {}, "schemes": {}, "plays": num(ts.get("teamPlays")), "top": 0,
            "players": [{"name": p["name"], "position": p["position"], "unit": p["unit"], "stats": p["stats"]} for p in players]}


def _ncaa_index(lookup: dict) -> dict:
    """frozenset(slugs) -> [(date, contest_id)] for every final NCAA game with a saved box score.

    A game where one side is an FBS team and the other matches no team is a game against an
    FCS school. The season plays it against the school's fictional stand-in (season.fcs_map),
    which the NCAA name cannot tell, so it is filed under frozenset((slug, FCS)) and found by
    date (_real_games)."""
    out: dict = {}
    if not GAMES_FILE.exists():
        return out
    for g in json.loads(GAMES_FILE.read_text(encoding="utf-8")):
        if not g.get("final") or not (BOX_DIR / f"{g['contest_id']}.json").exists():
            continue
        h = match(g["home_name"], lookup) or match(g["home_seo"], lookup)
        a = match(g["away_name"], lookup) or match(g["away_seo"], lookup)
        when = (datetime.strptime(g["date"], "%m/%d/%Y"), g["contest_id"])
        if h and a and h != a:
            out.setdefault(frozenset((h, a)), []).append(when)
        elif bool(h) != bool(a):
            out.setdefault(frozenset((h or a, FCS)), []).append(when)
    return out


def build(follow: str = DEFAULT_FOLLOW) -> dict:
    """The real season as a season state, saved as data/seasons/real-2026.json."""
    teams = season.load_teams()
    if follow not in teams or teams[follow]["fictional"]:
        follow = DEFAULT_FOLLOW
    st = season.new_season(follow, "remaining", fill_open_dates=False)
    st.update(id=REAL_ID, mode="real", settings={"god_mode": False, "morale": False}, season_stats={}, my_boxes={},
              real_built_at=datetime.now().isoformat(timespec="seconds"))
    st["real_summary"] = import_real_boxes(st, fresh=True)
    season.save_season(st)
    return st


def import_real_boxes(st: dict, fresh: bool = False) -> dict:
    """Every played real game's NCAA box score, turned into the game's stat lines: added to
    the season's stats and saved as a box score the season can open. Used by the real
    season page and by a season started from today (its real weeks then carry real stats,
    game logs and box scores). Returns counts: box scores, player lines, matched lines, and
    the team-games whose extra points are not listed (no kicker line, points scored), and the
    games against an FCS school (played by its fictional stand-in).

    In a game against an FCS school only the FBS team's players are kept. The FCS school's
    team line is imported (its field goals and punting are read from its player rows), but
    its players are left out of the box score and the season stats: the stand-in never shows
    the real school it replaces (season.fcs_label), and its roster is fictional. Player
    counts and the match rate are for FBS teams only.

    Two passes: every game's lines are read first, so a player missing from the roster gets
    one position for the season from all his games (guess_position), not one per game."""
    teams = season.load_teams()
    lookup = build_matcher(teams)
    index = _ncaa_index(lookup)
    rosters = {slug: RosterMatcher(t) for slug, t in teams.items() if not t["fictional"]}
    fictional = {slug for slug, t in teams.items() if t["fictional"]}
    box_dir = season.box_dir(st)
    box_dir.mkdir(parents=True, exist_ok=True)
    if fresh:
        for old in box_dir.glob("*.json"):
            old.unlink()
    st.setdefault("season_stats", {})
    games = []
    unmatched: dict[tuple, dict] = {}
    for eid, g, cid, sides in _real_games(st, index, lookup, fictional):
        players = {side: player_lines(sides[side], rosters.get(g[side])) for side in ("home", "away")}
        for side in players:
            if g[side] in fictional:
                continue
            for p in players[side]:
                if not p["matched"]:
                    u = unmatched.setdefault((g[side], p["key"]), {"stats": {}, "number": p["number"]})
                    season._add_into(u["stats"], p["stats"])
        games.append((eid, g, cid, sides, players))
    position = {k: guess_position(u["stats"], u["number"]) for k, u in unmatched.items()}
    n_box = n_players = n_matched = n_no_pats = n_fcs = 0
    for eid, g, cid, sides, players in games:
        lines, real_box = {}, {"real_box": True, "contest_id": cid, "event_id": eid}
        n_fcs += any(g[side] in fictional for side in ("home", "away"))
        for side, opp in (("home", "away"), ("away", "home")):
            plist = players[side]
            fcs = g[side] in fictional
            for p in plist:
                if not p["matched"] and not fcs:
                    p["position"] = position[(g[side], p["key"])]
                    p["unit"] = unit_of(p["position"])
            fill_special_teams(plist, sides[opp])
            score = g[f"{side}_score"]
            lines[side] = compact_side(sides[side], plist, score, sides[opp])
            if fcs:
                plist = lines[side]["players"] = []
            n_players += len(plist)
            n_matched += sum(1 for p in plist if p["matched"])
            n_no_pats += not lines[side]["events"]["pats_listed"]
            real_box[side] = {"slug": g[side], "name": teams[g[side]]["name"], "score": score,
                              "team": lines[side]["team"], "events": lines[side]["events"], "plays": lines[side]["plays"],
                              "players": [{k: v for k, v in p.items() if k not in ("matched", "key")} for p in plist]}
        season._accumulate_stats(st, g, lines)
        (box_dir / f"{eid}.json").write_text(json.dumps(real_box), encoding="utf-8")
        n_box += 1
    return {"box_scores": n_box, "players": n_players, "matched": n_matched, "pats_not_listed": n_no_pats, "fcs_games": n_fcs,
            "played": sum(1 for g in st["games"].values() if g["played"])}


def _real_games(st: dict, index: dict, lookup: dict, fictional: set):
    """(event id, game, contest id, {"home": team box, "away": team box}) for every played real
    game of the season with a saved NCAA box score, in week order.

    A game against a fictional FCS stand-in takes the FBS team's game against an FCS school
    on the same date (within FCS_DATE_DAYS); the FCS school's team box goes to the stand-in."""
    for eid, g in sorted(st["games"].items(), key=lambda kv: kv[1]["week"]):
        if not g["played"] or not g.get("real"):
            continue
        fcs_side = next((s for s in ("home", "away") if g[s] in fictional), None)
        fbs = g["away" if fcs_side == "home" else "home"] if fcs_side else None
        key = frozenset((fbs, FCS)) if fcs_side else frozenset((g["home"], g["away"]))
        cands = index.get(key, [])
        gdate = datetime.strptime(g["date"][:10], "%Y-%m-%d") if g.get("date") else None
        if fcs_side:
            cands = [c for c in cands if gdate and abs((c[0] - gdate).days) <= FCS_DATE_DAYS]
        if not cands:
            continue
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
            elif fcs_side and slug is None:
                sides[fcs_side] = tb
        if set(sides) == {"home", "away"}:
            yield eid, g, cid, sides


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
    print(f"real 2026 season through week {st['current_week']}: {s['played']} games played, {s['box_scores']} with a box score "
          f"({s['fcs_games']} against FCS schools), "
          f"{s['players']} player lines ({100 * s['matched'] / max(1, s['players']):.1f}% matched to a roster player); "
          f"extra points not listed for {s['pats_not_listed']} team-games (no kicker line, points scored)")

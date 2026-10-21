"""In-season form: how far each team has played above or below its preseason rating,
fit from the real 2026 results and carried into the sim as a rating adjustment.

The preseason ratings never moved during a season, so by midseason the sim was still
rating teams the way the rosters looked in August while the market had six weeks of
results priced in (week 7 of 2026: the market beat the sim 12-5 when they disagreed, and
the gap was in G5 games where the roster ratings are thinnest). This fits one number per
team, in points of margin, by ridge least squares on the real margins:

    margin = home field + (preseason gap in points) + form_home - form_away + noise

Margins are capped at ±28 so blowouts do not swing a team, and the ridge pulls every team
toward zero, so after n games a team keeps n / (n + K) of what the results say. The sim
takes the form as a shift of every player's ratings (points / PTS_PER_RATING).

`python form.py [through_week]` prints the table."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GAMES_FILE = ROOT / "data" / "season_games.json"

HFA = 2.5                 # home field, in points, for the fit
CAP = 28                  # a margin beyond this counts as this
K = 4.0                   # ridge: after n games a team keeps n / (n + K) of the fitted form
PTS_PER_RATING = 1.36     # the sim's margin per point of team rating (measured on the week 7 forward test)
MAX_SHIFT = 12            # rating points: no single adjustment beyond this
ATTRS = ("speed", "strength", "intelligence", "passing", "decision_making", "elusiveness", "vision", "hands",
         "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage", "kick_power",
         "kick_accuracy", "punt_power", "punt_accuracy", "return_rating")


def _matched(games: list[dict], teams: dict, through_week: int | None) -> list[tuple[str, str, int, bool]]:
    """(home slug, away slug, capped home margin, neutral) for every final game between two
    engine teams through `through_week`."""
    from teamnames import build_matcher, match
    lookup = build_matcher(teams)
    out = []
    for g in games:
        if not g.get("final") or g.get("home_score") is None:
            continue
        if through_week is not None and g["week"] > through_week:
            continue
        h = match(g["home_name"], lookup) or match(g.get("home_seo") or "", lookup)
        a = match(g["away_name"], lookup) or match(g.get("away_seo") or "", lookup)
        if not h or not a or h == a or h not in teams or a not in teams:
            continue
        m = max(-CAP, min(CAP, g["home_score"] - g["away_score"]))
        out.append((h, a, m, bool(g.get("neutral"))))
    return out


def fit_form(games: list[dict], teams: dict, through_week: int | None = None, iterations: int = 60,
             player_form: dict[str, dict[str, dict]] | None = None) -> dict[str, dict]:
    """slug -> {games, points, rating} for every team with a result; points is the team's
    form in margin points, rating the shift the sim applies to its players. With a player
    table, the fit starts from the player-adjusted ratings and explains only the rest."""
    rows = _matched(games, teams, through_week)
    rating0 = {s: adjusted_overall(t, (player_form or {}).get(s)) for s, t in teams.items() if not t.get("fictional")}
    form = {s: 0.0 for s in rating0}
    played: dict[str, list] = {s: [] for s in rating0}
    for h, a, m, neutral in rows:
        if h in rating0 and a in rating0:
            base = (0.0 if neutral else HFA) + (rating0[h] - rating0[a]) * PTS_PER_RATING
            played[h].append((a, m - base, 1))      # from the home side: residual = margin - base
            played[a].append((h, m - base, -1))     # from the away side the same residual, flipped
    for _ in range(iterations):
        for s, lst in played.items():
            if not lst:
                continue
            # ridge least squares one team at a time. From the home side the residual is
            # form_home - form_away, from the away side form_away - form_home, so for team s:
            # form_s = sum over its games of (sign * residual + form_opponent) / (n + K)
            form[s] = sum(sign * resid + form[opp] for opp, resid, sign in lst) / (len(lst) + K)
    out = {}
    for s, lst in played.items():
        if not lst:
            continue
        shift = max(-MAX_SHIFT, min(MAX_SHIFT, form[s] / PTS_PER_RATING))
        out[s] = {"games": len(lst), "points": round(form[s], 2), "rating": round(shift, 2)}
    return out


def form_shift(team_form: dict | None) -> float:
    return float(team_form["rating"]) if team_form else 0.0


def _moved(p: dict, keys, shift: float) -> dict:
    """A copy of the player with the ratings in `keys` moved by `shift` (held to 1-99)."""
    q = dict(p)
    for k in keys:
        v = p.get(k)
        if isinstance(v, (int, float)):
            q[k] = max(1, min(99, int(round(v + shift))))
    return q


def with_form(team: dict, shift: float) -> dict:
    """A copy of the team with every player's ratings moved by `shift` rating points
    (nothing when the shift rounds to zero)."""
    if abs(shift) < 0.5:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        out[unit] = [_moved(p, ATTRS, shift) for p in team[unit]]
    return out


# ----- player form: a player who is playing above or below his rating ------------------
# From the real box scores (data/boxscores, fetched by tools/fetch_boxscores.py): each
# matched player's production is placed on the league's distribution for his position and
# compared with where his rating sits among the league's starters. The gap, shrunk by
# games played and capped, moves his position ratings. The team-level fit then runs on
# the player-adjusted ratings, so it only explains what the players do not.

BOX_DIR = ROOT / "data" / "boxscores"
PLAYER_K = 6.0            # a player keeps n / (n + K) of what his games say
PLAYER_MAX_SHIFT = 5      # rating points
PLAYER_MIN_SHIFT = 1.0    # smaller moves are noise
PLAYER_ATTRS = {
    "QB": ("passing", "decision_making", "intelligence"),
    "RB": ("speed", "elusiveness", "vision", "strength"),
    "WR": ("hands", "route_running", "speed", "elusiveness"),
    "TE": ("hands", "route_running", "speed"),
    "K": ("kick_power", "kick_accuracy"),
    "P": ("punt_power", "punt_accuracy"),
    "DL": ("rushing", "tackling", "strength", "speed"),
    "LB": ("tackling", "rushing", "coverage", "speed"),
    "DB": ("coverage", "speed", "tackling"),
}
GROUP = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "P": "P", "DL": "DL", "MLB": "LB", "ROLB": "LB", "LOLB": "LB", "CB": "DB", "S": "DB"}
# category -> (position groups it can match, minimum sample, sample key)
CATEGORIES = {
    "passing": ({"QB"}, 40, "att"), "rushing": ({"RB"}, 30, "att"), "receiving": ({"WR", "TE"}, 12, "rec"),
    "kicking": ({"K"}, 5, "fga"), "punting": ({"P"}, 10, "punts"), "defense": ({"DL", "LB"}, 12, "tkl"),
}
# defensive backs are left out: tackles say little about coverage (the best corners are thrown at least)
MIN_GAMES = 3             # every line needs this many games as well
# The player table is always fitted (the player card shows it), but the shifts only reach the
# sims when FORM_PLAYERS=1 is set: on the week 7 back-test they made the picks worse (72.9% to
# 66-70% straight up, margin MAE 10.9 to 11.1-11.3), because production percentiles punish
# players on dominant teams, whose defenses sit and whose backs rest in blowouts.
PLAYER_FORM_APPLIED = (os.environ.get("FORM_PLAYERS") or "") in ("1", "true", "yes")
ENABLED_CATEGORIES = set((os.environ.get("FORM_CATEGORIES") or "passing,rushing,receiving,kicking,punting,defense").split(","))
# category -> {season total: box score field} for the totals that add up game by game
# (a kicker's long field goal is the season's longest instead, in _real_players)
BOX_FIELDS = {
    "passing": {"att": "passingAttempts", "cmp": "passingCompletions", "yds": "passingYards", "td": "passingTDs",
                "int": "passingInterceptions"},
    "rushing": {"att": "rushingAttempts", "yds": "rushingYards", "td": "rushingTDs"},
    "receiving": {"rec": "receivingReceptions", "yds": "receivingYards", "td": "receivingTDs"},
    "kicking": {"fga": "fieldGoalsAttempted", "fgm": "fieldGoalsMade"},
    "punting": {"punts": "puntingPunts", "yds": "puntingYards"},
    "defense": {"tkl": "totalTackles", "tfl": "lossTackles", "sacks": "sacks", "int": "defenseInterceptions",
                "ff": "fumblesForced"},
}


def _num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _last(name: str) -> str:
    """The last name for matching: upper case, punctuation and suffixes (Jr., III) dropped."""
    toks = [t for t in re.sub(r"[.,']", "", (name or "").upper()).split() if t not in ("JR", "SR", "II", "III", "IV", "V")]
    return toks[-1] if toks else ""


def _player_score(cat: str, t: dict) -> float | None:
    """One production number per category, per game where volume matters."""
    g = max(1, t["games"])
    if cat == "passing":
        if t["att"] < 1:
            return None
        return (8.4 * t["yds"] + 330 * t["td"] - 200 * t["int"] + 100 * t["cmp"]) / t["att"]   # the NCAA passer rating
    if cat == "rushing":
        return t["yds"] / max(1, t["att"]) + 0.03 * t["yds"] / g                                 # yards a carry, with volume
    if cat == "receiving":
        return t["yds"] / g
    if cat == "kicking":
        return t["fgm"] / max(1, t["fga"]) + 0.004 * t["long"]
    if cat == "punting":
        return t["yds"] / max(1, t["punts"])
    if cat == "defense":
        return (t["tkl"] + 2 * t["tfl"] + 4 * t["sacks"] + 5 * t["int"] + 3 * t["ff"]) / g
    return None


def _real_players(games: list[dict], teams: dict, through_week: int | None) -> dict[str, dict[str, dict]]:
    """slug -> (category|LASTNAME|first initial) -> season totals from the box scores."""
    from teamnames import build_matcher, match
    lookup = build_matcher(teams)
    out: dict[str, dict[str, dict]] = {}
    for g in games:
        if not g.get("final") or (through_week is not None and g["week"] > through_week):
            continue
        path = BOX_DIR / f"{g['contest_id']}.json"
        if not path.exists():
            continue
        try:
            box = json.loads(path.read_text(encoding="utf-8"))["data"]["boxscore"]
        except (ValueError, KeyError, TypeError):
            continue
        by_id = {str(t["teamId"]): t for t in box.get("teams", [])}
        for tb in box.get("teamBoxscore", []):
            info = by_id.get(str(tb["teamId"])) or {}
            slug = match(info.get("seoname") or "", lookup) or match(info.get("nameShort") or "", lookup)
            if not slug or slug not in teams:
                continue
            rows = out.setdefault(slug, {})
            seen = set()
            for p in tb.get("playerStats", []):
                cat = p.get("category")
                if cat not in CATEGORIES:
                    continue
                key = f"{cat}|{_last(p.get('lastName') or '')}|{(p.get('firstName') or '')[:1].upper()}"
                t = rows.setdefault(key, {"games": 0, "att": 0, "cmp": 0, "yds": 0, "td": 0, "int": 0, "rec": 0, "fga": 0, "fgm": 0, "long": 0,
                                          "punts": 0, "tkl": 0, "tfl": 0, "sacks": 0, "ff": 0, "first": (p.get("firstName") or "").upper(),
                                          "last": (p.get("lastName") or "").upper(), "pos": (p.get("position") or "").upper()})
                if key not in seen:
                    t["games"] += 1
                    seen.add(key)
                for total, field in BOX_FIELDS[cat].items():
                    t[total] += _num(p.get(field))
                if cat == "kicking":
                    t["long"] = max(t["long"], _num(p.get("fieldGoalsLong")))
    return out


def _overall(p: dict) -> float:
    """The position rating the shift is measured on: the mean of the position's key ratings."""
    keys = PLAYER_ATTRS.get(GROUP.get(p["position"], ""), ())
    vals = [p[k] for k in keys if isinstance(p.get(k), (int, float))]
    return sum(vals) / len(vals) if vals else 50.0


def _note(cat: str, t: dict) -> str:
    """A player's real season line in one category, for the player card."""
    if cat == "passing":
        return f"{t['cmp']:.0f}/{t['att']:.0f}, {t['yds']:.0f} yds, {t['td']:.0f} TD, {t['int']:.0f} INT"
    if cat == "rushing":
        return f"{t['att']:.0f} car, {t['yds']:.0f} yds ({t['yds'] / max(1, t['att']):.1f} a carry)"
    if cat == "receiving":
        return f"{t['rec']:.0f} rec, {t['yds']:.0f} yds"
    if cat == "kicking":
        return f"{t['fgm']:.0f}/{t['fga']:.0f} FG, long {t['long']:.0f}"
    if cat == "punting":
        return f"{t['punts']:.0f} punts, {t['yds'] / max(1, t['punts']):.1f} avg"
    if cat == "defense":
        return f"{t['tkl']:.0f} tkl, {t['tfl']:.0f} TFL, {t['sacks']:.0f} sacks, {t['int']:.0f} INT"
    raise KeyError(cat)


def fit_player_form(games: list[dict], teams: dict, through_week: int | None = None) -> dict[str, dict[str, dict]]:
    """slug -> player slug -> {shift, games, note}: how far each matched player's real
    production sits from his rating, as a shift of his position ratings."""
    real = _real_players(games, teams, through_week)
    # each real line matched to a roster player of the right group, by last name (first initial breaks ties)
    matched: dict[str, list[tuple[str, dict, dict]]] = {}      # category -> [(slug, player, totals)]
    for slug, rows in real.items():
        roster = [p for p in teams[slug]["offense"] + teams[slug]["defense"] if p.get("slug")]
        for key, t in rows.items():
            cat, last, initial = key.split("|")
            groups, minimum, sample_key = CATEGORIES[cat]
            if cat not in ENABLED_CATEGORIES or t[sample_key] < minimum or t["games"] < MIN_GAMES:
                continue
            cands = [p for p in roster if GROUP.get(p["position"]) in groups and _last(p["name"]) == last]
            if len(cands) > 1:
                cands = [p for p in cands if p["name"].upper().startswith(initial)] or cands
            if not cands:
                continue
            p = cands[0]
            score = _player_score(cat, t)
            if score is None:
                continue
            matched.setdefault(cat, []).append((slug, p, {**t, "score": score}))
    # the league's starters at each group: the rating ladder the real percentile maps onto
    ladder: dict[str, list[float]] = {}
    for s, team in teams.items():
        if team.get("fictional"):
            continue
        for p in team["offense"] + team["defense"]:
            if p.get("in_game"):
                ladder.setdefault(GROUP.get(p["position"], ""), []).append(_overall(p))
    for g in ladder:
        ladder[g].sort()
    out: dict[str, dict[str, dict]] = {}
    for cat, rows in matched.items():
        scores = sorted(r[2]["score"] for r in rows)
        n_all = len(scores)
        if n_all < 8:
            continue
        for slug, p, t in rows:
            group = GROUP.get(p["position"], "")
            rungs = ladder.get(group) or []
            if not rungs:
                continue
            # the real percentile, and the rating a starter at that percentile carries
            below = sum(1 for x in scores if x < t["score"])
            pct = (below + 0.5) / n_all
            target = rungs[min(len(rungs) - 1, int(pct * len(rungs)))]
            gap = target - _overall(p)
            shift = max(-PLAYER_MAX_SHIFT, min(PLAYER_MAX_SHIFT, gap * t["games"] / (t["games"] + PLAYER_K)))
            if abs(shift) < PLAYER_MIN_SHIFT:
                continue
            prev = out.setdefault(slug, {}).get(p["slug"])
            if prev and abs(prev["shift"]) >= abs(shift):
                continue
            rating_pct = int(100 * sum(1 for x in rungs if x < _overall(p)) / len(rungs))
            out[slug][p["slug"]] = {"shift": round(shift, 2), "games": t["games"], "category": cat, "real_pct": round(pct, 3),
                                    "note": f"{_note(cat, t)} in {t['games']} games: {int(pct * 100)}th percentile "
                                            f"against a {rating_pct}th percentile rating"}
    return out


def with_player_form(team: dict, shifts: dict[str, dict] | None) -> dict:
    """A copy of the team with each named player's position ratings moved by his shift."""
    if not shifts:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        rows = []
        for p in team[unit]:
            f = shifts.get(p.get("slug") or "")
            rows.append(_moved(p, PLAYER_ATTRS.get(GROUP.get(p["position"], ""), ()), f["shift"]) if f else p)
        out[unit] = rows
    return out


def adjusted_overall(team: dict, shifts: dict[str, dict] | None) -> float:
    """The team rating after its players' shifts: the starters' mean shift on top of the overall."""
    base = team["team_ratings"]["overall"]
    if not shifts:
        return base
    starters = [p for p in team["offense"] + team["defense"] if p.get("in_game")]
    if not starters:
        return base
    return base + sum(shifts.get(p.get("slug") or "", {}).get("shift", 0.0) for p in starters) / len(starters)


def load_player_form(teams: dict, through_week: int | None = None) -> dict[str, dict[str, dict]]:
    if not GAMES_FILE.exists() or not BOX_DIR.exists():
        return {}
    return fit_player_form(json.loads(GAMES_FILE.read_text(encoding="utf-8")), teams, through_week)


def load_form(teams: dict, through_week: int | None = None, player_form: dict[str, dict[str, dict]] | None = None) -> dict[str, dict]:
    """The team form table from data/season_games.json (empty when there are no results yet)."""
    if not GAMES_FILE.exists():
        return {}
    return fit_form(json.loads(GAMES_FILE.read_text(encoding="utf-8")), teams, through_week, player_form=player_form)


def load_all_form(teams: dict, through_week: int | None = None) -> tuple[dict[str, dict], dict[str, dict[str, dict]]]:
    """(team table, player table). The team fit runs on top of the player shifts only when
    those are applied; otherwise the team fit alone carries the results."""
    players = load_player_form(teams, through_week)
    return load_form(teams, through_week, player_form=players if PLAYER_FORM_APPLIED else None), players


def apply_form(team: dict, team_shift: float, player_shifts: dict[str, dict] | None) -> dict:
    """The team as the sim should see it: the players' own shifts (only when they are switched
    on, see PLAYER_FORM_APPLIED), then the team's."""
    return with_form(with_player_form(team, player_shifts) if PLAYER_FORM_APPLIED else team, team_shift)


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    sys.path.insert(0, str(ROOT))
    import season
    teams = season.load_teams()
    through = int(sys.argv[1]) if len(sys.argv) > 1 else None
    table, players = load_all_form(teams, through)
    flat = [(s, ps, f) for s, d in players.items() for ps, f in d.items()]
    print(f"player form through week {through or 'now'}: {len(flat)} players moved on {sum(len(d) for d in players.values())} lines")
    name_of = {p["slug"]: p for t in teams.values() for p in t["offense"] + t["defense"] if p.get("slug")}
    for item in sorted(flat, key=lambda x: -x[2]["shift"])[:12] + [None] + sorted(flat, key=lambda x: x[2]["shift"])[:12]:
        if item is None:
            print("  ...")
            continue
        s, ps, f = item
        p = name_of[ps]
        print(f"  {p['name']:<24}{p['position']:<4}{teams[s]['name']:<20}{f['shift']:>+6.1f}  {f['note']}")
    ranked = sorted(table.items(), key=lambda kv: -kv[1]["points"])
    print(f"form through week {through or 'now'}: {len(table)} teams with results")
    print(f"{'team':<22}{'games':>6}{'form pts':>10}{'rating':>8}   {'preseason':>9}")
    for s, f in ranked[:15] + [("...", None)] + ranked[-15:]:
        if f is None:
            print("  ...")
            continue
        print(f"{teams[s]['name']:<22}{f['games']:>6}{f['points']:>+10.1f}{f['rating']:>+8.1f}   {teams[s]['team_ratings']['overall']:>9}")

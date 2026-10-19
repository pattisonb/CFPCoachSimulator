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


def fit_form(games: list[dict], teams: dict, through_week: int | None = None, iterations: int = 60) -> dict[str, dict]:
    """slug -> {games, points, rating, record} for every team with a result; points is the
    team's form in margin points, rating the shift the sim applies to its players."""
    rows = _matched(games, teams, through_week)
    rating0 = {s: t["team_ratings"]["overall"] for s, t in teams.items() if not t.get("fictional")}
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


def with_form(team: dict, shift: float) -> dict:
    """A copy of the team with every player's ratings moved by `shift` rating points
    (nothing when the shift rounds to zero)."""
    if abs(shift) < 0.5:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        rows = []
        for p in team[unit]:
            q = dict(p)
            for k in ATTRS:
                v = p.get(k)
                if isinstance(v, (int, float)):
                    q[k] = max(1, min(99, int(round(v + shift))))
            rows.append(q)
        out[unit] = rows
    return out


def load_form(teams: dict, through_week: int | None = None) -> dict[str, dict]:
    """The form table from data/season_games.json (empty when there are no results yet)."""
    if not GAMES_FILE.exists():
        return {}
    return fit_form(json.loads(GAMES_FILE.read_text(encoding="utf-8")), teams, through_week)


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    sys.path.insert(0, str(ROOT))
    import season
    teams = season.load_teams()
    through = int(sys.argv[1]) if len(sys.argv) > 1 else None
    table = load_form(teams, through)
    ranked = sorted(table.items(), key=lambda kv: -kv[1]["points"])
    print(f"form through week {through or 'now'}: {len(table)} teams with results")
    print(f"{'team':<22}{'games':>6}{'form pts':>10}{'rating':>8}   {'preseason':>9}")
    for s, f in ranked[:15] + [("...", None)] + ranked[-15:]:
        if f is None:
            print("  ...")
            continue
        print(f"{teams[s]['name']:<22}{f['games']:>6}{f['points']:>+10.1f}{f['rating']:>+8.1f}   {teams[s]['team_ratings']['overall']:>9}")

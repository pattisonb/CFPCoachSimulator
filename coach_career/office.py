"""The Office's own read (web/office.js, GET /api/season/{id}/office): your program's news over the last
weeks and your conference's latest results with your place in it. Read only: nothing here draws a random
number or writes to the season, so the sim and its golden digests never see it.

`office_view(state)` -> {"news": [...], "conference": {"name", "week", "games": [...], "standing": {...} | None}}.
A news item is a recruiting event about a prospect on your board, one you offered or one who picked you
({week, kind, pid, name, position, stars, rank, school, school_name, rival_name?}), or one of your games
({week, kind: "game", won, points_for, points_against, opponent, opponent_name, venue, overtime}); newest
week first. A conference game is {event_id, week, home, away, home_name, away_name, home_score, away_score,
overtime, mine, conference_game}, from the latest week your conference's teams played.
"""
from __future__ import annotations

from typing import Optional

from coach_career import recruiting
from sim import season

NEWS_ITEMS = 6        # *tune* the most items Program News shows
CONF_GAMES = 4        # *tune* the most results Around the Conference shows
NEWS_WEEKS = 4        # *tune* how many weeks back Program News reaches

# the recruiting events worth a line, the biggest first inside a week
_NEWS_ORDER = ("signed", "pro", "commit", "hard", "flip", "decommit", "bloomed", "offer", "asked_more", "not_buying", "hung_up", "pester", "promise_broken")


def _school_name(slug: Optional[str], teams: dict) -> Optional[str]:
    if not slug:
        return None
    if slug == "FCS":
        return "an FCS program"
    return season.team_display(slug, teams) if slug in teams else slug


def program_news(state: dict) -> list[dict]:
    """Your program's latest news: the recruiting log's events about your prospects and your game results,
    newest week first, at most NEWS_ITEMS."""
    teams = season.load_teams()
    me, week = state["team"], state["current_week"]
    rc = state.get("recruiting") or {}
    mine = set(rc.get("board") or []) | set((rc.get("offers") or {}).get(me, []))
    skip = ("leaning_fcs",) + recruiting.HISTORY_ONLY
    items: list[dict] = []
    for e in rc.get("log") or []:
        if e["week"] <= week - NEWS_WEEKS or e["kind"] in skip or e["kind"] not in _NEWS_ORDER:
            continue
        if not (e.get("school") == me or e.get("from") == me or e["pid"] in mine):
            continue
        if e["kind"] == "offer" and e.get("school") == me:
            continue                     # your own offers are your doing, not news
        p = (rc.get("prospects") or {}).get(e["pid"])
        if not p:
            continue
        item = {"week": e["week"], "kind": e["kind"], "pid": e["pid"], "name": p["name"], "position": p["position"],
                "stars": p["stars"], "rank": p.get("rank"), "school": e.get("school"), "school_name": _school_name(e.get("school"), teams),
                "yours": e.get("school") == me}
        if e.get("rival"):
            item["rival_name"] = _school_name(e["rival"], teams)
        if e.get("action"):
            item["action"] = e["action"]
        if e.get("line"):                    # a bloomer's jump, a two-sport star going pro: the log's own sentence
            item["line"] = e["line"]
        items.append(item)
    for g in state["games"].values():
        if not g.get("played") or me not in (g["home"], g["away"]) or g["week"] <= week - NEWS_WEEKS:
            continue
        home = g["home"] == me
        pf, pa = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
        opp = g["away"] if home else g["home"]
        items.append({"week": g["week"], "kind": "game", "event_id": g["event_id"], "won": pf > pa, "points_for": pf, "points_against": pa,
                      "opponent": opp, "opponent_name": season.team_display(opp, teams),
                      "venue": "neutral" if g.get("neutral") else "home" if home else "away", "overtime": g.get("overtime") or 0})
    # newest week first; inside a week your game, then commitments to you, then the rest by weight
    rank = {k: i for i, k in enumerate(_NEWS_ORDER)}
    items.sort(key=lambda x: (-x["week"], x["kind"] != "game", not x.get("yours"), rank.get(x["kind"], 99)))
    # one line a prospect a week: the biggest
    seen, out = set(), []
    for x in items:
        key = (x["week"], x.get("pid") or x.get("event_id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out[:NEWS_ITEMS]


def conference_view(state: dict) -> dict:
    """Your conference's latest played week (conference games first, at most CONF_GAMES) and your standing row."""
    teams = season.load_teams()
    me = state["team"]
    conf = teams[me]["conference"]
    members = {s for s, t in teams.items() if t["conference"] == conf and not t["fictional"]}
    played = [g for g in state["games"].values() if g.get("played") and (g["home"] in members or g["away"] in members)]
    latest = max((g["week"] for g in played), default=None)
    games = []
    if latest is not None:
        week_games = [g for g in played if g["week"] == latest]
        week_games.sort(key=lambda g: (not g.get("conference_game"), me not in (g["home"], g["away"]), g["event_id"]))
        for g in week_games[:CONF_GAMES]:
            games.append({"event_id": g["event_id"], "week": g["week"], "home": g["home"], "away": g["away"],
                          "home_name": season.team_display(g["home"], teams), "away_name": season.team_display(g["away"], teams),
                          "home_score": g["home_score"], "away_score": g["away_score"], "overtime": g.get("overtime") or 0,
                          "mine": me in (g["home"], g["away"]), "conference_game": bool(g.get("conference_game"))})
    rows = season.standings(state).get(conf) or []
    row = next((r for r in rows if r["slug"] == me), None)
    standing = None
    if row is not None:
        group = [r for r in rows if r.get("division") == row.get("division")]
        standing = {"slug": me, "conf_rank": row["conf_rank"], "of": len(group), "division": row.get("division"),
                    "wins": row["wins"], "losses": row["losses"], "conf_wins": row["conf_wins"], "conf_losses": row["conf_losses"]}
    return {"name": conf, "week": latest, "games": games, "standing": standing,
            "independent": "independent" in conf.lower()}


def office_view(state: dict) -> dict:
    return {"news": program_news(state), "conference": conference_view(state)}

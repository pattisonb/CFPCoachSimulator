"""Around-the-league news while the weeks sim: the few results, poll moves, big games, streaks,
five-star commitments and starting-QB injuries worth a bubble on the page. Read only: the news
is built from the played games, the AP polls, the box scores, the public recruiting log and the
injury lines in the box scores; nothing here draws a random number or writes to the season.

`league_news(state, since_week)` returns the items for the finished weeks after `since_week`,
oldest week first and the most important first inside a week, at most NEWS_PER_WEEK a week.
Each item is {week, kind, text, team?, link?}; `link` is {"type": "game", "event_id"},
{"type": "team", "slug"} or {"type": "recruit", "pid"}. Your own team's items are left out,
except an upset either way.
"""
from __future__ import annotations

from typing import Optional

from sim import season

NEWS_PER_WEEK = 6           # *tune* the most items one week shows
UPSET_CHANCE = 0.19         # *tune* a winner given this chance or less before the game won an upset (about a 14-point underdog)
UPSET_TOP = 10              # *tune* an unranked team beating a team ranked this high or higher is an upset
TOP_N = 5                   # *tune* entering or leaving this top of the AP poll is news
BIG_PASS = 400              # *tune* passing yards in one game that make news
BIG_RUSH = 200              # *tune* rushing yards in one game that make news
BIG_TDS = 5                 # *tune* total touchdowns (pass, rush, catch) by one player in one game
BIG_SACKS = 3               # *tune* sacks by one player in one game
STREAK = 8                  # *tune* a team reaching STREAK-0, or losing its first game after STREAK or more wins
KIND_MAX = {"big_game": 3, "recruiting": 3}   # *tune* the most items of one kind a week (room for the rest)

KINDS = ("upset", "rankings", "big_game", "streak", "recruiting", "injury")

# importance: the score each kind starts from (the item's own details add a little)
_BASE = {"rankings_no1": 95, "upset": 80, "recruiting_flip": 72, "recruiting": 68, "injury": 64, "streak": 60,
         "rankings": 55, "big_game": 45}

_cache: dict[tuple, list[dict]] = {}     # (season id, year, week) -> that week's items, once the week is over


def _name(teams: dict, slug: str) -> str:
    return season.team_display(slug, teams)


def _ap_rank(state: dict, after_week: int) -> dict[str, int]:
    """Team -> AP rank in the poll released after `after_week` (the preseason poll for 0)."""
    p = state["polls"].get(str(after_week)) or {}
    return {e["team"]: e["rank"] for e in p.get("ap", [])}


def _ranked(name: str, rank: Optional[int]) -> str:
    return f"No. {rank} {name}" if rank else name


def _pregame_chance(teams: dict, g: dict, side: str) -> float:
    """The side's chance before the game, from the two teams' overall ratings (the same
    estimate the morale and the bracket projection use)."""
    try:
        edge = (teams[g["home"]]["team_ratings"]["overall"] - teams[g["away"]]["team_ratings"]["overall"]) / 60 \
            + (0.0 if g["neutral"] else 0.04)
    except (KeyError, TypeError):
        return 0.5
    p_home = max(0.05, min(0.95, 0.5 + edge))
    return p_home if side == "home" else 1.0 - p_home


def _score(g: dict, winner_home: bool) -> str:
    hi, lo = (g["home_score"], g["away_score"]) if winner_home else (g["away_score"], g["home_score"])
    return f"{hi}-{lo}" + (" in overtime" if g.get("overtime") else "")


def _upsets(state: dict, teams: dict, fbs: set, week: int, games: list[dict]) -> list[dict]:
    rank = _ap_rank(state, week - 1)
    out = []
    for g in games:
        if g["home"] not in fbs or g["away"] not in fbs:
            continue
        home_won = g["home_score"] > g["away_score"]
        w_side, l_side = ("home", "away") if home_won else ("away", "home")
        w, l = g[w_side], g[l_side]
        wr, lr = rank.get(w), rank.get(l)
        chance = _pregame_chance(teams, g, w_side)
        unranked_over_top = wr is None and lr is not None and lr <= UPSET_TOP
        long_shot = chance <= UPSET_CHANCE and not (wr is not None and lr is not None and wr < lr)
        if not (unranked_over_top or long_shot):
            continue
        wn, ln = _name(teams, w), _name(teams, l)
        lead = f"Unranked {wn}" if wr is None and lr is not None else _ranked(wn, wr)
        text = f"{lead} stuns {_ranked(ln, lr)} {_score(g, home_won)}."
        imp = _BASE["upset"] + (UPSET_TOP + 1 - lr if lr and lr <= UPSET_TOP else 0) + round(10 * (UPSET_CHANCE - min(chance, UPSET_CHANCE)) / UPSET_CHANCE)
        out.append({"kind": "upset", "text": text, "team": w, "teams": (w, l), "link": {"type": "game", "event_id": g["event_id"]}, "_imp": imp})
    return out


def _rankings(state: dict, teams: dict, week: int) -> list[dict]:
    if str(week) not in state["polls"] or not state["polls"][str(week)].get("ap"):
        return []
    before, after = _ap_rank(state, week - 1), _ap_rank(state, week)
    out = []
    new_one = next((t for t, r in after.items() if r == 1), None)
    old_one = next((t for t, r in before.items() if r == 1), None)
    if new_one and old_one and new_one != old_one:
        out.append({"kind": "rankings", "text": f"{_name(teams, new_one)} takes over at No. 1 in the AP poll.", "team": new_one,
                    "teams": (new_one,), "link": {"type": "team", "slug": new_one}, "_imp": _BASE["rankings_no1"]})
    for t, r in sorted(after.items(), key=lambda x: x[1]):
        if r <= TOP_N and t != new_one and (before.get(t) is None or before[t] > TOP_N):
            out.append({"kind": "rankings", "text": f"{_name(teams, t)} moves into the top {TOP_N} at No. {r}.", "team": t,
                        "teams": (t,), "link": {"type": "team", "slug": t}, "_imp": _BASE["rankings"] + TOP_N - r})
    for t, r in sorted(before.items(), key=lambda x: x[1]):
        now = after.get(t)
        if r <= TOP_N and (now is None or now > TOP_N):
            where = f"to No. {now}" if now else "out of the poll"
            out.append({"kind": "rankings", "text": f"{_name(teams, t)} drops out of the top {TOP_N}, {where}.", "team": t,
                        "teams": (t,), "link": {"type": "team", "slug": t}, "_imp": _BASE["rankings"] - 2})
    return out


def _player_side(box: dict, side: str) -> list[dict]:
    return (box.get(side) or {}).get("players") or []


def _big_games(state: dict, teams: dict, fbs: set, games: list[dict], boxes: dict) -> list[dict]:
    out = []
    for g in games:
        box = boxes.get(g["event_id"])
        if box is None or g["home"] not in fbs or g["away"] not in fbs:
            continue                       # FCS stand-ins never make the news, nor stats padded against them
        best = None                        # one line a game: its biggest
        for side, opp in (("home", "away"), ("away", "home")):
            slug, other = g[side], g[opp]
            for p in _player_side(box, side):
                st = p.get("stats") or {}
                tds = int(st.get("passing_touchdowns", 0) + st.get("rushing_touchdowns", 0) + st.get("receiving_touchdowns", 0))
                sacks = st.get("sacks", 0) or 0
                who = f"{_name(teams, slug)} {p['position']} {p['name']}"
                vs = f"against {_name(teams, other)}"
                line = None
                if st.get("pass_yards", 0) >= BIG_PASS:
                    line, extra = f"{who} throws for {st['pass_yards']} yards {vs}.", st["pass_yards"] - BIG_PASS
                elif st.get("rush_yards", 0) >= BIG_RUSH:
                    line, extra = f"{who} runs for {st['rush_yards']} yards {vs}.", st["rush_yards"] - BIG_RUSH
                elif tds >= BIG_TDS:
                    line, extra = f"{who} accounts for {tds} touchdowns {vs}.", 20 * (tds - BIG_TDS)
                elif sacks >= BIG_SACKS:
                    n = int(sacks) if float(sacks).is_integer() else sacks
                    line, extra = f"{who} records {n} sacks {vs}.", 20 * (sacks - BIG_SACKS)
                if line:
                    item = {"kind": "big_game", "text": line, "team": slug, "teams": (slug,),
                            "link": {"type": "game", "event_id": g["event_id"]}, "_imp": _BASE["big_game"] + min(15, round(extra / 10))}
                    if slug != state["team"] and (best is None or item["_imp"] > best["_imp"]):
                        best = item
        if best:
            out.append(best)
    return out


def _streaks(state: dict, teams: dict, fbs: set, week: int, games: list[dict]) -> list[dict]:
    after = season._records(state, week)
    before = season._records(state, week - 1)
    out = []
    for g in games:
        if g["kind"] == "playoff":
            continue
        for side, opp in (("home", "away"), ("away", "home")):
            slug = g[side]
            if slug not in fbs:
                continue
            b, a = before.get(slug), after.get(slug)
            if not a or not b:
                continue
            won = (g["home_score"] > g["away_score"]) == (side == "home")
            if won and a["losses"] == 0 and a["wins"] == STREAK:
                out.append({"kind": "streak", "text": f"{_name(teams, slug)} moves to {STREAK}-0.", "team": slug, "teams": (slug,),
                            "link": {"type": "team", "slug": slug}, "_imp": _BASE["streak"]})
            elif not won and b["losses"] == 0 and b["wins"] >= STREAK:
                hs = _score(g, g["home_score"] > g["away_score"])
                out.append({"kind": "streak", "text": f"Unbeaten {_name(teams, slug)} falls to {a['wins']}-1 with a {hs} loss to {_name(teams, g[opp])}.",
                            "team": slug, "teams": (slug,), "link": {"type": "game", "event_id": g["event_id"]}, "_imp": _BASE["streak"] + 4})
    return out


def _recruiting(state: dict, teams: dict, week: int) -> list[dict]:
    rc = state.get("recruiting")
    if not rc:
        return []
    out = []
    for e in rc.get("log") or []:
        if e.get("week") != week or e.get("kind") not in ("commit", "flip"):
            continue
        p = (rc.get("prospects") or {}).get(e.get("pid"))
        school = e.get("school")
        if not p or p.get("stars") != 5 or not school or school not in teams or teams[school].get("fictional"):
            continue
        who = f"Five-star {p['position']} {p['name']}"
        old = e.get("from")
        if e["kind"] == "flip" and old in teams and not teams[old].get("fictional"):
            text, imp = f"{who} flips from {_name(teams, old)} to {_name(teams, school)}.", _BASE["recruiting_flip"]
        else:
            text, imp = f"{who} commits to {_name(teams, school)}.", _BASE["recruiting"]
        out.append({"kind": "recruiting", "text": text, "team": school, "teams": (), "link": {"type": "recruit", "pid": e["pid"]}, "_imp": imp})
    return out


def _injuries(state: dict, teams: dict, fbs: set, week: int, games: list[dict], boxes: dict) -> list[dict]:
    rank = _ap_rank(state, week - 1)
    out = []
    for g in games:
        box = boxes.get(g["event_id"])
        if box is None:
            continue
        for side in ("home", "away"):
            slug = g[side]
            if slug not in fbs or slug not in rank:
                continue
            starters = {p["name"] for p in _player_side(box, side) if p.get("position") == "QB" and p.get("starter")}
            for inj in (box.get(side) or {}).get("injuries") or []:
                if inj.get("position") != "QB" or inj.get("name") not in starters or (inj.get("weeks") or 0) <= 0:
                    continue
                wk = inj["weeks"]
                span = "for the season" if wk >= 10 else f"for {wk} week{'s' if wk != 1 else ''}"
                kind = f" with a {inj['type']}" if inj.get("type") else ""
                text = f"No. {rank[slug]} {_name(teams, slug)} loses starting QB {inj['name']} {span}{kind}."
                out.append({"kind": "injury", "text": text, "team": slug, "teams": (slug,), "link": {"type": "game", "event_id": g["event_id"]},
                            "_imp": _BASE["injury"] + (26 - rank[slug]) // 5})
    return out


def week_news(state: dict, week: int) -> list[dict]:
    """The items for one finished week, the most important first, at most NEWS_PER_WEEK."""
    key = (state["id"], season.season_year(state), week)
    if key in _cache:
        return _cache[key]
    teams = season.load_teams()
    fbs = season.fbs_only(teams)
    games = [g for g in state["games"].values() if g["week"] == week and g.get("played")]
    boxes = {}
    for g in games:
        if g["home"] in fbs and g["away"] in fbs:
            b = season.load_box(state, g["event_id"])
            if b is not None:
                boxes[g["event_id"]] = b
    items = (_upsets(state, teams, fbs, week, games) + _rankings(state, teams, week) + _big_games(state, teams, fbs, games, boxes)
             + _streaks(state, teams, fbs, week, games) + _recruiting(state, teams, week) + _injuries(state, teams, fbs, week, games, boxes))
    me = state["team"]
    items = [i for i in items if i["kind"] == "upset" or me not in i["teams"]]
    items.sort(key=lambda i: -i["_imp"])                 # stable: the same order every time
    seen, out = set(), []
    for i in items:
        if i["text"] in seen or sum(o["kind"] == i["kind"] for o in out) >= KIND_MAX.get(i["kind"], NEWS_PER_WEEK):
            continue
        seen.add(i["text"])
        item = {"week": week, "kind": i["kind"], "text": i["text"]}
        if i.get("team"):
            item["team"] = i["team"]
        if i.get("link"):
            item["link"] = i["link"]
        out.append(item)
        if len(out) >= NEWS_PER_WEEK:
            break
    _cache[key] = out
    return out


def league_news(state: dict, since_week: int) -> list[dict]:
    """Every finished week's items after `since_week`, oldest week first."""
    out = []
    for w in range(max(0, since_week) + 1, state["current_week"] + 1):
        out.extend(week_news(state, w))
    return out

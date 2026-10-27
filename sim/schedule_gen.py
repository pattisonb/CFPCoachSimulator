"""Schedules for the seasons after 2026 (docs/superpowers/specs/2026-10-26... see
docs/superpowers/specs/2026-10-27-future-schedules-design.md).

`generate(year, teams, history, rng)` builds a season's games the way the conferences do:
protected rivals every year, the other league opponents rotated so every pair meets home
and away within the conference's cycle and never at the same site two years running, league
home games alternating 5/4, non-conference slots filled by tier (a Power team's Power
opponent and its one FCS game, a Group of Five team's Power pay game, FCS game and
home-and-homes), the series schools have announced for the year, annual rivalries with their
finales on Thanksgiving weekend, and Army-Navy on selection weekend. The history (who met whom,
who hosted, which home-and-homes owe a return) lives on the career's league and is seeded from
the 2026 schedule, so 2027 returns the 2026 games' sites.

The rules are data: data/schedule_rules.json (each conference) and data/series.json (annual
series and announced games)."""
from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
RULES_FILE = ROOT / "data" / "schedule_rules.json"
SERIES_FILE = ROOT / "data" / "series.json"

GAMES = 12                    # every FBS team's regular season
LAST_WEEK = 14                # the regular season's Saturdays (season.LAST_REGULAR_WEEK)
FINALE_WEEK = 14              # Thanksgiving weekend: the rivalry finales
ARMY_NAVY_WEEK = 16           # selection weekend (season.SELECTION_WEEK)
NONCONF_WEEKS = (1, 2, 3, 4)  # where non-conference games go first
LATE_FCS_WEEKS = (11, 12, 13)  # a Power team's late FCS tune-up
HISTORY_KEEP = 10             # meetings kept per pair
SECOND_POWER_ROAD = 0.35      # a Group of Five team's chance of a second Power pay game
POWER_FCS_CHANCE = 0.85       # a Power team's chance of using its FCS game
RESTARTS = 60                 # attempts at a league slate or a week grid before giving up on a seed

# the eight fictional FCS stand-ins' states, and which states they serve (teams/fcs_map.json keeps the real schools' map)
REGION_OF_STATE = {
    "ME": "ME", "NH": "ME", "VT": "ME", "MA": "ME", "RI": "ME", "CT": "ME", "NY": "ME", "NJ": "ME",
    "PA": "PA", "MD": "PA", "DE": "PA", "DC": "PA", "VA": "PA", "WV": "PA", "OH": "PA",
    "SC": "SC", "NC": "SC", "GA": "SC", "FL": "SC", "AL": "SC", "TN": "SC", "KY": "SC", "MS": "SC",
    "MI": "MI", "IN": "MI", "IL": "MI", "WI": "MI", "MN": "MI", "IA": "MI", "MO": "MI",
    "NE": "NE", "KS": "NE", "ND": "NE", "SD": "NE", "OK": "NE", "AR": "NE", "LA": "NE",
    "TX": "TX", "NM": "TX",
    "CO": "CO", "UT": "CO", "WY": "CO", "ID": "CO", "MT": "CO", "AZ": "CO", "NV": "CO",
    "WA": "WA", "OR": "WA", "CA": "WA", "HI": "WA", "AK": "WA",
}


class ScheduleError(Exception):
    pass


@lru_cache(maxsize=1)
def rules() -> dict:
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def series() -> dict:
    return json.loads(SERIES_FILE.read_text(encoding="utf-8"))


def pair_key(a: str, b: str) -> str:
    return "|".join(sorted((a, b)))


# ----- history -----------------------------------------------------------------------------------

def seed_history(teams: dict, schedules: Optional[dict] = None) -> dict:
    """A career's scheduling history from the 2026 schedule: every meeting and its host, and
    league home-game counts. `schedules` is data/schedules.json (loaded when not given)."""
    if schedules is None:
        from sim import season
        schedules = json.loads(season.SCHEDULES_FILE.read_text(encoding="utf-8"))
        counterparts = season.fcs_map(schedules, teams)
    else:
        counterparts = {}
    hist = {"pairs": {}, "home_conf": {}, "pending": [], "years": [2026]}
    for g in schedules["games"]:
        home = g.get("home_slug") or counterparts.get(g.get("home_espn"))
        away = g.get("away_slug") or counterparts.get(g.get("away_espn"))
        if not home or not away or home not in teams or away not in teams:
            continue
        _record(hist, 2026, home, away, bool(g.get("neutral")))
        if teams[home]["conference"] == teams[away]["conference"] and not teams[home]["fictional"] and not g.get("neutral"):
            hist["home_conf"].setdefault(home, {})["2026"] = hist["home_conf"].get(home, {}).get("2026", 0) + 1
    return hist


def _record(hist: dict, year: int, home: str, away: str, neutral: bool) -> None:
    met = hist["pairs"].setdefault(pair_key(home, away), [])
    met.append({"year": year, "home": home, "neutral": neutral})
    del met[:-HISTORY_KEEP]


def last_meeting(hist: dict, a: str, b: str) -> Optional[dict]:
    met = hist["pairs"].get(pair_key(a, b))
    return met[-1] if met else None


def _last_year(hist: dict, a: str, b: str) -> int:
    m = last_meeting(hist, a, b)
    return m["year"] if m else 0


def _site_from_history(hist: dict, a: str, b: str, rng: random.Random, deficit=None, year: Optional[int] = None) -> tuple[str, str]:
    """(home, away): the team that travelled last time hosts; a first meeting, or (with `year`) a
    non-conference pair that last met before last year, goes to the team further below its
    home-game target this year (`deficit(team)`), else a coin flip."""
    m = last_meeting(hist, a, b)
    if m and not m.get("neutral") and not (deficit is not None and year is not None and m["year"] < year - 1 and deficit(a) != deficit(b)):
        return (b, a) if m["home"] == a else (a, b)
    if deficit is not None:
        da, db = deficit(a), deficit(b)
        if da != db:
            return (a, b) if da > db else (b, a)
    return (a, b) if rng.random() < 0.5 else (b, a)


# ----- the season ----------------------------------------------------------------------------------

def generate(year: int, teams: dict, history: Optional[dict], rng: random.Random) -> tuple[dict, dict]:
    """The season's games (season.new_season's records, keyed by event id) and the history
    carried forward. Raises ScheduleError when no slate satisfies the rules for this seed."""
    hist = json.loads(json.dumps(history)) if history else seed_history(teams)
    fbs = {s: t for s, t in teams.items() if not t.get("fictional")}
    fcs = [s for s, t in teams.items() if t.get("fictional")]
    conf_of = {s: t["conference"] for s, t in fbs.items()}
    R = rules()
    power_confs = set(R["power"])
    is_power = lambda s: conf_of.get(s) in power_confs or s in R["power_independents"]
    games: list[dict] = []       # {home, away, neutral, week (or None), title, kind: fixed|conf|nonconf|fcs}
    played_pairs: set[str] = set()
    count = {s: 0 for s in fbs}
    nonconf_power = {s: 0 for s in fbs}       # Power opponents on the slate (Notre Dame counts)
    fcs_games = {s: 0 for s in fbs}
    home_total = {s: 0 for s in fbs}
    pending_next: list[dict] = []

    def add(home: str, away: str, neutral: bool = False, week: Optional[int] = None, title: str = "", kind: str = "nonconf",
            site: str = "") -> dict:
        key = pair_key(home, away)
        if key in played_pairs:
            raise ScheduleError(f"{home} and {away} twice in {year}")
        played_pairs.add(key)
        g = {"home": home, "away": away, "neutral": neutral, "week": week, "title": title, "kind": kind, "site": site}
        games.append(g)
        for s in (home, away):
            if s in count:
                count[s] += 1
        if not neutral and home in home_total:
            home_total[home] += 1
        if away in fbs and home in fbs and conf_of[home] != conf_of[away]:
            if is_power(away):
                nonconf_power[home] += 1
            if is_power(home):
                nonconf_power[away] += 1
        if home in fcs or away in fcs:
            fcs_games[away if home in fcs else home] += 1
        return g

    def remove(g: dict) -> None:
        """Undo `add` for a game not yet given a week (a stranded team takes over an FCS date)."""
        games.remove(g)
        played_pairs.discard(pair_key(g["home"], g["away"]))
        for s in (g["home"], g["away"]):
            if s in count:
                count[s] -= 1
        if not g["neutral"] and g["home"] in home_total:
            home_total[g["home"]] -= 1
        if g["home"] in fbs and g["away"] in fbs and conf_of[g["home"]] != conf_of[g["away"]]:
            if is_power(g["away"]):
                nonconf_power[g["home"]] -= 1
            if is_power(g["home"]):
                nonconf_power[g["away"]] -= 1
        if g["home"] in fcs or g["away"] in fcs:
            fcs_games[g["away"] if g["home"] in fcs else g["home"]] -= 1

    # 1. the games already on the books: announced series, returns owed, annual series, Notre Dame's slate
    booked = played_pairs
    league_k = {}
    for conf, members in _by_conference(fbs).items():
        rule = R["conferences"].get(conf)
        for s in members:
            league_k[s] = _league_games(rule, year) if rule else 0
    room = lambda s: count[s] < GAMES - league_k.get(s, 0)       # non-conference room left before the league slate
    _fixed_games(year, fbs, hist, rng, add, is_power, booked, room)
    # 2. every conference's league slate
    for conf, members in _by_conference(fbs).items():
        rule = R["conferences"].get(conf)
        if rule is None:
            continue
        _conference_slate(year, conf, rule, members, hist, rng, add, home_total, booked)
    # 3. non-conference fill by tier
    _nonconference(year, fbs, fcs, hist, rng, add, is_power, count, nonconf_power, fcs_games, home_total, pending_next, teams, booked, games, remove)
    short = [s for s, n in count.items() if n != GAMES]
    if short:
        raise ScheduleError(f"{len(short)} teams without {GAMES} games in {year}: {short[:6]}")
    # 4. weeks
    _assign_weeks(games, fbs, rng)
    # 5. records and history
    out = {}
    for g in games:
        rec = _record_for(g, year, teams, rng)
        out[rec["event_id"]] = rec
        _record(hist, year, g["home"], g["away"], g["neutral"])
    hist["home_conf"] = {s: {**hist["home_conf"].get(s, {}), str(year): n} for s, n in _home_conf_counts(games, conf_of).items()}
    hist["pending"] = pending_next
    hist["home_total"] = {s: {**(hist.get("home_total") or {}).get(s, {}), str(year): n} for s, n in home_total.items()}
    hist["years"] = (hist.get("years") or []) + [year]
    return out, hist


def _by_conference(fbs: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for s, t in fbs.items():
        out.setdefault(t["conference"], []).append(s)
    return {c: sorted(m) for c, m in out.items()}


# ----- fixed games ---------------------------------------------------------------------------------

def _fixed_games(year: int, fbs: dict, hist: dict, rng: random.Random, add, is_power, booked: set, room) -> None:
    S = series()
    for s in S["annual"]:                                 # annual series first: they outrank a new series
        a, b = s["teams"]
        if a not in fbs or b not in fbs:
            continue
        if s.get("first") and year < s["first"] or s.get("last") and year > s["last"]:
            continue
        if pair_key(a, b) in booked or not (room(a) and room(b)):
            continue
        neutral = bool(s.get("neutral"))
        home, away = _site_from_history(hist, a, b, rng) if not neutral else ((a, b) if year % 2 else (b, a))
        week = ARMY_NAVY_WEEK if s.get("week") == 16 else (FINALE_WEEK if s.get("finale") else s.get("week"))
        add(home, away, neutral, week, s.get("name", ""), "fixed")
    for g in hist.get("pending") or []:                  # the return leg of last year's home-and-home
        if g["year"] == year and g["home"] in fbs and g["away"] in fbs and pair_key(g["home"], g["away"]) not in booked \
                and room(g["home"]) and room(g["away"]):
            add(g["home"], g["away"], False, None, g.get("title", ""), "fixed")
    for g in S["announced"]:                              # announced series, while the teams have room for them
        if g["year"] != year or g["home"] not in fbs or g["away"] not in fbs or not (room(g["home"]) and room(g["away"])):
            continue
        if pair_key(g["home"], g["away"]) in booked:
            continue
        add(g["home"], g["away"], bool(g.get("neutral")), g.get("week"), g.get("name", ""), "fixed", g.get("site", ""))
    # Notre Dame: five ACC opponents a year (the annual one plus the four met least recently), Navy and Stanford are annual
    nd = "notre-dame"
    if nd in fbs:
        acc = [s for s, t in fbs.items() if t["conference"] == "ACC"]
        want = rules()["independents"].get(nd, {}).get("acc_games", 5)
        have = {s for s in acc if pair_key(s, nd) in booked}
        pool = sorted((s for s in acc if s not in have and s not in series().get("notre_dame_annual_acc", [])), key=lambda s: (_last_year(hist, nd, s), rng.random()))
        for s in series().get("notre_dame_annual_acc", []):
            if s in fbs and s not in have and room(s) and room(nd):
                home, away = _site_from_history(hist, nd, s, rng)
                add(home, away, False, None, "", "fixed"); have.add(s)
        for s in [q for q in pool if room(q)][:max(0, want - len(have))]:
            if not room(nd):
                break
            home, away = _site_from_history(hist, nd, s, rng)
            add(home, away, False, None, "", "fixed")


# ----- conference slates ---------------------------------------------------------------------------

def _league_games(rule: dict, year: int) -> int:
    n = rule["games"]
    for y, k in (rule.get("games_from") or {}).items():
        if year >= int(y):
            n = k
    return n


def _conference_slate(year: int, conf: str, rule: dict, members: list[str], hist: dict, rng: random.Random, add, home_total: dict,
                      booked: set) -> None:
    k = _league_games(rule, year)
    need = {s: k for s in members}
    eight = (rule.get("eight_game_team") or {}).get(str(year))
    if eight in need:
        need[eight] = k - 1
    if sum(need.values()) % 2:                             # thirteen teams at nine games: someone plays eight, rotating
        odd_one = members[year % len(members)]
        need[odd_one] -= 1
    divisions = rule.get("divisions")
    required: list[tuple[str, str]] = [tuple(p) for p in rule.get("protected", []) if p[0] in need and p[1] in need]
    if rule.get("round_robin"):
        required = [(a, b) for i, a in enumerate(members) for b in members[i + 1:]]
    if divisions:
        for div in divisions.values():
            ms = [s for s in div if s in need]
            required += [(a, b) for i, a in enumerate(ms) for b in ms[i + 1:]]
    # a pair already on the books (Army-Navy, an announced neutral game between members) is outside the league slate
    required = [p for p in dict.fromkeys(tuple(sorted(p)) for p in required) if pair_key(*p) not in booked]
    # pairs at the end of their cycle must meet this year (as many of them as each team's games allow)
    cycle = rule.get("cycle", 4)
    urgent = sorted((tuple(sorted((a, b))) for i, a in enumerate(members) for b in members[i + 1:]
                     if (a, b) not in required and (b, a) not in required and pair_key(a, b) not in booked
                     and not (divisions and _same_division(divisions, a, b)) and 0 < _last_year(hist, a, b) <= year - cycle),
                    key=lambda p: (_last_year(hist, *p), rng.random()))
    left = {s: need[s] - sum(1 for p in required if s in p) for s in members}
    musts = []
    for a, b in urgent:
        if left[a] > 0 and left[b] > 0:
            musts.append((a, b)); left[a] -= 1; left[b] -= 1
    edges = _fill_edges(members, need, required + musts, hist, rng, divisions, rule.get("cross_division"), booked)
    if edges is None:
        edges = _fill_edges(members, need, required, hist, rng, divisions, rule.get("cross_division"), booked)
    if edges is None:
        raise ScheduleError(f"no {conf} slate for {year}")
    # sites: the traveller of the last meeting hosts; then even out league home games toward the target
    target = _home_targets(members, k, year, hist, rule.get("home_split"))
    neutral_pairs = {tuple(sorted(p)) for p in rule.get("neutral", [])}
    hosted = len([e for e in edges if tuple(sorted(e)) not in neutral_pairs])      # home games to share out
    _normalise_targets(target, hosted, members, year, hist, rng)
    home_conf = {s: 0 for s in members}
    sited = []
    for a, b in edges:
        home, away = _site_from_history(hist, a, b, rng)
        sited.append([home, away, bool(last_meeting(hist, a, b))])
        if tuple(sorted((a, b))) not in neutral_pairs:
            home_conf[home] += 1
    flippable = lambda g: tuple(sorted((g[0], g[1]))) not in neutral_pairs and (not g[2] or _last_year(hist, g[0], g[1]) < year - 1)
    for _ in range(8):                                   # a first meeting, or one two years back, can go either way: balance with those
        under = [s for s in members if home_conf[s] < target[s]]
        if not under:
            break
        moved = False
        for g in sited:
            if g[1] in under and home_conf[g[0]] >= target[g[0]] and flippable(g):
                g[0], g[1] = g[1], g[0]
                home_conf[g[0]] += 1; home_conf[g[1]] -= 1
                under = [s for s in members if home_conf[s] < target[s]]
                moved = True
        if not moved:
            break
    finale_pairs = {tuple(sorted(p)) for p in rule.get("finales", [])}
    for home, away, _ in sited:
        key = tuple(sorted((home, away)))
        add(home, away, key in neutral_pairs, FINALE_WEEK if key in finale_pairs else None, "", "conf")


def _normalise_targets(target: dict, hosted: int, members: list, year: int, hist: dict, rng: random.Random) -> None:
    """The targets must add up to the home games there are: trim the teams that hosted most two years
    back (or raise those that hosted least) until they do."""
    two_back = lambda s: (hist.get("home_conf") or {}).get(s, {}).get(str(year - 2), 0)
    diff = sum(target.values()) - hosted
    while diff > 0:
        s = max((m for m in members if target[m] > 0), key=lambda m: (target[m], two_back(m), rng.random()))
        target[s] -= 1; diff -= 1
    while diff < 0:
        s = min(members, key=lambda m: (target[m], two_back(m), rng.random()))
        target[s] += 1; diff += 1


def _same_division(divisions: dict, a: str, b: str) -> bool:
    return any(a in ms and b in ms for ms in divisions.values())


def _home_targets(members: list[str], k: int, year: int, hist: dict, split: Optional[str]) -> dict[str, int]:
    """League home games per team this year: the alternate of last year's count (5 after 4) in a
    nine-game league, half in an eight-game one."""
    out = {}
    for s in members:
        last = (hist.get("home_conf") or {}).get(s, {}).get(str(year - 1))
        if k % 2 == 0:
            out[s] = k // 2
        elif last is not None:
            out[s] = k // 2 if last > k // 2 else k // 2 + 1
        else:
            out[s] = k // 2 + ((members.index(s) + year) % 2)
    return out


def _fill_edges(members: list[str], need: dict[str, int], required: list[tuple[str, str]], hist: dict, rng: random.Random,
                divisions: Optional[dict], cross: Optional[int], booked: set) -> Optional[list[tuple[str, str]]]:
    """A set of pairs giving every member its number of league games: the required pairs, then the
    least recently met pairs, with a repair pass; several randomised attempts."""
    div_of = {}
    if divisions:
        for name, ms in divisions.items():
            for s in ms:
                div_of[s] = name
    cands = []
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            p = (a, b)
            if p in required or pair_key(a, b) in booked:
                continue
            if divisions and div_of.get(a) == div_of.get(b):
                continue                                    # division games are all required
            cands.append(p)
    for attempt in range(RESTARTS):
        left = dict(need)
        edges = []
        ok = True
        for a, b in required:
            left[a] -= 1; left[b] -= 1
            edges.append((a, b))
        if any(v < 0 for v in left.values()):
            return None
        if divisions and cross:
            left = {s: min(v, cross) for s, v in left.items()}
        order = sorted(cands, key=lambda p: (_last_year(hist, *p), rng.random()))
        # a little randomness after the first attempt: shuffle among pairs that met the same year
        if attempt:
            rng.shuffle(order)
            order.sort(key=lambda p: _last_year(hist, *p) + rng.random() * (1 + attempt // 10))
        for a, b in order:
            if left[a] > 0 and left[b] > 0:
                edges.append((a, b)); left[a] -= 1; left[b] -= 1
        short = [s for s, v in left.items() if v > 0]
        if short:
            # repair: for two short teams a and b that already play, find an edge (c, d) to swap so that (a, c) and (b, d) are new legal pairs
            fixed = set(required)
            for _ in range(200):
                short = [s for s, v in left.items() if v > 0]
                if not short:
                    break
                a = rng.choice(short)
                bs = [s for s in short if s != a and (a, s) in cands or (s, a) in cands]
                if bs:
                    b = rng.choice(bs)
                    if (a, b) not in edges and (b, a) not in edges:
                        edges.append((a, b)); left[a] -= 1; left[b] -= 1
                        continue
                done = False
                for c, d in rng.sample(edges, len(edges)):
                    if (c, d) in fixed or a in (c, d):
                        continue
                    for x, y in ((c, d), (d, c)):
                        if _legal(a, x, cands, edges) and left.get(y, 0) >= 0:
                            # replace (c, d) by (a, x); y goes short by one, a's need drops
                            edges.remove((c, d)); edges.append(tuple(sorted((a, x))))
                            left[a] -= 1; left[y] += 1
                            done = True
                            break
                    if done:
                        break
                if not done:
                    break
            short = [s for s, v in left.items() if v > 0]
        if not short and all(v == 0 for v in left.values()):
            return [tuple(p) for p in edges]
    return None


def _legal(a: str, x: str, cands: list, edges: list) -> bool:
    p = tuple(sorted((a, x)))
    return a != x and (p in cands or (p[1], p[0]) in cands) and p not in edges and (p[1], p[0]) not in edges


# ----- non-conference ----------------------------------------------------------------------------

def _nonconference(year: int, fbs: dict, fcs: list[str], hist: dict, rng: random.Random, add, is_power, count: dict,
                   nonconf_power: dict, fcs_games: dict, home_total: dict, pending_next: list, teams: dict, booked: set,
                   games: list, remove) -> None:
    R = rules()
    conf_of = {s: t["conference"] for s, t in fbs.items()}
    rule_of = lambda s: R["conferences"].get(conf_of[s]) or {}
    nc = lambda s: (rule_of(s).get("non_conference") or R["independents"].get(s) or {})
    slots = lambda s: GAMES - count[s]
    recent = lambda a, b: _last_year(hist, a, b) >= year - 1
    # every year a Power team wants seven home games and a Group of Five team six: the non-conference sites
    # lean against the league's 5/4 alternation rather than with it
    last_home = hist.get("home_total") or {}
    target = {s: (7 if is_power(s) else 6) for s in fbs}
    deficit = lambda s: target[s] - home_total[s]

    def power_need(s: str) -> int:
        r = nc(s)
        want = r.get("power_min", 0)
        if (rule_of(s).get("eight_game_team") or {}).get(str(year)) == s:
            want = r.get("power_min_eight_game", want)
        return max(0, want - nonconf_power[s])

    powers = [s for s in fbs if is_power(s)]
    g5 = [s for s in fbs if not is_power(s)]
    # a. Power teams owed a Power opponent pair up across conferences (a home-and-home: the return goes on the books)
    needing = sorted((s for s in powers if power_need(s) > 0 and slots(s) > 0), key=lambda s: rng.random())
    while len(needing) >= 2:
        a = needing.pop()
        partners = [b for b in needing if conf_of[b] != conf_of[a] and pair_key(a, b) not in booked and not recent(a, b)]
        if not partners:
            partners = [b for b in needing if conf_of[b] != conf_of[a]]
        if not partners:
            continue
        b = min(partners, key=lambda s: (_last_year(hist, a, s), rng.random()))
        needing.remove(b)
        home, away = _site_from_history(hist, a, b, rng, deficit, year)
        add(home, away, False, None, "", "nonconf")
        pending_next.append({"year": year + 1, "home": away, "away": home})
    # whoever is still owed a Power opponent books a home-and-home with any Power team that has room
    for a in [s for s in powers if power_need(s) > 0 and slots(s) > 0]:
        partners = [b for b in powers if b != a and slots(b) > 0 and conf_of[b] != conf_of[a] and pair_key(a, b) not in booked]
        if not partners:
            continue
        b = min(partners, key=lambda s: (recent(a, s), -slots(s), _last_year(hist, a, s), rng.random()))
        home, away = _site_from_history(hist, a, b, rng, deficit, year)
        add(home, away, False, None, "", "nonconf")
        pending_next.append({"year": year + 1, "home": away, "away": home})
    # b. Group of Five teams' Power pay games (one, sometimes two), at the Power team's place
    for s in sorted(g5, key=lambda s: (-slots(s), rng.random())):
        lo, hi = nc(s).get("power_road", [1, 2])
        # a second pay game only after a year with six home dates or more (two trips plus a road league year is thin)
        want = lo + (1 if hi > lo and rng.random() < SECOND_POWER_ROAD and (last_home.get(s) or {}).get(str(year - 1), 6) >= 6 else 0)
        for i in range(want):
            if slots(s) <= 0 or (i and slots(s) <= 2 - (1 if fcs_games[s] else 0)):   # a second only with room for the FCS game and a home-and-home
                break
            hosts = [p for p in powers if slots(p) > 0 and not recent(s, p) and pair_key(s, p) not in booked]
            if not hosts:
                break
            # the Power teams with the most room first, among them the closest in the alphabet of history (least recently met)
            p = min(hosts, key=lambda h: (-deficit(h), -slots(h), _last_year(hist, s, h), rng.random()))
            add(p, s, False, None, "", "nonconf")
    # c. FCS games: a home game against the region's stand-in. Every other game fills two slots, so the
    # number of FCS games must have the parity of the slots still open, or one team ends up alone.
    planned = []
    for s in sorted(fbs, key=lambda s: rng.random()):
        cap = nc(s).get("fcs_max", 1)
        if fcs_games[s] >= cap or slots(s) <= 0:
            continue
        if is_power(s) and (deficit(s) <= 0 or rng.random() > POWER_FCS_CHANCE):
            continue
        planned.append(s)
    open_slots = sum(slots(s) for s in fbs)
    if (open_slots - len(planned)) % 2:
        passed = [s for s in fbs if is_power(s) and s not in planned and slots(s) > 0 and fcs_games[s] < nc(s).get("fcs_max", 1)]
        if passed:
            planned.append(rng.choice(passed))             # one more Power team takes its FCS game
        else:
            planned.pop()                                  # or one fewer
    for s in planned:
        add(s, _stand_in(s, teams, fcs, rng), False, None, "", "fcs")
    # d. the rest: home-and-homes between teams with room (Power hosts a Group of Five team for a pay game when it has one slot left)
    for _ in range(GAMES):
        open_ = sorted((s for s in fbs if slots(s) > 0), key=lambda s: (-slots(s), rng.random()))
        if len(open_) < 2:
            break
        before = sum(count.values())
        for a in open_:
            while slots(a) > 0:
                partners = [b for b in open_ if b != a and slots(b) > 0 and conf_of[b] != conf_of[a] and pair_key(a, b) not in booked]
                if not partners:
                    break
                # spread the games: the partner with the most room, least recently met
                b = min(partners, key=lambda s: (-slots(s), recent(a, s), -(deficit(s) if is_power(s) != is_power(a) else 0), _last_year(hist, a, s), rng.random()))
                if is_power(a) != is_power(b):
                    host, guest = (a, b) if is_power(a) else (b, a)
                    add(host, guest, False, None, "", "nonconf")             # a pay game, not returned
                else:
                    home, away = _site_from_history(hist, a, b, rng, deficit, year)
                    add(home, away, False, None, "", "nonconf")
                    pending_next.append({"year": year + 1, "home": away, "away": home})
        if sum(count.values()) == before:
            break
    # e. a team still short (the pool ran dry on it) takes over another team's FCS date: that team plays it
    # instead of the stand-in (a pay game at the Power side, else a home-and-home); failing that, an FCS game of its own
    for s in sorted(fbs, key=lambda s: -slots(s)):
        while slots(s) > 0:
            donors = [g for g in games if g["kind"] == "fcs" and g["home"] != s and conf_of[g["home"]] != conf_of[s]
                      and pair_key(s, g["home"]) not in booked]
            if donors:
                g = min(donors, key=lambda g: (-fcs_games[g["home"]], _last_year(hist, s, g["home"]), rng.random()))
                y = g["home"]
                remove(g)
                if is_power(s) != is_power(y):
                    host, guest = (s, y) if is_power(s) else (y, s)
                    add(host, guest, False, None, "", "nonconf")
                else:
                    home, away = _site_from_history(hist, s, y, rng, deficit, year)
                    add(home, away, False, None, "", "nonconf")
                    pending_next.append({"year": year + 1, "home": away, "away": home})
                continue
            if fcs_games[s] < max(1, nc(s).get("fcs_max", 1)):
                add(s, _stand_in(s, teams, fcs, rng, exclude={g["away"] for g in games if g["home"] == s}), False, None, "", "fcs")
                continue
            raise ScheduleError(f"{s} cannot fill its {year} schedule")


def _stand_in(s: str, teams: dict, fcs: list[str], rng: random.Random, exclude: Optional[set] = None) -> str:
    region = REGION_OF_STATE.get(teams[s].get("state") or "", None)
    pool = [f for f in fcs if f not in (exclude or set())]
    local = [f for f in pool if teams[f].get("state") == region]
    return rng.choice(local or pool)


def _home_conf_counts(games: list[dict], conf_of: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for g in games:
        if g["kind"] == "conf" and not g["neutral"]:
            out[g["home"]] = out.get(g["home"], 0) + 1
    return out


# ----- weeks ---------------------------------------------------------------------------------------

def _assign_weeks(games: list[dict], fbs: dict, rng: random.Random) -> None:
    """A week for every game: fixed weeks first, non-conference games early, conference games from
    week 3, finales in week 14, nobody twice in a week; randomised attempts until it fits."""
    for attempt in range(RESTARTS):
        busy: dict[str, set] = {s: set() for s in fbs}
        for g in games:
            g["_w"] = g["week"]
        ok = True
        fixed = [g for g in games if g["_w"] is not None]
        for g in fixed:
            w = g["_w"]
            if any(w in busy.get(s, set()) for s in (g["home"], g["away"]) if s in busy):
                ok = False
                break
            for s in (g["home"], g["away"]):
                if s in busy:
                    busy[s].add(w)
        if not ok:
            # two games with set weeks clash: the later-listed one (a league finale before a series, a series before an announced game) loses its week
            seen: dict = {}
            order = sorted(fixed, key=lambda g: (0 if g["kind"] == "fixed" and g.get("site") else 1 if g["kind"] == "fixed" else 2))
            for g in order:
                w = g["week"]
                if any((s, w) in seen for s in (g["home"], g["away"])):
                    g["week"] = None
                for s in (g["home"], g["away"]):
                    seen[(s, w)] = True
            continue
        slot: dict = {}                                   # (team, week) -> the game there
        for g in fixed:
            for s in (g["home"], g["away"]):
                slot[(s, g["_w"])] = g
        rest = [g for g in games if g["_w"] is None]
        rng.shuffle(rest)
        rest.sort(key=lambda g: (0 if g["kind"] in ("nonconf", "fixed") else 1 if g["kind"] == "fcs" else 2))

        def place(g, w):
            g["_w"] = w
            for s in (g["home"], g["away"]):
                if s in busy:
                    busy[s].add(w); slot[(s, w)] = g

        def unplace(g):
            for s in (g["home"], g["away"]):
                if s in busy:
                    busy[s].discard(g["_w"]); slot.pop((s, g["_w"]), None)
            g["_w"] = None

        def free_weeks(g):
            return [w for w in _prefs(g) if w not in busy.get(g["home"], set()) and w not in busy.get(g["away"], set())]

        for g in rest:
            prefs = _prefs(g)
            home, away = g["home"], g["away"]
            free = free_weeks(g)
            if not free:
                # repair: a week one side has free and the other spends on a movable game that can go elsewhere
                moved = False
                for w in prefs:
                    for mine, theirs in ((home, away), (away, home)):
                        if w in busy.get(mine, set()) or w not in busy.get(theirs, set()):
                            continue
                        other = slot.get((theirs, w))
                        if other is None or other["week"] is not None:
                            continue                      # a game with a set week stays
                        unplace(other)
                        alt = [w2 for w2 in free_weeks(other) if w2 != w]
                        if alt:
                            place(other, alt[0]); moved = True
                            break
                        place(other, w)
                    if moved:
                        break
                free = free_weeks(g) if moved else []
                if not free:
                    ok = False
                    break
            # spread: prefer the week where the two teams' schedules are emptiest around it (fewer byes in a row)
            w = free[0] if g["kind"] != "conf" else min(free[:6], key=lambda w: (_gap_cost(busy[home], w) + _gap_cost(busy[away], w), rng.random()))
            place(g, w)
        if ok:
            for g in games:
                g["week"] = g["_w"]
                del g["_w"]
            return
    raise ScheduleError("no week grid fits this schedule")


def _prefs(g: dict) -> list:
    """The weeks a game may take, best first: league games from week 3, FCS tune-ups early or late, the rest early."""
    if g["kind"] == "conf":
        return list(range(3, LAST_WEEK + 1)) + [2, 1]
    if g["kind"] == "fcs":
        return list(NONCONF_WEEKS) + list(LATE_FCS_WEEKS) + list(range(5, 11))
    return list(NONCONF_WEEKS) + list(range(5, LAST_WEEK + 1))


def _gap_cost(weeks: set, w: int) -> float:
    """Playing in week w costs little when the weeks beside it are already games (keeps byes apart)."""
    return (0 if w - 1 in weeks else 1) + (0 if w + 1 in weeks else 1)


# ----- records -------------------------------------------------------------------------------------

def _record_for(g: dict, year: int, teams: dict, rng: random.Random) -> dict:
    from sim import season
    home, away = g["home"], g["away"]
    fict_home, fict_away = teams[home].get("fictional"), teams[away].get("fictional")
    shift = 0.0
    if fict_home or fict_away:
        tiers = list(season.FCS_TIER_SHIFT.items())
        shift = rng.choice([v for _, v in tiers] + [0.0, 0.0])
    week = g["week"]
    date = season._saturday(week) if week <= LAST_WEEK else (season.POSTSEASON_DATES.get(week, ("2026-12-12",))[-1] + "T20:00Z")
    rec = {"event_id": f"{year}-{week:02d}-{home}-{away}", "week": week, "date": date, "neutral": bool(g["neutral"]),
           "home": home, "away": away, "fcs_shift": shift,
           "home_display": season.fcs_label(home) if fict_home else teams[home]["name"],
           "away_display": season.fcs_label(away) if fict_away else teams[away]["name"],
           "conference_game": g["kind"] == "conf",
           "played": False, "home_score": None, "away_score": None, "overtime": 0, "real": False, "kind": "regular"}
    if g.get("title"):
        rec["title"] = g["title"]
    if g.get("site"):
        rec["site"] = g["site"]
    return rec

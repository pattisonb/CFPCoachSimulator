"""Tune the rosters to how teams have really played in 2026: depth charts from who plays, and target shares from who
catches the ball. The real season is the cfbstats.com player tables (tools/fetch_team_stats.py writes
data/history/team_players_2026.json): season totals for every player of every FBS team.

Writes data/real_adjustments.json, which build_teams.py applies on top of the source data (cfb_sim_data/ is never
edited; delete the file and rebuild to go back).

    python tools/tune_from_stats.py              # depth charts, target shares, players the rosters lack
    python tools/tune_from_stats.py --dry        # report only: what matches, what would change
    python tools/tune_from_stats.py --approve 8  # ... and apply the proposed rating raises of 8 points or more

Matching: a real player is the roster player of his team with the same name (suffixes and punctuation aside), else the
one with his last name and first initial at a position he could play, else the only one with his last name there.

Depth: within each depth-chart role a team's players are put in order of their real work this season (pass attempts
for quarterbacks, carries for backs, catches and yards for receivers and tight ends, tackles, sacks and interceptions
for defenders, kicks for the specialists). The game starts at week 0 and plays the whole season, so the season's most
used player is the one to start it. Players under a floor keep their order behind the rest, each role keeps its number
of starters, and offensive linemen (no stats) keep theirs. Linebackers also get one order across SAM, MIKE and WILL,
and a real kicker or punter listed at the other spot is moved there.

Target shares: the engine hands out targets from ratings (play_functions._pick_target). Each receiver gets a weight on
top: his real share of his team's catches over his ratings' share, shrunk toward 1 for a small sample and held inside
the engine's cap. The backfield split is not touched: data/observed_tendencies.json holds each team's game-by-game
split, which season totals cannot give.

Ratings are not changed here. A receiver whose real share needs more than the cap is listed as a proposal (route
running and hands), in "proposed" in the file and on the screen, for the player to approve; "ratings" keeps what was
approved before, and --approve N adds the proposals of N points or more to it.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine import game_config as cfg  # noqa: E402

OUT = ROOT / "data" / "real_adjustments.json"
STATS = ROOT / "data" / "history" / "team_players_2026.json"
TEAMS = ROOT / "data" / "engine_teams.json"

# cfbstats team names that are not the game's own
TEAM_ALIAS = {"Miami (FL)": "miami", "Middle Tennessee State": "mtsu", "Sam Houston State": "sam-houston", "Connecticut": "uconn",
              "Massachusetts": "umass", "Hawaii": "hawai-i", "San Jose State": "san-jose-state", "Appalachian State": "app-st",
              "Louisiana-Monroe": "ul-monroe"}
# a cfbstats position: (the game's position for a player added from it, his role, the game's positions he may be listed at)
FRONT, BACK = ("DL", "LOLB", "ROLB", "MLB"), ("CB", "S", "MLB", "ROLB", "LOLB")
EDGE, INSIDE, LB, DB = ("DL", "REDG", FRONT), ("DL", "DT", FRONT), ("MLB", "MIKE", FRONT + ("S",)), ("S", "SS", BACK)
POSITIONS = {"QB": ("QB", "QB", ("QB",)), "RB": ("RB", "HB", ("RB", "WR")), "FB": ("RB", "HB", ("RB", "TE")), "SB": ("RB", "HB", ("RB", "WR")),
             "WR": ("WR", "WR", ("WR", "RB", "TE")), "SLT": ("WR", "WR", ("WR",)), "FL": ("WR", "WR", ("WR",)), "TE": ("TE", "TE", ("TE", "WR")),
             "DL": INSIDE, "DT": INSIDE, "NG": INSIDE, "NT": INSIDE, "DE": EDGE, "EDG": EDGE, "JCK": EDGE, "JK": EDGE, "BAN": EDGE, "RSH": EDGE,
             "ER": EDGE, "VPR": EDGE, "LB": LB, "ILB": LB, "MB": LB, "OLB": ("ROLB", "WILL", FRONT + ("S",)), "STA": LB, "SPR": DB, "NKL": DB,
             "DB": DB, "S": DB, "SAF": DB, "CB": ("CB", "CB", BACK), "NB": ("CB", "CB", BACK), "NI": ("CB", "CB", BACK), "NIC": ("CB", "CB", BACK),
             "K": ("K", "K", ("K", "P")), "PK": ("K", "K", ("K", "P")), "P": ("P", "P", ("P", "K"))}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

MIN_USAGE = {"QB": 33, "HB": 17, "FB": 3, "WR": 10, "TE": 7, "K": 7, "P": 7}   # *tune* a season's work under this does not reorder a role
DEF_MIN_USAGE = 13              # *tune* ... for a defender
TARGET_SHRINK = 30              # *tune* catches at which a receiver's real share counts half
APPROVE_SHARE = 0.5             # *tune* how much of a proposed raise --approve applies. Tried 2026-11-20 on the 27 raises
                                # of 8 or more: all of each, and half, both put receiving yards outside the realism
                                # margin (10% and 12% off against 4% with none), so none is applied
TARGET_FIX_MAX = 85             # *tune* a proposed route running or hands goes no higher than this
ZERO_CATCH_FLOOR = 0.3          # *tune* target weight for a WR/TE high on the depth chart with no real catches
ZERO_CATCH_DEPTH = 2            # ... at this depth or better
ZERO_CATCH_MATCHED = 0.9        # ... and only on a team where this share of the real catches found a roster player
MISSING_MIN_SCORE = 100         # *tune* a real player not on the roster is added once his season scores this much
                                # (pass attempts + 2 x carries + 3 x catches + 2 x tackles + 5 x field-goal tries)
ROLE_USAGE = {
    "QB": lambda s: s.get("pass_attempts", 0) + 0.3 * s.get("carries", 0),
    "HB": lambda s: s.get("carries", 0) + 0.5 * s.get("receptions", 0),
    "FB": lambda s: s.get("carries", 0) + s.get("receptions", 0),
    "WR": lambda s: s.get("receptions", 0) + s.get("receiving_yards", 0) / 12,
    "TE": lambda s: s.get("receptions", 0) + s.get("receiving_yards", 0) / 12,
    "K": lambda s: s.get("fg_attempted", 0) + s.get("pat_attempts", 0),
    "P": lambda s: s.get("punts", 0),
}
DEF_USAGE = lambda s: s.get("tackles", 0) + 3 * s.get("sacks", 0) + 4 * s.get("interceptions", 0)  # noqa: E731
DEF_ROLES = {"LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS"}
LB_ROLES = ("SAM", "MIKE", "WILL")
LB_POOL, SPECIALISTS = "LB_POOL", "SPECIALISTS"
# table -> ((our stat, column index after Name, Yr, Pos, G), ...)
COLUMNS = {"rushing": (("carries", 0), ("rush_yards", 1)), "passing": (("pass_attempts", 0), ("pass_yards", 3)),
           "receiving": (("receptions", 0), ("receiving_yards", 1)), "tackle": (("tackles", 2),), "sack": (("sacks", 0),),
           "interception": (("interceptions", 0),), "kicking": (("fg_attempted", 0), ("pat_attempts", 5)), "punting": (("punts", 0),)}


def num(s: str) -> float:
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def norm(name: str) -> tuple[str, ...]:
    """A name as its words, lower case, punctuation and suffixes dropped."""
    words = re.sub(r"[^a-z ]", "", html.unescape(name).lower().replace("-", " ")).split()
    return tuple(w for w in words if w not in SUFFIXES)


NICKNAME = re.compile(r"[\"“]([^\"”]+)[\"”]")


def names(name: str) -> list[tuple[str, ...]]:
    """The names a real player may be listed under: his own, and with a quoted nickname (Elijah "Bo" Barnes) his name
    without it and the nickname in place of his first name."""
    name = html.unescape(name)
    nick = NICKNAME.search(name)
    if not nick:
        return [norm(name)]
    plain = norm(NICKNAME.sub(" ", name))
    return [plain, norm(nick.group(1)) + plain[1:]]


def real_players(stats: dict, slugs: dict) -> dict[str, list[dict]]:
    """team slug -> its real players: {"name", "pos", "games", "stats": {...}}, a player once across the tables."""
    out: dict[str, list[dict]] = {}
    for team, entry in stats["teams"].items():
        slug = slugs.get(team)
        if not slug:
            continue
        players: dict[tuple, dict] = {}
        for table, cols in COLUMNS.items():
            for r in (entry.get(table) or {}).get("rows", []):
                name = html.unescape(r[0])
                p = players.setdefault(names(name)[0], {"name": name, "pos": r[2], "games": 0, "stats": {}})
                p["games"] = max(p["games"], int(num(r[3])))
                for key, i in cols:
                    p["stats"][key] = p["stats"].get(key, 0) + num(r[4 + i])
        out[slug] = [p for p in players.values() if any(p["stats"].values())]
    return out


def match(real: list[dict], roster: list[dict]) -> dict[str, dict]:
    """roster slug -> the real player's stats, for the real players found on the roster. Each real player is marked
    with the slug he matched ("slug")."""
    found: dict[str, dict] = {}

    def fits(r: dict, p: dict) -> bool:
        return p["position"] in (POSITIONS.get(r["pos"]) or (0, 0, ()))[2]

    def take(r: dict, cands: list[dict]) -> None:
        cands = [p for p in cands if p["slug"] not in found]
        if len(cands) > 1:
            cands = [p for p in cands if fits(r, p)]
        if len(cands) == 1:
            found[cands[0]["slug"]] = r
            r["slug"] = cands[0]["slug"]

    by_name: dict[tuple, list[dict]] = {}
    for p in roster:
        by_name.setdefault(norm(p["name"]), []).append(p)
    for r in real:                                           # the same name
        for n in names(r["name"]):
            if "slug" not in r:
                take(r, by_name.get(n, []))
    for initial in (True, False):                            # the last name (and first initial), at a position he could play
        left = [r for r in real if "slug" not in r and names(r["name"])[0]]
        for r in left:
            n = names(r["name"])[0]
            twins = [q for q in left if (qn := names(q["name"])[0])[-1] == n[-1] and (not initial or qn[0][0] == n[0][0])
                     and (POSITIONS.get(q["pos"]) or (0, 0, ()))[2] == (POSITIONS.get(r["pos"]) or (0, 0, ()))[2]]
            if len(twins) > 1:                               # two real players it could be: neither is guessed
                continue
            take(r, [p for p in roster if (pn := norm(p["name"])) and pn[-1] == n[-1] and (not initial or pn[0][0] == n[0][0]) and fits(r, p)])
    return found


def score(s: dict) -> float:
    return s.get("pass_attempts", 0) + 2 * s.get("carries", 0) + 3 * s.get("receptions", 0) + 2 * s.get("tackles", 0) + 5 * s.get("fg_attempted", 0)


def missing_players(real: dict, teams: dict, before: dict) -> dict:
    """team -> [{"name", "position", "role"}]: real players with a real season's work who are not on the roster
    (build_teams.py adds them with the ratings of the player atop their role). One added `before` keeps the name,
    position and role he was added with."""
    out: dict[str, list[dict]] = {}
    for slug, players in real.items():
        t = teams[slug]
        match(players, [p for p in t["offense"] + t["defense"] if not p.get("added")])
        for r in players:
            if "slug" not in r and r["pos"] in POSITIONS and score(r["stats"]) >= MISSING_MIN_SCORE:
                kept = next((a for a in before.get(slug, []) if norm(a["name"]) in names(r["name"])), None)
                plain = " ".join(NICKNAME.sub(" ", html.unescape(r["name"])).split())
                out.setdefault(slug, []).append(kept or {"name": plain, "position": POSITIONS[r["pos"]][0], "role": POSITIONS[r["pos"]][1]})
            r.pop("slug", None)
    return out


def depth_orders(teams: dict, lines: dict) -> dict:
    """team -> role -> ordered slugs, where the real season changes the order."""
    out = {}
    for slug, use_of in lines.items():
        t = teams[slug]
        by_role: dict[str, list[dict]] = {}
        for p in t["offense"] + t["defense"]:
            if p.get("role"):
                by_role.setdefault(p["role"], []).append(p)
        changes = {}
        for role, plist in by_role.items():
            usage_fn = ROLE_USAGE.get(role) or (DEF_USAGE if role in DEF_ROLES else None)
            if usage_fn is None:
                continue
            plist = sorted(plist, key=lambda p: p.get("depth") or 99)
            use = {p["slug"]: usage_fn(use_of.get(p["slug"], {})) for p in plist}
            floor = MIN_USAGE.get(role, DEF_MIN_USAGE)
            used = sorted((p for p in plist if use[p["slug"]] >= floor), key=lambda p: -use[p["slug"]])
            order = [p["slug"] for p in used + [p for p in plist if use[p["slug"]] < floor]]
            if order != [p["slug"] for p in plist]:
                changes[role] = order
        lbs = sorted((p for r in LB_ROLES for p in by_role.get(r, [])), key=lambda p: p.get("depth") or 99)
        if lbs:                      # linebackers are one pool: a team plays its most-used ones whatever their labels
            use = {p["slug"]: DEF_USAGE(use_of.get(p["slug"], {})) for p in lbs}
            used = sorted((p for p in lbs if use[p["slug"]] >= DEF_MIN_USAGE), key=lambda p: -use[p["slug"]])
            if used:
                changes[LB_POOL] = [p["slug"] for p in used + [p for p in lbs if use[p["slug"]] < DEF_MIN_USAGE]]
        swaps = {}                   # the real kicker kicks even when he is listed as the punter, and the other way round
        specialists = by_role.get("K", []) + by_role.get("P", [])
        for pos in ("K", "P"):
            use = {p["slug"]: ROLE_USAGE[pos](use_of.get(p["slug"], {})) for p in specialists}
            top = max(specialists, key=lambda p: use[p["slug"]], default=None)
            if top and top.get("role") != pos and use[top["slug"]] >= MIN_USAGE[pos]:
                swaps[pos] = top["slug"]
        if swaps and len(set(swaps.values())) == len(swaps):
            changes[SPECIALISTS] = swaps
        if changes:
            out[slug] = changes
    return out


def starter_changes(teams: dict, depth: dict, role: str) -> int:
    """How many teams start a different player at `role` after the reorder."""
    n = 0
    for slug, changes in depth.items():
        if role in changes:
            old = sorted((p for p in teams[slug]["offense"] + teams[slug]["defense"] if p.get("role") == role), key=lambda p: p.get("depth") or 99)
            n += bool(old) and old[0]["slug"] != changes[role][0]
    return n


def target_weight(p: dict) -> float:
    """The engine's target weight for a receiver from his ratings (play_functions._pick_target)."""
    rr, hands, speed = p.get("route_running") or 50, p.get("hands") or 50, p.get("speed") or 50
    w = (max(1.0, (rr + hands) / 2 + speed / 2) / 100) ** cfg.TARGET_WEIGHT_POWER
    return w * (cfg.TE_TARGET_WEIGHT if p["position"] == "TE" else 1.0)


def targets(teams: dict, lines: dict, real: dict) -> tuple[dict, dict]:
    """(team -> {slug: target weight}, team -> {slug: {"route_running": d, "hands": d}} proposed for the receivers the
    cap cannot cover)."""
    out: dict[str, dict] = {}
    proposed: dict[str, dict] = {}
    for slug, use_of in lines.items():
        t = teams[slug]
        rec = [p for p in t["offense"] if p["position"] in ("WR", "TE")]
        caught = {p["slug"]: use_of.get(p["slug"], {}).get("receptions", 0) for p in rec}
        catchers = [p for p in rec if caught[p["slug"]] > 0]
        total = sum(caught.values())
        if total < 15 or len(catchers) < 2:
            continue
        wsum = sum(target_weight(p) for p in catchers)
        mults = {}
        for p in catchers:
            n = caught[p["slug"]]
            m = max(0.3, min(3.0, ((n / total) / (target_weight(p) / wsum)) ** (n / (n + TARGET_SHRINK))))
            if m > cfg.TARGET_MULT_MAX:       # the weight the cap cannot give would have to come from his ratings
                need = target_weight(p) * m / cfg.TARGET_MULT_MAX / (cfg.TE_TARGET_WEIGHT if p["position"] == "TE" else 1.0)
                skill = 100 * need ** (1 / cfg.TARGET_WEIGHT_POWER) - (p.get("speed") or 50) / 2
                rr, hands = p.get("route_running") or 50, p.get("hands") or 50
                d = max(0, min(TARGET_FIX_MAX - min(rr, hands), round(skill - (rr + hands) / 2)))
                if d:
                    proposed.setdefault(slug, {})[p["slug"]] = {"route_running": d, "hands": d}
                m = cfg.TARGET_MULT_MAX
            if abs(m - 1) >= 0.05:
                mults[p["slug"]] = round(m, 3)
        everyone = sum(r["stats"].get("receptions", 0) for r in real[slug] if r["pos"] in ("WR", "TE", "SLT", "FL"))
        if everyone and total / everyone >= ZERO_CATCH_MATCHED:
            for p in rec:            # high on the depth chart and no catch all season: hardly thrown to
                if caught[p["slug"]] == 0 and (p.get("depth") or 99) <= ZERO_CATCH_DEPTH:
                    mults[p["slug"]] = ZERO_CATCH_FLOOR
        if mults:
            out[slug] = mults
    return out, proposed


def build() -> dict:
    subprocess.run([sys.executable, "-m", "teamdata.build_teams"], cwd=ROOT, check=True, capture_output=True)
    return json.loads(TEAMS.read_text(encoding="utf-8"))["teams"]


def lines_for(real: dict, teams: dict) -> tuple[dict, int, int]:
    """(team -> {roster slug: real stats}, real players matched, real players in all)."""
    lines, hit, n = {}, 0, 0
    for slug, players in real.items():
        t = teams[slug]
        found = match(players, t["offense"] + t["defense"])
        lines[slug] = {s: r["stats"] for s, r in found.items()}
        hit += len(found)
        n += len(players)
    return lines, hit, n


def main() -> None:
    dry = "--dry" in sys.argv
    approve = int(sys.argv[sys.argv.index("--approve") + 1]) if "--approve" in sys.argv else None
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    teams = json.loads(TEAMS.read_text(encoding="utf-8"))["teams"]
    slugs = {**{t["name"]: s for s, t in teams.items() if not t["fictional"]}, **TEAM_ALIAS}
    real = real_players(stats, slugs)
    print(f"real season: {len(real)} of {len(stats['teams'])} teams, {sum(len(v) for v in real.values())} players with a stat")
    added = missing_players(real, teams, old.get("added") or {})
    print(f"not on a roster with a season's work: {sum(len(v) for v in added.values())} players on {len(added)} teams")
    if not dry:                      # the depth order is worked out from the source order, with the added players in
        OUT.write_text(json.dumps({"depth": {}, "usage": old.get("usage", {}), "ratings": old.get("ratings", {}), "added": added}), encoding="utf-8")
        teams = build()
    lines, hit, n = lines_for(real, teams)
    print(f"matched to a roster player: {hit} of {n} ({100 * hit / n:.0f}%)")
    for key, label in (("receptions", "catches"), ("carries", "carries"), ("pass_attempts", "pass attempts"), ("tackles", "tackles")):
        have = sum(s.get(key, 0) for v in lines.values() for s in v.values())
        print(f"  {label}: {100 * have / sum(r['stats'].get(key, 0) for v in real.values() for r in v):.1f}% of the real total on a roster player")
    depth = depth_orders(teams, lines)
    print(f"depth: {len(depth)} teams, {sum(len(v) for v in depth.values())} roles reordered; a different starter at QB on "
          f"{starter_changes(teams, depth, 'QB')} teams, HB {starter_changes(teams, depth, 'HB')}, K {starter_changes(teams, depth, 'K')}")
    tgt, proposed = targets(teams, lines, real)
    usage = {s: dict(v) for s, v in (old.get("usage") or {}).items()}
    for s in usage:
        usage[s].pop("targets", None)
    for s, m in tgt.items():
        usage.setdefault(s, {})["targets"] = m
    print(f"target weights: {sum(len(v) for v in tgt.values())} receivers on {len(tgt)} teams; "
          f"{sum(len(v) for v in proposed.values())} receivers the cap cannot cover (proposed, not applied):")
    for s, v in sorted(proposed.items()):
        for ps, d in v.items():
            print(f"  {s} {ps}: route running and hands +{d['route_running']}")
    if dry:
        return
    ratings = {s: {ps: dict(d) for ps, d in v.items()} for s, v in (old.get("ratings") or {}).items()}
    if approve is not None:          # the approved raises go on top of what a player already has, and leave the proposals
        n = 0
        for s in list(proposed):
            for ps in [ps for ps, d in proposed[s].items() if d["route_running"] >= approve]:
                have = ratings.setdefault(s, {}).setdefault(ps, {})
                for attr, d in proposed[s].pop(ps).items():
                    have[attr] = have.get(attr, 0) + round(d * APPROVE_SHARE)
                n += 1
            if not proposed[s]:
                del proposed[s]
        print(f"approved: {n} receivers' route running and hands raised ({approve} points or more)")
    data = {"built_from": f"cfbstats.com season totals, fetched {stats.get('fetched')}", "depth": depth, "usage": usage,
            "ratings": ratings, "proposed": proposed, "added": added}
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    subprocess.run([sys.executable, "-m", "teamdata.build_teams"], cwd=ROOT, check=True)
    print(f"written to {OUT}; build_teams.py applied it")


if __name__ == "__main__":
    main()

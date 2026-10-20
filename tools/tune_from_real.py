"""Tune the rosters to how teams actually play in 2026: depth charts from who plays, and
usage from who gets the ball.

Writes data/real_adjustments.json, which build_teams.py applies on top of the source data
(cfb_sim_data/ is never edited; delete the file and rebuild to go back). Reads the real
season built by realdata.py (data/seasons/real-2026.json and its box scores).

    python tools/tune_from_real.py                 # depth charts and usage from every real game so far
    python tools/tune_from_real.py --through 6     # from our weeks 1-6 only (to test on later weeks)
    python tools/tune_from_real.py depth           # depth charts only (keeps the usage on file)

Depth: within each depth-chart role a team's players are reordered by their real usage
over its last 3 games (pass attempts for quarterbacks, carries for backs, catches and yards
for receivers and tight ends, tackles, sacks and interceptions for defenders, kicks for the
specialists); players with no recent usage keep their order behind them, and each role
keeps its number of starters. Offensive linemen have no box score stats and keep theirs. Linebackers also get one order
across SAM, MIKE and WILL (their starters are chosen from it), and a real kicker or punter
listed at the other specialist spot is moved there.

Usage: the engine hands out carries and targets from ratings (a lead back's share comes
from how much better he rates than the next back; a receiver's targets grow steeply with
his route running, hands and speed). Real coaches do not always agree, so each team gets
the lead-back split it really uses (its share of running back carries mapped to the
engine's committee-to-workhorse scale, measured by simulation) and each receiver a target
weight: his real share of the team's catches over his ratings' share, shrunk toward 1 for
small samples. A receiver whose real share needs more than the engine's target cap gets the
rest as route running and hands (TARGET_RATING_FIX): his card, not his coach, is what is off.
Otherwise ratings are not changed: nudging them toward real efficiency
was tried and made weeks 7-8 worse out of sample (docs/HOW_IT_WORKS.md).
"""
from __future__ import annotations

import json
import statistics as st
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import season  # noqa: E402

OUT = ROOT / "data" / "real_adjustments.json"
RECENT = 3                      # games that decide the depth order
QB_RECENT = 3                   # ... for quarterbacks (99: the season so far)
TARGET_RATING_FIX = True        # a receiver whose real usage needs more than cfg.TARGET_MULT_MAX gets the rest as
                                # route running and hands (his ratings, not the coach, are what is off)
TARGET_FIX_MAX = 85             # ... up to this rating
ZERO_CATCH_FLOOR = 0.3          # target weight for a rostered WR/TE high on the depth chart with no real catches
ZERO_CATCH_DEPTH = 2            # ... at this depth or better
TARGET_GAMES = 4                # games that decide the target weights
THROUGH = 99                    # --through W: use real games through our week W only
ROLE_USAGE = {
    "QB": lambda s: s.get("pass_attempts", 0) + 0.3 * s.get("carries", 0),
    "HB": lambda s: s.get("carries", 0) + 0.5 * s.get("receptions", 0),
    "FB": lambda s: s.get("carries", 0) + s.get("receptions", 0),
    "WR": lambda s: s.get("receptions", 0) + s.get("receiving_yards", 0) / 12,
    "TE": lambda s: s.get("receptions", 0) + s.get("receiving_yards", 0) / 12,
    "K": lambda s: s.get("fg_attempted", 0) + s.get("pat_attempts", 0),
    "P": lambda s: s.get("punts", 0),
}
DEF_USAGE = lambda s: s.get("solo_tackles", 0) + s.get("assisted_tackles", 0) + 3 * s.get("sacks", 0) + 2 * s.get("tackles_for_loss", 0) + 4 * s.get("interceptions", 0)
DEF_ROLES = {"LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS"}
LB_ROLES = ("SAM", "MIKE", "WILL")
LB_POOL = "LB_POOL"             # depth entry: every linebacker by real usage, across the three roles
SPECIALISTS = "SPECIALISTS"     # depth entry: {"K" or "P": slug} for a real kicker or punter listed at the other spot
MIN_USAGE = {"QB": 10, "HB": 5, "FB": 1, "WR": 3, "TE": 2, "K": 2, "P": 2}
FEATURES = [0.0, 0.25, 0.5, 0.75, 1.0]
LEAD_SHRINK = 60                # RB carries at which a team's real lead share counts half
TARGET_SHRINK = 15              # catches at which a receiver's real share counts half


def real_games_by_team(st_real: dict) -> dict[str, list[tuple[int, dict]]]:
    """team -> [(week, {slug: stats})] from the real box scores, in week order."""
    out: dict[str, list] = {}
    for eid, g in st_real["games"].items():
        if not g["played"] or g["week"] > THROUGH:
            continue
        box = season.load_box(st_real, eid)
        if not box or not box.get("real_box"):
            continue
        for side in ("home", "away"):
            lines = {p["slug"]: p["stats"] for p in box[side]["players"] if p.get("slug")}
            out.setdefault(g[side], []).append((g["week"], lines))
    for v in out.values():
        v.sort(key=lambda x: x[0])
    return out


def depth_orders(teams: dict, by_team: dict) -> dict:
    """team -> role -> ordered slugs, where real usage changes the source order."""
    out = {}
    for slug, t in teams.items():
        games = by_team.get(slug)
        if t["fictional"] or not games:
            continue
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
            recent = games[-(QB_RECENT if role == "QB" else RECENT):]
            use = {p["slug"]: sum(usage_fn(lines.get(p["slug"], {})) for _, lines in recent) for p in plist}
            floor = MIN_USAGE.get(role, 4) * len(recent) / RECENT
            used = sorted((p for p in plist if use[p["slug"]] >= floor), key=lambda p: -use[p["slug"]])
            order = [p["slug"] for p in used + [p for p in plist if use[p["slug"]] < floor]]
            if order != [p["slug"] for p in plist]:
                changes[role] = order
        # Linebackers are one pool: a team plays its most-used linebackers whatever their
        # labels (SAM, MIKE, WILL), so its linebacker starters are chosen across the roles.
        recent = games[-RECENT:]
        lbs = sorted((p for r in LB_ROLES for p in by_role.get(r, [])), key=lambda p: p.get("depth") or 99)
        if lbs:
            use = {p["slug"]: sum(DEF_USAGE(lines.get(p["slug"], {})) for _, lines in recent) for p in lbs}
            floor = 4 * len(recent) / RECENT
            used = sorted((p for p in lbs if use[p["slug"]] >= floor), key=lambda p: -use[p["slug"]])
            if used:
                changes[LB_POOL] = [p["slug"] for p in used + [p for p in lbs if use[p["slug"]] < floor]]
        # Kickers and punters: the real kicker kicks even when the source lists him as the
        # punter, and the other way round (one player who does both keeps his listing).
        swaps = {}
        specialists = by_role.get("K", []) + by_role.get("P", [])
        for pos in ("K", "P"):
            use = {p["slug"]: sum(ROLE_USAGE[pos](lines.get(p["slug"], {})) for _, lines in recent) for p in specialists}
            top = max(specialists, key=lambda p: use[p["slug"]], default=None)
            if top and top.get("role") != pos and use[top["slug"]] >= MIN_USAGE[pos] * len(recent) / RECENT:
                swaps[pos] = top["slug"]
        if len(set(swaps.values())) == len(swaps) and swaps:
            changes[SPECIALISTS] = swaps
        if changes:
            out[slug] = changes
    return out


def starter_changes(teams: dict, depth: dict, role: str) -> int:
    """How many teams start a different player at `role` after the reorder."""
    n = 0
    for slug, changes in depth.items():
        if role not in changes:
            continue
        old = sorted((p for p in teams[slug]["offense"] + teams[slug]["defense"] if p.get("role") == role), key=lambda p: p.get("depth") or 99)
        n += bool(old) and old[0]["slug"] != changes[role][0]
    return n


# ----- usage ----------------------------------------------------------------------------

_TEAMS: dict = {}


def _init(teams: dict) -> None:
    global _TEAMS
    _TEAMS = teams


def _lead_share_sim(args) -> list[float]:
    """Lead back's share of running back carries in a game simulated with a forced feature."""
    from engine.game import simulate_game
    home, away, feature, seed = args
    shares = []
    teams = {}
    for slug in (home, away):
        t = dict(_TEAMS[slug])
        t["tendencies"] = {**t.get("tendencies", {}), "rb_lead_feature": feature}
        teams[slug] = t
    g = simulate_game(teams[home], teams[away], seed=seed)
    for side, slug in (("home", home), ("away", away)):
        lead = next((p for p in _TEAMS[slug]["offense"] if p.get("role") == "HB" and p.get("depth") == 1), None)
        rbs = [p for p in g[side]["players"] if p["position"] == "RB"]
        total = sum(p["stats"].get("carries", 0) for p in rbs)
        if lead and total >= 10:
            mine = sum(p["stats"].get("carries", 0) for p in rbs if p["name"] == lead["name"])
            shares.append(mine / total)
    return shares


def feature_curve(teams: dict, games: list[dict]) -> list[tuple[float, float]]:
    """(feature, average lead-back share) measured by simulation over a sample of real games."""
    sample = games[::2][:120]
    curve = []
    with Pool(initializer=_init, initargs=(teams,)) as pool:
        for f in FEATURES:
            jobs = [(g["home"], g["away"], f, 700_000 + i) for i, g in enumerate(sample)]
            shares = [s for res in pool.imap_unordered(_lead_share_sim, jobs, chunksize=4) for s in res]
            curve.append((f, st.mean(shares)))
            print(f"  lead-back feature {f:.2f}: {100 * curve[-1][1]:.1f}% of running back carries")
    return curve


def invert(curve: list[tuple[float, float]], share: float) -> float:
    """The feature that gives this lead-back share (linear between the measured points)."""
    pts = sorted(curve, key=lambda c: c[1])
    if share <= pts[0][1]:
        return pts[0][0]
    if share >= pts[-1][1]:
        return pts[-1][0]
    for (f0, s0), (f1, s1) in zip(pts, pts[1:]):
        if s0 <= share <= s1:
            return round(f0 + (f1 - f0) * (share - s0) / max(1e-9, s1 - s0), 3)
    return 0.5


def target_weight(p: dict) -> float:
    """The engine's target weight for a receiver from his ratings (play_functions._pick_target)."""
    from engine import game_config as cfg
    rr, hands, speed = p.get("route_running") or 50, p.get("hands") or 50, p.get("speed") or 50
    w = (max(1.0, (rr + hands) / 2 + speed / 2) / 100) ** cfg.TARGET_WEIGHT_POWER
    return w * (cfg.TE_TARGET_WEIGHT if p["position"] == "TE" else 1.0)


def usage(teams: dict, by_team: dict, games: list[dict], ratings: dict | None = None) -> dict:
    """team -> {"rb_lead_feature": f, "targets": {slug: multiplier}}. With `ratings`, receivers
    whose real usage needs more than the engine's target cap get the rest as a rating fix
    there: team -> {slug: {"route_running": d, "hands": d}}."""
    from engine import game_config as cfg
    curve = feature_curve(teams, games)
    real_lead = {}
    for slug, t in teams.items():
        lead = next((p for p in t["offense"] if p.get("role") == "HB" and p.get("depth") == 1), None)
        rbs = [p for p in t["offense"] if p["position"] == "RB"]
        if not lead or not by_team.get(slug):
            continue
        carries = {p["slug"]: sum(lines.get(p["slug"], {}).get("carries", 0) for _, lines in by_team[slug]) for p in rbs}
        total = sum(carries.values())
        if total >= 20:
            real_lead[slug] = (carries[lead["slug"]] / total, total)
    league = st.median(s for s, _ in real_lead.values())
    out: dict[str, dict] = {}
    for slug, (share, n) in real_lead.items():
        w = n / (n + LEAD_SHRINK)
        out.setdefault(slug, {})["rb_lead_feature"] = invert(curve, w * share + (1 - w) * league)
    for slug, t in teams.items():
        games_t = (by_team.get(slug) or [])[-TARGET_GAMES:]
        if not games_t:
            continue
        rec = [p for p in t["offense"] if p["position"] in ("WR", "TE")]
        caught = {p["slug"]: sum(lines.get(p["slug"], {}).get("receptions", 0) for _, lines in games_t) for p in rec}
        catchers = [p for p in rec if caught[p["slug"]] > 0]
        total = sum(caught[p["slug"]] for p in catchers)
        if total < 15 or len(catchers) < 2:
            continue
        wsum = sum(target_weight(p) for p in catchers)
        mults = {}
        for p in catchers:
            real_share = caught[p["slug"]] / total
            model_share = target_weight(p) / wsum
            k = caught[p["slug"]] / (caught[p["slug"]] + TARGET_SHRINK)
            m = max(0.3, min(3.0, (real_share / model_share) ** k))
            if TARGET_RATING_FIX and ratings is not None and m > cfg.TARGET_MULT_MAX:
                # the weight the capped multiplier cannot give comes from route running and hands
                need = target_weight(p) * m / cfg.TARGET_MULT_MAX / (cfg.TE_TARGET_WEIGHT if p["position"] == "TE" else 1.0)
                skill = 100 * need ** (1 / cfg.TARGET_WEIGHT_POWER) - (p.get("speed") or 50) / 2
                rr, hands = p.get("route_running") or 50, p.get("hands") or 50
                d = max(0, min(TARGET_FIX_MAX - min(rr, hands), round(skill - (rr + hands) / 2)))
                if d:
                    ratings.setdefault(slug, {})[p["slug"]] = {"route_running": d, "hands": d}
                m = cfg.TARGET_MULT_MAX
            if abs(m - 1) >= 0.05:
                mults[p["slug"]] = round(m, 3)
        # a receiver high on the depth chart who has not caught a ball (hurt, or not really
        # a receiver in this offense) is hardly thrown to
        for p in rec:
            if caught[p["slug"]] == 0 and (p.get("depth") or 99) <= ZERO_CATCH_DEPTH:
                mults[p["slug"]] = ZERO_CATCH_FLOOR
        if mults:
            out.setdefault(slug, {})["targets"] = mults
    return out


def build() -> None:
    subprocess.run([sys.executable, str(ROOT / "build_teams.py")], cwd=ROOT, check=True, capture_output=True)
    season._teams_cache.clear()


def main() -> None:
    global THROUGH
    args = list(sys.argv[1:])
    if "--through" in args:
        k = args.index("--through")
        THROUGH = int(args[k + 1])
        del args[k:k + 2]
    mode = args[0] if args else "all"
    st_real = season.load_season("real-2026")
    if st_real is None:
        raise SystemExit("build the real season first: python realdata.py")
    # depth mode keeps the usage already on file (lead-back splits and target weights)
    old = json.loads(OUT.read_text(encoding="utf-8")) if mode == "depth" and OUT.exists() else {}
    old_usage, old_ratings = old.get("usage", {}), old.get("ratings", {})
    OUT.write_text(json.dumps({"depth": {}, "usage": {}}), encoding="utf-8")
    build()
    teams = season.load_teams()
    by_team = real_games_by_team(st_real)
    depth = depth_orders(teams, by_team)
    print(f"depth: {len(depth)} teams, {sum(len(v) for v in depth.values())} roles reordered; a different starter at QB on "
          f"{starter_changes(teams, depth, 'QB')} teams, HB {starter_changes(teams, depth, 'HB')}, K {starter_changes(teams, depth, 'K')}")
    data = {"built_from": f"real season through week {min(THROUGH, st_real['current_week'])}", "depth": depth, "usage": old_usage,
            "ratings": old_ratings}
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    if mode == "all":
        build()
        teams = season.load_teams()
        games = [g for g in st_real["games"].values() if g["played"] and g["week"] <= THROUGH and season.has_box(st_real, g)
                 and not teams[g["home"]]["fictional"] and not teams[g["away"]]["fictional"]]
        data["ratings"] = {}
        data["usage"] = usage(teams, by_team, games, data["ratings"])
        n_lead = sum(1 for v in data["usage"].values() if "rb_lead_feature" in v)
        n_tgt = sum(len(v.get("targets", {})) for v in data["usage"].values())
        n_fix = sum(len(v) for v in data["ratings"].values())
        print(f"usage: real lead-back split for {n_lead} teams, target weights for {n_tgt} receivers; "
              f"route running and hands raised for {n_fix} receivers the target cap could not cover")
        OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    subprocess.run([sys.executable, str(ROOT / "build_teams.py")], cwd=ROOT, check=True)
    print(f"written to {OUT}; build_teams.py applied it")


if __name__ == "__main__":
    main()

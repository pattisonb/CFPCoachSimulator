"""Ability goals (Clear Mode; the player's ask): every player always works toward one ability that fits his position, a
plain goal per tier ("Breakaway Speed (Bronze): 3 runs of 20+ yards"). Progress lands after every game; reaching the goal
unlocks the ability (or its next tier) mid-season, and the engine uses it from the next game on. One goal at a time: the
next is the same ability's next tier, or once it is Platinum, another that fits.

Three kinds of goal:
- "season": a running total of one of his stats since the goal began (it carries across seasons),
- "game": games with at least `per` of a stat (a big game),
- "moment": big moments, counted by the game itself (sim.season._moments): a go-ahead or tying score in the fourth
  quarter or overtime (`clutch_score`), a made kick then (`clutch_kick`), a sack, interception or forced fumble then
  while protecting a one-score lead (`clutch_stop`), a game started at home (`home_start`) or on the road (`road_start`).

State: state["ability_goals"][team][player key "Name|POS"] = {"trait", "tier", "have", "since": [year, week]};
state["abilities_earned"][team][key] = {trait: tier} (merged into the game's team, and into the league's rosters at the
offseason); state["ability_events"]: [{week, year, team, player, position, trait, name, tier, how}] (the news reads them).
"""
from __future__ import annotations

from typing import Optional

TIER_NAMES = {1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum"}

# trait -> (kind, metric, needs by tier [Bronze, Silver, Gold, Platinum], per-game threshold or None, the goal in words
# with {n} its count). Positions are the engine's groups a trait suits (season.SCALE_GROUP).
GOALS = {
    # quarterbacks
    "pinpoint": ("game", "completions", (2, 3, 4, 5), 25, "{n} game{s} with 25+ completions"),
    "timing_passer": ("season", "completions", (80, 160, 240, 320), None, "{n} completions"),
    "unflappable": ("season", "passing_touchdowns", (6, 12, 18, 24), None, "{n} touchdown passes"),
    "accurate_on_the_run": ("season", "pass_yards", (800, 1600, 2400, 3200), None, "{n} passing yards"),
    "poised_on_the_run": ("season", "pass_yards", (800, 1600, 2400, 3200), None, "{n} passing yards"),
    "off_platform": ("season", "pass_yards", (800, 1600, 2400, 3200), None, "{n} passing yards"),
    "steps_up": ("season", "passing_first_downs", (40, 80, 120, 160), None, "{n} passing first downs"),
    "escape_artist": ("season", "passing_first_downs", (40, 80, 120, 160), None, "{n} passing first downs"),
    "play_extender": ("season", "passing_first_downs", (40, 80, 120, 160), None, "{n} passing first downs"),
    "ball_handler": ("season", "passing_first_downs", (40, 80, 120, 160), None, "{n} passing first downs"),
    "option_maestro": ("season", "rush_yards", (100, 250, 400, 600), None, "{n} rushing yards"),
    "tuck_and_run": ("season", "rush_yards", (100, 250, 400, 600), None, "{n} rushing yards"),
    "coach_on_the_field": ("moment", "clutch_score", (1, 2, 4, 6), None, "{n} go-ahead or tying score{s} late"),
    # backs
    "breakaway_speed": ("season", "explosive_runs", (4, 8, 12, 16), None, "{n} runs of 20+ yards"),
    "quick_feet": ("season", "rush_yards", (250, 500, 800, 1100), None, "{n} rushing yards"),
    "spin_artist": ("season", "rush_yards", (250, 500, 800, 1100), None, "{n} rushing yards"),
    "slippery": ("season", "rush_yards", (250, 500, 800, 1100), None, "{n} rushing yards"),
    "stiff_arm_specialist": ("season", "rush_yards", (250, 500, 800, 1100), None, "{n} rushing yards"),
    "balance": ("season", "rush_yards", (250, 500, 800, 1100), None, "{n} rushing yards"),
    "tough_runner": ("season", "rushing_first_downs", (15, 30, 45, 60), None, "{n} rushing first downs"),
    "downhill_runner": ("season", "rushing_touchdowns", (3, 6, 9, 13), None, "{n} rushing touchdowns"),
    "bulldozer": ("season", "rushing_touchdowns", (3, 6, 9, 13), None, "{n} rushing touchdowns"),
    "extra_effort": ("season", "rushing_first_downs", (15, 30, 45, 60), None, "{n} rushing first downs"),
    "ball_protector": ("season", "carries", (60, 120, 180, 240), None, "{n} carries"),
    "lead_back": ("season", "key_blocks", (5, 10, 15, 20), None, "{n} key blocks"),
    # receivers
    "glue_hands": ("season", "receptions", (20, 40, 60, 80), None, "{n} catches"),
    "checkdown_target": ("season", "receptions", (20, 40, 60, 80), None, "{n} catches"),
    "qbs_favorite": ("season", "receptions", (20, 40, 60, 80), None, "{n} catches"),
    "jump_ball_winner": ("season", "receiving_touchdowns", (2, 4, 6, 9), None, "{n} touchdown catches"),
    "double_move": ("season", "explosive_catches", (4, 8, 12, 16), None, "{n} catches of 20+ yards"),
    "sharp_cutter": ("season", "receiving_first_downs", (10, 20, 30, 40), None, "{n} receiving first downs"),
    "press_beater": ("game", "receiving_yards", (1, 2, 3, 4), 100, "{n} game{s} with 100+ receiving yards"),
    # the line
    "road_grader": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "edge_sealer": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "second_level_blocker": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "vise_grip": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "option_blocker": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "screen_blocker": ("season", "key_blocks", (10, 20, 30, 45), None, "{n} key blocks"),
    "grinder": ("season", "snaps", (500, 800, 1100, 1400), None, "{n} snaps"),
    "line_leader": ("season", "snaps", (500, 800, 1100, 1400), None, "{n} snaps"),
    "pocket_protector": ("season", "clean_start", (4, 7, 10, 13), None, "{n} clean starts (no sacks, a pressure at most)"),
    "quick_set": ("season", "clean_start", (4, 7, 10, 13), None, "{n} clean starts (no sacks, a pressure at most)"),
    "quick_pass_set": ("season", "clean_start", (4, 7, 10, 13), None, "{n} clean starts (no sacks, a pressure at most)"),
    "interior_wall": ("season", "clean_start", (4, 7, 10, 13), None, "{n} clean starts (no sacks, a pressure at most)"),
    "play_action_protector": ("season", "clean_start", (4, 7, 10, 13), None, "{n} clean starts (no sacks, a pressure at most)"),
    # the front and the back seven
    "pocket_collapser": ("season", "sacks", (3, 5, 8, 11), None, "{n} sacks"),
    "edge_bender": ("season", "sacks", (3, 5, 8, 11), None, "{n} sacks"),
    "gap_penetrator": ("season", "tackles_for_loss", (4, 7, 10, 14), None, "{n} tackles for loss"),
    "pressure_player": ("season", "hurries", (5, 10, 16, 22), None, "{n} hurries"),
    "finisher": ("game", "sacks", (1, 2, 3, 4), 2, "{n} game{s} with 2+ sacks"),
    "jump_the_snap": ("season", "tackles_for_loss", (4, 7, 10, 14), None, "{n} tackles for loss"),
    "option_killer": ("season", "tackles_for_loss", (4, 7, 10, 14), None, "{n} tackles for loss"),
    "sure_tackler": ("season", "solo_tackles", (25, 45, 65, 85), None, "{n} solo tackles"),
    "pack_tackler": ("season", "solo_tackles", (25, 45, 65, 85), None, "{n} solo tackles"),
    "edge_setter": ("season", "solo_tackles", (25, 45, 65, 85), None, "{n} solo tackles"),
    "hand_fighter": ("season", "solo_tackles", (25, 45, 65, 85), None, "{n} solo tackles"),
    "block_buster": ("season", "solo_tackles", (25, 45, 65, 85), None, "{n} solo tackles"),
    "heavy_hitter": ("season", "forced_fumbles", (2, 3, 4, 5), None, "{n} forced fumbles"),
    "jarring_hits": ("season", "forced_fumbles", (2, 3, 4, 5), None, "{n} forced fumbles"),
    "ball_jarrer": ("season", "forced_fumbles", (2, 3, 4, 5), None, "{n} forced fumbles"),
    "defensive_leader": ("moment", "clutch_stop", (1, 2, 4, 6), None, "{n} big stop{s} late in a close game"),
    "turnover_magnet": ("season", "interceptions", (2, 4, 6, 8), None, "{n} interceptions"),
    "pick_six": ("season", "interceptions", (2, 4, 6, 8), None, "{n} interceptions"),
    "route_jumper": ("season", "interceptions", (2, 4, 6, 8), None, "{n} interceptions"),
    "shadow": ("season", "passes_defended", (5, 10, 15, 20), None, "{n} passes defended"),
    "jam_artist": ("season", "passes_defended", (5, 10, 15, 20), None, "{n} passes defended"),
    "diving_breakup": ("season", "passes_defended", (5, 10, 15, 20), None, "{n} passes defended"),
    # kickers and punters
    "automatic": ("season", "fg_short_made", (5, 10, 15, 20), None, "{n} field goals under 40 yards"),
    "long_range": ("season", "fg_50_made", (1, 2, 3, 5), None, "{n} field goal{s} of 50+ yards"),
    "cannon_leg": ("season", "punt_yards", (1200, 2400, 3600, 4800), None, "{n} punting yards"),
    "pin_artist": ("season", "punts_inside_20", (5, 10, 15, 22), None, "{n} punts inside the 20"),
    "ice_water": ("moment", "clutch_kick", (1, 2, 3, 5), None, "{n} clutch kick{s} made"),
    "clutch_leg": ("moment", "clutch_kick", (1, 2, 3, 5), None, "{n} clutch kick{s} made"),
    # anyone
    "closer": ("moment", "clutch_score", (1, 2, 4, 6), None, "{n} go-ahead or tying score{s} late"),
    "iron_horse": ("season", "snaps", (500, 800, 1100, 1400), None, "{n} snaps"),
    "quick_recovery": ("season", "snaps", (500, 800, 1100, 1400), None, "{n} snaps"),
    "crowd_favorite": ("moment", "home_start", (2, 4, 6, 8), None, "{n} starts at home"),
    "road_warrior": ("moment", "road_start", (2, 4, 6, 8), None, "{n} starts on the road"),
    "natural_talent": ("season", "games_started", (4, 8, 12, 16), None, "{n} starts"),
}

# which goals suit each engine position group, most fitting first (the first he does not hold at Platinum is his goal)
FITS = {
    "QB": ("pinpoint", "timing_passer", "unflappable", "steps_up", "accurate_on_the_run", "coach_on_the_field", "escape_artist",
           "play_extender", "ball_handler", "off_platform", "poised_on_the_run", "tuck_and_run", "option_maestro", "closer", "iron_horse"),
    "RB": ("breakaway_speed", "quick_feet", "spin_artist", "tough_runner", "bulldozer", "downhill_runner", "slippery", "balance",
           "stiff_arm_specialist", "extra_effort", "ball_protector", "checkdown_target", "closer", "iron_horse"),
    "FB": ("lead_back", "bulldozer", "tough_runner", "extra_effort", "iron_horse"),
    "WR": ("double_move", "glue_hands", "sharp_cutter", "jump_ball_winner", "press_beater", "qbs_favorite", "breakaway_speed", "closer", "iron_horse"),
    "TE": ("glue_hands", "checkdown_target", "jump_ball_winner", "screen_blocker", "qbs_favorite", "closer", "iron_horse"),
    "OL": ("road_grader", "pocket_protector", "edge_sealer", "quick_set", "second_level_blocker", "interior_wall", "vise_grip",
           "quick_pass_set", "play_action_protector", "grinder", "line_leader", "option_blocker", "screen_blocker", "iron_horse"),
    "DL": ("pocket_collapser", "edge_bender", "gap_penetrator", "pressure_player", "finisher", "hand_fighter", "edge_setter",
           "jump_the_snap", "block_buster", "defensive_leader", "iron_horse"),
    "LB": ("sure_tackler", "pack_tackler", "pressure_player", "option_killer", "heavy_hitter", "route_jumper", "block_buster",
           "defensive_leader", "edge_setter", "iron_horse"),
    "CB": ("shadow", "jam_artist", "turnover_magnet", "diving_breakup", "pick_six", "route_jumper", "defensive_leader", "iron_horse"),
    "S": ("route_jumper", "turnover_magnet", "sure_tackler", "heavy_hitter", "diving_breakup", "pick_six", "defensive_leader", "iron_horse"),
    "K": ("automatic", "long_range", "ice_water", "clutch_leg"),
    "P": ("pin_artist", "cannon_leg"),
}

# the engine's positions to their groups (the card's groups)
POS_GROUP = {"QB": "QB", "RB": "RB", "HB": "RB", "FB": "FB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL",
             "RT": "OL", "OL": "OL", "OT": "OL", "IOL": "OL", "DE": "DL", "DT": "DL", "LEDG": "DL", "REDG": "DL", "DL": "DL", "EDGE": "DL",
             "MLB": "LB", "LOLB": "LB", "ROLB": "LB", "LB": "LB", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S",
             "SS": "S", "S": "S", "K": "K", "P": "P"}


def on() -> bool:
    from coach_career import clear
    return clear.on()


def _held(state: dict, team: str, key: str, base: dict) -> dict:
    """{trait: tier} he holds: the roster's own (base) and what he has earned since."""
    earned = ((state.get("abilities_earned") or {}).get(team) or {}).get(key) or {}
    out = dict(base)
    for k, t in earned.items():
        out[k] = max(out.get(k, 0), t)
    return out


def next_goal(position: str, held: dict, key: str = "") -> Optional[tuple[str, int]]:
    """(trait, tier) he works toward, at the tier after his own: of the goals that suit his position and that he does not
    hold at Platinum, a seeded draw for him (`key`, and how many he holds, so each next goal is its own) that favors the
    list's first (weights 1/(1+i)) and an ability he already holds (x2), so goals spread over every ability, the mental
    ones too. None for a position with none."""
    import random
    fits = [t for t in FITS.get(POS_GROUP.get(position, position), ()) if t in GOALS and held.get(t, 0) < 4]
    if not fits:
        return None
    weights = [(2.0 if held.get(t, 0) else 1.0) / (1 + i) for i, t in enumerate(fits)]
    trait = random.Random(f"goal-{key}-{sum(held.values())}").choices(fits, weights=weights, k=1)[0]
    return trait, held.get(trait, 0) + 1


def goal_view(state: dict, team: str, key: str, position: str, base: dict) -> Optional[dict]:
    """His goal as the page shows it: {trait, name, tier, tier_name, have, need, text}; None without one."""
    from teamdata import ratings as rv2
    g = ((state.get("ability_goals") or {}).get(team) or {}).get(key)
    if not g:
        held = _held(state, team, key, base)
        nxt = next_goal(position, held, key)
        if not nxt:
            return None
        g = {"trait": nxt[0], "tier": nxt[1], "have": 0}
    kind, metric, needs, per, words = GOALS[g["trait"]]
    need = needs[g["tier"] - 1]
    name = rv2.TRAIT_INFO.get(g["trait"], (g["trait"], ""))[0]
    return {"trait": g["trait"], "name": name, "tier": g["tier"], "tier_name": TIER_NAMES[g["tier"]], "have": min(g["have"], need),
            "need": need, "text": words.format(n=need, s="" if need == 1 else "s")}


def _counts(kind: str, metric: str, per: Optional[int], stats: dict, moments: dict) -> int:
    if kind == "season":
        return int(stats.get(metric, 0) or 0)
    if kind == "game":
        return 1 if (stats.get(metric, 0) or 0) >= per else 0
    return int(moments.get(metric, 0) or 0)


def after_game(state: dict, g: dict, lines: dict, moments: dict, base_traits: dict) -> list[dict]:
    """Every player in the game moves toward his goal; one who reaches it earns the ability (or its next tier), logged in
    state["ability_events"], and starts on his next goal. `lines`: the game's compact sides ({"home": {"players": [...]}});
    `moments`: {"home": {key: {metric: n}}, ...} from the game; `base_traits`: {team: {key: {trait: tier}}} the rosters'
    own. Returns the events this game made."""
    from teamdata import ratings as rv2
    goals = state.setdefault("ability_goals", {})
    earned = state.setdefault("abilities_earned", {})
    events = state.setdefault("ability_events", [])
    year = state.get("year") or 2026
    made = []
    for side in ("home", "away"):
        team = g[side]
        side_moments = (moments or {}).get(side) or {}
        for pl in (lines.get(side) or {}).get("players") or []:
            key = f"{pl['name']}|{pl['position']}"
            stats = dict(pl.get("stats") or {})
            mo = dict(side_moments.get(key) or {})
            if stats.get("games_started") and not stats.get("sacks_allowed") and (stats.get("pressures_allowed") or 0) <= 1 \
                    and POS_GROUP.get(pl["position"], pl["position"]) == "OL":
                stats["clean_start"] = 1             # a lineman's start with no sack and a pressure at most
            if stats.get("games_started"):
                mo["home_start" if side == "home" and not g.get("neutral") else "road_start" if side == "away" and not g.get("neutral") else "_"] = 1
            base = (base_traits.get(team) or {}).get(key) or {}
            mine = goals.setdefault(team, {})
            cur = mine.get(key)
            if not cur:
                nxt = next_goal(pl["position"], _held(state, team, key, base), key)
                if not nxt:
                    continue
                cur = mine[key] = {"trait": nxt[0], "tier": nxt[1], "have": 0, "since": [year, g["week"]]}
            kind, metric, needs, per, words = GOALS[cur["trait"]]
            cur["have"] += _counts(kind, metric, per, stats, mo)
            need = needs[cur["tier"] - 1]
            if cur["have"] < need:
                continue
            got = earned.setdefault(team, {}).setdefault(key, {})
            got[cur["trait"]] = max(got.get(cur["trait"], 0), cur["tier"])
            name = rv2.TRAIT_INFO.get(cur["trait"], (cur["trait"], ""))[0]
            ev = {"week": g["week"], "year": year, "team": team, "player": pl["name"], "position": pl["position"], "trait": cur["trait"],
                  "name": name, "tier": cur["tier"], "tier_name": TIER_NAMES[cur["tier"]], "how": words.format(n=need, s="" if need == 1 else "s"), "event_id": g.get("event_id")}
            events.append(ev)
            made.append(ev)
            del mine[key]                        # the next goal starts with his next game (next_goal)
    return made


def traits_for_game(state: dict, team: str) -> dict:
    """{player key: {trait: tier}} he has earned this career, for the engine's team (merged over the roster's own)."""
    return ((state.get("abilities_earned") or {}).get(team) or {}) if on() else {}


def news(state: dict) -> list[dict]:
    """Program News items for your players' abilities earned (Clear Mode): {week, kind "ability", slug, name, position,
    trait, ability, tier_name, line}, his player page on the name."""
    if not on() or not state.get("career"):
        return []
    from sim import season
    me = state.get("team")
    year = state.get("year") or 2026
    roster = {f"{x['name']}|{x['position']}": x.get("slug") for x in
              (season.load_teams().get(me) or {}).get("offense", []) + (season.load_teams().get(me) or {}).get("defense", [])}
    out = []
    for e in state.get("ability_events") or []:
        if e["team"] != me or e.get("year", year) != year:
            continue
        verb = "earned" if e["tier"] == 1 else "moved up to"
        out.append({"week": e["week"], "kind": "ability", "slug": roster.get(f"{e['player']}|{e['position']}"), "name": e["player"],
                    "position": e["position"], "trait": e["trait"], "ability": e["name"], "tier_name": e["tier_name"],
                    "line": f"{verb[0].upper()}{verb[1:]} {e['name']} ({e['tier_name']}): {e['how']}."})
    return out


def merged_traits(state: dict, team: str, key: str, base: list) -> list[dict]:
    """His traits for the page: the roster's own (`base`, [{key, tier}]) with what he earned this career over them,
    each earned one marked "earned"."""
    earned = ((state.get("abilities_earned") or {}).get(team) or {}).get(key) or {} if on() else {}
    out = {t["key"]: dict(t) for t in base if isinstance(t, dict)}
    for k, tier in earned.items():
        if tier > (out.get(k) or {}).get("tier", 0):
            out[k] = {"key": k, "tier": tier, "earned": True}
    return list(out.values())


def carry_over(state: dict, lgd: dict) -> int:
    """At the offseason's start (Clear Mode): write every ability earned this season into the league's rosters ("ab",
    the source's "name|tier"), so he keeps it next year wherever he plays, then clear the season's goals. Returns how
    many abilities were written."""
    earned = state.pop("abilities_earned", None) or {}
    state.pop("ability_goals", None)
    if not on() or not earned:
        return 0
    from sim import season
    from teamdata import ratings as rv2
    source = {v[0]: k for k, v in rv2.TRAITS.items()}             # trait key -> the source's ability name
    tier_word = {v: k for k, v in rv2.TRAIT_TIERS.items()}
    teams = season.load_teams()
    n = 0
    for team, players in earned.items():
        t = teams.get(team) or {}
        slugs = {f"{x['name']}|{x['position']}": x.get("slug") for x in t.get("offense", []) + t.get("defense", [])}
        roster = {c.get("id"): c for c in ((lgd.get("teams") or {}).get(team) or {}).get("roster") or []}
        for key, got in players.items():
            c = roster.get(slugs.get(key))
            if not c:
                continue
            ab = list(c.get("ab") or [])
            for trait, tier in got.items():
                name = source.get(trait)
                if not name:
                    continue
                have = max((rv2.TRAIT_TIERS.get(a.split("|")[-1], 0) for a in ab if a.split("|")[0] == name), default=0)
                if tier > have:
                    ab = [a for a in ab if a.split("|")[0] != name] + [f"{name}|{tier_word[tier]}"]
                    n += 1
            c["ab"] = ab
    return n


# recruits who arrive with abilities (the player's ask; Clear Mode only): a share by stars, mostly Bronze
RECRUIT_AB_CHANCE = {5: 0.75, 4: 0.45, 3: 0.25, 2: 0.10, 1: 0.05}   # *tune* chance a recruit of these stars has one
RECRUIT_AB_SECOND = {5: 0.35, 4: 0.12}                              # *tune* ... and a second one
RECRUIT_AB_TIERS = {5: (0.45, 0.40, 0.15), 4: (0.65, 0.30, 0.05)}   # *tune* Bronze/Silver/Gold odds by stars (else 85/15/0)


def recruit_abilities(p: dict) -> list[dict]:
    """The abilities a high school prospect arrives with (Clear Mode): [{key, name, tier, tier_name}], drawn from the
    goals that suit his position (front-weighted, as a goal is) on his own stream (`recruit-ab-{id}`), so nothing else
    moves. Empty outside Clear Mode."""
    if not on():
        return []
    import random
    from teamdata import ratings as rv2
    rng = random.Random(f"recruit-ab-{p['id']}")
    stars = int(p.get("stars") or 3)
    fits = [t for t in FITS.get(POS_GROUP.get(p.get("ea_position") or p.get("position"), ""), ()) if t in GOALS]
    if not fits or rng.random() >= RECRUIT_AB_CHANCE.get(stars, 0.1):
        return []
    n = 2 if rng.random() < RECRUIT_AB_SECOND.get(stars, 0.0) else 1
    odds = RECRUIT_AB_TIERS.get(stars, (0.85, 0.15, 0.0))
    out, pool = [], list(fits)
    for _ in range(min(n, len(pool))):
        k = rng.choices(pool, weights=[1 / (1 + i) for i in range(len(pool))], k=1)[0]
        pool.remove(k)
        tier = rng.choices((1, 2, 3), weights=odds, k=1)[0]
        out.append({"key": k, "name": rv2.TRAIT_INFO.get(k, (k, ""))[0], "about": rv2.TRAIT_INFO.get(k, ("", ""))[1],
                    "tier": tier, "tier_name": TIER_NAMES[tier]})
    return out


def recruit_ab_field(p: dict) -> list[str]:
    """recruit_abilities as the league roster's "ab" ("source name|Tier")."""
    from teamdata import ratings as rv2
    source = {v[0]: k for k, v in rv2.TRAITS.items()}
    return [f"{source[a['key']]}|{a['tier_name']}" for a in recruit_abilities(p) if a["key"] in source]

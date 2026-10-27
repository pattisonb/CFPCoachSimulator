import random

from . import game_config as cfg

def return_skill(player):
    """0-1 return ability: the return rating when the roster has one, else speed and elusiveness."""
    rating = getattr(player, "return_rating", None)
    if isinstance(rating, (int, float)):
        return rating / 100
    return ((player.speed or 50) + (getattr(player, "elusiveness", None) or 50)) / 200


# The scrimmage stats that break ties between bench players at the same depth. Return,
# kicking and punting stats are left out (a designated returner would otherwise jump the
# depth chart), and so are the award stats (snaps, pressures, long plays...).
PRODUCTION_STATS = frozenset({
    "pass_attempts", "completions", "pass_yards", "interceptions_thrown", "sacks_taken", "carries", "rush_yards", "fumbles",
    "receptions", "receiving_yards", "targets", "passing_touchdowns", "receiving_touchdowns", "rushing_touchdowns",
    "solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles", "fumble_recoveries", "fumble_return_yards",
    "interception_return_yards", "defensive_touchdowns",
})


def lead_feature_for_share(share: float) -> float:
    """The lead back's feature score (0 committee .. 1 workhorse) that gives a team its observed
    split: `share` is the top back's share of running back carries in an average game, in
    percent, read off cfg.RB_LEAD_SHARE_CURVE between the measured points and clamped at its ends."""
    curve = cfg.RB_LEAD_SHARE_CURVE
    if share <= curve[0][1]:
        return curve[0][0]
    for (f0, s0), (f1, s1) in zip(curve, curve[1:]):
        if share <= s1:
            return f0 + (f1 - f0) * (share - s0) / max(1e-9, s1 - s0)
    return curve[-1][0]


def production(player) -> float:
    return sum(v for k, v in player.stats.items() if k in PRODUCTION_STATS)


class Player:
    def __init__(self, data):
        self.name = data["name"]
        self.slug = data.get("slug", data["name"])
        self.position = data["position"]
        self.speed = data.get("speed", 50)
        self.strength = data.get("strength", 50)
        self.intelligence = data.get("intelligence", 50)
        self.endurance = data.get("endurance", 50)
        self.fatigue = data.get("fatigue", 0)
        self.in_game = data.get("in_game", False)
        self.role = data.get("role")          # depth-chart role: LT, LG, C, RG, RT, LEDG, REDG, DT, SAM, MIKE, WILL, CB, FS, SS, HB, FB...
        self.depth = data.get("depth") or 99
        # place in the position group's playing order: the depth, except for linebackers,
        # who are ordered across SAM, MIKE and WILL by real usage (build_teams.pool_linebackers)
        self.order = data.get("order") or self.depth
        self.cls = data.get("class")
        self.injured = bool(data.get("injured"))
        self.injury = None
        self.stats = dict(data.get("stats") or {})   # own copy: the source roster is shared between games
        self.target_mult = min(cfg.TARGET_MULT_MAX, data.get("target_mult", 1.0))  # real 2026 share of his team's catches against his ratings' share
        # ratings v2 (teamdata/ratings.py): the position's attributes on the house scale (50 = an average
        # Power 4 starter) and the measurables. The engine reads them where a part of the game
        # has moved onto them (docs/RATINGS_V2.md); elsewhere it reads the composites above.
        self.attrs = dict(data.get("attributes") or {})
        # traits (phase 6): key -> tier 1-4; an Iron Horse tires slower, a Quick Recovery rests faster
        self.traits = {t["key"]: t["tier"] for t in data.get("traits") or [] if isinstance(t, dict)}
        if self.traits.get("iron_horse"):
            self.endurance = min(99, self.endurance + cfg.TRAIT_FX["iron_horse"] * self.traits["iron_horse"])
        self.recovery_mult = 1 + cfg.TRAIT_FX["quick_recovery"] * self.traits.get("quick_recovery", 0)
        self.height_in = data.get("height_in") or 74
        self.weight = data.get("weight") or 220

        # Skill-specific
        self.passing = data.get("passing")
        self.decision_making = data.get("decision_making")
        self.elusiveness = data.get("elusiveness")
        self.vision = data.get("vision")
        self.hands = data.get("hands")
        self.route_running = data.get("route_running")
        self.run_blocking = data.get("run_blocking")
        self.pass_blocking = data.get("pass_blocking")
        self.rushing = data.get("rushing")
        self.tackling = data.get("tackling")
        self.coverage = data.get("coverage")
        self.kick_power = data.get("kick_power")
        self.kick_accuracy = data.get("kick_accuracy")
        self.punt_power = data.get("punt_power")
        self.punt_accuracy = data.get("punt_accuracy")
        self.return_rating = data.get("return_rating")

        self._original_attrs = {
            "speed": self.speed,
            "strength": self.strength,
            "elusiveness": self.elusiveness,
            "vision": self.vision,
            "hands": self.hands,
            "route_running": self.route_running,
            "run_blocking": self.run_blocking,
            "pass_blocking": self.pass_blocking,
            "rushing": self.rushing,
            "tackling": self.tackling,
            "coverage": self.coverage
        }
        # (attribute, original value, floor) for the fatigue penalty, and the fatigue it was last applied at
        self._penalty_attrs = [(attr, v, round(v * (2 / 3))) for attr, v in self._original_attrs.items() if v is not None]
        self._penalty_fatigue = (1e9, -1e9)    # the scale interval the current values hold over: empty until the first refresh
        # what never changes inside a game, read once: trait sums by key tuple (play_functions._tr),
        # the injury durability factor (drive_functions.roll_injuries) and Football IQ (_unit_iq)
        self._tr_cache = {}
        self._durable = max(0.4, 1 - (self.attrs.get("durability", 50) - cfg.ATTR_LEAGUE_AVG) * cfg.INJURY_DURABILITY_EFFECT)
        self._iq = self.attrs.get("football_iq", 50)


class Team:
    def __init__(self, name, offense, defense, kick_returner=None, punt_returner=None):
        self.name = name
        self.offense = [Player(p) for p in offense]
        self.defense = [Player(p) for p in defense]
        # Designated returners (player slugs). Roles, not roster slots: starters can return.
        self.kick_returner = kick_returner
        self.punt_returner = punt_returner
        self.tendencies = {}
        self.home_field_advantage = 50
        self.timeouts = 3
        self.offense_scheme = "Multiple"
        self.defense_scheme = "4-2-5"
        self.grouping = None          # offensive grouping on this snap ("11", "12", ...)
        self.front = None             # defensive package counts on this snap
        self._lineup = {"offense": None, "defense": None}
        self.momentum = 0.0           # -1 (reeling) to 1 (rolling); only used when cfg.MOMENTUM is on
        self._active = set()          # players who have gained fatigue (the bench recovery visits only these)
        self._groups = {}             # position groups in depth order, built once (depth never changes in a game)
        self._lineup_version = 0      # bumped whenever someone's in_game or injured flag changes (see _take)
        self._take_cache = {}         # group key -> (version, the group sorted for _take)
        self.grouping_snaps = {}      # snaps per grouping / front, for the box score
        self.injuries = []            # injuries suffered in this game
        self.lead, self.half, self.in_overtime = 0, 1, False
        self._resting = {}            # unit -> True while its starters sit in a blowout (rest_starters)
        self._starter_snapshot = {}   # unit -> who was in the game before the starters sat
        self._rb_lead = None          # (lead back, his rotation profile), cached by _lead_profile
        self._defense_positions = sorted(set(p.position for p in self.defense))
        # Team-level stats for special teams events
        self.team_stats = {
            "kickoff_return_touchdowns": 0,
            "blocked_kicks": 0,
            "blocked_punts": 0,
            "safeties": 0,
            "fumbles_lost": 0,
            "penalties": 0,
            "penalty_yards": 0,
            "third_downs": 0,
            "third_down_conversions": 0,
            "red_zone_trips": 0,
            "red_zone_scores": 0,
            "red_zone_touchdowns": 0,
            "first_downs": 0,
            "fourth_down_attempts": 0,
            "fourth_down_conversions": 0,
        }

    def get_offense(self):
        return self._on_field("offense")

    def get_defense(self):
        return self._on_field("defense")

    def _on_field(self, unit):
        """The unit's eleven for this snap, or (before a lineup is set) every healthy player
        the fatigue rotation has in the game."""
        if self._lineup[unit] is not None:
            return self._lineup[unit]
        players = [p for p in getattr(self, unit) if p.in_game and not p.injured]
        self._active.update(players)      # they are about to gain fatigue
        return players

    # ----- personnel: build the eleven for a snap from the depth chart -----

    def _take(self, players, n, key=None):
        """The first n available players: the fatigue rotation's in-game players first, then
        the bench, each by playing order (ties in roster order, which is depth order); injured players never.
        With `key` (a stable group) the sorted pool is kept until a flag changes (_lineup_version)."""
        if key is not None:
            hit = self._take_cache.get(key)
            if hit is not None and hit[0] == self._lineup_version:
                return hit[1][:n]
        pool = [p for p in players if not p.injured]
        pool.sort(key=lambda p: (0 if p.in_game else 1, p.order))
        if key is not None:
            self._take_cache[key] = (self._lineup_version, pool)
        return pool[:n]

    def _group_exact(self, unit, pos):
        """The unit's players at exactly this position, in roster order (built once per game)."""
        key = (unit, pos, "exact")
        g = self._groups.get(key)
        if g is None:
            g = self._groups[key] = [p for p in getattr(self, unit) if p.position == pos]
        return g

    def _group(self, unit, pos):
        """One position group of a unit, in roster order (built once per game)."""
        key = (unit, pos)
        g = self._groups.get(key)
        if g is None:
            players = getattr(self, unit)
            if pos == "LB":
                g = [p for p in players if "LB" in p.position]
            elif pos == "EDGE":
                g = [p for p in players if p.position == "DL" and p.role in ("LEDG", "REDG")]
            elif pos == "DT":
                g = [p for p in players if p.position == "DL" and p.role not in ("LEDG", "REDG")]
            elif pos == "KP":
                g = [p for p in players if p.position in ("K", "P")]
            else:
                g = [p for p in players if p.position == pos]
            self._groups[key] = g
        return g

    def set_grouping(self, name, counts):
        """Offensive grouping for this snap: counts of RB, TE, WR, OL (plus the quarterback)."""
        self.grouping = name
        self.grouping_snaps[name] = self.grouping_snaps.get(name, 0) + 1
        lineup = self._take(self._group("offense", "QB"), 1, ("offense", "QB"))
        for pos in ("RB", "TE", "WR", "OL"):
            lineup += self._take(self._group("offense", pos), counts[pos], ("offense", pos))
        # the specialists ride along so the drive code can find the kicker and punter
        lineup += [p for p in self._group("offense", "KP") if p.in_game and not p.injured]
        self._lineup["offense"] = lineup
        self._active.update(lineup)
        self.refresh_ratings(lineup)

    def set_front(self, counts):
        """Defensive package for this snap: counts of EDGE, DT, LB, CB, S."""
        self.front = counts
        key = f"{counts['EDGE'] + counts['DT']}-{counts['LB']}-{counts['CB'] + counts['S']}"
        self.grouping_snaps[key] = self.grouping_snaps.get(key, 0) + 1
        edges, tackles = self._group("defense", "EDGE"), self._group("defense", "DT")
        edge_key = ("defense", "EDGE")
        if not edges or not tackles:          # rosters without roles: split the line by depth
            if ("defense", "EDGE_F") not in self._groups:
                line = sorted(self._group("defense", "DL"), key=lambda p: p.depth)
                self._groups[("defense", "EDGE_F")], self._groups[("defense", "DT_F")] = line[0::2], line[1::2]
            edges, tackles = self._groups[("defense", "EDGE_F")], self._groups[("defense", "DT_F")]
            edge_key = ("defense", "EDGE_F")
        lineup = self._take(edges, counts["EDGE"], edge_key)
        lineup += [p for p in self._take(tackles + [e for e in edges if e not in lineup], counts["DT"]) if p not in lineup]
        lineup += self._take(self._group("defense", "LB"), counts["LB"], ("defense", "LB"))
        lineup += self._take(self._group("defense", "CB"), counts["CB"], ("defense", "CB"))
        lineup += self._take(self._group("defense", "S"), counts["S"], ("defense", "S"))
        self._lineup["defense"] = lineup
        self._active.update(lineup)
        self.refresh_ratings(lineup)

    def clear_lineups(self):
        self._lineup = {"offense": None, "defense": None}

    def injure(self, player, weeks, kind):
        """A player leaves the game (and misses `weeks` more weeks)."""
        player.injured = True
        player.in_game = False
        self._lineup_version += 1
        player.injury = {"weeks": weeks, "type": kind}
        self.injuries.append({"name": player.name, "position": player.position, "weeks": weeks, "type": kind})
        self.clear_lineups()

    def recover_bench_players(self):
        # every player with fatigue is in _active (the penalty pass keeps it current)
        for p in self._active:
            if not p.in_game and p.fatigue:
                rate = p.endurance / 10 * getattr(p, "recovery_mult", 1.0)
                if p.position == 'RB':
                    rate *= cfg.RB_BENCH_RECOVERY
                p.fatigue = max(0, p.fatigue - rate)

    def lead_back(self):
        """The feature back: the healthy halfback highest on the depth chart (the roster lists
        are in depth order, so list order breaks ties); any back when there is no halfback."""
        backs = [p for p in self.offense if p.position == 'RB' and not p.injured]
        halfbacks = [p for p in backs if p.role != 'FB'] or backs
        return min(halfbacks, key=lambda p: p.depth, default=None)

    def _lead_profile(self, lead, backs):
        """(per-snap out chance, per-snap return chance) for the lead back, from the committee
        values to the workhorse values (cfg.RB_LEAD_*) by how much better he is than the next
        back. Uses the unpenalized ratings the run game uses; cached for the game."""
        if self._rb_lead is not None and self._rb_lead[0] is lead:
            return self._rb_lead[1]

        def rating(p):
            o = p._original_attrs
            return sum(o[k] or 50 for k in ("speed", "strength", "elusiveness", "vision")) / 4

        others = [p for p in backs if p is not lead and p.role != 'FB'] or [p for p in backs if p is not lead]
        gap = rating(lead) - max(rating(p) for p in others)
        lo, hi = cfg.RB_LEAD_GAP_RANGE
        feature = min(1.0, max(0.0, (gap - lo) / (hi - lo)))
        td = self.tendencies or {}
        if lead.depth == 1:         # the team's real 2026 split, when its real lead back leads
            if td.get("rb1_share") is not None:
                feature = lead_feature_for_share(td["rb1_share"])    # observed share (derive_tendencies.py)
            elif td.get("rb_lead_feature") is not None:
                feature = td["rb_lead_feature"]                       # tools/tune_from_real.py, when there is no observed share
        ret_lo, ret_hi = cfg.RB_LEAD_RETURN_CHANCE
        profile = (cfg.RB_LEAD_OUT_CHANCE * (1 - feature) ** cfg.RB_LEAD_OUT_CURVE,
                   ret_lo + (ret_hi - ret_lo) * feature ** cfg.RB_LEAD_CURVE)
        self._rb_lead = (lead, profile)
        return profile

    def rotate_backs(self, fatigue_threshold=50):
        """Running back rotation (the RB_LEAD_* constants in game_config). The lead back comes
        out when he tires or, on a committee team, by the coach's series rotation; he returns
        once rested, at once for a feature back and after the backups' series on a committee.
        The backups rotate among themselves at the skill-position threshold and call on the lead
        back only when no other fresh back is left. In a blowout the starters sit
        (rest_starters), so only the tired-for-fresh rotation runs."""
        backs = [p for p in self.offense if p.position == 'RB' and not p.injured]
        if len(backs) < 2:
            return
        lead = None if self._resting.get("offense") else self.lead_back()
        out_chance, return_chance = self._lead_profile(lead, backs) if lead is not None else (0.0, 0.0)
        if lead is not None and not lead.in_game and lead.fatigue <= cfg.RB_LEAD_RETURN_FATIGUE \
                and random.random() < return_chance:
            on_field = [p for p in backs if p.in_game]
            if on_field:
                max(on_field, key=lambda p: p.fatigue).in_game = False
            lead.in_game = True
            self._lineup_version += 1
            return
        lead_out = lead is not None and lead.in_game and (lead.fatigue > cfg.RB_LEAD_SUB_FATIGUE or random.random() < out_chance)
        tired = [p for p in backs if p.in_game and (lead_out if p is lead else p.fatigue > fatigue_threshold)]
        if not tired:
            return
        bench = [p for p in backs if not p.in_game and p is not lead and p.fatigue <= fatigue_threshold]
        if not bench and lead is not None and not lead.in_game and lead.fatigue <= cfg.RB_LEAD_RETURN_FATIGUE:
            bench = [lead]
        if not bench:
            return
        # the next fresh halfback on the depth chart first (fullbacks last), the more productive
        # one on a tie; sometimes the next back down gets the series instead
        bench.sort(key=lambda p: (p.role == 'FB', p.order, -production(p), p.fatigue))
        self._swap(tired, bench, rotate=True)

    def _swap(self, tired, bench, rotate=False):
        """Sub the bench (best first) for the tired players one-for-one. With `rotate`, the
        next player down sometimes gets the series instead (cfg.BACKUP_RB_ROTATION)."""
        for tired_player in tired:
            if not bench:
                break
            pick = 1 if rotate and len(bench) > 1 and random.random() < cfg.BACKUP_RB_ROTATION else 0
            sub = bench.pop(pick)
            tired_player.in_game = False
            sub.in_game = True
            self._lineup_version += 1

    def sub_skill_position_players(self, fatigue_threshold=50):
        self.rotate_backs(fatigue_threshold)

        for pos in ('WR', 'TE'):
            # in-game players of this position who are too tired
            group = self._group_exact("offense", pos)
            starters = [p for p in group if p.in_game and p.fatigue > fatigue_threshold]
            if not starters:
                continue

            # bench players of the same position who are fresh enough
            bench = [p for p in group if not p.in_game and not p.injured and p.fatigue <= fatigue_threshold]
            if not bench:
                continue

            # the next fresh player on the depth chart first, the more productive one on a tie
            bench.sort(key=lambda p: (p.order, -production(p), p.fatigue))
            self._swap(starters, bench, rotate=True)

    def sub_defensive_players(self, fatigue_threshold=50):
        for pos in self._defense_positions:
            threshold = cfg.DEF_SUB_FATIGUE.get(pos, fatigue_threshold)
            # Players currently in the game and too tired
            group = self._group_exact("defense", pos)
            tired_players = [p for p in group if p.in_game and p.fatigue > threshold]
            if not tired_players:
                continue

            # Bench players eligible to sub in
            bench = [p for p in group if not p.in_game and not p.injured and p.fatigue <= threshold * 0.6]
            if not bench:
                continue

            # the next fresh player on the depth chart first, then the freshest and most productive
            bench.sort(key=lambda p: (p.order, p.fatigue, -production(p)))
            self._swap(tired_players, bench)

    REST_POSITIONS = {"offense": ("QB", "RB", "WR", "TE", "OL"), "defense": ("DL", "MLB", "ROLB", "LOLB", "CB", "S")}

    def rest_starters(self, unit="offense"):
        """Blowout: sit the starters at the skill and front positions and play the next
        players on the depth chart (the roster lists are in depth order). No-op if already resting."""
        if self._resting.get(unit):
            return
        players = getattr(self, unit)
        self._starter_snapshot[unit] = [p.in_game for p in players]
        for pos in self.REST_POSITIONS[unit]:
            group = [p for p in players if p.position == pos and not p.injured]
            starters = [p for p in group if p.in_game]
            bench = sorted((p for p in group if not p.in_game), key=lambda p: p.order)
            for s, b in zip(starters, bench):
                s.in_game, b.in_game = False, True
        self._lineup_version += 1
        self._resting[unit] = True

    def restore_starters(self, unit="offense"):
        if not self._resting.get(unit):
            return
        for p, was in zip(getattr(self, unit), self._starter_snapshot[unit]):
            p.in_game = was
        self._lineup_version += 1
        self._resting[unit] = False

    def get_kicker(self):
        """The kicker: the in-game one, else any healthy K, else the punter, else anyone."""
        return self._specialist("K", "P")

    def get_punter(self):
        return self._specialist("P", "K")

    def _specialist(self, pos, alt):
        pool = [p for p in self.offense if p.position == pos]
        for cond in (lambda p: p.in_game and not p.injured, lambda p: not p.injured, lambda p: True):
            for p in pool:
                if cond(p):
                    return p
        for p in self.offense:
            if p.position == alt and not p.injured:
                return p
        return self.offense[0] if self.offense else None

    def _designated(self, slug):
        if not slug:
            return None
        for p in self.offense + self.defense:
            if p.slug == slug or p.name == slug:
                return p
        return None

    def best_returner(self):
        """Fallback returner: highest return rating among non-specialists, else fastest."""
        candidates = [p for p in self.offense + self.defense if p.position not in ("K", "P", "OL", "DL", "QB")]
        if not candidates:
            return None
        self.refresh_ratings(candidates)
        return max(candidates, key=lambda p: (return_skill(p), p.speed or 0))

    def get_kick_returner(self):
        """The designated kick returner, else the fastest skill position player."""
        return self._designated(self.kick_returner) or self.best_returner()

    def get_punt_returner(self):
        """The designated punt returner, else the fastest skill position player."""
        return self._designated(self.punt_returner) or self.best_returner()

    def swing(self, amount):
        """A momentum swing (positive is good for this team), clamped to [-1, 1]."""
        if cfg.MOMENTUM:
            self.momentum = max(-1.0, min(1.0, self.momentum + amount))

    def momentum_factor(self):
        return 1.0 + cfg.MOMENTUM_EFFECT * self.momentum if cfg.MOMENTUM else 1.0

    def refresh_ratings(self, players):
        """Bring these players' ratings up to date with their fatigue (up to 15% down, floor
        two thirds) and, when momentum is on, the team's momentum. Called for the players
        about to be read: the snap's lineups, a returner. Anyone whose fatigue and the
        factor are unchanged since his last refresh is skipped."""
        factor = self.momentum_factor()
        _round, _max, _min = round, max, min
        eps = 1e-9
        for player in players:
            scale = (1 - player.fatigue / 100 * 0.15) * factor
            # Every penalised attribute is a rounded, clamped multiple of the scale, so each one
            # holds its value over an interval of scales. While the scale stays inside the
            # intersection of those intervals (shrunk by eps against floating-point edges and
            # round-half-even ties) nothing can change and the player is skipped: the values a
            # recompute would write are, by construction, the ones already there.
            lo, hi = player._penalty_fatigue
            if lo <= scale < hi:
                continue
            values = player.__dict__      # plain attributes: writing the dict is setattr without the lookup
            lo, hi = -1e9, 1e9
            for attr, original_value, min_allowed in player._penalty_attrs:
                r = _round(original_value * scale)
                if r >= 99:
                    values[attr] = 99
                    lo = _max(lo, 98.5 / original_value + eps)
                elif r <= min_allowed:
                    values[attr] = min_allowed
                    hi = _min(hi, (min_allowed + 0.5) / original_value - eps)
                else:
                    values[attr] = r
                    lo = _max(lo, (r - 0.5) / original_value + eps)
                    hi = _min(hi, (r + 0.5) / original_value - eps)
            player._penalty_fatigue = (lo, hi)

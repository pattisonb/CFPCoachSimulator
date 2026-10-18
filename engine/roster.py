import json
import random

from . import game_config as cfg

def return_skill(player):
    """0-1 return ability: the return rating when the roster has one, else speed and elusiveness."""
    rating = getattr(player, "return_rating", None)
    if isinstance(rating, (int, float)):
        return rating / 100
    return ((player.speed or 50) + (getattr(player, "elusiveness", None) or 50)) / 200


# The box-score stats that existed before the award stats were added. Substitution order
# ranks bench players by these only, so the extra stats (snaps, pressures, long plays...)
# never change who comes into the game.
PRODUCTION_STATS = frozenset({
    "pass_attempts", "completions", "pass_yards", "interceptions_thrown", "sacks_taken", "carries", "rush_yards", "fumbles",
    "receptions", "receiving_yards", "targets", "passing_touchdowns", "receiving_touchdowns", "rushing_touchdowns",
    "solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles", "fumble_recoveries", "fumble_return_yards",
    "interception_return_yards", "defensive_touchdowns", "fg_attempted", "fg_made", "pat_attempts", "pat_made",
    "kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "punt_returns", "punt_return_yards",
    "punt_return_touchdowns", "punts", "punt_yards",
})


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
        self.cls = data.get("class")
        self.injured = bool(data.get("injured"))
        self.injury = None
        self.stats = dict(data.get("stats") or {})   # own copy: the source roster is shared between games
        self.target_mult = data.get("target_mult", 1.0)  # real 2026 share of his team's catches against his ratings' share

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
        self._penalty_fatigue = None


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
        self.grouping_snaps = {}      # snaps per grouping / front, for the box score
        self.injuries = []            # injuries suffered in this game
        self.lead, self.half, self.in_overtime = 0, 1, False
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

    def get_offense(self, side="offense"):
        if side == "offense" and self._lineup["offense"] is not None:
            return self._lineup["offense"]
        players = [p for p in getattr(self, side) if p.in_game and not p.injured]
        self._active.update(players)      # they are about to gain fatigue
        return players
    
    def get_defense(self, side="defense"):
        if side == "defense" and self._lineup["defense"] is not None:
            return self._lineup["defense"]
        players = [p for p in getattr(self, side) if p.in_game and not p.injured]
        self._active.update(players)      # they are about to gain fatigue
        return players

    # ----- personnel: build the eleven for a snap from the depth chart -----

    @staticmethod
    def _take(players, n):
        """The first n available players: the fatigue rotation's in-game players first, then
        the bench, each by depth-chart order; injured players never."""
        pool = [p for p in players if not p.injured]
        pool.sort(key=lambda p: (0 if p.in_game else 1, p.depth))
        return pool[:n]

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
        lineup = self._take(self._group("offense", "QB"), 1)
        for pos in ("RB", "TE", "WR", "OL"):
            lineup += self._take(self._group("offense", pos), counts[pos])
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
        if not edges or not tackles:          # rosters without roles: split the line by depth
            if ("defense", "EDGE_F") not in self._groups:
                line = sorted(self._group("defense", "DL"), key=lambda p: p.depth)
                self._groups[("defense", "EDGE_F")], self._groups[("defense", "DT_F")] = line[0::2], line[1::2]
            edges, tackles = self._groups[("defense", "EDGE_F")], self._groups[("defense", "DT_F")]
        lineup = self._take(edges, counts["EDGE"])
        lineup += [p for p in self._take(tackles + [e for e in edges if e not in lineup], counts["DT"]) if p not in lineup]
        lineup += self._take(self._group("defense", "LB"), counts["LB"])
        lineup += self._take(self._group("defense", "CB"), counts["CB"])
        lineup += self._take(self._group("defense", "S"), counts["S"])
        self._lineup["defense"] = lineup
        self._active.update(lineup)
        self.refresh_ratings(lineup)

    def clear_lineups(self):
        self._lineup = {"offense": None, "defense": None}

    def injure(self, player, weeks, kind):
        """A player leaves the game (and misses `weeks` more weeks)."""
        player.injured = True
        player.in_game = False
        player.injury = {"weeks": weeks, "type": kind}
        self.injuries.append({"name": player.name, "position": player.position, "weeks": weeks, "type": kind})
        self.clear_lineups()
        
    def recover_bench_players(self):
        # every player with fatigue is in _active (the penalty pass keeps it current)
        for p in self._active:
            if not p.in_game and p.fatigue:
                rate = p.endurance / 10
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
        cache = getattr(self, "_rb_lead", None)
        if cache is not None and cache[0] is lead:
            return cache[1]

        def rating(p):
            o = p._original_attrs
            return sum(o[k] or 50 for k in ("speed", "strength", "elusiveness", "vision")) / 4

        others = [p for p in backs if p is not lead and p.role != 'FB'] or [p for p in backs if p is not lead]
        gap = rating(lead) - max(rating(p) for p in others)
        lo, hi = cfg.RB_LEAD_GAP_RANGE
        feature = min(1.0, max(0.0, (gap - lo) / (hi - lo)))
        observed = (self.tendencies or {}).get("rb_lead_feature")
        if observed is not None and lead.depth == 1:
            feature = observed      # the team's real 2026 split (tools/tune_from_real.py), when its real lead back leads
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
        lead = None if getattr(self, "_resting", {}).get("offense") else self.lead_back()
        out_chance, return_chance = self._lead_profile(lead, backs) if lead is not None else (0.0, 0.0)
        if lead is not None and not lead.in_game and lead.fatigue <= cfg.RB_LEAD_RETURN_FATIGUE \
                and random.random() < return_chance:
            on_field = [p for p in backs if p.in_game]
            if on_field:
                max(on_field, key=lambda p: p.fatigue).in_game = False
            lead.in_game = True
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
        # the most productive fresh back first; sometimes the next back down gets the series instead
        bench.sort(key=lambda p: (-production(p), p.fatigue))
        for tired_player in tired:
            if not bench:
                break
            pick = 1 if len(bench) > 1 and random.random() < cfg.BACKUP_RB_ROTATION else 0
            sub = bench.pop(pick)
            tired_player.in_game = False
            sub.in_game = True

    def sub_skill_position_players(self, fatigue_threshold=50):
        self.rotate_backs(fatigue_threshold)

        skill_positions = ['WR', 'TE']

        for pos in skill_positions:
            # Get current in-game players of this position
            starters = [p for p in self.offense if p.position == pos and p.in_game and p.fatigue > fatigue_threshold]
            if not starters:
                continue  # no one too tired

            # Get bench players of same position who are fresh enough
            bench = [p for p in self.offense if p.position == pos and not p.in_game and not p.injured and p.fatigue <= fatigue_threshold]
            if not bench:
                continue  # no fresh players available

            # Prioritize fresh subs by fatigue ASC, then by total stats DESC
            def stat_sum(player):
                return production(player)

            bench.sort(key=lambda p: (-stat_sum(p), p.fatigue))

            # Sub one-for-one; sometimes the next back down gets the series instead of the best one
            for tired_player in starters:
                if not bench:
                    break
                pick = 1 if len(bench) > 1 and random.random() < cfg.BACKUP_RB_ROTATION else 0
                sub = bench.pop(pick)
                tired_player.in_game = False
                sub.in_game = True

    def sub_defensive_players(self, fatigue_threshold=50):
        positions = getattr(self, "_defense_positions", None)
        if positions is None:
            positions = self._defense_positions = sorted(set(p.position for p in self.defense))

        for pos in positions:
            threshold = cfg.DEF_SUB_FATIGUE.get(pos, fatigue_threshold)
            # Players currently in the game and too tired
            tired_players = [p for p in self.defense if p.position == pos and p.in_game and p.fatigue > threshold]
            if not tired_players:
                continue

            # Bench players eligible to sub in
            bench = [p for p in self.defense if p.position == pos and not p.in_game and not p.injured and p.fatigue <= threshold * 0.6]
            if not bench:
                continue

            # Prioritize by freshest and most productive
            def stat_sum(player):
                return production(player)

            bench.sort(key=lambda p: (p.fatigue, -stat_sum(p)))

            # Swap one-for-one
            for tired in tired_players:
                if not bench:
                    break
                fresh = bench.pop(0)
                tired.in_game = False
                fresh.in_game = True


    REST_POSITIONS = {"offense": ("QB", "RB", "WR", "TE", "OL"), "defense": ("DL", "MLB", "ROLB", "LOLB", "CB", "S")}

    def rest_starters(self, unit="offense"):
        """Blowout: sit the starters at the skill and front positions and play the next
        players on the depth chart (the roster lists are in depth order). No-op if already resting."""
        if getattr(self, "_resting", {}).get(unit):
            return
        players = getattr(self, unit)
        if not hasattr(self, "_resting"):
            self._resting = {}
            self._starter_snapshot = {}
        self._starter_snapshot[unit] = [p.in_game for p in players]
        for pos in self.REST_POSITIONS[unit]:
            group = [p for p in players if p.position == pos and not p.injured]
            starters = [p for p in group if p.in_game]
            bench = [p for p in group if not p.in_game]
            for s, b in zip(starters, bench):
                s.in_game, b.in_game = False, True
        self._resting[unit] = True

    def restore_starters(self, unit="offense"):
        if not getattr(self, "_resting", {}).get(unit):
            return
        for p, was in zip(getattr(self, unit), self._starter_snapshot[unit]):
            p.in_game = was
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
        designated = self._designated(self.kick_returner)
        if designated:
            return designated
        return self.best_returner()
    
    def get_punt_returner(self):
        """The designated punt returner, else the fastest skill position player."""
        designated = self._designated(self.punt_returner)
        if designated:
            return designated
        return self.best_returner()
    
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
        for player in players:
            fatigue = player.fatigue
            key = (fatigue, factor)
            if key == player._penalty_fatigue:
                continue
            player._penalty_fatigue = key
            scale = (1 - fatigue / 100 * 0.15) * factor
            values = player.__dict__      # plain attributes: writing the dict is setattr without the lookup
            for attr, original_value, min_allowed in player._penalty_attrs:
                values[attr] = _max(min_allowed, _min(99, _round(original_value * scale)))

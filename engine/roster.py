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
        self.stats = dict(data.get("stats") or {})   # own copy: the source roster is shared between games

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

    def is_offense(self):
        return self.position in {"QB", "RB", "WR", "TE", "OL", "K", "P"}

    def is_defense(self):
        return self.position in {"DL", "ROLB", "MLB", "LOLB", "CB", "S"}

    def fatigue_level(self):
        return self.fatigue / max(self.endurance, 1)

    def to_dict(self):
        return self.__dict__.copy()


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
        players = getattr(self, side)
        return [p for p in players if p.in_game]
    
    def get_all_offense(self, side="offense"):
        players = getattr(self, side)
        return [p for p in players]
    
    def get_defense(self, side="defense"):
        players = getattr(self, side)
        return [p for p in players if p.in_game]
        
    def get_all_defense(self, side="defense"):
        players = getattr(self, side)
        return [p for p in players]

    def get_player_by_name(self, name):
        for p in self.offense + self.defense:
            if p.name == name:
                return p
        return None
    
    def recover_bench_players(self):
        for unit in (self.offense, self.defense):
            for p in unit:
                if not p.in_game and p.fatigue:
                    p.fatigue = max(0, p.fatigue - p.endurance / 10)

    def sub_skill_position_players(self, fatigue_threshold=50):
        from operator import itemgetter

        skill_positions = ['RB', 'WR', 'TE']

        for pos in skill_positions:
            # Get current in-game players of this position
            starters = [p for p in self.offense if p.position == pos and p.in_game and p.fatigue > fatigue_threshold]
            if not starters:
                continue  # no one too tired

            # Get bench players of same position who are fresh enough
            bench = [p for p in self.offense if p.position == pos and not p.in_game and p.fatigue <= fatigue_threshold]
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
            # Players currently in the game and too tired
            tired_players = [p for p in self.defense if p.position == pos and p.in_game and p.fatigue > fatigue_threshold]
            if not tired_players:
                continue

            # Bench players eligible to sub in
            bench = [p for p in self.defense if p.position == pos and not p.in_game and p.fatigue <= fatigue_threshold]
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


    REST_POSITIONS = {"offense": ("QB", "RB", "WR", "TE"), "defense": ("DL", "MLB", "ROLB", "LOLB", "CB", "S")}

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
            group = [p for p in players if p.position == pos]
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
        for p in self.offense:
            if p.position == "K":
                return p
        return None
    
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
    
    def apply_fatigue_penalties(self):
        """Scale each player's ratings down by up to 15% with fatigue (floor two thirds).
        Only players whose fatigue changed since the last call are touched, which is the
        few on the field plus anyone recovering on the bench."""
        for unit in (self.offense, self.defense):
            for player in unit:
                fatigue = player.fatigue
                if fatigue == player._penalty_fatigue:
                    continue
                player._penalty_fatigue = fatigue
                penalty_scale = fatigue / 100 * 0.15  # max 15% drop
                for attr, original_value, min_allowed in player._penalty_attrs:
                    new_value = round(original_value * (1 - penalty_scale))
                    setattr(player, attr, max(min_allowed, new_value))

def initialize_teams(json_path):
    with open(json_path, "r") as f:
        data = json.load(f)

    teams = []
    for team_data in data["teams"]:
        team = Team(
            name=team_data["team_name"],
            offense=team_data["offense"],
            defense=team_data["defense"]
        )
        teams.append(team)

    return teams

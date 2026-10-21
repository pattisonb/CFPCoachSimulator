"""Season awards: the Heisman vote, the national player and coach awards, All-America teams,
and every conference's awards and all-conference teams.

The research behind the choices is docs/AWARDS_RESEARCH.md. Every award is scored from the
season-long stats the engine keeps (state["season_stats"]), the records and polls in the
season state, and the rosters (class, depth-chart role, ratings). Scores are standardized
within the eligible position pool so a 1,700-yard back and a 45-touchdown quarterback can
be compared, and a team term is added where the real award rewards team success.

The same scoring powers the live "race" shown during the season and the final results.
Calendar: conference awards after championship week (14), the Heisman and the national
awards in selection week (16), the postseason awards after the title game (20).
"""
from __future__ import annotations

import random
import statistics
from typing import Callable, Optional

# ----- constants ---------------------------------------------------------------

G5 = {"American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"}
FRESHMAN = {"FR", "FRRS"}
UPPERCLASS = {"JR", "JRRS", "SR", "SRRS"}
EDGE_ROLES = {"LEDG", "REDG"}
INTERIOR_DL = {"DT"}
LB_POSITIONS = {"MLB", "ROLB", "LOLB", "OLB"}
DB_POSITIONS = {"CB", "S"}

# Heisman regions by the school's state (870 media voters, 145 per region).
REGIONS = {
    "Far West": {"WA", "OR", "CA", "NV", "AZ", "UT", "ID", "MT", "WY", "CO", "AK", "HI", "NM"},
    "Southwest": {"TX", "OK", "AR", "LA"},
    "Midwest": {"OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO", "KS", "NE", "ND", "SD"},
    "South": {"FL", "GA", "AL", "MS", "TN", "KY", "SC", "NC", "VA", "WV"},
    "Mid-Atlantic": {"PA", "NJ", "DE", "MD", "DC"},
    "Northeast": {"NY", "CT", "MA", "RI", "VT", "NH", "ME"},
}

# How far each position's standardized production carries in a cross-position vote
# (nine of twelve Heisman winners were quarterbacks; no pure defender has won).
POSITION_PRIOR = {"QB": 1.0, "RB": 0.52, "WR": 0.6, "TE": 0.38, "EDGE": 0.42, "DT": 0.32, "LB": 0.36, "DB": 0.34,
                  "OL": 0.2, "K": 0.08, "P": 0.05, "RS": 0.25}

# Starters per team by score group: the cross-position awards standardize each player
# against the league's starters at his position (138 QBs, 276 backs, ...), so "how far above
# the other starters" is what carries across positions.
STARTERS_PER_TEAM = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "EDGE": 2, "DT": 2, "LB": 3, "DB": 4, "OL": 5, "K": 1, "P": 1, "RS": 1}

# The five All-America selectors the NCAA counts toward consensus: (team weight, noise sd).
SELECTORS = {"AP": (0.25, 0.5), "AFCA": (0.55, 0.55), "FWAA": (0.1, 0.45), "TSN": (0.3, 0.65), "WCFF": (0.45, 0.55)}
AA_SLOTS = [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("C", 1), ("OL", 4), ("EDGE", 2), ("DT", 2), ("LB", 3),
            ("CB", 2), ("S", 2), ("K", 1), ("P", 1), ("RS", 1)]

# All-conference layouts (docs/AWARDS_RESEARCH.md Part 1C): selectors, number of teams, slots.
CONF_LAYOUTS = {
    "SEC": (["Coaches", "AP"], 2, [("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("C", 1), ("OL", 4), ("EDGE", 2), ("DT", 2), ("LB", 3), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
    "Big Ten": (["Coaches", "Media"], 3, [("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("C", 1), ("G", 2), ("T", 2), ("DL", 4), ("LB", 4), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
    "Big 12": (["Coaches", "Media"], 2, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("C", 1), ("G", 2), ("T", 2), ("DL", 4), ("LB", 3), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
    "ACC": (["ACSMA"], 3, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("AP", 1), ("T", 2), ("G", 2), ("C", 1), ("EDGE", 2), ("DT", 2), ("LB", 3), ("CB", 2), ("S", 2), ("K", 1), ("P", 1), ("RS", 1)]),
    "American Athletic Conference": (["Coaches"], 3, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("T", 2), ("G", 2), ("C", 1), ("DL", 4), ("LB", 4), ("CB", 2), ("S", 2), ("K", 1), ("P", 1), ("RS", 1)]),
    "Mountain West": (["Coaches"], 2, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("OL", 5), ("DL", 4), ("LB", 4), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
    "Sun Belt": (["Coaches"], 3, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("OL", 5), ("DL", 4), ("LB", 3), ("DB", 5), ("K", 1), ("P", 1), ("RS", 1), ("AP", 1)]),
    "MAC": (["Media"], 3, [("QB", 1), ("RB", 2), ("WR", 4), ("TE", 1), ("OL", 5), ("DL", 4), ("LB", 4), ("DB", 4), ("K", 1), ("P", 1), ("RS", 2)]),
    "Conference USA": (["Coaches"], 2, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("OL", 5), ("EDGE", 2), ("DT", 2), ("LB", 3), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
    "Pac-12": (["Coaches"], 2, [("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1), ("OL", 5), ("DL", 4), ("LB", 4), ("DB", 4), ("K", 1), ("P", 1), ("RS", 1)]),
}

# Conference awards (Part 1F): (name, kind). Newcomer awards are left out: no transfer data.
_OPOY, _DPOY, _ST, _COY = ("Offensive Player of the Year", "opoy"), ("Defensive Player of the Year", "dpoy"), \
    ("Special Teams Player of the Year", "stpoy"), ("Coach of the Year", "coach")
CONF_AWARDS = {
    "ACC": [("Player of the Year", "mvp"), _OPOY, _DPOY, ("Rookie of the Year", "freshman"), ("Offensive Rookie of the Year", "off_freshman"),
            ("Defensive Rookie of the Year", "def_freshman"), _COY, ("Jacobs Blocking Trophy", "blocker")],
    "American Athletic Conference": [_OPOY, _DPOY, _ST, ("Rookie of the Year", "freshman"), _COY],
    "Big 12": [_OPOY, _DPOY, _ST, ("Offensive Freshman of the Year", "off_freshman"), ("Defensive Freshman of the Year", "def_freshman"),
               ("Offensive Lineman of the Year", "ol"), ("Defensive Lineman of the Year", "dl"), _COY],
    "Big Ten": [("Graham-George Offensive Player of the Year", "opoy"), ("Nagurski-Woodson Defensive Player of the Year", "dpoy"),
                ("Chicago Tribune Silver Football", "mvp"), ("Thompson-Randle El Freshman of the Year", "freshman"),
                ("Hayes-Schembechler Coach of the Year", "coach"), ("Griese-Brees Quarterback of the Year", "qb"),
                ("Ameche-Dayne Running Back of the Year", "rb"), ("Richter-Howard Receiver of the Year", "wr"),
                ("Kwalick-Clark Tight End of the Year", "te"), ("Rimington-Pace Offensive Lineman of the Year", "ol"),
                ("Smith-Brown Defensive Lineman of the Year", "dl"), ("Butkus-Fitzgerald Linebacker of the Year", "lb"),
                ("Tatum-Woodson Defensive Back of the Year", "db"), ("Bakken-Andersen Kicker of the Year", "k"),
                ("Eddleman-Fields Punter of the Year", "p"), ("Rodgers-Dwight Return Specialist of the Year", "rs")],
    "Conference USA": [("Most Valuable Player", "mvp"), _OPOY, _DPOY, _ST, ("Freshman of the Year", "freshman"), _COY],
    "MAC": [_OPOY, _DPOY, _ST, ("Freshman Player of the Year", "freshman"), ("Vern Smith Leadership Award", "mvp"), _COY],
    "Mountain West": [_OPOY, _DPOY, _ST, ("Freshman of the Year", "freshman"), _COY],
    "Pac-12": [_OPOY, ("Pat Tillman Defensive Player of the Year", "dpoy"), ("Offensive Freshman of the Year", "off_freshman"),
               ("Defensive Freshman of the Year", "def_freshman"), ("Morris Trophy (Offense)", "ol"), ("Morris Trophy (Defense)", "dl"), _COY],
    "SEC": [_OPOY, _DPOY, _ST, ("Jacobs Blocking Trophy", "blocker"), ("Freshman of the Year", "freshman"), _COY],
    "Sun Belt": [("Player of the Year", "mvp"), _OPOY, _DPOY, ("Freshman of the Year", "freshman"), _COY],
}

# National awards: (name, kind, team weight for the final score, honors). Week 15 unless noted.
NATIONAL_AWARDS = [
    ("Maxwell Award", "mvp", 0.9, "college player of the year"),
    ("Walter Camp Award", "mvp_team", 1.1, "player of the year, voted by coaches and sports information directors"),
    ("AP Player of the Year", "mvp", 0.9, "player of the year"),
    ("Sporting News Player of the Year", "mvp", 0.8, "player of the year"),
    ("Davey O'Brien Award", "qb", 0.6, "best quarterback"),
    ("Johnny Unitas Golden Arm Award", "qb_upper", 0.6, "best junior or senior quarterback"),
    ("Doak Walker Award", "rb", 0.3, "best running back"),
    ("Fred Biletnikoff Award", "wr", 0.3, "best receiver"),
    ("John Mackey Award", "te", 0.3, "best tight end"),
    ("Outland Trophy", "interior", 0.5, "best interior lineman, offense or defense"),
    ("Rimington Trophy", "c", 0.5, "best center"),
    ("Lombardi Award", "front", 0.5, "best lineman or linebacker"),
    ("Chuck Bednarik Award", "dpoy", 0.25, "defensive player of the year"),
    ("Bronko Nagurski Trophy", "dpoy_alt", 0.25, "defensive player of the year"),
    ("Lott IMPACT Trophy", "dpoy", 0.6, "defensive player, performance and leadership"),
    ("Butkus Award", "lb", 0.4, "best linebacker"),
    ("Jim Thorpe Award", "db", 0.3, "best defensive back"),
    ("Ted Hendricks Award", "edge", 0.3, "best defensive end"),
    ("Lou Groza Award", "k", 0.2, "best place-kicker"),
    ("Ray Guy Award", "p", 0.0, "best punter"),
    ("Jet Award", "rs", 0.0, "best return specialist"),
    ("Paul Hornung Award", "versatile", 0.2, "most versatile player"),
    ("Shaun Alexander Freshman of the Year", "freshman", 0.2, "top freshman"),
]
COACH_AWARDS = [
    ("AP Coach of the Year", 0.35, 1.0), ("AFCA Coach of the Year", 0.5, 0.6), ("Eddie Robinson Coach of the Year", 0.25, 1.2),
    ("Bobby Dodd Coach of the Year", 0.6, 0.6), ("George Munger Award", 0.4, 0.9), ("Home Depot Coach of the Year", 0.4, 1.0),
    ("Walter Camp Coach of the Year", 0.5, 0.7),
]   # (name, weight on wins, weight on surprise)
POSTSEASON_AWARDS = [("Manning Award", "qb"), ("Paul \"Bear\" Bryant Award", "coach_title"), ("Joe Moore Award", "ol_unit")]

# ----- small helpers --------------------------------------------------------------


def passer_rating(st: dict) -> float:
    att = st.get("pass_attempts", 0)
    if not att:
        return 0.0
    return (8.4 * st.get("pass_yards", 0) + 330 * st.get("passing_touchdowns", 0) + 100 * st.get("completions", 0)
            - 200 * st.get("interceptions_thrown", 0)) / att


def _z(values: list[float]) -> tuple[float, float]:
    if len(values) < 3:
        return (values[0] if values else 0.0), 1.0
    mean = statistics.fmean(values)
    sd = statistics.pstdev(values) or 1.0
    return mean, sd


def _ordinal(n: int) -> str:
    """1 -> '1st', 2 -> '2nd', 11 -> '11th'."""
    if 4 <= n <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _podium(race: list[dict]) -> dict:
    """An award's winner (None when nobody qualified) and its top three."""
    return {"winner": race[0] if race else None, "finalists": race[:3]}


def _rank_bonus(rank: Optional[int]) -> float:
    if rank is None:
        return -1.0
    if rank <= 4:
        return 1.5
    if rank <= 10:
        return 0.8
    if rank <= 15:
        return 0.1
    if rank <= 25:
        return -0.2
    return -0.6


# ----- the player pool ------------------------------------------------------------


class Pool:
    """Every player with season stats, with team context and standardized position scores."""

    def __init__(self, state: dict, teams: dict, records: dict, through_week: Optional[int] = None):
        self.state = state
        self.teams = teams
        self.records = records
        self.week = through_week if through_week is not None else state["current_week"]
        self.ranks = self._ranks()
        self.players: list[dict] = []
        self._eligible: dict[str, list[dict]] = {}    # by_group's cache: group -> players who played enough
        self._build()
        self._standardize()

    # -- team context
    def _ranks(self) -> dict[str, dict]:
        """Latest poll positions: AP rank and CFP rank (the committee's when it exists)."""
        polls = self.state.get("polls", {})
        weeks = sorted((int(w) for w in polls if w.isdigit() and int(w) <= self.week), reverse=True)
        ap: dict[str, int] = {}
        cfp: dict[str, int] = {}
        for w in weeks:
            p = polls[str(w)]
            if not ap and p.get("ap"):
                ap = {e["team"]: e["rank"] for e in p["ap"]}
            if not cfp and p.get("cfp_full"):
                cfp = {t: i + 1 for i, t in enumerate(p["cfp_full"])}
            elif not cfp and p.get("cfp"):
                cfp = {e["team"]: e["rank"] for e in p["cfp"]}
            if ap and cfp:
                break
        return {"ap": ap, "cfp": cfp}

    def team_term(self, slug: str) -> float:
        """How much a player's team helps him: wins, losses and the poll position."""
        r = self.records[slug]
        t = 0.22 * r["wins"] - 0.55 * r["losses"] + _rank_bonus(self.rank_of(slug))
        if self.teams[slug]["conference"] in G5:
            t -= 0.6 if r["losses"] > 0 else 0.25
        return t

    def rank_of(self, slug: str) -> Optional[int]:
        return self.ranks["cfp"].get(slug) or self.ranks["ap"].get(slug)

    # -- players
    def _build(self) -> None:
        ss = self.state.get("season_stats", {})
        for slug, ts in ss.items():
            team = self.teams.get(slug)
            if not team or team["fictional"]:
                continue
            roster = {(p["name"], p["position"]): p for p in team["offense"] + team["defense"]}
            team_games = max(1, ts["games"])
            for key, p in ts["players"].items():
                rp = roster.get((p["name"], p["position"])) or {}
                st = p["stats"]
                role = rp.get("role")
                group = self._group(p["position"], role, st)
                if group is None:
                    continue
                self.players.append({
                    "key": f"{slug}|{key}", "name": p["name"], "position": p["position"], "role": role, "group": group,
                    "class": rp.get("class"), "team": slug, "team_name": team["name"], "conference": team["conference"],
                    "games": p["games"], "team_games": team_games, "stats": st, "ratings": rp,
                    "raw": {}, "z": {},
                })

    @staticmethod
    def _group(position: str, role: Optional[str], st: dict) -> Optional[str]:
        if position in ("QB", "RB", "WR", "TE", "OL", "K", "P"):
            return position
        if position == "DL":
            return "EDGE" if role in EDGE_ROLES else "DT"
        if position in LB_POSITIONS:
            return "LB"
        if position in DB_POSITIONS:
            return "DB"
        return None

    # -- raw production scores, written as "points" so the numbers read like a box score
    def _raw_scores(self, p: dict) -> dict[str, float]:
        st, g = p["stats"], p["group"]
        get = st.get
        out: dict[str, float] = {}
        if g == "QB":
            att = get("pass_attempts", 0)
            out["QB"] = (0.040 * get("pass_yards", 0) + 0.022 * get("rush_yards", 0)
                         + 3.0 * (get("passing_touchdowns", 0) + get("rushing_touchdowns", 0))
                         - 3.0 * get("interceptions_thrown", 0) - 0.4 * get("sacks_taken", 0) - 2.0 * get("fumbles", 0)
                         + (0.15 * (passer_rating(st) - 120) if att >= 60 else 0))
        elif g == "RB":
            out["RB"] = (0.07 * get("rush_yards", 0) + 0.05 * get("receiving_yards", 0)
                         + 4.0 * (get("rushing_touchdowns", 0) + get("receiving_touchdowns", 0))
                         + 1.2 * get("explosive_runs", 0) + 0.4 * get("rushing_first_downs", 0) - 4.0 * get("fumbles", 0))
        elif g in ("WR", "TE"):
            out[g] = (0.08 * get("receiving_yards", 0) + 4.0 * get("receiving_touchdowns", 0) + 0.45 * get("receptions", 0)
                      + 1.2 * get("explosive_catches", 0) + 0.04 * get("rush_yards", 0) + 3.0 * get("rushing_touchdowns", 0)
                      - 3.0 * get("fumbles", 0))
            if g == "TE":
                out[g] += 0.08 * (float(p["ratings"].get("run_blocking") or 50) - 50)
        elif g in ("EDGE", "DT"):
            out[g] = (1.0 * get("solo_tackles", 0) + 0.5 * get("assisted_tackles", 0) + 3.0 * get("tackles_for_loss", 0)
                      + 5.0 * get("sacks", 0) + 1.2 * get("hurries", 0) + 4.0 * get("forced_fumbles", 0)
                      + 3.0 * get("fumble_recoveries", 0) + 4.0 * get("interceptions", 0) + 1.5 * get("passes_defended", 0)
                      + 10.0 * get("defensive_touchdowns", 0))
        elif g == "LB":
            out[g] = (1.0 * get("solo_tackles", 0) + 0.5 * get("assisted_tackles", 0) + 2.5 * get("tackles_for_loss", 0)
                      + 4.0 * get("sacks", 0) + 5.0 * get("interceptions", 0) + 2.0 * get("passes_defended", 0)
                      + 4.0 * get("forced_fumbles", 0) + 3.0 * get("fumble_recoveries", 0) + 10.0 * get("defensive_touchdowns", 0))
        elif g == "DB":
            out[g] = (0.45 * get("solo_tackles", 0) + 0.2 * get("assisted_tackles", 0) + 2.0 * get("tackles_for_loss", 0)
                      + 3.0 * get("sacks", 0) + 9.0 * get("interceptions", 0) + 3.0 * get("passes_defended", 0)
                      + 4.0 * get("forced_fumbles", 0) + 3.0 * get("fumble_recoveries", 0) + 10.0 * get("defensive_touchdowns", 0)
                      + 0.05 * get("interception_return_yards", 0))
        elif g == "K":
            miss = get("fg_attempted", 0) - get("fg_made", 0)
            out[g] = (3.0 * get("fg_made", 0) + 1.0 * get("pat_made", 0) - 4.0 * miss
                      - 3.0 * (get("pat_attempts", 0) - get("pat_made", 0)) + 2.0 * get("fg_40_made", 0)
                      + 4.0 * get("fg_50_made", 0) + 0.3 * max(0, get("long_fg", 0) - 40))
        elif g == "P":
            punts = get("punts", 0)
            if punts >= 10:
                net = get("punt_net_yards", 0) / punts
                gross = get("punt_yards", 0) / punts
                out[g] = 4.0 * (net - 38) + 2.0 * (gross - 40) + 1.5 * get("punts_inside_20", 0) - 1.0 * get("punt_touchbacks", 0) \
                    + 0.3 * max(0, get("long_punt", 0) - 55)
            else:
                out[g] = -50.0
        elif g == "OL":
            r = p["ratings"]
            block = 0.5 * float(r.get("run_blocking") or 50) + 0.5 * float(r.get("pass_blocking") or 50)
            snaps = get("snaps", 0)
            out[g] = ((block - 50) * 1.2 * min(1.0, snaps / 650.0) + 2.0 * get("key_blocks", 0)
                      - 3.0 * get("sacks_allowed", 0) - 0.8 * get("pressures_allowed", 0) - 1.0 * get("stuffs_allowed", 0)
                      + 0.02 * snaps)
        # returners: anyone with returns competes for the return slot
        ret = get("kickoff_returns", 0) + get("punt_returns", 0)
        if ret >= 8:
            ry = get("kickoff_return_yards", 0) + get("punt_return_yards", 0)
            out["RS"] = 0.06 * ry + 8.0 * (get("kickoff_return_touchdowns", 0) + get("punt_return_touchdowns", 0)) \
                + 0.5 * (ry / ret - 18) * min(ret, 30)
        return out

    def _standardize(self) -> None:
        for p in self.players:
            p["raw"] = self._raw_scores(p)
        by_group: dict[str, list[float]] = {}
        for p in self.players:
            for g, v in p["raw"].items():
                by_group.setdefault(g, []).append(v)
        # the reference is the top of each pool (the players who actually play), so a long
        # bench does not drag the mean down
        params = {}
        for g, vals in by_group.items():
            top = sorted(vals, reverse=True)[: max(5, min(80, len(vals) // 4))]
            params[g] = _z(top)
        n_teams = max(1, sum(1 for t in self.teams.values() if not t["fictional"]))
        starters = {}
        for g, vals in by_group.items():
            top = sorted(vals, reverse=True)[: max(5, STARTERS_PER_TEAM.get(g, 1) * n_teams)]
            starters[g] = _z(top)
        for p in self.players:
            p["zb"] = {}
            for g, v in p["raw"].items():
                mean, sd = params[g]
                p["z"][g] = (v - mean) / sd
                bm, bs = starters[g]
                p["zb"][g] = (v - bm) / bs
        self.params = params

    # -- eligibility and lookups
    def played_enough(self, p: dict, share: float = 0.5) -> bool:
        return p["games"] >= share * p["team_games"] and p["team_games"] >= 3

    def by_group(self, group: str, **cond) -> list[dict]:
        # the players with a score in the group who played enough, listed once per group
        if group not in self._eligible:
            self._eligible[group] = [p for p in self.players if group in p["z"] and self.played_enough(p)]
        out = []
        for p in self._eligible[group]:
            if cond.get("conference") and p["conference"] != cond["conference"]:
                continue
            if cond.get("roles") and p["role"] not in cond["roles"]:
                continue
            if cond.get("classes") and p["class"] not in cond["classes"]:
                continue
            if cond.get("unit") == "offense" and p["group"] not in ("QB", "RB", "WR", "TE", "OL"):
                continue
            if cond.get("unit") == "defense" and p["group"] not in ("EDGE", "DT", "LB", "DB"):
                continue
            out.append(p)
        return out

    def heisman_score(self, p: dict) -> float:
        """Standardized production times the position prior, plus the team term."""
        best = max((p["zb"][g] * POSITION_PRIOR.get(g, 0.3) for g in p["zb"]), default=-9)
        if self.teams[p["team"]]["conference"] in G5:
            best *= 0.85
        return best + 0.45 * self.team_term(p["team"])

    def card(self, p: dict, group: Optional[str] = None) -> dict:
        g = group or p["group"]
        return {"name": p["name"], "position": p["position"], "role": p["role"], "class": p["class"], "team": p["team"],
                "team_name": p["team_name"], "conference": p["conference"], "games": p["games"],
                "line": stat_line(p, g), "headline": headline(p, g), "score": round(p["z"].get(g, 0), 2)}


def headline(p: dict, group: str) -> str:
    """The one number that sums up the season, for the award cards."""
    st = p["stats"]
    get = st.get
    if group == "QB":
        return f"{get('pass_yards', 0):,} yds · {get('passing_touchdowns', 0) + get('rushing_touchdowns', 0)} TD"
    if group == "RB":
        return f"{get('rush_yards', 0):,} yds · {get('rushing_touchdowns', 0) + get('receiving_touchdowns', 0)} TD"
    if group in ("WR", "TE"):
        return f"{get('receiving_yards', 0):,} yds · {get('receiving_touchdowns', 0)} TD"
    if group in ("EDGE", "DT"):
        return f"{get('sacks', 0):g} sacks · {get('tackles_for_loss', 0):g} TFL"
    if group == "LB":
        return f"{get('solo_tackles', 0) + get('assisted_tackles', 0)} tkl · {get('tackles_for_loss', 0):g} TFL"
    if group == "DB":
        return f"{get('interceptions', 0)} INT · {get('passes_defended', 0)} PBU"
    if group == "K":
        return f"{get('fg_made', 0)}/{get('fg_attempted', 0)} FG"
    if group == "P":
        n = max(1, get("punts", 0))
        return f"{get('punt_net_yards', 0) / n:.1f} net"
    if group == "OL":
        return f"{get('sacks_allowed', 0)} sacks allowed"
    if group == "RS":
        return f"{get('kickoff_return_yards', 0) + get('punt_return_yards', 0):,} ret yds"
    return ""


def stat_line(p: dict, group: str) -> str:
    """A one-line box score for the award cards."""
    st = p["stats"]
    get = st.get
    if group == "QB":
        return (f"{get('completions', 0)}/{get('pass_attempts', 0)}, {get('pass_yards', 0):,} yds, {get('passing_touchdowns', 0)} TD, "
                f"{get('interceptions_thrown', 0)} INT, {passer_rating(st):.1f} rtg; {get('rush_yards', 0):,} rush yds, {get('rushing_touchdowns', 0)} rush TD")
    if group == "RB":
        return (f"{get('carries', 0)} car, {get('rush_yards', 0):,} yds, {get('rushing_touchdowns', 0)} TD; "
                f"{get('receptions', 0)} rec, {get('receiving_yards', 0):,} yds, {get('receiving_touchdowns', 0)} TD")
    if group in ("WR", "TE"):
        line = f"{get('receptions', 0)} rec, {get('receiving_yards', 0):,} yds, {get('receiving_touchdowns', 0)} TD"
        return line + (f", {get('explosive_catches', 0)} plays of 25+" if get('explosive_catches', 0) else "")   # real box scores carry no play lengths
    if group in ("EDGE", "DT", "LB", "DB"):
        tk = get("solo_tackles", 0) + get("assisted_tackles", 0)
        return (f"{tk} tackles, {get('tackles_for_loss', 0):g} TFL, {get('sacks', 0):g} sacks, {get('interceptions', 0)} INT, "
                f"{get('passes_defended', 0)} PBU, {get('forced_fumbles', 0)} FF")
    if group == "K":
        return f"{get('fg_made', 0)}/{get('fg_attempted', 0)} FG, {get('fg_50_made', 0)}/{get('fg_50_att', 0)} from 50+, long {get('long_fg', 0)}, {get('pat_made', 0)}/{get('pat_attempts', 0)} PAT"
    if group == "P":
        n = max(1, get("punts", 0))
        return f"{get('punts', 0)} punts, {get('punt_yards', 0) / n:.1f} avg, {get('punt_net_yards', 0) / n:.1f} net, {get('punts_inside_20', 0)} inside 20"
    if group == "OL":
        return f"{get('snaps', 0)} snaps, {get('sacks_allowed', 0)} sacks allowed, {get('pressures_allowed', 0)} pressures, {get('key_blocks', 0)} key blocks"
    if group == "RS":
        ret = get("kickoff_returns", 0) + get("punt_returns", 0)
        ry = get("kickoff_return_yards", 0) + get("punt_return_yards", 0)
        return f"{ret} returns, {ry:,} yds, {ry / max(1, ret):.1f} avg, {get('kickoff_return_touchdowns', 0) + get('punt_return_touchdowns', 0)} TD"
    return ""


# ----- award selection ----------------------------------------------------------------


def _candidates(pool: Pool, kind: str, conference: Optional[str] = None) -> list[tuple[list[dict], str]]:
    """The (players, score group) pairs an award kind draws from."""
    conf = {"conference": conference} if conference else {}
    if kind in ("mvp", "mvp_team", "opoy", "versatile", "freshman", "off_freshman"):
        groups = ("QB", "RB", "WR", "TE")
        classes = {"classes": FRESHMAN} if kind in ("freshman", "off_freshman") else {}
        pairs = [(pool.by_group(g, **conf, **classes), g) for g in groups]
        if kind in ("mvp", "mvp_team", "freshman"):
            pairs += [(pool.by_group(g, **conf, **classes), g) for g in ("EDGE", "DT", "LB", "DB")]
        return pairs
    if kind in ("dpoy", "dpoy_alt", "def_freshman"):
        classes = {"classes": FRESHMAN} if kind == "def_freshman" else {}
        return [(pool.by_group(g, **conf, **classes), g) for g in ("EDGE", "DT", "LB", "DB")]
    if kind in ("qb", "rb", "wr", "te", "lb", "db", "k", "p", "rs"):
        g = kind.upper()
        if kind == "wr":
            return [(pool.by_group("WR", **conf), "WR"), (pool.by_group("TE", **conf), "TE")]
        return [(pool.by_group(g, **conf), g)]
    if kind == "qb_upper":
        return [(pool.by_group("QB", **conf, classes=UPPERCLASS), "QB")]
    if kind == "edge":
        return [(pool.by_group("EDGE", **conf), "EDGE")]
    if kind == "dl":
        return [(pool.by_group("EDGE", **conf), "EDGE"), (pool.by_group("DT", **conf), "DT")]
    if kind in ("ol", "blocker"):
        return [(pool.by_group("OL", **conf), "OL")]
    if kind == "c":
        return [(pool.by_group("OL", **conf, roles={"C"}), "OL")]
    if kind == "interior":
        return [(pool.by_group("OL", **conf), "OL"), (pool.by_group("DT", **conf), "DT")]
    if kind == "front":
        return [(pool.by_group(g, **conf), g) for g in ("OL", "EDGE", "DT", "LB")]
    if kind == "stpoy":
        return [(pool.by_group(g, **conf), g) for g in ("K", "P", "RS")]
    return []


def award_race(pool: Pool, kind: str, team_weight: float, rng: random.Random, conference: Optional[str] = None,
               n: int = 5, noise: float = 0.0) -> list[dict]:
    """Ranked hopefuls for one award: production z within each eligible group (scaled by the
    position prior for cross-position awards), plus the team term."""
    cross = kind in ("mvp", "mvp_team", "opoy", "dpoy", "dpoy_alt", "versatile", "freshman", "off_freshman", "def_freshman",
                     "interior", "front", "stpoy", "dl", "wr")
    rows = []
    for players, g in _candidates(pool, kind, conference):
        if kind in ("dpoy", "dpoy_alt", "def_freshman"):
            prior = {"EDGE": 1.3, "LB": 1.0, "DB": 0.78, "DT": 1.0}[g]   # history: LB and DE dominate, DTs win sometimes
        elif kind == "front":
            prior = {"OL": 0.85, "EDGE": 1.05, "DT": 0.95, "LB": 0.8}[g]   # Lombardi: linemen first
        elif kind == "wr":
            prior = {"WR": 1.0, "TE": 0.7}[g]   # the Biletnikoff has always gone to a wide receiver
        elif kind == "interior":
            prior = {"OL": 1.0, "DT": 0.95}[g]
        elif kind == "versatile":
            prior = 0.6
        elif cross and kind != "dl":
            prior = POSITION_PRIOR.get(g, 0.5)
        else:
            prior = 1.0
        for p in players:
            s = (p["zb"][g] if cross else p["z"][g]) * prior + team_weight * pool.team_term(p["team"])
            if kind == "versatile":
                s += 0.8 * p["z"].get("RS", -1.0) + (0.5 if "RS" in p["z"] else -1.5)
            if kind == "stpoy" and g == "RS":
                s += 0.3
            if noise:
                s += rng.gauss(0, noise)
            rows.append((s, p, g))
    rows.sort(key=lambda x: -x[0])
    seen = set()
    out = []
    for s, p, g in rows:
        if p["key"] in seen:
            continue
        seen.add(p["key"])
        c = pool.card(p, g)
        c["score"] = round(s, 2)
        out.append(c)
        if len(out) >= n:
            break
    return out


# ----- the Heisman vote ----------------------------------------------------------------


def heisman_vote(pool: Pool, rng: random.Random, n_candidates: int = 12, straw: bool = False) -> dict:
    """870 media voters in six regions, the past winners and a fan vote, each ranking three.
    A straw poll (in season) uses a tenth of the voters."""
    players = [p for p in pool.players if pool.played_enough(p, 0.4)]
    scored = sorted(((pool.heisman_score(p), p) for p in players), key=lambda x: -x[0])[:n_candidates]
    if not scored:
        return {"candidates": [], "winner": None, "finalists": [], "ballots": 0}
    cands = [p for _, p in scored]
    base = {p["key"]: s for s, p in scored}
    region_of = {}
    for p in cands:
        st = pool.teams[p["team"]].get("state")
        region_of[p["key"]] = next((r for r, states in REGIONS.items() if st in states), "South")
    voters = []
    per_region = 15 if straw else 145
    for region in REGIONS:
        voters += [(region, rng.gauss(0, 0.3)) for _ in range(per_region)]
    voters += [(None, rng.gauss(0.1, 0.3)) for _ in range(6 if straw else 57)]   # past winners
    voters += [(None, 0.0)]                                                      # the fan vote
    tally = {p["key"]: [0, 0, 0] for p in cands}
    for region, bias in voters:
        utility = []
        for p in cands:
            u = base[p["key"]] + rng.gauss(0, 0.6) + bias * pool.team_term(p["team"]) * 0.4
            if region and region_of[p["key"]] == region:
                u += 0.35
            utility.append((u, p["key"]))
        utility.sort(key=lambda x: -x[0])
        for place, (_, key) in enumerate(utility[:3]):
            tally[key][place] += 1
    rows = []
    for p in cands:
        f, s, t = tally[p["key"]]
        pts = 3 * f + 2 * s + t
        c = pool.card(p)
        c.update({"first": f, "second": s, "third": t, "points": pts, "region": region_of[p["key"]],
                  "record": f"{pool.records[p['team']]['wins']}-{pool.records[p['team']]['losses']}", "rank": pool.rank_of(p["team"])})
        rows.append(c)
    rows.sort(key=lambda r: (-r["points"], -r["first"]))
    total_ballots = len(voters)
    finalists = rows[:4]
    if len(rows) > 4 and rows[4]["points"] >= 0.9 * rows[3]["points"]:
        finalists = rows[:5]
    return {"candidates": rows, "winner": rows[0], "finalists": finalists, "ballots": total_ballots,
            "possible": 3 * total_ballots, "share": round(100 * rows[0]["points"] / (3 * total_ballots), 1)}


# ----- coaches ----------------------------------------------------------------------


def coach_table(pool: Pool, include_playoff: bool = False) -> list[dict]:
    """Every head coach with wins over expectation. Expectation comes from the roster's
    rating rank and the preseason poll, so a surprise season is what the award sees."""
    teams = pool.teams
    fbs = [s for s, t in teams.items() if not t["fictional"]]
    by_rating = sorted(fbs, key=lambda s: -teams[s]["team_ratings"]["overall"])
    rating_rank = {s: i for i, s in enumerate(by_rating)}
    pre = {e["team"]: e["rank"] for e in pool.state.get("polls", {}).get("0", {}).get("ap", [])}
    champions = pool.state.get("champions", {})
    bracket = pool.state.get("bracket") or {}
    seed_list = bracket.get("seeds") if isinstance(bracket, dict) else None
    seeds = {}
    for s in seed_list if isinstance(seed_list, list) else []:
        if isinstance(s, dict) and "team" in s:
            seeds[s["team"]] = s.get("seed")
    rows = []
    for slug in fbs:
        r = pool.records[slug]
        g = r["wins"] + r["losses"]
        if g < 6:
            continue
        exp_pct = 0.88 - 0.55 * rating_rank[slug] / max(1, len(fbs) - 1)
        if slug in pre:
            exp_pct = max(exp_pct, 0.9 - 0.012 * pre[slug])
        expected = exp_pct * g
        surprise = max(-4.0, min(4.0, r["wins"] - expected))
        hc = (teams[slug].get("coaches") or {}).get("head_coach") or {}
        champ = any(v == slug for v in champions.values())
        rank = pool.rank_of(slug)
        rows.append({"team": slug, "team_name": teams[slug]["name"], "conference": teams[slug]["conference"], "coach": hc.get("name"),
                     "g5": teams[slug]["conference"] in G5,
                     "wins": r["wins"], "losses": r["losses"], "expected": round(expected, 1), "surprise": round(surprise, 2),
                     "champion": champ, "rank": rank, "preseason_rank": pre.get(slug), "seed": seeds.get(slug),
                     "national_champion": pool.state.get("champion") == slug})
    return rows


def coach_award(rows: list[dict], win_weight: float, surprise_weight: float, rng: random.Random, title: bool = False) -> list[dict]:
    scored = []
    for c in rows:
        s = surprise_weight * c["surprise"] + win_weight * (c["wins"] - 8) + (0.8 if c["champion"] else 0) + _rank_bonus(c["rank"]) * 1.2
        if c["losses"] >= 4:
            s -= 1.0 * (c["losses"] - 3)
        if c.get("g5") and c["losses"] > 1:
            s -= 1.8
        if c["preseason_rank"] is None:
            s += 0.4 * surprise_weight
        elif c["preseason_rank"] <= 5:
            s -= 1.2 * surprise_weight
        if title:
            s += 3.0 if c["national_champion"] else 0
        s += rng.gauss(0, 0.35)
        scored.append((s, c))
    scored.sort(key=lambda x: -x[0])
    return [{**c, "score": round(s, 2)} for s, c in scored[:5]]


def broyles_table(pool: Pool) -> list[dict]:
    """Coordinators: the unit's scoring rank against its rating rank, plus wins."""
    teams, ss = pool.teams, pool.state.get("season_stats", {})
    fbs = [s for s in ss if s in teams and not teams[s]["fictional"] and ss[s]["games"] >= 6]
    off = sorted(fbs, key=lambda s: -ss[s]["points"] / ss[s]["games"])
    dfn = sorted(fbs, key=lambda s: ss[s]["opp_points"] / ss[s]["games"])
    off_rank = {s: i for i, s in enumerate(off)}
    def_rank = {s: i for i, s in enumerate(dfn)}
    off_rating = {s: i for i, s in enumerate(sorted(fbs, key=lambda s: -teams[s]["team_ratings"]["offense"]))}
    def_rating = {s: i for i, s in enumerate(sorted(fbs, key=lambda s: -teams[s]["team_ratings"]["defense"]))}
    rows = []
    for slug in fbs:
        coaches = teams[slug].get("coaches") or {}
        wins = pool.records[slug]["wins"]
        for role, key, rank, rrank in (("Offensive coordinator", "offensive_coordinator", off_rank, off_rating),
                                       ("Defensive coordinator", "defensive_coordinator", def_rank, def_rating)):
            c = coaches.get(key) or {}
            if not c.get("name"):
                continue
            gain = (rrank[slug] - rank[slug]) / max(1, len(fbs)) * 6
            if rank[slug] < 10:
                unit_bonus = 2.0
            elif rank[slug] < 25:
                unit_bonus = 0.8
            else:
                unit_bonus = 0
            s = gain + 0.6 * (wins - 8) + unit_bonus + 0.8 * _rank_bonus(pool.rank_of(slug))
            rows.append({"coach": c["name"], "role": role, "team": slug, "team_name": teams[slug]["name"], "unit_rank": rank[slug] + 1,
                         "rating_rank": rrank[slug] + 1, "wins": wins, "score": round(s, 2)})
    rows.sort(key=lambda r: -r["score"])
    return rows[:5]


def ol_units(pool: Pool) -> list[dict]:
    """Joe Moore Award: the line as a unit."""
    teams, ss = pool.teams, pool.state.get("season_stats", {})
    rows = []
    for slug, ts in ss.items():
        if slug not in teams or teams[slug]["fictional"] or ts["games"] < 8:
            continue
        t = ts["team"]
        att = t.get("Pass Attempts", 0) + t.get("Sacks Taken", 0)
        sack_rate = t.get("Sacks Taken", 0) / att if att else 0.1
        ypc = t.get("Rush Yards", 0) / t.get("Carries", 1)
        rows.append({"team": slug, "team_name": teams[slug]["name"], "conference": teams[slug]["conference"],
                     "sack_rate": round(100 * sack_rate, 1), "ypc": round(ypc, 2), "rush_ypg": round(t.get("Rush Yards", 0) / ts["games"], 1),
                     "wins": pool.records[slug]["wins"]})
    if not rows:
        return []
    m_s, sd_s = _z([r["sack_rate"] for r in rows])
    m_y, sd_y = _z([r["ypc"] for r in rows])
    for r in rows:
        r["score"] = round(-(r["sack_rate"] - m_s) / sd_s + (r["ypc"] - m_y) / sd_y + 0.12 * (r["wins"] - 8), 2)
    rows.sort(key=lambda r: -r["score"])
    return rows[:5]


# ----- All-America and all-conference teams ---------------------------------------------


def _slot_pool(pool: Pool, slot: str, conference: Optional[str]) -> tuple[list[dict], str]:
    conf = {"conference": conference} if conference else {}
    if slot in ("QB", "RB", "WR", "TE", "K", "P", "LB", "DB", "EDGE", "DT", "OL", "RS"):
        return pool.by_group(slot, **conf), slot
    if slot == "C":
        return pool.by_group("OL", **conf, roles={"C"}), "OL"
    if slot == "G":
        return pool.by_group("OL", **conf, roles={"LG", "RG"}), "OL"
    if slot == "T":
        return pool.by_group("OL", **conf, roles={"LT", "RT"}), "OL"
    if slot == "CB":
        return pool.by_group("DB", **conf, roles={"CB"}), "DB"
    if slot == "S":
        return pool.by_group("DB", **conf, roles={"FS", "SS"}), "DB"
    if slot == "DL":
        return pool.by_group("EDGE", **conf) + pool.by_group("DT", **conf), None
    if slot == "AP":
        return [p for p in pool.by_group("RB", **conf) + pool.by_group("WR", **conf) if "RS" in p["z"]], None
    return [], slot


def select_team(pool: Pool, slots: list[tuple[str, int]], team_weight: float, noise: float, rng: random.Random,
                conference: Optional[str] = None, levels: int = 1) -> list[dict]:
    """Fill the slots for `levels` teams (first, second, ...), specific sub-positions first so
    the generic slots (OL, DL, DB) take what is left. Returns [{"slot", "level", card}]."""
    order = sorted(range(len(slots)), key=lambda i: 0 if slots[i][0] in ("C", "G", "T", "CB", "S", "EDGE", "DT") else 1)
    taken: set[str] = set()
    out = []
    utilities: dict[str, float] = {}

    def utility(p: dict, g: Optional[str]) -> float:
        key = (p["key"], g)
        if key not in utilities:
            gg = g or p["group"]
            u = p["z"][gg] + team_weight * pool.team_term(p["team"]) + rng.gauss(0, noise)
            if gg == "RS":
                # a return slot ignores the team; the first draw above is still taken so the
                # random stream (and every later pick) stays the same
                u = p["z"]["RS"] + rng.gauss(0, noise)
            utilities[key] = u
        return utilities[key]

    for level in range(1, levels + 1):
        for i in order:
            slot, n = slots[i]
            players, g = _slot_pool(pool, slot, conference)
            if slot == "AP":
                ranked = sorted(players, key=lambda p: -(p["z"][p["group"]] * 0.6 + p["z"]["RS"] * 0.6 + rng.gauss(0, noise)))
            else:
                ranked = sorted(players, key=lambda p: -utility(p, g))
            picked = 0
            for p in ranked:
                if p["key"] in taken:
                    continue
                taken.add(p["key"])
                c = pool.card(p, g or p["group"])   # the all-purpose and generic DL slots score each player at his own group
                out.append({"slot": slot, "level": level, **c})
                picked += 1
                if picked >= n:
                    break
    return out


def all_america(pool: Pool, rng: random.Random) -> dict:
    """Five selectors, each with first and second teams; consensus is first team on three of
    the five, unanimous on all five."""
    teams = {name: select_team(pool, AA_SLOTS, tw, noise, rng, levels=2) for name, (tw, noise) in SELECTORS.items()}
    counts: dict[str, dict] = {}
    for name, picks in teams.items():
        for c in picks:
            key = f"{c['team']}|{c['name']}|{c['position']}"
            rec = counts.setdefault(key, {**c, "first_teams": [], "second_teams": []})
            (rec["first_teams"] if c["level"] == 1 else rec["second_teams"]).append(name)
    consensus = []
    for key, rec in counts.items():
        n1 = len(rec["first_teams"])
        if n1 >= 3:
            rec = dict(rec)
            rec["unanimous"] = n1 == 5
            rec["selectors"] = n1
            consensus.append(rec)
    slot_order = {s: i for i, (s, _) in enumerate(AA_SLOTS)}
    consensus.sort(key=lambda r: (slot_order.get(r["slot"], 99), -r["selectors"], -r["score"]))
    return {"selectors": teams, "consensus": consensus, "unanimous": [r for r in consensus if r["unanimous"]]}


def all_conference(pool: Pool, conference: str, rng: random.Random) -> dict:
    layout = CONF_LAYOUTS.get(conference)
    if not layout:
        return {}
    selectors, levels, slots = layout
    out = {}
    for sel in selectors:
        tw = 0.45 if sel == "Coaches" else 0.25
        out[sel] = select_team(pool, slots, tw, 0.35, rng, conference=conference, levels=levels)
    return {"selectors": out, "levels": levels}


# ----- the season steps -------------------------------------------------------------------


def _rng(state: dict, salt: str) -> random.Random:
    return random.Random(f"{state.get('seed', 0)}|{state['id']}|{salt}")


def conference_awards(pool: Pool, state: dict, final: bool = True) -> dict:
    """Every conference's awards and all-conference teams (week 14)."""
    rng = _rng(state, "conference")
    coaches = coach_table(pool)
    out = {}
    for conf, awards in CONF_AWARDS.items():
        if not any(t["conference"] == conf and not t["fictional"] for t in pool.teams.values()):
            continue
        entry = {"awards": [], "teams": all_conference(pool, conf, rng) if final else {}}
        for name, kind in awards:
            if kind == "coach":
                rows = [c for c in coaches if c["conference"] == conf]
                race = coach_award(rows, 0.5, 1.0, rng)
            else:
                tw = {"mvp": 0.5, "opoy": 0.35, "dpoy": 0.2}.get(kind, 0.3)
                race = award_race(pool, kind, tw, rng, conference=conf, n=5, noise=0.15 if final else 0.0)
            entry["awards"].append({"name": name, "kind": kind, **_podium(race)})
        out[conf] = entry
    return out


def national_awards(pool: Pool, state: dict, final: bool = True) -> dict:
    """The Heisman vote, the national player awards, coach awards and All-America (week 15)."""
    rng = _rng(state, "national")
    heisman = heisman_vote(pool, rng, straw=not final)
    noise = 0.2 if final else 0.0
    awards = []
    for name, kind, tw, honors in NATIONAL_AWARDS:
        # the Walter Camp is scored like the other player of the year awards, with its own team weight
        race = award_race(pool, "mvp" if kind == "mvp_team" else kind, tw, rng, n=5, noise=noise)
        awards.append({"name": name, "kind": kind, "honors": honors, **_podium(race), "race": race})
    coaches = coach_table(pool)
    coach_awards = []
    for name, ww, sw in COACH_AWARDS:
        race = coach_award(coaches, ww, sw, rng)
        coach_awards.append({"name": name, **_podium(race)})
    broyles = broyles_table(pool)
    coach_awards.append({"name": "Broyles Award", **_podium(broyles), "assistant": True})
    out = {"heisman": heisman, "awards": awards, "coach_awards": coach_awards}
    if final:
        out["all_america"] = all_america(pool, rng)
    return out


def postseason_awards(pool: Pool, state: dict) -> dict:
    """After the national championship (week 20): Manning, Bear Bryant, Joe Moore."""
    rng = _rng(state, "postseason")
    out = []
    manning = award_race(pool, "qb", 0.7, rng, n=5, noise=0.2)
    out.append({"name": "Manning Award", "kind": "qb", "honors": "best quarterback, bowls and playoff included", **_podium(manning)})
    bryant = coach_award(coach_table(pool, include_playoff=True), 0.6, 0.6, rng, title=True)
    out.append({"name": "Paul \"Bear\" Bryant Award", "kind": "coach", "honors": "coach of the year, after the playoff", **_podium(bryant)})
    moore = ol_units(pool)
    out.append({"name": "Joe Moore Award", "kind": "ol_unit", "honors": "best offensive line", **_podium(moore)})
    return {"awards": out}


# ----- views ---------------------------------------------------------------------------------


def my_awards(state: dict, awards: dict) -> list[dict]:
    """Everything your team won or placed in, across every stage, as flat cards."""
    me = state["team"]
    out = []

    def add(stage: str, award: str, c: Optional[dict], place: str) -> None:
        if c and c.get("team") == me:
            # a unit award (the Joe Moore Award goes to an offensive line) has no one person
            unit = not (c.get("name") or c.get("coach"))
            out.append({"stage": stage, "award": award, "place": place,
                        "who": c.get("name") or c.get("coach") or f"{c.get('team_name', 'Your')} offensive line",
                        "position": "OL" if unit else c.get("position"), "line": c.get("line", "")})

    def add_award(stage: str, a: dict) -> None:
        """The winner and the other finalists of one award."""
        add(stage, a["name"], a.get("winner"), "winner")
        for c in a.get("finalists", [])[1:]:
            add(stage, a["name"], c, "finalist")

    nat = awards.get("national") or {}
    h = nat.get("heisman") or {}
    for i, c in enumerate(h.get("candidates", [])[:10]):
        if i == 0:
            place = "winner"
        else:
            place = f"{_ordinal(i + 1)} in the vote, {c['points']} points" + (" (finalist)" if c in h.get("finalists", []) else "")
        add("Heisman Trophy", "Heisman Trophy", c, place)
    for a in nat.get("awards", []) + (awards.get("postseason") or {}).get("awards", []):
        add_award("National awards", a)
    for a in nat.get("coach_awards", []):
        add_award("Coach awards", a)
    aa = nat.get("all_america") or {}
    for c in aa.get("consensus", []):
        add("All-America", "Consensus All-American" + (" (unanimous)" if c.get("unanimous") else ""), c, c["slot"])
    for sel, picks in (aa.get("selectors") or {}).items():
        for c in picks:
            add("All-America", f"{sel} All-America {'first' if c['level'] == 1 else 'second'} team", c, c["slot"])
    for conf, entry in (awards.get("conference") or {}).items():
        for a in entry.get("awards", []):
            add_award(f"{conf} awards", a)
        for sel, picks in (entry.get("teams") or {}).get("selectors", {}).items():
            for c in picks:
                add(f"All-{conf}", f"{sel} {['first', 'second', 'third'][c['level'] - 1]} team", c, c["slot"])
    return out


def race_view(state: dict, teams: dict, records: dict) -> dict:
    """The live picture during the season: Heisman straw poll, every national award's
    hopefuls, and your conference's award races."""
    pool = Pool(state, teams, records)
    if not pool.players:
        return {"live": True, "heisman": None, "awards": [], "coach_awards": [], "conference": {}}
    nat = national_awards(pool, state, final=False)
    conf = teams[state["team"]]["conference"]
    conf_entry = {}
    if conf in CONF_AWARDS:
        conf_entry = conference_awards(pool, state, final=False).get(conf, {})
    return {"live": True, "heisman": nat["heisman"], "awards": nat["awards"], "coach_awards": nat["coach_awards"],
            "conference": {conf: conf_entry} if conf_entry else {}}

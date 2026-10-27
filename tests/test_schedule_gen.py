"""Generated schedules (sim/schedule_gen.py): 2027 through 2032 from the 2026 history, each one
following the conferences' rules, and a career that rolls from 2026 into a generated 2027.
(Run as a file: multiprocessing on Windows.)"""
import collections
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from sim import schedule_gen as sg
from sim import season

if __name__ == "__main__":
    teams = season.load_teams()
    fbs = {s: t for s, t in teams.items() if not t["fictional"]}
    conf_of = {s: t["conference"] for s, t in fbs.items()}
    R, S = sg.rules(), sg.series()
    power = set(R["power"])
    hist = sg.seed_history(teams)
    met_site: dict = {}            # pair -> (year, home) of the last meeting, to check sites alternate
    met_year: dict = {}
    home_count: dict = collections.defaultdict(dict)
    rng = random.Random(7)
    for year in range(2027, 2033):
        games, hist = sg.generate(year, teams, hist, rng)
        by_team = collections.defaultdict(list)
        for g in games.values():
            for s in (g["home"], g["away"]):
                by_team[s].append(g)
        # twelve games, one a week, every FBS team
        for s in fbs:
            assert len(by_team[s]) == sg.GAMES, (year, s, len(by_team[s]))
            weeks = [g["week"] for g in by_team[s]]
            assert len(set(weeks)) == len(weeks), (year, s, sorted(weeks))
            assert all(1 <= w <= sg.LAST_WEEK or w == sg.ARMY_NAVY_WEEK for w in weeks), (year, s, weeks)
            home_count[s][year] = sum(1 for g in by_team[s] if g["home"] == s and not g["neutral"])
        # league counts and protected pairs
        for conf, rule in R["conferences"].items():
            members = [s for s in fbs if conf_of[s] == conf]
            k = sg._league_games(rule, year)
            eight = (rule.get("eight_game_team") or {}).get(str(year))
            odd_one = sorted(members)[year % len(members)] if (len(members) * k - (1 if eight in members else 0)) % 2 else None
            for s in members:
                n = sum(1 for g in by_team[s] if g["conference_game"])
                want = k - 1 if s in (eight, odd_one) else k
                assert n == want, (year, conf, s, n, want)
            for a, b in rule.get("protected", []):
                assert any({g["home"], g["away"]} == {a, b} for g in games.values()), (year, conf, a, b)
            for div in (rule.get("divisions") or {}).values():
                for i, a in enumerate(div):
                    for b in div[i + 1:]:
                        assert any({g["home"], g["away"]} == {a, b} for g in games.values()), (year, "division", a, b)
            # FCS and Power rules
            nc = rule["non_conference"]
            for s in members:
                fcs = sum(1 for g in by_team[s] if teams[g["home"]]["fictional"] or teams[g["away"]]["fictional"])
                assert fcs <= nc.get("fcs_max", 1), (year, s, fcs)
                opps = [g["away"] if g["home"] == s else g["home"] for g in by_team[s] if not g["conference_game"]]
                powers = sum(1 for o in opps if conf_of.get(o) in power or o in R["power_independents"])
                if conf in power:
                    need = nc.get("power_min_eight_game", nc["power_min"]) if s == eight else nc["power_min"]
                    assert powers >= need, (year, s, powers, need, opps)
                else:
                    road = sum(1 for g in by_team[s] if g["away"] == s and (conf_of.get(g["home"]) in power or g["home"] in R["power_independents"]))
                    assert road >= nc["power_road"][0], (year, s, road, opps)
        # sites alternate and no pair meets twice; the pair's last site is remembered
        seen = set()
        for g in games.values():
            key = sg.pair_key(g["home"], g["away"])
            assert key not in seen, (year, key)
            seen.add(key)
            last = met_site.get(key)
            if last and not g["neutral"] and not last[2] and last[0] == year - 1 and conf_of.get(g["home"]) == conf_of.get(g["away"]):
                assert last[1] != g["home"], (year, key, "same site two years running")
            met_site[key] = (year, g["home"], g["neutral"])
            met_year.setdefault(key, []).append(year)
        # announced series in their year at their site; annual series every year; finales in week 14; Army-Navy on selection weekend
        due = [a for a in S["announced"] if a["year"] == year and a["home"] in fbs and a["away"] in fbs]

        def fixed_load(team: str) -> int:
            """Annual series and announced games on a team's plate this year, against its non-conference allowance."""
            ann = sum(1 for x in S["annual"] if team in x["teams"] and not (x.get("first") and year < x["first"]) and not (x.get("last") and year > x["last"]))
            return ann + sum(1 for x in due if team in (x["home"], x["away"]))

        def allowance(team: str) -> int:
            rule = R["conferences"].get(conf_of[team])
            return sg.GAMES - (sg._league_games(rule, year) if rule else 0)

        for a in due:
            g = next((g for g in games.values() if g["home"] == a["home"] and g["away"] == a["away"]), None)
            if g is None:
                # dropped only when one side's annual and announced dates already exceed its allowance
                assert any(fixed_load(x) > allowance(x) for x in (a["home"], a["away"])), (year, a)
            else:
                assert g["neutral"] == bool(a.get("neutral")), (year, a)
        for s in S["annual"]:
            a, b = s["teams"]
            if a in fbs and b in fbs and not (s.get("first") and year < s["first"]) and not (s.get("last") and year > s["last"]):
                g = next((g for g in games.values() if {g["home"], g["away"]} == {a, b}), None)
                assert g is not None, (year, s["name"])
                if s.get("finale"):
                    assert g["week"] == sg.FINALE_WEEK, (year, s["name"], g["week"])
                if s.get("week") == 16:
                    assert g["week"] == sg.ARMY_NAVY_WEEK
        for conf, rule in R["conferences"].items():
            for a, b in rule.get("finales", []):
                g = next((g for g in games.values() if {g["home"], g["away"]} == {a, b}), None)
                if g is not None:
                    assert g["week"] == sg.FINALE_WEEK, (year, conf, a, b, g["week"])
        # Notre Dame's five ACC games and Navy
        nd = [g["away"] if g["home"] == "notre-dame" else g["home"] for g in by_team["notre-dame"]]
        assert sum(1 for o in nd if conf_of.get(o) == "ACC") == 5 and "navy" in nd and "clemson" in nd, (year, nd)
        # a stand-in is shown as its region, never a real FCS school
        for g in games.values():
            if teams[g["away"]]["fictional"]:
                assert g["away_display"].startswith("FCS "), g["away_display"]
                assert g["home"] == g["home"] and not teams[g["home"]]["fictional"]
    # every conference pair met within the cycle (2027-2032 covers the SEC's and Big 12's four-year cycles twice over)
    for conf, rule in R["conferences"].items():
        members = sorted(s for s in fbs if conf_of[s] == conf)
        cycle = rule["cycle"]
        if cycle > 6:
            continue
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                years = met_year.get(sg.pair_key(a, b), [])
                assert years, (conf, a, b, "never met 2027-2032")
                gaps = [y2 - y1 for y1, y2 in zip([2026] + years, years)]
                assert max(gaps) <= cycle + 1, (conf, a, b, years, cycle)
    # home games year to year: never a swing of three, and mostly a swing of one or none (league home games alternate
    # 5/4 and a home-and-home flips with them half the time, so a two happens)
    swings = [abs(home_count[s][y] - home_count[s][y - 1]) for s in fbs for y in range(2028, 2033)]
    assert max(swings) <= 3, max(swings)
    assert sum(1 for x in swings if x == 3) <= 0.03 * len(swings), sum(1 for x in swings if x == 3) / len(swings)
    assert sum(1 for x in swings if x <= 1) >= 0.75 * len(swings), sum(1 for x in swings if x <= 1) / len(swings)
    counts = [home_count[s][y] for s in fbs for y in range(2027, 2033)]
    assert all(4 <= n <= 9 for n in counts), [(s, y, home_count[s][y]) for s in fbs for y in range(2027, 2033) if not 4 <= home_count[s][y] <= 9][:5]
    assert sum(1 for n in counts if not 5 <= n <= 8) <= 0.03 * len(counts), sum(1 for n in counts if not 5 <= n <= 8) / len(counts)
    # a career rolls from 2026 into a generated 2027 and plays a week of it
    from coach_career import offseason
    from tests.test_offseason import finished
    st = season.new_season("smu", "full", seed=3, career=True)
    finished(st)
    offseason.start(st)
    offseason.run_all(st)
    new = offseason.next_season(st)
    assert new["year"] == 2027 and len([g for g in new["games"].values() if "smu" in (g["home"], g["away"]) and g["kind"] == "regular"]) == 12
    assert new["league"].get("schedule_history") and 2027 in new["league"]["schedule_history"]["years"]
    eids = set(new["games"])
    assert all(e.startswith("2027-") for e in eids if new["games"][e]["kind"] == "regular"), "2027's games are generated, not the 2026 file's"
    season.advance_to(new, 1)
    played = [g for g in new["games"].values() if g["played"]]
    assert played, "the generated week was simulated"
    print(f"schedule gen ok: 2027-2032 generated, {len(fbs)} teams x 12 games each year, every rule held; a career rolled into 2027 and played week 1")

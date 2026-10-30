"""No real FCS school is named anywhere a career shows games: the fictional stand-ins
(data/fcs_map.json maps every real FCS opponent on the 2026 schedules to one of eight) are
labeled "FCS <region>" on schedules, results, week lists, box scores and the next season's
schedule; the real names live only in the map and the strength tiers."""
import json
import re
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import season
from test_offseason import finished


def real_fcs_names() -> list[str]:
    m = json.loads(season.FCS_MAP_FILE.read_text(encoding="utf-8"))
    teams = season.load_teams()
    fbs = {t["name"] for t in teams.values()} | {t.get("school") or "" for t in teams.values()}
    full = {v["name"] for v in m.values()} | {n for tier in season.FCS_TIERS.values() for n in tier}
    names = {n for n in full | {n.rsplit(" ", 1)[0] for n in full} if " " in n and n not in fbs and not any(n in f for f in fbs)}
    return sorted(names, key=len, reverse=True)


if __name__ == "__main__":
    names = real_fcs_names()
    assert len(names) > 100, len(names)
    pat = re.compile("(" + "|".join(re.escape(n) for n in names) + ")")
    found = {}

    def scan(obj, label):
        hits = sorted(set(pat.findall(json.dumps(obj))))
        if hits:
            found[label] = hits[:5]

    st = season.new_season("smu", "full", seed=3, career=True)
    season.advance_to(st, 3)
    fict = [g for g in st["games"].values() if season.state_fictional(g["home"]) or season.state_fictional(g["away"])]
    assert fict and all(g["home_display"].startswith("FCS") or g["away_display"].startswith("FCS") for g in fict), [(g["home_display"], g["away_display"]) for g in fict[:3]]
    scan(st["games"], "games"); scan(season.summary(st), "summary"); scan(season.standings(st), "standings")
    scan(season.team_schedule_view(st, "smu"), "my schedule")
    scan(season.team_schedule_view(st, fict[0]["home"] if season.state_fictional(fict[0]["home"]) else fict[0]["away"]), "fcs team schedule")
    for w in range(1, 21):
        scan(season.week_view(st, w), f"week {w}")
    played = next(g for g in fict if g["played"])
    scan(season.load_box(st, played["event_id"]) or {}, "box score")
    scan([t for t in season.load_teams().values() if t["fictional"]], "fictional teams")
    scan(season.schedule_options(season.new_season("smu", "full", seed=4, career=True), next(g["event_id"] for g in season.schedule_editable(season.new_season("smu", "full", seed=4, career=True)))), "trade options")
    # the next season's schedule keeps the stand-ins
    finished(st)
    offseason.run_all(st)
    new = offseason.next_season(st)
    fict2 = [g for g in new["games"].values() if season.state_fictional(g["home"]) or season.state_fictional(g["away"])]
    assert fict2 and all(g["home_display"].startswith("FCS") or g["away_display"].startswith("FCS") for g in fict2)
    scan(new["games"], "next season's games"); scan(season.team_schedule_view(new, "smu"), "next season's schedule")
    season.close_pool()
    assert not found, found
    print(f"no real FCS names ok: {len(names)} names looked for across {len(fict)} FCS games, two seasons, box scores and week lists")

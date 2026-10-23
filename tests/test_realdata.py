"""The real box score import (realdata.py): names match through accents, apostrophes,
nicknames and a lost first name; the jersey fallback stays on the stat's side of the ball;
an unmatched player's position comes from his whole line; net punting sits under gross."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from sim import realdata as rd  # noqa: E402

ROSTER = {"offense": [{"name": "Zacharyus Williams", "position": "WR", "jersey": "0", "slug": "zw"},
                      {"name": "Theo Melin Öhrström", "position": "TE", "jersey": "18", "slug": "tmo"},
                      {"name": "Duke Clark", "position": "RB", "jersey": "20", "slug": "dc"},
                      {"name": "Cam Pruitt", "position": "WR", "jersey": "4", "slug": "cp"}],
          "defense": [{"name": "Jontez Williams", "position": "CB", "jersey": "0", "slug": "jw"},
                      {"name": "Ja'Bari Odoemenem", "position": "ROLB", "jersey": "3", "slug": "jo"},
                      {"name": "Kenny Soares Jr.", "position": "DL", "jersey": "23", "slug": "ks"},
                      {"name": "Kanye Clark", "position": "CB", "jersey": "20", "slug": "kc"},
                      {"name": "Xavion Griffin", "position": "CB", "jersey": "10", "slug": "xg"},
                      {"name": "Maurice Parker", "position": "CB", "jersey": "26", "slug": "mp"}]}


def slug(first, last, number, side):
    p = rd.RosterMatcher(ROSTER).find(first, last, number, side)
    return p["slug"] if p else None


if __name__ == "__main__":
    assert slug("JABARI", "ODOEMENEM", 3, "defense") == "jo"                 # apostrophe
    assert slug("THEO", "MELIN \ufffdHRSTR\ufffdM", 18, "offense") == "tmo"  # letters lost in the feed
    assert slug('XAVION "TUTU"', "GRIFFIN", 10, "defense") == "xg"           # quoted nickname
    assert slug("JR.", "SOARES", 1, "defense") == "ks"                       # first name lost, Jr. first
    assert slug("JONTEZ", "WILLIAMS", 0, "offense") == "zw"                    # one name for two #0s: the catch is the WR's
    assert slug("JONTEZ", "WILLIAMS", 0, "defense") == "jw"
    assert slug("KANYE", "CLARK", 20, "offense") == "dc"
    assert slug("MARCANTHONY", "PARKER", 56, "defense") is None              # a different player, not Maurice
    assert slug("CAMERON", "PRUITT", 22, "offense") == "cp"
    assert rd.guess_position({"pass_attempts": 54, "carries": 115}, 7) == "QB"
    assert rd.guess_position({"pass_attempts": 2, "carries": 40}, 7) == "RB"
    assert rd.guess_position({"solo_tackles": 20, "assisted_tackles": 10}, 92) == "DL"
    assert rd.guess_position({"solo_tackles": 20, "assisted_tackles": 10}, 44) == "MLB"
    assert rd.guess_position({"solo_tackles": 20, "interceptions": 2}, 21) == "S"
    assert rd.display_name("JR.", "SOARES") == "Soares Jr." and rd.display_name("CALVIN", "RUSSELL III") == "Calvin Russell III"

    # net punting: returns of -4 yards still leave net under gross (the touchback charge)
    players = [{"stats": {"punts": 5, "punt_yards": 220}}]
    rd.fill_special_teams(players, {"teamStats": {"TeamPuntReturnsStats": {"puntReturnYards": "-4"}}})
    assert players[0]["stats"]["punt_net_yards"] < 220, players

    # a game against an FCS school (Iowa vs UNI, 9/19) is played by the fictional stand-in:
    # found by date, and UNI's team box goes to the stand-in's side
    if (rd.BOX_DIR / "6603607.json").exists():
        lookup = rd.build_matcher(rd.season.load_teams())
        index = rd._ncaa_index(lookup)
        assert any(c[1] == 6603607 for c in index[frozenset(("iowa", rd.FCS))])
        game = {"played": True, "real": True, "week": 3, "home": "iowa", "away": "red-prairie-state"}
        on_day = {"games": {"e1": {**game, "date": "2026-09-19T23:00Z"}}}
        (_, _, cid, sides), = rd._real_games(on_day, index, lookup, {"red-prairie-state"})
        assert cid == 6603607 and set(sides) == {"home", "away"}
        week_off = {"games": {"e1": {**game, "date": "2026-09-26T23:00Z"}}}
        assert not [x for x in rd._real_games(week_off, index, lookup, {"red-prairie-state"}) if x[2] == 6603607]
    print("real import: names, sides, positions, net punting and FCS games as expected")

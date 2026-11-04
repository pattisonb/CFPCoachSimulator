"""Recruit personas (persona.py): the draw is seeded, shares hold, a class gets them, old saves draw lazily."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona
from sim import season

if __name__ == "__main__":
    # test_draw_is_deterministic
    assert persona.draw("p1", 7) == persona.draw("p1", 7)
    assert any(persona.draw("p1", 7) != persona.draw(f"q{i}", 7) for i in range(20))

    # test_shares
    n = 5000
    draws = [persona.draw(f"x{i}", 3) for i in range(n)]
    for k in persona.PERSONALITIES:
        share = sum(d["personality"] == k for d in draws) / n
        assert 0.17 <= share <= 0.23, (k, share)
    for k, want in persona.DECIDERS.items():
        share = sum(d["decider"] == k for d in draws) / n
        assert abs(share - want) <= 0.03, (k, share)
    for d in draws:
        assert (d["decider_topic"] is None) == (d["decider"] == "self"), d
        if d["decider"] != "self":
            assert d["decider_topic"] in persona.DECIDER_TOPICS[d["decider"]], d

    # test_class_gets_personas
    st = season.new_season("ohio-state", "full", seed=4, career=True)
    rc = st["recruiting"]
    assert not any("persona" in p for p in rc["prospects"].values()), "the persona is a fixed draw: never stored in the save"
    assert all(persona.of(st, pid) == persona.draw(pid, rc["seed"]) for pid in list(rc["prospects"])[:50])
    assert not any("persona" in p for p in rc["prospects"].values()), "reading a persona must not store it"

    # test_old_save_keeps_its_persona: a save from before stored one; it is read as is
    pid = next(iter(rc["prospects"]))
    rc["prospects"][pid]["persona"] = {"personality": "shy", "decider": "mom", "decider_topic": "academics"}
    assert persona.of(st, pid) == {"personality": "shy", "decider": "mom", "decider_topic": "academics"}
    del rc["prospects"][pid]["persona"]
    assert persona.of(st, pid) == persona.draw(pid, rc["seed"])
    print("test_persona: ok")

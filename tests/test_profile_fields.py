"""The recruit profile overhaul's server fields (coach_career/prospects.py): the position as the game's display
(display_pos: LEDG -> EDGE, DT stays DT), his rank at that position (pos_rank, by national order), height and weight
as text, the class year, and the Scouting Report written from your staff's reads only (headline, verdict, Strengths,
Areas to Develop, the Attributes bars), never his true grades; the hints for traits not known yet; the evaluation's
lines no longer repeat their label ("Upside: Big upside"). (Run as a file.)"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting   # noqa: E402
from sim import season   # noqa: E402

LABELS = {"Athleticism", "Football IQ", "Technique", "Size / Strength", "Coachability", "Upside"}


def career():
    st = season.new_season("ohio-state", "full", seed=13, career=True)
    return st


def test_display_pos() -> None:
    want = {"LEDG": "EDGE", "REDG": "EDGE", "DT": "DT", "LT": "OT", "RT": "OT", "LG": "IOL", "RG": "IOL", "C": "IOL",
            "HB": "RB", "FB": "RB", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "FS": "S", "SS": "S", "QB": "QB", "CB": "CB",
            "WR": "WR", "TE": "TE", "K": "K", "P": "P"}
    for ea, shown in want.items():
        assert prospects.display_pos(ea) == shown, (ea, prospects.display_pos(ea), shown)


def test_rows(st) -> None:
    rc = st["recruiting"]
    order = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
    seen = {}
    for pid in order[:400]:
        p = rc["prospects"][pid]
        shown = prospects.display_pos(p["ea_position"])
        seen[shown] = seen.get(shown, 0) + 1
        r = prospects.row(st, pid, st["team"])
        assert r["display_pos"] == shown and r["pos_rank"] == seen[shown], (pid, r["display_pos"], r["pos_rank"], seen[shown])
        assert r["height_display"] == f"{p['height'] // 12}'{p['height'] % 12}\"" and r["weight_display"] == f"{p['weight']} lbs"
        assert r["class_of"] == p["class_of"]
    # the mismatch the player saw: a recruit listed EDGE who plays DT in the game shows DT everywhere on his profile
    odd = next((q for q in order if rc["prospects"][q]["position"] == "EDGE" and rc["prospects"][q]["ea_position"] == "DT"
                and rc["prospects"][q]["rank"] <= prospects.EVALUATED), None)
    if odd:
        pr = prospects.profile(st, odd, st["team"])
        assert pr["public"]["display_pos"] == "DT"
        ev = pr["evaluation"]
        assert all("EDGE" not in t for t in ev["strengths"] + ev["solid"] + ev["weaknesses"] + [ev["outlook"]])
    assert prospects.height_text("6'2\"") == "6'2\"" and prospects.weight_text(None) is None


def tight(p: dict, looks: float) -> dict:
    return {"looks": float(looks), "area": 0.0, "by": {"80": float(looks)}, "g": {g: [float(p["truth"][g]), 2.0] for g in recruiting.GROUPS}}


def test_report(st) -> None:
    rc = st["recruiting"]
    me = st["team"]
    pid = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[5]
    p = rc["prospects"][pid]
    rc["reads"].pop(pid, None)
    pr = prospects.profile(st, pid, me)
    assert pr["report"] is None, "no report before a look"
    hints = pr["trait_hints"]
    assert set(hints) >= {"personality", "decider", "story"} and all(h.endswith(".") and h[0].isupper() for h in hints.values()), hints
    rc["reads"][pid] = tight(p, 2)
    rep = prospects.profile(st, pid, me)["report"]
    assert rep["headline"] and 2 <= rep["verdict"].count(".") <= 3, rep["verdict"]
    assert prospects.display_pos(p["ea_position"]) in rep["verdict"] or prospects.POS_NOUNS[prospects.display_pos(p["ea_position"])] in rep["verdict"]
    assert 0 <= len(rep["strengths"]) <= 3 and 0 <= len(rep["develop"]) <= 3
    assert set(rep["strengths"]) <= LABELS and set(rep["develop"]) <= LABELS and not set(rep["strengths"]) & set(rep["develop"])
    attrs = rep["attributes"]
    assert [a["label"] for a in attrs] == ["Athleticism", "Football IQ", "Technique", "Size / Strength", "Coachability"]
    for a in attrs:
        assert 0 <= a["lo"] <= a["mid"] <= a["hi"] <= 100 and a["tone"] in ("good", "warn", "bad")
        assert a["words"] == list(recruiting.grade_range(st, pid, a["group"]))
    # Areas to Develop holds only reads below Solid
    for g, lab in prospects.REPORT_LABELS.items():
        if lab in rep["develop"]:
            assert recruiting.word(recruiting.read_interval(st, pid, g)[0] / 2 + recruiting.read_interval(st, pid, g)[1] / 2) in ("Fair", "Weak")
    # from the reads only: moving his true grades leaves the report as it was
    before = copy.deepcopy(rep)
    saved = dict(p["truth"])
    for g in recruiting.GROUPS:
        p["truth"][g] = 99.0 if p["truth"][g] < 50 else 5.0
    after = prospects.profile(st, pid, me)["report"]
    p["truth"].update(saved)
    assert after == before, "the report reads the staff's grades, never the truth"
    # a weak read writes a concern and lists it to develop; a strong one a strength
    rc["reads"][pid]["g"] = {g: [30.0 if g == "technique" else 85.0, 2.0] for g in recruiting.GROUPS}
    rep = prospects.profile(st, pid, me)["report"]
    assert "Technique" in rep["develop"] and "Technique" not in rep["strengths"] and rep["verdict"].count(".") == 3, rep
    assert next(a for a in rep["attributes"] if a["group"] == "technique")["tone"] == "bad"
    assert next(a for a in rep["attributes"] if a["group"] == "athleticism")["tone"] == "good"
    rc["reads"][pid]["g"] = {g: [70.0, 2.0] for g in recruiting.GROUPS}
    rep = prospects.profile(st, pid, me)["report"]
    assert rep["develop"] == [], rep["develop"]
    rc["reads"].pop(pid)


def test_evaluation_labels(st) -> None:
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[:60]:
        ev = prospects.profile(st, pid, st["team"])["evaluation"]
        for t in ev["strengths"] + ev["solid"] + ev["weaknesses"]:
            head, _, rest = t.partition(": ")
            assert not (rest and rest.lower().startswith(head.lower().split()[0])), f"a doubled label: {t}"
            assert not t.startswith("Upside: Big upside"), t


def test_traits_hints(st) -> None:
    rc = st["recruiting"]
    me = st["team"]
    pid = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[7]
    rc["reads"][pid] = tight(rc["prospects"][pid], 3)
    persona.learn(st, me, pid, "personality")
    pr = prospects.profile(st, pid, me)
    assert pr["trait_hints"] == {}, pr["trait_hints"]
    assert pr["need"] is not None and isinstance(pr["history"], list)


if __name__ == "__main__":
    test_display_pos()
    st = career()
    test_rows(st)
    test_report(st)
    test_evaluation_labels(st)
    test_traits_hints(st)
    print("profile fields ok: display position, position rank, height and weight, class, a report from reads only, hints")

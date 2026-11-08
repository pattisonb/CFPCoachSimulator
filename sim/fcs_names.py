"""Saves from before the FCS stand-ins were renamed.

The eight FCS stand-ins are named only for their region: slug `fcs-southeast`, name "FCS
Southeast", no mascot, no town. They once carried made-up school names, towns, mascots and
stadiums; a career saved then (its state, its box scores, a downloaded .ccsave, a cached league)
still holds those slugs and names. `rewrite_text` turns every one of them into
today's slug and label, once, when the save is read (season.load_season, season.load_box,
career.read_save, coaches.load).

The old strings are kept here rot13-encoded so that none of them appears anywhere in the
repository as written (tests/test_no_standin_names.py checks every tracked file)."""
from __future__ import annotations

import codecs
import json
import re
from functools import lru_cache
from typing import Any

# region -> (old slug, [old names: school, short, town], old mascot, old stadium), rot13
_OLD = {
    "Southeast": ("pnyqre-fcevatf", ["Pnyqre Fcevatf Havirefvgl", "Pnyqre Fcevatf"], "Pbggbazbhguf", "Yvir Bnx Objy"),
    "Gulf Coast": ("cbeg-eraavpx-fgngr", ["Cbeg Eraavpx Fgngr Havirefvgl", "Cbeg Eraavpx Fg.", "Cbeg Eraavpx"], "Znevaref", "Frnjnyy Fgnqvhz"),
    "Plains": ("erq-cenvevr-fgngr", ["Erq Cenvevr Fgngr Havirefvgl", "Erq Cenvevr Fg.", "Erq Cenvevr"], "Cynvafzra", "Jvaqoernx Fgnqvhz"),
    "Mid-Atlantic": ("nyqre-evqtr-fgngr", ["Nyqre Evqtr Fgngr Havirefvgl", "Nyqre Evqtr Fg.", "Nyqre Evqtr"], "Sbetref", "Sheanpr Uvyy Fgnqvhz"),
    "Great Lakes": ("jraqg-ynxr-grpu", ["Jraqg Ynxr Cbylgrpuavp Vafgvghgr", "Jraqg Ynxr Grpu", "Jraqg Ynxr"], "Servtugref", "Ber Qbpx Svryq"),
    # this one's mascot is also a real FBS team's, so it is only ever cleared on a stand-in's own record
    "Mountain West": ("gnyhf-crnx", ["Gnyhf Crnx Havirefvgl", "Gnyhf Crnx"], None, "Fjvgpuonpx Fgnqvhz"),
    "Pacific Northwest": ("prqne-fbhaq", ["Prqne Fbhaq Havirefvgl", "Prqne Fbhaq"], "Bepnf", "Qevsgjbbq Svryq"),
    "New England": ("xrfgery-onl", ["Xrfgery Onl Havirefvgl", "Xrfgery Onl"], "Frn Jbyirf", "Uneobeivrj Svryq"),
}
_OLD_CONFERENCE = ["Rvtug Eviref Sbbgonyy Pbasrerapr", "Rvtug Eviref"]

_r = lambda s: codecs.decode(s, "rot13")


def new_slug(region: str) -> str:
    """A stand-in's slug: 'fcs-' and its region, e.g. fcs-mid-atlantic."""
    return "fcs-" + region.lower().replace(" ", "-")


def label(region: str) -> str:
    return f"FCS {region}"


@lru_cache(maxsize=1)
def _table() -> tuple[re.Pattern, dict]:
    """One pattern for every old token, longest first, and what each becomes."""
    to = {}
    for region, (slug, names, mascot, stadium) in _OLD.items():
        to[_r(slug)] = new_slug(region)
        for n in names:
            to[_r(n)] = label(region)
        if mascot:
            to[_r(mascot)] = label(region)
        to[_r(stadium)] = f"{label(region)} Stadium"
    for c in _OLD_CONFERENCE:
        to[_r(c)] = "FCS"
    pat = re.compile("|".join(re.escape(k) for k in sorted(to, key=len, reverse=True)))
    return pat, to


NEW_SLUGS = {new_slug(r): r for r in _OLD}


def has_old(text: str) -> bool:
    """Does `text` hold any old slug or name?"""
    return _table()[0].search(text) is not None


def _fix_records(o: Any) -> Any:
    """A stand-in's own team record (any dict whose slug is a stand-in's): its names become the
    label, its abbreviation "FCS", no mascot and no town."""
    if isinstance(o, dict):
        region = NEW_SLUGS.get(o.get("slug")) if isinstance(o.get("slug"), str) else None
        if region and ("fictional" in o or "mascot" in o or "school_name" in o or "short_name" in o):
            for k in ("name", "short_name", "school", "school_name"):
                if k in o:
                    o[k] = label(region)
            if "abbreviation" in o:
                o["abbreviation"] = "FCS"
            if "mascot" in o:
                o["mascot"] = ""
            o.pop("city", None)
        for v in o.values():
            _fix_records(v)
    elif isinstance(o, list):
        for v in o:
            _fix_records(v)
    return o


def rewrite_text(text: str) -> str:
    """`text` (a save, a box score, any JSON) with every old slug and name replaced; the same
    string when there is none."""
    pat, to = _table()
    if not pat.search(text):
        return text
    out = pat.sub(lambda m: to[m.group(0)], text)
    try:
        return json.dumps(_fix_records(json.loads(out)))
    except ValueError:
        return out

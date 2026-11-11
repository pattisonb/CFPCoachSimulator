"""Headquarters: the player's own dashboard of recruiting and scouting widgets (spec
docs/superpowers/specs/2026-11-07-headquarters-design.md). The page owns the widgets; this module keeps
the layout in the career save and computes the two reads no other view has: your commits by week and this
week's movers on your board. Nothing here touches the season sim (the layout is outside the golden digest)."""
import re
from typing import Optional

from coach_career import recruiting

HQ_MAX_CARDS = 40        # *tune* the most cards a Headquarters holds
CARD_H = (120, 1600)     # *tune* the shortest and tallest height (px) a player may give a card; none is Auto
MOVERS_SHOWN = 5         # *tune* risers and fallers each the Hot and Cold Movers widget gets
SIZES = ("S", "M", "L")
_ID = re.compile(r"^[a-z0-9-]{1,40}$")


class LayoutError(Exception):
    """A layout of the wrong shape; nothing was stored."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def layout(state: dict) -> dict:
    """The saved layout: {"cards": [{"id", "widget", "size"}, ...]}; an old save without one reads empty."""
    hq = (state.get("career") or {}).get("headquarters") or {}
    return {"cards": [dict(c) for c in hq.get("cards") or []]}


def set_layout(state: dict, cards) -> dict:
    """Check the shape and store the layout. The widget ids are not checked against a list: the page owns the
    widgets, and a newer page's widget in an older save is kept."""
    if not isinstance(cards, list):
        raise LayoutError("The layout must be a list of cards.")
    if len(cards) > HQ_MAX_CARDS:
        raise LayoutError(f"A Headquarters holds at most {HQ_MAX_CARDS} widgets.")
    seen, out = set(), []
    for c in cards:
        if not isinstance(c, dict):
            raise LayoutError("Each card must have an id, a widget and a size.")
        cid, widget, size = c.get("id"), c.get("widget"), c.get("size")
        if not (isinstance(cid, str) and _ID.match(cid)) or not (isinstance(widget, str) and _ID.match(widget)):
            raise LayoutError("Card and widget ids are short lowercase words with dashes.")
        if size not in SIZES:
            raise LayoutError("A widget's size is S, M or L.")
        if cid in seen:
            raise LayoutError("Each card id appears once.")
        h = c.get("h")
        if h is not None and (isinstance(h, bool) or not isinstance(h, int) or not CARD_H[0] <= h <= CARD_H[1]):
            raise LayoutError(f"A card's height is Auto or {CARD_H[0]} to {CARD_H[1]} pixels.")
        seen.add(cid)
        out.append({"id": cid, "widget": widget, "size": size, **({"h": h} if h is not None else {})})
    _hq(state)["cards"] = out
    return layout(state)


def _committed_now(state: dict, me: str) -> int:
    """Your commits in the live recruiting block (the class, or the portal in its weeks), as the board counts them."""
    rc = state["recruiting"]
    return sum(1 for s in rc["status"].values() if s.get("committed") == me)


def commits_by_week(state: dict) -> list:
    """Your commits week by week from the recruiting log: [{"week", "gained", "lost", "total"}], a row for
    every week from the first to now (the portal's weeks in the portal). A commit or a flip to you is gained,
    a decommit from you lost; what you held before the log began counts in the first week's total, so the
    last total is exactly your commits now."""
    rc, me = state["recruiting"], state["team"]
    portal = bool(rc.get("portal"))
    now = int((rc.get("week") if portal else state.get("current_week")) or 0)
    gained: dict[int, int] = {}
    lost: dict[int, int] = {}
    for e in rc.get("log") or []:
        if e.get("school") != me:
            continue
        w = e.get("portal_week") if portal else e.get("week")
        if w is None:
            continue
        w = int(w)
        if e.get("kind") in ("commit", "flip"):
            gained[w] = gained.get(w, 0) + 1
        elif e.get("kind") == "decommit":
            lost[w] = lost.get(w, 0) + 1
    first = min([1 if now >= 1 else 0, *gained, *lost])
    last = max([now, *gained, *lost])
    start = max(0, _committed_now(state, me) - (sum(gained.values()) - sum(lost.values())))
    rows, total = [], start
    for w in range(first, last + 1):
        g, l = gained.get(w, 0), lost.get(w, 0)
        total += g - l
        rows.append({"week": w, "gained": g, "lost": l, "total": max(0, total)})
    return rows


def movers(state: dict) -> dict:
    """This week's risers and fallers on your board, from the latest weekly report: your place on his list
    now against a week ago. {"up": [...], "down": [...]}, MOVERS_SHOWN each, most places moved first. The
    page shows them with your standing in words, never the place itself."""
    report: Optional[dict] = recruiting.latest_report(state)
    up, down = [], []
    for r in (report or {}).get("rows") or []:
        rank, prev = r.get("rank"), r.get("prev_rank")
        if rank is None or prev is None or rank == prev:
            continue
        row = {"pid": r["pid"], "name": r["name"], "position": r["position"], "stars": r["stars"], "places": abs(prev - rank)}
        (up if rank < prev else down).append(row)
    key = lambda x: (-x["places"], x["name"])
    return {"up": sorted(up, key=key)[:MOVERS_SHOWN], "down": sorted(down, key=key)[:MOVERS_SHOWN]}


# ----- round 2: the reads behind the planned widgets (spec "Round 2") ----------------------------------------

STALE_WEEKS = 3          # *tune* weeks without contact before an offered target reads as going stale (the page's rule)
DRAFT_LIKELY = 90        # *tune* a draft-eligible underclassman rated this (card overall) or better is likely to declare
DRAFT_POSSIBLE = 84      # *tune* ... and this or better might
TRANSFER_HIGH = 0.15     # *tune* a projected portal chance this high reads "High"
TRANSFER_SOME = 0.07     # *tune* ... and this high "Some"; under it "Low"
TOP100_GOAL = {1: 5, 2: 3, 3: 1, 4: 1, 5: 1}        # *tune* the default top-100 recruits goal by program tier
RANK_GOAL = {1: 10, 2: 25, 3: 40, 4: 60, 5: 80}     # *tune* the default class rank goal by program tier
GOAL_IDS = ("commits", "top100", "rank")
GOAL_TITLES = {"commits": "Sign Your Class", "top100": "Land Top 100 Recruits", "rank": "Finish in the Top"}
MAX_TASKS = 60           # *tune* the most tasks a Headquarters keeps
TASK_TEXT = 120          # the longest a task's text may be


def _hq(state: dict) -> dict:
    return state["career"].setdefault("headquarters", {"cards": []})


def last_contacts(state: dict) -> dict:
    """The last week you contacted, pitched or offered each recruit on your board, from the recruiting log
    (the portal's weeks in the portal). A recruit you never contacted is left out."""
    rc, me = state["recruiting"], state["team"]
    portal = bool(rc.get("portal"))
    board = set(rc.get("board") or [])
    out: dict = {}
    for e in rc.get("log") or []:
        if e.get("school") != me or e.get("pid") not in board or e.get("kind") not in recruiting.CONTACT_KINDS + ("offer",):
            continue
        w = e.get("portal_week") if portal else e.get("week")
        if w is not None:
            out[e["pid"]] = max(int(w), out.get(e["pid"], 0))
    return out


def _word(chance: float) -> str:
    return "High" if chance >= TRANSFER_HIGH else "Some" if chance >= TRANSFER_SOME else "Low"


def outlook(state: dict) -> dict:
    """Your roster's projected departures, as words: seniors graduate, draft-eligible underclassmen may declare
    (by overall), and every player's portal chance by the offseason's own odds (class, role, a losing year).
    A projection: the offseason decides."""
    from coach_career import offseason
    from sim import season
    me = state["team"]
    view = season.depth_roster_view(state, me)
    r = season._records(state).get(me) or {}
    losing = r.get("wins", 0) < r.get("losses", 0)
    players = []
    for p in view.get("players") or []:
        cls = p.get("class") or ""
        use = "starter" if p.get("starter") else "rotation" if (p.get("depth") or 99) <= 2 else "bench"
        base = cls.replace("RS", "") if cls not in offseason.PORTAL_BASE else cls
        chance = offseason.PORTAL_BASE.get(cls, offseason.PORTAL_BASE.get(base, 0.1)) * offseason.PORTAL_USAGE[use] * (offseason.PORTAL_LOSING if losing else 1.0)
        ovr = int(p.get("overall") or 0)
        draft = None
        if cls in offseason.UNDERCLASS_ELIGIBLE:
            draft = "Likely" if ovr >= DRAFT_LIKELY else "Possible" if ovr >= DRAFT_POSSIBLE else None
        grad = cls in ("SR", "SRRS")
        group = offseason.GROUP.get(p.get("role")) or offseason.GROUP.get(p.get("position")) or p.get("position")
        players.append({"slug": p.get("slug"), "name": p.get("name"), "position": p.get("position"), "group": group, "class": cls,
                        "overall": ovr, "starter": bool(p.get("starter")), "use": use,
                        "leaving": "graduation" if grad else None, "draft": draft,
                        "transfer": None if grad else _word(chance)})     # a senior graduates: no portal word
    _replacements(state, players)
    counts = {"graduation": sum(1 for p in players if p["leaving"]), "draft": sum(1 for p in players if p["draft"]),
              "draft_likely": sum(1 for p in players if p["draft"] == "Likely"),
              "transfer_high": sum(1 for p in players if p["transfer"] == "High"),
              "transfer_some": sum(1 for p in players if p["transfer"] == "Some"),
              "roster": len(players), "losing": losing}
    return {"players": players, "counts": counts}


REPLACE_ORDER = ("Committed", "Offered", "On Board")


def _replacements(state: dict, players: list) -> None:
    """Each player likely to leave (graduating, a likely or possible declare, a High portal risk) gets the best high
    school recruit at his group who is yours: committed to you first, then offered, then on your board, best
    national rank first. One recruit replaces one player; the best leaving player (starter, then overall) picks first."""
    from coach_career import prospects
    rc, me = prospects.class_rc(state), state["team"]
    offered = set(state["recruiting"].get("offers", {}).get(me, [])) if rc is state["recruiting"] else set()
    board = set(state["recruiting"].get("board") or []) if rc is state["recruiting"] else set()
    pool: dict = {}
    for pid, st in rc["status"].items():
        school = st["signed"] or st["committed"]
        status = "Committed" if school == me else None if school else "Offered" if pid in offered else "On Board" if pid in board else None
        if status is None:
            continue
        p = rc["prospects"][pid]
        pool.setdefault(recruiting._group_of(p), []).append((REPLACE_ORDER.index(status), p["rank"], pid, status))
    for g in pool:
        pool[g].sort()
    for p in players:
        p["replacement"] = None
    leaving = [p for p in players if p["leaving"] or p["draft"] or p["transfer"] == "High"]
    for p in sorted(leaving, key=lambda x: (not x["starter"], -x["overall"])):
        cands = pool.get(p["group"]) or []
        if cands:
            _, _, pid, status = cands.pop(0)
            q = rc["prospects"][pid]
            p["replacement"] = {"pid": pid, "name": q["name"], "stars": q["stars"], "position": q["position"], "status": status}


def next_year(state: dict) -> dict:
    """Next year's roster by group, as it stands: everyone the outlook keeps (seniors graduate) a class up, best overall
    first, with his draft or portal word; your commits (and signees) in their groups as freshmen; each group's target,
    the headcount filled, and `need`, recruiting.needs_detail's (which allows for the usual attrition and early leavers,
    so it can be more than target - filled)."""
    from coach_career import offseason, prospects
    me = state["team"]
    detail = recruiting.needs_detail(state, me)
    groups = {g: {"group": g, "target": int(d.get("target") or 0), "players": [], "commits": []} for g, d in detail.items()}
    for p in outlook(state)["players"]:
        if p["leaving"] or p["group"] not in groups:
            continue
        groups[p["group"]]["players"].append({"slug": p.get("slug"), "name": p["name"], "position": p["position"], "class_now": p["class"],
                                              "class_next": offseason.NEXT_CLASS.get(p["class"], p["class"]), "overall": p["overall"],
                                              "starter": p["starter"], "draft": p["draft"], "transfer": p["transfer"]})
    rc = prospects.class_rc(state)
    for pid, st in rc["status"].items():
        if (st["signed"] or st["committed"]) != me:
            continue
        q = rc["prospects"][pid]
        g = recruiting._group_of(q)
        if g in groups:
            groups[g]["commits"].append({"pid": pid, "name": q["name"], "position": q["position"], "stars": q["stars"],
                                         "signed": st["signed"] == me, "hard": bool(st.get("hard")), "rank": q["rank"]})
    out = []
    for g in groups.values():
        g["players"].sort(key=lambda x: -x["overall"])
        g["commits"].sort(key=lambda x: x["rank"])
        g["filled"] = len(g["players"]) + len(g["commits"])
        g["need"] = int(detail[g["group"]].get("need") or 0)     # the game's own need: it allows for the usual attrition, as Class Needs
        out.append(g)
    return {"groups": out}


def what_if(state: dict, pid: str) -> dict:
    """Your class rank now and if he commits to you, and his group's need now and after. Changes nothing. Both ranks
    come from prospects.class_table as you see it (another school's Quiet Commit left out), so the rank if he commits
    is the rank you get when he does."""
    from coach_career import prospects
    rc, me = prospects.class_rc(state), state["team"]
    if pid not in rc["prospects"]:
        raise LayoutError("Unknown recruit.")
    table = prospects.class_table(state, me)
    st = rc["status"][pid]
    mine = (st["signed"] or st["committed"]) == me
    p = rc["prospects"][pid]
    group = recruiting._group_of(p)
    need = int(recruiting.needs(state, me).get(group, 0))
    rank_now = table[me]["rank"]
    if mine:
        rank_if = rank_now
    else:
        comps = sorted([rc["prospects"][q]["composite"] for q in table[me]["pids"] if q != pid] + [p["composite"]], reverse=True)
        points = sum(c * prospects.CLASS_DECAY ** i for i, c in enumerate(comps))
        rank_if = 1 + sum(1 for slug, t in table.items() if slug != me and t["points"] > points)
    return {"pid": pid, "name": p["name"], "group": group, "rank_now": rank_now, "rank_if": rank_if,
            "need_now": need, "need_if": need if mine else max(0, need - 1)}


def _tier(state: dict) -> int:
    from coach_career import programs
    me = state["team"]
    row = next((r for r in programs.rows(state) if r["team"] == me), None)
    return int((row or {}).get("tier") or 3)


def goals(state: dict) -> list:
    """The three class goals: target (yours, or the default), now, and met."""
    from coach_career import prospects
    rc, me = prospects.class_rc(state), state["team"]
    saved = _hq(state).get("goals") or {}
    mine = [pid for pid, st in rc["status"].items() if (st["signed"] or st["committed"]) == me]
    tier = _tier(state)
    committed = len([1 for s in state["recruiting"]["status"].values() if s["committed"] == me])
    defaults = {"commits": committed + recruiting.open_spots(state, me), "top100": TOP100_GOAL.get(tier, 1), "rank": RANK_GOAL.get(tier, 40)}
    now = {"commits": committed, "top100": sum(1 for pid in mine if rc["prospects"][pid]["rank"] <= 100),
           "rank": prospects.class_rank(state, me) if mine else None}       # no commits: unranked, not first
    out = []
    for g in GOAL_IDS:
        target = int(saved.get(g) or defaults[g])
        met = (now[g] is not None and now[g] <= target) if g == "rank" else now[g] >= target
        out.append({"id": g, "title": GOAL_TITLES[g], "target": target, "now": now[g], "met": met, "default": g not in saved})
    return out


def tasks(state: dict) -> list:
    return [dict(t) for t in _hq(state).get("tasks") or []]


def set_plan(state: dict, body: dict) -> dict:
    """Store tasks and goal targets (either optional); check every field first, so a bad one stores nothing."""
    if not isinstance(body, dict):
        raise LayoutError("The plan must be an object.")
    new_tasks, new_goals = None, None
    if "tasks" in body:
        ts = body["tasks"]
        if not isinstance(ts, list) or len(ts) > MAX_TASKS:
            raise LayoutError(f"Tasks are a list of at most {MAX_TASKS}.")
        seen, new_tasks = set(), []
        for t in ts:
            if not isinstance(t, dict) or not (isinstance(t.get("id"), str) and _ID.match(t["id"])) or t["id"] in seen:
                raise LayoutError("Each task needs its own short lowercase id.")
            text = t.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > TASK_TEXT:
                raise LayoutError(f"A task's text is 1 to {TASK_TEXT} characters.")
            if not isinstance(t.get("done"), bool):
                raise LayoutError("A task is done or not.")
            seen.add(t["id"])
            new_tasks.append({"id": t["id"], "text": text.strip(), "done": t["done"]})
    if "goals" in body:
        gs = body["goals"]
        if not isinstance(gs, dict) or any(k not in GOAL_IDS for k in gs):
            raise LayoutError("Goals are commits, top100 and rank.")
        for v in gs.values():
            if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 200:
                raise LayoutError("A goal is a whole number from 1 to 200.")
        new_goals = dict(gs)
    hq = _hq(state)
    if new_tasks is not None:
        hq["tasks"] = new_tasks
    if new_goals is not None:
        hq["goals"] = dict(hq.get("goals") or {}, **new_goals)
    return {"tasks": tasks(state), "goals": goals(state)}

"""Coach Career scenes (docs/superpowers/specs/2026-10-28-recruiting-experience-design.md, section 6):
your calls and in-home visits as a short scene. He talks; a cue hints at what he cares about (one
topic, or two when he is torn); you pitch; he reacts. This file owns the words and the choice of cue
and reaction; recruiting.py owns the scene's lifecycle and its points (the one `_act` path).

Lines are in his voice, present tense, short, no numbers (an in-home visit's ask is in words). They
take {name}, {first}, {town}, {state}, {school}, {position}, {role} ("start", "compete" or "wait"),
{record} (the school's won-lost in words). Lines fit a high schooler and a transfer alike; two-sided cues take {a} and {b}, two topics' phrases."""
from __future__ import annotations

import random

from coach_career import recruiting

CUE_TWO_SIDED = 0.6        # how often a cue names two topics (one his, one not) *tune: tools/check_recruiting.py*

# the topics as he would say them, for two-sided cues
PHRASES = {"proximity": "staying close to home", "playing_time": "getting on the field early",
           "prestige": "a big-name program", "winning": "winning right away", "nil": "the NIL side of it",
           "coach": "the coaches I'd play for", "academics": "getting a real degree"}

LINES: dict[str, dict[str, list[str]]] = {
    "proximity": {
        "cue": ["My mom wants me close enough to drive to games.",
                "I like Sunday dinners in {town}. I don't want to give that up.",
                "Whoever I pick, my family has to be in the stands."],
        "hit": ["That's what I want to hear. My folks could make every home game.",
                "Home on a weekend? That matters, Coach. It really does.",
                "{town} to {school} isn't far at all. I like that a lot."],
        "polite": ["Being close is nice, I guess. My folks will travel.",
                   "Yeah, the drive's easy. That's cool.",
                   "Sure. I'd go anywhere for the right fit, though."],
        "quiet": ["...That's a long way from {town}, Coach.",
                  "My mom's not going to like that drive.",
                  "Yeah. I'll have to think about being that far out."],
    },
    "playing_time": {
        "cue": ["I want to play {position} on Saturdays, not hold a clipboard.",
                "Everybody says I'll play early. I want to see it.",
                "I'm not sitting for three years. I want snaps."],
        "hit": ["A real shot at the field next year? I'm all in on that.",
                "That depth chart looks good to me, Coach. Real good.",
                "Snaps next year. That's what I needed to hear."],
        "polite": ["I'll earn whatever I get. That's fine.",
                   "Yeah, the depth chart's cool. Not my biggest thing.",
                   "I figure I'll compete wherever I go."],
        "quiet": ["You've got a lot of guys at {position} already.",
                  "So I'd {role} next year. Okay.",
                  "...I've seen that depth chart, Coach."],
    },
    "prestige": {
        "cue": ["I grew up watching the big programs on TV. I want that helmet.",
                "Where I go says something. People back in {town} notice.",
                "I want to be on a team everybody knows."],
        "hit": ["{school}. Man. That name means something.",
                "That's the brand, Coach. Everybody knows {school}.",
                "Yeah. When you say {school}, people listen."],
        "polite": ["The name's nice. I'm more about the fit.",
                   "Sure, {school} is a big deal. That's cool.",
                   "I don't really care about logos, but okay."],
        "quiet": ["I don't know, Coach. Not a lot of people talk about {school} out here.",
                  "...Yeah. I was hoping for a bigger stage.",
                  "My friends haven't heard much about {school}."],
    },
    "winning": {
        "cue": ["I want to win. Rings, conference titles, all of it.",
                "I'm not going somewhere to lose. Not again.",
                "I want to play in the big games in December."],
        "hit": ["You guys win. I notice that, Coach.",
                "That's the thing. {school} wins. I want in.",
                "Playing for a title every year? Yes sir."],
        "polite": ["Winning's nice. It's not the only thing.",
                   "Yeah, you've been good. That's cool.",
                   "Sure. Everybody says they'll win."],
        "quiet": ["{record}... I want to play for a winner, Coach.",
                  "...You guys have had some rough years.",
                  "I don't know. I want to play in big games."],
    },
    "nil": {
        "cue": ["My family could use the help. I'm not going to lie about that.",
                "The NIL stuff matters. My dad asks about it every time.",
                "I want to take care of my mom. That's real."],
        "hit": ["That's real money for my family, Coach. Thank you.",
                "My dad is going to like hearing that.",
                "Okay. That takes care of a lot back home."],
        "polite": ["The money's fine. It's not what I'm chasing.",
                   "Yeah, cool. I'm more about football.",
                   "I appreciate it. Not my first question, though."],
        "quiet": ["...Other schools are talking bigger numbers, Coach.",
                  "My dad's not going to love that.",
                  "Yeah. That's less than I was hoping."],
    },
    "coach": {
        "cue": ["I want a coach who's going to be there all four years.",
                "I need to trust the guy I play for. That's big for me.",
                "I want somebody who'll yell at me and mean it."],
        "hit": ["I believe you, Coach. I really do.",
                "That's the kind of coach I want to play for.",
                "You've been straight with me. That counts."],
        "polite": ["Sure, Coach. I appreciate that.",
                   "Yeah, the staff seems cool.",
                   "I hear you. Coaches move around, though."],
        "quiet": ["...Everybody says that, Coach.",
                  "I don't really know you yet.",
                  "People back home have some questions about your staff."],
    },
    "academics": {
        "cue": ["My mom says the degree is the whole point.",
                "I want a degree that means something after football.",
                "I'm thinking about what I study, too. Not just ball."],
        "hit": ["My mom is going to love that. The degree matters.",
                "That's a real school, Coach. That counts for a lot.",
                "Good. I want something for after football."],
        "polite": ["Yeah, school's school. I'll get my degree.",
                   "That's cool. I'm here to play, mostly.",
                   "Sure. Every school says that."],
        "quiet": ["...I don't know much about the classes there.",
                  "My mom's going to ask about the academics. I don't know what to tell her.",
                  "Yeah. I was hoping for a stronger school."],
    },
    "_two_sided": {
        "cue": ["Honestly? It's {a} or {b}. I go back and forth.",
                "My dad says {a}. My coach says {b}. I don't know yet.",
                "Some days it's {a}. Some days it's {b}."],
    },
}

# a pestering call or visit (recruiting.PESTER_FREE): he is not weighing you, and the pitch falls flat
TIRED = ["He is polite but short. He is not weighing you right now, and the calls are wearing thin.",
         "He lets it ring a while before he picks up. {school} is not on his mind, and he does not hide it.",
         "He hears you out and says nothing about {school}. His mind is on other schools, and he wants the calls to stop."]

# the opening of a call (and the middle of a visit): small talk
COLOR = ["Hey Coach. Just got back from practice.",
          "Yes sir, I've got a few minutes.",
          "This is {first}. My phone's been going all week.",
          "Hey Coach. Everybody in {town} is talking about {school}.",
          "Coach! I was just watching your film."]

# an in-home visit opens with his family
FAMILY = ["His mom has the table set and the good plates out.",
          "His dad shakes your hand and doesn't let go for a while.",
          "His little brother asks if you know anybody in the NFL.",
          "His grandmother wants to know if there's a church near {school}.",
          "The whole family is on the couch in {town}. {first} sits closest to the door."]

_ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
         "sixteen seventeen eighteen nineteen").split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def words(n: int) -> str:
    """A whole number in words (0-999 in full; past that, the digits)."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else "-" + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + words(n % 100))
    return str(n)


def _role(state: dict, slug: str, pid: str) -> str:
    pt = recruiting.strengths(state, slug, pid)["playing_time"]
    return "start" if pt >= 0.9 else "compete" if pt >= 0.5 else "wait"


def _record(state: dict, slug: str) -> str:
    """The school's won-lost in words: this season's, or last season's before a game."""
    from sim import season
    rec = season._records(state).get(slug) or {}
    w, l = rec.get("wins", 0), rec.get("losses", 0)
    if not w + l:
        ls = recruiting._team_model(slug).get("last_season") or {}
        w, l = ls.get("wins", 0), ls.get("losses", 0)
    if not w + l:
        return "No record yet"
    return f"{words(w)} and {words(l)}".capitalize()


def _fields(state: dict, slug: str, p: dict) -> dict:
    from sim import season
    team = season.load_teams().get(slug) or {}
    return {"name": p["name"], "first": p["name"].split()[0], "town": p["hometown"]["city"] or p["hometown"]["state"],   # a transfer has no town on file
            "state": p["hometown"]["state"], "school": team.get("name", slug), "position": p["position"],
            "role": _role(state, slug, p["id"]), "record": _record(state, slug)}


def open_scene(state: dict, slug: str, pid: str, action: str, week: int) -> dict:
    """A call's or in-home visit's scene: his lines and a cue on one priority you have not heard
    (or two topics, one his and one not, CUE_TWO_SIDED of the time), and his ask as you know it."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    known = (rc["revealed"].get(slug) or {}).get(pid) or []
    true = next((t for t in p["priorities"] if t not in known), p["priorities"][0])
    rng = random.Random(f"cue-{rc['seed']}-{slug}-{pid}-{week}")
    f = _fields(state, slug, p)
    if rng.random() < CUE_TWO_SIDED:
        decoy = rng.choice([t for t in recruiting.PITCHES if t not in p["priorities"]])
        topics = [true, decoy] if rng.random() < 0.5 else [decoy, true]
        text = rng.choice(LINES["_two_sided"]["cue"]).format(a=PHRASES[topics[0]], b=PHRASES[topics[1]], **f)
    else:
        topics = [true]
        text = rng.choice(LINES[true]["cue"]).format(**f)
    ask = recruiting.ask_view(state, slug, pid)
    lines = [rng.choice(COLOR).format(**f), text]
    if action == "hc_visit":
        lines.insert(0, rng.choice(FAMILY).format(**f))
        n = ask.get("exact", 0)
        lines.append(f"His dad asks what the collective can do: {words(n)} points." if n
                     else "His dad says the money isn't the point.")
    return {"id": f"{action}-{pid}-{week}", "action": action, "week": week, "lines": lines,
            "cue": {"topics": topics, "text": text}, "ask": ask}


def reaction(state: dict, slug: str, pid: str, action: str, pitch: str, p: dict, tired: bool = False) -> dict:
    """How he takes your pitch: a priority where you are strong lights him up (hit), one where you are
    weak goes quiet, anything else is polite; `tired` (the call pestered him) and the pitch falls flat."""
    rng = random.Random(f"react-{state['recruiting']['seed']}-{slug}-{pid}-{state['current_week']}-{action}")
    if tired:
        return {"kind": "tired", "text": rng.choice(TIRED).format(**_fields(state, slug, p))}
    if pitch in p["priorities"]:
        kind = "hit" if recruiting.strengths(state, slug, pid)[pitch] >= recruiting.BACKFIRE else "quiet"
    else:
        kind = "polite"
    return {"kind": kind, "text": rng.choice(LINES[pitch][kind]).format(**_fields(state, slug, p))}

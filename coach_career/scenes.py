"""Coach Career scenes (docs/superpowers/specs/2026-10-28-recruiting-experience-design.md, section 6):
your calls and in-home visits as a short conversation. You open; he answers with small talk that
knows the week (your last game, his practice, the school leading his list); you present your program
(three things); he reacts; you ask what will decide it; he answers with the cue (one topic, or two
when he is torn); you lead with a pitch; he reacts. This file owns the words and the choice of cue
and reaction; recruiting.py owns the scene's lifecycle and its points (the one `_act` path).

A scene is `turns`: [{who: "you" | "him" | "note", text}] in order; `lines` (his turns' texts) stays
one release for the page's old readers. Lines are in his voice (or yours), present tense, short, no
numbers (an in-home visit's ask is in words). They take {name}, {first}, {town}, {state}, {school},
{position}, {role} ("start", "compete" or "wait"), {record} (the school's won-lost in words), {coach}
(your last name), {opponent} and {result} ("beat" / "lost to": your last game, or the opener before
one), {leader} (the school leading his list, "" when none or you) and {week_word}. Lines fit a high
schooler and a transfer alike; two-sided cues take {a} and {b}, two topics' phrases."""
from __future__ import annotations

import os
import random

from coach_career import recruiting

CUE_TWO_SIDED = 0.6        # how often a cue names two topics (one his, one not) *tune: tools/check_recruiting.py*
# how often a playing-time recruit asks about a named player on a call or visit *tune: tools/check_recruiting.py*
# (CFP_QUESTION_RATE: the sweep forces it through the dev server's environment)
QUESTION_RATE = float(os.environ.get("CFP_QUESTION_RATE", "0.6"))

# the topics as he would say them, for two-sided cues
PHRASES = {"proximity": "staying close to home", "playing_time": "getting on the field early",
           "prestige": "a big-name program", "winning": "winning right away", "nil": "the NIL side of it",
           "coach": "the coaches I'd play for", "academics": "getting a real degree"}

LINES: dict[str, dict[str, list[str]]] = {
    "proximity": {
        "cue": ["Honestly, Coach? My mom wants me close enough to drive to games.",
                "I like Sunday dinners in {town}. I don't want to give that up.",
                "Whoever I pick, my family has to be in the stands. That's the big one."],
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
        "cue": ["Honestly, Coach? I want to play {position} on Saturdays, not hold a clipboard.",
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
        "cue": ["Honestly? I grew up watching the big programs on TV. I want that helmet.",
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
        "cue": ["Winning, Coach. Rings, conference titles, all of it.",
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
        "cue": ["The money, Coach. My family could use the help. I'm not going to lie about that.",
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
        "cue": ["The staff. I want a coach who's going to be there all four years.",
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
        "cue": ["School, honestly. My mom says the degree is the whole point.",
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
        "cue": ["Honestly, Coach? It's {a} or {b}. I go back and forth.",
                "My dad says {a}. My coach says {b}. I don't know yet.",
                "Some days it's {a}, some days it's {b}. Ask me tomorrow and I'll say the other one."],
    },
}

# a pestering call or visit (recruiting.PESTER_FREE): he is not weighing you, and the pitch falls flat
TIRED = ["He is polite but short. He is not weighing you right now, and the calls are wearing thin.",
         "He lets it ring a while before he picks up. {school} is not on his mind, and he does not hide it.",
         "He hears you out and says nothing about {school}. His mind is on other schools, and he wants the calls to stop."]

# his question about a named player (docs/superpowers/specs/2026-10-29-recruit-questions-design.md,
# section 2): the player ahead of him on your roster ({ahead}, {ahead_cls} his class in words, {position}
# the recruit's position), or another recruit you offered at his position ({other})
QUESTION_LINES = {
    "roster": ["Is {ahead} still your {position} next year? I'm not coming to sit behind him.",
               "{ahead} is a {ahead_cls}. That's two more years of him. Where does that leave me?",
               "My dad looked at your depth chart. He says {ahead} has that spot locked."],
    "recruit": ["You offered {other} too. Which one of us do you actually want?",
                "I saw {other} post your offer. You telling him the same thing you're telling me?",
                "If {other} commits first, is there still a spot for me?"],
}
ANSWERS = ("straight", "promise", "deflect")
# your reply buttons: a Title Case label (what the button says) over your line, by the question's kind
# (the page draws them; the engine keeps the one copy)
ANSWER_LABELS = {"straight": "Tell Him Straight", "promise": "Make Him a Promise", "deflect": "Sidestep It"}
ANSWER_COPY = {
    "roster": {"straight": "He's the starter today. You'd compete, and the best man plays.",
               "promise": "The job's yours.",
               "deflect": "Let's talk about what you'd bring."},
    "recruit": {"straight": "I offered him too. One of you starts; I want it to be you.",
                "promise": "You're the one I want.",
                "deflect": "Let's talk about what you'd bring."},
}
# what he says back: a promise he believes ("promise") or one he has heard before ("hollow")
REPLY_LINES = {"straight": "Fair. At least you're not blowing smoke.",
               "promise": "That's what I needed to hear, Coach.",
               "hollow": "I've heard that one before.",
               "deflect": "...Okay."}
CLASS_WORDS = {"FR": "freshman", "FRRS": "redshirt freshman", "SO": "sophomore", "SORS": "redshirt sophomore",
               "JR": "junior", "JRRS": "redshirt junior", "SR": "senior", "SRRS": "redshirt senior"}


# ----- the conversation -------------------------------------------------------------------------------
# you open a call: a first call, a call the week after the last one, or one after a gap
OPEN = {
    "first": ["Hey {first}, Coach {coach} at {school}. Got a minute?",
              "{first}? Coach {coach}, {school}. Did I catch you at a good time?",
              "Hey {first}. Coach {coach} over at {school}. You got a few minutes for me?"],
    "last_week": ["Hey {first}, Coach {coach} again. Good talking last week.",
                  "{first}, Coach {coach}. Good talking last week. Got a minute?"],
    "again": ["Hey {first}, Coach {coach} at {school}. Week {week_word} already, you believe that?",
              "{first}, Coach {coach}. Been a minute since we talked. How are you?"],
}
# you open an in-home visit: you are in the living room
VISIT_OPEN = ["Thank you all for having me. {first}, good to finally sit down with you.",
              "Appreciate you opening your home. {first}, you look bigger in person.",
              "Thanks for having me, everybody. {first}, I've been looking forward to this."]
# his answer: small talk that knows the week, picked by what is true
CONTEXT = {
    "game": ["Hey Coach. Saw you {result} {opponent} Saturday. I watched the whole thing.",
             "Yes sir. Everybody in {town} saw you {result} {opponent}.",
             "Hey Coach. You {result} {opponent}, right? I had it on in the locker room."],
    "won": ["Hey Coach. Saw you beat {opponent} Saturday. That was a good one.",
            "Yes sir. Nice win over {opponent}, Coach. My dad was yelling at the TV."],
    "lost": ["Tough one against {opponent}, Coach. I watched the whole thing.",
             "Hey Coach. Yeah, I saw {opponent} got you. That was a hard watch."],
    "opener": ["Yes sir. Y'all open with {opponent}, right? I'll be watching.",
               "Hey Coach. Everybody's waiting on the {opponent} game. Me too."],
    "own": ["Hey Coach. Practice ran long. Coach has us in pads all week.",
            "Yes sir. Just got home from practice. My legs are shot.",
            "Hey Coach. Film session just let out. Coach is on us this week."],
    "leader": ["Hey Coach. My phone's been going all week. {leader} called twice.",
               "Yes sir. {leader} was just here, actually. It's been a lot.",
               "Hey Coach. Yeah, I've got a minute. {leader} keeps calling, so I'm used to it."],
    "tired": ["...Yeah, Coach. I've got a minute, I guess.",
              "Hey. Yeah. Kind of a lot going on, Coach.",
              "Hi Coach. Sure. Make it quick if you can."],
}
# your opening: the three things you lead your program with, as you say them
PRESENT_SAID = ["Here's {school} in a nutshell: {x}, {y} and {z}.",
                "Let me tell you what we're about at {school}: {x}, {y} and {z}.",
                "Three things about us, {first}: {x}, {y} and {z}."]
# how he takes your opening: one of his priorities in it (the one you are strongest on, {topic}, in his
# words), none, or he is tired of you; a priority you are weak at gets that topic's quiet line
PRESENT_LINES = {
    "hit": ["{topic}. Yeah. Keep talking, Coach.",
            "{topic}... okay. That's the part I wanted to hear.",
            "You said {topic}. That's the one. Go on."],
    "polite": ["Appreciate that, Coach.",
               "Okay. Yes sir.",
               "I hear you, Coach."],
    "tired": ["Okay.",
              "Yeah. I've heard the speech, Coach."],
}
# your question that sets up the cue: for one topic, and for a cue that names two
ASK = {
    "one": ["So what's going to decide this for you?",
            "Tell me straight, {first}: what's going to decide this for you?"],
    "two": ["Where's your head at right now?",
            "Where's your head at, {first}? Honest answer."],
}
# your lead-with, as you say it, after he has told you what he cares about
LEAD_LINES = {"proximity": "You'd be close, {first}. Your folks could make every home game.",
              "playing_time": "We need {position} help now. You'd have a real shot at the field.",
              "prestige": "You know what this name means. Everybody does.",
              "winning": "We're built to win now, and we are not slowing down.",
              "nil": "The collective takes care of our guys. That's real, and it's yours.",
              "coach": "I'm not going anywhere. You'd play for me every year you're here.",
              "academics": "The degree here means something. Your mom will like that part."}
# he has a question (recruit questions): this turn introduces it
QUESTION_INTRO = "Can I ask you something?"

# an in-home visit opens with his family
FAMILY = ["His mom has the table set and the good plates out.",
          "His dad shakes your hand and doesn't let go for a while.",
          "His little brother asks if you know anybody in the NFL.",
          "His grandmother wants to know if there's a church near {school}.",
          "The whole family is on the couch in {town}. {first} sits closest to the door."]

# every table of lines (tests format each line with FIELDS)
TABLES = {"LINES": LINES, "TIRED": TIRED, "OPEN": OPEN, "VISIT_OPEN": VISIT_OPEN, "CONTEXT": CONTEXT, "PRESENT_SAID": PRESENT_SAID,
          "PRESENT_LINES": PRESENT_LINES, "ASK": ASK, "LEAD_LINES": LEAD_LINES, "FAMILY": FAMILY}
FIELDS = ("name", "first", "town", "state", "school", "position", "role", "record", "coach", "opponent", "result", "leader",
          "week_word", "a", "b", "x", "y", "z", "topic")

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


def coach_name(state: dict, slug: str) -> str:
    """Your last name: the created coach's, else the team's head coach's, else the school's name."""
    from sim import season
    car = (state.get("career") or {}).get("coach") or {}
    name = car.get("name") or ((season.load_teams().get(slug) or {}).get("coaches") or {}).get("head_coach", {}).get("name") or ""
    return name.split()[-1] if name.strip() else (season.load_teams().get(slug) or {}).get("name", slug)


def last_game(state: dict, slug: str, week: int) -> dict | None:
    """The school's most recent played game as of `week`: {"opponent", "won", "week"}; None before the first."""
    from sim import season
    teams = season.load_teams()
    best = None
    for g in state["games"].values():
        if not g.get("played") or g["week"] > week or slug not in (g["home"], g["away"]):
            continue
        if best is None or g["week"] > best["week"]:
            opp = g["away"] if g["home"] == slug else g["home"]
            mine, theirs = (g["home_score"], g["away_score"]) if g["home"] == slug else (g["away_score"], g["home_score"])
            best = {"opponent": (teams.get(opp) or {}).get("name", opp), "won": mine > theirs, "week": g["week"]}
    return best


def next_game(state: dict, slug: str, week: int) -> dict | None:
    """The school's next unplayed game: {"opponent", "week"}; None when the season is over."""
    from sim import season
    teams = season.load_teams()
    best = None
    for g in state["games"].values():
        if g.get("played") or g["week"] < week or slug not in (g["home"], g["away"]):
            continue
        if best is None or g["week"] < best["week"]:
            opp = g["away"] if g["home"] == slug else g["home"]
            best = {"opponent": (teams.get(opp) or {}).get("name", opp), "week": g["week"]}
    return best


def leader_of(state: dict, slug: str, pid: str) -> str:
    """The school leading his list as the board knows it (the week step's ranks), its name; "" when
    there is none yet or it is you."""
    from sim import season
    now = ((state["recruiting"].get("ranks") or {}).get(pid) or {}).get("now") or {}
    lead = next((s for s, rk in now.items() if rk == 1), None)
    if not lead or lead == slug:
        return ""
    return (season.load_teams().get(lead) or {}).get("name", lead)


def _fields(state: dict, slug: str, p: dict, week: int | None = None) -> dict:
    from sim import season
    team = season.load_teams().get(slug) or {}
    week = state["current_week"] if week is None else week
    game, nxt = last_game(state, slug, week), next_game(state, slug, week)
    return {"name": p["name"], "first": p["name"].split()[0], "town": p["hometown"]["city"] or p["hometown"]["state"],   # a transfer has no town on file
            "state": p["hometown"]["state"], "school": team.get("name", slug), "position": p["position"],
            "role": _role(state, slug, p["id"]), "record": _record(state, slug), "coach": coach_name(state, slug),
            "opponent": game["opponent"] if game else nxt["opponent"] if nxt else "", "result": ("beat" if game["won"] else "lost to") if game else "",
            "leader": leader_of(state, slug, p["id"]), "week_word": words(week)}


def _turn(who: str, text: str) -> dict:
    return {"who": who, "text": text}


def last_talk(state: dict, slug: str, pid: str, week: int) -> int | None:
    """The week of your last contact with him before this one (his History's contacts and pitches), or None."""
    weeks = [e["week"] for e in state["recruiting"]["log"]
             if e["pid"] == pid and e.get("school") == slug and e["kind"] in ("contact", "pitch") and e["week"] < week]
    return max(weeks) if weeks else None


def context_line(state: dict, slug: str, pid: str, week: int, f: dict, rng: random.Random, tired: bool) -> str:
    """His small talk, from what is true: your last game (first, when it was this past Saturday), the
    school leading his list, his own week; the opener before your first game; tired when the call pesters him."""
    if tired:
        return rng.choice(CONTEXT["tired"]).format(**f)
    game = last_game(state, slug, week)
    kinds = []
    if game:
        kinds.append("game")
    elif f["opponent"]:
        kinds.append("opener")
    if f["leader"]:
        kinds.append("leader")
    kinds.append("own")
    kind = "game" if game and game["week"] >= week - 1 else rng.choice(kinds)
    if kind == "game":
        kind = rng.choice(["game", "won" if game["won"] else "lost"])
    return rng.choice(CONTEXT[kind]).format(**f)


def open_scene(state: dict, slug: str, pid: str, action: str, week: int) -> dict:
    """A call's or in-home visit's scene as it opens: the room (a visit), your opener and his small
    talk. The cue and his question wait on your opening (`present`); his ask is as you know it."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    rng = random.Random(f"open-{rc['seed']}-{slug}-{pid}-{week}")
    f = _fields(state, slug, p, week)
    tired = recruiting.would_pester(state, slug, pid)
    turns = []
    if action == "hc_visit":
        turns.append(_turn("note", rng.choice(FAMILY).format(**f)))
        turns.append(_turn("you", rng.choice(VISIT_OPEN).format(**f)))
    else:
        prev = last_talk(state, slug, pid, week)
        table = OPEN["first"] if prev is None else OPEN["last_week"] if prev == week - 1 else OPEN["again"]
        turns.append(_turn("you", rng.choice(table).format(**f)))
    turns.append(_turn("him", context_line(state, slug, pid, week, f, rng, tired)))
    sc = {"id": f"{action}-{pid}-{week}", "action": action, "week": week, "turns": turns, "lines": [],
          "cue": None, "ask": recruiting.ask_view(state, slug, pid), "question": None, "presented": None, "tired": tired}
    _lines(sc)
    return sc


def _lines(sc: dict) -> None:
    sc["lines"] = [t["text"] for t in sc["turns"] if t["who"] == "him"]


def cue(state: dict, slug: str, pid: str, week: int, f: dict) -> dict:
    """The cue: one priority you have not heard (or two topics, one his and one not, CUE_TWO_SIDED
    of the time), as a complete answer in his voice."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    known = (rc["revealed"].get(slug) or {}).get(pid) or []
    true = next((t for t in p["priorities"] if t not in known), p["priorities"][0])
    rng = random.Random(f"cue-{rc['seed']}-{slug}-{pid}-{week}")
    if rng.random() < CUE_TWO_SIDED:
        decoy = rng.choice([t for t in recruiting.PITCHES if t not in p["priorities"]])
        topics = [true, decoy] if rng.random() < 0.5 else [decoy, true]
        text = rng.choice(LINES["_two_sided"]["cue"]).format(a=PHRASES[topics[0]], b=PHRASES[topics[1]], **f)
    else:
        topics = [true]
        text = rng.choice(LINES[true]["cue"]).format(**f)
    return {"topics": topics, "text": text}


def present(state: dict, slug: str, pid: str, sc: dict, topics: list[str], hits: list[str], back: list[str], tired: bool) -> str:
    """Your opening lands on the scene: your turn (the three things), his reaction (a hit names the
    priority you are strongest on; a weak one gets its quiet line; none, polite), your question, his
    cue, his question's intro when he has one, and on a visit his dad's ask. Returns the reaction's kind."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    week = sc["week"]
    rng = random.Random(f"present-{rc['seed']}-{slug}-{pid}-{week}")
    f = _fields(state, slug, p, week)
    x, y, z = (PHRASES[t] for t in topics)
    sc["turns"].append(_turn("you", rng.choice(PRESENT_SAID).format(x=x, y=y, z=z, **f)))
    if tired:
        kind, text = "tired", rng.choice(PRESENT_LINES["tired"]).format(**f)
    elif hits:
        st_ = recruiting.strengths(state, slug, pid)
        best = max(hits, key=lambda t: st_[t])
        phrase = PHRASES[best]
        kind, text = "hit", rng.choice(PRESENT_LINES["hit"]).format(topic=phrase[0].upper() + phrase[1:], **f)
    elif back:
        kind, text = "quiet", rng.choice(LINES[back[0]]["quiet"]).format(**f)
    else:
        kind, text = "polite", rng.choice(PRESENT_LINES["polite"]).format(**f)
    sc["turns"].append(_turn("him", text))
    c = cue(state, slug, pid, week, f)
    sc["turns"].append(_turn("you", rng.choice(ASK["two" if len(c["topics"]) > 1 else "one"]).format(**f)))
    sc["turns"].append(_turn("him", c["text"]))
    sc["cue"] = c
    if sc["action"] == "hc_visit":
        n = sc["ask"].get("exact", 0)
        sc["turns"].append(_turn("note", f"His dad asks what the collective can do: {words(n)} points." if n
                                 else "His dad says the money isn't the point."))
    sc["question"] = question(state, slug, pid, week)
    if sc["question"]:
        sc["turns"].append(_turn("him", QUESTION_INTRO))
    sc["presented"] = list(topics)
    sc["present"] = {"kind": kind, "hit": list(hits)}
    _lines(sc)
    return kind


def question(state: dict, slug: str, pid: str, week: int) -> dict | None:
    """His question about a named player, QUESTION_RATE of the time when playing time is one of his
    priorities (its own RNG: no other draw moves): the best returning player at his group on your
    roster rated at least as high ("roster"), else the highest-ranked other recruit you offered at
    his group who is uncommitted or yours ("recruit"); neither, no question."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    if "playing_time" not in p["priorities"]:
        return None
    rng = random.Random(f"question-{rc['seed']}-{slug}-{pid}-{week}")
    if rng.random() >= QUESTION_RATE:
        return None
    ahead = recruiting.ahead_of(state, slug, pid)
    if ahead:
        text = rng.choice(QUESTION_LINES["roster"]).format(ahead=ahead["name"], ahead_cls=CLASS_WORDS.get(ahead["cls"], "veteran"),
                                                           position=p["position"])
        return {"kind": "roster", "text": text, "answer": None, "reply": None,
                "about": {"id": ahead["slug"], "name": ahead["name"], "position": ahead["position"], "cls": ahead["cls"],
                          "ovr": ahead["ovr"], "last_year": ahead["last_year"]}}
    other = recruiting.other_offered(state, slug, pid)
    if other:
        text = rng.choice(QUESTION_LINES["recruit"]).format(other=other["name"])
        return {"kind": "recruit", "text": text, "answer": None, "reply": None,
                "about": {"pid": other["pid"], "name": other["name"], "position": other["position"],
                          "cls": rc["prospects"][other["pid"]].get("cls")}}
    return None


def answer_reply(state: dict, slug: str, pid: str, question: dict, answer: str, truthful: bool | None) -> str:
    """What he says back to your answer (a hollow promise gets its own line)."""
    if answer == "promise" and not truthful:
        return REPLY_LINES["hollow"]
    return REPLY_LINES[answer]


def reaction(state: dict, slug: str, pid: str, action: str, pitch: str, p: dict, tired: bool = False) -> dict:
    """How he takes your lead-with: a priority where you are strong lights him up (hit), one where you
    are weak goes quiet, anything else is polite; `tired` (the call pestered him) and the pitch falls
    flat. `you` is your line, for the conversation."""
    rng = random.Random(f"react-{state['recruiting']['seed']}-{slug}-{pid}-{state['current_week']}-{action}")
    f = _fields(state, slug, p)
    you = LEAD_LINES[pitch].format(**f)
    if tired:
        return {"kind": "tired", "text": rng.choice(TIRED).format(**f), "you": you}
    if pitch in p["priorities"]:
        kind = "hit" if recruiting.strengths(state, slug, pid)[pitch] >= recruiting.BACKFIRE else "quiet"
    else:
        kind = "polite"
    return {"kind": kind, "text": rng.choice(LINES[pitch][kind]).format(**f), "you": you}

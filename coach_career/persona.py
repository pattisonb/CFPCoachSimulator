"""Recruit personas (persona.py): every prospect has a personality (how he talks) and a decider
(who has the say in where he signs, and the one topic that decider cares about). A fixed draw from
the class seed and his id, worked out when asked and never stored in the save (a save from before
this keeps the persona it stored; a test may set one on the prospect)."""
from __future__ import annotations

import random
from functools import lru_cache

PERSONALITIES = ("cocky", "shy", "guarded", "attention", "business")   # equally likely
PERSONALITY_LABEL = {"cocky": "Cocky", "shy": "Shy", "guarded": "Guarded", "attention": "Loves the Attention", "business": "All Business"}

DECIDERS = {"self": 0.30, "mom": 0.20, "dad": 0.15, "grandma": 0.10, "hs_coach": 0.15, "trainer": 0.10}   # who decides, by share *tune*
DECIDER_LABEL = {"self": "Himself", "mom": "Mom", "dad": "Dad", "grandma": "Grandmother", "hs_coach": "High School Coach", "trainer": "Trainer"}
PORTAL_DECIDERS = ("self", "mom", "dad", "trainer")   # a transfer's decider: no high school coach or grandmother (their shares renormalized)
DECIDER_TOPICS = {"self": (), "mom": ("proximity", "academics"), "dad": ("nil", "playing_time"), "grandma": ("proximity", "coach"),
                  "hs_coach": ("coach", "playing_time", "winning"), "trainer": ("nil",)}   # what each decider cares about


def draw(pid: str, seed, portal: bool = False) -> dict:
    """His personality, decider and the decider's topic (None when he decides himself). A transfer in
    the portal (`portal`) keeps the same personality draw; his decider comes from its own stream and
    only PORTAL_DECIDERS, so the class draw never moves."""
    rng = random.Random(f"persona-{seed}-{pid}")
    personality = rng.choice(PERSONALITIES)
    decider = rng.choices(list(DECIDERS), weights=list(DECIDERS.values()))[0]
    if portal:
        rng = random.Random(f"persona-portal-{seed}-{pid}")
        decider = rng.choices(PORTAL_DECIDERS, weights=[DECIDERS[d] for d in PORTAL_DECIDERS])[0]
    topics = DECIDER_TOPICS[decider]
    return {"personality": personality, "decider": decider, "decider_topic": rng.choice(topics) if topics else None}


@lru_cache(maxsize=20000)
def _drawn(pid: str, seed, portal: bool = False) -> dict:
    return draw(pid, seed, portal)


def of(state: dict, pid: str) -> dict:
    """The prospect's persona (read only): the one on the prospect when a save or a test set it,
    otherwise his fixed draw (the portal's for a transfer), cached in memory and not written into the state."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    return p["persona"] if "persona" in p else _drawn(pid, rc.get("seed", 0), bool(rc.get("portal")))


# ----- what the personality and the decider change in recruiting --------------------------------------

ATTENTION_GAP = 2                # weeks without a contact before a Loves-the-Attention recruit cools on a school *tune*
COCKY_PITCH = 1.3                # Cocky: playing time and prestige pitches count this much more *tune*
SHY_VISIT = 1.5                  # Shy: an in-home visit counts this much more *tune*
SHY_FIRST_CALL = 0.5             # Shy: his first call from a school counts this much *tune*
BUSINESS_MESSAGE = 0.3           # All Business: a message counts this much *tune*
BUSINESS_OFFER = 1.3             # All Business: an offer and its NIL count this much more *tune*
DECIDER_VISIT = 1.2              # an in-home visit on the topic his decider cares about counts this much more *tune*
COCKY_LOWBALL, TRAINER_LOWBALL = 0.7, 0.8     # the share of his ask under which an offer is a lowball *tune*
TRAINER_OVER = 1.2               # the Trainer counts NIL at full value up to this multiple of his ask *tune*
COCKY_HOLLOW = 2.0               # Cocky: a hollow promise costs this many times more *tune*
ATTENTION_PESTER_FREE = 5        # Loves the Attention: contacts before more start to pester *tune*
GUARDED_DECOMMIT = 0.5           # Guarded: his weekly decommit chance is this share of the usual *tune*


def pitch_mult(state: dict, pid: str, action: str, pitch, first_call: bool = False) -> float:
    """What his personality and decider do to a pitch's worth (before diminishing returns)."""
    d = of(state, pid)
    k, m = d["personality"], 1.0
    if k == "cocky" and pitch in ("playing_time", "prestige"):
        m *= COCKY_PITCH
    elif k == "shy":
        if action == "hc_visit":
            m *= SHY_VISIT
        elif action == "call" and first_call:
            m *= SHY_FIRST_CALL
    elif k == "business" and action == "message":
        m *= BUSINESS_MESSAGE
    if action == "hc_visit" and pitch is not None and pitch == d["decider_topic"]:
        m *= DECIDER_VISIT
    return m


def counts_as_priority(state: dict, pid: str, pitch) -> bool:
    """A pitch on one of his priorities, or on the topic his decider cares about, lands as a priority."""
    p = state["recruiting"]["prospects"][pid]
    return pitch in p["priorities"] or (pitch is not None and pitch == of(state, pid)["decider_topic"])


def lowball_share(state: dict, pid: str) -> float:
    """The share of his ask under which an offer reads as a lowball."""
    from coach_career import recruiting
    d = of(state, pid)
    if d["personality"] == "cocky":
        return COCKY_LOWBALL
    if d["decider"] == "trainer":
        return TRAINER_LOWBALL
    return recruiting.LOWBALL


def nil_over(state: dict, pid: str) -> tuple:
    """(the share of value NIL past his ask counts, up to what multiple of his ask it counts that way)."""
    from coach_career import recruiting
    if of(state, pid)["decider"] == "trainer":
        return (1.0, TRAINER_OVER)
    return (recruiting.NIL_OVER, float("inf"))


def offer_mult(state: dict, pid: str) -> float:
    return BUSINESS_OFFER if of(state, pid)["personality"] == "business" else 1.0


def hollow_mult(state: dict, pid: str) -> float:
    return COCKY_HOLLOW if of(state, pid)["personality"] == "cocky" else 1.0


def pester_free(state: dict, pid: str) -> int:
    from coach_career import recruiting
    return ATTENTION_PESTER_FREE if of(state, pid)["personality"] == "attention" else recruiting.PESTER_FREE


def call_reveals(state: dict, slug: str, pid: str, roll: bool = True) -> bool:
    """Whether a call tells the school one of his priorities: never for Guarded, not on the first call
    for Shy, otherwise today's roll (`roll=False`: only the personality's gate, for a scene's pitch)."""
    from coach_career import recruiting
    k = of(state, pid)["personality"]
    if k == "guarded":
        return False
    if k == "shy" and not (state["recruiting"]["contacts"].get(pid, {}).get(slug) or {}).get("calls", 0):
        return False
    if not roll:
        return True
    rc = state["recruiting"]
    return random.Random(f"call-{rc['seed']}-{slug}-{pid}-{state['current_week']}").random() < recruiting.CALL_REVEAL


def decommit_mult(state: dict, pid: str) -> float:
    return GUARDED_DECOMMIT if of(state, pid)["personality"] == "guarded" else 1.0


def cool_quiet(state: dict, week: int) -> None:
    """A Loves-the-Attention recruit cools on a school that has not been in touch for ATTENTION_GAP weeks."""
    rc = state["recruiting"]
    for pid, by in rc["contacts"].items():
        if rc["status"][pid]["signed"]:
            continue
        for slug, c in by.items():
            if rc["status"][pid]["committed"] == slug:      # post-commit attention is the commit style's, not this
                continue
            last = c.get("last_contact")
            if last is None or last > week - ATTENTION_GAP or (c.get("cooled_until") or -1) >= week + 1:
                continue
            if of(state, pid)["personality"] == "attention":
                c["cooled_until"] = week + 1
                set_cooled_why(state, slug, pid, "quiet")


def set_cooled_why(state: dict, slug: str, pid: str, why: str) -> None:
    """Why he cooled on the player's school ("lowball", "promise" or "quiet"), for the words the page
    shows; kept off the contact (the recruiting digest) and only for the player's school."""
    if slug == state.get("team"):
        state["recruiting"].setdefault("cooled_why", {}).setdefault(slug, {})[pid] = why


def cooled_why(state: dict, slug: str, pid: str) -> str:
    """Why he is cooled on the school; a save from before this, or an AI school: "lowball"."""
    return ((state["recruiting"].get("cooled_why") or {}).get(slug) or {}).get(pid) or "lowball"


# ----- discovery: what a school has learned about him ---------------------------------------------------

DECIDER_LOOKS = 2.0              # looks of his report before the player's staff learns who decides *tune*
PERSONALITY_LINE = {"cocky": "Your staff learned he's cocky.", "shy": "Your staff learned he's shy.",
                    "guarded": "Your staff learned he's guarded.", "attention": "Your staff learned he loves the attention.",
                    "business": "Your staff learned he's all business."}
DECIDER_LINE = {"self": "Your staff learned he makes his own call.", "mom": "Your staff learned his mom has the final say.",
                "dad": "Your staff learned his dad has the final say.", "grandma": "Your staff learned his grandmother has the final say.",
                "hs_coach": "Your staff learned his high school coach has the final say.", "trainer": "Your staff learned his trainer has the final say."}


def known(state: dict, slug: str, pid: str) -> dict:
    """What `slug` has learned about him: {"personality": bool, "decider": bool}. The player's staff
    knows his decider once its read holds DECIDER_LOOKS looks, logged or not (a save from before the
    decider was learned in look() never logged it)."""
    from coach_career import recruiting
    rc = state["recruiting"]
    k = ((rc.get("traits_known") or {}).get(slug) or {}).get(pid) or {}
    decider = bool(k.get("decider")) or (slug == state.get("team") and recruiting.report_looks((rc.get("reads") or {}).get(pid)) >= DECIDER_LOOKS)
    return {"personality": bool(k.get("personality")), "decider": decider}


def learn(state: dict, slug: str, pid: str, trait: str) -> bool:
    """`slug` learns one of his traits; True when newly learned. Only the player's school keeps a map
    (nothing reads an AI school's yet), and only the player's learning is logged for his History."""
    from coach_career import recruiting
    if slug != state.get("team"):
        return False
    rc = state["recruiting"]
    mine = rc.setdefault("traits_known", {}).setdefault(slug, {}).setdefault(pid, {"personality": False, "decider": False})
    if mine.get(trait):
        return False
    mine[trait] = True
    d = of(state, pid)
    line = PERSONALITY_LINE[d["personality"]] if trait == "personality" else DECIDER_LINE[d["decider"]]
    recruiting._event(state, "learned", pid, slug, trait=trait, line=line)
    return True


def learn_on_contact(state: dict, slug: str, pid: str, action: str) -> None:
    """His personality shows on the school's first call or first in-home visit (Guarded: the visit only)."""
    guarded = of(state, pid)["personality"] == "guarded"
    if action == "hc_visit" or (action == "call" and not guarded):
        learn(state, slug, pid, "personality")


def learn_from_read(state: dict, pid: str, looks: float) -> None:
    """His decider shows once the player's read of him holds DECIDER_LOOKS looks."""
    if looks >= DECIDER_LOOKS:
        learn(state, state["team"], pid, "decider")


def view(state: dict, viewer: str, pid: str) -> dict:
    """What `viewer` may show of him: labels, or None for Not Known Yet."""
    d, k = of(state, pid), known(state, viewer, pid)
    return {"personality": PERSONALITY_LABEL[d["personality"]] if k["personality"] else None,
            "decider": DECIDER_LABEL[d["decider"]] if k["decider"] else None,
            "decider_topic": d["decider_topic"] if k["decider"] else None}


# ----- how each personality and decider sounds in calls and in-home visits (scenes.py reads these) ------
# His voice, present tense, no numbers; only scenes.FIELDS placeholders. `open` answers your opener on a
# call and `visit_open` answers it in his living room; `small_talk`, `hit` and `quiet` play on a call or
# a visit, so they say nothing about the phone. `hit` and `quiet` react to a pitch or your presentation
# and name no topic, so a call that keeps his priority to himself still tells you nothing.
LINES: dict[str, dict[str, list[str]]] = {
    "cocky": {
        "open": ["Coach {coach}! Yeah, I figured {school} would call. Everybody does.",
                 "Hey Coach. Go ahead, you've got my attention. Not for long, but you do.",
                 "Yeah, it's {first}. You're calling the right guy, Coach.",
                 "About time, Coach. I've been waiting on {school} to step up."],
        "visit_open": ["Coach {coach}! Come on in. I figured {school} would show up sooner or later.",
                       "Have a seat, Coach. You've got my attention. Not for long, but you do.",
                       "Glad you made the trip, Coach. You're talking to the right guy.",
                       "About time, Coach. I've been waiting on {school} to step up."],
        "small_talk": ["You know I'm the best {position} in {state}, right? Just checking.",
                       "Man, my highlight tape keeps blowing up. Coaches can't stop watching it.",
                       "Everybody in {town} says I'm next. I'm not going to argue with them.",
                       "Everybody wants to talk to me this month. It's a nice problem."],
        "hit": ["Now you're talking, Coach. That's what a guy like me needs to hear.",
                "See, that's why I'm listening. You get it.",
                "Yeah, that's more like it. I like it.",
                "Good. You know what you've got in me."],
        "quiet": ["Hmm. That's not what I expected from {school}, Coach.",
                  "I'm used to bigger pitches than that.",
                  "That doesn't move me. Try again.",
                  "Come on, Coach. Is that really your best?"],
    },
    "shy": {
        "open": ["Oh. Hi, Coach. Yeah, um, I can talk.",
                 "Hey. Sorry, I wasn't sure who it was. Hi, Coach.",
                 "Hi. Yes sir. I've got a minute.",
                 "Oh, hey, Coach {coach}. Thanks for calling."],
        "visit_open": ["Oh. Hi, Coach. Um, come in. Thanks for coming.",
                       "Hey. Sorry, I'm kind of nervous. Hi, Coach.",
                       "Hi. Yes sir. Please, sit down.",
                       "Oh, hey, Coach {coach}. Thanks for coming all this way."],
        "small_talk": ["Um, it's been a long week. School, practice, you know.",
                       "I was just doing homework. It's fine, though.",
                       "My mom said you might come by. I didn't know what to say.",
                       "Sorry, I'm not great at talking to coaches, Coach."],
        "hit": ["Oh. Yeah. That sounds really good, Coach.",
                "Okay. I like that. I do.",
                "That's... that's actually what I was hoping for.",
                "Huh. Yeah. That helps, Coach."],
        "quiet": ["Oh. Um. I don't know about that.",
                  "Yeah, okay. I'll have to think about it.",
                  "...I'm not sure, Coach.",
                  "Sorry. That's not really what I was thinking."],
    },
    "guarded": {
        "open": ["Yeah, this is {first}. What's up, Coach?",
                 "Okay. Who is this again? {school}? Okay.",
                 "I've got a minute. Not a long one.",
                 "Coach {coach}. Sure. What do you need?"],
        "visit_open": ["Coach {coach}. Come in. Make it quick, if you can.",
                       "Okay. {school}. Sit down, Coach.",
                       "You're here. Fine. I've got a little time.",
                       "Coach {coach}. Sure. What do you need from me?"],
        "small_talk": ["Not much going on. Same as always.",
                       "I'd rather not get into my week, Coach.",
                       "It's fine. Everything's fine. What did you want to talk about?",
                       "People ask me a lot of questions. I'm used to it."],
        "hit": ["Okay. That's fine, I guess.",
                "Noted, Coach. I'll think about it.",
                "Maybe. I'm not saying more than that.",
                "Not bad. Don't read too much into that."],
        "quiet": ["I hear you. That's all I'm going to say.",
                  "Okay. We'll see.",
                  "That doesn't tell me much, Coach.",
                  "Hm. Let's leave it there."],
    },
    "attention": {
        "open": ["Coach {coach}! Oh man, I love getting your calls!",
                 "Hey Coach! I was hoping you'd call today. Seriously.",
                 "{school}! Yes! Okay, tell me everything.",
                 "Coach! You made my day. I'm all ears."],
        "visit_open": ["Coach {coach}! Oh man, you're actually here! Come in!",
                       "Hey Coach! I was hoping you'd come by. Seriously.",
                       "{school}! Yes! Okay, sit down and tell me everything.",
                       "Coach! You made my whole week. I'm all ears."],
        "small_talk": ["Dude, my texts have not stopped. It's wild.",
                       "My friends in {town} keep asking who came by. I love telling them.",
                       "I'm telling you, this is the best part. I could talk all day.",
                       "Did you see my last post? People are going crazy for it."],
        "hit": ["Yes! That's so good, Coach! Keep it coming!",
                "Okay, wow. I love that. Tell me more!",
                "Oh, that's exactly it! You get me, Coach.",
                "That's awesome. Seriously, I'm smiling right now."],
        "quiet": ["Aw, really? I was hoping for something bigger, Coach.",
                  "Hm. That's not as exciting as I thought it would be.",
                  "Okay... I guess. Got anything better?",
                  "Oh. That's kind of a bummer, honestly."],
    },
    "business": {
        "open": ["Coach {coach}. Go ahead.",
                 "I've got a few minutes. What do you have for me?",
                 "Okay. Let's get to it, Coach.",
                 "Appreciate the call. What's the plan for me at {school}?"],
        "visit_open": ["Coach {coach}. Have a seat. Go ahead.",
                       "I've got a little time. What do you have for me?",
                       "Okay. Let's get to it, Coach.",
                       "Appreciate you coming. What's the plan for me at {school}?"],
        "small_talk": ["I'd rather skip the small talk, Coach.",
                       "Let's keep this to football.",
                       "Time is short. What do you need from me?"],
        "hit": ["That's specific. I can work with that.",
                "Good. I need specifics, and that's one.",
                "Okay. That checks out, Coach.",
                "That's what I'm looking for. Put it in writing and we'll talk."],
        "quiet": ["That's not specific enough, Coach.",
                  "I need more than that.",
                  "That doesn't tell me much.",
                  "Come back with something concrete."],
    },
}

# what he says when a call keeps his priority to himself (a Guarded recruit, a Shy one's first call):
# a cue that names no topic
NO_TOPIC = {
    "guarded": ["I don't know, Coach. I keep that to myself.",
                "That's between me and my family, Coach.",
                "I'm not telling anybody that yet.",
                "You'll have to earn that one, Coach."],
    "shy": ["I don't know, Coach. I'm still figuring it out.",
            "Um, I'm not sure yet. Sorry.",
            "I haven't really thought about it, Coach.",
            "That's hard to say. I don't know you very well yet."],
}

# the one turn the decider takes in an in-home visit (who: "family"): the voice of the person who decides
# (no topic named: what he cares about is learned, not told). Himself has none.
DECIDER_LINES: dict[str, list[str]] = {
    "mom": ["We're glad you came, Coach. I just want to know my son will be looked after.",
            "Have you eaten? Sit down. I want to hear how you'll take care of him up there.",
            "He's still my baby, Coach. You'll treat him right, won't you?",
            "I'll be honest, I worry. Tell me he'll be safe and have people looking out for him.",
            "I like you, Coach. Now convince me he's in good hands."],
    "dad": ["I'll cut to it, Coach. What can you do for my son?",
            "I've heard a lot of talk from coaches. I want straight answers.",
            "Don't waste my time. Tell me what he gets and what he has to earn.",
            "My son works hard. I expect the same from a school that wants him.",
            "Don't sell me. Show me."],
    "grandma": ["Bless you for coming, Coach. Family means everything to us.",
                "I pray for him every night, Coach. I want him somewhere good for his heart, too.",
                "Is he going to be around good people, Coach? That matters most to me.",
                "He's a sweet boy, Coach. Promise me you'll look after him.",
                "Come sit by me, Coach. Let's talk about what's best for him."],
    "hs_coach": ["Coach {coach}, good to see you. I've coached this young man for years, so I'll tell you straight.",
                 "I'd like to hear your plan for his development, Coach. I want to see the full picture.",
                 "He's been well prepared. I expect the next program to keep that standard.",
                 "I've seen plenty of programs make promises, Coach. I'll be watching how you follow through.",
                 "My job is to make sure he lands in the right place. Walk me through how you'd use him."],
    "trainer": ["Let's talk value, Coach. What's the number, and what does it look like on the field?",
                "I've put a lot into this kid. I need to see what {school} brings to the table.",
                "Everyone has an offer. What's your best number?",
                "He's an asset, Coach. Show me how {school} makes him more valuable.",
                "I'm looking at the package, Coach. The whole thing, not the speech."],
}

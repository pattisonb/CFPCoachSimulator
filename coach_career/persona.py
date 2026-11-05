"""Recruit personas (persona.py): every prospect has a personality (how he talks) and a decider
(who has the say in where he signs, and the one topic that decider cares about). A fixed draw from
the class seed and his id, worked out when asked and never stored in the save (a save from before
this keeps the persona it stored; a test may set one on the prospect)."""
from __future__ import annotations

import math
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


def hollow_mult(state: dict, pid: str, slug=None) -> float:
    """What a hollow promise costs, times the usual: double for a Cocky recruit, and double again from his
    legacy school (his story)."""
    m = COCKY_HOLLOW if of(state, pid)["personality"] == "cocky" else 1.0
    k, d = story(state, pid)
    return m * (LEGACY_COST if slug is not None and k == "legacy" and d.get("school") == slug else 1.0)


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
    """What `slug` has learned about him: {"personality": bool, "decider": bool, "story": bool}. The
    player's staff knows his decider once its read holds DECIDER_LOOKS looks and his story at a complete
    report, logged or not (a save from before these were learned in look() never logged them); a public
    story (story_public) is known to everyone."""
    from coach_career import recruiting
    rc = state["recruiting"]
    k = ((rc.get("traits_known") or {}).get(slug) or {}).get(pid) or {}
    looks = recruiting.report_looks((rc.get("reads") or {}).get(pid)) if slug == state.get("team") else 0.0
    return {"personality": bool(k.get("personality")), "decider": bool(k.get("decider")) or looks >= DECIDER_LOOKS,
            "story": bool(k.get("story")) or looks >= recruiting.REPORT_LOOKS or story_public(state, pid)}


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
    if trait == "story":                          # a story your staff did not already know of (not a public one, not none)
        line = story_learned_line(state, pid)
        if line:
            recruiting._event(state, "learned", pid, slug, trait=trait, line=line)
        return True
    d = of(state, pid)
    line = PERSONALITY_LINE[d["personality"]] if trait == "personality" else DECIDER_LINE[d["decider"]]
    recruiting._event(state, "learned", pid, slug, trait=trait, line=line)
    return True


def learn_on_contact(state: dict, slug: str, pid: str, action: str) -> None:
    """His personality shows on the school's first call or first in-home visit (Guarded: the visit only);
    a Package Deal tells the school about his mate the first time it calls or visits."""
    guarded = of(state, pid)["personality"] == "guarded"
    if action == "hc_visit" or (action == "call" and not guarded):
        learn(state, slug, pid, "personality")
    if action in ("call", "hc_visit") and story(state, pid)[0] == "package":
        learn(state, slug, pid, "story")


def learn_from_read(state: dict, pid: str, looks: float) -> None:
    """His decider shows once the player's read of him holds DECIDER_LOOKS looks, his story at a complete report."""
    from coach_career import recruiting
    if looks >= DECIDER_LOOKS:
        learn(state, state["team"], pid, "decider")
    if looks >= recruiting.REPORT_LOOKS:
        learn(state, state["team"], pid, "story")


def story_public(state: dict, pid: str) -> bool:
    """Everyone knows a Hometown Hero, an Injury Comeback and a Late Bloomer who has jumped."""
    k, _ = story(state, pid)
    return k in PUBLIC_STORIES or (k == "bloomer" and "real" not in state["recruiting"]["prospects"][pid])


def _name_of(state: dict, pid: str) -> str:
    return (state["recruiting"]["prospects"].get(pid) or {}).get("name") or ""


def _school_name(slug) -> str:
    from sim import season
    return (season.load_teams().get(slug) or {}).get("name", slug or "")


def story_learned_line(state: dict, pid: str):
    """His History's sentence when your staff finds out his story; None for a public story or none."""
    k, d = story(state, pid)
    if k is None or story_public(state, pid):
        return None
    return STORY_LEARNED[k].format(school=_school_name(d.get("school")), mate=_name_of(state, d.get("mate")))


def story_detail(state: dict, viewer: str, pid: str):
    """The few words after his story's label (Title Case): a legacy's school, his mate, the draft risk from you."""
    k, d = story(state, pid)
    if k == "legacy":
        return _school_name(d.get("school"))
    if k == "package":
        return f"With {_name_of(state, d.get('mate'))}"
    if k == "two_sport":
        return f"Draft Risk: {draft_word(draft_risk(state, viewer, pid))}"
    return None


def view(state: dict, viewer: str, pid: str) -> dict:
    """What `viewer` may show of him: labels, or None for Not Known Yet. His story: its label (NO_STORY when
    a complete report found none), `story_key` and `story_detail` (a legacy's school, his mate, "Draft Risk: Some")."""
    d, k = of(state, pid), known(state, viewer, pid)
    kind = story(state, pid)[0] if k["story"] else None
    return {"personality": PERSONALITY_LABEL[d["personality"]] if k["personality"] else None,
            "decider": DECIDER_LABEL[d["decider"]] if k["decider"] else None,
            "decider_topic": d["decider_topic"] if k["decider"] else None,
            "story": (STORY_LABEL[kind] if kind else NO_STORY) if k["story"] else None,
            "story_key": kind,
            "story_detail": story_detail(state, viewer, pid) if kind else None,
            # his legacy school is the viewer's own: the tip speaks to you, not about "them"
            "story_yours": bool(kind == "legacy" and story(state, pid)[1].get("school") == viewer)}


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


# ----- his story (spec section 2): Legacy, Hometown Hero, Package Deal, Two-Sport, Injury Comeback, Late Bloomer -----
# A class-wide fixed draw from the seed (each prospect's own stream `story-{seed}-{pid}`; a Package Deal's
# mate from `story-mate-{seed}-{pid}`), worked out when asked and never stored: {pid: {"story", "story_data"}}
# for the prospects who have one. Only a class drawn with stories (rc["stories"], set by recruiting.start)
# has any: a save from before keeps playing without them, and the portal has none. The one thing stored is
# a shown-low prospect's real stars and composite (p["real"]: an Injury Comeback all season, a Late Bloomer
# until his jump), since the class's shown stars, composite and rank are what everyone reads.

STORIES = {"legacy": 0.15, "hero": 0.20, "package": 0.15, "two_sport": 0.15, "comeback": 0.15, "bloomer": 0.20}   # *tune* each story's share of the stories
STORY_RATE = {5: 0.53, 4: 0.53, 3: 0.30, 2: 0.30}     # *tune* the share of a star level drawn a story (his real stars); with the Package Deal mates about 35% of the class, half the blue chips
STORY_LABEL = {"legacy": "Legacy", "hero": "Hometown Hero", "package": "Package Deal", "two_sport": "Two-Sport",
               "comeback": "Injury Comeback", "bloomer": "Late Bloomer"}
NO_STORY = "No Story"                                   # a complete report that found none
PUBLIC_STORIES = ("hero", "comeback")                   # everyone knows these at once (a Late Bloomer's jump is public too)
TWO_SPORT_GROUPS = ("QB", "RB", "WR", "TE", "LB", "CB", "S")   # who also plays baseball
MATE_NEAR = 4              # *tune* a Package Deal's mate is one of this many prospects rated just under him (his town first, else his state)
LEGACY_TILT = 1.0          # *tune* a legacy school is drawn by exp(this x the program's strength): the big programs have more
LEGACY_HEAD = 8.0          # *tune* the legacy school's head start, in interest points on his list
LEGACY_PITCH = 1.2         # *tune* another school's Coach or Prestige pitch against a legacy counts this much more
LEGACY_LEVEL = 0.5         # *tune* a legacy school recruits its legacy hard only at a star level it signs this share of the nation's rate or more
LEGACY_COST = 2.0         # *tune* the legacy school's lowball (its cooling) or hollow promise costs this many times more
HERO_STATE = 1.4           # *tune* a Hometown Hero's pull toward the schools in his state counts this much more
HERO_AWAY = 0.8            # *tune* an out-of-state pitch to a hero counts this much (Playing Time and NIL in full)
HERO_FULL = ("playing_time", "nil")
DRAFT_RISK = 0.30          # *tune* a Two-Sport recruit's chance to go pro in baseball when he signs ...
DRAFT_FLOOR = 0.05         # *tune* ... never under this ...
DRAFT_PT = 0.04            # *tune* ... less this for each Playing Time pitch from the school he signs with ...
DRAFT_NIL = 0.5            # *tune* ... and this per his ask's worth of NIL over his ask (1.2 times his ask: 0.10 off)
DRAFT_WORDS = ((0.20, "High"), (0.10, "Some"), (0.0, "Low"))   # the risk as the page says it: at or past the share
COMEBACK_AI = 0.6          # *tune* an AI school that would offer an Injury Comeback does this often (it doubts the knee)
LOYALTY = 1.25             # *tune* contacts from a school that reached a comeback before LOYALTY_WEEK count this much more
LOYALTY_WEEK = 6
COMEBACK_READ = 1.5        # *tune* a look's error on a comeback's potential, times the usual: the knee clouds his ceiling
SHOWN_BAND = 6.0           # *tune* grade points the public grades understate a shown-low prospect (a comeback, a bloomer before his jump)
BLOOM_WEEKS = (5, 9)       # a Late Bloomer jumps at the week step after one of these weeks (inclusive)
COMEBACK_SHOWN = 1.0       # *tune* a comeback's shown composite comes from the top this share of the band under his own (1: anywhere in it)
BLOOM_SHOWN = 0.5          # *tune* a bloomer's shown composite comes from the bottom this share of his starting band: unranked
BLOOM_BOARDS = 10          # *tune* AI schools that add a bloomer to their boards at his jump: the ones he fits best
STORY_CALL_LINE = 0.35     # *tune* how often a call's small talk is his story, once the school knows it

_STORIES: tuple = (None, None, {})   # (the recruiting block, its key, its stories): the draw for one class, in memory only


def _real(p: dict) -> tuple:
    """His real (stars, composite): the shown ones unless he is shown low."""
    r = p.get("real") or p
    return r["stars"], r["composite"]


def _eligible(kind: str, p: dict, stars: int, fbs_states: set, generational: set) -> bool:
    from coach_career import recruiting
    if kind == "hero":
        return p["hometown"]["state"] in fbs_states            # a state with no FBS school has no hometown team to stay with
    if kind == "two_sport":                                    # his group read without caching it on the prospect (the save stays small)
        return (p.get("group") or recruiting._group_of({"ea_position": p["ea_position"]})) in TWO_SPORT_GROUPS
    if kind in ("comeback", "bloomer"):                        # a generational talent is no secret
        return p["id"] not in generational and (kind == "comeback" or stars >= 3)
    return True


def _draw_class(state: dict) -> dict:
    """Every story in the class: each prospect's own stream decides whether he has one (STORY_RATE by his
    real stars) and which (STORIES, among those that fit him) and its data; then each Package Deal lead is
    paired with a lower-rated prospect from his town, else his state, who has no story of his own and is
    not hidden (a lead with none left has no story). Best prospects first, so the pairing is one order."""
    from coach_career import recruiting
    from sim import season
    rc = state["recruiting"]
    seed = rc.get("seed", 0)
    teams = season.load_teams()
    schools = recruiting.fbs_schools(state)
    weights = [math.exp(LEGACY_TILT * recruiting._baseline(s)) for s in schools]
    fbs_states = {teams[s].get("state") for s in schools}
    gen = set(rc.get("generational") or ())
    pros = rc["prospects"]
    order = sorted(pros, key=lambda q: (-_real(pros[q])[1], q))
    fits = {pid: [k for k in STORIES if _eligible(k, pros[pid], _real(pros[pid])[0], fbs_states, gen)] for pid in order}
    # a story only some prospects can have weighs more for them, so its share of the class holds; a Package
    # Deal lead weighs half, his mate (drawn below, from the prospects without a story) making the other half
    weight = {k: STORIES[k] * len(order) / max(1, sum(1 for pid in order if k in fits[pid])) * (0.5 if k == "package" else 1.0) for k in STORIES}
    out: dict = {}
    for pid in order:
        p = pros[pid]
        stars = _real(p)[0]
        rng = random.Random(f"story-{seed}-{pid}")
        if rng.random() >= STORY_RATE.get(stars, STORY_RATE[2]):
            continue
        ok = fits[pid]
        kind = rng.choices(ok, weights=[weight[k] for k in ok])[0]
        data: dict = {}
        if kind == "legacy":
            data["school"] = rng.choices(schools, weights=weights)[0]
        elif kind == "hero":
            data["state"] = p["hometown"]["state"]
        elif kind == "bloomer":                                  # starts at two or three stars: a five-star jumps two, a three-star one
            data["week"] = rng.randint(*BLOOM_WEEKS)
            data["jump"] = 1 if stars == 3 else 2 if stars == 5 else rng.choice((1, 2))
        out[pid] = {"story": kind, "story_data": data}
    by_state: dict = {}
    for pid in order:
        by_state.setdefault(pros[pid]["hometown"]["state"], []).append(pid)
    for pid in order:
        s = out.get(pid)
        if not s or s["story"] != "package" or "mate" in s["story_data"]:
            continue
        p = pros[pid]
        comp = _real(p)[1]
        pool = [q for q in by_state[p["hometown"]["state"]] if q not in out and not pros[q].get("hidden")
                and q not in gen and _real(pros[q])[1] < comp]
        town = [q for q in pool if pros[q]["hometown"].get("city") and pros[q]["hometown"]["city"] == p["hometown"].get("city")]
        cands = (town or pool)[:MATE_NEAR]                       # the best few just under him (the pool runs best first)
        if not cands:
            del out[pid]
            continue
        mate = random.Random(f"story-mate-{seed}-{pid}").choice(cands)
        s["story_data"] = {"mate": mate, "lead": True}
        out[mate] = {"story": "package", "story_data": {"mate": pid, "lead": False}}
    return out


def stories(state: dict) -> dict:
    """The class's stories {pid: {"story", "story_data"}} (read only; {} for a class from before stories and
    for the portal), drawn once a process and kept in memory, never in the save."""
    global _STORIES
    rc = (state or {}).get("recruiting") or {}
    if rc.get("portal") or not rc.get("stories") or not rc.get("prospects"):
        return {}
    cached = _STORIES
    if cached[0] is rc:
        return cached[2]
    key = (state.get("id"), rc.get("year"), rc.get("seed"), len(rc["prospects"]))
    cached = (rc, key, cached[2] if cached[1] == key else _draw_class(state))
    _STORIES = cached
    return cached[2]


def story(state: dict, pid: str) -> tuple:
    """(his story or None, its data): the one a save or a test set on his persona, else the class's draw."""
    p = state["recruiting"]["prospects"].get(pid) or {}
    forced = p.get("persona")
    if forced and "story" in forced:
        return forced["story"], forced.get("story_data") or {}
    s = stories(state).get(pid)
    return (s["story"], s["story_data"]) if s else (None, {})


def mate(state: dict, pid: str):
    """A Package Deal's other half, or None."""
    k, d = story(state, pid)
    return d.get("mate") if k == "package" else None


def rerank(rc: dict) -> None:
    """The class ranked 1..N again by the shown composite (ties keep their order)."""
    pros = rc["prospects"]
    for i, pid in enumerate(sorted(pros, key=lambda q: (-pros[q]["composite"], pros[q]["rank"], q)), 1):
        pros[pid]["rank"] = i


def apply_stories(state: dict) -> None:
    """A new class's stories take their places (recruiting.start): an Injury Comeback shown one star under his own and a Late Bloomer at his starting two or three stars
    (`story-shown-{seed}-{pid}` draws the shown composite inside that band: a comeback's from its top
    COMEBACK_SHOWN, a bloomer's from its bottom BLOOM_SHOWN), each one's NIL ask from his shown stars; the class re-ranked. Marks the class."""
    from coach_career import recruiting, recruits
    global _STORIES
    rc = state["recruiting"]
    drawn = _draw_class(state)
    bands = recruits.model()["generation"]["rating_quantiles"]
    for pid, s in drawn.items():
        p, kind, d = rc["prospects"][pid], s["story"], s["story_data"]
        if kind in ("comeback", "bloomer"):
            shown = max(2, p["stars"] - (d["jump"] if kind == "bloomer" else 1))
            r = random.Random(f"story-shown-{rc.get('seed', 0)}-{pid}").random()
            u = r * BLOOM_SHOWN if kind == "bloomer" else 1.0 - r * COMEBACK_SHOWN
            comp = round(recruits.from_quantiles(bands[str(shown)], u), 4)
            p["real"] = {"stars": p["stars"], "composite": p["composite"]}
            p["stars"], p["composite"] = shown, min(comp, p["composite"])
            p["nil_ask"] = recruiting.nil_ask(p, rc["year"], rc.get("seed", 0))
    rerank(rc)
    rc["stories"] = 1
    _STORIES = (rc, (state.get("id"), rc.get("year"), rc.get("seed"), len(rc["prospects"])), drawn)


# ----- how each story sounds (scenes.py): "him" plays as his small talk, "family" is the decider's turn at an
# in-home visit. His voice or theirs, present tense, no numbers; {legacy} is his legacy school, {mate} his
# Package Deal mate, the rest scenes.FIELDS. A call brings a story up only once the school knows it.
STORY_LINES: dict[str, dict[str, list[str]]] = {
    "legacy": {
        "him": ["My dad played at {legacy}, Coach. I grew up in that stadium.",
                "Everybody at home figures I'm going to {legacy}. I'm keeping an open mind.",
                "There's a picture of my dad in a {legacy} uniform in our hallway. Just so you know."],
        "family": ["His father played at {legacy}, Coach. That means something in this house.",
                   "We have been {legacy} people for a long time. You'll have to show us why that should change.",
                   "Half this family went to {legacy}. I'm not saying that decides it. I'm saying it's there."],
    },
    "hero": {
        "him": ["Everybody in {town} wants me to stay in {state}. I hear it at the grocery store.",
                "I want to play in front of the people who raised me, Coach.",
                "My whole town comes to my games. I think about that a lot."],
        "family": ["This whole town wants him to stay home, Coach. People stop us at church about it.",
                   "He's {town}'s boy. Folks here would love to watch him on Saturdays.",
                   "Every kid in {town} wears his number. That counts for something."],
    },
    "package": {
        "him": ["Me and {mate} have played together since we were kids. Where I go, he goes.",
                "You want me, you want {mate} too. That's the deal, Coach.",
                "{mate} is my guy. We're doing this together."],
        "family": ["He and {mate} are a package, Coach. Two offers, or no deal.",
                   "Those two boys have been inseparable since grade school. They want to go together.",
                   "If you want our son, you'll need a spot for {mate} too."],
    },
    "two_sport": {
        "him": ["I had a doubleheader yesterday, Coach. My arm's still sore.",
                "Baseball scouts keep showing up at my games. It's a lot.",
                "Honestly, baseball could be my thing too. I haven't decided."],
        "family": ["Pro baseball scouts have been calling too, Coach. He has options.",
                   "I'll be honest, the baseball draft is real for him. Give him a reason to pick football.",
                   "The baseball people say he'll go high in the draft. Show us he'll play right away here."],
    },
    "comeback": {
        "him": ["The knee feels great, Coach. Better than before, honestly.",
                "Everybody forgot about me after I got hurt. I didn't forget.",
                "I'm healthy now. I just need somebody who believes it."],
        "family": ["After the injury, a lot of schools stopped calling. We remember who didn't.",
                   "He worked so hard to come back, Coach. Every morning before school.",
                   "We know who stuck with him when he was hurt. That matters to us."],
    },
    "bloomer": {
        "him": ["I grew a few inches since last year, Coach. Everything feels different.",
                "Nobody was calling me a year ago. Now my phone won't stop.",
                "I'm just getting started. Wait until you see my senior film."],
        "family": ["He grew so much this year, Coach. None of his old clothes fit.",
                   "A year ago nobody called. Now everybody does. We remember that.",
                   "He's still growing, Coach. You haven't seen the best of him."],
    },
}
# his History's sentence when your staff finds out (a public story is never news to them)
STORY_LEARNED = {"legacy": "Your staff learned he is a legacy at {school}.",
                 "hero": "Your staff learned he is a hometown hero.",
                 "package": "Your staff learned he and {mate} want to go together.",
                 "two_sport": "Your staff learned he could go pro in baseball.",
                 "comeback": "Your staff learned he is coming back from an injury.",
                 "bloomer": "Your staff learned he is a late bloomer."}


def story_fields(state: dict, pid: str) -> dict:
    """The story's own placeholders for scenes: {legacy} (his legacy school's name) and {mate}."""
    k, d = story(state, pid)
    return {"legacy": _school_name(d.get("school")) if k == "legacy" else "",
            "mate": _name_of(state, d.get("mate")) if k == "package" else ""}


def story_line(state: dict, slug: str, pid: str, scene_id: str, who: str, f: dict, action: str, first_call: bool = False):
    """His story's line for a scene (its own seeded draw `story-line-{scene_id}-{who}`, so no other stream
    moves), or None: at an in-home visit always ("family": the decider brings it up, and the school learns
    it); on a call ("him") a Package Deal's first call always, otherwise STORY_CALL_LINE of the time once
    the school knows the story (never for All Business: no small talk)."""
    k, _ = story(state, pid)
    if k is None:
        return None
    rng = random.Random(f"story-line-{scene_id}-{who}")
    line = rng.choice(STORY_LINES[k][who])
    if action == "call":
        if not (k == "package" and first_call):          # All Business skips the small talk, his story's too
            if of(state, pid)["personality"] == "business" or not known(state, slug, pid)["story"] or rng.random() >= STORY_CALL_LINE:
                return None
    return line.format(**f)


# ----- what his story changes in recruiting (hooks in recruiting.py) ----------------------------------

STAR_WORD = {2: "two", 3: "three", 4: "four", 5: "five"}
_SCHOOL_STATE: dict = {}


def school_state(slug: str) -> str:
    s = _SCHOOL_STATE.get(slug)
    if s is None:
        from sim import season
        s = _SCHOOL_STATE[slug] = (season.load_teams().get(slug) or {}).get("state") or ""
    return s


def story_interest(state: dict, slug: str, pid: str, pull: float) -> float:
    """His pull toward the school (interest before list points) as his story reads it: a Hometown Hero's
    toward a school in his state HERO_STATE times; his legacy school LEGACY_HEAD points ahead (a head
    start, not a place on his list: the school still has to recruit him)."""
    k, d = story(state, pid)
    if k == "hero" and school_state(slug) == d.get("state"):
        return pull * HERO_STATE
    if k == "legacy" and slug == d.get("school"):
        return pull + LEGACY_HEAD
    return pull


def story_mult(state: dict, slug: str, pid: str, pitch) -> float:
    """What his story does to the school's contact (before diminishing returns): another school's Coach or
    Prestige pitch against a legacy, an out-of-state school's pitch to a hero (not Playing Time or NIL),
    any contact from a school that reached a comeback early."""
    k, d = story(state, pid)
    if k is None:
        return 1.0
    if k == "legacy" and pitch in ("coach", "prestige") and slug != d.get("school"):
        return LEGACY_PITCH
    if k == "hero" and pitch is not None and pitch not in HERO_FULL and school_state(slug) != d.get("state"):
        return HERO_AWAY
    if k == "comeback" and ((state["recruiting"]["contacts"].get(pid) or {}).get(slug) or {}).get("loyal"):
        return LOYALTY
    return 1.0


def note_contact(state: dict, slug: str, pid: str, contact: dict, pitch) -> None:
    """What a contact leaves on the school's record with him: a comeback remembers who reached him before
    LOYALTY_WEEK; a Two-Sport recruit counts the school's Playing Time pitches (his draft risk)."""
    k, _ = story(state, pid)
    if k == "comeback" and state["current_week"] < LOYALTY_WEEK:
        contact["loyal"] = True
    elif k == "two_sport" and pitch == "playing_time":
        contact["pt"] = contact.get("pt", 0) + 1


def lowball_weeks(state: dict, slug: str, pid: str) -> int:
    """How long a lowball cools him on the school: LEGACY_COST times longer from his legacy school."""
    from coach_career import recruiting
    k, d = story(state, pid)
    return int(round(recruiting.COOL_WEEKS * (LEGACY_COST if k == "legacy" and d.get("school") == slug else 1.0)))


def draft_risk(state: dict, slug: str, pid: str) -> float:
    """A Two-Sport recruit's chance to go pro in baseball if he signs with the school: DRAFT_RISK less
    DRAFT_PT for each of its Playing Time pitches and DRAFT_NIL per his ask's worth of its NIL over his
    ask, never under DRAFT_FLOOR; 0 for anyone else."""
    from coach_career import recruiting
    if story(state, pid)[0] != "two_sport":
        return 0.0
    rc = state["recruiting"]
    c = (rc["contacts"].get(pid) or {}).get(slug) or {}
    held = rc["nil"].get(slug, {}).get("held", {}).get(pid, 0) if pid in rc["offers"].get(slug, []) else 0
    over = max(0.0, held / max(5, recruiting.ask_from(state, slug, pid)) - 1)
    return max(DRAFT_FLOOR, DRAFT_RISK - DRAFT_PT * c.get("pt", 0) - DRAFT_NIL * over)


def draft_word(risk: float) -> str:
    return next(w for at, w in DRAFT_WORDS if risk >= at)


def goes_pro(state: dict, slug: str, pid: str) -> bool:
    """His one roll (`draft-{seed}-{pid}`) against his draft risk with the school he signs with."""
    if story(state, pid)[0] != "two_sport":
        return False
    return random.Random(f"draft-{state['recruiting'].get('seed', 0)}-{pid}").random() < draft_risk(state, slug, pid)


def ai_doubts(state: dict, slug: str, pid: str) -> bool:
    """An AI school that doubts a comeback's knee does not offer him (COMEBACK_AI of them do): a fixed draw
    per school (`comeback-{seed}-{slug}-{pid}`). Never your school."""
    if slug == state.get("team") or story(state, pid)[0] != "comeback":
        return False
    return random.Random(f"comeback-{state['recruiting'].get('seed', 0)}-{slug}-{pid}").random() >= COMEBACK_AI


def read_mult(state: dict, pid: str, group: str) -> float:
    """A look's error on a comeback's potential is COMEBACK_READ times the usual."""
    return COMEBACK_READ if group == "potential" and story(state, pid)[0] == "comeback" else 1.0


_FRONT: tuple = (None, {})


def board_front(state: dict, slug: str) -> tuple:
    """The prospects an AI school adds to its board for their story, (at the front, at the end): its legacies at a star
    level it recruits (its share of that level at least LEGACY_LEVEL of the nation's: a blue blood does not
    take a two-star for his father) at the front; the four- and five-star Hometown Heroes of its state at the end
    (their pull toward it, HERO_STATE, does the rest)."""
    from coach_career import recruiting
    global _FRONT
    drawn = stories(state)
    if _FRONT[0] is not drawn:
        pros = state["recruiting"]["prospects"]
        front: dict = {}
        for pid, s in drawn.items():
            if s["story"] == "legacy":
                school, tier = s["story_data"]["school"], pros[pid]["stars"]
                share = (recruiting._team_model(school).get("star_share") or {}).get(recruiting.STAR_KEY.get(tier, "2*"), 0.0)
                if share >= LEGACY_LEVEL * recruiting._national_share(tier):
                    front.setdefault(school, []).append(pid)
            elif s["story"] == "hero" and pros[pid]["stars"] >= 4:
                front.setdefault(("state", s["story_data"]["state"]), []).append(pid)
        _FRONT = (drawn, front)
    front = _FRONT[1]
    return front.get(slug, []), front.get(("state", school_state(slug)), [])


def bloom(state: dict, week: int) -> list:
    """The Late Bloomers whose jump is this week's step: each takes his real stars and composite (and the
    NIL ask that goes with them), is no longer hidden, and the class is re-ranked (rc["class_v"] moves, so
    the star-level caches start over); the jump is public (a "bloomed" event) and the BLOOM_BOARDS AI
    schools he fits best add him at the front of their boards. Returns who jumped."""
    from coach_career import recruiting
    rc = state["recruiting"]
    jumped = []
    for pid, s in stories(state).items():
        if s["story"] != "bloomer" or s["story_data"]["week"] != week:
            continue
        p = rc["prospects"][pid]
        real = p.get("real")
        if not real:
            continue
        p["stars"], p["composite"] = real["stars"], real["composite"]
        del p["real"]
        p["hidden"] = False
        p["nil_ask"] = recruiting.nil_ask(p, rc["year"], rc.get("seed", 0))
        jumped.append(pid)
    if not jumped:
        return []
    rerank(rc)
    rc["class_v"] = rc.get("class_v", 0) + 1
    recruiting._ASKS.clear()
    me = state.get("team")
    schools = [s for s in recruiting.fbs_schools(state) if s != me]
    for pid in sorted(jumped, key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        recruiting._event(state, "bloomed", pid, None, stars=p["stars"], line=f"He jumped to {STAR_WORD[p['stars']]} stars.")
        st = rc["status"][pid]
        if st["committed"] or st["signed"]:
            continue
        best = sorted(schools, key=lambda s: (-recruiting._fits(state, s).get(pid, 0.0), s))[:BLOOM_BOARDS]
        for s in best:                                   # a new blue chip goes to the front; a new three-star joins the end
            board = rc["boards"].setdefault(s, [])
            if pid not in board:
                board.insert(0, pid) if p["stars"] >= 4 else board.append(pid)
    return jumped


def pro_line(state: dict, slug: str) -> str:
    """His History's line when he goes pro in baseball instead of signing with the school."""
    from sim import season
    return f"He chose pro baseball over {(season.load_teams().get(slug) or {}).get('name', slug)}."

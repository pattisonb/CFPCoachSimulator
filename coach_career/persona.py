"""Recruit personas (persona.py): every prospect has a personality (how he talks) and a decider
(who has the say in where he signs, and the one topic that decider cares about). Drawn once, seeded
by the class seed and his id, and stored on the prospect (old saves and portal entrants draw on first use)."""
from __future__ import annotations

import random

PERSONALITIES = ("cocky", "shy", "guarded", "attention", "business")   # equally likely
PERSONALITY_LABEL = {"cocky": "Cocky", "shy": "Shy", "guarded": "Guarded", "attention": "Loves the Attention", "business": "All Business"}

DECIDERS = {"self": 0.30, "mom": 0.20, "dad": 0.15, "grandma": 0.10, "hs_coach": 0.15, "trainer": 0.10}   # who decides, by share *tune*
DECIDER_LABEL = {"self": "Himself", "mom": "Mom", "dad": "Dad", "grandma": "Grandmother", "hs_coach": "High School Coach", "trainer": "Trainer"}
DECIDER_TOPICS = {"self": (), "mom": ("proximity", "academics"), "dad": ("nil", "playing_time"), "grandma": ("proximity", "coach"),
                  "hs_coach": ("coach", "playing_time", "winning"), "trainer": ("nil",)}   # what each decider cares about


def draw(pid: str, seed) -> dict:
    """His personality, decider and the decider's topic (None when he decides himself)."""
    rng = random.Random(f"persona-{seed}-{pid}")
    personality = rng.choice(PERSONALITIES)
    decider = rng.choices(list(DECIDERS), weights=list(DECIDERS.values()))[0]
    topics = DECIDER_TOPICS[decider]
    return {"personality": personality, "decider": decider, "decider_topic": rng.choice(topics) if topics else None}


def of(state: dict, pid: str) -> dict:
    """The prospect's persona, drawn and stored if he has none yet (an old save, a portal entrant)."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    if "persona" not in p:
        p["persona"] = draw(pid, rc.get("seed", 0))
    return p["persona"]


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


# ----- discovery: what a school has learned about him ---------------------------------------------------

DECIDER_LOOKS = 2.0              # looks of his report before the player's staff learns who decides *tune*
PERSONALITY_LINE = {"cocky": "He's cocky, and he isn't shy about it.", "shy": "He's shy and doesn't say much.",
                    "guarded": "He's guarded and keeps things close.", "attention": "He loves the attention and wants to hear from you often.",
                    "business": "He's all business and wants to talk about the offer."}
DECIDER_LINE = {"self": "Your staff learned he makes his own call.", "mom": "Your staff learned his mom has the final say.",
                "dad": "Your staff learned his dad has the final say.", "grandma": "Your staff learned his grandmother has the final say.",
                "hs_coach": "Your staff learned his high school coach has the final say.", "trainer": "Your staff learned his trainer has the final say."}


def known(state: dict, slug: str, pid: str) -> dict:
    """What `slug` has learned about him: {"personality": bool, "decider": bool}."""
    k = ((state["recruiting"].get("traits_known") or {}).get(slug) or {}).get(pid) or {}
    return {"personality": bool(k.get("personality")), "decider": bool(k.get("decider"))}


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
    """His personality shows on the school's first call (Guarded: its first in-home visit)."""
    guarded = of(state, pid)["personality"] == "guarded"
    if (action == "call" and not guarded) or (action == "hc_visit" and guarded):
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

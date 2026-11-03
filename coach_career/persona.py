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

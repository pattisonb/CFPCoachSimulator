"""Coach Career scenes (docs/superpowers/specs/2026-10-28-recruiting-experience-design.md, section 6):
your calls and in-home visits as a short conversation. You open; he answers with small talk that
knows the week (your last game, his practice, the school leading his list); you present your program
(three things); he reacts; you ask what will decide it; he answers with the cue (one topic, or two
when he is torn); you lead with a pitch; he reacts. This file owns the words and the choice of cue
and reaction; recruiting.py owns the scene's lifecycle and its points (the one `_act` path).

A scene is `turns`: [{who: "you" | "him" | "note", text}] in order (an in-home visit with a decider other
than himself adds one {who: "family", label: the decider's label, text}); `lines` (his turns' texts) stays
one release for the page's old readers. Lines are in his voice (or yours), present tense, short, no
numbers (an in-home visit's ask is in words). They take {name}, {first}, {town}, {state}, {school},
{position} ({positions} its plural in words), {role} ("start", "compete" or "wait"), {record} (the school's won-lost in words; {rec} the same
to go inside a sentence, {conf} its conference record), {coach}
(your last name), {opponent} and {result} ("beat" / "lost to": your last game, or the opener before
one), {leader} (the school leading his list, "" when none or you) and {week_word}. Lines fit a high
schooler and a transfer alike; two-sided cues take {a} and {b}, two topics' phrases. A line that claims
something about the school (NEEDS) is said only while it is true (`facts`, `truth`): this season's record,
the last game, the conference record, the rank, the program's recent winning and its strengths decide."""
from __future__ import annotations

import os
import random

from coach_career import persona, recruiting

PERSONA_LINE = 0.5         # how often his personality's own line stands in for the generic one *tune*
CUE_TWO_SIDED = 0.6        # how often a cue names two topics (one his, one not) *tune: tools/check_recruiting.py*
# how often a playing-time recruit asks about a named player on a call or visit *tune: tools/check_recruiting.py*
# (CFP_QUESTION_RATE: the sweep forces it through the dev server's environment)
QUESTION_RATE = float(os.environ.get("CFP_QUESTION_RATE", "0.6"))

# the topics as he would say them, for two-sided cues
PHRASES = {"proximity": "staying close to home", "playing_time": "getting on the field early",
           "prestige": "a big-name program", "winning": "winning right away", "nil": "the NIL side of it",
           "coach": "the coaches I'd play for", "academics": "getting a real degree", "pro": "getting to the league"}

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
    "pro": {
        "cue": ["Honestly, Coach? I'm trying to play on Sundays. Who gets {positions} there?",
                "My trainer keeps a list of who puts guys in the league. I look at it.",
                "I want to get drafted. That's the whole plan."],
        "hit": ["You put {positions} in the league. That's what I'm chasing.",
                "Sundays. That's the dream, Coach, and you've got the receipts.",
                "First-rounders at my spot? Say less."],
        "polite": ["Cool. The league's a long way off, though.",
                   "Yeah, I know what you've got. Not my biggest thing.",
                   "That's nice. I just want to play ball first."],
        "quiet": ["...Who was the last {position} you got drafted, Coach?",
                  "My trainer says nobody gets drafted from there. I don't know.",
                  "I'll have to look that up."],
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
# that player's roster position: a recruit listed as an athlete asks about your WR, never your "ATH"),
# or another recruit you offered at his position ({other})
QUESTION_LINES = {
    "roster": ["Is {ahead} still your {position} next year? I'm not coming to sit behind him.",
               "{ahead} is a {ahead_cls}. That's two more years of him. Where does that leave me?",
               "My dad looked at your depth chart. He says {ahead} has that spot locked."],
    "recruit": ["You offered {other} too. Which one of us do you actually want?",
                "I saw {other} post your offer. You telling him the same thing you're telling me?",
                "If {other} commits first, is there still a spot for me?"],
    # the Package Deal, once his or his family's line brought his mate up ({mate}): the mate without your offer, or holding it
    "package": ["So what about {mate}, Coach? Is there a spot for him?",
                "{mate} hasn't heard from you. Is he getting an offer?",
                "Where does {mate} stand with you? I need to know before I decide."],
    "package_offered": ["{mate} showed me your offer. We're both in this together, right?",
                        "You offered {mate}. Is that spot his for real?",
                        "{mate} has your offer. Just tell me you mean it for both of us."],
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
# the Package Deal's answers (scenes.question kind "package"): the label and your line by answer, the mate without
# your offer or holding it ("straight" differs: you have offered him, or you will look at him); {mate} his name
PACKAGE_ANSWERS = {
    False: {"straight": ("Tell Him Straight", "I can't promise {mate} a spot today. I'll look at him."),
            "promise": ("Promise Him an Offer", "{mate} gets an offer this week. You have my word."),
            "deflect": ("Sidestep It", "Let's talk about what you'd bring.")},
    True: {"straight": ("Already Offered Him", "I offered {mate} already. Two spots, both yours."),
           "promise": ("Promise Him an Offer", "{mate}'s offer stands. He signs with you, no questions."),
           "deflect": ("Sidestep It", "Let's talk about what you'd bring.")},
}
# what he says back: a promise he believes ("promise") or one he has heard before ("hollow"); the Package Deal's
# straight answer once his mate holds your offer ("package_offered"), and his promise, which waits on the offer ("package")
REPLY_LINES = {"straight": "Fair. At least you're not blowing smoke.",
               "promise": "That's what I needed to hear, Coach.",
               "hollow": "I've heard that one before.",
               "deflect": "...Okay.",
               "package_offered": "That's all we needed to hear, Coach.",
               "package": "Then we'll be watching for it."}
# the Package Deal promise kept (recruiting._promises): his History's line, {mate} his mate
PROMISE_KEPT_LINE = "{mate} got his offer. You kept your word, Coach."
MONEY_KEPT_LINE = "You put the money on the table. You kept your word, Coach."
MONEY_BROKEN_LINE = "You talked money and never put it on the table."
MONEY_OWED_LINE = "You talked money: put it on your offer within two weeks."   # the money promise opens: the player is told
NIL_NOT_HIS = "The money isn't what this is about for me."   # NIL pitched to a recruit who does not care about it
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
# words: {Topic} to open a line, {topic} inside one), none, or he is tired of you; a priority you are weak at gets
# that topic's quiet line
PRESENT_LINES = {
    "hit": ["{Topic}. Yeah. Keep talking, Coach.",
            "{Topic}... okay. That's the part I wanted to hear.",
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
              "academics": "The degree here means something. Your mom will like that part.",
              "pro": "We put {positions} in the league, {first}. Scouts know the way here."}
LEAD_PRO_PROGRAM = "We put guys in the league, {first}. Scouts know the way here."   # pro holds but not at his spot (a kicker or punter)

# ----- what is true (the lines that claim something agree with the game's facts) ---------------------------
CLAIM_FROM = 0.6          # *tune* a topic's strength from which your lines claim it outright (the page's Strong); under it they speak honestly
HISTORY_WINNING = 50.0    # *tune* the program's winning metric (programs.py: the last three seasons) from which "we win here every year" is true

# your lead-with on a topic you cannot claim (`truth` False): honest, or aspirational, never a claim
LEAD_HONEST = {"proximity": "It's a trip from {town}, I know. We'll make your folks feel at home every time they come.",
               "playing_time": "Nobody gets handed a job here, {first}. You'd get a fair shot to compete at {position}.",
               "prestige": "We're not the biggest name out there yet. Come help us make it one.",
               "nil": "The collective is still growing, but it takes care of our guys.",
               "coach": "I know what people are saying. I'm here to build this, and I want you in it.",
               "academics": "You'll get your degree here. We make sure our guys finish.",
               "pro": "I won't tell you we've sent a lot of guys to Sundays. Come be the first one everybody remembers."}
LEAD_HONEST_PRO_SOME = "We've sent some, {first}. You could be the next one."   # under the claim line, with a pick at his group in ten years
# your Winning Now lead by the season's form (`facts`): this season's record, the last game, the conference record and
# the program's recent history decide which is true; "hot" and "pre_up" are LEAD_LINES["winning"] (or the ranked line)
LEAD_WINNING = {"ranked": "We're ranked, we're winning, and we are not slowing down.",
                "winning": "We're {rec} and winning this year. One bad Saturday doesn't change who we are.",
                "even": "We're {rec}, right in the middle of it. Guys like you are how we tip it to winning now.",
                "even_conf": "We're {rec}, but we're {conf} in conference play. We're building to win now.",
                "losing": "We're not where we want to be this year, but we're building something to win now.",
                "losing_conf": "We're not where we want to be this year, but we're {conf} in the conference. We're building to win now.",
                "losing_history": "We're not where we want to be this year, but we've won here before, and we're building to win now.",
                "pre_down": "Last year wasn't us. We're building something to win now."}
# his reaction to a Winning Now lead that landed (hit) when the record does not back it: skeptical, not sold
WIN_DOUBT = {"even": ["{record}. You're right there, Coach. Show me the rest of the year.",
                      "Even's not winning, Coach. But I hear you."],
             "losing": ["You're {rec}, Coach. Winning now? I'll believe it when I see it.",
                        "{record}, Coach. Everybody says next year. Show me."],
             "losing_history": ["I know you guys won before. But {rec}? I'll believe it when I see it."],
             "pre_down": ["You guys had a rough one last year, Coach. Show me it's different."]}
# his reaction on a topic you cannot claim that still landed (hit): interested, in words that claim nothing false
HONEST_HIT = {"proximity": ["It's a drive, but my folks could make some games. That helps.",
                            "Not next door, but not the other side of the country either. Okay."],
              "playing_time": ["Compete for it? Okay. I'm not scared of that.",
                               "A fair shot is all I'm asking for, Coach."],
              "prestige": ["{school} isn't the biggest name, but I like where it's going.",
                           "Help build it? Yeah. I could see that."],
              "nil": ["It's not the biggest number, but it helps back home.",
                      "Okay. That's a start, Coach."],
              "academics": ["A degree's a degree, Coach. My mom will still want to hear that.",
                            "Good. I want something for after football."],
              "pro": ["Be the first? Okay. I like that, Coach.",
                      "Nobody's done it from there yet. Maybe that's me."],
              "pro_some": ["Some have made it from here. I could be next.",
                           "You've sent a few? Then I could be one of them."]}   # `pro` when nothing was drafted at his group in ten years, `pro_some` when something was
# your opening's three things on a topic you cannot claim, as you say them (PHRASES are his words and your claims)
SAID_HONEST = {"proximity": "a home away from home", "playing_time": "a fair shot to compete",
               "prestige": "a program you can help build", "winning": "building a winner", "academics": "getting your degree", "pro": "a path to Sundays"}
# the claim each line makes (by its template): the `truth` key that must hold ("!key": must not; a tuple: all of them); any line not
# listed claims nothing. A line whose claim is false gives way to one in its pool that holds, else the honest one.
NEEDS = {
    "That's what I want to hear. My folks could make every home game.": "proximity",
    "Home on a weekend? That matters, Coach. It really does.": "proximity",
    "{town} to {school} isn't far at all. I like that a lot.": "proximity",
    "Being close is nice, I guess. My folks will travel.": "proximity",
    "Yeah, the drive's easy. That's cool.": "proximity",
    "A real shot at the field next year? I'm all in on that.": "playing_time",
    "That depth chart looks good to me, Coach. Real good.": "playing_time",
    "Snaps next year. That's what I needed to hear.": "playing_time",
    "Yeah, the depth chart's cool. Not my biggest thing.": "playing_time",
    "{school}. Man. That name means something.": "prestige",
    "That's the brand, Coach. Everybody knows {school}.": "prestige",
    "Yeah. When you say {school}, people listen.": "prestige",
    "Sure, {school} is a big deal. That's cool.": "prestige",
    "You guys win. I notice that, Coach.": "winning",
    "That's the thing. {school} wins. I want in.": "winning",
    "Playing for a title every year? Yes sir.": ("winning", "history"),
    "Yeah, you've been good. That's cool.": "winning",
    "{record}... I want to play for a winner, Coach.": "!winning",
    "...You guys have had some rough years.": "!history",
    "That's real money for my family, Coach. Thank you.": "nil",
    "My dad is going to like hearing that.": "nil",
    "Okay. That takes care of a lot back home.": "nil",
    "That's a real school, Coach. That counts for a lot.": "academics",
    "My mom is going to love that. The degree matters.": "academics",
    "You put {positions} in the league. That's what I'm chasing.": ("pro", "pro_spot"),
    "Sundays. That's the dream, Coach, and you've got the receipts.": "pro",
    "First-rounders at my spot? Say less.": ("pro", "pro_spot"),
}


def facts(state: dict, slug: str, week: int | None = None) -> dict:
    """What the game knows about the school, for the lines that claim something: this season's record
    (w, l) and conference record (cw, cl), the last game (`last_won`, None before one) and the streak
    (wins positive, losses negative), the poll rank (None unranked), last season's record (`last`), whether
    the program has been winning for years (`history`), and the season's `form` in one word: before a game
    "pre_up" or "pre_down" (last season), then "hot" (a winning record and the last game won), "winning",
    "even" or "losing"."""
    from sim import season
    from coach_career import programs
    week = state["current_week"] if week is None else week
    rec = season._records(state).get(slug) or {}
    w, l, cw, cl = rec.get("wins", 0), rec.get("losses", 0), rec.get("conf_wins", 0), rec.get("conf_losses", 0)
    results = []
    for g in sorted(state["games"].values(), key=lambda g: g["week"]):
        if g.get("played") and g["week"] <= week and slug in (g["home"], g["away"]):
            mine, theirs = (g["home_score"], g["away_score"]) if g["home"] == slug else (g["away_score"], g["home_score"])
            results.append(mine > theirs)
    streak = 0
    for won in reversed(results):
        if streak and (won != (streak > 0)):
            break
        streak += 1 if won else -1
    polls = state.get("polls") or {}
    out_weeks = [int(k) for k, v in polls.items() if str(k).lstrip("-").isdigit() and int(k) <= week and (v.get("ap") or v.get("cfp") or v.get("cfp_full"))]
    rank = season.rank_map(state, max(out_weeks)).get(slug) if out_weeks else None
    ls = recruiting._team_model(slug).get("last_season") or {}
    last = (ls.get("wins", 0), ls.get("losses", 0))
    history = float(programs.get(state, slug).get("winning", 0.0)) >= HISTORY_WINNING
    if not w + l:
        form = "pre_up" if last[0] > last[1] else "pre_down"
    elif w > l:
        form = "hot" if results and results[-1] else "winning"
    else:
        form = "even" if w == l else "losing"
    return {"w": w, "l": l, "cw": cw, "cl": cl, "last_won": results[-1] if results else None, "streak": streak,
            "rank": rank, "last": last, "history": history, "form": form}


def truth(state: dict, slug: str, pid: str, week: int | None = None) -> dict:
    """Which topics your lines may claim to him: a strength of CLAIM_FROM or better (proximity, playing
    time, prestige, NIL, academics, Pro Pipeline); Winning Now by the season's form (`facts`), "history" by the
    program's last three seasons; The Head Coach unless the talk is that your job is not safe (his Hot
    Seat twist about you). `form` and `facts` ride along."""
    fx = facts(state, slug, week)
    st_ = recruiting.strengths(state, slug, pid)
    out = {t: st_[t] >= CLAIM_FROM for t in ("proximity", "playing_time", "prestige", "nil", "academics", "pro")}
    out.update(pro_truth(state, slug, pid, out["pro"]))
    tw = persona._twist(state, pid)
    out.update(winning=fx["form"] in ("hot", "winning", "pre_up"), history=fx["history"],
               coach=not (tw and tw["k"] == "hot_seat" and tw.get("s") == slug), form=fx["form"], facts=fx)
    return out


def pro_truth(state: dict, slug: str, pid: str, pro: bool) -> dict:
    """The Pro Pipeline facts a line may need: `pro_any`, the school has a pick at his group in its ten drafts (a kicker, a
    punter or any group without draft keys: any pick at all); `pro_spot`, the claim holds at his own spot (the strength for
    most; a kicker or punter, his own group's grade at CLAIM_FROM, since his strength reads the overall grade)."""
    from coach_career import programs
    p = state["recruiting"]["prospects"][pid]
    pr = programs.get(state, slug)
    group = recruiting._group(p["ea_position"])
    keys = programs.GROUP_DRAFT.get(group)
    lines = pr.get("drafts") or []
    any_ = any(g in keys and pts > 0 for _, _, gs in lines for g, pts in gs.items()) if keys else any(pts > 0 for _, pts, _ in lines)
    spot = pro if group not in ("K", "P") else (pr.get("pro_groups") or {}).get(group, 0) >= 100 * CLAIM_FROM
    return {"pro_any": any_, "pro_spot": bool(spot)}


def _holds(line: str, tr: dict) -> bool:
    """Whether a line's claims (NEEDS: one truth key, or several that must all hold) are true."""
    need = NEEDS.get(line)
    if not need:
        return True
    return all(not tr[k[1:]] if k.startswith("!") else bool(tr[k]) for k in ((need,) if isinstance(need, str) else need))


def _win_key(tr: dict) -> str | None:
    """The honest Winning Now key for the season's form (None: the confident lines are true)."""
    fx = tr["facts"]
    form = tr["form"]
    if form in ("hot", "pre_up"):
        return None
    if form == "winning":
        return "winning"
    if form == "even":
        return "even_conf" if fx["cw"] > fx["cl"] else "even"
    if form == "losing":
        return "losing_conf" if fx["cw"] > fx["cl"] else "losing_history" if tr["history"] else "losing"
    return "pre_down"


def lead_line(tr: dict, pitch: str) -> str:
    """Your lead-with as a template, true to the facts: the confident line when the topic holds, else its
    honest one; Winning Now by the season's form (a ranked team on a roll says so)."""
    if pitch == "winning":
        key = _win_key(tr)
        if key is None:
            return LEAD_WINNING["ranked"] if tr["form"] == "hot" and tr["facts"]["rank"] else LEAD_LINES["winning"]
        return LEAD_WINNING[key]
    if pitch == "pro":
        return (LEAD_LINES["pro"] if tr.get("pro_spot", True) else LEAD_PRO_PROGRAM) if tr["pro"] else LEAD_HONEST_PRO_SOME if tr.get("pro_any") else LEAD_HONEST["pro"]
    return LEAD_LINES[pitch] if tr[pitch] else LEAD_HONEST[pitch]


def said_phrase(tr: dict, topic: str) -> str:
    """A topic in your opening's three things: its phrase when you can claim it, else the honest one."""
    if topic in SAID_HONEST and not tr[topic]:
        return SAID_HONEST[topic]
    return PHRASES[topic]


def true_line(tr: dict, topic: str, kind: str, line: str, sid: str) -> tuple[str, bool]:
    """His line for `topic` and `kind` (a template drawn as before), or, when its claim is false, one that
    holds: a hit gets the honest hit (Winning Now: the skeptical one for the record), anything else another
    line of its pool that holds. Its own seeded draw (`truth-{sid}`), so no other stream moves. Returns the
    template and whether it was replaced."""
    if _holds(line, tr):
        return line, False
    rng = random.Random(f"truth-{sid}-{topic}-{kind}")
    if kind == "hit":
        if topic == "winning":
            key = _win_key(tr)
            if key in (None, "winning"):                          # the record wins: only "every year" can be false
                pool = [x for x in LINES["winning"]["hit"] if _holds(x, tr)]
            else:
                pool = WIN_DOUBT.get(key) or WIN_DOUBT[key.split("_")[0]]
        elif topic == "pro" and tr.get("pro"):                    # the claim holds for the program, not at his spot: a line that holds
            pool = [x for x in LINES["pro"]["hit"] if _holds(x, tr)]
        else:
            pool = HONEST_HIT.get("pro_some" if topic == "pro" and tr.get("pro_any") else topic) or []
    else:
        pool = [x for x in LINES[topic][kind] if _holds(x, tr)]
    return (rng.choice(pool), True) if pool else (line, False)
# he has a question (recruit questions): this turn introduces it
QUESTION_INTRO = "Can I ask you something?"

# an in-home visit opens with a plain note on who decides (a visit shows who decides): information, no scenery
DECIDER_NOTE = {"mom": "His mom has the final say.", "dad": "His dad has the final say.",
                "grandma": "His grandmother has the final say.", "hs_coach": "His high school coach has the final say.",
                "trainer": "His trainer has the final say.", "self": "{first} makes his own call."}

# his twist in his own words, while it is on (persona.TWISTS): "you" when the twist is about the school he is
# talking to, "other" when it is about another school ({rival}); a twist about no school has "him". {foe} is
# the opponent of the game he watches or wants won, {moved} his family's new town. No numbers, no phone words.
TWIST_LINES: dict[str, dict[str, list[str]]] = {
    "surprise": {"you": ["I didn't expect you to show up at practice like that, Coach. It got my attention.",
                         "Everybody at school saw your staff on the sideline this week. That was a statement.",
                         "You came out of nowhere, Coach. I'm taking you seriously now."],
                 "other": ["{rival}'s staff showed up at my practice out of nowhere. I didn't see that coming.",
                           "I'll be honest, Coach, {rival} surprised me this week. They came all the way out here.",
                           "{rival} just walked into my school unannounced. People are talking about it."]},
    "at_game": {"you": ["I'm coming to your game against {foe}, Coach. I want to see the place loud.",
                        "My dad got us seats for your game against {foe}. Don't let me down.",
                        "I'll be in the stands when you play {foe}. I want to feel it for myself."],
                "other": ["I'm going to the {rival} game against {foe}. It's close enough to drive.",
                          "My family's taking me to see {rival} play {foe}. I'm excited for it.",
                          "I've got tickets to {rival} and {foe}. I'll let you know how it goes."]},
    "hot_seat": {"you": ["People keep telling me your job might not be safe, Coach. Is that true?",
                         "I keep hearing the hot seat talk about you. I need to know you'll be here.",
                         "Everybody asks me what happens if you get fired, Coach. I don't know what to tell them."],
                 "other": ["I keep hearing the coach at {rival} might not last. That worries me.",
                           "Everybody says {rival}'s coach is on the hot seat. I don't want to sign and lose him.",
                           "If the coach at {rival} gets fired, where does that leave me? I think about that."]},
    "late_offer": {"you": ["I didn't think you'd offer this late, Coach. It changes things for me.",
                           "Your offer caught everybody off guard. My phone hasn't stopped since.",
                           "Honestly, Coach, getting your offer now feels huge."],
                   "other": ["{rival} just offered me. I didn't see that coming this late.",
                             "When {rival} offered, my whole family lost it. It's a big deal, Coach.",
                             "{rival} is in now. I have to take that seriously."]},
    "family_move": {"him": ["We're moving to {moved}, Coach. My mom got a new job.",
                            "My family packed up for {moved}. Everything's different now.",
                            "New house in {moved}, new school soon. It's a lot."]},
    "grades": {"him": ["My grades slipped this semester, Coach. I'm working on it, I promise.",
                       "A couple of schools backed off over my transcript. I'm fixing it.",
                       "I've got a tutor now. The classroom stuff is getting handled."]},
    "beat": {"you": ["I want to see you beat {foe}, Coach. Do that and we'll talk.",
                     "Beat {foe} and you'll have my full attention.",
                     "Everybody back home says {foe} is better than you. Prove them wrong."]},
}

# how his commit style sounds, once the school knows it (persona.STYLES): his voice, no numbers
STYLE_LINES: dict[str, list[str]] = {
    "early_bird": ["I want to get this done early, Coach. I'm not dragging it out.",
                   "When I know, I know. I'm not waiting around for the end of the year.",
                   "I'd like to lock in soon and get back to football."],
    "signing_day": ["I'm not deciding until signing day, Coach. Everybody can wait.",
                    "I'm keeping it open all the way. Signing day is my day.",
                    "Nobody gets an answer before signing day. Not even my mom."],
    "hat": ["I'm doing the hats, Coach. Three on the table and the whole town watching.",
            "When I pick, it's going to be a show. Hats and everything.",
            "I'm going to name my finalists first. Then the hat ceremony."],
    "quiet": ["When I decide, I'm not making a big deal of it. No posts, no hats.",
              "I'll keep it to myself when I pick. That's just how I am.",
              "I don't need an announcement, Coach. My family will know and that's enough."],
    "needs_attention": ["I like hearing from you, Coach. Don't go quiet on me.",
                        "Schools that stop checking in, I stop thinking about.",
                        "Keep in touch, Coach. It matters to me more than you'd think."],
}

# every table of lines (tests format each line with FIELDS)
TABLES = {"PERSONA_LINES": persona.LINES, "NO_TOPIC": persona.NO_TOPIC, "DECIDER_LINES": persona.DECIDER_LINES, "STORY_LINES": persona.STORY_LINES,
          "STORY_LINES_OFFERED": persona.STORY_LINES_OFFERED, "LINES": LINES, "TIRED": TIRED, "OPEN": OPEN, "VISIT_OPEN": VISIT_OPEN, "CONTEXT": CONTEXT, "PRESENT_SAID": PRESENT_SAID,
          "PRESENT_LINES": PRESENT_LINES, "ASK": ASK, "LEAD_LINES": LEAD_LINES, "LEAD_HONEST": LEAD_HONEST, "LEAD_WINNING": LEAD_WINNING,
          "WIN_DOUBT": WIN_DOUBT, "HONEST_HIT": HONEST_HIT, "DECIDER_NOTE": list(DECIDER_NOTE.values()), "TWIST_LINES": TWIST_LINES, "STYLE_LINES": STYLE_LINES}
FIELDS = ("name", "first", "town", "state", "school", "position", "positions", "role", "record", "rec", "conf", "coach", "opponent", "result", "leader",
          "week_word", "a", "b", "x", "y", "z", "topic", "Topic", "legacy", "mate", "rival", "foe", "moved")

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


def _conf(state: dict, slug: str) -> str:
    """The school's conference record this season in words ("two and one"); "no conference games yet" before one."""
    from sim import season
    rec = season._records(state).get(slug) or {}
    w, l = rec.get("conf_wins", 0), rec.get("conf_losses", 0)
    return f"{words(w)} and {words(l)}" if w + l else "no conference games yet"


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
            best = {"opponent": season.team_display(opp, teams), "won": mine > theirs, "week": g["week"]}
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
            best = {"opponent": season.team_display(opp, teams), "week": g["week"]}
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


PLURAL = {"QB": "quarterbacks", "RB": "backs", "WR": "receivers", "TE": "tight ends", "OT": "tackles", "IOL": "interior linemen", "EDGE": "edge rushers",
          "DL": "defensive linemen", "LB": "linebackers", "CB": "corners", "S": "safeties", "K": "kickers", "P": "punters", "ATH": "athletes"}


def _fields(state: dict, slug: str, p: dict, week: int | None = None) -> dict:
    from sim import season
    team = season.load_teams().get(slug) or {}
    week = state["current_week"] if week is None else week
    game, nxt = last_game(state, slug, week), next_game(state, slug, week)
    record = _record(state, slug)
    return {"name": p["name"], "first": p["name"].split()[0], "town": p["hometown"]["city"] or p["hometown"]["state"],   # a transfer has no town on file
            "state": p["hometown"]["state"], "school": team.get("name", slug), "position": p["position"], "positions": PLURAL.get(p["position"], "players"),
            "role": _role(state, slug, p["id"]), "record": record, "rec": record[:1].lower() + record[1:], "conf": _conf(state, slug),
            "coach": coach_name(state, slug),
            "opponent": game["opponent"] if game else nxt["opponent"] if nxt else "", "result": ("beat" if game["won"] else "lost to") if game else "",
            "leader": leader_of(state, slug, p["id"]), "week_word": words(week), **persona.story_fields(state, p["id"]),
            **persona.twist_fields(state, p["id"])}


def _turn(who: str, text: str) -> dict:
    return {"who": who, "text": text}


def _persona_line(state: dict, pid: str, scene_id: str, key: str, f: dict, always: bool = False, salt: str = "",
                  pool: tuple = ()) -> str | None:
    """His personality's own line for `key` (open, small_talk, hit, quiet), PERSONA_LINE of the time (always
    when `always`); its own seeded draw, keyed on the scene, so no other stream moves. None: use the generic."""
    rng = random.Random(f"persona-line-{scene_id}-{salt}{key}")
    own = persona.LINES[persona.of(state, pid)["personality"]]
    line = rng.choice([x for k in (pool or (key,)) for x in own[k]]).format(**f)
    return line if always or rng.random() < PERSONA_LINE else None


def _no_tell_line(state: dict, pid: str, key: str, f: dict, avoid: str | None = None) -> str:
    """What he says to a pitch on a call that keeps his priority to himself, when it was none of his
    (his NO_TOPIC lines, never the cue's own): a line that names no topic and shows no tone. Its own draw."""
    lines = [x.format(**f) for x in persona.NO_TOPIC.get(persona.of(state, pid)["personality"]) or persona.NO_TOPIC["guarded"]]
    return random.Random(f"persona-line-{key}-guarded").choice([x for x in lines if x != avoid] or lines)


def tells(state: dict, slug: str, pid: str, action: str) -> bool:
    """Whether this scene may name one of his priorities: every visit does; a call does unless he keeps
    it to himself (a Guarded recruit, a Shy one's first call)."""
    return action != "call" or persona.call_reveals(state, slug, pid, roll=False)


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


def twist_line(state: dict, slug: str, pid: str, sid: str, f: dict, always: bool = False):
    """His twist in his words while it is on (its own seeded draw `twist-line-{sid}`): on a call
    persona.TWIST_CALL_LINE of the time, at a visit always; a Wants to See You Beat X only to the school he told."""
    tw = persona._twist(state, pid)
    if not tw or (tw["k"] == "beat" and tw["s"] != slug):
        return None
    table = TWIST_LINES[tw["k"]]
    key = "him" if "him" in table else "you" if tw.get("s") == slug else "other"
    if key not in table:
        return None
    rng = random.Random(f"twist-line-{sid}")
    line = rng.choice(table[key])
    if not always and rng.random() >= persona.TWIST_CALL_LINE:
        return None
    return line.format(**f)


def style_line(state: dict, slug: str, pid: str, sid: str, f: dict):
    """How he means to commit, in his words, once the school knows his commit style: persona.STYLE_CALL_LINE
    of the calls (its own seeded draw `style-line-{sid}`); never for All Business (no small talk)."""
    k = persona.style(state, pid)
    if not k or not persona.known(state, slug, pid)["style"] or persona.of(state, pid)["personality"] == "business":
        return None
    rng = random.Random(f"style-line-{sid}")
    line = rng.choice(STYLE_LINES[k])
    return line.format(**f) if rng.random() < persona.STYLE_CALL_LINE else None


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
        turns.append(_turn("note", DECIDER_NOTE[persona.of(state, pid)["decider"]].format(**f)))
        turns.append(_turn("you", rng.choice(VISIT_OPEN).format(**f)))
    else:
        prev = last_talk(state, slug, pid, week)
        table = OPEN["first"] if prev is None else OPEN["last_week"] if prev == week - 1 else OPEN["again"]
        turns.append(_turn("you", rng.choice(table).format(**f)))
    sid = f"{action}-{pid}-{week}"
    context = context_line(state, slug, pid, week, f, rng, tired)     # always drawn: the seeded rng moves the same for every personality
    d = persona.of(state, pid)
    game = last_game(state, slug, week)
    if tired or (game and game["week"] >= week - 1):                  # a game this past Saturday is news he always brings up (a deliberate exception: All Business too)
        said = context
    elif d["personality"] == "business":                              # no small talk: he gets to it
        said = _persona_line(state, pid, sid, "visit_open" if action == "hc_visit" else "open", f, always=True)
    else:
        said = _persona_line(state, pid, sid, "visit_open" if action == "hc_visit" else "open", f,
                             pool=("visit_open" if action == "hc_visit" else "open", "small_talk")) or context
    story = None                                                      # his story's line, when it is said (a Package Deal's brings his question)
    if action == "call" and not tired and not (game and game["week"] >= week - 1):    # his story, once you know it (a Package Deal's first call: always)
        first = not ((rc["contacts"].get(pid) or {}).get(slug) or {}).get("calls")
        news = twist_line(state, slug, pid, sid, f)
        story = None if news else persona.story_line(state, slug, pid, sid, "him", f, action, first_call=first)
        said = news or story or style_line(state, slug, pid, sid, f) or said      # what happened to him first, then his story, then how he means to commit
    turns.append(_turn("him", said))
    if action == "hc_visit":                                          # in his living room what happened to him always comes up
        news = twist_line(state, slug, pid, sid, f, always=True)
        if news:
            turns.append(_turn("him", news))
    told = None                                                       # his story at a visit: the decider brings it up, or he does
    if action == "hc_visit" and d["decider"] != "self":               # the one who decides speaks
        story = persona.story_line(state, slug, pid, sid, "family", f, action)
        fam = story or random.Random(f"persona-line-{sid}-family").choice(persona.DECIDER_LINES[d["decider"]]).format(**f)
        told = fam
        turns.append({"who": "family", "label": persona.DECIDER_LABEL[d["decider"]], "text": fam})
        persona.learn(state, slug, pid, "decider")                    # the family is in the room: you see who decides
    elif action == "hc_visit":
        persona.learn(state, slug, pid, "decider")                    # the note said he decides himself
        told = story = persona.story_line(state, slug, pid, sid, "him", f, action)
        if told:
            turns.append(_turn("him", told))
    if action == "hc_visit" and persona.story(state, pid)[0] and told:
        persona.learn(state, slug, pid, "story")                      # it came up in his living room: now you know
    sc = {"id": sid, "action": action, "week": week, "turns": turns, "lines": [],
          "cue": None, "ask": recruiting.ask_view(state, slug, pid), "question": None, "presented": None, "tired": tired,
          "package": package_about(state, slug, pid) if story else None}      # his mate was brought up: the question after your opening
    _lines(sc)
    return sc


def _lines(sc: dict) -> None:
    sc["lines"] = [t["text"] for t in sc["turns"] if t["who"] == "him"]


def cue(state: dict, slug: str, pid: str, week: int, f: dict, tells: bool = True) -> dict:
    """The cue: one priority you have not heard (or two topics, one his and one not, CUE_TWO_SIDED
    of the time), as a complete answer in his voice. When the call keeps it to himself (`tells` False),
    a line that names no topic and an empty `topics`."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    if not tells:
        lines = persona.NO_TOPIC.get(persona.of(state, pid)["personality"]) or persona.NO_TOPIC["guarded"]
        return {"topics": [], "text": random.Random(f"persona-line-call-{pid}-{week}-cue").choice(lines).format(**f)}
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
    cue, his question's intro when he has one, and on a visit his dad's ask. Returns the reaction's kind:
    on a call that keeps his priority to himself, "guarded" (unless tired), whatever he thought of it."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    week = sc["week"]
    rng = random.Random(f"present-{rc['seed']}-{slug}-{pid}-{week}")
    f = _fields(state, slug, p, week)
    tr = truth(state, slug, pid, week)
    x, y, z = (said_phrase(tr, t) for t in topics)                  # a strength you lack is said honestly
    sc["turns"].append(_turn("you", rng.choice(PRESENT_SAID).format(x=x, y=y, z=z, **f)))
    tells_ = tells(state, slug, pid, sc["action"])
    c = cue(state, slug, pid, week, f, tells_)                     # its own draw: asked first so the reaction never repeats it
    if tired:
        kind, text = "tired", rng.choice(PRESENT_LINES["tired"]).format(**f)
    elif hits:
        st_ = recruiting.strengths(state, slug, pid)
        best = max(hits, key=lambda t: st_[t])
        phrase = said_phrase(tr, best)                              # he echoes what you said
        kind, text = "hit", rng.choice(PRESENT_LINES["hit"]).format(topic=phrase, Topic=phrase[0].upper() + phrase[1:], **f)
        mine = _persona_line(state, pid, sc["id"], "hit", f, always=not tells_)     # a call that tells nothing names no topic
        text = mine or text
    elif back:
        kind, text = "quiet", true_line(tr, back[0], "quiet", rng.choice(LINES[back[0]]["quiet"]), f"{sc['id']}-present")[0].format(**f)
        text = _persona_line(state, pid, sc["id"], "quiet", f, always=not tells_) or text
    else:
        kind, text = "polite", rng.choice(PRESENT_LINES["polite"]).format(**f)
        if not tells_:                                              # a generic polite line would say none were his
            text = _no_tell_line(state, pid, f"{sc['id']}-present", f, avoid=c["text"])
    if not tells_ and kind != "tired":
        kind = "guarded"
    sc["turns"].append(_turn("him", text))
    sc["turns"].append(_turn("you", rng.choice(ASK["two" if len(c["topics"]) > 1 else "one"]).format(**f)))
    sc["turns"].append(_turn("him", c["text"]))
    sc["cue"] = c
    if sc["action"] == "hc_visit":
        sc["turns"].append(_turn("note", ask_note(state, slug, pid, sc["ask"])))
    sc["question"] = question(state, slug, pid, week, sc.get("package"))
    if sc["question"]:
        sc["turns"].append(_turn("him", QUESTION_INTRO))
    sc["presented"] = list(topics)
    sc["present"] = {"kind": kind, "hit": list(hits) if tells_ else []}      # a call that tells nothing hides which were his
    _lines(sc)
    return kind


def ask_note(state: dict, slug: str, pid: str, ask: dict) -> str:
    """The visit's note on his family's NIL ask, in the game's NIL words and numerals: the ask the profile's
    His Ask shows (the number after a visit, the middle of the range before) and where you stand: the NIL
    you have left (and what your offer already holds on him), or that the ask is more than you can put up."""
    n = ask.get("exact")
    if n is None and ask.get("hi"):
        n = recruiting._five((ask["lo"] + ask["hi"]) / 2)
    if not n:
        return "His dad says the money isn't the point."
    rec = state["recruiting"]["nil"].get(slug)
    left = (recruiting.nil_left(state, slug) if rec                 # read only: never opens the school's NIL record here
            else recruiting.portal_budget(state, slug) if recruiting.is_portal(state) else recruiting.nil_budget(state, slug))
    held = ((rec or {}).get("held") or {}).get(pid, 0)
    room = left + held                                            # an offer to him can hold up to this (recruiting.act)
    about = "" if ask.get("exact") is not None else "about "
    if n > room:
        return f"His dad wants {about}{n} in NIL, more than you have left ({room})."
    if held:
        return f"His dad wants to know about NIL: they're looking for {about}{n}. Your offer holds {held}, and you have {left} NIL left."
    return f"His dad wants to know about NIL: they're looking for {about}{n}. You have {left} NIL left."


def package_about(state: dict, slug: str, pid: str) -> dict | None:
    """A Package Deal's mate as the scene keeps him for the question: {pid, name, offered} when he is a
    prospect in the class still to be had (not signed), else None."""
    rc = state["recruiting"]
    m = persona.mate(state, pid)
    if not m or m not in rc["prospects"] or (rc["status"].get(m) or {}).get("signed"):
        return None
    return {"pid": m, "name": rc["prospects"][m]["name"], "offered": m in rc["offers"].get(slug, [])}


def package_answers(about: dict) -> dict:
    """The Package Deal question's three answers, filled: {answer: {label, text}}."""
    table = PACKAGE_ANSWERS[bool(about.get("offered"))]
    return {k: {"label": label, "text": text.format(mate=about["name"])} for k, (label, text) in table.items()}


def question(state: dict, slug: str, pid: str, week: int, package: dict | None = None) -> dict | None:
    """His question about a named player, QUESTION_RATE of the time when playing time is one of his
    priorities (its own RNG: no other draw moves): the best returning player at his group on your
    roster rated at least as high ("roster"), else the highest-ranked other recruit you offered at
    his group who is uncommitted or yours ("recruit"); neither, no question. A scene where his
    Package Deal came up (`package`, scenes.package_about) asks about his mate instead ("package":
    always, its own draw for the line; the answers ride on the question, by whether you offered him)."""
    rc = state["recruiting"]
    p = rc["prospects"][pid]
    if package:
        about = {**package, "offered": package["pid"] in rc["offers"].get(slug, [])}   # as it stands when he asks
        rng = random.Random(f"question-package-{rc['seed']}-{slug}-{pid}-{week}")
        text = rng.choice(QUESTION_LINES["package_offered" if about["offered"] else "package"]).format(mate=about["name"])
        return {"kind": "package", "text": text, "answer": None, "reply": None, "about": about, "answers": package_answers(about)}
    if "playing_time" not in p["priorities"]:
        return None
    rng = random.Random(f"question-{rc['seed']}-{slug}-{pid}-{week}")
    if rng.random() >= QUESTION_RATE:
        return None
    ahead = recruiting.ahead_of(state, slug, pid)
    if ahead:
        text = rng.choice(QUESTION_LINES["roster"]).format(ahead=ahead["name"], ahead_cls=CLASS_WORDS.get(ahead["cls"], "veteran"),
                                                           position=ahead["position"])
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
    """What he says back to your answer (a hollow promise gets its own line; the Package Deal's promise
    waits on the offer, and its straight answer once his mate holds your offer has its own)."""
    if question.get("kind") == "package":
        if answer == "promise":
            return REPLY_LINES["package"]
        if answer == "straight" and question["about"].get("offered"):
            return REPLY_LINES["package_offered"]
        return REPLY_LINES[answer]
    if answer == "promise" and not truthful:
        return REPLY_LINES["hollow"]
    return REPLY_LINES[answer]


def reaction(state: dict, slug: str, pid: str, action: str, pitch: str, p: dict, tired: bool = False, tells: bool = True) -> dict:
    """How he takes your lead-with: a priority (or his decider's topic, persona.counts_as_priority) where
    you are strong lights him up (hit), one where you are weak goes quiet, anything else is polite;
    `tired` (the call pestered him) and the pitch falls flat. On a call that keeps his priority to himself
    (`tells` False) the kind is "guarded" whatever he thought (his personality's line keeps its tone; a
    pitch that was none of his gets a line that names nothing). `you` is your line, for the conversation."""
    rng = random.Random(f"react-{state['recruiting']['seed']}-{slug}-{pid}-{state['current_week']}-{action}")
    f = _fields(state, slug, p)
    tr = truth(state, slug, p["id"])
    you = lead_line(tr, pitch).format(**f)                          # your line, true to the record and the program
    if tired:
        return {"kind": "tired", "text": rng.choice(TIRED).format(**f), "you": you}
    if persona.counts_as_priority(state, pid, pitch):
        kind = "hit" if recruiting.strengths(state, slug, pid)[pitch] >= recruiting.BACKFIRE else "quiet"
    else:
        kind = "polite"
    sid = f"{action}-{p['id']}-{state['current_week']}"          # the scene's id: its personality line, keyed apart from every other draw
    line, fixed = true_line(tr, pitch, kind, rng.choice(LINES[pitch][kind]), sid)     # a claim the facts do not back gives way
    text = line.format(**f)
    if fixed and tells and pitch == "winning" and kind == "hit":
        pass                                                      # his doubt about the record stands: his personality's line would hide it
    elif kind in ("hit", "quiet"):
        text = _persona_line(state, p["id"], sid, kind, f, always=not tells, salt="react") or text
    elif not tells:                                               # the topic's polite line would say it is none of his
        text = _no_tell_line(state, p["id"], f"{sid}-react", f)
    elif pitch == "nil":                                          # money is not what he is about, and he says so
        text = NIL_NOT_HIS
    return {"kind": kind if tells else "guarded", "text": text, "you": you}

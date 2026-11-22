// Coach Career scenes (docs/superpowers/specs/2026-10-28-recruiting-experience-design.md, section 6):
// your calls and in-home visits as a short conversation. You open; he answers with small talk that
// knows the week (your last game, his practice, the school leading his list); you present your program
// (three things); he reacts; you ask what will decide it; he answers with the cue (one topic, or two
// when he is torn); you lead with a pitch; he reacts. This file owns the words and the choice of cue
// and reaction; recruiting.py owns the scene's lifecycle and its points (the one `_act` path).
//
// A scene is `turns`: [{who: "you" | "him" | "note", text}] in order (an in-home visit with a decider other
// than himself adds one {who: "family", label: the decider's label, text}); `lines` (his turns' texts) stays
// one release for the page's old readers. Lines are in his voice (or yours), present tense, short, no
// numbers (an in-home visit's ask is in words). They take {name}, {first}, {town}, {state}, {school},
// {position} ({positions} its plural in words), {role} ("start", "compete" or "wait"), {record} (the school's won-lost in words; {rec} the same
// to go inside a sentence, {conf} its conference record), {coach}
// (your last name), {opponent} and {result} ("beat" / "lost to": your last game, or the opener before
// one), {leader} (the school leading his list, "" when none or you) and {week_word}. Lines fit a high
// schooler and a transfer alike; two-sided cues take {a} and {b}, two topics' phrases. A line that claims
// something about the school (NEEDS) is said only while it is true (`facts`, `truth`): this season's record,
// the last game, the conference record, the rank, the program's recent winning and its strengths decide.
//
// Ported from coach_career/scenes.py by engine_js/PORTING.md's rules. Every constant and function is on `scenes`
// and is read through it. `persona`, `recruiting`, `programs`, `clear` and `season` are reached through `modules` at
// the call. What is not the Python's own text, said once:
//   - `line.format(**f)` is `format(line, f)` below: one pass over the template, a missing field throws;
//   - `TABLES` holds persona's tables, so it is built the first time it is read (persona may load after this file);
//   - QUESTION_RATE reads `env.CFP_QUESTION_RATE` (engine_js/files.js) where Python read the environment.
import { Random, sorted, maxBy, cmp, get, truthy, floordiv, mod, pyfloat } from "../engine_js/pyrt.js";
import { env } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

export const scenes = {};

// ---- Python's own, for this file ----------------------------------------------------------------------------------
/** `x or d` for a dict, list or None: the value when it is true in Python's sense, else the default. */
const orr = (x, d) => (truthy(x) ? x : d);
/** `k in d` for a dict. */
const own = (d, k) => Object.prototype.hasOwnProperty.call(d, k);
/** str(v) as an f-string or str.format writes a value: None, True, False, a whole number, a float. */
function pystr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyfloat(v);
  return String(v);
}
/** template.format(**fields): every {name} filled in one pass (a field's own text is never read again). */
function format(template, fields) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (fields[k] === undefined) throw new Error(`KeyError: '${k}'`);
    return pystr(fields[k]);
  });
}
/** f"{n:,}": a number with commas between its thousands. */
function commas(n) {
  const text = pystr(n), at = text.search(/[.e]/), whole = at === -1 ? text : text.slice(0, at);
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (at === -1 ? "" : text.slice(at));
}
/** str.capitalize(): the first letter upper case, the rest lower. */
const capitalize = (s) => s.slice(0, 1).toUpperCase() + s.slice(1).toLowerCase();
/** str.split(): the words between runs of white space. */
const split = (s) => s.trim().split(/\s+/).filter((w) => w.length);
/** sum(map(ord, s)). */
function ordsum(s) {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0);
  return n;
}

scenes.PERSONA_LINE = 0.5;   // how often his personality's own line stands in for the generic one *tune*
scenes.CUE_TWO_SIDED = 0.6;   // how often a cue names two topics (one his, one not) *tune: tools/check_recruiting.py*
scenes.CUE_TRUST_CONTACTS = 3;   // *tune* from this many contacts with him (or once you offered him) he names no decoy: he's straight with you
scenes.KNOWN_LEADS = ["You already know I care about {k}.", "You know where I stand on {k}."];   // his answer starts from what you've heard
scenes.ALL_KNOWN = "You know what I care about, Coach: {a}, {b} and {c}.";   // ... when you've heard all three
scenes.REPEAT_LINE = "You already said that one, Coach.";   // you lead with what your opening said
// how often a playing-time recruit asks about a named player on a call or visit *tune: tools/check_recruiting.py*
// (CFP_QUESTION_RATE: the sweep forces it through the dev server's environment)
scenes.QUESTION_RATE = Number(env.CFP_QUESTION_RATE ?? "0.6");

// the topics as he would say them, for two-sided cues
scenes.PHRASES = {"proximity": "staying close to home", "playing_time": "getting on the field early",
           "prestige": "a big-name program", "winning": "winning right away", "nil": "the NIL side of it",
           "coach": "the coaches I'd play for", "academics": "getting a real degree", "pro": "getting to the league"};

scenes.LINES = {
    "proximity": {
        "cue": ["Honestly, Coach? My mom wants me close enough to drive to games.",
                "I like Sunday dinners in {town}. I don't want to give that up.",
                "Whoever I pick, my family has to be in the stands. That's the big one."],
        "hit": ["That's what I want to hear. My folks could make every home game.",
                "Home on a weekend? That matters, Coach. It really does.",
                "{town} to your campus isn't far at all. I like that a lot."],
        "polite": ["Being close is nice, I guess. My folks will travel.",
                   "Yeah, the drive's easy. That's cool.",
                   "Sure. I'd go anywhere for the right fit, though."],
        "quiet": ["...That's a long way from {town}, Coach.",
                  "My mom's not going to like that drive.",
                  "Yeah. I'll have to think about being that far out."],
    },
    "playing_time": {
        "cue": ["Honestly, Coach? I want to play {position} on Saturdays, not hold a clipboard.",
                "Everybody says I'll play right away. I want to see it.",
                "I'm not coming to sit. I want snaps."],
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
        "hit": ["That would be real money for my family, Coach. Thank you.",
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
        "cue": ["The staff. I want a coach who's going to be there the whole time I am.",
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
                "My dad says {a}. My trainer says {b}. I don't know yet.",
                "Some days it's {a}, some days it's {b}. Ask me tomorrow and I'll say the other one."],
    },
};

// a pestering call or visit (recruiting.PESTER_FREE): he is not weighing you, and the pitch falls flat
scenes.TIRED = ["He is polite but short. He is not weighing you right now, and the attention is wearing thin.",
         "He goes quiet on you. {school} is not on his mind, and he does not hide it.",
         "He hears you out and says nothing about {school}. His mind is on other schools, and he wants to be left alone."];

// his question about a named player (docs/superpowers/specs/2026-10-29-recruit-questions-design.md,
// section 2): the player ahead of him on your roster ({ahead}, {ahead_cls} his class in words, {position}
// that player's roster position: a recruit listed as an athlete asks about your WR, never your "ATH"),
// or another recruit you offered at his position ({other})
scenes.QUESTION_LINES = {
    "roster": ["Is {ahead} still your {position} next year? I'm not coming to sit behind him.",
               "{ahead} is a {ahead_cls}, and he's ahead of me. Where does that leave me?",
               "My dad looked at your depth chart. He says {ahead} has that spot locked."],
    "recruit": ["You offered {other} too. Which one of us do you actually want?",
                "I saw {other} post your offer. You telling him the same thing you're telling me?",
                "If {other} commits first, is there still a spot for me?"],
    // the Package Deal, once his or his family's line brought his mate up ({mate}): the mate without your offer, or holding it
    "package": ["So what about {mate}, Coach? Is there a spot for him?",
                "{mate} hasn't heard from you. Is he getting an offer?",
                "Where does {mate} stand with you? I need to know before I decide."],
    "package_offered": ["{mate} showed me your offer. We're both in this together, right?",
                        "You offered {mate}. Is that spot his for real?",
                        "{mate} has your offer. Just tell me you mean it for both of us."],
};
scenes.ANSWERS = ["straight", "promise", "deflect"];
scenes.ANSWER_COPY = {
    "roster": {"straight": "He's the starter today. You'd compete, and the best man plays.",
               "promise": "The job's yours.",
               "deflect": "Let's talk about what you'd bring."},
    "recruit": {"straight": "I offered him too. One of you starts; I want it to be you.",
                "promise": "You're the one I want.",
                "deflect": "Let's talk about what you'd bring."},
};
// the Package Deal's answers (scenes.question kind "package"): the label and your line by answer, the mate without
// your offer or holding it ("straight" differs: you have offered him, or you will look at him); {mate} his name
scenes.PACKAGE_ANSWERS = {
    false: {"straight": ["Tell Him Straight", "I can't promise {mate} a spot today. I'll look at him."],
            "promise": ["Promise Him an Offer", "{mate} gets an offer this week. You have my word."],
            "deflect": ["Sidestep It", "Let's talk about what you'd bring."]},
    true: {"straight": ["Already Offered Him", "I offered {mate} already. Two spots, both yours."],
           "promise": ["Promise His Spot", "{mate}'s offer stands. He signs with you, no questions."],
           "deflect": ["Sidestep It", "Let's talk about what you'd bring."]},
};
// what he says back: a promise he believes ("promise") or one he has heard before ("hollow"); the Package Deal's
// straight answer once his mate holds your offer ("package_offered"), and his promise, which waits on the offer ("package")
scenes.HEARD_RIVAL = "Coach, I heard you told another kid the same thing.";   // an earlier job promise at his position, strained (recruiting._strain)
scenes.JOB_SAID = "The job's yours. I mean it.";   // Promise Him the Job, as you say it
scenes.REPLY_LINES = {"crowded": "Everybody gets that line, Coach. I hear you've already got guys at my spot.",
               "straight": "Fair. At least you're not blowing smoke.",
               "promise": "That's what I needed to hear, Coach.",
               "hollow": "I've heard that one before.",
               "deflect": "...Okay.",
               "package_offered": "That's all we needed to hear, Coach.",
               "package": "Then we'll be watching for it."};
// the Package Deal promise kept (recruiting._promises): his History's line, {mate} his mate
scenes.PROMISE_KEPT_LINE = "{mate} got his offer. You kept your word, Coach.";
scenes.MONEY_KEPT_LINE = "You put the money on the table. You kept your word, Coach.";
// a money promise broken, in his voice: nothing on your offer ("none") or some, short of what you talked ("short")
scenes.MONEY_BROKEN_LINES = {
    "none": {"cocky": "You talked money, Coach, and I never saw a dime of it on the table.",
             "shy": "I know you meant it, Coach. There just was never any money on the offer.",
             "guarded": "You talked money and never put it on the table. I noticed.",
             "attention": "Everybody asked me what you were paying. I had nothing to tell them.",
             "business": "You talked money and never put it on the table."},
    "short": {"cocky": "You talked a bigger game than that, Coach.",
              "shy": "I know you tried, Coach. I just thought there'd be more there.",
              "guarded": "You talked like there was going to be more there.",
              "attention": "That's not the number you were talking about, Coach.",
              "business": "That's not the number you talked about. It came up short."}};
scenes.MONEY_BROKEN_LINE = scenes.MONEY_BROKEN_LINES["none"]["business"];
// at a small school he may let it go (recruiting.MONEY_FORGIVE_CHANCE, MONEY_FORGIVE_TIER), each in his own way
scenes.MONEY_FORGIVEN_LINES = {"shy": "Sorry, Coach, I know you're a smaller school. No worries if you can't get it done.",
                        "business": "I get it, Coach. Smaller school, smaller budget. We're good.",
                        "guarded": "I figured it might go that way at a smaller school. It's fine.",
                        "attention": "People will be watching me wherever I play, Coach. We're good.",
                        "cocky": "No worries, Coach. Maybe I come in and help you raise that budget."};
scenes.MONEY_FORGIVEN_LINE = scenes.MONEY_FORGIVEN_LINES["shy"];
scenes.MONEY_OWED_LINE = "You talked money: put it on your offer within two weeks.";   // the money promise opens: the player is told
scenes.NIL_NOT_HIS = "The money isn't what this is about for me.";   // NIL pitched to a recruit who does not care about it
scenes.CLASS_WORDS = {"FR": "freshman", "FRRS": "redshirt freshman", "SO": "sophomore", "SORS": "redshirt sophomore",
               "JR": "junior", "JRRS": "redshirt junior", "SR": "senior", "SRRS": "redshirt senior"};

// ----- the conversation -------------------------------------------------------------------------------
// you open a call: a first call, a call the week after the last one, or one after a gap
scenes.OPEN = {
    "first": ["Hey {first}, Coach {coach} at {school}. Got a minute?",
              "{first}? Coach {coach}, {school}. Did I catch you at a good time?",
              "Hey {first}. Coach {coach} over at {school}. You got a few minutes for me?"],
    "last_week": ["Hey {first}, Coach {coach} again. Good talking last week.",
                  "{first}, Coach {coach}. Good talking last week. Got a minute?"],
    "again": ["Hey {first}, Coach {coach} at {school}. Week {week_word} already, you believe that?",
              "{first}, Coach {coach}. Been a minute since we talked. How are you?"],
};
// you open an in-home visit: you are in the living room
scenes.VISIT_OPEN = ["Thank you all for having me. {first}, good to finally sit down with you.",
              "Appreciate you opening your home. {first}, you look bigger in person.",
              "Thanks for having me, everybody. {first}, I've been looking forward to this."];
// his answer: small talk that knows the week, picked by what is true
scenes.CONTEXT = {
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
               "Hey Coach. {leader} keeps calling, so I'm used to this."],
    "tired": ["...Yeah, Coach. Okay, I guess.",
              "Hey. Yeah. Kind of a lot going on, Coach.",
              "Hi Coach. Sure. Make it quick if you can."],
};
// the transfer portal (the player's ask): the season is over and he has played college ball, so you open on his
// portal entry and he talks about his last school ({from_name}), what he did there ({did}) and why he left
scenes.PORTAL_OPEN = ["Hey {first}, Coach {coach} at {school}. Saw your name go in the portal. Got a minute?",
               "{first}? Coach {coach}, {school}. I watched your tape from {from_name}. You have a minute?",
               "Hey {first}. Coach {coach} over at {school}. I know your phone's blowing up, so I'll be quick."];
scenes.PORTAL_AGAIN = ["{first}, Coach {coach} again. Where's your head at?",
                "Hey {first}, Coach {coach}. Checking back in. How's the portal treating you?"];
scenes.PORTAL_VISIT_OPEN = ["Appreciate you sitting down with me, {first}. I've watched a lot of your film from {from_name}.",
                     "Thanks for making the time, {first}. I know a lot of schools want this meeting.",
                     "Good to finally meet you, {first}. Let's talk about what's next after {from_name}."];
// why he left, in his words: his role there (by usage) when nothing else drove it, else the driver
scenes.PORTAL_WHY = {
    "starter": ["I started {started} games at {from_name} last year, Coach. {did_cap}. I want to play for a winner now.",
                "Yes sir. {did_cap} at {from_name}. I'm looking for the right fit for my last stretch."],
    "rotation": ["I played in {games} games at {from_name}, but I was splitting time. I want the job outright.",
                 "Yes sir. {did_cap} at {from_name}, mostly in a rotation. I know I can do more."],
    "bench": ["I barely saw the field at {from_name}, Coach. I need somewhere I can actually play.",
              "Honestly, Coach, I sat most of last year at {from_name}. I'm ready to show what I can do."],
    "promised": ["They told me the job was mine at {from_name}, Coach. Then they gave it to somebody else.",
                 "I was promised a starting spot at {from_name}. That didn't happen, so here I am."],
    "deal": ["I'll be honest, Coach: {from_name} couldn't pay me what I'm worth. The money matters.",
             "Yes sir. {did_cap} at {from_name}, and they didn't want to pay for it. So I'm listening."],
    "slipping": ["{from_name} is going the wrong way, Coach. I want to win while I'm still in college.",
                 "Yes sir. We lost too much at {from_name}. I want to play meaningful games."],
    "better_coach": ["I need coaching, Coach. I wasn't getting better at {from_name}.",
                     "Yes sir. I want a staff that develops guys. That wasn't happening at {from_name}."],
};
// the one who decides at a transfer's visit (persona.PORTAL_DECIDERS): about his move, not his first time from home
scenes.PORTAL_DECIDER_LINES = {
    "mom": ["He's been through a lot this year, Coach. I want this next move to be the right one.",
            "We trusted the last staff, Coach. Tell me why this time is different.",
            "I just want him somewhere he's happy again. Can you give him that?"],
    "dad": ["He's done his time, Coach. What's his role on day one?",
            "Straight answers this time, Coach. We got the sales pitch at {from_name}.",
            "Don't tell me he'll compete. Tell me where he fits."],
    "trainer": ["He's got film now, Coach. Let's talk about what that's worth.",
                "Every school in the portal is calling. What's your number?",
                "He produced at {from_name}. I need to see how {school} pays for that."],
};
// his stat line as words for {did}: the two numbers a fan quotes for his position (recruiting.LINE_KEYS)
scenes.STAT_WORDS = {"pass_yards": "passing yards", "passing_touchdowns": "touchdown passes", "rush_yards": "rushing yards",
              "rushing_touchdowns": "rushing touchdowns", "receptions": "catches", "receiving_yards": "receiving yards",
              "receiving_touchdowns": "touchdown catches", "tackles": "tackles", "sacks": "sacks", "tackles_for_loss": "tackles for loss",
              "interceptions": "interceptions", "passes_defended": "pass breakups", "field_goals_made": "field goals", "punts": "punts",
              "carries": "carries", "snaps": "snaps"};

export function portal_fields(state, p) {
  // The portal entrant's own fields for his lines: his last school, games and starts, {did} (his numbers in words, or
  // his games when he has none) and why he left (`why`: his driver, else his usage there).
  const line = orr(get(p, "line"), {});
  const stats = orr(get(line, "stats"), {});
  const keys = Object.keys(stats).filter((k) => own(scenes.STAT_WORDS, k) && !["carries", "snaps", "interceptions_thrown"].includes(k)).slice(0, 2);
  const games = get(line, "games") || 0;
  let did;
  if (keys.length) {
    did = keys.map((k) => `${commas(stats[k])} ${scenes.STAT_WORDS[k]}`).join(" and ");
    did = `I had ${did}`;
  } else if (truthy(games)) {
    did = `I played in ${pystr(games)} games`;
  } else {
    did = "I didn't get many snaps";
  }
  const entry = orr(get(get(orr(get(orr(get(state, "offseason"), {}), "portal"), {}), "players", {}), p["id"]), {});
  const driver = get(entry, "driver");
  const why = own(scenes.PORTAL_WHY, driver) ? driver : (own(scenes.PORTAL_WHY, get(p, "usage")) ? get(p, "usage") : "rotation");
  return { from_name: get(p, "from_name") || "my last school", games, started: get(line, "started") || 0,
    did, did_cap: did.slice(0, 1).toUpperCase() + did.slice(1), why, has_did: keys.length > 0 };
}


export function portal_line(state, p, sid, f) {
  // Why he left, in his words (its own seeded draw `portal-line-{sid}`): a starter with no starts on record reads as
  // the rotation line; a line that quotes his numbers only when he has numbers.
  let why = !(f["why"] === "starter" && !truthy(f["started"])) ? f["why"] : "rotation";
  if (why === "rotation" && !truthy(f["games"])) {
    why = "bench";                   // no games on record: he did not "split time" in 0 games (the text sweep's find)
  }
  let pool = scenes.PORTAL_WHY[why].filter((x) => truthy(get(f, "has_did")) || !x.includes("{did"));   // his numbers only when he has some
  if (!pool.length) pool = scenes.PORTAL_WHY[why];
  return format(new Random(`portal-line-${sid}`).choice(pool), f);
}

// your opening: the three things you lead your program with, as you say them
scenes.PRESENT_SAID = ["Here's {school} in a nutshell: {x}, {y} and {z}.",
                "Let me tell you what we're about at {school}: {x}, {y} and {z}.",
                "Three things about us, {first}: {x}, {y} and {z}."];
// how he takes your opening: one of his priorities in it (the one you are strongest on, {topic}, in his
// words: {Topic} to open a line, {topic} inside one), none, or he is tired of you; a priority you are weak at gets
// that topic's quiet line
scenes.PRESENT_LINES = {
    "hit": ["{Topic}. Yeah. Keep talking, Coach.",
            "{Topic}... okay. That's the part I wanted to hear.",
            "You said {topic}. That's the one. Go on."],
    "polite": ["Appreciate that, Coach.",
               "Okay. Yes sir.",
               "I hear you, Coach."],
    "tired": ["Okay.",
              "Yeah. I've heard the speech, Coach."],
};
// your question that sets up the cue: for one topic, and for a cue that names two
// ... and to a recruit already committed to you: he is not deciding anything
scenes.ASK_COMMITTED = ["Still feeling good about us, {first}?", "How are you feeling about {school}, {first}? Still solid?"];
scenes.CUE_COMMITTED = ["I'm solid, Coach. Nothing's changed on my end.", "Yes sir. I'm with you. Just keep it real with me."];
scenes.ASK = {
    "one": ["So what's going to decide this for you?",
            "Tell me straight, {first}: what's going to decide this for you?"],
    "two": ["Where's your head at right now?",
            "Where's your head at, {first}? Honest answer."],
};
// your lead-with, as you say it, after he has told you what he cares about
scenes.LEAD_LINES = {"proximity": "You'd be close, {first}. Your folks could make every home game.",
              "playing_time": "We need {position} help now. You'd have a real shot at the field.",
              "prestige": "You know what this name means. Everybody does.",
              "winning": "We're built to win now, and we are not slowing down.",
              "nil": "The collective takes care of our guys. That's real, and it's yours.",
              "coach": "I'm not going anywhere. You'd play for me every year you're here.",
              "academics": "The degree here means something. Your mom will like that part.",
              "pro": "We put {positions} in the league, {first}. Scouts know the way here."};
scenes.LEAD_PRO_PROGRAM = "We put guys in the league, {first}. Scouts know the way here.";   // pro holds but not at his spot (a kicker or punter)

// ----- what is true (the lines that claim something agree with the game's facts) ---------------------------
scenes.CLAIM_FROM = 0.6;   // *tune* a topic's strength from which your lines claim it outright (the page's Strong); under it they speak honestly
scenes.HISTORY_WINNING = 50.0;   // *tune* the program's winning metric (programs.py: the last three seasons) from which "we win here every year" is true

// your lead-with on a topic you cannot claim (`truth` False): honest, or aspirational, never a claim
scenes.LEAD_HONEST = {"proximity": "It's a trip from {town}, I know. We'll make your folks feel at home every time they come.",
               "playing_time": "Nobody gets handed a job here, {first}. You'd get a fair shot to compete at {position}.",
               "prestige": "We're not the biggest name out there yet. Come help us make it one.",
               "nil": "The collective is still growing, but it takes care of our guys.",
               "coach": "I know what people are saying. I'm here to build this, and I want you in it.",
               "academics": "You'll get your degree here. We make sure our guys finish.",
               "pro": "I won't tell you we've sent a lot of guys to Sundays. Come be the first one everybody remembers."};
scenes.LEAD_HONEST_PRO_SOME = "We've sent some, {first}. You could be the next one.";   // under the claim line, with a pick at his group in ten years
// your Winning Now lead by the season's form (`facts`): this season's record, the last game, the conference record and
// the program's recent history decide which is true; "hot" and "pre_up" are LEAD_LINES["winning"] (or the ranked line)
scenes.LEAD_WINNING = {"ranked": "We're ranked, we're winning, and we are not slowing down.",
                "winning": "We're {rec} and winning this year. One bad Saturday doesn't change who we are.",
                "even": "We're {rec}, right in the middle of it. Guys like you are how we tip it to winning now.",
                "even_conf": "We're {rec}, but we're {conf} in conference play. We're building to win now.",
                "losing": "We're not where we want to be this year, but we're building something to win now.",
                "losing_conf": "We're not where we want to be this year, but we're {conf} in the conference. We're building to win now.",
                "losing_history": "We're not where we want to be this year, but we've won here before, and we're building to win now.",
                "pre_down": "Last year wasn't us. We're building something to win now."};
// his reaction to a Winning Now lead that landed (hit) when the record does not back it: skeptical, not sold
scenes.WIN_DOUBT = {"even": ["{record}. You're right there, Coach. Show me the rest of the year.",
                      "Even's not winning, Coach. But I hear you."],
             "losing": ["You're {rec}, Coach. Winning now? I'll believe it when I see it.",
                        "{record}, Coach. Everybody says next year. Show me."],
             "losing_history": ["I know you guys won before. But {rec}? I'll believe it when I see it."],
             "pre_down": ["You guys had a rough one last year, Coach. Show me it's different."]};
// his reaction on a topic you cannot claim that still landed (hit): interested, in words that claim nothing false
scenes.HONEST_HIT = {"proximity": ["It's a drive, but my folks could make some games. That helps.",
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
                           "You've sent a few? Then I could be one of them."]};   // `pro` when nothing was drafted at his group in ten years, `pro_some` when something was
// your opening's three things on a topic you cannot claim, as you say them (PHRASES are his words and your claims)
scenes.SAID_HONEST = {"proximity": "a home away from home", "playing_time": "a fair shot to compete",
               "prestige": "a program you can help build", "winning": "building a winner", "academics": "getting your degree", "pro": "a path to Sundays"};
// the claim each line makes (by its template): the `truth` key that must hold ("!key": must not; a tuple: all of them); any line not
// listed claims nothing. A line whose claim is false gives way to one in its pool that holds, else the honest one.
scenes.NEEDS = {
    "That's what I want to hear. My folks could make every home game.": "proximity",
    "Home on a weekend? That matters, Coach. It really does.": "proximity",
    "{town} to your campus isn't far at all. I like that a lot.": "proximity",
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
    "Playing for a title every year? Yes sir.": ["winning", "history"],
    "Yeah, you've been good. That's cool.": "winning",
    "{record}... I want to play for a winner, Coach.": "!winning",
    "...You guys have had some rough years.": "!history",
    "That would be real money for my family, Coach. Thank you.": "nil",
    "My dad is going to like hearing that.": "nil",
    "Okay. That takes care of a lot back home.": "nil",
    "That's a real school, Coach. That counts for a lot.": "academics",
    "My mom is going to love that. The degree matters.": "academics",
    "You put {positions} in the league. That's what I'm chasing.": ["pro", "pro_spot"],
    "Sundays. That's the dream, Coach, and you've got the receipts.": "pro",
    "First-rounders at my spot? Say less.": ["pro", "pro_spot"],
};

// ----- School Grades Phase 2: the five campus topics (facilities, location, stability, game day, exposure) ---------
scenes._G_PHRASES = {"facilities": "the facilities", "location": "where I'd be living", "stability": "a staff that sticks around",
           "game_day": "the Saturday crowd", "exposure": "being on TV"};

scenes._G_LINES = {
    "facilities": {
        "cue": ["Honestly, Coach? I want to see the weight room. Where I train matters.",
                "I like a nice building. I'm going to live in there every day.",
                "My trainer says the facilities tell you what a school thinks of its players."],
        "hit": ["That building is crazy, Coach. I could live in there.",
                "That weight room? That's where I want to be.",
                "Okay, the facilities are real. I see it."],
        "polite": ["Yeah, nice building. I just need a field and a weight room.",
                   "That's cool. Facilities don't win games, though.",
                   "Sure, Coach. Everybody's got a nice locker room now."],
        "quiet": ["...It looked kind of old when I saw pictures.",
                  "Other schools showed me their new buildings, Coach.",
                  "I don't know. I was hoping for something newer."],
    },
    "location": {
        "cue": ["I want to like where I live, too. Not just the stadium.",
                "Weather matters to me, Coach. I'm being honest.",
                "Where is it, really? Like, what's there to do?"],
        "hit": ["I could see myself living there. For real.",
                "That's my kind of place, Coach.",
                "Yeah. I'd be happy there off the field too."],
        "polite": ["The town's fine. I'm there to play.",
                   "Yeah, sounds nice. Not a big deal for me.",
                   "Okay. I'll be in the building most of the time anyway."],
        "quiet": ["...I don't know if I'd like it out there.",
                  "That's not really my kind of place, Coach.",
                  "My mom asked what there is to do there. I didn't know."],
    },
    "stability": {
        "cue": ["I want to know the staff will still be there when I leave.",
                "Coaches leave. I've seen it happen to guys I know.",
                "My mom keeps asking if you're staying, Coach."],
        "hit": ["That program doesn't run through coaches. That means something.",
                "Same staff the whole way? That's what I want.",
                "Okay. I trust that you guys aren't going anywhere."],
        "polite": ["Sure. Coaches move, though. That's football.",
                   "I hear you. I'll worry about that later.",
                   "Okay, Coach. Everybody says they're staying."],
        "quiet": ["...You've had a lot of coaches come through there.",
                  "My dad says that staff changes every couple years.",
                  "I don't know who I'd be playing for in two years."],
    },
    "game_day": {
        "cue": ["I want to play in front of a real crowd. Loud.",
                "Saturdays, Coach. I want the whole town there.",
                "I went to a game somewhere and the place was shaking. I want that."],
        "hit": ["That crowd is loud. I've seen it on TV.",
                "Running out in front of all those people? I'm in.",
                "That's a real Saturday, Coach."],
        "polite": ["Crowds are cool. I just want to play.",
                   "Yeah, sounds fun. Not my first thing.",
                   "Sure. I'll play in front of anybody."],
        "quiet": ["...The stands looked kind of empty on TV.",
                  "I want a louder place than that, Coach.",
                  "I don't know. It didn't feel like much of a game day."],
    },
    "exposure": {
        "cue": ["I want to be on TV. People back home want to watch me.",
                "Big games, national TV. That's how you get seen.",
                "My trainer says exposure is everything for the draft and NIL."],
        "hit": ["Prime time every week? Let's go.",
                "Everybody back home could watch. That's big.",
                "That's the stage, Coach. I want it."],
        "polite": ["TV's cool. I just want to play well.",
                   "Yeah, sure. Film is film.",
                   "Okay. If I play good, they'll find me."],
        "quiet": ["...My grandma can't even find your games on TV.",
                  "Other schools are on national TV every week, Coach.",
                  "I don't know. Nobody back home watches your games."],
    },
};

scenes._G_LEAD_LINES = {"facilities": "Come see the building, {first}. Everything you need to get better is under one roof.",
              "location": "You'd love living here, {first}. It's a great place to spend your college years.",
              "stability": "This program keeps its coaches, {first}. The people recruiting you are the ones who'd coach you.",
              "game_day": "Wait until you feel a Saturday here. The place is packed and loud.",
              "exposure": "We're on TV every week. Everybody back in {town} would see you play."};
scenes._G_LEAD_HONEST = {"facilities": "We don't have the newest building, but we've got everything you need to get better.",
               "location": "It's not for everybody, {first}, but our guys end up loving it here.",
               "stability": "We've had some changes, I won't hide that. I'm here to build this, and I want you in it.",
               "game_day": "We're still growing the crowd. Come give them a reason to pack it.",
               "exposure": "We're not on national TV every week yet. Play like I think you will and they'll find you."};
scenes._G_HONEST_HIT = {"facilities": ["Everything I need? Okay. That's fair, Coach.",
                             "Not the newest, but I'd get better there. I like that."],
              "location": ["Guys end up loving it? Okay. I could see that.",
                           "Not my first pick for a town, but I'd be okay there."],
              "stability": ["At least you're honest about it, Coach.",
                            "Okay. If you're staying, that's what matters."],
              "game_day": ["Give them a reason? I like that, Coach.",
                           "Okay. I could be the guy who fills it up."],
              "exposure": ["If I play good, they'll find me. I believe that.",
                           "Okay. I'll make them put me on TV."]};
scenes._G_SAID_HONEST = {"facilities": "everything you need to get better", "location": "a place our guys end up loving",
               "stability": "a staff building something together", "game_day": "a crowd you can help grow",
               "exposure": "a stage you can earn"};
// claim lines (by template) -> the truth key
scenes._G_NEEDS = {"That building is crazy, Coach. I could live in there.": "facilities",
         "That weight room? That's where I want to be.": "facilities",
         "Okay, the facilities are real. I see it.": "facilities",
         "That program doesn't run through coaches. That means something.": "stability",
         "Same staff the whole way? That's what I want.": "stability",
         "That crowd is loud. I've seen it on TV.": "game_day",
         "That's a real Saturday, Coach.": "game_day",
         "Prime time every week? Let's go.": "exposure",
         "Everybody back home could watch. That's big.": "exposure",
         "That's the stage, Coach. I want it.": "exposure",
         "That's my kind of place, Coach.": "location"};

Object.assign(scenes.PHRASES, scenes._G_PHRASES);
Object.assign(scenes.LINES, scenes._G_LINES);
Object.assign(scenes.LEAD_LINES, scenes._G_LEAD_LINES);
Object.assign(scenes.LEAD_HONEST, scenes._G_LEAD_HONEST);
Object.assign(scenes.HONEST_HIT, scenes._G_HONEST_HIT);
Object.assign(scenes.SAID_HONEST, scenes._G_SAID_HONEST);
Object.assign(scenes.NEEDS, scenes._G_NEEDS);
scenes.GRADE_TOPICS = Object.keys(scenes._G_PHRASES);   // the campus topics your lines may claim at CLAIM_FROM (truth)

export function facts(state, slug, week = null) {
  // What the game knows about the school, for the lines that claim something: this season's record
  // (w, l) and conference record (cw, cl), the last game (`last_won`, None before one) and the streak
  // (wins positive, losses negative), the poll rank (None unranked), last season's record (`last`), whether
  // the program has been winning for years (`history`), and the season's `form` in one word: before a game
  // "pre_up" or "pre_down" (last season), then "hot" (a winning record and the last game won), "winning",
  // "even" or "losing".
  const season = modules.season, programs = modules.programs, recruiting = modules.recruiting;
  week = week === null || week === undefined ? state["current_week"] : week;
  const rec = orr(get(season._records(state), slug), {});
  const w = get(rec, "wins", 0), l = get(rec, "losses", 0), cw = get(rec, "conf_wins", 0), cl = get(rec, "conf_losses", 0);
  const results = [];
  for (const g of sorted(Object.values(state["games"]), (g) => g["week"])) {
    if (truthy(get(g, "played")) && g["week"] <= week && (slug === g["home"] || slug === g["away"])) {
      const [mine, theirs] = g["home"] === slug ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
      results.push(mine > theirs);
    }
  }
  let streak = 0;
  for (const won of results.slice().reverse()) {
    if (streak && (won !== (streak > 0))) break;
    streak += won ? 1 : -1;
  }
  const polls = orr(get(state, "polls"), {});
  const out_weeks = [];
  for (const [k, v] of Object.entries(polls)) {
    if (/^[0-9]+$/.test(String(k).replace(/^-+/, "")) && Number(k) <= week && (truthy(get(v, "ap")) || truthy(get(v, "cfp")) || truthy(get(v, "cfp_full")))) {
      out_weeks.push(Number(k));
    }
  }
  const rank = out_weeks.length ? get(season.rank_map(state, Math.max(...out_weeks)), slug) : null;
  const ls = orr(get(recruiting._team_model(slug), "last_season"), {});
  const last = [get(ls, "wins", 0), get(ls, "losses", 0)];
  const history = Number(get(programs.get(state, slug), "winning", 0.0)) >= scenes.HISTORY_WINNING;
  let form;
  if (!(w + l)) {
    form = last[0] > last[1] ? "pre_up" : "pre_down";
  } else if (w > l) {
    form = results.length && results[results.length - 1] ? "hot" : "winning";
  } else {
    form = w === l ? "even" : "losing";
  }
  return { w, l, cw, cl, last_won: results.length ? results[results.length - 1] : null, streak,
    rank, last, history, form };
}


export function truth(state, slug, pid, week = null) {
  // Which topics your lines may claim to him: a strength of CLAIM_FROM or better (proximity, playing
  // time, prestige, NIL, academics, Pro Pipeline); Winning Now by the season's form (`facts`), "history" by the
  // program's last three seasons; The Head Coach unless the talk is that your job is not safe (his Hot
  // Seat twist about you). `form` and `facts` ride along.
  const persona = modules.persona, recruiting = modules.recruiting;
  const fx = scenes.facts(state, slug, week);
  const st_ = recruiting.strengths(state, slug, pid);
  const out = {};
  for (const t of ["proximity", "playing_time", "prestige", "nil", "academics", "pro", ...scenes.GRADE_TOPICS]) out[t] = st_[t] >= scenes.CLAIM_FROM;
  Object.assign(out, scenes.pro_truth(state, slug, pid, out["pro"]));
  const tw = persona._twist(state, pid);
  Object.assign(out, { winning: ["hot", "winning", "pre_up"].includes(fx["form"]), history: fx["history"],
    coach: !(truthy(tw) && tw["k"] === "hot_seat" && get(tw, "s") === slug), form: fx["form"], facts: fx });
  return out;
}


export function pro_truth(state, slug, pid, pro) {
  // The Pro Pipeline facts a line may need: `pro_any`, the school has a pick at his group in its ten drafts (a kicker, a
  // punter or any group without draft keys: any pick at all); `pro_spot`, the claim holds at his own spot (the strength for
  // most; a kicker or punter, his own group's grade at CLAIM_FROM, since his strength reads the overall grade).
  const programs = modules.programs, recruiting = modules.recruiting;
  const p = state["recruiting"]["prospects"][pid];
  const pr = programs.get(state, slug);
  const group = recruiting._group(p["ea_position"]);
  const keys = get(programs.GROUP_DRAFT, group);
  const lines = orr(get(pr, "drafts"), []);
  let any_ = false;
  if (truthy(keys)) {
    const among = keys instanceof Set ? (g) => keys.has(g) : (g) => keys.includes(g);
    search: for (const [, , gs] of lines) {
      for (const [g, pts] of Object.entries(gs)) {
        if (among(g) && pts > 0) { any_ = true; break search; }
      }
    }
  } else {
    any_ = lines.some(([, pts]) => pts > 0);
  }
  const spot = !["K", "P"].includes(group) ? pro : get(orr(get(pr, "pro_groups"), {}), group, 0) >= 100 * scenes.CLAIM_FROM;
  return { pro_any: any_, pro_spot: truthy(spot) };
}


export function _holds(line, tr) {
  // Whether a line's claims (NEEDS: one truth key, or several that must all hold) are true.
  const need = own(scenes.NEEDS, line) ? scenes.NEEDS[line] : null;
  if (!truthy(need)) return true;
  return (typeof need === "string" ? [need] : need).every((k) => (k.startsWith("!") ? !truthy(tr[k.slice(1)]) : truthy(tr[k])));
}


export function _win_key(tr) {
  // The honest Winning Now key for the season's form (None: the confident lines are true).
  const fx = tr["facts"];
  const form = tr["form"];
  if (form === "hot" || form === "pre_up") return null;
  if (form === "winning") return "winning";
  if (form === "even") return fx["cw"] > fx["cl"] ? "even_conf" : "even";
  if (form === "losing") return fx["cw"] > fx["cl"] ? "losing_conf" : truthy(tr["history"]) ? "losing_history" : "losing";
  return "pre_down";
}


export function lead_line(tr, pitch) {
  // Your lead-with as a template, true to the facts: the confident line when the topic holds, else its
  // honest one; Winning Now by the season's form (a ranked team on a roll says so).
  if (pitch === "winning") {
    const key = scenes._win_key(tr);
    if (key === null) {
      return tr["form"] === "hot" && truthy(tr["facts"]["rank"]) ? scenes.LEAD_WINNING["ranked"] : scenes.LEAD_LINES["winning"];
    }
    return scenes.LEAD_WINNING[key];
  }
  if (pitch === "pro") {
    return truthy(tr["pro"]) ? (truthy(get(tr, "pro_spot", true)) ? scenes.LEAD_LINES["pro"] : scenes.LEAD_PRO_PROGRAM)
      : truthy(get(tr, "pro_any")) ? scenes.LEAD_HONEST_PRO_SOME : scenes.LEAD_HONEST["pro"];
  }
  return truthy(tr[pitch]) ? scenes.LEAD_LINES[pitch] : scenes.LEAD_HONEST[pitch];
}


export function said_phrase(tr, topic) {
  // A topic in your opening's three things: its phrase when you can claim it, else the honest one.
  if (own(scenes.SAID_HONEST, topic) && !truthy(tr[topic])) return scenes.SAID_HONEST[topic];
  return scenes.PHRASES[topic];
}


export function true_line(tr, topic, kind, line, sid) {
  // His line for `topic` and `kind` (a template drawn as before), or, when its claim is false, one that
  // holds: a hit gets the honest hit (Winning Now: the skeptical one for the record), anything else another
  // line of its pool that holds. Its own seeded draw (`truth-{sid}`), so no other stream moves. Returns the
  // template and whether it was replaced.
  if (scenes._holds(line, tr)) return [line, false];
  const rng = new Random(`truth-${sid}-${topic}-${kind}`);
  let pool;
  if (kind === "hit") {
    if (topic === "winning") {
      const key = scenes._win_key(tr);
      if (key === null || key === "winning") {                    // the record wins: only "every year" can be false
        pool = scenes.LINES["winning"]["hit"].filter((x) => scenes._holds(x, tr));
      } else {
        const doubt = get(scenes.WIN_DOUBT, key);
        pool = truthy(doubt) ? doubt : scenes.WIN_DOUBT[key.split("_")[0]];
      }
    } else if (topic === "pro" && truthy(get(tr, "pro"))) {       // the claim holds for the program, not at his spot: a line that holds
      pool = scenes.LINES["pro"]["hit"].filter((x) => scenes._holds(x, tr));
    } else {
      pool = orr(get(scenes.HONEST_HIT, topic === "pro" && truthy(get(tr, "pro_any")) ? "pro_some" : topic), []);
    }
  } else {
    pool = scenes.LINES[topic][kind].filter((x) => scenes._holds(x, tr));
  }
  return pool.length ? [rng.choice(pool), true] : [line, false];
}

// he has a question (recruit questions): this turn introduces it
scenes.QUESTION_INTRO = "Can I ask you something?";

// an in-home visit opens with a plain note on who decides (a visit shows who decides): information, no scenery
scenes.DECIDER_NOTE = {"mom": "His mom has the final say.", "dad": "His dad has the final say.",
                "grandma": "His grandmother has the final say.", "hs_coach": "His high school coach has the final say.",
                "trainer": "His trainer has the final say.", "self": "{first} makes his own call."};

// his twist in his own words, while it is on (persona.TWISTS): "you" when the twist is about the school he is
// talking to, "other" when it is about another school ({rival}); a twist about no school has "him". {foe} is
// the opponent of the game he watches or wants won, {moved} his family's new town. No numbers, no phone words.
scenes.TWIST_LINES = {
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
    "late_offer": {"you": ["I didn't see your offer coming, Coach. It changes things for me.",
                           "Your offer caught everybody off guard. My phone hasn't stopped since.",
                           "Honestly, Coach, getting your offer now feels huge."],
                   "other": ["{rival} just offered me. I didn't see that coming.",
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
};

// how his commit style sounds, once the school knows it (persona.STYLES): his voice, no numbers
scenes.STYLE_LINES = {
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
};

// every table of lines (tests format each line with FIELDS)
Object.defineProperty(scenes, "TABLES", {
  enumerable: true, configurable: true,
  get() {
    const persona = modules.persona;
    const value = { "PERSONA_LINES": persona.LINES, "NO_TOPIC": persona.NO_TOPIC, "DECIDER_LINES": persona.DECIDER_LINES, "STORY_LINES": persona.STORY_LINES,
      "STORY_LINES_OFFERED": persona.STORY_LINES_OFFERED, "LINES": scenes.LINES, "TIRED": scenes.TIRED, "OPEN": scenes.OPEN, "VISIT_OPEN": scenes.VISIT_OPEN, "CONTEXT": scenes.CONTEXT, "PRESENT_SAID": scenes.PRESENT_SAID,
      "PRESENT_LINES": scenes.PRESENT_LINES, "ASK": scenes.ASK, "LEAD_LINES": scenes.LEAD_LINES, "LEAD_HONEST": scenes.LEAD_HONEST, "LEAD_WINNING": scenes.LEAD_WINNING,
      "WIN_DOUBT": scenes.WIN_DOUBT, "HONEST_HIT": scenes.HONEST_HIT, "DECIDER_NOTE": Object.values(scenes.DECIDER_NOTE), "TWIST_LINES": scenes.TWIST_LINES, "STYLE_LINES": scenes.STYLE_LINES };
    Object.defineProperty(scenes, "TABLES", { value, writable: true, enumerable: true, configurable: true });
    return value;
  },
  set(value) { Object.defineProperty(scenes, "TABLES", { value, writable: true, enumerable: true, configurable: true }); },
});
scenes.FIELDS = ["name", "first", "town", "state", "school", "position", "positions", "role", "record", "rec", "conf", "coach", "opponent", "result", "leader",
          "week_word", "a", "b", "x", "y", "z", "topic", "Topic", "legacy", "mate", "rival", "foe", "moved"];

scenes._ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
  + "sixteen seventeen eighteen nineteen").split(" ");
scenes._TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");


export function words(n) {
  // A whole number in words (0-999 in full; past that, the digits).
  if (n < 20) return scenes._ONES[n];
  if (n < 100) return scenes._TENS[floordiv(n, 10)] + (mod(n, 10) === 0 ? "" : "-" + scenes._ONES[mod(n, 10)]);
  if (n < 1000) return scenes._ONES[floordiv(n, 100)] + " hundred" + (mod(n, 100) === 0 ? "" : " " + scenes.words(mod(n, 100)));
  return pystr(n);
}


export function _role(state, slug, pid) {
  // by his place among the group's starters, not the pull's size: a second receiver starts
  return { "start": "start", "next": "compete", "depth": "wait" }[modules.recruiting.depth_place(state, slug, pid)];
}


export function _record(state, slug) {
  // The school's won-lost in words: this season's, or last season's before a game.
  const season = modules.season;
  const rec = orr(get(season._records(state), slug), {});
  let w = get(rec, "wins", 0), l = get(rec, "losses", 0);
  if (!(w + l)) {
    const ls = orr(get(modules.recruiting._team_model(slug), "last_season"), {});
    w = get(ls, "wins", 0); l = get(ls, "losses", 0);
  }
  if (!(w + l)) return "No record yet";
  return capitalize(`${scenes.words(w)} and ${scenes.words(l)}`);
}


export function _conf(state, slug) {
  // The school's conference record this season in words ("two and one"); "no conference games yet" before one.
  const season = modules.season;
  const rec = orr(get(season._records(state), slug), {});
  const w = get(rec, "conf_wins", 0), l = get(rec, "conf_losses", 0);
  return (w + l) ? `${scenes.words(w)} and ${scenes.words(l)}` : "no conference games yet";
}


export function coach_name(state, slug) {
  // Your last name: the created coach's, else the team's head coach's, else the school's name.
  const season = modules.season;
  const car = orr(get(orr(get(state, "career"), {}), "coach"), {});
  const name = get(car, "name") || get(get(orr(get(orr(get(season.load_teams(), slug), {}), "coaches"), {}), "head_coach", {}), "name") || "";
  return name.trim() ? split(name).at(-1) : get(orr(get(season.load_teams(), slug), {}), "name", slug);
}


export function last_game(state, slug, week) {
  // The school's most recent played game as of `week`: {"opponent", "won", "week"}; None before the first.
  const season = modules.season;
  const teams = season.load_teams();
  let best = null;
  for (const g of Object.values(state["games"])) {
    if (!truthy(get(g, "played")) || g["week"] > week || !(slug === g["home"] || slug === g["away"])) continue;
    if (best === null || g["week"] > best["week"]) {
      const opp = g["home"] === slug ? g["away"] : g["home"];
      const [mine, theirs] = g["home"] === slug ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
      best = { opponent: season.team_display(opp, teams), won: mine > theirs, week: g["week"] };
    }
  }
  return best;
}


export function next_game(state, slug, week) {
  // The school's next unplayed game: {"opponent", "week"}; None when the season is over.
  const season = modules.season;
  const teams = season.load_teams();
  let best = null;
  for (const g of Object.values(state["games"])) {
    if (truthy(get(g, "played")) || g["week"] < week || !(slug === g["home"] || slug === g["away"])) continue;
    if (best === null || g["week"] < best["week"]) {
      const opp = g["home"] === slug ? g["away"] : g["home"];
      best = { opponent: season.team_display(opp, teams), week: g["week"] };
    }
  }
  return best;
}


export function leader_of(state, slug, pid) {
  // The school leading his list as the board knows it (the week step's ranks), its name; "" when
  // there is none yet or it is you.
  const season = modules.season;
  const now = orr(get(orr(get(orr(get(state["recruiting"], "ranks"), {}), pid), {}), "now"), {});
  let lead = null;
  for (const [s, rk] of Object.entries(now)) {
    if (rk === 1) { lead = s; break; }
  }
  if (!truthy(lead) || lead === slug) return "";
  return get(orr(get(season.load_teams(), lead), {}), "name", lead);
}

scenes.SINGULAR = {"QB": "quarterback", "RB": "running back", "WR": "receiver", "TE": "tight end", "OT": "tackle", "IOL": "guard", "EDGE": "edge rusher",
            "DL": "defensive lineman", "LB": "linebacker", "CB": "corner", "S": "safety", "K": "kicker", "P": "punter", "ATH": "athlete"};
scenes.PLURAL = {"QB": "quarterbacks", "RB": "backs", "WR": "receivers", "TE": "tight ends", "OT": "tackles", "IOL": "interior linemen", "EDGE": "edge rushers",
          "DL": "defensive linemen", "LB": "linebackers", "CB": "corners", "S": "safeties", "K": "kickers", "P": "punters", "ATH": "athletes"};


scenes.STATE_NAMES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
               "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
               "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
               "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
               "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
               "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
               "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin",
               "WY": "Wyoming", "DC": "Washington, D.C."};

export function _fields(state, slug, p, week = null) {
  const season = modules.season, persona = modules.persona;
  const team = orr(get(season.load_teams(), slug), {});
  week = week === null || week === undefined ? state["current_week"] : week;
  const game = scenes.last_game(state, slug, week), nxt = scenes.next_game(state, slug, week);
  const record = scenes._record(state, slug);
  // a transfer has no town on file: his home state by name ("Sunday dinners in Texas", never "in TX")
  const town = p["hometown"]["city"] || get(scenes.STATE_NAMES, p["hometown"]["state"], p["hometown"]["state"]) || "home";
  return {
    name: p["name"], first: split(p["name"])[0], town,
    // spoken, so by name: "the best linebacker in Florida", never "the best LB in FL"
    state: get(scenes.STATE_NAMES, p["hometown"]["state"], p["hometown"]["state"]), school: get(team, "name", slug),
    position: get(scenes.SINGULAR, p["position"], p["position"]), positions: get(scenes.PLURAL, p["position"], "players"),
    role: scenes._role(state, slug, p["id"]), record, rec: record.slice(0, 1).toLowerCase() + record.slice(1), conf: scenes._conf(state, slug),
    coach: scenes.coach_name(state, slug),
    opponent: game ? game["opponent"] : nxt ? nxt["opponent"] : "", result: game ? (game["won"] ? "beat" : "lost to") : "",
    leader: scenes.leader_of(state, slug, p["id"]),
    week_word: scenes.words(Math.max(0, week - 1)),                   // the calendar's week (Week 0 opens the season)
    ...persona.story_fields(state, p["id"]), ...persona.twist_fields(state, p["id"]),
  };
}


export function _turn(who, text) {
  return { who, text };
}


export function _persona_line(state, pid, scene_id, key, f, always = false, salt = "", pool = []) {
  // His personality's own line for `key` (open, small_talk, hit, quiet), PERSONA_LINE of the time (always
  // when `always`); its own seeded draw, keyed on the scene, so no other stream moves. None: use the generic.
  const persona = modules.persona;
  const rng = new Random(`persona-line-${scene_id}-${salt}${key}`);
  const own_ = persona.LINES[persona.of(state, pid)["personality"]];
  const from = [];
  for (const k of (pool.length ? pool : [key])) for (const x of own_[k]) from.push(x);
  const line = format(rng.choice(from), f);
  return always || rng.random() < scenes.PERSONA_LINE ? line : null;
}


export function _no_tell_line(state, pid, key, f, avoid = null) {
  // What he says to a pitch on a call that keeps his priority to himself, when it was none of his
  // (his NO_TOPIC lines, never the cue's own): a line that names no topic and shows no tone. Its own draw.
  const persona = modules.persona;
  const mine = get(persona.NO_TOPIC, persona.of(state, pid)["personality"]);
  const lines = (truthy(mine) ? mine : persona.NO_TOPIC["guarded"]).map((x) => format(x, f));
  const others = lines.filter((x) => x !== avoid);
  return new Random(`persona-line-${key}-guarded`).choice(others.length ? others : lines);
}


export function tells(state, slug, pid, action) {
  // Whether this scene may name one of his priorities: every visit does; a call does unless he keeps
  // it to himself (a Guarded recruit, a Shy one's first call).
  if (modules.clear.on()) {                        // Clear Mode: every answer is a plain Yes or No
    return true;
  }
  return action !== "call" || modules.persona.call_reveals(state, slug, pid, false);
}


export function last_talk(state, slug, pid, week) {
  // The week of your last contact with him before this one (his History's contacts and pitches), or None.
  const weeks = state["recruiting"]["log"].filter((e) => e["pid"] === pid && get(e, "school") === slug
    && (e["kind"] === "contact" || e["kind"] === "pitch") && e["week"] < week).map((e) => e["week"]);
  return weeks.length ? Math.max(...weeks) : null;
}


export function context_line(state, slug, pid, week, f, rng, tired) {
  // His small talk, from what is true: your last game (first, when it was this past Saturday), the
  // school leading his list, his own week; the opener before your first game; tired when the call pesters him.
  if (tired) return format(rng.choice(scenes.CONTEXT["tired"]), f);
  const game = scenes.last_game(state, slug, week);
  const named = truthy(f["opponent"]) && !f["opponent"].startsWith("FCS ");    // an FCS stand-in has no name he would say
  const recent = truthy(game) && game["week"] >= week - 1;
  const kinds = [];
  if (game && recent && named) kinds.push("game");
  else if (!game && named) kinds.push("opener");
  if (truthy(f["leader"])) kinds.unshift("leader");
  kinds.push("own");
  let kind = recent && named ? "game" : rng.choice(kinds);
  if (kind === "game") kind = rng.choice(["game", game["won"] ? "won" : "lost"]);
  return format(rng.choice(scenes.CONTEXT[kind]), f);
}


export function twist_line(state, slug, pid, sid, f, always = false) {
  // His twist in his words while it is on (its own seeded draw `twist-line-{sid}`): on a call
  // persona.TWIST_CALL_LINE of the time, at a visit always; a Wants to See You Beat X only to the school he told.
  const persona = modules.persona;
  const tw = persona._twist(state, pid);
  if (!truthy(tw) || (tw["k"] === "beat" && tw["s"] !== slug)) return null;
  const table = scenes.TWIST_LINES[tw["k"]];
  const key = own(table, "him") ? "him" : get(tw, "s") === slug ? "you" : "other";
  if (!own(table, key)) return null;
  const rng = new Random(`twist-line-${sid}`);
  const line = rng.choice(table[key]);
  if (!always && rng.random() >= persona.TWIST_CALL_LINE) return null;
  return format(line, f);
}


export function style_line(state, slug, pid, sid, f) {
  // How he means to commit, in his words, once the school knows his commit style: persona.STYLE_CALL_LINE
  // of the calls (its own seeded draw `style-line-{sid}`); never for All Business (no small talk).
  const persona = modules.persona;
  const k = persona.style(state, pid);
  if (!truthy(k) || !truthy(persona.known(state, slug, pid)["style"]) || persona.of(state, pid)["personality"] === "business") return null;
  if (truthy(get(orr(get(state["recruiting"]["status"], pid), {}), "committed"))) {    // he has picked: no "I'm not deciding until signing day"
    return null;
  }
  const rng = new Random(`style-line-${sid}`);
  const line = rng.choice(scenes.STYLE_LINES[k]);
  return rng.random() < persona.STYLE_CALL_LINE ? format(line, f) : null;
}


export function heard_rival_due(state, slug, pid) {
  // He heard you promised his job to someone else (recruiting._strain) in an earlier week (the portal's own week in the
  // portal) and has not said so yet: your school's scene opens with HEARD_RIVAL.
  const c = orr(get(orr(get(state["recruiting"]["contacts"], pid), {}), slug), {});
  let stamp = get(c, "heard_rival");
  if (slug !== get(state, "team") || stamp === null) return false;
  stamp = Array.isArray(stamp) ? Array.from(stamp) : [stamp, 0];
  return cmp(stamp, modules.recruiting.rival_stamp(state)) < 0;
}


export function open_scene(state, slug, pid, action, week) {
  // A call's or in-home visit's scene as it opens: the room (a visit), your opener and his small
  // talk. The cue and his question wait on your opening (`present`); his ask is as you know it.
  const persona = modules.persona, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const rng = new Random(`open-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`);
  const f = scenes._fields(state, slug, p, week);
  const tired = recruiting.would_pester(state, slug, pid);
  if (modules.clear.on()) return scenes._open_clear(state, slug, pid, action, week, f, tired);
  if (truthy(get(rc, "portal")) && truthy(get(p, "portal"))) return scenes._open_portal(state, slug, pid, action, week, f, tired);
  const turns = [];
  if (action === "hc_visit") {
    turns.push(scenes._turn("note", format(scenes.DECIDER_NOTE[persona.of(state, pid)["decider"]], f)));
    turns.push(scenes._turn("you", format(rng.choice(scenes.VISIT_OPEN), f)));
  } else {
    const prev = scenes.last_talk(state, slug, pid, week);
    const table = prev === null ? scenes.OPEN["first"] : prev === week - 1 ? scenes.OPEN["last_week"] : scenes.OPEN["again"];
    turns.push(scenes._turn("you", format(rng.choice(table), f)));
  }
  const sid = `${action}-${pid}-${pystr(week)}`;
  const context = scenes.context_line(state, slug, pid, week, f, rng, tired);     // always drawn: the seeded rng moves the same for every personality
  const d = persona.of(state, pid);
  const game = scenes.last_game(state, slug, week);
  let said;
  if (tired || (game && game["week"] >= week - 1)) {                // a game this past Saturday is news he always brings up (a deliberate exception: All Business too)
    said = context;
  } else if (d["personality"] === "business") {                     // no small talk: he gets to it
    said = scenes._persona_line(state, pid, sid, action === "hc_visit" ? "visit_open" : "open", f, true);
  } else {
    said = scenes._persona_line(state, pid, sid, action === "hc_visit" ? "visit_open" : "open", f, false, "",
      [action === "hc_visit" ? "visit_open" : "open", "small_talk"]) || context;
  }
  let story = null;                                                 // his story's line, when it is said (a Package Deal's brings his question)
  if (action === "call" && !tired && !(game && game["week"] >= week - 1)) {    // his story, once you know it (a Package Deal's first call: always)
    const first = !truthy(get(orr(get(orr(get(rc["contacts"], pid), {}), slug), {}), "calls"));
    const news = scenes.twist_line(state, slug, pid, sid, f);
    story = truthy(news) ? null : persona.story_line(state, slug, pid, sid, "him", f, action, first);
    said = news || story || scenes.style_line(state, slug, pid, sid, f) || said;      // what happened to him first, then his story, then how he means to commit
  }
  const contact = orr(get(orr(get(rc["contacts"], pid), {}), slug), {});
  if (scenes.heard_rival_due(state, slug, pid)) {
    said = scenes.HEARD_RIVAL;                                      // he heard you promised his job again: he says so, once
    delete contact["heard_rival"];
  }
  turns.push(scenes._turn("him", said));
  if (action === "hc_visit") {                                      // in his living room what happened to him always comes up
    const news = scenes.twist_line(state, slug, pid, sid, f, true);
    if (truthy(news)) turns.push(scenes._turn("him", news));
  }
  let told = null;                                                  // his story at a visit: the decider brings it up, or he does
  if (action === "hc_visit" && d["decider"] !== "self") {           // the one who decides speaks
    story = persona.story_line(state, slug, pid, sid, "family", f, action);
    const fam = story || format(new Random(`persona-line-${sid}-family`).choice(persona.DECIDER_LINES[d["decider"]]), f);
    told = fam;
    turns.push({ who: "family", label: persona.DECIDER_LABEL[d["decider"]], text: fam });
    persona.learn(state, slug, pid, "decider");                     // the family is in the room: you see who decides
  } else if (action === "hc_visit") {
    persona.learn(state, slug, pid, "decider");                     // the note said he decides himself
    told = story = persona.story_line(state, slug, pid, sid, "him", f, action);
    if (truthy(told)) turns.push(scenes._turn("him", told));
  }
  if (action === "hc_visit" && truthy(persona.story(state, pid)[0]) && truthy(told)) {
    persona.learn(state, slug, pid, "story");                       // it came up in his living room: now you know
  }
  const sc = { id: sid, action, week, turns, lines: [],
    cue: null, ask: recruiting.ask_view(state, slug, pid), question: null, presented: null, tired,
    package: truthy(story) ? scenes.package_about(state, slug, pid) : null };      // his mate was brought up: the question after your opening
  scenes._lines(sc);
  return sc;
}


export function _open_portal(state, slug, pid, action, week, f, tired) {
  // A transfer's call or head coach visit: you open on his portal entry (no living room, no game last Saturday:
  // the season is over), he says why he left his last school, and at a visit the one who decides speaks. Its own
  // seeded draws (`portal-open-{sid}`, `portal-line-{sid}`); the high school scenes' draws never move.
  const persona = modules.persona, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  f = { ...f, ...scenes.portal_fields(state, p) };
  const sid = `${action}-${pid}-${pystr(week)}`;                    // the scene's id, as every scene's (the season's week)
  const pw = `${sid}-${pystr(get(rc, "week", 0))}`;                 // the portal's own week varies the draws
  const rng = new Random(`portal-open-${pystr(rc["seed"])}-${pw}`);
  const turns = [];
  const d = persona.of(state, pid);
  if (action === "hc_visit") {
    turns.push(scenes._turn("note", format(scenes.DECIDER_NOTE[d["decider"]], f)));
    turns.push(scenes._turn("you", format(rng.choice(scenes.PORTAL_VISIT_OPEN), f)));
  } else {
    const talked = truthy(get(orr(get(orr(get(rc["contacts"], pid), {}), slug), {}), "calls"));
    turns.push(scenes._turn("you", format(rng.choice(talked ? scenes.PORTAL_AGAIN : scenes.PORTAL_OPEN), f)));
  }
  let said = tired ? format(new Random(`portal-line-${pw}-tired`).choice(scenes.CONTEXT["tired"]), f) : scenes.portal_line(state, p, pw, f);
  const contact = orr(get(orr(get(rc["contacts"], pid), {}), slug), {});
  if (scenes.heard_rival_due(state, slug, pid)) {
    said = scenes.HEARD_RIVAL;
    delete contact["heard_rival"];
  }
  turns.push(scenes._turn("him", said));
  if (action === "hc_visit") {
    if (d["decider"] !== "self") {
      const theirs = get(scenes.PORTAL_DECIDER_LINES, d["decider"]);
      const fam = format(new Random(`portal-line-${pw}-family`).choice(truthy(theirs) ? theirs : persona.DECIDER_LINES[d["decider"]]), f);
      turns.push({ who: "family", label: persona.DECIDER_LABEL[d["decider"]], text: fam });
    }
    persona.learn(state, slug, pid, "decider");
  }
  const sc = { id: sid, action, week, turns, lines: [],
    cue: null, ask: recruiting.ask_view(state, slug, pid), question: null, presented: null, tired, package: null };
  scenes._lines(sc);
  return sc;
}

// ----- Clear Mode (coach_career/clear.py): transactional scenes. A plain note opens it; your opening gets a Yes (one of
// his priorities) or No per topic; your lead-with a Yes or No. No small talk, no cue to read between the lines. The
// points, the question and the visit's NIL note are the same as ever.

export function _open_clear(state, slug, pid, action, week, f, tired) {
  const persona = modules.persona, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const d = persona.of(state, pid);
  const sid = `${action}-${pid}-${pystr(week)}`;
  const turns = [scenes._turn("note", `${action === "hc_visit" ? "In-home visit" : "Call"} with ${pystr(f["name"])}.`)];
  if (action === "hc_visit") {
    turns.push(scenes._turn("note", `Decides: ${pystr(persona.DECIDER_LABEL[d["decider"]])}.`));
    persona.learn(state, slug, pid, "decider");
  }
  if (tired) turns.push(scenes._turn("note", "He is tired of your contact this week: no answers until he has a break."));
  const contact = orr(get(orr(get(rc["contacts"], pid), {}), slug), {});
  if (scenes.heard_rival_due(state, slug, pid)) {
    turns.push(scenes._turn("note", "He heard you promised the job to another player at his position."));
    delete contact["heard_rival"];
  }
  let package_ = null;
  const [k] = persona.story(state, pid);
  if (k === "package" && (action === "hc_visit" || !truthy(get(orr(get(orr(get(rc["contacts"], pid), {}), slug), {}), "calls")))) {
    // a Package Deal says so plainly, at a visit or on the first call: his question about his mate follows your opening
    turns.push(scenes._turn("note", `Package Deal: he wants ${pystr(get(f, "mate") || "his teammate")} to come too.`));
    package_ = scenes.package_about(state, slug, pid);
    if (action === "hc_visit") persona.learn(state, slug, pid, "story");
  }
  const sc = { id: sid, action, week, turns, lines: [],
    cue: null, ask: recruiting.ask_view(state, slug, pid), question: null, presented: null, tired, package: package_ };
  scenes._lines(sc);
  return sc;
}


export function _present_clear(state, slug, pid, sc, topics, hits, tired) {
  // `hits`: every presented topic that is one of his priorities, strong or weak (each a Yes).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const names = topics.map((t) => get(scenes._TOPIC_NAME, t, t));
  sc["turns"].push(scenes._turn("you", `You pitched: ${names[0]}, ${names[1]} and ${names[2]}.`));
  let kind, answer;
  if (tired) {
    kind = "tired";
    answer = "No answer: he is tired of your contact this week.";
    sc["turns"].push(scenes._turn("him", answer));
  } else {
    const st_ = recruiting.strengths(state, slug, pid);
    // the best of his that you pitched decides it: lit up on a strong case, listening on a fair one, quiet on a weak one
    kind = hits.length ? scenes.case_kind(Math.max(...hits.map((t) => st_[t]))) : "polite";
    answer = topics.map((t) => `${get(scenes._TOPIC_NAME, t, t)}: ${hits.includes(t) ? "Yes" : "No"}`).join(" · ");
    sc["turns"].push(scenes._turn("him", answer));
    if (hits.length) {                             // your program's grade on each Yes: where you stand on what he wants
      sc["turns"].push(scenes._turn("note", "Your case on his: " + hits.map((t) => `${get(scenes._TOPIC_NAME, t, t)} ${scenes._case_word(st_[t])}`).join(", ") + "."));
    }
    if (!own(rc["revealed"], slug)) rc["revealed"][slug] = {};
    if (!own(rc["revealed"][slug], pid)) rc["revealed"][slug][pid] = [];
    const seen = rc["revealed"][slug][pid];
    for (const t of hits) {                        // a Yes is one of his priorities, and now you know it
      if (rc["prospects"][pid]["priorities"].includes(t) && !seen.includes(t)) seen.push(t);
    }
  }
  sc["cue"] = { topics: [], text: answer };        // his answer is the line the conversation turns on (the page marks it)
  if (sc["action"] === "hc_visit") sc["turns"].push(scenes._turn("note", scenes.ask_note(state, slug, pid, sc["ask"])));
  sc["question"] = scenes.question(state, slug, pid, sc["week"], get(sc, "package"));
  if (truthy(sc["question"])) sc["turns"].push(scenes._turn("note", "He has a question."));
  sc["presented"] = Array.from(topics);
  sc["present"] = { kind, hit: Array.from(hits) };
  scenes._lines(sc);
  return kind;
}


export function _reaction_clear(state, slug, pid, pitch, tired) {
  const persona = modules.persona, recruiting = modules.recruiting;
  const name = get(scenes._TOPIC_NAME, pitch, pitch);
  const you = `You led with ${pystr(name)}.`;
  if (tired) return { kind: "tired", text: "No answer: he is tired of your contact this week.", you };
  let kind, text;
  if (persona.counts_as_priority(state, pid, pitch)) {
    kind = scenes.case_kind(recruiting.strengths(state, slug, pid)[pitch]);
    text = `${pystr(name)}: Yes, one of his priorities. Your case there: ${scenes._case_word(recruiting.strengths(state, slug, pid)[pitch])}.`;
  } else {
    kind = "polite"; text = `${pystr(name)}: No, not one of his priorities.`;
  }
  return { kind, text, you };
}


export function case_kind(sv) {
  // How he takes a pitch on one of his priorities, by your case there: "hit" (he lights up: strong), "fair" (he is
  // listening: fair) or "quiet" (he goes quiet: weak). The same cuts as the page's Strong, Fair and Weak.
  const recruiting = modules.recruiting;
  return sv >= recruiting.STRONG_CASE ? "hit" : sv < recruiting.BACKFIRE ? "quiet" : "fair";
}

// he cares about it and your case is fair: neither lit up nor gone quiet
scenes.FAIR_LINES = ["{Topic}. Okay. I'm listening, Coach.",
              "{Topic}. That's one I care about. Show me more of it.",
              "That's one of my things. I'd want to see it for myself."];

export function _case_word(sv) {
  // Your program's case on a topic in a word, as the page says it (web/recruiting.js caseWord).
  return sv >= 0.6 ? "Strong" : sv < 0.25 ? "Weak" : "Fair";
}

// the topics' names as the page shows them (web/recruiting.js PITCH_NAMES)
scenes._TOPIC_NAME = {"proximity": "Close to Home", "playing_time": "Playing Time", "prestige": "Program Prestige", "winning": "Winning Now",
               "nil": "NIL", "coach": "The Head Coach", "academics": "Academics", "pro": "Path to the League", "facilities": "Facilities",
               "location": "Location", "stability": "Stability", "game_day": "Game Day", "exposure": "Exposure"};

export function _lines(sc) {
  sc["lines"] = sc["turns"].filter((t) => t["who"] === "him").map((t) => t["text"]);
}


export function cue(state, slug, pid, week, f, tells = true) {
  // The cue: one priority you have not heard (or two topics, one his and one not, CUE_TWO_SIDED
  // of the time), as a complete answer in his voice. When the call keeps it to himself (`tells` False),
  // a line that names no topic and an empty `topics`.
  const persona = modules.persona, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  if (!tells) {
    const mine = get(persona.NO_TOPIC, persona.of(state, pid)["personality"]);
    const lines = truthy(mine) ? mine : persona.NO_TOPIC["guarded"];
    return { topics: [], text: format(new Random(`persona-line-call-${pid}-${pystr(week)}-cue`).choice(lines), f) };
  }
  const known = orr(get(orr(get(rc["revealed"], slug), {}), pid), []).filter((t) => p["priorities"].includes(t));
  const rng = new Random(`cue-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`);
  if (known.length >= p["priorities"].length) {    // you've heard all three: he sums them up, nothing new to hint
    const [a, b, c] = p["priorities"].slice(0, 3).map((t) => scenes.PHRASES[t]);
    return { topics: [], text: format(scenes.ALL_KNOWN, { a, b, c }) };
  }
  const true_ = p["priorities"].find((t) => !known.includes(t));
  const contact = orr(get(orr(get(rc["contacts"], pid), {}), slug), {});
  const trusted = get(rc["offers"], slug, []).includes(pid) || get(contact, "n", 0) >= scenes.CUE_TRUST_CONTACTS;   // straight with you: no decoy
  let topics, text;
  if (rng.random() < scenes.CUE_TWO_SIDED && !trusted) {
    const decoy = rng.choice(Array.from(recruiting.PITCHES).filter((t) => !p["priorities"].includes(t)));
    topics = rng.random() < 0.5 ? [true_, decoy] : [decoy, true_];
    text = format(rng.choice(scenes.LINES["_two_sided"]["cue"]), { a: scenes.PHRASES[topics[0]], b: scenes.PHRASES[topics[1]], ...f });
  } else {
    topics = [true_];
    text = format(rng.choice(scenes.LINES[true_]["cue"]), f);
  }
  if (known.length) {                              // what you already know first, then the new part
    const lead = format(new Random(`cue-known-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`).choice(scenes.KNOWN_LEADS), { k: scenes.PHRASES[known[0]] });
    text = `${lead} ${text.replace(/^Honestly, Coach[?,] /, "Past that? ")}`;
  }
  return { topics, text };
}


export function present(state, slug, pid, sc, topics, hits, back, tired) {
  // Your opening lands on the scene: your turn (the three things), his reaction (a hit names the
  // priority you are strongest on; a weak one gets its quiet line; none, polite), your question, his
  // cue, his question's intro when he has one, and on a visit his dad's ask. Returns the reaction's kind:
  // on a call that keeps his priority to himself, "guarded" (unless tired), whatever he thought of it.
  const recruiting = modules.recruiting;
  if (modules.clear.on()) {
    return scenes._present_clear(state, slug, pid, sc, topics, [...hits, ...back.filter((t) => !hits.includes(t))], tired);
  }
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const week = sc["week"];
  const rng = new Random(`present-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`);
  const f = scenes._fields(state, slug, p, week);
  const tr = scenes.truth(state, slug, pid, week);
  const [x, y, z] = topics.map((t) => scenes.said_phrase(tr, t));  // a strength you lack is said honestly
  sc["turns"].push(scenes._turn("you", format(rng.choice(scenes.PRESENT_SAID), { x, y, z, ...f })));
  const tells_ = scenes.tells(state, slug, pid, sc["action"]);
  const c = scenes.cue(state, slug, pid, week, f, tells_);         // its own draw: asked first so the reaction never repeats it
  let kind, text;
  if (tired) {
    kind = "tired"; text = format(rng.choice(scenes.PRESENT_LINES["tired"]), f);
  } else if (hits.length) {
    const st_ = recruiting.strengths(state, slug, pid);
    const best = maxBy(hits, (t) => st_[t]);
    const phrase = scenes.said_phrase(tr, best);                    // he echoes what you said
    kind = "hit"; text = format(rng.choice(scenes.PRESENT_LINES["hit"]), { topic: phrase, Topic: phrase[0].toUpperCase() + phrase.slice(1), ...f });
    const fair = st_[best] < recruiting.STRONG_CASE;                // his, and your case is fair: he is listening, not lit up
    const mine = scenes._persona_line(state, pid, sc["id"], "hit", f, !tells_);     // a call that tells nothing names no topic
    if (truthy(mine)) {                                             // his tone, still naming which of your three landed
      text = tells_ ? `${phrase[0].toUpperCase()}${phrase.slice(1)}? ${mine}` : mine;
    }
    if (fair) {
      kind = "fair";
      if (tells_) {                                                 // he names what he cares about, and no more than that
        text = format(scenes.FAIR_LINES[mod(ordsum(sc["id"]), scenes.FAIR_LINES.length)], { Topic: phrase[0].toUpperCase() + phrase.slice(1), ...f });
      }
    }
  } else if (back.length) {
    kind = "quiet"; text = format(scenes.true_line(tr, back[0], "quiet", rng.choice(scenes.LINES[back[0]]["quiet"]), `${sc["id"]}-present`)[0], f);
    text = scenes._persona_line(state, pid, sc["id"], "quiet", f, !tells_) || text;
  } else {
    kind = "polite"; text = format(rng.choice(scenes.PRESENT_LINES["polite"]), f);
    if (!tells_) {                                                  // a generic polite line would say none were his
      text = scenes._no_tell_line(state, pid, `${sc["id"]}-present`, f, c["text"]);
    }
  }
  if (!tells_ && kind !== "tired") kind = "guarded";
  sc["turns"].push(scenes._turn("him", text));
  if (get(orr(get(state["recruiting"]["status"], pid), {}), "committed") === slug) {      // your own commit (the player's call)
    const at = mod(ordsum(sc["id"]), scenes.ASK_COMMITTED.length);
    sc["turns"].push(scenes._turn("you", format(scenes.ASK_COMMITTED[at], f)));
    sc["turns"].push(scenes._turn("him", format(scenes.CUE_COMMITTED[at], f)));
  } else {
    sc["turns"].push(scenes._turn("you", format(rng.choice(scenes.ASK[c["topics"].length > 1 ? "two" : "one"]), f)));
    sc["turns"].push(scenes._turn("him", c["text"]));
  }
  sc["cue"] = c;
  if (sc["action"] === "hc_visit") sc["turns"].push(scenes._turn("note", scenes.ask_note(state, slug, pid, sc["ask"])));
  sc["question"] = scenes.question(state, slug, pid, week, get(sc, "package"));
  if (truthy(sc["question"])) sc["turns"].push(scenes._turn("him", scenes.QUESTION_INTRO));
  sc["presented"] = Array.from(topics);
  sc["present"] = { kind, hit: tells_ ? Array.from(hits) : [] };    // a call that tells nothing hides which were his
  scenes._lines(sc);
  return kind;
}

scenes.ASK_WHO = {"mom": "His mom", "dad": "His dad", "grandma": "His grandmother", "hs_coach": "His high school coach", "trainer": "His trainer", "self": "He"};

export function ask_note(state, slug, pid, ask) {
  // The visit's note on his family's NIL ask, in the game's NIL words and numerals: the ask the profile's
  // His Ask shows (the number after a visit, the middle of the range before) and where you stand: the NIL
  // you have left (and what your offer already holds on him), or that the ask is more than you can put up.
  const persona = modules.persona, recruiting = modules.recruiting;
  let n = get(ask, "exact");
  if (n === null && truthy(get(ask, "hi"))) n = recruiting._five((ask["lo"] + ask["hi"]) / 2);
  const d = persona.of(state, pid)["decider"];                      // the one who decides speaks to the money (never "his dad" for a trainer)
  const who = get(scenes.ASK_WHO, d, scenes.ASK_WHO["dad"]);
  const they = d === "self" ? "he's" : "they're";
  if (!truthy(n)) return `${who} says the money isn't the point.`;
  const rec = get(state["recruiting"]["nil"], slug);
  const left = truthy(rec) ? recruiting.nil_left(state, slug)       // read only: never opens the school's NIL record here
    : recruiting.is_portal(state) ? recruiting.portal_budget(state, slug) : recruiting.nil_budget(state, slug);
  const held = get(orr(get(orr(rec, {}), "held"), {}), pid, 0);
  const room = left + held;                                         // an offer to him can hold up to this (recruiting.act)
  const about = get(ask, "exact") !== null ? "" : "about ";
  if (n > room) return `${who} wants ${about}${pystr(n)} in NIL, more than you have left (${pystr(room)}).`;
  if (truthy(held)) return `${who} wants to know about NIL: ${they} looking for ${about}${pystr(n)}. Your offer holds ${pystr(held)}, and you have ${pystr(left)} NIL left.`;
  return `${who} wants to know about NIL: ${they} looking for ${about}${pystr(n)}. You have ${pystr(left)} NIL left.`;
}


export function package_about(state, slug, pid) {
  // A Package Deal's mate as the scene keeps him for the question: {pid, name, offered} when he is a
  // prospect in the class still to be had (not signed), else None.
  const rc = state["recruiting"];
  const m = modules.persona.mate(state, pid);
  const st = truthy(m) ? orr(get(rc["status"], m), {}) : {};
  if (!truthy(m) || !own(rc["prospects"], m) || truthy(get(st, "signed")) || !(get(st, "committed") === null || get(st, "committed") === slug)) return null;
  return { pid: m, name: rc["prospects"][m]["name"], offered: get(rc["offers"], slug, []).includes(m) };
}


export function package_answers(about) {
  // The Package Deal question's three answers, filled: {answer: {label, text}}.
  const table = scenes.PACKAGE_ANSWERS[truthy(get(about, "offered"))];
  const out = {};
  for (const [k, [label, text]] of Object.entries(table)) out[k] = { label, text: format(text, { mate: about["name"] }) };
  return out;
}


export function question(state, slug, pid, week, package_ = null) {
  // His question about a named player, QUESTION_RATE of the time when playing time is one of his
  // priorities (its own RNG: no other draw moves): the best returning player at his group on your
  // roster rated at least as high ("roster"), else the highest-ranked other recruit you offered at
  // his group who is uncommitted or yours ("recruit"); neither, no question. A scene where his
  // Package Deal came up (`package`, scenes.package_about) asks about his mate instead ("package":
  // always, its own draw for the line; the answers ride on the question, by whether you offered him).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  if (truthy(package_) && orr(get(orr(get(orr(get(rc["contacts"], pid), {}), slug), {}), "promises"), []).some((pr) => pr["kind"] === "package"
    && get(orr(get(pr, "about"), {}), "pid") === package_["pid"] && !truthy(get(pr, "broken")) && get(pr, "closed") === null)) {
    package_ = null;                     // you already promised his mate an offer (open or kept): he does not ask again
  }
  if (truthy(package_)) {
    const about = { ...package_, offered: get(rc["offers"], slug, []).includes(package_["pid"]) };   // as it stands when he asks
    const rng = new Random(`question-package-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`);
    const text = format(rng.choice(scenes.QUESTION_LINES[about["offered"] ? "package_offered" : "package"]), { mate: about["name"] });
    return { kind: "package", text, answer: null, reply: null, about, answers: scenes.package_answers(about) };
  }
  if (!p["priorities"].includes("playing_time")) return null;
  if (truthy(recruiting._open_roster_promise(orr(get(orr(get(rc["contacts"], pid), {}), slug), {})))) {
    return null;                                                    // you already promised him the job: nothing to ask
  }
  const rng = new Random(`question-${pystr(rc["seed"])}-${slug}-${pid}-${pystr(week)}`);
  if (rng.random() >= scenes.QUESTION_RATE) return null;
  const ahead = recruiting.ahead_of(state, slug, pid);
  if (truthy(ahead)) {
    const text = format(rng.choice(scenes.QUESTION_LINES["roster"]), { ahead: ahead["name"], ahead_cls: get(scenes.CLASS_WORDS, ahead["cls"], "veteran"),
      position: ahead["position"] });
    return { kind: "roster", text, answer: null, reply: null,
      about: { id: ahead["slug"], name: ahead["name"], position: ahead["position"], cls: ahead["cls"],
        ovr: ahead["ovr"], last_year: ahead["last_year"] } };
  }
  const other = recruiting.other_offered(state, slug, pid);
  if (truthy(other)) {
    const text = format(rng.choice(scenes.QUESTION_LINES["recruit"]), { other: other["name"] });
    return { kind: "recruit", text, answer: null, reply: null,
      about: { pid: other["pid"], name: other["name"], position: other["position"],
        cls: get(rc["prospects"][other["pid"]], "cls") } };
  }
  return null;
}

scenes.WORD_DOUBT = "Coach, I heard what happened with {name}.";   // Keeps His Word under the floor: the last promise you broke at his position
scenes.WORD_DOUBT_ANY = "Coach, I've heard about your promises.";   // ... with none broken at his position

export function answer_reply(state, slug, pid, question, answer, truthful) {
  // What he says back to your answer (a hollow promise gets its own line; the Package Deal's promise
  // waits on the offer, and its straight answer once his mate holds your offer has its own).
  if (modules.clear.on()) {                        // Clear Mode: what your answer did, in a word
    if (answer === "promise") {
      return truthy(truthful) || get(question, "kind") === "package" ? "Promise believed." : "Promise not believed: you cannot keep it.";
    }
    return answer === "straight" ? "Answer noted." : "Sidestepped.";
  }
  if (get(question, "kind") === "package") {
    if (answer === "promise") return scenes.REPLY_LINES[truthy(get(question["about"], "offered")) ? "package_offered" : "package"];
    if (answer === "straight" && truthy(get(question["about"], "offered"))) return scenes.REPLY_LINES["package_offered"];
    return scenes.REPLY_LINES[answer];
  }
  if (answer === "promise" && !truthy(truthful)) return scenes.REPLY_LINES["hollow"];
  return scenes.REPLY_LINES[answer];
}


export function bare_reaction(text) {
  // His line without what wraps it: the repeat note (REPEAT_LINE) and the echo naming what landed ("The NIL side of
  // it? ..."). Tests read the line itself through this.
  if (text.startsWith(scenes.REPEAT_LINE + " ")) text = text.slice(scenes.REPEAT_LINE.length + 1);
  for (const ph of Object.values(scenes.PHRASES)) {
    const echo = `${ph[0].toUpperCase()}${ph.slice(1)}? `;
    if (text.startsWith(echo)) return text.slice(echo.length);
  }
  return text;
}


export function reaction(state, slug, pid, action, pitch, p, tired = false, tells = true, repeat = false) {
  // How he takes your lead-with: a priority (or his decider's topic, persona.counts_as_priority) where
  // you are strong lights him up (hit), one where you are weak goes quiet, anything else is polite;
  // `tired` (the call pestered him) and the pitch falls flat. On a call that keeps his priority to himself
  // (`tells` False) the kind is "guarded" whatever he thought (his personality's line keeps its tone; a
  // pitch that was none of his gets a line that names nothing). `you` is your line, for the conversation.
  const persona = modules.persona, recruiting = modules.recruiting;
  if (modules.clear.on()) return scenes._reaction_clear(state, slug, pid, pitch, tired);
  const rng = new Random(`react-${pystr(state["recruiting"]["seed"])}-${slug}-${pid}-${pystr(state["current_week"])}-${action}`);
  const f = scenes._fields(state, slug, p);
  const tr = scenes.truth(state, slug, p["id"]);
  const you = format(scenes.lead_line(tr, pitch), f);               // your line, true to the record and the program
  if (tired) return { kind: "tired", text: format(rng.choice(scenes.TIRED), f), you };
  let kind;
  if (persona.counts_as_priority(state, pid, pitch)) {
    kind = scenes.case_kind(recruiting.strengths(state, slug, pid)[pitch]);
  } else {
    kind = "polite";
  }
  const sid = `${action}-${p["id"]}-${pystr(state["current_week"])}`;      // the scene's id: its personality line, keyed apart from every other draw
  // the draw is made from the lit-up or quiet lines either way (a fair case draws as a hit did), so the stream is as it was
  const [line, fixed] = scenes.true_line(tr, pitch, kind === "fair" ? "hit" : kind, rng.choice(scenes.LINES[pitch][kind === "fair" ? "hit" : kind]), sid);     // a claim the facts do not back gives way
  let text = format(line, f);
  if (kind === "fair" && !fixed) {                                  // he is listening: his own line, chosen by the scene (no draw). His doubt about a record the facts do not back stands
    const phrase = scenes.PHRASES[pitch];
    text = format(scenes.FAIR_LINES[mod(ordsum(sid), scenes.FAIR_LINES.length)], { Topic: phrase[0].toUpperCase() + phrase.slice(1), ...f });
  }
  if (fixed && tells && pitch === "winning" && kind === "hit") {
    // his doubt about the record stands: his personality's line would hide it
  } else if (kind === "fair" && tells) {
    // his listening line stands as it is
  } else if (kind === "hit" || kind === "quiet" || kind === "fair") {      // (a fair case on a call that tells nothing: his personality's line, as a hit's)
    const mine = scenes._persona_line(state, p["id"], sid, kind === "fair" ? "hit" : kind, f, !tells, "react");
    if (truthy(mine)) {                                             // his personality's tone, still naming what landed (a guarded call names nothing)
      text = tells ? `${scenes.PHRASES[pitch][0].toUpperCase()}${scenes.PHRASES[pitch].slice(1)}? ${mine}` : mine;
    }
  } else if (!tells) {                                              // the topic's polite line would say it is none of his
    text = scenes._no_tell_line(state, p["id"], `${sid}-react`, f);
  } else if (pitch === "nil") {                                     // money is not what he is about, and he says so
    text = scenes.NIL_NOT_HIS;
  }
  if (repeat) {                                                     // your opening already said it
    text = `${scenes.REPEAT_LINE} ${text}`;
  }
  return { kind: tells ? kind : "guarded", text, you };
}

Object.assign(scenes, {
  portal_fields, portal_line, facts, truth, pro_truth, _holds, _win_key, lead_line, said_phrase, true_line, words, _role, _record, _conf, coach_name, last_game, next_game, leader_of, _fields, _turn, _persona_line, _no_tell_line, tells, last_talk, context_line, twist_line, style_line, heard_rival_due, open_scene, _open_portal, _open_clear, _present_clear, _reaction_clear, case_kind, _case_word, _lines, cue, present, ask_note, package_about, package_answers, question, answer_reply, bare_reaction, reaction,
});

modules.scenes = scenes;

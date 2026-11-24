// Coach Career scenes (docs/superpowers/specs/2026-10-28-recruiting-experience-design.md, section 6):
// your calls and in-home visits as a short, plain conversation. A note opens it (at a visit, who decides; a Package
// Deal says so); you present your program (three things) and he answers each with a Yes (one of his priorities) or a
// No, with your case on each Yes; he may have a question about a named player; you lead with a pitch and get a Yes or
// No to it. No small talk and nothing to read between the lines. This file owns the scene's words;
// recruiting.js owns the scene's lifecycle and its points (the one `_act` path).
//
// A scene is `turns`: [{who: "you" | "him" | "note", text}] in order; `lines` (his turns' texts) stays one release
// for the page's old readers. His question, and the lines his History keeps (a promise kept or broken, the money
// talked), are in his voice.
//
// Every constant and function is on `scenes` and is read through it. `persona` and `recruiting` are reached through
// `modules` at the call. Notes:
//   - `format(line, f)` below fills a line's {fields}: one pass over the template, a missing field throws;
//   - QUESTION_RATE reads `env.CFP_QUESTION_RATE` (engine_js/files.js), a setting the host passes in.
import { Random, cmp, get, truthy, pyfloat } from "../engine_js/pyrt.js";
import { env } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

export const scenes = {};

// ---- small helpers ------------------------------------------------------------------------------------------------
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

// how often a playing-time recruit asks about a named player on a call or visit *tune: tools/check_recruiting.mjs*
// (CFP_QUESTION_RATE: the sweep forces it through the dev server's environment)
scenes.QUESTION_RATE = Number(env.CFP_QUESTION_RATE ?? "0.6");

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
scenes.HEARD_RIVAL = "Coach, I heard you told another kid the same thing.";   // an earlier job promise at his position, strained (recruiting._strain)
scenes.JOB_SAID = "The job's yours. I mean it.";   // Promise Him the Job, as you say it
// what he says back to Promise Him the Job: a promise he believes ("promise"), one he has heard before ("hollow"), or
// one made where you already have players at his spot ("crowded")
scenes.REPLY_LINES = {"crowded": "Everybody gets that line, Coach. I hear you've already got guys at my spot.",
               "promise": "That's what I needed to hear, Coach.",
               "hollow": "I've heard that one before."};
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
scenes.CLASS_WORDS = {"FR": "freshman", "FRRS": "redshirt freshman", "SO": "sophomore", "SORS": "redshirt sophomore",
               "JR": "junior", "JRRS": "redshirt junior", "SR": "senior", "SRRS": "redshirt senior"};


export function _turn(who, text) {
  return { who, text };
}


export function heard_rival_due(state, slug, pid) {
  // He heard you promised his job to someone else (recruiting._strain) in an earlier week (the portal's own week in the
  // portal) and has not been told so yet: your school's scene opens with a note saying so.
  const c = orr(get(orr(get(state["recruiting"]["contacts"], pid), {}), slug), {});
  let stamp = get(c, "heard_rival");
  if (slug !== get(state, "team") || stamp === null) return false;
  stamp = Array.isArray(stamp) ? Array.from(stamp) : [stamp, 0];
  return cmp(stamp, modules.recruiting.rival_stamp(state)) < 0;
}


// ----- The conversation is transactional. A plain note opens it; your opening gets a Yes (one of his priorities) or No
// per topic; your lead-with a Yes or No. No small talk, no cue to read between the lines. The points, the question and
// the visit's NIL note are the game's own.

export function open_scene(state, slug, pid, action, week) {
  // A call's or in-home visit's scene as it opens: a plain note, at a visit who decides, and a Package Deal saying so.
  // His answers and his question wait on your opening (`present`); his ask is as you know it.
  const persona = modules.persona, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const tired = recruiting.would_pester(state, slug, pid);
  const d = persona.of(state, pid);
  const sid = `${action}-${pid}-${pystr(week)}`;
  const turns = [scenes._turn("note", `${action === "hc_visit" ? "In-home visit" : "Call"} with ${pystr(p["name"])}.`)];
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
  const [k, d_] = persona.story(state, pid);
  if (k === "package" && (action === "hc_visit" || !truthy(get(orr(get(orr(get(rc["contacts"], pid), {}), slug), {}), "calls")))) {
    // a Package Deal says so plainly, at a visit or on the first call: his question about his mate follows your opening
    turns.push(scenes._turn("note", `Package Deal: he wants ${pystr(persona._name_of(state, get(d_, "mate")) || "his teammate")} to come too.`));
    package_ = scenes.package_about(state, slug, pid);
    if (action === "hc_visit") persona.learn(state, slug, pid, "story");
  }
  const sc = { id: sid, action, week, turns, lines: [],
    cue: null, ask: recruiting.ask_view(state, slug, pid), question: null, presented: null, tired, package: package_ };
  scenes._lines(sc);
  return sc;
}


export function present(state, slug, pid, sc, topics, hits, back, tired) {
  // Your opening lands on the scene: your turn (the three things), his Yes or No to each (a Yes: one of his
  // priorities, whatever your case, and now you know it), your letter grade on each Yes, on a visit the NIL note, and a
  // note when he has a question. Returns the reaction's kind, the best of his that you pitched (recruiting.reaction_kind:
  // sold, hit, fair, lukewarm or quiet), polite when none was his, tired when the call pestered him.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  hits = [...hits, ...back.filter((t) => !hits.includes(t))];      // every presented topic that is one of his priorities
  const names = topics.map((t) => get(scenes._TOPIC_NAME, t, t));
  sc["turns"].push(scenes._turn("you", `You pitched: ${names[0]}, ${names[1]} and ${names[2]}.`));
  let kind, answer;
  if (tired) {
    kind = "tired";
    answer = "No answer: he is tired of your contact this week.";
    sc["turns"].push(scenes._turn("him", answer));
  } else {
    const st_ = recruiting.case_letters(state, slug, pid, true);
    // the best of his that you pitched decides it: your letter on each against what he wants there
    kind = hits.length ? recruiting.best_reaction(hits.map((t) => scenes.case_kind(state, slug, pid, t))) : "polite";
    answer = topics.map((t) => `${get(scenes._TOPIC_NAME, t, t)}: ${hits.includes(t) ? "Yes" : "No"}`).join(" · ");
    sc["turns"].push(scenes._turn("him", answer));
    if (hits.length) {                             // your program's grade on each Yes: where you stand on what he wants
      sc["turns"].push(scenes._turn("note", "Your case on his: " + hits.map((t) => `${get(scenes._TOPIC_NAME, t, t)} ${st_[t]}`).join(", ") + "."));
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


export function reaction(state, slug, pid, pitch, tired = false) {
  // How he takes your lead-with, said plainly: a priority (or his decider's topic, persona.counts_as_priority) is a
  // Yes with your letter grade there (how he takes it: scenes.case_kind); anything else a No (polite);
  // `tired` (the call pestered him) and there is no answer. `you` is your line, for the conversation.
  const persona = modules.persona, recruiting = modules.recruiting;
  const name = get(scenes._TOPIC_NAME, pitch, pitch);
  const you = `You led with ${pystr(name)}.`;
  if (tired) return { kind: "tired", text: "No answer: he is tired of your contact this week.", you };
  let kind, text;
  if (persona.counts_as_priority(state, pid, pitch)) {
    kind = scenes.case_kind(state, slug, pid, pitch);
    text = `${pystr(name)}: Yes, one of his priorities. Your case there: ${scenes._case_word(recruiting.strengths(state, slug, pid, true)[pitch])}.`;
  } else {
    kind = "polite"; text = `${pystr(name)}: No, not one of his priorities.`;
  }
  return { kind, text, you };
}


export function case_kind(state, slug, pid, topic) {
  // How he takes a pitch on one of his priorities: your letter grade there against what he wants (his standards, never
  // shown; recruiting.reaction_kind). "sold" (He's Sold: a full letter or more over), "hit" (He Lights Up: you meet
  // it), "fair" (He's Listening: a little short), "lukewarm" (He's Lukewarm: one to two letters short) or "quiet"
  // (He Isn't Buying It: further than that, or an F).
  return modules.recruiting.reaction_kind(state, slug, pid, topic);
}

export function _case_word(sv) {
  // Your program's case on a topic as the page says it: a letter grade, A+ to F (career_js/grades.js school_pull).
  return modules.grades.school_pull(sv);
}

// the topics' names as the page shows them (web/recruiting.js PITCH_NAMES)
scenes._TOPIC_NAME = {"proximity": "Close to Home", "playing_time": "Playing Time", "prestige": "Program Prestige", "winning": "Winning Now",
               "nil": "NIL", "coach": "The Head Coach", "academics": "Academics", "pro": "Path to the League", "facilities": "Facilities",
               "location": "Location", "stability": "Stability", "game_day": "Game Day", "exposure": "Exposure",
               "contender": "A Title Contender", "recruiting": "The Class Around Him", "development": "Player Development", "culture": "Culture"};

export function _lines(sc) {
  sc["lines"] = sc["turns"].filter((t) => t["who"] === "him").map((t) => t["text"]);
}


scenes.ASK_WHO = {"mom": "His mom", "dad": "His dad", "grandma": "His grandmother", "hs_coach": "His high school coach", "trainer": "His trainer", "self": "He"};

export function ask_note(state, slug, pid, ask) {
  // The visit's note on NIL, in the game's NIL words and numerals: who speaks to the money, his ask as your scouts
  // have it (what the profile's His Ask shows: the number at a complete report, the range before; he never names
  // it himself) and where you stand: the NIL you have left (and what your offer already holds on him), or that the
  // ask is more than you can put up.
  const persona = modules.persona, recruiting = modules.recruiting;
  const n = get(ask, "exact");
  const ranged = n === null && truthy(get(ask, "hi"));
  const d = persona.of(state, pid)["decider"];                      // the one who decides speaks to the money (never "his dad" for a trainer)
  const who = get(scenes.ASK_WHO, d, scenes.ASK_WHO["dad"]);
  if (!ranged && !truthy(n)) return `${who} says the money isn't the point.`;
  const rec = get(state["recruiting"]["nil"], slug);
  const left = truthy(rec) ? recruiting.nil_left(state, slug)       // read only: never opens the school's NIL record here
    : recruiting.is_portal(state) ? recruiting.portal_budget(state, slug) : recruiting.nil_budget(state, slug);
  const held = get(orr(get(orr(rec, {}), "held"), {}), pid, 0);
  const room = left + held;                                         // an offer to him can hold up to this (recruiting.act)
  const have = ranged ? `Your scouts have his ask between ${pystr(ask["lo"])} and ${pystr(ask["hi"])}` : `Your scouts have his ask at ${pystr(n)}`;
  if ((ranged ? ask["lo"] : n) > room) return `${who} wants to know about NIL. ${have}, more than you have left (${pystr(room)}).`;
  if (truthy(held)) return `${who} wants to know about NIL. ${have}. Your offer holds ${pystr(held)}, and you have ${pystr(left)} NIL left.`;
  return `${who} wants to know about NIL. ${have}. You have ${pystr(left)} NIL left.`;
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
  // What your answer did, in a word (a hollow promise is not believed; the Package Deal's promise waits on the offer).
  if (answer === "promise") {
    return truthy(truthful) || get(question, "kind") === "package" ? "Promise believed." : "Promise not believed: you cannot keep it.";
  }
  return answer === "straight" ? "Answer noted." : "Sidestepped.";
}


Object.assign(scenes, {
  _turn, heard_rival_due, open_scene, case_kind, _case_word, _lines, present, ask_note, package_about, package_answers, question, answer_reply, reaction,
});

modules.scenes = scenes;

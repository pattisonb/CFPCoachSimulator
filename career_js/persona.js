// Recruit personas (career_js/persona.js): every prospect has a personality (how he talks) and a decider
// (who has the say in where he signs, and the one topic that decider cares about). A fixed draw from
// the class seed and his id, worked out when asked and never stored in the save (a save from before
// this keeps the persona it stored; a test may set one on the prospect).
import { Random, round, sorted, cmp, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { recruits } from "./recruits.js";

// ---- small helpers -------------------------------------------------------------------------------------
/** str(v) inside an f-string for a value that may be None ("None", as the seeds and keys built from it have always had it). */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
/** `a or b`: a when it is true as Python sees it (not None, 0, "", an empty list or dict), else b. */
const or_ = (a, b) => (truthy(a) ? a : b);
/** `x in xs` for a list or a tuple. */
const within = (x, xs) => xs.includes(x);
/** `d.get(key, default)` for a dict of another module, whichever of a plain object or a Map it is (STAR_KEY, AI_NIL, a school's fits). */
function dget(d, k, dflt = null) {
  if (d instanceof Map) return d.has(k) ? d.get(k) : d.has(String(k)) ? d.get(String(k)) : dflt;
  return get(d, k, dflt);
}
/** `d.clear()` for a cache of another module, whichever of a plain object, a Map or a Set it is. */
function clear_cache(d) {
  if (d instanceof Map || d instanceof Set) d.clear();
  else for (const k of Object.keys(d)) delete d[k];
}
/** `text.format(**fields)` for the game's lines: every {name} filled from `fields` (a name it lacks is a KeyError). */
function format(text, fields) {
  return text.replace(/\{(\w+)\}/g, (_, name) => {
    if (fields[name] === undefined) throw new Error(`KeyError: '${name}'`);
    return pystr(fields[name]);
  });
}
/** A tuple of names as a dict key (the board's ("state", "OH")): no slug or state holds the separator. */
const tuple_key = (...parts) => parts.map(pystr).join("\u0000");

const PERSONALITIES = ["cocky", "shy", "guarded", "attention", "business"];   // equally likely
const PERSONALITY_LABEL = { cocky: "Cocky", shy: "Shy", guarded: "Guarded", attention: "Loves the Attention", business: "All Business" };

const DECIDERS = { self: 0.30, mom: 0.20, dad: 0.15, grandma: 0.10, hs_coach: 0.15, trainer: 0.10 };   // who decides, by share *tune*
const DECIDER_LABEL = { self: "Himself", mom: "Mom", dad: "Dad", grandma: "Grandmother", hs_coach: "High School Coach", trainer: "Trainer" };
const DECIDERS_ON = false;              // *tune* off: every recruit decides himself, with no topic, and nothing about who decides is shown or learned (the player's call, for now)
const PORTAL_DECIDERS = ["self", "mom", "dad", "trainer"];   // a transfer's decider: no high school coach or grandmother (their shares renormalized)
const _TOPICS_BEFORE_GRADES = { self: [], mom: ["proximity", "academics"], dad: ["nil", "playing_time", "pro"], grandma: ["proximity", "coach"],
  hs_coach: ["coach", "playing_time", "winning", "pro"], trainer: ["nil", "pro"] };
const DECIDER_TOPICS = { self: [], mom: ["proximity", "academics", "stability"], dad: ["nil", "playing_time", "pro", "exposure"],
  grandma: ["proximity", "coach", "academics"], hs_coach: ["coach", "playing_time", "winning", "pro", "stability"],
  trainer: ["nil", "pro", "facilities", "exposure"] };   // what each decider cares about (School Grades Phase 2 added the campus grades)
const _TOPICS_BEFORE_PRO = Object.fromEntries(Object.entries(_TOPICS_BEFORE_GRADES).map(([d, ts]) => [d, ts.filter((t) => t !== "pro")]));   // the tuples the first draw reads, so a saved class keeps its topics


export function draw(pid, seed, portal = false, grades = true) {
  // His personality, decider and the decider's topic (None when he decides himself). A transfer in
  // the portal (`portal`) keeps the same personality draw; his decider comes from its own stream and
  // only PORTAL_DECIDERS, so the class draw never moves.
  let rng = new Random(`persona-${pystr(seed)}-${pystr(pid)}`);
  const personality = rng.choice(persona.PERSONALITIES);
  let decider = rng.choices(Object.keys(persona.DECIDERS), { weights: Object.values(persona.DECIDERS) })[0];
  if (portal) {
    rng = new Random(`persona-portal-${pystr(seed)}-${pystr(pid)}`);
    decider = rng.choices(persona.PORTAL_DECIDERS, { weights: persona.PORTAL_DECIDERS.map((d) => persona.DECIDERS[d]) })[0];
  }
  const topics = persona.DECIDER_TOPICS[decider];
  let topic = topics.length ? rng.choice(persona._TOPICS_BEFORE_PRO[decider]) : null;      // the draw as it was before Pro Pipeline
  const old = persona._TOPICS_BEFORE_GRADES[decider];
  if (within("pro", old) && new Random(`persona-pro-${pystr(seed)}-${pystr(pid)}`).random() < 1 / old.length) {
    topic = "pro";                                                     // its own stream: Path to the League takes its share
  }
  const fresh = grades ? topics.filter((t) => !within(t, old)) : [];      // a class from before the campus topics keeps its old pick
  if (fresh.length) {                                                    // the campus grades take their share, in their own stream
    const g = new Random(`persona-grades-${pystr(seed)}-${pystr(pid)}`);
    if (g.random() < fresh.length / topics.length) topic = g.choice(fresh);
  }
  if (!persona.DECIDERS_ON) return { personality, decider: "self", decider_topic: null };
  return { personality, decider, decider_topic: topic };
}


// (@lru_cache(maxsize=20000): the draw kept by its arguments; past the size the oldest kept goes, which changes no answer)
const _drawn_cache = new Map();
export function _drawn(pid, seed, portal = false, grades = false) {
  const key = tuple_key(pid, typeof seed === "string" ? `s:${seed}` : seed, portal, grades);
  let d = _drawn_cache.get(key);
  if (d === undefined) {
    d = persona.draw(pid, seed, portal, grades);
    if (_drawn_cache.size >= 20000) _drawn_cache.delete(_drawn_cache.keys().next().value);
    _drawn_cache.set(key, d);
  }
  return d;
}


export function of(state, pid) {
  // The prospect's persona (read only): the one on the prospect when a save or a test set it,
  // otherwise his fixed draw (the portal's for a transfer), cached in memory and not written into the state.
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  if (p["persona"] !== undefined) {                 // (one a save or a test set: his decider is himself too while they are off)
    const own = p["persona"];
    return persona.DECIDERS_ON || (get(own, "decider", "self") === "self" && get(own, "decider_topic") === null) ? own
      : { ...own, decider: "self", decider_topic: null };
  }
  return persona._drawn(pid, get(rc, "seed", 0), truthy(get(rc, "portal")), get(rc, "topics_v") === 2);
}


// ----- what the personality and the decider change in recruiting --------------------------------------

const ATTENTION_GAP = 2;                // weeks without a contact before a Loves-the-Attention recruit cools on a school *tune*
const COCKY_PITCH = 1.3;                // Cocky: playing time and prestige pitches count this much more *tune*
const SHY_VISIT = 1.5;                  // Shy: an in-home visit counts this much more *tune*
const SHY_FIRST_CALL = 0.5;             // Shy: his first call from a school counts this much *tune*
const BUSINESS_MESSAGE = 0.3;           // All Business: a message counts this much *tune*
const BUSINESS_OFFER = 1.3;             // All Business: an offer and its NIL count this much more *tune*
const DECIDER_VISIT = 1.2;              // an in-home visit on the topic his decider cares about counts this much more *tune*
const COCKY_LOWBALL = 0.7, TRAINER_LOWBALL = 0.8;     // the share of his ask under which an offer is a lowball *tune*
const TRAINER_OVER = 1.2;               // the Trainer counts NIL at full value up to this multiple of his ask *tune*
const COCKY_HOLLOW = 2.0;               // Cocky: a hollow promise costs this many times more *tune*
const ATTENTION_PESTER_FREE = 5;        // Loves the Attention: contacts before more start to pester *tune*
const GUARDED_DECOMMIT = 0.5;           // Guarded: his weekly decommit chance is this share of the usual *tune*


export function pitch_mult(state, pid, action, pitch, first_call = false) {
  // What his personality and decider do to a pitch's worth (before diminishing returns).
  const d = persona.of(state, pid);
  const k = d["personality"];
  let m = 1.0;
  if (k === "cocky" && within(pitch, ["playing_time", "prestige"])) m *= persona.COCKY_PITCH;
  else if (k === "shy") {
    if (action === "hc_visit") m *= persona.SHY_VISIT;
    else if (action === "call" && truthy(first_call)) m *= persona.SHY_FIRST_CALL;
  } else if (k === "business" && action === "message") m *= persona.BUSINESS_MESSAGE;
  if (action === "hc_visit" && pitch !== null && pitch !== undefined && pitch === d["decider_topic"]) m *= persona.DECIDER_VISIT;
  return m;
}


export function counts_as_priority(state, pid, pitch) {
  // A pitch on one of his priorities, or on the topic his decider cares about, lands as a priority.
  const p = state["recruiting"]["prospects"][pid];
  return within(pitch, p["priorities"]) || (pitch !== null && pitch !== undefined && pitch === persona.of(state, pid)["decider_topic"]);
}


export function lowball_share(state, pid) {
  // The share of his ask under which an offer reads as a lowball.
  const recruiting = modules.recruiting;
  const d = persona.of(state, pid);
  if (d["personality"] === "cocky") return persona.COCKY_LOWBALL;
  if (d["decider"] === "trainer") return persona.TRAINER_LOWBALL;
  return recruiting.LOWBALL;
}


export function nil_over(state, pid) {
  // (the share of value NIL past his ask counts, up to what multiple of his ask it counts that way).
  const recruiting = modules.recruiting;
  if (persona.of(state, pid)["decider"] === "trainer") return [1.0, persona.TRAINER_OVER];
  return [recruiting.NIL_OVER, Infinity];
}


export function offer_mult(state, pid) {
  return persona.of(state, pid)["personality"] === "business" ? persona.BUSINESS_OFFER : 1.0;
}


export function hollow_mult(state, pid, slug = null) {
  // What a hollow promise costs, times the usual: double for a Cocky recruit, and double again from his
  // legacy school (his story).
  const m = persona.of(state, pid)["personality"] === "cocky" ? persona.COCKY_HOLLOW : 1.0;
  const [k, d] = persona.story(state, pid);
  return m * (slug !== null && slug !== undefined && k === "legacy" && get(d, "school") === slug ? persona.LEGACY_COST : 1.0);
}


export function pester_free(state, pid) {
  const recruiting = modules.recruiting;
  return persona.of(state, pid)["personality"] === "attention" ? persona.ATTENTION_PESTER_FREE : recruiting.PESTER_FREE;
}


export function call_reveals(state, slug, pid, roll = true) {
  // Whether a call tells the school one of his priorities: never for Guarded, not on the first call
  // for Shy, otherwise today's roll (`roll=False`: only the personality's gate, for a scene's pitch).
  const recruiting = modules.recruiting;
  const k = persona.of(state, pid)["personality"];
  if (k === "guarded") return false;
  if (k === "shy" && !truthy(get(or_(get(get(state["recruiting"]["contacts"], pid, {}), slug), {}), "calls", 0))) return false;
  if (!truthy(roll)) return true;
  const rc = state["recruiting"];
  return new Random(`call-${pystr(rc["seed"])}-${pystr(slug)}-${pystr(pid)}-${pystr(state["current_week"])}`).random() < recruiting.CALL_REVEAL;
}


export function decommit_mult(state, pid) {
  return persona.of(state, pid)["personality"] === "guarded" ? persona.GUARDED_DECOMMIT : 1.0;
}


export function cool_quiet(state, week) {
  // A Loves-the-Attention recruit cools on a school that has not been in touch for ATTENTION_GAP weeks.
  const rc = state["recruiting"];
  for (const [pid, by] of Object.entries(rc["contacts"])) {
    if (truthy(rc["status"][pid]["signed"])) continue;
    for (const [slug, c] of Object.entries(by)) {
      if (rc["status"][pid]["committed"] === slug) continue;      // post-commit attention is the commit style's, not this
      const last = get(c, "last_contact");
      if (last === null || last > week - persona.ATTENTION_GAP || or_(get(c, "cooled_until"), -1) >= week + 1) continue;
      if (persona.of(state, pid)["personality"] === "attention") {
        c["cooled_until"] = week + 1;
        persona.set_cooled_why(state, slug, pid, "quiet");
      }
    }
  }
}


export function set_cooled_why(state, slug, pid, why) {
  // Why he cooled on the player's school ("lowball", "promise" or "quiet"), for the words the page
  // shows; kept off the contact (the recruiting digest) and only for the player's school.
  if (slug === get(state, "team")) {
    const rc = state["recruiting"];
    if (rc["cooled_why"] === undefined) rc["cooled_why"] = {};
    if (rc["cooled_why"][slug] === undefined) rc["cooled_why"][slug] = {};
    rc["cooled_why"][slug][pid] = why;
  }
}


export function cooled_why(state, slug, pid) {
  // Why he is cooled on the school; a save from before this, or an AI school: "lowball".
  return or_(get(or_(get(or_(get(state["recruiting"], "cooled_why"), {}), slug), {}), pid), "lowball");
}


// ----- discovery: what a school has learned about him ---------------------------------------------------

const DECIDER_LOOKS = 2.0;              // looks of his report before the player's staff learns who decides *tune*
const PERSONALITY_LINE = { cocky: "Your staff learned he's cocky.", shy: "Your staff learned he's shy.",
  guarded: "Your staff learned he's guarded.", attention: "Your staff learned he loves the attention.",
  business: "Your staff learned he's all business." };
const DECIDER_LINE = { self: "Your staff learned he makes his own call.", mom: "Your staff learned his mom has the final say.",
  dad: "Your staff learned his dad has the final say.", grandma: "Your staff learned his grandmother has the final say.",
  hs_coach: "Your staff learned his high school coach has the final say.", trainer: "Your staff learned his trainer has the final say." };


export function known(state, slug, pid) {
  // What `slug` has learned about him: {"personality": bool, "decider": bool, "story": bool}. The
  // player's staff knows his decider once its read holds DECIDER_LOOKS looks and his story at a complete
  // report, logged or not (a save from before these were learned in look() never logged them); a public
  // story (story_public) is known to everyone; his commit style once learned (learn_styles: an official
  // visit, or your offer held STYLE_OFFER_WEEKS).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const k = or_(get(or_(get(or_(get(rc, "traits_known"), {}), slug), {}), pid), {});
  const looks = slug === get(state, "team") ? recruiting.report_looks(get(or_(get(rc, "reads"), {}), pid)) : 0.0;
  return { personality: truthy(get(k, "personality")), decider: persona.DECIDERS_ON && (truthy(get(k, "decider")) || looks >= persona.DECIDER_LOOKS),
    story: truthy(get(k, "story")) || looks >= recruiting.REPORT_LOOKS || persona.story_public(state, pid),
    style: truthy(get(k, "style")) && persona.style(state, pid) !== null };
}


export function learn(state, slug, pid, trait) {
  // `slug` learns one of his traits; True when newly learned. Only the player's school keeps a map
  // (nothing reads an AI school's yet), and only the player's learning is logged for his History.
  const recruiting = modules.recruiting;
  if (slug !== get(state, "team")) return false;
  if (trait === "decider" && !persona.DECIDERS_ON) return false;
  const rc = state["recruiting"];
  if (rc["traits_known"] === undefined) rc["traits_known"] = {};
  if (rc["traits_known"][slug] === undefined) rc["traits_known"][slug] = {};
  if (rc["traits_known"][slug][pid] === undefined) rc["traits_known"][slug][pid] = { personality: false, decider: false };
  const mine = rc["traits_known"][slug][pid];
  if (truthy(get(mine, trait))) return false;
  mine[trait] = true;
  if (trait === "story") {                          // a story your staff did not already know of (not a public one, not none)
    const line = persona.story_learned_line(state, pid);
    if (truthy(line)) recruiting._event(state, "learned", pid, slug, { trait, line });
    return true;
  }
  if (trait === "style") {
    const k = persona.style(state, pid);
    if (k === null) {
      mine[trait] = false;
      return false;
    }
    recruiting._event(state, "learned", pid, slug, { trait, line: persona.STYLE_LEARNED[k] });
    return true;
  }
  const d = persona.of(state, pid);
  const line = trait === "personality" ? persona.PERSONALITY_LINE[d["personality"]] : persona.DECIDER_LINE[d["decider"]];
  recruiting._event(state, "learned", pid, slug, { trait, line });
  return true;
}


export function learn_on_contact(state, slug, pid, action) {
  // His personality shows on the school's first call or first in-home visit (Guarded: the visit only);
  // a Package Deal tells the school about his mate the first time it calls or visits.
  const guarded = persona.of(state, pid)["personality"] === "guarded";
  if (action === "hc_visit" || (action === "call" && !guarded)) persona.learn(state, slug, pid, "personality");
  if (within(action, ["call", "hc_visit"]) && persona.story(state, pid)[0] === "package") persona.learn(state, slug, pid, "story");
}


export function learn_from_read(state, pid, looks) {
  // His decider shows once the player's read of him holds DECIDER_LOOKS looks; a complete report tells the rest: his
  // story, his personality, how he means to commit and his priorities.
  const recruiting = modules.recruiting;
  if (looks >= persona.DECIDER_LOOKS) persona.learn(state, state["team"], pid, "decider");
  if (looks >= recruiting.REPORT_LOOKS) {
    persona.learn(state, state["team"], pid, "story");
    const me = state["team"];                       // a complete report leaves no guesswork about him
    for (const t of ["personality", "decider", "style"]) persona.learn(state, me, pid, t);
    const revealed = state["recruiting"]["revealed"];
    if (revealed[me] === undefined) revealed[me] = {};
    if (revealed[me][pid] === undefined) revealed[me][pid] = [];
    const seen = revealed[me][pid];
    for (const t of state["recruiting"]["prospects"][pid]["priorities"]) {
      if (!within(t, seen)) seen.push(t);
    }
  }
}


export function story_public(state, pid) {
  // Everyone knows a Hometown Hero, an Injury Comeback and a Late Bloomer who has jumped.
  const [k, _] = persona.story(state, pid);
  return within(k, persona.PUBLIC_STORIES) || (k === "bloomer" && state["recruiting"]["prospects"][pid]["real"] === undefined);
}


export function _name_of(state, pid) {
  return or_(get(or_(get(state["recruiting"]["prospects"], pid), {}), "name"), "");
}


export function _school_name(slug) {
  // A school's name for a line: an FCS stand-in is only ever its own name (season.team_display), never a placeholder's.
  const season = modules.season;
  const teams = season.load_teams();
  return typeof slug === "string" && slug in teams ? season.team_display(slug, teams) : or_(slug, "");
}

export function _foe_name(slug) {
  // The team a school plays, inside a line: "Iowa State", but "the Plains Thunderheads" (season.team_in_line).
  const season = modules.season;
  const teams = season.load_teams();
  return typeof slug === "string" && slug in teams ? season.team_in_line(slug, teams) : or_(slug, "");
}


export function story_learned_line(state, pid) {
  // His History's sentence when your staff finds out his story; None for a public story or none.
  const [k, d] = persona.story(state, pid);
  if (k === null || persona.story_public(state, pid)) return null;
  // (both names are worked out before the sentence is filled, whether the sentence uses them or not)
  return format(persona.STORY_LEARNED[k], { school: persona._school_name(get(d, "school")), mate: persona._name_of(state, get(d, "mate")) });
}


export function story_detail(state, viewer, pid) {
  // The few words after his story's label (Title Case): a legacy's school, his mate, the draft risk from you.
  const [k, d] = persona.story(state, pid);
  if (k === "legacy") return persona._school_name(get(d, "school"));
  if (k === "package") return `With ${persona._name_of(state, get(d, "mate"))}`;
  if (k === "two_sport") return `Draft Risk: ${persona.draft_word(persona.draft_risk(state, viewer, pid))}`;
  return null;
}


export function view(state, viewer, pid) {
  // What `viewer` may show of him: labels, or None for Not Known Yet. His story: its label (NO_STORY when
  // a complete report found none), `story_key` and `story_detail` (a legacy's school, his mate, "Draft Risk: Some").
  const d = persona.of(state, pid), k = persona.known(state, viewer, pid);
  const kind = k["story"] ? persona.story(state, pid)[0] : null;
  return { personality: k["personality"] ? persona.PERSONALITY_LABEL[d["personality"]] : null,
    decider: k["decider"] ? persona.DECIDER_LABEL[d["decider"]] : null,
    decider_topic: k["decider"] ? d["decider_topic"] : null,
    story: k["story"] ? (truthy(kind) ? persona.STORY_LABEL[kind] : persona.NO_STORY) : null,
    story_key: kind,
    story_detail: truthy(kind) ? persona.story_detail(state, viewer, pid) : null,
    // a Package Deal's mate, so the page can open his profile from the chip
    story_mate: kind === "package" && typeof get(persona.story(state, pid)[1], "mate") === "string"
      && get(persona.story(state, pid)[1], "mate") in state["recruiting"]["prospects"] ? get(persona.story(state, pid)[1], "mate") : null,
    commit_style: k["style"] ? persona.STYLE_LABEL[persona.style(state, pid)] : null,
    style_key: k["style"] ? persona.style(state, pid) : null,
    has_style: persona.style(state, pid) !== null,
    // his legacy school is the viewer's own: the tip speaks to you, not about "them"
    story_yours: kind === "legacy" && get(persona.story(state, pid)[1], "school") === viewer };
}


// ----- his story (spec section 2): Legacy, Hometown Hero, Package Deal, Two-Sport, Injury Comeback, Late Bloomer -----
// A class-wide fixed draw from the seed (each prospect's own stream `story-{seed}-{pid}`; a Package Deal's
// mate from `story-mate-{seed}-{pid}`), worked out when asked and never stored: {pid: {"story", "story_data"}}
// for the prospects who have one. Only a class drawn with stories (rc["stories"], set by recruiting.start)
// has any: a save from before keeps playing without them, and the portal has none. The one thing stored is
// a shown-low prospect's real stars and composite (p["real"]: an Injury Comeback all season, a Late Bloomer
// until his jump), since the class's shown stars, composite and rank are what everyone reads.

const STORIES = { legacy: 0.15, hero: 0.20, package: 0.15, two_sport: 0.15, comeback: 0.15, bloomer: 0.20 };   // *tune* each story's share of the stories
const STORY_RATE = { 5: 0.53, 4: 0.53, 3: 0.30, 2: 0.30 };     // *tune* the share of a star level drawn a story (his real stars); with the Package Deal mates about 35% of the class, half the blue chips
const STORY_LABEL = { legacy: "Legacy", hero: "Hometown Hero", package: "Package Deal", two_sport: "Two-Sport",
  comeback: "Injury Comeback", bloomer: "Late Bloomer" };
const NO_STORY = "No Story";                                   // a complete report that found none
const PUBLIC_STORIES = ["hero", "comeback"];                   // everyone knows these at once (a Late Bloomer's jump is public too)
const TWO_SPORT_GROUPS = ["QB", "RB", "WR", "TE", "LB", "CB", "S"];   // who also plays baseball
const MATE_NEAR = 4;              // *tune* a Package Deal's mate is one of this many prospects rated just under him (his town first, else his state)
const LEGACY_TILT = 1.0;          // *tune* a legacy school is drawn by exp(this x the program's strength): the big programs have more
const LEGACY_HEAD = 8.0;          // *tune* the legacy school's head start, in interest points on his list
const LEGACY_PITCH = 1.2;         // *tune* another school's Coach or Prestige pitch against a legacy counts this much more
const LEGACY_LEVEL = 0.5;         // *tune* a legacy school recruits its legacy hard only at a star level it signs this share of the nation's rate or more
const LEGACY_COST = 2.0;          // *tune* the legacy school's lowball (its cooling) or hollow promise costs this many times more
const HERO_STATE = 1.4;           // *tune* a Hometown Hero's pull toward the schools in his state counts this much more
const HERO_AWAY = 0.8;            // *tune* an out-of-state pitch to a hero counts this much (Playing Time and NIL in full)
const HERO_FULL = ["playing_time", "nil"];
const DRAFT_RISK = 0.10;          // *tune* a Two-Sport recruit's chance to go pro in baseball when he signs (0.30 sent ~45 a class to baseball) ...
const DRAFT_FLOOR = 0.02;         // *tune* ... never under this ...
const DRAFT_PT = 0.04;            // *tune* ... less this for each Playing Time pitch from the school he signs with ...
const DRAFT_NIL = 0.5;            // *tune* ... and this per his ask's worth of NIL over his ask (1.2 times his ask: 0.10 off)
const DRAFT_WORDS = [[0.08, "High"], [0.04, "Some"], [0.0, "Low"]];   // the risk as the page says it: at or past the share (scaled with DRAFT_RISK)
const COMEBACK_AI = 0.6;          // *tune* an AI school that would offer an Injury Comeback does this often (it doubts the knee)
const LOYALTY = 1.25;             // *tune* contacts from a school that reached a comeback before LOYALTY_WEEK count this much more
const LOYALTY_WEEK = 6;
const COMEBACK_READ = 1.5;        // *tune* a look's error on a comeback's potential, times the usual: the knee clouds his ceiling
const SHOWN_BAND = 6.0;           // *tune* steps (recruiting.read_scale) the public grades understate a shown-low prospect (a comeback, a bloomer before his jump)
const BLOOM_WEEKS = [5, 9];       // a Late Bloomer jumps at the week step after one of these weeks (inclusive)
const COMEBACK_SHOWN = 1.0;       // *tune* a comeback's shown composite comes from the top this share of the band under his own (1: anywhere in it)
const BLOOM_SHOWN = 0.5;          // *tune* a bloomer's shown composite comes from the bottom this share of his starting band: unranked
const BLOOM_BOARDS = 10;          // *tune* AI schools that add a bloomer to their boards at his jump: the ones he fits best

// persona._STORIES: (the recruiting block, its key, its stories): the draw for one class, in memory only


export function _real(p) {
  // His real (stars, composite): the shown ones unless he is shown low.
  const r = or_(get(p, "real"), p);
  return [r["stars"], r["composite"]];
}


export function _eligible(kind, p, stars, fbs_states, generational) {
  const recruiting = modules.recruiting;
  if (kind === "hero") return fbs_states.has(p["hometown"]["state"]);            // a state with no FBS school has no hometown team to stay with
  if (kind === "two_sport") {                                  // his group read without caching it on the prospect (the save stays small)
    return within(or_(get(p, "group"), null) || recruiting._group_of({ ea_position: p["ea_position"] }), persona.TWO_SPORT_GROUPS);
  }
  if (within(kind, ["comeback", "bloomer"])) {                 // a generational talent is no secret
    return !generational.has(p["id"]) && (kind === "comeback" || stars >= 3);
  }
  return true;
}


export function _draw_class(state) {
  // Every story in the class: each prospect's own stream decides whether he has one (STORY_RATE by his
  // real stars) and which (STORIES, among those that fit him) and its data; then each Package Deal lead is
  // paired with a lower-rated prospect from his town, else his state, who has no story of his own and is
  // not hidden (a lead with none left has no story). Best prospects first, so the pairing is one order.
  const recruiting = modules.recruiting;
  const season = modules.season;
  const rc = state["recruiting"];
  const seed = get(rc, "seed", 0);
  const teams = season.load_teams();
  const schools = recruiting.fbs_schools(state);
  const weights = schools.map((s) => Math.exp(persona.LEGACY_TILT * recruiting._baseline(s)));
  const fbs_states = new Set(schools.map((s) => get(teams[s], "state")));
  const gen = new Set(or_(get(rc, "generational"), []));
  const pros = rc["prospects"];
  const order = sorted(Object.keys(pros), (q) => [-persona._real(pros[q])[1], q]);
  const kinds = Object.keys(persona.STORIES);
  const fits = {};
  for (const pid of order) fits[pid] = kinds.filter((k) => persona._eligible(k, pros[pid], persona._real(pros[pid])[0], fbs_states, gen));
  // a story only some prospects can have weighs more for them, so its share of the class holds; a Package
  // Deal lead weighs half, his mate (drawn below, from the prospects without a story) making the other half
  const weight = {};
  for (const k of kinds) {
    let n = 0;
    for (const pid of order) if (within(k, fits[pid])) n += 1;
    weight[k] = persona.STORIES[k] * order.length / Math.max(1, n) * (k === "package" ? 0.5 : 1.0);
  }
  const out = {};
  for (const pid of order) {
    const p = pros[pid];
    const stars = persona._real(p)[0];
    const rng = new Random(`story-${pystr(seed)}-${pystr(pid)}`);
    if (rng.random() >= get(persona.STORY_RATE, stars, persona.STORY_RATE[2])) continue;
    const ok = fits[pid];
    const kind = rng.choices(ok, { weights: ok.map((k) => weight[k]) })[0];
    const data = {};
    if (kind === "legacy") data["school"] = rng.choices(schools, { weights })[0];
    else if (kind === "hero") data["state"] = p["hometown"]["state"];
    else if (kind === "bloomer") {                               // starts at two or three stars: a five-star jumps two, a three-star one
      data["week"] = rng.randint(persona.BLOOM_WEEKS[0], persona.BLOOM_WEEKS[1]);
      data["jump"] = stars === 3 ? 1 : stars === 5 ? 2 : rng.choice([1, 2]);
    }
    out[pid] = { story: kind, story_data: data };
  }
  const by_state = new Map();
  for (const pid of order) {
    const st = pros[pid]["hometown"]["state"];
    if (!by_state.has(st)) by_state.set(st, []);
    by_state.get(st).push(pid);
  }
  for (const pid of order) {
    const s = get(out, pid);
    if (!truthy(s) || s["story"] !== "package" || s["story_data"]["mate"] !== undefined) continue;
    const p = pros[pid];
    const comp = persona._real(p)[1];
    const pool = by_state.get(p["hometown"]["state"]).filter((q) => out[q] === undefined && !truthy(get(pros[q], "hidden"))
      && !gen.has(q) && persona._real(pros[q])[1] < comp);
    const town = pool.filter((q) => truthy(get(pros[q]["hometown"], "city")) && pros[q]["hometown"]["city"] === get(p["hometown"], "city"));
    const cands = (town.length ? town : pool).slice(0, persona.MATE_NEAR);     // the best few just under him (the pool runs best first)
    if (!cands.length) {
      delete out[pid];
      continue;
    }
    const mate_ = new Random(`story-mate-${pystr(seed)}-${pystr(pid)}`).choice(cands);
    s["story_data"] = { mate: mate_, lead: true };
    out[mate_] = { story: "package", story_data: { mate: pid, lead: false } };
  }
  return out;
}


/** The key of a class's draw (as text): the career, the year, the seed, how many prospects. */
const _stories_key = (state, rc) => [get(state, "id"), get(rc, "year"), get(rc, "seed"), Object.keys(rc["prospects"]).length];
const _same_key = (a, b) => a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

export function stories(state) {
  // The class's stories {pid: {"story", "story_data"}} (read only; {} for a class from before stories and
  // for the portal), drawn once a process and kept in memory, never in the save.
  const rc = or_(get(or_(state, {}), "recruiting"), {});
  if (truthy(get(rc, "portal")) || !truthy(get(rc, "stories"))) return {};
  let cached = persona._STORIES;
  // (The truth of a dict of 4,000 prospects lists its keys, and
  // this is asked for every prospect of every school's week: it was over half of a week's time. The same class's same
  // prospects dict, which held prospects when its stories were kept, is not asked again.)
  if (cached[0] === rc && cached[3] === rc["prospects"]) return cached[2];
  if (!truthy(get(rc, "prospects"))) return {};
  if (cached[0] === rc) { cached[3] = rc["prospects"]; return cached[2]; }
  const key = _stories_key(state, rc);
  cached = [rc, key, _same_key(cached[1], key) ? cached[2] : persona._draw_class(state), rc["prospects"]];
  persona._STORIES = cached;
  return cached[2];
}


export function story(state, pid) {
  // (his story or None, its data): the one a save or a test set on his persona, else the class's draw.
  const p = or_(get(state["recruiting"]["prospects"], pid), {});
  const forced = get(p, "persona");
  if (truthy(forced) && forced["story"] !== undefined) return [forced["story"], or_(get(forced, "story_data"), {})];
  const s = get(persona.stories(state), pid);
  return truthy(s) ? [s["story"], s["story_data"]] : [null, {}];
}


export function mate(state, pid) {
  // A Package Deal's other half, or None.
  const [k, d] = persona.story(state, pid);
  return k === "package" ? get(d, "mate") : null;
}


export function rerank(rc) {
  // The class ranked 1..N again by the shown composite (ties keep their order).
  const pros = rc["prospects"];
  sorted(Object.keys(pros), (q) => [-pros[q]["composite"], pros[q]["rank"], q]).forEach((pid, i) => { pros[pid]["rank"] = i + 1; });
}


export function apply_stories(state) {
  // A new class's stories take their places (recruiting.start): an Injury Comeback shown one star under his own and a Late Bloomer at his starting two or three stars
  // (`story-shown-{seed}-{pid}` draws the shown composite inside that band: a comeback's from its top
  // COMEBACK_SHOWN, a bloomer's from its bottom BLOOM_SHOWN), each one's NIL ask from his shown stars; the class re-ranked. Marks the class.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const drawn = persona._draw_class(state);
  const bands = recruits.model()["generation"]["rating_quantiles"];
  for (const [pid, s] of Object.entries(drawn)) {
    const p = rc["prospects"][pid], kind = s["story"], d = s["story_data"];
    if (within(kind, ["comeback", "bloomer"])) {
      const shown = Math.max(2, p["stars"] - (kind === "bloomer" ? d["jump"] : 1));
      const r = new Random(`story-shown-${pystr(get(rc, "seed", 0))}-${pystr(pid)}`).random();
      const u = kind === "bloomer" ? r * persona.BLOOM_SHOWN : 1.0 - r * persona.COMEBACK_SHOWN;
      const comp = round(recruits.from_quantiles(bands[String(shown)], u), 4);
      p["real"] = { stars: p["stars"], composite: p["composite"] };
      p["stars"] = shown;
      p["composite"] = Math.min(comp, p["composite"]);
      p["nil_ask"] = recruiting.nil_ask(p, rc["year"], get(rc, "seed", 0));
    }
  }
  persona.rerank(rc);
  rc["stories"] = 1;
  persona._STORIES = [rc, _stories_key(state, rc), drawn];
}


// his History's sentence when your staff finds out (a public story is never news to them)
const STORY_LEARNED = { legacy: "Your staff learned he is a legacy at {school}.",
  hero: "Your staff learned he is a hometown hero.",
  package: "Your staff learned he and {mate} want to go together.",
  two_sport: "Your staff learned he could go pro in baseball.",
  comeback: "Your staff learned he is coming back from an injury.",
  bloomer: "Your staff learned he is a late bloomer." };


// ----- what his story changes in recruiting (hooks in recruiting.js) ----------------------------------

const STAR_WORD = { 2: "two", 3: "three", 4: "four", 5: "five" };
// persona._SCHOOL_STATE: each school's state, kept once read


export function school_state(slug) {
  let s = get(persona._SCHOOL_STATE, slug);
  if (s === null) {
    const season = modules.season;
    s = persona._SCHOOL_STATE[slug] = or_(get(or_(get(season.load_teams(), slug), {}), "state"), "");
  }
  return s;
}


export function story_interest(state, slug, pid, pull) {
  // His pull toward the school (interest before list points) as his story reads it: a Hometown Hero's
  // toward a school in his state HERO_STATE times; his legacy school LEGACY_HEAD points ahead (a head
  // start, not a place on his list: the school still has to recruit him).
  const [k, d] = persona.story(state, pid);
  if (k === "hero" && persona.school_state(slug) === persona.hero_state(state, pid, d)) return pull * persona.HERO_STATE;     // his state moves with a Family Move
  if (k === "legacy" && slug === get(d, "school")) return pull + persona.LEGACY_HEAD;
  return pull;
}


export function story_mult(state, slug, pid, pitch) {
  // What his story does to the school's contact (before diminishing returns): another school's Coach or
  // Prestige pitch against a legacy, an out-of-state school's pitch to a hero (not Playing Time or NIL),
  // any contact from a school that reached a comeback early.
  const [k, d] = persona.story(state, pid);
  if (k === null) return 1.0;
  if (k === "legacy" && within(pitch, ["coach", "prestige"]) && slug !== get(d, "school")) return persona.LEGACY_PITCH;
  if (k === "hero" && pitch !== null && pitch !== undefined && !within(pitch, persona.HERO_FULL)
    && persona.school_state(slug) !== persona.hero_state(state, pid, d)) return persona.HERO_AWAY;
  if (k === "comeback" && truthy(get(or_(get(or_(get(state["recruiting"]["contacts"], pid), {}), slug), {}), "loyal"))) return persona.LOYALTY;
  return 1.0;
}


export function note_contact(state, slug, pid, contact, pitch) {
  // What a contact leaves on the school's record with him: a comeback remembers who reached him before
  // LOYALTY_WEEK; a Two-Sport recruit counts the school's Playing Time pitches (his draft risk).
  const [k, _] = persona.story(state, pid);
  if (k === "comeback" && state["current_week"] < persona.LOYALTY_WEEK) contact["loyal"] = true;
  else if (k === "two_sport" && pitch === "playing_time") contact["pt"] = get(contact, "pt", 0) + 1;
}


export function lowball_weeks(state, slug, pid) {
  // How long a lowball cools him on the school: LEGACY_COST times longer from his legacy school.
  const recruiting = modules.recruiting;
  const [k, d] = persona.story(state, pid);
  return round(recruiting.COOL_WEEKS * (k === "legacy" && get(d, "school") === slug ? persona.LEGACY_COST : 1.0));
}


export function draft_risk(state, slug, pid) {
  // A Two-Sport recruit's chance to go pro in baseball if he signs with the school: DRAFT_RISK less
  // DRAFT_PT for each of its Playing Time pitches and DRAFT_NIL per his ask's worth of its NIL over his
  // ask, never under DRAFT_FLOOR; 0 for anyone else.
  const recruiting = modules.recruiting;
  if (persona.story(state, pid)[0] !== "two_sport") return 0.0;
  const rc = state["recruiting"];
  const c = or_(get(or_(get(rc["contacts"], pid), {}), slug), {});
  const held = within(pid, get(rc["offers"], slug, [])) ? get(get(get(rc["nil"], slug, {}), "held", {}), pid, 0) : 0;
  const over = Math.max(0.0, held / Math.max(5, recruiting.ask_from(state, slug, pid)) - 1);
  return Math.max(persona.DRAFT_FLOOR, persona.DRAFT_RISK - persona.DRAFT_PT * get(c, "pt", 0) - persona.DRAFT_NIL * over);
}


export function draft_word(risk) {
  for (const [at, w] of persona.DRAFT_WORDS) if (risk >= at) return w;
  throw new Error("StopIteration");                 // (a risk under zero: there is no word for it)
}


export function goes_pro(state, slug, pid) {
  // His one roll (`draft-{seed}-{pid}`) against his draft risk with the school he signs with.
  if (persona.story(state, pid)[0] !== "two_sport") return false;
  return new Random(`draft-${pystr(get(state["recruiting"], "seed", 0))}-${pystr(pid)}`).random() < persona.draft_risk(state, slug, pid);
}


export function ai_doubts(state, slug, pid) {
  // An AI school that doubts a comeback's knee does not offer him (COMEBACK_AI of them do): a fixed draw
  // per school (`comeback-{seed}-{slug}-{pid}`). Never your school.
  if (slug === get(state, "team") || persona.story(state, pid)[0] !== "comeback") return false;
  return new Random(`comeback-${pystr(get(state["recruiting"], "seed", 0))}-${pystr(slug)}-${pystr(pid)}`).random() >= persona.COMEBACK_AI;
}


export function read_mult(state, pid, group) {
  // A look's error on a comeback's potential is COMEBACK_READ times the usual.
  return group === "potential" && persona.story(state, pid)[0] === "comeback" ? persona.COMEBACK_READ : 1.0;
}


// persona._FRONT: (the class's stories, the boards' fronts worked out from them)


export function board_front(state, slug) {
  // The prospects an AI school adds to its board for their story, (at the front, at the end): its legacies at a star
  // level it recruits (its share of that level at least LEGACY_LEVEL of the nation's: a blue blood does not
  // take a two-star for his father) at the front; the four- and five-star Hometown Heroes of its state at the end
  // (their pull toward it, HERO_STATE, does the rest).
  const recruiting = modules.recruiting;
  const drawn = persona.stories(state);
  if (persona._FRONT[0] !== drawn) {
    const pros = state["recruiting"]["prospects"];
    const front = new Map();                         // (keyed by a school, or by ("state", its state))
    const add = (key, pid) => { if (!front.has(key)) front.set(key, []); front.get(key).push(pid); };
    for (const [pid, s] of Object.entries(drawn)) {
      if (s["story"] === "legacy") {
        const school = s["story_data"]["school"], tier = pros[pid]["stars"];
        const share = get(or_(get(recruiting._team_model(school), "star_share"), {}), dget(recruiting.STAR_KEY, tier, "2*"), 0.0);
        if (share >= persona.LEGACY_LEVEL * recruiting._national_share(tier)) add(tuple_key("school", school), pid);
      } else if (s["story"] === "hero" && pros[pid]["stars"] >= 4) {
        add(tuple_key("state", s["story_data"]["state"]), pid);
      }
    }
    persona._FRONT = [drawn, front];
  }
  const front = persona._FRONT[1];
  return [front.get(tuple_key("school", slug)) ?? [], front.get(tuple_key("state", persona.school_state(slug))) ?? []];
}


export function bloom(state, week) {
  // The Late Bloomers whose jump is this week's step: each takes his real stars and composite (and the
  // NIL ask that goes with them), is no longer hidden, and the class is re-ranked (rc["class_v"] moves, so
  // the star-level caches start over); the jump is public (a "bloomed" event) and the BLOOM_BOARDS AI
  // schools he fits best add him at the front of their boards. Returns who jumped.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const jumped = [];
  for (const [pid, s] of Object.entries(persona.stories(state))) {
    if (s["story"] !== "bloomer" || s["story_data"]["week"] !== week) continue;
    const p = rc["prospects"][pid];
    const real = get(p, "real");
    if (!truthy(real)) continue;
    p["stars"] = real["stars"];
    p["composite"] = real["composite"];
    delete p["real"];
    p["hidden"] = false;
    p["nil_ask"] = recruiting.nil_ask(p, rc["year"], get(rc, "seed", 0));
    jumped.push(pid);
  }
  if (!jumped.length) return [];
  persona.rerank(rc);
  rc["class_v"] = get(rc, "class_v", 0) + 1;
  clear_cache(recruiting._ASKS);
  const me = get(state, "team");
  const schools = recruiting.fbs_schools(state).filter((s) => s !== me);
  for (const pid of sorted(jumped, (q) => rc["prospects"][q]["rank"])) {
    const p = rc["prospects"][pid];
    recruiting._event(state, "bloomed", pid, null, { stars: p["stars"], line: `He jumped to ${persona.STAR_WORD[p["stars"]]} stars.` });
    const st = rc["status"][pid];
    if (truthy(st["committed"]) || truthy(st["signed"])) continue;
    const best = sorted(schools, (s) => [-dget(recruiting._fits(state, s), pid, 0.0), s]).slice(0, persona.BLOOM_BOARDS);
    for (const s of best) {                          // a new blue chip goes to the front; a new three-star joins the end
      if (rc["boards"][s] === undefined) rc["boards"][s] = [];
      const board = rc["boards"][s];
      if (!within(pid, board)) {
        if (p["stars"] >= 4) board.unshift(pid);
        else board.push(pid);
      }
    }
  }
  return jumped;
}


export function pro_line(state, slug) {
  // His History's line when he goes pro in baseball instead of signing with the school.
  const season = modules.season;
  return `He chose pro baseball over ${pystr(get(or_(get(season.load_teams(), slug), {}), "name", slug))}.`;
}


// ----- commit style (spec section 3): how he commits -------------------------------------------------
// A fixed draw per prospect (its own stream `style-{seed}-{pid}`), worked out when asked and never stored:
// a test (or a save) may set it on his persona as "commit_style". The transfer portal has none (an entrant
// decides inside four weeks). What is stored: a Hat Ceremony's date and finalists (rc["hats"]) and the week
// you offered him (rc["offer_weeks"], your school's only: four weeks holding it shows you his style).

const STYLES = { early_bird: 0.2, signing_day: 0.2, hat: 0.2, quiet: 0.2, needs_attention: 0.2 };   // *tune* each style's share of the class
const STYLE_LABEL = { early_bird: "Early Bird", signing_day: "Signing Day", hat: "Hat Ceremony", quiet: "Quiet Commit",
  needs_attention: "Needs Attention" };
const EARLY_ODDS = 3.0;           // *tune* an Early Bird's weekly commit odds in EARLY_WEEKS, times the usual
const EARLY_WEEKS = [4, 8];       // the weeks an Early Bird looks to commit (inclusive)
const EARLY_FIRM = 15;            // *tune* an Early Bird starts his commitment this far under recruiting.HARD_AT
const HAT_LEAD = 2;               // *tune* weeks between a Hat Ceremony's announcement and the hat (never past the early signing period)
const HAT_FINALISTS = 3;          // the schools he names; only they can win
const NEEDS_DROP = 6;             // *tune* a Needs Attention commit's firmness lost each week his school goes quiet
const NEEDS_SILENT = 3;           // *tune* weeks of silence that make even his hard commit flippable again
const STYLE_OFFER_WEEKS = 4;      // *tune* your offer held this many weeks shows you his commit style (as an official visit does)
const STYLE_LEARNED = { early_bird: "Your staff learned he wants to commit early.",
  signing_day: "Your staff learned he will wait for signing day.",
  hat: "Your staff learned he plans a hat ceremony.",
  quiet: "Your staff learned he will commit quietly.",
  needs_attention: "Your staff learned he needs to hear from you every week." };


// (@lru_cache(maxsize=40000), as _drawn above)
const _style_cache = new Map();
export function _style_drawn(pid, seed) {
  const key = tuple_key(pid, typeof seed === "string" ? `s:${seed}` : seed);
  let k = _style_cache.get(key);
  if (k === undefined) {
    k = new Random(`style-${pystr(seed)}-${pystr(pid)}`).choices(Object.keys(persona.STYLES), { weights: Object.values(persona.STYLES) })[0];
    if (_style_cache.size >= 40000) _style_cache.delete(_style_cache.keys().next().value);
    _style_cache.set(key, k);
  }
  return k;
}


export function draw_style(pid, seed) {
  // His commit style: a fixed draw from the class seed and his id.
  return persona._style_drawn(pid, seed);
}


export function style(state, pid) {
  // His commit style (None in the portal): the one a test or a save set on his persona, else his draw.
  const rc = state["recruiting"];
  if (truthy(get(rc, "portal"))) return null;
  const forced = get(or_(get(rc["prospects"], pid), {}), "persona");
  if (truthy(forced) && truthy(get(forced, "commit_style"))) return forced["commit_style"];
  return persona._style_drawn(pid, get(rc, "seed", 0));
}


export function commit_odds_mult(state, pid, week) {
  // An Early Bird's commit odds in Weeks 4-8: EARLY_ODDS times the usual.
  return persona.EARLY_WEEKS[0] <= week && week <= persona.EARLY_WEEKS[1] && persona.style(state, pid) === "early_bird" ? persona.EARLY_ODDS : 1.0;
}


export function start_firmness(state, pid, firmness) {
  // How firm he is the week he commits: an Early Bird starts EARLY_FIRM under a hard commit.
  const recruiting = modules.recruiting;
  return persona.style(state, pid) === "early_bird" ? Math.max(firmness, recruiting.HARD_AT - persona.EARLY_FIRM) : firmness;
}


export function waits(state, pid, week) {
  // A Signing Day recruit commits to no one before the early signing day.
  const recruiting = modules.recruiting;
  return week < recruiting.early_signing_week() && persona.style(state, pid) === "signing_day";
}


export function signs_now(state, pid, week) {
  // A Signing Day recruit on signing day: he takes his leader, no roll.
  const recruiting = modules.recruiting;
  return week >= recruiting.early_signing_week() && persona.style(state, pid) === "signing_day";
}


export function is_quiet(state, pid) {
  return persona.style(state, pid) === "quiet";
}


export function hidden_from(state, viewer, pid) {
  // A Quiet Commit's commitment is his and his school's: every other school sees him as "Quiet", not where.
  const st = state["recruiting"]["status"][pid];
  return truthy(st["committed"]) && !truthy(st["signed"]) && !within(st["committed"], [viewer, "FCS"]) && persona.is_quiet(state, pid);
}


export function quiet_mark(state, pid) {
  // The mark a Quiet Commit's commitment events carry: kept out of the news and every other school's view.
  return persona.is_quiet(state, pid) ? { quiet: true } : {};
}


export function shown_to(e, viewer) {
  // Whether a log event is the viewer's to see: a quiet commitment, or a twist he told one school, only that school's.
  return !(truthy(get(e, "quiet")) || truthy(get(e, "private"))) || get(e, "school") === viewer;
}


export function climbs(state, slug, pid, points) {
  // A Quiet Commit's interest in the other schools stops climbing: their gains are lost (a loss still lands).
  if (points <= 0) return points;
  const st = state["recruiting"]["status"][pid];
  if (truthy(st["committed"]) && !truthy(st["signed"]) && !within(st["committed"], [slug, "FCS"]) && persona.is_quiet(state, pid)) return 0.0;
  return points;
}


export function needs_attention(state, pid) {
  return persona.style(state, pid) === "needs_attention";
}


export function learn_styles(state, week) {
  // Your staff learns a prospect's commit style after an official visit with you, or once he has held
  // your offer STYLE_OFFER_WEEKS weeks.
  const rc = state["recruiting"];
  const me = get(state, "team");
  if (truthy(get(rc, "portal")) || !truthy(me)) return;
  const held = or_(get(rc, "offer_weeks"), {});
  for (const pid of get(rc["offers"], me, [])) {
    if (held[pid] !== undefined && week - held[pid] >= persona.STYLE_OFFER_WEEKS) persona.learn(state, me, pid, "style");
  }
  for (const [pid, by] of Object.entries(rc["visits"])) {
    if (truthy(get(or_(get(by, me), {}), "done"))) persona.learn(state, me, pid, "style");
  }
}


// ----- twists (spec section 3): what happens to him along the way --------------------------------------
// A weekly roll per uncommitted prospect on any board (`twists-{seed}-{week}`, its own stream, at the end
// of the week's step), TWIST_RATE by his real stars: about one twist a recruit a season, more for the blue
// chips. One at a time; the active one is kept small in the save: rc["twists"][pid] = {"k": kind, "s": the
// school it is about, "w": weeks left, and a few of the kind's own}. A Family Move is kept for good in
// rc["moved"][pid] (his new home). Every school plays by the same twists.

const TWISTS = { surprise: 0.15, at_game: 0.14, hot_seat: 0.10, late_offer: 0.30, family_move: 0.05,
  grades: 0.06, beat: 0.20 };    // *tune* each twist's weight among those that can happen to him
const TWIST_RATE = { 5: 0.24, 4: 0.20, 3: 0.15, 2: 0.12 };   // *tune* a prospect's weekly chance of a twist by his real stars
const TWIST_TRIES = 2;            // *tune* a roll that hits draws a twist by weight; one that cannot happen to him draws once more, then none
const TWIST_LABEL = { surprise: "Surprise Visit", at_game: "At Your Game", hot_seat: "Hot Seat", late_offer: "New Offer",
  family_move: "Family Move", grades: "Grades Scare", beat: "Wants to See You Beat {foe}" };
const SURPRISE_WEEKS = 2;         // *tune* a surprise school sits in his top three this long, unless a top-three school calls or visits first
const SURPRISE_SPOT = [0.25, 0.35, 0.40];   // *tune* where in his top three it jumps: first, second, third
const SURPRISE_TILT = 3.0;        // *tune* the surprise school is drawn by exp(this x the program's strength) among his next five
const GAME_MILES = 400;           // *tune* a home game this close to him is one he goes to
const GAME_WIN = 1.3, GAME_BLOWOUT = 1.5;    // *tune* a win (by BLOWOUT or more) at his game: his interest in the school this much
const BLOWOUT = 21;
const GAME_CAP = 8.0;             // *tune* ... the gain never more than this many interest points (an official visit's worth)
const HOT_SEAT = 30;              // *tune* a head coach with AD security under this is on the hot seat (carousel)
const HOT_SEAT_WEEKS = 3;
const HOT_SEAT_PITCH = 2.0;       // *tune* another school's Coach pitch counts this much more against a hot-seat school
const LATE_ASK = 1.10;            // *tune* a late blue-blood offer raises his ask this much
const LATE_FROM = 4;              // *tune* a blue blood offers late only a prospect of this many real stars or more (3 filled the blue bloods with three-stars)
const GRADES_WEEKS = 3;
const GRADES_PITCH = 2.0;         // *tune* an Academics pitch from a school outside ACADEMIC counts this much more during a Grades Scare
const BEAT_AHEAD = 3;             // he names one of the school's next this many opponents
const BEAT_WIN = 5.0, BEAT_LOSS = 3.0;   // *tune* interest points the school he told gains with the win, loses with the loss


export function _teams() {
  const season = modules.season;
  return season.load_teams();
}


export function _rival_name(slug) {
  return truthy(slug) ? persona._school_name(slug) : "";
}


export function _twist(state, pid) {
  const tw = get(state["recruiting"], "twists");
  return truthy(tw) ? get(tw, pid) : null;
}


export function twist_bonus(state, slug, pid) {
  // A Surprise Visit's school sits in his top three: interest points over its own while it lasts.
  const tw = persona._twist(state, pid);
  return truthy(tw) && tw["k"] === "surprise" && tw["s"] === slug ? tw["b"] : 0.0;
}


export function twist_mult(state, slug, pid, pitch) {
  // What his twist does to a pitch's worth: another school's Coach pitch against a hot-seat school, an
  // Academics pitch from a school outside ACADEMIC during a Grades Scare.
  const tw = persona._twist(state, pid);
  if (!truthy(tw) || pitch === null || pitch === undefined) return 1.0;
  if (tw["k"] === "hot_seat" && pitch === "coach" && slug !== tw["s"]) return persona.HOT_SEAT_PITCH;
  if (tw["k"] === "grades" && pitch === "academics") {
    const recruiting = modules.recruiting;
    return !truthy(recruiting.academic(slug)) ? persona.GRADES_PITCH : 1.0;
  }
  return 1.0;
}


export function scared_off(state, slug, pid) {
  // An academic AI school keeps a prospect with a Grades Scare off its board while it lasts.
  const tw = persona._twist(state, pid);
  if (!truthy(tw) || tw["k"] !== "grades" || slug === get(state, "team")) return false;
  const recruiting = modules.recruiting;
  return recruiting.academic(slug);
}


export function knock_back(state, slug, pid, action) {
  // A call or in-home visit from a school that was in his top three knocks a Surprise Visit's school back out.
  const tw = persona._twist(state, pid);
  if (!truthy(tw) || tw["k"] !== "surprise" || !within(slug, get(tw, "r", []))) return;
  delete state["recruiting"]["twists"][pid];
  if (slug === get(state, "team")) {
    const recruiting = modules.recruiting;
    const what = action === "hc_visit" ? "visit" : "call";
    recruiting._event(state, "twist", pid, slug, { twist: "surprise", end: true, line: `Your ${what} knocked ${persona._rival_name(tw["s"])} back out of his top three.` });
  }
}


export function moved(state, pid) {
  // His new home after a Family Move ({"state", "city", "home"}), or None.
  const m = get(state["recruiting"], "moved");
  return truthy(m) ? get(m, pid) : null;
}


export function home_of(state, p) {
  // Where he lives now: his new home after a Family Move, else his own.
  const m = persona.moved(state, p["id"]);
  return truthy(m) ? m["home"] : p["home"];
}


export function hero_state(state, pid, d) {
  // A Hometown Hero's state: it moves with his family.
  const m = persona.moved(state, pid);
  return truthy(m) ? m["state"] : get(d, "state");
}


export function security(state, slug) {
  // The head coach's AD security at the school (carousel.ad), read without drawing it into the save: the
  // career league's (a second season on), else the standing a first season starts from (carousel.STANDING:
  // nobody is on the hot seat in year one).
  const carousel = modules.carousel;
  const season = modules.season;
  const t = or_(get(or_(get(or_(get(state, "league"), {}), "teams"), {}), slug), null) || get(season.load_teams(), slug);
  if (!truthy(t) || !truthy(get(or_(get(t, "coaches"), {}), "head_coach"))) return null;
  const a = or_(get(t, "ad"), null) || carousel.ad({ ...t }, slug, season.season_year(state));
  return get(a, "security");
}


export class _Week {
  // What a week's twists read, worked out once a step and only when asked: the coming games by school,
  // the hometowns a family can move to, the head coaches' security.

  constructor(state, week) {
    this.state = state;
    this.week = week;
    this._games = null;
    this._homes = null;
    this._sec = {};
  }

  games() {
    if (this._games === null) {
      const by = {};
      for (const g of Object.values(this.state["games"])) {
        if (truthy(g["played"]) || get(g, "kind") !== "regular" || !(this.week < g["week"] && g["week"] <= this.week + persona.BEAT_AHEAD)) continue;
        if (by[g["home"]] === undefined) by[g["home"]] = [];
        by[g["home"]].push(g);
        if (by[g["away"]] === undefined) by[g["away"]] = [];
        by[g["away"]].push(g);
      }
      for (const v of Object.values(by)) v.sort((a, b) => cmp([a["week"], get(a, "event_id", "")], [b["week"], get(b, "event_id", "")]));
      this._games = by;
    }
    return this._games;
  }

  homes() {
    if (this._homes === null) {
      const seen = new Map();                        // (keyed by (state, city): the first home there)
      for (const p of Object.values(this.state["recruiting"]["prospects"])) {
        const h = p["hometown"];
        if (truthy(get(h, "city")) && truthy(get(h, "state"))) {
          const key = tuple_key(h["state"], h["city"]);
          if (!seen.has(key)) seen.set(key, [h["state"], h["city"], p["home"]]);
        }
      }
      this._homes = sorted(Array.from(seen.values(), ([s, c, home]) => [s, c, Array.from(home)]));
    }
    return this._homes;
  }

  security(slug) {
    if (this._sec[slug] === undefined) this._sec[slug] = persona.security(this.state, slug);
    return this._sec[slug];
  }
}


export function _his_schools(state, pid) {
  // His schools (offered him or on his list), best first by interest, and their interest.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const schools = new Set(Object.keys(rc["lists"][pid]));
  for (const [s, pids] of Object.entries(rc["offers"])) if (within(pid, pids)) schools.add(s);
  const win = recruiting._winning(state);
  const vals = {};
  for (const s of schools) vals[s] = recruiting.interest(state, s, pid, win);
  return [sorted(schools, (s) => [-vals[s], s]), vals];
}


export function _setup(state, wk, pid, kind, rng) {
  // The twist `kind` happens to him if it can: (its active record, its line) once it took effect; else None.
  const programs = modules.programs, recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const me = get(state, "team");
  const week = wk.week;
  const [order, vals] = persona._his_schools(state, pid);
  const offered = new Set();
  for (const [s, pids] of Object.entries(rc["offers"])) if (within(pid, pids)) offered.add(s);
  if (kind === "surprise") {                       // a school outside his top three (one that offered, if any) jumps into it
    if (order.length < 4) return null;
    const rest = order.slice(3);
    const theirs = rest.filter((s) => offered.has(s));
    const outside = (theirs.length ? theirs : rest).slice(0, 5);
    const school = rng.choices(outside, { weights: outside.map((s) => Math.exp(persona.SURPRISE_TILT * recruiting._baseline(s))) })[0];   // the big programs make the surprise trips
    const spot = rng.choices([0, 1, 2], { weights: persona.SURPRISE_SPOT })[0];
    const top3 = order.slice(0, 3);
    const target = spot === 0 ? vals[top3[0]] + 0.5 : (vals[top3[spot - 1]] + vals[top3[spot]]) / 2;
    const bonus = Math.max(0.0, round(target - vals[school], 3));
    return [{ k: kind, s: school, w: persona.SURPRISE_WEEKS, b: bonus, r: top3 },
      `${persona._rival_name(school)} made a surprise visit and jumped into his top three.`];
  }
  if (kind === "at_game") {                        // one of his top five plays at home next week, close to him
    const home = persona.home_of(state, p);
    const ok = [];
    for (const s of order.slice(0, 5)) {
      const g = get(wk.games(), s, []).find((g) => g["home"] === s && g["week"] === week + 1) ?? null;
      const loc = get(recruiting._team_model(s), "location");
      if (truthy(g) && truthy(loc) && recruiting._miles(Array.from(home), Array.from(loc)) <= persona.GAME_MILES) ok.push([s, g]);
    }
    if (!ok.length) return null;
    const [s, g] = rng.choice(ok);
    return [{ k: kind, s, w: 1, g: g["week"], o: g["away"] },
      `He plans to be at ${persona._rival_name(s)}'s home game against ${persona._foe_name(g["away"])} this week.`];
  }
  if (kind === "hot_seat") {                       // his leader's head coach is on the hot seat
    const leader = order.length ? order[0] : null;
    const sec = truthy(leader) ? wk.security(leader) : null;
    if (sec === null || sec >= persona.HOT_SEAT) return null;
    return [{ k: kind, s: leader, w: persona.HOT_SEAT_WEEKS },
      `Talk that ${persona._rival_name(leader)}'s head coach is on the hot seat has his other schools selling stability.`];
  }
  if (kind === "late_offer") {                     // a blue blood that had not offered does, and he wants more
    if (persona._real(p)[0] < persona.LATE_FROM) return null;
    const commits = recruiting._commits(state);
    const blue = recruiting.fbs_schools(state).filter((s) => s !== me && !offered.has(s) && programs.get(state, s)["tier"] === 1
      && get(commits, s, 0) < recruiting.open_spots(state, s) && get(rc["offers"], s, []).length < recruiting.offer_cap(state, s));
    if (!blue.length) return null;
    const win = recruiting._winning(state);
    const keyed = blue.map((s) => [[-recruiting.interest(state, s, pid, win), s], s]);
    keyed.sort((a, b) => cmp(a[0], b[0]));
    const school = rng.choice(keyed.slice(0, 3).map((x) => x[1]));
    const nil = Math.min(recruiting.nil_left(state, school), round(recruiting._nil(state, school)["budget"] * dget(recruiting.AI_NIL, recruiting.tier_of(p), 0)),
      round(recruiting.AI_OVER_ASK * recruiting.ask_from(state, school, pid, win)));
    try {
      recruiting._act(state, school, pid, "offer", recruiting.best_pitch(state, school, pid, true), Math.max(0, nil));
    } catch (e) {
      if (e instanceof recruiting.RecruitingError) return null;
      throw e;
    }
    const rest = order.filter((s) => s !== school).map((s) => vals[s]);
    const target = rest.length ? (rest.length > 1 ? rest[1] : rest[0] - 0.5) + 0.5 : 0.0;     // in at his second spot
    const now = recruiting.interest(state, school, pid);
    if (target > now) rc["lists"][pid][school] = round(get(rc["lists"][pid], school, 0.0) + target - now, 3);
    if (truthy(get(p, "nil_ask"))) p["nil_ask"] = round(p["nil_ask"] * persona.LATE_ASK);     // (recruiting._ASKS keys on his ask: no cache to clear)
    return [{ k: kind, s: school, w: 1 },
      `${persona._rival_name(school)} offered and jumped near the top of his list, and his NIL ask went up.`];
  }
  if (kind === "family_move") {                    // a new home in another state: proximity and a hero's state move with it
    const cur = or_(get(or_(persona.moved(state, pid), {}), "state"), null) || p["hometown"]["state"];
    const homes = wk.homes().filter((h) => h[0] !== cur);
    if (!homes.length) return null;
    const [st_, city, home] = rng.choice(homes);
    if (rc["moved"] === undefined) rc["moved"] = {};
    rc["moved"][pid] = { state: st_, city, home };
    return [{ k: kind, s: null, w: 1 }, `His family moved to ${city}, ${st_}.`];
  }
  if (kind === "grades") {                         // the academic AI schools drop him (their offers too) while it lasts
    if (!recruiting.academic_schools().some((s) => s !== me && (offered.has(s) || within(pid, or_(get(rc["boards"], s), []))))) {
      return null;                                 // no academic school is after him: nothing to scare off
    }
    for (const s of recruiting.academic_schools()) {
      if (s === me) continue;
      const board = get(rc["boards"], s);
      if (truthy(board) && within(pid, board)) board.splice(board.indexOf(pid), 1);
      if (within(pid, get(rc["offers"], s, []))) {
        rc["offers"][s].splice(rc["offers"][s].indexOf(pid), 1);
        recruiting._unmark(state, s, pid);
        const held = get(get(rc["nil"], s, {}), "held", {});
        delete held[pid];
      }
    }
    return [{ k: kind, s: null, w: persona.GRADES_WEEKS }, "A grades scare has the academic schools backing off him."];
  }
  if (kind === "beat") {                           // he tells one of his top three which of its next opponents to beat
    const teams = persona._teams();
    // an opponent worth naming: an FBS team (an FCS stand-in is no measuring stick)
    const cands = [];
    for (const s of order.slice(0, 3)) {
      for (const g of get(wk.games(), s, [])) {
        if (!truthy(get(or_(get(teams, g["home"] === s ? g["away"] : g["home"]), {}), "fictional"))) cands.push([s, g]);
      }
    }
    if (!cands.length) return null;
    const [s, g] = rng.choice(cands);
    const opp = g["home"] === s ? g["away"] : g["home"];
    return [{ k: kind, s, w: g["week"] - week, g: g["week"], o: opp },
      `He told ${persona._rival_name(s)} he wants to see them beat ${persona._rival_name(opp)}.`];
  }
  return null;
}


export function roll_twists(state, week) {
  // The week's twists, at the end of its step: every uncommitted prospect on a board (any school's)
  // without one rolls TWIST_RATE (his real stars); one that hits draws a twist by weight, TWIST_TRIES times
  // at most, until one can happen to him (a twist that needs schools or games he lacks cannot). Logged as "twist" events (a Wants to See You Beat X is private to the school he told). Returns them.
  const recruiting = modules.recruiting;
  const season = modules.season;
  const rc = state["recruiting"];
  if (truthy(get(rc, "portal")) || week >= season.FINAL_WEEK) return [];
  if (rc["twists"] === undefined) rc["twists"] = {};
  const active = rc["twists"];
  const pool = new Set(or_(get(rc, "board"), []));
  for (const b of Object.values(rc["boards"])) for (const q of b) pool.add(q);
  const rng = recruiting._rng(state, "twists");
  const wk = new persona._Week(state, week);
  const out = [];
  const pros = rc["prospects"];
  for (const pid of sorted(pool, (q) => [pros[q]["rank"], q])) {
    const st = rc["status"][pid];
    if (truthy(st["signed"]) || truthy(st["committed"]) || active[pid] !== undefined) continue;
    if (rng.random() >= get(persona.TWIST_RATE, persona._real(pros[pid])[0], persona.TWIST_RATE[2])) continue;
    const left = { ...persona.TWISTS };
    for (let _ = 0; _ < persona.TWIST_TRIES; _++) {
      const kind = rng.choices(Object.keys(left), { weights: Object.values(left) })[0];
      delete left[kind];
      const got = persona._setup(state, wk, pid, kind, rng);
      if (truthy(got)) {
        const [tw, line] = got;
        active[pid] = tw;
        out.push(recruiting._event(state, "twist", pid, get(tw, "s"), { twist: kind, line, ...(kind === "beat" ? { private: true } : {}) }));
        break;
      }
    }
  }
  return out;
}


export function twist_week(state, week) {
  // The start of the week's step: an At Your Game or a Wants to See You Beat X plays out with the game
  // just played; every twist has a week less, and the ones run out end.
  const rc = state["recruiting"];
  const active = get(rc, "twists");
  if (!truthy(active)) return;
  for (const pid of sorted(Object.keys(active))) {
    const tw = active[pid];
    if (within(tw["k"], ["at_game", "beat"]) && get(tw, "g") === week) persona._game_twist(state, pid, tw, week);
    tw["w"] -= 1;
    if (tw["w"] <= 0) delete active[pid];
  }
}


export function _game_twist(state, pid, tw, week) {
  // His game played out: At Your Game, a win GAME_WIN (a blowout GAME_BLOWOUT) on his interest in the
  // school, a loss cools him a week; Wants to See You Beat X, BEAT_WIN for the win, BEAT_LOSS off for the loss.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const s = tw["s"], opp = tw["o"];
  // ({g["home"], g["away"]} == {s, opp}: the same two schools, either way round)
  const same_pair = (g) => (g["home"] === s || g["home"] === opp) && (g["away"] === s || g["away"] === opp)
    && (s === g["home"] || s === g["away"]) && (opp === g["home"] || opp === g["away"]);
  const g = Object.values(state["games"]).find((g) => g["week"] === week && truthy(g["played"]) && same_pair(g)) ?? null;
  if (g === null || truthy(rc["status"][pid]["signed"])) return;
  const mine = g["home"] === s ? g["home_score"] - g["away_score"] : g["away_score"] - g["home_score"];
  const name = persona._rival_name(s), foe = persona._foe_name(opp);
  const lst = rc["lists"][pid];
  let line;
  if (tw["k"] === "at_game") {
    if (mine > 0) {
      const mult = mine >= persona.BLOWOUT ? persona.GAME_BLOWOUT : persona.GAME_WIN;
      const gain = persona.climbs(state, s, pid, Math.min(persona.GAME_CAP, (mult - 1) * Math.max(0.0, recruiting.interest(state, s, pid))));
      lst[s] = round(get(lst, s, 0.0) + gain, 3);
      line = mine >= persona.BLOWOUT ? `He watched ${name} blow out ${foe} and loved every minute.` : `He watched ${name} beat ${foe} and came away impressed.`;
    } else {
      recruiting._contact(state, s, pid)["cooled_until"] = week + 1;
      persona.set_cooled_why(state, s, pid, "game");
      line = `He watched ${name} lose to ${foe} and left cooler on them.`;
    }
    recruiting._event(state, "twist", pid, s, { twist: "at_game", end: true, line });
  } else {
    if (mine > 0) {
      lst[s] = round(get(lst, s, 0.0) + persona.climbs(state, s, pid, persona.BEAT_WIN), 3);
      line = `${name} beat ${foe}, just as he hoped.`;
    } else {
      lst[s] = round(get(lst, s, 0.0) - persona.BEAT_LOSS, 3);
      line = `${name} lost to ${foe}, and he noticed.`;
    }
    recruiting._event(state, "twist", pid, s, { twist: "beat", end: true, line, private: true });
  }
}


export function twist_label(tw) {
  return format(persona.TWIST_LABEL[tw["k"]], { foe: persona._rival_name(get(tw, "o")) });
}


export function twist_view(state, viewer, pid) {
  // His twist as `viewer` sees it on his profile and in the pane, or None (Wants to See You Beat X: only
  // the school he told): {"key", "label", "line", "weeks_left"}, the line its latest one.
  const tw = persona._twist(state, pid);
  if (!truthy(tw) || (tw["k"] === "beat" && tw["s"] !== viewer)) return null;
  let line = null;
  const log = state["recruiting"]["log"];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e["pid"] === pid && e["kind"] === "twist" && get(e, "twist") === tw["k"] && persona.shown_to(e, viewer)) {
      line = get(e, "line");
      break;
    }
  }
  return { key: tw["k"], label: persona.twist_label(tw), line, weeks_left: tw["w"] };
}


export const persona = {
  DECIDERS_ON, PERSONALITIES, PERSONALITY_LABEL, DECIDERS, DECIDER_LABEL, PORTAL_DECIDERS, _TOPICS_BEFORE_GRADES, DECIDER_TOPICS, _TOPICS_BEFORE_PRO,
  draw, _drawn, of,
  ATTENTION_GAP, COCKY_PITCH, SHY_VISIT, SHY_FIRST_CALL, BUSINESS_MESSAGE, BUSINESS_OFFER, DECIDER_VISIT, COCKY_LOWBALL, TRAINER_LOWBALL,
  TRAINER_OVER, COCKY_HOLLOW, ATTENTION_PESTER_FREE, GUARDED_DECOMMIT,
  pitch_mult, counts_as_priority, lowball_share, nil_over, offer_mult, hollow_mult, pester_free, call_reveals, decommit_mult, cool_quiet,
  set_cooled_why, cooled_why,
  DECIDER_LOOKS, PERSONALITY_LINE, DECIDER_LINE,
  known, learn, learn_on_contact, learn_from_read, story_public, _name_of, _school_name, _foe_name, story_learned_line, story_detail, view,
  STORIES, STORY_RATE, STORY_LABEL, NO_STORY, PUBLIC_STORIES, TWO_SPORT_GROUPS, MATE_NEAR, LEGACY_TILT, LEGACY_HEAD, LEGACY_PITCH,
  LEGACY_LEVEL, LEGACY_COST, HERO_STATE, HERO_AWAY, HERO_FULL, DRAFT_RISK, DRAFT_FLOOR, DRAFT_PT, DRAFT_NIL, DRAFT_WORDS, COMEBACK_AI,
  LOYALTY, LOYALTY_WEEK, COMEBACK_READ, SHOWN_BAND, BLOOM_WEEKS, COMEBACK_SHOWN, BLOOM_SHOWN, BLOOM_BOARDS,
  _STORIES: [null, null, {}],
  _real, _eligible, _draw_class, stories, story, mate, rerank, apply_stories,
  STORY_LEARNED,
  STAR_WORD, _SCHOOL_STATE: {},
  school_state, story_interest, story_mult, note_contact, lowball_weeks, draft_risk, draft_word, goes_pro, ai_doubts, read_mult,
  _FRONT: [null, new Map()],
  board_front, bloom, pro_line,
  STYLES, STYLE_LABEL, EARLY_ODDS, EARLY_WEEKS, EARLY_FIRM, HAT_LEAD, HAT_FINALISTS, NEEDS_DROP, NEEDS_SILENT, STYLE_OFFER_WEEKS, STYLE_LEARNED,
  _style_drawn, draw_style, style, commit_odds_mult, start_firmness, waits, signs_now, is_quiet, hidden_from, quiet_mark, shown_to, climbs,
  needs_attention, learn_styles,
  TWISTS, TWIST_RATE, TWIST_TRIES, TWIST_LABEL, SURPRISE_WEEKS, SURPRISE_SPOT, SURPRISE_TILT, GAME_MILES, GAME_WIN, GAME_BLOWOUT, BLOWOUT,
  GAME_CAP, HOT_SEAT, HOT_SEAT_WEEKS, HOT_SEAT_PITCH, LATE_ASK, LATE_FROM, GRADES_WEEKS, GRADES_PITCH, BEAT_AHEAD, BEAT_WIN, BEAT_LOSS,
  _teams, _rival_name, _twist, twist_bonus, twist_mult, scared_off, knock_back, moved, home_of, hero_state, security, _Week,
  _his_schools, _setup, roll_twists, twist_week, _game_twist, twist_label, twist_view,
};

modules.persona = persona;

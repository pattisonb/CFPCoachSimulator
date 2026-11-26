// Recruiting, part 1: the constants, the class (start, priorities,
// NIL asks, generational prospects), the small reads (tiers, flag cuts, the recruiting calendar), what he asks of a
// school, pestering, and where he would line up on a roster.
//
// Coach Career recruiting (docs/superpowers/specs/2026-10-22-coach-career-design.md, sections 2-5): a generated class of
// high school seniors, every FBS school's pull on each of them, and (later parts of this file) the actions, the weekly
// step, signing and scouting.
//
// The recruiting state lives in `state["recruiting"]` (a Coach Career season only):
//     year, prospects {pid: prospect; "ratings" and "potential" on our scale (game_scale.js) as lists in `attrs` order},
//     lists {pid: {slug: action points}}, status {pid: {committed, signed, fcs}}, offers {slug: [pid]},
//     visits {pid: {slug: week}}, contacts {pid: {slug: {hc_week}}}, hours {slug: hours left},
//     nil {slug: {budget, held {pid: points}}}, revealed {slug: {pid: [topic]}}, board [pid], log [event]
// A prospect's interest in a school = his priorities' weights on the school's pulls (each 0-1)
// plus the points that school's actions have earned with him.
//
// Values marked *tune* are set by tools/check_recruiting.mjs against the real classes.
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { Random, round, int, cmp, sorted, get, truthy, odict } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { build_teams } from "../../teamdata_js/build_teams.js";
import { recruits } from "../recruits.js";
import { recruiting } from "../recruiting_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

/** `key in d` for a dict. */
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a tuple, list, set or dict (another part's constant, whatever shape it took). */
const _in = (x, coll) => (coll instanceof Set || coll instanceof Map ? coll.has(x) : Array.isArray(coll) ? coll.includes(x) : has(coll, x));

/** A tuple used as a cache key: its text (a number and the same digits as text stay apart). */
const _key = (...parts) => JSON.stringify(parts);

/** `a == b` for two dicts of JSON data (the order of keys does not count). */
function _equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => _equal(v, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && _equal(a[k], b[k]));
}

/** math.radians. */
const _RAD = Math.PI / 180.0;

// ----- the constants ------------------------------------------------------------------------------------------

recruiting.ROOT = ".";   // the project root
recruiting.PITCHES = ["proximity", "playing_time", "prestige", "winning", "nil", "coach", "pro", "academics",
  "facilities", "location", "stability", "game_day", "exposure",   // School Grades Phase 2: the five campus grades are topics too
  "contender", "recruiting", "development", "culture"];            // ... and the four added with the weekly grades (last: a saved class's draws read the list in order)
// This season's topics: a school's standing on each moves every week (recruiting.weekly), and a recruit's interest,
// his fit and whether he will hear from a school at all move with it (the player's rule).
recruiting.WEEKLY = ["winning", "contender", "recruiting"];
recruiting.NEUTRAL_PULL = 0.5;                         // *tune* a grade topic's pull at a program the research has no row for
recruiting.LOCATION_MATCH = 0.15;                      // *tune* Location's pull gains this for each tag (setting, climate) that matches his taste ...
recruiting.LOCATION_CLASH = 0.05;                      // *tune* ... and loses this for each that does not
recruiting.ACADEMIC_FROM = 70;                         // *tune* an Academics grade this high (Strong) makes a school academic (the Grades Scare)
recruiting.PLACE_SETTINGS = { "Big City": 0.30, "Mid-Size City": 0.20, "College Town": 0.35, "Small Town": 0.15 };   // *tune* his taste in a setting
recruiting.WARM_STATES = new Set("AL AZ CA FL GA HI LA MS SC TX".split(" "));
recruiting.COLD_STATES = new Set("IA ID IL IN MA ME MI MN MT ND NE NH NY OH PA SD VT WI WY".split(" "));
recruiting.HOME_CLIMATE = 0.7;                         // *tune* how often he wants the climate he grew up in
// how often each topic is a prospect's priority (drawn without replacement for his top three) *tune*
recruiting.PRIORITY_ODDS = { proximity: 0.11, playing_time: 0.11, prestige: 0.08, winning: 0.08, nil: 0.08, pro: 0.07, coach: 0.06,
  academics: 0.05, facilities: 0.05, location: 0.04, stability: 0.04, game_day: 0.03, exposure: 0.03,
  development: 0.06, contender: 0.05, culture: 0.04, recruiting: 0.02 };   // *tune* the four newer topics: a contender and a place that develops players matter to many, the class around him to a few
recruiting.PRIORITY_WEIGHTS = [0.35, 0.25, 0.15];      // his first, second and third priority; the rest share 0.25 *tune*
recruiting.OTHER_WEIGHT = 0.25;
recruiting.PRO_PULL_K = 1.2;                           // how steeply a Pro Pipeline grade away from 50 moves the Path to the League pull *tune*
recruiting.PULL_SCALE = 10.0;                          // interest points for a pull of 1.0 at full weight *tune*
recruiting.PROXIMITY_MILES = 300.0;                    // distance pull exp(-miles / this) *tune*
recruiting.PROXIMITY_FLOOR = 0.05;
recruiting.LAST_SEASON_WEIGHT = [[0, 0.8], [7, 0.3], [15, 0.05]];   // (week, weight on last season), linear between
recruiting.POLL_BUMP = [[10, 0.15], [25, 0.07]];       // (rank at or better, bump) on this season's standing
recruiting.STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 };
recruiting.ENGINE_GROUP = { MLB: "LB", ROLB: "LB", LOLB: "LB" };   // engine positions to roster groups (the rest are their own)
recruiting.EARLY_LEAVER_POOL = 100;                    // the underclassmen projecting a top-100 pick leave early ... *tune*
recruiting.ATTRITION = 0.10;                           // the share of returning players who leave anyway (the portal, quitting) *tune*
recruiting.LATE_MARKET = 12;                           // from this week the late market: a school refreshes its board every week, offers
recruiting.LATE_OFFERS = 1.25;                         // ... this much more, and takes one flier past a group's cap *tune*
recruiting.EARLY_LEAVER_RATE = 0.65;                   // ... this often (offseason.DECLARE's middle), so they only part-count as returning
recruiting.NEED_FACTOR = [[2, 1.6], [1, 1.2], [0, 0.6]];   // a board's pull toward a group by its need (need, factor); below 0: NEED_FLOOR *tune*
recruiting.NEED_FLOOR = 0.25;
recruiting.ONE_A_CLASS = ["QB", "K", "P"];              // groups a class takes one of unless the need is higher
recruiting.QB_CLASS_MAX = 3;                            // *tune* the most quarterbacks a CPU school signs in a class, however thin its room (you sign as many as you offer)
recruiting.OFFER_ROOM = 2.0;                            // open offers a school keeps out at a group: this times its cap there (it offers more than it takes)
recruiting.QB_THIN_NEED = 2;                            // *tune* a quarterback room this many short of a full one is thin: on the last Signing Day such a school with no quarterback in its class takes the best one left, however lukewarm he is
recruiting.QB_EVERY_CLASS = true;                       // a class takes a quarterback whatever the room (the one-starter spot turns over)
recruiting.FIVE_STAR_FLOOR = 0.6;                       // a blue blood's board pull on a five-star never drops below this for need
recruiting.LEAVING = new Set(["SR", "SRRS"]);          // seniors: gone after the season (the open spots rule)
// schools whose academics recruits weigh (a pull of 0.9); every other school 0.5
// the nine recruiting areas staff are assigned to (spec section 6)
recruiting.AREAS = {
  "Texas": ["TX"],
  "Florida": ["FL"],
  "Georgia-Carolinas": ["GA", "SC", "NC"],
  "Deep South": ["AL", "MS", "LA", "TN", "AR"],
  "Mid-Atlantic": ["VA", "MD", "DC", "DE", "PA", "NJ", "WV"],
  "Northeast": ["NY", "CT", "MA", "RI", "VT", "NH", "ME"],
  "Midwest": ["OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO", "KY", "KS", "NE", "ND", "SD"],
  "West Coast": ["CA", "OR", "WA", "HI", "AK"],
  "Mountain-Southwest": ["AZ", "NV", "UT", "CO", "NM", "ID", "MT", "WY", "OK"],
};
recruiting.HOURS = { message: 5, call: 15, hc_visit: 30, offer: 0, official_visit: 10, pull_offer: 0, raise_nil: 0,
  pitch: 0, call_recruit: 30 };        // a pitch finishes your call or visit scene: its hours went on the call
// the player's November 20 asks, for your school alone (the other schools recruit as they did):
recruiting.VISIT_MILES = [[250, 10], [750, 15], [1500, 20], [null, 25]];   // *tune* your invite to visit costs by how far he comes: (up to these miles, energy)
recruiting.HC_MILES = [[250, 20], [750, 30], [1500, 40], [null, 50]];      // *tune* ... and your head coach's in-home visit by how far he travels
// (Your head coach's visit, your invite to visit and the starting job wait for your offer on the page: the Recruiting
// board keeps their buttons off until he holds it. The rule is the page's, so a test or a tool can still make them.)
recruiting.PLANNABLE = ["message", "call", "call_recruit"];     // *tune* the quick actions you plan from his row, sent at the week step: a message, a call
//                                                                 to his coach ("call", the old quick call) and a call to him
// A school's energy a week is set by its program's stars (programs.stars_of): ENERGY_ZERO at no stars and ENERGY_PER_STAR
// more for each star, so 180, 210, ... 480 by halves (the player's numbers: a five-star program can make 16 video
// calls a week). Every school's, yours and the AI's. *tune*
recruiting.ENERGY_ZERO = 180;
recruiting.ENERGY_PER_STAR = 60;
recruiting.LOOK_ENERGY = 5;                            // *tune* a Send: one look at a prospect, in energy (there are no scouting points)
// How many looks finish a report, by your staff's blend for that prospect (scout_blend, on the scale the page shows:
// the average coach a 70): LOOKS_BY_BLEND's floors, else LOOKS_WORST. A read's `looks` are still kept in thirds of a
// report (REPORT_LOOKS = 3 is a complete one), so a look is worth 3 / looks_needed of them. *tune*
recruiting.LOOKS_BY_BLEND = [[85, 2], [70, 3]];
recruiting.LOOKS_WORST = 4;
recruiting.BLEND_WEIGHTS = { scout: 0.5, coordinator: 0.25, coach: 0.25 };   // *tune* the recruiter covering his state, the coordinator on his side of the ball, you
recruiting.FINE_BLEND = 85;                            // *tune* a blend this good reads a recruit's potential with a plus or a minus
recruiting.OFFENSE_GROUPS = ["QB", "RB", "WR", "TE", "OL"];   // his group's side of the ball (a kicker, a punter or an athlete: both coordinators' average)
recruiting.DEFENSE_GROUPS = ["DL", "LB", "CB", "S"];
recruiting.STAFF_LOOKS_WEEK = 10;                      // *tune* how many prospects each recruiter looks at on his own a week
// The class is the same size every year (the player's design, part 2): CLASS_CAP high school signees and TRANSFER_CAP
// transfers on top. Your roster's room no longer holds either back: what does not fit under the roster limit is
// settled at the offseason's Roster Cuts. The other schools sign under the same caps and still aim at their usual size. *tune*
recruiting.CLASS_CAP = 25;
recruiting.TRANSFER_CAP = 20;
recruiting.BOARD_CAP = 30;                             // *tune* the most prospects your board holds (the player's number: 50 first, then 30)
recruiting.WEEKLY_HOURS_BASE = 140;                    // *tune* a school's recruiting hours a week at a recruiting rating of 50 ...
recruiting.WEEKLY_HOURS_PER = 0.4;                     // *tune* ... plus this many per rating point over 50 (about 150 for most schools)
recruiting.SCOUT_POINTS_BASE = 150;                    // *tune* your scouting points a week with a best evaluator of 50 (about four full reports away from your areas) ...
recruiting.SCOUT_POINTS_PER = 2.0;                     // *tune* ... plus this many per evaluation point over 50 (250 at 100)
recruiting.LOOK_COST = { home: 5, area: 10, away: 15, portal: 5 };   // *tune* a Send's points: a prospect close to home (his state, or HOME_MILES), one in a staffed area, one away from your scouts, a portal entrant
recruiting.HOME_MILES = 150;                                     // *tune* a prospect this close to your campus is a "home" look, whatever his state
recruiting.SCENES = ["call", "hc_visit"];              // your calls and in-home visits without a pitch open a scene (scenes.js)
// looks come in trip units: a full report is REPORT_LOOKS looks and nothing goes past it (read["looks"] <= 3 always)
recruiting.REPORT_LOOKS = 3;                           // a complete scouting report: three looks (flags, "our comp" and the SCOUTED line wait for it)
recruiting.SEND_LOOK = 1.0;                            // a scouting trip (a Send, 5-15 scouting points): one look by your best evaluator, allowed while his report is short
recruiting.AREA_LOOK = 0.5;                            // an area scout's weekly look: half a look (the read moves half as far) ...
recruiting.AREA_CAP = 2.0;                             // ... up to this many looks from his area (read["area"]), so four weeks there leave one trip to finish him
recruiting.CALL_REVEAL = 0.5;                          // a call tells you one of his priorities this often; an in-home visit always does
recruiting.ASK_NARROW = [0.85, 1.15];                  // *tune* the ask range once your staff has had a look at him (any look short of a complete report)
recruiting.BASE_POINTS = { message: 1.0, call: 2.5, hc_visit: 6.0, offer: 4.0, official_visit: 8.0,
  call_recruit: 4.0 };             // *tune* the page's Video Call: more than a call ("call"), less than your head coach's visit
recruiting.PITCH_PRIORITY = [1.0, 3.0];                // no longer read: a pitch on one of his priorities is worth REACTION_WORTH by how he takes it (part 6); kept for old tools
recruiting.PITCH_OTHER = [0.3, 0.4];                   // any other topic: 0.3 + 0.4 * strength
recruiting.STRONG_CASE = 0.6;                          // a case from this up is a strong one: the bottom of the B's on the school-grade lines (grades.SCHOOL_LINES) *tune*
recruiting.BACKFIRE = 0.25;                            // a priority pitched at a strength under this backfires (he isn't buying it): an F on the school-grade lines ...
recruiting.BACKFIRE_COST = 0.5;                        // ... and costs this much of the action's base points
recruiting.PRESENT_HIT = 0.25;                         // your opening on a call or visit (scenes.present): each of the three things that is one of his
//                                                        priorities earns this share of the action's base times (1 + your strength); a weak one costs
//                                                        BACKFIRE_COST of that share; the total caps at the base *tune: tools/check_recruiting.mjs*
recruiting.COLD_OFFER = 0.5;                           // an offer before any contact counts this much
recruiting.STAGES = ["cold", "contact", "top", "visited", "committed"];
recruiting.DIMINISH = 0.2;                             // each earlier contact from the school cuts a new one's worth *tune*
recruiting.WEEKLY_ONCE = ["message", "call", "call_recruit"];   // each of these once a week per prospect: more contact is not more interest
recruiting.HC_VISIT_GAP = 4;                           // weeks between a school's head coach in-home visits to one prospect (yours too)
recruiting.QUICK_CALL = 0.5;                           // *tune* a quick call after his first (no conversation, no pitch): this share of a call's base, a slight boost
recruiting.NIL_VALUE = { 5: 0.04, 4: 0.07, 3: 0.12, 2: 0.15 };   // interest per NIL point by stars: top prospects expect more *tune*
recruiting.NIL_FLOOR = 30;
recruiting.NIL_PER_TIER = 3.0;                         // NIL points a year per point of the program's NIL tier *tune*
// what a prospect wants in NIL points (his ask): by stars, times his position, times a lognormal spread *tune*
recruiting.ASK = { 5: 60, 4: 30, 3: 8, 2: 0 };
recruiting.ASK_POS = { QB: 1.5, LEDG: 1.2, REDG: 1.2, LT: 1.2, WR: 1.2, CB: 1.2, HB: 0.9, TE: 0.9, K: 0.3, P: 0.3 };
recruiting.ASK_SPREAD = 0.3;
recruiting.ASK_TRAIL = 0.15;                           // he wants this much more per place you trail on his list
recruiting.ASK_SHOWN = [0.7, 1.3];                     // *tune* the ask range shown before your staff has looked at him; a complete report gives the number
recruiting.ASK_OFF_CENTER = [0.2, 0.8];                // *tune* where his number sits in a shown range, as a share of its width from the low end, drawn per prospect and school
//                                                        (its own stream, ask-view-{seed}-{school}-{pid}); [0.5, 0.5] puts every number dead center, so a range's middle gives it away
recruiting.NIL_OVER = 0.3;                             // NIL past his ask counts this much of the usual value
recruiting.LOWBALL = 0.5;                              // an offer under this share of his ask from you is a lowball ...
recruiting.LOWBALL_MIN = 20;                           // ... as is a 0-NIL offer when he asks for at least this
recruiting.COOL_WEEKS = 3;                             // a lowball cools him on you for this long: contacts count half, no visit
recruiting.COOLED_CONTACT = 0.5;
recruiting.ANSWER_STRAIGHT = 1.0;                      // his question about a named player (scenes.question): a straight answer's points ...
recruiting.ANSWER_PROMISE = 3.0;                       // ... a promise he can believe (he would start; he is the better recruit) ...
recruiting.ANSWER_HOLLOW = 2.0;                        // ... and what a hollow one costs (he cools on you a week too) *tune*
recruiting.PROMISE_MARGIN = 5;                         // no longer read: a roster promise always holds (your word, judged next season); kept for old tools
recruiting.LAST_YEAR = new Set(["JR", "JRRS"]);        // this season's class of a player in his last year next season (the portal's rosters already read next season: LEAVING)
recruiting.PROMISE_RIVAL = 20;                         // firmness lost when the other recruit you promised him over commits to you too
recruiting.PACKAGE_OFFERED = 1.0;                      // a Package Deal's question (scenes.question "package") when his mate already holds your offer: on top of ANSWER_STRAIGHT *tune*
recruiting.PACKAGE_PROMISE_WEEKS = 2;                  // you promised his mate an offer: kept when the mate holds it within this many weeks, broken after *tune*
recruiting.PACKAGE_KEPT = 2.0;                         // what a kept Package Deal promise earns at the week step it is kept *tune*
recruiting.NIL_PROMISE_SHARE = 0.8;                    // *tune* a money promise (NIL pitched with nothing on the offer) is kept once the offer holds this share of his ask
recruiting.NIL_PROMISE_WEEKS = 2;                      // *tune* ... within this many week steps, or it breaks
recruiting.MONEY_FORGIVE_CHANCE = { shy: 0.75, business: 0.35, guarded: 0.30, attention: 0.25, cocky: 0.10 };   // *tune* the chance each lets a broken money promise go at a small school
recruiting.MONEY_FORGIVE_TIER = 4;                     // *tune* ... a school at this program tier or below (Group of 5 and the bottom)
recruiting.ASK_MORE = [1.5, 1.25];                     // a rival's NIL this much over yours, with you in his top group: his ask from you rises this much
recruiting.TOP_GROUP = 10;                             // *tune* his list: his top this many schools by interest (fewer once he cuts it: FINALISTS, part 6)
// pestering: contacts past his patience from a school he is not considering cost it *tune*
recruiting.PESTER_FREE = 3;                            // contacts (message, call, in-home visit; a scene's pitch is the contact it finishes) a school gets
//                                                        before more count as pestering while he is not considering it (an offer in hand does not
//                                                        exempt it; an official visit or his commitment does)
recruiting.PESTER_TOP = 3;                             // he is not considering a school outside his top this many (by interest plus pending, among the
recruiting.PESTER_SHARE = 0.6;                         // schools that worked or offered him) or under this share of his leader's; his leader never
recruiting.PESTER_COST = 1.5;                          // a pestering contact costs this times the action's base points (no pitch bonus) ...
recruiting.PESTER_RAMP = 0.5;                          // ... and each pester costs this much more than the one before
recruiting.PESTER_ASK = 1.1;                           // his ask from the school rises this much per pester (ask_mult, capped at ASK_MULT_MAX overall)
recruiting.ASK_MULT_MAX = 2.0;
// Only your own hand pesters. AI schools (_auto_week acting for them) are exempt, and Auto-recruit acting
// for your school never does it: it skips a contact that would pester and spends the hours elsewhere (and
// _act's `auto` flag keeps the penalty off its contacts regardless). The AI's targeting does not spam, and
// tests/test_sim_golden.mjs stays byte-identical.
recruiting.AI_OVER_ASK = 1.1;                          // an AI school offers up to this times his ask from it
// generational prospects: a public tag on a few top four- and five-stars, drawn once per class *tune*
recruiting.GENERATIONAL_FROM = 96;                     // true projected overall at least this
recruiting.GENERATIONAL_ODDS = { 5: 0.4, 4: 0.1 };     // a qualifying prospect is drawn this often, by stars
recruiting.GENERATIONAL_MAX = 4;                       // at most this many a class (some years none)
recruiting.GENERATIONAL_ASK = 1.5;                     // his NIL ask is this times larger
recruiting.GEM_RANK = 300;                             // a gem is a three-star or less ranked past this
recruiting.FIND_LOOKS = recruiting.REPORT_LOOKS;       // looks before your staff names a gem, a bust risk or a generational talent: a complete report
recruiting.GEM_PERCENTILE = 0.94;                      // a gem's potential read beats, even at its low end, this share of his star tier's true potential
recruiting.BUST_PERCENTILE = 0.0175;                   // a bust risk's read sits, even at its high end, under this share of his star tier's (one in 57)
recruiting.FLAG_HOLD = 4.0;                            // a flag found stays until the read moves this far back past its cut (a read's slack, WORD_SLACK): no flicker
recruiting.LOOK_LOG_KEEP = 30;                         // the look log keeps this many of a scout's looks a week (flags, then potential, then the rest)
// the transfer portal as recruiting (offseason.js runs it): four weeks after signing day *tune*
recruiting.PORTAL_WEEKS = 4;
recruiting.PORTAL_PRIORITY_ODDS = { playing_time: 0.30, nil: 0.16, winning: 0.11, proximity: 0.07, prestige: 0.05, pro: 0.05, stability: 0.04,
  coach: 0.03, exposure: 0.03, facilities: 0.02, location: 0.02, academics: 0.01, game_day: 0.01,
  contender: 0.04, development: 0.03, culture: 0.02, recruiting: 0.01 };
recruiting.PORTAL_TOP_PRIORITY_ODDS = { nil: 0.22, winning: 0.17, playing_time: 0.14, prestige: 0.08, pro: 0.07, exposure: 0.05, proximity: 0.04,
  coach: 0.03, facilities: 0.02, stability: 0.02, academics: 0.01, location: 0.01, game_day: 0.01,
  contender: 0.09, development: 0.02, culture: 0.01, recruiting: 0.01 };   // the best transfers chase a title
recruiting.PORTAL_TOP_TIER = 4;                        // an entrant rated a four-star or better draws his priorities from PORTAL_TOP_PRIORITY_ODDS: the best transfers chase NIL and a contender
recruiting.PORTAL_NATIONAL = 40;                       // the best entrants by portal rank are on every Power 4 board (the whole country chases them)
recruiting.PORTAL_STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 };   // a group's starters: an entrant better than the last of them is an upgrade, taken past the group's cap
recruiting.PORTAL_COMMIT = [0.25, 0.4, 0.6, 1.0];      // an entrant with offers decides at each week's step this often
// the portal runs on this season's money: what a school had left of the year's budget plus a reward
// for the season (shares of the budget, summed then capped), never less than the collective's
// portal fund; what it does not spend carries into next year, capped by the program's tier
recruiting.REWARD = { winning: 0.10, nine_wins: 0.20, conference: 0.10, playoff: 0.10, host: 0.10, title: 0.15, goal: 0.10 };
recruiting.REWARD_CAP = 0.50;                          // the reward at most this share of the budget
recruiting.REWARD_FLAT = { playoff: 75, host: 50, title: 100 };   // *tune* NIL points a playoff run is worth at any school: the reward is never less than these lines' sum, so a small collective's windfall is real money
recruiting.REWARD_WHY = { winning: "winning record", nine_wins: "nine wins", conference: "conference champion",
  playoff: "made the playoff", host: "hosted a playoff game", title: "national champion", goal: "AD goal met" };
recruiting.PORTAL_FLOOR = 0.30;                        // the collective's portal fund: no program enters the portal with less
recruiting.CARRY_CAP = { 1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30, 5: 0.30 };   // the share of next year's budget that may carry over, by program tier
recruiting.PORTAL_ASK = [25, 1.3, 79];                 // an entrant's ask: this plus this per overall point over the third, times his position
recruiting.PORTAL_RANK_NOISE = 1.6;                    // the public portal ranking: his overall plus this much noise (points)
recruiting.PORTAL_LOOK = 0.5;                          // a staff's look at a transfer errs this much of a high schooler's: there is film
recruiting.PORTAL_WALK_ON = 0.5;                       // an entrant unsigned after the last week takes a walk-on spot this often
recruiting.PORTAL_CHURN = 8;                           // portal spots a Power 4 school (and you) make by releasing the end of the roster
recruiting.TIER_FROM_OVERALL = [[87, 5], [83, 4], [77, 3], [0, 2]];   // a transfer's standing for the boards' star lifts, from his overall
recruiting.ROSTER_LIMIT = 85;                          // EA's roster limit (offseason.ROSTER_LIMIT)
recruiting.MIN_OPEN = 12;
recruiting.EARLY_LEAVERS = 6;                          // returning players expected to leave early (draft, transfers, quitting; offseason.js) *tune*
recruiting.CLASS_ROOM = 2;                             // a class tops out this far over the school's real mean size *tune*
recruiting.OFFER_FACTOR = 1.5;
recruiting.FCS_LINE = 4.0;                             // best FBS interest under this: Leaning FCS *tune*
recruiting.BLUE_CHIP_HOME = true;                      // *tune* a four- or five-star never signs with an FCS school: a school he likes makes room for him
recruiting.FCS_NO_OFFER_WEEK = 8;                      // from this week a prospect with no FBS offer leans FCS
recruiting.COMMIT_ODDS = [[0, 0.02], [6, 0.05], [9, 0.095], [12, 0.11], [16, 0.12], [20, 0.30]];   // weekly base chance by week (raised from Week 9 on when a fifth of the class became Signing Day recruits) *tune*
recruiting.COMMIT_FREEZE_WEEKS = 3;                     // nobody commits anywhere in the first weeks: time to scout and build a board before the class moves
recruiting.LEAD_SCALE = 6.3;                           // interest lead worth a doubling of the base chance (6 with energy by stars, 180 to 480 a week: leads run bigger still, and 4 had 91-93% signed by the early period; 5.5 sat on the 90% edge and 7 let one school sign nine five-stars. It was 4 with the commit styles; 5: with 140-160 hours a week leads run bigger, and 3 had over 92% signed by the early period) *tune*
recruiting.VISIT_BOOST = 1.6;                          // after an official visit to the leader
recruiting.DECOMMIT_RATE = 1.4;                        // weekly chance of a decommitment at an even race (1.4: Early Bird, Quiet Commit and Signing Day recruits flip less or never; 0.8: AI schools now message every commit weekly, so commits firm faster; 0.45 left 5% of the top 300 decommitting) *tune*
// a commitment's firmness, 0-100: it starts soft and firms up only if the school keeps in touch *tune*
recruiting.FIRM_START = 40;                            // at commitment (after an official visit there)
recruiting.FIRM_VISIT = 60;
recruiting.FIRM_TOUCH = 8;                             // a week with a message, call or visit from the school / a quiet week (he still warms to you)
recruiting.FIRM_DRIFT = 3;
recruiting.HARD_AT = 90;                               // a verbal commit this firm is a hard commit: no flip, no pulled offer, he signs
recruiting.FIRM_NIL = 3;                               // the NIL promised is still held
recruiting.FIRM_RIVAL = -6;                            // per rival in his top three offering more playing time
recruiting.FIRM_RIVALS = 3;
recruiting.FLIP_MARGIN = 4.0;                          // a rival's lead that doubles-ish it (logistic) *tune*
recruiting.CROWD = 2.0;                                // interest lost per committed recruit at his position rated at least as high *tune*
recruiting.RIVAL_RANK = 300;                           // AI schools keep chasing committed prospects this highly ranked
recruiting.REST_MILES = 700.0;                         // outside its top states a school recruits near home first *tune*
recruiting.REST_NEAR = 2.5;
recruiting.NATIONAL_TILT = 40;                         // how hard national targets lean to the very best *tune*
recruiting.NATIONAL_TARGETS = 25;                      // national targets on a board, times the school's blue-chip share *tune*
recruiting.BOARD_FACTOR = 3;                           // an AI school's board holds this many prospects per open spot
recruiting.NATIONAL_REACH = 0.08;                      // a blue-chip program's pull on four- and five-stars anywhere *tune*
recruiting.STAR_KEY = { 5: "5*", 4: "4*", 3: "3*", 2: "2*" };
recruiting.AI_NIL = { 5: 0.30, 4: 0.15, 3: 0.04, 2: 0.0 };   // share of the budget an AI school puts on one offer by stars (0.25/0.12 before the twists spread the blue chips) *tune*
recruiting.POS_247 = { OT: "OL", IOL: "OL" };
recruiting.ACADEMIC = new Set(["stanford", "notre-dame", "northwestern", "duke", "vanderbilt", "rice", "california", "ucla", "michigan",
  "virginia", "georgia-tech", "wake-forest", "boston-college", "navy", "army", "air-force", "usc", "north-carolina"]);


// (recruits.model() reads the file once.)
function model() {
  return recruits.model();
}


function _miles(a, b) {
  const [lat1, lon1, lat2, lon2] = [...a, ...b].map((x) => x * _RAD);
  const s1 = Math.sin((lat2 - lat1) / 2), s2 = Math.sin((lon2 - lon1) / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * (s2 * s2);
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}


function _logistic(x) {
  return 1 / (1 + Math.exp(-x));
}


function _interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    if (x <= x1) return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
  }
  return points[points.length - 1][1];
}


recruiting._LEAGUE_MODELS = {};   // the career league's own recruiting models (a league file's new or moved teams), use_league_models


function use_league_models(models) {
  // Put a career league's recruiting models (state["league"]["recruiting_models"]) over the
  // built-in ones; {} for none. Everything worked out from the old ones is forgotten when they change.
  models = truthy(models) ? models : {};
  if (_equal(models, recruiting._LEAGUE_MODELS)) return;
  recruiting._LEAGUE_MODELS = models;
  recruiting.reset_caches();
}


function _team_model(slug) {
  const own = get(recruiting._LEAGUE_MODELS, slug);
  if (truthy(own)) return own;
  const built = get(recruiting.model()["teams"], slug);
  return truthy(built) ? built : {};
}


function _baseline(slug) {
  const strength = get(recruiting._team_model(slug), "strength");
  const baseline = get(truthy(strength) ? strength : {}, "baseline");
  return truthy(baseline) ? baseline : -1.0;
}


function attributes(state, p, field = "potential") {
  // A prospect's ratings ("ratings") or potential ("potential") by skill, on our scale.
  const attrs = state["recruiting"]["attrs"], values = p[field];
  const out = {};
  for (let i = 0; i < attrs.length && i < values.length; i++) out[attrs[i]] = values[i];
  return out;
}


function fbs_schools(state) {
  const season = modules.season;
  return sorted(Object.entries(season.load_teams())
    .filter(([s, t]) => !truthy(get(t, "fictional")) && truthy(recruiting._team_model(s))).map(([s]) => s));
}


// ----- scouting (spec section 6) *tune* -----
recruiting.GROUPS = ["athleticism", "size_strength", "technique", "football_iq", "potential", "coachability"];
recruiting.WORDS = ["All-American", "Elite", "Strong", "Solid", "Fair", "Weak"];
// words on the game's 1-99 scale (50 is the middle Power 4 starter at the position, 65 one standard
// deviation better, 80 two): Solid is that starter, Strong a clearly better one, Elite an all-conference level
recruiting.WORD_FLOORS = [90, 80, 65, 50, 40, -1e9];
recruiting.GRADE_LOW = 1.0;                // grades run the whole scale
recruiting.GRADE_SPAN = 98.0;
recruiting.COACHABILITY_POINTS = { "Coach's Dream": 90, "Film Junkie": 80, "Quick Study": 68, "Steady Grinder": 52,
  "Slow to Click": 37, "Set in His Ways": 20 };
recruiting.LOOK_SD = [16.0, 4.0];                      // a look's error sd in grade points: 16 * (1 - s) + 4, s = rating / 99
recruiting.WORD_SLACK = 4.0;                           // a word range already spans its end words' width, so the read narrows by this much
recruiting.CONFIDENCE_NOISE = 0.5;                     // how far a look's own confidence strays (log sd, times 1 - s)
recruiting.HIDDEN_RATE = 0.15;                         // two-stars and three-stars under this composite, hidden until a look
recruiting.HIDDEN_BELOW = 0.82;
recruiting._ATHLETIC = ["speed", "acceleration", "agility", "change_of_direction", "jumping"];
recruiting._SIZE = ["strength", "toughness", "stamina"];
recruiting._IQ = ["awareness", "play_recognition"];

// ----- the class ---------------------------------------------------------------------------------

function _home(p) {
  const h = p["hometown"];
  if (get(h, "lat") !== null) return [h["lat"], h["lon"]];
  const found = get(recruiting.model()["generation"]["towns"], get(h, "state"));
  const towns = truthy(found) ? found : [];
  return towns.length && towns[0][2] !== null ? [towns[0][2], towns[0][3]] : [39.8, -98.6];
}


recruiting.TILT = 1.5;                                 // *tune* each lean (who decides, personality, stars, position) multiplies a topic's odds by this
recruiting.TILTS = {                                   // the spec's Tilts: what each kind of kid leans toward
  decider: { mom: ["proximity", "academics", "stability", "culture"], dad: ["nil", "playing_time", "pro", "exposure"],
    grandma: ["proximity", "coach", "academics"], hs_coach: ["stability", "development"], trainer: ["facilities", "exposure", "development"],
    self: ["facilities", "game_day", "location"] },
  personality: { attention: ["exposure", "game_day"], cocky: ["playing_time", "exposure", "contender"], shy: ["proximity", "stability", "culture"],
    guarded: ["stability", "coach"], business: ["nil", "pro", "development"] },
  group: { QB: ["coach", "exposure"], OL: ["stability", "coach"], RB: ["exposure", "game_day"], WR: ["exposure", "game_day"],
    TE: ["exposure", "game_day"] },
};


function tilt_for(p, d) {
  // His leans as multipliers on the priority odds (TILT each; leans on the same topic multiply): who decides, his
  // personality, his stars (a transfer's tier stands in) and his position group.
  const out = {};
  const lean = (topics) => {
    for (const t of topics) out[t] = get(out, t, 1.0) * recruiting.TILT;
  };
  if (modules.persona.DECIDERS_ON) lean(get(recruiting.TILTS["decider"], get(d, "decider"), []));   // (off: nobody leans by who decides)
  lean(get(recruiting.TILTS["personality"], get(d, "personality"), []));
  const stars = get(p, "stars") || get(p, "tier") || 0;
  lean(stars >= 5 ? ["nil", "exposure", "pro", "contender", "recruiting"] : stars === 4 ? ["contender"]
    : stars === 2 || stars === 3 ? ["playing_time", "proximity", "development"] : []);
  lean(get(recruiting.TILTS["group"], truthy(get(p, "group")) || truthy(get(p, "ea_position")) ? recruiting._group_of(p) : null, []));
  return out;
}


function _priorities(pid, table = null, tilt = null) {
  const rng = new Random(`priorities-${pid}`);
  table = truthy(table) ? table : recruiting.PRIORITY_ODDS;
  tilt = truthy(tilt) ? tilt : {};
  const topics = Object.keys(table), odds = Object.entries(table).map(([t, v]) => v * get(tilt, t, 1.0));
  const out = [];
  for (let _ = 0; _ < 3; _++) {
    const t = rng.choices(topics, { weights: odds })[0];
    const i = topics.indexOf(t);
    topics.splice(i, 1);
    odds.splice(i, 1);
    out.push(t);
  }
  return out;
}


function start(state, year = 2027) {
  // Give a Coach Career its class of high school seniors (recruits.generate_class) and an empty
  // recruiting board. Nobody is committed at the start.
  const season = modules.season, persona = modules.persona;
  const taken = new Set();
  for (const t of Object.values(season.load_teams())) {
    for (const p of t["offense"].concat(t["defense"])) taken.add(p["name"].toLowerCase());
  }
  const cls = recruits.generate_class(year, get(state, "rng_state", 0), taken, false);   // converted below
  const prospects = {};
  for (const p of cls) {
    p["priorities"] = recruiting._priorities(p["id"], null, recruiting.tilt_for(p, persona.draw(p["id"], get(state, "rng_state", 0))));
    p["home"] = recruiting._home(p);
    const hideable = p["stars"] === 2 || (p["stars"] === 3 && p["composite"] < recruiting.HIDDEN_BELOW);
    p["hidden"] = hideable && new Random(`hidden-${year}-${get(state, "rng_state", 0)}-${p["id"]}`).random() < recruiting.HIDDEN_RATE;
    p["nil_ask"] = recruiting.nil_ask(p, year, get(state, "rng_state", 0));
    prospects[p["id"]] = p;
  }
  // the class is drawn by a model learned from real players, in card numbers: kept as lists in one key order, with
  // his overall now and projected
  const attrs = game_scale.keys();
  for (const p of Object.values(prospects)) {
    const ratings_ea = p["ratings_ea"];
    delete p["ratings_ea"];
    const card = game_scale.from_ea(ratings_ea, p["ea_position"]);
    const potential_ea = p["potential_ea"];
    delete p["potential_ea"];
    const pot = game_scale.potential_from_ea(potential_ea, card, p["ea_position"]);
    p["ratings"] = attrs.map((k) => get(card, k, game_scale.MISSING));
    p["potential"] = attrs.map((k) => get(pot, k, game_scale.MISSING));
    p["ovr"] = game_scale.overall(card, p["ea_position"]);
    p["pot_ovr"] = game_scale.overall(pot, p["ea_position"]);
    for (const k of ["overall_ea", "overall"]) delete p[k];
  }
  recruiting._truths(prospects, attrs);
  const lists = {}, status = {};
  for (const pid of Object.keys(prospects)) lists[pid] = {};
  for (const pid of Object.keys(prospects)) status[pid] = { committed: null, signed: null, fcs: false };
  state["recruiting"] = {
    year, prospects, lists,
    status,
    offers: {}, visits: {}, contacts: {}, hours: {}, scout_points: {}, nil: {}, revealed: {}, board: [], log: [],
    boards: {}, seed: get(state, "rng_state", 0), topics_v: 2, reads: {}, attrs, grades: "game", scale: "card", overall_v: game_scale.overall_version(),
    pending: {}, why: {}, ranks: {}, reports: [], action_points: {}, leader_changes: {},
  };
  state["recruiting"]["generational"] = recruiting.draw_generational(state["recruiting"]);
  persona.apply_stories(state);       // his story: a comeback and a bloomer shown low, the class re-ranked
  recruiting.keep_tens(state);        // every recruit's list of ten schools as the class opens (part 6)
}


function nil_ask(p, year, seed) {
  // What he wants in NIL points: his stars and position, with a spread (a transfer: his overall).
  const rng = new Random(`ask-${year}-${seed}-${p["id"]}`);
  const base = truthy(get(p, "portal")) ? Math.max(0.0, recruiting.PORTAL_ASK[0] + recruiting.PORTAL_ASK[1] * (p["ovr"] - recruiting.PORTAL_ASK[2]))
    : get(recruiting.ASK, p["stars"], 0);
  return int(round(base * get(recruiting.ASK_POS, p["ea_position"], 1.0) * Math.exp(rng.gauss(0, recruiting.ASK_SPREAD))));
}


function draw_generational(rc) {
  // The class's generational prospects, highest true potential first: each four- or five-star whose
  // true potential is at the top of the scale is drawn on his own seeded odds, the first few kept.
  const cands = sorted(Object.entries(rc["prospects"])
    .filter(([pid, p]) => p["stars"] !== null && p["stars"] !== undefined && p["stars"] >= 4 && p["truth"]["potential"] >= recruiting.GENERATIONAL_FROM)
    .map(([pid]) => pid),
  (pid) => [-rc["prospects"][pid]["truth"]["potential"], pid]);
  const drawn = cands.filter((pid) => new Random(`generational-${rc["seed"]}-${pid}`).random() < recruiting.GENERATIONAL_ODDS[rc["prospects"][pid]["stars"]]);
  return drawn.slice(0, recruiting.GENERATIONAL_MAX);
}


function is_generational(state, pid) {
  const rc = get(state, "recruiting") || {};
  return !truthy(get(rc, "portal")) && (get(rc, "generational") || []).includes(pid);
}


recruiting._STEP_WEEK = [null];        // the season week whose step is running (weekly_step), else None
recruiting._STEP_AUTO = [false];       // whether that step recruits for your school too (a simmed season, an auto offseason): Room


function contact_week(state) {
  // The recruiting week a message or call counts against (WEEKLY_ONCE): the week whose step lands
  // it. Your actions now land at the next step (the current week plus one); Auto-recruit's and the
  // AI's, made during a step, land at that step. So your staff on Auto never use up the week you are
  // about to play. In the portal it is the portal's own week (the season's week stands still there).
  const rc = state["recruiting"];
  if (truthy(get(rc, "portal"))) return get(rc, "week") || 1;
  return recruiting._STEP_WEEK[0] !== null ? recruiting._STEP_WEEK[0] : state["current_week"] + 1;
}


function heal_contacts(state) {
  // A career saved with a call or visit left open from an earlier week (it never closed), or in
  // the portal with message and call marks from the season's frozen week (they never cleared): both
  // blocked a contact for good. Drops them. Returns whether anything changed.
  const rc = get(state, "recruiting") || {};
  let changed = false;
  for (const [slug, by] of Object.entries(get(rc, "scenes") || {})) {
    for (const pid of Object.keys(by).filter((q) => get(by[q], "week") !== get(state, "current_week"))) {
      delete by[pid];
      changed = true;
    }
  }
  if (truthy(get(rc, "portal"))) {
    const last = get(rc, "weeks") || recruiting.PORTAL_WEEKS;       // range(1, last + 1)
    const in_weeks = (w) => typeof w === "number" && Number.isInteger(w) && w >= 1 && w <= last;
    for (const by of Object.values(get(rc, "contacts") || {})) {
      for (const c of Object.values(by)) {
        const marks = get(c, "week") || {};
        for (const action of Object.keys(marks).filter((a) => !in_weeks(marks[a]))) {
          delete marks[action];
          changed = true;
        }
      }
    }
  }
  return changed;
}


function upgrade_generational(state) {
  // A career saved before generational prospects: draw its class's. Returns whether it did.
  const rc = get(state, "recruiting") || {};
  if (!truthy(get(rc, "prospects")) || truthy(get(rc, "portal")) || has(rc, "generational")) return false;
  rc["generational"] = recruiting.draw_generational(rc);
  return true;
}


/** next(t for at, t in TIER_FROM_OVERALL if ovr >= at): throws when none is. */
function _tier_from_overall(ovr) {
  for (const [at, t] of recruiting.TIER_FROM_OVERALL) if (ovr >= at) return t;
  throw new Error("StopIteration");
}


function market_value(pos, ovr) {
  // A roster player's NIL market in points: the recruit ask of the star tier his overall reads as
  // (TIER_FROM_OVERALL), times his position (ASK, ASK_POS): a starter rated like a four-star asks
  // like one, a bench-level player has none. The offseason's NIL transfer driver reads it.
  const stars = _tier_from_overall(ovr);
  return get(recruiting.ASK, stars, 0) * get(recruiting.ASK_POS, pos, 1.0);
}


function tier_of(p) {
  // His standing for the boards' star lifts and NIL values: his stars, or a transfer's from his overall.
  if (get(p, "stars") !== null) return p["stars"];
  return get(p, "tier") || _tier_from_overall(p["ovr"]);
}


function _tiers(rc) {
  // Every prospect's tier, once per class and star change (a transfer's overall is fixed all season; a
  // Late Bloomer's jump moves rc["class_v"]).
  const key = _key(recruiting._ck(rc), get(rc, "class_v", 0));
  let cached = recruiting._TIERS;
  if (cached[0] !== key || Object.keys(cached[1]).length !== Object.keys(rc["prospects"]).length) {
    const tiers = {};
    for (const [pid, p] of Object.entries(rc["prospects"])) tiers[pid] = recruiting.tier_of(p);
    cached = recruiting._TIERS = [key, tiers];
  }
  return cached[1];
}


recruiting._TIERS = [null, {}];


function flag_cuts(rc) {
  // Each star tier's (gem, bust) cuts on potential: the GEM_PERCENTILE and BUST_PERCENTILE of the
  // class's true potential at that star level, once per class (prospects.find reads against them).
  // Potential varies nearly as much within a tier as across tiers (about a fifth of two- and
  // three-stars project Elite), so an absolute cut names a quarter of the class; a tier-relative one
  // names the few who stand out among their own.
  const key = _key(recruiting._ck(rc), get(rc, "seed"), Object.keys(rc["prospects"]).length);
  let cached = recruiting._CUTS;
  if (cached[0] !== key) {
    const by = new Map();                        // stars -> potentials, in the order the stars are met
    for (const p of Object.values(rc["prospects"])) {
      if (get(p, "stars") !== null && truthy(get(p, "truth"))) {      // by real stars: a shown-low prospect (his story) never moves the cuts
        const real = get(p, "real");
        const stars = (truthy(real) ? real : p)["stars"];
        if (!by.has(stars)) by.set(stars, []);
        by.get(stars).push(p["truth"]["potential"]);
      }
    }
    const cuts = odict();                        // keyed by stars, in that order
    for (const [stars, vals] of by) {
      vals.sort(cmp);
      cuts[stars] = [recruiting._percentile(vals, recruiting.GEM_PERCENTILE), recruiting._percentile(vals, recruiting.BUST_PERCENTILE)];
    }
    cached = recruiting._CUTS = [key, cuts];
  }
  return cached[1];
}


recruiting._CUTS = [null, {}];


function _percentile(sorted_vals, q) {
  // The q-quantile of sorted values, interpolated between neighbors (potentials are whole numbers,
  // so a nearest-rank cut would jump a whole point and a share of the tier with it).
  const pos = q * (sorted_vals.length - 1);
  const i = int(pos);
  const j = Math.min(i + 1, sorted_vals.length - 1);
  return round(sorted_vals[i] + (sorted_vals[j] - sorted_vals[i]) * (pos - i), 2);
}


function _ck(rc) {
  // A recruiting block's cache key: its class year, or the portal's own (the two share a year).
  return get(rc, "cache_key") || rc["year"];
}


recruiting.CLOSED_TEXT = "Recruiting is closed until Signing Day.";


function close_week() {
  // The last week recruiting is worked: after Championship Week's step nobody offers, contacts, hosts or scouts.
  const season = modules.season;
  return season.CCG_WEEK;
}


function early_signing_week() {
  // The early Signing Day: the week recruiting closes, before the bowls. Every recruit committed by then signs.
  return recruiting.close_week();
}


function signing_week() {
  // The last Signing Day: after the last game. Whoever committed during the dead period signs then and the
  // rest take their leader.
  const season = modules.season;
  return season.FINAL_WEEK;
}


function closed(state) {
  // The dead period: the regular season and its title games are over and Signing Day has not come. Recruits still
  // decide among the offers they hold (the weekly draws go on); no school, yours included, can work one. The portal
  // weeks are their own recruiting and are never closed.
  return !recruiting.is_portal(state) && truthy(get(state, "recruiting")) && get(state, "current_week", 0) >= recruiting.close_week();
}


function is_portal(state) {
  return truthy(get(get(state, "recruiting") || {}, "portal"));
}


function upgrade_asks(state) {
  // A career saved before prospects had NIL asks: give them theirs. Returns whether any were added.
  const rc = get(state, "recruiting") || {};
  let added = false;
  for (const p of Object.values(get(rc, "prospects") || {})) {
    if (!has(p, "nil_ask")) {
      p["nil_ask"] = recruiting.nil_ask(p, get(rc, "year", 2027), get(rc, "seed", 0));
      added = true;
    }
  }
  return added;
}


function hc_visit_week(state, slug, pid) {
  // The week of the school's last real in-home visit to him, for the once-a-month rule, or None. A visit is real when
  // it was had: Auto-recruit's (its contact carries the pitch), one you presented or pitched in, or one open now. A mark
  // with none of those was left by a visit that broke before it opened (the player's report: a Legacy's visit failed,
  // and the next try said he had been visited this month); it does not count.
  const rc = state["recruiting"];
  const c = get(get(get(rc, "contacts", {}), pid) || {}, slug) || {};
  const w = get(c, "hc_week");
  if (w === null || slug !== get(state, "team")) return w;      // an AI school's visits log nothing: its mark stands (and no log scan)
  if (truthy(get(get(get(rc, "scenes") || {}, slug) || {}, pid))) return w;
  const log = get(rc, "log") || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (get(e, "pid") !== pid || get(e, "school") !== slug || get(e, "week") !== w || get(e, "action") !== "hc_visit") continue;
    if (e["kind"] === "present" || e["kind"] === "pitch" || (e["kind"] === "contact" && truthy(get(e, "pitch")))) return w;
  }
  return null;
}


function _contact(state, slug, pid) {
  const contacts = state["recruiting"]["contacts"];
  if (contacts[pid] === undefined) contacts[pid] = {};
  const by = contacts[pid];
  if (by[slug] === undefined) by[slug] = { n: 0, hc_week: null };
  return by[slug];
}


recruiting._ASKS = new Map();          // (career, class, week, prospect, school, his ask multiplier) -> his ask from the school this week


function ask_from(state, slug, pid, win = null, peek = false) {
  // What he wants from `slug`: his ask, raised when a rival's number beat the school's, times
  // ASK_TRAIL per place the school trails on his list (as the week's step left it). `peek`: read only,
  // never opening a contact record (a strength read for a school that has not touched him).
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const mult = get(peek ? (get(get(rc["contacts"], pid) || {}, slug) || {}) : recruiting._contact(state, slug, pid), "ask_mult", 1.0);
  const base = p["nil_ask"] * mult;
  if (!base) return 0;
  const key = _key(state["id"], recruiting._ck(rc), state["current_week"], get(rc, "week"), pid, slug, base);      // his ask itself in the key: a late offer raises it
  let ask = recruiting._ASKS.get(key);
  if (ask === undefined || ask === null) {
    if (recruiting._ASKS.size > 500000) recruiting._ASKS.clear();
    const schools = new Set(Object.keys(rc["lists"][pid]));
    schools.add(slug);
    win = win !== null && win !== undefined ? win : recruiting._winning(state);
    const order = sorted(schools, (s) => -recruiting.interest(state, s, pid, win));
    ask = Math.max(5, recruiting._five(base * (1 + recruiting.ASK_TRAIL * Math.max(0, order.indexOf(slug)))));
    recruiting._ASKS.set(key, ask);
  }
  return recruiting.is_generational(state, pid) ? int(round(ask * recruiting.GENERATIONAL_ASK)) : ask;
}


recruiting._ASK_SPOTS = new Map();     // (class seed, school, prospect) -> where his number sits in a shown range (ASK_OFF_CENTER)


function ask_spot(state, slug, pid) {
  // Where his number sits in the range you are shown, 0 (the low end) to 1 (the high end): a fixed draw per prospect
  // and school on its own stream, never stored in the save, so the middle of a range is not his number.
  const seed = state["recruiting"]["seed"];
  const key = _key(seed, slug, pid);
  let f = recruiting._ASK_SPOTS.get(key);
  if (f === undefined) {
    if (recruiting._ASK_SPOTS.size > 500000) recruiting._ASK_SPOTS.clear();
    const [a, b] = recruiting.ASK_OFF_CENTER;
    f = a + (b - a) * new Random(`ask-view-${seed}-${slug}-${pid}`).random();
    recruiting._ASK_SPOTS.set(key, f);
  }
  return f;
}


function ask_known(state, slug, pid) {
  // How well `slug` knows his NIL ask: "exact" once your staff's report on him is complete (report_complete: the same
  // test that tells you his priorities, decider and personality) or he has signed with you, "narrow" once the report
  // holds any look, "wide" before that. Scouting is the only way to it: no call, visit or money talk tells you (a
  // save from before this may hold contact["asked"] from a talk; it is ignored). Only the player's school keeps
  // scouting reports, so any other school reads "wide" (the AI never reads this: it recruits from ask_from).
  const rc = state["recruiting"];
  if (slug !== get(state, "team")) return "wide";
  if (get(get(rc["status"], pid) || {}, "signed") === slug) return "exact";
  const looks = recruiting.report_looks(get(get(rc, "reads") || {}, pid));
  return looks >= recruiting.REPORT_LOOKS ? "exact" : looks > 0 ? "narrow" : "wide";
}


function ask_view(state, slug, pid, peek = false) {
  // His ask from your school as you know it (ask_known): the number once he is fully scouted, a range before
  // (ASK_SHOWN unscouted, ASK_NARROW once your staff has had a look), in fives, with the number somewhere inside it
  // (ask_spot), not at its middle. `peek`: read only, never opening a contact record.
  const ask = recruiting.ask_from(state, slug, pid, undefined, peek);
  const how = recruiting.ask_known(state, slug, pid);
  if (how === "exact") return { exact: ask };
  const [lo, hi] = how === "narrow" ? recruiting.ASK_NARROW : recruiting.ASK_SHOWN;
  const width = (hi - lo) * ask, f = recruiting.ask_spot(state, slug, pid);
  return { lo: Math.max(0, Math.min(ask - 5, recruiting._five(ask - f * width))), hi: Math.max(ask + 5, recruiting._five(ask + (1 - f) * width)) };     // a range in fives that straddles the number
}


function nil_value(p, nil, ask, state = null) {
  // The interest NIL on an offer is worth: in full up to his ask, NIL_OVER past it (with `state`,
  // as his personality and decider read it: a Trainer counts it in full to 1.2 times his ask, an
  // All Business recruit a third more).
  const [rate, cap] = state === null ? [recruiting.NIL_OVER, Infinity] : modules.persona.nil_over(state, p["id"]);
  const edge = cap === Infinity ? nil : Math.min(nil, cap * ask);     // past his ask up to here NIL counts at `rate`, beyond it at NIL_OVER
  const value = Math.min(nil, ask) + rate * Math.max(0, edge - ask) + recruiting.NIL_OVER * Math.max(0, nil - Math.max(edge, ask));
  const mult = state === null ? 1.0 : modules.persona.offer_mult(state, p["id"]);
  return get(recruiting.NIL_VALUE, recruiting.tier_of(p), 0.1) * value * mult;
}


const _LOWBALL_AT_LOAD = recruiting.LOWBALL;       // the default is fixed here, at load: a later change to LOWBALL does not move it

function is_lowball(nil, ask, share = _LOWBALL_AT_LOAD) {
  return nil < share * ask || (nil === 0 && ask >= recruiting.LOWBALL_MIN);
}


recruiting.COOLED_409 = { lowball: "he has cooled on you after that offer, so raise it to what he wants",
  promise: "he has cooled on you after that promise, so give him time",
  quiet: "he has cooled on you after you went quiet, so call or visit to warm him back up",
  game: "he has cooled on you after the loss he watched, so give him a week" };


function cooled(state, slug, pid) {
  // Whether he is cooled on the school (a lowball, a hollow or broken promise, or silence for a
  // Loves-the-Attention recruit): contacts count half, no visit. persona.cooled_why says which.
  return (get(recruiting._contact(state, slug, pid), "cooled_until") || -1) > state["current_week"];
}


function _pester_exempt(state, slug, pid) {
  // He has committed to the school or taken an official visit there: none of its contacts pester.
  const rc = state["recruiting"];
  const st = rc["status"][pid];
  return slug === st["committed"] || slug === st["signed"] || truthy(get(get(get(rc["visits"], pid, {}), slug) || {}, "done"));
}


function not_considering(state, slug, pid, win = null) {
  // He is not considering the school: among the schools that have worked or offered him (the set
  // `top_group` reads), ordered by interest plus this week's pending, it sits outside his top
  // PESTER_TOP or under PESTER_SHARE of his leader's. His leader never is. A school he will not consider at
  // all (locked_out: too far from what he wants) or one he has cut from his finalists (cut_out) always is.
  const rc = state["recruiting"];
  if (recruiting.locked_out(state, slug, pid, win) || recruiting.cut_out(state, slug, pid)) return true;
  const schools = new Set(Object.keys(rc["lists"][pid]));
  for (const [s, pids] of Object.entries(rc["offers"])) if (pids.includes(pid)) schools.add(s);
  for (const s of Object.keys(get(get(rc, "pending") || {}, pid, {}))) schools.add(s);
  schools.add(slug);
  win = win !== null && win !== undefined ? win : recruiting._winning(state);
  const score = {};
  for (const s of schools) score[s] = recruiting.interest(state, s, pid, win) + recruiting.pending(state, s, pid);
  const order = sorted(schools, (s) => -score[s]);
  if (order[0] === slug) return false;
  return order.indexOf(slug) >= recruiting.PESTER_TOP || score[slug] < recruiting.PESTER_SHARE * score[order[0]];
}


function would_pester(state, slug, pid) {
  // Whether the school's next contact would pester him: PESTER_FREE contacts landed, he is not
  // considering the school, no official visit or commitment. Only your school (by hand) ever does.
  if (slug !== get(state, "team")) return false;
  const c = get(get(state["recruiting"]["contacts"], pid) || {}, slug) || {};
  if (get(c, "n", 0) < modules.persona.pester_free(state, pid) || recruiting._pester_exempt(state, slug, pid)) return false;
  return recruiting.not_considering(state, slug, pid);
}


function pesters(state, slug, pid) {
  // How many times the school has pestered him (reset once he is considering it).
  return get(get(get(state["recruiting"]["contacts"], pid) || {}, slug) || {}, "pester", 0);
}


function upgrade_grades(state) {
  // A career saved when grades were class percentiles in school points: its true grades move
  // to the game's scale and each read keeps how far off it was (and its looks).
  const rc = state["recruiting"];
  const old = {}, fresh = {};
  for (const [pid, p] of Object.entries(rc["prospects"])) old[pid] = { ...p["truth"] };
  for (const [pid, p] of Object.entries(rc["prospects"])) fresh[pid] = { ...p };
  recruiting._truths(fresh, rc["attrs"]);
  for (const [pid, p] of Object.entries(rc["prospects"])) p["truth"] = fresh[pid]["truth"];
  for (const [pid, read] of Object.entries(rc["reads"])) {
    const p = get(rc["prospects"], pid);
    if (p === null) continue;
    for (const [g, [mean, prec]] of Object.entries(read["g"])) {
      read["g"][g] = [round(p["truth"][g] + (mean - old[pid][g]), 3), prec];
    }
  }
  rc["grades"] = "game";
}


// ----- what pulls a prospect to a school -----------------------------------------------------------

function _group(ea_position) {
  const pos = get(build_teams.POSITION_MAP, ea_position, ea_position);
  return pos === "MLB" || pos === "ROLB" || pos === "LOLB" ? "LB" : pos;
}


function _ahead(state, slug, group, ovr) {
  // Returning players at his position group on that roster rated at least as high as him
  // (in the portal: next year's roster in the career's league, signees included).
  let n = 0;
  if (recruiting.is_portal(state)) {
    const offseason = modules.offseason;
    for (const c of state["league"]["teams"][slug]["roster"]) if (get(offseason.GROUP, c["pos"]) === group && c["o"] >= ovr) n += 1;
    return n;
  }
  for (const o of recruiting._returning(slug, group)) if (o >= ovr) n += 1;
  return n;
}


recruiting.NEXT_IN_LINE = 2;          // *tune* this many past a group's starters are "next in line"; anyone behind them is depth


function depth_place(state, slug, pid) {
  // Where he would line up there in a word: "start" when fewer players at his group are rated at least as high as
  // him than the group starts (STARTERS: the second and third receiver start, as the fifth lineman does), "next" for
  // the NEXT_IN_LINE behind them, else "depth". A word for the page and the scenes: the pull itself is `pull`'s.
  const group = recruiting._group(state["recruiting"]["prospects"][pid]["ea_position"]);
  const ahead = recruiting._ahead(state, slug, group, state["recruiting"]["prospects"][pid]["ovr"]);
  const starters = get(recruiting.STARTERS, group, 2);
  return ahead < starters ? "start" : ahead < starters + recruiting.NEXT_IN_LINE ? "next" : "depth";
}


function ahead_of(state, slug, pid) {
  // The best returning player at his position group on that roster rated at least as high as him
  // (`_ahead`'s test, the one player it names): {name, position, cls, ovr, slug}, or None. In the
  // portal the career league's roster (next year's, signees included); otherwise the season's.
  const p = state["recruiting"]["prospects"][pid];
  const group = recruiting._group_of(p);
  let best = null;
  if (recruiting.is_portal(state)) {
    const offseason = modules.offseason;
    for (const c of state["league"]["teams"][slug]["roster"]) {
      if (get(offseason.GROUP, c["pos"]) === group && c["o"] >= p["ovr"] && (best === null || c["o"] > best["ovr"])) {
        best = { name: c["n"], position: get(recruiting.POS_247_OF, c["pos"], c["pos"]), cls: c["cls"], ovr: c["o"], slug: c["id"],
          last_year: _in(c["cls"], recruiting.LEAVING) };
      }
    }
    return best;
  }
  if (!recruiting._returning(slug, group).some((o) => o >= p["ovr"])) return null;       // `_ahead`'s own test, so the two always agree
  const season = modules.season;
  const t = season.load_teams()[slug];
  for (const q of t["offense"].concat(t["defense"])) {
    const ovr = get(q, "ovr") || 0;
    if ((q["position"] === "MLB" || q["position"] === "ROLB" || q["position"] === "LOLB" ? "LB" : q["position"]) === group
        && !_in(get(q, "class"), recruiting.LEAVING) && ovr >= p["ovr"] && (best === null || ovr > best["ovr"])) {
      best = { name: q["name"], position: q["position"], cls: get(q, "class"), ovr, slug: q["slug"],
        last_year: _in(get(q, "class"), recruiting.LAST_YEAR) };
    }
  }
  return best;
}


function promise_holds(state, slug, pid, question) {
  // Whether he can believe your promise. Over a roster player, always (the player's ask): a promised start is your
  // word to play him over the better player, and next season judges whether you do (promises.js); what can still make
  // one fail is two promises at his position (job_crowd) or your record at it (word.believes). Over another recruit,
  // when the recruit is rated at least as high.
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const about = question["about"];
  if (question["kind"] === "roster") return true;
  const other_pid = get(about, "pid");
  const other = other_pid === null ? null : get(rc["prospects"], other_pid);
  return other === null || p["ovr"] >= other["ovr"];
}


function other_offered(state, slug, pid) {
  // The highest-ranked other recruit at his position group the school has offered who is
  // uncommitted or committed to that school: {pid, name, position, rank}, or None.
  const rc = state["recruiting"];
  const group = recruiting._group_of(rc["prospects"][pid]);
  let best = null;
  for (const other of get(rc["offers"], slug, [])) {
    const st_ = rc["status"][other];
    if (other === pid || truthy(st_["signed"]) || !(st_["committed"] === null || st_["committed"] === slug)) continue;
    const q = rc["prospects"][other];
    if (recruiting._group_of(q) === group && (best === null || q["rank"] < best["rank"])) {
      best = { pid: other, name: q["name"], position: q["position"], rank: q["rank"] };
    }
  }
  return best;
}


recruiting._LEAVER_CUT = [null, 0];   // (career and year, the overall at the EARLY_LEAVER_POOL-th best draft-eligible underclassman)


function _early_leaver_cut(state) {
  // The overall from which a draft-eligible underclassman (three years out of high school)
  // projects a top-100 pick this season, league-wide.
  const key = _key(state["id"], recruiting._ck(state["recruiting"]));
  if (recruiting._LEAVER_CUT[0] !== key) {
    const season = modules.season;
    const offseason = modules.offseason;
    const pool = [];
    for (const t of Object.values(season.load_teams())) {
      if (truthy(t["fictional"])) continue;
      for (const p of t["offense"].concat(t["defense"])) {
        if (_in(get(p, "class"), offseason.UNDERCLASS_ELIGIBLE)) pool.push(get(p, "ovr") || 0);
      }
    }
    pool.sort((a, b) => cmp(b, a));
    recruiting._LEAVER_CUT = [key, pool.length >= recruiting.EARLY_LEAVER_POOL ? pool[recruiting.EARLY_LEAVER_POOL - 1] : 99];
  }
  return recruiting._LEAVER_CUT[1];
}


recruiting._GROUP = {};        // EA position -> roster group (offseason.GROUP, read once)

Object.assign(recruiting, {
  model, _miles, _logistic, _interp, use_league_models, _team_model, _baseline, attributes, fbs_schools, _home, tilt_for, _priorities,
  start, nil_ask, draw_generational, is_generational, contact_week, heal_contacts, upgrade_generational, market_value, tier_of, _tiers,
  flag_cuts, _percentile, _ck, close_week, early_signing_week, signing_week, closed, is_portal, upgrade_asks, hc_visit_week, _contact,
  ask_from, ask_spot, ask_known, ask_view, nil_value, is_lowball, cooled, _pester_exempt, not_considering, would_pester, pesters, upgrade_grades, _group,
  _ahead, depth_place, ahead_of, promise_holds, other_offered, _early_leaver_cut,
});

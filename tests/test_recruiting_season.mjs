// Recruiting over a real season: a seeded Coach Career played week by week, every school on its own.
// - To the selection week, every school's commitments follow each recruit's commit style (career_js/persona.js): a
//   Signing Day recruit never commits before the early signing period; a Hat Ceremony picks one of the finalists he
//   named, on or after his day; a Quiet Commit is marked quiet; only Needs Attention softens; Early Birds commit
//   sooner than the rest.
// - By the end of the season everyone has signed somewhere, no school past its open spots, about a third with FCS
//   schools, and the national class ranking counts exactly who signed.
// `node tests/test_recruiting_season.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects } = game.modules;

const st = season.new_season("georgia", "full", 2, undefined, undefined, true);

test("a season to the selection week: every school's commitments follow each recruit's style", () => {
  season.advance_to(st, season.SELECTION_WEEK);
  const rc = st["recruiting"];
  const first = {};
  for (const e of rc["log"]) if (["commit", "flip"].includes(e["kind"]) && !(e["pid"] in first) && e["school"] !== "FCS") first[e["pid"]] = e;
  const by = Object.fromEntries(Object.keys(persona.STYLES).map((k) => [k, Object.keys(first).filter((q) => persona.style(st, q) === k)]));
  const pairs = new Set(Object.keys(rc["prospects"]).filter((q) => persona.mate(st, q)));     // a Package Deal's mate commits with him, whatever his style
  const early = by["signing_day"].filter((q) => !pairs.has(q) && first[q]["week"] < recruiting.early_signing_week());
  assert(!early.length, `Signing Day recruits committed early: ${early.slice(0, 5)}`);
  assert(by["signing_day"].length, "Signing Day recruits commit on signing day");
  for (const q of by["hat"]) {
    if (pairs.has(q)) continue;
    const hat = rc["log"].filter((e) => e["kind"] === "hat" && e["pid"] === q && e["week"] <= first[q]["week"]).at(-1);     // his last ceremony
    assert(hat && hat["finalists"].includes(first[q]["school"]) && first[q]["week"] >= hat["day"], JSON.stringify([q, hat, first[q]]));
  }
  for (const q of by["quiet"]) assert(first[q]["quiet"], JSON.stringify(first[q]));
  assert(rc["log"].filter((e) => e["kind"] === "softened").every((e) => persona.style(st, e["pid"]) === "needs_attention"));
  const by8 = (k) => by[k].filter((q) => first[q]["week"] <= 8).length / Math.max(1, by[k].length);
  assert(by8("early_bird") > 1.3 * by8("needs_attention"), `committed by Week 8: Early Bird ${by8("early_bird")}, Needs Attention ${by8("needs_attention")}`);
});

test("by the end of the season everyone has signed, nobody past their open spots, about a third with FCS schools", () => {
  season.advance_to(st, season.FINAL_WEEK);
  const rc = st["recruiting"];
  const signed = Object.values(rc["status"]).map((s) => s["signed"]);
  assert(signed.every((s) => s), "a prospect never signed");
  const per = {};
  for (const s of signed) if (s !== "FCS") per[s] = (per[s] || 0) + 1;
  for (const [t, n] of Object.entries(per)) assert(n <= recruiting.open_spots(st, t), `${t} signed ${n}, past its ${recruiting.open_spots(st, t)} open spots`);
  const fcs = signed.filter((s) => s === "FCS").length / signed.length;
  assert(fcs > 0.25 && fcs < 0.45, `${fcs} of the class signed with FCS schools`);
  assert(recruiting.signed_class(st, "georgia").length === per["georgia"] && per["georgia"] > 0);
  const nc = prospects.national_classes(st);
  assert(nc["phase"] === "Signed" && nc["schools"].reduce((a, c) => a + c["count"], 0) === Object.values(per).reduce((a, b) => a + b, 0));
  const uga = nc["schools"].find((c) => c["school"] === "georgia");
  assert(uga["rank"] === prospects.class_rank(st, "georgia") && uga["count"] === per["georgia"] && uga["top"].length === Math.min(3, per["georgia"]));
  const ranks = ["georgia", "kent-state"].map((s) => prospects.class_rank(st, s));
  assert(ranks.every((r) => r >= 1 && r <= recruiting.fbs_schools(st).length) && ranks[0] < ranks[1], `class ranks ${ranks}`);
  let refused = null;
  try { recruiting.act(st, "georgia", Object.keys(rc["prospects"])[0], "message"); } catch (e) { refused = e; }
  assert(refused instanceof recruiting.RecruitingError && refused.code === 409, "a signed prospect was worked");
});

await run();

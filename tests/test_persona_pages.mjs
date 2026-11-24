// What the recruiting pages are told about a recruit's persona, through the API as the page calls it (app_js/api):
// what your staff learned stays in his History and out of the week's news; his profile carries the week's scouting
// points left; why he cooled on you (a lowball, a promise, silence) reaches the board and the visit's refusal; and
// a career saved before personas and scouting points still opens every recruiting page and plays on.
// `node tests/test_persona_pages.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { season, recruiting, api } = game;
const { persona } = game.modules;
persona.DECIDERS_ON = true;   // who decides is switched off in the game for now (persona.DECIDERS_ON): these tests hold what it does when it is on

const show = (v) => JSON.stringify(v);
const G = (sid, p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (sid, body) => api.call("POST", `/api/season/${sid}/recruit`, body);

function new_career(team, seed) {
  const sid = api.call("POST", "/api/season", { team, mode: "full", seed, career: true })["id"];
  G(sid, "recruiting");
  return [sid, api.loaded_state()];
}

function force(st, pid, personality, decider = "self", topic = null) {
  st["recruiting"]["prospects"][pid]["persona"] = { personality, decider, decider_topic: topic };
}

/** A visible prospect your school has not touched, passing `ok`. */
function cold(st, used, ok = () => true) {
  const rc = st["recruiting"], me = st["team"];
  const seen = recruiting.visible(st);
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  for (const pid of by_rank) {
    if (used.has(pid) || rc["prospects"][pid]["hidden"] || rc["status"][pid]["committed"] || me in (rc["contacts"][pid] || {})) continue;
    if (!seen.has(pid) || !ok(pid)) continue;
    used.add(pid);
    return pid;
  }
  throw new Error("no prospect");
}

const [sid, st] = new_career("ohio-state", 11);
const ME = st["team"], rc = st["recruiting"];
const used = new Set();

test("what your staff learned is in his History and never in the week's news", () => {
  const pid = cold(st, used);
  rc["board"] = [pid];
  force(st, pid, "cocky");
  rc["hours"][ME] = 1000;
  R(sid, { pid, action: "message" });                                // other news about him this week
  assert(persona.learn(st, ME, pid, "personality"));
  const week = st["current_week"];
  assert(rc["log"].some((e) => e["kind"] === "learned" && e["week"] === week && e["pid"] === pid));
  const v = G(sid, "recruiting");
  assert(!(v["recap"] || []).some((e) => e["kind"] === "learned"), "a learned line in the news");
  assert(!((G(sid, "recruiting/report")["reports"] || []).some((rep) => rep["rows"].some((r) => r["events"].some((e) => e["kind"] === "learned")))));
  const row = v["board"].find((b) => b["id"] === pid);
  assert(row["history"].some((e) => e["kind"] === "learned" && e["line"] === "Your staff learned he's cocky."), () => show(row["history"]));
  assert(row["traits"]["personality"] === "Cocky");
});

test("his profile carries the week's scouting points left and what a look at him costs", () => {
  const pid = cold(st, used);
  const prof = G(sid, `prospect/${pid}`);
  assert(prof["points_left"] === recruiting.scout_points_left(st, ME) && Number.isInteger(prof["scout_cost"]), () => show([prof["points_left"], prof["scout_cost"]]));
  const before = prof["points_left"];
  assert(R(sid, { pid, action: "scout" })["look"]);
  assert(G(sid, `prospect/${pid}`)["points_left"] === before - prof["scout_cost"], "a Send spends its cost");
});

test("why he cooled on you reaches the board, his profile and the visit's refusal", () => {
  // Loves the Attention, gone quiet two weeks: cooled for silence
  const quiet = cold(st, used);
  force(st, quiet, "attention");
  rc["hours"][ME] = 1000;
  R(sid, { pid: quiet, action: "message" });
  rc["board"] = [quiet];
  st["current_week"] += persona.ATTENTION_GAP;
  persona.cool_quiet(st, st["current_week"]);
  assert(recruiting.cooled(st, ME, quiet));
  let b = G(sid, "recruiting")["board"].find((x) => x["id"] === quiet);
  equal([Boolean(b["cooled"]), b["cooled_why"]], [true, "quiet"]);
  assert(G(sid, `prospect/${quiet}`)["cooled_why"] === "quiet");
  // a lowball: cooled for the offer
  const low = cold(st, used, (q) => recruiting.ask_from(st, ME, q) >= recruiting.LOWBALL_MIN);
  force(st, low, "business");
  rc["board"] = [quiet, low];
  R(sid, { pid: low, action: "offer", nil: 0 });
  b = G(sid, "recruiting")["board"].find((x) => x["id"] === low);
  equal([Boolean(b["cooled"]), b["cooled_why"]], [true, "lowball"]);
  // not cooled: no reason
  const fine = cold(st, used);
  rc["board"].push(fine);
  assert(G(sid, "recruiting")["board"].find((x) => x["id"] === fine)["cooled_why"] === null);
  // the visit's refusal says why
  for (const [why, pid] of [["quiet", quiet], ["lowball", low]]) {
    let e = null;
    try { recruiting.act(st, ME, pid, "official_visit"); } catch (err) { e = err; }
    assert(e instanceof recruiting.RecruitingError && e.code === 409 && e.message === recruiting.COOLED_409[why], () => show([why, e && e.message]));
  }
  assert(recruiting.COOLED_409["quiet"].includes("went quiet"));
  // a save from before the reason was kept reads as a lowball
  const kept = rc["cooled_why"];
  delete rc["cooled_why"];
  assert(persona.cooled_why(st, ME, quiet) === "lowball");
  rc["cooled_why"] = kept;
});

test("a career saved before personas and scouting points opens every recruiting page and plays on", () => {
  const me = "smu";
  const old = season.new_season(me, "full", 31, undefined, undefined, true);
  season.advance_to(old, 2);
  const orc = old["recruiting"];
  orc["hours"][me] = 1000;
  const seen = recruiting.visible(old);
  const free = recruiting.prospect_list(old).filter((q) => !orc["prospects"][q]["hidden"] && seen.has(q) && !(orc["reads"][q] || {})["looks"]
    && !orc["status"][q]["committed"]);
  const read = free[0];
  while (recruiting.report_looks(orc["reads"][read]) < persona.DECIDER_LOOKS) {
    orc["scout_points"] = { [me]: 999 };
    recruiting.act(old, me, read, "scout");
  }
  // a contact, its conversation left open: the first other prospect who takes the call (one may not consider the program)
  const fresh = free.slice(1).find((q) => { try { recruiting.act(old, me, q, "call"); return true; } catch { return false; } });
  assert(fresh, "nobody takes a call");
  orc["board"] = [read, fresh];
  // the old save: none of the newer keys
  for (const k of ["scout_points", "traits_known", "cooled_why"]) delete orc[k];
  for (const by of Object.values(orc["contacts"])) for (const c of Object.values(by)) delete c["calls"];
  orc["log"] = orc["log"].filter((e) => e["kind"] !== "learned");
  orc["hours"][me] = 55;
  for (const p of Object.values(orc["prospects"])) delete p["persona"];
  season.save_season(old);
  const raw = JSON.parse(game.files.read_text(`${season.SEASONS_DIR}/${old["id"]}.json`));
  assert(!("scout_points" in raw["recruiting"]) && !("traits_known" in raw["recruiting"]));

  const id = old["id"];
  api.call("GET", `/api/season/${id}`);
  const v = G(id, "recruiting");
  // (there are no scouting points: both read the week's energy, what is left of it and the whole of it)
  assert(v["points_left"] === v["hours_left"] && v["points_week"] === v["hours"], () => show([v["points_left"], v["points_week"]]));
  assert(v["hours_left"] === 55, () => String(v["hours_left"]));
  const sv = G(id, "scouting");
  assert(Number.isInteger(sv["points_left"]) && sv["points_left"] > 0);
  for (const p of ["scouting?scouted=1&sort=looks", "scouting?on_board=1", "recruiting/report", "prospects?limit=50", "classes", `classes?school=${me}`]) G(id, p);
  const now = api.loaded_state();
  // two looks tell who decides, whether or not the old save logged it
  const want = persona.DECIDER_LABEL[persona.of(now, read)["decider"]];
  assert(v["board"].find((b) => b["id"] === read)["traits"]["decider"] === want);
  assert(v["board"].find((b) => b["id"] === fresh)["traits"]["decider"] === null, "no looks: not known yet");
  assert(G(id, `prospect/${read}`)["points_left"] === v["points_left"]);
  G(id, `prospect/${fresh}`);
  // a Send works and spends points
  const target = sv["queue"].find((r) => r["can_send"] && ![read, fresh].includes(r["pid"]));
  assert(R(id, { pid: target["pid"], action: "scout" })["look"]);
  assert(G(id, "scouting")["points_left"] === sv["points_left"] - target["cost"]);
  // the open call finishes on an old contact (no `calls`)
  const sc = now["recruiting"]["scenes"][me][fresh];
  const pr = R(id, { pid: fresh, action: "present", scene: sc["id"], topics: recruiting.PITCHES.slice(0, 3) });
  if (pr["scene"]["question"]) R(id, { pid: fresh, action: "answer", scene: sc["id"], answer: "deflect" });
  const r = R(id, { pid: fresh, action: "pitch", scene: sc["id"], pitch: recruiting.PITCHES[0] });
  assert(["hit", "fair", "polite", "quiet", "tired"].includes(r["reaction"]["kind"]), () => show(r["reaction"]));
  const text = JSON.stringify([G(id, "recruiting"), G(id, "scouting"), G(id, `prospect/${read}`)]);
  assert(!text.includes("NaN") && !text.includes("undefined"));
});

await run();

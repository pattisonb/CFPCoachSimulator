// Taking a prospect off your board pulls your offer to him: the NIL comes back, the offer slot frees,
// a verbal commit of yours decommits, his History logs the pull; a hard commit cannot come off (his
// offer stands until he signs). A prospect you never offered just leaves the board. Through `api`,
// as the page calls it.
// `node tests/test_board_offer.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { api } = game;
const rec = game.recruiting;

const ME = "ohio-state";

const R = (sid, path, body) => api.call("POST", `/api/season/${sid}/${path}`, body);

function refused(fn, code, words) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code && e.message.includes(words), () => JSON.stringify([e.status, e.message]));
    return;
  }
  throw new Error(`expected ${code}`);
}

test("board offer", () => {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
  const rows = api.call("GET", `/api/season/${sid}/prospects?stars=3&limit=5000`)["rows"];
  const a = rows[40]["id"], b = rows[41]["id"], c = rows[42]["id"];
  const st = api.loaded_state();
  const rc = st["recruiting"];
  for (const pid of [a, b, c]) R(sid, "board", { pid, on: true });
  const pitch = rec.PITCHES[0];
  const left0 = rec.nil_left(st, ME);
  R(sid, "recruit", { pid: a, action: "offer", pitch, nil: 10 });
  assert(rc["offers"][ME].includes(a) && rec.nil_left(st, ME) === left0 - 10);

  // off the board: the offer goes with him, the NIL comes back, his History says so
  R(sid, "board", { pid: a, on: false });
  assert(!rc["board"].includes(a) && !rc["offers"][ME].includes(a), "taking him off the board pulls the offer");
  assert(rec.nil_left(st, ME) === left0, "the NIL on the offer comes back");
  assert(rc["log"].some((e) => e["kind"] === "pull_offer" && e["pid"] === a && e["school"] === ME), "the pull is logged");

  // never offered: he just leaves the board
  R(sid, "board", { pid: b, on: false });
  assert(!rc["board"].includes(b));

  // your verbal commit decommits when you take him off
  R(sid, "recruit", { pid: c, action: "offer", pitch, nil: 0 });
  Object.assign(rc["status"][c], { committed: ME, firmness: 60, hard: false });
  R(sid, "board", { pid: c, on: false });
  assert(rc["status"][c]["committed"] === null && !rc["offers"][ME].includes(c), "a verbal commit of yours decommits");

  // a hard commit cannot come off: his offer stands
  R(sid, "board", { pid: c, on: true });
  R(sid, "recruit", { pid: c, action: "offer", pitch, nil: 0 });
  Object.assign(rc["status"][c], { committed: ME, firmness: 95, hard: true });
  refused(() => R(sid, "board", { pid: c, on: false }), 409, "hard commit");
  assert(rc["board"].includes(c) && rc["offers"][ME].includes(c));

  // nor can a recruit who signed with you (the player took one off from the Classes tab's profile)
  Object.assign(rc["status"][c], { signed: ME, hard: false });
  refused(() => R(sid, "board", { pid: c, on: false }), 409, "signed with you");
  assert(rc["board"].includes(c));
  console.log("board offer ok: off the board pulls the offer and returns its NIL; a verbal commit decommits; a hard commit and a signee stay");
});

await run();

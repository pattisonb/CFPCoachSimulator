// The engine for a Python process on a computer (sim/engine.py starts one of these): a line of JSON in
// ({"id", "fn", "args"}), a line of JSON out ({"id", "ok", "result" | "error"}). It ends when its input does.
import readline from "readline";
import fs from "fs";
import { api } from "./api.js";

api.set_reader((path) => fs.readFileSync(path, "utf8"));

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line) return;
  let id = null;
  try {
    const msg = JSON.parse(line);
    id = msg.id;
    process.stdout.write(JSON.stringify({ id, ok: true, result: api[msg.fn](...msg.args) }) + "\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ id, ok: false, not_here: err instanceof api.NotHere, error: String((err && err.stack) || err).slice(0, 2000) }) + "\n");
  }
});
rl.on("close", () => process.exit(0));

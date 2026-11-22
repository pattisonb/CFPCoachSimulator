// The engine for a Python process on a computer (sim/engine.py starts one of these): a line of JSON in
// ({"id", "fn", "args"}), a line of JSON out ({"id", "ok", "result" | "error"}). It ends when its input does.
import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { api } from "./api.js";

// a path from the project's root, or an absolute one (a league's teams file)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
api.set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));

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

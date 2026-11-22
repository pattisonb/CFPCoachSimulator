// The game's data files, for the JavaScript that reads them: a path from the project's root ("data/game_scale.json")
// to its text or its parsed JSON. Whoever hosts the code says how a file is read (set_reader): Node's fs on a
// computer (bridge.mjs), the Python file system in the browser's game worker (worker.js). A host without the file
// throws, and the caller that can do without it catches that.
let reader = null;
const parsed = new Map();

/** `fn(path)` returns the file's text; `path` is from the project's root, or absolute for a league's teams file. */
export function set_reader(fn) {
  reader = fn;
  parsed.clear();
}

export function read_text(path) {
  if (!reader) throw new Error(`no way to read ${path}: set_reader was not called`);
  return reader(path);
}

/** The file as JSON, read and parsed once. */
export function read_json(path) {
  if (!parsed.has(path)) parsed.set(path, JSON.parse(read_text(path)));
  return parsed.get(path);
}

/** Forget a parsed file (it was rewritten). */
export function forget(path) {
  parsed.delete(path);
}

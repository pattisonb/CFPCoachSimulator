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

// ---- writing, and the folders of saves --------------------------------------------------------------------------
// The season's saves, box scores and built leagues are files in Python. The host gives a store that can do what
// those need (set_store): Node's fs on a computer, the browser's own storage there. Paths are from the project's
// root, as for reading.
let store = null;

/** `s`: { write(path, text), exists(path), remove(path), list(dir) -> names, mtime(path) -> ms or null, remove_dir(dir) }. */
export function set_store(s) { store = s; }

function need() {
  if (!store) throw new Error("no file store: set_store was not called");
  return store;
}

/** Write a file (its folders are made as needed). */
export function write_text(path, text) { need().write(path, text); parsed.delete(path); }
export const exists = (path) => need().exists(path);
/** Remove a file; nothing happens when it is not there. */
export function remove(path) { need().remove(path); parsed.delete(path); }
/** Remove a folder and everything in it; nothing happens when it is not there. */
export const remove_dir = (dir) => need().remove_dir(dir);
/** The names of the files in a folder (not its sub-folders), sorted; none when the folder is not there. */
export const list_dir = (dir) => need().list(dir);
/** When a file was last written, in milliseconds, or null when it is not there. */
export const mtime = (path) => need().mtime(path);

/** Settings a host passes in where Python read the environment (SIM_WORKERS, CFP_SEASONS_DIR). */
export const env = {};

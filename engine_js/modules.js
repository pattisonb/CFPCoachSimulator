// Where one part of the game finds another that is not ported yet. The Python modules import each other in circles
// and are being moved to JavaScript a few at a time, so a ported file cannot statically import one that does not
// exist yet. Each ported module puts its namespace here under its Python name (`modules.polls = polls`), and a call
// into a module still to come is written `modules.season.load_teams()`: it works the day that module is ported and
// registered, and until then throws a plain "not ported yet" error at the call, not at load.
const registered = {};

export const modules = new Proxy(registered, {
  get(target, name) {
    if (name in target || typeof name === "symbol") return target[name];
    throw new Error(`the game's ${String(name)} module is not ported to JavaScript yet`);
  },
});

/** Whether a module has been ported and loaded. */
export const has = (name) => name in registered;

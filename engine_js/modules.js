// The registry of the game's modules. The modules import each other in circles, so one cannot always import another
// statically without a cycle at load. Each module puts its namespace here under its own name as its last line
// (`modules.polls = polls`), and a call across a cycle is written `modules.season.load_teams()`: the module is
// looked up when the call runs, by which time app_js/game.js has loaded every one. A call into a module that has not
// been loaded throws a plain error at the call, not at load.
const registered = {};

export const modules = new Proxy(registered, {
  get(target, name) {
    if (name in target || typeof name === "symbol") return target[name];
    throw new Error(`the game's ${String(name)} module is not loaded`);
  },
});

/** Whether a module has been loaded and registered. */
export const has = (name) => name in registered;

// The season's namespace. The season is five thousand lines, kept as the parts in sim_js/season/ (loaded in
// order); each part puts its functions, constants and module variables on this one object, and every call
// to one of them, from any part, goes through it (`season.load_teams()`), as engine_js/PORTING.md says.
import { modules } from "../engine_js/modules.js";

export const season = {};
modules.season = season;

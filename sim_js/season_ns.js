// sim/season.py's namespace. The Python file is five thousand lines, ported as the parts in sim_js/season/ (in the
// file's own order); each part puts its functions, constants and module variables on this one object, and every call
// to one of them, from any part, goes through it (`season.load_teams()`), as engine_js/PORTING.md says.
import { modules } from "../engine_js/modules.js";

export const season = {};
modules.season = season;

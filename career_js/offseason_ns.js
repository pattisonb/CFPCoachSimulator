// The offseason's namespace: the offseason is kept as the parts in career_js/offseason/ (loaded in order), each
// putting its functions, constants and module variables on this one object (engine_js/PORTING.md, "Big Files in Parts").
import { modules } from "../engine_js/modules.js";

export const offseason = {};
modules.offseason = offseason;

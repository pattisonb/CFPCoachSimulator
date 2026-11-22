// The API's namespace: the API is kept as the parts in app_js/api/ (loaded in order), each putting its functions,
// constants and module variables on this one object (engine_js/PORTING.md, "Big Files in Parts").
import { modules } from "../engine_js/modules.js";

export const api = {};
modules.api = api;

// app/api.py's namespace: the Python file is ported as the parts in app_js/api/ (in the file's own order), each
// putting its functions, constants and module variables on this one object (engine_js/PORTING.md).
import { modules } from "../engine_js/modules.js";

export const api = {};
modules.api = api;

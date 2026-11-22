// sim/season.py: the season itself (its state, the weekly sim, the saves, and what the pages read). The parts are
// loaded in the Python file's order, since a later part's constants are built from an earlier one's.
import { season } from "./season_ns.js";
import "./season/part1.js";
import "./season/part2.js";
import "./season/part3.js";
import "./season/part4.js";
import "./season/part5.js";
import "./season/part6.js";

export { season };

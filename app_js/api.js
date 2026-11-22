// The game's API (the routes a page calls), loaded part by part in order: a later part builds on an earlier one's.
import { api } from "./api_ns.js";
import "./api/part1.js";
import "./api/part2.js";

export { api };

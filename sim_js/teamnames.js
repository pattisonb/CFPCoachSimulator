// Matching real-world team names (NCAA.com, ESPN, poll archives) to the engine's slugs.
// Used by the season engine for the real 2026 polls and results, and by the data tools.
import { modules } from "../engine_js/modules.js";

// names the automatic matcher cannot resolve on its own
const ALIASES = {
  "southern california": "usc", "miami (fl)": "miami", "army west point": "army",
  "app state": "app-st", "middle tenn": "mtsu", "south fla": "usf", "south florida": "usf",
  "florida international": "fiu", "massachusetts": "umass",
  "kennesaw st": "kennesaw-st", "jacksonville st": "jax-state", "ulm": "ul-monroe",
  "western ky": "w-kentucky", "central mich": "c-michigan", "eastern mich": "e-michigan",
  "western mich": "w-michigan", "coastal carolina": "c-carolina", "ga southern": "ga-southern",
  "fla atlantic": "fla-atlantic", "hawaii": "hawai-i", "san jose st": "san-jose-state",
  "new mexico st": "new-mexico-st", "missouri st": "missouri-state", "southern miss": "southern-miss",
  "louisiana tech": "louisiana-tech", "texas st": "texas-state", "arkansas st": "arkansas-state",
  "georgia st": "georgia-state", "ohio st": "ohio-state", "michigan st": "michigan-state",
  "mississippi st": "mississippi-state", "oklahoma st": "oklahoma-state", "oregon st": "oregon-state",
  "penn st": "penn-state", "iowa st": "iowa-state", "kansas st": "kansas-state", "florida st": "florida-state",
  "boise st": "boise-state", "colorado st": "colorado-state", "fresno st": "fresno-state",
  "utah st": "utah-state", "san diego st": "san-diego-state", "ball st": "ball-state",
  "kent st": "kent-state", "arizona st": "arizona-state", "washington st": "washington-state",
  "nc state": "nc-state", "north carolina": "north-carolina", "south carolina": "south-carolina",
  "notre dame": "notre-dame", "ole miss": "ole-miss", "texas a&m": "texas-am", "texas tech": "texas-tech",
  "west virginia": "west-virginia", "virginia tech": "virginia-tech", "georgia tech": "georgia-tech",
  "boston college": "boston-college", "wake forest": "wake-forest", "east carolina": "east-carolina",
  "old dominion": "old-dominion", "james madison": "james-madison", "south alabama": "south-alabama",
  "north texas": "north-texas", "new mexico": "new-mexico", "air force": "air-force",
  "bowling green": "bowling-green", "sam houston": "sam-houston", "miami (oh)": "miami-oh",
};

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Python's white space (str.isspace, and \s in its patterns): JavaScript's \s has U+FEFF and lacks U+001C-U+001F and U+0085
const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const RUNS = new RegExp(`${WS}+`, "g");
const ENDS = new RegExp(`^${WS}+|${WS}+$`, "g");

export function norm(name) {
  // Lower case, no dots or apostrophes, single spaces.
  const s = name.toLowerCase().replaceAll(".", "").replaceAll("'", "");
  return s.replace(RUNS, " ").replace(ENDS, "");
}

export function build_matcher(teams) {
  // A lookup from every spelling of a team (slug, name, school, abbreviation, alias) to its slug.
  const lookup = {};
  for (const [slug, t] of Object.entries(teams)) {
    // an FCS stand-in by its slug only: its names and abbreviation ("FCS") are no real school's
    const keys = t["fictional"] ? [slug] : [slug, slug.replaceAll("-", " "), t["name"], t["school"], t["abbreviation"]];
    for (const key of keys) {
      const n = teamnames.norm(key);
      if (!own(lookup, n)) lookup[n] = slug;
    }
  }
  for (const [k, v] of Object.entries(teamnames.ALIASES)) {
    if (own(teams, v)) lookup[teamnames.norm(k)] = v;
  }
  return lookup;
}

export function match(name, lookup) {
  // The slug for a real-world name, or null when nothing matches.
  const n = teamnames.norm(name);
  if (own(lookup, n)) return lookup[n];
  const n2 = n.endsWith(" st") ? n.replaceAll(" st", " state") : n;
  return own(lookup, n2) ? lookup[n2] : null;
}

export const teamnames = { ALIASES, norm, build_matcher, match };

modules.teamnames = teamnames;

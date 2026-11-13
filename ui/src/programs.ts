// Custom programs: the ones saved in this browser and the league file (cfp-league/1) they make. A port of the old
// UI's web/programs-lib.js; both read and write the same storage key, so a program made in one shows up in the other
// (and on the old New Career screen).

/** *tune* The browser storage key, shared with the old UI. */
const STORE = "cfp-custom-programs";
/** *tune* A rival outside the conference takes a non-conference week: three is what a schedule always fits. */
export const MAX_RIVALS = 3;

export const STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );
export const POSITIONS = "QB RB WR TE LT LG C RG RT LEDG DT REDG SAM MIKE WILL CB FS SS K P".split(" ");
export const CLASSES = ["FR", "SO", "JR", "SR", "FRRS", "SORS", "JRRS", "SRRS"];
export const STRENGTHS = ["Elite", "Strong", "Average", "Weak"];
/** The conference value that means "a conference of my own". */
export const NEW_CONF = "__new";

export type RivalryOften = "year" | "week" | "some";

/** A program's fields, as the old UI stores them (every one optional; blanks are filled by the game). */
export interface ProgramFields {
  name?: string;
  short_name?: string;
  abbreviation?: string;
  mascot?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  city?: string;
  state?: string;
  lat?: number;
  lon?: number;
  conference?: string;
  new_conf_name?: string;
  new_conf_games?: string;
  strength?: string;
  prestige?: string | number;
  coach?: string;
  oc?: string;
  dc?: string;
  offense?: string;
  defense?: string;
  rivals?: string[];
  rivalry_names?: Record<string, string>;
  rivalry_often?: Record<string, RivalryOften>;
  /** one player a line: "Name, POS, CLASS[, overall]" */
  roster?: string;
}

export interface Program {
  id: string;
  kind: "new" | "edit";
  /** the real team an edit changes */
  base: string | null;
  f: ProgramFields;
  updated: number;
}

/** A real team as GET /api/league/programs lists it; the details (GET /api/league/programs/{slug}) add the rest. */
export interface RealProgram {
  slug: string;
  name: string;
  short_name: string;
  abbreviation: string;
  conference: string | null;
  level: string;
  mascot?: string;
  city?: string;
  state?: string;
  lat?: number | null;
  lon?: number | null;
  colors?: Partial<Record<"primary" | "secondary" | "accent", { name: string; hex: string }>>;
  prestige?: number;
  rivals?: string[];
  offense?: string | null;
  defense?: string | null;
}

export interface Conference {
  id: string;
  name: string;
  games: number;
  level: string;
}

export interface ProgramsResponse {
  teams: RealProgram[];
  conferences: Conference[];
  playbooks: { offense: string[]; defense: string[] };
}

export interface CheckResponse {
  ok: boolean;
  errors?: string[];
}

let memory: Program[] | null = null; // storage unavailable: the visit keeps them here

export function loadPrograms(): Program[] {
  try {
    const raw = localStorage.getItem(STORE);
    const d = raw ? JSON.parse(raw) : null;
    return Array.isArray(d?.programs) ? d.programs : [];
  } catch {
    return memory ?? [];
  }
}

/** Saves the list; false when the browser won't keep it. */
export function savePrograms(list: Program[]): boolean {
  memory = list;
  try {
    localStorage.setItem(STORE, JSON.stringify({ version: 1, programs: list }));
    return true;
  } catch {
    return false;
  }
}

const slugify = (s: string | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "program";

export function slugOf(name: string | undefined, taken: Set<string>): string {
  const base = slugify(name);
  let s = base;
  for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
  taken.add(s);
  return s;
}

export interface RosterRow {
  name: string;
  pos: string;
  class: string;
  overall?: number;
}

/** "Name, POS, CLASS[, overall]" one a line, as rows (a bad line is kept so the problems name it). */
export function parseRoster(text: string | undefined): RosterRow[] {
  return String(text ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name = "", pos = "", cls = "", ovr = ""] = l.split(",").map((x) => x.trim());
      const row: RosterRow = { name, pos: pos.toUpperCase(), class: cls.toUpperCase() };
      if (ovr && Number.isFinite(Number(ovr))) row.overall = Number(ovr);
      return row;
    });
}

/** Which form field a problem belongs to. */
export type ProblemKey = "name" | "conference" | "new_conf_name" | "abbreviation" | "prestige" | "roster" | "rivals";

/** What a program still needs before the game can use it. */
export function problems(p: Program): { key: ProblemKey; msg: string }[] {
  const f = p.f;
  const out: { key: ProblemKey; msg: string }[] = [];
  if (p.kind === "new" && !f.name?.trim()) out.push({ key: "name", msg: "Give the program a name." });
  if (p.kind === "new" && !f.conference) out.push({ key: "conference", msg: "Pick a conference." });
  if (f.conference === NEW_CONF && !f.new_conf_name?.trim())
    out.push({ key: "new_conf_name", msg: "Name the new conference." });
  if (f.abbreviation && !/^[A-Za-z0-9&]{2,4}$/.test(f.abbreviation.trim()))
    out.push({ key: "abbreviation", msg: "An abbreviation is 2 to 4 letters or numbers." });
  if (f.prestige !== undefined && f.prestige !== "" && !(Number(f.prestige) >= 0 && Number(f.prestige) <= 100))
    out.push({ key: "prestige", msg: "Prestige runs from 0 to 100." });
  parseRoster(f.roster).forEach((r, i) => {
    if (!r.name) out.push({ key: "roster", msg: `Player ${i + 1} needs a name.` });
    else if (!POSITIONS.includes(r.pos))
      out.push({ key: "roster", msg: `${r.name}: '${r.pos || "?"}' is not a position.` });
    else if (!CLASSES.includes(r.class))
      out.push({ key: "roster", msg: `${r.name}: '${r.class || "?"}' is not a class (FR, SO, JR, SR, or with RS).` });
    else if (r.overall != null && !(r.overall >= 1 && r.overall <= 99))
      out.push({ key: "roster", msg: `${r.name}: an overall runs from 1 to 99.` });
  });
  const rivals = f.rivals ?? [];
  if (rivals.length > MAX_RIVALS) out.push({ key: "rivals", msg: `At most ${MAX_RIVALS} rivals.` });
  if (rivals.filter((x) => f.rivalry_often?.[x] === "week").length > 1)
    out.push({ key: "rivals", msg: "Only one rival can be your rivalry week game." });
  return out;
}

const color = (hex: string) => ({ name: hex.toUpperCase(), hex });

/** One program as a league file team (an edit writes only what changed from the real team). */
function team(p: Program, real: Record<string, RealProgram>, slug: string): Record<string, unknown> {
  const f = p.f;
  const base: Partial<RealProgram> = p.kind === "edit" && p.base ? (real[p.base] ?? {}) : {};
  const t: Record<string, unknown> = { slug };
  const put = (k: string, v: unknown, was: unknown) => {
    if (v !== undefined && v !== null && v !== "" && v !== was) t[k] = v;
  };
  put("name", f.name, base.name);
  put("short_name", f.short_name, base.short_name);
  put("abbreviation", f.abbreviation, base.abbreviation);
  put("mascot", f.mascot, base.mascot);
  put("city", f.city, base.city);
  put("state", f.state, base.state);
  if (Number.isFinite(f.lat) && Number.isFinite(f.lon) && (f.lat !== base.lat || f.lon !== base.lon)) {
    t.lat = f.lat;
    t.lon = f.lon;
  }
  put("conference", f.conference === NEW_CONF ? slugify(f.new_conf_name) : f.conference, base.conference);
  const bc = base.colors ?? {};
  const cols: Record<string, { name: string; hex: string }> = {};
  for (const k of ["primary", "secondary", "accent"] as const) {
    const hex = f[k];
    if (hex && hex !== bc[k]?.hex) cols[k] = color(hex);
  }
  if (Object.keys(cols).length) t.colors = p.kind === "edit" ? { ...bc, ...cols } : cols;
  if (f.strength) t.strength = STRENGTHS.includes(f.strength) ? f.strength : Number(f.strength);
  if (f.prestige !== undefined && f.prestige !== "" && Number(f.prestige) !== base.prestige)
    t.prestige = Number(f.prestige);
  const co: Record<string, unknown> = {};
  if (f.coach) co.head = { name: f.coach };
  if (f.oc) co.oc = { name: f.oc };
  if (f.dc) co.dc = { name: f.dc };
  if (f.offense && f.offense !== base.offense) co.offense = f.offense;
  if (f.defense && f.defense !== base.defense) co.defense = f.defense;
  if (Object.keys(co).length) t.coaches = co;
  const rv = (f.rivals ?? []).filter(Boolean).slice(0, MAX_RIVALS);
  const names = f.rivalry_names ?? {};
  const often = f.rivalry_often ?? {};
  const named = rv.some((x) => names[x]?.trim());
  const special = rv.some((x) => often[x] === "week" || often[x] === "some");
  const same = JSON.stringify([...rv].sort()) === JSON.stringify([...(base.rivals ?? [])].sort());
  if (rv.length && (named || special || !same))
    t.rivals = rv.map((x) => {
      const nm = names[x]?.trim() ?? "";
      const o = often[x] ?? "year";
      if (!nm && o === "year") return x;
      return {
        slug: x,
        ...(nm ? { name: nm } : {}),
        ...(o === "week" ? { rivalry_week: true } : {}),
        ...(o === "some" ? { every_year: false } : {}),
      };
    });
  const roster = parseRoster(f.roster);
  if (roster.length) t.roster = roster;
  if (p.kind === "new") t.level = "FBS";
  return t;
}

/** The league file for these programs: new conferences, then each program's team (an edit by its real slug). */
export function leagueDoc(list: Program[], real: Record<string, RealProgram>, name = "Custom Programs") {
  const taken = new Set(Object.keys(real));
  const conferences: Conference[] = [];
  const teams = list.map((p) => {
    const f = p.f;
    if (f.conference === NEW_CONF && f.new_conf_name) {
      const id = slugify(f.new_conf_name);
      if (!conferences.some((c) => c.id === id))
        conferences.push({ id, name: f.new_conf_name, level: "FBS", games: Number(f.new_conf_games) || 8 });
    }
    return team(p, real, p.kind === "edit" && p.base ? p.base : slugOf(f.name, taken));
  });
  return { format: "cfp-league/1", name, year: 2026, conferences, teams };
}

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A blank program, or an edit of a real team (its details already fetched). */
export function createProgram(base?: RealProgram): Program {
  const c = base?.colors ?? {};
  const f: ProgramFields = base
    ? {
        name: base.name,
        short_name: base.short_name,
        abbreviation: base.abbreviation,
        mascot: base.mascot,
        city: base.city,
        state: base.state,
        lat: Number.isFinite(base.lat) ? (base.lat as number) : undefined,
        lon: Number.isFinite(base.lon) ? (base.lon as number) : undefined,
        conference: base.conference ?? "",
        primary: c.primary?.hex,
        secondary: c.secondary?.hex,
        accent: c.accent?.hex,
        prestige: base.prestige,
        offense: base.offense ?? undefined,
        defense: base.defense ?? undefined,
        rivals: [...(base.rivals ?? [])],
      }
    : { conference: "", primary: "#1f4e79", secondary: "#ffffff", accent: "#111111", new_conf_games: "8" };
  return { id: newId(), kind: base ? "edit" : "new", base: base?.slug ?? null, f, updated: Date.now() };
}

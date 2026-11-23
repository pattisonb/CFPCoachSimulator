// Skins, the page's side: load one from a file, say which one is on, take it off. A skin gives the game other names
// and rosters, in this browser only (public/skin.js says what one is and holds the part the game's worker shares;
// tools/make_skin.mjs makes one). Only the published site takes a skin: `npm run dev` already shows the source
// rosters, and there the control is not shown (`available`).

interface SkinRuntime {
  FORMAT: number;
  FLAG: string;
  FAILED: string;
  plain: (name: unknown) => boolean;
  flag: () => { id: string; name: string } | null;
  write: (parts: Record<string, unknown>) => Promise<void>;
  clear: () => Promise<void>;
}
declare global {
  interface Window {
    Skin?: SkinRuntime;
    /** how many of the app's own names the skin gave it, and how many it had none for (public/skin.js `boot`) */
    __skinApp?: { done: number; missed: number };
  }
}

/** What the running game says of the skin it started with (the worker's "ready"). */
export interface SkinReport {
  id: string;
  name: string;
  /** the site's data has changed since the skin was made */
  stale: boolean;
  /** names of the site the skin has nothing for */
  missed: number;
}

/** *tune* The largest file taken, and the largest it may unpack to, in bytes. */
const MAX_FILE = 160 << 20;
const MAX_TEXT = 400 << 20;
/** *tune* The most files and the most words a skin may hold. */
const MAX_FILES = 4000;
const MAX_WORDS = 200000;

const KIND = "pocket-college-football";
const PATH = /^(?:data|cfb_sim_data)\/[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*\.json$/;
const SAVES = ["data/seasons/", "data/coaches/", "data/leagues/"]; // the player's own files: never a skin's

/** A reason a file was not taken, as a sentence for the page. */
export class SkinError extends Error {}

const no = (sentence: string): never => {
  throw new SkinError(sentence);
};

/** Skins can be loaded here: the published site, built with its lists of names. */
export const available = (): boolean => !!import.meta.env.VITE_SKINS && !!window.Skin;

/** The skin that is on, or null. */
export const current = (): { id: string; name: string } | null => (available() ? window.Skin!.flag() : null);

/** Why the game took the last skin off by itself, said once. */
export function failure(): string | null {
  try {
    const key = window.Skin?.FAILED;
    if (!key) return null;
    const said = localStorage.getItem(key);
    if (said) localStorage.removeItem(key);
    return said;
  } catch {
    return null;
  }
}

async function textOf(file: File): Promise<string> {
  if (file.size > MAX_FILE) no("This file is too large to be a roster file.");
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return file.text();
  // gzip: unpacked a piece at a time, so a file that would unpack past the limit is refused before it has
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_TEXT) {
      await reader.cancel();
      no("This file is too large to be a roster file.");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const goodPath = (p: string) => PATH.test(p) && !p.includes("..") && !SAVES.some((dir) => p.startsWith(dir));

/** The files of a skin, checked: every path is one of the game's data files and every file is JSON text. */
function filesOf(v: unknown, what: string): Record<string, string> {
  if (!isRecord(v)) return no(`This roster file is damaged: it has no ${what}.`);
  const paths = Object.keys(v);
  if (paths.length > MAX_FILES) no("This roster file is damaged: it holds too many files.");
  for (const p of paths) {
    const text = v[p];
    if (!goodPath(p)) no("This roster file is damaged: it names a file the game does not have.");
    if (typeof text !== "string" || !/^\s*[[{]/.test(text.slice(0, 64)))
      no("This roster file is damaged: one of its files is not data.");
  }
  return v as Record<string, string>;
}

/** A skin read from a file's text and checked; throws a SkinError that says what is wrong. */
export function parse(text: string): { meta: Record<string, unknown>; parts: Record<string, unknown> } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return no("This file could not be read. A roster file is a .json or .json.gz file.");
  }
  const S = window.Skin!;
  if (!isRecord(doc) || doc.skin !== KIND) return no("This file is not a roster file for this game.");
  if (doc.format !== S.FORMAT)
    no(
      `This roster file was made for another version of the game (format ${String(doc.format).slice(0, 8)}, and this one reads format ${S.FORMAT}). Ask for a new one.`,
    );
  const { id, name, base, pack, generated, words, made } = doc;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) no("This roster file is damaged: it has no id.");
  if (typeof name !== "string" || name.length > 40 || !S.plain(name))
    no("This roster file is damaged: it has no name.");
  if (typeof base !== "number") no("This roster file is damaged: it does not say what it was made for.");
  const paths = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= MAX_FILES && v.every((p) => typeof p === "string" && goodPath(p));
  if (!paths(pack) || !paths(generated) || !generated.every((p) => pack.includes(p)))
    return no("This roster file is damaged: its list of files cannot be read.");
  const files = filesOf(doc.files, "files");
  const sources = filesOf(doc.sources, "rosters");
  if (!Object.keys(files).every((p) => pack.includes(p)))
    no("This roster file is damaged: its list of files cannot be read.");
  if (!isRecord(words)) return no("This roster file is damaged: it has no names.");
  // the names: kept only where they are plain name text (public/skin.js writes no other into the game)
  const kept: Record<string, string[]> = Object.create(null);
  let count = 0;
  for (const shown of Object.keys(words)) {
    const list = words[shown];
    if (!Array.isArray(list)) continue;
    const names = list.filter((n): n is string => S.plain(n));
    count += names.length;
    if (count > MAX_WORDS) no("This roster file is damaged: it holds too many names.");
    if (names.length && shown.length <= 120) kept[shown] = names;
  }
  const when = isRecord(made) ? made : {};
  const meta = {
    format: S.FORMAT,
    id,
    name,
    base,
    pack,
    generated,
    made: { commit: String(when.commit ?? "").slice(0, 64), at: String(when.at ?? "").slice(0, 40) },
  };
  return { meta, parts: { words: kept, files, sources } };
}

/** Load the skin in `file` and turn it on. The page must be reloaded after: the game starts again on the skin. */
export async function install(file: File): Promise<void> {
  const S = window.Skin;
  if (!available() || !S) return no("This version of the game does not take a roster file.");
  let text: string;
  try {
    text = await textOf(file);
  } catch (e) {
    if (e instanceof SkinError) throw e;
    return no("This file could not be read. A roster file is a .json or .json.gz file.");
  }
  const { meta, parts } = parse(text);
  try {
    localStorage.removeItem(S.FLAG); // off while it is written: a half-kept skin is never started
    await S.write({ ...parts, cache: undefined, meta });
    localStorage.setItem(S.FLAG, JSON.stringify({ id: meta.id, name: meta.name }));
  } catch {
    no("This browser could not keep the roster file: its storage is full or switched off.");
  }
}

/** Take the skin off. Its careers are kept, and show again when the skin is loaded again. Reload after. */
export async function remove(): Promise<void> {
  const S = window.Skin;
  if (!S) return;
  try {
    localStorage.removeItem(S.FLAG);
  } catch {
    // no storage: nothing was on
  }
  try {
    await S.clear();
  } catch {
    // what is left of it is not read again
  }
}

/** The game could not start on the skin: it is taken off, with the reason kept for the page to say once. */
export async function fail(reason: string): Promise<void> {
  await remove();
  try {
    if (window.Skin) localStorage.setItem(window.Skin.FAILED, reason);
  } catch {
    // nowhere to keep the reason
  }
}

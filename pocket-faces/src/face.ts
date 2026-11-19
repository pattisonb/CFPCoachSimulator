import type { Category, CategoryInfo, FixedPart, Grid, Manifest, Part, RGB, WidthPart } from "./types.ts";
import { mulberry32 } from "./rng.ts";

/**
 * A face is a FaceSpec (a part from each category, a skin tone, hair and eye colours), composited from the data's
 * parts. The whole of it, so it ports as is:
 *
 *   1. for each category in the data's `order` (bottom to top): the spec's part, named under the category's
 *      `field`; a category it doesn't name gives its first part when the data marks it `default` (nose, mouth,
 *      brows, ears), else nothing (null: none);
 *   2. a width part (hair, beard, ears, chin) takes its variant for the face shape;
 *   3. each pixel's colour is its role's, recoloured: skin and skin shadow take the skin tone in every layer;
 *      a hair layer's (hair, beard, brows) black and hair shade take the hair colour, and only there (so the
 *      mouth keeps its black); the iris takes the eye colour;
 *   4. opaque pixels cover what is under them. No blending, no resampling. A layer marked `onHair` (the
 *      mouth) leaves its black off where facial hair is (`under`: the beard is drawn around the mouth, and
 *      covers a corner that strays into it), or draws it there in that role's colour instead;
 *   5. hair's fade pixels (hairFade) draw as its black, or with `hairFade` in the hair colour's `fade`;
 *   6. a category named in `flip` (and allowed to: `flip` in the data) draws its part mirrored about the
 *      middle column (`axis`), read as row[2 * axis - x];
 *   7. a skin tone and hair colour the data lists as too close (`lowContrast`): every hair-coloured pixel
 *      beside skin (left, right, up, down) takes that pair's edge colour, so the hairline still reads.
 */

/** a face to draw: a part id (or null) per category field, the colours, and the fade and flips */
export interface FaceSpec {
  faceShape: string;
  skinTone: string;
  hairColor: string;
  /** the iris colour (left out: as drawn) */
  eyeColor?: string;
  /** null: bald */
  hair?: string | null;
  /** null: clean shaven */
  beard?: string | null;
  nose?: string | null;
  mouth?: string | null;
  brows?: string | null;
  ears?: string | null;
  /** a chin dimple, or null */
  chin?: string | null;
  /** a faded style's temples in the lighter stroke (only hair with `fade` has any) */
  hairFade?: boolean;
  /** the categories drawn mirrored (only asymmetric parts change) */
  flip?: Category[];
  /** any other category's part, under its field */
  [field: string]: string | null | boolean | Category[] | undefined;
}

/**
 * A player's face, every field spelled out: the colours, a part id (or null) for each category the data has
 * parts in, under its field, and the fade and flips. What to store.
 */
export interface FaceJSON {
  faceShape: string;
  skinTone: string;
  hairColor: string;
  eyeColor: string;
  hairFade: boolean;
  flip: Category[];
  [field: string]: string | null | boolean | Category[];
}

/** how often a random face has its hair faded (when the style has a fade), and each asymmetric part flipped */
export const FADE_CHANCE = 0.5;
export const FLIP_CHANCE = 0.5;

const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
/** the parts a random face picks from: all but those marked `random: false` */
const pickable = (m: Manifest, c: Category): Part[] => (m.parts[c] ?? []).filter((p) => p.random !== false);
const isWidth = (p: Part): p is WidthPart => "variants" in p;
const partOf = (m: Manifest, c: Category, id: string | null | undefined): Part | undefined =>
  id ? m.parts[c]?.find((p) => p.id === id) : undefined;
/** the JSON key a category's part goes under */
export const fieldOf = (m: Manifest, c: Category): string => m.categories[c]?.field ?? (c === "face_shape" ? "faceShape" : c);
/** the categories a face names a part for (those with parts), bottom layer first */
export const partCategories = (m: Manifest): Category[] => m.order.filter((c) => (m.parts[c] ?? []).length > 0);
/** the categories whose asymmetric parts can be flipped */
export const flipCategories = (m: Manifest): Category[] => m.order.filter((c) => m.categories[c]?.flip);

/** a skin tone and hair colour too close to tell apart, as the data lists them */
const tooClose = (m: Manifest, skinTone: string, hairColor: string) =>
  (m.lowContrast ?? []).find((l) => l.skinTone === skinTone && l.hairColor === hairColor);

/** the spec's part for a category, or null: unnamed, a `default` category's first part */
function chosen(m: Manifest, spec: FaceSpec, c: Category): string | null {
  const v = spec[fieldOf(m, c)] as string | null | undefined;
  if (v === undefined && m.categories[c]?.default) return m.parts[c]?.[0]?.id ?? null;
  return v ?? null;
}

/**
 * A face from a seed: the same seed always gives the same face, for the same data (derive it from a player's id
 * with seedOf). The draws, in this order:
 *   face shape, skin tone, hair colour (one too close to the skin tone, `lowContrast`, moves on to the next in the
 *   list without another draw); then each category in the data's order, after the face shape, that has parts a
 *   random face can pick: an optional one draws whether it's there (`chance`), then which part; any other
 *   draws which part; then the eye colour; then always one draw for the fade and one for each category that can
 *   flip (kept only where the hair has a fade, or the part is asymmetric).
 * Parts marked `random: false` are never picked (a face can still be given one). Adding, removing or reordering
 * parts changes which face a seed gives: store a player's face JSON, not only the seed.
 */
export function randomFace(m: Manifest, seed: number): FaceSpec {
  const rnd = mulberry32(seed);
  const spec: FaceSpec = {
    faceShape: pick(rnd, pickable(m, "face_shape")).id,
    skinTone: pick(rnd, m.skinTones).id,
    hairColor: "",
  };
  let hc = Math.floor(rnd() * m.hairColors.length);
  for (let i = 0; i < m.hairColors.length && tooClose(m, spec.skinTone, m.hairColors[hc].id); i++) hc = (hc + 1) % m.hairColors.length;
  spec.hairColor = m.hairColors[hc].id;
  for (const c of m.order) {
    if (c === "face_shape") continue;
    const list = pickable(m, c);
    if (!list.length) continue;
    const info = m.categories[c];
    const has = info.optional ? rnd() < (info.chance ?? 0.5) : true;
    const id = pick(rnd, list).id;
    spec[fieldOf(m, c)] = has ? id : null;
  }
  if (m.eyeColors?.length) spec.eyeColor = pick(rnd, m.eyeColors).id;
  const fade = rnd() < FADE_CHANCE;
  if (fade && (partOf(m, "hair", chosen(m, spec, "hair")) as WidthPart | undefined)?.fade) spec.hairFade = true;
  const flip: Category[] = [];
  for (const c of flipCategories(m)) {
    if (rnd() < FLIP_CHANCE && partOf(m, c, chosen(m, spec, c))?.asymmetric) flip.push(c);
  }
  if (flip.length) spec.flip = flip;
  return spec;
}

/** RGBA pixels, size × size × 4, transparent where nothing is drawn */
export type Pixels = Uint8ClampedArray;

/** Composite a face: the steps above. Throws on a part, tone or colour the data doesn't have. */
export function composite(m: Manifest, spec: FaceSpec): Pixels {
  const n = m.size;
  const out = new Uint8ClampedArray(n * n * 4);
  /** which pixels a hair-coloured layer drew last (for `onHair` and the edge), and which are skin */
  const hairy = new Uint8Array(n * n);
  const skin = new Uint8Array(n * n);
  const face = m.parts.face_shape.find((p) => p.id === spec.faceShape) as FixedPart | undefined;
  if (!face) throw new Error(`no face shape "${spec.faceShape}"`);
  const tone = m.skinTones.find((t) => t.id === spec.skinTone);
  if (!tone) throw new Error(`no skin tone "${spec.skinTone}"`);
  const hairColor = m.hairColors.find((h) => h.id === spec.hairColor);
  const eyeColor = spec.eyeColor === undefined ? undefined : m.eyeColors.find((e) => e.id === spec.eyeColor);
  if (spec.eyeColor !== undefined && !eyeColor) throw new Error(`no eye colour "${spec.eyeColor}"`);
  const axis = m.axis ?? n / 2;
  for (const c of m.order) {
    const id = chosen(m, spec, c);
    if (!id) continue;
    const part = m.parts[c]?.find((p) => p.id === id);
    if (!part) throw new Error(`no ${c} "${id}"`);
    let grid: Grid;
    if (isWidth(part)) {
      const v = part.variants[face.id];
      if (!v) throw new Error(`${c} "${id}" has no variant for ${face.id}`);
      grid = v;
    } else grid = part;
    const info: CategoryInfo = m.categories[c];
    const recolor = info.recolor;
    const onHair = info.onHair;
    const flip = !!info.flip && !!spec.flip?.includes(c);
    if (recolor === "hair" && !hairColor) throw new Error(`no hair colour "${spec.hairColor}"`);
    grid.pixels.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const sx = flip ? 2 * axis - x : x;
        const role = sx >= 0 && sx < row.length ? m.codes[row[sx]] : undefined;
        if (!role) continue;
        const p = y * n + x;
        let r: typeof role = role === "hairFade" && !spec.hairFade ? "black" : role;
        if (onHair && role === "black" && hairy[p]) {
          if (onHair === "under") continue;
          r = onHair;
        }
        let rgb: RGB = m.roles[r];
        if (r === "skin" || r === "skinShadow") rgb = tone[r];
        else if (recolor === "hair" && r === "black") rgb = hairColor!.black;
        else if (recolor === "hair" && r === "hairShade") rgb = hairColor!.shade;
        else if (recolor === "hair" && r === "hairFade") rgb = hairColor!.fade ?? hairColor!.black;
        else if (r === "iris" && eyeColor) rgb = eyeColor.iris;
        hairy[p] = recolor === "hair" ? 1 : 0;
        skin[p] = r === "skin" || r === "skinShadow" ? 1 : 0;
        const i = p * 4;
        out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = 255;
      }
    });
  }
  // hair too close to the skin: an edge where it meets it
  const low = tooClose(m, spec.skinTone, spec.hairColor);
  if (low) {
    const edges: number[] = [];
    for (let p = 0; p < n * n; p++) {
      if (!hairy[p]) continue;
      const x = p % n, y = (p / n) | 0;
      if ((x > 0 && skin[p - 1]) || (x < n - 1 && skin[p + 1]) || (y > 0 && skin[p - n]) || (y < n - 1 && skin[p + n])) edges.push(p);
    }
    for (const p of edges) { out[p * 4] = low.edge[0]; out[p * 4 + 1] = low.edge[1]; out[p * 4 + 2] = low.edge[2]; }
  }
  return out;
}

/** the fields of a face's JSON for this data, in order: the colours, a field per category with parts, the fade and flips */
export function faceFields(m: Manifest): string[] {
  return ["faceShape", "skinTone", "hairColor", "eyeColor", ...partCategories(m).filter((c) => c !== "face_shape").map((c) => fieldOf(m, c)), "hairFade", "flip"];
}

/**
 * A face with every field spelled out (what to store for a player): a default part (nose, mouth, brows, ears) by
 * its id, an unnamed optional part as null, an unnamed eye colour as the first; `hairFade` true only on hair that
 * has a fade, `flip` only the categories whose part is asymmetric (in layer order).
 */
export function resolveFace(m: Manifest, spec: FaceSpec): FaceJSON {
  const out: FaceJSON = {
    faceShape: spec.faceShape,
    skinTone: spec.skinTone,
    hairColor: spec.hairColor,
    eyeColor: spec.eyeColor ?? m.eyeColors[0]?.id ?? "",
    hairFade: false,
    flip: [],
  };
  for (const c of partCategories(m)) if (c !== "face_shape") out[fieldOf(m, c)] = chosen(m, spec, c);
  out.hairFade = !!spec.hairFade && !!(partOf(m, "hair", chosen(m, spec, "hair")) as WidthPart | undefined)?.fade;
  out.flip = flipCategories(m).filter((c) => spec.flip?.includes(c) && partOf(m, c, chosen(m, spec, c))?.asymmetric);
  // in faceFields order
  const ordered = {} as FaceJSON;
  for (const f of faceFields(m)) ordered[f] = out[f];
  return ordered;
}

/** what a field of a face's JSON may hold, for checking and repairing one */
interface FieldRule { field: string; ids: string[]; nullable: boolean; required: boolean }
function fieldRules(m: Manifest): FieldRule[] {
  const rules: FieldRule[] = [
    { field: "faceShape", ids: (m.parts.face_shape ?? []).map((p) => p.id), nullable: false, required: true },
    { field: "skinTone", ids: m.skinTones.map((t) => t.id), nullable: false, required: true },
    { field: "hairColor", ids: m.hairColors.map((h) => h.id), nullable: false, required: true },
    { field: "eyeColor", ids: m.eyeColors.map((e) => e.id), nullable: false, required: false },
  ];
  for (const c of partCategories(m)) {
    if (c === "face_shape") continue;
    rules.push({ field: fieldOf(m, c), ids: m.parts[c].map((p) => p.id), nullable: !!m.categories[c]?.optional, required: false });
  }
  return rules;
}

/** each problem with a face's JSON, and the spec as far as it goes */
function check(m: Manifest, json: unknown): { spec: FaceSpec; errors: { field: string; message: string }[] } {
  const o = (typeof json === "string" ? JSON.parse(json) : json) as Record<string, unknown>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("a face is a JSON object");
  const errors: { field: string; message: string }[] = [];
  const spec = { faceShape: "", skinTone: "", hairColor: "" } as FaceSpec;
  for (const r of fieldRules(m)) {
    const v = o[r.field];
    if (v === undefined) {
      if (r.required) errors.push({ field: r.field, message: `${r.field} is required` });
      continue;
    }
    if ((v === null && r.nullable) || (typeof v === "string" && r.ids.includes(v))) spec[r.field] = v as string | null;
    else errors.push({ field: r.field, message: `${r.field}: ${JSON.stringify(v)} is not one of ${r.nullable ? "null, " : ""}${r.ids.join(", ")}` });
  }
  if (o.hairFade !== undefined) {
    if (typeof o.hairFade === "boolean") spec.hairFade = o.hairFade;
    else errors.push({ field: "hairFade", message: `hairFade: ${JSON.stringify(o.hairFade)} is not true or false` });
  }
  if (o.flip !== undefined) {
    const can = flipCategories(m);
    if (Array.isArray(o.flip) && o.flip.every((c) => can.includes(c))) spec.flip = o.flip as Category[];
    else errors.push({ field: "flip", message: `flip: ${JSON.stringify(o.flip)} is not a list of ${can.join(", ")}` });
  }
  return { spec, errors };
}

/**
 * A player's face from JSON: every id checked against the data, so a typo or a removed part is an error that
 * names it, not a face drawn wrong. Fields it leaves out take their defaults; unknown fields are ignored.
 */
export function parseFace(m: Manifest, json: unknown): FaceSpec {
  const { spec, errors } = check(m, json);
  if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"));
  return spec;
}

/**
 * A face from JSON that may name ids this data doesn't have (saved with an older version: a removed hair
 * colour, say): each bad or missing required field takes its first option (a bad optional part: none; a bad
 * fade or flip: off). Returns the face and what was changed. Throws only when it isn't a JSON object.
 */
export function repairFace(m: Manifest, json: unknown): { spec: FaceSpec; fixed: string[] } {
  const { spec, errors } = check(m, json);
  const rules = new Map(fieldRules(m).map((r) => [r.field, r]));
  const fixed: string[] = [];
  for (const e of errors) {
    const r = rules.get(e.field);
    if (r) {
      spec[r.field] = r.nullable ? null : r.ids[0];
      fixed.push(`${e.message}: now ${JSON.stringify(spec[r.field])}`);
    } else {
      delete spec[e.field];
      fixed.push(`${e.message}: left off`);
    }
  }
  return { spec, fixed };
}

/** a spec as a cache key: its fields in one fixed order */
export const specKey = (s: FaceSpec): string =>
  Object.keys(s).filter((k) => s[k] !== undefined).sort().map((k) => `${k}=${Array.isArray(s[k]) ? (s[k] as string[]).join("+") : String(s[k])}`).join("|");

/** Composited faces by spec, each made once (a roster shows dozens at once). */
export class FaceCache {
  private faces = new Map<string, Pixels>();
  private readonly m: Manifest;
  private readonly max: number;
  constructor(m: Manifest, max = 512) {
    this.m = m;
    this.max = max;
  }
  get(spec: FaceSpec): Pixels {
    const k = specKey(spec);
    let px = this.faces.get(k);
    if (!px) {
      px = composite(this.m, spec);
      if (this.faces.size >= this.max) this.faces.delete(this.faces.keys().next().value!);
      this.faces.set(k, px);
    }
    return px;
  }
  get size(): number { return this.faces.size; }
}

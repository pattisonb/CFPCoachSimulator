/**
 * pocket-faces: 48x48 pixel-art faces stacked from layers, one small JSON per player.
 *
 *   import { createFaces } from "pocket-faces";
 *   import data from "pocket-faces/data";
 *
 *   const faces = createFaces(data);
 *   const look = faces.random("player-7");     // the same id always gives the same face
 *   faces.draw(ctx, look, x, y, { scale: 3 });   // into any canvas
 *   save(JSON.stringify(look));                  // what a player stores; faces.parse() reads it back
 *   faces.catalog();                             // every option with its name, to build a customiser
 *
 * Everything else (randomFace, composite, parseFace, ...) is exported as well, for doing it by hand.
 */
import { FaceCache, fieldOf, flipCategories, hairColorsFor, parseFace, partCategories, randomFace, repairFace, resolveFace, specKey, type FaceJSON, type FaceSpec, type Pixels, type RandomOptions } from "./face.ts";
import { seedOf } from "./rng.ts";
import type { Category, Manifest, RGB, WidthPart } from "./types.ts";

export * from "./face.ts";
export * from "./rng.ts";
export type * from "./types.ts";

export const VERSION = "0.3.0";
/** a rectangle on the 48x48 canvas */
export interface Box { x: number; y: number; w: number; h: number }
export interface DrawOptions {
  /** whole-number pixel scale (default 1) */
  scale?: number;
  /** true (default): only the part of the canvas faces use (`cropBox`), so a face isn't lost in empty space */
  crop?: boolean;
}

/** every value each field of the face JSON can take, in order (null first where it can be left off); `flip`: the categories that can */
export interface FaceOptions {
  faceShape: string[];
  skinTone: string[];
  hairColor: string[];
  eyeColor: string[];
  hairFade: boolean[];
  flip: Category[];
  /** each category's field: its part ids */
  [field: string]: (string | null)[] | boolean[];
}

/** one option, for a customiser: its id (what's stored), its name, and for colours the colour */
export interface Choice { id: string | null; label: string; rgb?: RGB }
/** a group of options: a category of parts (`category` set) or a colour */
export interface CatalogEntry {
  /** the face JSON field it sets */
  field: string;
  label: string;
  /** set for parts: the layer */
  category?: Category;
  /** can be left off (null is the first choice) */
  nullable: boolean;
  /** parts: flippable when the chosen one is asymmetric */
  flip?: boolean;
  choices: Choice[];
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function newCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  throw new Error("pocket-faces: drawing needs a browser (or a worker with OffscreenCanvas); pixels() works anywhere");
}

/** the part of the canvas any face, hair or beard uses, with a pixel spare at the top and sides */
export function cropBox(m: Manifest): Box {
  let x0 = m.size, y0 = m.size, x1 = 0, y1 = 0;
  for (const c of ["face_shape", "hair", "beard"] as const) {
    for (const p of m.parts[c] ?? []) {
      for (const g of "variants" in p ? Object.values(p.variants) : [p]) {
        g.pixels.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] === ".") continue;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
        });
      }
    }
  }
  const x = Math.max(0, x0 - 1), y = Math.max(0, y0 - 1);
  return { x, y, w: Math.min(m.size, x1 + 2) - x, h: Math.min(m.size, y1 + 1) - y };
}

/**
 * The face kit for one data set. Faces are composited once and kept (a roster of dozens is cheap to redraw
 * every frame).
 */
export function createFaces(data: Manifest, { cacheSize = 512 }: { cacheSize?: number } = {}) {
  const pixelCache = new FaceCache(data, cacheSize);
  const sprites = new Map<string, AnyCanvas>();
  const crop = cropBox(data);
  const full: Box = { x: 0, y: 0, w: data.size, h: data.size };
  const ids = (c: Category) => (data.parts[c] ?? []).map((p) => p.id);
  const partIn = (c: Category, id: unknown) => (typeof id === "string" ? data.parts[c]?.find((p) => p.id === id) : undefined);

  /** the face as a 48x48 canvas, made once per face */
  const sprite = (spec: FaceSpec): AnyCanvas => {
    const k = specKey(spec);
    let s = sprites.get(k);
    if (!s) {
      const n = data.size;
      s = newCanvas(n, n);
      (s.getContext("2d") as AnyContext).putImageData(new ImageData(new Uint8ClampedArray(pixelCache.get(spec)), n, n), 0, 0);
      if (sprites.size >= cacheSize) sprites.delete(sprites.keys().next().value!);
      sprites.set(k, s);
    }
    return s;
  };

  const faces = {
    data,
    /** the canvas size every part is drawn on (48) */
    size: data.size,
    /** the box `crop: true` draws */
    cropBox: crop,

    /**
     * a face from a player id (or a 32-bit seed): the same id always gives the same face. `group: "coach"` also
     * draws from the hair colours kept for coaches (gray); players never get those.
     */
    random(idOrSeed: string | number, opts: RandomOptions = {}): FaceJSON {
      return resolveFace(data, randomFace(data, typeof idOrSeed === "number" ? idOrSeed >>> 0 : seedOf(idOrSeed), opts));
    },
    /** a stored face (a JSON string or object) checked against the data; throws naming every bad field */
    parse(json: unknown): FaceJSON {
      return resolveFace(data, parseFace(data, json));
    },
    /**
     * a stored face that may name ids this data no longer has (saved with an older version): each bad field
     * takes its first option (an optional part: none). Returns the face and a line per change ([] if none).
     */
    repair(json: unknown): { face: FaceJSON; fixed: string[] } {
      const { spec, fixed } = repairFace(data, json);
      return { face: resolveFace(data, spec), fixed };
    },
    /** the problems with a stored face, [] when it's good */
    validate(json: unknown): string[] {
      try { parseFace(data, json); return []; } catch (e) { return (e instanceof Error ? e.message : String(e)).split("\n"); }
    },
    /** a face with every field spelled out (defaults filled in), ready to store */
    resolve(spec: FaceSpec): FaceJSON {
      return resolveFace(data, spec);
    },
    /**
     * every value each field can take (to pick from yourself); `catalog()` has the same with names. A hair
     * colour kept for a group (gray: coaches) is listed only with that `group`.
     */
    options({ group }: RandomOptions = {}): FaceOptions {
      const out: FaceOptions = {
        faceShape: ids("face_shape"),
        skinTone: data.skinTones.map((t) => t.id),
        hairColor: hairColorsFor(data, group).map((h) => h.id),
        eyeColor: data.eyeColors.map((e) => e.id),
        hairFade: [false, true],
        flip: flipCategories(data),
      };
      for (const c of partCategories(data)) {
        if (c === "face_shape") continue;
        out[fieldOf(data, c)] = [...(data.categories[c].optional ? [null] : []), ...ids(c)];
      }
      return out;
    },
    /**
     * Every option, grouped as a customiser shows them: the face shape, skin tone, each category of parts (layer
     * order, bottom first), hair colour and eye colour, each choice with its id and name (colours with their RGB).
     * A hair colour kept for a group (gray: coaches) is a choice only with that `group`.
     */
    catalog({ group }: RandomOptions = {}): CatalogEntry[] {
      const parts = (c: Category): CatalogEntry => ({
        field: fieldOf(data, c),
        label: data.categories[c].label ?? c,
        category: c,
        nullable: !!data.categories[c].optional,
        ...(data.categories[c].flip ? { flip: true } : {}),
        choices: [...(data.categories[c].optional ? [{ id: null, label: "None" }] : []), ...data.parts[c].map((p) => ({ id: p.id, label: p.label ?? p.id }))],
      });
      return [
        parts("face_shape"),
        { field: "skinTone", label: "Skin", nullable: false, choices: data.skinTones.map((t) => ({ id: t.id, label: t.label, rgb: t.skin })) },
        ...partCategories(data).filter((c) => c !== "face_shape").map(parts),
        { field: "hairColor", label: "Hair colour", nullable: false, choices: hairColorsFor(data, group).map((h) => ({ id: h.id, label: h.label, rgb: h.black })) },
        { field: "eyeColor", label: "Eyes", nullable: false, choices: data.eyeColors.map((e) => ({ id: e.id, label: e.label, rgb: e.iris })) },
      ];
    },
    /** does this face's hair have a fade (so `hairFade` changes it)? */
    canFade(face: FaceSpec): boolean {
      return !!(partIn("hair", face.hair) as WidthPart | undefined)?.fade;
    },
    /** can this face's part in a category be flipped (the category allows it and the part is asymmetric)? */
    canFlip(face: FaceSpec, category: Category): boolean {
      const f = resolveFace(data, face);
      return !!data.categories[category]?.flip && !!partIn(category, f[fieldOf(data, category)])?.asymmetric;
    },

    /** the face's RGBA pixels, size x size x 4 (no DOM needed: servers, tests, WebGL textures). Don't modify. */
    pixels(spec: FaceSpec): Pixels {
      return pixelCache.get(spec);
    },
    /** draw the face into a 2D context, its top left at (x, y), pixel-sharp */
    draw(ctx: AnyContext, spec: FaceSpec, x: number, y: number, { scale = 1, crop: c = true }: DrawOptions = {}): void {
      const b = c ? crop : full;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite(spec), b.x, b.y, b.w, b.h, x, y, b.w * scale, b.h * scale);
      ctx.imageSmoothingEnabled = smooth;
    },
    /** a new canvas with the face on it, `scale` times its size (to put in the page) */
    canvas(spec: FaceSpec, { scale = 1, crop: c = true }: DrawOptions = {}): HTMLCanvasElement {
      const b = c ? crop : full;
      const out = newCanvas(b.w * scale, b.h * scale) as HTMLCanvasElement;
      faces.draw(out.getContext("2d")!, spec, 0, 0, { scale, crop: c });
      if ("style" in out) out.style.imageRendering = "pixelated";
      return out;
    },
    /** the face as a PNG data URL (for an <img>, CSS, or a texture loader) */
    dataURL(spec: FaceSpec, opts: DrawOptions = {}): string {
      return faces.canvas(spec, opts).toDataURL("image/png");
    },
  };
  return faces;
}

export type Faces = ReturnType<typeof createFaces>;

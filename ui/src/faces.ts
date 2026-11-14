import { createFaces, type CatalogEntry, type Category, type FaceJSON } from "pocket-faces";
import data from "pocket-faces/data";

// One face kit for the app: faces are composited once and cached, so thumbnails are cheap.
export const faces = createFaces(data);
export type Face = FaceJSON;
/** A face JSON field: the data names them (faceShape, hair, beard, …), so a new category needs no code. */
export type FaceField = string;
export type { CatalogEntry, Category };

/** Every option, grouped by field, with names (pocket-faces 0.2 `catalog()`). */
export const CATALOG: CatalogEntry[] = faces.catalog();

/** A new random face (a fresh seed each call). */
export const randomFace = (): Face => faces.random(Math.floor(Math.random() * 2 ** 32));

/** A face with one layer flipped or not; resolve drops a flip that changes nothing. */
export const withFlip = (face: Face, category: Category, on: boolean): Face =>
  faces.resolve({ ...face, flip: on ? [...face.flip, category] : face.flip.filter((c) => c !== category) });

const SMALL = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"]);
/** The face data's names are sentence case ("Short crop"); labels here are Title Case ("Short Crop"). */
export const titleCase = (s: string) =>
  s
    .split(" ")
    .map((w, i, all) =>
      i > 0 && i < all.length - 1 && SMALL.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ")
    .replace(/colour/gi, (c) => (c[0] === "C" ? "Color" : "color"));

/** *tune* Positions drawn with the widest face shapes: the roster's (OL, DL), the depth chart's roles (LT, DT…) and
 *  recruiting's (OT, IOL, EDGE), so a recruit keeps his face when he signs. */
const LINEMEN = new Set([
  "OL",
  "OT",
  "IOL",
  "OG",
  "LT",
  "LG",
  "C",
  "RG",
  "RT",
  "DL",
  "DT",
  "EDGE",
  "DE",
  "LEDG",
  "REDG",
]);
/** *tune* Linemen pick from the last this-many face shapes (the widest); skill players never from the last SKILL_SKIP. */
const LINEMAN_SHAPES = 3;
const SKILL_SKIP = 2;

const SHAPES = faces.options().faceShape;
const playerFaces = new Map<string, Face>();

/** A small stable hash (FNV-1a), so a player's shape pick never changes between visits. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A player's face, the same every time for the same player: rolled from their id, then given a face shape that suits
 * the position (linemen the widest shapes, everyone else the narrower ones). A recruit's id (r2027-0001) becomes his
 * roster slug when he signs, so prospect and player share one face.
 */
export function playerFace(id: string, position: string): Face {
  const key = `${id}|${LINEMEN.has(position) ? "line" : "skill"}`;
  const hit = playerFaces.get(key);
  if (hit) return hit;
  const shapes = LINEMEN.has(position) ? SHAPES.slice(-LINEMAN_SHAPES) : SHAPES.slice(0, -SKILL_SKIP);
  const face = faces.resolve({
    ...faces.random(`player-${id}`),
    faceShape: shapes[hash(`${id}-shape`) % shapes.length],
  });
  playerFaces.set(key, face);
  return face;
}

import { createFaces, type CatalogEntry, type Category, type FaceJSON } from "pocket-faces";
import data from "pocket-faces/data";
import { titleCase as title } from "./format.ts";

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

/** The face data's names are sentence case ("Short crop", "Side part (left)"); labels here are Title Case, American. */
export const titleCase = (s: string) => title(s).replace(/colour/gi, (c) => (c[0] === "C" ? "Color" : "color"));

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
const playerPresets = new Map<string, Face>();

/** A small stable hash (FNV-1a), so a player's shape pick never changes between visits. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A player's face, the same every time for the same player: his preset face when he has one (made from his roster
 * photo), else rolled from their id, then given a face shape that suits
 * the position (linemen the widest shapes, everyone else the narrower ones). A recruit's id (r2027-0001) becomes his
 * roster slug when he signs, so prospect and player share one face.
 */
export function playerFace(id: string, position: string): Face {
  const key = `${id}|${LINEMEN.has(position) ? "line" : "skill"}`;
  const hit = playerPresets.get(id) ?? playerFaces.get(key);
  if (hit) return hit;
  const shapes = LINEMEN.has(position) ? SHAPES.slice(-LINEMAN_SHAPES) : SHAPES.slice(0, -SKILL_SKIP);
  const face = faces.resolve({
    ...faces.random(`player-${id}`),
    faceShape: shapes[hash(`${id}-shape`) % shapes.length],
  });
  playerFaces.set(key, face);
  return face;
}

/** A player's look: the face drawn for him this season (Edit Player Look), else the one from his id. */
export function lookOf(saved: unknown, id: string, position: string): Face {
  return saved ? faces.repair(saved).face : playerFace(id, position);
}

const staffFaces = new Map<string, Face>();
const coachPresets = new Map<string, Face>();

/** The preset faces of real players (by slug) and coaches (by name), as GET /api/teams sends them: each is checked,
 *  and a bad part is repaired. */
export function setPresetFaces(players: Record<string, unknown>, coaches: Record<string, unknown>): void {
  for (const [to, from] of [
    [playerPresets, players],
    [coachPresets, coaches],
  ] as const) {
    to.clear();
    for (const [key, face] of Object.entries(from)) if (face) to.set(key, faces.repair(face).face);
  }
  playerFaces.clear();
  staffFaces.clear();
}

/** A real coach's preset face, if he has one. */
export const presetCoachFace = (name: string): Face | null => coachPresets.get(name) ?? null;

/** A staff member's face (a coordinator or a scout), the same every time for the same name: his preset, else rolled. */
export function staffFace(name: string): Face {
  let face = staffFaces.get(name);
  if (!face) {
    face = coachPresets.get(name) ?? faces.resolve(faces.random(`staff-${name}`));
    staffFaces.set(name, face);
  }
  return face;
}

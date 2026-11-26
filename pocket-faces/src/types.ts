/**
 * The shape of the face data (faces.json; made from the art by tools/build_faces.py build). Every part is
 * a 48x48 grid of colour roles; a width part has one grid per face shape.
 */
export type RGB = [number, number, number];
export type Role = "skin" | "skinShadow" | "black" | "white" | "iris" | "hairShade" | "hairFade";
/** a layer of the face. These ship with the data; a data set can add its own (the code reads them from `order`) */
export type Category = "face_shape" | "ears" | "chin" | "nose" | "mouth" | "beard" | "eyes" | "brows" | "hair" | (string & {});

export interface Grid { pixels: string[]; file?: string }
interface PartInfo {
  id: string;
  /** its name, for people (the id is what's stored) */
  label?: string;
  /** false: a face can have it, but random faces never pick it */
  random?: boolean;
  /** not symmetric: can be flipped */
  asymmetric?: boolean;
}
export interface FixedPart extends Grid, PartInfo {
  /** face shapes: the width class every width part (hair, ears) is picked by, and the measured anchors */
  widthClass?: string;
  anchors?: Record<string, unknown>;
}
/** a part that follows the head's sides: one grid per face shape (`derived`: fitted by the pipeline from one drawn on another face) */
export interface WidthPart extends PartInfo {
  variants: Record<string, Grid & { derived?: boolean; fadeDerived?: boolean }>;
  /** hair with a temple fade (its hairFade pixels) */
  fade?: boolean;
}
export type Part = FixedPart | WidthPart;

export interface CategoryInfo {
  /** the key a face's JSON names this category's part under (face_shape: faceShape) */
  field: string;
  /** its name, for people */
  label: string;
  placement: "fixed" | "width";
  recolor: "skin" | "hair" | "none";
  /** a face can leave it off (null) */
  optional: boolean;
  /** a face that doesn't name one gets the first part (the features every face was drawn with) */
  default: boolean;
  /** optional categories: how often a random face has one */
  chance?: number;
  /** what this layer's black does over facial hair: `under` (left off) or a role whose colour it takes */
  onHair?: Role | "under";
  /** an asymmetric part of it can be mirrored */
  flip?: boolean;
}

export interface Manifest {
  /** the pocket-faces data version (faces.json) */
  version?: string;
  size: number;
  rng: string;
  /** the middle column every face is centred on (flipping mirrors about it) */
  axis?: number;
  roles: Record<Role, RGB>;
  /** the code in a part's rows for each role ("." is clear) */
  codes: Record<string, Role>;
  /** the layers, bottom to top */
  order: Category[];
  widthClasses: Record<string, number>;
  categories: Record<Category, CategoryInfo>;
  parts: Record<Category, Part[]>;
  /** `hair`: the hair colours a random face with this skin gets, each with its weight (one not listed is never picked for it) */
  skinTones: { id: string; label: string; skin: RGB; skinShadow: RGB; hair?: Record<string, number> }[];
  /**
   * `groups`: a colour only some kinds of face get (gray: coaches). A random face picks it only when asked for
   * that group, and then `chance` of the time; options() and catalog() list it only for that group.
   */
  hairColors: { id: string; label: string; black: RGB; shade: RGB; fade?: RGB; groups?: string[]; chance?: number }[];
  eyeColors: { id: string; label: string; iris: RGB }[];
  /** skin tone and hair colour pairs too close to tell apart, and the edge such hair gets where it meets skin */
  lowContrast: { skinTone: string; hairColor: string; difference: number; edge: RGB }[];
}

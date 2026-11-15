import { faces, type Face as FaceSpec } from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  face: FaceSpec;
  /** whole-number pixel scale; the face stays pixel-sharp */
  scale?: number;
  /** what a screen reader says; empty for a decorative face */
  label?: string;
  className?: string;
}

/** *tune* How many drawn faces the page keeps; past it the cache starts over. */
const CACHE_MAX = 3000;
// pocket-faces draws a fresh canvas and PNG on every dataURL call: each face and scale is drawn once
const drawn = new Map<string, string>();
function urlOf(face: FaceSpec, scale: number): string {
  const key = `${scale}|${JSON.stringify(face)}`;
  let url = drawn.get(key);
  if (url === undefined) {
    if (drawn.size >= CACHE_MAX) drawn.clear();
    url = faces.dataURL(face, { scale });
    drawn.set(key, url);
  }
  return url;
}

/** A pocket-faces face as an image, drawn at a whole-pixel scale. */
export default function Face({ face, scale = 4, label = m.label, className }: Props) {
  const box = faces.cropBox;
  return (
    <img
      className={["face", className].filter(Boolean).join(" ")}
      src={urlOf(face, scale)}
      width={box.w * scale}
      height={box.h * scale}
      alt={label}
      draggable={false}
    />
  );
}

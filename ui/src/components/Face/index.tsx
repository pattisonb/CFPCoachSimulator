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

/** A pocket-faces face as an image, drawn at a whole-pixel scale. */
export default function Face({ face, scale = 4, label = m.label, className }: Props) {
  const box = faces.cropBox;
  return (
    <img
      className={["face", className].filter(Boolean).join(" ")}
      src={faces.dataURL(face, { scale })}
      width={box.w * scale}
      height={box.h * scale}
      alt={label}
      draggable={false}
    />
  );
}

import type { ReactNode } from "react";
import "./index.css";

interface Props {
  label: string;
  hint?: string;
  invalid?: boolean;
  /** several controls: a <div>, since a <label> sends every click inside it to its first control */
  group?: boolean;
  className?: string;
  children: ReactNode;
}

/** A label over one form control (or a group of them), with an optional hint under it. */
export default function Field({ label, hint, invalid = false, group = false, className, children }: Props) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={["field", invalid && "field--invalid", className].filter(Boolean).join(" ")}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </Tag>
  );
}

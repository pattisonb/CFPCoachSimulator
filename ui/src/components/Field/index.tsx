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

/** A label over one form control (or a group of them). Its hint is the field's tip; a field that is wrong says why under it. */
export default function Field({ label, hint, invalid = false, group = false, className, children }: Props) {
  const Tag = group ? "div" : "label";
  return (
    <Tag
      className={["field", invalid && "field--invalid", className].filter(Boolean).join(" ")}
      title={!invalid && typeof hint === "string" ? hint : undefined}
    >
      <span className="label">{label}</span>
      {children}
      {hint && (invalid || typeof hint !== "string") && <span className="field__hint">{hint}</span>}
    </Tag>
  );
}

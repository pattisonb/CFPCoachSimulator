import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./index.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** the chosen one in its row */
  on: boolean;
  /** a small number after the label, such as how many players it holds */
  count?: number;
  children: ReactNode;
}

/** A small toggle for filters and tabs. Pass role="tab" for a tab; otherwise it reports aria-pressed. */
export default function Chip({ on, count, children, className, role, ...rest }: Props) {
  const state = role === "tab" ? { "aria-selected": on } : { "aria-pressed": on };
  return (
    <button
      type="button"
      role={role}
      className={["chip", on && "chip--on", className].filter(Boolean).join(" ")}
      {...state}
      {...rest}
    >
      {children}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  );
}

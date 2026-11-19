import type { ReactNode } from "react";
import Tooltip from "../Tooltip/index.tsx";
import "./index.css";

/** A titled panel: its name over a rule on a light card (no dark bar), then whatever it holds. */
export default function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  /** at the head's far end, soft: a count, a note */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["panel", className].filter(Boolean).join(" ")} aria-label={title}>
      <header className="panel__head">
        <h3>{title}</h3>
        {aside && <span className="panel__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * A tab's panels. Packed into two columns when there is room (each as tall as it needs, like a newspaper); `stack`
 * keeps them one under another, full width.
 */
export function Panels({
  stack,
  label,
  children,
  className,
}: {
  stack?: boolean;
  /** names the tab's panel for screen readers */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["panels", stack && "panels--stack", className].filter(Boolean).join(" ")}
      role={label ? "tabpanel" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** The rows of a panel: wrap `PanelRow`s in this. */
export function PanelRows({ children }: { children: ReactNode }) {
  return <dl className="panel__rows">{children}</dl>;
}

/**
 * A label and its value on one row, a hairline between rows. A value not given reads `unknown` in the soft color; a
 * `hint` sits under the value; a `tip` shows on hover.
 */
export function PanelRow({
  label,
  value,
  unknown,
  hint,
  tip,
}: {
  label: string;
  value?: ReactNode;
  unknown?: string;
  hint?: string | null;
  tip?: string | null;
}) {
  const shown = value ? <b>{value}</b> : <span className="panel__soft">{unknown ?? "–"}</span>;
  return (
    <div className="panel__row">
      <dt>{label}</dt>
      <dd>
        {tip ? (
          <Tooltip text={tip} title={label}>
            {shown}
          </Tooltip>
        ) : (
          shown
        )}
        {hint && <span className="panel__hint">{hint}</span>}
      </dd>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { ArrowUpRight, CaretDown, CaretRight } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import "./index.css";

/** A titled panel: its name over a rule on a light card (no dark bar), then whatever it holds. */
export default function Panel({
  title,
  aside,
  children,
  className,
  collapsible,
  defaultOpen = true,
  onTitle,
}: {
  title: string;
  /** at the head's far end, soft: a count, a note */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** its head folds it shut and open again (a long list you may not want in the way) */
  collapsible?: boolean;
  /** a collapsible panel's state to start */
  defaultOpen?: boolean;
  /** its name is a way on (to the page that tells this in full): an arrow beside it, and it is a button */
  onTitle?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  return (
    <section
      className={["panel", collapsible && "panel--fold", !shown && "is-folded", className].filter(Boolean).join(" ")}
      aria-label={title}
    >
      <header className="panel__head">
        {collapsible ? (
          <h3>
            <button type="button" className="panel__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? (
                <CaretDown size={14} weight="bold" aria-hidden="true" />
              ) : (
                <CaretRight size={14} weight="bold" aria-hidden="true" />
              )}
              {title}
            </button>
          </h3>
        ) : onTitle ? (
          <h3>
            <button type="button" className="panel__toggle panel__go" onClick={onTitle}>
              {title}
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </button>
          </h3>
        ) : (
          <h3>{title}</h3>
        )}
        {aside && <span className="panel__aside">{aside}</span>}
      </header>
      {shown && children}
    </section>
  );
}

/**
 * A tab's panels: two to a row when there is room, the panels of a row one height so their edges line up, and each
 * panel in the same place whatever its neighbors hold (first left, second right, third left…). `stack` keeps them one
 * under another, full width. (`split` is the same two-to-a-row layout; it is kept so callers need not change.)
 */
export function Panels({
  stack,
  label,
  children,
  className,
}: {
  stack?: boolean;
  split?: boolean;
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
 * `hint` sits under the value; a `tip` shows on hover. `wide` gives the value the whole row beside its label, on one
 * line at the row's right edge (a long value that must not wrap: a comp's name, school, position and overall).
 */
export function PanelRow({
  label,
  value,
  unknown,
  hint,
  tip,
  wide,
}: {
  label: string;
  value?: ReactNode;
  unknown?: string;
  hint?: string | null;
  tip?: string | null;
  wide?: boolean;
}) {
  const shown = value ? <b>{value}</b> : <span className="panel__soft">{unknown ?? "–"}</span>;
  return (
    <div className={`panel__row${wide ? " panel__row--wide" : ""}`}>
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

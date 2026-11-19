import { useState, type ReactNode } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
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

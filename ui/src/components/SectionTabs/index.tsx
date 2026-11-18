import type { ReactNode } from "react";
import { Info } from "@phosphor-icons/react";
import "./index.css";

export interface SectionTab<K extends string> {
  key: K;
  label: string;
  /** a number after the label (how many it holds), or a short tag ("3 New") */
  count?: ReactNode;
}

interface Props<K extends string> {
  /** the section's name, at the start of the bar */
  title: string;
  tabs: SectionTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** at the bar's far end: a status ("Live Race · Through Week 6") */
  aside?: ReactNode;
}

/**
 * A section's tab bar: its name (a heading, set off by a rule: not a tab), then its tabs as boxes, the one shown
 * outlined; one fixed strip across the top. It never changes size, so switching
 * tabs moves only what's below it. The panes go in `SectionPane`s under it (all mounted, the others hidden).
 */
export default function SectionTabs<K extends string>({ title, tabs, value, onChange, aside }: Props<K>) {
  return (
    <div className="section-tabs" role={tabs.length ? "tablist" : undefined} aria-label={title}>
      <h1 className="section-tabs__title">{title}</h1>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className="section-tabs__tab"
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count != null && <span className="section-tabs__count">{t.count}</span>}
        </button>
      ))}
      {aside && <div className="section-tabs__aside">{aside}</div>}
    </div>
  );
}

/** One tab's pane: it fills the space under the bar, and stays mounted when hidden (its filters and scroll kept). */
export function SectionPane({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div className="section-tabs__pane" hidden={!shown}>
      {children}
    </div>
  );
}

/** The status at a bar's end ("Live Race · Through Week 5"); a sample's is dashed, with an info mark. */
export function SectionStatus({ sample, tip, children }: { sample?: boolean; tip?: string; children: ReactNode }) {
  return (
    <span className={`section-tabs__status${sample ? " is-sample" : ""}`} title={tip}>
      {sample && <Info size={14} weight="bold" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The note over a page showing sample data: why, and when the real thing starts. */
export function SampleNote({ children }: { children: ReactNode }) {
  return <p className="section-tabs__sample">{children}</p>;
}

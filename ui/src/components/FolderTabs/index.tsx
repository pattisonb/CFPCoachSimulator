import { useId, type ReactNode } from "react";
import { messages as m } from "./messages.ts";
import "./index.css";

export interface Tab<K extends string> {
  key: K;
  label: string;
  /** marks the tab (a field on it needs a fix) */
  flagged?: boolean;
}

interface Props<K extends string> {
  /** what the tab list is, for screen readers */
  label: string;
  tabs: Tab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** extra classes for the panel (its own layout) */
  panelClassName?: string;
  /** the open tab's contents */
  children: ReactNode;
}

/** Folder tabs joined to a bordered panel, filling the height they're given; the panel scrolls. */
export default function FolderTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  panelClassName,
  children,
}: Props<K>) {
  const id = useId();
  return (
    <div className="folder-tabs">
      <div className="folder-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-tab-${t.key}`}
            aria-selected={value === t.key}
            aria-controls={`${id}-panel`}
            className="folder-tabs__tab"
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {t.flagged && <span className="folder-tabs__flag" title={m.needsFix} aria-label={m.needsFix} />}
          </button>
        ))}
      </div>
      <div
        className={["folder-tabs__panel", panelClassName].filter(Boolean).join(" ")}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${value}`}
      >
        {children}
      </div>
    </div>
  );
}

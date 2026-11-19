import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import "./index.css";

export interface DropdownOption {
  value: string;
  label: string;
  /** a line under the label saying what picking it does */
  hint?: string;
  /** a number beside the label, such as how many it holds */
  count?: number;
}

interface Props {
  /** what is being chosen: shown before the value on the button, and the menu's name */
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** show only this icon on the button (the label and value become its tooltip and its name) */
  icon?: ReactNode;
  /** leave the label off the button (it still names the control): just the value, its count and the caret */
  hideLabel?: boolean;
  /** the button's size: "sm" on a card's edge, "md" in a row of filters (a chip's height) */
  size?: "sm" | "md";
  /** which edge of the button the menu lines up with */
  align?: "left" | "right";
  disabled?: boolean;
  className?: string;
}

/** *tune* The room kept between an open menu and the screen's edge, and between the menu and its button, in px. */
const EDGE = 8;
const GAP = 6;

/**
 * A small button that names a setting and its value (or just an icon), and opens a menu to change it. The menu drops from under the
 * button; Escape or a click elsewhere closes it, the arrow keys move through it.
 */
export default function Dropdown({
  label,
  value,
  options,
  onChange,
  icon,
  hideLabel = false,
  size = "sm",
  align = "left",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    // start on the chosen option
    const items = list.current?.querySelectorAll<HTMLButtonElement>("button");
    (Array.from(items ?? []).find((b) => b.getAttribute("aria-checked") === "true") ?? items?.[0])?.focus();
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // where the menu goes: under the button when it fits there, over it when there is more room above (a button at the
  // foot of a window), never taller than the room it has, and slid sideways if it would run off the screen's edge
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number; shift: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const btn = root.current?.getBoundingClientRect();
    const menu = list.current;
    if (!btn || !menu) return;
    const below = window.innerHeight - btn.bottom - EDGE - GAP;
    const above = btn.top - EDGE - GAP;
    const want = menu.scrollHeight;
    const up = want > below && above > below;
    const r = menu.getBoundingClientRect();
    const shift =
      r.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - r.right : r.left < EDGE ? EDGE - r.left : 0;
    setPlace({ up, maxHeight: Math.max(120, Math.floor(up ? above : below)), shift: Math.round(shift) });
  }, [open, options.length]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) root.current?.querySelector<HTMLButtonElement>(".dropdown__button")?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return close(true);
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };

  return (
    <div className={["dropdown", `dropdown--${align}`, className].filter(Boolean).join(" ")} ref={root}>
      <button
        type="button"
        className={["dropdown__button", `dropdown__button--${size}`, icon && "dropdown__button--icon"]
          .filter(Boolean)
          .join(" ")}
        aria-label={icon || hideLabel ? `${label}: ${current?.label ?? ""}` : undefined}
        title={icon && !open ? `${label}: ${current?.label ?? ""}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (open) onKey(e);
        }}
      >
        {icon ?? (
          <>
            {!hideLabel && <span className="dropdown__label">{label}</span>}
            <b>{current?.label ?? ""}</b>
            {current?.count !== undefined && <span className="dropdown__count">{current.count}</span>}
            <CaretDown size={12} weight="bold" aria-hidden="true" />
          </>
        )}
      </button>
      {open && (
        <div
          className={`dropdown__menu${place?.up ? " is-up" : ""}`}
          id={id}
          role="menu"
          aria-label={label}
          ref={list}
          onKeyDown={onKey}
          style={
            place
              ? ({ "--menu-max": `${place.maxHeight}px`, "--menu-shift": `${place.shift}px` } as CSSProperties)
              : undefined
          }
        >
          {icon && <p className="dropdown__title label">{label}</p>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="dropdown__item"
              onClick={() => {
                close(true);
                if (o.value !== value) onChange(o.value);
              }}
            >
              <Check size={14} weight="bold" aria-hidden="true" className="dropdown__check" />
              <span className="dropdown__text">
                <b>{o.label}</b>
                {o.hint && <span className="dropdown__hint">{o.hint}</span>}
              </span>
              {o.count !== undefined && <span className="dropdown__count">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

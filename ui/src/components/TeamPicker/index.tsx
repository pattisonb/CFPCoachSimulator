import { useId, useMemo, useState } from "react";
import { useListPopover } from "../../listPopover.ts";
import { CaretDown, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  label: string;
  /** keep the label for screen readers only */
  hideLabel?: boolean;
  teams: TeamCard[] | null;
  value: string;
  onChange: (slug: string) => void;
  onNewProgram: () => void;
}

type Item = { kind: "new" } | { kind: "team"; team: TeamCard };

function Swatch({ team }: { team: TeamCard }) {
  return (
    <span
      className="team-picker__swatch"
      style={{ background: team.colors.primary, borderColor: team.colors.secondary }}
    />
  );
}

/** A searchable team list. Type to filter, arrows to move, Enter to pick, Escape to close. */
export default function TeamPicker({ label, hideLabel = false, teams, value, onChange, onNewProgram }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");

  const selected = teams?.find((t) => t.slug === value) ?? null;
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const hits = (teams ?? []).filter((t) =>
      `${t.name} ${t.abbreviation} ${t.conference} ${t.mascot} ${t.state ?? ""}`.toLowerCase().includes(q),
    );
    return [{ kind: "new" }, ...hits.map((team) => ({ kind: "team" as const, team }))];
  }, [teams, query]);

  const pop = useListPopover({ count: items.length, minWidth: 460, maxHeight: 440, align: "left" });
  const { open, active } = pop;

  const show = () => {
    setQuery("");
    pop.show(Math.max(0, (teams ?? []).findIndex((t) => t.slug === value) + 1));
  };
  const choose = (it: Item) => {
    if (it.kind === "new") onNewProgram();
    else onChange(it.team.slug);
    pop.close();
  };

  return (
    <div className="team-picker" ref={pop.root}>
      <span className={hideLabel ? "team-picker__label-hidden" : "label"} id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={pop.trigger}
        type="button"
        className="team-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        disabled={!teams}
        onClick={() => (open ? pop.close() : show())}
      >
        <span id={`${id}-value`} className="team-picker__value">
          {selected ? (
            <>
              <Swatch team={selected} />
              <span className="team-picker__name">{selected.name}</span>
            </>
          ) : (
            m.loading
          )}
        </span>
        {selected?.state && <span className="team-picker__state">{selected.state}</span>}
        <CaretDown size={18} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div className="team-picker__pop" style={pop.place}>
          <label className="team-picker__search">
            <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
            <input
              ref={pop.input}
              role="combobox"
              aria-label={m.search}
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={`${id}-opt-${active}`}
              placeholder={m.search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                pop.setActive(e.target.value ? 1 : 0);
              }}
              onKeyDown={(e) => pop.onKey(e, (i) => choose(items[i]))}
            />
          </label>
          <ul
            ref={pop.list}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="team-picker__list"
          >
            {items.map((it, i) => (
              <li
                key={it.kind === "new" ? "new" : it.team.slug}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={it.kind === "team" && it.team.slug === value}
                className={[
                  "team-picker__option",
                  it.kind === "new" && "team-picker__option--new",
                  i === active && "is-active",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => pop.setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(it)}
              >
                {it.kind === "new" ? (
                  <>
                    <Plus size={18} weight="bold" aria-hidden="true" />
                    <span className="team-picker__name">{m.newProgram}</span>
                    <span className="team-picker__meta">{m.newProgramHint}</span>
                  </>
                ) : (
                  <>
                    <Swatch team={it.team} />
                    <span className="team-picker__name">{it.team.name}</span>
                    <span className="team-picker__meta">{it.team.conference}</span>
                    {it.team.state && <span className="team-picker__state">{it.team.state}</span>}
                  </>
                )}
              </li>
            ))}
            {items.length === 1 && query && <li className="team-picker__none">{m.noMatch(query)}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import "./index.css";

export interface Column<T> {
  key: string;
  label: string;
  /** a number: set at the right, in figures that line up */
  num?: boolean;
  render: (row: T, i: number) => ReactNode;
  /** what the column sorts by; a column without one can't be sorted */
  sort?: (row: T) => number | string;
  /** the header's hover text */
  tip?: string;
  /** the column's width in px in a `sticky` table (a number column sizes itself from its heading without one) */
  width?: number;
}

interface Props<T> {
  /** names the table for screen readers */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** your own row: bold on a tint, with an ink edge */
  mine?: (row: T) => boolean;
  /** start sorted by this column, largest first (click a header to change it) */
  sortBy?: string;
  /** keep the header row in view while the rows scroll under it (the table sits in a box that scrolls) */
  sticky?: boolean;
  /** draw only this many rows, the first ones as sorted (a list of thousands) */
  limit?: number;
}

/** *tune* A sticky table's number column: its least width, the width a heading letter takes, and the room for the
 *  sort arrow and the gap, in px; and the least a text column gets. */
const NUM_MIN = 62;
const HEAD_CHAR = 8.6;
const HEAD_ROOM = 30;
const TEXT_MIN = 180;

/**
 * A table of rows: soft headers, hairlines, numbers set right. Click a sortable header to sort by it (largest first,
 * again for smallest first): the column it is sorted by is the one in bold. Your own row is tinted.
 */
export default function DataTable<T>({ label, columns, rows, rowKey, mine, sortBy, sticky, limit }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(sortBy ? { key: sortBy, down: true } : null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const by = col.sort;
    return [...rows].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort!.down ? -d : d;
    });
  }, [rows, columns, sort]);
  // a sticky table's columns keep their widths whatever rows are showing (sorting brought other numbers to the top
  // and every column shifted): each number column is as wide as its heading needs, the rest share what is left
  const widthOf = (c: Column<T>) =>
    sticky ? (c.width ?? (c.num ? Math.max(NUM_MIN, c.label.length * HEAD_CHAR + HEAD_ROOM) : undefined)) : undefined;
  const fixed = sticky ? columns.reduce((n, c) => n + (widthOf(c) ?? TEXT_MIN), 0) : undefined;
  return (
    <table
      className={`data-table${sticky ? " data-table--sticky" : ""}`}
      style={fixed ? { minWidth: fixed } : undefined}
      aria-label={label}
    >
      <thead>
        <tr>
          {columns.map((c) => {
            const on = sort?.key === c.key;
            return (
              <th
                key={c.key}
                scope="col"
                className={c.num ? "is-num" : undefined}
                style={widthOf(c) ? { width: widthOf(c) } : undefined}
                title={c.tip}
                aria-sort={on ? (sort!.down ? "descending" : "ascending") : undefined}
              >
                {c.sort ? (
                  <button type="button" onClick={() => setSort({ key: c.key, down: on ? !sort!.down : true })}>
                    {c.label}
                    {/* the arrow's room is always kept, so a heading is the same width sorted or not */}
                    <span className="data-table__arrow" aria-hidden="true">
                      {on && (sort!.down ? <CaretDown size={10} weight="bold" /> : <CaretUp size={10} weight="bold" />)}
                    </span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {(limit ? sorted.slice(0, limit) : sorted).map((r, i) => (
          <tr key={rowKey(r)} className={mine?.(r) ? "is-mine" : undefined}>
            {columns.map((c) => (
              <td
                key={c.key}
                className={
                  [c.num && "is-num", sort?.key === c.key && "is-sorted"].filter(Boolean).join(" ") || undefined
                }
              >
                {c.render(r, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

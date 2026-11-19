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
}

/**
 * A table of rows: soft headers, hairlines, numbers set right. Click a sortable header to sort by it (largest first,
 * again for smallest first). Your own row stands out.
 */
export default function DataTable<T>({ label, columns, rows, rowKey, mine, sortBy }: Props<T>) {
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
  return (
    <table className="data-table" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => {
            const on = sort?.key === c.key;
            return (
              <th
                key={c.key}
                scope="col"
                className={c.num ? "is-num" : undefined}
                title={c.tip}
                aria-sort={on ? (sort!.down ? "descending" : "ascending") : undefined}
              >
                {c.sort ? (
                  <button type="button" onClick={() => setSort({ key: c.key, down: on ? !sort!.down : true })}>
                    {c.label}
                    {on && (sort!.down ? <CaretDown size={10} weight="bold" /> : <CaretUp size={10} weight="bold" />)}
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
        {sorted.map((r, i) => (
          <tr key={rowKey(r)} className={mine?.(r) ? "is-mine" : undefined}>
            {columns.map((c) => (
              <td key={c.key} className={c.num ? "is-num" : undefined}>
                {c.render(r, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

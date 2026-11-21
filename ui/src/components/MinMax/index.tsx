import { useEffect, useState } from "react";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** what is being bounded ("Weight") */
  label: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  /** pick each end from these (a height reads 6'2", not 74) in place of typing a number */
  options?: { value: number; label: string }[];
}

/**
 * A column's low and high end as one small control: its name, then a pair of fields, either left empty for no bound.
 * A typed number is taken when the field is left or Enter is pressed, so a list is not read again for every digit.
 */
export default function MinMax({ label, min, max, onChange, options }: Props) {
  const [lo, setLo] = useState(min === null ? "" : String(min));
  const [hi, setHi] = useState(max === null ? "" : String(max));
  useEffect(() => setLo(min === null ? "" : String(min)), [min]);
  useEffect(() => setHi(max === null ? "" : String(max)), [max]);
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const commit = (a = lo, b = hi) => {
    const [x, y] = [num(a), num(b)];
    if (x !== min || y !== max) onChange(x, y);
  };
  const end = (which: "lo" | "hi") => {
    const value = which === "lo" ? lo : hi;
    const set = which === "lo" ? setLo : setHi;
    const name = which === "lo" ? m.min(label) : m.max(label);
    return options ? (
      <select
        aria-label={name}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          commit(which === "lo" ? e.target.value : lo, which === "hi" ? e.target.value : hi);
        }}
      >
        <option value="">{which === "lo" ? m.lo : m.hi}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        type="text"
        inputMode="numeric"
        aria-label={name}
        placeholder={which === "lo" ? m.lo : m.hi}
        value={value}
        onChange={(e) => set(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => commit()}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    );
  };
  return (
    <span className={`min-max${min !== null || max !== null ? " is-set" : ""}`} role="group" aria-label={label}>
      <span className="label min-max__label">{label}</span>
      {end("lo")}
      <span className="min-max__to" aria-hidden="true">
        {m.to}
      </span>
      {end("hi")}
    </span>
  );
}

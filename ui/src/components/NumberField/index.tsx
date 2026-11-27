import { useEffect, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  /** the number typed (an empty box is `min`) */
  onChange: (n: number) => void;
  min?: number;
};

/**
 * A whole-number box (a NIL amount): what you type is what it shows, with no 0 forced in front of it ("040"), it
 * can be emptied while you type, and clicking into it selects the number so typing replaces it (the player: "I don't
 * like the forced 0 on the offer NIL").
 */
export default function NumberField({ value, onChange, min = 0, onFocus, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  // a new value from outside (the offer was saved, another player's card): the box shows it
  useEffect(() => {
    if ((text === "" ? min : Number(text)) !== value) setText(String(value));
  }, [value]);
  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      value={text}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        const t = e.target.value.replace(/^0+(?=\d)/, "");
        setText(t);
        onChange(Math.max(min, Number(t) || 0));
      }}
    />
  );
}

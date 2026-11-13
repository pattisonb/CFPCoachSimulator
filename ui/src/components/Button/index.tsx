import type { ButtonHTMLAttributes } from "react";
import "./index.css";

export type ButtonVariant = "solid" | "outline";
export type ButtonSize = "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The square, pixel-edged button. */
export default function Button({ variant = "solid", size = "md", className, type = "button", ...rest }: Props) {
  const classes = ["btn", `btn--${variant}`, size === "lg" && "btn--lg", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}

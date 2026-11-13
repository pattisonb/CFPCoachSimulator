import { Moon, Sun } from "@phosphor-icons/react";
import BallLogo from "../BallLogo/index.tsx";
import { ROOT } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import { messages as m, type NavKey } from "./messages.ts";
import "./index.css";

interface Props {
  active: NavKey;
  theme: Theme;
  onToggleTheme: () => void;
}

/** The site header: the brand on the left, the nav in the middle, the theme switch on the right. */
export default function Header({ active, theme, onToggleTheme }: Props) {
  const dark = theme === "dark";
  return (
    <header className="header">
      <a className="header__brand" href={ROOT} aria-label={m.homeLabel}>
        <span className="header__mark">
          <BallLogo />
        </span>
        <span className="header__name">{m.brand}</span>
      </a>
      <nav className="header__nav" aria-label={m.navLabel}>
        {m.nav.map((n) => (
          <a
            key={n.key}
            href={ROOT + n.href}
            className={n.key === active ? "is-active" : undefined}
            aria-current={n.key === active ? "page" : undefined}
          >
            {n.label}
          </a>
        ))}
      </nav>
      {/* shows the mode you would switch to: the moon in light mode, the sun in dark mode */}
      <button
        type="button"
        className="header__theme"
        onClick={onToggleTheme}
        aria-label={dark ? m.toLight : m.toDark}
        title={dark ? m.toLight : m.toDark}
      >
        {dark ? <Sun size={24} weight="bold" /> : <Moon size={24} weight="bold" />}
      </button>
    </header>
  );
}

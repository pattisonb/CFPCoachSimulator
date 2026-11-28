import { Flag, Moon, Sun } from "@phosphor-icons/react";
import BallLogo from "../BallLogo/index.tsx";
import { navigate, ROOT } from "../../router.ts";
import { nextTheme, type Theme } from "../../theme.ts";
import { messages as m, type NavKey } from "./messages.ts";
import "./index.css";

interface Props {
  active: NavKey;
  theme: Theme;
  onToggleTheme: () => void;
}

/** The site header: the brand on the left, the nav in the middle, the theme switch on the right. */
export default function Header({ active, theme, onToggleTheme }: Props) {
  // the switch goes round Light, Dark, School: it shows the one you would switch to
  const next = nextTheme(theme);
  const tip = next === "dark" ? m.toDark : next === "school" ? m.toSchool : m.toLight;
  return (
    <header className="header">
      {/* home, inside the app: a plain link reloads the page, and on the published site that starts the whole game
          again (the stress run's find) */}
      <a
        className="header__brand"
        href={ROOT}
        aria-label={m.homeLabel}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault();
          navigate("play");
        }}
      >
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
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
              e.preventDefault();
              navigate(n.key);
            }}
          >
            {n.label}
          </a>
        ))}
      </nav>
      {/* shows the theme you would switch to: the moon for Dark, the flag for School, the sun for Light */}
      <button type="button" className="header__theme" onClick={onToggleTheme} aria-label={tip} title={tip}>
        {next === "dark" ? (
          <Moon size={24} weight="bold" />
        ) : next === "school" ? (
          <Flag size={24} weight="bold" />
        ) : (
          <Sun size={24} weight="bold" />
        )}
      </button>
    </header>
  );
}

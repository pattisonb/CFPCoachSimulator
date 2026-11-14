import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FocusEvent, type PointerEvent } from "react";
import {
  ArrowLeft,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  GearSix,
  Moon,
  PushPin,
  SidebarSimple,
  type Icon,
} from "@phosphor-icons/react";
import BallLogo from "../BallLogo/index.tsx";
import { hrefFor, navigate } from "../../router.ts";
import { NAV_SHORTCUT, type NavMode } from "../../navMode.ts";
import { CAREER_SECTIONS, LEAGUE_SECTIONS, isLeague, type Section } from "../../sections.ts";
import type { Theme } from "../../theme.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** The team the game is played as, as the sidebar's chip shows it. */
export interface NavTeam {
  name: string;
  primary: string;
  secondary: string;
  record: string;
  week: number;
}

interface Props {
  team: NavTeam | null;
  active: string;
  onSection: (key: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  mode: NavMode;
  onMode: (mode: NavMode) => void;
}

/** *tune* How long a peeking sidebar waits after the pointer leaves before it slides away. */
const PEEK_LEAVE_MS = 240;
/** *tune* Minimized: how long the pointer rests on an icon before its tooltip shows (moving to the next is instant). */
const TIP_SHOW_MS = 60;
/** *tune* How long the tooltip stays after the pointer leaves the icons, so crossing a gap doesn't flicker it. */
const TIP_HIDE_MS = 90;

interface Tip {
  label: string;
  /** the icon's right edge and middle, in window pixels */
  x: number;
  y: number;
  shown: boolean;
  /** it was already showing: glide to the new icon instead of appearing there */
  glide: boolean;
}

/**
 * Minimized, every control's name shows in one themed tooltip beside the rail: it comes up quickly, glides from icon
 * to icon as the pointer (or keyboard focus) moves through them, and fades when it leaves. Controls opt in with
 * data-tip; the handlers go on the nav, so one set covers them all.
 */
function useRailTip(on: boolean) {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const shown = useRef(false);

  useEffect(() => {
    window.clearTimeout(timer.current);
    shown.current = false;
    setTip(null);
  }, [on]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (target: EventTarget) => {
    const el = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
    if (!el) return hide();
    const r = el.getBoundingClientRect();
    const at = { label: el.dataset.tip ?? "", x: r.right, y: r.top + r.height / 2 };
    window.clearTimeout(timer.current);
    if (shown.current) setTip({ ...at, shown: true, glide: true });
    else
      timer.current = window.setTimeout(() => {
        shown.current = true;
        setTip({ ...at, shown: true, glide: false });
      }, TIP_SHOW_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      shown.current = false;
      setTip((t) => t && { ...t, shown: false, glide: false });
    }, TIP_HIDE_MS);
  };

  const handlers = on
    ? {
        onPointerOver: (e: PointerEvent<HTMLElement>) => show(e.target),
        onPointerLeave: hide,
        onFocus: (e: FocusEvent<HTMLElement>) => show(e.target),
        onBlur: hide,
        onScroll: hide,
      }
    : {};
  const node = tip && (
    <span
      className={["game-nav__tip", tip.shown && "is-shown", tip.glide && "is-gliding"].filter(Boolean).join(" ")}
      style={{ left: tip.x, top: tip.y }}
      aria-hidden="true"
    >
      {tip.label}
    </span>
  );
  return { handlers, node };
}

/** One row: an icon and its name. Minimized, the name fades out and shows as a tooltip instead. */
function Item({
  icon: I,
  label,
  rail,
  filled,
  title,
  ...rest
}: { icon: Icon; label: string; rail: boolean; filled?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="game-nav__item"
      {...rest}
      title={rail ? undefined : title}
      data-tip={rail ? label : undefined}
    >
      <I size={20} weight={filled ? "fill" : "bold"} aria-hidden="true" />
      <span className="game-nav__text">{label}</span>
    </button>
  );
}

/** An icon alone, named for screen readers and by a tooltip: the browser's, or with `tip` the rail's own. */
function Tool({
  icon: I,
  label,
  tip,
  className,
  ...rest
}: { icon: Icon; label: string; tip?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={["game-nav__tool", className].filter(Boolean).join(" ")}
      aria-label={label}
      title={tip ? undefined : label}
      data-tip={tip ? label : undefined}
      {...rest}
    >
      <I size={18} weight="bold" aria-hidden="true" />
    </button>
  );
}

/**
 * The game's sidebar, in three modes (like Notion's):
 * - open: the brand with Minimize and Hide at its right, your team, the sections (League open to start), then
 *   Settings, the Dark Mode switch and Back to Main Menu;
 * - rail (minimized): the icons alone, which hold still as it narrows; hovering the logo shows Expand in its place;
 * - hidden: it slides away; the pointer at the window's left edge (or focus moving into it) brings it back over
 *   the page until the pointer leaves, with Keep Sidebar Open at its top. The page shows its own Open button.
 */
export default function GameNav({ team, active, onSection, theme, onToggleTheme, mode, onMode }: Props) {
  const [leagueOpen, setLeagueOpen] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const scroll = useRef<HTMLDivElement>(null);
  const showLeague = leagueOpen || isLeague(active);
  const rail = mode === "rail";
  const hidden = mode === "hidden";
  const dark = theme === "dark";

  // the open section in view, on a window too short to show them all
  useEffect(() => {
    scroll.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [active, showLeague]);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const peek = () => {
    window.clearTimeout(leaveTimer.current);
    setPeeking(true);
  };
  const unpeek = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setPeeking(false), PEEK_LEAVE_MS);
  };
  const go = (next: NavMode) => {
    window.clearTimeout(leaveTimer.current);
    setPeeking(false);
    onMode(next);
  };

  const item = (s: Section) => (
    <li key={s.key}>
      <Item
        icon={s.icon}
        label={s.label}
        rail={rail}
        filled={s.key === active}
        aria-current={s.key === active ? "page" : undefined}
        onClick={() => onSection(s.key)}
      />
    </li>
  );

  const railTip = useRailTip(rail);
  const navClass = ["game-nav", rail && "is-rail", hidden && peeking && "is-peeking"].filter(Boolean).join(" ");
  const hiddenEvents = hidden ? { onMouseEnter: peek, onMouseLeave: unpeek, onFocus: peek, onBlur: unpeek } : {};

  return (
    <div className={`game-nav-slot game-nav-slot--${mode}`}>
      {hidden && <div className="game-nav-slot__edge" onMouseEnter={peek} onMouseLeave={unpeek} aria-hidden="true" />}
      <nav className={navClass} aria-label={m.navLabel} {...hiddenEvents} {...railTip.handlers}>
        <div className="game-nav__brand">
          <span className="game-nav__mark">
            <BallLogo />
          </span>
          <span className="game-nav__name">{m.brand}</span>
          {mode === "open" && (
            <span className="game-nav__dock">
              <Tool icon={SidebarSimple} label={m.minimize} onClick={() => go("rail")} />
              <Tool icon={CaretDoubleLeft} label={m.hide(NAV_SHORTCUT)} onClick={() => go("hidden")} />
            </span>
          )}
          {hidden && (
            <span className="game-nav__dock">
              <Tool icon={PushPin} label={m.keepOpen} onClick={() => go("open")} />
            </span>
          )}
          {/* minimized: Expand sits over the logo and shows on hover or focus */}
          {rail && (
            <Tool
              icon={CaretDoubleRight}
              label={m.expand}
              className="game-nav__expand"
              tip
              onClick={() => go("open")}
            />
          )}
        </div>

        <div className="game-nav__team" data-tip={rail ? team?.name : undefined}>
          <span
            className="game-nav__swatch"
            style={
              team ? { background: `linear-gradient(135deg, ${team.primary} 50%, ${team.secondary} 50%)` } : undefined
            }
            aria-hidden="true"
          />
          <span className="game-nav__who">
            <span className="game-nav__team-name">{team?.name ?? m.noTeam}</span>
            {team && <span className="game-nav__team-line">{m.teamLine(team.record, team.week)}</span>}
          </span>
        </div>

        <div className="game-nav__scroll" ref={scroll}>
          <p className="game-nav__group label">
            <span className="game-nav__text">{m.career}</span>
          </p>
          <ul className="game-nav__list">{CAREER_SECTIONS.map(item)}</ul>

          <button
            type="button"
            className="game-nav__group game-nav__fold label"
            aria-expanded={showLeague}
            aria-controls="game-nav-league"
            aria-label={m.league}
            data-tip={rail ? m.league : undefined}
            onClick={() => setLeagueOpen(!showLeague)}
          >
            <span className="game-nav__text">{m.league}</span>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </button>
          <ul id="game-nav-league" className="game-nav__list" hidden={!showLeague}>
            {LEAGUE_SECTIONS.map(item)}
          </ul>
        </div>

        <div className="game-nav__foot">
          {/* aria-disabled, not disabled: a disabled button gets no pointer events, so it couldn't show its tooltip */}
          <Item
            icon={GearSix}
            label={rail ? m.settingsSoon : m.settings}
            rail={rail}
            aria-disabled="true"
            title={m.soon}
            onClick={(e) => e.preventDefault()}
          />
          {/* the theme as a switch: on is dark */}
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            className="game-nav__item"
            data-tip={rail ? m.darkMode : undefined}
            onClick={onToggleTheme}
          >
            <Moon size={20} weight={dark ? "fill" : "bold"} aria-hidden="true" />
            <span className="game-nav__text">{m.darkMode}</span>
            <span className="game-nav__switch" aria-hidden="true" />
          </button>
          <a
            className="game-nav__item"
            href={hrefFor("play")}
            data-tip={rail ? m.exit : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate("play");
            }}
          >
            <ArrowLeft size={20} weight="bold" aria-hidden="true" />
            <span className="game-nav__text">{m.exit}</span>
          </a>
        </div>
      </nav>
      {railTip.node}
    </div>
  );
}

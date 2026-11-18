import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { CaretDown, MagnifyingGlass, Play, Shuffle, Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Helmet from "../Helmet/index.tsx";
import { contrast, inkOn } from "../../colors.ts";
import { navigate, replaceParams } from "../../router.ts";
import type { TeamCard } from "../../types.ts";
import Details from "./Details.tsx";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  teams: TeamCard[];
}

type Sort = keyof typeof m.sorts;

/** *tune* The top of the prestige scale (the teams' prestige runs 1 to this). */
const PRESTIGE_MAX = 6;

/** Conferences whose short name reads better in a menu. */
const SHORT: Record<string, string> = {
  "American Athletic Conference": "American",
  "Conference USA": "C-USA",
  "FBS Independent": "Independents",
};
const short = (c: string) => SHORT[c] ?? c;

const SORTS: Record<Sort, (a: TeamCard, b: TeamCard) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  overall: (a, b) => b.ratings.overall - a.ratings.overall || a.name.localeCompare(b.name),
  prestige: (a, b) => b.prestige - a.prestige || b.ratings.overall - a.ratings.overall,
};

/** Everything a search can match on a team. */
const haystack = (t: TeamCard) =>
  [t.name, t.school, t.mascot, t.abbreviation, t.city, t.state, t.conference, short(t.conference)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const isField = (el: EventTarget | null) =>
  el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/**
 * Play's New Season window: every team as a tile of its letters in its colors (search, conference and sort above),
 * and the picked team at the right, its helmet and ratings in a team-banner of its colors over its Overview and Roster.
 * In the grid the arrows move and Enter plays; / jumps to the search, R picks a team at random.
 */
export default function TeamSelect({ teams }: Props) {
  // the team picked last time (?team=), so Back from another page lands on it
  const [slug, setSlug] = useState(() => new URLSearchParams(location.search).get("team") ?? "");
  const [query, setQuery] = useState("");
  const [conf, setConf] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const confs = useMemo(
    () => [...new Set(teams.map((t) => t.conference))].sort((a, b) => short(a).localeCompare(short(b))),
    [teams],
  );
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return teams
      .filter((t) => (!conf || t.conference === conf) && words.every((w) => haystack(t).includes(w)))
      .sort(SORTS[sort]);
  }, [teams, conf, sort, query]);
  // the pick follows the filters: when it's filtered out, the first team shown takes its place
  const team = shown.find((t) => t.slug === slug) ?? shown[0] ?? teams.find((t) => t.slug === slug) ?? teams[0];

  // the address follows the pick
  useEffect(() => {
    if (team) replaceParams("play", { team: team.slug });
  }, [team]);

  // the picked tile stays in view, and takes the focus when the grid has it
  useEffect(() => {
    const tile = grid.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    tile?.scrollIntoView({ block: "nearest" });
    if (tile && grid.current?.contains(document.activeElement)) tile.focus();
  }, [team, shown]);

  const play = (t: TeamCard | undefined) => t && navigate("coachEdit", { team: t.slug });
  // from the teams shown, or from every team (clearing the filters) when they show one or none
  const random = () => {
    const wide = shown.length < 2;
    if (wide) {
      setQuery("");
      setConf("");
    }
    const others = (wide ? teams : shown).filter((t) => t.slug !== team?.slug);
    if (others.length) setSlug(others[Math.floor(Math.random() * others.length)].slug);
  };

  // anywhere on the page but a field: / to the search, R for a random team
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isField(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "r" || e.key === "R") random();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onGridKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      return play(team);
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 0, ArrowDown: 0, Home: 0, End: 0 }[e.key];
    if (step === undefined || !shown.length) return;
    e.preventDefault();
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 1;
    const at = Math.max(
      0,
      shown.findIndex((t) => t.slug === team?.slug),
    );
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? shown.length - 1
          : at + (e.key === "ArrowUp" ? -cols : e.key === "ArrowDown" ? cols : step);
    setSlug(shown[Math.min(shown.length - 1, Math.max(0, to))].slug);
  };

  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    } else if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      if (shown[0] && !shown.some((t) => t.slug === slug)) setSlug(shown[0].slug);
      grid.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  };

  return (
    <div className="chooser">
      <section className="chooser__list" aria-label={m.teamsLabel}>
        <label className="chooser__search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder={m.searchPlaceholder}
            aria-label={m.search}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <kbd className="chooser__kbd" aria-hidden="true">
            /
          </kbd>
          {query && (
            <button type="button" className="chooser__clear" aria-label={m.clearSearch} onClick={() => setQuery("")}>
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="chooser__filters">
          <label className="chooser__select">
            <span className="label">{m.conference}</span>
            <select value={conf} onChange={(e) => setConf(e.target.value)}>
              <option value="">{m.allConferences}</option>
              {confs.map((c) => (
                <option key={c} value={c}>
                  {short(c)}
                </option>
              ))}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </label>
          <label className="chooser__select">
            <span className="label">{m.sort}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(Object.keys(m.sorts) as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {m.sorts[s]}
                </option>
              ))}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </label>
        </div>
        <span className="chooser__count" aria-live="polite">
          {m.count(shown.length)}
        </span>
        {shown.length ? (
          <div className="chooser__grid" ref={grid} role="listbox" aria-label={m.teamsLabel} onKeyDown={onGridKey}>
            {shown.map((t) => (
              <button
                key={t.slug}
                type="button"
                role="option"
                aria-selected={t.slug === team?.slug}
                tabIndex={t.slug === team?.slug ? 0 : -1}
                className="chooser__tile"
                style={tileColors(t.colors) as CSSProperties}
                title={t.name}
                onClick={() => setSlug(t.slug)}
                onDoubleClick={() => play(t)}
              >
                <span className="chooser__abbr">{t.abbreviation}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="chooser__none">{m.noMatch(query.trim())}</p>
        )}
        <div className="chooser__more">
          <button type="button" className="chooser__link" onClick={random}>
            <Shuffle size={16} weight="bold" aria-hidden="true" />
            {m.random}
            <kbd className="chooser__kbd" aria-hidden="true">
              R
            </kbd>
          </button>
          <button
            type="button"
            className="chooser__link"
            onClick={() => navigate("programEdit", team ? { team: team.slug } : undefined)}
          >
            {m.newProgram}
          </button>
        </div>
      </section>

      {team && (
        <div className="chooser__team">
          <Banner key={team.slug} team={team} onPlay={() => play(team)} />
          <Details team={team} />
        </div>
      )}
    </div>
  );
}

/** The picked team in its colors: its helmet, name, prestige, ratings, coach and stadium, and Play. */
function Banner({ team, onPlay }: { team: TeamCard; onPlay: () => void }) {
  const style = {
    "--c": team.colors.primary,
    "--c2": team.colors.secondary,
    "--on": inkOn(team.colors.primary),
  } as CSSProperties;
  const ratings = [
    ["ovr", team.ratings.overall],
    ["off", team.ratings.offense],
    ["def", team.ratings.defense],
    ["st", team.ratings.special_teams],
  ] as const;
  const facts = [
    [m.headCoach, team.head_coach],
    [m.stadium, `${team.stadium.name} · ${m.seats(team.stadium.capacity)}`],
  ].filter((f): f is [string, string] => !!f[1]);

  return (
    <section className="team-banner" style={style} aria-label={team.name}>
      <span className="team-banner__mark" aria-hidden="true">
        {team.abbreviation}
      </span>
      <Helmet color={team.colors.primary} className="team-banner__helmet" label={m.helmet(team.name)} />
      <div className="team-banner__who">
        <span className="team-banner__school">
          {team.name} · {short(team.conference)}
        </span>
        <h2 className="team-banner__mascot">{team.mascot}</h2>
        <span
          className="team-banner__stars"
          role="img"
          title={m.prestige(team.prestige, PRESTIGE_MAX)}
          aria-label={m.prestige(team.prestige, PRESTIGE_MAX)}
        >
          {Array.from({ length: PRESTIGE_MAX }, (_, i) => (
            <Star
              key={i}
              size={18}
              weight={i < team.prestige ? "fill" : "regular"}
              className={i < team.prestige ? undefined : "is-off"}
              aria-hidden="true"
            />
          ))}
        </span>
        <dl className="team-banner__facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="team-banner__side">
        <div className="team-banner__ratings">
          {ratings.map(([k, v]) => (
            <span key={k} className="team-banner__rating" title={m.ratingTips[k]}>
              <b>{Math.round(v)}</b>
              <span>{m[k]}</span>
            </span>
          ))}
        </div>
        <Button size="lg" onClick={onPlay} aria-label={m.playAs(team.name)} className="team-banner__play">
          <Play size={20} weight="fill" aria-hidden="true" />
          {m.play}
        </Button>
      </div>
    </section>
  );
}

/** *tune* How far the second color's lightness must sit from the plate's for it to show as the letters' drop. */
const DROP_CONTRAST = 1.6;

/**
 * A tile's colors: the plate in the team's color, the letters in white outlined in black (or dark outlined in white on
 * a light plate), dropped in the second color unless it would melt into the plate, then in the outline's color.
 */
function tileColors({ primary, secondary }: { primary: string; secondary: string }) {
  const fill = inkOn(primary);
  const edge = fill === "#fff" ? "#000" : "#fff";
  const drop = contrast(primary, secondary) >= DROP_CONTRAST ? secondary : edge;
  return { "--c": primary, "--c2": secondary, "--fill": fill, "--edge": edge, "--drop": drop };
}

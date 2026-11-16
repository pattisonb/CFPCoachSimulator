import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CaretDown, Play, Star } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import Header from "../../components/Header/index.tsx";
import Helmet from "../../components/Helmet/index.tsx";
import { inkOn } from "../../colors.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import { navigate, replaceParams } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
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

/** A coordinator's scheme, from "OC Name (Scheme)". */
const scheme = (line: string | undefined) => /\(([^)]+)\)/.exec(line ?? "")?.[1] ?? null;

const SORTS: Record<Sort, (a: TeamCard, b: TeamCard) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  overall: (a, b) => b.ratings.overall - a.ratings.overall || a.name.localeCompare(b.name),
  prestige: (a, b) => b.prestige - a.prestige || b.ratings.overall - a.ratings.overall,
};

/** Keys that work anywhere on the page (except inside a menu). */
const isField = (el: EventTarget | null) => el instanceof HTMLSelectElement || el instanceof HTMLInputElement;

/**
 * Team Select (a trial of a second look for Play's team pick, at /select): every team as a helmet in its colors on
 * a grid at the left, the picked one big at the right with its name, prestige, ratings and staff. Arrows move, Enter
 * plays as the team (on to Your Coach, as Play does), R picks one at random, Escape goes back to Play.
 */
export default function TeamSelect({ theme, onToggleTheme }: Props) {
  const [teams, setTeams] = useState<TeamCard[] | null>(cachedTeams);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [slug, setSlug] = useState(() => new URLSearchParams(location.search).get("team") ?? "");
  const [conf, setConf] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (teams) return;
    loadTeams()
      .then((real) => {
        setTeams(real);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [teams, attempt]);

  const confs = useMemo(
    () => [...new Set((teams ?? []).map((t) => t.conference))].sort((a, b) => short(a).localeCompare(short(b))),
    [teams],
  );
  const shown = useMemo(
    () => (teams ?? []).filter((t) => !conf || t.conference === conf).sort(SORTS[sort]),
    [teams, conf, sort],
  );
  const team = teams?.find((t) => t.slug === slug) ?? shown[0] ?? null;

  // the address follows the pick, so Back from Your Coach lands on it
  useEffect(() => {
    if (team) replaceParams("teamSelect", { team: team.slug });
  }, [team]);

  // the picked tile stays in view as the arrows move it
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [team, shown]);

  const play = (t: TeamCard | null) => t && navigate("coachEdit", { team: t.slug });
  const random = () => {
    const pool = shown.filter((t) => t.slug !== team?.slug);
    if (pool.length) setSlug(pool[Math.floor(Math.random() * pool.length)].slug);
  };
  const back = () => navigate("play", team ? { team: team.slug } : undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isField(e.target)) return;
      if (e.key === "Escape") return back();
      if (e.key === "r" || e.key === "R") return random();
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) return play(team);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 0, ArrowDown: 0 }[e.key];
      if (step === undefined || !shown.length) return;
      e.preventDefault();
      const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 1;
      const by = e.key === "ArrowUp" ? -cols : e.key === "ArrowDown" ? cols : step;
      const at = Math.max(
        0,
        shown.findIndex((t) => t.slug === team?.slug),
      );
      const next = shown[Math.min(shown.length - 1, Math.max(0, at + by))];
      setSlug(next.slug);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pick">
      <Header active="play" theme={theme} onToggleTheme={onToggleTheme} />
      {!teams ? (
        <p className="pick__note" role={error ? "alert" : "status"}>
          {error ? m.loadError(error) : m.loading}
          {error && (
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {m.tryAgain}
            </Button>
          )}
        </p>
      ) : (
        <main className="pick__body">
          <section className="pick__list" aria-label={m.title}>
            <h1 className="pick__title">{m.title}</h1>
            <div className="pick__filters">
              <label className="pick__select">
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
              <label className="pick__select">
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
              <span className="pick__count">{m.count(shown.length)}</span>
            </div>
            <div className="pick__grid" ref={grid} role="listbox" aria-label={m.teamsLabel}>
              {shown.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  role="option"
                  aria-selected={t.slug === team?.slug}
                  className="pick__tile"
                  style={{ "--c": t.colors.primary } as CSSProperties}
                  title={t.name}
                  onClick={() => setSlug(t.slug)}
                  onDoubleClick={() => play(t)}
                >
                  <Helmet color={t.colors.primary} className="pick__helmet" />
                  <span className="pick__abbr">{t.abbreviation}</span>
                </button>
              ))}
            </div>
          </section>

          {team && <Preview key={team.slug} team={team} onPlay={() => play(team)} />}
        </main>
      )}

      <footer className="pick__keys" aria-label={m.keys}>
        <button type="button" className="pick__key" onClick={() => play(team)} disabled={!team}>
          <kbd>Enter</kbd>
          {m.play}
        </button>
        <button type="button" className="pick__key" onClick={back}>
          <kbd>Esc</kbd>
          {m.back}
        </button>
        <button type="button" className="pick__key" onClick={random} disabled={!teams}>
          <kbd>R</kbd>
          {m.random}
        </button>
        <button
          type="button"
          className="pick__key pick__key--end"
          onClick={() => navigate("programEdit", team ? { team: team.slug } : undefined)}
        >
          {m.newProgram}
        </button>
      </footer>
    </div>
  );
}

/** The picked team, big: its helmet on its colors, then its name, prestige, ratings and staff. */
function Preview({ team, onPlay }: { team: TeamCard; onPlay: () => void }) {
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
    [m.offScheme, scheme(team.staff?.offense)],
    [m.defScheme, scheme(team.staff?.defense)],
    [m.stadium, `${team.stadium.name} · ${m.seats(team.stadium.capacity)}`],
  ].filter((f): f is [string, string] => !!f[1]);

  return (
    <section className="preview" style={style} aria-label={team.name}>
      <span className="preview__mark" aria-hidden="true">
        {team.abbreviation}
      </span>
      <div className="preview__art">
        <Helmet color={team.colors.primary} className="preview__helmet" label={m.helmet(team.name)} />
      </div>
      <div className="preview__info">
        <span className="preview__badge" aria-hidden="true">
          {team.abbreviation}
        </span>
        <span className="preview__school">{team.name}</span>
        <h2 className="preview__mascot">{team.mascot}</h2>
        <span
          className="preview__stars"
          role="img"
          title={m.prestige(team.prestige, PRESTIGE_MAX)}
          aria-label={m.prestige(team.prestige, PRESTIGE_MAX)}
        >
          {Array.from({ length: PRESTIGE_MAX }, (_, i) => (
            <Star
              key={i}
              size={20}
              weight={i < team.prestige ? "fill" : "regular"}
              className={i < team.prestige ? undefined : "is-off"}
              aria-hidden="true"
            />
          ))}
        </span>
        <div className="preview__ratings">
          {ratings.map(([k, v]) => (
            <span key={k} className="preview__rating" title={m.ratingTips[k]}>
              <b>{Math.round(v)}</b>
              <span>{m[k]}</span>
            </span>
          ))}
        </div>
        <span className="preview__conf">{team.conference}</span>
        <dl className="preview__facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <Button size="lg" onClick={onPlay} aria-label={m.playAs(team.name)} className="preview__play">
          <Play size={20} weight="fill" aria-hidden="true" />
          {m.play}
        </Button>
      </div>
    </section>
  );
}

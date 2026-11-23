import { useEffect, useState } from "react";
import Button from "../../components/Button/index.tsx";
import Header from "../../components/Header/index.tsx";
import SkinControl from "../../components/SkinControl/index.tsx";
import TeamSelect from "../../components/TeamSelect/index.tsx";
import { api } from "../../api.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import { navigate, rememberDynasty } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import type { SeasonCard, SeasonsResponse, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
}

/** What the window shows: setting up a new season, or the saved ones to load. */
type Mode = "new" | "load";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Play: the start screen. A slim hero (the title, New Season / Load Season), then a window that fills the rest of the
 * screen: a new season's team select (components/TeamSelect) or the saved seasons.
 */
export default function Home({ theme, onToggleTheme }: Props) {
  const [teams, setTeams] = useState<TeamCard[] | null>(cachedTeams);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [seasons, setSeasons] = useState<SeasonCard[] | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by Try Again: every failed load runs again

  useEffect(() => {
    if (teams) return;
    loadTeams()
      .then((real) => {
        setTeams(real);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [teams, attempt]);

  // the saved seasons load the first time the list is opened
  useEffect(() => {
    if (mode !== "load" || seasons !== null) return;
    api<SeasonsResponse>("/api/seasons")
      .then((d) => {
        for (const s of d.seasons) rememberDynasty(s.id, s.team); // so each career's address names its school
        setSeasons(d.seasons);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [mode, seasons, attempt]);

  return (
    <div className="home">
      <Header active="play" theme={theme} onToggleTheme={onToggleTheme} />

      <section className="home__hero">
        <div className="home__brand">
          <h1 className="home__title">
            <mark className="home__title-mark">{m.titleMark}</mark>
          </h1>
          <p className="home__tagline">{m.tagline}</p>
        </div>
        <div className="home__actions">
          <Button
            variant={mode === "new" ? "solid" : "outline"}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            {m.newSeason}
          </Button>
          <Button
            variant={mode === "load" ? "solid" : "outline"}
            aria-pressed={mode === "load"}
            onClick={() => setMode("load")}
          >
            {m.loadSeason}
          </Button>
          <SkinControl />
        </div>
        {error && (
          <p className="home__error" role="alert">
            {m.loadError(error)}
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {m.tryAgain}
            </Button>
          </p>
        )}
      </section>

      <section className="window" aria-label={mode === "load" ? m.windowLoad : m.windowNew}>
        {mode === "load" ? (
          <div className="window__body">
            <h2 className="window__heading">{m.seasonsTitle}</h2>
            {seasons === null ? (
              <p className="home__soft">{m.loadingSeasons}</p>
            ) : seasons.length === 0 ? (
              <div className="home__empty">
                <p className="home__empty-title">{m.noSeasonsTitle}</p>
                <p className="home__soft">{m.noSeasonsText}</p>
                <div>
                  <Button variant="solid" onClick={() => setMode("new")}>
                    {m.newSeason}
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="home__seasons">
                {seasons.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="season-card" onClick={() => navigate("game", { id: s.id })}>
                      <span className="season-card__name">{s.team_name}</span>
                      <span className="season-card__soft">{m.seasonKind(s)}</span>
                      <span className="season-card__row">
                        <b>{m.record(s)}</b> {m.status(s)}
                      </span>
                      <span className="season-card__soft">{shortDate(s.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : teams ? (
          <TeamSelect teams={teams} />
        ) : (
          <p className="window__body home__soft">{m.loadingTeams}</p>
        )}
      </section>
    </div>
  );
}

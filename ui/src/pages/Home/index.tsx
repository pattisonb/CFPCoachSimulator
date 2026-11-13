import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import FolderTabs from "../../components/FolderTabs/index.tsx";
import Header from "../../components/Header/index.tsx";
import RosterTable from "../../components/RosterTable/index.tsx";
import TeamOverview from "../../components/TeamOverview/index.tsx";
import TeamPicker from "../../components/TeamPicker/index.tsx";
import { api } from "../../api.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import { navigate, replaceParams } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import type { RosterPlayer, SeasonCard, SeasonsResponse, TeamCard, TeamDetail } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
}

// Actions not wired to the game yet: each one is a step in the refactor.
const notYet = () => {};

// kept between visits to Play, so coming back from another page draws at once
const rosterCache = new Map<string, RosterPlayer[]>();

/** What the window shows: setting up a new season, or the saved ones to load. */
type Mode = "new" | "load";

/** The team's tabs in the window. */
type TeamView = "overview" | "roster";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span className="meter__label">{label}</span>
      <span className="meter__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="meter__value">{Math.round(value)}</span>
    </div>
  );
}

/**
 * Play: the start screen. A centered hero (headline, tagline, New Season / Load Season), then a window that
 * fills the rest of the screen: a new season's setup (team picker, the team, its roster) or the saved seasons.
 */
export default function Home({ theme, onToggleTheme }: Props) {
  const [teams, setTeams] = useState<TeamCard[] | null>(cachedTeams);
  // the team picked last time (?team=), so Back from another page lands on it
  const [slug, setSlug] = useState(() => new URLSearchParams(location.search).get("team") ?? "");
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [view, setView] = useState<TeamView>("overview");
  const [seasons, setSeasons] = useState<SeasonCard[] | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by Try Again: every failed load runs again
  const rosters = useRef(rosterCache);

  useEffect(() => {
    if (teams) return;
    loadTeams()
      .then((real) => {
        setTeams(real);
        setSlug((s) => s || real[0]?.slug || "");
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [teams, attempt]);

  // the picked team's players, each team fetched once
  useEffect(() => {
    if (!slug) return;
    const cached = rosters.current.get(slug);
    if (cached) {
      setRoster(cached);
      return;
    }
    let current = true;
    setRoster(null);
    api<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`)
      .then((d) => {
        rosters.current.set(slug, d.players);
        if (current) {
          setRoster(d.players);
          setError(null);
        }
      })
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [slug, attempt]);

  // the saved seasons load the first time the list is opened
  useEffect(() => {
    if (mode !== "load" || seasons !== null) return;
    api<SeasonsResponse>("/api/seasons")
      .then((d) => {
        setSeasons(d.seasons);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [mode, seasons, attempt]);

  // the address follows the pick
  useEffect(() => {
    if (slug) replaceParams("play", { team: slug });
  }, [slug]);

  const team = useMemo(() => teams?.find((t) => t.slug === slug) ?? null, [teams, slug]);

  return (
    <div className="home">
      <Header active="play" theme={theme} onToggleTheme={onToggleTheme} />

      <section className="home__hero">
        <h1 className="home__title">
          <mark className="home__title-mark">{m.titleMark}</mark>
        </h1>
        <p className="home__tagline">{m.tagline}</p>
        <div className="home__actions">
          <Button
            size="lg"
            variant={mode === "new" ? "solid" : "outline"}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            {m.newSeason}
          </Button>
          <Button
            size="lg"
            variant={mode === "load" ? "solid" : "outline"}
            aria-pressed={mode === "load"}
            onClick={() => setMode("load")}
          >
            {m.loadSeason}
          </Button>
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

      <section className="window" aria-label={mode === "load" ? m.windowLoad : m.windowNew(team?.name ?? "")}>
        {mode === "load" ? (
          <div className="window__body window__body--full">
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
                    <button type="button" className="season-card" onClick={notYet}>
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
        ) : (
          <div className="window__body">
            {/* the sidebar: pick the team, see the program */}
            <aside className="window__side">
              <TeamPicker
                label={m.yourTeam}
                hideLabel
                teams={teams}
                value={slug}
                onChange={setSlug}
                onNewProgram={() => navigate("programEdit", slug ? { team: slug } : undefined)}
              />
              {team && (
                <>
                  <div className="side-group">
                    <dl className="side-facts">
                      <div>
                        <dt>{m.conference}</dt>
                        <dd>{team.conference}</dd>
                      </div>
                      <div>
                        <dt>{m.headCoach}</dt>
                        <dd>{team.head_coach}</dd>
                      </div>
                      <div>
                        <dt>{m.stadium}</dt>
                        <dd>{team.stadium.name}</dd>
                      </div>
                      <div>
                        <dt>{m.capacity}</dt>
                        <dd>{m.seats(team.stadium.capacity)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="side-group">
                    <span className="label">{m.ratings}</span>
                    <Meter label={m.offense} value={team.ratings.offense} />
                    <Meter label={m.defense} value={team.ratings.defense} />
                    <Meter label={m.specialTeams} value={team.ratings.special_teams} />
                  </div>
                  <div className="side-overall">
                    <span className="label">{m.overall}</span>
                    <b className="side-overall__value">{Math.round(team.ratings.overall)}</b>
                  </div>
                </>
              )}
            </aside>

            {/* the main area: the team, then its roster */}
            <div className="window__main">
              {team && (
                <div className="team-head">
                  <span
                    className="team-head__badge"
                    style={{ background: team.colors.primary, borderColor: team.colors.secondary }}
                    aria-hidden="true"
                  >
                    {team.abbreviation}
                  </span>
                  <div className="team-head__who">
                    <h2 className="team-head__name">{team.name}</h2>
                    <span className="team-head__line">{m.teamLine(team.mascot, team.conference)}</span>
                  </div>
                  <Button
                    size="lg"
                    onClick={() => navigate("coachEdit", { team: team.slug })}
                    aria-label={m.playAs(team.name)}
                  >
                    <Play size={20} weight="fill" aria-hidden="true" />
                    {m.play}
                  </Button>
                </div>
              )}
              <FolderTabs
                label={m.teamTabs}
                tabs={(["overview", "roster"] as const).map((v) => ({ key: v, label: m[v] }))}
                value={view}
                onChange={setView}
                panelClassName="team-panel"
              >
                {view === "overview" ? <TeamOverview team={team} players={roster} /> : <RosterTable players={roster} />}
              </FolderTabs>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

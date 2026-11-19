import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Robot, SidebarSimple } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import CoachBadge from "../../components/CoachBadge/index.tsx";
import Dropdown from "../../components/Dropdown/index.tsx";
import Bracket from "../../components/Bracket/index.tsx";
import GameWindow from "../../components/GameWindow/index.tsx";
import Headquarters from "../../components/Headquarters/index.tsx";
import Offseason from "../../components/Offseason/index.tsx";
import Programs from "../../components/Programs/index.tsx";
import Rankings from "../../components/Rankings/index.tsx";
import Recap from "../../components/Recap/index.tsx";
import Scores from "../../components/Scores/index.tsx";
import Stats from "../../components/Stats/index.tsx";
import TeamResume from "../../components/TeamResume/index.tsx";
import DepthChart from "../../components/DepthChart/index.tsx";
import Office from "../../components/Office/index.tsx";
import Awards from "../../components/Awards/index.tsx";
import Bowls from "../../components/Bowls/index.tsx";
import Schedule from "../../components/Schedule/index.tsx";
import Standings from "../../components/Standings/index.tsx";
import Staff from "../../components/Staff/index.tsx";
import RecruitingHub, { type HubTab } from "../../components/RecruitingHub/index.tsx";
import GameNav, { type NavTeam } from "../../components/GameNav/index.tsx";
import SeasonStrip from "../../components/SeasonStrip/index.tsx";
import { api } from "../../api.ts";
import { faces, type Face as FaceSpec } from "../../faces.ts";
import { NAV_SHORTCUT, useNavMode } from "../../navMode.ts";
import { inkOn, teamAccent } from "../../colors.ts";
import { hrefFor, navigate, replaceParams } from "../../router.ts";
import { sectionOf } from "../../sections.ts";
import { useSim } from "../../sim.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import type { Theme } from "../../theme.ts";
import type { RecruitingBoard, SavedCoach, SeasonCoach, SeasonSummary, TeamCard, ScheduleGame } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** ?id=: the season (a Coach Career) being played */
  seasonId: string | null;
  /** ?section= */
  sectionKey: string | null;
}

type Load =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "ready"; season: SeasonSummary };

const coachName = (c: SeasonCoach) => (c.existing ? c.name : `${c.first_name} ${c.last_name}`);

/** How each built section sits in the window: edge to edge with its own columns, or padded. */
const PANE: Record<string, string> = {
  office: "",
  recruiting: "",
  depth: "game__pane--padded",
  schedule: "",
  staff: "",
  awards: "",
  bowls: "",
  standings: "",
  headquarters: "",
  rankings: "",
  stats: "",
  bracket: "",
  recap: "",
  scores: "",
  programs: "",
  offseason: "",
};

/**
 * /play: the game itself. Its own layout, no site header: the GameNav sidebar on the left; on the right, the
 * season's schedule and your coach (face, energy) across the top, then the open section's screen. Picking a section
 * rewrites the address (?section=) in place, so Back still leaves the game. The sidebar is open, minimized or
 * hidden (GameNav); hidden, an Open button leads the top row, and ⌘\\ / Ctrl+\\ hides and shows it.
 */
export default function Game({ theme, onToggleTheme, seasonId, sectionKey }: Props) {
  const [section, setSection] = useState(() => sectionOf(sectionKey));
  // Recruiting's tab: the Board, or Prospects (?tab=; an old ?section=prospects link opens it, sectionOf maps it)
  const [hubTab, setHubTab] = useState<HubTab>(() =>
    sectionKey === "classes" || new URLSearchParams(location.search).get("tab") === "classes"
      ? "classes"
      : sectionKey === "prospects" || new URLSearchParams(location.search).get("tab") === "prospects"
        ? "prospects"
        : "board",
  );
  // every section opened stays mounted (hidden when not shown): going back is instant and keeps its filters,
  // page, picks and scroll
  const [visited, setVisited] = useState<string[]>(() => [sectionOf(sectionKey).key]);
  const [navMode, setNavMode] = useNavMode();
  const [lastShown, setLastShown] = useState<"open" | "rail">(navMode === "rail" ? "rail" : "open");
  const [load, setLoad] = useState<Load>(seasonId ? { kind: "loading" } : { kind: "none" });
  const [teams, setTeams] = useState<TeamCard[]>(() => cachedTeams() ?? []);
  const [recruiting, setRecruiting] = useState<RecruitingBoard | null>(null);
  // a recruit another section asked to open on the board (a name in Headquarters)
  const [recruitPick, setRecruitPick] = useState<string | null>(null);
  const [savedFace, setSavedFace] = useState<FaceSpec | null>(null);

  useEffect(() => {
    loadTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    let live = true;
    setLoad({ kind: "loading" });
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => live && setLoad({ kind: "ready", season }))
      .catch((e: Error) => live && setLoad({ kind: "error", msg: e.message }));
    return () => {
      live = false;
    };
  }, [seasonId]);

  // the week's recruiting board (and with it Energy): on load, after every recruiting action and after a sim. Every
  // change to the board goes through here, so Recruiting never refetches just because it was opened
  const reloadRecruiting = useCallback(async () => {
    if (!seasonId) return;
    const r = await api<RecruitingBoard>(`/api/season/${seasonId}/recruiting`);
    setRecruiting(r);
  }, [seasonId]);
  useEffect(() => {
    reloadRecruiting().catch(() => setRecruiting(null));
  }, [reloadRecruiting]);

  // after a sim: the season and the week's recruiting again, in place (no loading screen)
  const refresh = useCallback(() => {
    if (!seasonId) return;
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => setLoad({ kind: "ready", season }))
      .catch(() => {});
    reloadRecruiting().catch(() => {});
  }, [seasonId, reloadRecruiting]);
  // Auto-Recruit (your staff works the board for you): Off, This Week or All Season, from the coach card
  const setAutoRecruit = async (mode: string) => {
    await api(`/api/season/${seasonId}/settings`, { method: "POST", body: { auto_recruit: mode } });
    await reloadRecruiting();
  };
  // a game in a window: a played game's box score, or your game played back after Game Day. The page behind keeps the
  // week as it was until the playback is over, so the score is not given away
  const [game, setGame] = useState<{ id: string; live: boolean } | null>(null);
  const sim = useSim(seasonId, (last) => {
    if (last?.status !== "error" && last?.gameday_event) setGame({ id: last.gameday_event, live: true });
    else refresh();
  });
  const openBox = (id: string) => setGame({ id, live: false });
  // the Offseason has the screen to itself: the season is over, so its week strip and the week's Energy say nothing
  const bare = section.key === "offseason";
  /** a team's resume in a window (from Rankings and Programs) */
  const [resume, setResume] = useState<string | null>(null);
  const energy = recruiting && { left: recruiting.hours_left, total: recruiting.hours };

  const season = load.kind === "ready" ? load.season : null;
  const coach = season?.coach ?? null;
  const createdId = coach && !coach.existing ? coach.id : null;

  // your created coach's own face; the team's own coach gets one rolled from his name
  useEffect(() => {
    if (!createdId) return;
    api<SavedCoach>(`/api/coaches/${createdId}`)
      .then((c) => setSavedFace(c.face ? faces.repair(c.face).face : null))
      .catch(() => setSavedFace(null));
  }, [createdId]);
  const face = useMemo(
    () => savedFace ?? (coach ? faces.random(`coach-${coachName(coach)}`) : null),
    [savedFace, coach],
  );

  const bySlug = useMemo(() => new Map(teams.map((t) => [t.slug, t])), [teams]);
  const myTeam = season ? bySlug.get(season.team) : undefined;
  // your team's colors for the whole game: the primary, or the secondary when the primary would vanish against this
  // theme's page; the text on it black or white, whichever reads
  const accent = myTeam ? teamAccent(myTeam.colors, theme) : null;
  const teamVars =
    myTeam && accent
      ? ({
          "--team": accent,
          "--team-2": accent === myTeam.colors.primary ? myTeam.colors.secondary : myTeam.colors.primary,
          "--team-on": inkOn(accent),
        } as CSSProperties)
      : undefined;
  // while a sim runs, the week strip and your record follow it: each result lands on its tile as the week is played
  // (a game not on the schedule yet, a bowl or a playoff game, gets a tile of its own). Game Day keeps its score back
  // for the playback.
  const liveResults = sim.status?.kind === "gameday" ? undefined : sim.status?.results;
  const stripGames = useMemo(() => {
    const games = season?.schedule ?? [];
    if (!liveResults?.length) return games;
    const hit = (g: ScheduleGame) => liveResults.find((r) => r.week === g.week && r.opponent === g.opponent);
    const known = games.map((g) => {
      const r = g.played ? undefined : hit(g);
      return r
        ? {
            ...g,
            played: true,
            won: r.won,
            points_for: r.points_for,
            points_against: r.points_against,
            overtime: r.overtime,
          }
        : g;
    });
    const fresh = liveResults
      .filter((r) => !games.some((g) => g.week === r.week && g.opponent === r.opponent))
      .map((r) => ({ ...r, event_id: null, opponent_rank: null, played: true }) as unknown as ScheduleGame);
    // a new game takes the place of that week's open date
    return [...known.filter((g) => !(g.kind === "bye" && fresh.some((r) => r.week === g.week))), ...fresh].sort(
      (a, b) => a.week - b.week,
    );
  }, [season?.schedule, liveResults]);
  const stripWeek = (liveResults && sim.status?.current_week) || season?.current_week || 0;
  const simRecord = sim.status?.kind === "gameday" ? undefined : sim.status?.record;
  const simWeek = sim.status?.kind === "gameday" ? undefined : sim.status?.current_week;
  const navTeam: NavTeam | null = season && {
    name: season.team_name,
    primary: myTeam?.colors.primary ?? "var(--ink)",
    secondary: myTeam?.colors.secondary ?? "var(--paper)",
    // a running sim moves the record and the week as it goes
    record: `${(simRecord ?? season.record).wins}-${(simRecord ?? season.record).losses}`,
    week: simWeek ?? season.current_week,
  };

  // ⌘\\ / Ctrl+\\: hide the sidebar, or show it again as it was before
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (navMode === "hidden") setNavMode(lastShown);
      else {
        setLastShown(navMode);
        setNavMode("hidden");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navMode, lastShown, setNavMode]);

  // the address names the section and, in Recruiting, the Prospects tab; the rest of it (?id=) stays
  const writeAddress = (key: string, tab: HubTab) => {
    const params = new URLSearchParams(location.search);
    params.set("section", key);
    if (key === "recruiting" && tab !== "board") params.set("tab", tab);
    else params.delete("tab");
    replaceParams("game", Object.fromEntries(params));
  };

  const openTab = (tab: HubTab) => {
    setHubTab(tab);
    writeAddress("recruiting", tab);
  };

  const open = (key: string) => {
    const next = sectionOf(key);
    if (next.key === section.key) return;
    setSection(next);
    setVisited((v) => (v.includes(next.key) ? v : [...v, next.key]));
    writeAddress(next.key, hubTab);
  };

  const toMenu = (
    <Button variant="outline" onClick={() => navigate("play")}>
      <ArrowLeft size={18} weight="bold" aria-hidden="true" />
      {m.mainMenu}
    </Button>
  );

  return (
    <div className="game" style={teamVars}>
      <GameNav
        team={navTeam}
        active={section.key}
        onSection={open}
        theme={theme}
        onToggleTheme={onToggleTheme}
        mode={navMode}
        onMode={(next) => {
          if (next === "hidden" && navMode !== "hidden") setLastShown(navMode);
          setNavMode(next);
        }}
      />
      <main className={`game__main${bare && navMode !== "hidden" ? " is-bare" : ""}`}>
        {/* the season so far and to come, then you */}
        <div className="game__top">
          {navMode === "hidden" && (
            <button
              type="button"
              className="game__open"
              aria-label={m.openNav(NAV_SHORTCUT)}
              title={m.openNav(NAV_SHORTCUT)}
              onClick={() => setNavMode(lastShown)}
            >
              <SidebarSimple size={20} weight="bold" aria-hidden="true" />
            </button>
          )}
          {season && !bare && (
            <SeasonStrip
              games={stripGames}
              teams={bySlug}
              weekLabels={season.week_labels}
              week={stripWeek}
              onBox={openBox}
            />
          )}
          {season && coach && face && !bare && (
            <CoachBadge
              name={coachName(coach)}
              team={season.team_name}
              face={face}
              energy={energy}
              corner={
                recruiting && (
                  <Dropdown
                    label={m.auto}
                    icon={
                      <Robot
                        size={16}
                        weight={recruiting.auto_recruit === "off" ? "bold" : "fill"}
                        aria-hidden="true"
                      />
                    }
                    align="right"
                    value={recruiting.auto_recruit}
                    options={Object.entries(m.autoModes).map(([value, label]) => ({ value, label }))}
                    onChange={(mode) => void setAutoRecruit(mode)}
                  />
                )
              }
            />
          )}
        </div>

        {season ? (
          // one window for every section: it never changes; the sections stack in it and cross-fade (Game/index.css)
          <section className="game__body" aria-label={section.label}>
            {visited.map((key) => {
              const sec = sectionOf(key);
              return (
                <div
                  key={key}
                  className={["game__pane", PANE[key] ?? "game__pane--center", key === section.key && "is-shown"]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden={key !== section.key}
                >
                  {key === "office" ? (
                    <Office
                      season={season}
                      recruiting={recruiting}
                      teams={bySlug}
                      sim={sim}
                      onSection={open}
                      onBox={openBox}
                    />
                  ) : key === "recruiting" ? (
                    <RecruitingHub
                      teams={bySlug}
                      seasonId={season.id}
                      team={season.team}
                      year={season.year}
                      weekLabels={season.week_labels}
                      board={recruiting}
                      reload={reloadRecruiting}
                      tab={hubTab}
                      onTab={openTab}
                      weekKey={season.current_week}
                      coach={coach && face ? { name: coachName(coach), face } : null}
                      pick={recruitPick}
                    />
                  ) : key === "headquarters" ? (
                    <Headquarters
                      key={season.current_week}
                      season={season}
                      onSection={open}
                      onProspects={() => {
                        open("recruiting");
                        openTab("prospects");
                      }}
                      onRecruit={(pid) => {
                        // on your board: open him there; not on it: the class list, where you can find and star him
                        const onBoard = !!recruiting?.board.some((b) => b.id === pid);
                        if (onBoard) setRecruitPick(pid);
                        open("recruiting");
                        openTab(onBoard ? "board" : "prospects");
                      }}
                      onBoardChange={() => void reloadRecruiting()}
                    />
                  ) : key === "rankings" ? (
                    <Rankings
                      season={season}
                      teams={bySlug}
                      onBracket={() => open("bracket")}
                      onBox={openBox}
                      onTeam={setResume}
                    />
                  ) : key === "stats" ? (
                    <Stats key={season.current_week} season={season} teams={bySlug} />
                  ) : key === "bracket" ? (
                    <Bracket season={season} teams={bySlug} />
                  ) : key === "recap" ? (
                    <Recap season={season} teams={bySlug} />
                  ) : key === "offseason" ? (
                    <Offseason
                      season={season}
                      teams={bySlug}
                      onSection={open}
                      onNextSeason={(id) => location.assign(hrefFor("game", { id, section: "office" }))}
                    />
                  ) : key === "scores" ? (
                    <Scores key={season.current_week} season={season} teams={bySlug} onBox={openBox} />
                  ) : key === "programs" ? (
                    <Programs season={season} teams={bySlug} onTeam={setResume} />
                  ) : key === "standings" ? (
                    <Standings season={season} teams={bySlug} />
                  ) : key === "bowls" ? (
                    <Bowls season={season} teams={bySlug} />
                  ) : key === "awards" ? (
                    <Awards
                      key={season.current_week}
                      season={season}
                      teams={bySlug}
                      coach={coach && face ? { name: coachName(coach), face } : null}
                    />
                  ) : key === "staff" ? (
                    <Staff
                      key={season.current_week}
                      seasonId={season.id}
                      year={season.year}
                      onBoardChange={() => void reloadRecruiting()}
                    />
                  ) : key === "schedule" ? (
                    <Schedule season={season} teams={bySlug} onBox={openBox} />
                  ) : key === "depth" ? (
                    <DepthChart
                      key={season.current_week}
                      seasonId={season.id}
                      team={season.team}
                      weekLabels={season.week_labels}
                      colors={myTeam?.colors}
                    />
                  ) : (
                    // the sidebar names the open section, so the section's screen takes the whole space
                    <div className="game__empty">
                      <sec.icon size={32} weight="bold" aria-hidden="true" />
                      <h1 className="game__empty-title">{m.notBuilt(sec.label)}</h1>
                      <p className="game__blurb">{sec.blurb}</p>
                      <p className="game__blurb">{m.notBuiltText}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ) : (
          <section className="game__body">
            <div className="game__pane game__pane--center is-shown">
              <div className="game__empty" role="status">
                {load.kind === "loading" && <p className="game__blurb">{m.loading}</p>}
                {load.kind === "error" && (
                  <>
                    <p className="game__empty-title">{m.loadError(load.msg)}</p>
                    {toMenu}
                  </>
                )}
                {load.kind === "none" && (
                  <>
                    <p className="game__empty-title">{m.noSeason}</p>
                    <p className="game__blurb">{m.noSeasonText}</p>
                    {toMenu}
                  </>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
      {season && (
        <TeamResume
          seasonId={season.id}
          team={resume}
          teams={bySlug}
          weekLabels={season.week_labels}
          onBox={openBox}
          onClose={() => setResume(null)}
        />
      )}
      {season && (
        <GameWindow
          seasonId={season.id}
          eventId={game?.id ?? null}
          live={game?.live}
          teams={bySlug}
          mine={season.team}
          weekLabels={season.week_labels}
          onFinal={refresh}
          onClose={() => setGame(null)}
        />
      )}
    </div>
  );
}

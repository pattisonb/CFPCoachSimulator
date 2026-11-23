import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Robot, SidebarSimple } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import { dateYearText } from "../../format.ts";
import CoachBadge, { Energy, type CoachRatings, type CoachWord } from "../../components/CoachBadge/index.tsx";
import Dropdown from "../../components/Dropdown/index.tsx";
import Bracket from "../../components/Bracket/index.tsx";
import GameWindow from "../../components/GameWindow/index.tsx";
import Headquarters from "../../components/Headquarters/index.tsx";
import Offseason from "../../components/Offseason/index.tsx";
import Programs from "../../components/Programs/index.tsx";
import Rankings from "../../components/Rankings/index.tsx";
import Recap from "../../components/Recap/index.tsx";
import SimBar from "../../components/SimBar/index.tsx";
import Ticker from "../../components/Ticker/index.tsx";
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
import Notifications, { NoticeToasts } from "../../components/Notifications/index.tsx";
import FindReveal from "../../components/FindReveal/index.tsx";
import { PlayerLinks } from "../../components/PlayerLink/index.tsx";
import { api } from "../../api.ts";
import { useFinds } from "../../finds.ts";
import { useNotices, type Notice } from "../../notices.ts";
import { useTab } from "../../tab.ts";
import { faces, presetCoachFace, type Face as FaceSpec } from "../../faces.ts";
import { NAV_SHORTCUT, useNavMode } from "../../navMode.ts";
import { inkOn, teamAccent } from "../../colors.ts";
import { currentParams, navigate, rememberDynasty, replaceParams } from "../../router.ts";
import { sectionOf } from "../../sections.ts";
import { useSim } from "../../sim.ts";
import { cachedStandIns, cachedTeams, loadTeams } from "../../teams.ts";
import type { Theme } from "../../theme.ts";
import type { RecruitingBoard, SavedCoach, SeasonCoach, SeasonSummary, TeamCard, ScheduleGame } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** ?id=: the season (a Coach Career) being played */
  seasonId: string | null;
  /** the next season has begun: the page is drawn afresh for it */
  onNewSeason: () => void;
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
/** *tune* How long after time passes (a sim, a week, an offseason stage) a new find still counts as your staff's, in ms. */
const PASSING_MS = 8000;

/** The offseason's stages before the portal opens (career_js/offseason.js STAGES). */
const BEFORE_PORTAL = ["retention", "departures"];

/** *tune* How much of your team's color the hard shadows under cards and buttons take, in percent. */
const SHADOW_TINT = 34;

export default function Game({ theme, onToggleTheme, seasonId, sectionKey, onNewSeason }: Props) {
  const [section, setSection] = useState(() => sectionOf(sectionKey));
  // Recruiting's tab: the Board, or Prospects (?tab=; an old ?section=prospects link opens it, sectionOf maps it)
  const [hubTab, setHubTab] = useState<HubTab>(() =>
    sectionKey === "classes" || currentParams().get("tab") === "classes"
      ? "classes"
      : sectionKey === "prospects" || currentParams().get("tab") === "prospects"
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
  // (quiet: no "Loading…" notice; stale: asked when the answer lands, and a true drops it, since newer clicks are on
  // the page already)
  const reloadRecruiting = useCallback(
    async (quiet?: boolean, stale?: () => boolean) => {
      if (!seasonId) return;
      const r = await api<RecruitingBoard>(`/api/season/${seasonId}/recruiting`, { quiet: quiet === true });
      if (!stale?.()) setRecruiting(r);
    },
    [seasonId],
  );
  useEffect(() => {
    reloadRecruiting().catch(() => setRecruiting(null));
  }, [reloadRecruiting]);
  /** a change shown at once, ahead of the server's answer (a quick action ticked: his row and your Energy) */
  const patchRecruiting = useCallback(
    (change: (b: RecruitingBoard) => RecruitingBoard) => setRecruiting((b) => (b ? change(b) : b)),
    [],
  );

  // after a sim: the season and the week's recruiting again, in place (no loading screen)
  const passedAt = useRef(0);
  const refresh = useCallback(() => {
    if (!seasonId) return;
    passedAt.current = Date.now();
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => setLoad({ kind: "ready", season }))
      .catch(() => {});
    reloadRecruiting().catch(() => {});
  }, [seasonId, reloadRecruiting]);
  // the offseason moved to another stage (the portal opened, a portal week passed): the board and the Prospects list
  // are a different pool now, so they load again (they are keyed by the week, which an offseason stage does not change)
  const [offStage, setOffStage] = useState("");
  const offStageWas = useRef("");
  const onOffStage = useCallback(
    (stage: string) => {
      if (offStageWas.current && offStageWas.current !== stage) refresh();
      offStageWas.current = stage;
      setOffStage(stage);
    },
    [refresh],
  );
  // Auto-Recruit (your staff works the board for you): Off, This Week or All Season, from the coach card
  const setAutoRecruit = async (mode: string) => {
    if (!seasonId) return;
    try {
      await api(`/api/season/${seasonId}/settings`, { method: "POST", body: { auto_recruit: mode } });
      await reloadRecruiting();
    } catch {
      // refused (a sim is running): the menu keeps the mode the game has
    }
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
  // Recruiting has it too, for the room: your coach's card floats in the window's corner there instead
  // (the player's ask: only the Office and Headquarters keep the season strip; every other page has the window to
  // itself, its own top bar stopping short of your coach's picture in the corner)
  const bare = section.key !== "office" && section.key !== "headquarters";
  /** the league's crawl along the window's bottom: on the Office only (the player's ask), where the week is read */
  const ticker = section.key === "office";
  /** a team's resume in a window (from Rankings and Programs) */
  const [resume, setResume] = useState<string | null>(null);
  const energy = recruiting && { left: recruiting.hours_left, total: recruiting.hours };

  // Auto-Recruit, in the coach card's corner
  const autoMenu = recruiting && (
    <Dropdown
      label={m.auto}
      icon={<Robot size={16} weight={recruiting.auto_recruit === "off" ? "bold" : "fill"} aria-hidden="true" />}
      align="right"
      value={recruiting.auto_recruit}
      options={Object.entries(m.autoModes).map(([value, label]) => ({ value, label }))}
      onChange={(mode) => void setAutoRecruit(mode)}
    />
  );

  const season = load.kind === "ready" ? load.season : null;
  // Recruiting goes by Transfer Portal from the moment the portal opens until the new season starts (the player's
  // ask): while it is open, and through the offseason's stages after it
  const portalNamed =
    !!recruiting?.portal || (!!season?.offseason_stage && !BEFORE_PORTAL.includes(season.offseason_stage));
  const coach = season?.coach ?? null;
  const createdId = coach && !coach.existing ? coach.id : null;

  // your created coach's own face; the team's own coach gets his preset face, else one rolled from his name
  useEffect(() => {
    if (!createdId) return;
    api<SavedCoach>(`/api/coaches/${createdId}`)
      .then((c) => setSavedFace(c.face ? faces.repair(c.face).face : null))
      .catch(() => setSavedFace(null));
  }, [createdId]);
  const face = useMemo(
    () =>
      savedFace ?? (coach ? (presetCoachFace(coachName(coach)) ?? faces.random(`coach-${coachName(coach)}`)) : null),
    // the presets arrive with the teams
    [savedFace, coach, teams],
  );

  // every team a game can show: the programs, and the FCS stand-ins a schedule plays (flagged `fictional`: a list
  // to pick from leaves them out)
  const bySlug = useMemo(() => new Map([...teams, ...cachedStandIns()].map((t) => [t.slug, t])), [teams]);
  // whose depth chart is open: yours (null), or another FBS team's to look at
  const [depthTeam, setDepthTeam] = useState<string | null>(null);
  const myTeam = season ? bySlug.get(season.team) : undefined;
  // your team's colors for the whole game: the primary, or the secondary when the primary would vanish against this
  // theme's page; the text on it black or white, whichever reads
  const accent = myTeam ? teamAccent(myTeam.colors, theme) : null;
  // the other two colors are for trim only (a stripe, a marker, a tint): words never sit on them without --team-2-on
  const second =
    myTeam && accent ? (accent === myTeam.colors.primary ? myTeam.colors.secondary : myTeam.colors.primary) : null;
  const third = myTeam?.colors.accent ?? second;
  const teamVars =
    myTeam && accent && second && third
      ? ({
          "--team": accent,
          "--team-2": second,
          "--team-3": third,
          "--team-on": inkOn(accent),
          "--team-2-on": inkOn(second),
          // the three colors as one stripe: mostly yours, then the second, a touch of the third
          "--team-stripe": `linear-gradient(90deg, ${accent} 0 64%, ${second} 64% 88%, ${third} 88%)`,
          // the hard pixel shadows lean toward your color
          "--shadow": `color-mix(in srgb, ${accent} ${SHADOW_TINT}%, ${theme === "dark" ? "#0f0f0f" : "#37352f"})`,
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
  // the week a sim has got to is held after it ends, until the saved season catches up: for a moment between the two
  // the season still says the old week, which sent the strip back a week and then forward again
  const simAt = useRef({ season: "", week: 0 });
  if (simAt.current.season !== `${season?.id}-${season?.year}`)
    simAt.current = { season: `${season?.id}-${season?.year}`, week: 0 };
  if (liveResults && sim.status?.current_week) simAt.current.week = sim.status.current_week;
  if ((season?.current_week ?? 0) >= simAt.current.week) simAt.current.week = 0;
  const stripWeek = Math.max(season?.current_week ?? 0, simAt.current.week);
  // your record is held the same way: without it the sidebar and the tab read last week's record for a moment
  const liveRecord = sim.status?.kind === "gameday" ? undefined : sim.status?.record;
  const heldRecord = useRef<{ wins: number; losses: number } | null>(null);
  if (liveRecord) heldRecord.current = liveRecord;
  if (!simAt.current.week) heldRecord.current = liveRecord ?? null;
  const simRecord = liveRecord ?? heldRecord.current ?? undefined;
  const simWeek = sim.status?.kind === "gameday" ? undefined : sim.status?.current_week;
  // a sim of several weeks: every week it finishes, the season is read again, so the page behind (your next game, the
  // program's news, the standings) follows the sim instead of holding the week it started in. Game Day keeps its page
  // still: the score is not given away before the playback
  useEffect(() => {
    if (!seasonId || !simWeek) return;
    api<SeasonSummary>(`/api/season/${seasonId}`, { quiet: true })
      .then((next) =>
        setLoad((was) => (was.kind === "ready" && was.season.id === next.id ? { kind: "ready", season: next } : was)),
      )
      .catch(() => {});
  }, [seasonId, simWeek]);
  // while a sim runs the page is to watch, not to work: every click and key is swallowed except on what is marked
  // data-sim-allow (Stop After This Week). Pointing still works, so the tooltips do
  useEffect(() => {
    if (!sim.running) return;
    const allowed = (e: Event) => e.target instanceof Element && !!e.target.closest("[data-sim-allow]");
    const block = (e: Event) => {
      if (allowed(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      // the browser's own keys (reload, find, the function keys) and Tab are left alone
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab" || /^F\d+$/.test(e.key)) return;
      block(e);
    };
    const kinds = [
      "click",
      "dblclick",
      "mousedown",
      "pointerdown",
      "touchstart",
      "contextmenu",
      "submit",
      "input",
      "change",
    ];
    kinds.forEach((k) => document.addEventListener(k, block, true));
    document.addEventListener("keydown", key, true);
    return () => {
      kinds.forEach((k) => document.removeEventListener(k, block, true));
      document.removeEventListener("keydown", key, true);
    };
  }, [sim.running]);
  // the browser tab: "Toledo Dynasty", and the sim's progress, your record and the week while one runs
  useTab(
    season?.team_name ?? null,
    simRecord ?? season?.record ?? null,
    {
      running: sim.running,
      progress: sim.status?.progress ?? 0,
      week: season ? (season.week_labels[String((simWeek ?? season.current_week) + 1)] ?? null) : null,
      failed: !!sim.error,
    },
    accent ?? "#f5b942",
    myTeam?.colors,
  );
  // the date under your team's name: the one the Office's headline shows (your game this week, else the week's main
  // day), with its year. The schedule's dates are one calendar's, so a later season moves only the year
  const dateWeek = (simWeek ?? season?.current_week ?? 0) + 1;
  const dateIso =
    season?.schedule.find((g) => g.week === dateWeek && g.opponent)?.date ??
    season?.week_dates[String(dateWeek)]?.main ??
    season?.week_dates[String(dateWeek - 1)]?.main;
  const calendarYear = Number(season?.week_dates["1"]?.main?.slice(0, 4)) || season?.year || 0;
  const navTeam: NavTeam | null = season && {
    name: season.team_name,
    primary: myTeam?.colors.primary ?? "var(--ink)",
    secondary: myTeam?.colors.secondary ?? "var(--paper)",
    // a running sim moves the record and the week as it goes
    record: `${(simRecord ?? season.record).wins}-${(simRecord ?? season.record).losses}`,
    week: simWeek ?? season.current_week,
    date: dateYearText(dateIso, season.year - calendarYear),
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
    const params = currentParams();
    // the address has already left the game (a click here in the moment before another page draws): it is not
    // this page's to rewrite (the stress run's find: an Edit Look address turned into a game with no career)
    if (!params.get("id")) return;
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
  // the season ending while you watch (the last week played) takes you to its recap; a season already over when the
  // page opens stays where the address says
  const wasDone = useRef<{ season: string; done: boolean } | null>(null);
  useEffect(() => {
    if (!season) return;
    const key = `${season.id}-${season.year}`;
    const before = wasDone.current;
    wasDone.current = { season: key, done: season.done };
    if (before && before.season === key && !before.done && season.done) open("recap");
  });

  // a recruit or transfer named in another section: on your board, open him there; not on it, the class list, where
  // you can find and star him
  const openRecruit = (pid: string) => {
    const onBoard = !!recruiting?.board.some((b) => b.id === pid);
    if (onBoard) setRecruitPick(pid);
    open("recruiting");
    openTab(onBoard ? "board" : "prospects");
  };

  // the address names the school once the career has loaded (dynasty/app-state/office), whatever link opened it
  const seasonKey = season ? `${season.id}:${season.team}` : "";
  useEffect(() => {
    if (!season) return;
    rememberDynasty(season.id, season.team);
    writeAddress(section.key, hubTab);
  }, [seasonKey]);

  // finds can land when a week passes, an offseason stage turns, or a look comes back on someone on your board
  const looks = recruiting?.board.reduce((n, b) => n + (b.looks ?? 0), 0) ?? 0;
  // your word (how well you keep promises), on your coach's card: read again when a week passes
  const [word, setWord] = useState<CoachWord | null>(null);
  // ... and your ratings as a head coach, in the part that drops under the card
  const [ratings, setRatings] = useState<CoachRatings | null>(null);
  useEffect(() => {
    if (!season?.id) return;
    let on = true;
    api<{ word?: CoachWord; coach?: { ratings?: CoachRatings } }>(`/api/season/${season.id}/office`)
      .then((v) => {
        if (!on) return;
        setWord(v.word ?? null);
        setRatings(v.coach?.ratings ?? null);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [season?.id, season?.current_week, offStage]);

  // what happened while time passed (a commit, a decommit, an injury, a staff find): the bell on your coach's card
  // while a sim runs they come with its progress, week by week (sim.status.feed): your class and your injuries are not
  // read again until it ends, so a long sim showed nothing until then
  const feed = sim.running ? sim.status?.feed : null;
  const notices = useNotices(
    season?.id,
    season?.year,
    season?.team,
    feed?.week ?? season?.current_week,
    feed?.board ?? recruiting?.board,
    feed?.injuries,
  );
  const finds = useFinds(
    season?.id,
    season?.year,
    `${season?.current_week}-${offStage}-${looks}`,
    () => sim.running || Date.now() - passedAt.current < PASSING_MS,
    (found) =>
      notices.add(
        found.map((f) => ({
          id: `find:${f.pid}:${f.flag}`,
          kind: f.flag,
          name: f.name,
          position: f.position,
          pid: f.pid,
          stars: f.stars,
        })),
      ),
  );
  // a notice opens what it is about: a recruit's file, or your team's injury report (Stats, Injuries)
  const [statsOpen, setStatsOpen] = useState<{ tab: "injuries" | "players"; team: string; at: number } | null>(null);
  // the week's two budgets as bars (hours and scouting points): in Recruiting's tab bar and the Offseason's portal
  // box. The dead period has neither to spend, so they are left out
  const budgets =
    recruiting && !recruiting.closed ? (
      <>
        <Energy energy={energy || null} />
        <Energy
          energy={{ left: recruiting.points_left, total: recruiting.points_week }}
          label={m.scouting}
          hint={m.scoutingHint}
        />
      </>
    ) : undefined;
  const openNotice = (n: Notice) => {
    if (n.kind === "injury") {
      if (season) setStatsOpen({ tab: "injuries", team: season.team, at: Date.now() });
      open("stats");
    } else if (n.pid) openRecruit(n.pid);
  };
  const bell = season && (
    <Notifications
      items={notices.items}
      unread={notices.unread}
      weekLabels={season.week_labels}
      onOpen={openNotice}
      onRead={notices.readAll}
      onShow={notices.clearToasts}
    />
  );
  const corner = (
    <>
      {bell}
      {autoMenu}
    </>
  );
  const toasts = () =>
    season && (
      <NoticeToasts
        items={notices.toasts}
        weekLabels={season.week_labels}
        onOpen={openNotice}
        onDismiss={notices.dismiss}
      />
    );

  // the sidebar hidden: the button that brings it back
  const openNav = navMode === "hidden" && (
    <button
      type="button"
      className="game__open"
      aria-label={m.openNav(NAV_SHORTCUT)}
      title={m.openNav(NAV_SHORTCUT)}
      onClick={() => setNavMode(lastShown)}
    >
      <SidebarSimple size={20} weight="bold" aria-hidden="true" />
    </button>
  );

  const toMenu = (
    <Button variant="outline" onClick={() => navigate("play")}>
      <ArrowLeft size={18} weight="bold" aria-hidden="true" />
      {m.mainMenu}
    </Button>
  );

  return (
    <div className={sim.running ? "game is-simming" : "game"} style={teamVars}>
      {/* any player's name on any screen opens his card: one window for the whole career (PlayerLink) */}
      <PlayerLinks seasonId={season?.id} weekLabels={season?.week_labels}>
        <GameNav
          team={navTeam}
          loading={load.kind === "loading"}
          active={section.key}
          onSection={open}
          // the offseason's portal: the same page works the portal, so it goes by that name (the player's ask)
          names={portalNamed ? { recruiting: m.portal } : undefined}
          // the Offseason joins the list when the season is over (it stays while you are on it, an address typed by hand)
          hide={season && !season.done && section.key !== "offseason" ? ["offseason"] : undefined}
          theme={theme}
          onToggleTheme={onToggleTheme}
          mode={navMode}
          onMode={(next) => {
            if (next === "hidden" && navMode !== "hidden") setLastShown(navMode);
            setNavMode(next);
          }}
        />
        <main
          className={[
            "game__main",
            bare && "is-bare",
            navMode === "hidden" && "is-navless",
            section.key === "recruiting" && "is-recruiting",
            section.key === "offseason" && "is-offseason",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/* the season so far and to come, then you */}
          {/* the sidebar hidden, on a page with no top row: Open sits in the corner of the page's own top bar, which
              starts clear of it, so the page keeps the whole window (the player's ask) */}
          {bare && openNav}
          <div className="game__top">
            {!bare && openNav}
            {season && !bare && (
              <SeasonStrip
                games={stripGames}
                titleGame={season.title_game}
                teams={bySlug}
                weekLabels={season.week_labels}
                week={stripWeek}
                onBox={openBox}
              />
            )}
          </div>
          {/* you, in the window's top right corner on every screen: your face alone, the card when you point at it.
              Recruiting and the Offseason have no top row: their top bars stop short of your face and leave it the corner */}
          {season && coach && face && (
            <CoachBadge
              name={coachName(coach)}
              team={season.team_name}
              face={face}
              word={word}
              budgets={budgets}
              nil={recruiting ? { left: recruiting.nil.left, total: recruiting.nil.budget } : null}
              ratings={ratings}
              corner={corner}
              below={toasts()}
              alert={notices.unread}
            />
          )}

          {season ? (
            // one window for every section: it never changes; the sections stack in it and cross-fade (Game/index.css)
            <section
              className={ticker || sim.running ? "game__body has-ticker" : "game__body"}
              aria-label={section.label}
            >
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
                        aside={budgets}
                        teams={bySlug}
                        seasonId={season.id}
                        team={season.team}
                        year={season.year}
                        weekLabels={season.week_labels}
                        portalNamed={portalNamed}
                        board={recruiting}
                        reload={reloadRecruiting}
                        patch={patchRecruiting}
                        tab={hubTab}
                        onTab={openTab}
                        weekKey={`${season.current_week}-${offStage}`}
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
                        onRecruit={openRecruit}
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
                      <Stats key={season.current_week} season={season} teams={bySlug} show={statsOpen} />
                    ) : key === "bracket" ? (
                      <Bracket season={season} teams={bySlug} onBox={openBox} />
                    ) : key === "recap" ? (
                      <Recap
                        season={season}
                        teams={bySlug}
                        onBracket={() => open("bracket")}
                        onOpen={(to) => {
                          // the stats open on the players, yours alone or the whole league's
                          if (to === "stats" || to === "stats-mine")
                            setStatsOpen({ tab: "players", team: to === "stats" ? "" : season.team, at: Date.now() });
                          open(to === "stats-mine" ? "stats" : to);
                        }}
                      />
                    ) : key === "offseason" ? (
                      <Offseason
                        season={season}
                        teams={bySlug}
                        onSection={open}
                        onStage={onOffStage}
                        onRecruit={openRecruit}
                        budgets={budgets}
                        onNextSeason={(id) => {
                          // the new season opens in place, on a page drawn afresh: a full load would start the
                          // published game's engine over (the stress run's find)
                          navigate("game", { id, section: "office" }, true);
                          onNewSeason();
                        }}
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
                        onBoardChange={() => void reloadRecruiting().catch(() => {})}
                      />
                    ) : key === "schedule" ? (
                      <Schedule season={season} teams={bySlug} onBox={openBox} />
                    ) : key === "depth" ? (
                      <DepthChart
                        key={`${season.current_week}-${depthTeam ?? season.team}`}
                        seasonId={season.id}
                        team={depthTeam ?? season.team}
                        mine={season.team}
                        teams={bySlug}
                        onTeam={setDepthTeam}
                        weekLabels={season.week_labels}
                        colors={(depthTeam ? bySlug.get(depthTeam) : myTeam)?.colors}
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
              {/* a sim running: its bar takes the ticker's place, on every page (the player's ask) */}
              {sim.running && sim.status && (
                <SimBar
                  status={sim.status}
                  week={season?.week_labels[String((sim.status.current_week ?? season.current_week) + 1)] ?? null}
                  onStop={sim.stop}
                />
              )}
              {ticker && season && !sim.running && (
                <Ticker
                  seasonId={season.id}
                  week={stripWeek}
                  teams={bySlug}
                  live={sim.running}
                  onBox={openBox}
                  onTeam={setResume}
                  onRecruit={openRecruit}
                />
              )}
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
        {/* a gem or a generational talent your staff has just found: the whole screen stops for it */}
        <FindReveal
          find={finds.find}
          more={finds.more}
          onClose={finds.next}
          onOpen={(pid) => {
            finds.next();
            openRecruit(pid);
          }}
        />
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
      </PlayerLinks>
    </div>
  );
}

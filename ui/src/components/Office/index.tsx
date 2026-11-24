import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CalendarDots,
  CaretRight,
  Check,
  FastForward,
  GameController,
  Football,
  Handshake,
  PhoneCall,
  Lightning,
  ListNumbers,
  Play,
  SkipForward,
  Star,
  StopCircle,
  Trophy,
  type Icon,
} from "@phosphor-icons/react";
import PlayGame from "../PlayGame/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import { dateText, kickoffText, ordinal } from "../../format.ts";
import type { Sim } from "../../sim.ts";
import SimBoard from "../SimBoard/index.tsx";
import type {
  NewsItem,
  OfficeView,
  RecruitingWeek,
  ScheduleGame,
  SeasonSummary,
  SimResult,
  SimStatus,
  TeamCard,
} from "../../types.ts";
import { nameInLine } from "../../teams.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** A line kept at its height while it has nothing to say. */
const NBSP = "\u00a0";

interface Props {
  season: SeasonSummary;
  /** the week's recruiting read (already loaded for Energy), or null while it loads */
  recruiting: RecruitingWeek | null;
  teams: Map<string, TeamCard>;
  sim: Sim;
  /** open another section (a to-do opens Recruiting, Scouting or the Depth Chart) */
  onSection: (key: string) => void;
  /** open a played game's box score */
  onBox?: (eventId: string) => void;
}

/** *tune* Recruiting closes once Championship Week is played (recruiting.close_week), and Signing Day comes after the
 *  last game (sim_js/season.js FINAL_WEEK): between the two nobody can work a recruit. */
const CLOSE_WEEK = 15;
const FINAL_WEEK = 20;
/** *tune* Selection day: Sim to Selection Day shows before it. */
const SELECTION_WEEK = 15;
/** *tune* How long after Sim Through's list opens a scroll is still taken as the click's own, not a reason to close. */
const OPEN_SETTLE_MS = 250;
/** *tune* The cheapest recruiting action (a message): fewer hours left than this and the week's hours are spent. */
const MIN_ACTION_HOURS = 5;
/** Conferences whose short name reads better ("Around the American"). */
const CONF_SHORT: Record<string, string> = {
  "American Athletic Conference": "American",
  "FBS Independent": "Independents",
  "FBS Independents": "Independents",
};
/** What a recruiting event says (web/recruiting.js WORDS). */
const EVENT_WORDS: Record<string, string> = {
  commit: "verbally committed to",
  hard: "is now a hard commit to",
  flip: "flipped to",
  decommit: "decommitted from",
  signed: "signed with",
  offer: "was offered by",
  asked_more: "wants more from",
  not_buying: "isn't buying the pitch from",
  hung_up: "has an unfinished call from",
  pester: "is tuning out",
  promise_broken: "feels a promise was broken by",
};
/** Events that carry their own sentence. */
const LINE_KINDS = new Set(["bloomed", "pro", "twist", "hat", "softened", "cooled", "door_closed", "door_open"]);

const confShort = (c: string) => CONF_SHORT[c] ?? c;
const recordText = (r: { wins: number; losses: number }) => `${r.wins}-${r.losses}`;

interface Todo {
  key: string;
  icon: Icon;
  title: string;
  sub: string;
  /** a short figure at the right: hours, points, a kickoff */
  meta: string;
  done: boolean;
  go?: () => void;
}

/**
 * The Office: your week, in three columns. Left, the upcoming game (the matchup, the Win Chance) and the actions that
 * move the season on; the middle, the week's to-do list as a checked timeline; the right, Program News and the
 * conference's scores. The top row (schedule, coach, Energy) is the game's own, above it.
 */
/** *tune* How long the next to-do must hold still before the highlight moves to it, in ms. */
const NOW_SETTLE_MS = 450;
/** *tune* The longest the sim's board stays up after a sim ends, waiting for the new week's Office to arrive, in ms. */
const BOARD_SETTLE_MS = 900;

export default function Office({ season: s, recruiting: v, teams, sim, onSection, onBox }: Props) {
  const [office, setOffice] = useState<OfficeView | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);
  // Play Game Day: pick the sides, then the field (Pocket Franchise) or a sim
  const [playOpen, setPlayOpen] = useState(false);

  const weekName = (w: number) => s.week_labels[String(w)] ?? m.week(w - 1);
  const games = s.schedule.filter((g) => g.opponent);
  const thisWeek = s.done ? null : (games.find((g) => g.week === s.current_week + 1) ?? null);
  const next = s.done ? null : (games.find((g) => !g.played && g.week >= s.current_week + 1) ?? null);
  // the game card, held while a sim runs: it stays as it was when the sim began instead of chasing the weeks (the
  // player's ask)
  // Program News while a sim runs: the sim sends each finished week's with its progress, so it is not a read behind
  const news = (sim.running && sim.status?.feed?.news) || office?.news || [];
  const cardNow = { s, thisWeek, next };
  const cardHeld = useRef(cardNow);
  if (!sim.running) cardHeld.current = cardNow;
  const card = sim.running ? cardHeld.current : cardNow;
  const w = s.current_week + 1;

  // the office's own read, again after every sim (the week moves on)
  // (while a sim runs the weeks pass faster than the game answers: an answer is shown unless a later one already is,
  // so the news follows the sim a week or two behind instead of waiting for its end)
  const officeAsk = useRef({ season: "", asked: 0, shown: 0 });
  useEffect(() => {
    if (officeAsk.current.season !== s.id) officeAsk.current = { season: s.id, asked: 0, shown: 0 };
    const mine = ++officeAsk.current.asked;
    const current = () => officeAsk.current.season === s.id && mine > officeAsk.current.shown;
    api<OfficeView>(`/api/season/${s.id}/office`, { quiet: sim.running })
      .then((o) => {
        if (!current()) return;
        officeAsk.current.shown = mine;
        setOffice(o);
        setOfficeError(null);
      })
      .catch((e: Error) => current() && setOfficeError(e.message));
  }, [s.id, s.current_week, s.record.wins, s.record.losses]);

  // ---------- the week's to-dos ----------
  const todos: Todo[] = [];
  if (!s.done) {
    // the dead period: there is no recruiting or scouting to do until Signing Day
    if (v && s.current_week < CLOSE_WEEK) {
      const auto = v.auto_recruit && v.auto_recruit !== "off";
      const spent = !!auto || v.hours_left < MIN_ACTION_HOURS;
      todos.push({
        key: "recruit",
        icon: Handshake,
        title: m.recruit,
        sub: auto
          ? v.auto_recruit === "week"
            ? m.autoWeek
            : m.autoSeason
          : spent
            ? m.recruitDone(v.hours)
            : m.recruitSub(v.hours_left, v.hours, v.hours_used),
        meta: m.hours(v.hours_left),
        done: spent,
        go: () => onSection("recruiting"),
      });
      // a commit of yours another school is still calling: keep in touch (done once he has heard from you this week)
      const pressed = office?.pressed ?? [];
      if (pressed.length && !auto) {
        const waiting = pressed.filter((x) => !x.kept);
        todos.push({
          key: "pressed",
          icon: PhoneCall,
          title: m.pressed,
          sub: waiting.length ? m.pressedSub(waiting[0].school_name) : m.pressedDone,
          meta: m.pressedCount(waiting.length || pressed.length),
          done: !waiting.length,
          go: () => onSection("recruiting"),
        });
      }
    }
    const hurt = s.injuries?.length ?? 0;
    if (hurt > 0)
      todos.push({
        key: "depth",
        icon: ListNumbers,
        title: m.depth,
        sub: m.depthSub(hurt),
        meta: m.hurt(hurt),
        done: false,
        go: () => onSection("depth"),
      });
    if (thisWeek)
      todos.push({
        key: "gameday",
        icon: Football,
        title: m.gameDay,
        sub: thisWeek.played
          ? m.played(!!thisWeek.won, m.score(thisWeek.points_for ?? 0, thisWeek.points_against ?? 0))
          : m.gameDaySub(
              thisWeek.venue === "away" ? m.atOpp : m.against,
              nameInLine(thisWeek.opponent_name, thisWeek.opponent),
            ),
        meta: kickoffText(thisWeek.date),
        done: thisWeek.played,
        go: thisWeek.played ? undefined : () => setPlayOpen(true),
      });
    todos.push({
      key: "advance",
      icon: FastForward,
      title: m.advance,
      sub: w < FINAL_WEEK ? m.advanceSub(weekName(w + 1)) : m.advanceLast,
      meta: w < FINAL_WEEK ? weekName(w + 1) : "",
      done: false,
      go: () => sim.start("advance"),
    });
  }
  const first = todos.find((t) => !t.done)?.key;
  // the to-do in ink follows the week, but only once it has settled: a sim (and the moment after it, while the new
  // week's schedule and its recruiting hours arrive one after the other) moved it from one row to another and back
  // (outside a sim it IS the first thing left to do, at once: held a beat behind, a new dynasty showed Advance or Scout
  // in ink until the recruiting numbers had arrived and the beat had passed, and sometimes stayed there)
  const [nowHeld, setNowHeld] = useState(first);
  const [holding, setHolding] = useState(sim.running);
  useEffect(() => {
    if (sim.running) return setHolding(true);
    const t = window.setTimeout(() => setHolding(false), NOW_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [sim.running]);
  useEffect(() => {
    if (!holding) setNowHeld(first);
  }, [first, holding]);
  // before the recruiting numbers arrive the list is not whole yet (Recruit and Scout are missing): nothing is in ink
  const waiting = !s.done && !v && s.current_week < CLOSE_WEEK;
  const current = waiting ? undefined : holding ? nowHeld : first;

  const conf = confShort(office?.conference.name ?? s.conference);
  const st = office?.conference.standing;
  const signing = s.current_week >= CLOSE_WEEK;
  /** the sim's own progress, while one runs: the Office shows the board and nothing to press */
  const board = sim.running ? sim.status : null;
  // The board stays up for the moment after a sim ends, until the new week's Office and recruiting numbers have both
  // arrived (the player's report: the Office came back in two steps, grayed with last week's numbers and then filled
  // in). So the Office is shown once, whole. It never waits longer than BOARD_SETTLE_MS.
  const ran = useRef(false);
  const atEnd = useRef<{ office: OfficeView | null; v: typeof v } | null>(null);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (sim.running) {
      // what the Office held when the sim began: the new week's has arrived once both differ from these (read at the
      // sim's end instead, an answer already in by then was never seen to change, and the board sat out the whole
      // wait: the player's report of a hang after every week)
      if (!ran.current) atEnd.current = { office, v };
      ran.current = true;
      return;
    }
    if (!ran.current) return;
    ran.current = false;
    setSettling(true);
    const t = window.setTimeout(() => setSettling(false), BOARD_SETTLE_MS);
    return () => window.clearTimeout(t);
    // (only the sim starting and ending: what the Office held at the end is read once, then)
  }, [sim.running]);
  useEffect(() => {
    // (and the to-do in ink has caught up with the new week: the Office is never shown with nothing marked)
    const arrived = !!atEnd.current && office !== atEnd.current.office && (v !== atEnd.current.v || !v);
    if (settling && arrived && !holding && nowHeld === first) setSettling(false);
  }, [settling, office, v, holding, nowHeld, first]);
  // (the sim has ended and the effect above has not run yet: one draw, still the board)
  // (a season that has just ended goes straight to its recap: nothing to settle)
  const boardOn = !!board || (!s.done && (settling || (ran.current && !sim.running)));
  // The board changes all at once, when the sim finishes a week (the player's ask): the sim counts a week's games
  // into your record before it calls the week over, so the record and the rank are held as they were until the week
  // itself moves. Your place in the conference comes with that week's feed.
  const held = useRef<{
    week: number;
    record: NonNullable<SimStatus["record"]>;
    rank: string | null;
    results: SimResult[];
  } | null>(null);
  const heldPlace = useRef<string | null | undefined>(undefined);
  if (!boardOn) {
    held.current = null;
    heldPlace.current = undefined;
  } else if (board) {
    const wk = board.current_week ?? s.current_week;
    if (!held.current || held.current.week !== wk) {
      const rank = board.my_rank === undefined ? s.my_rank?.rank : board.my_rank?.rank;
      held.current = {
        week: wk,
        record: board.record ?? s.record,
        rank: rank ? `#${rank}` : null,
        results: board.results ?? [],
      };
      const p = board.feed?.week === wk ? board.feed.place : undefined;
      if (p !== undefined) heldPlace.current = p ? m.confPlace(ordinal(p.conf_rank), p.of) : null;
    }
  }
  const boardPlace =
    heldPlace.current !== undefined
      ? heldPlace.current
      : office?.conference.independent || !st
        ? null
        : m.confPlace(ordinal(st.conf_rank), st.of);
  // the week on the board: the one being played. Past the last week there is none (the player's report: a sim to the
  // season's end flashed "Week 20" before the recap), so the last one named stays
  const boardAt = (held.current?.week ?? s.current_week) + 1;
  const boardWeek = s.week_labels[String(boardAt)] ? weekName(boardAt) : weekName(boardAt - 1);
  const title = s.done ? m.seasonComplete(s.year) : m.thisWeek;
  const subtitle = s.done
    ? s.champion_name
      ? m.champion(s.champion_name)
      : m.wrap
    : [weekName(w), dateText(thisWeek?.date ?? s.week_dates[String(w)]?.main)].filter(Boolean).join(" · ");

  return (
    <div className={boardOn ? "office is-simming" : "office"}>
      {/* a sim running: one big board in place of the game, the actions and the to-dos (the player's ask) */}
      {boardOn && (
        <div className="office__board">
          <SimBoard
            week={boardWeek}
            record={held.current?.record ?? s.record}
            conference={conf}
            place={boardPlace}
            rank={held.current?.rank ?? null}
            results={held.current?.results ?? []}
          />
        </div>
      )}
      {/* ---------- left: the game, then the actions ---------- */}
      <aside className="office__col office__left" hidden={boardOn}>
        {s.done ? (
          <WrapCard s={s} teams={teams} />
        ) : (
          <GameCard {...card} teams={teams} weekName={weekName} onBox={onBox} simming={sim.running} />
        )}
        <Actions
          s={s}
          sim={sim}
          game={thisWeek && !thisWeek.played ? thisWeek : null}
          weekName={weekName}
          next={next}
          onPlay={() => setPlayOpen(true)}
          onOffseason={() => onSection("offseason")}
        />
      </aside>

      {/* ---------- middle: the week and its to-dos ---------- */}
      <section className="office__col office__mid" aria-label={m.todo} hidden={boardOn}>
        <header className="office__hero">
          <h1 className="office__title">
            <span>{title}</span>
            <span className="office__title-sub">{subtitle}</span>
          </h1>
          <dl className="office__stats">
            <div>
              <dt className="label">{m.rank}</dt>
              <dd>
                {s.my_rank?.rank ? (
                  <>
                    #{s.my_rank.rank} <small>{m.rankLine(s.my_rank.kind)}</small>
                  </>
                ) : (
                  m.unranked
                )}
              </dd>
            </div>
            <div>
              <dt className="label">{conf}</dt>
              <dd>
                {office?.conference.independent ? m.independent : st ? m.confPlace(ordinal(st.conf_rank), st.of) : "–"}
              </dd>
            </div>
            <div>
              <dt className="label">{m.recruitingClass}</dt>
              <dd>
                {v ? (
                  <>
                    {m.commits(v.committed, v.open_spots)} <small>{m.committed}</small>
                  </>
                ) : (
                  "–"
                )}
              </dd>
            </div>
          </dl>
        </header>

        {signing && (
          <p className="office__notice" role="status">
            <b>{s.current_week >= FINAL_WEEK ? m.nationalSigning : m.recruitingClosed}</b>
            <span>{s.current_week >= FINAL_WEEK ? m.nationalText : m.closedText}</span>
          </p>
        )}

        {s.done ? (
          <p className="office__soft">{m.offseasonNext}</p>
        ) : (
          <ol className="office__todos" aria-label={m.todo}>
            {todos.map((t) => {
              const state = t.done ? "is-done" : t.key === current ? "is-now" : "";
              return (
                <li key={t.key} className={`office__todo ${state}`}>
                  <span className="office__rail" aria-hidden="true">
                    {t.done ? <Check size={14} weight="bold" /> : null}
                  </span>
                  <button
                    type="button"
                    className="office__todo-card"
                    aria-current={state === "is-now" ? "step" : undefined}
                    disabled={
                      !t.go ||
                      (sim.running &&
                        t.key !== "recruit" &&
                        t.key !== "pressed" &&
                        t.key !== "scout" &&
                        t.key !== "depth")
                    }
                    onClick={t.go}
                    title={t.sub}
                  >
                    <span className="office__todo-icon" aria-hidden="true">
                      <t.icon size={20} weight="bold" />
                    </span>
                    <span className="office__todo-text">
                      <b>{t.title}</b>
                    </span>
                    {t.meta && <span className="office__todo-meta">{t.meta}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ---------- right: the news ---------- */}
      <aside className="office__col office__right">
        <section className="office__panel" aria-label={m.news}>
          <h2 className="office__panel-title">{m.news}</h2>
          {office ? (
            news.length ? (
              <ul className="office__feed">
                {news.map((n, i) => (
                  <li key={`${n.week}-${n.kind}-${n.pid ?? i}`}>
                    <span className="office__when">
                      {n.week === s.current_week ? m.thisWeekWhen : weekName(n.week)}
                    </span>
                    <span>{newsLine(s, n, teams)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="office__soft">{m.noNews}</p>
            )
          ) : (
            <p className="office__soft">{officeError ? m.loadError(officeError) : m.loading}</p>
          )}
        </section>

        <section className="office__panel" aria-label={m.aroundThe(conf)}>
          <h2 className="office__panel-title">{m.aroundThe(conf)}</h2>
          {office ? (
            office.conference.games.length ? (
              <ul className="office__results">
                {office.conference.games.map((g) => {
                  const awayWon = g.away_score > g.home_score;
                  return (
                    <li key={`${g.away}-${g.home}`} className={g.mine ? "is-mine" : undefined}>
                      <TeamTag slug={g.away} name={g.away_name} teams={teams} won={awayWon} />
                      <b className="office__res-score">{m.score(g.away_score, g.home_score)}</b>
                      <TeamTag slug={g.home} name={g.home_name} teams={teams} won={!awayWon} />
                      {onBox && g.event_id ? (
                        <button
                          type="button"
                          className="office__when office__box"
                          title={m.boxScoreOf(g.away_name, g.home_name)}
                          onClick={() => onBox(g.event_id!)}
                        >
                          {g.overtime ? m.finalOt : m.final}
                        </button>
                      ) : (
                        <span className="office__when">{g.overtime ? m.finalOt : m.final}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="office__soft">{m.noScores}</p>
            )
          ) : (
            <p className="office__soft">{officeError ? m.loadError(officeError) : m.loading}</p>
          )}
        </section>
      </aside>
      <PlayGame
        open={playOpen}
        onClose={() => setPlayOpen(false)}
        seasonId={s.id}
        team={s.team}
        opponent={next?.opponent ?? null}
        teams={teams}
        week={next ? weekName(next.week) : ""}
        date={next ? kickoffText(next.date) : ""}
        onSim={thisWeek && !thisWeek.played ? () => sim.start("gameday") : undefined}
      />
    </div>
  );
}

/** One side of the matchup: swatch and short name ("CCU"; the full name on hover), its rank and record under them. */
function Side({ team, name, line }: { team: TeamCard | undefined; name: string; line: string }) {
  return (
    <div className="office__side" title={name}>
      <Swatch team={team} size={36} />
      <b className="office__side-name">{team?.abbreviation ?? name.split(" ")[0].slice(0, 6).toUpperCase()}</b>
      <span className="office__soft office__side-line">{line}</span>
    </div>
  );
}

/** The upcoming game: this week's (or, on a bye, the next), the final once it's played, and the Win Chance. */
function GameCard({
  s,
  thisWeek,
  next,
  teams,
  weekName,
  onBox,
  simming,
}: {
  s: SeasonSummary;
  onBox?: (eventId: string) => void;
  thisWeek: ScheduleGame | null;
  next: ScheduleGame | null;
  teams: Map<string, TeamCard>;
  weekName: (w: number) => string;
  /** a sim is running: the read on the next game waits for it, and says nothing meanwhile */
  simming?: boolean;
}) {
  const g = thisWeek ?? next;
  if (!g)
    return (
      <section className="office__game" aria-label={m.noGame}>
        <span className="label office__kicker">{m.noGame}</span>
        <p className="office__soft">{s.current_week + 1 > 14 ? m.postseasonText : m.noGameText}</p>
      </section>
    );
  const played = !!thisWeek?.played;
  // a sim running: the card is held as it was when the sim began, and says so (the player's ask)
  const kicker = simming ? m.simming : played ? m.final : thisWeek ? m.upcoming : m.nextGame;
  const when = [weekName(g.week), kickoffText(g.date)].filter(Boolean).join(" · ");
  const venue = g.venue === "away" ? m.away : g.venue === "neutral" ? m.neutral : m.home;
  const named = g.title ?? g.rivalry?.name ?? null;
  return (
    <section className="office__game" aria-label={kicker}>
      <header className="office__game-head">
        <span className="label office__kicker">{kicker}</span>
        <span className="office__chip">{venue}</span>
      </header>
      <span className="office__game-when">{when}</span>
      {named && <b className="office__game-name">{named}</b>}
      <div className="office__match">
        <Side
          team={teams.get(s.team)}
          name={s.team_name}
          line={m.sideLine(s.my_rank?.rank ?? null, recordText(s.record))}
        />
        {played ? (
          <span className={`office__final ${g.won ? "is-won" : "is-lost"}`}>
            <span className="office__result">{g.won ? m.won : m.lost}</span>
            <b>
              {m.score(g.points_for ?? 0, g.points_against ?? 0)}
              {g.overtime ? ` ${m.overtime(g.overtime)}` : ""}
            </b>
          </span>
        ) : (
          <span className="office__vs">{g.venue === "away" ? m.at : m.vs}</span>
        )}
        <Side
          team={g.opponent ? teams.get(g.opponent) : undefined}
          name={g.opponent_name}
          line={m.sideLine(g.opponent_rank, g.opponent_record ?? "")}
        />
      </div>
      {played && onBox && g.event_id && g.has_box !== false && (
        <button type="button" className="office__box office__box--game" onClick={() => onBox(g.event_id!)}>
          {m.boxScore}
        </button>
      )}
    </section>
  );
}

/** One action: an icon tile, its name and what it does; the first is filled in ink. */
function ActionTile({
  icon: I,
  title,
  sub,
  main,
  onClick,
  disabled,
  trail,
  ...rest
}: {
  icon: Icon;
  title: string;
  sub: string;
  main?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  trail?: ReactNode;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      className={`office__action${main ? " is-main" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={typeof sub === "string" ? sub : undefined}
      {...rest}
    >
      <span className="office__action-icon" aria-hidden="true">
        <I size={20} weight="fill" />
      </span>
      <span className="office__action-text">
        <b>{title}</b>
        {typeof sub !== "string" && sub ? <span className="office__action-sub">{sub}</span> : null}
      </span>
      <span className="office__action-trail" aria-hidden="true">
        {trail ?? <ArrowRight size={16} weight="bold" />}
      </span>
    </button>
  );
}

/** The ways the season moves on, as tiles; while a sim runs, its progress and Stop in their place. */
function Actions({
  s,
  sim,
  game,
  weekName,
  next,
  onPlay,
  onOffseason,
}: {
  s: SeasonSummary;
  sim: Sim;
  /** your game this week, while it's unplayed */
  game: ScheduleGame | null;
  weekName: (w: number) => string;
  /** your next game (this week's, or after a bye): the field's opponent */
  next: ScheduleGame | null;
  /** Play Game Day (or, any other week, Play It on the Field): the window that picks the sides */
  onPlay: () => void;
  /** the season is over: open the Offseason */
  onOffseason: () => void;
}) {
  const gameReady = game !== null;
  // Sim Through's list floats over the page (fixed, in a portal on <body>: the section's fade-in animation would
  // otherwise be what it's placed against), beside its tile
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const open = place !== null;
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const toggle = (button: HTMLElement) => {
    if (open) return setPlace(null);
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setPlace(
      below > 320
        ? { left: r.left, width: r.width, top: r.bottom + 8, maxHeight: below - 24 }
        : {
            left: r.left,
            width: r.width,
            bottom: window.innerHeight - r.top + 8,
            maxHeight: Math.min(440, r.top - 16),
          },
    );
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const away = (e: MouseEvent) =>
      !menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    // a scroll elsewhere moves the tile away from the list; the list's own scroll is fine, and so is the scroll that
    // brought the tile into view as it was clicked
    const opened = performance.now();
    const scrolled = (e: Event) =>
      performance.now() - opened > OPEN_SETTLE_MS && !menu.current?.contains(e.target as Node) && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);

  if (s.done)
    return (
      <section className="office__actions" aria-label={m.actions}>
        <h2 className="office__panel-title">{m.actions}</h2>
        <ActionTile icon={SkipForward} title={m.toOffseason} sub={m.offseasonSub} main onClick={onOffseason} />
      </section>
    );

  if (sim.status) {
    const st = sim.status;
    const pct = Math.round(100 * (st.progress ?? 0));
    return (
      <section className="office__actions" aria-label={m.actions}>
        <h2 className="office__panel-title">{m.actions}</h2>
        <div className="office__sim" role="status">
          <b className="office__sim-stage">{st.stage ?? m.simming}</b>
          {/* its line is always there (empty between stages), so the bar under it never moves */}
          <span className="office__soft office__sim-count">
            {st.games_total ? m.progress(st.games_done ?? 0, st.games_total) : NBSP}
          </span>
          <span className="office__sim-bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
          {st.total - st.done > 1 && (
            <button type="button" className="office__link" onClick={sim.stop} data-sim-allow>
              <StopCircle size={16} weight="bold" aria-hidden="true" />
              {m.stop}
            </button>
          )}
        </div>
      </section>
    );
  }

  const w = s.current_week + 1;
  const weeks: number[] = [];
  for (let k = w + 1; k <= FINAL_WEEK; k++) weeks.push(k);
  const go = (to: number) => {
    setPlace(null);
    sim.start("advance", to);
  };

  return (
    <section className="office__actions" aria-label={m.actions}>
      <h2 className="office__panel-title">{m.actions}</h2>
      {game && (
        <ActionTile
          icon={Play}
          title={m.playGame}
          sub={m.playGameSub(game.venue === "away" ? m.atOpp : m.vs, nameInLine(game.opponent_name, game.opponent))}
          main
          onClick={onPlay}
        />
      )}
      {!game && (
        <ActionTile
          icon={GameController}
          title={m.field}
          sub={next ? m.fieldSub(nameInLine(next.opponent_name, next.opponent)) : m.fieldAny}
          onClick={onPlay}
        />
      )}
      <ActionTile
        icon={Lightning}
        title={m.simWeek}
        sub={w < FINAL_WEEK ? m.simWeekSub(weekName(w + 1)) : m.simWeekLast}
        main={!gameReady}
        onClick={() => sim.start("advance")}
      />
      {s.current_week < SELECTION_WEEK && (
        <ActionTile
          icon={FastForward}
          title={m.selection}
          sub={weekName(SELECTION_WEEK)}
          onClick={() => sim.start("advance", SELECTION_WEEK)}
        />
      )}
      <ActionTile icon={Trophy} title={m.signing} sub={m.signingSub} onClick={() => sim.start("advance", FINAL_WEEK)} />
      {weeks.length > 0 && (
        <div ref={trigger}>
          <ActionTile
            icon={CalendarDots}
            title={m.simThrough}
            sub={m.simThroughSub}
            aria-haspopup="menu"
            aria-expanded={open}
            trail={<CaretRight size={16} weight="bold" />}
            onClick={(e) => toggle(e.currentTarget)}
          />
        </div>
      )}
      {open &&
        createPortal(
          <div className="office__menu-list" role="menu" style={place ?? undefined} ref={menu}>
            {weeks.map((k) => (
              <button key={k} type="button" role="menuitem" className="office__menu-item" onClick={() => go(k)}>
                <b>{weekName(k)}</b>
                <span className="office__soft">{dateText(s.week_dates[String(k)]?.main)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      {sim.error && <p className="office__error">{m.simError(sim.error)}</p>}
    </section>
  );
}

/** The season's over: your final record. */
function WrapCard({ s, teams }: { s: SeasonSummary; teams: Map<string, TeamCard> }) {
  return (
    <section className="office__game" aria-label={m.wrap}>
      <span className="label office__kicker">{m.final}</span>
      <Side
        team={teams.get(s.team)}
        name={s.team_name}
        line={m.sideLine(s.my_rank?.rank ?? null, recordText(s.record))}
      />
    </section>
  );
}

/** A team in a result line: its swatch and abbreviation (the name as its tooltip). */
function TeamTag({
  slug,
  name,
  teams,
  won,
}: {
  slug: string;
  name: string;
  teams: Map<string, TeamCard>;
  won: boolean;
}) {
  const t = teams.get(slug);
  return (
    <span className={`office__res-team${won ? " is-won" : ""}`} title={name}>
      <Swatch team={t} size={14} />
      {t?.abbreviation ?? name}
    </span>
  );
}

const Stars = ({ n }: { n: number }) => (
  <span className="office__stars" aria-label={`${n}-star`}>
    {Array.from({ length: n }, (_, k) => (
      <Star key={k} size={10} weight="fill" aria-hidden="true" />
    ))}
  </span>
);

/** One line of Program News (web/office.js newsLine). */
function newsLine(s: SeasonSummary, n: NewsItem, teams: Map<string, TeamCard>) {
  if (n.kind === "game") {
    const where = n.venue === "away" ? " on the road" : n.venue === "neutral" ? " at a neutral site" : "";
    return (
      <>
        <b>{s.team_name}</b> {n.won ? "beat" : "lost to"} {nameInLine(n.opponent_name ?? "", n.opponent)}{" "}
        <span className="office__nowrap">{m.score(n.points_for ?? 0, n.points_against ?? 0)}</span>
        {where}
        {n.overtime ? " in overtime" : ""}.
      </>
    );
  }
  if (n.kind === "ability" && n.line)
    return (
      <>
        <b>{n.name}</b> ({n.position}) {n.line.charAt(0).toLowerCase() + n.line.slice(1)}
      </>
    );
  // another school's answer to your recruiting: the game's own sentence, the school's mark before it
  if (n.kind === "rival_push" && n.line)
    return (
      <>
        <Swatch team={teams.get(n.school ?? "")} size={12} className="office__news-mark" /> <b>{n.name}</b> (
        {n.position}, <Stars n={n.stars ?? 0} />
        ): {n.line}
      </>
    );
  if (n.kind === "promise")
    return (
      <>
        <b>{n.name}</b> ({n.position}): "{n.line}"
      </>
    );
  const what =
    n.kind === "asked_more" && n.school === s.team
      ? `wants more NIL from you: ${n.rival_name || "a rival"} offered more.`
      : LINE_KINDS.has(n.kind) && n.line
        ? n.line.replace(/^He /, "")
        : n.kind === "unsigned"
          ? "went unsigned."
          : `${EVENT_WORDS[n.kind] ?? "is in the news with"} ${n.school_name ?? ""}`.trim() + ".";
  return (
    <>
      <b>{n.name}</b> ({n.position}, <Stars n={n.stars ?? 0} />) {what}
      {n.reason && <span className="office__soft"> {n.reason}</span>}
    </>
  );
}

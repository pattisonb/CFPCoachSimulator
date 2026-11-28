import { useEffect, useState, type CSSProperties } from "react";
import { Info, Trophy } from "@phosphor-icons/react";
import Panel from "../Panel/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import Wordmark from "../Wordmark/index.tsx";
import { api } from "../../api.ts";
import { inkOn } from "../../colors.ts";
import type { Bracket as Field, BracketSeed, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a played game's box score */
  onBox?: (eventId: string) => void;
}

/** A playoff game as the season's review reports it (GET /review → rounds[].games[], title_game). */
interface PlayoffGame {
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  home_score: number | null;
  away_score: number | null;
  played: boolean;
  winner: string | null;
  home_seed?: number | null;
  away_seed?: number | null;
  bowl?: string | null;
  event_id?: string;
  has_box?: boolean;
}
interface Review {
  rounds: { round: string; week: number; games: PlayoffGame[] }[];
  title_game: PlayoffGame | null;
}

/** One line of a matchup: a seeded team (with its score once played), or who it is waiting on. */
interface Side {
  seed?: number;
  team?: string;
  name: string;
  score?: number | null;
  won?: boolean;
  /** not a team yet: "Winner of 5 vs 12" */
  pending?: boolean;
}
interface Match {
  key: string;
  top: Side;
  bottom: Side;
  /** the bowl that hosts it, when the game is set */
  note?: string | null;
  /** the played game's id when it has a box score to open */
  box?: string | null;
}

/** a name as the review writes it carries its seed ("(1) Texas"): the slot has the seed in its own box */
const bare = (name: string) => name.replace(/^\(\d+\)\s*/, "");
const sideOf = (s: BracketSeed): Side => ({ seed: s.seed, team: s.team, name: s.name });
const waiting = (text: string): Side => ({ name: text, pending: true });
const boxOf = (g?: PlayoffGame) => (g?.played && g.has_box && g.event_id ? g.event_id : null);

/**
 * The Bracket: the 12-team playoff, round by round. Before selection day it is a projection: the field as it would be
 * seeded today, from the committee's ranking once it ranks (Week 10) and from the AP poll before that, with each
 * conference's leader as its champion. After selection day it is the real bracket, filling in with each round's
 * scores. Under it, on the same screen: the field with how each team got in, and the first four out. A projection
 * says so with one mark in the bar's corner, its why in the mark's tip.
 */
export default function Bracket({ season, teams, onBox }: Props) {
  const real = season.bracket?.seeds?.length ? season.bracket : null;
  const field: Field | null = real ?? season.bracket_projection ?? null;
  const [review, setReview] = useState<Review | null>(null);

  // the real bracket's scores, round by round
  useEffect(() => {
    if (!real) return;
    let live = true;
    api<Review>(`/api/season/${season.id}/review`)
      .then((v) => live && setReview(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [real, season.id, season.current_week]);

  const weekName = (w: number) => (w === 0 ? m.preseason : (season.week_labels[String(w)] ?? m.week(w)));
  const status = !field ? null : real ? (
    <SectionStatus>{season.champion_name ? m.final : m.set}</SectionStatus>
  ) : (
    <Tooltip
      title={m.projected(field.source === "ap" ? m.apPoll : m.cfpRanking, weekName(field.week ?? 0))}
      text={field.source === "ap" ? m.apTip : m.cfpTip}
    >
      <span className="bracket__info" role="img" aria-label={m.projectedLabel}>
        <Info size={20} weight="bold" aria-hidden="true" />
      </span>
    </Tooltip>
  );

  if (!field)
    return (
      <div className="section-tabs__wrap">
        <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} />
        <p className="bracket__soft bracket__note">{m.none}</p>
      </div>
    );

  // a played game from the review, found by the two teams in it
  const played = (round: string, a?: string, b?: string) =>
    review?.rounds
      .find((r) => r.round.toLowerCase().startsWith(round))
      ?.games.find((g) => (!a || g.home === a || g.away === a) && (!b || g.home === b || g.away === b));
  const scored = (s: Side, g?: PlayoffGame): Side =>
    g?.played && s.team
      ? { ...s, score: g.home === s.team ? g.home_score : g.away_score, won: g.winner === s.team }
      : s;
  const winnerOf = (g: PlayoffGame | undefined, fallback: Side): Side => {
    if (!g?.played || !g.winner) return fallback;
    const home = g.winner === g.home;
    return {
      team: g.winner,
      name: bare(home ? g.home_name : g.away_name),
      seed: (home ? g.home_seed : g.away_seed) ?? undefined,
    };
  };

  // first round, in the order of the quarterfinals they feed (the engine's pairing: "5 vs 12" meets the 1 seed…)
  const first: Match[] = field.quarterfinals.map((q) => {
    const fr =
      field.first_round.find((g) => `${g.home.seed} vs ${g.away.seed}` === q.winner_of) ?? field.first_round[0];
    const g = played("first", fr.home.team, fr.away.team);
    return {
      key: q.winner_of,
      top: scored(sideOf(fr.home), g),
      bottom: scored(sideOf(fr.away), g),
      note: g?.bowl,
      box: boxOf(g),
    };
  });
  const quarters: Match[] = field.quarterfinals.map((q, i) => {
    const frGame = played("first", first[i].top.team, first[i].bottom.team);
    const g = played("quarter", q.bye.team);
    const foe = winnerOf(frGame, waiting(m.winnerOf(q.winner_of)));
    return {
      key: `q${q.bye.seed}`,
      top: scored(sideOf(q.bye), g),
      bottom: scored(foe, g),
      note: g?.bowl,
      box: boxOf(g),
    };
  });
  const quarterGames = field.quarterfinals.map((q) => played("quarter", q.bye.team));
  const semis: Match[] = [0, 1].map((k) => {
    const a = winnerOf(quarterGames[2 * k], waiting(m.quarterWinner));
    const b = winnerOf(quarterGames[2 * k + 1], waiting(m.quarterWinner));
    const g = a.team && b.team ? played("semi", a.team, b.team) : undefined;
    return { key: `s${k}`, top: scored(a, g), bottom: scored(b, g), note: g?.bowl, box: boxOf(g) };
  });
  const semiGames = semis.map((s) =>
    s.top.team && s.bottom.team ? played("semi", s.top.team, s.bottom.team) : undefined,
  );
  const title = review?.title_game ?? undefined;
  const finalA = winnerOf(semiGames[0], waiting(m.semiWinner));
  const finalB = winnerOf(semiGames[1], waiting(m.semiWinner));
  const final: Match = { key: "final", top: scored(finalA, title), bottom: scored(finalB, title), box: boxOf(title) };

  // each round with how its games reach the next: one to one (a first-round winner meets a seed), or two into one
  const rounds: [string, Match[], "straight" | "pairs" | "end"][] = [
    [m.rounds.first, first, "straight"],
    [m.rounds.quarters, quarters, "pairs"],
    [m.rounds.semis, semis, "pairs"],
    [m.rounds.final, [final], "end"],
  ];
  const champSlug = title?.played ? title.winner : null;
  const champ = champSlug ? teams.get(champSlug) : undefined;

  return (
    <div className="section-tabs__wrap">
      <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} aside={status} />
      <div className="bracket">
        {season.champion_name && (
          <div
            className="bracket__champ"
            style={
              champ && ({ "--team": champ.colors.primary, "--team-on": inkOn(champ.colors.primary) } as CSSProperties)
            }
          >
            <Trophy size={30} weight="fill" aria-hidden="true" />
            <span className="bracket__champ-text">
              <span className="label">{m.championKicker}</span>
              <b>{bare(season.champion_name)}</b>
            </span>
            {title?.played && <TitleGame g={title} teams={teams} />}
          </div>
        )}
        <div className="bracket__cols">
          <div className="bracket__tree" role="group" aria-label={m.title}>
            {rounds.map(([name, games, link]) => (
              <section key={name} className={`bracket__round bracket__round--${link}`} aria-label={name}>
                <h2 className="label bracket__round-name">{name}</h2>
                <div className="bracket__games" style={{ "--n": games.length } as CSSProperties}>
                  {games.map((g) => (
                    <div key={g.key} className="bracket__cell">
                      <Game g={g} teams={teams} me={season.team} onBox={onBox} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="bracket__side">
            <Panel title={m.field} aside={m.fieldNote}>
              <ol className="bracket__field">
                {field.seeds.map((s) => (
                  <li key={s.team} className={s.team === season.team ? "is-mine" : undefined}>
                    <span className={`bracket__seed${s.bye ? " is-bye" : ""}`} title={s.bye ? m.byeTip : undefined}>
                      {s.seed}
                    </span>
                    <span className="plate-fit">
                      <TeamPlate team={teams.get(s.team)}>{s.name}</TeamPlate>
                    </span>
                    <span className="bracket__soft bracket__bid">{m.bid(s.bid)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
            {field.first_four_out.length > 0 && (
              <Panel title={m.firstFourOut}>
                <ol className="bracket__field">
                  {field.first_four_out.map((s) => (
                    <li key={s.team} className={s.team === season.team ? "is-mine" : undefined}>
                      <span className="bracket__seed is-out">{s.rank ?? m.dash}</span>
                      <span className="plate-fit">
                        <TeamPlate team={teams.get(s.team)}>{s.name}</TeamPlate>
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A matchup's card: the bowl over its two lines; a played game with a box score is a button that opens it. */
function Game({
  g,
  teams,
  me,
  onBox,
}: {
  g: Match;
  teams: Map<string, TeamCard>;
  me: string;
  onBox?: (eventId: string) => void;
}) {
  const body = (
    <>
      {g.note && <span className="bracket__bowl">{g.note}</span>}
      <Line s={g.top} teams={teams} me={me} />
      <Line s={g.bottom} teams={teams} me={me} />
    </>
  );
  const box = onBox && g.box;
  return box ? (
    <button
      type="button"
      className="bracket__game is-link"
      title={m.boxScore(bare(g.top.name), bare(g.bottom.name))}
      onClick={() => onBox(box)}
    >
      {body}
    </button>
  ) : (
    <div className="bracket__game">{body}</div>
  );
}

/**
 * The title game on the champion's band: the winner's letters in its colors, the score, the loser's letters in its
 * colors. A side whose team the page does not know (no card) falls back to the score and the loser's name.
 */
function TitleGame({ g, teams }: { g: PlayoffGame; teams: Map<string, TeamCard> }) {
  const homeWon = g.winner === g.home;
  const won = { team: teams.get(homeWon ? g.home : g.away), score: (homeWon ? g.home_score : g.away_score) ?? 0 };
  const lost = {
    team: teams.get(homeWon ? g.away : g.home),
    score: (homeWon ? g.away_score : g.home_score) ?? 0,
    name: bare(homeWon ? g.away_name : g.home_name),
  };
  if (!won.team || !lost.team)
    return <span className="bracket__champ-game">{m.titleScore(won.score, lost.score, lost.name)}</span>;
  return (
    <span className="bracket__champ-game" aria-label={m.titleScore(won.score, lost.score, lost.name)}>
      <Wordmark team={won.team} framed />
      <b>{won.score}</b>
      <i aria-hidden="true">{m.dash}</i>
      <b className="is-lost">{lost.score}</b>
      <Wordmark team={lost.team} framed />
    </span>
  );
}

/** One team in a matchup: its seed, colors and name, and its score once the game is played. */
function Line({ s, teams, me }: { s: Side; teams: Map<string, TeamCard>; me: string }) {
  if (s.pending)
    return (
      <div className="bracket__line is-pending">
        <span className="bracket__seed is-out" />
        <span className="bracket__team">{s.name}</span>
      </div>
    );
  return (
    <div
      className={`bracket__line${s.won ? " is-won" : ""}${s.won === false ? " is-lost" : ""}${s.team === me ? " is-mine" : ""}`}
    >
      <span className="bracket__seed">{s.seed ?? ""}</span>
      <span className="bracket__grow plate-fit">
        <TeamPlate team={s.team ? teams.get(s.team) : undefined} size="sm">
          {bare(s.name)}
        </TeamPlate>
      </span>
      {s.score != null && <b className="bracket__score">{s.score}</b>}
    </div>
  );
}

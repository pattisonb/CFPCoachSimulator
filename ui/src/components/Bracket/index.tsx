import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import Panel from "../Panel/index.tsx";
import SectionTabs, { SampleNote, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import type { Bracket as Field, BracketSeed, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
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
}

const sideOf = (s: BracketSeed): Side => ({ seed: s.seed, team: s.team, name: s.name });
const waiting = (text: string): Side => ({ name: text, pending: true });

/**
 * The Bracket: the 12-team playoff, round by round. Before selection day it is a projection: the field as it would be
 * seeded today, from the committee's ranking once it ranks (Week 10) and from the AP poll before that, with each
 * conference's leader as its champion. After selection day it is the real bracket, filling in with each round's
 * scores. Beside it: the field with how each team got in, and the first four out.
 */
export default function Bracket({ season, teams }: Props) {
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
    <SectionStatus sample tip={field.source === "ap" ? m.apTip : m.cfpTip}>
      {m.projected(field.source === "ap" ? m.apPoll : m.cfpRanking, weekName(field.week ?? 0))}
    </SectionStatus>
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
      name: home ? g.home_name : g.away_name,
      seed: (home ? g.home_seed : g.away_seed) ?? undefined,
    };
  };

  // first round, in the order of the quarterfinals they feed (the engine's pairing: "5 vs 12" meets the 1 seed…)
  const first: Match[] = field.quarterfinals.map((q) => {
    const fr =
      field.first_round.find((g) => `${g.home.seed} vs ${g.away.seed}` === q.winner_of) ?? field.first_round[0];
    const g = played("first", fr.home.team, fr.away.team);
    return { key: q.winner_of, top: scored(sideOf(fr.home), g), bottom: scored(sideOf(fr.away), g), note: g?.bowl };
  });
  const quarters: Match[] = field.quarterfinals.map((q, i) => {
    const frGame = played("first", first[i].top.team, first[i].bottom.team);
    const g = played("quarter", q.bye.team);
    const foe = winnerOf(frGame, waiting(m.winnerOf(q.winner_of)));
    return { key: `q${q.bye.seed}`, top: scored(sideOf(q.bye), g), bottom: scored(foe, g), note: g?.bowl };
  });
  const quarterGames = field.quarterfinals.map((q) => played("quarter", q.bye.team));
  const semis: Match[] = [0, 1].map((k) => {
    const a = winnerOf(quarterGames[2 * k], waiting(m.quarterWinner));
    const b = winnerOf(quarterGames[2 * k + 1], waiting(m.quarterWinner));
    const g = a.team && b.team ? played("semi", a.team, b.team) : undefined;
    return { key: `s${k}`, top: scored(a, g), bottom: scored(b, g), note: g?.bowl };
  });
  const semiGames = semis.map((s) =>
    s.top.team && s.bottom.team ? played("semi", s.top.team, s.bottom.team) : undefined,
  );
  const title = review?.title_game ?? undefined;
  const finalA = winnerOf(semiGames[0], waiting(m.semiWinner));
  const finalB = winnerOf(semiGames[1], waiting(m.semiWinner));
  const final: Match = { key: "final", top: scored(finalA, title), bottom: scored(finalB, title) };

  const mine = field.seeds.find((s) => s.team === season.team);
  const justOut = field.first_four_out.find((s) => s.team === season.team);
  const standing = mine
    ? (real ? m.youIn : m.youInProjected)(season.team_name, mine.seed)
    : justOut
      ? m.youJustOut(season.team_name)
      : (real ? m.youOut : m.youOutProjected)(season.team_name);

  const rounds: [string, Match[]][] = [
    [m.rounds.first, first],
    [m.rounds.quarters, quarters],
    [m.rounds.semis, semis],
    [m.rounds.final, [final]],
  ];

  return (
    <div className="section-tabs__wrap">
      <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} aside={status} />
      <div className="bracket">
        {!real && <SampleNote>{field.source === "ap" ? m.apTip : m.cfpTip}</SampleNote>}
        <p className="bracket__standing">
          {season.champion_name ? (
            <>
              <Trophy size={18} weight="fill" aria-hidden="true" /> {m.champion(season.champion_name)}
            </>
          ) : (
            standing
          )}
        </p>
        <div className="bracket__cols">
          <div className="bracket__tree" role="group" aria-label={m.title}>
            {rounds.map(([name, games]) => (
              <section key={name} className="bracket__round" aria-label={name}>
                <h2 className="label bracket__round-name">{name}</h2>
                <div className="bracket__games">
                  {games.map((g) => (
                    <div key={g.key} className="bracket__game">
                      <Line s={g.top} teams={teams} me={season.team} />
                      <Line s={g.bottom} teams={teams} me={season.team} />
                      {g.note && <span className="bracket__bowl">{g.note}</span>}
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
                    <span className={`bracket__seed${s.bye ? " is-bye" : ""}`}>{s.seed}</span>
                    <Swatch team={teams.get(s.team)} size={14} />
                    <span className="bracket__grow">
                      <b>{s.name}</b>
                      <span className="bracket__soft">{m.bid(s.bid)}</span>
                    </span>
                    {s.bye && (
                      <Tooltip title={m.bye} text={m.byeTip}>
                        <span className="bracket__tag">{m.bye}</span>
                      </Tooltip>
                    )}
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
                      <Swatch team={teams.get(s.team)} size={14} />
                      <span className="bracket__grow">
                        <b>{s.name}</b>
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

/** One team in a matchup: its seed, colors and name, and its score once the game is played. */
function Line({ s, teams, me }: { s: Side; teams: Map<string, TeamCard>; me: string }) {
  if (s.pending)
    return (
      <div className="bracket__line is-pending">
        <span className="bracket__seed is-out" />
        <span className="bracket__grow">{s.name}</span>
      </div>
    );
  return (
    <div
      className={`bracket__line${s.won ? " is-won" : ""}${s.won === false ? " is-lost" : ""}${s.team === me ? " is-mine" : ""}`}
    >
      <span className="bracket__seed">{s.seed ?? ""}</span>
      <Swatch team={s.team ? teams.get(s.team) : undefined} size={14} />
      <span className="bracket__grow">{s.name}</span>
      {s.score != null && <b className="bracket__score">{s.score}</b>}
    </div>
  );
}

import type { SimResult } from "../../types.ts";
import FitText from "../FitText/index.tsx";
import "./index.css";
import { messages as m } from "./messages.ts";

/** *tune* How many of your results the board carries: a whole season's, so a chip never leaves once it is on. */
const RESULTS = 18;

interface Props {
  /** the week the sim is on ("Week 9", "Champ Week") */
  week: string;
  record: { wins: number; losses: number; conf_wins: number; conf_losses: number };
  /** your conference's short name, and where you stand in it ("5th of 7"); null for an independent */
  conference: string;
  place: string | null;
  /** your ranking ("#12"), or null when unranked */
  rank: string | null;
  /** your games so far, oldest first */
  results: SimResult[];
}

/**
 * The Office while a sim runs: one big board in place of the game card, the actions and the to-dos (the player's
 * ask). Only what the sim sends with its own progress, so it keeps up with the weeks: the week it is on, your record,
 * where you stand, and your results.
 *
 * Nothing on it moves while the weeks pass (the player's report: the sim was jumpy): the week's name is always one
 * line in a box of one height (a long one, "Championship Week", is set smaller: FitText), the results keep their room
 * whether there are none or a season's, and each result stays where it first appeared, the next one after it.
 */
export default function SimBoard({ week, record, conference, place, rank, results }: Props) {
  const last = results.slice(-RESULTS);
  return (
    <section className="sim-board" aria-label={m.label} aria-live="off">
      <p className="sim-board__kicker label">{m.kicker}</p>
      <h1 className="sim-board__week">
        <FitText min={0.4}>{week}</FitText>
      </h1>
      <dl className="sim-board__stats">
        <div>
          <dt className="label">{m.record}</dt>
          <dd>{m.winsLosses(record.wins, record.losses)}</dd>
        </div>
        <div>
          <dt className="label">{conference}</dt>
          <dd>
            {m.winsLosses(record.conf_wins, record.conf_losses)}
            {place && <small>{place}</small>}
          </dd>
        </div>
        <div>
          <dt className="label">{m.rank}</dt>
          <dd>{rank ?? m.unranked}</dd>
        </div>
      </dl>
      <h2 className="sim-board__title label">{m.results}</h2>
      {last.length ? (
        <ol className="sim-board__results">
          {last.map((r) => (
            <li key={r.week} className={r.won ? "is-won" : "is-lost"}>
              <b className="sim-board__wl">{r.won ? m.win : m.loss}</b>
              <span className="sim-board__score">
                {m.score(r.points_for, r.points_against)}
                {r.overtime > 0 && <small>{m.ot(r.overtime)}</small>}
              </span>
              <span className="sim-board__opp">
                {m.venue[r.venue ?? "neutral"]} {r.opponent_name}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sim-board__none">{m.none}</p>
      )}
    </section>
  );
}

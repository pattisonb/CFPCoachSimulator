import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Chip from "../Chip/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import { Scoreboard, Scoring } from "../BoxScore/index.tsx";
import { inkOn } from "../../colors.ts";
import { isSnap, momentsOf, quarterName, type GameBox, type Moment, type SideKey } from "../../gamelog.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  box: GameBox;
  teams: Map<string, TeamCard>;
  /** your team's slug */
  mine: string;
  /** the last play has been shown (or skipped past): the result is out, so the page behind may show it */
  onFinal: () => void;
  /** open the full box score in this game's place */
  onBox: () => void;
}

type Speed = "slow" | "normal" | "fast";
/** *tune* How long each play stays up, in ms, at each speed. */
const PACE: Record<Speed, number> = { slow: 1600, normal: 900, fast: 320 };
const SPEEDS: Speed[] = ["slow", "normal", "fast"];
/** The browser remembers your speed (the old UI's own key, so both agree). */
const SPEED_KEY = "cfp.gameday.speed";
const savedSpeed = (): Speed => {
  try {
    const v = localStorage.getItem(SPEED_KEY) as Speed | null;
    return v && SPEEDS.includes(v) ? v : "normal";
  } catch {
    return "normal";
  }
};

/** Across the field, as a percent from the left: the home team drives left to right, the away team right to left. */
const across = (side: SideKey, yl: number) => Math.max(0, Math.min(100, side === "home" ? yl : 100 - yl));

/** Where the ball, the first-down line and the last play's gain sit after a moment (given the one that follows). */
function fieldOf(cur: Moment | undefined, next: Moment | undefined) {
  if (!cur) return null;
  let spot: number | null = null;
  let side = cur.off;
  let line: number | null = null;
  const from = isSnap(cur.kind) && cur.to != null ? (cur.yl ?? null) : null;
  if (isSnap(cur.kind) && cur.to != null) spot = cur.to;
  else if ((cur.kind === "kickoff" || cur.kind === "punt") && cur.to != null) spot = cur.to;
  else if (cur.kind === "field_goal" && cur.yl != null) spot = cur.yl;
  // the next snap of the same drive says where the ball is spotted and where the sticks are
  if (next && next.drive === cur.drive && isSnap(next.kind) && next.yl != null) {
    spot = next.yl;
    side = next.off;
    if (next.dist != null) line = Math.min(100, next.yl + next.dist);
  }
  if (spot == null) return null;
  const gain =
    from != null && cur.to != null && from !== cur.to
      ? {
          left: Math.min(across(cur.off, from), across(cur.off, cur.to)),
          width: Math.abs(across(cur.off, cur.to) - across(cur.off, from)),
          loss: cur.to < from,
        }
      : null;
  return { ball: across(side, spot), side, line: line != null && line < 100 ? across(side, line) : null, gain };
}

/**
 * Game Day: your game played back from its log, a play at a time. The scoreboard and clock move with it; the field
 * shows the ball, the line to gain and the last play; under it, the drive in progress (newest play first), the scoring
 * so far and the drives behind it. Slow, Normal or Fast; Skip to Final jumps to the box score.
 */
export default function GameDay({ box, teams, mine, onFinal, onBox }: Props) {
  const abbr = (s: SideKey) => teams.get(box[`${s}_slug`])?.abbreviation ?? box[s].name;
  const moments = useMemo(() => momentsOf(box, { home: abbr("home"), away: abbr("away") }), [box]);
  /** how many moments have been shown */
  const [i, setI] = useState(1);
  const [speed, setSpeed] = useState<Speed>(savedSpeed);
  const over = i >= moments.length;
  const cur = moments[Math.min(i, moments.length) - 1];
  const next = moments[i];

  useEffect(() => {
    if (over) return onFinal();
    const pace = PACE[speed];
    const delay = cur?.end ? pace * 0.6 : cur?.big ? pace * 2 : cur?.kind === "kickoff" ? pace * 0.8 : pace;
    const t = window.setTimeout(() => setI((n) => n + 1), delay);
    return () => window.clearTimeout(t);
  }, [i, speed, over]);

  const pickSpeed = (v: Speed) => {
    setSpeed(v);
    try {
      localStorage.setItem(SPEED_KEY, v);
    } catch {
      /* private mode: the speed lasts this game */
    }
  };

  const seen = moments.slice(0, i);
  const field = over ? null : fieldOf(cur, next);
  const drive = box.drives[cur?.drive ?? 0];
  const plays = seen.filter((x) => x.drive === cur?.drive && !x.end).reverse();
  const drives = seen.filter((x) => x.end).reverse();
  const scores = seen.filter((x) => x.score).length;
  const situation = over || cur?.end ? "" : cur?.situation || (next && next.drive === cur?.drive ? next.situation : "");
  const color = (s: SideKey) => teams.get(box[`${s}_slug`])?.colors.primary ?? "var(--ink)";
  const zone = (s: SideKey) => {
    const c = teams.get(box[`${s}_slug`])?.colors.primary;
    return { "--c": c ?? "var(--ink)", "--on": c ? inkOn(c) : "var(--paper-hi)" } as CSSProperties;
  };

  return (
    <div className="gameday">
      <Scoreboard
        box={box}
        teams={teams}
        mine={mine}
        score={over ? undefined : { home: cur?.home ?? 0, away: cur?.away ?? 0 }}
        status={
          over ? undefined : (
            <>
              <span className="gameday__live">{m.live}</span> {cur ? quarterName(cur.quarter) : m.kickoff}
              {cur?.clock ? ` · ${cur.clock}` : ""}
            </>
          )
        }
      />

      <div className="gameday__bar">
        <p className="gameday__situation" aria-live="polite">
          {over ? m.over : situation ? m.ball(situation, box[cur.off].name) : " "}
        </p>
        {over ? (
          <button type="button" className="gameday__skip is-on" onClick={onBox}>
            {m.boxScore}
          </button>
        ) : (
          <>
            <div className="gameday__speeds" role="group" aria-label={m.speedLabel}>
              {SPEEDS.map((v) => (
                <Chip key={v} on={speed === v} onClick={() => pickSpeed(v)}>
                  {m.speeds[v]}
                </Chip>
              ))}
            </div>
            <button type="button" className="gameday__skip" onClick={onBox}>
              {m.skip}
            </button>
          </>
        )}
      </div>

      {/* the field: an end zone in each team's color (home at the left), yard lines, the ball and the sticks */}
      <div className="gameday__field" aria-hidden="true">
        <span className="gameday__zone" style={zone("home")}>
          {abbr("home")}
        </span>
        <div className="gameday__grass">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
            <span key={y} className="gameday__yard" style={{ left: `${y}%` }}>
              <i>{y <= 50 ? y : 100 - y}</i>
            </span>
          ))}
          {field?.gain && (
            <span
              className={`gameday__gain${field.gain.loss ? " is-loss" : ""}`}
              style={{ left: `${field.gain.left}%`, width: `${field.gain.width}%` }}
            />
          )}
          {field?.line != null && <span className="gameday__sticks" style={{ left: `${field.line}%` }} />}
          {field && (
            <span
              className={`gameday__ball is-${field.side}`}
              style={{ left: `${field.ball}%`, "--c": color(field.side) } as CSSProperties}
            />
          )}
        </div>
        <span className="gameday__zone" style={zone("away")}>
          {abbr("away")}
        </span>
      </div>

      <div className="gameday__cols">
        <section className="gameday__panel gameday__panel--plays" aria-live="polite">
          <h3 className="label gameday__head">
            {drive ? m.drive((cur?.drive ?? 0) + 1, drive.offense_name) : m.plays}
          </h3>
          <ol className="gameday__plays">
            {plays.map((p, k) => (
              <li
                key={plays.length - k}
                className={`${p.big ? "is-big" : ""}${p.score ? " is-score" : ""}`}
                style={{ "--c": color(p.off) } as CSSProperties}
              >
                <span className="gameday__when">{[p.clock, p.situation].filter(Boolean).join(" · ")}</span>
                <span>
                  {p.text}
                  {p.score?.try && <span className="gameday__soft"> ({p.score.try})</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <div className="gameday__side">
          <section className="gameday__panel">
            <h3 className="label gameday__head">{m.scoring}</h3>
            {scores ? <Scoring box={box} color={color} upTo={scores} /> : <p className="gameday__soft">{m.noScore}</p>}
          </section>
          <section className="gameday__panel">
            <h3 className="label gameday__head">{m.drives}</h3>
            {drives.length ? (
              <ol className="gameday__drives">
                {drives.map((d) => (
                  <li key={d.drive}>
                    <TeamPlate team={teams.get(box[`${d.off}_slug`])} size="sm">
                      {box[d.off].name}
                    </TeamPlate>
                    <span className="gameday__soft">{d.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="gameday__soft">{m.noDrives}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

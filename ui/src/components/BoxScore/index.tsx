import { useState, type CSSProperties, type ReactNode } from "react";
import Chip from "../Chip/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import {
  clockOf,
  driveResult,
  fieldPos,
  quarterName,
  quarterShort,
  scoreKind,
  type BoxPlayer,
  type GameBox,
  type GameSide,
  type SideKey,
} from "../../gamelog.ts";
import type { TeamCard } from "../../types.ts";
import { titleCase } from "../../format.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  box: GameBox;
  teams: Map<string, TeamCard>;
  /** your team's slug: its side is marked */
  mine?: string;
  /** leave the scoreboard out (the window it sits in shows its own) */
  bare?: boolean;
  /** open a player's card (his name becomes a button); a team with no player cards, an FCS stand-in, is left as text */
  onPlayer?: (team: string, p: BoxPlayer) => void;
}

type Tab = "scoring" | "team" | "away" | "home" | "drives";
const SIDES: SideKey[] = ["away", "home"];

/**
 * A played game in full: the scoreboard with its line score, then Scoring (every score in order), Team Stats (the two
 * sides compared, the better number in bold), each team's players by what they did, and the Drives.
 */
export default function BoxScore({ box, teams, mine, bare, onPlayer }: Props) {
  const [tab, setTab] = useState<Tab>("scoring");
  const slug = (s: SideKey) => box[`${s}_slug`];
  const color = (s: SideKey) => teams.get(slug(s))?.colors.primary ?? "var(--ink)";
  const tabs: [Tab, string][] = [
    ["scoring", m.tabs.scoring],
    ["team", m.tabs.team],
    ["away", box.away.name],
    ["home", box.home.name],
    ["drives", m.tabs.drives],
  ];

  return (
    <div className="box">
      {!bare && <Scoreboard box={box} teams={teams} mine={mine} />}
      <div className="box__tabs" role="tablist" aria-label={m.tabsLabel}>
        {tabs.map(([k, label]) => (
          <Chip key={k} role="tab" on={tab === k} onClick={() => setTab(k)}>
            {label}
          </Chip>
        ))}
      </div>
      <div className="box__pane" role="tabpanel">
        {tab === "scoring" && <Scoring box={box} color={color} />}
        {tab === "team" && <TeamStats box={box} />}
        {(tab === "away" || tab === "home") && (
          <Players
            side={box[tab]}
            onPlayer={
              onPlayer && teams.get(slug(tab)) && !teams.get(slug(tab))?.fictional
                ? (p) => onPlayer(slug(tab), p)
                : undefined
            }
          />
        )}
        {tab === "drives" && <Drives box={box} color={color} />}
      </div>
    </div>
  );
}

/** The two teams with their scores, the winner's in ink, and the line score by quarter. */
export function Scoreboard({
  box,
  teams,
  mine,
  score,
  status,
}: Props & {
  /** a score to show in place of the final (a game in progress) */
  score?: Record<SideKey, number>;
  /** in place of "Final" */
  status?: ReactNode;
}) {
  const periods = Math.max(4, box.home.quarters.length + box.home.overtime.length);
  const cells = (s: GameSide) => [...s.quarters, ...s.overtime];
  const final = box.overtime_periods ? m.finalOt(box.overtime_periods) : m.final;
  return (
    <header className="box__board">
      {SIDES.map((s) => {
        const side = box[s];
        const slug = box[`${s}_slug`];
        const lost = !score && box.winner != null && box.winner !== s;
        return (
          <div key={s} className={`box__side box__side--${s}${lost ? " is-lost" : ""}`}>
            <span className="box__name">
              <span className="box__full plate-fit">
                <TeamPlate team={teams.get(slug)} size="lg">
                  {side.name}
                </TeamPlate>
              </span>
              {/* where the board is too narrow for two names (index.css): the team's letters */}
              <span className="box__short">
                <TeamPlate team={teams.get(slug)} size="lg" title={side.name}>
                  {teams.get(slug)?.abbreviation ?? side.name}
                </TeamPlate>
              </span>
              {box.overalls?.[s] != null && (
                <span className="box__ovr" title={m.overallTip}>
                  {m.overall(box.overalls[s]!)}
                </span>
              )}
              {slug === mine && <span className="box__you" aria-hidden="true" />}
            </span>
            <b className="box__score">{score ? score[s] : side.score}</b>
          </div>
        );
      })}
      <div className="box__mid">
        <span className="label box__status">{status ?? final}</span>
        {!score && (
          <table className="box__line" aria-label={m.lineScore}>
            <thead>
              <tr>
                <th />
                {Array.from({ length: periods }, (_, i) => (
                  <th key={i}>{i < 4 ? i + 1 : m.ot(i - 3)}</th>
                ))}
                <th>{m.total}</th>
              </tr>
            </thead>
            <tbody>
              {SIDES.map((s) => (
                <tr key={s}>
                  <th>{teams.get(box[`${s}_slug`])?.abbreviation ?? box[s].name}</th>
                  {Array.from({ length: periods }, (_, i) => (
                    <td key={i}>{cells(box[s])[i] ?? ""}</td>
                  ))}
                  <td>
                    <b>{box[s].score}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </header>
  );
}

/** Every score in order, under its quarter: when, what, who, and the score after it (away first). */
export function Scoring({
  box,
  color,
  upTo,
}: {
  box: GameBox;
  color: (s: SideKey) => string;
  /** show only the first so many (a game in progress), newest first */
  upTo?: number;
}) {
  const plays = upTo == null ? box.scoring_plays : box.scoring_plays.slice(0, upTo).reverse();
  if (!plays.length) return <p className="box__soft">{m.noScoring}</p>;
  return (
    <ol className="box__scoring">
      {plays.map((s, i) => (
        <li key={i} className={upTo == null && s.quarter !== plays[i - 1]?.quarter ? "is-first" : undefined}>
          {upTo == null && s.quarter !== plays[i - 1]?.quarter && (
            <h3 className="label box__quarter">{quarterName(s.quarter)}</h3>
          )}
          <span className="box__when">{upTo == null ? s.clock : `${quarterShort(s.quarter)} ${s.clock}`}</span>
          <span className="box__kind" style={{ "--c": color(s.team) } as CSSProperties}>
            {scoreKind(s.kind)}
          </span>
          <span className="box__desc">
            <b>{s.team_name}</b> {titleCase(s.description)}
            {s.try && <span className="box__soft"> ({titleCase(s.try)})</span>}
          </span>
          <span className="box__running">
            {s.away_score}–{s.home_score}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Better = "hi" | "lo" | null;

/** A side's totals, in the order the table shows them: label, value, and which way is better (for the bold). */
function totals(side: GameSide, box: GameBox, key: SideKey): [string, string | number, Better][] {
  const s = (k: string) => side.team_stats[k] ?? 0;
  const e = (k: string) => side.team_events?.[k] ?? 0;
  const lost = side.team_events?.fumbles_lost ?? s("Fumbles");
  const own = box.drives.filter((d) => d.offense === key && d.quarter <= 4);
  const plays = own.reduce((a, d) => a + d.plays, 0);
  const yards = s("Pass Yards") + s("Rush Yards");
  const pct = (n: number, d: number) => (d ? ` (${Math.round((100 * n) / d)}%)` : "");
  const per = (n: number, d: number) => (d ? (n / d).toFixed(1) : "–");
  const t = m.stats;
  return [
    [t.points, side.score, "hi"],
    [t.yards, yards, "hi"],
    [t.plays, plays, null],
    [t.perPlay, per(yards, plays), "hi"],
    [t.firstDowns, e("first_downs"), "hi"],
    [
      t.third,
      `${e("third_down_conversions")}/${e("third_downs")}${pct(e("third_down_conversions"), e("third_downs"))}`,
      null,
    ],
    [t.fourth, `${e("fourth_down_conversions")}/${e("fourth_down_attempts")}`, null],
    [t.redZone, m.redZoneLine(e("red_zone_scores"), e("red_zone_trips"), e("red_zone_touchdowns")), null],
    [t.possession, clockOf(own.reduce((a, d) => a + d.seconds, 0)), null],
    [t.passing, m.passLine(s("Completions"), s("Pass Attempts"), s("Pass Yards")), null],
    [t.passTdInt, `${s("Passing Touchdowns")} / ${s("Interceptions Thrown")}`, null],
    [t.rushing, m.rushLine(s("Carries"), s("Rush Yards")), null],
    [t.perCarry, per(s("Rush Yards"), s("Carries")), "hi"],
    [t.rushTd, s("Rushing Touchdowns"), "hi"],
    [t.fumbles, `${s("Fumbles")} / ${lost}`, null],
    [t.turnovers, s("Interceptions Thrown") + lost, "lo"],
    [t.penalties, `${e("penalties")} / ${e("penalty_yards")}`, null],
    [t.sacksTaken, s("Sacks Taken"), "lo"],
    [t.sacks, s("Sacks"), "hi"],
    [t.tackles, `${s("Solo Tackles")} + ${s("Assisted Tackles")}`, null],
    [t.takeaways, s("Interceptions") + s("Fumble Recoveries"), "hi"],
    [t.defTd, s("Defensive Touchdowns"), "hi"],
    [t.fieldGoals, `${s("Field Goals Made")}/${s("Field Goals Attempted")}`, null],
    [t.pats, `${s("PATs Made")}/${s("PATS Attempted")}`, null],
    [t.punts, `${s("Punts")} / ${per(s("Punt Yards"), s("Punts"))}`, null],
    [t.kickReturns, m.returns(s("Kickoff Returns"), s("Kickoff Return Yards"), s("Kickoff Return Touchdowns")), null],
    [t.puntReturns, m.returns(s("Punt Returns"), s("Punt Return Yards"), s("Punt Return Touchdowns")), null],
  ];
}

function TeamStats({ box }: { box: GameBox }) {
  const away = totals(box.away, box, "away");
  const home = totals(box.home, box, "home");
  return (
    <table className="box__compare">
      <thead>
        <tr>
          <th>{box.away.name}</th>
          <th />
          <th>{box.home.name}</th>
        </tr>
      </thead>
      <tbody>
        {away.map(([label, av, better], i) => {
          const hv = home[i][1];
          const a = Number(av);
          const h = Number(hv);
          const cmp = better && !Number.isNaN(a) && !Number.isNaN(h) && a !== h;
          const awayBetter = cmp && (better === "hi" ? a > h : a < h);
          return (
            <tr key={label}>
              <td className={awayBetter ? "is-better" : undefined}>{av}</td>
              <th scope="row">{label}</th>
              <td className={cmp && !awayBetter ? "is-better" : undefined}>{hv}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Col = [label: string, value: (p: BoxPlayer) => string | number, total?: (rows: BoxPlayer[]) => string | number];

/** One team's players, a table for each thing they did (passing, rushing… returns), best first, the team's totals last. */
function Players({ side, onPlayer }: { side: GameSide; onPlayer?: (p: BoxPlayer) => void }) {
  const st = (p: BoxPlayer, k: string) => p.stats[k] ?? 0;
  const has = (p: BoxPlayer, ...keys: string[]) => keys.some((k) => st(p, k));
  const sum = (k: string) => (rows: BoxPlayer[]) => rows.reduce((a, p) => a + st(p, k), 0);
  const avg = (num: string, den: string) => (p: BoxPlayer) => (st(p, den) ? (st(p, num) / st(p, den)).toFixed(1) : "–");
  const avgT = (num: string, den: string) => (rows: BoxPlayer[]) => {
    const d = sum(den)(rows);
    return d ? (sum(num)(rows) / d).toFixed(1) : "–";
  };
  const c = m.cols;
  const P = side.players ?? [];
  const groups: [string, BoxPlayer[], Col[], string][] = [
    [
      m.groups.passing,
      P.filter((p) => has(p, "pass_attempts")),
      [
        [
          c.catt,
          (p) => `${st(p, "completions")}/${st(p, "pass_attempts")}`,
          (r) => `${sum("completions")(r)}/${sum("pass_attempts")(r)}`,
        ],
        [
          c.pct,
          (p) => (st(p, "pass_attempts") ? Math.round((100 * st(p, "completions")) / st(p, "pass_attempts")) : "–"),
        ],
        [c.yds, (p) => st(p, "pass_yards"), sum("pass_yards")],
        [c.ya, avg("pass_yards", "pass_attempts"), avgT("pass_yards", "pass_attempts")],
        [c.td, (p) => st(p, "passing_touchdowns"), sum("passing_touchdowns")],
        [c.int, (p) => st(p, "interceptions_thrown"), sum("interceptions_thrown")],
        [c.sacked, (p) => st(p, "sacks_taken"), sum("sacks_taken")],
      ],
      "pass_yards",
    ],
    [
      m.groups.rushing,
      P.filter((p) => has(p, "carries")),
      [
        [c.car, (p) => st(p, "carries"), sum("carries")],
        [c.yds, (p) => st(p, "rush_yards"), sum("rush_yards")],
        [c.avg, avg("rush_yards", "carries"), avgT("rush_yards", "carries")],
        [c.td, (p) => st(p, "rushing_touchdowns"), sum("rushing_touchdowns")],
        [c.fum, (p) => st(p, "fumbles"), sum("fumbles")],
      ],
      "rush_yards",
    ],
    [
      m.groups.receiving,
      P.filter((p) => has(p, "targets", "receptions")),
      [
        [c.tgt, (p) => st(p, "targets"), sum("targets")],
        [c.rec, (p) => st(p, "receptions"), sum("receptions")],
        [c.yds, (p) => st(p, "receiving_yards"), sum("receiving_yards")],
        [c.avg, avg("receiving_yards", "receptions"), avgT("receiving_yards", "receptions")],
        [c.td, (p) => st(p, "receiving_touchdowns"), sum("receiving_touchdowns")],
      ],
      "receiving_yards",
    ],
    [
      m.groups.defense,
      P.filter(
        (p) =>
          p.unit === "defense" &&
          has(
            p,
            "solo_tackles",
            "assisted_tackles",
            "sacks",
            "interceptions",
            "forced_fumbles",
            "fumble_recoveries",
            "defensive_touchdowns",
          ),
      ),
      [
        [c.solo, (p) => st(p, "solo_tackles"), sum("solo_tackles")],
        [c.ast, (p) => st(p, "assisted_tackles"), sum("assisted_tackles")],
        [
          c.tot,
          (p) => st(p, "solo_tackles") + st(p, "assisted_tackles"),
          (r) => sum("solo_tackles")(r) + sum("assisted_tackles")(r),
        ],
        [c.sacks, (p) => st(p, "sacks"), sum("sacks")],
        [c.int, (p) => st(p, "interceptions"), sum("interceptions")],
        [c.intYds, (p) => st(p, "interception_return_yards"), sum("interception_return_yards")],
        [c.ff, (p) => st(p, "forced_fumbles"), sum("forced_fumbles")],
        [c.fr, (p) => st(p, "fumble_recoveries"), sum("fumble_recoveries")],
        [c.td, (p) => st(p, "defensive_touchdowns"), sum("defensive_touchdowns")],
      ],
      "solo_tackles",
    ],
    [
      m.groups.kicking,
      P.filter((p) => has(p, "fg_attempted", "pat_attempts")),
      [
        [c.fg, (p) => `${st(p, "fg_made")}/${st(p, "fg_attempted")}`],
        [c.pat, (p) => `${st(p, "pat_made")}/${st(p, "pat_attempts")}`],
        [c.pts, (p) => st(p, "fg_made") * 3 + st(p, "pat_made")],
      ],
      "fg_made",
    ],
    [
      m.groups.punting,
      P.filter((p) => has(p, "punts")),
      [
        [c.punts, (p) => st(p, "punts")],
        [c.yds, (p) => st(p, "punt_yards")],
        [c.avg, avg("punt_yards", "punts")],
      ],
      "punts",
    ],
    [
      m.groups.returns,
      P.filter((p) => has(p, "kickoff_returns", "punt_returns")),
      [
        [c.kr, (p) => st(p, "kickoff_returns")],
        [c.krYds, (p) => st(p, "kickoff_return_yards")],
        [c.pr, (p) => st(p, "punt_returns")],
        [c.prYds, (p) => st(p, "punt_return_yards")],
        [c.td, (p) => st(p, "kickoff_return_touchdowns") + st(p, "punt_return_touchdowns")],
      ],
      "kickoff_return_yards",
    ],
  ];
  const shown = groups.filter(([, rows]) => rows.length);
  if (!shown.length) return <p className="box__soft">{m.noPlayers}</p>;
  return (
    <div className="box__groups">
      {shown.map(([title, rows, cols, by]) => {
        const sorted = [...rows].sort((a, b) => st(b, by) - st(a, by));
        const hasTotals = cols.some((col) => col[2]);
        return (
          <section key={title} className="box__group">
            <h3 className="label box__quarter">{title}</h3>
            <table className="box__table">
              <thead>
                <tr>
                  <th>{m.player}</th>
                  {cols.map(([label]) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={`${p.name}-${p.position}`}>
                    <th scope="row">
                      {onPlayer ? (
                        <button
                          type="button"
                          className="box__player"
                          title={m.openCard(p.name)}
                          onClick={() => onPlayer(p)}
                        >
                          {p.name}
                        </button>
                      ) : (
                        p.name
                      )}{" "}
                      <span className="box__soft">{p.position}</span>
                      {p.injury && <span className="box__hurt">{m.injured(p.injury.type)}</span>}
                    </th>
                    {cols.map(([label, value]) => (
                      <td key={label}>{value(p)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {hasTotals && (
                <tfoot>
                  <tr>
                    <th scope="row">{m.team}</th>
                    {cols.map(([label, , total]) => (
                      <td key={label}>{total ? total(sorted) : ""}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** Every drive: who had it, where it started, how far it went and how it ended, with its stretch of the field drawn. */
function Drives({ box, color }: { box: GameBox; color: (s: SideKey) => string }) {
  if (!box.drives.length) return <p className="box__soft">{m.noDrives}</p>;
  const c = m.driveCols;
  return (
    <table className="box__table box__table--drives">
      <thead>
        <tr>
          {[c.n, c.quarter, c.offense, c.start, c.plays, c.yards, c.time, c.result, c.field].map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {box.drives.map((d, i) => {
          const yards = d.end_yardline - d.start_yardline;
          // drawn as the field lies: the home team drives left to right
          const at = (y: number) => (d.offense === "home" ? y : 100 - y);
          const left = Math.min(at(d.start_yardline), at(d.end_yardline));
          return (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{quarterShort(d.quarter).replace("Q", "")}</td>
              <th scope="row">{d.offense_name}</th>
              <td>{fieldPos(d.start_yardline)}</td>
              <td>{d.plays}</td>
              <td>{yards}</td>
              <td>{clockOf(d.seconds)}</td>
              <td
                className={
                  /touchdown|field goal/.test(d.result) && d.result !== "defensive_touchdown" ? "is-score" : undefined
                }
              >
                {driveResult(d.result)}
              </td>
              <td>
                <span className="box__bar" aria-hidden="true">
                  <i
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(1, Math.abs(yards))}%`,
                      background: color(d.offense),
                    }}
                  />
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

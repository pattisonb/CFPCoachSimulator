import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, CaretUp } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Panel from "../Panel/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a team's resume */
  onTeam?: (slug: string) => void;
}

/** One program (GET /programs → rows[], coach_career/programs.py): where it stands and what it is built on. */
interface Program {
  team: string;
  name: string;
  tier: number;
  tier_name: string;
  goal: string;
  rank: number;
  // the rating's own measures, 0 to 100
  prestige: number;
  winning: number;
  nil: number;
  market: number;
  conference: number;
  coach: number;
  pro: number;
  /** the pro pipeline by draft position */
  pro_groups?: Record<string, number>;
  /** the campus grades from the record; null for a program with none on file */
  grades?: Record<string, number> | null;
  tags?: { setting?: string; climate?: string; region?: string } | null;
  /** how far a grade moved this offseason */
  grades_moved?: Record<string, number> | null;
}
interface View {
  you: Program;
  rows: Program[];
  tiers: Record<string, string>;
  /** the eight grade words by floor, best first */
  words?: [string, number][];
  group_order?: string[];
}

type Key = keyof typeof m.measures;
/** The eight grade words by floor (coach_career/programs.py WORD_FLOORS; the game sends its own in `words`). */
const WORD_FLOORS: [string, number][] = [
  ["Elite", 90],
  ["Excellent", 80],
  ["Strong", 70],
  ["Good", 60],
  ["Solid", 50],
  ["Fair", 40],
  ["Thin", 30],
  ["Weak", 0],
];
/** This browser remembers whether Your Program is open. */
const OPEN_KEY = "cfp.programs.yours";
const savedOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};
/** *tune* A grade that moved this much or more since last season gets an arrow. */
const MOVED = 0.5;
/** The measures the campus record grades (in `grades`); the rest sit on the program itself. */
const CAMPUS: Key[] = ["academics", "facilities", "location", "stability", "game_day", "exposure"];
const GROUPS: [string, Key[]][] = [
  [m.football, ["prestige", "winning", "coach", "stability", "conference", "pro"]],
  [m.campus, ["academics", "facilities", "location", "game_day", "exposure", "nil"]],
];
const HEADLINE: Key[] = ["prestige", "market", "pro"];
const TABLE: Key[] = [
  "prestige",
  "winning",
  "nil",
  "market",
  "conference",
  "coach",
  "pro",
  "academics",
  "facilities",
  "location",
  "stability",
  "game_day",
  "exposure",
];
const PRO_ORDER = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P"];

/** A program's value on a measure, or null when the record has no grade for it. */
const gradeOf = (p: Program, k: Key): number | null =>
  CAMPUS.includes(k) ? (p.grades ? (p.grades[k] ?? null) : null) : ((p[k as keyof Program] as number) ?? 0);

/**
 * Programs: Your Program (its standing, its three headline readings, its twelve school grades as bars in words, the
 * positions it sends to the pros, and your AD's goal), then Every Program on the same measures. Every grade is one of
 * eight words (Elite to Weak), never a number; a grade that moved this offseason carries an arrow.
 */
export default function Programs({ season, teams, onTeam }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  /** Your Program open (its grades showing) or folded to its headline, which leaves the table the room */
  const [open, setOpen] = useState(savedOpen);
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        /* a private window: it lasts this visit */
      }
      return !v;
    });
  };

  useEffect(() => {
    let live = true;
    api<View>(`/api/season/${season.id}/programs`)
      .then((v) => live && setView(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id, season.current_week]);

  const floors = view?.words?.length ? view.words : WORD_FLOORS;
  const word = (v: number) => (floors.find(([, f]) => v >= f) ?? floors[floors.length - 1])[0];
  /** how strong a word is, for its ink: the top three in bold, the bottom three soft */
  const tone = (v: number) => (v >= 70 ? " is-high" : v < 50 ? " is-low" : "");
  const moved = (p: Program, k: Key) => {
    const d = p.grades_moved?.[k];
    if (d == null || Math.abs(d) < MOVED) return null;
    return (
      <span className="programs__moved" title={m.moved(d > 0, Math.round(Math.abs(d)))}>
        {d > 0 ? (
          <ArrowUp size={10} weight="bold" aria-hidden="true" />
        ) : (
          <ArrowDown size={10} weight="bold" aria-hidden="true" />
        )}
      </span>
    );
  };
  const grade = (p: Program, k: Key) => {
    const v = gradeOf(p, k);
    return v == null ? (
      <span className="programs__word is-low">{m.notGraded}</span>
    ) : (
      <span className={`programs__word${tone(v)}`}>
        {word(v)}
        {moved(p, k)}
      </span>
    );
  };

  const columns: Column<Program>[] = [
    {
      key: "team",
      label: m.cols.program,
      render: (p) => (
        <span className="programs__team">
          <Swatch team={teams.get(p.team)} size={16} />
          {onTeam ? (
            <button
              type="button"
              className="programs__link"
              title={m.openResume(p.name)}
              onClick={() => onTeam(p.team)}
            >
              {p.name}
            </button>
          ) : (
            p.name
          )}
        </span>
      ),
      sort: (p) => p.name,
    },
    {
      key: "tier",
      label: m.cols.standing,
      tip: m.tips.standing,
      render: (p) => <span className="programs__tag">{p.tier_name}</span>,
      sort: (p) => -p.rank,
    },
    ...TABLE.map(
      (k): Column<Program> => ({
        key: k,
        label: m.short[k] ?? m.measures[k],
        num: true,
        tip: m.tips[k],
        render: (p) => grade(p, k),
        sort: (p) => gradeOf(p, k) ?? -1,
      }),
    ),
  ];

  const you = view?.you;
  const job = season.job;
  const rows = view ? view.rows.filter((p) => tier == null || p.tier === tier) : [];
  const groups = you
    ? (view.group_order?.length ? view.group_order : PRO_ORDER)
        .map((g, i) => ({ g, v: you.pro_groups?.[g] ?? 0, i }))
        .sort((a, b) => b.v - a.v || a.i - b.i)
    : [];

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value="all"
        onChange={() => {}}
        tabs={[]}
        aside={you && <SectionStatus tip={m.tips.standing}>{m.yours(season.team_name, you.tier_name)}</SectionStatus>}
      />
      <div className="programs">
        {!view || !you ? (
          <p className="programs__soft">{error ? m.loadError(error) : m.loading}</p>
        ) : (
          <>
            <Panel
              title={m.yourProgram}
              className={`programs__yours${open ? "" : " is-folded"}`}
              aside={
                <span className="programs__head-tools">
                  <span className="programs__tag is-solid">{you.tier_name}</span>
                  <button type="button" className="programs__fold" aria-expanded={open} onClick={toggle}>
                    {open ? m.hide : m.show}
                    {open ? (
                      <CaretUp size={12} weight="bold" aria-hidden="true" />
                    ) : (
                      <CaretDown size={12} weight="bold" aria-hidden="true" />
                    )}
                  </button>
                </span>
              }
            >
              {/* the hero: who you are, and the three readings recruits ask about first */}
              <div className="programs__hero">
                <Swatch team={teams.get(you.team)} size={56} />
                <div className="programs__names">
                  <h2>{you.name}</h2>
                  <span className="programs__soft">{teams.get(you.team)?.conference ?? season.conference}</span>
                </div>
                <dl className="programs__stats">
                  {HEADLINE.map((k) => (
                    <div key={k}>
                      <dt className="label">{m.measures[k]}</dt>
                      <dd className={`programs__word${tone(gradeOf(you, k) ?? 0)}`}>{word(gradeOf(you, k) ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {open && (
                <>
                  <div className="programs__body">
                    <section className="programs__col">
                      <h3 className="label programs__kicker">
                        <Tooltip title={m.schoolGrades} text={m.schoolGradesTip}>
                          <span>{m.schoolGrades}</span>
                        </Tooltip>
                      </h3>
                      {GROUPS.map(([title, keys]) => (
                        <div key={title} className="programs__group">
                          <h4 className="label programs__group-name">{title}</h4>
                          <div className="programs__bars">
                            {keys.map((k) => {
                              const v = gradeOf(you, k);
                              const tags =
                                k === "location"
                                  ? [you.tags?.setting, you.tags?.climate, you.tags?.region].filter(Boolean)
                                  : [];
                              return (
                                <div key={k} className="programs__bar" title={m.tips[k]}>
                                  <span className="programs__label">{m.measures[k]}</span>
                                  <span className="programs__track" aria-hidden="true">
                                    <i style={{ width: `${v == null ? 0 : Math.max(2, Math.min(100, v))}%` }} />
                                  </span>
                                  {grade(you, k)}
                                  {tags.length > 0 && (
                                    <span className="programs__tags">
                                      {tags.map((t) => (
                                        <span key={t} className="programs__tag">
                                          {t}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </section>
                    <section className="programs__col">
                      <h3 className="label programs__kicker">
                        <Tooltip title={m.proPotential} text={m.proPotentialTip}>
                          <span>{m.proPotential}</span>
                        </Tooltip>
                      </h3>
                      <ul className="programs__pros">
                        {groups.map(({ g, v }) => (
                          <li key={g}>
                            <b>{g}</b>
                            <span className={`programs__word${tone(v)}`}>{word(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  <footer className="programs__job">
                    <span className="label programs__kicker">{m.adGoal}</span>
                    <b>{job?.goal ?? you.goal}</b>
                    {job && (
                      <span className="programs__tag">
                        {job.mood}
                        {job.ultimatum ? ` · ${m.ultimatum}` : ""}
                      </span>
                    )}
                  </footer>
                </>
              )}
            </Panel>

            <Panel title={m.everyProgram} aside={m.sortHint} className="programs__table">
              <div className="programs__bar-row" role="group" aria-label={m.tierLabel}>
                <Chip on={tier == null} onClick={() => setTier(null)}>
                  {m.allTiers}
                </Chip>
                {Object.entries(view.tiers).map(([k, name]) => (
                  <Chip
                    key={k}
                    on={tier === Number(k)}
                    count={view.rows.filter((p) => p.tier === Number(k)).length}
                    onClick={() => setTier(Number(k))}
                  >
                    {name}
                  </Chip>
                ))}
              </div>
              {/* its own box: it scrolls both ways from anywhere in it, the header and the names staying put */}
              <div className="programs__scroll" tabIndex={0} role="region" aria-label={m.everyProgram}>
                <DataTable
                  label={m.everyProgram}
                  columns={columns}
                  rows={rows}
                  rowKey={(p) => p.team}
                  mine={(p) => p.team === season.team}
                />
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

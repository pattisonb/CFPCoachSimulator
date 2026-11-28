import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, CaretUp } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Panel from "../Panel/index.tsx";
import SchoolGrade, { gradePlace } from "../SchoolGrade/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import { titleCase } from "../../format.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import ProgramStars from "../ProgramStars/index.tsx";
import StarPicker from "../ProgramStars/Picker.tsx";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a team's resume */
  onTeam?: (slug: string) => void;
}

/** One program (GET /programs → rows[], career_js/programs.js): where it stands and what it is built on. */
interface Program {
  team: string;
  name: string;
  tier: number;
  tier_name: string;
  /** its standing in stars, 0.5 to 5 by halves */
  stars: number;
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
  /** this season's grades as they stand this week, 0 to 100 (a career's) */
  contender?: number;
  recruiting?: number;
  /** how far each of this season's grades moved over the week just played */
  week_moved?: Record<string, number> | null;
  /** every grade as the page shows it, a letter (A+ to F) the game worked out: the measures, the campus grades, and
   *  the pro pipeline by draft position */
  letters?: Record<string, string | Record<string, string>>;
}
interface View {
  you: Program;
  rows: Program[];
  tiers: Record<string, string>;
  group_order?: string[];
}

type Key = keyof typeof m.measures;
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
/** The measures kept in `grades` (the record's, and the two about its players); the rest sit on the program itself. */
const CAMPUS: Key[] = [
  "academics",
  "facilities",
  "location",
  "stability",
  "game_day",
  "exposure",
  "development",
  "culture",
];
type GroupKey = keyof typeof m.groups;
/** Your Program's four columns: what moves every week first, then the program, its players and its campus. */
const GROUPS: [GroupKey, Key[]][] = [
  ["season", ["winning", "contender", "recruiting"]],
  ["program", ["prestige", "coach", "conference", "market", "pro"]],
  ["players", ["development", "culture", "stability", "academics", "nil"]],
  ["campus", ["facilities", "location", "game_day", "exposure"]],
];
/** This season's grades: an arrow says what the week did, not the offseason. */
const WEEKLY: Key[] = ["winning", "contender", "recruiting"];
const TABLE: Key[] = [
  "winning",
  "contender",
  "recruiting",
  "prestige",
  "nil",
  "market",
  "conference",
  "coach",
  "pro",
  "development",
  "culture",
  "stability",
  "academics",
  "facilities",
  "location",
  "game_day",
  "exposure",
];
const PRO_ORDER = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P"];

/** A program's value on a measure, or null when the record has no grade for it. */
const gradeOf = (p: Program, k: Key): number | null =>
  CAMPUS.includes(k)
    ? p.grades
      ? (p.grades[k] ?? null)
      : null
    : ((p[k as keyof Program] as number | undefined) ?? null);

/** A program's letter on a measure, as the game sent it (never worked out here); null when the record has none. */
const letterOf = (p: Program, k: string): string | null => {
  const v = p.letters?.[k];
  return typeof v === "string" ? v : null;
};
const proLetter = (p: Program, g: string): string | null => {
  const v = p.letters?.pro_groups;
  return v && typeof v === "object" ? (v[g] ?? null) : null;
};

/**
 * Programs: Your Program (its standing, its three headline readings, its twelve school grades as letters on a bar, the
 * positions it sends to the pros, and your AD's goal), then Every Program on the same measures. Every grade is a
 * letter, A+ to F (the game's own: career_js/grades.js), drawn as a patch in the program's colors, never a number; a
 * grade that moved this offseason carries an arrow.
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

  /** how far a grade moved, and since when: this season's over the week just played, the rest over the offseason */
  const moveOf = (p: Program, k: Key): { up: boolean; text: string } | null => {
    const weekly = WEEKLY.includes(k);
    const d = weekly ? p.week_moved?.[k] : p.grades_moved?.[k];
    if (d == null || Math.abs(d) < MOVED) return null;
    return { up: d > 0, text: weekly ? m.movedWeek(d > 0) : m.moved(d > 0, Math.round(Math.abs(d))) };
  };
  /** the arrow, in a slot of its own width whether or not the grade moved (so the patches stay in one column) */
  const moved = (p: Program, k: Key) => {
    const mv = moveOf(p, k);
    return (
      <span className={`programs__moved${mv ? (mv.up ? " is-up" : " is-down") : ""}`} aria-hidden="true">
        {mv &&
          (mv.up ? (
            <ArrowUp size={11} weight="bold" aria-hidden="true" />
          ) : (
            <ArrowDown size={11} weight="bold" aria-hidden="true" />
          ))}
      </span>
    );
  };
  /** a measure's tip: what it is, and what it just did */
  const tipOf = (p: Program, k: Key) => [m.tips[k], moveOf(p, k)?.text].filter(Boolean).join(" ");
  /** a grade as a patch: yours in your colors, another program's in its own (the player: "we lost team branding"
   *  when every row wore yours) */
  const grade = (p: Program, k: Key, size: "sm" | "md" = "md") => {
    const l = letterOf(p, k);
    return l == null ? (
      <span className="programs__word is-low">{m.notGraded}</span>
    ) : (
      <span className="programs__word">
        <SchoolGrade grade={l} size={size} colors={p.team === season.team ? undefined : teams.get(p.team)?.colors} />
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
          {onTeam ? (
            <button
              type="button"
              className="programs__link"
              title={m.openResume(p.name)}
              onClick={() => onTeam(p.team)}
            >
              <TeamPlate team={teams.get(p.team)} size="sm" title={m.openResume(p.name)}>
                {p.name}
              </TeamPlate>
            </button>
          ) : (
            <TeamPlate team={teams.get(p.team)} size="sm">
              {p.name}
            </TeamPlate>
          )}
        </span>
      ),
      sort: (p) => p.name,
    },
    {
      key: "tier",
      label: m.cols.standing,
      tip: m.tips.standing,
      render: (p) => <ProgramStars stars={p.stars} size={13} />,
      sort: (p) => -p.rank,
    },
    ...TABLE.map(
      (k): Column<Program> => ({
        key: k,
        label: m.short[k] ?? m.measures[k],
        num: true,
        tip: m.tips[k],
        render: (p) => grade(p, k, "sm"),
        sort: (p) => gradePlace(letterOf(p, k)) * 1000 + (gradeOf(p, k) ?? -1),
      }),
    ),
  ];

  const you = view?.you;
  const job = season.job;
  const rows = view ? view.rows.filter((p) => tier == null || p.stars === tier) : [];
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
                  <ProgramStars stars={you.stars} size={16} tip />
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
              {/* the hero: who you are and where you are, with what your AD wants of you this year */}
              <div className="programs__hero">
                <div className="programs__names">
                  <h2>
                    <TeamPlate team={teams.get(you.team)} size="lg">
                      {you.name}
                    </TeamPlate>
                  </h2>
                  <span className="programs__where">
                    <span className="programs__soft">{teams.get(you.team)?.conference ?? season.conference}</span>
                    {[you.tags?.setting, you.tags?.climate, you.tags?.region].filter(Boolean).map((t) => (
                      <span key={t} className="programs__tag">
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="programs__goal">
                  <span className="label programs__kicker">{m.adGoal}</span>
                  <b>{titleCase(job?.goal ?? you.goal)}</b>
                  {job && (
                    <span className="programs__tag is-solid">
                      {job.mood}
                      {job.ultimatum ? ` · ${m.ultimatum}` : ""}
                    </span>
                  )}
                </div>
              </div>

              {open && (
                <>
                  <h3 className="label programs__kicker programs__section">
                    <Tooltip title={m.schoolGrades} text={m.schoolGradesTip}>
                      <span>{m.schoolGrades}</span>
                    </Tooltip>
                  </h3>
                  {/* four columns of one height: every row is a name, a bar, a grade and an arrow's slot */}
                  <div className="programs__groups">
                    {GROUPS.map(([g, keys]) => (
                      <section key={g} className={`programs__group${g === "season" ? " is-live" : ""}`}>
                        <header className="programs__group-head">
                          <h4 className="label">{m.groups[g]}</h4>
                          <span className="programs__soft">{m.groupNotes[g]}</span>
                        </header>
                        <div className="programs__bars">
                          {keys.map((k) => {
                            const v = gradeOf(you, k);
                            return (
                              <Tooltip key={k} block title={m.measures[k]} text={tipOf(you, k)}>
                                <div className="programs__bar">
                                  <span className="programs__label">{m.measures[k]}</span>
                                  <span className="programs__track" aria-hidden="true">
                                    <i style={{ width: `${v == null ? 0 : Math.max(2, Math.min(100, v))}%` }} />
                                  </span>
                                  {grade(you, k)}
                                </div>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>

                  <h3 className="label programs__kicker programs__section">
                    <Tooltip title={m.proPotential} text={m.proPotentialTip}>
                      <span>{m.proPotential}</span>
                    </Tooltip>
                  </h3>
                  {/* one strip across the card: every position it sends to the pros, best first */}
                  <ul className="programs__pros">
                    {groups.map(({ g }) => (
                      <li key={g}>
                        <b>{g}</b>
                        <SchoolGrade grade={proLetter(you, g)} size="sm" />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel title={m.everyProgram} aside={m.sortHint} className="programs__table">
              <div className="programs__bar-row" role="group" aria-label={m.tierLabel}>
                {/* five empty stars: fill them to a level and the list is that level's programs; All empties them */}
                <Chip on={tier == null} onClick={() => setTier(null)}>
                  {m.allTiers}
                </Chip>
                <StarPicker
                  label={m.tierLabel}
                  value={tier}
                  onPick={setTier}
                  count={(s) => view.rows.filter((p) => p.stars === s).length}
                />
                {tier != null && <span className="programs__soft">{m.starCount(tier, rows.length)}</span>}
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

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Binoculars,
  BookOpen,
  Chat,
  CurrencyDollar,
  Flag,
  Handshake,
  House,
  type Icon,
  Lightning,
  Minus,
  Newspaper,
  PenNib,
  Plus,
  Phone,
  Scroll,
  Star,
  User,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { GradeRange, GradeScale } from "../Grade/index.tsx";
import Reaction from "../Reaction/index.tsx";
import SchoolGrade from "../SchoolGrade/index.tsx";
import Meter from "../Meter/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import Button from "../Button/index.tsx";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import RangeBar from "../RangeBar/index.tsx";
import Swatch from "../Swatch/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { inkOn } from "../../colors.ts";
import { cachedTeams } from "../../teams.ts";
import { PITCH_NAMES, standingOf } from "../../standing.ts";
import type { BoardRow, ListSchool, ProspectDetail, RecruitEvent } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

// A recruit's file, the four tabs of his panel on the board (web/recruiting.js overviewCards, scoutCards,
// profileCards, historyCards), on the same panels as a player's card. Overview: the Recruiting Battle, the Recruit
// Snapshot, the Scout's Summary. Scouting: the report and his ratings. Profile: who he is and his background.
// History: the timeline and who moved on his list. His offer, his ask and your chance are in the panel's head.

/** Looks in words: 1, 2½, ½. */
const fmtLooks = (n: number) => `${Math.floor(n) || (n % 1 ? "" : "0")}${n % 1 ? "½" : ""}`;
const looksOf = (r: BoardRow, d: ProspectDetail | null) => Math.min(3, d?.looks ?? r.looks ?? 0);
const teamOf = (slug: string | null | undefined) => cachedTeams()?.find((t) => t.slug === slug);
const teamName = (slug: string | null | undefined, fallback?: string | null) =>
  teamOf(slug)?.name ?? fallback ?? slug ?? m.aSchool;

/** The schools on his list that have a place in his race. */
const raceOf = (r: BoardRow) => r.list.filter((x) => x.bar != null);

// ---------- Overview ----------

/** A school's place in his race, in a word: the leader is the Favorite; then Contender, In the Mix, Long Shot. */
function battleWord(x: ListSchool, i: number, rows: ListSchool[], r: BoardRow, flip: Record<string, string>): string {
  const holder = r.signed || r.committed;
  if (holder) {
    if (x.school === holder) return r.signed ? m.words.signed : r.hard ? m.words.hard : m.words.committed;
    return r.signed ? m.words.missed : m.words.flip(flip[x.school] ?? m.words.none);
  }
  if (!x.offered) return m.words.noOffer;
  if (i === 0) return m.words.favorite;
  return (x.bar ?? 0) >= (rows[0].bar ?? 0) - 0.1
    ? m.words.contender
    : (x.bar ?? 0) >= 0.15
      ? m.words.mix
      : m.words.long;
}

/** A committed or signed recruit: where, and his chance to flip in a sentence. */
function CommitBanner({ r, d }: { r: BoardRow; d: ProspectDetail | null }) {
  const holder = r.signed || r.committed;
  if (!holder) return null;
  const school = teamName(holder, r.school_name);
  const leader = d?.flip?.rivals[0]?.name;
  const word = d?.flip?.word ?? "None";
  const sub = r.signed
    ? m.commit.signedSub
    : r.hard
      ? m.commit.hardSub
      : word === "None" || !leader
        ? m.commit.solid
        : word === "Slim"
          ? m.commit.slim(leader)
          : word === "Real"
            ? m.commit.real(leader)
            : m.commit.close(leader);
  const colors = teamOf(holder)?.colors;
  return (
    <div
      className="recruit-file__commit"
      title={sub}
      style={
        colors ? { background: colors.primary, color: inkOn(colors.primary), borderColor: colors.secondary } : undefined
      }
    >
      <b>{r.signed ? m.commit.signed(school) : r.hard ? m.commit.hard(school) : m.commit.verbal(school)}</b>
    </div>
  );
}

/** A report's verdict, then what he does well and what he has to work on. */
function Summary({ rep }: { rep: NonNullable<ProspectDetail["report"]> }) {
  const list = (title: string, items: string[], good: boolean) =>
    items.length > 0 && (
      <div className="recruit-file__marked">
        <h4 className="label">{title}</h4>
        <ul className={`recruit-file__marks ${good ? "is-good" : "is-work"}`}>
          {items.map((t) => (
            <li key={t}>
              <span className="recruit-file__mark" aria-hidden="true">
                {good ? <Plus size={10} weight="bold" /> : <Minus size={10} weight="bold" />}
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <>
      <div className="recruit-file__lists">
        {list(m.strengths, rep.strengths, true)}
        {list(m.develop, rep.develop, false)}
      </div>
      <p className="recruit-file__verdict">{rep.verdict}</p>
    </>
  );
}

/** Overview: the Recruiting Battle and the Recruit Snapshot, one under another (the scout's summary is on Scouting). */
export function OverviewTab({
  r,
  detail,
  team,
  weekLabels,
  wide,
}: {
  r: BoardRow;
  detail: ProspectDetail | null;
  team: string;
  weekLabels: Record<string, string>;
  /** his recruitment is over: the Overview has the whole width, the battle and the scout's summary side by side */
  wide?: boolean;
}) {
  const rows = raceOf(r);
  const flip = Object.fromEntries((detail?.flip?.rivals ?? []).map((x) => [x.school, x.word]));
  const holder = r.signed || r.committed;
  const sd = standingOf(r, team);
  const looks = looksOf(r, detail);
  const known = r.priorities_known;
  return (
    <Panels stack className={wide ? "recruit-file__pair" : undefined}>
      <Panel title={m.battle} aside={rows.length ? m.schools(rows.length) : undefined}>
        <CommitBanner r={r} d={detail} />
        {rows.length ? (
          <ol className="recruit-file__battle">
            {rows.slice(0, 8).map((x, i) => {
              const you = x.you || x.school === team;
              // a school answering your recruiting of him says so, on its own color
              const push = (r.rival_push ?? []).find((p) => p.school === x.school);
              const worn = push ? teamOf(x.school)?.colors.primary : undefined;
              return (
                <li key={x.school} className={you ? "is-you" : undefined}>
                  <span className="recruit-file__place">{x.rank ?? i + 1}</span>
                  <span className="recruit-file__school">
                    <Swatch team={teamOf(x.school)} size={16} />
                    <b>{x.name}</b>
                    {x.offered && <span className="recruit-file__tag">{m.offered}</span>}
                    {push && (
                      <span
                        className="recruit-file__tag is-rival"
                        style={worn ? ({ "--rw": worn, "--rw-on": inkOn(worn) } as CSSProperties) : undefined}
                      >
                        {push.pressing ? m.pressing : m.pushing}
                      </span>
                    )}
                    {x.visit && (
                      <span className="recruit-file__tag">
                        {x.visit.done
                          ? m.visited
                          : m.visit(weekLabels[String(x.visit.week)] ?? m.week(x.visit.week - 1))}
                      </span>
                    )}
                  </span>
                  {/* his pull, in the school's own color */}
                  <RangeBar
                    lo={0}
                    hi={Math.round(100 * (x.bar ?? 0))}
                    soft={!you}
                    color={teamOf(x.school)?.colors.primary}
                  />
                  <span className="recruit-file__word">{battleWord(x, i, rows, r, flip)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="recruit-file__soft">{holder ? m.raceOver : m.noList}</p>
        )}
      </Panel>

      {/* his recruitment is over: where you stand and what to do next no longer apply, so the snapshot is left out */}
      {!wide && (
        <Panel title={m.snapshot}>
          {/* one row of five tiles: where you stand, how far he is scouted, then what he cares about, first to
              third, each with your program's case on it as a word (so his priority is never read as your strength) */}
          <div className="recruit-file__snap">
            <div className="recruit-file__snap-cell recruit-file__snap-cell--wide" title={sd.text}>
              <span className="label">{m.standing}</span>
              <b>{sd.odds ?? sd.word}</b>
            </div>
            <div className="recruit-file__snap-cell recruit-file__snap-cell--end">
              <span className="label">{m.scouted}</span>
              <b>{m.looksCount(looks)}</b>
              <Meter value={looks / 3} label={m.scouted} />
            </div>
            {[0, 1, 2].map((i) => {
              const t = known[i];
              const name = t ? (PITCH_NAMES[t] ?? t) : null;
              const grade = t ? (r.case?.[t] ?? null) : null;
              const mark = t ? r.pitch_marks?.[t]?.mark : undefined;
              return (
                <div
                  key={i}
                  className={`recruit-file__snap-cell${t ? "" : " is-unknown"}`}
                  title={t ? m.pullTip(grade ?? "") : m.priorityHint}
                >
                  <span className="label">{m.priority(i)}</span>
                  <span className="recruit-file__snap-line">
                    <b className={t ? undefined : "recruit-file__snap-unknown"}>{name ?? m.unknown}</b>
                    {t && <SchoolGrade grade={grade} size="sm" />}
                  </span>
                  {/* how he took your pitch on it last time: what tells you where your grade sits against what he wants */}
                  {mark && mark !== "no_read" && (
                    <span className="recruit-file__snap-took">
                      <Reaction kind={mark} mark />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {r.no_room && <p className="recruit-file__warn">{r.no_room.tip}</p>}
        </Panel>
      )}
    </Panels>
  );
}

// ---------- Scouting ----------

/** A read's uncertainty said the way the Key Ratings say it: as the staff's confidence (the opposite word). */
const CONFIDENCE_OF: Record<string, string> = { Low: "High", Medium: "Medium", High: "Low" };

/** Scouting: your staff's report on him, his ratings as ranges, and Send a Scout. */
/** *tune* How long "His report is complete" stays written out after the look that finishes it, in ms. */
const DONE_MS = 7000;

export function ScoutingTab({
  r,
  detail,
  team,
  busy,
  onScout,
}: {
  r: BoardRow;
  detail: ProspectDetail | null;
  team: string;
  busy: boolean;
  /** send a scout for another look (it costs scouting points) */
  onScout: () => void;
}) {
  if (!detail) return <p className="recruit-file__soft">{m.loading}</p>;
  const looks = looksOf(r, detail);
  const rep = detail.report;
  const clear = detail.clear;
  const pot = clear?.potential;
  const yours = !!r.signed || r.committed === team;
  const left = 3 - looks;
  const cant = looks >= 3 || !detail.can_scout || detail.points_left < detail.scout_cost || !!r.scene;
  const why =
    looks >= 3
      ? undefined
      : detail.points_left < detail.scout_cost
        ? m.noPoints
        : r.scene
          ? m.finishFirst
          : !detail.can_scout
            ? m.cantScout
            : undefined;
  const comp = detail.our_comp;
  const compText = comp ? (
    <>
      <PlayerLink team={comp.team} name={comp.name} />
      <span className="recruit-file__comp-rest">
        {" "}
        · {m.compRest(teamOf(comp.team)?.abbreviation ?? comp.school, comp.position, comp.overall)}
      </span>
    </>
  ) : null;
  const coach = rep?.attributes.find((a) => a.group === "coachability");
  // his report finishing while his file is open is said for a moment; after that each rating's tooltip says it
  const looksWere = useRef({ id: r.id, looks });
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    const was = looksWere.current;
    looksWere.current = { id: r.id, looks };
    if (was.id !== r.id || !(looks >= 3 && was.looks < 3)) return setJustDone(false);
    setJustDone(true);
    const t = setTimeout(() => setJustDone(false), DONE_MS);
    return () => clearTimeout(t);
  }, [r.id, looks]);
  return (
    <Panels label={m.tabs.scouting}>
      <Panel title={m.report}>
        {/* the report's lead: how many looks, and his potential as your staff reads it */}
        <div className="recruit-file__lead">
          <div
            className="recruit-file__tile recruit-file__looks"
            title={
              looks >= 3
                ? m.complete
                : looks <= 0
                  ? m.looksShort.none
                  : left <= 1
                    ? m.looksShort.one
                    : m.looksShort.more(fmtLooks(left))
            }
          >
            <span className="label">{m.scouted}</span>
            <b className="recruit-file__big">{m.looksOf(fmtLooks(looks))}</b>
            <Meter value={looks / 3} label={m.scouted} />
          </div>
          {rep && (
            <div className="recruit-file__tile recruit-file__potential">
              <span className="label" title={pot?.label}>
                {m.potential}
              </span>
              {pot?.grade ? (
                // his potential is a letter grade, never a number: the read's low and high ends, then the whole scale
                // with the letters it covers lit; how sure the read is and whether it carries a plus or minus is the tip
                <Tooltip
                  title={`${m.confidence(pot.confidence)} · ${pot.fine ? m.fineShort : m.coarseShort}`}
                  text={pot.fine ? m.fineOn : m.fineOff}
                >
                  <b className="recruit-file__big">
                    <GradeRange read={pot.grade} />
                  </b>
                </Tooltip>
              ) : pot ? (
                <b className="recruit-file__big" title={m.confidence(pot.confidence)}>
                  {m.range(pot.est, pot.lo, pot.hi)}
                </b>
              ) : (
                <b className="recruit-file__big">{m.wordRange(rep.potential[0], rep.potential[1])}</b>
              )}
              {pot?.grade ? (
                <GradeScale read={pot.grade} />
              ) : pot ? (
                <RangeBar
                  lo={pot.lo}
                  hi={pot.hi}
                  mid={pot.est}
                  soft={pot.confidence === "Low"}
                  label={m.rangeLabel(pot.label, pot.est, pot.lo, pot.hi)}
                />
              ) : null}
            </div>
          )}
        </div>
        {rep ? (
          <Summary rep={rep} />
        ) : (
          <p className="recruit-file__soft" title={m.looksLine.none}>
            {m.noLook}
          </p>
        )}
        {/* who he compares to, on a line of its own under the summary (a transfer has no comp: he is who he is) */}
        {!r.portal && (
          <div className="recruit-file__comp">
            <span className="label">{m.comp}</span>
            <b className="recruit-file__comp-line">
              {compText ?? (
                <span className="recruit-file__comp-rest" title={looks >= 3 ? undefined : m.compLater}>
                  {looks >= 3 ? m.compNone : m.unknown}
                </span>
              )}
            </b>
          </div>
        )}
        {/* a finished report has nothing left to send for: the lead's Scouted strip is full */}
        {!yours && looks < 3 && (
          <div className="recruit-file__acts">
            <span
              title={why ?? [left <= 1 ? m.finishes : "", m.pointsLeft(detail.points_left)].filter(Boolean).join(" ")}
            >
              <Button disabled={busy || cant} onClick={onScout}>
                <Binoculars size={18} weight="bold" aria-hidden="true" />
                {m.sendScout(detail.scout_cost)}
              </Button>
            </span>
          </div>
        )}
      </Panel>

      <Panel title={clear ? m.keyRatings : m.attributes}>
        {clear ? (
          <div className="recruit-file__ratings">
            {clear.rows.map((x) => (
              <Tooltip
                key={x.key}
                title={x.label}
                text={m.ratingTip(x.est, x.lo, x.hi, x.confidence) + (looks >= 3 ? ` ${m.finalGrade}` : "")}
                block
                className="recruit-file__rating"
              >
                <span className="recruit-file__rating-name">{x.label}</span>
                <RangeBar lo={x.lo} hi={x.hi} mid={x.est} soft={x.confidence === "Low"} />
                <b className="recruit-file__num">{m.range(x.est, x.lo, x.hi)}</b>
              </Tooltip>
            ))}
            {/* how fast he will grow, as your staff reads it: in words, never a number */}
            {coach && (
              <Tooltip
                title={coach.label}
                text={m.coachTip(coach.words[0], coach.words[1], CONFIDENCE_OF[coach.uncertainty] ?? "Medium")}
                block
                className="recruit-file__rating"
              >
                <span className="recruit-file__rating-name">{coach.label}</span>
                <RangeBar
                  lo={Math.round(coach.lo)}
                  hi={Math.round(coach.hi)}
                  mid={Math.round(coach.mid)}
                  soft={CONFIDENCE_OF[coach.uncertainty] === "Low"}
                />
                <b className="recruit-file__num">{m.wordRange(coach.words[0], coach.words[1])}</b>
              </Tooltip>
            )}
          </div>
        ) : rep ? (
          <div className="recruit-file__ratings">
            {rep.attributes.map((x) => (
              <Tooltip
                key={x.group}
                title={x.label}
                text={m.wordsTip(x.words[0], x.words[1], x.uncertainty) + (looks >= 3 ? ` ${m.finalGrade}` : "")}
                block
                className="recruit-file__rating"
              >
                <span className="recruit-file__rating-name">{x.label}</span>
                <RangeBar lo={x.lo} hi={x.hi} mid={x.mid} soft={x.uncertainty === "High"} />
                <b className="recruit-file__num">{m.wordRange(x.words[0], x.words[1])}</b>
              </Tooltip>
            ))}
          </div>
        ) : (
          <p className="recruit-file__soft" title={m.noRatings}>
            {m.noLook}
          </p>
        )}
        {justDone && (
          <p className="recruit-file__foot" role="status">
            {m.looksLine.done}
          </p>
        )}
      </Panel>
    </Panels>
  );
}

// ---------- Profile ----------

/** "Open", "Committed: Texas", "Signed: SMU", "Leaning FCS", "Going Pro" */
function statusText(r: BoardRow, d: ProspectDetail): string {
  if (d.public.pro) return m.statuses.pro;
  const holder = r.signed || r.committed;
  if (holder) return (r.signed ? m.statuses.signed : m.statuses.committed)(teamName(holder, r.school_name));
  return d.public.leaning_fcs ? m.statuses.fcs : m.statuses.open;
}

const TRAIT_ICON: Record<string, Icon> = {
  personality: User,
  decider: UsersThree,
  story: BookOpen,
  commit_style: Handshake,
};

/** Profile: who he is, a card a trait (one not known yet says how it shows itself), and his background. */
export function ProfileTab({
  r,
  detail,
  onMate,
  mateOnBoard,
}: {
  r: BoardRow;
  detail: ProspectDetail | null;
  /** open his Package Deal teammate */
  onMate?: (id: string) => void;
  /** whether a prospect is on your board already (opening one who is not adds him) */
  mateOnBoard?: (id: string) => boolean;
}) {
  if (!detail) return <p className="recruit-file__soft">{m.loading}</p>;
  const tr = detail.traits;
  const hints = detail.trait_hints;
  const p = detail.public;
  const looks = looksOf(r, detail);
  const comp = detail.our_comp;
  const compText = comp ? (
    <>
      <PlayerLink team={comp.team} name={comp.name} />
      <span className="recruit-file__comp-rest">
        {" "}
        · {m.compRest(teamOf(comp.team)?.abbreviation ?? comp.school, comp.position, comp.overall)}
      </span>
    </>
  ) : null;
  const st = p.hometown.state === "DC" ? "D.C." : p.hometown.state;
  const story = tr.story ? (tr.story_detail ? `${tr.story} · ${tr.story_detail}` : tr.story) : null;
  const traits: [string, string | null][] = [
    ["personality", tr.personality],
    ["decider", tr.decider],
    ["story", story],
    ["commit_style", tr.commit_style],
  ];
  // what has happened to him this cycle (a grades scare, a coaching change): part of his story, in its card
  const twist = detail.twist;
  const twistHead = twist
    ? twist.weeks_left
      ? `${twist.label} · ${m.weeksLeft(twist.weeks_left)}`
      : twist.label
    : null;
  const known = traits.filter(([, v]) => v).length;
  const tips: Record<string, string | undefined> = {
    story: tr.story_key ? m.storyTips[tr.story_key]?.(tr.story_detail, !!tr.story_yours) : undefined,
    commit_style: tr.style_key ? m.styleTips[tr.style_key] : undefined,
  };
  return (
    <Panels stack label={m.tabs.profile}>
      <Panel title={m.traits} aside={m.knownOf(known, traits.length)}>
        <ul className="recruit-file__traits">
          {traits.map(([k, v]) => {
            const Mark = TRAIT_ICON[k] ?? User;
            return (
              <li key={k} className={`recruit-file__trait${v || (k === "story" && twist) ? "" : " is-unknown"}`}>
                {/* a trait is its mark, its name and its word; what it means for recruiting him (and, not known yet,
                    how to learn it) is the cell's tip, not a paragraph in it */}
                <Tooltip
                  block
                  title={v ? `${m.traitNames[k]}: ${v}` : m.traitNames[k]}
                  text={
                    k === "story" && twist
                      ? [v ? (tips[k] ?? m.traitAbout[k]) : "", `${twistHead}: ${twist.line}`]
                          .filter(Boolean)
                          .join("\n")
                      : v
                        ? (tips[k] ?? m.traitAbout[k])
                        : (hints[k] ?? m.traitAbout[k])
                  }
                >
                  <div className="recruit-file__trait-cell">
                    <span className="recruit-file__trait-icon" aria-hidden="true">
                      <Mark size={16} weight={v ? "fill" : "regular"} />
                    </span>
                    <span className="label">{m.traitShort[k] ?? m.traitNames[k]}</span>
                    {(v || !(k === "story" && twist)) && <b>{v ?? m.unknown}</b>}
                    {k === "story" && twist && <b className="recruit-file__twist">{twistHead}</b>}
                    {k === "story" && tr.story_key === "package" && tr.story_mate && onMate && (
                      <button type="button" className="recruit-file__mate" onClick={() => onMate(tr.story_mate!)}>
                        {mateOnBoard?.(tr.story_mate) ? m.openMate : m.addMate}
                        <ArrowRight size={12} weight="bold" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={m.background}>
        <PanelRows>
          <PanelRow label={m.highSchool} value={p.high_school} unknown={m.unknown} />
          <PanelRow label={m.archetype} value={p.archetype} unknown={m.unknown} />
          <PanelRow label={m.rankings} value={m.ranks(p.national_rank, r.pos_rank, r.display_pos, p.state_rank, st)} />
          {p.composite != null && <PanelRow label={m.composite} value={p.composite.toFixed(4)} />}
          <PanelRow label={m.status} value={statusText(r, detail)} />
          {!r.portal && (
            <PanelRow
              label={m.comp}
              value={compText ?? (looks >= 3 ? m.compNone : undefined)}
              unknown={m.unknown}
              hint={null}
              wide={!!comp}
            />
          )}
        </PanelRows>
      </Panel>
    </Panels>
  );
}

// ---------- History ----------

const KIND_ICON: Record<string, Icon> = {
  message: Chat,
  call: Phone,
  hc_visit: House,
  official_visit: House,
  pitch: Phone,
  offer: Scroll,
  raise_nil: CurrencyDollar,
  pull_offer: X,
  learned: Binoculars,
  present: Phone,
  answer: Phone,
  hung_up: Phone,
  asked_more: CurrencyDollar,
  commit: Flag,
  hard: Flag,
  flip: Flag,
  decommit: Flag,
  signed: PenNib,
  leaning_fcs: Flag,
  bloomed: Star,
  pro: Star,
  rival_push: Lightning,
};

/** A line of his history, in the old board's order: "Call · Program Prestige", then how he took it. */
interface Item {
  week: number;
  kind: string;
  text: string;
  /** how he took a pitch (sold, hit, fair, lukewarm, quiet, polite, tired): drawn as its own mark after the line */
  reaction?: string;
  /** another school's answer to your recruiting: that school, whose mark and colors the line wears */
  rival?: string;
}

/** Kinds whose line the game wrote itself. */
const LINE_KINDS = new Set([
  "learned",
  "bloomed",
  "pro",
  "twist",
  "hat",
  "softened",
  "rival_push",
  "promise_kept",
  "promise_strained",
]);

/**
 * His history as lines, newest first (web/recruiting.js historyItems). A call's or visit's pitch folds into that
 * call's line, so one conversation is one entry.
 */
export function historyItems(events: RecruitEvent[], team: string): Item[] {
  const folded = new Set<number>();
  const actionOf = new Map<number, string>();
  events.forEach((e, i) => {
    if (e.kind !== "pitch") return;
    // the call or visit this pitch finished: the same week, the nearest older contact that opened a conversation
    const j = events.findIndex(
      (c, k) =>
        k > i &&
        !folded.has(k) &&
        c.kind === "contact" &&
        c.week === e.week &&
        (c.action === "call" || c.action === "hc_visit") &&
        !c.pitch &&
        (!e.action || c.action === e.action),
    );
    if (j >= 0) {
      folded.add(j);
      actionOf.set(i, events[j].action ?? "call");
    }
  });
  const school = (e: RecruitEvent) => (e.school ? (e.school === team ? m.you : teamName(e.school)) : m.fcs);
  const topic = (t?: string) => (t ? (PITCH_NAMES[t] ?? t) : null);
  const line = (e: RecruitEvent, i: number): (string | null | undefined)[] => {
    const k = e.kind;
    const about = e.about ?? "";
    if (k === "contact") return [m.actions[e.action ?? ""] ?? e.action, topic(e.pitch)];
    if (k === "pitch") return [m.actions[e.action ?? actionOf.get(i) ?? ""] ?? m.actions.pitch, topic(e.pitch)];
    if (k === "offer")
      return e.school && e.school !== team ? [m.h.offeredBy(teamName(e.school))] : [m.actions.offer, m.h.nil(e.nil)];
    if (k === "raise_nil") return [m.actions.raise_nil, m.h.nil(e.nil)];
    if (k === "pull_offer") return [m.actions.pull_offer];
    if (k === "hung_up") return [e.action === "hc_visit" ? m.h.visitUnfinished : m.h.callUnfinished];
    if (k === "asked_more") return [m.h.askedMore];
    if (k === "not_buying") return [m.h.notBuying];
    if (k === "pester")
      return [m.h.tunedOut(e.action === "hc_visit" ? "visit" : e.action === "call" ? "call" : "message")];
    if (k === "present")
      return [m.h.presented((e.topics ?? []).map((t) => PITCH_NAMES[t] ?? t).join(", ")), m.h.landed(e.hit ?? 0)];
    if (k === "answer" && e.question === "package")
      return [
        e.answer === "promise"
          ? m.h.promisedOffer(about)
          : e.answer === "deflect"
            ? m.h.sidestepped(about)
            : e.offered
              ? m.h.alreadyOffered(about)
              : m.h.straight(about),
      ];
    if (k === "answer")
      return [
        e.answer === "promise"
          ? m.h.promisedJob(about, e.truthful === false || !!e.crowded)
          : e.answer === "deflect"
            ? m.h.sidestepped(about)
            : m.h.straight(about),
      ];
    if (e.line && (LINE_KINDS.has(k) || k === "signed" || k === "unsigned")) return [e.line];
    if (k === "promise_broken")
      return [
        e.why === "money" && e.line ? e.line : e.why === "package" ? m.h.brokenPackage(about) : m.h.brokenSpot(about),
      ];
    if (k === "leaning_fcs") return [m.h.leaningFcs];
    if (m.h.moves[k]) return [m.h.moves[k](school(e))];
    return [e.line ?? m.h.other(school(e), k.replace(/_/g, " "))];
  };
  return events.flatMap((e, i) =>
    folded.has(i)
      ? []
      : [
          {
            week: e.week,
            kind: e.kind === "contact" || e.kind === "pitch" ? (e.action ?? actionOf.get(i) ?? "pitch") : e.kind,
            text: line(e, i).filter(Boolean).join(" · "),
            ...(e.kind === "pitch" && e.reaction ? { reaction: e.reaction } : {}),
            ...(e.kind === "rival_push" && e.school ? { rival: e.school } : {}),
          },
        ],
  );
}

/**
 * A recruit's History as a scrolling list, newest first: an icon, the week and what happened, the kind as a tag. The
 * recruiting page's History tab shows it, and a signed player's card keeps it (PlayerView's History).
 */
export function RecruitTimeline({ events, team }: { events: RecruitEvent[]; team: string }) {
  const items = historyItems(events, team);
  if (!items.length) return <p className="recruit-file__soft">{m.noHistory}</p>;
  return (
    <ul className="recruit-file__timeline" tabIndex={0}>
      {items.map((x, i) => {
        const Mark = KIND_ICON[x.kind] ?? Newspaper;
        // a rival's move wears that school's mark, and its tag the school's color
        const rival = x.rival ? teamOf(x.rival) : undefined;
        const worn = rival
          ? ({ "--rw": rival.colors.primary, "--rw-on": inkOn(rival.colors.primary) } as CSSProperties)
          : undefined;
        return (
          <li key={i} className={x.rival ? "is-rival" : undefined} style={worn}>
            {x.rival ? <Swatch team={rival} size={16} /> : <Mark size={16} weight="bold" aria-hidden="true" />}
            <span>
              <b>{m.week(Math.max(0, x.week - 1))}</b> · {x.text}
              {x.reaction && (
                <span className="recruit-file__took">
                  {" · "}
                  <Reaction kind={x.reaction} />
                </span>
              )}
            </span>
            <span className="recruit-file__tag">{m.chips[x.kind] ?? m.news}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** History: the Recruiting Timeline and Recent Interest Changes. */
export function HistoryTab({ r, team }: { r: BoardRow; team: string }) {
  const rows = raceOf(r);
  const items = historyItems(r.history, team);
  return (
    <Panels label={m.tabs.history}>
      <Panel title={m.timeline} aside={items.length ? m.entries(items.length) : undefined}>
        <RecruitTimeline events={r.history} team={team} />
      </Panel>

      <Panel title={m.changes}>
        {rows.length ? (
          <ol className="recruit-file__battle recruit-file__battle--moves">
            {rows.slice(0, 8).map((x, i) => {
              const you = x.you || x.school === team;
              const move = x.move ?? 0;
              const Arrow = x.new ? Star : move > 0 ? ArrowUp : move < 0 ? ArrowDown : Minus;
              return (
                <li key={x.school} className={you ? "is-you" : undefined}>
                  <span className="recruit-file__place">{x.rank ?? i + 1}</span>
                  <span className="recruit-file__school">
                    <Swatch team={teamOf(x.school)} size={16} />
                    <b>{x.name}</b>
                  </span>
                  <span className="recruit-file__move">
                    <Arrow size={14} weight="bold" aria-hidden="true" />
                    {x.new
                      ? m.moves.fresh
                      : move > 0
                        ? m.moves.up(move)
                        : move < 0
                          ? m.moves.down(-move)
                          : m.moves.same}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="recruit-file__soft">{m.noList}</p>
        )}
      </Panel>
    </Panels>
  );
}

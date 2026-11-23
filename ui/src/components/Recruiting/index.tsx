import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CaretDown,
  CaretRight,
  Check,
  Handshake,
  Heart,
  House,
  MagnifyingGlass,
  PhoneCall,
  Star,
  X,
} from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import ClosedDoor, { ClosedMark } from "../ClosedDoor/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Conversation from "../Conversation/index.tsx";
import Face from "../Face/index.tsx";
import ScoutMark from "../ScoutMark/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import { HistoryTab, OverviewTab, ProfileTab, ScoutingTab } from "../RecruitFile/index.tsx";
import Panel from "../Panel/index.tsx";
import ProfileHead, { HeadTag } from "../ProfileHead/index.tsx";
import RecruitStatus from "../RecruitStatus/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import VisitTip from "../VisitTip/index.tsx";
import { api } from "../../api.ts";
import { cachedTeams, teamNamed } from "../../teams.ts";
import { setFavorite, setOnBoard } from "../../board.ts";
import { playerFace, type Face as FaceSpec } from "../../faces.ts";
import { byChance, standingOf, statusOf, topicPhrase } from "../../standing.ts";
import type { BoardRow, MoneyOwed, ProspectDetail, RecruitingBoard, Scene, TeamCard } from "../../types.ts";
import { inkOn } from "../../colors.ts";
import { useKept } from "../../kept.ts";
import ChangeBadge, { changesOf, seenOf, type Seen } from "../ChangeBadge/index.tsx";
import { formatClass } from "../../format.ts";
import Swatch from "../Swatch/index.tsx";
import QuickActions from "./Quick.tsx";
import { messages as m } from "./messages.ts";
import RecruitFlags, { type RecruitAlert } from "../RecruitFlags/index.tsx";
import RivalPush from "../RivalPush/index.tsx";
import "./index.css";

/** *tune* How long what your last action did, and a warning that has just started, stay written out, in ms. */
const NOTE_MS = 6000;

/** Your commit with a rival near to flipping him (a real chance or better): the alert his line and his head show. */
const flipAlert = (r: BoardRow): { key: RecruitAlert; tip: string } | null =>
  r.flip && r.flip.word !== "Slim" ? { key: "flip", tip: m.flipRisk(r.flip.word, r.flip.school) } : null;

/** What a Class Needs chip counts against the spots the class set out to fill. */
type NeedShow = "commits" | "board" | "offers";

/** The roster groups in order (the keys a need is counted under). */
// the line, linebackers and safeties as their positions (career_js/recruiting.js SPOTS), in depth-chart order
const GROUP_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "OT",
  "OG",
  "C",
  "EDGE",
  "DT",
  "MIKE",
  "WILL",
  "CB",
  "FS",
  "SS",
  "K",
  "P",
  "ATH",
];
const groupOf = (r: BoardRow) => r.group ?? r.display_pos;
/** A school by its slug, for its colors (none for a stand-in). */
const schoolOf = (slug: string | null) => (slug ? cachedTeams()?.find((t) => t.slug === slug) : undefined);

/** A warning about one school, on a band of that school's first color in the ink that reads on it. */
function RivalWarn({ team, text }: { team: TeamCard | undefined; text: string }) {
  const c = team?.colors;
  const style = c
    ? ({ "--rw": c.primary, "--rw-on": inkOn(c.primary), "--rw-2": c.secondary } as CSSProperties)
    : undefined;
  return (
    <p className="recruit__warn recruit__warn--rival" role="status" style={style}>
      <Swatch team={team} size={22} />
      <PhoneCall size={16} weight="fill" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

interface Props {
  seasonId: string;
  /** your school */
  team: string;
  weekLabels: Record<string, string>;
  /** GET /recruiting (the game loads it; Energy reads the same) */
  board: RecruitingBoard | null;
  /** load it again after an action (hours, standings, the board) */
  reload: (quiet?: boolean, stale?: () => boolean) => Promise<void>;
  /** change it at once, ahead of the server (a quick action ticked) */
  patch?: (change: (b: RecruitingBoard) => RecruitingBoard) => void;
  /** an empty board's Find Prospects: the Prospects tab */
  onFindProspects: () => void;
  /** your coach, beside your lines on a call or visit */
  coach?: { name: string; face: FaceSpec } | null;
  /** a recruit to pick (asked for from another section); he shows if he is on the board */
  pick?: string | null;
}

/** *tune* How many recommended prospects an empty board's one click adds. */
const STARTER_BOARD = 10;

/** The board's groups, in order: where each recruit stands in his recruitment. */
const STAGES = ["committed", "visited", "top", "contact", "cold", "gone"] as const;
/** the filters that cut across the stages: your favorites (♥), the recruits holding your offer, and whether your staff's report on him is complete */
const ACROSS = {
  favorites: (r: BoardRow) => !!r.favorite,
  offered: (r: BoardRow) => r.offered,
  scouted: (r: BoardRow) => (r.looks ?? 0) >= FULL_REPORT,
  partly: (r: BoardRow) => (r.looks ?? 0) > 0 && (r.looks ?? 0) < FULL_REPORT,
  unscouted: (r: BoardRow) => !(r.looks ?? 0),
} as const;
type Across = keyof typeof ACROSS;
/** *tune* Looks that make a full scouting report (recruiting.REPORT_LOOKS). */
const FULL_REPORT = 3;
const isAcross = (s: string): s is Across => s in ACROSS;
/** the filter: every stage, one stage, or one of the filters across them */
type StageKey = (typeof STAGES)[number] | "all" | Across;

/** Committed to you counts as committed; committed or signed elsewhere is "gone". */
const stageOf = (r: BoardRow, me: string): (typeof STAGES)[number] => {
  const school = r.signed || r.committed;
  if (school) return school === me ? "committed" : "gone";
  return (STAGES as readonly string[]).includes(r.stage) ? (r.stage as (typeof STAGES)[number]) : "cold";
};

/**
 * The Recruiting board: the recruits you're working, grouped by stage (or one stage), each with where you stand;
 * beside it the one picked, worked from his panel (his list, your offer against his ask, what he wants, and the
 * week's actions). Every action goes to POST /recruit, then the board loads again (hours, standings, Energy).
 */
export default function Recruiting({
  seasonId,
  team,
  weekLabels,
  board,
  reload,
  patch,
  onFindProspects,
  coach = null,
  pick = null,
}: Props) {
  // the board's filters and sort are kept for the career, so another page and back finds them as you left them
  const [stage, setStage] = useKept<StageKey>(`board.${seasonId}.stage`, "all");
  const [sort, setSort] = useKept<"chance" | "rank">(`board.${seasonId}.sort`, "chance");
  // the list narrowed to a name (or a hometown) and to one position group
  const [q, setQ] = useState("");
  const [pos, setPos] = useKept(`board.${seasonId}.pos`, "all");
  const [picked, setPicked] = useState<string | null>(null);
  // another section asked for him: show every stage (he may not be in the one filtered to) and pick him
  useEffect(() => {
    if (!pick) return;
    setStage("all");
    setQ("");
    setPos("all");
    setPicked(pick);
  }, [pick]);

  const all = useMemo(() => board?.board ?? [], [board]);
  // the position groups on your board, in roster order, and how many of each
  const posCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) c[groupOf(r)] = (c[groupOf(r)] ?? 0) + 1;
    return c;
  }, [all]);
  const positions = [
    ...GROUP_ORDER.filter((g) => posCounts[g]),
    ...Object.keys(posCounts).filter((g) => !GROUP_ORDER.includes(g)),
  ];
  // your class's needs, said one way everywhere: how many of the spots the class set out to fill are filled
  // (your commits there, of your commits plus what is still open)
  const filled = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) if (r.committed === team || r.signed === team) c[groupOf(r)] = (c[groupOf(r)] ?? 0) + 1;
    return c;
  }, [all, team]);
  // what a need chip counts before the slash: your commits there, the recruits on your board, or your open offers
  const [needShow, setNeedShow] = useKept<NeedShow>(`board.${seasonId}.needShow`, "commits");
  /** Class Needs folded away (its name stays, to open it again) */
  const [needsShut, setNeedsShut] = useKept(`board.${seasonId}.needsShut`, false);
  /** Triage Needs: each chip in the color of how pressing its need is */
  const [triage, setTriage] = useKept(`board.${seasonId}.triage`, true);
  const offeredAt = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) if (r.offered) c[groupOf(r)] = (c[groupOf(r)] ?? 0) + 1;
    return c;
  }, [all]);
  const before = (g: string) =>
    (needShow === "commits" ? filled[g] : needShow === "board" ? posCounts[g] : offeredAt[g]) ?? 0;
  const spots = (g: string) => (filled[g] ?? 0) + Math.max(0, board?.needs?.[g] ?? 0);
  const needs = GROUP_ORDER.filter((g) => spots(g) > 0);
  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (pos === "all" || groupOf(r) === pos) &&
        (!text || `${r.name} ${r.hometown.city} ${r.hometown.state} ${r.display_pos}`.toLowerCase().includes(text)),
    );
  }, [all, q, pos]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[stageOf(r, team)] = (c[stageOf(r, team)] ?? 0) + 1;
    for (const k of Object.keys(ACROSS) as Across[]) c[k] = rows.filter(ACROSS[k]).length;
    return c;
  }, [rows, team]);
  const order = useMemo(
    () => (sort === "chance" ? byChance(team) : (a: BoardRow, b: BoardRow) => a.national_rank - b.national_rank),
    [sort, team],
  );
  // once your whole class has signed (after a signing day), the stage reads Signed, not Committed
  const yours = all.filter((r) => stageOf(r, team) === "committed");
  const classSigned = yours.length > 0 && yours.every((r) => r.signed === team);
  // his top group's size this week: 8, then his finalists (5, 3), as the game says
  const topSize = all.find((r) => r.top_size != null)?.top_size ?? 8;
  const stageName = (s: StageKey) =>
    s === "committed" && classSigned ? m.signedStage : s === "top" ? m.topN(topSize) : m.stageNames[s];
  const groups = useMemo(
    () =>
      STAGES.filter((s) => stage === "all" || isAcross(stage) || stage === s)
        .map((s) => ({
          key: s,
          rows: rows.filter((r) => stageOf(r, team) === s && (!isAcross(stage) || ACROSS[stage](r))).sort(order),
        }))
        .filter((g) => g.rows.length),
    [rows, stage, team, order],
  );
  const shown = groups.flatMap((g) => g.rows);
  const current = shown.find((r) => r.id === picked) ?? shown[0] ?? null;

  // what each recruit looked like when you last opened his card: a row whose recruit has changed since wears a bell.
  // A recruit new to the board is taken as seen; the one whose card is open is seen as he is now.
  const [seen, setSeen] = useKept<Record<string, Seen>>(`board.${seasonId}.seen`, {});
  const seenKey = all.map((r) => r.id).join("|") + JSON.stringify(current ? seenOf(current, team) : null);
  useEffect(() => {
    if (!all.length) return;
    const next: Record<string, Seen> = {};
    for (const r of all) next[r.id] = r.id === current?.id || !seen[r.id] ? seenOf(r, team) : seen[r.id];
    if (JSON.stringify(next) !== JSON.stringify(seen)) setSeen(next);
  }, [seenKey]);

  // an empty board: the class's recommended prospects, onto it in one go
  const [adding, setAdding] = useState(false);
  const addRecommended = async () => {
    setAdding(true);
    try {
      const rec = await api<{ rows: { id: string }[] }>(
        `/api/season/${seasonId}/prospects?status=recommended&limit=${STARTER_BOARD}`,
      );
      await setOnBoard(
        seasonId,
        rec.rows.map((r) => r.id),
        true,
      );
      await reload();
    } finally {
      setAdding(false);
    }
  };

  if (board && all.length === 0)
    return (
      <div className="recruiting recruiting--empty">
        <div className="recruiting__empty">
          <Star size={32} weight="bold" aria-hidden="true" />
          <h1 className="recruiting__empty-title">{m.empty}</h1>
          <p className="recruiting__soft">{m.emptyText}</p>
          <div className="recruiting__empty-acts">
            <Button disabled={adding} onClick={addRecommended}>
              <Star size={18} weight="fill" aria-hidden="true" />
              {adding ? m.adding : m.addRecommended(STARTER_BOARD)}
            </Button>
            <Button variant="outline" onClick={onFindProspects}>
              {m.findProspects}
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="recruiting">
      <section className="recruiting__main" aria-label={m.title}>
        <header className="recruiting__head">
          {board && (
            <dl className="recruiting__meters">
              <div>
                <dt className="label">{m.nil}</dt>
                <dd>
                  {board.nil.left} <small>/ {board.nil.budget}</small>
                </dd>
              </div>
              <div>
                <dt className="label">{m.offers}</dt>
                <dd>
                  {board.offers} <small>/ {board.offers + board.offers_left}</small>
                </dd>
              </div>
              <div>
                <dt className="label">{m.commits}</dt>
                <dd>
                  {board.committed} <small>/ {board.open_spots}</small>
                </dd>
              </div>
            </dl>
          )}
        </header>

        {/* your class's needs: a chip a position the class set out to fill, with how many are filled; each one a filter */}
        {needs.length > 0 && (
          <div className="recruiting__needs" role="group" aria-label={m.needs}>
            <div className="recruiting__needs-title">
              <button
                type="button"
                className="label recruiting__needs-fold"
                title={m.needsTip}
                aria-expanded={!needsShut}
                onClick={() => setNeedsShut(!needsShut)}
              >
                {m.needs}
                {needsShut ? (
                  <CaretRight size={12} weight="bold" aria-hidden="true" />
                ) : (
                  <CaretDown size={12} weight="bold" aria-hidden="true" />
                )}
              </button>
              {!needsShut && (
                <label className="recruiting__triage" title={m.triageTip}>
                  <input type="checkbox" checked={triage} onChange={(e) => setTriage(e.target.checked)} />
                  {m.triage}
                </label>
              )}
              {!needsShut && (
                <Dropdown
                  label={m.needShow}
                  hideLabel
                  align="right"
                  value={needShow}
                  options={(Object.keys(m.needShows) as NeedShow[]).map((k) => ({
                    value: k,
                    label: m.needShows[k],
                  }))}
                  onChange={(k) => setNeedShow(k as NeedShow)}
                />
              )}
            </div>
            {!needsShut &&
              needs.map((g) => {
                const lv = triage ? board?.need_levels?.[g] : undefined;
                const chip = (
                  <Chip key={g} on={pos === g} onClick={() => setPos(pos === g ? "all" : g)}>
                    {lv?.level === 0 && <Check size={12} weight="bold" aria-hidden="true" />}
                    {g}
                    <span className="chip__count">{m.filledShort(before(g), spots(g))}</span>
                  </Chip>
                );
                return lv ? (
                  <span
                    key={g}
                    className={`recruiting__need recruiting__need--${lv.level}`}
                    title={m.triageLevel(lv.level, lv.leaving, lv.starters)}
                  >
                    {chip}
                  </span>
                ) : (
                  chip
                );
              })}
          </div>
        )}

        <div className="recruiting__tools">
          <label className="recruiting__search">
            <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
            <input
              type="search"
              value={q}
              placeholder={m.search}
              aria-label={m.search}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <Dropdown
            label={m.stages}
            hideLabel
            size="md"
            value={stage}
            // a stage with no one in it is left out (unless it is the one you are on)
            options={(["all", ...STAGES, "favorites", "offered", "scouted", "partly", "unscouted"] as StageKey[])
              .filter((s) => s === "all" || s === stage || counts[s])
              .map((s) => ({
                value: s,
                label: stageName(s),
                count: counts[s] ?? 0,
              }))}
            onChange={(s) => setStage(s as StageKey)}
          />
          <Dropdown
            label={m.position}
            hideLabel
            size="md"
            value={pos}
            options={[
              { value: "all", label: m.allPositions },
              ...positions.map((g) => ({
                value: g,
                label: g,
                // one line under the position: who is on your board there, and the class's spots there
                hint: [m.onBoardN(posCounts[g]), spots(g) > 0 ? m.filledOf(filled[g] ?? 0, spots(g)) : null]
                  .filter(Boolean)
                  .join(" · "),
              })),
            ]}
            onChange={setPos}
          />
          <Dropdown
            label={m.sort}
            size="md"
            align="right"
            value={sort}
            options={[
              { value: "chance", label: m.sortChance, hint: m.sortChanceHint },
              { value: "rank", label: m.sortRank, hint: m.sortRankHint },
            ]}
            onChange={(v) => setSort(v as "chance" | "rank")}
          />
        </div>

        <div className="recruiting__list">
          {groups.length === 0 && <p className="recruiting__soft">{m.noneAtStage}</p>}
          {groups.map((g) => (
            <section key={g.key} className="recruiting__group" aria-label={stageName(g.key)}>
              {(stage === "all" || isAcross(stage)) && (
                <h2 className="label recruiting__group-title">
                  {stageName(g.key)} <span>{g.rows.length}</span>
                </h2>
              )}
              <ul className="recruiting__rows">
                {g.rows.map((r) => {
                  // your place on his list, when you are on it
                  const race = r.list.filter((x) => x.bar != null);
                  const mine = race.find((x) => x.you || x.school === team);
                  // (a signed recruit has no list any more)
                  const rank = mine && !r.signed ? (mine.rank ?? race.indexOf(mine) + 1) : null;
                  // the door is shut on you (he will not consider you, or cut his list without you): he stays on
                  // your board, marked out, every action off
                  const out = r.blocked && r.blocked.why !== "signed" ? r.blocked : null;
                  return (
                    <li
                      key={r.id}
                      className={
                        [out && "is-out", !!r.rival_push?.length && "has-rival"].filter(Boolean).join(" ") || undefined
                      }
                    >
                      <button
                        type="button"
                        className="recruiting__row"
                        aria-pressed={current?.id === r.id}
                        onClick={() => setPicked(r.id)}
                      >
                        <span className="recruiting__mug">
                          <span className="face-tile recruiting__face">
                            <Face face={playerFace(r.id, r.display_pos)} scale={2} label="" />
                          </span>
                          {/* something about him changed since you last opened his card: a bell on the picture's other corner */}
                          {current?.id !== r.id && (
                            <span className="recruiting__changed">
                              <ChangeBadge changes={changesOf(seen[r.id], seenOf(r, team), team)} />
                            </span>
                          )}
                          {/* where his offer or commitment stands, stamped on the picture's corner */}
                          {statusOf(r, team).key !== "none" && (
                            <span className="recruiting__stamp">
                              <RecruitStatus
                                status={statusOf(r, team)}
                                size={14}
                                stamp={30}
                                school={schoolOf(r.signed || r.committed)}
                                schoolName={r.school_name}
                              />
                            </span>
                          )}
                        </span>
                        <span className="recruiting__who">
                          <b>
                            {r.name}
                            {r.favorite && (
                              <Heart className="recruiting__fav" size={11} weight="fill" aria-label={m.favorite} />
                            )}
                          </b>
                          <span className="recruiting__soft recruiting__facts">
                            {r.display_pos}
                            {/* a transfer: his year (they are not all freshmen) and the school he left (his season's numbers are on his file; they do not fit a card) */}
                            {r.portal ? (
                              // (the school by its short name, FAU: a long one was cut off; the whole name is its tooltip)
                              <span title={r.from_name ?? undefined}>
                                {[r.cls && formatClass(r.cls), teamNamed(r.from_name)?.abbreviation ?? r.from_name]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            ) : (
                              <Stars n={r.stars} size={10} />
                            )}
                            <ScoutMark looks={r.looks} size={12} />
                            <RecruitFlags
                              generational={r.generational}
                              find={r.find}
                              likes={r.likes}
                              alerts={flipAlert(r) ? [flipAlert(r)!] : undefined}
                              size={11}
                            />
                          </span>
                          {rank != null && <span className="recruiting__soft recruiting__place">{m.onList(rank)}</span>}
                          {/* a school answering your recruiting of him, in its own colors: a line of its own along
                              the row's foot */}
                          {!!r.rival_push?.length && (
                            <span className="recruiting__rivals">
                              <RivalPush rivals={r.rival_push} teamOf={schoolOf} />
                            </span>
                          )}
                        </span>
                      </button>
                      {/* every action is off: the shut door stands where his quick actions would */}
                      {out && (
                        <span className="recruiting__shut">
                          <ClosedMark blocked={out} />
                        </span>
                      )}
                      <QuickActions
                        seasonId={seasonId}
                        r={r}
                        left={board?.hours_left ?? 0}
                        costs={board?.hours_cost ?? {}}
                        off={
                          !board ||
                          board.closed ||
                          !!(r.signed || (r.committed && r.committed !== team && r.hard)) ||
                          !!out
                        }
                        offWhy={out?.text}
                        hidden={!!out}
                        labels
                        onChange={(stale) => reload(true, stale)}
                        onPlan={(action, on) =>
                          patch?.((b) => ({
                            ...b,
                            hours_left: b.hours_left + (on ? -1 : 1) * (b.hours_cost[action] ?? 0),
                            board: b.board.map((x) =>
                              x.id === r.id
                                ? {
                                    ...x,
                                    planned: on
                                      ? [...(x.planned ?? []), action]
                                      : (x.planned ?? []).filter((a) => a !== action),
                                  }
                                : x,
                            ),
                          }))
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <aside className="recruiting__side">
        {current && board ? (
          <RecruitPanel
            key={current.id}
            r={current}
            board={board}
            team={team}
            seasonId={seasonId}
            weekLabels={weekLabels}
            reload={reload}
            coach={coach}
            onBoard={(id) => rows.some((x) => x.id === id)}
            onPick={(id) => {
              setStage("all");
              setPicked(id);
            }}
          />
        ) : (
          <p className="recruiting__soft">{m.pickOne}</p>
        )}
      </aside>
    </div>
  );
}

/** His panel's tabs (the old board's pane): what you do on Overview, what you know on the other three. */
const TABS = ["overview", "scouting", "profile", "history"] as const;
type Tab = (typeof TABS)[number];
/** the tab you were last on: the next recruit you pick opens on it (reading reports down the board stays on Scouting) */
let lastTab: Tab = "overview";

/**
 * A recruit's panel: his head, then four tabs. Overview: your chance, the Recruiting Battle, the Recruit Snapshot and
 * the Scout's Summary beside the week's actions. Scouting: your staff's report and his ratings. Profile: his traits and
 * background. History: the timeline, notes and who moved on his list.
 */
function RecruitPanel({
  r,
  board,
  team,
  seasonId,
  weekLabels,
  reload,
  coach,
  onBoard,
  onPick,
}: {
  r: BoardRow;
  board: RecruitingBoard;
  team: string;
  seasonId: string;
  weekLabels: Record<string, string>;
  reload: () => Promise<void>;
  coach: { name: string; face: FaceSpec } | null;
  /** whether a prospect is on your board */
  onBoard: (id: string) => boolean;
  /** open another recruit on the board (his Package Deal teammate) */
  onPick: (id: string) => void;
}) {
  const sd = standingOf(r, team);
  const stage = stageOf(r, team);
  // his list: your place on it, or why you have none
  const race = r.list.filter((x) => x.bar != null);
  const mine = race.find((x) => x.you || x.school === team);
  // once he has signed he has no list: the tile reads Yours (or Lost)
  const place = mine && !r.signed ? (mine.rank ?? race.indexOf(mine) + 1) : null;
  const listPlace = r.signed
    ? sd.word
    : place
      ? m.listPlace(place, Math.max(r.standing.of, race.length))
      : r.offered && !(r.signed || r.committed)
        ? m.outside
        : m.notOnIt;
  const askDefault = r.ask.exact ?? r.ask.hi ?? r.ask.lo ?? 0;
  const [nil, setNil] = useState(r.offered ? r.nil + 5 : askDefault);
  const openWeeks = r.visit_weeks.filter((w) => !w.taken_by && w.week > board.week);
  // a weekend's opponent by its letters, so the week and the team both show in the narrow picker
  const abbrOf = (name: string) => teamNamed(name)?.abbreviation ?? name;
  const [visitWeek, setVisitWeek] = useState<number | null>(openWeeks[0]?.week ?? null);
  // an offer can carry the promise of a starting role (once per recruit)
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // what your last action did is said for a moment, then the row is clear again
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);
  // what needs your attention with him: an icon in his head for as long as it holds, and a full line for a moment
  // when it starts while his file is open (your offer just cooled him)
  const weekOf = (w: number) => weekLabels[String(w)] ?? m.week(Math.max(0, w - 1));
  const alerts: { key: RecruitAlert; tip: string }[] = [];
  if (r.cooled) alerts.push({ key: "cooled", tip: m.cooled(r.cooled_why) });
  if (r.money_owed) alerts.push({ key: "owed", tip: m.moneyOwed(r.money_owed, weekOf(r.money_owed.by_week)) });
  if (r.pestering) alerts.push({ key: "pestered", tip: m.pestering });
  if (r.unpaid) alerts.push({ key: "unpaid", tip: m.unpaid(r.unpaid.name, r.unpaid.flip) });
  if (flipAlert(r)) alerts.push(flipAlert(r)!);
  const alertKeys = alerts.map((a) => a.key).join(",");
  const alertsWere = useRef({ id: "", keys: "" });
  const [flash, setFlash] = useState<string[]>([]);
  useEffect(() => {
    const was = alertsWere.current;
    alertsWere.current = { id: r.id, keys: alertKeys };
    if (was.id !== r.id) return setFlash([]);
    const fresh = alertKeys.split(",").filter((k) => k && !was.keys.split(",").includes(k));
    if (!fresh.length) return;
    setFlash((f) => [...new Set([...f, ...fresh])]);
    const t = setTimeout(() => setFlash((f) => f.filter((k) => !fresh.includes(k))), NOTE_MS);
    return () => clearTimeout(t);
  }, [r.id, alertKeys]);
  // the call or visit in its window: the one just opened, or the open one Finish brings back
  const [talk, setTalk] = useState<Scene | null>(null);
  const [tab, setTabState] = useState<Tab>(() => lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  // his file (the report, his traits, his background): read again whenever the board loads, since a look, an offer
  // or a call changes it; the last one stays up while the next arrives
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const fileOf = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    // a fresh read of the file already up is quiet: no "Loading…" for every tick on the board
    api<ProspectDetail>(`/api/season/${seasonId}/prospect/${encodeURIComponent(r.id)}`, {
      quiet: fileOf.current === r.id,
    })
      .then((d) => {
        if (!live) return;
        fileOf.current = r.id;
        setDetail(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seasonId, r.id, board]);

  useEffect(() => {
    setNil(r.offered ? r.nil + 5 : askDefault);
  }, [r.offered, r.nil, askDefault]);

  const weekName = (w: number) => weekLabels[String(w)] ?? m.week(Math.max(0, w - 1));
  const left = board.hours_left;
  const cost = (a: string) => board.hours_cost[a] ?? 0;
  const closed = !!(r.signed || (r.committed && r.committed !== team && r.hard));
  // the door is shut on you: he will not consider your program, or he cut his list without you
  const out = !closed && r.blocked && r.blocked.why !== "signed" ? r.blocked : null;

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api<{
        revealed?: string | null;
        scene?: Scene;
        money_owed?: MoneyOwed | null;
      }>(`/api/season/${seasonId}/recruit`, {
        method: "POST",
        body: { pid: r.id, action, ...extra },
      });
      if (out.scene) {
        // a call or visit opens as a conversation: the hours are spent, the rest happens in its window
        setTalk(out.scene);
        await reload();
        return;
      }
      const n = action === "scout" ? (detail?.scout_cost ?? 0) : Number(extra.nil ?? cost(action));
      const said = [
        action === "promise_role" ? m.promisedRole : (m.said[action]?.(r.name, n) ?? ""),
        out.revealed ? m.revealed(topicPhrase(out.revealed)) : "",
        // talking money is a promise: say so plainly
        out.money_owed ? m.moneyOwed(out.money_owed, weekName(out.money_owed.by_week)) : "",
      ];
      setNote(said.filter(Boolean).join(" "));
      await reload();
    } catch (e) {
      setNote(m.failed((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const toggleFavorite = async () => {
    try {
      await setFavorite(seasonId, r.id, !r.favorite);
      await reload();
    } catch (e) {
      setNote(m.failed((e as Error).message));
    }
  };
  // his Package Deal: open his teammate, putting him on your board first if he is not there
  // (either may be refused: a sim is running, or he left the pool when the portal closed. The game's reason is said,
  // never left as an error nobody sees: the stress run's find)
  const openMate = async (id: string) => {
    try {
      if (!onBoard(id)) {
        await setOnBoard(seasonId, [id], true);
        await reload();
      }
      onPick(id);
    } catch (e) {
      setNote(m.failed((e as Error).message));
    }
  };
  const offBoard = async () => {
    if (r.offered && !window.confirm(m.offBoardConfirm(r.name))) return;
    try {
      await setOnBoard(seasonId, [r.id], false);
      await reload();
    } catch (e) {
      setNote(m.failed((e as Error).message));
    }
  };

  // what waits for your offer: your head coach's visit (once a month, by how far he lives) and the starting job (free)
  const after = (
    key: string,
    label: string,
    Icon: typeof House,
    sub: string,
    off: boolean,
    why: string | undefined,
    go: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className="recruit__act"
      disabled={busy || closed || !!r.scene || off}
      title={why}
      onClick={go}
    >
      <Icon size={18} weight="bold" aria-hidden="true" />
      <b>{label}</b>
      <span>{sub}</span>
    </button>
  );
  const hcCost = r.hc_cost ?? cost("hc_visit");
  const hcWait = r.hc_wait ?? 0;

  return (
    <article className="recruit" aria-label={r.name}>
      {/* his head and the tab row stay at the top while the tab under them scrolls */}
      <div className="pin-top">
        {/* the head: who he is, your offer and your chance in words, and your place on his list in the square */}
        <ProfileHead
          face={<Face face={playerFace(r.id, r.display_pos)} scale={6} label="" />}
          name={r.name}
          beside={`${r.display_pos} · ${m.ranks(r.national_rank, r.pos_rank, r.display_pos)}`}
          // a transfer: the school he left where a recruit has his hometown (a transfer's town is often not on file)
          line={[
            r.height_display,
            r.weight_display,
            r.portal && r.from_name
              ? m.fromSchool(r.from_name)
              : [r.hometown.city, r.hometown.state].filter(Boolean).join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
          tags={
            <>
              {/* Visited says when, and how the game went, on hover */}
              {(() => {
                const tag = (
                  <HeadTag solid={stage === "committed"}>
                    {stage === "committed" && r.signed === team
                      ? m.signedStage
                      : stage === "top"
                        ? m.topN(r.top_size ?? 8)
                        : m.stageNames[stage]}
                  </HeadTag>
                );
                return stage === "visited" && r.visit?.done ? (
                  <VisitTip
                    seasonId={seasonId}
                    school={team}
                    week={r.visit.week}
                    done
                    weekName={weekLabels[String(r.visit.week)] ?? m.week(Math.max(0, r.visit.week - 1))}
                  >
                    {tag}
                  </VisitTip>
                ) : (
                  tag
                );
              })()}
              {out && <ClosedMark blocked={out} />}
              {/* a transfer has a class, not stars */}
              {r.portal ? r.cls && <HeadTag>{formatClass(r.cls)}</HeadTag> : <Stars n={r.stars} />}
              <RecruitFlags
                generational={r.generational}
                find={r.find}
                likes={r.likes}
                alerts={alerts}
                size={15}
                boxed
              />
              {r.job_promised && (
                <HeadTag tip={{ title: m.jobPromised, text: m.jobPromisedTip }}>{m.jobPromised}</HeadTag>
              )}
              <RivalPush rivals={r.rival_push} teamOf={schoolOf} bare />
            </>
          }
          cells={[
            { label: m.offer, value: r.offered ? m.nilAmount(r.nil) : m.noOffer },
            { label: m.chance, value: sd.odds ?? sd.word },
            {
              label: m.hisAsk,
              value: m.ask(r.ask.lo, r.ask.hi, r.ask.exact),
              // a range is what your scouts know so far
              tip:
                r.ask.exact == null && r.ask.lo != null && r.ask.hi != null ? m.askTip(r.ask.lo, r.ask.hi) : undefined,
            },
          ]}
          tile={{
            label: m.hisList,
            // your place on his list, big; off it (or once he is yours or gone), the word for where you stand
            value: place ? m.place(place) : sd.word === "Yours" || sd.word === "Lost" ? sd.word : listPlace,
            word: !place,
            aria: `${m.hisList}: ${listPlace}`,
            tip: { title: listPlace, text: sd.text },
          }}
        />

        {/* his tabs, what your last action did, and Off My Board, on one row */}
        <div className="recruit__bar">
          <div className="recruit__tabs" role="tablist" aria-label={m.about}>
            {TABS.map((k) => (
              <Chip key={k} role="tab" on={tab === k} onClick={() => setTab(k)}>
                {m.tabs[k]}
              </Chip>
            ))}
          </div>
          <p className="recruit__note" role="status" title={note ?? undefined}>
            {note}
          </p>
          <Tooltip title={m.favorite} text={r.favorite ? m.favoriteOnTip : m.favoriteTip}>
            <button
              type="button"
              className={`recruit__off${r.favorite ? " is-on" : ""}`}
              aria-label={r.favorite ? m.removeFavorite(r.name) : m.addFavorite(r.name)}
              aria-pressed={!!r.favorite}
              onClick={toggleFavorite}
            >
              <Heart size={16} weight={r.favorite ? "fill" : "bold"} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip title={m.offBoard} text={m.offBoardTip}>
            <button type="button" className="recruit__off" aria-label={m.offBoard} onClick={offBoard}>
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>

      {tab === "overview" && (
        <div className="recruit__overview" role="tabpanel" aria-label={m.tabs.overview}>
          {/* your commit, and another school is still calling him: said in that school's colors until it stops */}
          {(r.rival_push ?? [])
            .filter((x) => x.pressing)
            .map((x) => (
              <RivalWarn key={x.school} team={schoolOf(x.school)} text={m.pressed(x.name)} />
            ))}
          {r.unpaid && !flash.includes("unpaid") && (
            <p className="recruit__warn" role="status">
              {m.unpaid(r.unpaid.name, r.unpaid.flip)}
            </p>
          )}
          {alerts
            .filter((a) => flash.includes(a.key))
            .map((a) => (
              <p key={a.key} className="recruit__warn" role="status">
                {a.tip}
              </p>
            ))}

          {/* his recruitment is over: there is nothing to do beside the Overview, so it takes the whole width */}
          <div className={`recruit__cols${closed ? " is-closed" : ""}`}>
            <div className="recruit__col">
              <OverviewTab
                r={r}
                detail={detail}
                team={team}
                seasonId={seasonId}
                weekLabels={weekLabels}
                wide={closed}
              />
            </div>

            <div className="recruit__col">
              {/* the dead period: nobody can work a recruit until Signing Day */}
              {!closed && board.closed && (
                <Panel title={m.work} className="recruit__work">
                  <p className="recruiting__soft">{m.deadPeriod(board.signing ?? "")}</p>
                </Panel>
              )}
              {out && !board.closed && (
                <Panel title={m.work} className="recruit__work">
                  <ClosedDoor blocked={out} />
                  {/* your offer still stands until you pull it: the NIL it holds comes back */}
                  {r.offered && (
                    <div className="recruit__offer">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => window.confirm(m.pullConfirm(r.name)) && act("pull_offer")}
                      >
                        {m.pull}
                      </Button>
                    </div>
                  )}
                </Panel>
              )}
              {!closed && !out && !board.closed && (
                <Panel title={m.work} aside={m.hoursLeft(Math.round(left))} className="recruit__work">
                  {r.scene && (
                    <div className="recruit__open">
                      <span>{m.openTalk[r.scene.action]}</span>
                      <Button
                        onClick={() => {
                          setTalk(r.scene);
                        }}
                      >
                        {m.finishTalk[r.scene.action]}
                      </Button>
                    </div>
                  )}
                  <div className="recruit__offer">
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={nil}
                      aria-label={m.offer}
                      title={r.ask.exact == null && !r.offered ? m.askScout : undefined}
                      onChange={(e) => setNil(Math.max(0, Number(e.target.value) || 0))}
                    />
                    {r.offered ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy || nil <= r.nil}
                          onClick={() => act("raise_nil", { nil })}
                        >
                          {m.raise}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => window.confirm(m.pullConfirm(r.name)) && act("pull_offer")}
                        >
                          {m.pull}
                        </Button>
                      </>
                    ) : (
                      <Button disabled={busy || board.offers_left <= 0} onClick={() => act("offer", { nil })}>
                        {m.makeOffer(nil)}
                      </Button>
                    )}
                  </div>

                  {/* once he holds your offer: your head coach's visit, the starting job and a weekend on campus, a row each */}
                  <span className="label recruit__after">{m.afterOffer}</span>
                  <div className="recruit__acts">
                    {after(
                      "hc",
                      m.hcVisit,
                      House,
                      !r.offered ? m.hours(hcCost) : hcWait > 0 ? m.hcWait(hcWait) : m.hours(hcCost),
                      !r.offered || hcWait > 0 || left < hcCost,
                      !r.offered ? m.offerFirst : hcWait > 0 ? m.hcMonthly : left < hcCost ? m.notEnough : undefined,
                      () => act("hc_visit"),
                    )}
                    {after(
                      "promise",
                      m.promiseRole,
                      Handshake,
                      r.job_promised ? m.promised : m.promiseFree,
                      !r.offered || !!r.job_promised,
                      r.job_promised ? m.promisedTip : !r.offered ? m.offerFirst : m.promiseRoleHelp,
                      () => act("promise_role"),
                    )}
                  </div>

                  {!r.visit && openWeeks.length > 0 && (
                    <div className="recruit__visit">
                      <span className="label">{m.officialVisit}</span>
                      {/* the weekend's opponent in its colors, beside the picker */}
                      <Swatch team={teamNamed(openWeeks.find((w) => w.week === visitWeek)?.opponent_name)} size={24} />
                      <select
                        aria-label={m.pickWeekend}
                        disabled={!r.offered}
                        title={!r.offered ? m.offerFirst : undefined}
                        value={visitWeek ?? ""}
                        onChange={(e) => setVisitWeek(Number(e.target.value))}
                      >
                        {openWeeks.map((w) => (
                          <option key={w.week} value={w.week}>
                            {m.wk(w.week)} · {abbrOf(w.opponent_name)}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        disabled={
                          busy || !r.offered || left < (r.visit_cost ?? cost("official_visit")) || visitWeek == null
                        }
                        title={!r.offered ? m.offerFirst : undefined}
                        onClick={() => act("official_visit", { week: visitWeek })}
                      >
                        {m.invite(r.visit_cost ?? cost("official_visit"))}
                      </Button>
                    </div>
                  )}
                </Panel>
              )}
            </div>
          </div>
        </div>
      )}
      {tab !== "overview" && (
        <div role="tabpanel" aria-label={m.tabs[tab]}>
          {tab === "scouting" && (
            <ScoutingTab r={r} detail={detail} team={team} busy={busy} onScout={() => act("scout")} />
          )}
          {tab === "profile" && (
            <ProfileTab r={r} detail={detail} onMate={(id) => void openMate(id)} mateOnBoard={onBoard} />
          )}
          {tab === "history" && <HistoryTab r={r} team={team} />}
        </div>
      )}

      {talk && (
        <Conversation
          key={talk.id}
          open
          onClose={() => {
            setTalk(null);
            void reload().catch(() => {});
          }}
          seasonId={seasonId}
          r={r}
          scene={talk}
          pitches={board.pitches}
          coach={coach}
          onChange={() => void reload().catch(() => {})}
        />
      )}
    </article>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, Chat, ChatsCircle, Heart, House, MagnifyingGlass, Phone, Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Conversation from "../Conversation/index.tsx";
import Face from "../Face/index.tsx";
import ScoutMark from "../ScoutMark/index.tsx";
import { Stars, transferLine } from "../ProspectCard/index.tsx";
import { HistoryTab, OverviewTab, ProfileTab, ScoutingTab } from "../RecruitFile/index.tsx";
import Panel from "../Panel/index.tsx";
import ProfileHead, { HeadTag } from "../ProfileHead/index.tsx";
import RecruitStatus from "../RecruitStatus/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import { setFavorite, setOnBoard } from "../../board.ts";
import { playerFace, type Face as FaceSpec } from "../../faces.ts";
import { PITCH_NAMES, byChance, standingOf, statusOf } from "../../standing.ts";
import type { BoardRow, ProspectDetail, RecruitingBoard, Scene } from "../../types.ts";
import { messages as m } from "./messages.ts";
import RecruitFlags, { type RecruitAlert } from "../RecruitFlags/index.tsx";
import "./index.css";

/** *tune* How long what your last action did, and a warning that has just started, stay written out, in ms. */
const NOTE_MS = 6000;

/** The roster groups in order (the keys a need is counted under). */
const GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P", "ATH"];
const groupOf = (r: BoardRow) => r.group ?? r.display_pos;

interface Props {
  seasonId: string;
  /** your school */
  team: string;
  weekLabels: Record<string, string>;
  /** GET /recruiting (the game loads it; Energy reads the same) */
  board: RecruitingBoard | null;
  /** load it again after an action (hours, standings, the board) */
  reload: () => Promise<void>;
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
/** the filters that cut across the stages: your favorites (♥), and whether your staff's report on him is complete */
const ACROSS = {
  favorites: (r: BoardRow) => !!r.favorite,
  scouted: (r: BoardRow) => (r.looks ?? 0) >= FULL_REPORT,
  unscouted: (r: BoardRow) => (r.looks ?? 0) < FULL_REPORT,
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
  onFindProspects,
  coach = null,
  pick = null,
}: Props) {
  const [stage, setStage] = useState<StageKey>("all");
  const [sort, setSort] = useState<"chance" | "rank">("chance");
  // the list narrowed to a name (or a hometown) and to one position group
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("all");
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
  // what your class still needs: the groups with spots to fill
  const needs = GROUP_ORDER.filter((g) => (board?.needs?.[g] ?? 0) > 0);
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
            options={(["all", ...STAGES, "favorites", "scouted", "unscouted"] as StageKey[])
              .filter((s) => s === "all" || s === stage || counts[s])
              .map((s) => ({
                value: s,
                label: m.stageNames[s],
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
                count: posCounts[g],
                hint: (board?.needs?.[g] ?? 0) > 0 ? m.needN(board?.needs?.[g] ?? 0) : undefined,
              })),
            ]}
            onChange={setPos}
          />
          <Dropdown
            label={m.sort}
            icon={<ArrowsDownUp size={16} weight="bold" aria-hidden="true" />}
            size="md"
            align="right"
            value={sort}
            options={[
              { value: "chance", label: m.sortChance, hint: m.sortChanceHint },
              { value: "rank", label: m.sortRank, hint: m.sortRankHint },
            ]}
            onChange={(v) => setSort(v as "chance" | "rank")}
          />
          {/* your class's needs: a chip a position with spots to fill, each one a filter */}
          {needs.length > 0 && (
            <div className="recruiting__needs" role="group" aria-label={m.needs}>
              <span className="label recruiting__soft recruiting__needs-title" title={m.needsTip}>
                {m.needs}
              </span>
              {needs.map((g) => (
                <Chip key={g} on={pos === g} count={board?.needs?.[g]} onClick={() => setPos(pos === g ? "all" : g)}>
                  {g}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="recruiting__list">
          {groups.length === 0 && <p className="recruiting__soft">{m.noneAtStage}</p>}
          {groups.map((g) => (
            <section key={g.key} className="recruiting__group" aria-label={m.stageNames[g.key]}>
              {(stage === "all" || isAcross(stage)) && (
                <h2 className="label recruiting__group-title">
                  {m.stageNames[g.key]} <span>{g.rows.length}</span>
                </h2>
              )}
              <ul className="recruiting__rows">
                {g.rows.map((r) => {
                  // your place on his list, when you are on it
                  const race = r.list.filter((x) => x.bar != null);
                  const mine = race.find((x) => x.you || x.school === team);
                  const rank = mine ? (mine.rank ?? race.indexOf(mine) + 1) : null;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="recruiting__row"
                        aria-pressed={current?.id === r.id}
                        onClick={() => setPicked(r.id)}
                      >
                        <span className="face-tile recruiting__face">
                          <Face face={playerFace(r.id, r.display_pos)} scale={2} label="" />
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
                            {r.portal ? <span>{transferLine(r)}</span> : <Stars n={r.stars} size={10} />}
                            <ScoutMark looks={r.looks} size={12} />
                            <RecruitFlags generational={r.generational} find={r.find} likes={r.likes} size={11} />
                          </span>
                          {rank != null && <span className="recruiting__soft recruiting__place">{m.onList(rank)}</span>}
                        </span>
                        <span className="recruiting__standing">
                          <RecruitStatus status={statusOf(r, team)} />
                        </span>
                      </button>
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
  const place = mine ? (mine.rank ?? race.indexOf(mine) + 1) : null;
  const listPlace = place
    ? m.listPlace(place, Math.max(r.standing.of, race.length))
    : r.offered && !(r.signed || r.committed)
      ? m.outside
      : m.notOnIt;
  const askDefault = r.ask.exact ?? r.ask.hi ?? r.ask.lo ?? 0;
  const [nil, setNil] = useState(r.offered ? r.nil + 5 : askDefault);
  const openWeeks = r.visit_weeks.filter((w) => !w.taken_by && w.week > board.week);
  const [visitWeek, setVisitWeek] = useState<number | null>(openWeeks[0]?.week ?? null);
  // an offer can carry the promise of a starting role (once per recruit)
  const [promiseJob, setPromiseJob] = useState(false);
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
  if (r.money_owed) alerts.push({ key: "owed", tip: m.moneyOwed(r.money_owed.nil, weekOf(r.money_owed.by_week)) });
  if (r.pestering) alerts.push({ key: "pestered", tip: m.pestering });
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
  useEffect(() => {
    let live = true;
    api<ProspectDetail>(`/api/season/${seasonId}/prospect/${encodeURIComponent(r.id)}`)
      .then((d) => live && setDetail(d))
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
  const done = (a: string) => r.done_this_week.includes(a);
  const closed = !!(r.signed || (r.committed && r.committed !== team && r.hard));

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api<{
        revealed?: string | null;
        scene?: Scene;
        money_owed?: { nil: number; by_week: number } | null;
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
        extra.answer === "quick" ? m.quickCalled(r.name, cost("call")) : (m.said[action]?.(r.name, n) ?? ""),
        extra.answer === "promise" ? m.promisedRole : "",
        out.revealed ? m.revealed(PITCH_NAMES[out.revealed] ?? out.revealed) : "",
        // talking money is a promise: say so plainly
        out.money_owed ? m.moneyOwed(out.money_owed.nil, weekName(out.money_owed.by_week)) : "",
      ];
      setNote(said.filter(Boolean).join(" "));
      if (action === "offer") setPromiseJob(false);
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
  const openMate = async (id: string) => {
    if (!onBoard(id)) {
      await setOnBoard(seasonId, [id], true);
      await reload();
    }
    onPick(id);
  };
  const offBoard = async () => {
    if (r.offered && !window.confirm(m.offBoardConfirm(r.name))) return;
    await setOnBoard(seasonId, [r.id], false);
    await reload();
  };

  const timed = (action: string, label: string, Icon: typeof Chat, extra?: Record<string, unknown>, tip?: string) => {
    const c = cost(action);
    // your head coach visits a recruit once
    const hcSoon = action === "hc_visit" && r.hc_week != null;
    const off = busy || closed || !!r.scene || done(action) || hcSoon || left < c;
    const why = hcSoon ? m.hcOnce : done(action) ? m.doneThisWeek : left < c ? m.notEnough : (tip ?? undefined);
    return (
      <button
        type="button"
        className="recruit__act"
        disabled={off}
        title={why}
        onClick={() => act(action, extra ?? {})}
      >
        <Icon size={18} weight="bold" aria-hidden="true" />
        <b>{label}</b>
        <span>{hcSoon ? m.visited : done(action) ? m.done : m.hours(c)}</span>
      </button>
    );
  };

  return (
    <article className="recruit" aria-label={r.name}>
      {/* his head and the tab row stay at the top while the tab under them scrolls */}
      <div className="pin-top">
        {/* the head: who he is, your offer and your chance in words, and your place on his list in the square */}
        <ProfileHead
          face={<Face face={playerFace(r.id, r.display_pos)} scale={6} label="" />}
          name={r.name}
          beside={`${r.display_pos} · ${m.ranks(r.national_rank, r.pos_rank, r.display_pos)}`}
          line={[r.height_display, r.weight_display, `${r.hometown.city}, ${r.hometown.state}`].join(" · ")}
          tags={
            <>
              <HeadTag solid={stage === "committed"}>{m.stageNames[stage]}</HeadTag>
              <Stars n={r.stars} />
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
            </>
          }
          cells={[
            { label: m.offer, value: r.offered ? m.nilAmount(r.nil) : m.noOffer },
            { label: m.chance, value: sd.odds ?? sd.word },
            { label: m.hisAsk, value: m.ask(r.ask.lo, r.ask.hi, r.ask.exact) },
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
          <p className="recruit__note" role="status">
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
              <OverviewTab r={r} detail={detail} team={team} weekLabels={weekLabels} wide={closed} />
            </div>

            <div className="recruit__col">
              {!closed && (
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
                  <div className="recruit__acts">
                    {timed("message", m.message, Chat)}
                    {/* after his first call, Call is a quick check-in (the hours, a slight boost, no conversation) and
                        Call and Pitch talks again */}
                    {(r.calls ?? 0) > 0 ? (
                      <>
                        {timed("call", m.quickCall, Phone, { answer: "quick" }, m.quickCallTip)}
                        {timed("call", m.callAndPitch, ChatsCircle, undefined, m.callAndPitchTip)}
                      </>
                    ) : (
                      timed("call", m.call, Phone)
                    )}
                    {timed("hc_visit", m.hcVisit, House)}
                  </div>

                  <div className="recruit__offer">
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={nil}
                      aria-label={m.offer}
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
                      <Button
                        disabled={busy || board.offers_left <= 0}
                        onClick={() => act("offer", { nil, ...(promiseJob ? { answer: "promise" } : {}) })}
                      >
                        {m.makeOffer(nil)}
                      </Button>
                    )}
                  </div>

                  {!r.offered && !r.job_promised && (
                    <label className="recruit__promise">
                      <input type="checkbox" checked={promiseJob} onChange={(e) => setPromiseJob(e.target.checked)} />
                      <span>
                        <b>{m.promiseRole}</b>
                        <span className="recruiting__soft">{m.promiseRoleHelp}</span>
                      </span>
                    </label>
                  )}

                  {!r.visit && openWeeks.length > 0 && (
                    <div className="recruit__visit">
                      <span className="label">{m.officialVisit}</span>
                      <select
                        aria-label={m.pickWeekend}
                        value={visitWeek ?? ""}
                        onChange={(e) => setVisitWeek(Number(e.target.value))}
                      >
                        {openWeeks.map((w) => (
                          <option key={w.week} value={w.week}>
                            {w.label} · {w.opponent_name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        disabled={busy || !r.offered || left < cost("official_visit") || visitWeek == null}
                        onClick={() => act("official_visit", { week: visitWeek })}
                      >
                        {m.invite(cost("official_visit"))}
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
          {tab === "history" && <HistoryTab r={r} detail={detail} team={team} />}
        </div>
      )}

      {talk && (
        <Conversation
          key={talk.id}
          open
          onClose={() => {
            setTalk(null);
            void reload();
          }}
          seasonId={seasonId}
          r={r}
          scene={talk}
          pitches={board.pitches}
          coach={coach}
          onChange={() => void reload()}
        />
      )}
    </article>
  );
}

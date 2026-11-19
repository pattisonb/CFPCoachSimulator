import { useEffect, useMemo, useState } from "react";
import { Chat, ChatsCircle, Heart, House, Phone, Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Conversation from "../Conversation/index.tsx";
import Face from "../Face/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import { HistoryTab, OverviewTab, ProfileTab, ScoutingTab } from "../RecruitFile/index.tsx";
import Panel from "../Panel/index.tsx";
import ProfileHead, { HeadTag } from "../ProfileHead/index.tsx";
import RecruitStatus from "../RecruitStatus/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import { setFavorite, setOnBoard } from "../../board.ts";
import { playerFace, type Face as FaceSpec } from "../../faces.ts";
import { PITCH_NAMES, byChance, pullOf, standingOf, statusOf } from "../../standing.ts";
import type { BoardRow, ProspectDetail, RecruitingBoard, Scene } from "../../types.ts";
import { messages as m } from "./messages.ts";
import RecruitFlags from "../RecruitFlags/index.tsx";
import "./index.css";

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
/** the filter: every stage, one stage, or your favorites (♥), which cut across the stages */
type StageKey = (typeof STAGES)[number] | "all" | "favorites";

/** Committed to you counts as committed; committed or signed elsewhere is "gone". */
const stageOf = (r: BoardRow, me: string): (typeof STAGES)[number] => {
  const school = r.signed || r.committed;
  if (school) return school === me ? "committed" : "gone";
  return (STAGES as readonly string[]).includes(r.stage) ? (r.stage as (typeof STAGES)[number]) : "cold";
};

const pct = (p: number | null | undefined) => (p == null ? null : `${Math.round(100 * p)}%`);

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
  const [picked, setPicked] = useState<string | null>(null);
  // another section asked for him: show every stage (he may not be in the one filtered to) and pick him
  useEffect(() => {
    if (!pick) return;
    setStage("all");
    setPicked(pick);
  }, [pick]);

  const rows = useMemo(() => board?.board ?? [], [board]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[stageOf(r, team)] = (c[stageOf(r, team)] ?? 0) + 1;
    c.favorites = rows.filter((r) => r.favorite).length;
    return c;
  }, [rows, team]);
  const order = useMemo(
    () => (sort === "chance" ? byChance(team) : (a: BoardRow, b: BoardRow) => a.national_rank - b.national_rank),
    [sort, team],
  );
  const groups = useMemo(
    () =>
      STAGES.filter((s) => stage === "all" || stage === "favorites" || stage === s)
        .map((s) => ({
          key: s,
          rows: rows.filter((r) => stageOf(r, team) === s && (stage !== "favorites" || r.favorite)).sort(order),
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

  if (board && rows.length === 0)
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
          <Dropdown
            label={m.stages}
            hideLabel
            size="md"
            value={stage}
            // a stage with no one in it is left out (unless it is the one you are on)
            options={(["all", ...STAGES, "favorites"] as StageKey[])
              .filter((s) => s === "all" || s === stage || counts[s])
              .map((s) => ({
                value: s,
                label: m.stageNames[s],
                count: counts[s] ?? 0,
              }))}
            onChange={(s) => setStage(s as StageKey)}
          />
          <select
            className="recruiting__select"
            aria-label={m.sort}
            value={sort}
            onChange={(e) => setSort(e.target.value as "chance" | "rank")}
          >
            <option value="chance">{m.sortChance}</option>
            <option value="rank">{m.sortRank}</option>
          </select>
        </div>

        <div className="recruiting__list">
          {groups.length === 0 && <p className="recruiting__soft">{m.noneAtStage}</p>}
          {groups.map((g) => (
            <section key={g.key} className="recruiting__group" aria-label={m.stageNames[g.key]}>
              {(stage === "all" || stage === "favorites") && (
                <h2 className="label recruiting__group-title">
                  {m.stageNames[g.key]} <span>{g.rows.length}</span>
                </h2>
              )}
              <ul className="recruiting__rows">
                {g.rows.map((r) => {
                  const sd = standingOf(r, team);
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
                            <Stars n={r.stars} size={10} />
                            <RecruitFlags generational={r.generational} find={r.find} likes={r.likes} size={11} />
                          </span>
                        </span>
                        <span className="recruiting__standing">
                          <RecruitStatus status={statusOf(r, team)} />
                          {sd.pct != null && <span className="recruiting__pct">{pct(sd.pct)}</span>}
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
  const listPlace = mine
    ? m.listPlace(mine.rank ?? race.indexOf(mine) + 1, Math.max(r.standing.of, race.length))
    : r.offered && !(r.signed || r.committed)
      ? m.outside
      : m.notOnIt;
  const known = r.priorities_known;
  const best = known[0] ?? Object.entries(r.strength).sort((a, b) => b[1] - a[1])[0]?.[0] ?? board.pitches[0];
  const [pitch, setPitch] = useState(best);
  const askDefault = r.ask.exact ?? r.ask.hi ?? r.ask.lo ?? 0;
  const [nil, setNil] = useState(r.offered ? r.nil + 5 : askDefault);
  const openWeeks = r.visit_weeks.filter((w) => !w.taken_by && w.week > board.week);
  const [visitWeek, setVisitWeek] = useState<number | null>(openWeeks[0]?.week ?? null);
  // an offer can carry the promise of a starting role (once per recruit)
  const [promiseJob, setPromiseJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // the call or visit in its window: the one just opened, or the open one Finish brings back
  const [talk, setTalk] = useState<Scene | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
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
  const fit = m.pulls[pullOf(r.strength[pitch])];
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
        onClick={() => act(action, extra ?? (talks(action) ? {} : { pitch }))}
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
        {/* the head: who he is, your offer and your place on his list, and your chance in the square */}
        <ProfileHead
          face={<Face face={playerFace(r.id, r.display_pos)} scale={6} label="" />}
          name={r.name}
          beside={`${r.display_pos} · ${m.ranks(r.national_rank, r.pos_rank, r.display_pos)}`}
          line={[r.height_display, r.weight_display, `${r.hometown.city}, ${r.hometown.state}`].join(" · ")}
          tags={
            <>
              <HeadTag solid={stage === "committed"}>{m.stageNames[stage]}</HeadTag>
              <Stars n={r.stars} />
              <RecruitFlags generational={r.generational} find={r.find} likes={r.likes} size={15} boxed />
              {r.job_promised && (
                <HeadTag tip={{ title: m.jobPromised, text: m.jobPromisedTip }}>{m.jobPromised}</HeadTag>
              )}
            </>
          }
          cells={[
            { label: m.offer, value: r.offered ? m.nilAmount(r.nil) : m.noOffer },
            { label: m.hisList, value: listPlace },
            { label: m.hisAsk, value: m.ask(r.ask.lo, r.ask.hi, r.ask.exact) },
          ]}
          tile={{
            label: m.chance,
            value:
              sd.pct != null ? (
                <>
                  {Math.round(100 * sd.pct)}
                  <small>%</small>
                </>
              ) : (
                sd.word
              ),
            word: sd.pct == null,
            aria: `${m.chance}: ${pct(sd.pct) ?? sd.word}`,
            tip: { title: sd.odds ?? sd.word, text: sd.text },
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
          {r.cooled && <p className="recruit__warn">{m.cooled(r.cooled_why)}</p>}
          {r.money_owed && (
            <p className="recruit__warn">{m.moneyOwed(r.money_owed.nil, weekName(r.money_owed.by_week))}</p>
          )}
          {r.pestering && <p className="recruit__warn">{m.pestering}</p>}

          {/* his recruitment is over: there is nothing to do beside the Overview, so it takes the whole width */}
          <div className={`recruit__cols${closed ? " is-closed" : ""}`}>
            <div className="recruit__col">
              <OverviewTab r={r} detail={detail} team={team} weekLabels={weekLabels} wide={closed} />
            </div>

            <div className="recruit__col">
              {!closed && (
                <Panel title={m.work} aside={m.hoursLeft(Math.round(left))} className="recruit__work">
                  <label className="recruit__pitch">
                    <span className="label">{m.pitch}</span>
                    <select value={pitch} onChange={(e) => setPitch(e.target.value)}>
                      {board.pitches.map((p) => (
                        <option key={p} value={p}>
                          {PITCH_NAMES[p] ?? p}
                          {known.includes(p) ? " ★" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="recruiting__soft">{m.pitchFit(fit)}</span>
                  </label>
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
                        onClick={() => act("offer", { pitch, nil, ...(promiseJob ? { answer: "promise" } : {}) })}
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

/** A call or in-home visit is a conversation: it opens with no pitch (you choose one in its window). */
const talks = (action: string) => action === "call" || action === "hc_visit";

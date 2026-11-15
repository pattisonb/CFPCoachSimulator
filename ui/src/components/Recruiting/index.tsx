import { useEffect, useMemo, useState } from "react";
import { Chat, House, Phone, Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Conversation from "../Conversation/index.tsx";
import Face from "../Face/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import { api } from "../../api.ts";
import { setOnBoard } from "../../board.ts";
import { cachedTeams } from "../../teams.ts";
import { playerFace, type Face as FaceSpec } from "../../faces.ts";
import { PITCH_NAMES, byChance, pullOf, standingOf } from "../../standing.ts";
import type { BoardRow, RecruitingBoard, Scene } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  /** your school */
  team: string;
  year: number;
  weekLabels: Record<string, string>;
  /** GET /recruiting (the game loads it; Energy reads the same) */
  board: RecruitingBoard | null;
  /** load it again after an action (hours, standings, the board) */
  reload: () => Promise<void>;
  /** an empty board's Find Prospects: the Prospects tab */
  onFindProspects: () => void;
  /** your coach, beside your lines on a call or visit */
  coach?: { name: string; face: FaceSpec } | null;
}

/** *tune* How many recommended prospects an empty board's one click adds. */
const STARTER_BOARD = 10;

/** The board's groups, in order: where each recruit stands in his recruitment. */
const STAGES = ["committed", "visited", "top", "contact", "cold", "gone"] as const;
type StageKey = (typeof STAGES)[number] | "all";

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
  year,
  weekLabels,
  board,
  reload,
  onFindProspects,
  coach = null,
}: Props) {
  const [stage, setStage] = useState<StageKey>("all");
  const [sort, setSort] = useState<"chance" | "rank">("chance");
  const [picked, setPicked] = useState<string | null>(null);

  const rows = useMemo(() => board?.board ?? [], [board]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[stageOf(r, team)] = (c[stageOf(r, team)] ?? 0) + 1;
    return c;
  }, [rows, team]);
  const order = useMemo(
    () => (sort === "chance" ? byChance(team) : (a: BoardRow, b: BoardRow) => a.national_rank - b.national_rank),
    [sort, team],
  );
  const groups = useMemo(
    () =>
      STAGES.filter((s) => stage === "all" || stage === s)
        .map((s) => ({ key: s, rows: rows.filter((r) => stageOf(r, team) === s).sort(order) }))
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

  const setAuto = async (mode: string) => {
    await api(`/api/season/${seasonId}/settings`, { method: "POST", body: { auto_recruit: mode } });
    await reload();
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
          <p className="recruiting__lede">{m.classLine(year + 1, rows.length)}</p>
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
          <div className="recruiting__chips" role="group" aria-label={m.stages}>
            {(["all", ...STAGES] as StageKey[])
              .filter((s) => s === "all" || counts[s])
              .map((s) => (
                <Chip key={s} on={stage === s} count={counts[s] ?? 0} onClick={() => setStage(s)}>
                  {m.stageNames[s]}
                </Chip>
              ))}
          </div>
          <select
            className="recruiting__select"
            aria-label={m.sort}
            value={sort}
            onChange={(e) => setSort(e.target.value as "chance" | "rank")}
          >
            <option value="chance">{m.sortChance}</option>
            <option value="rank">{m.sortRank}</option>
          </select>
          {board && (
            <div className="recruiting__auto" role="group" aria-label={m.auto}>
              <span className="label">{m.auto}</span>
              {Object.keys(m.autoModes).map((k) => (
                <Chip key={k} on={board.auto_recruit === k} onClick={() => setAuto(k)}>
                  {m.autoModes[k]}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="recruiting__list">
          {groups.map((g) => (
            <section key={g.key} className="recruiting__group" aria-label={m.stageNames[g.key]}>
              {stage === "all" && (
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
                          <Face face={playerFace(r.id, r.display_pos)} scale={1} label="" />
                        </span>
                        <span className="recruiting__who">
                          <b>{r.name}</b>
                          <span className="recruiting__soft">
                            {r.display_pos} · {r.hometown.city}, {r.hometown.state}
                          </span>
                        </span>
                        <Stars n={r.stars} size={10} />
                        <span className={`recruiting__word is-${sd.tone}`}>{sd.word}</span>
                        <span className="recruiting__pct">{pct(sd.pct) ?? "–"}</span>
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
          />
        ) : (
          <p className="recruiting__soft">{m.pickOne}</p>
        )}
      </aside>
    </div>
  );
}

/** A recruit's panel: where you stand, his list, your offer, what he wants, and the week's actions. */
function RecruitPanel({
  r,
  board,
  team,
  seasonId,
  weekLabels,
  reload,
  coach,
}: {
  r: BoardRow;
  board: RecruitingBoard;
  team: string;
  seasonId: string;
  weekLabels: Record<string, string>;
  reload: () => Promise<void>;
  coach: { name: string; face: FaceSpec } | null;
}) {
  const sd = standingOf(r, team);
  const known = r.priorities_known;
  const best = known[0] ?? Object.entries(r.strength).sort((a, b) => b[1] - a[1])[0]?.[0] ?? board.pitches[0];
  const [pitch, setPitch] = useState(best);
  const askDefault = r.ask.exact ?? r.ask.hi ?? r.ask.lo ?? 0;
  const [nil, setNil] = useState(r.offered ? r.nil + 5 : askDefault);
  const openWeeks = r.visit_weeks.filter((w) => !w.taken_by && w.week > board.week);
  const [visitWeek, setVisitWeek] = useState<number | null>(openWeeks[0]?.week ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // the call or visit in its window: the one just opened, or the open one Finish brings back
  const [talk, setTalk] = useState<Scene | null>(null);

  useEffect(() => {
    setNil(r.offered ? r.nil + 5 : askDefault);
  }, [r.offered, r.nil, askDefault]);

  const left = board.hours_left;
  const cost = (a: string) => board.hours_cost[a] ?? 0;
  const done = (a: string) => r.done_this_week.includes(a);
  const fit = m.pulls[pullOf(r.strength[pitch])];
  const closed = !!(r.signed || (r.committed && r.committed !== team && r.hard));

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api<{ revealed?: string | null; scene?: Scene }>(`/api/season/${seasonId}/recruit`, {
        method: "POST",
        body: { pid: r.id, action, ...extra },
      });
      if (out.scene) {
        // a call or visit opens as a conversation: the hours are spent, the rest happens in its window
        setTalk(out.scene);
        await reload();
        return;
      }
      const said = m.said[action]?.(r.name, Number(extra.nil ?? cost(action))) ?? "";
      setNote(out.revealed ? `${said} ${m.revealed(PITCH_NAMES[out.revealed] ?? out.revealed)}` : said);
      await reload();
    } catch (e) {
      setNote(m.failed((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const offBoard = async () => {
    if (r.offered && !window.confirm(m.offBoardConfirm(r.name))) return;
    await setOnBoard(seasonId, [r.id], false);
    await reload();
  };

  const timed = (action: string, label: string, Icon: typeof Chat) => {
    const c = cost(action);
    const hcSoon = action === "hc_visit" && r.hc_week != null && board.week - r.hc_week < 4;
    const off = busy || closed || !!r.scene || done(action) || hcSoon || left < c;
    const why = done(action) || hcSoon ? m.doneThisWeek : left < c ? m.notEnough : undefined;
    return (
      <button
        type="button"
        className="recruit__act"
        disabled={off}
        title={why}
        onClick={() => act(action, talks(action) ? {} : { pitch })}
      >
        <Icon size={18} weight="bold" aria-hidden="true" />
        <b>{label}</b>
        <span>{done(action) || hcSoon ? m.done : m.hours(c)}</span>
      </button>
    );
  };

  return (
    <article className="recruit" aria-label={r.name}>
      <header className="recruit__head">
        <span className="face-tile recruit__face">
          <Face face={playerFace(r.id, r.display_pos)} scale={3} label="" />
        </span>
        <div className="recruit__who">
          <h2 className="recruit__name">{r.name}</h2>
          <Stars n={r.stars} />
          <span className="recruiting__soft">
            {[r.display_pos, r.height_display, r.weight_display, `${r.hometown.city}, ${r.hometown.state}`].join(" · ")}
          </span>
          <span className="recruit__ranks">{m.ranks(r.national_rank, r.pos_rank, r.display_pos)}</span>
        </div>
        <button type="button" className="recruit__off" title={m.offBoard} aria-label={m.offBoard} onClick={offBoard}>
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </header>

      <section className={`recruit__chance is-${sd.tone}`}>
        <span className="label">{m.chance}</span>
        <div className="recruit__chance-row">
          {sd.pct != null ? (
            <b className="recruit__big">{pct(sd.pct)}</b>
          ) : (
            <b className="recruit__word-big">{sd.word}</b>
          )}
          <span>
            <b>{sd.odds ?? sd.word}</b>
            <span className="recruiting__soft"> {sd.text}</span>
          </span>
        </div>
      </section>

      {r.cooled && <p className="recruit__warn">{m.cooled(r.cooled_why)}</p>}
      {r.pestering && <p className="recruit__warn">{m.pestering}</p>}

      <section className="recruit__block">
        <h3 className="label recruit__kicker">{m.hisList}</h3>
        {r.list.length ? (
          <ol className="recruit__list">
            {r.list.slice(0, 6).map((s) => (
              <li key={s.school} className={s.you || s.school === team ? "is-you" : undefined}>
                <span className="recruit__school">
                  {s.name}
                  {s.offered && <span className="recruit__tag">{m.offered}</span>}
                  {s.visit && (
                    <span className="recruit__tag">
                      {s.visit.done ? m.visited : m.visit(weekLabels[String(s.visit.week)] ?? m.week(s.visit.week - 1))}
                    </span>
                  )}
                </span>
                <span className="recruit__bar" aria-hidden="true">
                  <i style={{ width: `${Math.round(100 * (s.bar ?? 0))}%` }} />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="recruiting__soft">{m.noList}</p>
        )}
      </section>

      <div className="recruit__pair">
        <section className="recruit__block">
          <h3 className="label recruit__kicker">{m.offer}</h3>
          <b>{r.offered ? m.nilAmount(r.nil) : m.noOffer}</b>
          <span className="recruiting__soft">{m.ask(r.ask.lo, r.ask.hi, r.ask.exact)}</span>
        </section>
        <section className="recruit__block">
          <h3 className="label recruit__kicker" title={m.wantsTip}>
            {m.wants}
          </h3>
          <ul className="recruit__wants">
            {[0, 1, 2].map((i) => (
              <li key={i} className={known[i] ? undefined : "is-unknown"}>
                {known[i] ? (PITCH_NAMES[known[i]] ?? known[i]) : m.unknown}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {!closed && (
        <section className="recruit__block recruit__work">
          <h3 className="label recruit__kicker">{m.work}</h3>
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
            {timed("call", m.call, Phone)}
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
                <Button variant="outline" disabled={busy || nil <= r.nil} onClick={() => act("raise_nil", { nil })}>
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
              <Button disabled={busy || board.offers_left <= 0} onClick={() => act("offer", { pitch, nil })}>
                {m.makeOffer(nil)}
              </Button>
            )}
          </div>

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
        </section>
      )}

      <p className="recruit__note" role="status">
        {note}
      </p>

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

      {r.history.length > 0 && (
        <section className="recruit__block">
          <h3 className="label recruit__kicker">{m.recent}</h3>
          <ul className="recruit__history">
            {r.history.slice(0, 6).map((h, i) => (
              <li key={i}>
                <span className="recruit__when">{m.week(Math.max(0, h.week - 1))}</span>
                <span>{historyLine(h, team)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** A call or in-home visit is a conversation: it opens with no pitch (you choose one in its window). */
const talks = (action: string) => action === "call" || action === "hc_visit";

/** One line of his recruitment, in words. */
function historyLine(h: BoardRow["history"][number], team: string): string {
  if (h.line) return h.line;
  const who =
    h.school === team ? m.you : (cachedTeams()?.find((t) => t.slug === h.school)?.name ?? h.school ?? m.aSchool);
  if (h.kind === "offer") return m.hist.offer(who, h.nil);
  if (h.kind === "contact") return m.hist.contact(who, h.action);
  if (h.kind === "hung_up") return m.hist.hung_up(who);
  if (h.kind === "commit") return m.hist.commit(who);
  if (h.kind === "decommit") return m.hist.decommit(who);
  return `${who}: ${h.kind.replace(/_/g, " ")}.`;
}

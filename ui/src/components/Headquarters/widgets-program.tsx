import { useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import SchoolGrade from "../SchoolGrade/index.tsx";
import { PITCH_NAMES, standingOf } from "../../standing.ts";
import { cachedTeams } from "../../teams.ts";
import {
  Empty,
  Filtered,
  List,
  Meter,
  PName,
  RName,
  Stats,
  StarsShort,
  Table,
  Tag,
  plural,
  posOf,
  rowsFor,
} from "./kit.tsx";
import { messages as m } from "./messages.ts";
import {
  SAMPLE_BOARD,
  SAMPLE_CONTACTS,
  SAMPLE_DEPTH,
  SAMPLE_NEXT,
  SAMPLE_OUTLOOK,
  SAMPLE_PROGRAMS,
  SAMPLE_SEASON,
} from "./samples.ts";
import type {
  Ctx,
  DepthPlayer,
  HqBoard,
  HqRow,
  OutlookPlayer,
  ProgramRow,
  Sources,
  Task,
  TaskDo,
  WhatIf,
  Widget,
} from "./types.ts";
import { wkLong, wkShort } from "./widgets-recruiting.tsx";

// Headquarters: the widgets that look ahead (web/hq-widgets/outlook.js, program.js). Read-only views over the board,
// the depth chart, the season and the outlook, plus your own tasks and goals. Nothing here changes how games or
// recruiting play. Moods and chances are words; every empty case is a sentence.

type P = { d: Sources; ctx: Ctx };

/** *tune* Weeks without contact before an offered target goes stale (headquarters.STALE_WEEKS). */
const STALE_WEEKS = 3;
const SIGNING: Record<number, string> = { 15: m.earlySigning, 20: m.signingDay };
/** offseason.ROSTER_LIMIT */
const ROSTER_LIMIT = 85;

// ---------- the alerts (Alerts and Needs Attention, and Recruiting Tasks' suggestions) ----------
interface Alert {
  kind: string;
  pid?: string;
  name?: string;
  text: string;
  task?: string;
  do?: TaskDo;
}

/** The pitch to lead with when he cooled: the strongest of his known priorities. */
const bestPitch = (b: HqRow) => {
  const known = (b.priorities_known ?? []).filter((t) => b.strength?.[t] != null);
  known.sort((x, y) => b.strength[y] - b.strength[x]);
  return known.length ? (PITCH_NAMES[known[0]] ?? known[0]) : null;
};

function alertsOf(board: HqBoard, contacts: Record<string, number>, ctx: Ctx): Alert[] {
  const out: Alert[] = [];
  const week = board.week ?? 0;
  const rows = board.board ?? [];
  // first what you owe: a money promise has a deadline
  for (const b of rows) {
    const mo = b.money_owed;
    if (mo) {
      // the number once he is fully scouted; before that, an amount sure to cover it
      const nil = mo.nil ?? mo.sure ?? 0;
      out.push({
        kind: m.alertKinds.promise,
        pid: b.id,
        name: b.name,
        text:
          mo.nil != null
            ? m.alerts.money(b.name, nil, wkLong(mo.by_week))
            : m.alerts.moneySure(b.name, nil, wkLong(mo.by_week)),
        task: m.tasksFor.money(b.name, nil, wkLong(mo.by_week)),
        do: { kind: "nil", pid: b.id, nil },
      });
    }
  }
  // then who cooled on you, with what to do about it
  for (const b of rows) {
    if (!b.cooled || b.signed || (b.committed && b.committed !== ctx.team)) continue;
    const pitch = bestPitch(b);
    const why = b.cooled_why;
    out.push({
      kind: m.alertKinds.cooled,
      pid: b.id,
      name: b.name,
      text: m.alerts.cooled(b.name),
      task:
        why === "lowball"
          ? m.tasksFor.raise(b.name)
          : why === "promise"
            ? m.tasksFor.wait(b.name)
            : pitch
              ? m.tasksFor.callWith(b.name, pitch)
              : m.tasksFor.call(b.name),
      do: { kind: why === "lowball" ? "raise" : why === "promise" ? "wait" : "call", pid: b.id },
    });
  }
  for (const b of rows)
    if (b.pestering)
      out.push({
        kind: m.alertKinds.contact,
        pid: b.id,
        name: b.name,
        text: m.alerts.tuningOut(b.name),
        task: m.tasksFor.leave(b.name),
        do: { kind: "leave", pid: b.id },
      });
  for (const b of rows) {
    const school = b.signed || b.committed;
    if (b.offered && school && school !== ctx.team && (b.signed || b.hard))
      out.push({
        kind: m.alertKinds.offer,
        pid: b.id,
        name: b.name,
        text: m.alerts.lockedElsewhere(b.name),
        task: m.tasksFor.pull(b.name),
        do: { kind: "pull", pid: b.id },
      });
    else if (b.offered && !school) {
      const last = contacts[b.id];
      const gap = last == null ? null : week - last;
      if (gap == null || gap >= STALE_WEEKS)
        out.push({
          kind: m.alertKinds.contact,
          pid: b.id,
          name: b.name,
          text: gap == null ? m.alerts.neverHeard(b.name) : m.alerts.quiet(b.name, gap),
          task: m.tasksFor.call(b.name),
          do: { kind: "call", pid: b.id },
        });
    }
  }
  for (const b of (board.targets ?? []).slice(0, 5))
    if (!b.looks)
      out.push({
        kind: m.alertKinds.scout,
        pid: b.id,
        name: b.name,
        text: m.alerts.unscouted(b.name),
        task: m.tasksFor.scout(b.name),
        do: { kind: "scout", pid: b.id },
      });
  for (const [g, n] of Object.entries(board.needs_detail ?? {}))
    if (n.need > 0 && !n.board)
      out.push({
        kind: m.alertKinds.need,
        text: m.alerts.need(n.need, g),
        task: m.tasksFor.need(g),
        do: { kind: "need", group: g },
      });
  return out;
}

// ---------- Alerts and Needs Attention ----------
function Alerts({ d, ctx }: P) {
  const rows = alertsOf(d.board!, d.hq?.contacts ?? {}, ctx).slice(0, rowsFor(ctx.size));
  if (!rows.length) return <Empty>{m.noAlerts}</Empty>;
  // his name is the link; what is wrong reads after it as a sentence
  const rest = (a: Alert) => (a.name && a.text.startsWith(a.name) ? a.text.slice(a.name.length).trim() : a.text);
  return (
    <List className="hq-list--wrap">
      {rows.map((a, i) => (
        <li key={`${a.kind}-${a.pid ?? i}`}>
          <Tag>{a.kind}</Tag>
          {a.pid && a.name ? (
            <span className="hq-grow hq-wrap">
              <RName ctx={ctx} pid={a.pid} grow={false}>
                {a.name}
              </RName>{" "}
              <span className="hq-sub">{rest(a)}</span>
            </span>
          ) : (
            <span className="hq-grow hq-wrap">{a.text}</span>
          )}
        </li>
      ))}
    </List>
  );
}

// ---------- Board Health ----------
function BoardHealth({ d, ctx }: P) {
  const board = d.board!;
  const contacts = d.hq?.contacts ?? {};
  const week = board.week ?? 0;
  const h = { active: 0, stale: 0, risk: 0, unscouted: 0 };
  const live = (board.board ?? []).filter((b) => !(b.signed || b.committed) || (b.signed || b.committed) === ctx.team);
  for (const b of live) {
    if ((b.signed || b.committed) === ctx.team) {
      h.active++;
      continue;
    }
    const last = contacts[b.id];
    const word = b.sample_word ?? (ctx.sample || !b.list ? "In It" : standingOf(b, ctx.team).word);
    if (!b.looks) h.unscouted++;
    else if (word === "Long Shot") h.risk++;
    else if (last == null || week - last >= STALE_WEEKS) h.stale++;
    else h.active++;
  }
  if (!live.length) return <Empty>{m.boardEmpty}</Empty>;
  const meter = (label: string, n: number, soft?: boolean) => (
    <Meter label={label} words={m.xOfY(n, live.length)} frac={n / live.length} soft={soft} />
  );
  return (
    <div className="hq-stack">
      {meter(m.health.active, h.active)}
      {meter(m.health.stale, h.stale, true)}
      {meter(m.health.risk, h.risk, true)}
      {meter(m.health.unscouted, h.unscouted, true)}
    </div>
  );
}

// ---------- Offer Efficiency ----------
const rateWord = (n: number, of: number) =>
  !of ? m.rates.none : n / of >= 0.5 ? m.rates.strong : n / of >= 0.25 ? m.rates.fair : m.rates.low;
function OfferEfficiency({ d, ctx }: P) {
  const offered = (d.board?.board ?? []).filter((b) => b.offered || (b.signed || b.committed) === ctx.team);
  if (!offered.length) return <Empty>{m.noOffers}</Empty>;
  const visited = offered.filter((b) => b.visit?.done).length;
  const committed = offered.filter((b) => (b.signed || b.committed) === ctx.team).length;
  return (
    <div className="hq-stack">
      <Stats
        pairs={[
          [offered.length, m.offered],
          [visited, m.visited],
          [committed, m.committed],
        ]}
      />
      <Meter label={m.visitRate} words={rateWord(visited, offered.length)} frac={visited / offered.length} />
      <Meter label={m.commitRate} words={rateWord(committed, offered.length)} frac={committed / offered.length} />
    </div>
  );
}

// ---------- Position Battle Board ----------
const battleWord = (a: number, b?: number) =>
  // *tune* overall points apart on the shown scale (its middle is tighter than the old scale's)
  b == null ? m.battles.none : a - b >= 3 ? m.battles.secure : a - b >= 1 ? m.battles.close : m.battles.open;
function PositionBattles({ d, ctx }: P) {
  const rows: { unit: string; pos: string; a: DepthPlayer; b?: DepthPlayer; word: string }[] = [];
  for (const u of d.depth?.units ?? [])
    for (const r of u.rows ?? []) {
      const [a, b] = r.players ?? [];
      if (a)
        rows.push({ unit: u.name ?? "", pos: r.role ?? r.label ?? "", a, b, word: battleWord(a.overall, b?.overall) });
    }
  if (!rows.length) return <Empty>{m.noDepth}</Empty>;
  return (
    <Filtered
      id="position-battles"
      rows={rows}
      none={m.noBattlesMatch}
      cols={[
        ["unit", m.unit, (r) => r.unit],
        ["status", m.status, (r) => r.word],
      ]}
      render={(shown) => (
        <Table
          heads={[m.pos, m.starter, m.challenger, m.status]}
          rows={shown.slice(0, ctx.size === "L" ? shown.length : 8).map((r) => [
            r.pos,
            <PName key="a" ctx={ctx} name={r.a.name} pos={r.pos} />,
            r.b ? <PName key="b" ctx={ctx} name={r.b.name} pos={r.pos} /> : m.nobody,
            <Tag key="w" solid={r.word === m.battles.secure}>
              {r.word}
            </Tag>,
          ])}
        />
      )}
    />
  );
}

// ---------- Scholarship Budget ----------
function Scholarships({ d }: P) {
  const used = d.board?.committed ?? 0;
  const open = d.board?.open_spots ?? 0;
  const total = used + open;
  return (
    <div className="hq-stack">
      <Stats
        pairs={[
          [used, m.committed],
          [open, m.open],
        ]}
      />
      <Meter label={m.spotsFilled} words={m.xOfY(used, total)} frac={total ? used / total : 0} />
      <Empty>{m.rosterNote(ROSTER_LIMIT)}</Empty>
    </div>
  );
}

// ---------- Recruiting Calendar ----------
function Calendar({ d, ctx }: P) {
  const s = ctx.sample ? d.season : ctx.season;
  const from = (s?.current_week ?? 0) + 1;
  const items: [number, string, string][] = [];
  for (let w = from; w <= 20; w++) {
    const g = (s?.schedule ?? []).find((x) => x.week === w && x.opponent && !x.played);
    if (g) items.push([w, g.venue === "away" ? m.at(g.opponent_name) : m.vs(g.opponent_name), m.calKinds.game]);
    for (const b of d.board?.board ?? [])
      if (b.visit && !b.visit.done && b.visit.week === w) items.push([w, m.onVisit(b.name), m.calKinds.visit]);
    if (SIGNING[w]) items.push([w, SIGNING[w], m.calKinds.signing]);
  }
  if (!items.length) return <Empty>{m.noCalendar}</Empty>;
  return (
    <List>
      {items.slice(0, rowsFor(ctx.size)).map(([w, text, kind], i) => (
        <li key={`${w}-${i}`}>
          <Tag solid={kind === m.calKinds.signing}>{wkShort(ctx, w)}</Tag>
          <span className="hq-grow">{text}</span>
          <span className="hq-sub">{kind}</span>
        </li>
      ))}
    </List>
  );
}

// ---------- What-If ----------
function WhatIfWidget({ d, ctx }: P) {
  const [pid, setPid] = useState("");
  const [out, setOut] = useState<WhatIf | "busy" | "failed" | null>(null);
  const pool = [...(d.board?.targets ?? []), ...(d.board?.board ?? [])].filter(
    (b, i, all) => all.findIndex((x) => x.id === b.id) === i && !(b.signed || b.committed),
  );
  const result = (w: WhatIf) => (
    <div className="hq-stack">
      <Stats
        pairs={[
          [d.board?.committed ? `#${w.rank_now}` : m.unranked, m.rankNow],
          [`#${w.rank_if}`, m.rankIf],
        ]}
      />
      <Empty>{w.need_now > 0 ? m.fillsNeed(w.group, w.need_now, w.need_if) : m.noNeedAt(w.group)}</Empty>
    </div>
  );
  if (ctx.sample) return d.whatif ? result(d.whatif) : null;
  if (!pool.length) return <Empty>{m.whatIfEmpty}</Empty>;
  const pick = async (id: string) => {
    setPid(id);
    if (!id || !ctx.season) return setOut(null);
    setOut("busy");
    try {
      const r = await ctx.get<{ whatif: WhatIf }>(
        `/api/season/${ctx.season.id}/headquarters?want=whatif&pid=${encodeURIComponent(id)}`,
      );
      setOut(r.whatif);
    } catch {
      setOut("failed");
    }
  };
  return (
    <div className="hq-stack">
      <select className="hq-input" aria-label={m.pickRecruit} value={pid} onChange={(e) => void pick(e.target.value)}>
        <option value="">{m.pickRecruit}</option>
        {pool.slice(0, 40).map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {posOf(b)}
          </option>
        ))}
      </select>
      {out === "busy" ? (
        <Empty>{m.working}</Empty>
      ) : out === "failed" ? (
        <Empty>{m.failedTry}</Empty>
      ) : out ? (
        result(out)
      ) : null}
    </div>
  );
}

// ---------- Player Impact and Retention ----------
function SeniorImpact({ d, ctx }: P) {
  // in the offseason a player's real outcome replaces the projection: gone, going or kept
  const gone = (p: OutlookPlayer) =>
    !!p.next && p.next.status !== "returning" && !(p.next.status === "transfer_in" && p.next.team === ctx.team);
  const ps = (d.hq?.outlook?.players ?? [])
    .filter((p) => gone(p) || (!p.next && (p.leaving || p.draft || (p.starter && p.transfer === "High"))))
    .sort((a, b) => Number(b.starter) - Number(a.starter) || b.overall - a.overall);
  if (!ps.length) return <Empty>{m.nobodyLeaving}</Empty>;
  const outcome = (n: NonNullable<OutlookPlayer["next"]>) =>
    n.status === "transfer_in"
      ? m.transferredTo(n.team_name ?? "")
      : n.status === "portal"
        ? m.inPortal
        : (n.status_name ?? "");
  const why = (p: OutlookPlayer) =>
    gone(p) ? outcome(p.next!) : p.leaving ? m.graduating : p.draft ? m.draft(p.draft) : m.transferRisk;
  const rep = (p: OutlookPlayer) =>
    p.replacement ? (
      <span className="hq-pair">
        <RName ctx={ctx} pid={p.replacement.pid} grow={false}>
          {p.replacement.name}
        </RName>
        <Tag solid={p.replacement.status === "Committed"}>{p.replacement.status}</Tag>
      </span>
    ) : (
      <span className="hq-sub">{m.nobodyYet}</span>
    );
  const role = (p: OutlookPlayer) => (p.starter ? m.starter : m.reserve);
  return (
    <Filtered
      id="senior-impact"
      rows={ps}
      cols={[
        ["pos", m.pos, (p) => p.position],
        ["role", m.role, role],
        ["cls", m.classCol, (p) => p.class],
        ["outlook", m.outlook, why],
        ["rep", m.replacement, (p) => p.replacement?.status ?? m.nobodyYet],
      ]}
      render={(all) => {
        const shown = all.slice(0, rowsFor(ctx.size));
        const name = (p: OutlookPlayer) => <PName key="n" ctx={ctx} name={p.name} />;
        return ctx.size === "L" ? (
          <Table
            heads={[m.player, m.pos, m.classCol, m.role, m.outlook, m.replacement]}
            rows={shown.map((p) => [name(p), p.position, p.class, role(p), <Tag key="w">{why(p)}</Tag>, rep(p)])}
          />
        ) : (
          <Table
            heads={[m.player, m.pos, m.outlook, m.replacement]}
            rows={shown.map((p) => [name(p), p.position, <Tag key="w">{why(p)}</Tag>, rep(p)])}
          />
        );
      }}
    />
  );
}

// ---------- Roster Loss Projections ----------
/** *tune* A year's projected losses as a word. */
const lossWord = (n: number) => (n >= 30 ? m.losses.heavy : n >= 18 ? m.losses.normal : m.losses.light);
function RosterLoss({ d, ctx }: P) {
  const c = d.hq?.outlook?.counts;
  if (!c) return <Empty>{m.noRoster}</Empty>;
  const total = c.graduation + c.draft_likely + c.transfer_high;
  const by: Record<string, number> = {};
  if (ctx.size === "M")
    for (const p of d.hq?.outlook?.players ?? [])
      if (p.leaving || p.draft === "Likely" || p.transfer === "High") by[p.position] = (by[p.position] ?? 0) + 1;
  const top = Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <div className="hq-stack">
      <Stats
        pairs={[
          [c.graduation, m.graduating],
          [c.draft, m.mayDeclare],
          [c.transfer_high, m.transferRisk],
        ]}
      />
      <Meter label={m.projectedLosses} words={lossWord(total)} frac={Math.min(1, total / 40)} soft={total < 18} />
      {top.length > 0 && <Table heads={[m.pos, m.couldLeave]} rows={top.map(([p, n]) => [p, n])} />}
    </div>
  );
}

// ---------- Recruiting Tasks ----------
const nextTaskId = (ts: Task[]) => {
  const used = new Set(ts.map((t) => t.id));
  let n = 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
};
function Tasks({ d, ctx }: P) {
  const [text, setText] = useState("");
  const tasks = d.hq?.tasks ?? [];
  const save = (next: Task[]) => void ctx.savePlan({ tasks: next });
  const addNow = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    save([...tasks, { id: nextTaskId(tasks), text: t, done: false }]);
  };
  const have = new Set(tasks.map((t) => t.text));
  const ideas = d.board
    ? alertsOf(d.board, d.hq?.contacts ?? {}, ctx)
        .filter((a) => a.task && !have.has(a.task))
        .slice(0, 3)
    : [];
  const week = ctx.season?.current_week ?? 0;
  return (
    <div className="hq-stack">
      <div className="hq-row">
        <input
          type="text"
          className="hq-input"
          placeholder={m.addTask}
          aria-label={m.addTask}
          maxLength={120}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNow()}
        />
        <button type="button" className="hq-btn" onClick={addNow}>
          {m.add}
        </button>
      </div>
      {tasks.length ? (
        <List className="hq-list--wrap">
          {tasks.map((t) => (
            <li key={t.id} className={`hq-task${t.done ? " is-done" : ""}`}>
              {/* your own tick: unticking one the game ticked for you holds, so it is not ticked again */}
              <button
                type="button"
                className="hq-check"
                role="checkbox"
                aria-checked={t.done}
                aria-label={t.text}
                title={t.auto ? m.doneForYou : undefined}
                onClick={() =>
                  save(
                    tasks.map((x) =>
                      x.id === t.id
                        ? { ...x, done: !x.done, ...(x.done && x.auto ? { manual: true, auto: false } : {}) }
                        : x,
                    ),
                  )
                }
              >
                {t.done && <Check size={14} weight="bold" aria-hidden="true" />}
              </button>
              <span className="hq-grow hq-wrap">
                {t.text}
                {t.note && <span className="hq-sub"> {t.note}</span>}
              </span>
              <button
                type="button"
                className="hq-btn hq-btn--icon"
                aria-label={m.deleteTask(t.text)}
                onClick={() => save(tasks.filter((x) => x.id !== t.id))}
              >
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            </li>
          ))}
        </List>
      ) : (
        <Empty>{m.noTasks}</Empty>
      )}
      {ideas.length > 0 && (
        <List className="hq-list--wrap">
          {ideas.map((a) => (
            <li key={a.task}>
              <Tag soft>{m.suggested}</Tag>
              <span className="hq-grow hq-wrap">{a.task}</span>
              {/* a suggestion carries what it asks: the task ticks itself once you do it */}
              <button
                type="button"
                className="hq-btn"
                onClick={() =>
                  save([
                    ...tasks,
                    { id: nextTaskId(tasks), text: a.task!, done: false, ...(a.do ? { do: a.do, since: week } : {}) },
                  ])
                }
              >
                {m.add}
              </button>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------- Recruiting Goals ----------
function Goals({ d, ctx }: P) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const gs = d.hq?.goals ?? [];
  if (!gs.length) return <Empty>{m.noGoals}</Empty>;
  return (
    <div className="hq-stack">
      {gs.map((g) => {
        const isRank = g.id === "rank";
        const label = isRank ? `${g.title} ${g.target}` : g.title;
        const words = isRank ? (g.now == null ? m.unranked : `#${g.now}`) : m.xOfY(g.now ?? 0, g.target);
        const frac = isRank
          ? g.now == null
            ? 0
            : Math.min(1, g.target / g.now)
          : g.target
            ? (g.now ?? 0) / g.target
            : 0;
        const commit = () => {
          const n = parseInt(draft, 10);
          setEditing(null);
          if (n >= 1 && n <= 200 && n !== g.target) void ctx.savePlan({ goals: { [g.id]: n } });
        };
        return (
          <div key={g.id} className="hq-goal">
            <Meter label={label} words={words} frac={frac} />
            <div className="hq-row">
              <Tag solid={g.met}>{g.met ? m.met : m.onTheWay}</Tag>
              <span className="hq-grow" />
              {!ctx.sample && editing === g.id ? (
                <input
                  type="number"
                  className="hq-input hq-input--num"
                  min={1}
                  max={200}
                  autoFocus
                  aria-label={m.targetFor(label)}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="hq-link"
                  aria-label={m.editGoal(label)}
                  onClick={() => {
                    setDraft(String(g.target));
                    setEditing(g.id);
                  }}
                >
                  {m.editTarget}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Program Comparison ----------
function ProgramCompare({ d, ctx }: P) {
  const pv = d.programs ?? {};
  const mine = pv.you?.team ?? ctx.team;
  const colors = new Map((cachedTeams() ?? []).map((t) => [t.slug, t.colors]));
  const others = (pv.rows ?? []).filter((r) => r.team !== mine).slice(0, ctx.size === "L" ? 7 : 4);
  const rows = pv.you ? [pv.you, ...others] : others;
  if (!rows.length) return <Empty>{m.noPrograms}</Empty>;
  // each grade as the game sent it (a letter, A+ to F): yours in your colors, another program's in its own
  const w = (r: ProgramRow, k: string) => {
    const l = r.letters?.[k];
    return (
      <SchoolGrade
        grade={typeof l === "string" ? l : null}
        size="sm"
        colors={r.team === mine ? undefined : colors.get(r.team)}
      />
    );
  };
  return ctx.size === "L" ? (
    <Table
      heads={[m.program, m.tier, m.prestige, m.winning, m.nil, m.proPipeline]}
      rows={rows.map((r) => [r.name, r.tier_name, w(r, "prestige"), w(r, "winning"), w(r, "nil"), w(r, "pro")])}
      mine={(i) => rows[i].team === mine}
    />
  ) : (
    <Table
      heads={[m.program, m.prestige, m.winning, m.nil]}
      rows={rows.map((r) => [r.name, w(r, "prestige"), w(r, "winning"), w(r, "nil")])}
      mine={(i) => rows[i].team === mine}
    />
  );
}

// ---------- Next Year's Depth Chart ----------
/** this browser's own: the positions picked to show, and which recruits show besides your commits */
const NEXT_KEY = "cfp-hq-next-groups";
const SHOW_KEY = "cfp-hq-next-show";
const OPTS_KEY = "cfp-hq-next-opts";
const SHOW = ["commits", "offered", "board", "contacted"] as const;
/** the positions of each side of the ball, for the chips that pick a whole side */
const SIDES = [
  ["offense", ["QB", "RB", "WR", "TE", "OT", "OG", "C", "OL"]],
  ["defense", ["EDGE", "DT", "DL", "MIKE", "WILL", "LB", "CB", "FS", "SS", "S"]],
] as const;
const stored = (key: string, fallback: string[]): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(v) ? (v as string[]) : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, v: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* a private window: kept for the visit */
  }
};
function NextDepth({ d, ctx }: P) {
  const groups = d.hq?.next_year?.groups ?? [];
  const [picked, setPicked] = useState<string[]>(() => stored(NEXT_KEY, []));
  const [show, setShow] = useState<string[]>(() => stored(SHOW_KEY, ["commits"]));
  /** how it is laid out: "need" puts the positions that need the most first, "vertical" stands each one up as a column */
  const [opts, setOpts] = useState<string[]>(() => stored(OPTS_KEY, []));
  if (!groups.length) return <Empty>{m.noRoster}</Empty>;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const pickGroup = (g: string) => {
    let next = g ? toggle(picked, g) : [];
    if (next.length === groups.length) next = []; // every group picked is All
    setPicked(next);
    store(NEXT_KEY, next);
  };
  // a side's positions among the ones this roster has; picked again, it goes back to All
  const sideOf = (of: readonly string[]) => groups.map((g) => g.group).filter((g) => of.includes(g));
  const isSide = (of: readonly string[]) => {
    const side = sideOf(of);
    return side.length > 0 && side.length === picked.length && side.every((g) => picked.includes(g));
  };
  const pickSide = (of: readonly string[]) => {
    const next = isSide(of) ? [] : sideOf(of);
    setPicked(next);
    store(NEXT_KEY, next);
  };
  const pickShow = (k: string) => {
    const next = toggle(show, k);
    setShow(next);
    store(SHOW_KEY, next);
  };
  const pickOpt = (k: string) => {
    const next = toggle(opts, k);
    setOpts(next);
    store(OPTS_KEY, next);
  };
  const listed = groups.filter((g) => !picked.length || picked.includes(g.group));
  // by need: the most players short first, the rest in the depth chart's order
  const shown = opts.includes("need") ? [...listed].sort((a, b) => b.need - a.need) : listed;
  const vertical = opts.includes("vertical");
  return (
    <div className="hq-stack">
      <div className="hq-row" role="group" aria-label={m.positionsToShow}>
        <Chip on={!picked.length} onClick={() => pickGroup("")}>
          {m.all}
        </Chip>
        {/* a whole side at once: its positions picked together */}
        {SIDES.map(([key, of]) => (
          <Chip key={key} on={isSide(of)} onClick={() => pickSide(of)}>
            {m.sides[key]}
          </Chip>
        ))}
        {groups.map((g) => (
          <Chip key={g.group} on={picked.includes(g.group)} onClick={() => pickGroup(g.group)}>
            {g.group}
          </Chip>
        ))}
      </div>
      <div className="hq-row" role="group" aria-label={m.recruitsToShow}>
        {SHOW.map((k) => (
          <Chip key={k} on={show.includes(k)} onClick={() => pickShow(k)}>
            {m.showNames[k]}
          </Chip>
        ))}
        <span className="hq-grow" />
        <Chip on={opts.includes("need")} onClick={() => pickOpt("need")}>
          {m.sortByNeed}
        </Chip>
        <Chip on={vertical} onClick={() => pickOpt("vertical")}>
          {m.viewVertical}
        </Chip>
      </div>
      {/* a lane a position: its name and need at the left, its players in one line that scrolls sideways. Every lane
          is one height and the lanes' window never changes size, so picking positions with more or fewer players
          cannot move the card (the player's ask). Vertical stands each position up as a column in the same window,
          its players down it */}
      <div
        className={vertical ? "hq-lanes is-vertical" : "hq-lanes"}
        role="region"
        aria-label={m.nextDepthLabel}
        tabIndex={0}
      >
        {shown.map((g) => (
          <section key={g.group} className="hq-lane">
            <header className="hq-lane__head">
              <span className="hq-lane__name">
                <b>{g.group}</b>
                <Tag solid={g.need <= 0}>{g.need > 0 ? m.needN(g.need) : m.full}</Tag>
              </span>
              <span className="hq-sub hq-lane__sub">
                {m.returning(g.players.length)}
                {g.commits.length ? ` · ${plural(g.commits.length, m.commit)}` : ""}
              </span>
            </header>
            <ul className="hq-lane__strip">
              {show.includes("commits") &&
                g.commits.map((c) => (
                  <li className="hq-lane__item" key={`c-${c.pid}`}>
                    <Tag solid>{c.signed ? m.signed : m.commit}</Tag>
                    <RName ctx={ctx} pid={c.pid} pos={posOf(c)}>
                      {c.name}
                    </RName>
                    <span className="hq-sub">{c.position}</span>
                    <StarsShort n={c.stars} />
                  </li>
                ))}
              {(g.targets ?? [])
                .filter((c) => show.includes(c.kind))
                .map((c) => (
                  <li className="hq-lane__item" key={`t-${c.kind}-${c.pid}`}>
                    <Tag soft>{m.kindTags[c.kind]}</Tag>
                    <RName ctx={ctx} pid={c.pid} pos={posOf(c)}>
                      {c.name}
                    </RName>
                    <span className="hq-sub">{c.position}</span>
                    <StarsShort n={c.stars} />
                  </li>
                ))}
              {g.players.map((p, i) => (
                <li className="hq-lane__item" key={`p-${i}-${p.name}`}>
                  <Tag>{p.class_next}</Tag>
                  <PName ctx={ctx} name={p.name} />
                  {p.draft && <span className="hq-sub">{m.draft(p.draft)}</span>}
                  <b className="hq-num">{p.overall}</b>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------- Promises: every promise you have out, to your players and to recruits ----------
/** A promise as a row: who, what was promised and where it stands. */
interface PromiseRow {
  key: string;
  /** a recruit's id (his name opens his file) */
  pid?: string;
  name: string;
  pos: string;
  what: string;
  status: string;
}
/**
 * The game's own tracker (career_js/headquarters.js promises_tracker): a starting role, a start over a named
 * player, ahead of another recruit, an offer to his teammate, NIL by a week; each Open, Kept, Broken, Due or Owed Next
 * Season. A game that does not send it yet falls back to what the depth chart and the board show.
 */
function promiseRows(d: P["d"], ctx: Ctx): { players: PromiseRow[]; recruits: PromiseRow[] } {
  const t = d.hq?.promises;
  if (t)
    return {
      players: t.players.map((p) => ({
        key: p.slug,
        name: p.name,
        pos: p.position,
        what: m.promiseWhat.role,
        status: p.status,
      })),
      recruits: t.recruits.map((r) => ({
        key: r.key,
        pid: r.pid,
        name: r.name,
        pos: r.position ?? "",
        what: r.what,
        status: r.status,
      })),
    };
  const players: PromiseRow[] = [];
  const seen = new Set<string>();
  for (const u of d.depth?.units ?? [])
    for (const r of u.rows ?? [])
      for (const p of r.players ?? [])
        if (p.promise && !seen.has(p.slug ?? p.name)) {
          seen.add(p.slug ?? p.name);
          players.push({
            key: p.slug ?? p.name,
            name: p.name,
            pos: p.position ?? r.role ?? "",
            what: m.promiseWhat.role,
            status: p.promise,
          });
        }
  const recruits: PromiseRow[] = [];
  for (const b of d.board?.board ?? []) {
    const school = b.signed || b.committed;
    if (school && school !== ctx.team) continue; // closed: he went elsewhere
    const who = { pid: b.id, name: b.name, pos: posOf(b) };
    if (b.job_promised)
      recruits.push({
        ...who,
        key: `${b.id}-job`,
        what: m.promiseWhat.role,
        status: b.signed ? m.promiseStatus.owed : m.promiseStatus.open,
      });
    if (b.money_owed)
      recruits.push({
        ...who,
        key: `${b.id}-nil`,
        what: m.promiseWhat.nil(b.money_owed.nil),
        status: m.promiseStatus.due(wkLong(b.money_owed.by_week)),
      });
  }
  return { players, recruits };
}

function Promises({ d, ctx }: P) {
  const { players, recruits } = promiseRows(d, ctx);
  if (!players.length && !recruits.length) return <Empty>{m.noPromises}</Empty>;
  const good = (s: string) => s === "On Track" || s === "Kept";
  const group = (title: string, rows: PromiseRow[]) =>
    rows.length > 0 && (
      <div>
        <h4 className="label hq-kicker">{title}</h4>
        <List>
          {rows.slice(0, rowsFor(ctx.size)).map((r) => (
            <li key={r.key}>
              {r.pid ? (
                <RName ctx={ctx} pid={r.pid} pos={posOf(r)}>
                  {r.name}
                </RName>
              ) : (
                <PName ctx={ctx} name={r.name} pos={r.pos} />
              )}
              <span className="hq-sub">{r.pos}</span>
              {ctx.size !== "S" && <span className="hq-sub">{r.what}</span>}
              <Tag solid={good(r.status)} soft={r.status === "Broken"}>
                {r.status}
              </Tag>
            </li>
          ))}
        </List>
      </div>
    );
  return (
    <div className="hq-stack">
      {group(m.yourPlayers, players)}
      {group(m.recruits, recruits)}
    </div>
  );
}
export const PROGRAM_WIDGETS: Widget[] = [
  {
    id: "alerts",
    ...m.w.alerts,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["board", "hq"],
    want: ["contacts"],
    viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD, hq: { contacts: SAMPLE_CONTACTS } },
    Draw: Alerts,
  },
  {
    id: "board-health",
    ...m.w.boardHealth,
    category: "scouting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board", "hq"],
    want: ["contacts"],
    viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD, hq: { contacts: SAMPLE_CONTACTS } },
    Draw: BoardHealth,
  },
  {
    id: "offer-efficiency",
    ...m.w.offerEfficiency,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board"],
    viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD },
    Draw: OfferEfficiency,
  },
  {
    id: "position-battles",
    ...m.w.positionBattles,
    category: "program",
    sizes: ["M", "L"],
    size: "M",
    sources: ["depth"],
    viewAll: "depth",
    sample: { depth: SAMPLE_DEPTH },
    Draw: PositionBattles,
  },
  {
    id: "scholarships",
    ...m.w.scholarships,
    category: "program",
    sizes: ["S"],
    size: "S",
    sources: ["board"],
    viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD },
    Draw: Scholarships,
  },
  {
    id: "calendar",
    ...m.w.calendar,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["board"],
    viewAll: "schedule",
    sample: { board: SAMPLE_BOARD, season: SAMPLE_SEASON },
    Draw: Calendar,
  },
  {
    id: "what-if",
    ...m.w.whatIf,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["board"],
    sample: {
      board: SAMPLE_BOARD,
      whatif: { name: "Marcus Williams", group: "CB", rank_now: 14, rank_if: 9, need_now: 2, need_if: 1 },
    },
    Draw: WhatIfWidget,
  },
  {
    id: "senior-impact",
    ...m.w.seniorImpact,
    category: "program",
    sizes: ["M", "L"],
    size: "M",
    sources: ["hq"],
    want: ["outlook"],
    viewAll: "depth",
    sample: { hq: { outlook: SAMPLE_OUTLOOK } },
    Draw: SeniorImpact,
  },
  {
    id: "roster-loss",
    ...m.w.rosterLoss,
    category: "program",
    sizes: ["S", "M"],
    size: "S",
    sources: ["hq"],
    want: ["outlook"],
    viewAll: "depth",
    sample: { hq: { outlook: SAMPLE_OUTLOOK } },
    Draw: RosterLoss,
  },
  {
    id: "tasks",
    ...m.w.tasks,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["hq", "board"],
    want: ["tasks", "contacts"],
    sample: {
      board: SAMPLE_BOARD,
      hq: {
        contacts: SAMPLE_CONTACTS,
        tasks: [
          { id: "t1", text: "Call Marcus Williams.", done: false },
          { id: "t2", text: "Book a visit for David Johnson.", done: true },
        ],
      },
    },
    Draw: Tasks,
  },
  {
    id: "goals",
    ...m.w.goals,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["hq"],
    want: ["goals"],
    sample: {
      hq: {
        goals: [
          { id: "commits", title: "Sign Your Class", target: 23, now: 9, met: false },
          { id: "top100", title: "Land Top 100 Recruits", target: 3, now: 2, met: false },
          { id: "rank", title: "Finish in the Top", target: 25, now: 14, met: true },
        ],
      },
    },
    Draw: Goals,
  },
  {
    id: "program-compare",
    ...m.w.programCompare,
    category: "program",
    sizes: ["M", "L"],
    size: "M",
    sources: ["programs"],
    sample: { programs: SAMPLE_PROGRAMS },
    Draw: ProgramCompare,
  },
  {
    id: "next-depth",
    ...m.w.nextDepth,
    category: "program",
    sizes: ["M", "L"],
    size: "L",
    sources: ["hq"],
    want: ["next_year"],
    viewAll: "depth",
    sample: { hq: { next_year: SAMPLE_NEXT } },
    Draw: NextDepth,
  },
  {
    id: "promises",
    ...m.w.promises,
    category: "program",
    sizes: ["S", "M", "L"],
    size: "M",
    sources: ["hq", "depth", "board"],
    want: ["promises"],
    viewAll: "recruiting",
    sample: { depth: SAMPLE_DEPTH, board: SAMPLE_BOARD },
    Draw: Promises,
  },
];

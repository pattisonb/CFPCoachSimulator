import { GradeRange, isGrade } from "../Grade/index.tsx";
import { useState } from "react";
import { ArrowDown, ArrowUp, Binoculars, CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import { historyItems } from "../RecruitFile/index.tsx";
import { cachedTeams } from "../../teams.ts";
import { standingOf } from "../../standing.ts";
import type { ProspectDetail } from "../../types.ts";
import {
  Chart,
  Empty,
  Filtered,
  List,
  Meter,
  RName,
  Stats,
  StarsShort,
  Table,
  Tag,
  posOf,
  rowsFor,
  title,
} from "./kit.tsx";
import { messages as m } from "./messages.ts";
import {
  SAMPLE_BOARD,
  SAMPLE_CLASSES,
  SAMPLE_MYCLASS,
  SAMPLE_PROSPECTS,
  SAMPLE_SCOUTED,
  SAMPLE_SCOUTING,
} from "./samples.ts";
import type { Ctx, HqRow, ScoutRow, Sources, Widget } from "./types.ts";

// Headquarters: the recruiting and scouting widgets (web/hq-widgets/recruiting.js, scouting.js). Each reads the
// sources it names, already fetched. Recruit names open him on the board; standings and chances are words; every
// empty case is a sentence.

type P = { d: Sources; ctx: Ctx };

/** A regular-season week as the calendar names it (engine week N is Week N-1); a postseason week keeps its own label. */
export const wkShort = (ctx: Ctx, w: number) =>
  w >= 1 && w <= 14 ? m.wk(w - 1) : (ctx.season?.week_labels[String(w)] ?? m.wk(w));
export const wkLong = (w: number) => m.week(w >= 1 && w <= 14 ? w - 1 : w);

/** Where you stand with him, as the board says it. */
export const standingWord = (b: HqRow | undefined, ctx: Ctx) => {
  if (!b) return "";
  if (b.sample_word) return b.sample_word;
  if (ctx.sample || !b.list) return "";
  const sd = standingOf(b, ctx.team);
  return title(sd.odds ?? sd.word);
};

/** Add to Board: it turns to On Board once it worked (or when he already is). */
function AddButton({ ctx, who, on }: { ctx: Ctx; who: { pid: string; name: string }; on: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done">(on ? "done" : "idle");
  return (
    <button
      type="button"
      className="hq-btn"
      disabled={state !== "idle"}
      aria-label={state === "done" ? m.onBoardLabel(who.name) : m.addLabel(who.name)}
      onClick={async () => {
        setState("busy");
        setState((await ctx.act("board", who)) ? "done" : "idle");
      }}
    >
      {state !== "done" && <Plus size={12} weight="bold" aria-hidden="true" />}
      {state === "done" ? m.onBoard : m.add}
    </button>
  );
}

/** Send a Scout: it turns to Sent once it worked. */
function ScoutButton({ ctx, who }: { ctx: Ctx; who: { pid: string; name: string } }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button"
      className="hq-btn"
      disabled={state !== "idle"}
      aria-label={m.scoutLabel(who.name)}
      onClick={async () => {
        setState("busy");
        setState((await ctx.act("scout", who)) ? "done" : "idle");
      }}
    >
      {state !== "done" && <Binoculars size={12} weight="bold" aria-hidden="true" />}
      {state === "done" ? m.sent : m.scout}
    </button>
  );
}

// ---------- Class at a Glance ----------
function ClassGlance({ d }: P) {
  const b = d.board!;
  return (
    <Stats
      pairs={[
        [b.committed, m.commits],
        [b.open_spots, m.openSpots],
        [b.committed && b.class_rank ? `#${b.class_rank}` : m.unranked, m.classRank],
        [m.xOfY(b.offers, b.offers + b.offers_left), m.offersOut],
      ]}
    />
  );
}

// ---------- Week's Resources ----------
function Resources({ d }: P) {
  const b = d.board!;
  const frac = (a: number, t: number) => (t ? a / t : 0);
  return (
    <div className="hq-stack">
      <Meter
        label={m.hours}
        words={m.left(b.hours_left ?? 0, b.hours ?? 0)}
        frac={frac(b.hours_left ?? 0, b.hours ?? 0)}
      />
      <Meter
        label={m.nil}
        words={m.left(b.nil?.left ?? 0, b.nil?.budget ?? 0)}
        frac={frac(b.nil?.left ?? 0, b.nil?.budget ?? 0)}
      />
      <Meter
        label={m.points}
        words={m.left(b.points_left ?? 0, b.points_week ?? 0)}
        frac={frac(b.points_left ?? 0, b.points_week ?? 0)}
      />
    </div>
  );
}

// ---------- Top Targets ----------
function TopTargets({ d, ctx }: P) {
  const rows = d.board?.targets ?? [];
  if (!rows.length) return <Empty>{m.noTargets}</Empty>;
  const word = (b: HqRow) => standingWord(b, ctx);
  return (
    <Filtered
      id="top-targets"
      rows={rows}
      none={m.noTargetsMatch}
      cols={[
        ["pos", m.pos, posOf],
        ["stars", m.starsCol, (b) => (b.stars ? m.nStars(b.stars) : "")],
        ["standing", m.standing, word],
      ]}
      render={(shown) => (
        <List>
          {shown.slice(0, rowsFor(ctx.size)).map((b) => (
            <li key={b.id}>
              <RName ctx={ctx} pid={b.id}>
                {b.name}
              </RName>
              <span className="hq-sub">{posOf(b)}</span>
              <Stars n={b.stars} size={10} />
              {word(b) && <Tag>{word(b)}</Tag>}
            </li>
          ))}
        </List>
      )}
    />
  );
}

// ---------- Class Needs ----------
function ClassNeeds({ d, ctx }: P) {
  const rows = Object.entries(d.board?.needs_detail ?? {})
    .filter(([, n]) => n.need > 0 || n.commits > 0)
    .sort((a, b) => b[1].need - a[1].need)
    .slice(0, ctx.size === "S" ? 6 : 12);
  if (!rows.length) return <Empty>{m.noNeeds}</Empty>;
  return ctx.size === "S" ? (
    <Table heads={[m.pos, m.need, m.commits]} rows={rows.map(([g, n]) => [g, n.need, n.commits])} />
  ) : (
    <Table heads={[m.pos, m.need, m.commits, m.onBoard]} rows={rows.map(([g, n]) => [g, n.need, n.commits, n.board])} />
  );
}

// ---------- Visit Schedule ----------
function VisitSchedule({ d, ctx }: P) {
  const rows = (d.board?.board ?? [])
    .filter((b) => b.visit && !b.visit.done)
    .sort((a, b) => a.visit!.week - b.visit!.week)
    .slice(0, rowsFor(ctx.size));
  if (!rows.length) return <Empty>{m.noVisits}</Empty>;
  return (
    <List>
      {rows.map((b) => {
        const game = b.list?.find((x) => x.you || x.school === ctx.team)?.visit?.game;
        const vs = ctx.size === "M" && game?.opponent_name ? ` · ${m.vs(game.opponent_name)}` : "";
        return (
          <li key={b.id}>
            <Tag>{wkShort(ctx, b.visit!.week)}</Tag>
            <RName ctx={ctx} pid={b.id}>
              {b.name}
            </RName>
            <span className="hq-sub">
              {posOf(b)}
              {vs}
            </span>
          </li>
        );
      })}
    </List>
  );
}

// ---------- Recent Commits ----------
function RecentCommits({ d, ctx }: P) {
  const byId = new Map((d.board?.board ?? []).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const rows: { pid: string; name: string; week?: number; portal?: boolean; b?: HqRow }[] = [];
  for (const e of [...(d.board?.recap ?? [])].reverse()) {
    if ((e.kind === "commit" || e.kind === "flip") && e.school === ctx.team && !seen.has(e.pid)) {
      seen.add(e.pid);
      rows.push({
        pid: e.pid,
        name: e.name,
        week: e.portal_week ?? e.week,
        portal: e.portal_week != null,
        b: byId.get(e.pid),
      });
    }
  }
  for (const b of d.board?.board ?? [])
    if (b.committed === ctx.team && !seen.has(b.id)) {
      seen.add(b.id);
      rows.push({ pid: b.id, name: b.name, b });
    }
  if (!rows.length) return <Empty>{m.noCommits}</Empty>;
  return (
    <List>
      {rows.slice(0, rowsFor(ctx.size)).map((r) => (
        <li key={r.pid}>
          <RName ctx={ctx} pid={r.pid}>
            {r.name}
          </RName>
          {r.b && <span className="hq-sub">{posOf(r.b)}</span>}
          {r.b && <Stars n={r.b.stars} size={10} />}
          {r.week != null && <span className="hq-sub">{r.portal ? m.week(r.week) : wkLong(r.week)}</span>}
        </li>
      ))}
    </List>
  );
}

// ---------- Recruiting Activity ----------
function Activity({ d, ctx }: P) {
  const evs = [...(d.board?.recap ?? [])].reverse().slice(0, rowsFor(ctx.size));
  if (!evs.length) return <Empty>{m.noActivity}</Empty>;
  const line = (e: (typeof evs)[number]) => {
    if (ctx.sample)
      return e.kind === "commit"
        ? m.committedToYou
        : m.offeredBy(cachedTeams()?.find((t) => t.slug === e.school)?.name ?? "Georgia");
    return historyItems([e], ctx.team)[0]?.text ?? "";
  };
  return (
    <List>
      {evs.map((e, i) => (
        <li key={`${e.pid}-${i}`}>
          <RName ctx={ctx} pid={e.pid} grow={false}>
            {e.name}
          </RName>
          <span className="hq-grow hq-sub">{line(e)}</span>
          <span className="hq-sub">{wkLong(e.portal_week ?? e.week)}</span>
        </li>
      ))}
    </List>
  );
}

// ---------- Commitment Tracker ----------
function CommitTracker({ d, ctx }: P) {
  const rows = d.hq?.commits ?? [];
  if (!rows.length) return <Empty>{m.noWeeks}</Empty>;
  const last = rows[rows.length - 1];
  const net = last.gained - last.lost;
  return (
    <div className="hq-stack">
      <Stats
        pairs={[
          [last.total, m.totalCommits],
          [net > 0 ? `+${net}` : String(net), m.thisWeek],
        ]}
      />
      <Chart points={rows.map((r) => [wkShort(ctx, r.week), r.total])} />
    </div>
  );
}

// ---------- Hot and Cold Movers ----------
function Movers({ d, ctx }: P) {
  const mv = d.hq?.movers ?? { up: [], down: [] };
  const byId = new Map((d.board?.board ?? []).map((b) => [b.id, b]));
  const col = (head: string, rows: typeof mv.up, up: boolean) => (
    <div>
      <h4 className="label hq-kicker">{head}</h4>
      {rows.length ? (
        <List>
          {rows.map((r) => (
            <li key={r.pid}>
              {up ? (
                <ArrowUp size={14} weight="bold" aria-label={m.rising} />
              ) : (
                <ArrowDown size={14} weight="bold" className="hq-soft" aria-label={m.falling} />
              )}
              <RName ctx={ctx} pid={r.pid}>
                {r.name}
              </RName>
              <Tag>{r.word || standingWord(byId.get(r.pid), ctx) || posOf(r)}</Tag>
            </li>
          ))}
        </List>
      ) : (
        <Empty>{up ? m.noRisers : m.noFallers}</Empty>
      )}
    </div>
  );
  return (
    <div className="hq-split">
      {col(m.rising, mv.up ?? [], true)}
      {col(m.falling, mv.down ?? [], false)}
    </div>
  );
}

// ---------- Class Breakdown ----------
/** *tune* The donut's segments, five stars down to two: ink, then lighter. */
const DONUT = [
  "var(--ink)",
  "color-mix(in srgb, var(--ink) 62%, var(--paper-hi))",
  "var(--ink-soft)",
  "var(--line-soft)",
];
function ClassBreakdown({ d, ctx }: P) {
  const mine = (d.classes?.schools ?? []).find((r) => r.yours || r.school === ctx.team);
  const counts = [5, 4, 3, 2]
    .map((n, i) => [n, Number(mine?.stars?.[String(n)] ?? 0), i] as const)
    .filter(([, c]) => c > 0);
  const total = counts.reduce((a, [, c]) => a + c, 0);
  if (!total) return <Empty>{m.noCommits}</Empty>;
  let at = 25;
  return (
    <div className="hq-donut">
      <svg viewBox="0 0 42 42" role="img" aria-label={m.breakdownLabel(total)}>
        {counts.map(([n, c, i]) => {
          const seg = (100 * c) / total;
          const offset = at;
          at -= seg;
          return (
            <circle
              key={n}
              cx={21}
              cy={21}
              r={15.915}
              fill="none"
              stroke={DONUT[i]}
              strokeWidth={6}
              strokeDasharray={`${seg} ${100 - seg}`}
              strokeDashoffset={offset}
            />
          );
        })}
      </svg>
      <List>
        {counts.map(([n, c, i]) => (
          <li key={n}>
            <i className="hq-key" style={{ background: DONUT[i] }} aria-hidden="true" />
            <span className="hq-grow">{m.nStar(n)}</span>
            <b>{c}</b>
          </li>
        ))}
      </List>
    </div>
  );
}

// ---------- Your Full Class ----------
function FullClass({ d, ctx }: P) {
  const rows = d.myclass?.class ?? [];
  const mine = (d.myclass?.schools ?? []).find((r) => r.yours || r.school === ctx.team);
  if (!rows.length) return <Empty>{m.noCommits}</Empty>;
  type Row = (typeof rows)[number];
  const statusWord = (r: Row) => (r.signed ? m.signed : m.committed);
  const status = (r: Row) => <Tag solid={!!r.signed}>{statusWord(r)}</Tag>;
  return (
    <div className="hq-stack">
      <Stats
        pairs={[
          [rows.length, m.commits],
          [mine?.count && mine.rank ? `#${mine.rank}` : m.unranked, m.classRank],
          [rows.filter((r) => r.signed).length, m.signed],
        ]}
      />
      <Filtered
        id="full-class"
        rows={rows}
        none={m.noRecruitsMatch}
        cols={[
          ["pos", m.pos, posOf],
          ["stars", m.starsCol, (r) => (r.stars ? m.nStars(r.stars) : "")],
          ["status", m.status, statusWord],
        ]}
        render={(all) => {
          const shown = ctx.size === "L" ? all : all.slice(0, rowsFor(ctx.size));
          return (
            <>
              {ctx.size === "L" ? (
                <Table
                  heads={[m.player, m.pos, m.starsCol, m.natRank, m.status]}
                  rows={shown.map((r) => [
                    <RName key="n" ctx={ctx} pid={r.id}>
                      {r.name}
                    </RName>,
                    posOf(r),
                    <Stars key="s" n={r.stars ?? 0} size={10} />,
                    r.national_rank ? `#${r.national_rank}` : m.dash,
                    status(r),
                  ])}
                />
              ) : (
                <List>
                  {shown.map((r) => (
                    <li key={r.id}>
                      <RName ctx={ctx} pid={r.id}>
                        {r.name}
                      </RName>
                      <span className="hq-sub">{posOf(r)}</span>
                      <Stars n={r.stars ?? 0} size={10} />
                      {status(r)}
                    </li>
                  ))}
                </List>
              )}
              {all.length > shown.length && <p className="hq-sub">{m.andMore(all.length - shown.length)}</p>}
            </>
          );
        }}
      />
    </div>
  );
}

// ---------- Recruiting Rankings ----------
function Rankings({ d, ctx }: P) {
  // a school with no commits has no class to rank yet
  const all = (d.classes?.schools ?? []).filter((r) => r.count > 0);
  const isMine = (r: (typeof all)[number]) => !!r.yours || r.school === ctx.team;
  const top = all.slice(0, 5).map((r, i) => [r.rank ?? i + 1, r] as const);
  const at = all.findIndex(isMine);
  if (at >= 5) top.push([all[at].rank ?? at + 1, all[at]]);
  if (!top.length) return <Empty>{m.noClasses}</Empty>;
  return (
    <Table
      heads={[m.hash, m.school, m.commits, m.fiveStar]}
      rows={top.map(([n, r]) => [n, r.name, r.count, r.stars?.["5"] ?? 0])}
      mine={(i) => isMine(top[i][1])}
    />
  );
}

// ---------- Recruit Search ----------
function RecruitSearch({ d, ctx }: P) {
  type Row = NonNullable<NonNullable<Sources["prospects"]>["rows"]>[number];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const shown = rows ?? d.prospects?.rows ?? [];
  const search = async (params: Record<string, string>) => {
    if (ctx.sample || !ctx.season) return;
    setState("busy");
    try {
      const r = await ctx.get<{ rows?: Row[] }>(
        `/api/season/${ctx.season.id}/prospects?${new URLSearchParams({ limit: "30", ...params })}`,
      );
      setRows(r.rows ?? []);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  const need = Object.entries(d.prospects?.needs ?? {})
    .map(([g, n]) => [g, typeof n === "number" ? n : n.need] as const)
    .sort((a, b) => b[1] - a[1])[0];
  const quick: [string, Record<string, string>][] = [
    [m.top100, { sort: "rank", limit: "100" }],
    [m.fiveStar, { stars: "5" }],
  ];
  if (need && need[1] > 0) quick.push([m.needAt(need[0]), { group: need[0] }]);
  return (
    <div className="hq-stack">
      <div className="hq-row">
        <input
          type="search"
          className="hq-input"
          placeholder={m.searchByName}
          aria-label={m.searchRecruits}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search({ q: q.trim() })}
        />
        <button type="button" className="hq-btn" onClick={() => void search({ q: q.trim() })}>
          {m.search}
        </button>
        {quick.map(([label, params]) => (
          <Chip key={label} on={false} onClick={() => void search(params)}>
            {label}
          </Chip>
        ))}
      </div>
      {state === "busy" ? (
        <Empty>{m.searching}</Empty>
      ) : state === "failed" ? (
        <Empty>{m.searchFailed}</Empty>
      ) : !shown.length ? (
        <Empty>{m.noSearch}</Empty>
      ) : (
        <List>
          {shown.slice(0, rowsFor(ctx.size)).map((r) => (
            <li key={r.id}>
              <RName ctx={ctx} pid={r.id}>
                {r.name}
              </RName>
              <span className="hq-sub">{posOf(r)}</span>
              <Stars n={r.stars ?? 0} size={10} />
              {ctx.size === "L" && !r.scouted && <ScoutButton ctx={ctx} who={{ pid: r.id, name: r.name }} />}
              <AddButton ctx={ctx} who={{ pid: r.id, name: r.name }} on={!!r.on_board} />
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ================= scouting =================

const FLAG_WORDS: Record<string, string> = { generational: m.flagGenerational, gem: m.flagGem, bust: m.flagBust };
const ROLE_SHORT: Record<string, string> = { "Offensive Coordinator": "OC", "Defensive Coordinator": "DC" };
const potentialOf = (p?: string[]) =>
  !p?.length ? null : p[0] === p[p.length - 1] ? p[0] : m.range(p[0], p[p.length - 1]);
/** A potential read in a row: letter grades as their tiles, anything else (a grade word) in a tag as before. */
const potentialTag = (p?: string[]) =>
  !p?.length ? null : isGrade(p[0]) ? <GradeRange read={p} size="sm" /> : <Tag>{potentialOf(p)}</Tag>;

// ---------- Scouting Queue ----------
function ScoutQueue({ d, ctx }: P) {
  const rows = (d.scouting?.queue ?? []).filter((r) => r.looks < 3).slice(0, rowsFor(ctx.size));
  if (!rows.length) return <Empty>{m.queueDone}</Empty>;
  return (
    <List>
      {rows.map((r) => {
        const pot = ctx.size === "L" ? potentialTag(r.potential) : null;
        return (
          <li key={r.pid}>
            <RName ctx={ctx} pid={r.pid}>
              {r.name}
            </RName>
            <span className="hq-sub">{posOf(r)}</span>
            <Stars n={r.stars ?? 0} size={10} />
            <span className="hq-sub">{m.looks(r.looks || 0)}</span>
            {pot}
            {r.can_send && <ScoutButton ctx={ctx} who={{ pid: r.pid, name: r.name }} />}
            <AddButton ctx={ctx} who={{ pid: r.pid, name: r.name }} on={!!r.on_board} />
          </li>
        );
      })}
    </List>
  );
}

// ---------- Flags ----------
function Flags({ d, ctx }: P) {
  const rows = (d.scouting?.flags ?? []).slice(0, rowsFor(ctx.size));
  if (!rows.length) return <Empty>{m.noFlags}</Empty>;
  return (
    <List>
      {rows.map((f) => {
        const who = f.likes && typeof f.likes === "object" ? f.likes.who : f.likes;
        const word =
          f.flag === "likes"
            ? m.likesHim(ROLE_SHORT[who ?? ""] ?? who ?? m.staff)
            : (FLAG_WORDS[f.flag] ?? title(f.flag));
        return (
          <li key={`${f.pid}-${f.flag}`}>
            <Tag solid={f.flag === "gem" || f.flag === "generational"}>{word}</Tag>
            <RName ctx={ctx} pid={f.pid}>
              {f.name}
            </RName>
            <span className="hq-sub">{posOf(f)}</span>
            {ctx.size === "M" && <AddButton ctx={ctx} who={{ pid: f.pid, name: f.name }} on={!!f.on_board} />}
          </li>
        );
      })}
    </List>
  );
}

// ---------- Area Scouts ----------
function AreaScouts({ d, ctx }: P) {
  const rows = (d.scouting?.scouts ?? []).slice(0, rowsFor(ctx.size));
  if (!rows.length) return <Empty>{m.noScouts}</Empty>;
  return (
    <Table
      heads={[m.scoutCol, m.area, m.eye, m.thisWeek]}
      rows={rows.map((s) => {
        const looks = Number(s.yield?.looks ?? 0);
        const flags = s.yield?.flags ?? 0;
        return [
          `${s.name}${ROLE_SHORT[s.role] ? ` (${ROLE_SHORT[s.role]})` : ""}`,
          s.area || m.anywhere,
          s.evaluation_word || "",
          `${m.nLooks(looks)}${flags ? ` · ${m.nFlags(flags)}` : ""}`,
        ];
      })}
    />
  );
}

// ---------- Scouted Players: everyone your staff has looked at; a tile opens his report in place ----------
const GRADE_NAMES: [string, string][] = [
  ["potential", m.grades.potential],
  ["athleticism", m.grades.athleticism],
  ["size_strength", m.grades.size],
  ["technique", m.grades.technique],
  ["football_iq", m.grades.iq],
  ["coachability", m.grades.coachability],
];
function Scouted({ d, ctx }: P) {
  const rows = d.scouted?.queue ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<
    { pid: string; grades: Record<string, string[]> | null; line: string } | "failed" | null
  >(null);
  if (!rows.length) return <Empty>{m.noScouted}</Empty>;
  const short = (r: ScoutRow) => (r.looks || 0) < 3;
  const tag = (r: ScoutRow) =>
    r.flags?.length
      ? (FLAG_WORDS[r.flags[0]] ?? title(r.flags[0]))
      : r.likes
        ? m.likesHim(r.likes.who ?? m.staff)
        : null;
  const at = rows.findIndex((r) => r.pid === open);
  const show = (i: number) => {
    const r = rows[i];
    setOpen(r.pid);
    setReport(null);
    if (!ctx.season) return;
    ctx
      .get<ProspectDetail & { our_grades?: Record<string, string[]> | null }>(
        `/api/season/${ctx.season.id}/prospect/${encodeURIComponent(r.pid)}`,
      )
      .then((pr) =>
        setReport({
          pid: r.pid,
          grades: pr.our_grades ?? null,
          line: [pr.public?.archetype, pr.public ? `${pr.public.hometown.city}, ${pr.public.hometown.state}` : null]
            .filter(Boolean)
            .join(" · "),
        }),
      )
      .catch(() => setReport("failed"));
  };
  if (at >= 0 && !ctx.sample) {
    const r = rows[at];
    const mine = report && report !== "failed" && report.pid === r.pid ? report : null;
    return (
      <div className="hq-detail">
        <div className="hq-row">
          <button type="button" className="hq-btn" onClick={() => setOpen(null)}>
            {m.backToAll}
          </button>
          <span className="hq-grow hq-sub">{m.xOfY(at + 1, rows.length)}</span>
          <button
            type="button"
            className="hq-btn"
            aria-label={m.prevPlayer}
            disabled={at === 0}
            onClick={() => show(at - 1)}
          >
            <CaretLeft size={12} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="hq-btn"
            aria-label={m.nextPlayer}
            disabled={at === rows.length - 1}
            onClick={() => show(at + 1)}
          >
            <CaretRight size={12} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="hq-detail__head">
          <b className="hq-grow">{r.name}</b>
          <span className="hq-sub">{posOf(r)}</span>
          <StarsShort n={r.stars} />
          {tag(r) && <Tag solid>{tag(r)}</Tag>}
        </div>
        {short(r) && <span className="hq-sub">{m.looks(r.looks || 0)}</span>}
        {report === "failed" ? (
          <Empty>{m.reportFailed}</Empty>
        ) : !mine ? (
          <Empty>{m.loadingReport}</Empty>
        ) : (
          <>
            {mine.line && <Empty>{mine.line}</Empty>}
            <dl className="hq-grades">
              {GRADE_NAMES.map(([id, label]) => (
                <div key={id}>
                  <dt>{label}</dt>
                  <dd>{potentialOf(mine.grades?.[id]) ?? m.notSeen}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <div className="hq-row">
          <button type="button" className="hq-btn" onClick={() => ctx.openRecruit(r.pid)}>
            {m.openProfile}
          </button>
          <AddButton ctx={ctx} who={{ pid: r.pid, name: r.name }} on={!!r.on_board} />
        </div>
      </div>
    );
  }
  return (
    <div className="hq-tiles">
      {rows.map((r, i) => (
        <button
          key={r.pid}
          type="button"
          className="hq-tile"
          aria-label={m.openReport(r.name)}
          onClick={() => !ctx.sample && show(i)}
        >
          <b className="hq-tile__name">{r.name}</b>
          <span className="hq-tile__line">
            <span className="hq-sub">{posOf(r)}</span>
            <Stars n={r.stars ?? 0} size={10} />
          </span>
          <span className="hq-tile__line">
            {potentialTag(r.potential)}
            {short(r) && <span className="hq-sub">{m.looks(r.looks || 0)}</span>}
          </span>
          {tag(r) && <Tag solid>{tag(r)}</Tag>}
        </button>
      ))}
    </div>
  );
}

export const RECRUITING_WIDGETS: Widget[] = [
  {
    id: "class-glance",
    ...m.w.classGlance,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: ClassGlance,
  },
  {
    id: "resources",
    ...m.w.resources,
    category: "recruiting",
    sizes: ["S"],
    size: "S",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: Resources,
  },
  {
    id: "top-targets",
    ...m.w.topTargets,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: TopTargets,
  },
  {
    id: "class-needs",
    ...m.w.classNeeds,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: ClassNeeds,
  },
  {
    id: "visit-schedule",
    ...m.w.visitSchedule,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: VisitSchedule,
  },
  {
    id: "recent-commits",
    ...m.w.recentCommits,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: RecentCommits,
  },
  {
    id: "activity",
    ...m.w.activity,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["board"],
    sample: { board: SAMPLE_BOARD },
    viewAll: "recruiting",
    Draw: Activity,
  },
  {
    id: "commit-tracker",
    ...m.w.commitTracker,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["hq"],
    want: ["commits"],
    viewAll: "recruiting",
    sample: {
      hq: {
        commits: [1, 2, 3, 4, 5, 6].map((w, i) => ({
          week: w,
          gained: i ? 1 + (i % 2) : 2,
          lost: 0,
          total: [2, 3, 5, 6, 8, 9][i],
        })),
      },
    },
    Draw: CommitTracker,
  },
  {
    id: "movers",
    ...m.w.movers,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["hq", "board"],
    want: ["movers"],
    viewAll: "recruiting",
    sample: {
      board: SAMPLE_BOARD,
      hq: {
        movers: {
          up: [
            { pid: "s1", name: "Marcus Williams", position: "CB", stars: 5, word: "Clear Favorite" },
            { pid: "s3", name: "David Johnson", position: "WR", stars: 4, word: "Narrow Favorite" },
          ],
          down: [{ pid: "s4", name: "James Taylor", position: "DL", stars: 4, word: "Long Shot" }],
        },
      },
    },
    Draw: Movers,
  },
  {
    id: "class-breakdown",
    ...m.w.classBreakdown,
    category: "recruiting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["classes"],
    sample: { classes: SAMPLE_CLASSES },
    Draw: ClassBreakdown,
  },
  {
    id: "full-class",
    ...m.w.fullClass,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["myclass"],
    sample: { myclass: SAMPLE_MYCLASS },
    Draw: FullClass,
  },
  {
    id: "rankings",
    ...m.w.rankings,
    category: "recruiting",
    sizes: ["M"],
    size: "M",
    sources: ["classes"],
    sample: { classes: SAMPLE_CLASSES },
    Draw: Rankings,
  },
  {
    id: "recruit-search",
    ...m.w.recruitSearch,
    category: "recruiting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["prospects"],
    sample: { prospects: SAMPLE_PROSPECTS },
    viewAll: "prospects",
    Draw: RecruitSearch,
  },
  {
    id: "scout-queue",
    ...m.w.scoutQueue,
    category: "scouting",
    sizes: ["M", "L"],
    size: "M",
    sources: ["scouting"],
    sample: { scouting: SAMPLE_SCOUTING },
    viewAll: "staff",
    Draw: ScoutQueue,
  },
  {
    id: "flags",
    ...m.w.flags,
    category: "scouting",
    sizes: ["S", "M"],
    size: "S",
    sources: ["scouting"],
    sample: { scouting: SAMPLE_SCOUTING },
    viewAll: "staff",
    Draw: Flags,
  },
  {
    id: "area-scouts",
    ...m.w.areaScouts,
    category: "scouting",
    sizes: ["M"],
    size: "M",
    sources: ["scouting"],
    sample: { scouting: SAMPLE_SCOUTING },
    viewAll: "staff",
    Draw: AreaScouts,
  },
  {
    id: "scouted",
    ...m.w.scouted,
    category: "scouting",
    sizes: ["S", "M", "L"],
    size: "M",
    sources: ["scouted"],
    sample: { scouted: SAMPLE_SCOUTED },
    viewAll: "staff",
    Draw: Scouted,
  },
];

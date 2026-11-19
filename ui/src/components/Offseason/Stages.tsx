import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Face from "../Face/index.tsx";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { inkOn } from "../../colors.ts";
import { playerFace } from "../../faces.ts";
import { formatClass } from "../../format.ts";
import type { StageProps } from "./index.tsx";
import { messages as m } from "./messages.ts";
import type { Candidate, ConferencesView, Departure, JobRow, Leaver, NextSchedule, OffPlayer } from "./types.ts";

type P = StageProps;

/** The stage's panels: what happened, and what you can do about it. */
export function Stage({ stage, ...p }: P & { stage: string }) {
  if (stage === "review") return <Meeting {...p} />;
  if (stage === "retention") return <Retention {...p} />;
  if (stage === "departures") return <Departures {...p} />;
  if (stage.startsWith("portal")) return <Portal {...p} />;
  if (stage === "development") return <Development {...p} />;
  if (stage === "staff") return <Staff {...p} />;
  if (stage === "conferences") return <Conferences {...p} />;
  if (stage === "schedule") return <Schedule {...p} />;
  return <Ready {...p} />;
}

// ---------- small shared pieces ----------

const who = (x: OffPlayer) => (
  <span className="off__who">
    <b>{x.name}</b>
    <span className="off__soft">
      {x.pos} · {formatClass(x.cls)}
    </span>
  </span>
);
const Btn = ({
  children,
  on,
  ...rest
}: { children: ReactNode; on?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" className={`off__btn${on ? " is-on" : ""}`} {...rest}>
    {children}
  </button>
);
const Tag = ({ children, solid }: { children: ReactNode; solid?: boolean }) => (
  <span className={`off__tag${solid ? " is-solid" : ""}`}>{children}</span>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="off__soft">{children}</p>;
const teamName = (teams: P["teams"], slug: string) => teams.get(slug)?.name ?? slug;

/** Your meeting with the AD: what he made of the year, and (when the job is in question) what you say to him. */
function ReviewPanel({ v, busy, live, act }: P) {
  const r = v.review;
  const [staff, setStaff] = useState(v.your_staff.find((s) => s.role === "OC" || s.role === "DC")?.id ?? "");
  if (!r) return null;
  const coordinators = v.your_staff.filter((s) => s.role === "OC" || s.role === "DC");
  return (
    <Panel title={m.review.title} aside={<Tag solid={r.met}>{r.mood}</Tag>}>
      <p className="off__lede">{r.words}</p>
      <PanelRows>
        <PanelRow label={m.review.goal} value={r.goal} />
        <PanelRow label={m.review.record} value={`${r.record[0]}-${r.record[1]}`} />
        <PanelRow label={m.review.nil} value={m.review.nilLine(r.nil_now, r.nil_next)} tip={m.review.nilTip} />
      </PanelRows>
      {live && !r.decided && r.options.length > 0 && (
        <div className="off__say">
          <span className="label">{m.review.say}</span>
          <div className="off__row">
            {r.options.map((o) =>
              o === "change" ? (
                <span key={o} className="off__row">
                  <Btn disabled={busy || !staff} onClick={() => act("/review", { action: o, staff_id: staff })}>
                    {r.option_names[o]}
                  </Btn>
                  {coordinators.length > 0 && (
                    <Dropdown
                      label={m.review.whoGoes}
                      size="md"
                      value={staff}
                      options={coordinators.map((s) => ({ value: s.id, label: s.name, hint: s.role }))}
                      onChange={setStaff}
                    />
                  )}
                </span>
              ) : (
                <Btn key={o} disabled={busy} onClick={() => act("/review", { action: o })}>
                  {r.option_names[o]}
                </Btn>
              ),
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Your call on each redshirt (a player who sat most of the year keeps the year). */
function Redshirts({ v, busy, live, act }: P) {
  const rs = v.redshirts;
  if (!rs.players.length) return null;
  const open = live && !rs.decided;
  return (
    <Panel title={m.redshirts.title} aside={open ? m.redshirts.note : m.redshirts.decided}>
      <ul className="off__list">
        {rs.players.map((x) => (
          <li key={x.id}>
            {who(x)}
            <span className="off__soft">{m.redshirts.games(x.games, x.team_games)}</span>
            <b className="off__num">{x.overall}</b>
            {open ? (
              <Btn
                on={x.redshirt}
                disabled={busy}
                aria-pressed={x.redshirt}
                onClick={() => act("/redshirt", { pid: x.id, on: !x.redshirt })}
              >
                {x.redshirt ? m.redshirts.on : m.redshirts.off}
              </Btn>
            ) : (
              <Tag solid={x.redshirt}>{x.redshirt ? m.redshirts.on : m.redshirts.off}</Tag>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------- Your meeting with the AD: the offseason's first step ----------

function Meeting(p: P) {
  const r = p.v.review;
  if (!r) return <Empty>{m.review.none}</Empty>;
  return (
    <div className="off__meeting">
      <ReviewPanel {...p} />
      <Panel title={m.review.next}>
        <PanelRows>
          <PanelRow label={m.review.goal} value={r.goal} />
          <PanelRow label={m.review.result} value={r.met ? m.review.met : m.review.missed} />
          <PanelRow label={m.review.standing} value={r.mood} tip={m.review.standingTip} />
        </PanelRows>
        <p className="off__soft">{r.must && !r.decided ? m.review.mustText : m.review.afterText}</p>
      </Panel>
    </div>
  );
}

// ---------- Keep Them Home ----------

function Retention(p: P) {
  const { v, busy, live, act } = p;
  const rt = v.retention;
  return (
    <>
      {/* the players thinking of leaving: a row of cards that scrolls sideways, one a player */}
      <section className="off__keep" aria-label={m.keep.title}>
        <header className="off__keep-head">
          <h3>{m.keep.title}</h3>
          <span className="off__soft">{m.keep.count(rt.players.length)}</span>
          <span className="off__tag is-solid">{m.keep.pool(rt.left, rt.budget)}</span>
        </header>
        {!rt.players.length ? (
          <Empty>{m.keep.none}</Empty>
        ) : (
          <ul className="off__cards" tabIndex={0}>
            {rt.players.map((x) => (
              <LeaverCard
                key={x.id}
                x={x}
                left={rt.left}
                busy={busy}
                live={live}
                act={act}
                colors={p.teams.get(p.season.team)?.colors}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * One player thinking of leaving, as a card: his face in your colors with his overall, what he says about why, his
 * role now and next and what he wants (once you have met), then your moves, the one that matters most on top.
 */
function LeaverCard({
  x,
  left,
  busy,
  live,
  act,
  colors,
}: {
  x: Leaver;
  left: number;
  busy: boolean;
  live: boolean;
  act: P["act"];
  colors?: { primary: string; secondary: string };
}) {
  const [nil, setNil] = useState(x.offers.nil || x.ask.nil || 0);
  const gone = x.offers.released;
  const style = {
    "--c": colors?.primary ?? "var(--ink)",
    "--on": colors ? inkOn(colors.primary) : "var(--paper-hi)",
  } as CSSProperties;
  const ask = !x.met
    ? m.keep.askUnknown
    : x.ask.kind === "nil" && x.ask.nil
      ? m.keep.askNilShort(x.ask.nil)
      : x.ask.kind === "promise" || x.ask.kind === "role"
        ? m.keep.askRoleShort
        : m.keep.askNoneShort;
  return (
    <li className={`off-card${gone ? " is-gone" : ""}`} style={style}>
      <header className="off-card__top">
        <span className="off-card__face">
          <Face face={playerFace(x.id, x.pos)} scale={3} label="" />
        </span>
        <span className="off-card__name">
          <span className="off-card__pos">
            {x.pos} · {formatClass(x.cls)}
          </span>
          <b>{x.name}</b>
          <span className="off-card__intent">{m.intents[x.intent] ?? x.intent}</span>
        </span>
        <span className="off-card__ovr">
          <b>{x.overall}</b>
          <span>{m.keep.ovr}</span>
        </span>
      </header>
      <p className="off-card__quote">{m.keep.quote(x.reason)}</p>
      <dl className="off-card__facts">
        <div>
          <dt className="label">{m.keep.roleNow}</dt>
          <dd>{x.role_now_name}</dd>
        </div>
        <div>
          <dt className="label">{m.keep.roleNext}</dt>
          <dd>{x.role_next_name}</dd>
        </div>
        <div>
          <dt className="label">{m.keep.wants}</dt>
          <dd className={x.met ? undefined : "is-soft"}>{ask}</dd>
        </div>
        <div>
          <dt className="label">{m.keep.odds}</dt>
          <dd className={x.chance_word ? undefined : "is-soft"}>{x.chance_word ?? m.keep.askUnknown}</dd>
        </div>
      </dl>
      {live && (
        <div className="off-card__acts">
          {!x.met ? (
            <button
              type="button"
              className="off-card__main"
              disabled={busy}
              onClick={() => act("/retain", { pid: x.id, action: "meet" })}
            >
              {m.keep.meet}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`off-card__main${x.offers.promise ? " is-done" : ""}`}
                disabled={busy || x.offers.promise || gone}
                onClick={() => act("/retain", { pid: x.id, action: "promise" })}
              >
                {x.offers.promise ? m.keep.promised : m.keep.promise}
              </button>
              <span className="off-card__nil">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={nil}
                  aria-label={m.keep.nilLabel(x.name)}
                  onChange={(e) => setNil(Math.max(0, Number(e.target.value) || 0))}
                />
                <Btn
                  disabled={busy || gone || nil > left + x.offers.nil}
                  onClick={() => act("/retain", { pid: x.id, action: "nil", nil })}
                >
                  {x.offers.nil ? m.keep.nilChange(x.offers.nil) : m.keep.nil}
                </Btn>
              </span>
            </>
          )}
          <button
            type="button"
            className="off-card__quiet"
            disabled={busy || gone}
            onClick={() => act("/retain", { pid: x.id, action: "release" })}
          >
            {gone ? m.keep.released : m.keep.release}
          </button>
        </div>
      )}
    </li>
  );
}

// ---------- Departures ----------

function Departures(p: P) {
  const { v, season } = p;
  const d = v.departures;
  const results = v.retention.results ?? [];
  const cols: Column<Departure>[] = [
    { key: "who", label: m.cols.player, render: (x) => who(x), sort: (x) => x.name },
    { key: "ovr", label: m.cols.overall, num: true, render: (x) => x.overall, sort: (x) => x.overall },
    { key: "kind", label: m.cols.how, render: (x) => x.kind_name ?? m.kinds[x.kind] ?? x.kind, sort: (x) => x.kind },
  ];
  return (
    <Panels>
      {results.length > 0 && (
        <Panel title={m.results.title}>
          <ul className="off__list">
            {results.map((x) => (
              <li key={x.id}>
                {who(x)}
                <b className="off__num">{x.overall}</b>
                <Tag solid={x.status === "stayed"}>{m.results.status[x.status] ?? x.status}</Tag>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={m.departures.yours} aside={m.departures.count(d.mine.length)} className="off__wide">
        {d.mine.length ? (
          <DataTable label={m.departures.yours} columns={cols} rows={d.mine} rowKey={(x) => x.id} sortBy="ovr" />
        ) : (
          <Empty>{m.departures.none}</Empty>
        )}
      </Panel>
      <Panel title={m.departures.league}>
        <PanelRows>
          {Object.entries(d.league).map(([k, n]) => (
            <PanelRow key={k} label={m.kinds[k] ?? k} value={n.toLocaleString("en-US")} />
          ))}
        </PanelRows>
      </Panel>
      {d.first_round.length > 0 && (
        <Panel title={m.departures.firstRound}>
          <ol className="off__list">
            {d.first_round.slice(0, 32).map((x) => (
              <li key={x.id} className={x.team === season.team ? "is-mine" : undefined}>
                <span className="off__pick">{x.pick}</span>
                {who(x)}
                <span className="off__soft off__team">
                  <Swatch team={p.teams.get(x.team)} size={12} />
                  {x.team_name}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <Redshirts {...p} />
      <PositionMoves {...p} />
    </Panels>
  );
}

/** Move one of your players to another position for next season, with the overall he would be there. */
function PositionMoves({ v, busy, live, act, get }: P) {
  const [pid, setPid] = useState("");
  const [options, setOptions] = useState<{ pos: string; overall: number; current: boolean }[] | null>(null);
  useEffect(() => {
    setOptions(null);
    if (!pid) return;
    let on = true;
    get<{ options: { pos: string; overall: number; current: boolean }[] }>(
      `/position_options?pid=${encodeURIComponent(pid)}`,
    )
      .then((r) => on && setOptions(r.options))
      .catch(() => on && setOptions([]));
    return () => {
      on = false;
    };
  }, [pid, v.position_changes.length]);
  const here = options?.find((o) => o.current);
  return (
    <Panel title={m.moves.title} aside={m.moves.note}>
      {live && (
        <div className="off__row">
          <Dropdown
            label={m.moves.player}
            size="md"
            value={pid}
            options={[
              { value: "", label: m.moves.pick },
              ...v.my_roster.map((x) => ({ value: x.id, label: x.name, hint: `${x.pos} · ${x.overall}` })),
            ]}
            onChange={setPid}
          />
          {options && options.length > 1 && here && (
            <Dropdown
              label={m.moves.to}
              size="md"
              disabled={busy}
              value={here.pos}
              options={options.map((o) => ({
                value: o.pos,
                label: o.pos,
                hint: o.current ? m.moves.now(o.overall) : m.moves.would(o.overall),
              }))}
              onChange={(pos) => pos !== here.pos && act("/position", { pid, pos })}
            />
          )}
        </div>
      )}
      {v.position_changes.length ? (
        <ul className="off__list">
          {v.position_changes.map((c, i) => (
            <li key={i}>
              <b>{c.name}</b>
              <span className="off__soft">{m.moves.line(c.from, c.to)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{m.moves.none}</Empty>
      )}
    </Panel>
  );
}

// ---------- the transfer portal, a week at a time ----------

function Portal({ v, teams, onSection, live }: P) {
  const pt = v.portal;
  return (
    <Panels>
      <Panel title={m.portal.title} aside={pt.week ? m.portal.week(pt.week, pt.weeks) : undefined}>
        <PanelRows>
          <PanelRow label={m.portal.entrants} value={pt.entrants.toLocaleString("en-US")} />
          <PanelRow label={m.portal.signed} value={pt.signed.toLocaleString("en-US")} />
          <PanelRow
            label={m.portal.spots}
            value={String(v.open_spots)}
            tip={m.portal.spotsTip(v.roster, v.roster_limit)}
          />
          <PanelRow label={m.portal.offers} value={m.portal.offersLine(pt.offers.length, pt.offers_left)} />
        </PanelRows>
        {live && (
          <>
            <p className="off__soft">{m.portal.how}</p>
            <button type="button" className="off__next" onClick={() => onSection("recruiting")}>
              {m.portal.open}
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </>
        )}
      </Panel>
      <Panel title={m.portal.board} aside={pt.board ? m.portal.onBoard(pt.board.count) : undefined}>
        {pt.board?.rows.length ? (
          <ul className="off__list">
            {pt.board.rows.map((x) => (
              <li key={x.id}>
                <span className="off__who">
                  <b>{x.name}</b>
                  <span className="off__soft">{x.pos}</span>
                </span>
                <b className="off__num">{x.overall}</b>
                <Tag solid={!!x.signed}>
                  {x.signed
                    ? m.portal.signedWith(teamName(teams, x.signed))
                    : x.committed
                      ? m.portal.committedTo(teamName(teams, x.committed))
                      : x.offered
                        ? m.portal.offered
                        : m.portal.watching}
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{m.portal.noBoard}</Empty>
        )}
      </Panel>
      <Moves v={v} teams={teams} />
      {pt.away.length > 0 && (
        <Panel title={m.portal.away}>
          <ul className="off__list">
            {pt.away.map((x) => (
              <li key={x.id}>
                <span className="off__who">
                  <b>{x.name}</b>
                  <span className="off__soft">{x.line}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Panels>
  );
}

/** The portal moves in and out of your program so far. */
function Moves({ v, teams }: Pick<P, "v" | "teams">) {
  if (!v.portal.moves_mine.length) return null;
  return (
    <Panel title={m.portal.moves}>
      <ul className="off__list">
        {v.portal.moves_mine.map((x) => (
          <li key={x.id}>
            <span className="off__who">
              <b>{x.name}</b>
              <span className="off__soft">{x.pos}</span>
            </span>
            <b className="off__num">{x.overall}</b>
            <span className="off__soft">
              {m.portal.move(teamName(teams, x.from), teamName(teams, x.to), !!x.walk_on)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------- Development ----------

function Development({ v, teams }: P) {
  const rep = v.report;
  const rec = v.portal_recap;
  type Row = NonNullable<typeof rep>["mine"][number];
  const cols: Column<Row>[] = [
    { key: "who", label: m.cols.player, render: (x) => who(x), sort: (x) => x.name },
    {
      key: "gain",
      label: m.cols.gain,
      num: true,
      render: (x) => (x.gain > 0 ? `+${x.gain}` : x.gain),
      sort: (x) => x.gain,
    },
    { key: "ovr", label: m.cols.now, num: true, render: (x) => x.overall, sort: (x) => x.overall },
    { key: "why", label: m.cols.why, render: (x) => <span className="off__soft">{x.why.join(" · ")}</span> },
  ];
  return (
    <Panels>
      <Panel title={m.dev.title} aside={rep ? m.dev.walkOns(rep.walk_ons) : undefined} className="off__wide">
        {rep?.mine.length ? (
          <DataTable label={m.dev.title} columns={cols} rows={rep.mine} rowKey={(x) => x.id} sortBy="gain" />
        ) : (
          <Empty>{m.dev.none}</Empty>
        )}
      </Panel>
      {rec && (
        <Panel title={m.dev.portal} aside={m.dev.portalLine(rec.signed_league, rec.entrants)}>
          <h4 className="label off__kicker">{m.dev.got(rec.signed.length)}</h4>
          <ul className="off__list">
            {rec.signed.map((x) => (
              <li key={x.id}>
                {who(x)}
                <b className="off__num">{x.overall}</b>
              </li>
            ))}
          </ul>
          <h4 className="label off__kicker">{m.dev.lost(rec.lost.length)}</h4>
          <ul className="off__list">
            {rec.lost.map((x) => (
              <li key={x.id}>
                {who(x)}
                <span className="off__soft">{m.dev.lostLine(x.to_name, x.reason)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Moves v={v} teams={teams} />
    </Panels>
  );
}

// ---------- Staff, and the jobs ----------

function Staff({ v, teams, busy, live, act, season }: P) {
  const st = v.staff;
  const job = v.job;
  const leaving = new Set(st?.leaving.map((s) => s.id) ?? []);
  const jobRow = (j: JobRow, taking: boolean) => (
    <li key={j.team}>
      <Swatch team={teams.get(j.team)} size={16} />
      <span className="off__who">
        <b>{j.name}</b>
        <span className="off__soft">
          {j.conference} · {j.goal}
        </span>
      </span>
      {live && (
        <Btn on={taking} disabled={busy} onClick={() => act("/job", { team: taking ? null : j.team })}>
          {taking ? m.staff.taking : m.staff.take}
        </Btn>
      )}
    </li>
  );
  return (
    <Panels>
      <Panel title={m.staff.yours} aside={season.team_name}>
        <ul className="off__list">
          {v.your_staff.map((s) => (
            <li key={s.id}>
              <span className="off__who">
                <b>{s.name}</b>
                <span className="off__soft">
                  {m.staff.roles[s.role] ?? s.role}
                  {st?.contract[s.id]?.until ? ` · ${m.staff.through(st.contract[s.id].until!)}` : ""}
                </span>
              </span>
              {leaving.has(s.id) ? (
                <Tag>{m.staff.leaving}</Tag>
              ) : (
                live && (
                  <Btn disabled={busy} title={m.staff.letGoTip} onClick={() => act("/open_role", { staff_id: s.id })}>
                    {m.staff.letGo}
                  </Btn>
                )
              )}
            </li>
          ))}
        </ul>
        {st && st.renewed.length > 0 && (
          <p className="off__soft">{m.staff.renewed(st.renewed.map((r) => `${r.name} (${r.through})`).join(", "))}</p>
        )}
      </Panel>

      {st?.leaving.map((s) => (
        <Panel
          key={s.id}
          title={m.staff.opening(m.staff.roles[s.role] ?? s.role)}
          aside={m.staff.reason(s.name, st.reasons[s.id] ?? "")}
        >
          <ul className="off__cands">
            {(st.candidates[s.id] ?? []).map((c: Candidate, i) => {
              const picked = st.hired[s.id] === i;
              return (
                <li key={`${c.name}-${i}`} className={picked ? "is-picked" : undefined}>
                  <span className="off__who">
                    <b>{c.name}</b>
                    <span className="off__soft">
                      {[c.age ? m.staff.age(c.age) : "", c.previous_job, c.years ? m.staff.years(c.years) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <dl className="off__ratings">
                    <div>
                      <dt>{m.staff.evaluation}</dt>
                      <dd>{c.evaluation}</dd>
                    </div>
                    <div>
                      <dt>{m.staff.recruiting}</dt>
                      <dd>{c.recruiting}</dd>
                    </div>
                    {c.play_calling != null && (
                      <div>
                        <dt>{m.staff.playCalling}</dt>
                        <dd>{c.play_calling}</dd>
                      </div>
                    )}
                  </dl>
                  {live ? (
                    <Btn on={picked} disabled={busy} onClick={() => act("/hire", { staff_id: s.id, index: i })}>
                      {picked ? m.staff.hired : m.staff.hire}
                    </Btn>
                  ) : (
                    picked && <Tag solid>{m.staff.hired}</Tag>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="off__soft">{m.staff.auto}</p>
        </Panel>
      ))}

      {job && (job.offers.length > 0 || job.openings.length > 0) && (
        <Panel title={job.offers.length ? m.staff.offers : m.staff.openings} aside={m.staff.jobNote}>
          <ul className="off__list">{[...job.offers, ...job.openings].map((j) => jobRow(j, job.choice === j.team))}</ul>
        </Panel>
      )}

      {st && st.developed.length > 0 && (
        <Panel title={m.staff.developed}>
          <ul className="off__list">
            {st.developed.map((d) => (
              <li key={d.id} className="off__stack">
                <span className="off__who">
                  <b>{d.name}</b>
                  <span className="off__soft">
                    {m.staff.roles[d.role] ?? d.role}
                    {d.why.length ? ` · ${d.why.join(", ")}` : ""}
                  </span>
                </span>
                <span className="off__soft">
                  {d.changes.map((c) => m.staff.change(c.rating, c.from, c.to)).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {v.coaching_changes.length > 0 && (
        <Panel title={m.staff.carousel} aside={m.staff.carouselCount(v.coaching_changes.length)}>
          <ul className="off__list">
            {v.coaching_changes.map((c, i) => (
              <li key={i}>
                <Swatch team={teams.get(c.team)} size={14} />
                <span className="off__who">
                  <b>{teamName(teams, c.team)}</b>
                  <span className="off__soft">
                    {c.new
                      ? m.staff.hiredLine(c.new, m.staff.roles[c.role] ?? c.role, c.from)
                      : m.staff.changeLine(c.old ?? "", m.staff.roles[c.role] ?? c.role, c.reason)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Panels>
  );
}

// ---------- Change Conferences ----------

function Conferences({ v, teams, busy, live, act, get }: P) {
  const [view, setView] = useState<ConferencesView | null>(null);
  const [team, setTeam] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    get<ConferencesView>("/conferences")
      .then((r) => on && setView(r))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [tick, v.stage]);
  if (!view) return <Empty>{m.loading}</Empty>;
  const all = view.conferences.flatMap((c) => c.teams.map((t) => ({ ...t, conf: c.name })));
  const picked = all.find((t) => t.team === team);
  const open = live && view.open;
  const move = async (conference: string) => {
    if (await act("/conference", { team, conference })) setTick((n) => n + 1);
  };
  return (
    <>
      {open && (
        <div className="off__tool">
          <span className="off__soft">{m.conf.how}</span>
          <Dropdown
            label={m.conf.team}
            size="md"
            value={team}
            options={[
              { value: "", label: m.conf.pick },
              ...all
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => ({ value: t.team, label: t.name, hint: t.conf })),
            ]}
            onChange={setTeam}
          />
          {picked && (
            <Dropdown
              label={m.conf.to}
              size="md"
              disabled={busy}
              value={picked.conf}
              options={view.conferences.map((c) => ({
                value: c.name,
                label: c.name,
                hint: c.name === picked.conf ? m.conf.now : undefined,
              }))}
              onChange={(c) => c !== picked.conf && void move(c)}
            />
          )}
        </div>
      )}
      <div className="off__confs">
        {view.conferences.map((c) => (
          <Panel key={c.name} title={c.name} aside={m.conf.count(c.teams.length)}>
            <ul className="off__teams">
              {c.teams.map((t) => (
                <li
                  key={t.team}
                  className={t.moved_from ? "is-moved" : undefined}
                  title={t.moved_from ? m.conf.movedFrom(t.moved_from) : undefined}
                >
                  <Swatch team={teams.get(t.team)} size={12} />
                  {t.name}
                  {t.moved_from && <Tag>{m.conf.moved}</Tag>}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}

// ---------- Edit Schedule ----------

function Schedule({ v, teams, busy, live, act, get, season }: P) {
  const [view, setView] = useState<NextSchedule | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    get<NextSchedule>("/schedule")
      .then((r) => on && setView(r))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [tick, v.stage]);
  if (!view) return <Empty>{m.loading}</Empty>;
  const me = view.team ?? season.team;
  const editable = new Map(view.editable.map((g) => [g.event_id, g]));
  const trade = async (event_id: string, slug: string) => {
    if (await act("/schedule", { event_id, slug })) setTick((n) => n + 1);
  };
  return (
    <Panel title={m.sched.title(v.year)} aside={live && view.open ? m.sched.note : undefined} className="off__wide">
      {!view.games.length ? (
        <Empty>{m.sched.none}</Empty>
      ) : (
        <ol className="off__games">
          {view.games.map((g) => {
            const home = g.home === me;
            const opp = home ? g.away : g.home;
            const e = editable.get(g.event_id);
            return (
              <li key={g.event_id}>
                <span className="off__week">{season.week_labels[String(g.week)] ?? m.sched.week(g.week)}</span>
                <span className="off__soft">{g.neutral ? m.sched.neutral : home ? m.sched.vs : m.sched.at}</span>
                <Swatch team={teams.get(opp)} size={14} />
                <b className="off__grow">{home ? g.away_display : g.home_display}</b>
                <Tag>{g.conference_game ? m.sched.conference : m.sched.nonConference}</Tag>
                {live && view.open && e?.options && (
                  <Dropdown
                    label={m.sched.trade}
                    size="md"
                    align="right"
                    disabled={busy}
                    value=""
                    options={[
                      { value: "", label: m.sched.keep },
                      ...e.options
                        .filter((o) => o.accepts)
                        .map((o) => ({ value: o.slug, label: o.name, hint: `${o.conference} · ${o.why}` })),
                    ]}
                    onChange={(slug) => slug && void trade(g.event_id, slug)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

// ---------- Ready ----------

function Ready({ v, season }: P) {
  const lost = v.departures.mine.length;
  const gained = v.portal.moves_mine.filter((x) => x.to === season.team).length;
  return (
    <Panels>
      <Panel title={m.ready.title(v.year)}>
        <PanelRows>
          <PanelRow label={m.ready.goal} value={v.goal_next ?? v.review?.goal} />
          <PanelRow label={m.ready.roster} value={m.ready.rosterLine(v.roster, v.roster_limit)} />
          <PanelRow label={m.ready.signed} value={String(v.signed)} />
          <PanelRow label={m.ready.portalIn} value={String(gained)} />
          <PanelRow label={m.ready.left} value={String(lost)} />
        </PanelRows>
        <p className="off__soft">{m.ready.text}</p>
      </Panel>
      {v.review && (
        <Panel title={m.review.title} aside={<Tag solid={v.review.met}>{v.review.mood}</Tag>}>
          <p className="off__lede">{v.review.words}</p>
        </Panel>
      )}
    </Panels>
  );
}

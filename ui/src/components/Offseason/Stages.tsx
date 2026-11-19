import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import Dropdown from "../Dropdown/index.tsx";
import Modal from "../Modal/index.tsx";
import Face from "../Face/index.tsx";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import PlayerWindow, { type PlayerRef } from "../PlayerWindow/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { inkOn } from "../../colors.ts";
import { playerFace } from "../../faces.ts";
import { formatClass } from "../../format.ts";
import type { TeamCard } from "../../types.ts";
import type { StageProps } from "./index.tsx";
import { messages as m } from "./messages.ts";
import type { Candidate, ConferencesView, Departure, Grown, JobRow, Leaver, NextSchedule } from "./types.ts";

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
/** A tag in a school's own color (a player signed there, a coach hired there). */
const TeamTag = ({ children, team }: { children: ReactNode; team: TeamCard | undefined }) => (
  <span
    className="off__tag is-team"
    style={team ? ({ "--c": team.colors.primary, "--on": inkOn(team.colors.primary) } as CSSProperties) : undefined}
  >
    {children}
  </span>
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

/** *tune* A released card's fade, and the slide of the cards that close up after it, in ms. */
const CARD_FADE = 180;
const CARD_SLIDE = 320;

function Retention(p: P) {
  const { v, busy, live, act } = p;
  const rt = v.retention;
  // the ones you let go drop to the back of the row, in the order they were in
  const ordered = [...rt.players.filter((x) => !x.offers.released), ...rt.players.filter((x) => x.offers.released)];
  const order = ordered.map((x) => x.id).join("|");

  // When a card is let go: the row stays scrolled where it is, the card fades out where it stood, the cards after it
  // slide forward to close the gap, and it fades back in at the end of the row.
  /** a player whose full card is open over the row */
  const [card, setCard] = useState<PlayerRef | null>(null);
  const row = useRef<HTMLUListElement>(null);
  const lefts = useRef(new Map<string, number>());
  const wasGone = useRef(new Set<string>());
  const scrollAt = useRef(0);
  useLayoutEffect(() => {
    const ul = row.current;
    if (!ul) return;
    ul.scrollLeft = scrollAt.current; // a reorder must not move what you are looking at
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    const gone = new Set<string>();
    for (const li of [...ul.children] as HTMLElement[]) {
      const id = li.dataset.id ?? "";
      const left = li.offsetLeft;
      next.set(id, left);
      const released = li.classList.contains("is-gone");
      if (released) gone.add(id);
      const was = lefts.current.get(id);
      if (still || was == null) continue;
      const from = `translateX(${was - left}px)`;
      if (released && !wasGone.current.has(id)) {
        // the card just let go: out where it stood, then in at its new place (dimmed, as a released card rests)
        const cut = CARD_FADE / (CARD_FADE + CARD_SLIDE);
        li.animate(
          [
            { transform: from, opacity: 1 },
            { transform: from, opacity: 0, offset: cut },
            { transform: "none", opacity: 0, offset: Math.min(0.99, cut + 0.01) },
            { transform: "none", opacity: 0.55 },
          ],
          { duration: CARD_FADE + CARD_SLIDE, easing: "ease-out" },
        );
      } else if (was !== left) {
        // everyone else waits for the fade, then slides to where it now belongs
        li.animate([{ transform: from }, { transform: "none" }], {
          duration: CARD_SLIDE,
          delay: CARD_FADE,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        });
      }
    }
    lefts.current = next;
    wasGone.current = gone;
  }, [order]);
  return (
    <>
      {/* the players thinking of leaving: a row of cards that scrolls sideways, one a player */}
      <section className="off__keep" aria-label={m.keep.title}>
        <header className="off__keep-head">
          <h3>{m.keep.count(rt.players.length)}</h3>
          <span className="off__tag is-solid">{m.keep.pool(rt.left, rt.budget)}</span>
        </header>
        {!rt.players.length ? (
          <Empty>{m.keep.none}</Empty>
        ) : (
          <ul
            className="off__cards"
            tabIndex={0}
            ref={row}
            onScroll={(e) => {
              scrollAt.current = e.currentTarget.scrollLeft;
            }}
          >
            {ordered.map((x) => (
              <LeaverCard
                key={x.id}
                x={x}
                left={rt.left}
                busy={busy}
                live={live}
                act={act}
                onCard={() => setCard({ team: p.season.team, name: x.name })}
              />
            ))}
          </ul>
        )}
      </section>
      <PlayerWindow seasonId={p.season.id} who={card} weekLabels={p.season.week_labels} onClose={() => setCard(null)} />
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
  onCard,
}: {
  x: Leaver;
  left: number;
  busy: boolean;
  live: boolean;
  act: P["act"];
  /** open his full player card */
  onCard: () => void;
}) {
  const [nil, setNil] = useState(x.offers.nil || x.ask.nil || 0);
  const gone = x.offers.released;
  const style = {
    "--c": "var(--team, var(--ink))",
    "--on": "var(--team-on, var(--paper-hi))",
  } as CSSProperties;
  const ask = !x.met
    ? m.keep.askUnknown
    : x.ask.kind === "nil" && x.ask.nil
      ? m.keep.askNilShort(x.ask.nil)
      : x.ask.kind === "promise" || x.ask.kind === "role"
        ? m.keep.askRoleShort
        : m.keep.askNoneShort;
  return (
    <li className={`off-card${gone ? " is-gone" : ""}`} style={style} data-id={x.id}>
      <header className="off-card__top">
        <span className="face-tile off-card__face">
          <Face face={playerFace(x.id, x.pos)} scale={2} label="" />
        </span>
        <span className="off-card__name">
          <span className="off-card__pos">
            {x.pos} · {formatClass(x.cls)}
          </span>
          <button type="button" className="off-card__open" title={m.keep.openCard(x.name)} onClick={onCard}>
            {x.name}
          </button>
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

/** *tune* How many of the best players lost get a card of their own. */
const TOP_LOSSES = 5;
/** How a player left, in the order the board's columns stand. */
const WAYS = ["portal", "draft", "undrafted", "graduated", "quit"];

/**
 * Departures: who is gone, at a glance. Four numbers up top (how many left, how many to the portal, how Keep Them Home
 * went, the best player lost); the biggest losses as cards; then everyone as a board, a column for each way out
 * (portal, draft, graduated…), each player a bar of his overall so the weight of a column shows. Under it your
 * redshirt calls as tiles, and the draft's first round as a board of picks (folded: it is the league's news, not
 * yours).
 */
function Departures(p: P) {
  const { v, season, teams, busy, live, act } = p;
  const d = v.departures;
  const gone = [...d.mine].sort((a, b) => b.overall - a.overall);
  const results = v.retention.results ?? [];
  const stayed = results.filter((r) => r.status === "stayed").length;
  const best = gone[0];
  const top = gone.slice(0, TOP_LOSSES);
  const ways = [...new Set(gone.map((x) => x.kind))].sort(
    (a, b) => (WAYS.indexOf(a) + 1 || 99) - (WAYS.indexOf(b) + 1 || 99),
  );
  const how = (x: Departure) => x.kind_name ?? m.kinds[x.kind] ?? x.kind;
  const max = Math.max(...gone.map((x) => x.overall), 1);
  const cardStyle = {
    "--c": "var(--team, var(--ink))",
    "--on": "var(--team-on, var(--paper-hi))",
  } as CSSProperties;
  const rs = v.redshirts;
  const rsOpen = live && !rs.decided;
  const league = d.league;

  return (
    <div className="dev">
      <dl className="dev__stats">
        <div>
          <dt className="label">{m.departures.goneLabel}</dt>
          <dd>{gone.length}</dd>
        </div>
        <div>
          <dt className="label">{m.departures.portalLabel}</dt>
          <dd>{gone.filter((x) => x.kind === "portal").length}</dd>
        </div>
        {results.length > 0 && (
          <div>
            <dt className="label">{m.departures.keptLabel}</dt>
            <dd>{m.departures.keptLine(stayed, results.length)}</dd>
          </div>
        )}
        {best && (
          <div>
            <dt className="label">{m.departures.bestLabel}</dt>
            <dd>
              {best.overall} <small>{best.name}</small>
            </dd>
          </div>
        )}
      </dl>
      <p className="off__soft">
        {m.departures.leagueLine(
          league.portal ?? 0,
          league.graduated ?? 0,
          (league.draft ?? 0) + (league.declared ?? 0),
        )}
      </p>

      {!gone.length ? (
        <Empty>{m.departures.none}</Empty>
      ) : (
        <>
          <section aria-label={m.departures.biggest}>
            <h3 className="label dev__kicker">{m.departures.biggest}</h3>
            <ul className="dev__jumps">
              {top.map((x) => (
                <li key={x.id} className="dev-card" style={cardStyle}>
                  <header className="dev-card__top">
                    <span className="face-tile dev-card__face">
                      <Face face={playerFace(x.id, x.pos)} scale={2} label="" />
                    </span>
                    <b className="dev-card__gain">{x.overall}</b>
                  </header>
                  <b className="dev-card__name">{x.name}</b>
                  <span className="off__soft">
                    {x.pos} · {formatClass(x.cls)}
                  </span>
                  <span className="dev-card__line">
                    <Tag solid={x.kind === "portal"}>{how(x)}</Tag>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* everyone, a column for each way out */}
          <section className="dev__chart" aria-label={m.departures.yours}>
            <header className="dev__chart-head">
              <h3 className="label dev__kicker">{m.departures.yours}</h3>
            </header>
            <div className="gone">
              {ways.map((w) => {
                const list = gone.filter((x) => x.kind === w);
                return (
                  <section key={w} className="gone__col">
                    <h4 className="gone__head">
                      <b>{how(list[0])}</b>
                      <span className="off__tag is-solid">{list.length}</span>
                    </h4>
                    <ol className="gone__list">
                      {list.map((x) => (
                        <li key={x.id}>
                          <span className="dev__who gone__who">
                            <b>{x.name}</b>
                            <span className="off__soft">{x.pos}</span>
                          </span>
                          <span className="dev__track" aria-hidden="true">
                            <i className="dev__gain" style={{ left: 0, width: `${(100 * x.overall) / max}%` }} />
                          </span>
                          <b className="dev__now">{x.overall}</b>
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* your redshirt calls: a tile a player, his switch on it */}
      {rs.players.length > 0 && (
        <section aria-label={m.redshirts.title}>
          <h3 className="label dev__kicker">
            {m.redshirts.title} · {rsOpen ? m.redshirts.note : m.redshirts.decided}
          </h3>
          <ul className="shirts">
            {rs.players.map((x) => (
              <li key={x.id} className={`shirt${x.redshirt ? " is-on" : ""}`}>
                <span className="shirt__who">
                  <b>{x.name}</b>
                  <span className="off__soft">
                    {x.pos} · {formatClass(x.cls)} · {m.redshirts.games(x.games, x.team_games)}
                  </span>
                </span>
                <b className="off__num">{x.overall}</b>
                {rsOpen ? (
                  <button
                    type="button"
                    className={`off__btn${x.redshirt ? " is-on" : ""}`}
                    disabled={busy}
                    aria-pressed={x.redshirt}
                    onClick={() => act("/redshirt", { pid: x.id, on: !x.redshirt })}
                  >
                    {x.redshirt ? m.redshirts.on : m.redshirts.off}
                  </button>
                ) : (
                  <Tag solid={x.redshirt}>{x.redshirt ? m.redshirts.on : m.redshirts.off}</Tag>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* the draft's first round: the league's news, folded, as a board of picks */}
      {d.first_round.length > 0 && (
        <Panel
          title={m.departures.firstRound}
          aside={m.departures.picks(d.first_round.length)}
          collapsible
          defaultOpen={false}
          className="gone__draft"
        >
          <ol className="picks">
            {d.first_round.slice(0, 32).map((x) => (
              <li key={x.id} className={`pick${x.team === season.team ? " is-mine" : ""}`}>
                <span className="pick__n">{x.pick}</span>
                <Swatch team={teams.get(x.team)} size={16} />
                <span className="pick__who">
                  <b>{x.name}</b>
                  <span className="off__soft">
                    {x.pos} · {teams.get(x.team)?.abbreviation ?? x.team_name}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

// ---------- the transfer portal, a week at a time ----------

function Portal({ v, teams, onSection, live, season }: P) {
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
                {x.signed || x.committed ? (
                  <TeamTag team={teams.get(x.signed ?? x.committed ?? "")}>
                    {x.signed
                      ? m.portal.signedWith(teamName(teams, x.signed))
                      : m.portal.committedTo(teamName(teams, x.committed ?? ""))}
                  </TeamTag>
                ) : (
                  <Tag>{x.offered ? m.portal.offered : m.portal.watching}</Tag>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{m.portal.noBoard}</Empty>
        )}
      </Panel>
      <Moves v={v} teams={teams} me={season.team} />
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
function Moves({ v, teams, me }: Pick<P, "v" | "teams"> & { me: string }) {
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
            {/* where he came from and where he went, each in its colors; In or Out is from your side */}
            <span className="off__move">
              <Swatch team={teams.get(x.from)} size={14} />
              {teams.get(x.from)?.abbreviation ?? teamName(teams, x.from)}
              <ArrowRight size={12} weight="bold" aria-hidden="true" />
              <Swatch team={teams.get(x.to)} size={14} />
              {teams.get(x.to)?.abbreviation ?? teamName(teams, x.to)}
              {x.walk_on && <span className="off__soft">{m.portal.walkOn}</span>}
            </span>
            {x.to === me ? <TeamTag team={teams.get(me)}>{m.portal.in}</TeamTag> : <Tag>{m.portal.out}</Tag>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------- Development ----------

type Unit = "all" | "offense" | "defense" | "special";
const OFFENSE = new Set(["QB", "HB", "RB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "OL", "OT", "IOL"]);
const SPECIAL = new Set(["K", "P", "KR", "PR"]);
const unitOf = (pos: string): Unit => (SPECIAL.has(pos) ? "special" : OFFENSE.has(pos) ? "offense" : "defense");
/**
 * The game's notes on a player's offseason (coach_career/offseason.py growth_terms and the coachability roll), sorted
 * by what they say: what sped his growth up, what held it back, and a change to how coachable he is (which shapes the
 * years to come, not this jump).
 */
function notesOf(why: string[]) {
  const helped: string[] = [];
  const despite: string[] = [];
  const changed: string[] = [];
  for (const w of why) {
    if (/^struggled/i.test(w)) despite.push(w);
    else if (/^now an? /i.test(w)) changed.push(w);
    else helped.push(w);
  }
  return { helped, despite, changed };
}
/** The notes as one sentence, for a bar's hover. */
const notesLine = (why: string[]) => {
  const n = notesOf(why);
  return [
    n.helped.length ? m.dev.helped(n.helped.join(", ")) : "",
    n.despite.length ? m.dev.despite(n.despite.join(", ")) : "",
    ...n.changed,
  ]
    .filter(Boolean)
    .join(" ");
};
/** *tune* How many of the biggest jumps get a card of their own. */
const TOP_JUMPS = 5;

/**
 * Development: the offseason's growth at a glance. Four numbers up top (how many grew, the biggest jump, the average,
 * what the portal netted); the biggest jumps as cards; then everyone as a growth chart: a bar a player, the soft part
 * where he was and the part in your color what he gained, sorted by the gain and filtered by unit. Under it, the
 * portal's ins and outs as chips in each school's colors.
 */
function Development({ v, teams }: P) {
  const [unit, setUnit] = useState<Unit>("all");
  /** the player whose growth is open in a window */
  const [open, setOpen] = useState<Grown | null>(null);
  const rep = v.report;
  const rec = v.portal_recap;
  const all = [...(rep?.mine ?? [])].sort((a, b) => b.gain - a.gain || b.overall - a.overall);
  if (!rep || !all.length) return <Empty>{m.dev.none}</Empty>;
  const grew = all.filter((x) => x.gain > 0);
  const best = all[0];
  const avg = all.reduce((s, x) => s + x.gain, 0) / all.length;
  const top = all.slice(0, TOP_JUMPS).filter((x) => x.gain > 0);
  const shown = all.filter((x) => unit === "all" || unitOf(x.pos) === unit);
  // the chart's scale: the best rating on it, so the longest bar fills its track
  const max = Math.max(...all.map((x) => Math.max(x.overall, x.overall - x.gain)), 1);
  const cardStyle = {
    "--c": "var(--team, var(--ink))",
    "--on": "var(--team-on, var(--paper-hi))",
  } as CSSProperties;
  const signed = (x: number) => (x > 0 ? `+${x}` : String(x));
  const units: Unit[] = ["all", "offense", "defense", "special"];

  return (
    <div className="dev">
      <dl className="dev__stats">
        <div>
          <dt className="label">{m.dev.grew}</dt>
          <dd>{m.dev.grewOf(grew.length, all.length)}</dd>
        </div>
        <div>
          <dt className="label">{m.dev.biggest}</dt>
          <dd>
            {signed(best.gain)} <small>{best.name}</small>
          </dd>
        </div>
        <div>
          <dt className="label">{m.dev.average}</dt>
          <dd>{signed(Math.round(avg * 10) / 10)}</dd>
        </div>
        {rec && (
          <div>
            <dt className="label">{m.dev.portalNet}</dt>
            <dd>{m.dev.portalNetLine(rec.signed.length, rec.lost.length)}</dd>
          </div>
        )}
      </dl>

      {top.length > 0 && (
        <section aria-label={m.dev.jumps}>
          <h3 className="label dev__kicker">{m.dev.jumps}</h3>
          <ul className="dev__jumps">
            {top.map((x) => (
              <li key={x.id} className="dev-card" style={cardStyle}>
                <button
                  type="button"
                  className="dev-card__open"
                  aria-label={m.dev.openGrowth(x.name)}
                  title={m.dev.openGrowth(x.name)}
                  onClick={() => setOpen(x)}
                />
                <header className="dev-card__top">
                  <span className="face-tile dev-card__face">
                    <Face face={playerFace(x.id, x.pos)} scale={2} label="" />
                  </span>
                  <b className="dev-card__gain">{signed(x.gain)}</b>
                </header>
                <b className="dev-card__name">{x.name}</b>
                <span className="off__soft">
                  {x.pos} · {formatClass(x.cls)}
                </span>
                <span className="dev-card__line">
                  {x.overall - x.gain} <ArrowRight size={12} weight="bold" aria-hidden="true" /> <b>{x.overall}</b>
                </span>
                <Notes why={x.why} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dev__chart" aria-label={m.dev.title}>
        <header className="dev__chart-head">
          <h3 className="label dev__kicker">{m.dev.title}</h3>
          <div className="off__row" role="group" aria-label={m.dev.unitLabel}>
            {units.map((u) => (
              <button
                key={u}
                type="button"
                className={`off__btn${unit === u ? " is-on" : ""}`}
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
              >
                {m.dev.units[u]}
              </button>
            ))}
          </div>
          <span className="dev__legend" aria-hidden="true">
            <i className="dev__key dev__key--was" />
            {m.dev.was}
            <i className="dev__key dev__key--gain" />
            {m.dev.gained}
          </span>
        </header>
        {shown.length ? (
          <ol className="dev__bars">
            {shown.map((x) => {
              const before = x.overall - x.gain;
              const lo = Math.min(before, x.overall);
              return (
                <li key={x.id} title={notesLine(x.why) || undefined}>
                  <button
                    type="button"
                    className="dev__who"
                    title={m.dev.openGrowth(x.name)}
                    onClick={() => setOpen(x)}
                  >
                    <b>{x.name}</b>
                    <span className="off__soft">{x.pos}</span>
                  </button>
                  <span className="dev__track" aria-hidden="true">
                    <i className="dev__was" style={{ width: `${(100 * lo) / max}%` }} />
                    <i
                      className={`dev__gain${x.gain < 0 ? " is-loss" : ""}`}
                      style={{ left: `${(100 * lo) / max}%`, width: `${(100 * Math.abs(x.gain)) / max}%` }}
                    />
                  </span>
                  <b className="dev__now">{x.overall}</b>
                  <span className={`dev__delta${x.gain > 0 ? " is-up" : ""}`}>{signed(x.gain)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty>{m.dev.noneInUnit}</Empty>
        )}
      </section>

      {rec && (rec.signed.length > 0 || rec.lost.length > 0) && (
        <section className="dev__portal" aria-label={m.dev.portal}>
          <div>
            <h3 className="label dev__kicker">{m.dev.got(rec.signed.length)}</h3>
            <ul className="dev__chips">
              {rec.signed.map((x) => (
                <li key={x.id} className="dev__chip is-in">
                  <b>{x.name}</b>
                  <span className="off__soft">
                    {x.pos} · {x.overall}
                  </span>
                </li>
              ))}
              {!rec.signed.length && <li className="off__soft">{m.dev.nobody}</li>}
            </ul>
          </div>
          <div>
            <h3 className="label dev__kicker">{m.dev.lost(rec.lost.length)}</h3>
            <ul className="dev__chips">
              {rec.lost.map((x) => (
                <li key={x.id} className="dev__chip" title={x.reason}>
                  <b>{x.name}</b>
                  <span className="off__soft">
                    {x.pos} · {x.overall}
                  </span>
                  <span className="off__move">
                    <ArrowRight size={12} weight="bold" aria-hidden="true" />
                    <Swatch team={teams.get((x as { to?: string }).to ?? "")} size={12} />
                    {x.to_name}
                  </span>
                </li>
              ))}
              {!rec.lost.length && <li className="off__soft">{m.dev.nobody}</li>}
            </ul>
          </div>
        </section>
      )}
      <GrowthWindow who={open} style={cardStyle} onClose={() => setOpen(null)} />
    </div>
  );
}

/** *tune* A rating counts as one that lifted his overall when its weight in his position's formula is at least this. */
const MAIN_WEIGHT = 0.03;
const ratingName = (key: string) =>
  m.dev.ratingNames[key] ?? key.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * One player's offseason in a window: his overall before and after, the game's notes, and every rating that moved.
 * What Lifted His Overall: the ratings his position's overall is built on, biggest lift first, each as a bar (the soft
 * part where it was, the part in your color what it gained) with what it added to his overall. Also Improved: the
 * rest, folded. A report made before the game kept each change says so.
 */
function GrowthWindow({ who, style, onClose }: { who: Grown | null; style: CSSProperties; onClose: () => void }) {
  const rows = (who?.grew ?? [])
    .map((g) => ({ ...g, label: ratingName(g.key), lift: (g.w ?? 0) * (g.to - g.from) }))
    .sort((a, b) => b.lift - a.lift || b.to - b.from - (a.to - a.from));
  const main = rows.filter((r) => Math.abs(r.w ?? 0) >= MAIN_WEIGHT);
  const rest = rows.filter((r) => Math.abs(r.w ?? 0) < MAIN_WEIGHT).sort((a, b) => b.to - b.from - (a.to - a.from));
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const bars = (list: typeof rows, lifts: boolean) => (
    <ol className="growth__bars">
      {list.map((r) => {
        const lo = Math.min(r.from, r.to);
        return (
          <li key={r.key} className={lifts ? "has-lift" : undefined}>
            <span className="growth__label">{r.label}</span>
            <span className="dev__track" aria-hidden="true">
              <i className="dev__was" style={{ width: `${lo}%` }} />
              <i
                className={`dev__gain${r.to < r.from ? " is-loss" : ""}`}
                style={{ left: `${lo}%`, width: `${Math.abs(r.to - r.from)}%` }}
              />
            </span>
            <span className="growth__from">{r.from}</span>
            <b className="dev__now">{r.to}</b>
            <span className={`dev__delta${r.to > r.from ? " is-up" : ""}`}>{signed(r.to - r.from)}</span>
            {lifts && (
              <span className="growth__lift" title={m.dev.liftTip}>
                {m.dev.lift(Math.round(r.lift * 10) / 10)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <Modal open={!!who} onClose={onClose} title={who?.name ?? ""} head={<span />} size="talk">
      {who && (
        <div className="growth" style={style}>
          <header className="growth__head">
            <span className="face-tile growth__face">
              <Face face={playerFace(who.id, who.pos)} scale={2} label="" />
            </span>
            <span className="growth__name">
              <b>{who.name}</b>
              <span className="off__soft">
                {who.pos} · {formatClass(who.cls)}
              </span>
            </span>
            <span className="growth__ovr">
              <span className="label">{m.dev.overall}</span>
              <span className="growth__line">
                {who.overall - who.gain} <ArrowRight size={14} weight="bold" aria-hidden="true" /> <b>{who.overall}</b>
              </span>
            </span>
            <b className="growth__gain">{signed(who.gain)}</b>
          </header>
          <Notes why={who.why} />
          {!who.grew ? (
            <p className="off__soft">{m.dev.noDetail}</p>
          ) : !rows.length ? (
            <p className="off__soft">{m.dev.noChange}</p>
          ) : (
            <>
              <section>
                <h4 className="label dev__kicker">{m.dev.lifted(main.length)}</h4>
                {main.length ? bars(main, true) : <p className="off__soft">{m.dev.noLift}</p>}
              </section>
              {rest.length > 0 && (
                <Panel title={m.dev.also(rest.length)} collapsible defaultOpen={false} className="growth__rest">
                  <div className="growth__cols">{bars(rest, false)}</div>
                </Panel>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** A jump card's notes, each kind under its own word: what helped, what he grew in spite of, what changed in him. */
function Notes({ why }: { why: string[] }) {
  const n = notesOf(why);
  if (!why.length) return null;
  const line = (label: string, items: string[]) =>
    items.length > 0 && (
      <span className="dev-card__note">
        <span className="label">{label}</span>
        {items.join(" · ")}
      </span>
    );
  return (
    <span className="dev-card__why">
      {line(m.dev.helpedLabel, n.helped)}
      {line(m.dev.despiteLabel, n.despite)}
      {line(m.dev.changedLabel, n.changed)}
    </span>
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

import { useEffect, useMemo, useState } from "react";
import { CaretDown, Star } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Face from "../Face/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import SectionTabs, { SectionPane } from "../SectionTabs/index.tsx";
import CoverageMap from "./CoverageMap.tsx";
import { api } from "../../api.ts";
import { setOnBoard } from "../../board.ts";
import { playerFace, staffFace } from "../../faces.ts";
import type { ReportGroup, ReportItem, Scout, ScoutFlag, ScoutingView } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

type Tab = "scouts" | "reports";
type Week = "this_week" | "last_week" | "finds";

interface Props {
  seasonId: string;
  year: number;
  /** a board change here: the Board reloads */
  onBoardChange: () => void;
}

/** The roles in the order the cards list them: coordinators, then recruiters. */
const ROLE_ORDER = ["Offensive Coordinator", "Defensive Coordinator", "Recruiter"];
const ROLE_SHORT: Record<string, string> = { "Offensive Coordinator": "OC", "Defensive Coordinator": "DC" };

/** A report line as a sentence: "First read: potential Strong–All-American." */
const sentence = (t: string) => (t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "");

/** This week's finds: a prospect a scout flagged or a coordinator liked, once each. */
function findsOf(v: ScoutingView): number {
  const seen = new Set<string>();
  for (const g of v.reports.this_week) for (const it of g.items) if (it.flags.length || it.likes) seen.add(it.pid);
  return seen.size;
}

/**
 * Staff: the people who work for you. Scouts: each coordinator and recruiter as a card (his face, his eye for
 * talent, his contract and his area, which you set here), beside a map of the country by scouting area with each
 * scout's face on his; pick a scout, then an area, to move him. Reports: what each scout found this week and last,
 * and the finds your staff flagged this class. Scouting a prospect yourself happens on Prospects.
 */
export default function Staff({ seasonId, year, onBoardChange }: Props) {
  const [tab, setTab] = useState<Tab>("scouts");
  const [view, setView] = useState<ScoutingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [week, setWeek] = useState<Week>("this_week");

  const load = () =>
    api<ScoutingView>(`/api/season/${seasonId}/scouting?limit=1`)
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [seasonId]);

  const scouts = useMemo(
    () =>
      [...(view?.scouts ?? [])].sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id.localeCompare(b.id),
      ),
    [view],
  );
  const pickedScout = scouts.find((s) => s.id === picked) ?? null;

  const assign = async (s: Scout, area: string) => {
    if (s.area === area) return;
    try {
      await api(`/api/season/${seasonId}/staff`, { method: "POST", body: { staff_id: s.id, area } });
      await load();
      setNote(m.moved(s.name, area));
    } catch (e) {
      setNote(m.failed((e as Error).message));
    }
  };

  // the map: with a scout picked, an area sends him there; else it picks the scout already there
  const onArea = (area: string) => {
    if (pickedScout) void assign(pickedScout, area);
    else setPicked(scouts.find((s) => s.area === area)?.id ?? null);
  };

  const toggleBoard = async (pid: string, on: boolean) => {
    try {
      await setOnBoard(seasonId, [pid], on);
      await load();
      onBoardChange();
    } catch (e) {
      setNote(m.boardError((e as Error).message));
    }
  };

  const finds = view ? findsOf(view) : 0;
  const areaCount = view ? Object.keys(view.areas ?? {}).length : 0;
  const covered = new Set(scouts.map((s) => s.area).filter(Boolean)).size;

  return (
    <div className="section-tabs__wrap staff">
      <SectionTabs
        title={m.title}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "scouts", label: m.tabs.scouts, count: scouts.length || undefined },
          { key: "reports", label: m.tabs.reports, count: finds ? m.newFinds(finds) : undefined },
        ]}
      />
      {!view ? (
        <p className="staff__note" role="status">
          {error ? m.loadError(error) : m.loading}
        </p>
      ) : (
        <>
          <SectionPane shown={tab === "scouts"}>
            <div className="staff__scouts">
              <Totals v={view} />
              <div className="staff__cols">
                <ul className="staff__list" aria-label={m.scoutsLabel}>
                  {scouts.map((s) => (
                    <ScoutCard
                      key={s.id}
                      s={s}
                      year={year}
                      areas={Object.keys(view.areas ?? {})}
                      sharedWith={scouts.filter((o) => o.id !== s.id && o.area && o.area === s.area)}
                      picked={s.id === picked}
                      onPick={() => setPicked(s.id === picked ? null : s.id)}
                      onArea={(a) => void assign(s, a)}
                    />
                  ))}
                </ul>
                <section className="staff__map" aria-label={m.mapLabel}>
                  <header className="staff__map-head">
                    <b className="label">{m.covered(covered, areaCount)}</b>
                  </header>
                  <CoverageMap areas={view.areas ?? {}} scouts={scouts} picked={pickedScout} onArea={onArea} />
                  <p className="staff__soft">{m.howItWorks}</p>
                  <p className="staff__toast" role="status" aria-live="polite">
                    {note ?? ""}
                  </p>
                </section>
              </div>
            </div>
          </SectionPane>
          <SectionPane shown={tab === "reports"}>
            <Reports v={view} week={week} onWeek={setWeek} onBoard={toggleBoard} scouts={scouts} />
          </SectionPane>
        </>
      )}
    </div>
  );
}

/** The week's scouting numbers: points (a bar), trips, full reports, your board's share with a look. */
function Totals({ v }: { v: ScoutingView }) {
  const share = (a: number, b: number) => `${Math.round(100 * (b ? Math.min(1, a / b) : 0))}%`;
  return (
    <dl className="staff__totals">
      <div className="staff__total staff__total--points" title={m.pointsTip(v.points_left, v.points_week)}>
        <dt className="label">{m.points}</dt>
        <dd>
          <b>{m.pointsOf(v.points_left, v.points_week)}</b>
          <span className="staff__bar" aria-hidden="true">
            <i style={{ width: share(v.points_left, v.points_week) }} />
          </span>
        </dd>
      </div>
      <div className="staff__total">
        <dt className="label">{m.trips}</dt>
        <dd>
          <b>{v.trips_this_week}</b>
        </dd>
      </div>
      <div className="staff__total">
        <dt className="label">{m.fullReports}</dt>
        <dd>
          <b>{v.full_reports}</b>
        </dd>
      </div>
      <div className="staff__total">
        <dt className="label">{m.boardScouted}</dt>
        <dd>
          <b>{m.ofN(v.board_scouted, v.board_size)}</b>
        </dd>
      </div>
    </dl>
  );
}

function ScoutCard({
  s,
  year,
  areas,
  sharedWith,
  picked,
  onPick,
  onArea,
}: {
  s: Scout;
  year: number;
  areas: string[];
  sharedWith: Scout[];
  picked: boolean;
  onPick: () => void;
  onArea: (area: string) => void;
}) {
  const last = s.contract_until != null && s.contract_until <= year;
  const y = s.yield;
  return (
    <li className={`scout${picked ? " is-picked" : ""}`}>
      <button type="button" className="scout__pick" aria-pressed={picked} onClick={onPick}>
        <span className="face-tile scout__face">
          <Face face={staffFace(s.name)} scale={2} label="" />
        </span>
        <span className="scout__who">
          <b className="scout__name">{s.name}</b>
          <span className="scout__role">
            {s.role}
            {ROLE_SHORT[s.role] && <span className="scout__short">{ROLE_SHORT[s.role]}</span>}
          </span>
          {s.contract_until != null && (
            <span className="scout__contract">
              {m.signedThrough(s.contract_until)}
              {last && <span className="scout__final">{m.finalYear}</span>}
            </span>
          )}
        </span>
        <span className="scout__eye" title={m.eyeTip}>
          <span className="label">{m.eye}</span>
          <b className={`scout__word scout__word--${s.evaluation_word.toLowerCase().replace(/[^a-z]/g, "")}`}>
            {s.evaluation_word}
          </b>
        </span>
      </button>
      <div className="scout__body">
        <label className="scout__area">
          <span className="label">{m.area}</span>
          <span className="scout__select">
            <select value={s.area ?? ""} aria-label={m.areaFor(s.name)} onChange={(e) => onArea(e.target.value)}>
              {!s.area && <option value="">{m.noArea}</option>}
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </span>
        </label>
        <p className="scout__line">
          <span>{m.lookingAt(s.looking_at)}</span>
          {sharedWith.length > 0 && (
            <span className="scout__warn">{m.shared(sharedWith.map((o) => o.name).join(", "))}</span>
          )}
        </p>
        <p className="scout__line">
          <span className="label">{m.thisWeek}</span>
          <span>{y.looks ? m.yieldLine(y.looks, y.narrowed, y.flags) : m.idle}</span>
        </p>
      </div>
    </li>
  );
}

/** The reports: each scout's for this week or last, or the finds your staff flagged this class. */
function Reports({
  v,
  week,
  onWeek,
  onBoard,
  scouts,
}: {
  v: ScoutingView;
  week: Week;
  onWeek: (w: Week) => void;
  onBoard: (pid: string, on: boolean) => Promise<void>;
  scouts: Scout[];
}) {
  const groups: ReportGroup[] = week === "finds" ? [] : v.reports[week];
  const counts: Record<Week, number> = {
    this_week: v.reports.this_week.length,
    last_week: v.reports.last_week.length,
    finds: v.flags.length,
  };
  const role = (id: string) => scouts.find((s) => s.id === id)?.role;
  return (
    <div className="staff__reports">
      <div className="staff__chips" role="group" aria-label={m.weeksLabel}>
        {(["this_week", "last_week", "finds"] as Week[]).map((w) => (
          <Chip key={w} on={week === w} count={counts[w]} onClick={() => onWeek(w)}>
            {m.weeks[w]}
          </Chip>
        ))}
      </div>
      {week === "finds" ? (
        v.flags.length ? (
          <ul className="finds">
            {v.flags.map((f) => (
              <Find key={`${f.pid}-${f.flag}`} f={f} onBoard={onBoard} />
            ))}
          </ul>
        ) : (
          <Empty title={m.noFinds} text={m.noFindsText} />
        )
      ) : groups.length ? (
        <div className="reports">
          {groups.map((g) => (
            <section key={g.scout_id} className="report" aria-label={g.scout}>
              <header className="report__head">
                <span className="face-tile report__face">
                  {g.scout_id === "trip" ? null : <Face face={staffFace(g.scout)} scale={1} label="" />}
                </span>
                <span className="report__who">
                  <b>{g.scout_id === "trip" ? m.yourTrips : g.scout}</b>
                  <span className="staff__soft">{[role(g.scout_id), g.area].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="report__count">{m.reportHead(g.looks, g.changed)}</span>
              </header>
              <ul className="report__items">
                {g.items.map((it) => (
                  <Item key={it.pid} it={it} onBoard={onBoard} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty title={m.noReports} text={m.noReportsText} />
      )}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="staff__empty">
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}

function BoardStar({ name, on, onClick }: { name: string; on: boolean; onClick: () => void }) {
  const label = on ? m.removeBoard(name) : m.addBoard(name);
  return (
    <button
      type="button"
      className={`staff__star${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Star size={16} weight={on ? "fill" : "bold"} aria-hidden="true" />
    </button>
  );
}

function FlagTags({ flags, likes }: { flags: string[]; likes: ReportItem["likes"] }) {
  return (
    <>
      {flags.map((f) => (
        <span key={f} className={`staff__flag staff__flag--${f}`} title={m.flagTips[f]}>
          {m.flags[f] ?? f}
        </span>
      ))}
      {likes && (
        <span className="staff__flag staff__flag--likes" title={likes.text}>
          {m.likes(likes.who)}
        </span>
      )}
    </>
  );
}

function Item({ it, onBoard }: { it: ReportItem; onBoard: (pid: string, on: boolean) => Promise<void> }) {
  return (
    <li className="report__item">
      <BoardStar name={it.name} on={it.on_board} onClick={() => void onBoard(it.pid, !it.on_board)} />
      <span className="report__prospect">
        <b>{it.name}</b>
        <span className="staff__soft">{it.position}</span>
        <Stars n={it.stars} size={10} />
        <FlagTags flags={it.flags} likes={it.likes} />
        {it.complete && <span className="staff__flag">{m.complete}</span>}
      </span>
      <span className="report__change">{sentence(it.change)}</span>
    </li>
  );
}

function Find({ f, onBoard }: { f: ScoutFlag; onBoard: (pid: string, on: boolean) => Promise<void> }) {
  return (
    <li className="find">
      <BoardStar name={f.name} on={f.on_board} onClick={() => void onBoard(f.pid, !f.on_board)} />
      <span className="face-tile find__face">
        <Face face={playerFace(f.pid, f.position)} scale={1} label="" />
      </span>
      <span className="find__who">
        <b>{f.name}</b>
        <span className="report__prospect">
          <span className="staff__soft">{f.position}</span>
          <Stars n={f.stars} size={10} />
        </span>
      </span>
      <span className="find__tags">
        <FlagTags flags={f.flag === "likes" ? [] : [f.flag]} likes={f.flag === "likes" ? f.likes : null} />
      </span>
      <span className="staff__soft">{m.looks(f.looks)}</span>
      <span className="find__standing">{f.standing_word}</span>
    </li>
  );
}

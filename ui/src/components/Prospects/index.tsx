import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  SortAscending,
  SortDescending,
  Door,
  Heart,
  Check,
  Plus,
  X,
  Funnel,
} from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Face from "../Face/index.tsx";
import Modal from "../Modal/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import ScoutMark from "../ScoutMark/index.tsx";
import RecruitStatus from "../RecruitStatus/index.tsx";
import ProspectCard, { Stars, statusOf, transferLine } from "../ProspectCard/index.tsx";
import MinMax from "../MinMax/index.tsx";
import FitText from "../FitText/index.tsx";
import RangeBar from "../RangeBar/index.tsx";
import TileMap, { MapMark } from "../TileMap/index.tsx";
import { api } from "../../api.ts";
import { setFavorite, setOnBoard } from "../../board.ts";
import { playerFace } from "../../faces.ts";
import { cachedTeams } from "../../teams.ts";
import type { NeedGroup, ProspectRow, ProspectsView, TeamCard } from "../../types.ts";
import { GradeRange } from "../Grade/index.tsx";
import { useKept } from "../../kept.ts";
import { formatClass, ordinal } from "../../format.ts";
import { messages as m } from "./messages.ts";
import RecruitFlags from "../RecruitFlags/index.tsx";
import "./index.css";

interface Props {
  seasonId: string;
  /** the season's year: the class is the next one */
  year: number;
  /** your school: the map marks its state in its color */
  school?: TeamCard;
  /** the board changed (a star): the Recruiting board loads it again */
  onBoardChange?: () => void;
  /** its tab is the one shown (Recruiting's tabs keep both mounted) */
  active?: boolean;
  /** how many are on your board: shown again after the Board tab changed it, the stars and your class line load again */
  boardSize?: number;
  /** the class's size, once known (the Prospects tab's count) */
  onClassSize?: (n: number) => void;
}

/** *tune* Prospects a page. */
const PAGE = 50;
/** *tune* The Offers column counts this far; past it, it reads "9+" (a transfer can have sixty). */
const OFFERS_SHOWN = 9;
/** *tune* Under this width the table drops its Size column and slims the others. */
const NARROW_TABLE = 1000;
/** *tune* How long the search waits after a key before it asks the server. */
const SEARCH_MS = 220;

type View = keyof typeof m.views;
/** the views, as the server's status filter */
const VIEW_STATUS: Record<View, string | null> = {
  all: null,
  recommended: "recommended",
  board: "board",
  favorites: "favorites",
  interested: "interested",
  open: "open",
};
type Col = keyof typeof m.cols;
/** columns the server sorts by (prospects._sort_key), best first */
/** His status has nothing to add: he is open to you or shut to you, and His List says which. */
const quietStatus = (r: ProspectRow) =>
  !r.pro && !r.leaning_fcs && (r.blocked ? r.blocked.why !== "signed" : !r.stage || r.stage === "cold");

const SORTS: Partial<Record<Col, string>> = {
  rank: "rank",
  who: "who",
  pos: "pos",
  ht: "ht",
  wt: "wt",
  stars: "stars",
  status: "status",
  offers: "offers",
  ask: "ask",
  cls: "stars", // a transfer has a class where a recruit has stars: the same server sort
  int: "int",
  sc: "sc",
  pot: "pot",
};
/** the groups in roster order (the needs' keys come in this order too) */
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

/** What a position chip counts: spots left, or your commits, board or offers there against the spots the class set out to fill. */
type ChipShow = "need" | "commits" | "board" | "offers";
const chipCount = (n: NeedGroup, show: ChipShow): string | null => {
  if (show === "need") return n.need > 0 ? String(n.need) : null;
  // the need after the slash is always the one the class started with (what is left plus your commits), so it
  // never shrinks as commits come in
  const start = n.commits + Math.max(0, n.need);
  if (show === "commits") return `${n.commits}/${start}`;
  return `${(show === "board" ? n.board : n.offers) ?? 0}/${start}`;
};

/** *tune* The heights a Height filter offers, in inches (5'6" to 6'10"). */
const HEIGHTS = Array.from({ length: 17 }, (_, i) => 66 + i).map((n) => ({
  value: n,
  label: `${Math.floor(n / 12)}'${n % 12}"`,
}));

/**
 * The Prospects section: the whole class, to find who to recruit. A table you can search, filter (view, position,
 * stars, a state from the map) and sort by any column, 50 a page; the board star on every row. Beside it the pixel
 * map of where the class lives, your needs by position (each one a filter), your class so far and the best
 * uncommitted. A row opens his file (ProspectCard) over the side column.
 */
export default function Prospects({
  seasonId,
  year,
  school,
  onBoardChange,
  active = true,
  boardSize,
  onClassSize,
}: Props) {
  const schoolMark = school?.state
    ? { state: school.state, color: school.colors.primary, second: school.colors.secondary, name: school.name }
    : null;
  // the filters and the sort are kept for the career: going to another page and back finds them as you left them
  const [view, setView] = useKept<View>(`prospects.${seasonId}.view`, "all");
  const [chips, setChips] = useKept<ChipShow>(`prospects.${seasonId}.chips`, "need");
  // a narrow table (a smaller window, or the sidebar open): the Size column goes and the rest slim down, so the
  // prospect column keeps its room; measured on the table's own box, not the window's
  const [narrow, setNarrow] = useState(false);
  const measure = useRef<ResizeObserver | null>(null);
  const tableBox = useCallback((el: HTMLDivElement | null) => {
    measure.current?.disconnect();
    scroller.current = el;
    if (!el) return;
    // a hidden tab measures 0 wide: it keeps the width it had
    measure.current = new ResizeObserver(([e]) => {
      if (e.contentRect.width > 0) setNarrow(e.contentRect.width < NARROW_TABLE);
    });
    measure.current.observe(el);
  }, []);
  // the map's column folded to a rail at the side (kept for good, not for one career); a prospect's file still opens
  const [sideShut, setSideShut] = useKept<boolean>("prospects.side-shut", false);
  // the big labeled map, in a window over the page
  const [mapOpen, setMapOpen] = useState(false);
  /** the big map's own pick: the list behind it is filtered only when the window closes, so looking round the map
   * never waits on the list loading */
  const [bigHome, setBigHome] = useState<string | null>(null);
  const openMap = () => {
    setBigHome(home);
    setMapOpen(true);
  };
  const closeMap = () => {
    setMapOpen(false);
    if (bigHome !== home) setHome(bigHome);
  };
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useKept<string | null>(`prospects.${seasonId}.group`, null);
  const [stars, setStars] = useKept<number | null>(`prospects.${seasonId}.stars`, null);
  const [home, setHome] = useKept<string | null>(`prospects.${seasonId}.home`, null);
  /** what the map's dots show: one value for the small map and the big one */
  const [mapShow, setMapShow] = useKept(`prospects.${seasonId}.mapShow`, "none");
  const [sort, setSort] = useKept(`prospects.${seasonId}.sort`, "rank");
  /** the scouted rating the table measures by (a column of its own, and the sort): "" for none */
  const [gauge, setGauge] = useKept(`prospects.${seasonId}.measure`, "");
  /** the columns' own filters (a word for Status, Interest, Scouted and Potential; a low and a high end for the rest) */
  const [cols, setCols] = useKept<Record<string, string | number>>(`prospects.${seasonId}.cols`, {});
  const [colsOpen, setColsOpen] = useKept(`prospects.${seasonId}.colsOpen`, false);
  const colsKey = JSON.stringify(cols);
  const colsOn = Object.keys(cols).length;
  /** set or clear one of them */
  const setCol = (changes: Record<string, string | number | null>) => {
    const next = { ...cols };
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") delete next[k];
      else next[k] = v;
    }
    setCols(next);
  };
  const colNum = (k: string) => (typeof cols[k] === "number" ? (cols[k] as number) : null);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ProspectsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);

  // the search waits for a pause in typing
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), SEARCH_MS);
    return () => window.clearTimeout(t);
  }, [query]);
  // a new filter starts at the first page
  useEffect(() => {
    setPage(0);
  }, [view, q, group, stars, home, sort, gauge, colsKey]);

  const load = useCallback(() => {
    const token = ++seq.current;
    const params = new URLSearchParams({ offset: String(page * PAGE), limit: String(PAGE), sort });
    const status = VIEW_STATUS[view];
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (group) params.set("group", group);
    if (stars) params.set("stars", String(stars));
    if (home) params.set("state", home);
    for (const [k, v] of Object.entries(cols)) params.set(k, String(v));
    if (gauge) params.set("measure", gauge);
    setLoading(true);
    api<ProspectsView>(`/api/season/${seasonId}/prospects?${params}`)
      .then((d) => {
        if (token !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => token === seq.current && setError(e.message))
      .finally(() => token === seq.current && setLoading(false));
  }, [seasonId, view, q, group, stars, home, sort, gauge, page, colsKey]);

  // the class is read once this tab has been opened (the Board tab does not pay for it), and from then on whenever
  // a filter changes
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  useEffect(() => {
    if (opened) load();
  }, [load, opened]);
  // shown again after the board changed on the Board tab: this page's stars and counts follow (its own stars
  // reload it as they land, so only coming back to it checks)
  const shownBoard = data?.summary.footprint.board;
  useEffect(() => {
    if (active && boardSize !== undefined && shownBoard !== undefined && boardSize !== shownBoard) load();
  }, [active]);
  // block bodies only: newer browsers' scrollTo returns a promise, and an effect may return nothing but its cleanup
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [page, view, q, group, stars, home, sort]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  // the transfer portal's list: its rows are transfers (a class where a recruit has stars)
  const portal = !!rows[0]?.portal;
  const classTotal = data?.summary.total;
  useEffect(() => {
    if (classTotal != null) onClassSize?.(classTotal);
  }, [classTotal, onClassSize]);

  // the board: on or off, in place, then the counts again
  const setBoard = async (r: ProspectRow, on: boolean) => {
    if (!on && r.offered && !window.confirm(m.pullsOffer(r.name))) return;
    try {
      await setOnBoard(seasonId, [r.id], on);
      setData(
        (d) =>
          d && {
            ...d,
            rows: d.rows.map((x) => (x.id === r.id ? { ...x, on_board: on, offered: on && x.offered } : x)),
          },
      );
      setNote(on ? m.boardOn(r.name) : m.boardOff(r.name));
      load();
      onBoardChange?.();
    } catch (e) {
      setNote(m.boardError((e as Error).message));
    }
  };

  // your favorites (♥): marked or cleared in place
  const setFav = async (r: ProspectRow, on: boolean) => {
    try {
      await setFavorite(seasonId, r.id, on);
      setData((d) => d && { ...d, rows: d.rows.map((x) => (x.id === r.id ? { ...x, favorite: on } : x)) });
      setNote(on ? m.favOn(r.name) : m.favOff(r.name));
      if (view === "favorites") load();
      onBoardChange?.();
    } catch (e) {
      setNote(m.boardError((e as Error).message));
    }
  };

  const addAll = async () => {
    if (!data) return;
    const ids = rows.filter((r) => !r.on_board && !r.blocked).map((r) => r.id);
    setAdding(true);
    try {
      await setOnBoard(seasonId, ids, true);
      onBoardChange?.();
      setNote(m.added(ids.length));
    } catch (e) {
      setNote(m.boardError((e as Error).message));
    } finally {
      setAdding(false);
      load();
    }
  };

  // the Measure menu: the ratings the list can be ranked by. Picking one ranks by it; a position's own rating that
  // the list no longer offers (another position picked) is let go, and the sort with it
  const measures = data?.measures ?? [];
  const measured = measures.find((x) => x.key === gauge);
  // measuring takes a column: Height and Weight give theirs up for it, so a prospect's name keeps its room
  const sized = !narrow && !measured;
  const pickMeasure = (key: string) => {
    setGauge(key);
    if (key) setSort("measure");
    else if (sort.replace("-", "") === "measure") setSort("rank");
  };
  useEffect(() => {
    if (gauge && data?.measures && !data.measures.some((x) => x.key === gauge)) pickMeasure("");
  }, [data?.measures, gauge]);

  const sortBy = (col: Col) => {
    const key = SORTS[col];
    if (!key) return;
    setSort(sort === key ? `-${key}` : key);
  };
  const sortIcon = (col: Col) => {
    const key = SORTS[col];
    if (!key || sort.replace("-", "") !== key) return null;
    return sort.startsWith("-") ? (
      <SortDescending size={14} weight="bold" aria-hidden="true" />
    ) : (
      <SortAscending size={14} weight="bold" aria-hidden="true" />
    );
  };
  const ariaSort = (col: Col) =>
    SORTS[col] && sort.replace("-", "") === SORTS[col]
      ? sort.startsWith("-")
        ? "descending"
        : "ascending"
      : undefined;

  const needs = data?.needs ?? {};
  const groups = GROUP_ORDER.filter((g) => g in needs);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const s = data?.summary;
  // every state with a prospect, the biggest first, for the filter beside the search
  const byState = s?.by_state;
  const topList = (home ? s?.top_in?.[home] : s?.top) ?? [];
  const stateOptions = useMemo(
    () => [
      { value: "", label: m.allStates },
      ...Object.entries(byState ?? {})
        .filter(([, c]) => c.n > 0)
        .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
        .map(([st, c]) => ({ value: st, label: st, hint: String(c.n) })),
    ],
    [byState],
  );
  // Recommended: the ones on this page not yet on your board
  const notOnBoard = rows.filter((r) => !r.on_board && !r.blocked).length;

  const Th = ({ col, className }: { col: Col; className?: string }) => (
    <th className={className} aria-sort={ariaSort(col)} scope="col">
      {SORTS[col] ? (
        <button type="button" className="prospects__sort" title={m.sortBy(m.cols[col])} onClick={() => sortBy(col)}>
          {/* the sort's arrow hangs off the label, so the label stays where it is, sorted or not */}
          <span className="prospects__sort-label">
            {m.cols[col]}
            {sortIcon(col)}
          </span>
        </button>
      ) : (
        m.cols[col]
      )}
    </th>
  );

  return (
    <div className={`prospects${narrow ? " is-narrow" : ""}${sideShut && !picked ? " is-side-shut" : ""}`}>
      {/* ---------- the list ---------- */}
      <section className="prospects__main" aria-label={m.title}>
        <header className="prospects__head">
          <p className="prospects__lede">{m.classOf(year + 1, s?.total ?? 0)}</p>
          {s && (
            // your footprint in the class: three counts said one way, a name over each number
            <dl className="prospects__class" aria-label={m.yourBoard}>
              <div title={m.onBoardTip}>
                <dt className="label">{m.onBoard}</dt>
                <dd>
                  {s.footprint.board} <small>{m.ofCap(s.footprint.cap ?? 30)}</small>
                </dd>
              </div>
              <div title={m.inContactTip}>
                <dt className="label">{m.inContact}</dt>
                <dd>{s.footprint.contact}</dd>
              </div>
              <div title={m.scoutedTip}>
                <dt className="label">{m.scoutedN}</dt>
                <dd>{s.footprint.evaluated}</dd>
              </div>
            </dl>
          )}
          {/* the map's column folded away: this button, in the page's corner, brings it back (no rail down the side) */}
          {sideShut && !picked && (
            <button
              type="button"
              className="prospects__unfold"
              title={m.showSide}
              aria-label={m.showSide}
              aria-expanded={false}
              onClick={() => setSideShut(false)}
            >
              <MapMark />
            </button>
          )}
        </header>

        <div className="prospects__tools">
          <label className="prospects__search">
            <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
            <input
              value={query}
              placeholder={m.search}
              aria-label={m.search}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" aria-label="Clear" onClick={() => setQuery("")}>
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            )}
          </label>
          <Dropdown
            label={m.state}
            hideLabel
            size="md"
            value={home ?? ""}
            options={stateOptions}
            onChange={(v) => setHome(v || null)}
          />

          {/* which prospects: six chips where the row has the room, one menu where it does not (the map open) */}
          <div className="prospects__chips prospects__views" role="group" aria-label={m.show}>
            {(Object.keys(m.views) as View[]).map((v) => (
              <Chip key={v} on={view === v} onClick={() => setView(v)}>
                {m.views[v]}
              </Chip>
            ))}
          </div>
          <span className="prospects__view-pick">
            <Dropdown
              label={m.show}
              hideLabel
              size="md"
              value={view}
              options={(Object.keys(m.views) as View[]).map((v) => ({ value: v, label: m.views[v] }))}
              onChange={(v) => setView(v as View)}
            />
          </span>
          {/* (the same menu as its neighbors: it was the one plain select in the row) */}
          <Dropdown
            label={m.stars}
            hideLabel
            size="md"
            value={stars ? String(stars) : ""}
            options={[
              { value: "", label: m.anyStars },
              ...[5, 4, 3, 2].map((n) => ({ value: String(n), label: m.starsN(n) })),
            ]}
            onChange={(v) => setStars(v ? Number(v) : null)}
          />
          {/* rank the list by one scouted rating: it gets a column of its own */}
          <span title={m.measureTip}>
            <Dropdown
              label={m.measure}
              size="md"
              value={gauge}
              options={[
                { value: "", label: m.noMeasure },
                ...measures.map((x) => ({
                  value: x.key,
                  label: x.label,
                  hint: x.physical ? m.measureBody : m.measureOwn,
                })),
              ]}
              onChange={pickMeasure}
            />
          </span>
          {/* the columns' own filters open under this row; the button counts the ones set */}
          <Chip on={colsOpen || colsOn > 0} count={colsOn || undefined} onClick={() => setColsOpen(!colsOpen)}>
            <Funnel size={14} weight="bold" aria-hidden="true" />
            {m.filters}
          </Chip>
          {colsOpen && (
            <div className="prospects__cols" role="group" aria-label={m.filters}>
              {(["commit", "interest", "scouted", "pot"] as const).map((k) => (
                <label key={k} className={`prospects__col${cols[k] ? " is-set" : ""}`}>
                  <span className="label">{m.colNames[k]}</span>
                  <select value={String(cols[k] ?? "")} onChange={(e) => setCol({ [k]: e.target.value })}>
                    <option value="">{m.any}</option>
                    {Object.entries(m.colWords[k]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <MinMax
                label={m.colNames.ht}
                min={colNum("ht_min")}
                max={colNum("ht_max")}
                options={HEIGHTS}
                onChange={(a, b) => setCol({ ht_min: a, ht_max: b })}
              />
              {(["wt", "offers", "ask"] as const).map((k) => (
                <MinMax
                  key={k}
                  label={m.colNames[k]}
                  min={colNum(`${k}_min`)}
                  max={colNum(`${k}_max`)}
                  onChange={(a, b) => setCol({ [`${k}_min`]: a, [`${k}_max`]: b })}
                />
              ))}
              {colsOn > 0 && (
                <button type="button" className="prospects__panel-link" onClick={() => setCols({})}>
                  {m.clearFilters}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="prospects__chips prospects__groups" role="group" aria-label={m.group}>
          <Dropdown
            label={m.chipShow}
            size="md"
            value={chips}
            options={(Object.keys(m.chipShows) as ChipShow[]).map((k) => ({
              value: k,
              label: m.chipShows[k],
              hint: m.chipHints[k],
            }))}
            onChange={(k) => setChips(k as ChipShow)}
          />
          <Chip on={group === null} onClick={() => setGroup(null)}>
            {m.allGroups}
          </Chip>
          {groups.map((g) => (
            <Chip key={g} on={group === g} onClick={() => setGroup(g)}>
              {g}
              {chipCount(needs[g], chips) && <span className="chip__count">{chipCount(needs[g], chips)}</span>}
            </Chip>
          ))}
          {view === "recommended" && notOnBoard > 0 && (
            <Button variant="outline" className="prospects__add" disabled={adding} onClick={addAll}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              {adding ? m.adding : m.addAll(notOnBoard)}
            </Button>
          )}
        </div>

        <div className={`prospects__table-wrap${loading ? " is-loading" : ""}`} ref={tableBox}>
          {error ? (
            <p className="prospects__soft prospects__empty">{m.loadError(error)}</p>
          ) : !data ? (
            <p className="prospects__soft prospects__empty">{m.loading}</p>
          ) : rows.length === 0 ? (
            <p className="prospects__soft prospects__empty">{m.none}</p>
          ) : (
            <table className={`prospects__table${measured ? " has-measure" : ""}`}>
              {/* fixed widths: a new page, filter or state never moves a column */}
              <colgroup>
                <col className="prospects__col-add" />
                <col className="prospects__col-rank" />
                <col />
                <col className="prospects__col-pos" />
                {measured && <col className="prospects__col-measure" />}
                {sized && <col className="prospects__col-size" />}
                {sized && <col className="prospects__col-size" />}
                <col className="prospects__col-stars" />
                <col className="prospects__col-status" />
                <col className="prospects__col-offers" />
                <col className="prospects__col-ask" />
                <col className="prospects__col-int" />
                <col className="prospects__col-sc" />
                <col className="prospects__col-pot" />
                <col className="prospects__col-board" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" aria-label={m.cols.board} />
                  <Th col="rank" className="num" />
                  <Th col="who" className="left" />
                  <Th col="pos" />
                  {measured && (
                    <th
                      className="left"
                      scope="col"
                      aria-sort={sort === "measure" ? "descending" : sort === "-measure" ? "ascending" : undefined}
                    >
                      <button
                        type="button"
                        className="prospects__sort"
                        title={m.sortBy(measured.label)}
                        onClick={() => setSort(sort === "measure" ? "-measure" : "measure")}
                      >
                        <span className="prospects__sort-label">
                          {measured.label}
                          {sort === "measure" ? (
                            <SortDescending size={14} weight="bold" aria-hidden="true" />
                          ) : sort === "-measure" ? (
                            <SortAscending size={14} weight="bold" aria-hidden="true" />
                          ) : null}
                        </span>
                      </button>
                    </th>
                  )}
                  {sized && <Th col="ht" />}
                  {sized && <Th col="wt" />}
                  {/* the portal: a transfer's class where a recruit has his stars */}
                  <Th col={portal ? "cls" : "stars"} />
                  <Th col="status" />
                  <Th col="offers" />
                  <Th col="ask" />
                  <Th col="int" />
                  <Th col="sc" />
                  <Th col="pot" />
                  <th scope="col" aria-label={m.favCol} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === picked ? "is-on" : undefined}
                    onClick={() => setPicked(r.id === picked ? null : r.id)}
                  >
                    {/* on your board or not, first in the row (the player's ask: adding one is the page's commonest click).
                        The door is shut on you (he signed, he will not consider you, you missed his cut): no adding him,
                        and the game's own sentence says why */}
                    <td className="prospects__tick-cell">
                      <button
                        type="button"
                        className={`prospects__tick${r.on_board ? " is-on" : ""}${r.blocked && !r.on_board ? " is-shut" : ""}`}
                        aria-pressed={r.on_board}
                        aria-label={
                          r.on_board ? m.removeBoard(r.name) : r.blocked ? r.blocked.text : m.addBoard(r.name)
                        }
                        title={r.on_board ? m.removeBoard(r.name) : r.blocked ? r.blocked.text : m.addBoard(r.name)}
                        aria-disabled={!!r.blocked && !r.on_board}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.blocked && !r.on_board) return setNote(r.blocked.text);
                          setBoard(r, !r.on_board);
                        }}
                      >
                        {r.on_board ? (
                          <Check size={14} weight="bold" aria-hidden="true" />
                        ) : r.blocked && r.blocked.why !== "signed" ? (
                          <Door size={14} weight="fill" aria-hidden="true" />
                        ) : (
                          <Plus size={14} weight="bold" aria-hidden="true" />
                        )}
                      </button>
                    </td>
                    <td className="num prospects__soft">{r.national_rank}</td>
                    <td className="left">
                      <button
                        type="button"
                        className="prospects__who"
                        aria-pressed={r.id === picked}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicked(r.id === picked ? null : r.id);
                        }}
                      >
                        <span className="prospects__face">
                          <Face face={playerFace(r.id, r.display_pos)} scale={1} label="" />
                        </span>
                        <span className="prospects__name">
                          {/* one line each, always: a long name or town is set a little smaller, never wrapped
                              (rows of one height) and never cut short */}
                          <b>
                            <FitText min={0.6}>{r.name}</FitText>
                            <RecruitFlags generational={r.generational} find={r.find} likes={r.likes} size={12} />
                          </b>
                          <FitText className="prospects__soft">
                            {r.portal ? transferLine(r) : `${r.hometown.city}, ${r.hometown.state}`}
                          </FitText>
                        </span>
                      </button>
                    </td>
                    <td>{r.display_pos}</td>
                    {measured && (
                      <td className="left">
                        {r.measure ? (
                          <span
                            className="prospects__measure"
                            title={m.measureRead(measured.label, r.measure.est, r.measure.lo, r.measure.hi)}
                          >
                            <b>{r.measure.est}</b>
                            <RangeBar
                              lo={r.measure.lo}
                              hi={r.measure.hi}
                              mid={r.measure.est}
                              soft={r.measure.confidence === "Low"}
                            />
                            <span className="prospects__soft">{m.measureRange(r.measure.lo, r.measure.hi)}</span>
                          </span>
                        ) : (
                          <span className="prospects__soft" title={`${m.notScouted}. ${m.notScoutedTip}`}>
                            –
                          </span>
                        )}
                      </td>
                    )}
                    {sized && <td className="prospects__soft">{r.height_display}</td>}
                    {sized && <td className="prospects__soft">{r.weight_display.replace(" lbs", "")}</td>}
                    <td>{r.portal ? formatClass(r.cls ?? null) : <Stars n={r.stars} size={10} />}</td>
                    <td className="prospects__status" title={r.blocked ? r.blocked.text : statusOf(r)}>
                      {/* where he went: his school's stamp alone; the cell's tip says it in words ("Signed: Oregon") */}
                      {!r.pro && (r.signed || r.committed) ? (
                        <span className="prospects__held" role="img" aria-label={statusOf(r)}>
                          <RecruitStatus
                            status={{
                              key: r.signed ? "signed" : r.hard ? "hard" : "verbal",
                              away: (r.signed || r.committed) !== school?.slug,
                            }}
                            size={10}
                            stamp={22}
                            school={cachedTeams()?.find((t) => t.slug === (r.signed || r.committed))}
                            bare
                          />
                        </span>
                      ) : quietStatus(r) ? null : (
                        statusOf(r)
                      )}
                    </td>
                    <td className="prospects__offers">
                      {r.offers_n ? (
                        r.offers_n > OFFERS_SHOWN ? (
                          <span title={m.offersTip(r.offers_n)}>{m.offersPlus(OFFERS_SHOWN)}</span>
                        ) : (
                          r.offers_n
                        )
                      ) : null}
                    </td>
                    <td className="prospects__ask">
                      {r.ask?.exact != null ? (
                        r.ask.exact
                      ) : r.ask?.hi ? (
                        <span title={m.askTip}>{m.askRange(r.ask.lo ?? 0, r.ask.hi)}</span>
                      ) : null}
                    </td>
                    <td
                      className={`prospects__int is-${r.blocked || r.list_place == null ? "low" : r.list_place <= 3 ? "high" : "medium"}`}
                      title={
                        r.blocked ? r.blocked.text : r.list_place == null ? m.listOpenTip : m.listPlaceTip(r.list_place)
                      }
                    >
                      {r.blocked
                        ? r.blocked.why === "signed"
                          ? m.listNone
                          : m.listClosed
                        : r.list_place == null
                          ? m.listOpen
                          : ordinal(r.list_place)}
                    </td>
                    <td>{r.looks > 0 ? <ScoutMark looks={r.looks} /> : null}</td>
                    <td className="prospects__pot">
                      {r.our_potential ? <GradeRange read={r.our_potential} size="sm" /> : null}
                    </td>
                    <td className="prospects__marks">
                      <button
                        type="button"
                        className={`prospects__star${r.favorite ? " is-on" : ""}`}
                        aria-pressed={!!r.favorite}
                        aria-label={r.favorite ? m.removeFav(r.name) : m.addFav(r.name)}
                        title={r.favorite ? m.removeFav(r.name) : m.addFav(r.name)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFav(r, !r.favorite);
                        }}
                      >
                        <Heart size={18} weight={r.favorite ? "fill" : "bold"} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="prospects__foot">
          <span className="prospects__soft" role="status">
            {note}
          </span>
          {total > 0 && (
            <span className="prospects__pager">
              <button
                type="button"
                className="prospects__page-btn"
                aria-label={m.prev}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <CaretLeft size={16} weight="bold" aria-hidden="true" />
              </button>
              <span>{m.page(page * PAGE + 1, Math.min(total, (page + 1) * PAGE), total)}</span>
              <button
                type="button"
                className="prospects__page-btn"
                aria-label={m.next}
                disabled={page >= pages - 1}
                onClick={() => setPage(page + 1)}
              >
                <CaretRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </span>
          )}
        </footer>
      </section>

      {/* ---------- the side: his file, or the map, your needs and the best uncommitted ---------- */}
      <aside className="prospects__side">
        {picked ? (
          <ProspectCard
            key={picked}
            seasonId={seasonId}
            pid={picked}
            row={rows.find((r) => r.id === picked)}
            onClose={() => setPicked(null)}
            onBoard={setBoard}
            // a file left open when the pool changed under it (the portal closed): it shuts, and the list is read again
            onGone={() => {
              setPicked(null);
              setNote(m.gone);
              load();
            }}
          />
        ) : sideShut ? null : (
          <>
            <section className="prospects__panel">
              <h2 className="prospects__panel-title">
                {m.map}
                <span className="prospects__panel-links">
                  <button type="button" className="prospects__panel-link" onClick={openMap}>
                    {m.bigMap}
                  </button>
                  <button
                    type="button"
                    className="prospects__panel-link"
                    title={m.hideSideTip}
                    aria-expanded
                    onClick={() => setSideShut(true)}
                  >
                    {m.hideSide}
                    <CaretRight size={12} weight="bold" aria-hidden="true" />
                  </button>
                </span>
              </h2>
              {s && (
                <TileMap
                  counts={s.by_state ?? {}}
                  value={home}
                  onPick={setHome}
                  school={schoolMark}
                  points={s.board_at}
                  show={mapShow}
                  onShow={setMapShow}
                />
              )}
            </section>
            {/* under the map, to the column's foot: the best uncommitted, of the picked state when there is one */}
            {s && topList.length > 0 && (
              <section className="prospects__panel prospects__panel--fill">
                <h2 className="prospects__panel-title">{home ? m.topIn(home) : m.topOpen}</h2>
                <ol className="prospects__top">
                  {topList.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setPicked(t.id)}>
                        <span className="prospects__face">
                          <Face face={playerFace(t.id, t.display_pos)} scale={1} label="" />
                        </span>
                        <span className="prospects__name">
                          <b>{t.name}</b>
                          <span className="prospects__soft">
                            {t.display_pos}
                            {t.home ? ` · ${t.home}` : ""}
                          </span>
                        </span>
                        <span className="prospects__top-rank">
                          <Stars n={t.stars} size={10} />
                          <span className="prospects__soft">#{t.national_rank}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </aside>
      <Modal
        open={mapOpen}
        onClose={closeMap}
        title={m.map}
        lede={m.classOf(year + 1, s?.total ?? 0)}
        footer={
          // always there, so the window keeps its size when a state is picked
          <Button disabled={!bigHome} onClick={closeMap}>
            {bigHome ? m.listThese(s?.by_state?.[bigHome]?.n ?? 0, bigHome) : m.pickState}
            {bigHome && <ArrowRight size={16} weight="bold" aria-hidden="true" />}
          </Button>
        }
      >
        <div className="prospects__bigmap">
          {s && (
            <TileMap
              counts={s.by_state ?? {}}
              value={bigHome}
              onPick={setBigHome}
              labels
              cities={s.cities}
              school={schoolMark}
              points={s.board_at}
              show={mapShow}
              onShow={setMapShow}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

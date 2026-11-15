import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  SortAscending,
  SortDescending,
  Star,
  X,
} from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Face from "../Face/index.tsx";
import Modal from "../Modal/index.tsx";
import ProspectCard, { Stars, statusOf } from "../ProspectCard/index.tsx";
import TileMap from "../TileMap/index.tsx";
import { api } from "../../api.ts";
import { setOnBoard } from "../../board.ts";
import { playerFace } from "../../faces.ts";
import type { ProspectRow, ProspectsView } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  /** the season's year: the class is the next one */
  year: number;
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
  interested: "interested",
  open: "open",
};
type Col = keyof typeof m.cols;
/** columns the server sorts by (prospects._sort_key), best first */
const SORTS: Partial<Record<Col, string>> = {
  rank: "rank",
  who: "who",
  pos: "pos",
  ht: "ht",
  wt: "wt",
  stars: "stars",
  status: "status",
  int: "int",
  sc: "sc",
  pot: "pot",
};
/** the groups in roster order (the needs' keys come in this order too) */
const GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P", "ATH"];

/** Recommended's reasons as one line: "From a state you sign from · a position you need: QB 2 left" */
const whyText = (why: string[]) => {
  const line = why.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
};

/** Your staff's looks as three pixel segments, each filled in halves. */
function Looks({ n }: { n: number }) {
  return (
    <span className="prospects__looks" role="img" aria-label={m.looks(n)} title={m.looks(n)}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={n >= i + 1 ? "is-full" : n > i ? "is-half" : undefined} />
      ))}
    </span>
  );
}

/**
 * The Prospects section: the whole class, to find who to recruit. A table you can search, filter (view, position,
 * stars, a state from the map) and sort by any column, 50 a page; the board star on every row. Beside it the pixel
 * map of where the class lives, your needs by position (each one a filter), your class so far and the best
 * uncommitted. A row opens his file (ProspectCard) over the side column.
 */
export default function Prospects({ seasonId, year, onBoardChange, active = true, boardSize, onClassSize }: Props) {
  const [view, setView] = useState<View>("all");
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
  // the big labeled map, in a window over the page
  const [mapOpen, setMapOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [sort, setSort] = useState("rank");
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
  }, [view, q, group, stars, home, sort]);

  const load = useCallback(() => {
    const token = ++seq.current;
    const params = new URLSearchParams({ offset: String(page * PAGE), limit: String(PAGE), sort });
    const status = VIEW_STATUS[view];
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (group) params.set("group", group);
    if (stars) params.set("stars", String(stars));
    if (home) params.set("state", home);
    setLoading(true);
    api<ProspectsView>(`/api/season/${seasonId}/prospects?${params}`)
      .then((d) => {
        if (token !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => token === seq.current && setError(e.message))
      .finally(() => token === seq.current && setLoading(false));
  }, [seasonId, view, q, group, stars, home, sort, page]);

  useEffect(() => {
    load();
  }, [load]);
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

  const addAll = async () => {
    if (!data) return;
    const ids = rows.filter((r) => !r.on_board).map((r) => r.id);
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

  const sortBy = (col: Col) => {
    const key = SORTS[col];
    if (!key) return;
    setSort((cur) => (cur === key ? `-${key}` : key));
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
  // Recommended: the ones on this page not yet on your board
  const notOnBoard = rows.filter((r) => !r.on_board).length;

  const Th = ({ col, className }: { col: Col; className?: string }) => (
    <th className={className} aria-sort={ariaSort(col)} scope="col">
      {SORTS[col] ? (
        <button type="button" className="prospects__sort" title={m.sortBy(m.cols[col])} onClick={() => sortBy(col)}>
          {m.cols[col]}
          {sortIcon(col)}
        </button>
      ) : (
        m.cols[col]
      )}
    </th>
  );

  return (
    <div className={`prospects${narrow ? " is-narrow" : ""}`}>
      {/* ---------- the list ---------- */}
      <section className="prospects__main" aria-label={m.title}>
        <header className="prospects__head">
          <p className="prospects__lede">{m.classOf(year + 1, s?.total ?? 0)}</p>
          {s && (
            <div className="prospects__class">
              <span className="label">{m.yourClass}</span>
              <b>
                {m.commits(s.outlook.commits, s.outlook.spots)} <small>{m.committed}</small>
              </b>
              <span className="prospects__soft">
                {m.footprint(s.footprint.board, s.footprint.contact, s.footprint.evaluated)}
              </span>
            </div>
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
          <div className="prospects__chips" role="group" aria-label={m.show}>
            {(Object.keys(m.views) as View[]).map((v) => (
              <Chip key={v} on={view === v} onClick={() => setView(v)}>
                {m.views[v]}
              </Chip>
            ))}
          </div>
          <select
            className="prospects__select"
            aria-label={m.stars}
            value={stars ?? ""}
            onChange={(e) => setStars(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{m.anyStars}</option>
            {[5, 4, 3, 2].map((n) => (
              <option key={n} value={n}>
                {m.starsN(n)}
              </option>
            ))}
          </select>
        </div>

        <div className="prospects__chips prospects__groups" role="group" aria-label={m.group}>
          <Chip on={group === null} onClick={() => setGroup(null)}>
            {m.allGroups}
          </Chip>
          {groups.map((g) => (
            <Chip
              key={g}
              on={group === g}
              count={needs[g].need > 0 ? needs[g].need : undefined}
              onClick={() => setGroup(g)}
            >
              {g}
            </Chip>
          ))}
          {view === "recommended" && notOnBoard > 0 && (
            <Button variant="outline" className="prospects__add" disabled={adding} onClick={addAll}>
              <Star size={16} weight="bold" aria-hidden="true" />
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
            <table className="prospects__table">
              {/* fixed widths: a new page, filter or state never moves a column */}
              <colgroup>
                <col className="prospects__col-rank" />
                <col />
                <col className="prospects__col-pos" />
                {!narrow && <col className="prospects__col-size" />}
                <col className="prospects__col-stars" />
                <col className="prospects__col-status" />
                <col className="prospects__col-int" />
                <col className="prospects__col-sc" />
                <col className="prospects__col-pot" />
                <col className="prospects__col-board" />
              </colgroup>
              <thead>
                <tr>
                  <Th col="rank" className="num" />
                  <Th col="who" className="left" />
                  <Th col="pos" />
                  {!narrow && <Th col="ht" />}
                  <Th col="stars" />
                  <Th col="status" className="left" />
                  <Th col="int" />
                  <Th col="sc" />
                  <Th col="pot" />
                  <Th col="board" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === picked ? "is-on" : undefined}
                    onClick={() => setPicked(r.id === picked ? null : r.id)}
                  >
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
                          <b>{r.name}</b>
                          <span className="prospects__soft" title={r.why?.length ? whyText(r.why) : undefined}>
                            {r.why?.length ? whyText(r.why) : `${r.hometown.city}, ${r.hometown.state}`}
                          </span>
                        </span>
                        {r.find && <span className="prospects__flag">{r.find}</span>}
                      </button>
                    </td>
                    <td>{r.display_pos}</td>
                    {!narrow && (
                      <td className="prospects__soft">
                        {r.height_display} · {r.weight_display.replace(" lbs", "")}
                      </td>
                    )}
                    <td>
                      <Stars n={r.stars} size={10} />
                    </td>
                    <td className="left prospects__status">{statusOf(r)}</td>
                    <td className={`prospects__int is-${r.interest_level.toLowerCase()}`}>{r.interest_level}</td>
                    <td>{r.looks > 0 ? <Looks n={r.looks} /> : <span className="prospects__soft">–</span>}</td>
                    <td className="prospects__pot">
                      {r.our_potential ? (
                        r.our_potential[0] === r.our_potential[1] ? (
                          r.our_potential[0]
                        ) : (
                          r.our_potential.join("–")
                        )
                      ) : (
                        <span className="prospects__soft">{m.unscouted}</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`prospects__star${r.on_board ? " is-on" : ""}`}
                        aria-pressed={r.on_board}
                        aria-label={r.on_board ? m.removeBoard(r.name) : m.addBoard(r.name)}
                        title={r.on_board ? m.removeBoard(r.name) : m.addBoard(r.name)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setBoard(r, !r.on_board);
                        }}
                      >
                        <Star size={18} weight={r.on_board ? "fill" : "bold"} aria-hidden="true" />
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
          />
        ) : (
          <>
            <section className="prospects__panel">
              <h2 className="prospects__panel-title">
                {m.map}
                <button type="button" className="prospects__panel-link" onClick={() => setMapOpen(true)}>
                  {m.bigMap}
                </button>
              </h2>
              {s && <TileMap counts={s.by_state ?? {}} value={home} onPick={setHome} />}
            </section>
            {s && s.top.length > 0 && (
              <section className="prospects__panel">
                <h2 className="prospects__panel-title">{m.topOpen}</h2>
                <ol className="prospects__top">
                  {s.top.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setPicked(t.id)}>
                        <span className="prospects__face">
                          <Face face={playerFace(t.id, t.display_pos)} scale={1} label="" />
                        </span>
                        <span className="prospects__name">
                          <b>{t.name}</b>
                          <span className="prospects__soft">
                            #{t.national_rank} · {t.display_pos}
                          </span>
                        </span>
                        <Stars n={t.stars} size={10} />
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
        onClose={() => setMapOpen(false)}
        title={m.map}
        lede={m.classOf(year + 1, s?.total ?? 0)}
        footer={
          home ? (
            <Button onClick={() => setMapOpen(false)}>
              {m.listThese(total, home)}
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Button>
          ) : null
        }
      >
        <div className="prospects__bigmap">
          {s && <TileMap counts={s.by_state ?? {}} value={home} onPick={setHome} labels />}
        </div>
      </Modal>
    </div>
  );
}

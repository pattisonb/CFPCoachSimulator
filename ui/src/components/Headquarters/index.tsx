import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, DotsSixVertical, PencilSimple, Plus, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import SectionTabs from "../SectionTabs/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary } from "../../types.ts";
import { messages as m } from "./messages.ts";
import type { Card, Category, Ctx, HqView, Size, SourceName, Sources, Task, Widget } from "./types.ts";
import { PROGRAM_WIDGETS } from "./widgets-program.tsx";
import { RECRUITING_WIDGETS } from "./widgets-recruiting.tsx";
import "./index.css";

interface Props {
  season: SeasonSummary;
  /** open another section (a card's View All) */
  onSection: (key: string) => void;
  /** open Recruiting's Prospects tab */
  onProspects: () => void;
  /** open a recruit on the Recruiting board */
  onRecruit: (pid: string) => void;
}

const WIDGETS: Widget[] = [...RECRUITING_WIDGETS, ...PROGRAM_WIDGETS];
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
const CATS: (Category | "all")[] = ["all", "recruiting", "scouting", "program"];

/** *tune* ms after the last change before the layout saves. */
const SAVE_DELAY = 600;
/** The masonry's row unit and the gap under every card (px; index.css's grid-auto-rows and column-gap). */
const ROW = 4;
const GAP = 16;
/** *tune* A card's height snaps to this; its limits match headquarters.CARD_H. */
const H_STEP = 40;
const H_MIN = 120;
const H_MAX = 1600;
/** *tune* How close a card's bottom comes to a neighbor's before it snaps to it. */
const SNAP_PX = 14;
/** *tune* How long a card takes to slide to its new place. */
const PACK_MS = 170;
/** *tune* A dragged card this close (px) to the board's top or bottom edge scrolls the board. */
const DRAG_EDGE = 72;
/** *tune* The most the board scrolls in a tick while a card is held at its edge (px), and how long a tick is. */
const DRAG_SPEED = 18;
const DRAG_TICK_MS = 16;
/** *tune* How far the pointer travels (px) after the cards make room before they can make room again. */
const DRAG_SETTLE = 8;
/** *tune* How far the pointer must travel (px) onto a card before the wheel scrolls that card and not the page. */
const WHEEL_ENGAGE = 4;
/** *tune* A wheel "line" in px (a mouse that reports lines, not pixels). */
const WHEEL_LINE = 40;
/** *tune* How long Removed… Undo stays up. */
const UNDO_MS = 6000;
/** *tune* The layout Start With the Recommended Layout builds: the week's work first, then the class, then next year. */
const RECOMMENDED: [string, Size][] = [
  ["class-glance", "S"],
  ["resources", "S"],
  ["alerts", "M"],
  ["top-targets", "M"],
  ["tasks", "M"],
  ["goals", "M"],
  ["class-needs", "S"],
  ["board-health", "S"],
  ["scout-queue", "M"],
  ["commit-tracker", "M"],
  ["promises", "M"],
  ["next-depth", "L"],
];

const clampH = (px: number) => Math.max(H_MIN, Math.min(H_MAX, Math.round(px)));
const snapH = (px: number) => clampH(Math.round(px / H_STEP) * H_STEP);
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** The grid's column count, from index.css's --hq-cols (the computed tracks can lag a width change). */
const columnsOf = (grid: HTMLElement) =>
  Math.max(1, parseInt(getComputedStyle(grid).getPropertyValue("--hq-cols"), 10) || 1);

/** One source as the page holds it: its value (kept while a fresh one loads), and whether it failed. */
interface Entry {
  value?: unknown;
  failed?: boolean;
  /** asked to load again */
  stale?: boolean;
  /** the /headquarters reads it was fetched with */
  want?: string;
}

/**
 * Headquarters: a board you build from widgets (web/hq.js). Cards sit in rows on four columns: Small is one
 * column wide, Medium two, Large the whole row; a row is as tall as its tallest card (its content, or the height you
 * drag it to) and the others stretch to it, so the cards' edges line up.
 * Edit Layout lays the controls over every card: drag it to move, pick its size, remove it. Add Widget opens the
 * catalog, where each widget shows a live preview from canned data. The layout saves with the career a moment after
 * every change. Each read the cards need is fetched once, however many cards use it.
 */
export default function Headquarters({ season, onSection, onProspects, onRecruit }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [cat, setCat] = useState<Category | "all">("all");
  const [q, setQ] = useState("");
  const [store, setStore] = useState<Record<string, Entry>>({});
  const [drag, setDrag] = useState<{ id: string; at: number; h: number; size: Size } | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);

  const grid = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  // The wheel belongs to the page. A card scrolls its own list only once you have moved the pointer onto it; a card
  // that slides under a still pointer while the page scrolls never takes the wheel (the player's note: scrolling down
  // the board kept stopping in whichever card passed under the pointer). The page moving hands the wheel back to it.
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    let engaged: Element | null = null;
    let at: [number, number] | null = null;
    /** where the page was when the pointer moved onto that card: the page moving since hands the wheel back */
    let engagedAt = 0;
    const moved = (e: PointerEvent) => {
      // the browser also reports a "move" when the page slides under a still pointer: only real travel counts
      if (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) < WHEEL_ENGAGE) return;
      at = [e.clientX, e.clientY];
      engaged = (e.target as Element).closest?.(".hq-card") ?? null;
      engagedAt = el.scrollTop;
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // a zoom, or a sideways scroll: the browser's
      const card = (e.target as Element).closest?.(".hq-card");
      if (el.scrollTop !== engagedAt) engaged = null;
      if (!card || card === engaged) return;
      e.preventDefault();
      el.scrollTop += e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? el.clientHeight : 1);
    };
    el.addEventListener("pointermove", moved);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointermove", moved);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  const guide = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<Map<Element, DOMRect> | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const noteTimer = useRef<number | undefined>(undefined);
  const inflight = useRef(new Set<string>());
  const id = season.id;

  // ----- the saved layout -----
  useEffect(() => {
    let live = true;
    api<HqView>(`/api/season/${id}/headquarters`)
      .then((v) => {
        if (!live) return;
        const saved = (v.layout?.cards ?? []).filter((c) => BY_ID.has(c.widget));
        setCards(saved);
        if (!saved.length) setDrawer(true);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  const say = useCallback((text: string, undo?: () => void) => {
    window.clearTimeout(noteTimer.current);
    setNote({ text, undo });
    noteTimer.current = window.setTimeout(() => setNote(null), UNDO_MS);
  }, []);

  /** Change the cards, then save a moment later (the last change wins). */
  const change = useCallback(
    (fn: (cards: Card[]) => Card[]) => {
      setCards((cur) => {
        const next = fn(cur ?? []);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          api(`/api/season/${id}/headquarters`, {
            method: "POST",
            body: {
              cards: next.map((c) => ({ id: c.id, widget: c.widget, size: c.size, ...(c.h ? { h: c.h } : {}) })),
            },
          }).catch(() => say(m.saveFailed));
        }, SAVE_DELAY);
        return next;
      });
    },
    [id, say],
  );

  // ----- the sources: each read the placed cards name, fetched once -----
  const placed = useMemo(() => cards ?? [], [cards]);
  const want = useMemo(
    () => [...new Set(placed.flatMap((c) => BY_ID.get(c.widget)?.want ?? []))].sort().join(","),
    [placed],
  );
  const needed = useMemo(() => [...new Set(placed.flatMap((c) => BY_ID.get(c.widget)?.sources ?? []))], [placed]);
  useEffect(() => {
    const urlOf = (name: SourceName): string => {
      const team = encodeURIComponent(season.team);
      if (name === "board") return `/api/season/${id}/recruiting`;
      if (name === "scouting") return `/api/season/${id}/scouting`;
      if (name === "scouted") return `/api/season/${id}/scouting?scouted=1&sort=potential&limit=60`;
      if (name === "programs") return `/api/season/${id}/programs`;
      if (name === "classes") return `/api/season/${id}/classes`;
      if (name === "myclass") return `/api/season/${id}/classes?school=${team}`;
      if (name === "prospects") return `/api/season/${id}/prospects?limit=50`;
      if (name === "depth") return `/api/season/${id}/depth/${team}`;
      return `/api/season/${id}/headquarters?want=${want}`;
    };
    for (const name of needed) {
      const e = store[name];
      const fresh = e && !e.stale && !e.failed && (name !== "hq" || e.want === want);
      const key = `${name}|${name === "hq" ? want : ""}`;
      if (fresh || inflight.current.has(key)) continue;
      inflight.current.add(key);
      api<unknown>(urlOf(name))
        .then((value) => setStore((s) => ({ ...s, [name]: { value, want } })))
        .catch(() => setStore((s) => ({ ...s, [name]: { value: s[name]?.value, failed: true, want } })))
        .finally(() => inflight.current.delete(key));
    }
  }, [needed, want, store, id, season.team]);

  /** Load the named sources again; the cards that read them redraw in place (their old values stay up meanwhile). */
  const refresh = useCallback((names: SourceName[]) => {
    setStore((s) => {
      const next = { ...s };
      for (const n of names) if (next[n]) next[n] = { ...next[n], stale: true, failed: false };
      return next;
    });
  }, []);

  // ----- what a widget can do -----
  const savePlan = useCallback(
    async (body: { tasks?: Task[]; goals?: Record<string, number> }) => {
      try {
        await api(`/api/season/${id}/headquarters/plan`, { method: "POST", body });
      } catch {
        say(m.planFailed);
        return false;
      }
      refresh(["hq"]);
      return true;
    },
    [id, say, refresh],
  );
  const ctxFor = (size: Size, sample: boolean): Ctx => ({
    size,
    sample,
    season: sample ? null : season,
    team: sample ? "you" : season.team,
    openRecruit: sample ? () => {} : onRecruit,
    savePlan: sample ? async () => false : savePlan,
    get: (path) => api(path),
  });
  const go = (key: string) => (key === "prospects" ? onProspects() : onSection(key));

  // ----- rows: the cards in order, each row as tall as its tallest card -----
  /** Remember where every card is now, so the next layout slides each one from there. */
  const flip = () => {
    if (!grid.current || still()) return;
    flipFrom.current = new Map([...grid.current.children].map((n) => [n, n.getBoundingClientRect()]));
  };
  const pack = useCallback(() => {
    const g = grid.current;
    if (!g) return;
    const items = [...g.children].filter(
      (n): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.size && !n.classList.contains("is-dragging"),
    );
    const cols = columnsOf(g);
    // each card's own height: what it holds, or the height you set (the last pass's stretch taken off first)
    for (const n of items) n.style.minHeight = "";
    const sized = items.map((n) => ({
      n,
      w: n.dataset.size === "L" ? cols : n.dataset.size === "M" ? Math.min(2, cols) : 1,
      rows: Math.max(1, Math.ceil((n.getBoundingClientRect().height + GAP) / ROW)),
    }));
    // the cards in order, left to right, a new row when the next one does not fit; a row is as tall as its tallest
    // card and the others stretch to it, so every top and bottom edge in a row lines up
    let top = 0;
    for (let i = 0; i < sized.length; ) {
      let j = i;
      let used = 0;
      while (j < sized.length && used + sized[j].w <= cols) used += sized[j++].w;
      const row = sized.slice(i, j);
      const rows = Math.max(...row.map((c) => c.rows));
      let at = 0;
      for (const c of row) {
        c.n.style.gridColumn = `${at + 1} / span ${c.w}`;
        c.n.style.gridRow = `${top + 1} / span ${rows}`;
        if (row.length > 1) c.n.style.minHeight = `${rows * ROW - GAP}px`;
        at += c.w;
      }
      top += rows;
      i = j;
    }
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from) return;
    for (const n of items) {
      const a = from.get(n);
      if (!a) continue;
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
        n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: PACK_MS,
          easing: "ease-out",
        });
    }
  }, []);
  // after every render (a card added, moved, resized, its data landed), and whenever a card or the grid changes size
  useLayoutEffect(pack);
  useEffect(() => {
    const g = grid.current;
    if (!g) return;
    const watch = new ResizeObserver(() => pack());
    watch.observe(g);
    for (const n of g.children) watch.observe(n);
    return () => watch.disconnect();
  }, [pack, placed, drag]);

  // ----- the layout's changes -----
  const nextId = (list: Card[]) => {
    const used = new Set(list.map((c) => c.id));
    let n = 1;
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  };
  const addWidget = (wid: string, size: Size) => {
    const w = BY_ID.get(wid);
    if (!w || placed.some((c) => c.widget === wid)) return;
    flip();
    change((list) => [...list, { id: nextId(list), widget: wid, size: w.sizes.includes(size) ? size : w.size }]);
  };
  const addRecommended = () => {
    flip();
    change((list) => {
      const next = [...list];
      for (const [wid, size] of RECOMMENDED)
        if (BY_ID.has(wid) && !next.some((c) => c.widget === wid)) next.push({ id: nextId(next), widget: wid, size });
      return next;
    });
    setDrawer(false);
  };
  const removeCard = (c: Card) => {
    const at = placed.findIndex((x) => x.id === c.id);
    flip();
    change((list) => list.filter((x) => x.id !== c.id));
    say(m.removed(BY_ID.get(c.widget)?.title ?? ""), () => {
      flip();
      change((list) => (list.some((x) => x.id === c.id) ? list : [...list.slice(0, at), c, ...list.slice(at)]));
      setNote(null);
    });
  };
  const move = (cid: string, step: number) => {
    const at = placed.findIndex((c) => c.id === cid);
    const to = at + step;
    if (at < 0 || to < 0 || to >= placed.length) return;
    flip();
    change((list) => {
      const next = [...list];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  };
  const setSize = (cid: string, size: Size) => {
    flip();
    change((list) => list.map((c) => (c.id === cid ? { ...c, size } : c)));
  };
  const setHeight = (cid: string, h: number | null) =>
    change((list) =>
      list.map((c) => {
        if (c.id !== cid) return c;
        const { h: _old, ...rest } = c;
        void _old;
        return h ? { ...rest, h: clampH(h) } : rest;
      }),
    );

  // ----- dragging: the card lifts and follows the pointer; a placeholder shows where it will land -----
  // The other cards slide to make room as the placeholder moves; the half of the card under the pointer decides the
  // side, so nothing flips back and forth. The drop puts the card where the placeholder is; Escape puts it back.
  const startDrag = (e: React.PointerEvent, c: Card) => {
    const g = grid.current;
    const node = g?.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
    if (e.button !== 0 || !g || !node) return;
    e.preventDefault();
    const r0 = node.getBoundingClientRect();
    const g0 = g.getBoundingClientRect();
    const dx = e.clientX - r0.left;
    const dy = e.clientY - r0.top;
    const from = placed.findIndex((x) => x.id === c.id);
    let at = from;
    flip();
    // lifted, the card is placed from the board's own corner: left in its cell, it would be placed from that cell's
    // corner and jump a column or a row away the moment it is picked up (the player's find)
    node.style.gridColumn = "";
    node.style.gridRow = "";
    Object.assign(node.style, {
      left: `${r0.left - g0.left}px`,
      top: `${r0.top - g0.top}px`,
      width: `${r0.width}px`,
      height: `${r0.height}px`,
    });
    setDrag({ id: c.id, at, h: r0.height, size: c.size });
    // the pointer, kept: the board scrolling under a still pointer moves the card and its landing spot too
    let px = e.clientX;
    let py = e.clientY;
    const scroller = g.closest<HTMLElement>(".hq__page");
    let movedAt = { x: -DRAG_SETTLE, y: -DRAG_SETTLE }; // the pointer (in the board's own space) at the last reorder
    const place = () => {
      const gr = g.getBoundingClientRect();
      node.style.left = `${px - dx - gr.left}px`;
      node.style.top = `${py - dy - gr.top}px`;
      // a card just made room: the pointer has to travel a little before the next one does, so a card that slid
      // under a still pointer cannot send the landing spot back again
      const sy = py + (scroller?.scrollTop ?? 0);
      if (Math.hypot(px - movedAt.x, sy - movedAt.y) < DRAG_SETTLE) return;
      // where each card sits in the layout, not where it is drawn: a card still sliding to its new place is
      // measured at that place, or the landing spot flickers while the others move
      const box = (n: HTMLElement) => {
        const left = gr.left + n.offsetLeft;
        const top = gr.top + n.offsetTop;
        return { left, top, right: left + n.offsetWidth, bottom: top + n.offsetHeight };
      };
      const others = [...g.querySelectorAll<HTMLElement>("[data-card]")].filter((n) => n.dataset.card !== c.id);
      const over = others.find((n) => {
        const r = box(n);
        return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
      });
      if (!over) return;
      const r = box(over);
      // a card that fills its row is passed going up or down; one that shares its row, going left or right
      const fills = over.offsetWidth > gr.width - GAP;
      const before = fills ? py < (r.top + r.bottom) / 2 : px < (r.left + r.right) / 2;
      const to = others.indexOf(over) + (before ? 0 : 1);
      if (to === at) return;
      at = to;
      movedAt = { x: px, y: sy };
      flip();
      setDrag((d) => d && { ...d, at: to });
    };
    // near the board's top or bottom edge the board scrolls, faster the closer the pointer is: most of a full board
    // is below the fold, and a card has to be able to get there
    const creep = () => {
      if (!scroller) return;
      const sr = scroller.getBoundingClientRect();
      const up = sr.top + DRAG_EDGE - py;
      const down = py - (sr.bottom - DRAG_EDGE);
      const by = up > 0 ? -up : down > 0 ? down : 0;
      if (!by) return;
      // never past the last row: the lifted card hangs below the board and would stretch the page for ever
      if (by > 0 && g.getBoundingClientRect().bottom <= sr.bottom - GAP) return;
      const was = scroller.scrollTop;
      scroller.scrollTop += (Math.min(DRAG_EDGE, Math.abs(by)) / DRAG_EDGE) * DRAG_SPEED * Math.sign(by);
      if (scroller.scrollTop !== was) place();
    };
    const creeping = window.setInterval(creep, DRAG_TICK_MS);
    const moveTo = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      place();
    };
    // the wheel turned mid-drag: the card stays under the pointer
    const scrolled = () => place();
    scroller?.addEventListener("scroll", scrolled);
    const finish = (cancel: boolean) => {
      window.clearInterval(creeping);
      scroller?.removeEventListener("scroll", scrolled);
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key, true);
      flip();
      flipFrom.current?.set(node, node.getBoundingClientRect());
      for (const k of ["left", "top", "width"] as const) node.style[k] = "";
      node.style.height = c.h ? `${c.h}px` : "";
      setDrag(null);
      if (!cancel && at !== from)
        change((list) => {
          const rest = list.filter((x) => x.id !== c.id);
          return [...rest.slice(0, at), c, ...rest.slice(at)];
        });
    };
    const up = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
  };

  // ----- heights: drag a card's bottom edge (snapped, the grid making room as it grows); a double-click is Auto -----
  const startResize = (e: React.PointerEvent, c: Card) => {
    const g = grid.current;
    const node = g?.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
    if (e.button !== 0 || !g || !node) return;
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = node.getBoundingClientRect().height;
    let h = h0;
    let moved = false; // a press that never moved is a click, not a resize
    node.classList.add("is-resizing");
    const spanOf = (n: HTMLElement) => {
      const mt = /(\d+)\s*\/\s*span\s*(\d+)/.exec(n.style.gridColumn);
      return mt ? [Number(mt[1]), Number(mt[1]) + Number(mt[2]) - 1] : [1, 1];
    };
    // the bottom edge of a card beside this one (columns not shared) within SNAP_PX of y, the nearest
    const snapTo = (y: number) => {
      const [a0, a1] = spanOf(node);
      let best: number | null = null;
      for (const n of g.querySelectorAll<HTMLElement>("[data-card]")) {
        if (n === node) continue;
        const [b0, b1] = spanOf(n);
        if (!(b1 < a0 || b0 > a1)) continue; // same columns: it moves with this card, not beside it
        const bottom = n.getBoundingClientRect().bottom;
        if (Math.abs(bottom - y) <= SNAP_PX && (best == null || Math.abs(bottom - y) < Math.abs(best - y)))
          best = bottom;
      }
      return best;
    };
    const moveTo = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - y0) > 3) moved = true;
      if (!moved) return;
      const top = node.getBoundingClientRect().top;
      const wanted = h0 + ev.clientY - y0;
      const b = snapTo(top + wanted);
      if (b != null && b - top >= H_MIN) {
        // close to a neighbor's bottom: line up with it, and show the line
        h = Math.round(b - top);
        if (guide.current) {
          guide.current.style.top = `${b - g.getBoundingClientRect().top}px`;
          guide.current.hidden = false;
        }
      } else {
        h = snapH(wanted);
        if (guide.current) guide.current.hidden = true;
      }
      node.style.height = `${h}px`;
      node.classList.add("has-height");
      pack();
    };
    const up = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (guide.current) guide.current.hidden = true;
      node.classList.remove("is-resizing");
      if (moved) setHeight(c.id, h);
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ----- drawing -----
  const dataFor = (w: Widget): { d: Sources; state: "ready" | "loading" | "failed" } => {
    const d: Record<string, unknown> = {};
    let state: "ready" | "loading" | "failed" = "ready";
    for (const n of w.sources) {
      const e = store[n];
      if (e?.value !== undefined) d[n] = e.value;
      else state = e?.failed ? "failed" : state === "failed" ? "failed" : "loading";
    }
    return { d: d as Sources, state };
  };

  // while a card is dragged: the others in order, the placeholder (null) where it would land, then the lifted card
  const rest = drag ? placed.filter((c) => c.id !== drag.id) : placed;
  const lifted = drag ? placed.filter((c) => c.id === drag.id) : [];
  const order: (Card | null)[] = drag ? [...rest.slice(0, drag.at), null, ...rest.slice(drag.at), ...lifted] : placed;

  const cardNode = (c: Card) => {
    const w = BY_ID.get(c.widget)!;
    const { d, state } = dataFor(w);
    const i = placed.findIndex((x) => x.id === c.id);
    const lifted = drag?.id === c.id;
    return (
      <section
        key={c.id}
        className={`hq-card${c.h ? " has-height" : ""}${lifted ? " is-dragging" : ""}`}
        data-card={c.id}
        data-size={c.size}
        aria-label={w.title}
        style={c.h && !lifted ? { height: c.h } : undefined}
      >
        <header className="hq-card__head">
          <h3>{w.title}</h3>
          {w.viewAll && (
            <button type="button" className="hq-link" onClick={() => go(w.viewAll!)}>
              {m.viewAll}
            </button>
          )}
        </header>
        <div className="hq-card__body">
          {state === "ready" ? (
            <w.Draw d={d} ctx={ctxFor(c.size, false)} />
          ) : (
            <p className="hq-empty-line">{state === "failed" ? m.widgetFailed : m.loading}</p>
          )}
        </div>
        {/* Edit Layout: the controls lie over the whole card on a see-through layer, so no card changes size */}
        {editing && (
          <div className="hq-edit">
            <b className="hq-edit__title">{w.title}</b>
            <Tooltip title={m.dragToMove} text={m.dragTip}>
              <button
                type="button"
                className="hq-edit__drag"
                aria-label={m.dragToMove}
                onPointerDown={(e) => startDrag(e, c)}
              >
                <DotsSixVertical size={20} weight="bold" aria-hidden="true" />
              </button>
            </Tooltip>
            {w.sizes.length > 1 && (
              <div className="hq-edit__group" role="group" aria-label={m.size}>
                {w.sizes.map((s) => (
                  <Chip key={s} on={c.size === s} aria-label={m.sizeNames[s]} onClick={() => setSize(c.id, s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
            <div className="hq-edit__group">
              <button
                type="button"
                className="hq-btn hq-btn--icon"
                aria-label={m.moveEarlier}
                disabled={i <= 0}
                onClick={() => move(c.id, -1)}
              >
                <ArrowLeft size={14} weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="hq-btn hq-btn--icon"
                aria-label={m.moveLater}
                disabled={i >= placed.length - 1}
                onClick={() => move(c.id, +1)}
              >
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </button>
              {c.h && (
                <button type="button" className="hq-btn" onClick={() => setHeight(c.id, null)}>
                  {m.autoHeight}
                </button>
              )}
              <button
                type="button"
                className="hq-btn hq-btn--icon"
                aria-label={m.remove(w.title)}
                onClick={() => removeCard(c)}
              >
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          className="hq-card__edge"
          aria-label={m.resize}
          title={m.resizeTip}
          onPointerDown={(e) => startResize(e, c)}
          onDoubleClick={() => setHeight(c.id, null)}
          onKeyDown={(e) => {
            // the keyboard's way: arrows step the height, Home is Auto
            const cur = c.h ?? (e.currentTarget.parentElement?.getBoundingClientRect().height || 400);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setHeight(c.id, snapH(cur + (e.key === "ArrowDown" ? H_STEP : -H_STEP)));
            }
            if (e.key === "Home") {
              e.preventDefault();
              setHeight(c.id, null);
            }
          }}
        />
      </section>
    );
  };

  const on = new Set(placed.map((c) => c.widget));
  const query = q.trim().toLowerCase();
  const listed = WIDGETS.filter(
    (w) => (cat === "all" || w.category === cat) && (!query || `${w.title} ${w.blurb}`.toLowerCase().includes(query)),
  ).sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category));

  return (
    <div className={`section-tabs__wrap hq${editing ? " is-editing" : ""}`}>
      <SectionTabs
        title={m.title}
        value="all"
        onChange={() => {}}
        tabs={[]}
        aside={
          <>
            {note && (
              <span className="hq-note" role="status">
                {note.text}
                {note.undo && (
                  <button type="button" className="hq-link" onClick={note.undo}>
                    {m.undo}
                  </button>
                )}
              </span>
            )}
            <button type="button" className="hq-tool" onClick={() => setDrawer(true)}>
              <Plus size={13} weight="bold" aria-hidden="true" />
              {m.addWidget}
            </button>
            <button
              type="button"
              className={`hq-tool${editing ? " is-on" : ""}`}
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {!editing && <PencilSimple size={13} weight="bold" aria-hidden="true" />}
              {editing ? m.done : m.editLayout}
            </button>
          </>
        }
      />
      <div className="hq__page" ref={page}>
        {error ? (
          <p className="hq-empty-line">{m.openFailed(error)}</p>
        ) : !cards ? (
          <p className="hq-empty-line">{m.opening}</p>
        ) : (
          <>
            {!placed.length && (
              <div className="hq__empty">
                <h2>{m.emptyTitle}</h2>
                <p>{m.emptyText}</p>
                <div className="hq-row">
                  <Button onClick={addRecommended}>{m.startRecommended}</Button>
                  <Button variant="outline" onClick={() => setDrawer(true)}>
                    <Plus size={16} weight="bold" aria-hidden="true" />
                    {m.addWidget}
                  </Button>
                </div>
              </div>
            )}
            <div className="hq__grid" ref={grid}>
              {order.map((c) =>
                c ? (
                  cardNode(c)
                ) : (
                  <div
                    key="placeholder"
                    className="hq-placeholder"
                    data-size={drag!.size}
                    style={{ height: drag!.h }}
                    aria-hidden="true"
                  />
                ),
              )}
              <div className="hq__guide" ref={guide} hidden aria-hidden="true" />
            </div>
          </>
        )}
      </div>

      {/* the catalog: every widget with a live preview drawn from canned data (it never calls the server) */}
      {drawer && (
        <aside
          className="hq-drawer"
          role="dialog"
          aria-label={m.catalog}
          onKeyDown={(e) => e.key === "Escape" && setDrawer(false)}
        >
          <header className="hq-drawer__head">
            <h2>{m.catalog}</h2>
            <span className="hq-sub">{m.count(on.size, WIDGETS.length)}</span>
            <button type="button" className="hq-btn hq-btn--icon" aria-label={m.close} onClick={() => setDrawer(false)}>
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          </header>
          <div className="hq-drawer__tools">
            <div className="hq-row" role="group" aria-label={m.category}>
              {CATS.map((k) => (
                <Chip key={k} on={cat === k} onClick={() => setCat(k)}>
                  {m.cats[k]}
                </Chip>
              ))}
            </div>
            <input
              type="search"
              className="hq-input"
              placeholder={m.searchWidgets}
              aria-label={m.searchWidgets}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="hq-drawer__list">
            {listed.map((w) => (
              <Entry key={w.id} w={w} has={on.has(w.id)} onAdd={(size) => addWidget(w.id, size)} ctxFor={ctxFor} />
            ))}
            {!listed.length && <p className="hq-empty-line">{m.noWidgets}</p>}
          </div>
        </aside>
      )}
    </div>
  );
}

/** One widget in the catalog: its name and line, a preview at the size picked, and Add. */
function Entry({
  w,
  has,
  onAdd,
  ctxFor,
}: {
  w: Widget;
  has: boolean;
  onAdd: (size: Size) => void;
  ctxFor: (size: Size, sample: boolean) => Ctx;
}) {
  const [size, setSize] = useState<Size>(w.size);
  return (
    <article className="hq-entry">
      <header className="hq-entry__head">
        <h3>{w.title}</h3>
        <span className="hq-tag is-soft">{m.cats[w.category]}</span>
      </header>
      <p className="hq-entry__blurb">{w.blurb}</p>
      <div className="hq-preview" aria-hidden="true">
        <w.Draw d={w.sample} ctx={ctxFor(size, true)} />
      </div>
      <footer className="hq-entry__foot">
        {w.sizes.length > 1 ? (
          <div className="hq-row" role="group" aria-label={m.size} title={m.sizeTip}>
            {w.sizes.map((s) => (
              <Chip key={s} on={size === s} onClick={() => setSize(s)}>
                {m.sizeNames[s]}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="hq-sub">{m.sizeNames[w.size]}</span>
        )}
        <Button variant={has ? "outline" : "solid"} disabled={has} onClick={() => onAdd(size)}>
          {has ? m.onHq : m.add}
        </Button>
      </footer>
    </article>
  );
}

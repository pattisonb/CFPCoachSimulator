import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Face from "../Face/index.tsx";
import Helmet from "../Helmet/index.tsx";
import { inkOn } from "../../colors.ts";
import { lookOf, titleCase } from "../../faces.ts";
import { firstNames, formatClass, lastName } from "../../format.ts";
import type { DepthCard, DepthRow } from "../../types.ts";
import { CARD_W, boardOf, type Kick, type Unit } from "./formation.ts";
import { messages as m } from "./messages.ts";

interface Props {
  unit: Unit;
  /** every role on the chart, all three units */
  rows: Map<string, DepthRow>;
  kick: Kick;
  /** open a player's full card (from the role he's shown on) */
  onOpen: (role: string, slug: string) => void;
  /** swap two players at one role (drag one card onto the other); leave out for a chart you cannot edit */
  onSwap?: (role: string, a: string, b: string) => void;
  /** the school whose field this is: its end zone is painted at the end away from the line of scrimmage */
  school?: { abbreviation: string; name: string; colors: { primary: string; secondary: string } };
}

/** *tune* How far a press must move before it is a drag and not a click, in px. */
const DRAG_START = 6;
/** What a card needs to be dragged and dropped on: the handlers and the marks. */
type DragProps = (
  role: string,
  p: DepthCard,
  tag: string,
) => {
  className: string;
  "data-drop": "";
  "data-role": string;
  "data-slug": string;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
};

/** *tune* The most the board grows past its natural size on a big screen. */
const MAX_SCALE = 1.45;
/** *tune* The most the formation spreads sideways to fill a wide field (1: never; the cards keep their size). */
const MAX_SPREAD = 1.7;
/** *tune* The end zone's depth, in px. */
const ZONE = 56;
/** Room around the board for the cards' shadows, in px. */
const PAD = 16;

/**
 * The unit's formation on a field: each starter as a card in the team's colors (overall, position, number, face,
 * name, class, size and type) where he lines up, the next ones up as small cards under him. The board keeps its
 * natural size and is scaled to fit the field, so it never scrolls. Special Teams lists the returners below.
 *
 * Any card drags: pick up a backup and drop him on the starter (or on another backup) at the same role and the two
 * trade places. While a card is in the air, the cards it can land on are outlined and the rest fade.
 */
export default function Formation({ unit, rows, kick, onOpen, onSwap, school }: Props) {
  const board = useMemo(() => boardOf(rows, unit, kick), [rows, unit, kick]);
  const returners = (["KR", "PR"] as const).map((role) => ({ role, r: rows.get(role) }));

  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [spread, setSpread] = useState(1);
  const zone = school ? ZONE : 0;
  const w = board.width + 2 * PAD;
  const h = board.height + 2 * PAD;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // the end zone keeps its own strip of the field: the board fits in what is left, so no card stands on it
    const fit = () => {
      const s = Math.min(MAX_SCALE, el.clientWidth / w, (el.clientHeight - zone) / h) || 1;
      setScale(s);
      // a field wider than the formation needs: the cards keep their size and spread out across it
      setSpread(Math.max(1, Math.min(MAX_SPREAD, el.clientWidth / (w * s))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, zone]);
  const zoneAtTop = board.los > board.height / 2;
  // spread: the board is `spread` times as wide, the leftmost card still at its left edge and the rightmost at its right
  const wide = w * spread;
  const stretch = board.width > CARD_W ? (wide - 2 * PAD - CARD_W) / (board.width - CARD_W) : 1;

  // the card in the air (its role and player), and whether the press that just ended was a drag (so it opens nothing)
  const [lift, setLift] = useState<{ role: string; slug: string; p: DepthCard; tag: string } | null>(null);
  const dragged = useRef(false);
  // the card that follows the pointer: always a full starter's card, so a backup opens up as he is picked up
  const ghost = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const place = () => {
    if (ghost.current) ghost.current.style.translate = `${at.current.x}px ${at.current.y}px`;
  };
  useLayoutEffect(place, [lift]);
  const open = (role: string, slug: string) => {
    if (!dragged.current) onOpen(role, slug);
  };

  const dragOf: DragProps = (role, p, tag) => {
    const slug = p.slug;
    return {
      className: !lift ? "" : lift.slug === slug ? " is-lifted" : lift.role === role ? " is-target" : " is-dim",
      "data-drop": "",
      "data-role": role,
      "data-slug": slug,
      onPointerDown: (e) => {
        if (!onSwap || e.button !== 0) return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const small = rect.width < CARD_W * scale - 1 || rect.height < 100 * scale;
        // where the pointer holds the full card: the same place across it, and near the top when it grew from a backup
        const ox = ((x0 - rect.left) / rect.width) * CARD_W * scale;
        const oy = small ? 40 * scale : y0 - rect.top;
        let lifted = false;
        let over: HTMLElement | null = null;
        // the card under the pointer, if it is one this card can trade with
        const target = (x: number, y: number) => {
          const t = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
          return t && t.dataset.role === role && t.dataset.slug !== slug ? t : null;
        };
        const move = (ev: PointerEvent) => {
          if (!lifted) {
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
            lifted = true;
            setLift({ role, slug, p, tag });
          }
          at.current = { x: ev.clientX - ox, y: ev.clientY - oy };
          place();
          const t = target(ev.clientX, ev.clientY);
          if (t !== over) {
            over?.classList.remove("is-over");
            t?.classList.add("is-over");
            over = t;
          }
        };
        const end = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          if (!lifted) return;
          over?.classList.remove("is-over");
          setLift(null);
          dragged.current = true;
          window.setTimeout(() => (dragged.current = false), 0);
          const t = ev.type === "pointerup" ? target(ev.clientX, ev.clientY) : null;
          if (t?.dataset.slug) onSwap(role, slug, t.dataset.slug);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      },
    };
  };

  return (
    <>
      <div className={`formation__field${onSwap ? " is-editable" : ""}`} ref={box}>
        {/* the school's end zone, painted across the end of the field away from the line of scrimmage: its name
            between two helmets, in its colors */}
        {school && (
          <div
            className={`formation__zone${zoneAtTop ? " is-top" : ""}`}
            aria-hidden="true"
            style={
              {
                height: zone,
                "--c": school.colors.primary,
                "--c2": school.colors.secondary,
                "--on": inkOn(school.colors.primary),
              } as CSSProperties
            }
          >
            <Helmet color={school.colors.primary} className="formation__helmet" />
            <b>{school.name}</b>
            <Helmet color={school.colors.primary} className="formation__helmet" flip />
          </div>
        )}
        <div
          className="board"
          style={{
            width: wide,
            height: h,
            top: `calc(50% ${zoneAtTop ? "+" : "-"} ${zone / 2}px)`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            ...({ "--board-scale": scale } as CSSProperties),
          }}
        >
          <span className="board__los" style={{ top: PAD + board.los }} aria-hidden="true" />
          {board.slots.map((s) => (
            <section
              key={`${s.label}-${s.p.slug}`}
              className="board__slot"
              style={{ left: PAD + s.left * stretch, top: PAD + s.top, width: CARD_W }}
              aria-label={s.label}
            >
              <h3 className="board__label">{s.label}</h3>
              <StarterCard
                p={s.p}
                tag={s.tag}
                drag={dragOf(s.row.role, s.p, s.tag)}
                onOpen={() => open(s.row.role, s.p.slug)}
              />
              {s.backups.length > 0 && (
                <ol className="board__backups" aria-label={m.backups}>
                  {s.backups.map((b) => (
                    <li key={b.slug}>
                      <button
                        type="button"
                        {...dragOf(s.row.role, b, s.tag)}
                        className={`board__backup${dragOf(s.row.role, b, s.tag).className}`}
                        aria-label={m.spotLabel(s.tag, b.name, b.overall)}
                        title={onSwap ? m.dragBackup(b.name) : m.openCard(b.name)}
                        onClick={() => open(s.row.role, b.slug)}
                      >
                        <span className="board__backup-face">
                          <Face face={lookOf(b.face, b.slug, b.position)} scale={1} label="" />
                        </span>
                        <span className="board__backup-name">
                          <span>{firstNames(b.name)}</span>
                          <b>{lastName(b.name)}</b>
                        </span>
                        {b.injury && <span className="depth__flag depth__flag--out">{m.out}</span>}
                        <span className="board__backup-ovr">
                          <b>{b.overall}</b>
                          <span>{m.ovr}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      </div>
      {lift && (
        <div className="board__ghost" ref={ghost} style={{ width: CARD_W, scale: String(scale) }} aria-hidden="true">
          <StarterCard p={lift.p} tag={lift.tag} />
        </div>
      )}
      {unit === "special" && (
        <div className="formation__returners">
          {returners.map(
            ({ role, r }) =>
              r?.players[0] && (
                <button
                  key={role}
                  type="button"
                  className="formation__returner"
                  title={m.openCard(r.players[0].name)}
                  onClick={() => onOpen(role, r.players[0].slug)}
                >
                  <span className="label">{titleCase(r.label)}</span>
                  <b>{r.players[0].name}</b>
                  <span>{r.players[0].overall}</span>
                </button>
              ),
          )}
        </div>
      )}
    </>
  );
}

/** A starter's card: the team-colored top with his overall, position and face; his name and his line below. */
function StarterCard({
  p,
  tag,
  drag,
  onOpen,
}: {
  p: DepthCard;
  tag: string;
  /** left out for the copy that follows the pointer */
  drag?: ReturnType<DragProps>;
  onOpen?: () => void;
}) {
  // the weight as a bare number: the card is narrow, and "lbs" pushed it past the edge
  const size = [p.height, p.weight ? String(p.weight).replace(/ ?lbs?$/i, "") : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      {...drag}
      className={["board__card", p.injury && "is-out"].filter(Boolean).join(" ") + (drag?.className ?? "")}
      aria-label={m.spotLabel(tag, p.name, p.overall)}
      title={m.openCard(p.name)}
      onClick={onOpen}
    >
      <span className="board__top">
        <span className="board__ovr">
          <b>{p.overall}</b>
          <span>{p.position}</span>
        </span>
        {p.jersey && <span className="board__jersey">#{p.jersey}</span>}
        <span className="board__face">
          <Face face={lookOf(p.face, p.slug, p.position)} scale={2} label="" />
        </span>
        {p.injury && <span className="board__out">{m.out}</span>}
        {p.redshirt?.on && <span className="board__rs">{m.rs}</span>}
      </span>
      <span className="board__name">
        <span>{firstNames(p.name)}</span>
        <b>{lastName(p.name)}</b>
      </span>
      <span className="board__meta">{[formatClass(p.class), size].filter(Boolean).join(" · ")}</span>
      <span className="board__type">{p.archetype ?? ""}</span>
    </button>
  );
}

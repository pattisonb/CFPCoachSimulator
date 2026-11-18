import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Face from "../Face/index.tsx";
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
}

/** *tune* The most the board grows past its natural size on a big screen. */
const MAX_SCALE = 1.25;
/** Room around the board for the cards' shadows, in px. */
const PAD = 16;

/**
 * The unit's formation on a field: each starter as a card in the team's colors (overall, position, number, face,
 * name, class, size and type) where he lines up, the next ones up as small cards under him. The board keeps its
 * natural size and is scaled to fit the field, so it never scrolls. Special Teams lists the returners below.
 */
export default function Formation({ unit, rows, kick, onOpen }: Props) {
  const board = useMemo(() => boardOf(rows, unit, kick), [rows, unit, kick]);
  const returners = (["KR", "PR"] as const).map((role) => ({ role, r: rows.get(role) }));

  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const w = board.width + 2 * PAD;
  const h = board.height + 2 * PAD;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(MAX_SCALE, el.clientWidth / w, el.clientHeight / h) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  return (
    <>
      <div className="formation__field" ref={box}>
        <div className="board" style={{ width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <span className="board__los" style={{ top: PAD + board.los }} aria-hidden="true" />
          {board.slots.map((s) => (
            <section
              key={`${s.label}-${s.p.slug}`}
              className="board__slot"
              style={{ left: PAD + s.left, top: PAD + s.top, width: CARD_W }}
              aria-label={s.label}
            >
              <h3 className="board__label">{s.label}</h3>
              <StarterCard p={s.p} tag={s.tag} onOpen={() => onOpen(s.row.role, s.p.slug)} />
              {s.backups.length > 0 && (
                <ol className="board__backups" aria-label={m.backups}>
                  {s.backups.map((b) => (
                    <li key={b.slug}>
                      <button
                        type="button"
                        className="board__backup"
                        aria-label={m.spotLabel(s.tag, b.name, b.overall)}
                        title={m.openCard(b.name)}
                        onClick={() => onOpen(s.row.role, b.slug)}
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
function StarterCard({ p, tag, onOpen }: { p: DepthCard; tag: string; onOpen: () => void }) {
  const size = [p.height, p.weight].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={["board__card", p.injury && "is-out"].filter(Boolean).join(" ")}
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

import type { DepthCard, DepthRow } from "../../types.ts";

// Where each starter stands in a simple formation, as % of the field's play area (x across, 0 left; y down, 0 top).
// Offense and defense come straight from the chart's starters (so a nickel defense shows its third corner, a team
// with a fullback lines up in the I). The kicking units aren't roles in the engine, so they're filled from the
// chart: the line from the offensive line, the holder is the punter, the wings and gunners the next ones up.

export type Unit = "offense" | "defense" | "special";
export type Kick = "fg" | "punt";

export interface Spot {
  /** the spot's tag on the field (LT, MIKE, H, LS, G…) */
  tag: string;
  x: number;
  y: number;
  p: DepthCard;
  /** the chart role he's drawn from (his depth there shows beside the field) */
  row: DepthRow;
}

export interface Formation {
  /** the line of scrimmage, as % down the area */
  los: number;
  spots: Spot[];
}

/** `n` points spread evenly between `from` and `to` (one point sits in the middle). */
const spread = (n: number, from: number, to: number) =>
  n === 1 ? [(from + to) / 2] : Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

export function formationOf(rows: Map<string, DepthRow>, unit: Unit, kick: Kick): Formation {
  const spots: Spot[] = [];
  const used = new Set<string>();
  const put = (tag: string, x: number, y: number, row: DepthRow, p: DepthCard) => {
    used.add(p.slug);
    spots.push({ tag, x, y, p, row });
  };
  /** a role's starters */
  const starters = (role: string) => {
    const r = rows.get(role);
    return r ? r.players.slice(0, r.starters).map((p) => ({ r, p })) : [];
  };
  /** the next `n` players not yet on the field, from these roles in order */
  const next = (roles: string[], n: number) => {
    const out: { r: DepthRow; p: DepthCard }[] = [];
    for (const role of roles) {
      const r = rows.get(role);
      for (const p of r?.players ?? []) {
        if (out.length === n) return out;
        if (!used.has(p.slug) && !out.some((o) => o.p.slug === p.slug)) out.push({ r: r!, p });
      }
    }
    return out;
  };
  /** place these at the given points (extras beyond the points are left off) */
  const place = (list: { r: DepthRow; p: DepthCard }[], at: [number, number][], tag?: string) =>
    list.slice(0, at.length).forEach(({ r, p }, i) => put(tag ?? r.role, at[i][0], at[i][1], r, p));

  /** the guards and tackles, each from his own side's row, at these x's (LG, RG, LT, RT) on row y */
  const line = (xs: number[], y: number) =>
    ["LG", "RG", "LT", "RT"].forEach((role, i) => place(next([role], 1), [[xs[i], y]]));

  if (unit === "offense") {
    const ol = ["LT", "LG", "C", "RG", "RT"].flatMap(starters);
    place(
      ol,
      spread(ol.length, 26, 74).map((x) => [x, 30]),
    );
    place(starters("TE"), [
      [86, 30],
      [14, 30],
    ]);
    place(starters("WR"), [
      [2, 30],
      [98, 30],
      [86, 60],
      [14, 60],
    ]);
    const fb = starters("FB");
    if (fb.length) {
      // under center, the fullback and the back behind him
      place(starters("QB"), [[50, 46]]);
      place(fb, [[50, 68]]);
      place(starters("HB"), [[50, 90]]);
    } else {
      // the shotgun, the back beside him
      place(starters("QB"), [[50, 64]]);
      place(starters("HB"), [[64, 66]]);
    }
    return { los: 22, spots };
  }

  if (unit === "defense") {
    // two rows, wide: up front the corners, the line and a nickel corner in the slot; behind, the linebackers over the
    // line with the safeties outside them, a step deeper
    const front = ["LEDG", "DT", "REDG"].flatMap(starters);
    const half = ((front.length - 1) * 12) / 2;
    place(
      front,
      spread(front.length, 50 - half, 50 + half).map((x) => [x, 70]),
    );
    const backers = ["SAM", "MIKE", "WILL"].flatMap(starters);
    const bhalf = ((backers.length - 1) * 12) / 2;
    place(
      backers,
      spread(backers.length, 50 - bhalf, 50 + bhalf).map((x) => [x, 48]),
    );
    const edge = 50 + half + 12;
    place(starters("CB"), [
      [50 - half - 24, 70],
      [50 + half + 24, 70],
      [edge, 68],
      [50 - half - 12, 68],
    ]);
    const safeties = ["FS", "SS"].flatMap(starters);
    place(
      safeties,
      [
        [50 - bhalf - 16, 44],
        [50 + bhalf + 16, 44],
      ].slice(0, safeties.length) as [number, number][],
    );
    return { los: 78, spots };
  }

  if (kick === "fg") {
    // the snapper and the line, the ends, the wings a step back, the holder and the kicker
    place(next(["C"], 1), [[50, 32]], "LS");
    line([40, 60, 30, 70], 32);
    place(next(["TE"], 2), [
      [20, 32],
      [80, 32],
    ]);
    place(
      next(["TE", "FB", "HB"], 2),
      [
        [8, 46],
        [92, 46],
      ],
      "W",
    );
    place(next(["P", "QB"], 1), [[50, 62]], "H");
    place(next(["K"], 1), [[62, 84]]);
    return { los: 26, spots };
  }

  // the punt: the snapper and the line, the wings, the gunners split wide, the personal protector, the punter
  place(next(["C"], 1), [[50, 30]], "LS");
  line([40, 60, 30, 70], 30);
  place(
    next(["TE", "FB"], 2),
    [
      [18, 46],
      [82, 46],
    ],
    "W",
  );
  place(
    next(["CB", "WR"], 2),
    [
      [8, 28],
      [92, 28],
    ],
    "G",
  );
  place(next(["SS", "FS", "FB", "HB"], 1), [[50, 54]], "PP");
  place(next(["P"], 1), [[50, 86]]);
  return { los: 22, spots };
}

export interface Slot extends Spot {
  /** the card's heading: the tag, numbered when the role starts more than one ("WR 2") */
  label: string;
  /** the next ones up behind him (the role's backups, dealt out across its starters) */
  backups: DepthCard[];
  /** where the card sits on the board, in px */
  left: number;
  top: number;
  height: number;
}

export interface Board {
  slots: Slot[];
  width: number;
  height: number;
  /** the line of scrimmage, in px down the board */
  los: number;
}

/** *tune* How many backups each card shows. */
export const BACKUPS_SHOWN = 2;

// A card's size on the board, in px; index.css draws the cards at exactly these sizes.
export const CARD_W = 150;
const LABEL_H = 22; // the tag over the card and the gap under it
const CARD_H = 184;
const BACKUP_H = 40;
const BACKUP_GAP = 4;
const BACKUPS_TOP = 6;
/** *tune* The room between cards side by side and one behind another, and how far a yard of depth moves a card. */
const SIDE_GAP = 12;
const BEHIND_GAP = 24;
const PX_PER_DEPTH = 10;

const heightOf = (backups: number) =>
  LABEL_H + CARD_H + (backups ? BACKUPS_TOP + backups * BACKUP_H + (backups - 1) * BACKUP_GAP : 0);

/**
 * The formation as a board of cards: each starter's card where he lines up, the role's backups under it. Across, the
 * field is stretched just enough that the closest two men on a row don't touch. Away from the ball, cards are placed
 * nearest the line of scrimmage first, each at its depth or just past any card nearer the ball that it would cover, so
 * the shape of the formation holds (the offense and the kicking units below the line, the defense above it).
 */
export function boardOf(rows: Map<string, DepthRow>, unit: Unit, kick: Kick): Board {
  const { spots, los } = formationOf(rows, unit, kick);
  const onField = new Set(spots.map((s) => s.p.slug));
  const above = unit === "defense";

  // across: px per % of the field, so the tightest pair on a row clears
  let tightest = 100;
  spots.forEach((a, i) =>
    spots.slice(i + 1).forEach((b) => {
      if (Math.abs(a.y - b.y) < 6 && a.x !== b.x) tightest = Math.min(tightest, Math.abs(a.x - b.x));
    }),
  );
  const perX = (CARD_W + SIDE_GAP) / tightest;
  const minX = Math.min(...spots.map((s) => s.x));
  const depth = (s: Spot) => Math.abs(s.y - los);
  const nearest = Math.min(...spots.map(depth));

  // each card's span away from the ball: [from, from + height]
  const placed: (Slot & { from: number })[] = [];
  [...spots]
    .sort((a, b) => depth(a) - depth(b) || a.x - b.x)
    .forEach((s) => {
      const mates = spots.filter((o) => o.row.role === s.row.role);
      const same = spots.filter((o) => o.tag === s.tag && o.row.role === s.row.role);
      const backups = s.row.players
        .filter((p) => !onField.has(p.slug))
        .filter((_, i) => i % mates.length === mates.indexOf(s))
        .slice(0, BACKUPS_SHOWN);
      const left = (s.x - minX) * perX;
      const height = heightOf(backups.length);
      const blocked = placed
        .filter((o) => Math.abs(o.left - left) < CARD_W + SIDE_GAP - 1)
        .map((o) => o.from + o.height + BEHIND_GAP);
      const from = Math.max(BEHIND_GAP + (depth(s) - nearest) * PX_PER_DEPTH, ...blocked);
      placed.push({
        ...s,
        label: same.length > 1 ? `${s.tag} ${same.indexOf(s) + 1}` : s.tag,
        backups,
        left,
        top: 0,
        height,
        from,
      });
    });

  // down the board: below the line for the offense and the kicking units, above it for the defense
  const far = Math.max(...placed.map((s) => s.from + s.height));
  const slots: Slot[] = placed.map(({ from, ...s }) => ({ ...s, top: above ? far - from - s.height : from }));
  return {
    slots,
    width: Math.max(...slots.map((s) => s.left)) + CARD_W,
    height: far,
    los: above ? far : 0,
  };
}

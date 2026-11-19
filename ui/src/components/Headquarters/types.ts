import type { ReactNode } from "react";
import type { BoardRow, RecruitEvent, SeasonSummary } from "../../types.ts";

// Headquarters' own shapes: a card on the board, a widget in the catalog, and the reads ("sources") widgets draw from.
// Each source is one request, fetched once however many cards use it (web/hq.js sourceUrl).

export type Size = "S" | "M" | "L";
export type Category = "recruiting" | "scouting" | "program";

/** One card on your board: which widget, how wide (S one column, M two, L all of them), and a set height if you gave one. */
export interface Card {
  id: string;
  widget: string;
  size: Size;
  /** px; none is Auto (as tall as its content, up to the cap) */
  h?: number;
}

export type SourceName =
  | "board"
  | "scouting"
  | "scouted"
  | "programs"
  | "classes"
  | "myclass"
  | "prospects"
  | "depth"
  | "hq";

/** A recruit as the lists show him: enough for a name, a position and stars. */
export interface Who {
  id?: string;
  pid?: string;
  name: string;
  position?: string;
  display_pos?: string;
  stars?: number | null;
}

/** A board row with what only Headquarters reads (and a sample's canned word). */
export type HqRow = BoardRow & { position?: string; sample_word?: string };

/** GET /recruiting, with the fields the board's own screen does not use. */
export interface HqBoard {
  week?: number;
  committed: number;
  open_spots: number;
  class_rank?: number;
  offers: number;
  offers_left: number;
  hours?: number;
  hours_left?: number;
  nil?: { budget: number; left: number };
  points_left?: number;
  points_week?: number;
  targets?: HqRow[];
  board?: HqRow[];
  needs_detail?: Record<string, { need: number; commits: number; board: number }>;
  recap?: (RecruitEvent & { pid: string; name: string; portal_week?: number })[];
}

export interface ScoutRow extends Who {
  pid: string;
  looks: number;
  can_send?: boolean;
  on_board?: boolean;
  potential?: string[];
  flags?: string[];
  likes?: { who: string; name?: string; text?: string } | null;
}

/** GET /scouting (and ?scouted=1: only the prospects your staff has looked at). */
export interface HqScouting {
  queue?: ScoutRow[];
  flags?: (Who & { pid: string; flag: string; likes?: { who: string } | string | null; on_board?: boolean })[];
  scouts?: {
    id: string;
    name: string;
    role: string;
    area: string | null;
    evaluation_word: string;
    yield?: { looks: number; flags: number };
  }[];
}

export interface ProgramRow {
  team: string;
  name: string;
  tier_name: string;
  prestige: number;
  winning: number;
  nil: number;
  pro: number;
}

/** GET /programs: your program, the rest by rating, and the floors that turn a grade into its word. */
export interface HqPrograms {
  you?: ProgramRow | null;
  rows?: ProgramRow[];
  words?: [string, number][];
}

export interface ClassSchool {
  school: string;
  name: string;
  count: number;
  rank?: number;
  yours?: boolean;
  stars?: Record<string, number>;
}

/** GET /classes (and ?school=: that school's class, every recruit). */
export interface HqClasses {
  schools?: ClassSchool[];
  class?: (Who & { id: string; national_rank?: number; signed?: string | null; committed?: string | null })[];
}

export interface HqProspects {
  rows?: (Who & { id: string; on_board?: boolean; scouted?: boolean })[];
  needs?: Record<string, number | { need: number }>;
}

export interface DepthPlayer {
  name: string;
  overall: number;
  position?: string;
  slug?: string;
  promise?: string | null;
}

export interface HqDepth {
  units?: { name?: string; rows?: { role?: string; label?: string; players?: DepthPlayer[] }[] }[];
}

export interface OutlookPlayer {
  slug?: string;
  name: string;
  position: string;
  class: string;
  overall: number;
  starter: boolean;
  leaving: string | null;
  draft: string | null;
  transfer: string | null;
  next?: { status: string; status_name?: string; team?: string; team_name?: string } | null;
  replacement?: { pid: string; name: string; status: string } | null;
}

export interface NextGroup {
  group: string;
  target: number;
  filled: number;
  need: number;
  players: {
    slug?: string;
    name: string;
    position: string;
    class_next: string;
    overall: number;
    draft?: string | null;
  }[];
  commits: { pid: string; name: string; stars: number; position: string; signed?: boolean }[];
  targets?: { pid: string; name: string; stars: number; position: string; kind: "offered" | "board" | "contacted" }[];
}

export interface Goal {
  id: string;
  title: string;
  target: number;
  now: number | null;
  met: boolean;
}

/** What a suggested task asks of you; the game ticks the task once you do it. */
export interface TaskDo {
  kind: string;
  pid?: string;
  nil?: number;
  group?: string;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  /** the game ticked it for you */
  auto?: boolean;
  /** you unticked one the game ticked: it stays unticked */
  manual?: boolean;
  /** why it no longer applies */
  note?: string;
  do?: TaskDo;
  since?: number;
}

/** GET /headquarters?want=…: the saved layout, and the reads no other screen has. */
export interface HqView {
  layout?: { cards: Card[] };
  commits?: { week: number; gained: number; lost: number; total: number }[];
  movers?: { up: (Who & { pid: string; word?: string })[]; down: (Who & { pid: string; word?: string })[] };
  /** recruit id → the week you last contacted him */
  contacts?: Record<string, number>;
  outlook?: {
    players: OutlookPlayer[];
    counts: {
      graduation: number;
      draft: number;
      draft_likely: number;
      transfer_high: number;
      transfer_some: number;
      roster: number;
    };
  };
  next_year?: { groups: NextGroup[] };
  goals?: Goal[];
  tasks?: Task[];
  whatif?: WhatIf;
}

export interface WhatIf {
  name?: string;
  group: string;
  rank_now: number;
  rank_if: number;
  need_now: number;
  need_if: number;
}

/** What a widget is handed: the sources it named (a sample's canned ones in the catalog's preview). */
export interface Sources {
  board?: HqBoard;
  scouting?: HqScouting;
  scouted?: HqScouting;
  programs?: HqPrograms;
  classes?: HqClasses;
  myclass?: HqClasses;
  prospects?: HqProspects;
  depth?: HqDepth;
  hq?: HqView;
  /** samples only: a season for the calendar, a canned What-If */
  season?: Pick<SeasonSummary, "current_week" | "schedule">;
  whatif?: WhatIf;
}

/** What a widget can do, and where it is drawn. */
export interface Ctx {
  size: Size;
  /** drawn in the catalog from canned data: nothing it shows can be acted on */
  sample: boolean;
  season: SeasonSummary | null;
  /** your school's slug ("you" in a sample) */
  team: string;
  /** Add to Board, or Send a Scout; resolves true when it worked (the cards that read it redraw) */
  act: (kind: "board" | "scout", who: { pid: string; name: string }) => Promise<boolean>;
  /** open a recruit on the Recruiting board */
  openRecruit: (pid: string) => void;
  /** open your Depth Chart (a player's name) */
  openPlayer: () => void;
  /** store tasks or goal targets, then redraw the cards that read them */
  savePlan: (body: { tasks?: Task[]; goals?: Record<string, number> }) => Promise<boolean>;
  /** one-off reads: a search, a What-If */
  get: <T>(path: string) => Promise<T>;
}

export interface Widget {
  id: string;
  title: string;
  category: Category;
  /** one line for the catalog */
  blurb: string;
  sizes: Size[];
  /** the size it is added at */
  size: Size;
  sources: SourceName[];
  /** the /headquarters reads it needs */
  want?: string[];
  /** the section its View All opens */
  viewAll?: string;
  /** canned data for the catalog's preview */
  sample: Sources;
  Draw: (props: { d: Sources; ctx: Ctx }) => ReactNode;
}

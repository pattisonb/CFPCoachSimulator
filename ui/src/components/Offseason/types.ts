// GET /api/season/{id}/offseason (coach_career/offseason.py view): the whole offseason as it stands. Every stage reads
// from this one object; an action returns it again (or a small result, after which it is read again).

export interface OffStage {
  key: string;
  name: string;
  done: boolean;
  current: boolean;
}

/** A player by the offseason's own short names. */
export interface OffPlayer {
  id: string;
  name: string;
  pos: string;
  cls: string;
  overall: number;
}

/** A player who may leave, at Keep Them Home. */
export interface Leaver extends OffPlayer {
  /** portal, draft… */
  intent: string;
  /** why, in a sentence fragment: "Buried on the depth chart behind Khamoni Robinson" */
  reason: string;
  role_now_name: string;
  role_next_name: string;
  /** you have met with him: his ask is known */
  met: boolean;
  ask: { kind: string | null; nil: number | null; known: boolean };
  offers: { nil: number; promise: boolean; released: boolean };
  /** how likely he stays, in a word, once you have met */
  chance_word: string | null;
  elite: boolean;
}

export interface Departure extends OffPlayer {
  team: string;
  team_name: string;
  kind: string;
  kind_name?: string;
  pick?: number;
  round?: number;
}

export interface Review {
  goal: string;
  met: boolean;
  record: [number, number];
  mood: string;
  /** he must decide on you this year */
  must: boolean;
  options: string[];
  option_names: Record<string, string>;
  decided: boolean;
  fired: boolean;
  /** what he said, in sentences */
  words: string;
  nil_now: number;
  nil_next: number;
}

export interface Candidate {
  name: string;
  role: string;
  evaluation: number;
  recruiting: number;
  play_calling?: number;
  why: string;
  previous_job: string;
  age?: number;
  years?: number;
}

export interface StaffMember {
  id: string;
  role: string;
  name: string;
  contract_until?: number | null;
}

export interface JobRow {
  team: string;
  name: string;
  conference: string;
  goal: string;
}

export interface OffView {
  stage: string;
  stage_name: string;
  /** the season being built */
  year: number;
  stages: OffStage[];
  fired: boolean;
  review: Review | null;
  review_open: boolean;
  retention: {
    players: Leaver[];
    results: (OffPlayer & { intent: string; status: string; nil: number; promise: boolean })[] | null;
    /** NIL points you may spend keeping players, and what is left */
    budget: number;
    left: number;
  };
  redshirts: {
    players: (OffPlayer & { games: number; team_games: number; redshirt: boolean })[];
    decided: boolean;
  };
  departures: {
    mine: Departure[];
    league: Record<string, number>;
    first_round: Departure[];
    drafted: boolean;
  };
  position_changes: { id?: string; name: string; from: string; to: string }[];
  my_roster: (OffPlayer & { moved_from: string | null; transfer: string | null })[];
  roster: number;
  roster_limit: number;
  open_spots: number;
  /** recruits signed in the class coming in */
  signed: number;
  portal: {
    week: number | null;
    weeks: number;
    entrants: number;
    signed: number;
    offers: string[];
    offers_left: number;
    /** portal moves in or out of your program */
    moves_mine: {
      id: string;
      name: string;
      pos: string;
      from: string;
      to: string;
      overall: number;
      walk_on?: boolean;
    }[];
    /** the entrants you chased who went elsewhere */
    away: { id: string; name: string; pos: string; overall: number; to_name: string | null; line: string }[];
    board: {
      count: number;
      rows: {
        id: string;
        name: string;
        pos: string;
        overall: number;
        offered: boolean;
        signed: string | null;
        committed: string | null;
      }[];
    } | null;
  };
  portal_recap: {
    signed: (OffPlayer & { from_name?: string })[];
    lost: (OffPlayer & { to_name: string; reason: string })[];
    entrants: number;
    signed_league: number;
  } | null;
  report: {
    mine: (OffPlayer & { gain: number; why: string[]; transfer: string | null })[];
    walk_ons: number;
  } | null;
  your_staff: StaffMember[];
  staff: {
    leaving: StaffMember[];
    candidates: Record<string, Candidate[]>;
    /** the candidate you picked for each opening (his place in the list) */
    hired: Record<string, number>;
    reasons: Record<string, string>;
    contract: Record<string, { until: number | null; expiring: boolean }>;
    renewed: { id: string; name: string; role: string; through: number }[];
    developed: {
      id: string;
      name: string;
      role: string;
      why: string[];
      changes: { rating: string; from: number; to: number }[];
    }[];
  } | null;
  /** the league's coaching moves: a coach out (`old`, why) or a coach in (`new`, where from) */
  coaching_changes: { team: string; role: string; old?: string; new?: string; from?: string; reason: string }[];
  /** job offers (or, let go, the openings), at the Staff step */
  job?: { offers: JobRow[]; openings: JobRow[]; choice: string | null; moving_to: string | null };
  /** what your AD will expect next season, at Ready */
  goal_next?: string;
}

/** GET /offseason/conferences */
export interface ConferencesView {
  conferences: {
    name: string;
    independent: boolean;
    power: boolean;
    teams: { team: string; name: string; moved_from: string | null }[];
  }[];
  moves: { team: string; name?: string; from: string; to: string }[];
  open: boolean;
}

/** One of next season's games, and who could take the other side of it. */
export interface NextGame {
  event_id: string;
  week: number;
  home: string;
  away: string;
  home_display: string;
  away_display: string;
  neutral: boolean;
  conference_game: boolean;
  options?: { slug: string; name: string; conference: string; accepts: boolean; why: string }[];
}

/** GET /offseason/schedule */
export interface NextSchedule {
  team: string;
  games: NextGame[];
  editable: NextGame[];
  changes: unknown[];
  open: boolean;
}

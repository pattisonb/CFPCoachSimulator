// Shapes of what the game's API (app/api.py) returns. Add to these as screens are ported.

/** GET /api/teams → teams[] (app/api.py _team_card) */
export interface TeamCard {
  slug: string;
  name: string;
  school: string;
  abbreviation: string;
  mascot: string;
  conference: string;
  subdivision: string;
  city: string | null;
  state: string | null;
  fictional: boolean;
  colors: { primary: string; secondary: string; accent?: string };
  prestige: number;
  ratings: { overall: number; offense: number; defense: number; special_teams: number };
  head_coach: string;
  stadium: { name: string; capacity: number };
}

/** GET /api/teams/{slug} → players[] */
export interface RosterPlayer {
  name: string;
  slug: string | null;
  position: string;
  unit: "offense" | "defense";
  starter: boolean;
  overall: number;
  class: string | null;
  height: string | null;
  weight: number | null;
  jersey: string | null;
  role: string | null;
}

/** GET /api/teams/{slug} */
export interface TeamDetail extends TeamCard {
  players: RosterPlayer[];
}

export interface TeamsResponse {
  teams: TeamCard[];
}

/** GET /api/seasons → seasons[] (app/api.py list_seasons) */
export interface SeasonCard {
  id: string;
  team: string;
  team_name: string;
  mode: string;
  created_at: string | null;
  current_week: number;
  done: boolean;
  wins: number;
  losses: number;
  champion_name: string | null;
  year: number;
  career: boolean;
  offseason: string | null;
}

export interface SeasonsResponse {
  seasons: SeasonCard[];
}

/** GET /api/coach-options (the parts the new UI uses) */
export interface CoachOptions {
  blank: Record<string, unknown>;
}

/** POST /api/coaches and GET /api/coaches/{id} → the saved coach */
export interface SavedCoach {
  id: string;
  first_name: string;
  last_name: string;
  /** the pocket-faces face (sim/coaches.py keeps it as stored) */
  face?: unknown;
}

/** One week of your schedule (GET /api/season/{id} → schedule[], sim/season.py team_schedule) */
export interface ScheduleGame {
  event_id: string | null;
  week: number;
  /** "bye", "regular", or a postseason kind */
  kind: string;
  /** a named game ("Big 12 Championship"), else null */
  title: string | null;
  opponent: string | null;
  opponent_name: string;
  opponent_rank: number | null;
  venue: "home" | "away" | "neutral" | null;
  played: boolean;
  won: boolean | null;
  points_for: number | null;
  points_against: number | null;
  overtime: number;
  date: string | null;
  /** the opponent's record now ("3-1") */
  opponent_record?: string | null;
  /** a neutral site's name */
  site?: string | null;
  rivalry?: { name: string } | null;
  /** a box score exists (GET /api/season/{id}/game/{event_id}) */
  has_box?: boolean;
}

/** Who coaches your team this season: your created coach, or the team's own */
export type SeasonCoach =
  | { existing: true; name: string }
  | { existing: false; id: string; first_name: string; last_name: string };

/** GET /api/season/{id} (the parts the new UI uses) */
export interface SeasonSummary {
  id: string;
  team: string;
  team_name: string;
  conference: string;
  current_week: number;
  year: number;
  done: boolean;
  record: { wins: number; losses: number; conf_wins: number; conf_losses: number };
  schedule: ScheduleGame[];
  my_rank: { rank: number | null; kind: string; week: number } | null;
  coach: SeasonCoach;
  week_labels: Record<string, string>;
  /** each week's dates; `main` is its Saturday */
  week_dates: Record<string, { start: string; end: string; main: string }>;
  /** your job with the AD: the season's goal and how secure you are (0-100) */
  job: { goal: string; security: number; mood: string; ultimatum: boolean } | null;
  champion_name: string | null;
  offseason_stage: string | null;
  /** your team's injury report */
  injuries: unknown[];
}

/** GET /api/season/{id}/recruiting (the week's hours: the coach's energy) */
export interface RecruitingWeek {
  hours: number;
  hours_left: number;
  hours_used: number;
  /** "off", "week" or "season" */
  auto_recruit: string;
  committed: number;
  open_spots: number;
  class_rank: number | null;
  nil: { budget: number; left: number; carry: number };
  /** this week's scouting points */
  points_left: number;
  points_week: number;
}

/** GET /api/season/{id}/preview?team= : this week's game and a simulated prediction */
export interface GamePreview {
  game: unknown | null;
  /** "bye" or "done" when there's no game */
  reason?: string;
  prediction: { win_prob: number; points_for: number; points_against: number } | null;
}

/** One item of Program News (coach_career/office.py program_news) */
export interface NewsItem {
  week: number;
  kind: string;
  /** a game */
  won?: boolean;
  points_for?: number;
  points_against?: number;
  opponent_name?: string;
  venue?: "home" | "away" | "neutral";
  overtime?: number;
  /** a prospect or player */
  pid?: string;
  name?: string;
  position?: string;
  stars?: number;
  school?: string;
  school_name?: string | null;
  rival_name?: string | null;
  line?: string;
  reason?: string;
}

export interface ConferenceGame {
  away: string;
  home: string;
  away_name: string;
  home_name: string;
  away_score: number;
  home_score: number;
  overtime?: number;
  mine?: boolean;
}

/** GET /api/season/{id}/office */
export interface OfficeView {
  news: NewsItem[];
  conference: {
    name: string;
    week: number | null;
    games: ConferenceGame[];
    standing: {
      conf_rank: number;
      of: number;
      division: string | null;
      wins: number;
      losses: number;
      conf_wins: number;
      conf_losses: number;
    } | null;
    independent: boolean;
  };
}

/** GET /api/season/{id}/status : the sim job */
export interface SimStatus {
  status: "idle" | "running" | "error";
  kind?: string | null;
  done: number;
  total: number;
  stage: string | null;
  week: number | null;
  games_done: number | null;
  games_total: number | null;
  progress: number | null;
  error: string | null;
}

/** A player as the depth chart shows him (sim/season.py _depth_card): GET /api/season/{id}/depth/{team} */
export interface DepthCard {
  name: string;
  slug: string;
  /** engine position: QB, RB, WR, TE, OL, DL, MLB, LOLB, ROLB, CB, S, K, P */
  position: string;
  /** depth-chart role (QB, LT, MIKE, KR…), or null when on no chart */
  role: string | null;
  /** spot in the role's order, from 1 */
  depth: number | null;
  class: string | null;
  height: string | null;
  weight: number | null;
  jersey: string | null;
  overall: number;
  starter: boolean;
  games: number;
  /** one line of season stats ("1,204 yds · 9 TD"), empty before he plays */
  headline: string;
  archetype: string | null;
  form: number;
  injury: { type: string; weeks_left: number; returns_week: number } | null;
  /** this season's position change: where he came from */
  moved_from: string | null;
  /** a promised start (your career team): On Track, Slipping, Broken */
  promise: string | null;
  /** your own roster only */
  coachability?: string;
  coach_level?: number;
  potential_word?: string;
  redshirt?: { on: boolean; can: boolean; games: number; limit: number; why: string | null };
  /** the face drawn for him this season (Edit Player Look), else null */
  face?: unknown;
}

export interface DepthRow {
  role: string;
  label: string;
  /** how many start (the base formation's count; 0 when the scheme leaves the role out) */
  starters: number;
  /** in depth order, at most six */
  players: DepthCard[];
}

export interface DepthChart {
  team: string;
  name: string;
  head_coach: string | null;
  roster_size: number;
  overridden: boolean;
  units: { name: string; rows: DepthRow[] }[];
}

/** One attribute on our scale, with his ceiling */
export interface PlayerAttribute {
  key: string;
  label: string;
  group: string;
  about: string;
  value: number;
  potential: number;
  boost: number;
}

export interface PlayerTrait {
  key: string;
  name: string;
  about: string;
  /** 1 Bronze … 4 Platinum */
  tier: number;
  tier_name: string;
  built_on: { label: string; value: number }[];
  earned: boolean;
}

/** GET /api/season/{id}/player?team=&slug= (the parts the new UI uses) */
export interface PlayerProfile {
  slug: string;
  name: string;
  position: string;
  class_name: string | null;
  dev_trait: string | null;
  stars: number | null;
  attributes: PlayerAttribute[];
  traits: PlayerTrait[];
  ability_goal: { name: string; tier_name: string; have: number; need: number; text: string } | null;
  morale: { enabled: boolean; label: string } | null;
  /** his overall at every position group */
  ratings_at: Record<string, number>;
  games: number;
  team: { name: string };
  jersey: string | null;
  class: string | null;
  /** the face drawn for him this season (Edit Player Look), else null */
  face?: unknown;
}

/** One prospect in the class (GET /api/season/{id}/prospects → rows[], coach_career/prospects.py row) */
export interface ProspectRow {
  id: string;
  name: string;
  stars: number;
  national_rank: number;
  pos_rank: number;
  /** the recruiting position (QB, OT, IOL, EDGE…) */
  display_pos: string;
  /** the roster group he'd fill (QB, OL, DL…) */
  group: string;
  height_display: string;
  weight_display: string;
  hometown: { city: string; state: string };
  archetype: string;
  /** a school's slug when committed or signed */
  committed: string | null;
  signed: string | null;
  school_name: string | null;
  leaning_fcs: boolean;
  pro: boolean;
  on_board: boolean;
  offered: boolean;
  /** your staff's looks at him (a full report at 3) */
  looks: number;
  /** your staff's potential read, low and high (grade words, or numbers in Clear Mode); null before a look */
  our_potential: [string, string] | null;
  interest_level: "High" | "Medium" | "Low";
  generational: boolean;
  /** a full report's flag: gem, bust */
  find: string | null;
  /** Recommended only: why he fits ("from a state you sign from", "a position you need: QB 2 left") */
  why?: string[];
}

export interface NeedGroup {
  target: number;
  back: number;
  commits: number;
  need: number;
}

/** GET /api/season/{id}/prospects */
export interface ProspectsView {
  total: number;
  rows: ProspectRow[];
  needs: Record<string, NeedGroup>;
  recommended_ids: string[];
  summary: {
    total: number;
    stars: Record<string, number>;
    footprint: { board: number; contact: number; evaluated: number };
    outlook: { commits: number; spots: number; by_stars: Record<string, number> };
    top: { id: string; name: string; stars: number; national_rank: number; display_pos: string }[];
    /** per home state: the class, its 4- and 5-stars, your board */
    by_state: Record<string, { n: number; blue: number; board: number }>;
  };
}

/** GET /api/season/{id}/prospect/{pid} (the parts the new UI uses) */
export interface ProspectDetail {
  public: {
    id: string;
    name: string;
    hometown: { city: string; state: string };
    high_school: string;
    height_display: string;
    weight_display: string;
    archetype: string;
    stars: number;
    composite: number;
    national_rank: number;
    position_rank: number;
    state_rank: number;
    display_pos: string;
    committed: string | null;
    signed: string | null;
    on_board: boolean;
    offered_by_you: boolean;
    schools: { school: string; name: string; offered: boolean }[];
  };
  need: number | null;
  looks: number;
  evaluation: { strengths: string[]; solid: string[]; weaknesses: string[]; outlook: string } | null;
  row: ProspectRow;
}

/** One school on a recruit's list (GET /recruiting → board[].list) */
export interface ListSchool {
  school: string;
  name: string;
  /** his interest against the leader's, 0 to 1 */
  bar: number | null;
  pct: number | null;
  rank: number | null;
  offered: boolean;
  you?: boolean;
  visit: { week: number; done: boolean; game: { opponent_name: string } | null } | null;
}

/** One recruit on your board (GET /api/season/{id}/recruiting → board[], coach_career/prospects.py board_row) */
export interface BoardRow {
  id: string;
  name: string;
  stars: number;
  display_pos: string;
  national_rank: number;
  pos_rank: number;
  height_display: string;
  weight_display: string;
  hometown: { city: string; state: string };
  archetype: string;
  /** cold, contact, top, visited, committed */
  stage: string;
  committed: string | null;
  signed: string | null;
  hard: boolean;
  school_name: string | null;
  offered: boolean;
  /** your offer lands at the week step */
  offer_landing: boolean;
  /** your NIL on the table */
  nil: number;
  /** his NIL ask of you: a range until a visit pins it */
  ask: { lo?: number; hi?: number; exact?: number };
  standing: {
    place: number | null;
    of: number;
    pct: number | null;
    lo: number | null;
    hi: number | null;
    certainty: string;
  };
  list: ListSchool[];
  priorities_known: string[];
  /** your program's pull on each topic, 0 to 1 */
  strength: Record<string, number>;
  done_this_week: string[];
  hc_week: number | null;
  visit: { week: number; done: boolean } | null;
  visit_weeks: { week: number; label: string; opponent_name: string; taken_by: string | null }[];
  cooled: boolean;
  cooled_why: string | null;
  pestering: boolean;
  no_room: { label: string; tip: string } | null;
  history: { week: number; kind: string; school?: string; action?: string; line?: string; nil?: number }[];
  need: number | null;
  looks: number;
  /** what he said about each topic you pitched him: hit, weak, not_his, no_read */
  pitch_marks: Record<string, { mark: string; week?: number; action?: string }>;
  /** you already promised him the starting job */
  job_promised: boolean;
  /** your call or in-home visit this week, open until you pitch */
  scene: Scene | null;
}

/** A turn of a call or visit: you, him, someone in his family (with their label), or a note on the room. */
export interface SceneTurn {
  who: "you" | "him" | "family" | "note";
  text: string;
  label?: string;
}

/** His question about a named player (or his Package Deal mate), and your answer once given. */
export interface SceneQuestion {
  kind: "roster" | "recruit" | "package";
  text: string;
  answer: "straight" | "promise" | "deflect" | null;
  reply: string | null;
  about: { name: string; position?: string; offered?: boolean };
  /** a Package Deal's own three answers */
  answers?: Record<string, { label: string; text: string }>;
  truthful?: boolean | null;
}

/** A call or in-home visit as a conversation (coach_career/scenes.py). */
export interface Scene {
  id: string;
  action: "call" | "hc_visit";
  week: number;
  turns: SceneTurn[];
  /** the line he tells you what he cares about in (after your opening), and the topics it points at */
  cue: { text: string; topics: string[] } | null;
  question: SceneQuestion | null;
  /** your opening's three topics, once presented */
  presented: string[] | null;
  tired: boolean;
  /** you promised him the job on this call */
  job?: boolean;
}

/** POST /recruit action "pitch": how he took what you led with */
export interface SceneReaction {
  kind: "hit" | "polite" | "quiet" | "tired" | "guarded";
  text: string;
  /** your line */
  you: string;
  revealed: string | null;
}

/** GET /api/season/{id}/recruiting (the parts the board reads) */
export interface RecruitingBoard extends RecruitingWeek {
  week: number;
  board: BoardRow[];
  offers: number;
  offers_left: number;
  pitches: string[];
  hours_cost: Record<string, number>;
}

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
}

/** GET /api/season/{id}/recruiting (the week's hours: the coach's energy) */
export interface RecruitingWeek {
  hours: number;
  hours_left: number;
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
}

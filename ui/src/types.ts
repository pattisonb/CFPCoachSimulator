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

/** POST /api/coaches → the saved coach */
export interface SavedCoach {
  id: string;
  first_name: string;
  last_name: string;
}

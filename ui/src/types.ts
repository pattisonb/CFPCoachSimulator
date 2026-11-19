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
  /** the coordinators, as "OC Name (Scheme)" */
  staff?: { offense: string; defense: string };
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
  rivalry?: Rivalry | null;
  /** the AP rank you held going into the week */
  my_rank?: number | null;
  /** a box score exists (GET /api/season/{id}/game/{event_id}) */
  has_box?: boolean;
}

/** A rivalry game's line (sim/season.py game_rivalry): the series entering it, or after it with who took the trophy */
export interface Rivalry {
  name: string;
  trophy?: string;
  /** "SMU leads 5-3" */
  series?: string;
  /** a played game: "TCU keeps the Iron Skillet" */
  headline?: string;
}

/** GET /api/season/{id}/schedule/{slug}: any FBS team's season */
export interface TeamScheduleView {
  team: string;
  team_name: string;
  conference: string;
  record: { wins: number; losses: number; conf_wins: number; conf_losses: number };
  rank: number | null;
  schedule: ScheduleGame[];
}

/** One side of a box score (GET /api/season/{id}/game/{event_id}; the parts the new UI uses) */
export interface BoxSide {
  name: string;
  score: number;
  quarters: number[];
  overtime: number[];
  team_stats: Record<string, number>;
}

export interface BoxScore {
  home: BoxSide;
  away: BoxSide;
  home_slug: string;
  away_slug: string;
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
  /** the bowls, once they're set on selection day (sim/season.py bowl_view) */
  bowls?: Bowl[];
  /** before then, from the committee's first ranking: the projected lineup */
  bowl_projection?: BowlProjection | null;
  /** the playoff field, once it's set */
  bracket?: Bracket | null;
  /** before then: the bracket as it would be seeded today, from the committee's ranking (the AP poll until it ranks) */
  bracket_projection?: Bracket | null;
  /** the bowls from the same order, from Week 0 (bowl_projection waits for the committee) */
  bowl_outlook?: BowlProjection | null;
  /** every week's polls, by week ("0" is the preseason) */
  polls?: Record<string, WeekPolls>;
  /** the weeks the committee ranks */
  cfp_weeks?: number[];
}

/** One team in a poll (sim/polls.py). */
export interface PollEntry {
  rank: number;
  team: string;
  name: string;
  /** last week's rank; null when it was unranked */
  previous: number | null;
  record: string;
  conference: string;
  first_place?: number;
  points?: number;
}

/** A week's polls: the AP and Coaches Top 25 with the others receiving votes, and the committee's once it ranks. */
export interface WeekPolls {
  ap?: PollEntry[];
  ap_others?: PollEntry[];
  coaches?: PollEntry[];
  coaches_others?: PollEntry[];
  cfp?: PollEntry[];
}

export interface BracketSeed {
  seed: number;
  team: string;
  name: string;
  /** its place in the ranking the bracket was built from */
  rank: number | null;
  conference: string;
  /** "SEC champion", "at-large", "Group of Six auto bid (highest ranked)" */
  bid: string;
  /** the top four: no first-round game */
  bye: boolean;
}

/** The 12-team playoff (sim/polls.py build_bracket): the real one, or today's projection. */
export interface Bracket {
  seeds: BracketSeed[];
  first_round: { home: BracketSeed; away: BracketSeed }[];
  /** each top-four seed and the first-round game whose winner it meets ("5 vs 12") */
  quarterfinals: { bye: BracketSeed; winner_of: string }[];
  first_four_out: { team: string; name: string; rank: number | null }[];
  autos: { team: string; bid: string; name: string }[];
  /** a projection: where it came from, and that poll's week */
  projected?: boolean;
  source?: "ap" | "cfp";
  week?: number;
}

/** One bowl: its game (set, projected, or played) and its history */
export interface Bowl {
  bowl: string;
  name: string;
  /** "Dec 15" */
  date: string | null;
  /** "5:30 pm" */
  time: string | null;
  site: string | null;
  /** 17, 18 or 19: the bowl weeks */
  week: number;
  event_id?: string;
  home: string | null;
  away: string | null;
  home_name: string | null;
  away_name: string | null;
  home_record: string | null;
  away_record: string | null;
  home_conference: string | null;
  away_conference: string | null;
  /** the conferences it takes, as picked this year */
  tie_ins: string[];
  /** no eligible teams were left for it */
  unfilled?: boolean;
  projected?: boolean;
  played: boolean;
  home_score?: number | null;
  away_score?: number | null;
  overtime?: number;
  mine: boolean;
  has_box: boolean;
  games_played?: number | null;
  first_played?: number | null;
  payout?: string | null;
  recent?: { year: number; winner: string; winner_score: number; loser: string; loser_score: number }[];
}

/** The projected bowl lineup (sim/season.py bowl_projection) */
export interface BowlProjection {
  /** the committee ranking it's built from */
  week: number;
  bowls: Bowl[];
  /** the projected playoff field */
  playoff: string[];
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
  /** the game's id, for its box score */
  event_id?: string | null;
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
  /** Game Day: your game's id once it has been played, for the playback */
  gameday_event?: string | null;
  /** the last week the sim has finished */
  current_week?: number;
  record?: { wins: number; losses: number; conf_wins: number; conf_losses: number };
  /** your games played so far (sim/season.py my_results), for the week strip while a sim runs */
  results?: SimResult[];
}

/** One of your results as a running sim reports it. */
export interface SimResult {
  week: number;
  title: string | null;
  kind: string;
  won: boolean;
  points_for: number;
  points_against: number;
  opponent: string;
  opponent_name: string;
  venue: "home" | "away" | "neutral" | null;
  overtime: number;
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
  /** how much of his overall it is, in percent */
  weight?: number;
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
  /** what its next tier takes and how far along he is (none at Platinum, or when it is his goal) */
  next?: { tier: number; tier_name: string; have: number; need: number; text: string };
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
  /** the ability he is working toward: its key, the tier he would reach, how far along, and what it takes */
  ability_goal: {
    trait: string;
    name: string;
    tier: number;
    tier_name: string;
    have: number;
    need: number;
    text: string;
  } | null;
  morale: { enabled: boolean; label: string } | null;
  /** his overall at every position group */
  ratings_at: Record<string, number>;
  games: number;
  team: { name: string; record?: string };
  jersey: string | null;
  class: string | null;
  /** the face drawn for him this season (Edit Player Look), else null */
  face?: unknown;
  /** the broad ratings (Speed, Strength, Awareness…), and which of them his position leans on */
  ratings?: { key: string; label: string; value: number }[];
  key_ratings?: string[];
  /** your own roster: how fast he grows, and how good he can become */
  coachability?: string;
  potential_word?: string;
  redshirt?: { on: boolean; can: boolean; games: number; limit: number; why: string | null };
  /** where his main numbers rank at his position, in FBS and in his conference */
  ranks?: {
    key: string;
    label: string;
    value: number;
    fbs_rank: number;
    fbs_n: number;
    conf_rank: number;
    conf_n: number;
  }[];
  /** his games this season, in order; null when the game keeps no box scores for his team */
  game_log?:
    | {
        week: number;
        opponent_name: string;
        venue: string;
        won: boolean;
        points_for: number;
        points_against: number;
        started: boolean;
      }[]
    | null;
  honors?: { stage: string; award: string; place: string; detail: string }[];
  /** his past seasons, oldest first */
  history?: {
    year: number;
    team_name: string;
    class: string | null;
    position: string;
    games: number;
    honors: { kind: string; name: string }[];
  }[];
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
  /** one of your favorites (♥) */
  favorite?: boolean;
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
  /** your coordinator vouches for him (his report is complete and the read says he would start) */
  likes?: { who: string; text?: string } | null;
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
    leaning_fcs?: boolean;
    pro?: boolean;
  };
  need: number | null;
  looks: number;
  evaluation: { strengths: string[]; solid: string[]; weaknesses: string[]; outlook: string } | null;
  row: ProspectRow;
  /** who he is, as far as you have learned (each null until then) */
  traits: RecruitTraits;
  /** how each trait you don't know yet shows itself */
  trait_hints: Record<string, string>;
  /** your staff's report; null before a look */
  report: ScoutReport | null;
  /** Clear Mode: his position's key ratings as ranges; null before a look or outside Clear Mode */
  clear: {
    complete: boolean;
    looks: number;
    rows: RatingRead[];
    potential: (RatingRead & { position: string }) | null;
  } | null;
  /** the roster player he compares to, once his report is complete */
  our_comp: { name: string; school: string; position: string; overall?: number } | null;
  /** a committed recruit: his chance to flip in a word, and each school working him */
  flip: { word: string; rivals: { school: string; name: string; word: string }[] } | null;
  /** what happened to him this season */
  twist: { key: string; label: string; line?: string; weeks_left?: number } | null;
  can_scout: boolean;
  /** scouting points one trip to him costs, and what you have left this week */
  scout_cost: number;
  points_left: number;
}

/** A recruit's traits (coach_career/prospects.py): the words, each null until you learn it. */
export interface RecruitTraits {
  personality: string | null;
  decider: string | null;
  story: string | null;
  story_key: string | null;
  story_detail: string | null;
  commit_style: string | null;
  style_key: string | null;
  /** his story names your school (a legacy whose family played for you) */
  story_yours?: boolean;
  /** a Package Deal: the teammate he comes with (a prospect id) */
  story_mate?: string | null;
}

/** One rating as your staff reads it: an estimate inside a range, and how sure they are. */
export interface RatingRead {
  key: string;
  label: string;
  est: number;
  lo: number;
  hi: number;
  /** Low, Medium, High */
  confidence: string;
}

/** Your staff's scouting report on a prospect. */
export interface ScoutReport {
  /** his potential as a range of grade words ("Weak – Strong") */
  headline: string;
  potential: [string, string];
  potential_tone: string;
  verdict: string;
  strengths: string[];
  develop: string[];
  attributes: {
    group: string;
    label: string;
    words: [string, string];
    lo: number;
    hi: number;
    mid: number;
    word: string;
    tone: string;
    uncertainty: string;
  }[];
  certainty: string;
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
  /** places moved on his list since last week (up is positive), and whether the school is new on it */
  move?: number | null;
  new?: boolean;
  visit: { week: number; done: boolean; game: { opponent_name: string } | null } | null;
}

/** One recruit on your board (GET /api/season/{id}/recruiting → board[], coach_career/prospects.py board_row) */
export interface BoardRow {
  id: string;
  name: string;
  stars: number;
  /** your staff's flags (RecruitFlags): found once his report is complete */
  generational?: boolean;
  find?: string | null;
  likes?: { who: string; text?: string } | null;
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
  /** the week your head coach visited him (he visits a recruit once) */
  hc_week: number | null;
  /** your finished calls with him: after the first, Call is a quick check-in */
  calls?: number;
  /** one of your favorites (♥): your own mark, a filter and nothing more */
  favorite?: boolean;
  visit: { week: number; done: boolean } | null;
  visit_weeks: { week: number; label: string; opponent_name: string; taken_by: string | null }[];
  cooled: boolean;
  cooled_why: string | null;
  pestering: boolean;
  no_room: { label: string; tip: string } | null;
  history: RecruitEvent[];
  need: number | null;
  looks: number;
  /** what he said about each topic you pitched him: hit, weak, not_his, no_read */
  pitch_marks: Record<string, { mark: string; week?: number; action?: string }>;
  /** you already promised him the starting job */
  job_promised: boolean;
  /** you talked money with him: the NIL you owe on your offer, and the week it is due by */
  money_owed?: { nil: number; by_week: number } | null;
  /** your call or in-home visit this week, open until you pitch */
  scene: Scene | null;
}

/** One entry in a recruit's history, newest first (coach_career/recruiting.py log). */
export interface RecruitEvent {
  week: number;
  kind: string;
  school?: string;
  /** a contact's or pitch's action: message, call, hc_visit, official_visit */
  action?: string;
  /** the topic pitched, and how he took it: hit, polite, quiet, tired, guarded */
  pitch?: string;
  reaction?: string;
  /** an opening's topics, and how many landed (null: he gave nothing away) */
  topics?: string[];
  hit?: number | null;
  /** his question: how you answered (straight, promise, deflect), about whom */
  question?: string;
  answer?: string;
  about?: string;
  offered?: boolean;
  truthful?: boolean | null;
  crowded?: boolean;
  why?: string;
  /** a line the game wrote for it */
  line?: string;
  nil?: number;
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

/** One of your staff as a scout (GET /api/season/{id}/scouting → scouts[]) */
export interface Scout {
  id: string;
  name: string;
  /** "Offensive Coordinator", "Defensive Coordinator", "Recruiter" */
  role: string;
  /** how well he reads talent, as a word (Weak to All-American) */
  evaluation_word: string;
  area: string | null;
  contract_until: number | null;
  /** prospects in his area he still has looks to give */
  looking_at: number;
  /** this week: looks given, reads that changed, flags raised */
  yield: { looks: number; narrowed: number; flags: number };
}

/** One line of a scout's report: a prospect he looked at and what changed */
export interface ReportItem {
  pid: string;
  name: string;
  position: string;
  stars: number;
  /** "first read: potential Strong–All-American", "potential narrowed to Solid" */
  change: string;
  flags: string[];
  likes: { who: string; text: string } | null;
  on_board: boolean;
  complete: boolean;
}

/** One scout's report for a week */
export interface ReportGroup {
  scout_id: string;
  scout: string;
  area: string | null;
  looks: number;
  changed: number;
  items: ReportItem[];
}

/** A find your staff flagged this class */
export interface ScoutFlag {
  pid: string;
  name: string;
  position: string;
  stars: number;
  /** "generational", "gem", "bust" or "likes" */
  flag: string;
  looks: number;
  likes: { who: string; text: string } | null;
  on_board: boolean;
  standing_word: string;
}

/** GET /api/season/{id}/scouting (the parts Staff uses; it asks for one queue row) */
export interface ScoutingView {
  hours: number;
  hours_left: number;
  points_left: number;
  points_week: number;
  scouts: Scout[];
  /** each area's states */
  areas: Record<string, string[]>;
  full_reports: number;
  trips_this_week: number;
  board_size: number;
  board_scouted: number;
  reports: { this_week: ReportGroup[]; last_week: ReportGroup[] };
  flags: ScoutFlag[];
}

/** A player in an award race or result (sim/awards.py Pool.card; `slug` and `face` added by season.awards_view) */
export interface AwardPlayer {
  name: string;
  position: string;
  role: string | null;
  /** "JR", "SRRS" */
  class: string | null;
  team: string;
  team_name: string;
  conference: string;
  games: number;
  /** the season line: "40 rec, 672 yds, 8 TD" */
  line: string;
  /** the short line: "672 yds · 8 TD" */
  headline: string;
  score: number;
  slug?: string;
  /** his look, when you drew him one (Edit Player Look) */
  face?: unknown;
}

/** A Heisman candidate: a player with his votes */
export interface HeismanCandidate extends AwardPlayer {
  first: number;
  second: number;
  third: number;
  points: number;
  region: string;
  record: string;
  rank: number | null;
  /** the final vote: his line as the season ended */
  final_line?: string;
}

export interface HeismanVote {
  candidates: HeismanCandidate[];
  winner: HeismanCandidate | null;
  finalists: HeismanCandidate[];
  ballots: number;
  possible: number;
  /** the winner's points as a share of the possible, in percent */
  share: number;
}

/** A coach in a coach award's race */
export interface AwardCoach {
  team: string;
  team_name: string;
  conference: string;
  coach: string;
  /** an assistant's award (the Broyles): his role */
  role?: string;
  wins: number;
  /** an assistant's row (the Broyles) carries his team's wins only */
  losses?: number;
  champion?: boolean;
  rank?: number | null;
  preseason_rank?: number | null;
}

export interface PlayerAward {
  name: string;
  /** what kind of award ("qb", "dpoy", "mvp"…): the page groups by it */
  kind: string;
  /** what it honors: "best receiver" */
  honors?: string;
  winner: AwardPlayer | null;
  finalists: AwardPlayer[];
  /** the live race: the top five now */
  race?: AwardPlayer[];
}

export interface CoachAward {
  name: string;
  winner: AwardCoach | null;
  finalists: AwardCoach[];
  assistant?: boolean;
}

/** A player named to an honor team (sim/awards.py select_team): the slot he fills and which team (1 first, 2 second) */
export interface TeamPick extends AwardPlayer {
  slot: string;
  level: number;
}

/** A consensus All-American: first team on at least three of the five selectors' lists */
export interface ConsensusPick extends TeamPick {
  first_teams: string[];
  second_teams: string[];
  /** first team on all five */
  unanimous: boolean;
  /** how many selectors had him first team */
  selectors: number;
}

/** The All-America teams (sim/awards.py all_america): each selector's first and second teams, and the consensus */
export interface AllAmerica {
  selectors: Record<string, TeamPick[]>;
  consensus: ConsensusPick[];
  unanimous: ConsensusPick[];
}

/** One conference's honors (sim/awards.py conference_awards): its awards and its all-conference teams */
export interface ConferenceAwards {
  /** a coach award has kind "coach" and coaches in place of players */
  awards: (PlayerAward | (CoachAward & { kind: string }))[];
  teams?: { selectors?: Record<string, TeamPick[]>; levels?: number };
}

/** The national awards: the live race, or the results once given */
export interface NationalAwards {
  heisman: HeismanVote | null;
  awards: PlayerAward[];
  coach_awards: CoachAward[];
  /** named with the national awards (Week 15) */
  all_america?: AllAmerica | null;
  /** the live race: your conference's awards as they stand */
  conference?: Record<string, ConferenceAwards>;
}

/** One of your team's honors once given (sim/awards.py my_awards) */
export interface MyHonor {
  stage: string;
  award: string;
  who: string;
  position?: string;
  place: string;
  line?: string;
}

/** GET /api/season/{id}/awards */
export interface AwardsView {
  /** the last week whose awards are given (0: none yet) */
  given_through: number;
  /** every conference's awards and all-conference teams, once given (Week 14) */
  conference?: Record<string, ConferenceAwards>;
  national: NationalAwards | null;
  /** the live race, until the national awards are given */
  race?: NationalAwards & { live: boolean };
  postseason: { awards: PlayerAward[] } | null;
  mine: MyHonor[];
  my_conference: string;
  team: string;
}

/** One team's row in its conference's standings (GET /api/season/{id}/standings → standings[conf][]) */
export interface StandingRow {
  slug: string;
  name: string;
  /** "East", "West" in a conference with divisions */
  division: string | null;
  wins: number;
  losses: number;
  conf_wins: number;
  conf_losses: number;
  points_for: number;
  points_against: number;
  home_wins: number;
  home_losses: number;
  away_wins: number;
  away_losses: number;
  /** positive: wins in a row; negative: losses */
  streak: number;
  last: { won: boolean; score: string; opponent: string; opponent_name: string; venue: string; week: number } | null;
  ap_rank: number | null;
  cfp_rank: number | null;
  conf_rank: number;
  /** tied on conference record: what broke the tie */
  tiebreak?: string;
  champion: boolean;
  runner_up: boolean;
}

export interface StandingsView {
  standings: Record<string, StandingRow[]>;
}

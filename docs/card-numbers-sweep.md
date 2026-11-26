# Card numbers everywhere: the sweep (working checklist, deleted when done)

The player's rule (2026-11-26): the game sim's numbers are card numbers. Every number on any other scale goes: nothing
stored, sent between parts of the game, compared in a rule, or named in code or comments on any scale but the card's.
Play formulas take card numbers as their input. Old saves are converted once on load (the one place old numbers live).
The golden digest moves (the player asked for this change to the sim). When this list is empty this file is deleted.

## Phase 1: players (skills, room, overall, potential)
- Overall: one formula per position on the 54 card skills (fit once from today's card overalls: 96% within a point).
  game_scale.overall, _card_overall, card_formula, legacy_overall, OVERALL_FLOOR, position_skills; data/game_scale.json.
- League storage on card numbers: league.compact (r, g, o, REAL_ROOM, defaults), _filed_player (rosters.stored, ea_row,
  ROOM, missing room), expand (ratings to the engine: shown.to_base of the card number), own_decision, _development_of,
  _compute_base stamp, ensure_built (data/leagues files), rosters.stored/_stored/stored_ratings/_overall/overall/derive_team.
- Recruits and newcomers: recruiting/part1.js:461-485 generation (from_ea, potential_from_ea, ovr, pot_ovr);
  part5.js:539-582 portal_rc (composite o/100, _sort noise); offseason/part2.js:785-831 signees; part3.js:617-733
  walk-ons, FCS/JUCO transfers, cuts re-placed; league_fill.js 192-225, 345-421, 513-542; league_file.js 399-450, 1100-1112;
  position_fit.js 125-214 (to_ours(to_base) across groups); game_job.js 113-132; clear.js 63-90 ceiling_drift.
- Development: offseason/part3.js develop/regress/_develop_all (DEV_RATE, DEV_TOP 55, DEV_TOP_SPAN 10, BREAKOUT_ROOM,
  HONOR_ROOM, ROOM_CAP, REGRESS_POINTS); clear.js CEIL_* and CLEAR_CONFIDENCE; game_scale.ROOM; recruits.STAR_ROOM.
- Rules on overalls: offseason.house (part1.js:221); DRAFT_MIN_SD, ELITE_DECLARE 95, TRANSFER_UP_FROM 50, PROGRAM_FLOOR 45,
  RETAIN_ASK, QUIT_LOW, draft_grades/draft_score, ai_offers (+10, bar-4, /2, /3), walk-on compare; part4.js:326 overall>=70;
  word.STAR_OVR 70; headquarters DRAFT_LIKELY 90 / DRAFT_POSSIBLE 84; programs DEVELOPMENT_LIVE; league DEPTH_EYE,
  DEPTH_EXPERIENCE, TARGET_SPREAD; position_fit SIZE_*/FLOOR/POSITION_FLOOR; league_fill SLOT_STEP, CLASS_STEP, STAR_STEP,
  PLAYER_SD, OVERALL_RANGE; recruiting GENERATIONAL_FROM 95, PORTAL_ASK, PORTAL_RANK_NOISE, TIER_FROM_OVERALL, _ahead,
  depth_place, ahead_of, promise_holds, _early_leaver_cut, part2 needs/returning/playing_time/portal_upgrade;
  season part5.js:693 award outlook, part6.js:933 recruit_stars; awards.js 311/342 blocking - 50.
- Views: every shown.overall / skill / gain / overall_exact / overall_back on a player becomes nothing (the number is the
  card number): season part1-6, prospects, clear, grades, headquarters, offseason part2/part4 page(), recruiting part5,
  scenes.js about.ovr, prospects grade_detail pot_ovr.

## Phase 2: card attributes and the play engine
- Card attributes are card skills (each reads one skill): prospects._card/card_attributes, card_scale, decision_card,
  rosters._attribute, build_teams ATTR_SCALE/attribute_scale/house_attributes_of/USE_FROZEN, shown.attribute(_back).
- The engine reads card numbers: game_config ATTR_LEAGUE_AVG, play_functions 278/403/728-770/944/1063/1095/1229/1236,
  drive_functions 265/282/358, roster.js 131, CORE_FLOOR_OVR/CORE_FLOOR, engine_means/normalize; season part1.js
  _house_scale/house_value/house_to_engine/display_rating/engine_rating/shown_overall; ratings_at; return_rating to the page;
  profile ratings[] (raw); god mode edits (part6.js 400-590, player_edits); engine_teams.json attribute_scale,
  spread_scale, starter_means_before_normalization.

## Phase 3: coaches and team ratings
- Coaches on card numbers (average 70): data/engine_teams.json coaches, build_teams 357/766 measured_recruiting, carousel
  generated/_ratings_for/SUPPLY*, league_fill 674-740, league_file 625/751, staff (recruiting part5 852-858, offseason part3
  891-984, part4 725), created coach (sim_js/coaches.js, game_job apply_coach: already about 75), COACH_* development,
  dev_rating/coach_factor, COACH_UP_DEVELOPER, REDSHIRT_STAFF, WEAK_COACH, programs DEVELOPMENT_COACH/CULTURE_COACH/
  COACH_TIER_MEAN/COACH_LEAGUE_MEAN/coach appeal, program_history.json coach, carousel NFL >=80/HC_PROVEN, recruiting
  _coach_edge/_recruiting_rating/scout_blend/best_evaluator/look, grades PLUS_MINUS_EYE, tendencies (play_calling,
  discipline: DISCIPLINE_EFFECT, PLAY_CALLING_EFFECT), office/carousel/part4 shown.coach, raw coach ratings to the page.
- Team ratings: one, on card numbers (page_ratings already is): league.team_ratings/TEAM_FIT, season part5 game_ratings/
  team_ratings_now, part1.js:166 overwrite; consumers polls rating_weight, win expectation /60 (part5 765, part6 236,
  news 61), _prestige (overall-60)/10, programs conference scale (program_history scales.conference), awards ranks,
  league_fill STRENGTH_GRADE/NUDGE; shown.team/team_ratings; tests' fake seasons (team_ratings.overall); long_run.mjs.

## Phase 4: recruiting reads and grades
- Truths, looks and words on card numbers: recruiting part5 _truths/look/word/word_band/read halves/shown_range,
  WORD_FLOORS, COACHABILITY_POINTS, LOOK_SD, WORD_SLACK, GEM/BUST, prospects READ_SHIFT, PUBLIC_SD, STRENGTH_FROM 60,
  WEAKNESS_BELOW 45, GOOD_FROM, SOLID_FROM, UNCERTAINTY, find/find_held, comps; persona SHOWN_BAND, COMEBACK_READ;
  grades letters.

## Phase 5: saves, words, tests
- Old saves: one conversion on load (league, recruiting, portal, logs, player_edits, coaches, staff), stamped; replaces
  game_scale.upgrade/upgrade_overalls/_convert and recruiting upgrade_grades.
- Delete shown.js and game_scale's other scales; every comment on them; CLAUDE.md, README, ui/PLAN.md, ui/src/types.ts.
- Tests that pin the old numbers (see the list in the commit that adds this file's last phase); golden regenerated.
- Then the three progression fixes (4-star room for recruits, 4-star potentials in the roster file, the elite tier).

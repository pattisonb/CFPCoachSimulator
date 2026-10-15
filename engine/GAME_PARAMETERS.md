# Football Simulation Game Parameters

This document lists all baseline percentages, chances, and base yardage values used in the simulation. These can be adjusted via sliders in the UI.

---

## RUSHING PLAYS

### Base Yardage
- **Base rush yards**: `4.8` yards per carry
- **Red zone boost**: `1.15x` multiplier when yardline >= 80
- **Short yardage conversion**: `60%` chance to convert when `first_down <= 2` and `base_yards > -1.25`
- **Suppressed play minimum**: `1.5-3.5` yards (random) when `base_yards < 2.0`
- **O-line advantage divisor**: `750` (affects base_yards multiplier)

### Big Plays
- **Big run chance**: `12%` (when RB speed > 75)
- **Big run yards**: `20-50` yards (random)

### Fumbles (Rushing)
- **Base fumble chance**: `0.5%` (0.005)
- **Strength factor multiplier**: `0.008`
- **Intelligence factor multiplier**: `0.008`
- **Fumble recovery (offense)**: `42%` base chance
- **Recovery awareness boost**: Up to `8%` additional (based on team intelligence)
- **Recovery yardage loss**: `0-2` yards (random)

### Other Rush Modifiers
- **Guessed play penalty**: `50%` chance, `-10 to -1` yards
- **Assisted tackle chance**: `20%`

---

## PASSING PLAYS

### Base Yardage
- **Base pass yards**: `10.5` yards (Gaussian distribution, std dev = 5)
- **Max completion yards**: `50` yards (capped, except touchdowns)
- **Checkdown chance**: `18%`
- **Checkdown base yards**: `3` yards (Gaussian, std dev = 2)
- **Checkdown big play chance**: Based on RB speed / 100
- **Checkdown big play yards**: `+1 to +9` yards

### Completion Rate
- **Base completion chance**: `28%` (0.28)
- **QB skill divisor**: `1000` (intelligence + passing + decision_making)
- **Route running factor divisor**: `200`
- **Speed factor divisor**: `300`
- **Coverage factor divisor**: `1.9`
- **Minimum completion chance**: `1%` (0.01)
- **Per-option decrease**: `5%` (0.05) for each receiver checked

### Red Zone Boost
- **Red zone multiplier**: `1.15x` when yardline >= 80
- **TE target boost**: `+5%` completion chance on 3rd down or yardline > 80

### Big Plays
- **Big play chance**: `12%` (when speed_factor > 1)
- **Big play yards**: `25-75` yards (random)

### Sacks
- **Base sack rate**: `0.4%` (0.004) + `0.4%` per down (0.004 * down)
- **Guessed play bonus**: `+10%` (0.10)
- **O-line advantage divisor**: `5000`
- **Sack yardage**: `-8` yards average (Gaussian, std dev = 2)
- **Fumble on sack chance**: `2.5%` base (0.025) + strength/intelligence factors
- **Sack fumble strength factor**: `0.015`
- **Sack fumble intelligence factor**: `0.008`

### Throwaways
- **Base throwaway chance**: `8%` (0.08)
- **Per-down increase**: `+2%` per down (0.02 * down)
- **Total range**: `8-14%` depending on down

### Interceptions
- **Base interception chance**: `2.5%` (0.025)
- **Coverage skill divisor**: `1500` (adds up to 4% more)
- **Guessed play bonus**: `+1.5%` (0.015)
- **QB decision-making divisor**: `1200` (bad decisions increase INT chance)
- **Max interception chance**: `12%` (0.12 cap)
- **Interception return yards**: `+10` yards (added to yardline)

### QB Scramble
- **Base scramble chance**: `max(5%, (100 - intelligence) / 150)`
- **Low speed penalty**: `50%` reduction if speed < 60
- **Scramble gain odds**: `50%` base + `(speed - 50) / 100`
- **Scramble gain yards**: `1-12` yards
- **Scramble loss yards**: `-6 to -1` yards

---

## SPECIAL TEAMS

### Kickoffs
- **Base distance**: `45` yards + `(kick_power * 0.5)`
- **Distance variance**: `-5 to +5` yards
- **Out-of-bounds base chance**: `15%` (0.15)
- **Out-of-bounds accuracy reduction**: `kick_accuracy / 100 * 0.15`
- **Out-of-bounds minimum**: `1%` (0.01)
- **Touchback threshold**: `95` yards
- **Touchback spot**: `25` yard line
- **Fair catch chance**: `10%` (0.10)
- **Kickoff return TD chance**: `0.5%` (0.005)
- **Return yards**: `10-35` yards (random)

### PATs (Point After Touchdown)
- **Base success rate**: `97.5%` (0.975)
- **Accuracy adjustment**: `(kick_accuracy - 50) * 0.003`
- **Success rate range**: `94-99.5%` (clamped)
- **Botched snap/hold chance**: `1%` (0.01)

### Field Goals
- **Max kick range**: `52` yards
- **Range adjustment**: `(kick_power - 50) / 5` yards
- **Blocked kick chance**: `1%` (0.01)

#### Field Goal Success Rates by Distance
- **≤ 30 yards**: `96%` (0.96)
- **31-39 yards**: `90%` (0.90)
- **40-49 yards**: `75%` (0.75)
- **50-55 yards**: `50%` (0.50)
- **> 55 yards**: `25%` (0.25)
- **Accuracy adjustment**: `(kick_accuracy - 50) * 0.005`
- **Final range**: `3-98%` (clamped)

### Punts
- **Base punt distance**: `43` yards (Gaussian, std dev = 5)
- **Punt power adjustment**: `(punt_power - 50) / 5` yards
- **Fake punt chance**: `0.3%` (0.003) when yardline < 50
- **Blocked punt chance**: `0.5%` (0.005)
- **Pin inside 20 base chance**: `25%` (0.25)
- **Pin accuracy factor**: Based on punter accuracy

### 2-Point Conversions
- **Pass play chance**: `55%` (0.55)
- **Run play chance**: `45%` (0.45)
- **Pass base completion**: `50%` (0.50)
- **Pass QB skill divisor**: `300`
- **Pass defense coverage divisor**: `2000`
- **Pass success range**: `25-75%` (clamped)
- **Run base success**: `45%` (0.45)
- **Run O-line divisor**: `500`
- **Run D-line divisor**: `800`
- **Run success range**: `30-70%` (clamped)

---

## PENALTIES

### Offensive Penalties
- **Base chance**: `10%` (0.10)
- **False start**: `30%` weight, `-5` yards
- **Holding**: `40%` weight, `-10` yards
- **Offensive pass interference**: `15%` weight, `-15` yards
- **Delay of game**: `15%` weight, `-5` yards

### Defensive Penalties
- **Base chance**: `6%` (0.06)
- **Offside**: `40%` weight, `+5` yards
- **Pass interference**: `40%` weight, `+15` yards
- **Facemask**: `20%` weight, `+15` yards

---

## PLAY CALLING

### Offensive Play Selection
- **Run/pass balance**: Based on down and distance (see `determine_offense_play`)

### Defensive Play Selection
- **Down 1, ≤ 3 yards**: `75%` defend run
- **Down 1, 4-6 yards**: `60%` defend run
- **Down 1, 7-10 yards**: `55%` defend pass
- **Down 1, > 10 yards**: `70%` defend pass
- **Down 2, ≤ 3 yards**: `65%` defend run
- **Down 2, 4-6 yards**: `60%` defend pass
- **Down 2, 7-10 yards**: `70%` defend pass
- **Down 2, > 10 yards**: `80%` defend pass
- **Down 3, ≤ 3 yards**: `60%` defend run
- **Down 3, 4-6 yards**: `70%` defend pass
- **Down 3, 7-10 yards**: `85%` defend pass
- **Down 3, > 10 yards**: `90%` defend pass

### 4th Down Go-For-It Logic
- **Red zone (≥ 80), ≤ 1 yard**: `100%` go for it
- **Red zone (≥ 80), 2-3 yards**: `75%` chance
- **Red zone (≥ 80), 4-5 yards**: `50%` chance
- **Mid-field (50-79), ≤ 1 yard**: `70%` chance
- **Mid-field (50-79), 2 yards**: `40%` chance
- **Own territory (< 50), ≤ 1 yard, < 5 min**: `50%` chance
- **Own territory (< 50), ≤ 1 yard, ≥ 5 min**: `25%` chance

---

## TIME MANAGEMENT

### Play Duration
- **Normal play base time**: `28-42` seconds (random)
- **Hurry-up play base time**: `12-22` seconds (random)
- **Fatigue modifier**: `1.0 + (game_progress * 0.15)` (up to 15% slower)
- **Hurry-up fatigue modifier**: `1.0 + (game_progress * 0.05)` (up to 5% slower)

### Game Progress
- **Total game time**: `2400` seconds (40 minutes * 60)
- **Game progress calculation**: `1.0 - (seconds_remaining / 2400.0)`

---

## FATIGUE SYSTEM

### Baseline Fatigue
- **Base chance**: `(100 - endurance) / 10` (percentage)
- **Max fatigue cap**: Same as base chance

### General Fatigue (Per Play)
- **Skill positions**: `1.8` base fatigue
  - Positions: RB, TE, WR, CB, OLB, MLB, ROLB, S
- **Linemen/others**: `0.1` base fatigue
- **Endurance factor**: `(100 - endurance) / 100`

### Run Play Fatigue
- **Base fatigue**: `1 + (100 - endurance) / 80` (range: ~1-2.25)
- **Effort multiplier**: `1 + (100 - endurance) / 100`
- **With effort**: `base_fatigue + effort * multiplier`
- **Without effort**: `base_fatigue`

### Pass Play Fatigue
- **Base fatigue**: `1 + (100 - endurance) / 80` (range: ~1-2.25)
- **Effort multiplier**: `1 + (100 - endurance) / 100`
- **With effort**: `base_fatigue + effort * multiplier`
- **Without effort**: `base_fatigue * 0.75` (lighter for blocking/decoy routes)

---

## TACKLE ASSIGNMENT

### Position Weights (Short Yardage, ≤ 2 yards)
- **DL**: `35%`
- **ROLB**: `20%`
- **OLB**: `15%`
- **LB**: `20%`
- **S**: `10%`

### Position Weights (Mid Yardage, 3-7 yards)
- **ROLB**: `25%`
- **OLB**: `20%`
- **LB**: `25%`
- **S**: `20%`
- **DL**: `10%`

### Position Weights (Long Yardage, > 7 yards)
- **S**: `40%`
- **CB**: `40%`
- **ROLB**: `8%`
- **OLB**: `6%`
- **LB**: `6%`

### Other Tackle Settings
- **Assisted tackle chance**: `20%`
- **Max CBs per tackle**: `3`
- **Skill weight**: `(tackling + intelligence) / 2`

---

## FORCED FUMBLE ASSIGNMENT

### Position Selection (Based on Yardage)
- **≤ 2 yards**: ROLB, OLB, MLB (front seven)
- **3-7 yards**: ROLB, OLB, MLB, S (LBs and safeties)
- **> 7 yards**: CB, S (defensive backs)

### Weight Calculation
- **Weight**: `(tackling + strength) / 2`

---

## SACK ASSIGNMENT

### Half Sack Chance
- **Half sack probability**: `25%` (0.25)

---

## NOTES

- All percentages are expressed as decimals (e.g., `0.10` = 10%)
- Random ranges use `random.randint(min, max)` or `random.uniform(min, max)`
- Gaussian distributions use `random.gauss(mean, std_dev)`
- Many values are modified by player attributes (speed, strength, intelligence, etc.)
- Some values are clamped to minimum/maximum ranges for realism


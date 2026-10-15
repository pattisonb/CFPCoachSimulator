# Slider System Usage Guide

## Overview

The game now includes a comprehensive slider system similar to EA Sports College Football games. All sliders range from **0-100**, where **50 = default/normal**.

## How Sliders Work

- **50** = Normal/default behavior
- **0-49** = Decreases that attribute (e.g., lower QB accuracy = more incomplete passes)
- **51-100** = Increases that attribute (e.g., higher QB accuracy = more completions)

## Available Sliders

### Offense Sliders

| Slider | Default | Effect |
|--------|---------|--------|
| `qb_accuracy` | 50 | QB passing accuracy and completion percentage |
| `wr_catching` | 50 | WR/TE catching ability and route running effectiveness |
| `pass_blocking` | 50 | Offensive line pass protection (reduces sacks) |
| `run_blocking` | 50 | Offensive line run blocking effectiveness |
| `running_ability` | 50 | RB rushing effectiveness and base yards per carry |
| `fumble_frequency` | 50 | Offensive fumble rate (lower = more fumbles) |
| `offensive_penalties` | 50 | Offensive penalty frequency (lower = more penalties) |

### Defense Sliders

| Slider | Default | Effect |
|--------|---------|--------|
| `pass_defense` | 50 | Pass coverage effectiveness |
| `interceptions` | 50 | Interception frequency |
| `pass_rush` | 50 | Defensive pass rush / sack rate |
| `run_defense` | 50 | Run defense effectiveness |
| `tackling` | 50 | Tackling ability and assisted tackle frequency |
| `defensive_penalties` | 50 | Defensive penalty frequency (lower = more penalties) |
| `forced_fumbles` | 50 | Forced fumble frequency |

### Special Teams Sliders

| Slider | Default | Effect |
|--------|---------|--------|
| `kicking_power` | 50 | Kicker/punter power (affects FG range and punt distance) |
| `kicking_accuracy` | 50 | Kicker accuracy (PATs and field goals) |
| `punt_accuracy` | 50 | Punter accuracy (pinning, distance) |
| `kickoff_power` | 50 | Kickoff distance |
| `kickoff_return` | 50 | Kickoff return effectiveness and return TD chance |

### Game Play Sliders

| Slider | Default | Effect |
|--------|---------|--------|
| `game_speed` | 50 | Overall game tempo (affects time per play) |
| `injury_frequency` | 50 | Injury frequency (not yet implemented) |
| `home_field_advantage` | 50 | Home field advantage (not yet implemented) |

## Usage Examples

### Example 1: Adjust Sliders in Code

Edit `sim_game.py`:

```python
from start_game import simulate_full_game
from game_config import sliders

# Make QBs more accurate
sliders.qb_accuracy = 60

# Make pass defense weaker
sliders.pass_defense = 40

# Increase interceptions
sliders.interceptions = 70

# Make kicking more accurate
sliders.kicking_accuracy = 55

# Run simulation
simulate_full_game()
```

### Example 2: Create High-Scoring Games

```python
from start_game import simulate_full_game
from game_config import sliders

# Boost offense
sliders.qb_accuracy = 65
sliders.wr_catching = 65
sliders.running_ability = 65
sliders.run_blocking = 65

# Weaken defense
sliders.pass_defense = 35
sliders.run_defense = 35
sliders.interceptions = 30
sliders.pass_rush = 35

simulate_full_game()
```

### Example 3: Create Defensive Battles

```python
from start_game import simulate_full_game
from game_config import sliders

# Weaken offense
sliders.qb_accuracy = 40
sliders.wr_catching = 40
sliders.running_ability = 40

# Boost defense
sliders.pass_defense = 65
sliders.run_defense = 65
sliders.interceptions = 70
sliders.pass_rush = 65
sliders.tackling = 65

simulate_full_game()
```

### Example 4: Reduce Penalties

```python
from start_game import simulate_full_game
from game_config import sliders

# Higher values = fewer penalties
sliders.offensive_penalties = 80
sliders.defensive_penalties = 80

simulate_full_game()
```

### Example 5: Increase Chaos (More Fumbles, More Interceptions)

```python
from start_game import simulate_full_game
from game_config import sliders

# Lower fumble frequency = more fumbles
sliders.fumble_frequency = 30

# Higher interceptions = more picks
sliders.interceptions = 70
sliders.forced_fumbles = 70

simulate_full_game()
```

## Slider Math

The slider system uses these formulas:

### Normal Multiplier (for most sliders)
- **50** = 1.0x (normal)
- **0** = 0.5x (50% of normal)
- **100** = 1.5x (150% of normal)

### Inverse Multiplier (for penalties, fumbles)
- **50** = 1.0x (normal)
- **0** = 1.5x (150% - more frequent)
- **100** = 0.5x (50% - less frequent)

## Tips

1. **Start with small adjustments**: Try ±5-10 points first to see the effect
2. **Balance is key**: If you boost offense, consider boosting defense too for competitive games
3. **Test combinations**: Some sliders interact (e.g., pass blocking vs pass rush)
4. **Check the box score**: Run multiple simulations to see how sliders affect stats

## Future Enhancements

- UI slider interface (coming soon)
- Save/load slider presets
- Per-team slider adjustments
- Weather effects on sliders


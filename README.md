# Pocket College Football

A college football coaching career built on the real 2026 season: take one of 138 FBS schools through the season to
the playoff and the bowls, recruit your classes, run the offseason, and keep going season after season.

## Run it

```
python -m teamdata.build_teams     # once: builds data/engine_teams.json from the rosters in cfb_sim_data/
cd ui
npm install                        # once
npm run dev                        # the game on http://localhost:5173
```

`npm run dev` also starts the game's API (`tools/dev_server.py`, port 8000) and stops it when you quit. On Windows,
`run.bat` does the last step.

## What is where

- `ui/`: the app (React, Vite, TypeScript). `ui/PLAN.md` is its changelog and design rules.
- `app/api.py`: every route the app calls.
- `sim/`, `engine/`: the season and the play-by-play game.
- `coach_career/`: recruiting, the offseason, the coaching carousel, programs.
- `teamdata/`: builds the engine's teams from the source rosters; the game's rating scale.
- `data/`, `cfb_sim_data/`: the data the game reads.
- `tests/`: the engine's tests, plain scripts (`python tests/run_all.py`, or one file at a time).

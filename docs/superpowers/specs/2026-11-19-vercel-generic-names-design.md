# Branches, the Vercel Site and Generic Names

## Intent
Keep the two older builds, make the React app the main line, publish it on Vercel, and make sure nothing
published carries a name someone else owns, while the game run on a developer's computer keeps the real rosters.

## Goals
- `v0` is the old `main` (the `web/` site), `v1` is the old `clear-mode`; `main` is the React app (`ui-clear-mode`).
- A merge to `main` publishes the React app on Vercel.
- The published build swaps every real school, mascot, stadium, bowl, conference, trophy, award, player and coach.
  Colors stay except a small move on protected shades, and a
  person keeps their initials.

## Non-Goals
- No change to the engine, the season sim or `npm run dev`.
- No server on Vercel.

## Approaches
1. **The Python game in the browser (chosen).** Vercel hosts files only, so the game's dispatcher runs in a Web
   Worker under Pyodide, as the `v0` site did. Saves stay in the browser.
2. The Python server as Vercel functions. Rejected: the game holds a season and a running sim in memory, which
   functions lose between calls.
3. A separate host for the Python server. Rejected: a second service to run and pay for, and saves on a server.

For the names: swap them in a staged copy at build time (chosen) rather than filter the game's answers as they
leave. A filter on answers would still ship the real data file to every browser, and would need the reverse swap
on everything the page sends back.

## Design
- `tools/build_site.py` copies the game and `ui/` to a scratch folder, swaps names there when `--generic` (always
  on Vercel), builds the engine data from the copy, runs `vite build` with `VITE_GAME=browser`, and writes
  `ui/dist/` with `game.zip` and `version.json`.
- `ui/src/gameClient.ts`: `fetch` in dev, messages to `ui/public/worker.js` on the site.
- `tools/generic/tables.py`: the hand-written lookalikes. `scrub.py`: field edits, then one swap over every string
  (whole-string lookup, then whole-word phrases, longest first). `check.py`: finds real names left in a build.
- `tests/test_generic_names.py`: no real name in the staged build or in what the game says; the swapped game plays.
- `vercel.json`: install in `ui/`, build generic, serve `ui/dist`, every path falls back to `index.html`.

## Calls Made Along the Way
- No school keeps its real name, abbreviation, mascot or stadium. A school named for its state or city goes by its
  home town or the town's nickname (Texas is Austin, Houston is Space City); a school named for anything else gets
  a lookalike (Notre Dame is North Dome). A place name is swapped only in the fields that name a team, so states
  and cities keep theirs.
- Every team's slug follows its new name (the slug shows in the address bar).
- Coaches' alma maters outside the league are blanked; a last job outside the league reads without the employer.

## pocket-faces
The package is in the repository (`pocket-faces/`) and the app reads its source through an alias, so there is
nothing to install or build for it.

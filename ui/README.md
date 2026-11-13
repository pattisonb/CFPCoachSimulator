# New UI (React)

A React rewrite of the game's front end. The Python game (`app/`, `engine/`, `sim/`, `coach_career/`)
does not change; this folder replaces `web/` one screen at a time. The site map of every screen
to port is in the "CFP Coach Simulator Site Map" artifact.

Stack: React 18 + Vite 5 + TypeScript (strict), no router or state library yet.

## Run it

```
cd ui
npm install      # first time only
npm run dev      # the new UI on http://localhost:5173
```

`npm run dev` also starts the game's API (`python3 tools/dev_server.py` on port 8000) unless one is
already running, and stops it when you quit. Vite forwards every `/api/...` call to it, so the new
UI talks to the same game as the old one.

## Layout

- `src/main.tsx`: mounts the app
- `src/App.tsx`: the root component (for now a check that the game answers)
- `src/api.ts`: every call to the game goes through `api<T>(path, options)`
- `src/types.ts`: the shapes the game's API returns
- `src/styles.css`: global styles

## Formatting and linting

```
npm run format     # Prettier rewrites every file in place
npm run lint:css   # Stylelint (standard rules, BEM class names) checks the CSS
npm run check      # formatting, CSS lint and types, without changing anything
```

Run `npm run check` before committing. Editors with the Prettier and Stylelint extensions pick up
`.prettierrc.json` and `.stylelintrc.json` on their own.

## Build

`npm run typecheck` checks the types. `npm run build` type-checks, then writes a static site to `ui/dist/` with relative URLs. Running the game in the
browser on the static site (the Pyodide worker in `web/worker.js` and `game.zip`) is not wired up
yet. Do that before the new UI replaces `web/` in `tools/build_site.py`.

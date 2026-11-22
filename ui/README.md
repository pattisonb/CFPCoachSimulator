# The App (React)

The game's front end. The game itself (JavaScript: `app_js/`, `engine_js/`, `sim_js/`, `career_js/`, `teamdata_js/`)
runs in a Web Worker beside it (`public/worker.js`); there is no server.

Stack: React 18, Vite 5, TypeScript (strict). Routing is the app's own (`src/router.ts`); there is no state library.

## Run It

```
cd ui
npm install      # first time only
npm run dev      # the game on http://localhost:5173
```

`npm run dev` also serves the game the worker loads (`vite.config.ts`): the whole game as one script, made again when
a file of the game changes (the page reloads), and its data, built from the rosters the first time (some fifteen
seconds). There is no other process to start.

## Layout

- `src/main.tsx`: mounts the app.
- `src/App.tsx`: the root component; `src/router.ts` maps the path to a page in `src/pages/`.
- `src/components/`: one folder a component, with `index.tsx`, `index.css` and, when it has words, `messages.ts`.
- `src/api.ts`: every call to the game goes through `api<T>(path, options)`.
- `src/gameClient.ts`: the page's side of the worker. A call is a message, answered as a `Response`.
- `src/types.ts`: the shapes the game's API returns.
- `src/globals.css`: the design tokens and global styles.
- `public/worker.js`, `public/sim-worker.js`: the game's host in the browser and its helper workers.
- `game.entry.js`: what is bundled into `game.js`, the whole game as one script for the workers.
- `PLAN.md`: the design rules and the changelog. Add a row with every change.

## Formatting and Linting

```
npm run format     # Prettier rewrites every file in place
npm run lint:css   # Stylelint (standard rules, BEM class names) checks the CSS
npm run check      # formatting, CSS lint and types, without changing anything
```

The gate a pull request has to pass is the same three checks:

```
npx tsc --noEmit
npx stylelint "src/**/*.css"
npx prettier --check --end-of-line auto src
```

Editors with the Prettier and Stylelint extensions pick up `.prettierrc.json` and `.stylelintrc.json` on their own.

## Build

`npm run build` type-checks, then writes the app to `ui/dist/` with relative URLs. The built app still needs the game
beside it: `node tools/build_site.mjs` (from the repository's root) builds the whole site, the app and the game.

# The App (React)

The game's front end, in React. The game itself (JavaScript: `app_js/`, `engine_js/`, `sim_js/`, `career_js/`, `teamdata_js/`) runs in a Web Worker beside it (`public/worker.js`).

Stack: React 18 + Vite 5 + TypeScript (strict), no router or state library yet.

## Run it

```
cd ui
npm install      # first time only
npm run dev      # the game on http://localhost:5173
```

`npm run dev` also serves the game the worker loads (`vite.config.ts`): the whole game as one script, made again when
a file of the game changes, and its data, built from the rosters the first time (some fifteen seconds). There is no
other server to start.

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

`npm run typecheck` checks the types. `npm run build` type-checks, then writes the app to `ui/dist/` with relative URLs. The built app still needs the game beside it: `node tools/build_site.mjs` (from the repository's root) builds the whole site, the app and the game.

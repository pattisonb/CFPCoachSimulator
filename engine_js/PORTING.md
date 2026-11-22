# Working in the game's JavaScript

The game (`engine_js/`, `sim_js/`, `teamdata_js/`, `career_js/`, `app_js/`) was written in Python and moved to
JavaScript one file at a time. Each file was held to the Python's exact answers on real inputs before the Python was
deleted, so the same seed plays the same season it always did and a save made before the move still loads. There is
no Python left to compare with. This file says why the code looks the way it does and which of its habits still
matter. (It keeps its name because the game's files cite it.)

Two things depend on the rules below:

- **The same seed gives the same game.** `tests/test_sim_golden.mjs` holds two weeks of a career to a recorded
  result, `tests/test_play_log.mjs` prints five games' fingerprint, `tests/test_determinism.mjs` holds an offseason
  to its seed, and `tests/test_engine_js.mjs` checks the random numbers and the rounding underneath.
- **A saved career still loads and plays on.** A save is the season's state as JSON, written and read with the key
  order and number forms the code expects.

## Why the Code Looks Like Python

- **One file per Python file, with the Python's names.** `sim_js/polls.js` was `sim/polls.py`. Functions, dict keys
  and locals are snake_case, in the original order. Comments that cite a `.py` file or "the Python" are from the
  move; the JavaScript file of the same name is what they mean now.
- **Python's behavior comes from `engine_js/pyrt.js`.** It has Python's `random` (the Mersenne Twister, seeded from a
  number or from text as Python seeds it), `round`, `sum`, `sorted`, and the built-ins whose JavaScript namesakes
  differ. `engine_js/pystat.js` has the `statistics` module's exact `mean`, `fmean`, `median` and `pstdev`.
- **Data is plain JSON shapes.** Lists and tuples are arrays, dicts are plain objects (or an `odict`, below), sets
  are `Set`, `None` is `null`. A function that returned a tuple returns an array. Keyword arguments became
  positional ones; a caller that skips one passes `undefined`.

New code does not have to imitate Python. It does have to keep the rules below wherever a number can reach a
result or a save.

## Random Numbers

- Every draw comes from `pyrt.js`: the module-level `random` (the engine reseeds it for each game), or a `Random` of
  its own (`cfg.stat_rng`, `cfg.injury_rng`, `new Random("awards-11-2027")`). **Never `Math.random`.**
- **The order of draws is the game.** Adding, removing or reordering a draw on an existing stream changes every
  result after it. A draw inside `&&`/`||`, a `?:`, a `.map` or a `.some` happens only when that code runs: write the
  loop out when the order is not obvious.
- **New randomness gets its own stream**, seeded from text that names it (`_rng(state, "<name>")` in
  `sim_js/awards.js`, or ``new Random(`<name>-${seed}-...`)``), so it moves nothing that exists.
  `random.choices(pop, { weights: w })[0]` takes `weights`, `cumWeights` and `k`.
- Seed text is built with the same characters every time. A value inside it is written the way the file already writes it (the local
  `pystr` helpers write a missing value as `None`, as the seeds always have).

## Numbers

- **`round` is always `round` from `pyrt.js`** (halves go to the even neighbor; `Math.round` sends them up), with
  its second argument for decimals.
- **`sum` of a list is `sum` from `pyrt.js`**, which adds floats with a running correction. A plain `reduce` gives a
  different last digit.
- Keep an expression's shape: floating-point sums depend on their order. `floordiv(a, b)` and `mod(a, b)` are
  Python's `//` and `%` (they differ from JavaScript's for a negative left side); `int(x)` cuts toward zero.
- Averages and deviations that reach a result use `pystat.js`, not a hand-written mean.
- `Math.pow`, `Math.exp`, `Math.log`, `Math.sin` and `Math.cos` are the JavaScript engine's own and can differ from
  another machine's in the sixteenth digit. Do not store such a value where its last digit is compared exactly:
  round it, or compare with a margin. A whole-number power can be made exact (`pypow` in `career_js/recruits.js`).

## Sorting, Lookups and Truth

- `sorted(xs, f)` and `xs.sort((a, b) => cmp(f(a), f(b)))` sort by a key; an array key compares item by item. Both
  are stable. Swap `cmp`'s arguments for descending. `maxBy(xs, f)` and `minBy(xs, f)` return the first of equals.
  A plain `xs.sort()` compares as text and is wrong for numbers.
- `get(d, k, fallback)` is a dict's `.get`: a stored `null`, `0` or `false` comes back as it is. `d[k] ?? fallback`
  replaces a stored `null`, and `d[k] || fallback` replaces every falsy value: use them only when that is meant.
- An empty array or object is true in JavaScript. Test `xs.length`, or `truthy(v)` when the type is not known.
  `isNumber(v)` tells a number from anything else.
- Text for the page: `fmt(x, 1)` is one decimal, `title(s)` capitalizes each word.

## Dicts With Number-Like Keys

A JavaScript object lists keys that look like whole numbers ("401856766", "11", "3") first, in numeric order, whatever
order they were added in. Where such a dict is only looked up by key, a plain object is fine. Where it is walked
(looped over, turned into a list, searched for the first match, written out for a page), it must be an `odict` from
`pyrt.js`, which keeps the order keys were added in.

- `state["games"]` (keyed by event id) and `state["my_boxes"]` are odicts, and so is any dict built from them and
  then walked.
- A season read from its text is read with `parse_ordered(text, [["games"], ["my_boxes"]])`
  (`sim_js/season/part3.js`, `career_js/career.js`), never a bare `JSON.parse`.
- `get`, `in`, `Object.keys/values/entries`, `for...in`, `delete` and `JSON.stringify` work on an odict as on a
  plain object. `structuredClone` and `postMessage` do not: send its JSON text.

A new dict keyed by ids, weeks or years that will be walked needs the same care.

## Modules

- **A namespace object per file.** Each file exports one object named for it (`polls`, `season`, `recruiting`, `cfg`
  for `game_config.js`, `sit` for `situation.js`) that holds its functions, constants and module-level state.
  Constants and state live only on that object and are read through it, inside the file too (`cfg.MOMENTUM`,
  `season.FINAL_WEEK`), because a caller, a test or a tool may replace one.
- **Other files are reached through their namespace**, never by importing a function by name: the files depend on
  each other in circles. Import the namespace (`import { polls } from "./polls.js";`) where that does not make a
  cycle at load, and otherwise go through `modules` from `engine_js/modules.js` (`modules.season.load_teams()`),
  which is looked up when the call runs.
- **Every file registers itself** as its last line (`modules.polls = polls;`), and `app_js/game.js` imports every
  file so that all of them are registered before a host makes a call. A new file needs both.

## Big Files in Parts

`sim_js/season.js`, `career_js/recruiting.js`, `career_js/offseason.js` and `app_js/api.js` each load a folder of
parts (`season/part1.js` to `part6.js`) in order. Every part imports the one namespace object from `<name>_ns.js` and:

- defines its functions as local `function name(...)` and puts them on the namespace at the end of the part
  (`Object.assign(season, { name, ... })`);
- puts each constant and variable on the namespace where it is defined (`season.FINAL_WEEK = 20;`), since a later
  one, possibly in a later part, may be built from it;
- reaches every function and constant of its own file through the namespace, even one defined a line above
  (`season.load_teams()`): the parts cannot see each other's locals.

## Files

The game never touches `fs`, `fetch` or `localStorage`. It reads and writes through `engine_js/files.js`, and the
host says how (`set_reader`, `set_store`): the browser's worker keeps files in memory and saves in IndexedDB
(`ui/public/worker.js`), Node uses a folder (`tools/game_host.mjs`).

- A path is text from the repository's root, joined with "/" (`data/schedules.json`,
  `${season.SEASONS_DIR}/${id}.json`). An environment setting is `env.NAME` from `files.js`.
- `read_json(path)` parses a file once and keeps it; `read_text`, `write_text`, `exists`, `remove`, `remove_dir`,
  `list_dir` and `mtime` are the rest. A host without a file throws, and a caller that can do without it catches.
- A save is written with `JSON.stringify(state)`. Where the text itself is used (a cache key cut from it, its
  length, a hash, a recorded test result), it is `json_dumps` from `pyrt.js`, which writes separators and numbers
  as the saves and recorded results already have them.
- A new data file the game reads has to be in the data pack: add it to `DATA_FILES` in `tools/build_site.mjs`.

## Hosts, Time and Ids

- There are no processes or threads in the game. A week's games go through `season.play_jobs(jobs, on_result)`,
  which plays each with `_sim_one` from `sim_js/game_job.js`, in order; the browser's worker replaces it to share
  the games with its helpers, and a helper's result must be the same as the game's own.
- The clock and random ids (`new Date()`, `crypto.randomUUID()`) are used only for a save's id and its timestamps,
  never for anything a result depends on.

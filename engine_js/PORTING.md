# The engine in JavaScript

`engine_js/` is the game engine: the play-by-play sim of one game. It was `engine/` in Python and was ported file for
file, checked game for game against the Python it replaced (640 seeded games, every field of every result the same),
and the Python was then deleted. The rest of the game is being ported the same way, a piece at a time; until it is,
the Python that remains asks this engine for games through `sim/engine.py` (in the browser directly, on a computer
through a Node process running `bridge.mjs`), and `api.js` is what it can ask for.

What holds the engine to the results it had in Python: `tests/test_sim_golden.py` (two weeks of a career, every score
and stat line), `tests/test_play_log.py` (five games' fingerprint) and `tests/test_engine_js.py` (the random numbers
and the rounding underneath).

The rules below are how the port was written, and how the next pieces are: they are what kept the two identical.

## Rules (every one of them is about keeping the two identical)

1. **One file per Python file, the same names.** `engine/roster.py` is `engine_js/roster.js`. Functions, classes,
   methods, attributes, dict keys and local variables keep their Python names (snake_case), in the same order, so the
   two files can be read side by side. Keep the comments that explain why.
2. **A namespace object per module.** Each file exports one object named as below, holding everything the Python
   module has at module level (functions, classes, constants, and its mutable variables), plus named exports of the
   functions and classes. Module-level *variables and constants* live only on that object and are always read and
   written through it, inside the module too (`cfg.MOMENTUM = true`, `play_functions.last_play`).
   Other modules are always reached through their namespace object (`game_functions.apply_run_fatigue(...)`), never
   by importing a function by name: the modules import each other in circles.

   | Python | file | namespace |
   |---|---|---|
   | `game_config` (`cfg`) | `game_config.js` | `cfg` (its `sliders`, `stat_rng`, `injury_rng` are `cfg.sliders`, `cfg.stat_rng`, `cfg.injury_rng`) |
   | `personnel` | `personnel.js` | `personnel` |
   | `situation` (`sit`) | `situation.js` | `sit` |
   | `roster` | `roster.js` | `roster` |
   | `game_functions` | `game_functions.js` | `game_functions` |
   | `play_functions` | `play_functions.js` | `play_functions` |
   | `drive_functions` | `drive_functions.js` | `drive_functions` |
   | `game` | `game.js` | `game` |

3. **Random numbers come from `pyrt.js`, in the same order.** `random.random()`, `random.randint(a, b)`,
   `random.choice(xs)`, `random.gauss(mu, sigma)`, `random.uniform(a, b)`, `random.gammavariate(a, b)`,
   `random.seed(n)` on the `random` exported by `pyrt.js` (Python's module-level generator); `cfg.stat_rng` and
   `cfg.injury_rng` are `Random` instances from the same file. `random.choices(pop, weights=w, k=1)[0]` is
   `random.choices(pop, { weights: w })[0]` (options: `weights`, `cumWeights`, `k`). Never `Math.random`.
   **The order of draws is the game.** Python evaluates left to right, arguments before the call, and `and`/`or`
   short-circuit as `&&`/`||` do. A draw inside a comprehension, a generator, `any(...)`, `next(...)`, a default
   argument or a conditional expression must happen exactly when Python's does: write the loop out when in doubt.
4. **Arithmetic is written the same way.** Keep each expression's shape (no reordering, no simplifying: floating
   point sums depend on their order). `/` is true division in both. `//` is `floordiv(a, b)`, `%` with a possibly
   negative left side is `mod(a, b)`, `int(x)` is `int(x)` (toward zero), `x ** y` is `Math.pow(x, y)`,
   `abs`/`min`/`max` of numbers are `Math.abs`/`Math.min`/`Math.max`, `sum(xs)` is `sum(xs)` from `pyrt.js`.
   **`round` is always `round` from `pyrt.js`** (Python rounds halves to even; `Math.round` does not), with its
   second argument when Python has one.
5. **Sorting and picking the best.** `xs.sort(key=f)` is `xs.sort((a, b) => cmp(f(a), f(b)))`; a tuple key is an
   array key. `reverse=True` swaps the two arguments of `cmp`. `sorted(xs, key=f)` is `sorted(xs, f)`.
   `max(xs, key=f)` / `min(xs, key=f)` are `maxBy(xs, f)` / `minBy(xs, f)` (the first of equals, as Python's).
6. **None, missing and truth.** `None` is `null`. `d.get(k, default)` is `get(d, k, default)` (a stored `None` is
   returned as it is; `d[k] ?? default` is wrong when the value can be `None`, `0` or `False`... use `get`).
   `getattr(o, "x", default)` is `getattr(o, "x", default)`. An empty list or dict is false in Python and true in
   JavaScript: `if xs:` is `if (xs.length)`, `x or []` needs care, and `truthy(v)` is there when the type is not
   known. `isinstance(v, (int, float))` is `isNumber(v)`.
7. **Data shapes.** Lists are arrays, tuples are arrays, dicts are plain objects (their keys here are names), sets
   are `Set`. A function that returns a tuple returns an array. Keyword arguments become positional ones in the
   order of the Python signature; a caller that skips one passes `undefined` so the default applies.
   Team and player data come in as parsed JSON (the same dicts Python gets) and the result goes out as plain
   JSON-ready objects with the same keys.
8. **Text.** f-strings become template strings. `f"{x:.1f}"` is `fmt(x, 1)`. `s.title()` is `title(s)`.
   `print(...)` stays as `console.log(...)` under the same `verbose` test.
9. **Say what could not be written literally.** A check that tells an int from a float (`isinstance(x, int)`),
   iteration over a set (Python's order is by hash, JavaScript's by insertion), an exception used to steer
   (`try`/`except KeyError`, `StopIteration`), anything dynamic (`setattr`, `__dict__`, `getattr` by a computed
   name): port it the closest way and list it in the notes at the end of your work.

## Modules that are not ported yet

A ported file imports the namespaces of files that exist (`import { game_scale } from "../teamdata_js/game_scale.js";`)
and reaches one that does not exist yet through `engine_js/modules.js`: `modules.season.load_teams()`. Every ported
module registers its namespace there under its Python name as its last line (`modules.polls = polls;`), so the call
starts working when that module is ported. Folders: `engine/` is `engine_js/`, `sim/` is `sim_js/`, `teamdata/` is
`teamdata_js/`, `coach_career/` is `career_js/`, `app/` is `app_js/`.

Data files are read with `read_json("data/x.json")` from `engine_js/files.js` (a path from the project's root).
Generators seeded with text are `new Random(0)` then `.seed("text")`, or `new Random("text")`... the constructor takes
a whole number or text, as Python's does. `statistics.mean`, `pstdev`, `median`, `fmean` are in `engine_js/pystat.js`
(exact, as Python's are): never a plain floating-point average where Python used the module.

Each port is checked against the Python before it counts: a Python script that writes real inputs and Python's
answers as JSON, and a Node script that feeds the same inputs to the JavaScript and compares exactly, both kept in the
folder's `test/` so they can be rerun.

## Where Python and JavaScript cannot agree to the last digit

- **`sum` of floats** is `sum` from `pyrt.js`, which adds the way Python 3.12+ does (with a running correction). It is
  exact for a list of floats and for a list of whole numbers. A list that mixes Python ints and floats cannot be told
  apart here (3 and 3.0 are one number in JavaScript), and Python adds an int inside a float sum without the
  correction: where the Python sums such a mix, say so in the port's notes.
- **`x ** y`, `math.exp`, `math.log`, `math.sin`, `math.cos`** are the machine's math library in Python and the
  JavaScript engine's own here; about one result in fifteen differs in the sixteenth digit. A whole-number power can
  be made exact (`career_js/recruits.js` `pypow`); the others cannot. So `gauss` and `gammavariate` draw the same
  random numbers but can return a value one last digit off. Everything the game decides from such a value (a rounded
  yardage, a comparison with a random number, an order of teams) comes out the same unless the value sits exactly on
  the line, which no test has found; a value that is stored as it is (a coach's opinion of a team in the polls) can
  differ in its last digit, and a comparison of such values allows for that.

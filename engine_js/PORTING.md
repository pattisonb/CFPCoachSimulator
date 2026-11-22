# The engine in JavaScript: how the port is written

`engine_js/` is `engine/` (the Python play-by-play game sim) in JavaScript, file for file. It must play every game the
Python engine plays, number for number: `simulate_game(home, away, sliders, seed, venue, momentum)` with the same team
data and seed returns the same result. `tests/test_engine_js.py` compares the two.

The Python stays the reference. A change to `engine/*.py` is made in `engine_js/*.js` too, the same way.

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

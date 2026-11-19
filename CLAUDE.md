# CFP Coach Simulator: house rules for anyone editing this repo

## Copy and casing (the player's standing rules)
- **Titles, labels, tags, kickers, tab names, column headers, stat labels, chips and button labels are Title Case**: "Your Offer", "His List", "Blue Blood", "Tier 1", "Sim to Signing Day", "Advance to Keep Them Home", "DC Likes Him", "Not Offered". Never sentence case in those places ("Blue blood", "Not offered", "your 135" are wrong). Small words (a, an, the, of, to, for, and, or, in, on, at, by) stay lowercase inside a title unless first or last.
- **Sentences** (help text, toasts, scene lines, History lines, reasons) are ordinary sentences: capital first letter, a period, sentence case otherwise.
- **A value that starts with a word starts with a capital** ("He wants 105", not "wants 105").
- **American spelling everywhere** (favorite, color, defense, center).
- No numbers out of 100 for moods or chances where the game uses words; no "null"/"undefined"/"NaN" ever reaches the page.

## Engine
- `python3 tests/test_sim_golden.py` must stay byte-identical unless the change is to the season sim itself and the player agreed; recruiting reads, flags and scenes are never in the digest.
- New randomness goes into its own seeded stream (`_rng(state, "<name>")` or `random.Random(f"<name>-{seed}-...")`) appended after existing draws.
- Constants the player may want to tune are module-level, marked `*tune*`, with a one-line comment.

## Front end
- The app is `ui/` (React, Vite, TypeScript); the old `web/` UI is gone. `ui/PLAN.md` holds its design rules and its changelog (newest first): add a row with every change.
- Use the tokens in `ui/src/globals.css` and px spacing; a component is a folder with `index.tsx`, `index.css` and, when it has words, `messages.ts`. Reuse an existing component before making one; anything new is reusable.
- The gate is `npx tsc --noEmit`, `npx stylelint "src/**/*.css"` and `npx prettier --check --end-of-line auto src` in `ui/`. There are no browser tests: look at a change in the browser.
- Words only ever sit on a team color with its `--team-on` (black or white, whichever reads).

## Process
- Engine tests are plain scripts: `python3 tests/<file>.py`; the full suite is `python3 tests/run_all.py`. Keep testing light: run the tests that touch what changed, not the full suite, unless the player asks.
- The Python server does not reload: an engine change needs `npm run dev` restarted.
- Commits end with the session's two attribution trailer lines; no model identifiers in code or commits.
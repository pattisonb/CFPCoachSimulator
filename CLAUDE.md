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
- Actions patch in place (`window.CFP.ui`: toast, pulse, fadeIn, fadeOut, reconcile, busy, on, morph); a full redraw only on tab open, recruit switch, career change, week advance or offseason stage change. See `docs/HOW_IT_WORKS.md` "Smooth actions".
- Every URL relative; every control at least 44 px tall on a phone; `tests/test_spacing.py` and `tests/test_ux_sweep.py` are the gate.

## Process
- Tests are plain scripts: `python3 tests/<file>.py`; the full suite is `python3 tests/run_all.py`.
- Commits end with the session's two attribution trailer lines; no model identifiers in code or commits.

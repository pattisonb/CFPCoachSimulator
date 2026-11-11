# Custom Programs: Build and Edit Programs in the Game

**Status:** approved in conversation, November 11. This spec is for the player to review before the plan is written.

## Why

The league file (`docs/superpowers/specs/2026-11-05-league-file-design.md`) already lets a career start with added or changed teams, but only from a hand-written JSON file. The player wants to build those teams in the game:

- create a program to coach or to play against;
- edit a real program (rename, recolor, move it);
- download programs to share;
- tick saved programs into a new career.

## Decisions (the player's)

- **Name.** The page is **Custom Programs**, not "Team Builder", because EA uses that name for its own web tool. Its buttons are **Create a Program** and **Edit a Real Program**.
- **Both kinds.** Create a new program (with an optional hand-built roster) and edit a real one.
- **Several at once.** Build any number of programs. Download one or all as a league file.
- **Saved locally.** Every program saves in the browser automatically as **My Custom Programs**.
- **Into a new career.** The New Career screen lists your saved programs with checkboxes. Ticked ones join the league before you pick your team, so you can coach one.
- **A scheduling note.** When your choices change the league's shape, the summary says the schedule is generated fresh.

## Approach

The page writes the same `cfp-league/1` document the game already imports. It reuses the import's check, summary and Start Career, so the engine does not change.

Rejected:

- **Server-stored drafts.** These add storage and accounts for no gain.
- **Editing a career in progress.** The league file decided new careers only.

## The Page (`web/programs.html`, `web/programs.js`, `web/programs.css`)

- **Nav:** a third link, "Coach Career · Your Coach · **Custom Programs**".
- **List view:** your programs as cards, each with its pill, name, conference, and "New" or "Edits {Real Name}". Each card has Edit, Download and Delete.
- **List buttons:**
  - **Create a Program**
  - **Edit a Real Program**: a picker of every FBS team.
  - **Download All**: one league file.
  - **Load File**: a `.json` league file whose teams join the list. The `remove` list and conferences are kept too.

### The editor (one program), as cards

1. **Identity:**
   - Name (required), short name, abbreviation (3–4 letters) and mascot. The short name and abbreviation are suggested from the name until edited.
   - Primary, secondary and accent colors, with a live pill preview (`window.CFP.teamPill` with these colors).
2. **Home:**
   - City and state (a select of states).
   - Latitude and longitude, shown as "From the state's center" unless set.
3. **Program:**
   - **Conference** (required): any game conference, or **New Conference**, with a name and its conference games (8 or 9).
   - **Strength:** Elite, Strong, Average, Weak or a number 1–100. Blank means the conference average.
   - **Prestige:** a slider shown in `WORD_FLOORS` words. Blank means the conference average.
   - **Rivals:** a multi-pick of any team.
4. **Coaches:** head coach name and rating (1–99); OC and DC names; offense and defense playbooks from the game's lists. Blank means generated.
5. **Roster:** empty by default. "The game fills 85 players to your strength when the career starts."
   - **Add Player:** name, position and class, plus optional overall, stars, height, weight, hometown and jersey.
   - **Paste a List:** one player per line, as "Name, POS, CLASS".
   - **Fill the Rest:** the default. Your players are kept and the rest are generated at start.
   - Positions and classes are the league file's (`QB RB WR TE LT LG C RG RT LEDG DT REDG SAM MIKE WILL CB FS SS K P`; `FR SO JR SR` and their `RS` forms).
6. **Check Program:** sends a one-program league document to the existing `POST /api/league/check`. It shows the errors as sentences, or "Ready to use."

**Edit a Real Program** fills the editor from that team's current values in the game's league (the same data Export League writes). It saves as a replacement with the real slug. The program stores only the fields you changed, so untouched fields keep the real values. The roster is stored only if you edited it, and then it replaces the whole roster, as the league file says.

## Storage (`localStorage["cfp-custom-programs"]`)

- `{version: 1, programs: [{id, kind: "new"|"edit", base: slug|null, team: {...cfp-league/1 team fields}, conference: {...}|null, updated}]}`.
- Every edit saves in place, a moment after the change, with no redraw.
- If storage is unavailable or throws, the page works for the visit and says once: "Your browser isn't keeping these between visits. Download them to save."
- **Slugs:**
  - A new program's slug comes from its name.
  - A clash with a real team or another of your programs gets a suffix (`alder-tech-2`).
  - An Edit always uses the real slug. Two edits of one real team are refused ("You already have an edit of Akron.").

## The New Career Screen (`web/leaguefile.js`, `web/season.js`)

- The League panel gains **Custom Programs**: your saved programs with checkboxes, and a link to the Custom Programs page. With none saved, it shows "Build a program on the Custom Programs page." with the link.
- **Building the document:**
  - Ticking one or more builds one league document: the imported file if one is chosen, then your ticked programs merged on top by slug, then your new conferences.
  - It runs the existing check, showing the busy view, then the errors or the summary.
  - `LeagueFile.key()` and `teams()` then describe the merged league, so the team picker lists your programs and Start Career uses them.
- **The scheduling note.** When the check's result is structural (`structural`: a team added or removed, or a conference changed), the summary shows:

  > "Your custom programs change the league, so the 2026 schedule is generated fresh for every team: conference games by each conference's rules, your listed rivalries, and the rest filled in. The real 2026 schedule is used only when no team or conference changes."

  It does not show when you only rename or recolor real teams.

## Errors

- All errors are sentences naming the program, and the player when there is one. Each comes from the game's check, the builder's own checks (an empty name, no conference, a bad hex color, a duplicate edit), or a file that won't load ("That file isn't a league file: its format is not cfp-league/1.").
- **A saved program that no longer fits** (its conference is gone, or a rival was removed in a newer game) is flagged on its card ("Alder Tech: conference 'big-sky-e' is not in the game.") and can't be ticked until edited.

## House Rules

- Labels, buttons and chips are Title Case; messages are sentences.
- American spelling.
- No null or undefined on the page.
- Controls are 44 px tall on a phone.
- Relative URLs.
- Edits patch in place (`window.CFP.ui`).
- The built-in league, and so `tests/test_sim_golden.py`, is unchanged.

## Testing

- **Server** (no engine change; the existing check):
  - A program with only a name and conference passes.
  - An Edit of a real program with only a new name and colors keeps its roster and ratings.
  - Builder-shaped errors come back as sentences: a bad position, an unknown conference, a duplicate slug.
- **Browser** (`tests/test_custom_programs.py`):
  - Create a program, set its colors and add three players, then check it ("Ready to use.").
  - Download it and confirm the file is valid `cfp-league/1` with the three players.
  - Reload the page and the program is still listed.
  - Edit a real program (Akron) with a new name and colors.
  - Delete a program.
  - The no-storage message.
  - Run at 1280 and 400.
- **New Career** (`tests/test_custom_programs.py`):
  - Tick the new program and the Akron edit. The summary and the scheduling note show.
  - Pick the new program in the team picker and Start Career.
  - The Office shows your program's name and pill colors.
  - Ticking only the Akron rename shows no scheduling note.
- **Suite:** `tests/test_spacing.py` and `tests/test_ux_sweep.py` cover the new page. `python3 tests/run_all.py` passes, apart from failures that also fail on main.

## Not in Scope

- Uploading a logo image (the colored pill stands in).
- Editing a career in progress.
- Custom bowls or playoffs beyond what conferences imply.
- Sharing through the game's server (files only).

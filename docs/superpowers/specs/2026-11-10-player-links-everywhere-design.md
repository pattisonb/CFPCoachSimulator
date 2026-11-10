# Player links everywhere: every name opens his profile

**Status:** draft (November 10), not yet approved by the player. He asked: "anytime you see a player, you should
be able to click on the profile and see the profile", starting with the offseason's portal board.

## Today

Two profiles exist:

- **Prospect Profile** (recruits and portal entrants): `openProfile(s, pid)` (`web/recruiting.js`), modal token
  `profile:<pid>`, `GET /api/season/{id}/prospect/{pid}`. A portal entrant has a pid only while the portal is open.
- **Player page** (roster players): `openPlayer(team, name, position)` (`web/season.js`), token
  `player:<team>|<name>|<pos>`, `GET /api/season/{id}/player`. Any element with `data-player` (from `playerAttrs`)
  opens it through one document click handler, except inside a `<button>`.

The season's screens mostly link (stats, roster, awards, box scores, the recap, the depth chart). The gaps:

1. **The offseason: no name is clickable.** Departures, the First Round, Keep Them Home cards and answers, the
   Portal Board, Your Moves, Who Got Away, the Portal Recap, Development lists and Redshirts.
2. **The injury report** (yours and Around the League) and the box score's injury line.
3. **The Office's team leaders.**
4. **HQ widgets:** Position Battle Board, Senior Impact and Next Year returning players.
5. **The old Heisman hero and the finalists sentence**, and This Week's "Projected:" players (one text string).
6. **Class Rankings' top names** (inside the row's expand button).
7. Free text (scoring plays, drive lines, news text) and coaches. **Out of scope:** names inside sentences stay
   text, and there is no coach profile.

## The catch: the offseason reads last season

`/api/season/{id}/player` reads the season's teams file, which is rebuilt only when the offseason ends. In the
offseason it shows last year's roster and ratings, finds a transfer you signed only under his old team, misses
Development's gains and can miss a player whose position moved (it matches name and position).

**Fix (revised while planning, November 10):** rebuilding a single team's engine card from `state["league"]`
does not work (`teamdata.build_teams.build` fits league-wide steps and fails on one team; the league's attributes
are a different set from the engine's). So in the offseason the player page stays **last season's page** (his
ratings, stats, game log, honors: what he did), found by `slug` on any team, and adds a **Next Season** block from
`state["league"]`: his team now (a transfer under his new school), position, class and overall, or where he went
(the draft, graduated, the portal). The token gains the slug, `player:<team>|<name>|<pos>|<slug>`; the old three-part
token keeps working. A signee with no college season opens his Prospect Profile while the class is on file, and
otherwise shows only the Next Season block.

## The rule

- **One helper per profile, shared by every screen:** `playerAttrs(team, name, pos, slug)` for a roster player
  and a `prospectLink(pid, text)` that replaces the three local copies (`hq.js` `k.name`, `scouting.js`
  `nameLink`, the inline buttons in `recruiting.js` and `office.js`).
- **Which profile:** a portal entrant during the portal opens the Prospect Profile; anyone on a roster, or after the
  portal closes, opens the player page under his team now (a transfer under his new school).
- **A name inside a button** (Redshirt toggles, Class Rankings rows) gets its own link beside the button, never
  nested in it.
- **Smooth actions:** links are attributes or `ui.on` handlers, so `morph` keeps them through a patch and no
  action redraws the screen (`docs/HOW_IT_WORKS.md` "Smooth actions").
- **Tap targets:** a link is `.go-link` or `.plink`, focusable (a real link or button), at least 44 px tall on a
  phone where it sits alone in a row (`tests/test_spacing.py`).

## Phases

1. **The offseason** (the player's ask): the player page reads next year's roster by slug, then every offseason
   name links. Portal names open the Prospect Profile while the portal is open.
2. **The rest of the gaps:** injuries, the Office leaders, HQ widgets, Heisman and This Week's projection (split
   into names), Class Rankings' top names.
3. **One helper:** fold the local copies into the shared ones.

## Checks

- `tests/test_ux_sweep.py`: in each offseason stage, click a name and see the right profile open (Prospect Profile
  for an entrant during the portal, the player page otherwise) with his current team and ratings.
- `tests/test_deep_links.py`: the slug token reopens from the address; a gone slug closes quietly.
- `tests/test_spacing.py` and `tests/test_smoothness.py` stay green.

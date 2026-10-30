# Coach Career UI review, October 2026

How it was checked: I drove the real app in Playwright/Chromium at 1280 and 390 wide, in the dark and light
themes, and played a career: added prospects to the board, made an offer, sent a message,
turned on Auto-recruit, advanced a week, simmed to selection, opened profiles and Classes. I
looked at every screenshot and listened for page errors (none came up).

Priorities: **P0** breaks the way around or blocks a task; **P1** loses information or
looks broken; **P2** confuses people or reads badly; **P3** polish.
Status: **fixed** on branch `ui-review`, or **deferred**.

## P0

1. **Navigation disappears when you leave the Office** (fixed). *Where:* the Office tile grid
   (Recruiting, Prospects, Staff, Classes, Roster, Schedule, Polls & CFP, Stats, Awards) and the
   tab bar. *Why:* the tiles under your game week were the main way around, but they belonged to
   the Office, so they vanished on every other screen. The tab bar that stayed scrolled sideways
   on a phone, and the career tabs came last, so Recruiting, Prospects, Staff and Classes were
   out of sight. The active tab was often off screen too. The tiles and tabs also used different
   names for the same screens (Roster and Depth Chart, Polls & CFP and Rankings, Schedule and
   Team Schedule). *Fix:* a career now has one game-style tab bar (Barlow Condensed, team-color
   active state) above the header on every screen. The career screens come first. It wraps on a
   phone, so nothing scrolls out of sight, and it sticks under the top bar on a wide screen. The
   duplicate Office tiles are gone.
2. **The tab bar jumps between screens** (fixed). *Where:* the season header. *Why:* on the
   Office the header hid its sim buttons and week strip, and on other tabs it showed them. That
   moved the tab bar by about 80px on desktop and about 300px on a phone, so the target you had
   just tapped moved away. *Fix:* the tab bar now sits above the header, so it stays in one
   place. The week strip shows only on the season screens, where it does something.

## P1

3. **On a phone, the board's side panel ends up below every card** (fixed). *Why:* tapping a card
   "selects" him, but the panel with the pitch, the NIL offer and Pull offer was at the bottom of
   the page. It looked as if nothing happened. *Fix:* below 1100px the panel opens right under the
   selected card, with an outline.
4. **The side panel slides under the sticky top bar** (fixed). *Why:* the panel stuck at
   `top: 12px` while the top bar (114px) also sticks, so the panel's top was hidden as you
   scrolled. *Fix:* `--topbar-h` and `--sticky-top` are measured with a ResizeObserver, and the
   panel and the tab bar stop below them.
5. **The side panel can show someone you can't see** (fixed). *Why:* the selection survived a
   filter chip that hid him. *Fix:* if the selected prospect is filtered out, the first prospect
   shown is selected.
6. **On a phone, the Prospects rows lose their status and squash the rest** (fixed). *Why:* a
   later `.go-list-read` rule overrode the media query, so status (committed, uncommitted) and
   interest were hidden. "Not scouted" wrapped into a 38px column, and every row had a
   full-width red "+ Board" bar. *Fix:* status, interest and potential sit in a tag row under the
   name. The board button is compact, right-aligned and under the tags.
7. **Board action buttons cut off their labels** (fixed). "Message" overflowed its button on a
   270px card. *Fix:* tighter padding, a no-wrap label, and a smaller size.

## P2

8. **Duplicate progress during a multi-week sim** (fixed). The header bar and the overlay bar
   both said "Simming Week N · x%". *Fix:* only one bar shows at a time. The header bar is for a
   single week and the overlay bar is for a longer sim.
9. **"Game day" flashes on during a sim** (fixed). Redrawing the week strip each week turned the
   Game day button back on until the next poll. *Fix:* it stays hidden while the sim runs.
10. **Team accent text fails contrast** (fixed). Text in the team color (kickers, links, h3)
    used the accent, which was chosen for 2.6:1. For Ohio State on dark that is #666 on navy,
    about 3:1. *Fix:* `--accent-text` is now computed to 4.5:1 against the page and panel, and
    game-screen links use the text color with an accent underline.
11. **"Medium interest" and "close race" show in the team color** (fixed). The warn tone used
    the accent, so for red teams a neutral state looked like bad news. *Fix:* new `--go-warn` and
    `--go-warn-text` (amber, darker amber in light) for warn tags, standing text and bars.
12. **Board card names wrap ("George / Raphael")** (fixed). The stars took the width. *Fix:* the
    stars now sit under the name.
13. **Controls don't say what they do** (fixed). Message, Call, HC visit, Offer, Visit and
    Auto-recruit had no explanation, and a disabled action didn't say why. *Fix:* each has a
    tooltip with its cost and effect, or the reason it is off ("Needs 30 hours; 24 left", "once
    every 4 weeks"). The pitch panel says which actions use the pitch.
14. **The profile is a dead end** (fixed). You could add someone to your board but not recruit
    him from his profile. "Put a staff member on his area (Staff)" was plain text. *Fix:* the
    profile now has "Recruit him on your board →", which closes the profile and opens the board
    with him selected, and "Assign your staff →".
15. **Classes ranks you #1 with no commitments** (fixed). In the preseason the only row was
    yours, at "#1" with 0. *Fix:* the rank shows "—" with no commitments, plus an empty-state line.
16. **The pitch shows for a finished recruitment** (fixed). The panel offered pitches for a
    prospect already committed to you or signed. *Fix:* it is hidden then.
17. **Staff area picker cut off** ("Georgia-Carolinas · 533 prospe") (fixed). *Fix:* the option
    now reads "Georgia-Carolinas (533)" and the label says what the number is.
18. **"BYE WEEK" in selection week** (fixed). The postseason weeks without your game now say
    "No game this week", in the title and in the Game day step.
19. **Hover stays stuck on a phone** (fixed). A tapped tab kept its hover background, so it looked
    like a second active tab. *Fix:* the hover style applies only on `(hover: hover)` devices.

## P3 (deferred)

- On a phone the season header is long. The meta line runs on (coordinators, sim date, created
  date), and "0-0 Big Ten" wraps as "Big / Ten". A shorter meta line for careers would help.
- On a phone the tab bar is four rows (about 170px). It could become two groups with a "More" menu.
- The week strip's future weeks are faint in the light theme, close to 2:1. This is a shared
  season screen, so I left it alone.
- On a bye week the Office's This-week card leaves a large empty area on desktop.
- The Offers meter is filled in the team primary, so it reads as "danger" for red teams.
- On phones the sticky top bar is 186px, a fifth of the screen, on every screen. It is site-wide
  and outside this review's scope.
- The class rank looked surprising (8 commitments with two five-stars ranked #131). That is the
  model's scoring, not the UI. Worth a look by whoever owns `recruiting.py`.

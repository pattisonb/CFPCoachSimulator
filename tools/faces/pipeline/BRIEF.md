# Making pixel-art faces from roster headshots

A football game draws each player as a 48x48 pixel face built from a small set of parts. For each team you are given,
look at numbered sheets of the team's official roster headshots and choose the parts that best resemble each person.
You are only describing what is visible in each photo (hair, skin tone, beard, face width); the names come from the
roster, not from you.

Work dir: `W=/tmp/claude-0/-home-user-CFPCoachSimulator/cff90bb8-6355-5fad-b7f0-2367a0e9e7c7/scratchpad/faces`

## Per team (`$W/teams/<slug>/`)
1. First, once: Read `$W/catalog.png` (every part drawn, with its id under it) so you know what each id looks like.
2. Read every sheet in `sheets/` (`00.jpg`, `01.jpg`, ...). Each holds up to 16 photos; the yellow number on each is its
   index. `people.json` lists them in index order with name and position (the last few may be coaches).
3. Write `table.txt`: one line per index, 11 space-separated fields:

   `idx shape skin hairColor hair fade beard mouth eye nose ears`

   or `idx SKIP <reason>` when there is no usable face (blank tile, "NO PHOTO", a logo or silhouette placeholder,
   a helmet covering the face, not a person).
4. Run `python3 $W/code/finalize.py $W <slug>`. Fix any errors it prints and rerun until it prints `OK`.
5. Read `compare.png` (photo beside sprite) for the FIRST team only, to calibrate; fix anything clearly off and rerun.
   For later teams skip this unless something worried you.

Every index needs a line. Do not touch anything outside `teams/<slug>/table.txt`. Do not use subagents.

## Fields
- **shape** `00`-`07`: `00 01 02` narrow, `03 04 05` medium, `06 07` wide. Go by the face in the photo; linemen
  (OL, C, LT, LG, RG, RT, DT, DL) usually `05`-`07`, backs and receivers usually `00`-`04`.
- **skin**: `porcelain` (very pale/pink), `light`, `tan`, `brown`, `dark`, `deep` (darkest). Judge the face, allowing for lighting.
- **hairColor**: `black darkbrown brown blond red auburn`. No gray exists: for gray or white hair use `black` (dark gray)
  or `blond` (white/silver), whichever is closer.
- **hair** (`-` = bald or shaved to the skin):
  - `09` crew cut (very short, tight), `00` short crop, `06` round crop (short rounded/short afro), `05` receding
  - `02` messy top, `14` brushed back, `25` quiff (up at the front), `26` textured fringe (short, forward), `03` swept fringe,
    `07` side part, `08` side part (other side), `11` swept part, `01` volume top (big, full), `17` wavy (thick, wavy), `12` shaggy
  - `23` curly top (curls / twists / short afro with height / short locs on top), `24` locs (long locs, braids or twists
    that hang past the ears), `27` bowl cut, `10` long straight (past the shoulders), `04` mullet, `20` man bun (bun or top knot), `19` mohawk
- **fade** `1` when the sides are clearly shorter/faded than the top, else `0` (ignored on styles without one).
- **beard**: `-` none or light stubble; `01` full beard; `02` moustache only; `03` chin beard (hair on the chin only);
  `04` goatee (moustache joined to chin beard). Only mark a beard that is clearly visible.
- **mouth**: `00` smile (teeth showing), `01` straight/neutral, `02` small closed, `03` smirk (closed-mouth smile). Never `04`.
- **eye**: `brown dark hazel green blue gray`. Use `dark` or `brown` when you cannot tell.
- **nose**: `00` straight (default), `01` nostrils, `02` crooked, `03` button (small), `04` broad.
- **ears**: `00` standard (default), `01` flat, `02` round, `03` big / sticking out.

Example lines:
```
0 04 light brown 02 0 - 00 brown 00 00
1 01 brown black 23 1 - 01 dark 04 00
2 05 dark black - 0 01 01 dark 04 00
3 SKIP placeholder silhouette
```

## Report back
One line per team: `<slug>: OK n players, n coaches, n skipped` (the finalize output), plus anything odd (photos that
were not headshots, sheets that would not load). Nothing else.

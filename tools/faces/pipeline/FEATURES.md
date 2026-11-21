# Noting what the pixel faces cannot show

A football game draws each player and coach as a small pixel face built from a fixed set of parts, already chosen from
these headshots. The part set is limited. Your job: look at the same photos again and note, per person, the visible
features the parts CANNOT draw, so the artist knows what to add and who to update later. You are describing what is
visible in each photo only.

Work dir: `W=/tmp/claude-0/-home-user-CFPCoachSimulator/cff90bb8-6355-5fad-b7f0-2367a0e9e7c7/scratchpad/faces`
You are given a batch number N. `python3 -c "import json;print(' '.join(json.load(open('$W/featbatches.json'))[N]))"` lists your folders.

## Per folder (`$W/teams/<folder>/`)
1. Read every sheet in `feat/` (`00.jpg`, `01.jpg`, ...). Each holds up to 25 photos; the yellow number on each tile is
   that person's index (indexes are not consecutive: some people have no tile).
2. Write `features.txt` in the folder: one line for each person who has at least one feature below, as
   `idx tag tag ...` (space-separated tags). People with nothing to note get NO line. An empty file is fine.

What the parts CAN already draw (do not note these): six skin tones; hair colors black, dark brown, brown, blond, red,
auburn; short crops, crew cuts, fades, side parts, quiffs, messy/wavy/shaggy tops, curly tops, short afros, long locs,
long straight hair, mullets, man buns, mohawks, bald; a full beard, a moustache, a chin beard, a goatee; clean shaven.

## Tags (use exactly these words)
- Hair color: `gray_hair` (mostly gray), `white_hair`, `salt_pepper` (dark hair with clear gray in it), `gray_beard`
  (beard grayer than the hair), `dyed_hair` (bleached, colored or two-tone hair or loc tips).
- Hair shape: `balding` (receding to a bald crown, or hair only at the sides), `cornrows` (tight braids flat to the
  scalp), `braids` (box braids or plaits, not locs), `large_afro` (wide and tall), `long_curly` (long loose curls or
  waves past the ears, not locs), `ponytail`.
- Face hair: `stubble` (visible short stubble, no full beard), `thin_moustache` (a faint or pencil moustache),
  `chinstrap` (a thin line of beard along the jaw), `long_beard` (well below the chin), `sideburns`.
- Worn: `glasses`, `sunglasses`, `headwear` (cap, visor, beanie, durag, hood or wide headband hiding most of the hair),
  `headband` (a band with the hair still visible), `earrings`, `nose_ring`.
- Skin: `neck_tattoo`, `face_tattoo`, `freckles`.
- Anything else the parts clearly cannot show and an artist would want: `other:<two_or_three_words_joined_by_underscores>`.

Only tag what is clearly visible; when unsure, leave it out. Most players will have no line or just one or two tags.
Do not write anything outside `teams/<folder>/features.txt`. Do not use subagents.

## Report back
One line: how many folders done and how many people tagged, then the five most common tags you used with rough counts.

# Changelog

## 0.3.0

### Fixed
- **Random faces no longer make a blackface caricature.** 0.2 drew hair colour independently of skin tone, and
  moved a colour too close to the skin on to the next in the list, which for dark skin was blond: half of all
  deep-skinned faces were blond, and one face in 21 had dark skin with a blond or red beard round the mouth.
  Hair colour is now drawn from each skin tone's own weighted list (`skinTones[].hair`). Brown, dark and deep
  skin get black and dark brown only. A face can still be given any colour by hand.
- **The full beard fits the wide faces.** It was drawn once, on a narrow face, and stretched. Wide 1 and Wide 2
  have their own drawings that follow the jaw.

### Added
- **Gray hair, for coaches only:** `random(id, { group: "coach" })`. `options()` and `catalog()` take the same
  option and list gray only with it. `hairColors[].groups` and `.chance` in the data.

### Changed
- **Red is a copper** (188, 94, 42), not a lipstick red: a red goatee read as lips.
- `random(id)` gives different faces than 0.2 for the same id; stored face JSON is unaffected.

## 0.2.0

### Added
- **Hairstyles:** `hair_23` Curly top, `hair_24` Locs, `hair_25` Quiff, `hair_26` Textured fringe, `hair_27` Bowl cut.
- **Hair colour:** `auburn`.
- **Fades:** a new `hair fade` role (`f`) and a `fade` colour on each hair colour. A face's `hairFade: true`
  draws a style's temples in the lighter stroke. 18 styles have one.
- **Flips:** a face's `flip` list (`hair`, `beard`, `nose`, `mouth`) mirrors those layers. Only asymmetric parts
  change (`asymmetric: true` in the data).
- **Brows** are their own layer (`brows_00`) and take the hair colour.
- **Names** for every part (`label`) and category (`label`). `catalog()` returns them, grouped for a customiser.
- **`repair(json)`** loads a save that names removed ids, `canFade` / `canFlip` say when a toggle would change
  a face, and `faceFields(data)` lists the face's JSON fields.
- **Data-driven fields:** each category declares its JSON `field`, `label`, `optional` and random `chance`, so a
  new category needs no code changes.
- **Parts that random faces never pick** (`random: false`), starting with the frown.

### Changed
- `random(id)` gives different faces than 0.1 for the same id; stored face JSON is unaffected.
- The face JSON's fields follow the layers: `faceShape`, `skinTone`, `hairColor`, `eyeColor`, each part, then
  `hairFade` and `flip`.
- `FaceJSON` and `FaceOptions` are interfaces keyed by field.
- **Art fixes:**
  - The chin dimple sits on each chin's last row.
  - Beards and long hair end at each jaw's line.
  - Facial hair covers a mouth corner that strays into it.
  - Wavy, Brushed back and Man bun sit a pixel lower.
  - The Bowl cut's sides taper.
  - The Mullet's outline is unbroken.

### Removed
- The `gray` hair colour. `parse` rejects it; `repair` turns it into `black`.
- `FACE_FIELDS` (use `faceFields(data)`), and `BALD_CHANCE`, `BEARD_CHANCE`, `CHIN_CHANCE` (now each category's
  `chance` in the data).

## 0.1.0

First release: 8 face shapes, 17 hairstyles, 4 beards, 5 noses, 5 mouths, 4 ears, a chin dimple, 6 skin
tones, 6 hair colours and 6 eye colours; `createFaces` with `random`, `parse`, `validate`, `resolve`,
`options`, `pixels`, `draw`, `canvas` and `dataURL`.

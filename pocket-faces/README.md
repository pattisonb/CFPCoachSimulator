# pocket-faces v0.2

48x48 pixel-art faces built from layers. Each player's look is stored as one small JSON object, and a player id
can always generate the same face. There are no dependencies and no UI: you get the layers (in `faces.json`), a
compositor, drawing helpers for canvas, and a catalog of every option with its name for building your own customiser.

```ts
import { createFaces } from "pocket-faces";
import data from "pocket-faces/data";

const faces = createFaces(data);

const look = faces.random("player-7");          // a face from an id
faces.draw(ctx, look, 100, 40, { scale: 3 });   // into your game's canvas, pixel-sharp
img.src = faces.dataURL(look, { scale: 4 });    // or as an image
db.save(player.id, JSON.stringify(look));       // what you store
const back = faces.parse(db.load(player.id));   // read back, every id checked
```

New in 0.2: five hairstyles, hair fades, flipped parts, brows in the hair colour, names for every part,
`catalog()` for customisers, and `repair()` for old saves. See [Upgrading from 0.1](#upgrading-from-01) and
`CHANGELOG.md`.

## Install

Pick one:

- Point `npm install` at the package folder: `npm install ../sprite-test/packages/pocket-faces`.
- Pack it and copy the tarball: run `npm pack` here, then `npm install ./pocket-faces-0.2.0.tgz` in your app.
- Copy `src/` into your project as plain TypeScript, and import `src/index.ts` and `src/data.ts`.

`dist/` is built and committed, so the first two options need no build step. The package is ESM. It works with
Vite, Next.js, webpack, esbuild, and in a plain `<script type="module">` (see `examples/index.html`).

## The face JSON

A face is one flat object. Each field holds an id from the data, and `null` means "none".

```json
{
  "faceShape": "face_shape_07",
  "skinTone": "brown",
  "hairColor": "blond",
  "eyeColor": "brown",
  "ears": "ears_02",
  "chin": "chin_01",
  "nose": "nose_01",
  "beard": null,
  "mouth": "mouth_00",
  "brows": "brows_00",
  "hair": "hair_25",
  "hairFade": true,
  "flip": []
}
```

| Field | Ids (v0.2) | `null` allowed | If left out |
|---|---|---|---|
| `faceShape` | `face_shape_00`–`02` (narrow), `03`–`05` (medium), `06`–`07` (wide) | no | required |
| `skinTone` | `porcelain` `light` `tan` `brown` `dark` `deep` | no | required |
| `hairColor` | `black` `darkbrown` `brown` `blond` `red` `auburn` | no | required (it also colours the beard and brows) |
| `eyeColor` | `brown` `dark` `hazel` `green` `blue` `gray` | no | `brown` |
| `ears` | `ears_00`–`ears_03` | no | `ears_00` |
| `chin` | `chin_01` (a dimple) | yes | none |
| `nose` | `nose_00`–`nose_04` | no | `nose_00` |
| `beard` | `beard_01`–`beard_04` | yes | none |
| `mouth` | `mouth_00`–`mouth_04` (`mouth_04`, the frown, is never picked at random) | no | `mouth_00` |
| `brows` | `brows_00` | no | `brows_00` |
| `hair` | `hair_00`–`hair_12`, `hair_14`, `hair_17`, `hair_19`, `hair_20`, `hair_23`–`hair_27` | yes (bald) | bald |
| `hairFade` | `true` / `false` | no | `false` |
| `flip` | a list of `hair` `beard` `nose` `mouth` | no | `[]` |

- **Lists and validation.** At runtime, `faces.catalog()` lists every option with its name and
  `faces.options()` lists the bare ids. `face.schema.json` is a JSON Schema of the same lists, for checking saves
  on a server.
- **Ids are names, not positions.** A gap such as `hair_13` is a removed style; the other styles keep their ids.
- **`random()`, `parse()` and `resolve()` return every field.** Store that object. A smaller object also
  loads, with the defaults in the table filled in.
- **`hairFade` and `flip` only apply where they change something.** `hairFade` affects only styles that have a
  fade, and `flip` affects only parts that aren't symmetric. The returned JSON reflects this: a fade on a style
  without one comes back `false`, and the flip of a symmetric part is dropped. To show a toggle only when it
  does something, use `canFade(face)` and `canFlip(face, "mouth")`.
- **Bad ids.** `faces.parse(json)` throws an error naming every bad field, for example
  `hair: "hair_99" is not one of null, hair_00, ...`. `faces.validate(json)` returns those messages as a list
  instead (`[]` when the face is fine). `faces.repair(json)` fixes the bad fields instead of failing. A face is
  never drawn with a missing part.
- **Field order doesn't matter.** Unknown fields are ignored, so you can keep the face inside a bigger player object.

### Random faces and seeds

`random(id)` always gives the same face for the same id **with the same data**. Adding, removing or reordering
parts changes which face an id rolls, so 0.2 rolls different faces than 0.1 did. Treat the stored JSON as the
player's face, and use the id only to create a face the first time.

Random faces never pick a part marked `random: false` (the frown), or a hair colour that's too close to the skin
tone. When random picks a style with a fade it fades it half the time, and it flips each asymmetric part half
the time.

## The API

`createFaces(data, { cacheSize = 512 })` returns:

| | |
|---|---|
| `random(idOrSeed)` | Face JSON from a string id, or from a 32-bit number seed. |
| `parse(json)` | A JSON string or object to face JSON, checked. Throws on a bad id. |
| `validate(json)` | A `string[]` of problems, `[]` if the face is fine. |
| `repair(json)` | `{ face, fixed }`: each bad field replaced by its first option (an optional part becomes none), plus a line per change. |
| `resolve(spec)` | Any partial spec to the full face JSON. |
| `catalog()` | Every option grouped for a customiser: `{ field, label, category?, nullable, flip?, choices: [{ id, label, rgb? }] }`. Colours include their RGB, for swatches. |
| `options()` | The bare values per field, with `null` first where it's allowed. |
| `canFade(face)`, `canFlip(face, category)` | Whether the toggle would change this face. |
| `pixels(spec)` | `Uint8ClampedArray` RGBA, 48 x 48 x 4. Needs no DOM, so it works on a server, in tests, or for WebGL/Pixi/Phaser textures. |
| `draw(ctx, spec, x, y, { scale, crop })` | Draws the face into a 2D context at a whole-number scale, with smoothing off. |
| `canvas(spec, { scale, crop })` | A new `<canvas>` with the face on it. |
| `dataURL(spec, { scale, crop })` | A PNG data URL. |
| `cropBox`, `size` | `cropBox` is the area faces use (`crop: true`, the default); `size` is 48. |

Each face is composited once and cached, so redrawing a whole roster every frame is fine. `draw`, `canvas` and
`dataURL` need a browser, or a worker with `OffscreenCanvas`.

The building blocks are exported too: `randomFace`, `composite`, `resolveFace`, `parseFace`, `repairFace`,
`faceFields`, `FaceCache`, `seedOf` (FNV-1a) and `mulberry32`.

### A customiser in a few lines

```ts
for (const entry of faces.catalog()) {
  // entry.label: "Hair"; entry.field: "hair"; entry.choices: [{ id: null, label: "None" }, { id: "hair_25", label: "Quiff" }, ...]
  addPicker(entry.label, entry.choices, face[entry.field], (id) => (face = faces.resolve({ ...face, [entry.field]: id })));
  if (entry.field === "hair" && faces.canFade(face)) addToggle("Fade", face.hairFade, (on) => (face = faces.resolve({ ...face, hairFade: on })));
  if (entry.flip && faces.canFlip(face, entry.category!)) addToggle("Flip", face.flip.includes(entry.category!), /* add or remove it from face.flip */);
}
```

`examples/index.html` builds a working version of this. New parts and categories show up in it with no code change.

## Upgrading from 0.1

1. **Install 0.2** the same way you installed 0.1: re-run `npm install` on the folder, install the new tarball,
   or copy `src/` again.
2. **Nothing in the API was removed.** `createFaces`, `random`, `parse`, `validate`, `resolve`, `options`,
   `pixels`, `draw`, `canvas` and `dataURL` work as before. You'll get the new art and features with no code
   changes.
3. **Saved faces from 0.1 load.** The new fields (`brows`, `hairFade`, `flip`) take their defaults, so an old
   face keeps its parts and colours, with its brows now in its hair colour (and the art fixes in `CHANGELOG.md`). The one exception is gray hair, which was
   removed in 0.2: `parse` rejects a save with `"hairColor": "gray"`. Load saves with `repair` to fix those:

   ```ts
   const { face, fixed } = faces.repair(saved);   // gray hair becomes black, and `fixed` says so
   if (fixed.length) db.save(player.id, JSON.stringify(face));   // store the fixed face
   ```
4. **Expect different faces from `random(id)`.** The same id now rolls a different face than in 0.1, because
   the parts and the draws changed. If you stored the JSON, nothing changes for existing players. If you only
   stored ids, save each player's `random(id)` from 0.1 before upgrading, or accept the new faces.
5. **Using the new features:**
   - New hairstyles (Curly top, Locs, Quiff, Textured fringe, Bowl cut) and auburn hair: they're in the data.
     A customiser built from `catalog()` lists them; a hard-coded list of ids needs them added.
   - Fades: set `hairFade: true`. Show the toggle only when `canFade(face)` is true.
   - Flips: add the category to `flip`, for example `flip: ["hair", "mouth"]`. Show the toggle only when
     `canFlip(face, category)` is true.
   - Names: use `catalog()` to show "Quiff" instead of `hair_25`.
6. **TypeScript changes:**
   - `FaceJSON` is now an interface with a field per category rather than a fixed set of keys, and its field order
     follows the layers (`faceShape`, `skinTone`, `hairColor`, `eyeColor`, then each part, then `hairFade` and `flip`).
   - `FaceOptions` gained `brows`, `hairFade` and `flip`.
   - `FACE_FIELDS` and the `BALD_CHANCE`, `BEARD_CHANCE` and `CHIN_CHANCE` constants are gone. Use
     `faceFields(data)` instead of `FACE_FIELDS`. The chances now live in the data (each category's `chance`).
7. **Validating on a server?** Replace your copy of `face.schema.json` with the new one.

## How a face is built (the layers)

`faces.json` holds every layer. Each part is a 48x48 grid: 48 strings of 48 characters, one character per pixel.
A character is a **role**, not a colour:

| Code | Role | Becomes |
|---|---|---|
| `.` | clear | nothing (the layer below shows through) |
| `s` | skin | the skin tone's `skin` |
| `d` | skin shadow | the skin tone's `skinShadow` (outline, nose, shading) |
| `b` | black | black. On hair, beard and brow layers, the hair colour's `black` instead. |
| `g` | hair shade | the hair colour's `shade` (strands in hair and beards) |
| `f` | hair fade | the hair colour's `black` normally; its `fade` (a lighter stroke) when `hairFade` is on |
| `w` | white | white (eyes, teeth) |
| `i` | iris | the eye colour |

Layers stack bottom to top in `data.order`: face shape, ears, chin, nose, beard, mouth, brows, hair. Each opaque
pixel covers what's under it, and nothing is blended or scaled. On top of that:

1. **Width parts fit the head.** Hair, beards, ears and chins follow the sides of the head, so each carries
   one grid per face shape (`variants["face_shape_06"]`). Use the variant for the face's shape.
2. **Facial hair covers stray mouth corners.** The mouth layer is marked `onHair: "under"`: where its black lands
   on a beard pixel, it isn't drawn. Beards are drawn around the mouth, so this only hides a corner that strays
   into the beard, like a smirk's.
3. **Flips mirror about the middle.** A category in the face's `flip` that allows it (`categories[c].flip`)
   reads its part mirrored: the pixel at x comes from x' = 2 × `axis` − x.
4. **Hair keeps a visible edge.** `data.lowContrast` lists skin tone and hair colour pairs that are too close to
   tell apart. For those pairs, every hair-coloured pixel touching skin (left, right, up or down) takes that
   pair's `edge` colour.

That's the whole format. To port it to Swift, C# or GDScript, read `faces.json` and follow those steps;
`composite` in `src/face.ts` is about 70 lines to copy. To get the same random faces, also port `seedOf`,
`mulberry32` and the draw order documented on `randomFace`.

## Adding content

The package reads everything from the data, so new art needs no code changes:

- **A new part** (a hairstyle, a nose) becomes a new id. It appears in `catalog()`, `options()`, the schema and
  random faces.
- **A new category** (say, glasses) is an entry in `parts.json` with its `field`, `label`, `optional` and
  `chance`, placed in `order`. Faces gain that field, and `catalog()` gains a group for it.
- **A part only for hand-made faces** goes in its category's `notRandom` list.

The art lives in the sprite-test repo (see `art/README.md` there). After changing it:

```
python3 tools/build_faces.py fit && python3 tools/build_faces.py build   # the art → art/manifest.json
npm run faces:pack                                                        # → this package's faces.json, data.ts, schema, dist/
npm run test:facekit                                                      # golden faces + this package's tests
```

Bump `version` in `package.json` (and `VERSION` in `src/index.ts`) when you ship new art. Add ids rather than
renaming them, and list removals in `CHANGELOG.md` so apps know to `repair` saves.

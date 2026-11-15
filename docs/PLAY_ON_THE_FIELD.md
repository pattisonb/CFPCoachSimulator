# Play It on the Field: sending a team to Pocket Franchise

A handoff from the Pocket Franchise session. **The task:** add a **Play It on the Field** button that opens
Pocket Franchise's practice field with this season's team lined up against this week's opponent. Each team
plays to its current skills, wears its own uniform, and keeps the faces it has on the depth chart.

Nothing on the Pocket Franchise side needs to change. It's live on `main` and deployed.

## Where to send it

Open one link in a new tab:

```
https://pocket-franchise.vercel.app/play#roster=<payload>
```

- **`<payload>`:** the JSON below, compressed with **raw DEFLATE** (no zlib header) and encoded as
  **base64url** with no `=` padding.
- **Use `#roster=`, not `?roster=`.** The fragment never reaches a server, so there's no upload or API to call.
- **Testing locally:** run Pocket Franchise with `npm run dev` in `~/Projects/sprite-test` (port 3000), then
  use `http://localhost:3000/play#roster=…`.
- **The full contract** is `~/Projects/sprite-test/docs/roster-link.md`. The reader that checks every field
  is `~/Projects/sprite-test/lib/game/roster-link.ts`.

## What the page does with it

1. Reads the link once and clears it from the address bar.
2. Fills its 22 positions from each team's depth chart.
3. Turns the defense on, so Enter snaps.
4. Shows a "**Georgia vs Alabama** loaded from a link" banner with **Keep** and **Undo**.

You play the offense's quarterback.

## The JSON

```jsonc
{
  "v": 1,
  "offense": Team,   // required: your team
  "defense": Team    // optional: this week's opponent
}
```

**Team**

| Field | Required | What it is |
|---|---|---|
| `slug` | yes | The team slug, e.g. `alabama` |
| `name` | yes | The short name shown in the banner and on cards (`Alabama`) |
| `depth` | yes | Role → player slugs, starter first. Engine roles (`QB RB WR TE OL DL MLB LOLB ROLB CB S`) and EA roles (`HB LT LG C RG RT LEDG DT REDG SAM MIKE WILL FS SS`) both work |
| `players` | yes | The whole roster (up to 130). The depth chart chooses who starts |
| `colors` | recommended | `{ "primary", "secondary", "accent" }`, as `#rrggbb` or `{ "hex": "#rrggbb" }`. The four uniforms are worked out from these |
| `uniforms` | no | Exact colors for parts that differ from the worked-out ones (see Uniforms) |
| `wear` | no | `home`, `away`, `alt` or `rush`. Default: home for the offense, away for the defense |
| `abbr` | no | `BAMA` |

**Player**

| Field | Required | What it is |
|---|---|---|
| `slug` | yes | Unique in the link. It also seeds his face, the same way `web/depth/portraits.js` does |
| `name` | yes | |
| `skills` | yes | **`p["skills"]` as is.** It's the 54 skills in `game_scale.keys()` order, which is exactly the order the link expects (checked) |
| `pos` | yes | `p.get("role") or p["position"]` |
| `jersey` | recommended | Number 0–99 |
| `h`, `w` | recommended | `height_in` and `weight`. They shape his sprite |
| `cls`, `arch`, `dev`, `ovr` | no | Class, archetype, dev trait, overall. Shown on his card only |
| `abilities` | no | `[[name, tier], …]`, earned ones only. Shown on his card only; the field doesn't play to them |
| `skin` | sent | `["#base", "#shade"]`: his skin tone and its shade, from his `face` (the pocket-faces palette) |
| `face` | sent | **New: the field doesn't read it yet.** His pocket-faces face (the 0.2 schema, `pocket-faces/face.schema.json`): `faceShape`, `skinTone`, `hairColor`, `eyeColor`, the parts, `hairFade`, `flip`. The new UI's face for him, Edit Player Look's when a coach changed it |

Send the **current** skills: after development, with god-mode edits. `team_data(state, slug)` already merges
the edits through `with_edits`.

## What to build

### 1. An API route in `app/api.py`

Put it beside the depth chart routes:

```python
@route("GET", "/api/season/{season_id}/playlink/{slug}")
def season_playlink(p: Params) -> dict:
    """One team in a Pocket Franchise roster link's shape (docs/PLAY_ON_THE_FIELD.md)."""
```

Build it from what the depth chart already uses:

- **The team:** `apply_depth(team_data(state, slug), overrides)`, with `overrides` as in `depth_chart_view`.
- **`depth`:** each role's players sorted the way `depth_chart_view` sorts them,
  `(p.get("depth") or 99, -player_overall(p))`, as `{role: [slug, …]}`.
- **`players`:** `t["offense"] + t["defense"]`, mapped with the Player table above.
- **`colors`:** the program's primary, secondary and accent (what `ProgramEdit` edits). Check where the
  season state keeps an edited program's colors before falling back to `cfb_sim_data`.

### 2. The button on the depth chart screen (`web/depth/depth.js`)

Label it **Play It on the Field**, in Title Case per the house rules. Open the tab **inside the click, before
any `await`**, or the pop-up blocker stops it:

```js
async function playOnTheField(ctx, myTeam, opponent, base = "https://pocket-franchise.vercel.app") {
  const tab = window.open("", "_blank"); // now, while the click still counts
  try {
    const id = ctx.season().id;
    const [offense, defense] = await Promise.all([
      ctx.api(`/api/season/${id}/playlink/${myTeam}`),
      opponent ? ctx.api(`/api/season/${id}/playlink/${opponent}`) : null,
    ]);
    const link = defense ? { v: 1, offense, defense } : { v: 1, offense };
    const bytes = new TextEncoder().encode(JSON.stringify(link));
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < packed.length; i += 0x8000) bin += String.fromCharCode(...packed.subarray(i, i + 0x8000));
    const payload = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (!tab) return; // pop-ups blocked: tell the player with a toast
    tab.opener = null;
    tab.location.href = `${base}/play#roster=${payload}`;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
```

The opponent is this week's game. Leave `defense` out when there's no game.

### 3. Python, for a test or a script

```python
import base64, json, zlib

def roster_link(link: dict, base: str = "https://pocket-franchise.vercel.app") -> str:
    packed = zlib.compress(json.dumps(link, separators=(",", ":")).encode(), level=9, wbits=-15)  # raw DEFLATE
    return f"{base}/play#roster={base64.urlsafe_b64encode(packed).rstrip(b'=').decode()}"
```

A full 85-man team comes to about 13,000 characters; two teams to about 24,000. That's fine for a link you
click, but too long to paste into most chat apps.

## Uniforms, faces and skin

**Uniforms.** `colors` alone is enough. The page works out home, away, alternate and rush uniforms across the
11 parts its sprites paint: primary jersey and helmet at home, a white jersey away, a secondary facemask, and
whichever team color reads best for numbers and stripes.

To match a real kit exactly, send only the parts that differ. Each part is `"#rrggbb"` or
`["#base", "#shade"]`, and the parts are `helmet`, `helmetDecal`, `facemask`, `jersey`, `sleeves`, `number`,
`pants`, `pantStripe`, `sockFront`, `sockBack` and `shoes`:

```json
"uniforms": { "home": { "pants": "#b3a369", "facemask": "#ffffff" }, "alt": { "jersey": "#111111" } }
```

**Faces and skin.** The new UI draws faces with pocket-faces, not Pocket Franchise's face code, and a coach can
change any player's look (Edit Player Look). So each player now carries his look: `face`, the pocket-faces face, and
`skin`, its skin tone and shade. The page (`ui/src/franchise.ts`) fills both from the face the Depth Chart shows: the
saved look, else the one rolled from his slug and position.

For the field to match, the reader (`sprite-test/lib/game/roster-link.ts`) should draw `face` when it is there, with
pocket-faces, and roll from `slug` only when it is missing (older links). Until then `skin` already matches his skin
tone; hair and features still come from the slug roll.

## Checking it

- [ ] The route returns valid JSON for a team. Each player has a 54-number `skills` array, and `depth` has
      the roles filled.
- [ ] The button opens a new tab showing "<Team> vs <Opponent> loaded from a link", with Keep and Undo.
- [ ] Your team is in its home colors and the opponent in its away colors. Hovering a player shows his name,
      number, school, class and abilities.
- [ ] A player's face on the field card matches his depth chart portrait (needs the reader to draw `face`; until
      then only his skin tone matches).
- [ ] Undo puts the practice field back as it was.

Errors the page can show:

| Error | Cause and fix |
|---|---|
| "it isn't a roster link, or it was cut short" | The payload isn't raw DEFLATE plus base64url (use `deflate-raw`, `wbits=-15`), or it was cut off |
| "roster link version …" | Send `"v": 1` |
| "the roster has no offense" | Every player needs a `slug`, a `name` and `skills` |
| A slot keeps its old player | Nobody in `depth` matched that position (see "Who starts" in the contract) |

## House rules that apply here

- **Golden test:** this touches no sim math, so `python3 tests/test_sim_golden.py` must stay byte-identical.
- **Copy:** the label is Title Case, and the toast is a sentence ("Pop-ups are blocked, so allow them for this
  site and try again.").
- **Controls:** the button is at least 44 px tall on a phone.
- **Privacy:** the link carries the whole roster, ratings included, and the ratings come from EA's numbers.
  It opens in the player's own browser and goes nowhere else.

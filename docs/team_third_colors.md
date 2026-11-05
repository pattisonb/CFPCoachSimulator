# Team Third Colors

A team's pill is drawn as primary/secondary diagonal halves with the accent (third) color as
its border. These 35 teams had no accent in `cfb_sim_data` (`colors.accent` was null). This
file records where each new accent came from: 24 from official brand guides, 11 chosen by the
player.

The accents live in the source data: `cfb_sim_data/teams/<slug>.json` and
`cfb_sim_data/teams_index.json` (the same `{"name", "hex"}` shape as every other color).
`data/base_meta.json` is built from them by `python3 tools/build_site.py`
(`league.write_base_files()`). Colors are not read by the season sim.

## How a color was picked

- Only from an official university or athletics brand page or brand-guide PDF, read
  directly (search-result summaries alone were not enough).
- The first color the guide lists after the two the game already uses, in the guide's own
  order (supporting, secondary, neutral, accent or tertiary palette).
- Skipped: plain black or white unless the guide names it as a school color beyond the two in
  use; and a color within RGB distance 60 of either team color (a darker or lighter version
  of a color the pill already shows, so the border would not read).
- Unnamed swatches are given a plain descriptive name; the hex is the guide's.

## Teams with a new accent (24)

| Team | Color Name | Hex | Source | Notes |
|---|---|---|---|---|
| akron | Bright Blue | #1E63AF | https://uakron.edu/im/resources/brand/colors (Brand Guidelines PDF, Tertiary Colors, p. 25) | Secondary colors Buchtel Blue #070C72 and Prezi Gold #9D9362 sit too close to the team's blue and gold. |
| c-michigan | Red Accent | #EF3340 | https://www.cmich.edu/offices-departments/university-communications/brand-guidelines/visual-language/color-palette | Guide name "Red Accent 1", first of the accent palette. |
| delaware | Cool Gray | #BDBDBD | https://www.cehd.udel.edu/wp-content/uploads/2019/05/UD-Color-Accessibility-Cheat-Sheet.pdf (UD brand guide color page, p. 23) | PMS Cool Gray 4 C, secondary. UD Dark Blue #003C71 skipped (too close to UD Blue). |
| fiu | Bright Gold | #FFCC00 | https://brand.fiu.edu/visual-styles/colors/ | First accent color. |
| iowa | Cool Gray | #BBBCBC | https://brand.uiowa.edu/color | PMS Cool Gray 4, first secondary color. |
| kent-state | Light Blue | #2C8ECD | https://www.kent.edu/brand/swatches | First secondary swatch; the page gives no name. |
| michigan-state | Kelly Green | #008208 | https://brand.msu.edu/visual/color-palette | First of the accent greens. |
| mississippi-st | Light Gray | #C1C6C8 | https://brand.msstate.edu/assets/materials/msstatecolors.pdf | "MSState Light Grey", a primary color beside maroon. |
| missouri | Bluff | #453D3F | https://brand.missouri.edu/visual-identity/colors/ | First neutral color. |
| missouri-state | Black | #000000 | https://brand.missouristate.edu/colors.htm | The Springfield primary palette is Missouri State Maroon, Black and White. |
| mtsu | Midnight Murphy | #343636 | https://www.mtsu.edu/web-training/?p=12 | Primary color beside MTSU True Blue. |
| ndsu | Prairie Grass | #A0BD78 | https://www.ndsu.edu/sites/default/files/documents/NDSU-Brand-Basics.pdf | Secondary ("current campaign") color; Evergreen #003524 skipped (too close to NDSU Green). |
| new-mexico-st | Organ Mountain | #B6A5AD | https://brand.nmsu.edu/color/index.html | First secondary color. |
| ohio | Putnam | #756E65 | https://www.ohio.edu/brand/visual-identity/colors | First secondary color. Under the Elms #024230 skipped (too close to Cutler Green). |
| oklahoma | Dark Gray | #323232 | https://www.ou.edu/brand/creative-platform/design-system/colors | First neutral after black. |
| oregon | Dusk | #A2AAAD | https://communications.uoregon.edu/colors | Secondary. Obsidian (black) and Night #3D4546 skipped (Night too close to the team green). |
| penn-state | Beaver Blue | #1E407C | https://brand.psu.edu/design-toolkit/design-essentials | Primary color beside Nittany Navy and White Out. |
| texas | Charcoal | #333F48 | https://umac.utexas.edu/brand-center/visual-identity/colors/ | PMS 432, first supportive secondary color; the name is UT's (e.g. https://cockrell.utexas.edu/communications-and-marketing/brand/colors). |
| toledo | Dark Blue | #000F3E | https://www.utoledo.edu/offices/marketing/toolkit/index.html | Chosen by the player over the guide's magenta accent; Dark Blue is the guide's first secondary color. |
| ucla | Darkest Blue | #003B5C | https://designsystem.brand.ucla.edu/build/v2.6.0/docs/style-guide/colors.html | First secondary color. |
| usc | Light Gray | #CCCCCC | https://identity.usc.edu/color/ | Secondary "Gray (30K)". |
| w-kentucky | Gray | #333333 | https://www.wku.edu/marketingandcommunications/documents/wku-communication-and-branding-manual-2021.pdf | Primary "Gray" (Pantone Cool Gray 9) beside red and white. |
| w-michigan | Warm Gray | #B4AEA7 | https://wmich.edu/brand/visualidentity/color | First neutral (PMS 401). |
| washington | Heritage Gold | #85754D | https://www.washington.edu/brand/colors/ | Primary palette. Husky Purple #32006E skipped (too close to the team purple). |

## Teams with an accent chosen by the player (11)

These schools' guides could not be read or listed no usable third color, so the player chose
their accents.

| Team | Color Name | Hex | Source | Notes |
|---|---|---|---|---|
| e-michigan | Light Gray | #A7A9AC | Chosen by the player | Their turf gray. |
| indiana | Black | #000000 | Chosen by the player | |
| kentucky | Black | #000000 | Chosen by the player | |
| michigan | Dark Gray | #3F4444 | Chosen by the player | |
| minnesota | Dark Gray | #3C3D3F | Chosen by the player | |
| nebraska | Black | #000000 | Chosen by the player | |
| northwestern | Black | #000000 | Chosen by the player | |
| purdue | Dark Gray | #3F4444 | Chosen by the player | Purdue's secondary is already black; dark gray still reads as distinct on the pill border. |
| sac-state | Black | #000000 | Chosen by the player | |
| texas-a-m | Black | #000000 | Chosen by the player | |
| wisconsin | Black | #000000 | Chosen by the player | |

Every one of the 35 teams now has an accent.

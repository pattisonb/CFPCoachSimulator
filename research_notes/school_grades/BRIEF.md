# School Grades research brief (Phase 1)

Spec: `docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md`. This research feeds six new grades:
Academics, Facilities, Location, Stability, Game Day, Exposure. The schools are in `schools.json` here
(`slug|Name|City, State`, grouped by conference). **Every value needs a source URL.** If you cannot find a value,
write `null` with a `note` saying what you tried. Never invent a number. A number you derived or estimated is marked
`"estimate": true` with the note saying how.

## Fields (per school)

| field | what | preferred source |
|---|---|---|
| `us_news_rank` | U.S. News Best Colleges 2025 (or the latest edition) National Universities rank (number; `"unranked"` if not ranked; for a tie, the number) | usnews.com, or the school's own page quoting it |
| `football_gsr` | NCAA Graduation Success Rate for the football program, latest cohort (percent) | NCAA GSR database / reports, school athletics releases |
| `football_apr` | NCAA Academic Progress Rate, football, latest multi-year score (out of 1000) | NCAA APR database / school releases |
| `stadium_name` | home stadium | Wikipedia / school |
| `stadium_capacity` | current official capacity | Wikipedia / school |
| `stadium_renovated` | year of the latest major renovation or expansion (the year it opened if never) | Wikipedia / school |
| `football_building_year` | year the current football operations building opened or was last fully renovated | school release / news |
| `indoor_practice` | year the indoor practice facility opened, or `"none"` | school / news |
| `metro_population` | population of the metro (MSA) or, if none, the city/micro area (Census 2020 or latest estimate) | census.gov / Wikipedia |
| `jan_avg_temp_f` | January average temperature (°F), NOAA normals for the city or nearest station | NOAA / Wikipedia climate box |
| `setting` | `"Big City"` (metro 1M+), `"College Town"` (the university dominates a smaller city), or `"Small Town"` | your judgment from the above; note why |
| `head_coaches_since_2010` | number of head football coaches (not interim) who started a season from 2010 through 2025 | Wikipedia coach list |
| `current_hc_since` | first season of the current (2025) head coach | Wikipedia |
| `instagram_followers` | the football program's Instagram follower count (as of when you look; give the date in the note) | instagram.com page or a news article citing it |

## Output

Write one JSON file: `research_notes/school_grades/<batch>.json`, shaped
`{"<slug>": {"<field>": {"value": ..., "source": "<url>", "estimate": false, "note": "..."}, ...}, ...}` for every school in
your batch and every field above. Then return a short summary: schools done, fields found/null counts, and any
source you could not reach.

# School Grades research (Phase 1)

The facts behind six school grades (Academics, Facilities, Location, Stability, Game Day, Exposure) for all 136 FBS
programs. The spec is `docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md` and the brief is `BRIEF.md`.
`tools/build_program_profile.py` turns these files into `data/program_profile.json`, and
`coach_career/programs.grades` grades the profile on read.

## Files

- `schools.json`: the 136 programs by conference (`slug|Name|City, State`).
- Seven batch files, every field with its `value`, `source` (a URL), `estimate` flag and `note`:
  - `acc.json`
  - `sec-ind.json` (the SEC and the independents)
  - `sunbelt-pac12.json`
  - `aac-cusa.json`
  - `big-ten.json`
  - `mac-mwc.json`
  - `big-12.json`
- `instagram_handles.csv`: each football program's Instagram account and follower count. The player filled it in on
  2026-11-10; `followers_num` is the number used. The six biggest accounts show rounded on the page (1M, 2M), so they
  tie at those values.

## Sources and editions

| Fact | Source |
|---|---|
| U.S. News rank | 2027 edition (September 2026), National Universities |
| Football GSR | NCAA 2025 report, four-class average |
| Football APR | NCAA 2024-25 multi-year rate |
| Stadium, capacity, renovation | Wikipedia infoboxes and school pages |
| Football building and indoor practice years | School releases and local news |
| Metro population | Census MSA estimates (2025, or 2020 where newer was not tabulated) |
| January temperature | NOAA 1991-2020 normals |
| Head coaches since 2010 | Wikipedia coach lists |

These facts come from the game's own data, not this research:

- Home attendance and the TV audience come from `data/program_market.json` (`tools/build_program_market.py`). Nielsen
  publishes the TV audience only for the most-watched teams, so the rest are fitted.
- The state comes from the teams file.

## Coverage (of 136)

| Fact | Coverage |
|---|---|
| GSR, APR, capacity, metro, coaches | 136 found |
| U.S. News rank | 133 found (7 unranked, 4 marked estimates) |
| Stadium renovated | 133 found (3 estimated) |
| January temperature | 136 (4 estimated from the nearest station) |
| Football building year | 94 found; 42 left at their conference's median (59 estimates in all, counting the researchers' own) |
| Indoor practice | 93 found or `none` (14 have none); 43 left at their conference's median (52 estimates in all) |
| Instagram | 136, from the player |
| TV audience | 14 published, 122 fitted |

## Judgment calls

- **Unranked schools:**
  - An unranked school reads a rank score of 25.
  - The three service academies read 85, because U.S. News ranks them among the top liberal arts colleges.
- **Rank curve:** the rank score is a bent log (`programs.RANK_CURVE` = 2), so the top 10 read Elite. The straight
  log in the plan gave Stanford (rank 5) only 74.6.
- **Setting:** Big City (a metro of 1M+) and Mid-Size City (500K-1M) come from the metro, unless the research called
  the school a College Town. Below that, the research's College Town or Small Town stands. The researchers' "Big City"
  for metros under 1M (Akron, for example) was overridden by the metro rule.
- **Stadium over capacity:** a crowd bigger than the stated capacity (14 programs, where sources conflict) fills 100%.
- **No research row:** NDSU and Sacramento State are in the league but have no research row. They read Not Graded.

## Gaps for a later pass

- **Facility years:** 42 football building years and 43 indoor practice years are conference medians. They are
  listed in each program's `estimates` with a note.
- **TV audience:** fitted for every team Nielsen does not publish.

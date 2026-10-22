# Recruit Decision Drivers and Recruiting Class Position Mix (FBS, ~2010-2026)

Research date: 2026-10-22. About 19 search/fetch calls. Many sources here are abstracts, snippets or single-team examples. Every number below carries its source, and the Inferences section marks the simulation estimates as estimates.

## 1. What drives a recruit's school choice (surveys and studies of decision factors)

### Takeaway
Among elite recruits, the coaching staff and NFL development rank at the top of self-reported priorities. In the 2022 On3 survey, NIL money ranked 6th of 7 options, yet about 30% of respondents said a strong NIL deal could pull them to a school that was not a perfect fit. Small-sample academic surveys add career and academic outcomes, impressions from the recruiter and the official visit, and campus atmosphere. Proximity matters a lot in practice: programs typically draw 25-60% of a class from in-state, and median recruit distances run about 150-460 miles.

### Cited Findings
- **On3 survey (published July 2022, updated Feb 2023):** 85 of On3's consensus top-200 HS football recruits responded. They "overwhelmingly prioritized coaching staff and NFL development," and NIL deals ranked **6th of 7** options. The article does not publish the full list of 7 factors or any per-factor percentages. — [Front Office Sports](https://frontofficesports.com/article/survey-cfb-recruits-value-coaches-pro-chances-more-than-nil/)
- Same On3 survey: **30%** would consider a school that is not a perfect football or academic fit if a good NIL deal were waiting. **31.8%** had been contacted by a collective. **64.7%** had discussed NIL deals with other recruits, and **38.2%** had compared offers with other recruits. **11.8%** had worked with a lawyer on an NIL contract. — [Front Office Sports](https://frontofficesports.com/article/survey-cfb-recruits-value-coaches-pro-chances-more-than-nil/)
- A separate On3 poll of **41 blue-chip recruits** reportedly found culture fit and NFL development "outweighing a larger payday." This comes from a search snippet that I could not verify against the original. — [On3 via search summary](https://www.on3.com/recruits/news/how-on3-recruits-helps-you-get-recruited)
- A survey of **74 Division I FBS players** ranked "the opportunity to begin a good career other than playing professional football" as the most influential factor. This is a Journal of Applied Sport Management article (vol. 8, iss. 4). — [JASM / Trace Tennessee](https://trace.tennessee.edu/jasm/vol8/iss4/8)
- A qualitative study of the Pac-12 ranked the main themes by influence: **atmosphere, communication, athletics, academics**. — [UW-Madison MINDS thesis](https://minds.wisconsin.edu/handle/1793/83150)
- Small-college evidence from Nebraska Wesleyan (not FBS): the top-ranked factors were the impression the recruiter left on the first HS visit, the recruiter's follow-up calls, and a positive on-campus visit. — [UNL Digital Commons](https://digitalcommons.unl.edu/cehsedaddiss/48)
- **Proximity, team-level data from the 2027 cycle (commits, not signees):** Mississippi State's average commit distance was **178 mi**, with **47%** in-state. Tennessee averaged **271 mi** and Auburn **294 mi**. Iowa averaged **240 mi** with **46%** in-state, and Indiana **299 mi** with **24%** in-state. — [On3/Rivals SEC](https://www.on3.com/rivals/news/ranking-sec-recruiting-classes-via-average-commit-distance-2027); [On3/Rivals Big Ten](https://on3.com/rivals/news/ranking-big-ten-recruiting-classes-via-average-commit-distance-october/)
- **Proximity, playoff-team rosters (Esri):** across 509 players on 4 playoff teams, the median recruit distance was **226 mi**. Georgia's median was **152 mi** (60% in-state), Ohio State **184 mi**, TCU **221 mi** (61% in-state) and Michigan **460 mi** (27% in-state). Transfers came from farther away than HS recruits. — [Esri ArcGIS blog](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/college-football-recruiting-patterns)
- **Rukkus/FootballScoop map of 13,738 FBS player hometowns (~2016):** of the 24 schools whose average player lives ≥650 mi away, all but one (Syracuse) are west of the Rockies or service academies. — [FootballScoop](https://footballscoop.com/chart-mapping-every-fbs-players-home-town)
- Then-Auburn coach Tommy Tuberville (2009) described a goal of signing players from within about 200 miles. The same column reported that programs drawing at least half their recruits from within 200 miles won more games. This is a 2009 newspaper column, not a peer-reviewed study. — [The Gazette](https://www.thegazette.com/?p=133361)

### Inferences
- **Simulation estimate:** for a "home pull" term, use roughly 40-60% in-state or near-home share for Southern and Midwestern programs in talent-rich states. Use about 25% for national brands (e.g., Michigan) and talent-poor states, and lower for Western schools and service academies. A distance decay with a half-weight near 200-300 miles is consistent with the medians above. This is my estimate; no study fit a decay curve.
- Suggested factor ordering for elite recruits (an estimate drawn from the On3 surveys): coach relationship and NFL development first, then program prestige and winning, then playing time. NIL sits mid-to-low as a stated priority but acts as a strong tiebreaker or override for about 30% of recruits.

### Gaps
- I found no NCAA GOALS study figures specific to FBS football recruit decisions in this search.
- I found no per-factor percentages from the On3 survey; only the rank order of 2 of the 7 factors is reported.
- I found no quantitative evidence specifically on facilities, conference affiliation, position-coach relationships or family influence.
- I found no blue-chip-specific distance statistics.

## 2. Measured effects of winning, titles and coaching changes on the next class; lag and momentum

### Takeaway
Panel econometric work finds that recent winning, AP top-25 finishes and a successful head coach raise later recruiting rankings. NCAA sanctions (bowl bans, scholarship cuts, probation) lower them. Prior-season results explain up to about half of the variance in recruiting rank. Coaching changes produce noisy outcomes: most first-year coaches stay within ±10 spots of their first class in year 2, though individual hires can jump dozens of spots.

### Cited Findings
- **Pitts & Evans, *Applied Economics* (2016), FBS panel 2002-2014:** recent success (winning seasons, AP top-25 finishes) has a positive effect on annual recruiting rankings. Schools with more successful head coaches sign better classes. Bowl bans, scholarship restrictions and probation have a negative effect. Conference achievement creates positive recruiting externalities, with a possible negative externality too. The coefficients are not given in the abstract. — [Kennesaw State Digital Commons](https://digitalcommons.kennesaw.edu/facpubs/3755)
- **Herda et al., *Journal of Quantitative Analysis in Sports* (2009):** prior-season ratings or wins explained **up to 51%** of the variance in subsequent recruiting rankings (from the search snippet). — [KU ScholarWorks](https://kuscholarworks.ku.edu/bitstream/1808/18001/1/HerdaT_IQAS_2009.pdf)
- ***Journal of Sports Economics*, "The Effect of Recruit Quality on College Football Team Performance":** adding school fixed effects cuts the estimated effect of recruit quality on wins by **more than 25%**, but the remaining effect is still statistically and economically significant. Within-school changes in recruit quality also predict appearances in the most lucrative bowls. This implies that durable program effects drive much of the recruiting–winning link. — [MetaTOC abstract](https://metatoc.com/papers/63621-the-effect-of-recruit-quality-on-college-football-team-performance)
- **Langelett (2003):** recruiting significantly affected team performance over the following 5 years, with the largest effect in a player's freshman year. This is reported secondhand. — [TDAlabama Mag](https://tdalabamamag.com/2014/07/10/looking-to-the-stars/)
- Harvard Sports Analysis Collective (2013) cautions that the recruiting–performance relationship involves simultaneous causality, since program quality drives both. — [HSAC](https://harvardsportsanalysis.org/2013/02/analyzing-the-lagged-effect-of-college-football-recruiting/) (the page returned HTTP 500 when fetched; content is from the search summary)
- **Coaching changes:** in Rivals' study of ACC first-year coaches, **8 of 13** saw no significant change (±10 spots) from their first class to their second. Only **2** (Dabo Swinney at Clemson and Larry Fedora at UNC) climbed ≥10 spots, and most of the rest dropped. — [Rivals](https://n.rivals.com/news/history-of-first-year-coaches-recruiting-success-acc)
- A late hire shrinks the first class: analyst Tom Lemming said a December hire leaves about 3 weeks of effective recruiting before the dead period (Chad Morris at Arkansas example). — [NWA Online, 2018](https://www.nwaonline.com/news/2018/feb/08/national-analyst-hogs-make-up-ground-to/)
- A departing coach can collapse a class: Rivals attributed Houston's recruiting dip to Tom Herman's departure. — [Rivals](https://n.rivals.com/news/five-programs-that-made-the-least-improvement-from-2016-to-2017)
- Recent example: Alex Golesh's first Auburn class (2026 cycle) climbed from **93rd to 35th** in the 247Sports rankings, helped by flips and keeping most existing commits. — [SI Auburn](https://www.si.com/college/auburn/recruiting/auburn-2026-recruiting-class-ranked-after-day-one-of-early-signing-period)

### Inferences
- **Simulation estimate:** model next-year recruiting "prestige" as a weighted blend of the last 1-3 seasons, weighting the most recent season heaviest. Prior-season results explain at most about 50% of variance (Herda), so the rest should come from a persistent program-brand term and random noise.
- **Coaching change estimate:** when a coach is fired, apply a one-cycle penalty (lost commits, a short window) scaled by how late the hire happens. Then reset toward the new coach's own recruiting rating. For year 2 relative to year 1, about 60% of cases should stay within ±10 ranks (from Rivals' 8 of 13).

### Gaps
- I found no effect sizes (e.g., "+X class-rank spots per extra win" or "national title → +Y rating points"); the Pitts & Evans and Herda coefficients were behind paywalls or PDFs I did not open.
- I found no study isolating CFP appearances or national-title effects, or a formal measure of "recruiting momentum."

## 3. Persistence of program recruiting level (year-to-year correlation)

### Takeaway
I found no direct published year-to-year correlation of class rank. Indirect evidence shows a large persistent program component.

### Cited Findings
- School fixed effects absorb more than 25% of the estimated recruit-quality → wins effect, which signals large stable between-school differences. — [MetaTOC / JSE abstract](https://metatoc.com/papers/63621-the-effect-of-recruit-quality-on-college-football-team-performance)
- Most ACC first-year coaches' second classes landed within ±10 spots of their first. — [Rivals](https://n.rivals.com/news/history-of-first-year-coaches-recruiting-success-acc)
- A Substack analysis covering a decade of recruiting and performance trends exists; I did not fetch it. — [jjfuller72 Substack](https://jjfuller72.substack.com/p/trends-and-biases-in-college-football)

### Inferences
- **Simulation estimate (not sourced):** treat class rating as strongly autocorrelated, roughly r ≈ 0.8-0.9 for team rating points among Power-conference teams. Mean-revert slowly toward a long-run program baseline, and allow shocks from coaching changes and sanctions. The developers could check this against CollegeFootballData.com team recruiting data (requires a free API key).

### Gaps
- No sourced year-to-year correlation. CFBD/247 data could compute one directly, but I had no API key or dataset access in this session (GitHub data repos were blocked).

## 4. The NIL era (2021+) and revenue sharing (2025+): who lands top recruits

### Takeaway
The NIL era has shifted talent out of the SEC footprint toward Big Ten, ACC and Big 12 programs that pay. An academic study reportedly finds slightly greater concentration of 5-stars after NIL (the Gini rose), but I could not verify it. Revenue sharing began with a $20.5M cap in Year 1, and top programs reportedly spend $40M+ when above-cap NIL is included. Elite prospects command multi-year packages worth $5M+.

### Cited Findings
- **AP analysis (Sept 29, 2026), 247Sports Composite top 250:** the share of top recruits from SEC states signing with SEC schools fell from **72% (99 players) in 2022** to a projected **53% (78) for the 2027 class**. Big Ten signings from SEC states rose from **9 (2022)** to a projected **22 (2027)**. In **2024**, 54 of the 153 top recruits from SEC states chose non-SEC schools. Texas Tech holds **8** top-250 commitments from SEC states. More than half of each year's top-250 recruits since 2015 have come from SEC states. — [NBC Sports (AP)](https://www.nbcsports.com/college-football/news/as-top-talent-slowly-leaks-from-sec-territory-the-league-looks-to-stop-a-three-year-title-slide)
- An academic study of 2018-2024 recruits reportedly found the Gini coefficient for 5-star distribution rose from **0.501 to 0.536** after NIL. This is **UNVERIFIED**: it comes from a social media paraphrase, not the original paper. — [X post](https://x.com/Genetics56/status/1986233982258913640)
- **2026 cycle:** at one point nearly **20 schools** had a signed or committed 5-star, out of **34** 5-star prospects total. Notre Dame, Alabama and Oregon had 4 each, and Texas had 3. Top prospects secured multi-year deals worth **north of $5M**. The House settlement's Year 1 revenue-share cap was **$20.5M**, and industry sources expect top programs' above-cap roster spending to exceed **$40M**, with some GMs projecting **$55M**. Classes filled earlier than ever before. — [ESPN](https://africa.espn.com/college-football/story/_/id/45869679/college-football-recruiting-2025-missed-summer-commits-five-stars-flips)
- Revenue sharing let "smaller schools and those with less fanfare" make significant offers to elite players (Michigan commitments cited as an example). — [SI Michigan](https://www.si.com/college/michigan/football/ojo-russell-mcdonald-commitments-mark-recruiting-shift-and-the-power-of-rev-share)
- Market pricing (low-quality source): a 5-star may cost close to $2M per year and a 4-star about $500K. — [nil-ncaa.com](https://nil-ncaa.com/)
- Football scholarship limits rose from **85 to 105** (roster limits) under the House settlement, and partial scholarships are now allowed. — [247Sports Ohio State](https://247sports.com/college/ohio-state/article/ohio-state-buckeyes-football-scholarship-totals-by-class-and-position-281022447/)

### Inferences
- **Simulation estimate:** from 2021 onward, add an NIL/rev-share "budget" term. For about 30% of recruits it can override fit (On3). Its effect should shrink regional loyalty, e.g., SEC-footprint retention falling from about 70% to about 55% over 2022-2027 (AP). Under a 105-man roster, class sizes and the HS-versus-portal split may shift.

### Gaps
- I found no verified concentration metrics (HHI or top-10 share of 5-stars by year) comparing pre- and post-NIL.
- I found no causal study of revenue-sharing budgets versus class rank.

## 5. Position mix of a typical class, and how 5-stars split by position

### Takeaway
I found no published multi-year average of signees per position. Single-class examples and roster rules of thumb suggest that a class of about 20-25 typically takes 1 QB, 2 RB, 3-4 WR, 1-2 TE, 4-5 OL, 4-5 DL/EDGE, 2-4 LB, 4-5 DB, 0-2 ATH and 0-1 specialist. Composite 5-stars number about 32-36 per year. The 2022 class split 5 QB, 2 RB, 4 WR, 0 TE, 4 OL, 6 DL/EDGE, 1 LB, 7 DB and 4 ATH.

### Cited Findings
- **247Sports Composite 5-star threshold:** a rating of 0.98 or higher. 247's in-house 5-stars are the top 32. — [Wikipedia: 247Sports](https://en.wikipedia.org/wiki/247Sports)
- Composite 5-star counts by class: **2022 = 33** (247's article said 36, but 3 listed players were 4-stars), **2023 = 33**, **2026 = 34**. — [247Sports 2022 list](https://247sports.com/LongFormArticle/college-football-recruiting-5-star-prospects-in-the-2022-class-161538244/); [Yahoo Sports 2023](https://sports.yahoo.com/247sports-composite-complete-updated-list-120043743.html); [ESPN 2026](https://africa.espn.com/college-football/story/_/id/45869679/college-football-recruiting-2025-missed-summer-commits-five-stars-flips)
- **2022 Composite 5-stars by position (my count from the 247 list):**

  | Position | Count |
  |---|---|
  | QB | 5 |
  | RB | 2 |
  | WR | 4 |
  | TE | 0 |
  | OT | 3 |
  | IOL | 1 |
  | DL | 4 |
  | EDGE | 2 |
  | LB | 1 |
  | CB | 5 |
  | S | 2 |
  | ATH | 4 |
  | **Total** | **33** |

  — [247Sports](https://247sports.com/LongFormArticle/college-football-recruiting-5-star-prospects-in-the-2022-class-161538244/)
- In the 2017 Composite, **5 of the top 19** prospects were offensive tackles, and only 2 linebackers were rated 5-star. This shows how much the position split varies year to year. — [Saturday Down South](https://www.saturdaydownsouth.com/news/college-football/2017-recruiting-class-strengths-weaknesses/)
- **Oklahoma, 2026 class:** the school announced 24 signees, but the bios list 23. By position: QB 1, RB 2, WR 3, TE 2, OL 2, DL 5 (3 described as edge types), LB 4, CB 1, S 2, K 1. — [News9](https://www.news9.com/sports/university-of-oklahoma/sooners-announce-24-signees-in-2026-recruiting-class-including-three-top-100-prospects)
- **Texas, 2014 class:** QB 1, RB 3, WR 5, TE 1, OL 3, DL 4 (DBs and LBs were not captured in the snippet). — [Dallas News](https://www.dallasnews.com/sports/2014/01/27/meet-texas-2014-national-signing-day-class/)
- Rule of thumb from a recruiting-guide blog (low authority): about **4-6 OL per class**, and OL is the largest scholarship group on the roster at about **14-18**. — [NCAA Scholarship Guide blog](https://www.ncaascholarshipguide.com/blog/football-scholarships-by-position-the-real-offer-patterns-for-qbs-linemen-skills-specialists)
- An Axios analysis of the 247Sports Composite found that 29% of drafted 5-star recruits (2015-2022) were first-round picks. Separately, On3 reports 71% of On3 5-stars were drafted across three drafts and 81.3% in 2023. This is useful for an "NFL development" attribute. — [Axios](https://www.axios.com/2023/04/29/nfl-draft-college-football-five-star-recruits); [On3 via search summary](https://www.on3.com/recruits/news/how-on3-recruits-helps-you-get-recruited)

### Inferences
- **Simulation estimate (unsourced, built from the roster structure and the examples above):** for a 22-25 signee class, use these target counts:

  | Position | Target |
  |---|---|
  | QB | 1 (0-2) |
  | RB | 1-2 |
  | WR | 3-4 |
  | TE | 1-2 |
  | OL | 4-5 |
  | DL (interior) | 2-3 |
  | EDGE | 2-3 |
  | LB | 2-3 |
  | CB | 2-3 |
  | S | 2 |
  | ATH | 0-2 |
  | K/P/LS | 0-1, about every other year |

  Tie the counts to need: target = (departing seniors and early NFL entrants at the position) adjusted toward the roster target size. For roster targets, OL about 15-17, DL/EDGE about 14-16, DB about 14-16, WR about 10, LB about 8, RB about 4-5, TE about 4-5, QB about 3-4.
- **Simulation estimate:** for 5-star generation, draw about 30-36 per year. Weight positions roughly QB 12%, RB 7%, WR 12%, TE 2%, OL 12%, DL/EDGE 18%, LB 5%, DB 20%, ATH 10%. These weights come from the 2022 count only, smoothed with judgment, and are not a multi-year average.

### Gaps
- I found no multi-year average of signees per position across FBS; computing one requires 247/CFBD signee data, which was not accessible here.
- I found no multi-year 5-star-by-position table (only 2022 counted, plus a 2017 anecdote).
- I found no source on how often programs sign 0 or 2 QBs in a class, or on kicker and punter signing frequency.

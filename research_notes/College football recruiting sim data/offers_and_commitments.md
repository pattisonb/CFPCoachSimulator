# Offers, Visits and Commitments in FBS High School Recruiting (sim parameter notes)

Research date: 2026-10-22. Research budget was about 18 searches/fetches. On3 (403) and ESPN (empty page) articles could not be fetched in full, so several On3/ESPN numbers come from search-result snippets and are marked that way. **Overall: the published record is thin on offer counts by star level and on flip rates by star level.** Many simulation parameters below are therefore estimates and need calibration, possibly from a CFBD/247 data pull.

---

## 1. Offers received per recruit, by star level

### Takeaway
I found no published, sourced average offer count by star level (5/4/3/2-star) for any FBS class from 2015 to 2026. The usable supporting data are class-size counts by star tier (how many players exist at each level) and anecdotes. Offer distributions need either a 247Sports/On3 scrape or designer estimates.

### Cited Findings
- Class sizes by star tier: about 33 five-stars, 332 four-stars and 2,087 three-stars per class on average (Last Word on Sports analysis of star ratings) — [Last Word on Sports, 2021](https://lastwordonsports.com/collegefootball/2021/07/12/what-do-those-star-ratings-mean/)
- On3's Rivals Industry Ranking defines about 400 "blue-chip" (4- and 5-star) prospects per class. "More than 380 of the 400 blue-chip prospects" in the 2026 class were committed at an unspecified point late in the cycle (search snippet; the page returned 403) — [On3, "2026 class by the numbers"](https://www.on3.com/rivals/news/college-football-recruiting-breaking-down-the-2026-class-by-the-numbers/)
- NCSA (a recruiting-service marketing page) says elite prospects can hold very large offer lists, while the "average recruit" weighs only two or three serious offers. No methodology is given, so treat it as low quality (search snippet) — [search result set, NCSA reference via sportsengine](https://discover.sportsengineplay.com/?p=4117)
- Outcomes by tier, useful context for how valuable each tier is: 19.3% of four-stars vs 7.1% of three-stars were drafted (Rivals, 2015 draft) — [Rivals](https://n.rivals.com/news/nfl-draft-crunching-the-numbers)

### Inferences
- Estimate, not sourced: offer lists are commonly reported in the 30 to 50+ range for 5-stars and 15 to 35 for high 4-stars. Many 3-stars hold about 5 to 15 FBS offers, and 2-stars hold 0 to 3 FBS offers (mostly G5/FCS). A heavy-tailed, star-conditioned distribution (for example lognormal) fits the anecdotal pattern. These ranges come from general familiarity with 247/On3 profile pages, not from a study.
- The tier sizes give an upper bound on how many recruits the sim needs per class. With roughly 30 to 35 five-stars, about 300 to 330 four-stars and about 1,500 to 2,100 three-stars, roughly 2,400 FBS-caliber ranked prospects compete for about 138 × ~20 to 25 HS signees, which is about 2,800 to 3,400 slots. Some of those slots go to 2-stars and unrated players.

### Gaps
- No published mean or median offers by star level. No academic paper surfaced that reports offer distributions.
- I found no "committable vs. non-committable" offer data.

---

## 2. Offers sent per program per class; offer-to-commit ratios

### Takeaway
The only hard offer-volume number found is Georgia's 123+ offers to 2021-class prospects while they were still juniors. Classes typically end at about 20 to 25 HS signees. Program-level offer-to-commit ratios for P4 vs G5 are not published in what I found.

### Cited Findings
- Georgia had made more than 123 offers to 2021-class prospects while they were still juniors. Largest position groups: 20 OL and 22 WR offers. Geography: 29 to Florida prospects, 22 to Texas, 21 to Georgia — [Bulldawg Illustrated (fan site)](https://bulldawgillustrated.com/?p=134035)
- Pre-2025 rule constraints: 85 total scholarships, and a program could sign no more than 25 players per class — [ESPN / search snippet](https://www.espn.com/recruiting/s/donnanunofficial.html); [Bulldawg Illustrated](https://bulldawgillustrated.com/?p=134035)
- Alabama could only sign 20 prospects in 2018 because of numbers — [DawgNation/Saturday Down South results set](https://www.saturdaydownsouth.com/?p=231751). Alabama held 22 commitments for 2026 before the early signing period — [SI Alabama](https://www.si.com/college/alabama/recruiting/alabama-extends-offer-to-rising-2026-tackle-prospect)
- Selective-offer model: Oregon signed only 41 high school prospects across the 2025 and 2026 classes, with the highest average rating per commit in each cycle (snippet) — [On3 blue-chip %](https://www.on3.com/rivals/news/college-football-recruiting-teams-with-the-highest-percentage-of-blue-chip-commits/)
- More than 60 teams signed at least one 247 Composite blue-chip in the 2025 class. Blue-chips are therefore concentrated in about 45% of FBS programs, and roughly 75+ FBS programs signed zero — [247Sports](https://247sports.com/longformarticle/college-football-recruiting-teams-with-most-composite-blue-chip-signees-in-2025-class-ranked-245117251/)
- Class sizes in December 2025: USC collected 31 signatures from 35 verbal commits on day 1 of the ESP, and North Carolina signed 39. Very large post-House-settlement classes are possible for some programs — [Fox Sports, Dec 3 2025](https://www.foxsports.com/stories/college-football/cohen-4-takeaways-early-signing-period)

### Inferences
- Estimate: 123 junior-stage offers for Georgia suggests an elite program ends a cycle at about 150 to 250+ offers for about 20 to 28 signees. That is an offer-to-signee ratio of roughly 6:1 to 10:1. Reports commonly cite 200 to 300+ offers for some programs, but I did not verify any such count.
- Estimate: G5 programs probably offer fewer prospects in absolute terms (about 80 to 150), with a better conversion ratio (about 3:1 to 6:1), because more of their offers are "committable." This is not sourced.
- The USC (35 commits) and UNC (39 signees) figures indicate that under the 105-man roster limit model (House settlement, 2025-26), class size is no longer capped at 25. The sim should allow variable class sizes of about 15 to 40, driven by roster need and transfer-portal reliance. The rule detail is not verified here; see Gaps.

### Gaps
- No verified per-program total offer counts (Alabama, Ohio State and others), and no P4 vs G5 ratio study.
- Not verified in this research: the House settlement (approved June 2025) replaced the 85-scholarship limit with a 105-roster limit and is widely reported to have removed the 25-signee initial-counter cap. Confirm with another research thread or ncaa.org.

---

## 3. Timing of offers, contact rules, official/unofficial visits, camps

### Takeaway
Under the April 2017 and 2023 NCAA reforms, coaches may begin off-campus contact on June 15 after a recruit's sophomore year. Official visits begin April 1 of the junior year (since 2017), and the old five-visit cap was removed in 2023, although each school may host a prospect only once. The result is an official-visit "season" from late May through June before the senior year, which is when most commitments now happen.

### Cited Findings
- April 2017 NCAA package: official visits allowed from April 1 of the junior year through the Sunday before the last Wednesday in June. They then reopen at the start of the senior year (Sept. 1 under the rule text). Before 2017, official visits were not allowed until Sept. 1 of the senior year. The same package created the December early signing period and added a 10th assistant coach — [WCPO](https://www.wcpo.com/sports/high-school-sports/ncaa-allows-earlier-football-signings-recruiting-visits); [CBS News / AP 2017](https://www.cbsnews.com/texas/news/ncaa-adopts-early-signing-period-10th-coach-for-football)
- 2023 changes: the visit limit was removed, effective August 1, 2023 per the Texas Football summary. Schools remain limited to 56 official visits per cycle. Contact may begin June 15 after the sophomore year, moved up from Sept. 1 of the junior year — [TexasFootball.com, Apr 2023](https://texasfootball.com/article/2023/04/12/ncaa-recommending-changes-to-recruiting-calendar)
- On3 reports that unlimited official visits begin "July 1" under Division I Council rules, limited to one official visit per school unless there is a coaching change (snippet; page 403). **This conflicts with the Aug 1, 2023 date above** — [On3](https://www.on3.com/news/ncaa-recruits-can-now-take-unlimited-official-visits); also [CBS Sports](https://www.cbssports.com/college-football/news/ncaa-approves-rule-allowing-prospects-to-take-an-unlimited-number-of-official-recruiting-visits)
- Proposed and adopted December calendar (CCA, 2024): the evaluation period closes Dec. 1 and a dead period runs Dec. 2 to 8 (2024). A "quiet period" runs Dec. 9 to 22, with on-campus hosting allowed. Proposals also called for a dead period of June 22 to 30 and all of July. The pre-change dead period ran June 24 to July 24 — [FootballScoop, May 21 2024](https://footballscoop.com/news/college-football-moving-closer-to-potential-june-signing-period-earlier-december-dates)
- Volume of June official visits: Ohio State hosted 43 official visitors between May 30 and June 22, 2025 (2026 class) — [Eleven Warriors, July 2025](https://www.elevenwarriors.com/ohio-state-football-recruiting/2025/07/156719/taking-stock-of-ohio-state-s-2026-class-after-june-full-of-commitments-and-official-visits)
- Nebraska ran multiple June OV weekends, for example June 12 to 14, and 8 recruits on its final June weekend (2026 class) — [SI Nebraska](https://www.si.com/college/nebraska/recruiting/nebraska-welcomes-eight-recruits-for-final-official-visit-weekend-of-june-2026)
- Spring commitment surge: 121 of ESPN's SC Next 300 for 2027 committed between March 1 and June 1, which is 68.3% of all committed top-300 prospects at that time (snippet; ESPN page empty on fetch) — [ESPN, June 2026](https://www.espn.com/college-football/recruiting/story/_/id/48911285/college-football-recruiting-2026-summer-intel-commits-flips-winners-visits)

### Inferences
- Sim calendar suggestion, in model time:
  - Offers: rare in the freshman year and growing in the sophomore year (elite only). The big wave comes from June 15 after the sophomore year, when contact opens, and through the junior year.
  - Unofficial visits and camps: year-round outside dead periods, especially in spring and in June camps.
  - Official visits: about late May to late June before the senior year (peak), plus fall game-day OVs in the senior season.
  - Each prospect can take one OV per school. Model about 3 to 6 OVs per blue-chip (estimate). Each school has a cap of 56 OVs per cycle (sourced).
- Because there is no cap on the number of OVs, top prospects can take many visits. Visit counts per recruit are an estimate, since I found no average.

### Gaps
- Effective date of the unlimited OV rule: Aug 1, 2023 (TexasFootball) or July 1 (On3). The year in On3's snippet is not visible.
- No sourced share of offers issued by grade year (9th/10th/11th/12th).
- I could not verify whether 2025-26 NCAA governance (after the House settlement) changed the 56-OV cap or the contact rules.

---

## 4. Commitment timeline and signing periods

### Takeaway
Since the December early signing period (ESP) began with the 2018 class (signed Dec 2017), it has become the main signing event. About 65% of FBS signees signed early in 2017, 88% did in 2020 per the NLI, and about 80% was projected for Dec 2024. The ESP moved from the third Wednesday of December to the first week of December starting with Dec 4 to 6, 2024. It ran Dec 3 to 5, 2025 for the 2026 class and is listed as Dec 2 to 4, 2026 for the 2027 class, with February NSD retained (Feb 3, 2027). A proposed June signing period failed (June 2024). Commitments are front-loaded into the spring and June before the senior year.

### Cited Findings
- 2018 class (first ESP, Dec 2017): 65% of the expected FBS signees signed early (247Sports data, per search summary) — [CBS Sports 2018 ESP preview / search set](https://www.cbssports.com/college-football/news/college-football-recruiting-2018-early-signing-period-key-announcement-times-predictions); see also [Athletic Business, "Early Period Eclipses February Signing Day"](https://www.athleticbusiness.com/operations/programming/news/15153189/early-period-eclipses-february-signing-day)
- In 2020, 88% of D-I FBS and 65% of FCS football prospects signed early, per the NLI (search summary) — [search set incl. 247Sports](https://247sports.com/longformarticle/recruiting-intel-top247-prospects-college-football-signing-day-264367426/)
- Dec 2024 (2025 class): about 80% of FBS prospects were expected to sign during the Dec 4 to 6/7 window. This was a projection, not a final tally — [Yahoo Sports](https://sports.yahoo.com/2024-college-football-early-signing-171335458.html)
- An uncited blog claims 85 to 90% of FBS commitments now sign in the ESP. Treat it as unverified — [DonorsWall](https://donorswall.com/blog/when-is-early-signing-day-for-college-football/)
- ESP date change: the CCA endorsed moving the ESP to the first week of December (Dec 4 to 6, 2024), with the transfer portal opening Dec 9. February NSD is unchanged (first Wednesday in Feb; Feb 5, 2025) — [FootballScoop, May 2024](https://footballscoop.com/news/college-football-moving-closer-to-potential-june-signing-period-earlier-december-dates). The ESP now falls in the week before conference championship games — [CBS Sports, June 20 2024](https://www.cbssports.com/college-football/news/june-signing-period-for-college-football-expected-to-be-voted-down-after-failing-to-gain-support-per-reports)
- June signing period: it was proposed for June 25 to 27, 2025 (2026 class). A CCA straw poll showed insufficient support and it was expected to be voted down (June 2024). The December plus February model remains — [CBS Sports, June 20 2024](https://www.cbssports.com/college-football/news/june-signing-period-for-college-football-expected-to-be-voted-down-after-failing-to-gain-support-per-reports)
- 2026 class: the ESP opened Wednesday, Dec 3, 2025 — [Fox Sports, Dec 3 2025](https://www.foxsports.com/stories/college-football/cohen-4-takeaways-early-signing-period)
- 2027 class: the ESP runs Dec 2 to 4, 2026, and NSD (regular period) opens Feb 3, 2027, per NCSA. Other secondary guides give Dec 3 to 5 or Dec 16 to 18, which conflict and look stale — [NCSA](https://www.ncsasports.org/recruiting/managing-recruiting-process/national-signing-day); [NextCommit](https://www.nextcommit.ai/blog/national-signing-day-2027)
- Commitment timing: for 2027, 68.3% of committed SC Next 300 prospects (121) committed between March 1 and June 1, 2026 (ESPN Research, snippet) — [ESPN](https://www.espn.com/college-football/recruiting/story/_/id/48911285/college-football-recruiting-2026-summer-intel-commits-flips-winners-visits). Nearly 60% (177) of the SC Next 300 for 2027 were committed as the OV season began — [ESPN (search summary)](https://africa.espn.com/college-football/recruiting/story/_/id/48911285/college-football-recruiting-2026-summer-intel-commits-flips-winners-visits)
- More than 380 of the 400 Rivals Industry blue-chips in 2026 were committed late in the cycle, with "just five blue-chip recruits remaining uncommitted" in a later On3 piece (snippets) — [On3 by the numbers](https://www.on3.com/rivals/news/college-football-recruiting-breaking-down-the-2026-class-by-the-numbers/); [On3, five uncommitted](https://www.on3.com/rivals/news/just-five-blue-chip-recruits-in-2026-class-remain-uncommitted/); [On3, 10 left](https://www.on3.com/rivals/news/college-football-recruiting-10-blue-chip-prospects-left-in-2026-class/)
- A Group of 5 / FCS-level observer argues the bulk of a 2026 class, "if not the entire class," is committed by the start of the senior season — [Bite-Sized Bison](https://bitesizedbison.substack.com/p/entering-the-2025-recruiting-dead)
- 2016 SEC commitments by month (historical, pre-ESP distribution) — [Saturday Down South](https://www.saturdaydownsouth.com/news/college-football/2016-sec-commitments-by-month/) (not fetched; month values not extracted)

### Inferences
- Estimated cumulative commitment curve for blue-chips in the current era, triangulated from the ESPN and On3 figures:
  - about 10 to 20% committed by Jan 1 of the junior year
  - about 40 to 60% by June 1 before the senior year
  - about 75 to 85% by Aug 1
  - about 90 to 95% by the ESP
  - about 98 to 99% by February
- 3-stars and G5 recruits commit later, often after senior-season offers and camps. They sign disproportionately in February or late in the ESP. This is an estimate.
- Signing split for the sim: about 80 to 90% of FBS HS signees sign in the December ESP, and about 10 to 20% sign in February or later. The sourced points are 65% in 2017, 88% in 2020 and a projected about 80% in 2024.

### Gaps
- No month-by-month commitment histogram for 2015 to 2026 was retrieved, because the SDS 2016 page was not fetched.
- No final, published 2025 or 2026 ESP percentage.
- No share of uncommitted ranked recruits at February NSD beyond the "five uncommitted blue-chips" anecdote.

---

## 5. Decommitments and flips

### Takeaway
The only systematic published rates are old. Of Rivals100 prospects from 2007 to 2011, 14.6% decommitted at some point. Coaching changes trigger mass decommitments: Penn State's 2026 class saw 19 decommitments after James Franklin was fired, and about 10 Penn State commits followed him to Virginia Tech. I found no current flip rate by star level.

### Cited Findings
- Rivals100, 2007 to 2011: 73 of 500 (14.6%) decommitted at some point — [SI "Commitment Project," Jan 2012](https://www.si.com/more-sports/2012/01/20/commitment-project)
- An earlier SI "Commitment Project" (Aug 2011) using RSCI top-100 for 2007 to 2011 found 83 of 502 (16.5%) decommitted. **Caution:** RSCI is a basketball index, so this is likely a basketball study and not applicable to football — [SI, Aug 2011](https://www.si.com/more-sports/2011/08/05/commitment-trends)
- Florida State: 21 of 33 decommitments over four classes were blue-chips (just under 64%), including two 5-stars — [Tomahawk Nation, 2023](https://www.tomahawknation.com/florida-state-seminoles-football-recruiting-fsu-class-commit-visit-offer-transfer-portal-news-college-cfb/2023/3/22/23607608/high-school-sec-rivals-norvell-class-players-coach-napier-cristobal-rankings-gators-hurricanes)
- Miami 2020 class: 20 decommits (12 four-stars, 8 three-stars) — same search set (Tomahawk Nation)
- Coaching change effects (2026 class): Penn State had 19 decommitments after firing James Franklin — [Pro Football Network](https://www.profootballnetwork.com/cfb/james-franklin-on-flipping-penn-state-recruits-after-19-decommitments/). Virginia Tech gained about 10 former Penn State commits after Franklin moved there, and Ole Miss commits (Barber, Anderson, Miret) moved to LSU (after Lane Kiffin's move) during the Dec 2025 ESP — [Fox Sports, Dec 3 2025](https://www.foxsports.com/stories/college-football/cohen-4-takeaways-early-signing-period)
- Signing-day flips of elite players: QB Jared Curtis (No. 1-ranked QB) flipped from Georgia to Vanderbilt, and Kayden Dixon-Wyatt flipped from Ohio State to USC during the Dec 2025 ESP. 5-star WR Chris Henry Jr. (an Ohio State commit) delayed signing — [Fox Sports](https://www.foxsports.com/stories/college-football/cohen-4-takeaways-early-signing-period)
- Academic: Twitter data can predict decommitments ("The turf is always greener," Decision Support Systems, 2018) — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S016792361830160X)
- An unsourced College Football 25 guide gives "stability" of 5-star 68%, 4-star 78% and 3-star 88%. It is not real data, so do not use it as evidence — [sportssurge](https://sportssurge.alibaba.com/football/can-players-decommit-in-college-football-25)
- Trackers exist but publish no rates: [247Sports 2025 decommit tracker](https://247sports.com/longformarticle/college-football-decommits-tracking-2025-prospects-whose-recruitments-reopen-before-signing-day-238846378/); [On3 latest decommits 2026](https://www.on3.com/recruiting/latest-decommits/?sport=football&year=2026); [CBS live tracker](https://www.cbssports.com/college-football/news/college-football-recruiting-signing-day-commitments-decommitments/live/)

### Inferences
- Estimate: the baseline decommit probability per committed prospect over a cycle is about 15 to 25% for blue-chips in the NIL/early-commit era. It is likely higher than the 14.6% of 2007 to 2011, because commitments now come earlier and NIL adds late leverage. Not sourced.
- Model the probability as rising with star rating and with time from commit to signing, and falling as the commit's school prestige rises relative to the suitor. Scale it up by roughly 3 to 10x when the head coach is fired or leaves: Penn State lost 19 commits in one class, which is most of a class.
- Most decommits flip to another school (the "flip") rather than staying uncommitted for long, especially in the 2 to 4 weeks around the ESP. This is an estimate.

### Gaps
- No current decommit or flip rate by star rating from 247/On3/CFBD.
- No count of signing-day flips per year.

---

## 6. Finalists lists and prediction accuracy

### Takeaway
247Sports' lead Crystal Ball predictor (Steve Wiltfong) is about 91 to 92% correct over about 4,200 predictions, with 98.77% claimed for the 2024 cycle. Other analysts run about 80 to 85%. I found no data on typical finalist list sizes.

### Cited Findings
- Wiltfong's all-time record is 91.33% (SI). A later SI piece says about 92% of about 4,200 predictions. The 2018 cycle was 434/474 (91.56%) — [Eleven Warriors, Feb 2018](https://www.elevenwarriors.com/11w/2018/02/90951/eleven-warriors-andrew-lind-andrew-ellis-finish-fourth-sixth-in-2018-247sports-crystal-ball-rankings); [SI](https://www.si.com/fannation/college/cfb-hq/ncaa-football-picks/college-football-recruiting-georgia-dylan-raiola-prediction)
- Wiltfong was 98.77% correct in the 2024 cycle (SI, per search summary) — [SI / search set](https://www.si.com/fannation/college/cfb-hq/ncaa-football-picks/college-football-recruiting-georgia-dylan-raiola-prediction)
- Other Crystal Ball analysts in 2018 (Eleven Warriors writers placed 4th and 6th) were 85.21% and 80.75% — [Eleven Warriors](https://www.elevenwarriors.com/11w/2018/02/90951/eleven-warriors-andrew-lind-andrew-ellis-finish-fourth-sixth-in-2018-247sports-crystal-ball-rankings)
- Example of a finalist and visit structure: a prospect with three OVs (Auburn, Texas A&M, UCF) and a set decision timeline — [SI](https://www.si.com/college/recruiting/football/three-official-visits-decision-timeline-clear-for-caden-story-auburn-tamu-ucf)

### Inferences
- These accuracy figures are biased upward because analysts often log picks shortly before a decision. A sim "favorite wins" rate should depend on time before the decision. Estimate about 60 to 70% months out and about 85 to 92% in the final days.
- Estimate: blue-chips commonly announce a top 8 to 10 in the winter or spring of the junior year, cut to a top 3 to 5 before June OVs, and commit from that set most of the time. Not sourced.

### Gaps
- No data on the typical size of finalist lists, or on how often a recruit commits outside the announced finalists.
- No measured accuracy for On3 RPM predictions.

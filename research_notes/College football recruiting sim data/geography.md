# Geography of College Football High School Recruiting (FBS, ~2010-2026)

Method note: research date 2026-10-22. Most primary pages (On3/Rivals, Esri, Eleven Warriors, CornNation, Georgetown Voice, Harvard Sports Analysis) returned HTTP 403/500 to the fetch tool, so many figures below come from search-engine summaries of those pages rather than full-text reads. Those items are marked "(snippet)". Re-verify them before using them as hard constants. Items marked ESTIMATE are my own inferences, not sourced numbers.

## Q1. Which states produce the most FBS signees and blue-chip recruits (absolute and per capita)?

### Takeaway
Texas, Florida and Georgia are the top three producers of FBS high school signees. In the 2025 class, Texas had about 368, Florida 294 and Georgia 257. California, Ohio, Louisiana, Alabama and North Carolina form the next tier (that tier is from widely known patterns, not a source fetched here). Per capita, the Deep South (Georgia, Louisiana, Mississippi, Alabama, Florida) leads. I found no fresh all-state per-capita table for blue-chips.

### Cited Findings
- 2025 class FBS high school signees: Texas led the nation with 368 FBS letters of intent, Florida was second with 294 (all from high school) and Georgia was third with 257 (snippet). — [Dave Campbell's Texas Football, "Recruiting by the Numbers: State of Texas Reclaims Dominance" (Aug 11, 2025)](https://www.texasfootball.com/article/2025/08/11/recruiting-by-the-numbers-texas-reclaims-dominance). The full article redirected to davecampbells.com and returned 404.
- The same article computes per-capita rates only for Texas UIL classifications, not for states (snippet). — [Dave Campbell's Texas Football](https://www.texasfootball.com/amp/article/2025/08/11/recruiting-by-the-numbers-texas-reclaims-dominance)
- An Axios/SB Nation (Banner Society) piece mapped blue-chip recruits by state for 2015-19 and noted that the picture "changes little annually" (snippet). — [Banner Society via Axios link](https://link.axios.com/click/25741844.19/aHR0cHM6Ly93d3cuYmFubmVyc29jaWV0eS5jb20vMjAxOS84LzE0LzIwNzQ3Mzc5L2NvbGxlZ2UtZm9vdGJhbGwtcGxheWVycy1tYXAtd2hlcmUtZnJvbT91dG1fc291cmNlPW5ld3NsZXR0ZXImdXRtX21lZGl1bT1lbWFpbCZ1dG1fY2FtcGFpZ249c2VuZHRvX2xvY2FsbmV3c2xldHRlcnRlc3Qmc3RyZWFtPXRvcA/613b89d6ca76e632c69b8c4bB170e5cbe)
- Mississippi produced 61 four- or five-star players over roughly 2008-2015 (8 years), about 7.6 per year from a state of about 3M people (snippet). — [FSU Tomahawk Nation (2016)](https://www.tomahawknation.com/florida-state-football-recruiting-fsu-class-commit-visit-offer/2016/12/27/14089832/cam-akers-mississippi-ole-miss-state-player-leave)
- Texas produced 58 four-star recruits over the five years before 2019 in one counting (snippet; the counting basis is unclear and likely a single service). — [Last Word on Sports (2019)](https://lastwordonsports.com/collegefootball/2019/08/04/keeping-texas-high-school-football-recruits-in-state/)

### Inferences
- ESTIMATE for sim seeding: about 2,600-3,000 high school FBS signees per year nationally (roughly 138 teams x about 20 high school signees). Using the 2025 counts, Texas would be about 12-14%, Florida about 10-11% and Georgia about 9-10%. The top three states would then supply roughly a third of all FBS high school signees.
- ESTIMATE: a per-capita ordering of blue-chips, from general knowledge of 247Sports Composite data and not verified here: Georgia ≈ Louisiana ≈ Mississippi ≈ Alabama > Florida > Texas ≈ South Carolina > Ohio > California. California is a large absolute producer but below average per capita.
- The Texas article's "reclaims" framing suggests Florida or Georgia had come close to or matched Texas in some recent years. Year-to-year rank swaps among the top three are plausible.

### Gaps
- No verified national state-by-state table of FBS signees or blue-chips for 2026 or 2027 was retrieved. A 2026 FBS-signees-by-state search returned only team pages.
- Recommended data pull: the CFBD API `/recruiting/players` endpoint (it has state, stars, committedTo and hometown lat/long) to compute exact counts, per-capita rates and distances for 2010-2026.

## Q2. What share of recruits sign in their home state, and how does it vary by star rating and by state?

### Takeaway
Elite recruits have increasingly left home. About 60% or more of top recruits stayed in-state in 2002-04. The split was about 50/50 in 2012. By 2018, 63% of the Rivals100 signed out of state, and another series shows the in-state share falling from 51.2% (2008) to 32.5% (2019). Retention varies widely by state: Mississippi kept about 84% of its blue-chips, Florida and Texas historically kept about 60-65% of elite players, and Alabama and Maryland retain poorly.

### Cited Findings
- Rivals100 trend: 60% or more chose in-state schools in 2002-2004; there was an exact 50/50 split in 2012; 2012-2015 was roughly even; and in 2018, 63 of 100 (63%) signed out of state, "the highest ever." — [FootballScoop summarizing Rivals/Hero Sports (Apr 2018)](https://www.footballscoop.com/2025/03/04/study-shows-top-recruits-signing-state-schools)
- The share of top recruits staying in-state fell from 51.2% in 2008 to 32.5% in 2019 (snippet). — [Georgetown Voice (Aug 2020)](https://georgetownvoice.com/2020/08/12/if-recruiting-becomes-more-geography-based-post-covid-who-benefits-and-who-loses-out)
- Five-stars from 2002 onward stayed in-state at these rates: California 65%, Texas 53.7%, Florida about two-thirds. Across all Rivals100 prospects, Florida kept 64.2% and Texas 61.1% (snippet). — [Rivals, "Five-star choice: should I stay or should I go"](https://n.rivals.com/news/five-star-choice-should-i-stay-or-should-i-go-1)
- Texas kept 30 of 58 four-star recruits in-state over the five years before 2019, or about 50% (snippet). — [Last Word on Sports (2019)](https://lastwordonsports.com/collegefootball/2019/08/04/keeping-texas-high-school-football-recruits-in-state/)
- Mississippi kept 51 of 61 four- and five-star players in-state over eight years, or 84% (snippet). — [Tomahawk Nation (2016)](https://www.tomahawknation.com/florida-state-football-recruiting-fsu-class-commit-visit-offer/2016/12/27/14089832/cam-akers-mississippi-ole-miss-state-player-leave)
- Alabama schools kept only 29% of in-state recruits, and Maryland ranked 43rd of 51 (the 50 states plus DC) in in-state retention (snippet). — [Capital News Service, "6 Charts that Prove Maryland Football is Bad at Recruiting in Maryland" (2016)](https://cnsmaryland.org/interactives/spring-2016/maryland-football-recruiting/index.html)
  - Caveat: the 29% figure for Alabama seems inconsistent with Alabama and Auburn's strong in-state hold on blue-chips. It may be measuring all recruits, including those who signed at FCS or Group of 5 schools outside the state. Treat it as unverified.

### Inferences
- ESTIMATE for the sim: the in-state probability falls with star rating. Suggested starting values for 2020s classes are 5-star about 30-35%, 4-star about 35-45%, 3-star about 45-55% and 2-star/unrated FBS signees about 55-65%. These are anchored on the 32.5% for top recruits (2019) and the 63% out-of-state Rivals100 figure. The 3-star and below values are extrapolated and unsourced.
- ESTIMATE: apply a per-state multiplier. States with one or two dominant in-state flagship powers and modest talent supply (Mississippi, Louisiana with LSU, Georgia, Ohio, Oklahoma) retain more. High-volume states with many suitors (Texas, Florida, California) retain about 50-65% historically, and the share is falling. Low-population or weak-flagship states (Maryland, New Jersey, Pennsylvania-East, DC, Hawaii, Nevada, Arizona) export most of their blue-chips.
- Absolute talent supply vs in-state seat count matters. Florida (294 signees in 2025) and Georgia (257) produce far more FBS players than their in-state FBS rosters can absorb, so most of their 3-stars must leave the state by construction.

### Gaps
- No source measuring in-state rate by star level for all FBS signees (including 2- and 3-stars) was retrieved.
- No post-2019 national in-state percentage was verified. The 2025 FootballScoop URL republishes the 2018 data.

## Q3. Typical hometown-to-college distance by star level and program tier

### Takeaway
The average FBS player comes from about 450-510 miles away, but the median is much lower, about 225 miles, because the distribution is right-skewed. Class-level average commit distances in 2027 cycles range from about 180 miles (Mississippi State) to about 600 miles (Vanderbilt). Higher-rated players travel farther and attract more national suitors, though I found no clean star-level medians.

### Cited Findings
- The average FBS player comes from 446 miles from school, and the average Pac-12 recruit from 836 miles (snippet; the article's year is unclear, likely mid-2010s). — [The Gazette (Cedar Rapids)](https://www.thegazette.com/?p=150844)
- Average distance for 2013 recruits was 512 miles. The analysis also noted that the higher the star rating, the more likely SEC and Pac-12 schools are to be involved (qualitative) (snippet). — [CornNation, "The 500 mile radius..." (Feb 2013)](https://www.cornnation.com/2013/2/19/4003606/the-500-mile-radius-an-even-greater-obstacle-for-nebraska-football)
- Esri analysis of the recruits of 2023 playoff teams: 509 players, overall median 226 miles. Georgia's median was 152 miles with 60% from in-state, and Michigan was 27% in-state (snippet). — [Esri ArcGIS Blog, college football recruiting patterns](https://www.esri.com/arcgis-blog/?p=1805912) / [also](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/college-football-recruiting-patterns)
- 2027-cycle average commit distance (Rivals/On3; commit lists, not final signees): SEC low was Mississippi State at 178 miles and high was Vanderbilt at 601 miles. Big Ten low was Iowa at 240 miles and high was Rutgers at 423 miles (snippet). — [On3/Rivals SEC](https://www.on3.com/rivals/news/ranking-sec-recruiting-classes-via-average-commit-distance-2027); [On3/Rivals Big Ten](https://www.on3.com/news/ranking-big-ten-recruiting-classes-via-average-commit-distance-october)
- Esri's "Air Mile Index" describes Clemson's footprint as highly local (snippet). — [Esri, Air Mile Index](https://www.esri.com/arcgis-blog/products/analytics/analytics/air-mile-index-visualizing-a-recruitment-footprint)
- ESPN mapped ESPNU 150 recruits from 2007-11, i.e., where elite recruits went (PDF graphic). — [ESPN The Magazine recruiting map (2012)](https://a.espncdn.com/pdf/2012/0125/mag_0206recruiting_map.pdf)
- Coaching rule of thumb: recruit within about an 8-10 hour drive (Dr. Gary Green, cited) (snippet). — [Georgetown Voice (2020)](https://georgetownvoice.com/2020/08/12/if-recruiting-becomes-more-geography-based-post-covid-who-benefits-and-who-loses-out)

### Inferences
- ESTIMATE, median distance by star: 5-star about 400-600 miles, 4-star about 300-400, 3-star about 200-250, 2-star/Group of 5 about 120-200. This is anchored on the overall median of about 226, a mean of about 450-510 and the qualitative "higher stars travel farther."
- ESTIMATE, by tier: blue-blood or national programs (Ohio State, Alabama, Notre Dame, USC, Oregon) have average class distances of about 500-900 miles. Regional Power 4 programs average about 200-400 miles. Group of 5 programs average about 150-300 miles, dominated by in-state and adjacent-state players. Schools in low-talent states (Vanderbilt, Rutgers, Nebraska, Iowa State, Utah, Boston College, the Mountain West) skew farther, because they have to import players. The exception is Iowa at 240 miles, which recruits locally with lower-ranked players.

### Gaps
- No public study reporting median distance by star rating was retrieved. CFBD player hometown lat/long plus school coordinates would compute it directly.

## Q4. Recruiting footprints and pipeline states for major programs; Group of 5 recruiting

### Takeaway
Home-state share varies widely. Georgia is about 60% in-state (Esri, 2023 playoff roster). Ohio State's roster is about 44-47% Ohioans. Michigan is about 27% in-state. National brands such as Notre Dame, USC (post-2024) and Oregon recruit much more nationally. Verified per-program numbers were scarce.

### Cited Findings
- Georgia: 60% within-state and a median distance of 152 miles (2023 playoff analysis). Michigan: 27% within-state (snippet). — [Esri ArcGIS Blog](https://www.esri.com/arcgis-blog/?p=1805912)
- Ohio State 2026 roster: 52 of 119 players are from Ohio (≈44%), 63 of 119 were 4-star+ recruits, there are 5 Alabama natives and 6 Georgia natives, and Ohio State added more transfers from Alabama than from any other school in the 2026 offseason (snippet). — [Eleven Warriors 2026 Season Preview (Aug 2026)](https://www.elevenwarriors.com/ohio-state-football/2026/08/163526/2026-season-preview-how-ohio-state-s-roster-stacks-up-by-the-numbers); [Eleven Warriors on Alabama transfers (Feb 2026)](https://www.elevenwarriors.com/ohio-state-football/2026/02/161634/another-trio-of-alabama-transfers-bolsters-ohio-states-2026-defense)
- Ohio State 2025 roster: 56 of 120 players from Ohio (≈47%) (snippet). — [Eleven Warriors 2025 Season Preview](https://www.elevenwarriors.com/ohio-state-football/2025/08/157193/2025-season-preview-how-ohio-state-s-roster-stacks-up-by-the-numbers)
- An Eleven Warriors article (July 2026) describes Alabama as "fertile recruiting ground" for Ohio State (Karlos May commitment). — [Eleven Warriors (Jul 2026)](https://www.elevenwarriors.com/ohio-state-football-recruiting/2026/07/163056/alabama-s-emergence-as-fertile-recruiting-ground-for-ohio-state-continues-with-karlos-may-s-commitment)
- The 33rd Team ranked schools by the share of top in-state prospects they signed over 10 years (2021; numbers not retrieved). — [The 33rd Team](https://www.the33rdteam.com/?p=2916)
- Saturday Down South covered SEC coaches keeping top talent at home (numbers not retrieved). — [Saturday Down South](https://www.saturdaydownsouth.com/news/college-football/sec-coaches-keep-top-talent-home/)
- Maryland has historically failed to land its own in-state talent (2016 data story). — [CNS Maryland](https://cnsmaryland.org/interactives/spring-2016/maryland-football-recruiting/index.html)
- Mountain West rosters and transfer intake by origin, as a Group of 5 example (numbers not retrieved). — [MWC Connection (2024)](https://www.mwcconnection.com/2024/10/16/24259951/mountain-west-football-2024-season-transfer-portal-part-1)

### Inferences (ESTIMATES for sim pipelines; based on general knowledge and not verified here)
- Ohio State: Ohio about 40-47% of the roster (sourced). Secondary states are Florida, Georgia, Pennsylvania, Michigan, Texas, California, Maryland/DC/Virginia (DMV) and Alabama (rising).
- Alabama: Alabama about 25-35%. Secondary states are Georgia, Florida, Texas, Louisiana, Mississippi, Tennessee, the Carolinas and California.
- Georgia: Georgia about 55-60% (sourced from the 2023 sample). Secondary states are Florida, Alabama, the Carolinas and Tennessee.
- Clemson: South Carolina plus Georgia and North Carolina form the core, and the footprint is "highly local" (Esri). Georgia is often equal to or larger than South Carolina.
- Texas: Texas about 70-80% of high school signees, with secondary states Louisiana, Oklahoma, Arizona and California.
- Michigan: Michigan about 25-30% (sourced 27%), with secondary states Ohio, Florida, Georgia, the DMV, Pennsylvania/New Jersey and California.
- Penn State: Pennsylvania about 25-35%, with secondary states New Jersey, Maryland/DMV, Ohio, New York and Virginia.
- Oregon: Oregon about 10-15% because of the state's small talent base. California is the largest source at about 30-40%, with Washington, Texas, Arizona, Hawaii, Florida and Georgia also contributing.
- USC: California about 50-65%, with secondary states Texas, Arizona, Nevada, Washington, Hawaii and Georgia.
- Notre Dame: Indiana is under 10%. Recruiting is national, with Ohio, Illinois, Michigan, Texas, California, Florida, Georgia, Pennsylvania and the Northeast all significant.
- Group of 5: roughly 50-75% of high school signees come from the home state, with most of the rest from adjacent states. Exceptions include Group of 5 schools in Florida, Texas and Georgia that recruit locally, and Mountain West and Sun Belt schools in low-talent states, which import from California, Texas, Florida and Georgia. Group of 5 teams also take many Power 4 departures through the portal.

### Gaps
- Verified home-state percentages for Alabama, Texas, USC, Clemson, Notre Dame, Penn State and Oregon were not retrieved because the fetches were blocked. Compute them from CFBD recruiting data (filter by committedTo and stateProvince).

## Q5. How the transfer portal, NIL and realignment have changed geography

### Takeaway
Elite recruits were already leaving home more often before the portal and NIL (the out-of-state share rose steadily from 2008 to 2019). Distance from home predicts transferring: players more than 300 miles from home transfer at above-average rates. Big Ten westward expansion produced only a "slow burn" in Midwest-to-California recruiting at first. California and Pacific Northwest talent has since become more nationalized, for example Ohio State and Oregon.

### Cited Findings
- 247Sports data for the 2016-2021 classes: of 16,964 recruits, 24.6% entered the portal and 16.2% transferred. Recruits who attend school 50 miles or less from home have the lowest transfer rates, those 200-300 miles away transfer at about the average rate, and the rate rises beyond 300 miles. — [Bud Davis, "Statistical Properties of the CFB Transfer Portal (Part 1)", CFB Numbers Substack (2022)](https://cfbnumbers.substack.com/p/statistical-properties-of-the-cfb)
- Higher-rated players are more likely to transfer, particularly to stronger NIL environments (thesis abstract, 2025). — [Claremont McKenna thesis](https://scholarship.claremont.edu/cmc_theses/4002)
- About 1,000 FBS players entered the portal on opening day of the 2025-26 window, nearly double the prior year's Day 1 total. — [Front Office Sports](https://frontofficesports.com/article/transfer-portal-chaos-record-moves-star-qbs-and-nil-deals-reshape-cfb/)
- AP (Nov 2022): after USC and UCLA announced their Big Ten move, only 12 high school juniors and seniors from Pac-12 states had committed to Big Ten schools, and only 4 of them after the June 30 announcement. A Penn State staffer described the shift as a "slow burn." Illinois staff cited flight logistics favoring Florida, Atlanta and Texas. One Big Ten commit list showed 40 prospects from Florida but only 4 from California. — [AP via KUTV](https://kutv.com/sports/college/usc-ucla-may-cause-big-ten-schools-to-expand-recruiting-map-southern-california-pac-12-big-ten-west-coast-college-sports)

### Inferences
- ESTIMATE: in the sim, apply a portal transfer hazard that increases with distance from home (lowest within 50 miles, rising past 300 miles), and a hazard that increases with star rating when a higher-NIL suitor exists.
- ESTIMATE: realignment and conference membership add a "conference footprint" bonus. Since 2024, schools in the 18-team Big Ten get a modest boost in California, Oregon and Washington, and SEC schools get one in Texas and Oklahoma. Ramp this bonus up over 3-5 years rather than applying it all at once.
- Portal transfers likely depend less on geography than high school recruiting does, since many moves follow money, playing time and coaches. The distance decay for transfers should be flatter. This is commentary plus inference, not measured.

### Gaps
- No quantitative post-2021 study measuring the change in average recruit distance under NIL and the portal was found.

## Q6. Quantitative models of recruiting distance decay

### Takeaway
I found no published logistic or gravity model with fitted coefficients for probability of signing versus distance. The available evidence is descriptive: a median of about 225 miles, a mean of about 450-510 miles, a heavy tail, the 8-10 hour driving-radius heuristic, and transfer risk rising past 300 miles.

### Cited Findings
- Descriptive anchors (see Q3): median 226 miles (Esri), mean 446 miles (Gazette), mean 512 miles for 2013 (CornNation), a 500-mile radius concept (CornNation), an 8-10 hour drive (Green via Georgetown Voice), and transfer risk rising beyond 300 miles (Bud Davis).
- A Colby College undergraduate project (2014) appears to study recruiting geography or distance (abstract only, not retrieved). — [Colby Digital Commons](https://digitalcommons.colby.edu/clas/2014/program/309/)

### Inferences (ESTIMATE: proposed sim model, not from a source)
- Utility for recruit r and school s: U = b_prestige*P_s + b_fit + b_inState*1[same state] + b_conf*1[school's conference footprint covers r's state] - b_dist(stars)*log(1 + d/100mi). Choose via softmax over the schools that offered.
- Calibrate so the overall median distance is about 220-230 miles and the mean is about 450-500, the overall in-state share for blue-chips is about 35-40% (2020s), and the 5-star in-state share is about 30-35%.
- Make b_dist decrease with stars, so 5-stars are least sensitive to distance. Values like 5★ 0.5, 4★ 0.8, 3★ 1.1 and 2★ 1.4 (relative) are a reasonable starting guess to tune.
- On the school side, the pursuit radius should depend on tier. National programs pursue 5-stars and high 4-stars anywhere. Regional Power 4 programs focus on about 500 miles plus pipeline states. Group of 5 programs focus on about 300 miles plus portal transfers.

### Gaps
- No fitted coefficients are available. Fit them on CFBD recruit data (hometown lat/long against school location) with conditional logit, using each recruit's top offers as the choice set if offer data is available.

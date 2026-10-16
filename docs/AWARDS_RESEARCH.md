# Season awards: research and design

Research for giving out every end-of-season award in the sim: player of the year awards,
position awards, All-America and all-conference teams, conference awards, coach awards.
Sources are the Wikipedia pages named in each section, read on October 15-16, 2026.
Part 2 maps every award to the stats the engine already keeps or must start keeping, and
Part 3 is the implementation plan.

## Part 1A. National awards catalog

Source: National College Football Awards Association page and its navbox; the player of
the year list; the Maxwell, Walter Camp and Touchdown Club of Columbus pages. "n/g" means
the page did not give it. Touchdown Club of Columbus awards were cancelled in January 2020
and are listed as defunct.

### Player of the year
| Award | Honors | Selector | Since | Rule |
|---|---|---|---|---|
| Heisman Trophy | most outstanding player | Heisman Trust (media + former winners + fan vote) | 1935 | none |
| Maxwell Award | college player of the year | Maxwell Football Club | 1937 | none |
| Walter Camp Award | player of the year | Walter Camp Foundation (FBS coaches and SIDs vote) | 1967 | none |
| AP Player of the Year | player of the year | Associated Press | 1998 | none |
| Sporting News Player of the Year | player of the year | Sporting News | 1942 | none |
| Polynesian Player of the Year | outstanding player of Polynesian descent | Polynesian FB Hall of Fame | 2014 | ancestry (needs a flag we do not have) |
| Paul Hornung Award | most versatile player | Louisville Sports Commission | 2010 | plays several roles (returns + offense) |
| Lombardi Award | lineman/linebacker, now any position "best performance" | Rotary Club of Houston | 1970 | historically OL/DL/LB |

### Offensive position awards
| Award | Honors | Rule |
|---|---|---|
| Davey O'Brien Award | quarterback | none |
| Manning Award | quarterback (counts bowl games) | announced after bowls |
| Johnny Unitas Golden Arm Award | quarterback | seniors (or fourth-year) only |
| Doak Walker Award | running back | none |
| Fred Biletnikoff Award | receiver (any position that catches passes) | none |
| John Mackey Award | tight end | none |
| Outland Trophy | interior lineman, offense or defense (G, C, T, DT) | not DE |
| Rimington Trophy | center | centers only |
| Joe Moore Award | best offensive line (unit award) | team unit |
| Jacobs Blocking Trophy | best blocker (regional, ACC/SEC-era history) | skip |

### Defensive awards
| Award | Honors | Rule |
|---|---|---|
| Chuck Bednarik Award | defensive player of the year (Maxwell Club) | none |
| Bronko Nagurski Trophy | defensive player of the year (FWAA) | none |
| Lott IMPACT Trophy | defensive player, performance plus character | none |
| Butkus Award | linebacker | LB only |
| Jim Thorpe Award | defensive back | CB or S |
| Ted Hendricks Award | defensive end | DE only |
| Outland Trophy | defensive tackle eligible (see above) | interior |

### Special teams
| Award | Honors | Rule |
|---|---|---|
| Lou Groza Award | place-kicker | K |
| Ray Guy Award | punter | P |
| Jet Award | return specialist | returner role |
| Patrick Mannelly Award | long snapper | no long snappers in the rosters; skip |
| Peter Mortell Holder of the Year | holder | skip |

### Freshman / newcomer
| Award | Honors | Rule |
|---|---|---|
| Shaun Alexander Freshman of the Year (Maxwell Club) | top freshman | freshman class (needs class year) |

### Coach awards
| Award | Selector | Since |
|---|---|---|
| AFCA Coach of the Year | AFCA | 1935 |
| Eddie Robinson Coach of the Year | FWAA | 1957 |
| Sporting News Coach of the Year | Sporting News | 1963 |
| Walter Camp Coach of the Year | Walter Camp Foundation | 1967 |
| Bobby Dodd Coach of the Year | Dodd Trophy committee (also weighs academics and character) | 1976 |
| Paul "Bear" Bryant Award | NSAC, announced in January | 1986 |
| George Munger Award | Maxwell Club | 1989 |
| Home Depot Coach of the Year | ESPN | 1994 |
| AP Coach of the Year | Associated Press | 1998 |
| Bobby Bowden Coach of the Year | FCA | 2009 |
| Broyles Award | assistant coach of the year | 1996 |
| AFCA Assistant Coach of the Year | AFCA | n/g |

### Character, academic, service (no on-field criteria; need data the sim lacks)
Campbell Trophy (academic), Wuerffel Trophy (community service), Burlsworth Trophy
(walk-on), Disney Spirit Award, Uplifting Athletes, Senior CLASS Award, Academic
All-America, Rudy Award, Comeback Player of the Year (needs injuries, which the sim does
not model yet), Stallings Award and Buddy Teevens Award (coaches).

### Regional
Earl Campbell Tyler Rose Award (Texas ties), Jon Cornish Trophy (Canadian), Conerly and
Kent Hull trophies (Mississippi), Dudley Award (Virginia), Nelson Award (New England),
Brian Westbrook Tri-State (PA/NJ/DE), Walter Camp CT Player of the Year. These need
hometown or school-state data: school state is available, hometown is not.

### Defunct
UPI Player of the Year (1950-1991), Chic Harley Award and Archie Griffin Award (Touchdown
Club, to 2018), ESPY best college player (1993-2001), Paterno Award (2010-2011), and all
Touchdown Club of Columbus position awards (Sammy Baugh, Jim Brown, Paul Warfield, Jim
Parker, Bill Willis, Jack Lambert, Jack Tatum, Kellen Moore, Ozzie Newsome, Woody Hayes,
Zuppke, Freshman of the Year, Vlade).

## Part 1B. All-America teams

Source: "All-America college football team" and "2024 All-America college football team".

- Five selectors count toward consensus: AP, AFCA (coaches), FWAA (writers), Sporting
  News, Walter Camp (coaches and sports information directors). A player named first team
  by more than half of them (3 of 5) is a consensus All-American; by all five, unanimous.
  The NCAA compiles it by points per position; second and third teams break ties.
- Consensus first team slots (2024, 27 players because of ties): QB 1, RB 2, WR 3, TE 1,
  OL 5 (one of them a center; selectors list a separate C slot), DL 4 to 5, LB 3, DB 4,
  K 1, P 1, all-purpose/return specialist 1. DL and DB are not split by sub-position on the
  consensus team; the navbox splits them as OT 3, OG 1, C 1, DE 3, DT 2, CB 2, S 2.
- AFCA also names a long snapper; it is not part of the consensus team.
- Each selector also names a second team (AP, Walter Camp) and some a third.
- 2024 unanimous: Jeanty (RB), Nash (WR), Banks (OT), Carter (DL), Graham (DT), Higgins
  (LB), Downs (S), Hunter (AP). 2024 first-team QB: Cam Ward (4 of 5), Gabriel (FWAA).
- The page carries no stat lines; winner stat profiles come from the award pages (Part 1D).

## Part 1C. All-conference teams and conference awards (2024)

| Conference | Selectors | Teams | First-team slots | Awards |
|---|---|---|---|---|
| SEC | coaches; AP media | AP 2 teams; coaches 3 | QB 1, RB 2, WR 2, C 1, OL 4, TE 1, DE 2, DT 2, LB 3, DB 4, K, P, AP/RS | Offensive POY, Defensive POY, Special Teams POY, Freshman of the Year, Newcomer of the Year, Coach of the Year (AP and coaches can differ), Jacobs Blocking Trophy, Scholar-Athlete |
| Big Ten | coaches (offense and defense units); media panel | 3 teams each | QB 1, RB 2, WR 2, C 1, G 2, T 2, TE 1; DL 4, LB 4, DB 4; K, P, RS, LS | named awards: Graham-George Offensive POY, Nagurski-Woodson Defensive POY, Silver Football (MVP), Thompson-Randle El Freshman, Rimington-Pace OL, Richter-Howard Receiver, Ameche-Dayne RB, Griese-Brees QB, Kwalick-Clark TE, Smith-Brown DL, Butkus-Fitzgerald LB, Tatum-Woodson DB, Bakken-Andersen K, Eddleman-Fields P, Rodgers-Dwight Return Specialist, Hayes-Schembechler and Dave McClain Coach of the Year (verify on the conference page) |
| Big 12 | coaches; media panel | 2 teams each plus honorable mention | QB 1, RB 2, FB 1 (coaches), C 1, G 2, T 2, TE 1 to 2, WR 3; DL 4 to 5, LB 3, DB 4 to 5; K, P, AP/RS | Offensive POY, Defensive POY, Offensive and Defensive Freshman/Newcomer, Special Teams, Offensive and Defensive Lineman, Coach of the Year (verify) |
| ACC | conference vote | 3 teams | QB 1, RB 2, WR 3, TE 1, all-purpose 1, T 2, G 2, C 1; DE 2, DT 2, LB 3, CB 2, S 2; PK, P, specialist | Player of the Year, Offensive POY, Defensive POY, Rookie of the Year, Offensive and Defensive Rookie, Coach of the Year, Jacobs Blocking Trophy (ACC) |
| American | head coaches | 3 teams | WR 3, OT 2, OG 2, RB 2, C 1, TE 1, QB 1; DL 4, LB 4, CB 2, S 2; K, P, RS | Offensive POY, Defensive POY, Special Teams POY, Rookie of the Year, Coach of the Year |
| Mountain West | coaches | 2 teams | QB 1, RB 2, WR 3, TE 1, OL 5, PK, KR; DL 4, LB 4, DB 4, PR, P | Offensive POY, Defensive POY, Special Teams POY, Freshman POY, Coach of the Year |
| Sun Belt | coaches | 3 teams | QB 1, RB 2, OL 5, TE 1, WR 3; DL 4, LB 3, DB 5; K, P, RS, AP | Player of the Year, Offensive POY, Defensive POY, Freshman POY, Newcomer of the Year, Coach of the Year |
| MAC | coaches | 3 teams | QB 1, OL 5, TE 1, WR 4, RB 2, PK; DL 4, LB 4, DB 4, P; returners 2 | Offensive POY, Defensive POY, Special Teams POY, Freshman POY, Vern Smith Leadership Award (MVP), Coach of the Year |
| Conference USA | conference | 2 teams plus a Freshman All-Conference team | QB 1, RB 2, WR 3, TE 1, OL 5; DE 2, DT 2, LB 3, DB 4; K, P, KR, PR, LS | MVP, Offensive POY, Defensive POY, Special Teams POY, Freshman of the Year, Newcomer of the Year, Coach of the Year |
| Pac-12 | coaches | 2 teams | (2026 Pac-12 is the rebuilt eight-team league; use the Mountain West format) | Offensive POY, Defensive POY, Freshman, Coach of the Year (verify) |

## Part 1D. Who wins each award (2014-2025 winners from each award's page)

The award pages carry names, positions and schools but no stat lines; stat thresholds
come from Sports-Reference in Part 1E.

| Award | Winners 2014-2025 (position, school) | Pattern |
|---|---|---|
| Maxwell | Mariota QB Oregon; Henry RB Alabama; L. Jackson QB Louisville; Mayfield QB Oklahoma; Tagovailoa QB Alabama; Burrow QB LSU; D. Smith WR Alabama; B. Young QB Alabama; C. Williams QB USC; Penix QB Washington; Jeanty RB Boise State; Mendoza QB Indiana | 9 QB, 2 RB, 1 WR; title contenders; one Group of Five winner |
| Walter Camp | same as Maxwell except K. Walker RB Michigan State 2021, J. Daniels QB LSU 2023, T. Hunter CB/WR Colorado 2024 | matches Maxwell 9 of 12 |
| AP Player of the Year | Heisman winner 11 of 12 (McCaffrey 2015 the exception) | effectively the Heisman |
| Davey O'Brien (QB) | Mariota, Watson x2, Mayfield, Murray, Burrow, M. Jones, B. Young, Duggan, Daniels, Ward, Mendoza | Heisman winner or finalist nearly every year; playoff teams |
| Unitas Golden Arm (upperclass QB) | Mariota, Cook, Watson, Rudolph, Minshew, Burrow, M. Jones, Pickett, Duggan, Daniels, S. Sanders, Pavia | junior or senior; mid-tier teams common |
| Doak Walker (RB) | M. Gordon, Henry, Foreman, B. Love, J. Taylor x2, N. Harris, K. Walker, B. Robinson, O. Gordon, Jeanty, J. Love | top-10 team not required (Wisconsin x4, Oklahoma State, Boise State) |
| Biletnikoff (receiver) | Cooper, Coleman, Westbrook, Washington, Jeudy, Chase, D. Smith, Addison, Hyatt, Harrison, Hunter, Lemon | always a WR; high-volume passing teams, many outside the top 10 |
| Mackey (TE) | O'Leary, H. Henry, Butt, Andrews, Hockenson, H. Bryant, Pitts, McBride, Bowers x2, Warren, Stowers | spread across tiers (FAU, Colorado State, Vanderbilt) |
| Outland (interior line) | Scherff OT, Garnett G, C. Robinson OT, Oliver DT, Q. Williams DT, Sewell OT, Leatherwood OT, J. Davis DT, Oluwatimi C, Sweat DT, Banks OT, Fano OT | 8 OL, 4 DT; mostly playoff-level teams |
| Rimington (C) | Dismukes, Kelly, Elflein, Price, Bradbury, Biadasz, Dickerson, Linderbaum, Oluwatimi, Powers-Johnson, McLaughlin, L. Jones | the consensus All-America center |
| Lombardi | S. Wright LB, Nassib DE, J. Allen DT, (2017-20 not recognized), Hutchinson DE, W. Anderson LB, Latu DE, Banks OT, Rodriguez LB | tracks Bednarik/Nagurski |
| Bednarik (defensive POY) | S. Wright LB Arizona, Matakevich LB Temple, J. Allen DT, Fitzpatrick S, J. Allen LB Kentucky, C. Young DE, Z. Collins LB Tulsa, J. Davis DT, W. Anderson LB, P. Wilson LB NC State, Hunter CB, Rodriguez LB Texas Tech | 7 LB; production beats team ranking |
| Nagurski (defensive POY) | same as Bednarik 8 of 12; differs: Chubb DE NC State 2017, W. Anderson 2021, X. Watts S Notre Dame 2023, Kennard DE South Carolina 2024 | 6 LB, 4 DE, 1 S |
| Butkus (LB) | Kendricks, Jaylon Smith, Foster, Roquan Smith, D. White, Simmons, Owusu-Koramoah, Dean, J. Campbell, P. Wilson, Walker, Rodriguez | mostly playoff-caliber teams |
| Thorpe (DB) | Holliman S, King CB, A. Jackson CB, Fitzpatrick S, Baker CB, Delpit S, Moehrig S, C. Bryant CB, Hodges-Tomlinson CB, T. Taylor S Air Force, Barron CB, Downs S | 6 CB, 6 S; ranking weak predictor |
| Hendricks (DE) | Orchard, Nassib, J. Allen, Chubb, Ferrell, C. Young, none 2020, Hutchinson, Murphy (Div. II), Latu, Ezeiruaku, Bain | sack production |
| Groza (K) | Craddock, Fairbairn, Z. Gonzalez, Gay, Szmyt, Blankenship, Borregales, Moody, Dunn, Nicholson (Miami OH), Almendares (Louisiana), Sandell | mostly non-elite teams |
| Ray Guy (P) | Hackett x2, Wishnowsky, Dickson, Mann, Duffy, Harvin, Araiza, Korsak, T. Taylor, Czaplicki, Thorson | team ranking irrelevant |
| Jet (returner) | Lockett, McCaffrey, A. Jackson, Pettis, Scarver, Reed, A. Williams, M. Jones, D. Davis, Branch, Wetjen x2 | WR/RB/CB who return; any tier |
| Hornung (versatile) | S. Thompson, McCaffrey, Peppers, Barkley, R. Moore, Bowden, D. Smith, M. Jones, Colletto, Hunter x2, Concepcion | offense plus returns, or two-way |
| Shaun Alexander Freshman | Lawrence QB, Gainwell RB, W. Anderson LB, Bowers TE, Maye QB, Downs S, Simmons DE, Sayin QB | since 2018; title programs 6 of 8 |
| Joe Moore (OL unit) | Alabama x2, Iowa x2, Notre Dame, Oklahoma, LSU, Michigan x2, Washington, Army | elite or run-heavy lines; continuity counts |
| Broyles (assistant) | Herman OC, L. Riley OC, Venables DC, Elliott OC, Locksley OC, Brady, Sarkisian OC, Gattis OC, G. Riley OC, Parker DC, Golden DC, Haines DC | 8 OC, 4 DC; playoff teams |
| AP Coach of the Year | Patterson TCU, Swinney, MacIntyre Colorado, Frost UCF, B. Kelly, Orgeron, Chadwell Coastal, Harbaugh, Dykes TCU, DeBoer, Cignetti x2 | surprise seasons dominate |
| Eddie Robinson (FWAA) | matches AP 8 of 12; differs Ferentz Iowa 2015, Clark UAB 2018, Fickell Cincinnati 2021, Lea Vanderbilt 2025 | even more toward overachievers |

## Part 1E. The Heisman Trophy, 2014-2025

Sources: the Heisman Trophy page (selection process), the list of winners, and the
"Heisman Trophy voting" tables on each season's FBS page (verbatim 2018-2025).

**How the vote works.** 870 media voters, 145 from each of six regions (Far West,
Mid-Atlantic, Midwest, Northeast, South, Southwest), plus every living past winner (57)
and one fan vote. Each ballot ranks three players, 3-2-1 points; a ballot with fewer than
three names or a duplicate is invalid. About 925 ballots are cast, so roughly 2,780 points
are possible. Voting closes after championship weekend and before the bowls; the ceremony
is the second Saturday of December (Dec 14 in 2019). Bowl and playoff games never count.

**Winners.** Record and rank are at the final CFP ranking release.

| Year | Winner | Pos | School | Class | Rec / CFP rank | Points (1st) | % of max |
|---|---|---|---|---|---|---|---|
| 2014 | Marcus Mariota | QB | Oregon | Jr | 12-1 / 2 | 2,534 (788) | 90.9 |
| 2015 | Derrick Henry | RB | Alabama | Jr | 12-1 / 2 | 1,832 (378) | 65.7 |
| 2016 | Lamar Jackson | QB | Louisville | So | 9-3 / 13 | 2,144 (526) | 79.5 |
| 2017 | Baker Mayfield | QB | Oklahoma | Sr | 12-1 / 2 | 2,398 (732) | 86.0 |
| 2018 | Kyler Murray | QB | Oklahoma | Jr | 12-1 / 4 | 2,167 (517) | 77.8 |
| 2019 | Joe Burrow | QB | LSU | Sr | 13-0 / 1 | 2,608 (841) | 93.8 |
| 2020 | DeVonta Smith | WR | Alabama | Sr | 11-0 / 1 | 1,856 (447) | 66.8 |
| 2021 | Bryce Young | QB | Alabama | So | 12-1 / 1 | 2,311 (684) | 83.0 |
| 2022 | Caleb Williams | QB | USC | So | 11-2 / 10 | 2,031 (544) | 72.9 |
| 2023 | Jayden Daniels | QB | LSU | Sr | 9-3 / 13 | 2,029 (503) | 72.9 |
| 2024 | Travis Hunter | WR/CB | Colorado | Jr | 9-3 / 23 | 2,231 (552) | 80.1 |
| 2025 | Fernando Mendoza | QB | Indiana | Jr | 13-0 / 1 | 2,362 (643) | 84.7 |

**Top five by year** (first-place votes, points, record and rank):

- 2014: Mariota QB 788/2,534; M. Gordon RB Wisconsin 37/1,250 (10-3, 18); A. Cooper WR Alabama 49/1,023 (12-1, 1); Boykin QB TCU 218; Barrett QB Ohio State 78.
- 2015: Henry RB 378/1,832; McCaffrey RB Stanford 290/1,539 (11-2, 6); Watson QB Clemson 148/1,165 (13-0, 1); Mayfield QB 334; K. Reynolds QB Navy 180 (10-2, 21).
- 2016: L. Jackson QB 526/2,144; Watson QB 269/1,524 (2); Mayfield 361; Westbrook WR Oklahoma 209; Peppers LB Michigan 208.
- 2017: Mayfield QB 732/2,398; B. Love RB Stanford 75/1,300 (9-4, 13); L. Jackson 793 (8-4, unranked); Barkley RB Penn State 304; R. Penny RB San Diego State 175.
- 2018: Murray QB 517/2,167; Tagovailoa QB Alabama 299/1,871 (13-0, 1); Haskins QB Ohio State 783; Grier QB West Virginia 126 (8-3); Minshew QB Washington State 122.
- 2019: Burrow QB 841/2,608; Hurts QB Oklahoma 762; Fields QB Ohio State 747; C. Young DE Ohio State 20/643; J. Taylor RB Wisconsin 189.
- 2020: D. Smith WR 447/1,856; Lawrence QB Clemson 222/1,187; M. Jones QB Alabama 138/1,130; Trask QB Florida 737 (8-3); N. Harris RB Alabama 216.
- 2021: B. Young QB 684/2,311; Hutchinson DE Michigan 78/954 (12-1, 2); Pickett QB Pittsburgh 631 (11-2, 12); Stroud QB Ohio State 399; W. Anderson LB Alabama 325.
- 2022: C. Williams QB 544/2,031; Duggan QB TCU 188/1,420 (12-1, 3); Stroud 539; S. Bennett QB Georgia 349 (13-0, 1); Hooker QB Tennessee 226.
- 2023: Daniels QB 503/2,029; Penix QB Washington 292/1,701 (13-0, 2); Nix QB Oregon 885; Harrison WR Ohio State 352; Travis QB Florida State 85.
- 2024: Hunter WR/CB 552/2,231; Jeanty RB Boise State 309/2,017 (12-1, 9; more second-place votes than Hunter); Gabriel QB Oregon 516 (13-0, 1); Ward QB Miami 229; Skattebo RB Arizona State 170.
- 2025: Mendoza QB 643/2,362; Pavia QB Vanderbilt 189/1,435 (10-2, 14); J. Love RB Notre Dame 719; Sayin QB Ohio State 432; Rodriguez LB Texas Tech 295.

**What the vote rewards (the model should encode this):**
1. Position: 9 of 12 winners were QBs; one RB, one WR, one two-way star. Of 60 top-five
   slots, about 36 went to QBs, 12 RBs, 5 WRs, 6 defenders. No pure defender has won;
   the best pure-defense finishes were Hutchinson 2nd (2021) and Chase Young 4th (2019).
2. Team: 8 of 12 winners were on teams ranked 1-4 with at most one loss. Three winners came
   from 3-loss teams (Jackson 2016, Daniels 2023, Hunter 2024) on the strength of dominant
   individual numbers; a 4-loss player has finished as high as 2nd (B. Love 2017). The
   typical finalist's team is 10-2 to 13-0 and in the top ten.
3. Production beats pedigree once the team is good: the QB of the best team is not
   automatically the winner (Gabriel 3rd in 2024 at 13-0, Bennett 4th in 2022 at 13-0,
   Travis 5th in 2023 at 13-0). The winner is usually the national leader or near it in
   total yards and touchdowns responsible for, with a 3-loss ceiling in practice.
4. Group of Five players reach the top five about once every three years (Reynolds 2015,
   Penny 2017, Jeanty 2nd in 2024) but have not won in this era.
5. Freshmen do not win; sophomores do (Jackson, Young, Williams).

## Part 1F. Conference individual awards (exact names, 2024 winners)

Source: each conference's "football individual awards" page.

- **ACC** (Atlantic Coast Sports Media Association): Player of the Year (Cam Ward QB),
  Offensive POY (Ward), Defensive POY (Ezeiruaku DE), Rookie of the Year (Isaac Brown RB),
  Offensive Rookie (Brown), Defensive Rookie (Sammy Brown LB), Coach of the Year (Lashlee,
  SMU), Brian Piccolo Award (courage; Eli Pancol WR Duke), Jacobs Blocking Trophy (ACC).
- **American** (head coaches): Offensive POY (Bryson Daily QB Army), Defensive POY (Jimmori
  Robinson LB UTSA), Special Teams POY (Jonah Delange K UAB), Rookie of the Year (Joseph
  Williams WR Tulsa), Coach of the Year (Monken, Army).
- **Big 12** (coaches): Offensive POY (Shedeur Sanders QB), Defensive POY (Travis Hunter CB),
  Special Teams POY (Ferrin K BYU and Noel PR Iowa State, co-winners), Offensive Newcomer
  (Tyson WR Arizona State), Defensive Newcomer (Green DE Colorado), Offensive Freshman
  (Leavitt QB Arizona State), Defensive Freshman (Trotter LB West Virginia), Offensive
  Lineman (Milum T West Virginia), Defensive Lineman (Mott DE Kansas State), Coach of the
  Year (Dillingham, Arizona State).
- **Big Ten** (coaches and media): Graham-George Offensive POY (Gabriel QB Oregon),
  Nagurski-Woodson Defensive POY (Carter DE Penn State), Thompson-Randle El Freshman
  (Jeremiah Smith WR Ohio State), Hayes-Schembechler Coach of the Year (Cignetti, Indiana;
  the Dave McClain award was the media version 1986-2010), Griese-Brees QB (Gabriel),
  Ameche-Dayne RB (Kaleb Johnson Iowa), Richter-Howard Receiver (J. Smith), Kwalick-Clark
  TE (Warren Penn State), Rimington-Pace OL (Ersery OT Minnesota), Smith-Brown DL (Carter),
  Butkus-Fitzgerald LB (Higgins Iowa), Tatum-Woodson DB (Downs S Ohio State),
  Bakken-Andersen K (Zvada Michigan), Eddleman-Fields P (Czaplicki USC), Rodgers-Dwight
  Return Specialist (Wetjen Iowa); Chicago Tribune Silver Football (MVP, external); the
  Ford-Kinnick and Dungy-Thompson awards go to alumni (skip).
- **Conference USA** (head coaches): MVP (Tyler Huff QB Jacksonville State), Offensive POY
  (Veltkamp QB WKU), Defensive POY (Barnes LB FIU), Special Teams POY (Carneiro PK WKU),
  Freshman of the Year (McKinney RB Sam Houston), Newcomer of the Year (Huff), Coach of
  the Year (Rodriguez, Jacksonville State).
- **MAC** (media; Vern Smith by coaches): Offensive POY (Fannin TE Bowling Green),
  Defensive POY (Dolac LB Buffalo), Special Teams POY (Gillie RS Ball State), Freshman POY
  (Semonza QB Ball State), Vern Smith Leadership Award (MVP; Fannin), Coach of the Year
  (Albin, Ohio).
- **Mountain West** (coaches and media panel): Offensive POY (Jeanty), Defensive POY
  (Woodard LB UNLV), Special Teams POY (Ricky White WR UNLV), Freshman of the Year
  (Chittenden PK UNLV), Coach of the Year (Danielson, Boise State).
- **Pac-12** (coaches; the two-team 2024-25 league gave only "Top Performers"): Offensive
  POY, Pat Tillman Defensive POY, Offensive and Defensive Freshman of the Year, Morris
  Trophy (best offensive and defensive lineman, voted by opposing players), Coach of the
  Year. For the rebuilt 2026 league use this full set.
- **SEC** (coaches and AP, can differ): Offensive POY (Sampson RB Tennessee), Defensive
  POY (Kennard DE South Carolina), Special Teams POY (Raynor K Kentucky), Jacobs Blocking
  Trophy (Banks OT Texas and Campbell OT LSU), Freshman of the Year (Sellers QB South
  Carolina), Newcomer of the Year (new 2024; Pavia QB Vanderbilt), Coach of the Year (Lea,
  Vanderbilt by coaches; Beamer, South Carolina by AP).
- **Sun Belt** (coaches): Player of the Year (Mike Green DE Marshall), Offensive POY
  (Wooldridge QB Louisiana), Defensive POY (Watson-Trent LB Georgia Southern), Freshman of
  the Year (Hardy RB ULM), Newcomer of the Year (Braxton QB Marshall), Coach of the Year
  (Desormeaux, Louisiana).

Common to every conference: Offensive POY, Defensive POY, Coach of the Year, a freshman
award. Special teams POY: American, Big 12, Big Ten, CUSA, MAC, Mountain West, SEC.
Newcomer (transfer) award: Big 12, CUSA, SEC, Sun Belt. Overall MVP: ACC, CUSA, MAC (Vern
Smith), Sun Belt, Big Ten (Silver Football). Position awards: Big Ten (full set), Big 12
(OL, DL), SEC and ACC (blocker), Pac-12 (Morris Trophy linemen).

## Part 1G. Winning stat lines (from the players' Wikipedia pages)

Heisman winners and runners-up, award season only:

| Season | Player | Pos | G | Passing C/A, yds, TD, INT | Rushing att, yds, TD | Receiving rec, yds, TD | Other |
|---|---|---|---|---|---|---|---|
| 2014 | Mariota | QB | 15 | 304/445, 4,454, 42, 2 | 135, 770, 15 | | 181.7 rating |
| 2015 | Henry | RB | 15 | | 395, 2,219, 28 | 11, 91, 0 | |
| 2016 | L. Jackson | QB | 13 | 230/409, 3,543, 30, 9 | 260, 1,571, 21 | | 148.8 |
| 2017 | Mayfield | QB | 14 | 285/404, 4,627, 43, 6 | 97, 311, 5 | | 198.9 |
| 2018 | Murray | QB | 14 | 260/377, 4,361, 42, 7 | 140, 1,001, 12 | | 199.2 |
| 2019 | Burrow | QB | 15 | 402/527, 5,671, 60, 6 | 115, 368, 5 | | 202.0 |
| 2020 | D. Smith | WR | | | | 117, 1,856, 23 | led FBS in all three |
| 2021 | B. Young | QB | 15 | 366/547, 4,872, 47, 7 | 81, 0, 3 | | 167.5 |
| 2022 | C. Williams | QB | 14 | 333/500, 4,537, 42, 5 | 113, 382, 10 | | 168.5 |
| 2023 | Daniels | QB | 12 | 236/327, 3,812, 40, 4 | 135, 1,134, 10 | | 208.0; 4,946 total yds, 50 TD |
| 2024 | Hunter | WR/CB | 13 | | | 96, 1,258, 15 | 36 tackles, 4 INT, 11 PBU, 1 FF |
| 2025 | Mendoza | QB | 16 | 273/379, 3,535, 41, 6 | 90, 276, 7 | | 182.9 |
| 2024 2nd | Jeanty | RB | 14 | | 374, 2,601, 29 | 23, 138, 1 | |
| 2025 2nd | Pavia | QB | 13 | 267/378, 3,539, 29, 8 | 167, 862, 10 | | 170.4 |
| 2023 2nd | Penix | QB | 15 | 363/555, 4,903, 36, 11 | 35, 8, 3 | | 157.1 |
| 2022 2nd | Duggan | QB | 15 | 267/419, 3,698, 32, 8 | 137, 423, 9 | | 159.2 |
| 2021 2nd | Hutchinson | DE | 14 | | | | 55 tackles, 15 TFL, 14 sacks, 2 FF |

QB winners: touchdowns responsible for 48 to 65 (median 51), total yards 3,811 to 6,039
(median 4,946), passer rating 149 to 208, interceptions 2 to 9. Note the regular-season
share: voting closes after 13 to 14 games, so the sim compares through championship week.
RB winner or runner-up: 2,200 to 2,600 rushing yards and 28 to 29 TDs; the Heisman RB bar
is far above the Doak Walker bar.

Position award winners (recent):

| Award | Player, season | Line |
|---|---|---|
| Doak Walker | Jeanty 2024 | 374 att, 2,601 yds, 29 TD |
| | O. Gordon 2023 | 285, 1,732, 21; 39 rec 330 |
| | B. Robinson 2022 | 258, 1,580, 18; 19 rec 314 |
| | J. Love 2025 | 199, 1,372, 18; 27 rec 280 |
| Biletnikoff | Harrison 2023 | 67 rec, 1,211 yds, 14 TD (12 games) |
| | Hyatt 2022 | 67, 1,267, 15 |
| | Addison 2021 | 100, 1,593, 17 |
| | Lemon 2025 | 79, 1,156, 11 |
| Mackey | Bowers 2022 | 63, 942, 7 (plus 3 rush TD) |
| | Bowers 2023 | 56, 714, 6 (10 games) |
| | Warren 2024 | 104, 1,233, 8 (plus 4 rush TD) |
| | Fannin 2024 (All-America) | 117, 1,555, 10 |
| Butkus | Higgins 2024 | 124 tackles, 3 TFL, 1 sack, 4 INT, 2 FF, 5 PBU |
| | P. Wilson 2023 | 138 tackles, 6 sacks, 3 INT, 1 FF, 6 PBU |
| | J. Campbell 2022 | 118 tackles, 2 INT, 1 FF |
| Hendricks / edge | W. Anderson 2021 | 102 tackles, 34.5 TFL, 17.5 sacks, 3 FF |
| | Latu 2023 | about 21.5 TFL, 13 sacks, 2 INT |
| | Carter 2024 | 68 tackles, 12 sacks, 2 FF, 4 PBU |
| | Ezeiruaku 2024 | 16.5 sacks |
| Thorpe | Barron 2024 | 67 tackles, 5 INT, 11 PBU |
| | Watts 2023 | 52 tackles, 7 INT, 4 PBU |
| | Downs 2025 | 68 tackles, 2 INT, 5 TFL, 2 FF |
| Groza | Nicholson 2023 | 27/28 FG, long 52, 35/37 PAT, 116 pts |
| | Almendares 2024 | 27/29 FG |
| Ray Guy | T. Taylor 2023 | 93 punts, 48.2 gross, 43.8 net, 32 inside 20, long 67 |
| | Czaplicki 2024 | 45.7 net, 24 inside 20, long 62 |

Typical winning lines, regular season: RB about 1,600 to 1,750 yards and 18 to 21 TDs
(2,600 is a once-a-decade season); WR about 1,200 to 1,300 yards, 14 to 15 TDs, 65 to 80
catches; TE 60 to 100 catches, 700 to 1,200 yards, 6 to 8 TDs; LB 120 to 140 tackles with
a few INTs and sacks; edge 12 to 17 sacks and 15 to 25 TFL; DB 5 to 7 INTs or 10+ PBU on
a good team; K about 27 of 29 with a 50-yarder; P a 44 to 46 net and 25 to 30 inside the
20.

## Part 2. What the sim has, what it needs

### Data the rosters already carry (cfb_sim_data)
- Every player: position, class (FR, FRRS, SO, SORS, JR, JRRS, SR, SRRS), height, weight,
  jersey, archetype, dev trait, overall and full ratings. So freshman awards (true and
  redshirt), the upperclassman rule (Golden Arm) and class tie-breaks are possible. The
  roster builder must start passing class through to the engine rosters.
- Every team: state, conference, prestige, team ratings by position group, and the real
  2026 preseason AP rank for coach-of-the-year expectations.
- Coaches: head coach, offensive and defensive coordinators with names, year hired,
  previous job and ratings. So Broyles (assistant of the year) and coach of the year work.
- Not carried: hometown, transfer status, walk-on status, academics, ancestry, injuries.
  Regional awards, Newcomer of the Year, Burlsworth, Campbell, Wuerffel, Polynesian POY,
  Comeback POY and the Disney Spirit Award cannot be awarded honestly, so they are listed
  as not modelled rather than faked.

### Player stats the engine keeps today
Passing (att, cmp, yds, TD, INT, sacks taken), rushing (att, yds, TD, fumbles), receiving
(targets, rec, yds, TD), defense (solo, assisted, sacks, INT, INT yards, FF, FR, fumble
return yards, defensive TD), kicking (FG att/made, PAT att/made), punting (punts, yards),
returns (KR, yards, TD; PR, yards, TD); games played per player. Team: points, yards,
plays, possession, first downs, third and fourth downs, red zone, penalties, turnovers,
and the opponent's versions.

### Stats to add to the engine (each is a one-line credit in an existing play function)
| Stat | Comes from | Awards that need it |
|---|---|---|
| Tackles for loss | run or completion stopped behind the line: credit the tackler | Butkus, Bednarik, Nagurski, Hendricks, Lombardi, Outland (DT), every DL and LB selection |
| Pass breakups | incomplete pass where the coverage check won: credit the nearest DB or LB | Thorpe, DB selections, defensive POY |
| QB hurries | pass-rush check won without a sack | Hendricks, DL selections |
| Explosive plays (20+ yard runs, 25+ yard catches) | play result | Biletnikoff, Doak Walker, Hornung |
| First downs and third-down conversions by the ball carrier | down and distance | Doak Walker, RB selections |
| Field goals by distance (under 40, 40 to 49, 50+) and long | kicking function | Groza, kicker selections |
| Punts inside the 20, touchbacks, net average | punt function | Ray Guy, punter selections |
| Return long and fair catches | return functions | Jet, return specialist |
| Games started and snaps per player | the drive loop (in_game at the snap) | every selection, OL and DL evaluation, minimum-play rules |
| Offensive line: sacks allowed, pressures allowed, stuffed runs, with each lineman credited by snaps | pass and run functions | Joe Moore, Outland, Rimington, Big 12 and Big Ten OL awards, All-America OL |
| Passer rating (NCAA formula) and yards per attempt | computed from existing stats | O'Brien, Heisman, QB selections |

Offensive linemen have no individual box-score stats in real football either; the awards
follow reputation (ratings), the unit's results and snaps. The sim will do the same: an OL
score is the player's run and pass blocking ratings times snaps played, plus the unit's
sacks-allowed rate and rushing yards per carry relative to the league.

### Awards the sim will give and how each is decided
Scores are standardized season totals (not averages, which matches how voters think)
within the eligible pool, plus a team term where the real award shows one. "Team term"
means points for team wins and final CFP rank; "none" means production only.

| Award | Pool | Score | Team term |
|---|---|---|---|
| Heisman | all players | position-specific production (QB: total yards, total TD, passer rating, INT; RB: rush yds, TD, yds per carry, receiving; WR/TE: yds, TD, rec; defense: TFL + sacks + INT + PBU, scaled so a defender reaches the top five about once in three years) | strong: finalists need 10+ wins or a top-10 rank; a 3-loss player wins only with a dominant production lead |
| Maxwell, Walter Camp, AP POY, Sporting News | all players | the Heisman score with different weights (Walter Camp leans to the best team's star, Maxwell to raw production), each with its own noise so they do not always agree | strong |
| Davey O'Brien | QB | passing yds, TD, rating, INT | medium |
| Manning | QB | the same, computed after the bowls and playoff | medium |
| Unitas Golden Arm | QB, JR or SR only | O'Brien score | medium |
| Doak Walker | RB | rush yds, TD, yds per carry, explosives, receiving | weak |
| Biletnikoff | WR and TE | receiving yds, TD, rec, yds per catch | weak |
| Mackey | TE | receiving yds, TD, rec, plus blocking rating | weak |
| Outland | OL and DT | OL score or DT score | medium |
| Rimington | each team's starting center (OL slot 3 on the depth chart) | OL score | medium |
| Joe Moore | OL units | sacks-allowed rate, rush yds per carry, stuff rate, continuity | medium |
| Lombardi | OL, DL, LB | best of the line and LB scores | medium |
| Bednarik, Nagurski | all defenders | tackles, TFL, sacks, INT, PBU, FF, defensive TD, with LB and DE weighted as the history shows | weak |
| Lott IMPACT | all defenders | the Nagurski score with a team-wins term | medium |
| Butkus | LB (MLB, ROLB, LOLB) | tackles, TFL, sacks, INT, FF | medium |
| Thorpe | CB and S | INT, PBU, tackles, INT return yards | weak |
| Hendricks | edge DL (the two outside DL slots, or the top sack producers) | sacks, TFL, hurries, FF | weak |
| Groza | K | FG%, makes from 40+ and 50+, points, misses | weak |
| Ray Guy | P | net average, inside-20 share, touchbacks | none |
| Jet | kick and punt returners | return yards, average, TDs | none |
| Hornung | players with both offense and return production, or two-way snaps | all-purpose yards and number of roles | weak |
| Shaun Alexander Freshman | class FR or FRRS | the Heisman-style score within freshmen | medium |
| Coach of the Year (AP, AFCA, Eddie Robinson, Dodd, Bryant, Munger, Home Depot) | head coaches | wins minus expected wins (from preseason rank and team rating), conference title, playoff seed, upsets; the AP leans to breakthrough teams, Bryant to the title game, Dodd to the best record | strong |
| Broyles | coordinators | unit rank gain: the offense or defense rank versus the unit's rating rank, plus wins | strong |
| All-America (five selectors, consensus and unanimous) | by position slot | each selector = the position score plus its own noise and bias (AFCA favors top-team players, FWAA production, Walter Camp the coaches' view); consensus = 3 of 5 first teams, unanimous = 5 of 5 | per selector |
| All-conference first, second, third teams | each conference's own slot layout | position scores within the conference; coaches and media versions where the conference has both | per selector |
| Conference OPOY, DPOY, Special Teams POY, Freshman, Coach of the Year, MVP, the Big Ten and Big 12 position awards, Jacobs Blocking Trophy, Morris Trophy | conference members | the national formulas restricted to the conference | as above |

Timing follows the real calendar: conference awards and all-conference teams after
championship week (week 14); Heisman finalists on selection Monday (week 15) with the
ceremony the following Saturday, voting closed before the bowls; All-America teams and the
national position awards in week 16 (the real awards show is the Thursday before the
bowls); the Manning Award, the Bear Bryant coach award and the Joe Moore winner after the
national championship (week 19).

### Heisman voting model
Six regions of 145 media voters plus past winners and a fan vote, 3-2-1 ballots. Each
voter ranks the candidates by the Heisman score with (a) a regional bump for a candidate
whose team plays in the voter's region, (b) a team-quality bias that varies by voter, and
(c) noise. Points and first-place votes are tallied like the real table, finalists are the
top four by points (five when the fifth is within 10%), and the page shows the top ten with
first, second and third counts so the vote reads like the real one. Targets from Part 1E:
winner share of possible points 65 to 94%, a QB wins about three years in four, a top-four
team's star wins about two years in three, a Group of Five finalist about once in three
years, a defender in the top five about once in three years.

## Part 3. Implementation plan

1. Engine stats (play_functions.py, drive_functions.py, game_functions.py): add the
   credits in the table above; extend summarize_stats and the compact season line; verify
   with the seeded 24-game hash that scores do not change (new stats must not touch the
   random stream).
2. Rosters: pass class, height, weight and jersey through build_teams.py into the engine
   rosters; the depth chart order gives starters (OL slot 3 is the center).
3. awards.py (new): award definitions as data (name, pool, score weights, team term,
   timing, selector set), the scoring functions, the Heisman vote simulation, the
   All-America and all-conference selectors, coach and assistant awards. Everything reads
   the season stats, records and polls already in the season state.
4. season.py: run the award steps at weeks 14, 15, 16 and 19 and store them in the state;
   the summary gains the Heisman result (winner, finalists, vote table) and your team's
   awards and placements.
5. server.py: an awards endpoint with everything, and the Summary tab's review gains the
   Heisman winner and finalists.
6. Page: an Awards tab. Your team first (Heisman finishes, All-America and all-conference
   selections, conference awards, coach awards), then every national award with winner and
   finalists, All-America first and second teams with consensus and unanimous marks, and
   each conference's awards and teams.
7. Calibration: run 20 seasons and check the award distributions against Part 1 (Heisman
   position mix and winner team rank, Group of Five finalists, Bednarik winners from
   outside the top 10, Groza and Ray Guy from any tier, coach of the year to
   overachievers), then tune the weights.

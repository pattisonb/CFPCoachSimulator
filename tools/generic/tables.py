"""The lookalike names the published site uses in place of real ones (tools/generic/scrub.py applies them).
Edit freely: every table is `real -> lookalike`. Players and coaches are not listed here; their names are drawn
by scrub.py with the same initials.

House rule for teams: no school keeps its real name, abbreviation, mascot or stadium. A school named for its state
or city goes by its home town or the town's nickname (Texas is Austin, Houston is Space City); a school named for
anything else gets a lookalike (Notre Dame is North Dome, TCU is Texas City). Colors stay.
"""
from __future__ import annotations

# slug -> (short name, abbreviation, mascot). The full name is "<short> University".   *tune*
TEAMS: dict[str, tuple[str, str, str]] = {
    "air-force": ("Air Fleet", "AFL", "Kestrels"),
    "akron": ("Rubber City", "RUB", "Zippers"),
    "alabama": ("Tuscaloosa", "TUSC", "Red Tide"),
    "app-st": ("High Country", "HIGH", "Highlanders"),
    "arizona-state": ("Tempe", "TEMP", "Sun Imps"),
    "arizona": ("Tucson", "TUC", "Desert Cats"),
    "arkansas-state": ("Jonesboro", "JONE", "Red Coyotes"),
    "arkansas": ("Fayetteville", "FAY", "Wild Hogs"),
    "army": ("Armory", "ARMO", "Iron Knights"),
    "auburn": ("The Plains", "PLNS", "Sabertooths"),
    "ball-state": ("Muncie", "MUN", "Robins"),
    "baylor": ("Baywood", "BAYW", "Kodiaks"),
    "boise-state": ("Treasure Valley", "TRV", "Stallions"),
    "boston-college": ("Bay Colony", "BAYC", "Skyhawks"),
    "bowling-green": ("Black Swamp", "SWMP", "Peregrines"),
    "buffalo": ("Nickel City", "NICK", "Stampede"),
    "byu": ("Big Yonder", "YON", "Catamounts"),
    "c-carolina": ("Conway", "CONW", "Roosters"),
    "c-michigan": ("Mount Pleasant", "MTP", "Voyageurs"),
    "california": ("Berkeley", "BERK", "Golden Grizzlies"),
    "charlotte": ("Crown City", "CRWN", "Gold Rush"),
    "cincinnati": ("Queen City", "QC", "Binturongs"),
    "clemson": ("Upstate", "UPST", "Lynx"),
    "colorado-state": ("Fort Collins", "FTC", "Bighorns"),
    "colorado": ("Boulder", "BOUL", "Yaks"),
    "delaware": ("First State", "FRST", "Blue Cluckers"),
    "duke": ("Dukeston", "DUKN", "Blue Imps"),
    "e-michigan": ("Ypsilanti", "YPSI", "Ospreys"),
    "east-carolina": ("Down East", "DOWN", "Buccaneers"),
    "fiu": ("Florida Inlet", "FLI", "Gulf Cats"),
    "fla-atlantic": ("Boca Raton", "BOCA", "Night Owls"),
    "florida-state": ("Tallahassee", "TALL", "Firebirds"),
    "florida": ("Gainesville", "GNV", "Crocs"),
    "fresno-state": ("Central Valley", "CVAL", "Boxers"),
    "ga-southern": ("Statesboro", "SBRO", "Talons"),
    "georgia-state": ("Downtown Atlanta", "DATL", "Black Cats"),
    "georgia-tech": ("Atlanta Tech", "ATLT", "Hornets"),
    "georgia": ("Athens", "ATH", "Mastiffs"),
    "hawai-i": ("Honolulu", "HON", "Wave Riders"),
    "houston": ("Space City", "SPC", "Comets"),
    "illinois": ("Champaign", "CHAM", "Prairie Fire"),
    "indiana": ("Bloomington", "BLM", "Racers"),
    "iowa-state": ("Ames", "AMES", "Twisters"),
    "iowa": ("Iowa City", "IAC", "Kernels"),
    "james-madison": ("James Monroe", "JMO", "Barons"),
    "jax-state": ("Calhoun County", "CALC", "Gamebirds"),
    "kansas-state": ("Little Apple", "LAPP", "Prairie Cats"),
    "kansas": ("Lawrence", "LAW", "Bluebirds"),
    "kennesaw-st": ("Cobb County", "COBB", "Horned Owls"),
    "kent-state": ("Portage County", "PORT", "Lightning"),
    "kentucky": ("Lexington", "LEX", "Thoroughbreds"),
    "liberty": ("Liberty Hill", "LHIL", "Embers"),
    "louisiana-tech": ("Ruston", "RUS", "Hounds"),
    "louisiana": ("Lafayette", "LAF", "Zydeco"),
    "louisville": ("Derby City", "DRBY", "Redbirds"),
    "lsu": ("Baton Rouge", "BTR", "Swamp Cats"),
    "marshall": ("Marshfield", "MRSF", "Rumbling Herd"),
    "maryland": ("College Park", "CPK", "Snappers"),
    "memphis": ("Bluff City", "BLUF", "Kings"),
    "miami-oh": ("Oxford Valley", "OXV", "RedTails"),
    "miami": ("Coral Gables", "CGAB", "Squall"),
    "michigan-state": ("East Lansing", "ELAN", "Hoplites"),
    "michigan": ("Ann Arbor", "A2", "Skunk Bears"),
    "minnesota": ("Twin Cities", "TWIN", "Groundhogs"),
    "mississippi-st": ("Starkville", "STRK", "Bullmastiffs"),
    "missouri-state": ("Springfield", "SPFD", "Brown Bears"),
    "missouri": ("CoMo", "COMO", "Mules"),
    "mtsu": ("Murfreesboro", "BORO", "Blue Bandits"),
    "navy": ("Annapolis", "ANNA", "Deckhands"),
    "nc-state": ("Raleigh", "RAL", "Howlers"),
    "ndsu": ("Fargo", "FAR", "Herd"),
    "nebraska": ("Lincoln", "LINC", "Shuckers"),
    "nevada": ("Reno", "RENO", "Silver Pack"),
    "new-mexico-st": ("Las Cruces", "LCRU", "Ranchers"),
    "new-mexico": ("Albuquerque", "ABQ", "Wolves"),
    "niu": ("DeKalb", "DEK", "Snow Dogs"),
    "north-carolina": ("Chapel Hill", "CHAP", "Pine Tars"),
    "north-texas": ("Denton", "DENT", "Emeralds"),
    "northwestern": ("Evanston", "EVAN", "Lakecats"),
    "notre-dame": ("North Dome", "NDM", "Fighting Clovers"),
    "ohio-state": ("Columbus", "CBUS", "Chestnuts"),
    "ohio": ("Hocking", "HOCK", "Ocelots"),
    "oklahoma-state": ("Stillwater", "STIL", "Wranglers"),
    "oklahoma": ("Norman", "NORM", "Land Runners"),
    "old-dominion": ("Hampton Roads", "HRDS", "Regents"),
    "ole-miss": ("Olde Miss", "OLDE", "Gamblers"),
    "oregon-state": ("Corvallis", "CORV", "Otters"),
    "oregon": ("Eugene", "EUG", "Mallards"),
    "penn-state": ("Happy Valley", "HAPV", "Mountain Lions"),
    "pittsburgh": ("Steel City", "STEL", "Steelcats"),
    "purdue": ("Purdale", "PURD", "Ironworkers"),
    "rice": ("Riceland", "RLND", "Barn Owls"),
    "rutgers": ("Rutledge", "RUTL", "Crimson Lancers"),
    "sac-state": ("River City", "RIVR", "Wasps"),
    "sam-houston": ("Sam Hill", "HILL", "Bearcubs"),
    "san-diego-st": ("Mission Valley", "MVAL", "Condors"),
    "san-jose-state": ("South Bay", "SBAY", "Centurions"),
    "smu": ("Metroplex", "METX", "Colts"),
    "south-alabama": ("Mobile", "MOB", "Leopards"),
    "south-carolina": ("Soda City", "SODA", "Spurs"),
    "southern-miss": ("Hattiesburg", "HATT", "Golden Hawks"),
    "stanford": ("Stanfield", "STNF", "Redwood"),
    "syracuse": ("Salt City", "SALT", "Tangerine"),
    "tcu": ("Texas City", "TXC", "Spiny Lizards"),
    "temple": ("Templeton", "TMPL", "Screech Owls"),
    "tennessee": ("Knoxville", "KNOX", "Smokies"),
    "texas-a-m": ("College Station", "CSTA", "Farmers"),
    "texas-state": ("San Marcos", "SMAR", "Ringtails"),
    "texas-tech": ("Lubbock", "LBK", "Dust Devils"),
    "texas": ("Austin", "ATX", "Steers"),
    "toledo": ("Glass City", "GLAS", "Missiles"),
    "troy": ("Pike County", "PIKE", "Myrmidons"),
    "tulane": ("Tullin", "TULL", "Green Tide"),
    "tulsa": ("T-Town", "TTWN", "Golden Gale"),
    "uab": ("Birmingham", "BHAM", "Dragons"),
    "ucf": ("Orlando", "ORL", "Paladins"),
    "ucla": ("Westwood", "WSTW", "Grizzlies"),
    "uconn": ("Storrs", "STOR", "Sled Dogs"),
    "ul-monroe": ("Monroe", "MONR", "Thunderhawks"),
    "umass": ("Pioneer Valley", "PVAL", "Militia"),
    "unlv": ("Las Vegas", "VEG", "Outlaws"),
    "usc": ("Sunny Cal", "SUNC", "Legionnaires"),
    "usf": ("Tampa Bay", "TPA", "Toros"),
    "utah-state": ("Cache Valley", "CACH", "Ranch Hands"),
    "utah": ("Salt Lake", "SLC", "Redrocks"),
    "utep": ("El Paso", "ELP", "Prospectors"),
    "utsa": ("Alamo City", "ALMO", "Coyotes"),
    "vanderbilt": ("Vandermeer", "VDM", "Admirals"),
    "virginia-tech": ("Blacksburg", "BBRG", "Toms"),
    "virginia": ("Charlottesville", "CVIL", "Swordsmen"),
    "w-kentucky": ("Cave Country", "CAVE", "Hillclimbers"),
    "w-michigan": ("Kalamazoo", "KZOO", "Mustangs"),
    "wake-forest": ("Wake Woods", "WAKW", "Holy Terrors"),
    "washington-st": ("Palouse", "PLSE", "Pumas"),
    "washington": ("Seattle", "SEA", "Malamutes"),
    "west-virginia": ("Morgantown", "MGTN", "Ridge Runners"),
    "wisconsin": ("Madison", "MAD", "Honey Badgers"),
    "wyoming": ("Laramie", "LAR", "Buckaroos"),
}

# Real short names that are not also a place: swapped wherever they stand as whole words. A place name ("Texas",
# "Houston", "North Carolina") is swapped only in the fields that name a team, so states and cities keep theirs.
LOOSE = {
    "Notre Dame", "Baylor", "Boston College", "James Madison", "Purdue", "Rutgers", "Sam Houston", "Stanford", "Tulane",
    "Vanderbilt", "Wake Forest", "UConn", "UMass", "Ole Miss", "Air Force", "Ball State", "BYU", "TCU", "LSU", "SMU",
    "UCLA", "USC", "UCF", "UAB", "FIU", "USF", "UTEP", "UTSA", "UNLV", "NC State", "App State", "Georgia Tech",
    "Texas A&M", "Texas Tech", "Virginia Tech", "Louisiana Tech", "Penn State", "Ohio State", "Michigan State",
    "Florida State", "Iowa State", "Kansas State", "Oklahoma State", "Oregon State", "Arizona State", "Boise State",
    "Colorado State", "Fresno State", "Georgia State", "Kent State", "Kennesaw State", "Mississippi State",
    "Missouri State", "New Mexico State", "San Diego State", "San José State", "Texas State", "Utah State",
    "Washington State", "Arkansas State", "Jacksonville State", "Sacramento State", "North Dakota State",
    "Coastal Carolina", "Central Michigan", "Eastern Michigan", "Western Michigan", "Western Kentucky",
    "East Carolina", "Florida Atlantic", "Georgia Southern", "Middle Tennessee", "Northern Illinois", "Old Dominion",
    "Southern Miss", "UL Monroe", "Miami (OH)", "Northwestern", "Clemson",      # not "Auburn": it is also a hair color
}
# The fields of the data that name a team: a place-named school is swapped here and nowhere else.
TEAM_KEYS = {"team", "name", "winner", "loser", "short_name", "home", "away", "opponent", "school", "alma_mater"}

# Campus towns named for the school itself.
CITIES = {"air-force": "Colorado Springs", "notre-dame": "South Bend"}

# Real mascots that belong to one school and read as its name wherever they appear.
DISTINCT_MASCOTS = {
    "Crimson Tide", "Razorbacks", "Sun Devils", "Red Wolves", "Black Knights", "Chanticleers", "Chippewas",
    "Golden Bears", "Bearcats", "Buffaloes", "Fightin' Blue Hens", "Blue Devils", "Seminoles", "Gators",
    "Yellow Jackets", "Rainbow Warriors", "Fighting Illini", "Hoosiers", "Cyclones", "Hawkeyes", "Jayhawks",
    "Golden Flashes", "Ragin' Cajuns", "Thundering Herd", "Terrapins", "RedHawks", "Hurricanes", "Wolverines",
    "Golden Gophers", "Blue Raiders", "Midshipmen", "Wolfpack", "Cornhuskers", "Wolf Pack", "Lobos", "Tar Heels",
    "Mean Green", "Fighting Irish", "Buckeyes", "Sooners", "Nittany Lions", "Boilermakers", "Scarlet Knights",
    "Bearkats", "Aztecs", "Gamecocks", "Golden Eagles", "Horned Frogs", "Volunteers", "Red Raiders", "Longhorns",
    "Green Wave", "Golden Hurricane", "Bruins", "Minutemen", "Utes", "Commodores", "Hokies", "Cavaliers",
    "Hilltoppers", "Demon Deacons", "Zips", "Thundering Herd", "Roadrunners", "Warhawks", "Mountaineers",
}

# Team colors whose names carry a school's name.   *tune*
COLOR_NAMES = {
    "Air Force Blue": "Academy Blue", "Arizona Blue": "Desert Blue", "Arizona Red": "Desert Red",
    "Beaver Blue": "Otter Blue", "Berkeley Blue": "Bay Blue", "California Gold": "Golden State Gold",
    "Carolina Blue": "Sky Blue", "Chicago Maroon": "Maroon", "Clemson Orange": "Orange", "Duke Blue": "Royal Blue",
    "Hayes Hall Gray": "Hall Gray", "Midnight Murphy": "Midnight", "Pitt Gold": "Gold", "Pitt Royal": "Royal",
    "Spartan Blue": "Blue", "Stanford Black": "Black", "Tech Gold": "Gold", "UB Blue": "Blue", "Utah Red": "Red",
    "Wolfpack Red": "Red", "Burnt Orange": "Rust Orange",
}
# Schools whose exact shade is itself protected: their colors move a hair (COLOR_NUDGE per channel), everyone else's
# stay exactly as they are.   *tune*
NUDGE_COLORS = {"texas", "north-carolina", "tennessee", "syracuse", "clemson", "michigan", "alabama", "ohio-state",
                "notre-dame", "oklahoma", "florida", "lsu", "purdue", "texas-a-m", "duke", "nebraska", "usc", "ucla"}
COLOR_NUDGE = 6   # *tune* how far a protected shade moves, out of 255 a channel

CONFERENCES = {
    "American Athletic Conference": "National Athletic Conference", "Atlantic Coast Conference": "Atlantic Coast League",
    "Southeastern Conference": "Southeastern League", "Mid-American Conference": "Mid-Continent League",
    "ACC": "ACL", "Big Ten": "Big Eighteen", "Big 12": "Big Dozen", "Conference USA": "Conference America",
    "C-USA": "C-AM", "CUSA": "CAM", "MAC": "MAL", "Mountain West": "Mountain Time", "Pac-12": "Pac-Dozen",
    "SEC": "SEL", "Sun Belt": "Heat Belt",
}
# Conference short forms the app shows that are ordinary words: swapped only where they stand alone.
CONFERENCES_EXACT = {"American": "National"}

BOWLS = {
    "College Football Playoff National Championship": "National Title Game",
    "Rose Bowl": "Thorn Bowl", "Fiesta Bowl": "Siesta Bowl", "Peach Bowl": "Nectarine Bowl",
    "Cotton Bowl": "Denim Bowl", "Orange Bowl": "Clementine Bowl", "Sugar Bowl": "Molasses Bowl",
    "Salute to Veterans Bowl": "Thank a Veteran Bowl", "Frisco Football Classic": "Suburb Football Classic",
    "Boca Raton Bowl": "Rat's Mouth Bowl", "Gasparilla Bowl": "Buccaneer Bowl", "Myrtle Beach Bowl": "Grand Strand Bowl",
    "Famous Idaho Potato Bowl": "Famous Spud Bowl", "Puerto Rico Bowl": "Isla Bowl", "Cure Bowl": "Remedy Bowl",
    "Independence Bowl": "Declaration Bowl", "New Orleans Bowl": "Crescent City Bowl",
    "Armed Forces Bowl": "Service Branch Bowl", "Poinsettia Bowl": "Mistletoe Bowl", "Frisco Bowl": "Suburb Bowl",
    "New Mexico Bowl": "Enchantment Bowl", "Hawaii Bowl": "Luau Bowl", "Pinstripe Bowl": "Seersucker Bowl",
    "Fenway Bowl": "Green Wall Bowl", "Duke's Mayo Bowl": "Aioli Bowl", "68 Ventures Bowl": "67 Ventures Bowl",
    "Cactus Bowl": "Succulent Bowl", "Military Bowl": "Mess Hall Bowl", "Holiday Bowl": "Day Off Bowl",
    "Birmingham Bowl": "Magic City Bowl", "Pop-Tarts Bowl": "Toaster Pastry Bowl", "Alamo Bowl": "Mission Bowl",
    "Gator Bowl": "Croc Bowl", "Music City Bowl": "Honky Tonk Bowl", "ReliaQuest Bowl": "Cyber Quest Bowl",
    "Sun Bowl": "Sunscreen Bowl", "Las Vegas Bowl": "Neon Bowl", "Texas Bowl": "Lone Star Bowl",
    "Citrus Bowl": "Zest Bowl", "First Responder Bowl": "First on Scene Bowl", "Arizona Bowl": "Dry Heat Bowl",
    "Liberty Bowl": "Freedom Bell Bowl",
}

# Named rivalry games. One not listed here is named for its two teams ("Florida-Georgia").
RIVALRIES = {
    "The Game": "The Big One", "Iron Bowl": "Steel Bowl", "Army-Navy Game": "Armory-Naval Game",
    "Red River Rivalry": "Red Creek Rivalry", "Crosstown Rivalry": "Across-Town Rivalry",
    "Cy-Hawk Game": "Twister-Kernel Game", "Border War": "Border Feud", "Sunflower Showdown": "Sunflower Standoff",
    "Bedlam Series": "Mayhem Series", "Lone Star Showdown": "Lone Star Standoff", "Revivalry": "Revival",
    "Sunshine Showdown": "Sunshine Standoff", "Deep South's Oldest Rivalry": "The Deep South's Eldest Feud",
    "Clean, Old-Fashioned Hate": "Good, Clean Hate", "Palmetto Bowl": "Palm Tree Bowl",
    "Third Saturday in October": "Fourth Saturday in October", "Magnolia Bowl": "Dogwood Bowl",
    "Egg Bowl": "Omelet Bowl", "Battle for the Golden Boot": "Battle for the Gilded Boot",
    "Southwest Classic": "Southwestern Classic", "Governor's Cup": "Mayor's Cup",
    "Commonwealth Clash": "Commonwealth Scuffle", "Backyard Brawl": "Front Yard Brawl", "Apple Cup": "Orchard Cup",
    "Big Game": "Large Game", "Holy War": "Sunday Feud", "Territorial Cup": "Statehood Cup",
    "Rocky Mountain Showdown": "Front Range Standoff", "Rumble in the Rockies": "Ruckus in the Rockies",
    "Battle for the Victory Bell": "Battle for the Winner's Bell", "Battle for the Milk Can": "Battle for the Cream Can",
    "Battle for the Fremont Cannon": "Battle for the Silver State Cannon",
    "Border War (Bronze Boot)": "Border Feud (Brass Boot)", "Battle for the Old Oil Can": "Battle for the Rusty Oil Can",
    "Battle of I-75": "Battle of the Interstate", "Battle of the Bricks": "Battle of the Cobblestones",
    "Battle for the Victory Cannon": "Battle for the Winner's Cannon", "Bayou Bucket Classic": "Bayou Pail Classic",
    "Battle for the Iron Skillet": "Battle for the Cast-Iron Pan", "Battle for the Belt": "Battle for the Buckle",
    "Deeper Than Hate": "Beyond Dislike", "Battle on the Bayou": "Brawl on the Bayou", "War on I-4": "Feud on the Freeway",
    "Battle Line Rivalry": "State Line Rivalry", "Battle for the Wagon Wheel": "Battle for the Cart Wheel",
    "Rio Grande Rivalry": "Big River Rivalry", "Battle of I-10": "Battle of the Desert Highway",
    "Shula Bowl": "Coach's Bowl", "Old Wagon Wheel": "Old Cart Wheel",
}

# Rivalry trophies. One not listed here loses its name (the game is then played for no named trophy).
TROPHIES = {
    "Foy-ODK Trophy": "Sportsmanship Trophy", "Commander-in-Chief's Trophy": "Commandant's Trophy",
    "Golden Hat": "Gilded Hat", "Jeweled Shillelagh": "Jeweled Walking Stick", "Victory Bell": "Winner's Bell",
    "Paul Bunyan's Axe": "Lumberjack's Axe", "Floyd of Rosedale": "Bronze Pig", "Old Oaken Bucket": "Old Wooden Bucket",
    "Paul Bunyan Trophy": "Lumberjack Trophy", "Little Brown Jug": "Small Brown Jug",
    "Land of Lincoln Trophy": "Prairie State Trophy", "Heroes Trophy": "Hometown Trophy",
    "Illibuck": "Wooden Turtle", "Cy-Hawk Trophy": "Twister-Kernel Trophy", "Purdue Cannon": "Old Cannon",
    "Old Brass Spittoon": "Old Brass Pot", "Land Grant Trophy": "Land Deed Trophy", "Indian War Drum": "Marching Drum",
    "Governor's Cup": "Mayor's Cup", "Bedlam Bell": "Mayhem Bell", "Chancellor's Spurs": "Dean's Spurs",
    "Hardee's Trophy": "Palm Tree Trophy", "Magnolia Bowl Trophy": "Dogwood Bowl Trophy", "Golden Egg": "Golden Omelet",
    "Golden Boot": "Gilded Boot", "Southwest Classic Trophy": "Southwestern Classic Trophy",
    "Commonwealth Cup": "Commonwealth Mug", "Legends Trophy": "Old Timers Trophy",
    "Shillelagh Trophy": "Walking Stick Trophy", "Platypus Trophy": "Echidna Trophy", "Apple Cup": "Orchard Cup",
    "Stanford Axe": "The Hatchet", "Territorial Cup": "Statehood Cup", "Centennial Cup": "Front Range Cup",
    "Milk Can": "Cream Can", "Fremont Cannon": "Silver State Cannon", "Bronze Boot": "Brass Boot",
    "Old Oil Can": "Rusty Oil Can", "Peace Pipe": "Friendship Trophy", "Victory Cannon": "Winner's Cannon",
    "Bayou Bucket": "Bayou Pail", "Iron Skillet": "Cast-Iron Pan", "The Belt": "The Buckle",
    "Wooden Boot": "Wooden Shoe", "War on I-4 Trophy": "Freeway Trophy", "Battle Line Trophy": "State Line Trophy",
    "Freedom Trophy": "Liberty Bell Trophy", "Heartland Trophy": "Breadbasket Trophy", "Wagon Wheel": "Cart Wheel",
    "Maloof Trophy": "Big River Trophy", "Silver Spade": "Silver Shovel", "Black Diamond Trophy": "Coal Seam Trophy",
    "Don Shula Trophy": "Coach's Trophy", "Old Wagon Wheel": "Old Cart Wheel",
}

# Awards, leagues and networks named in the game's own words (Python and the app). Longest first wins.   *tune*
MARKS = {
    "College Football Playoff": "National Championship Playoff", "CFP": "NCP",
    "Commander in Chief's Trophy": "Commandant's Trophy", "Commander-in-Chief's Trophy": "Commandant's Trophy",
    "Heisman Trophy": "Stiff-Arm Trophy", "Heisman": "Stiff-Arm",
    "Biletnikoff": "Billingsley", "Butkus": "Buckley", "Thorpe": "Thornton", "Outland": "Trenches",
    "Maxwell": "Maxfield", "Doak Walker": "Dash Walker", "Davey O'Brien": "Danny O'Malley", "Mackey": "Mackenzie",
    "Nagurski": "Novak", "Bednarik": "Bednar", "Lombardi": "Lombardo", "Rimington": "Rimmer",
    "Lou Groza": "Lou Garza", "Ray Guy": "Ray Gunn", "Broyles": "Boyles",
    "NFL": "Pro", "NCAA": "NCFA", "ESPN": "TV", "Nielsen": "ratings",
    "AP Top 25": "Press Top 25", "AP Poll": "Press Poll", "AP poll": "Press poll", "AP": "Press",
    "Associated Press": "Press",
}

# Mascots for the FCS schools on a schedule (their names are drawn: a city in their state, a suffix, one of these).
FCS_MASCOTS = (
    "Badgers", "Falcons", "Bears", "Hawks", "Rams", "Pirates", "Knights", "Raiders", "Lions", "Panthers", "Colonels",
    "Pioneers", "Rattlers", "Bobcats", "Mariners", "Explorers", "Foxes", "Stags", "Herons", "Bulls", "Wildcats",
    "Tigers", "Eagles", "Hornets", "Cougars", "Vikings", "Spartans", "Trojans", "Owls", "Cardinals", "Broncos",
    "Lancers", "Rangers", "Patriots", "Chargers", "Storm", "Thunder", "Comets", "Jets", "Marlins",
)
FCS_SUFFIXES = (" Poly", " A&T", " Tech", " College", " Institute", " Valley", " Central", " Northern", " Southern")

# Fallback given names and surnames for initials the game's own name lists do not cover.
SPARE_NAMES = {
    "first": {"Q": ["Quentin", "Quincy"], "U": ["Ulysses", "Uriah"], "X": ["Xavier", "Xander"], "Y": ["Yusuf", "Yancy"],
              "Z": ["Zach", "Zane"], "I": ["Isaac", "Ivan"], "O": ["Owen", "Oscar"], "V": ["Victor", "Vince"]},
    "last": {"Q": ["Quinn", "Quigley"], "U": ["Underwood", "Upton"], "X": ["Xiong", "Xavier"], "Y": ["Young", "Yates"],
             "Z": ["Zimmer", "Zeller"], "I": ["Ingram", "Irving"], "O": ["Owens", "Ortiz"], "V": ["Vance", "Vaughn"]},
}

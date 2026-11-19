"""The lookalike names the published site uses in place of real ones (tools/generic/scrub.py applies them).
Edit freely: every table is `real -> lookalike`. Players and coaches are not listed here; their names are drawn
by scrub.py with the same initials.

House rule for teams: a school named only for a place keeps the place ("Texas", "Ohio State") and gets a new mascot;
a school named for anything else gets a lookalike that fits its abbreviation (TCU is Texas City University).
"""
from __future__ import annotations

# slug -> (short name or None to keep it, school name or None for "<short> College", mascot)   *tune*
TEAMS: dict[str, tuple[str | None, str | None, str]] = {
    "air-force": ("Air Fleet", "Air Fleet Academy", "Kestrels"),
    "akron": (None, None, "Zippers"),
    "alabama": (None, None, "Red Tide"),
    "app-st": (None, "Appalachia State University", "Highlanders"),
    "arizona-state": (None, None, "Sun Imps"),
    "arizona": (None, None, "Desert Cats"),
    "arkansas-state": (None, None, "Red Coyotes"),
    "arkansas": (None, None, "Wild Hogs"),
    "army": ("Armory", "Armory Military Institute", "Iron Knights"),
    "auburn": (None, None, "Sabertooths"),
    "ball-state": ("Ballard State", "Ballard State University", "Robins"),
    "baylor": ("Baywood", "Baywood University", "Kodiaks"),
    "boise-state": (None, None, "Stallions"),
    "boston-college": ("Bay Colony", "Bay Colony College", "Skyhawks"),
    "bowling-green": (None, None, "Peregrines"),
    "buffalo": (None, None, "Stampede"),
    "byu": (None, "Big Yonder University", "Catamounts"),
    "c-carolina": (None, None, "Roosters"),
    "c-michigan": (None, None, "Voyageurs"),
    "california": (None, None, "Golden Grizzlies"),
    "charlotte": (None, None, "Gold Rush"),
    "cincinnati": (None, None, "Binturongs"),
    "clemson": (None, None, "Lynx"),
    "colorado-state": (None, None, "Bighorns"),
    "colorado": (None, None, "Yaks"),
    "delaware": (None, None, "Blue Cluckers"),
    "duke": ("Dukeston", "Dukeston University", "Blue Imps"),
    "e-michigan": (None, None, "Ospreys"),
    "east-carolina": (None, None, "Buccaneers"),
    "fiu": (None, "Florida Inlet University", "Gulf Cats"),
    "fla-atlantic": (None, None, "Night Owls"),
    "florida-state": (None, None, "Firebirds"),
    "florida": (None, None, "Crocs"),
    "fresno-state": (None, None, "Boxers"),
    "ga-southern": (None, None, "Talons"),
    "georgia-state": (None, None, "Black Cats"),
    "georgia-tech": (None, None, "Hornets"),
    "georgia": (None, None, "Mastiffs"),
    "hawai-i": (None, None, "Wave Riders"),
    "houston": (None, None, "Comets"),
    "illinois": (None, None, "Prairie Fire"),
    "indiana": (None, None, "Racers"),
    "iowa-state": (None, None, "Twisters"),
    "iowa": (None, None, "Kernels"),
    "james-madison": ("James Monroe", "James Monroe University", "Barons"),
    "jax-state": (None, None, "Gamebirds"),
    "kansas-state": (None, None, "Prairie Cats"),
    "kansas": (None, None, "Bluebirds"),
    "kennesaw-st": (None, None, "Horned Owls"),
    "kent-state": (None, None, "Lightning"),
    "kentucky": (None, None, "Thoroughbreds"),
    "liberty": ("Liberty Hill", "Liberty Hill University", "Embers"),
    "louisiana-tech": (None, None, "Hounds"),
    "louisiana": (None, None, "Zydeco"),
    "louisville": (None, None, "Redbirds"),
    "lsu": (None, "Louisiana Swamp University", "Swamp Cats"),
    "marshall": ("Marshfield", "Marshfield University", "Rumbling Herd"),
    "maryland": (None, None, "Snappers"),
    "memphis": (None, None, "Kings"),
    "miami-oh": (None, "Miami of Ohio College", "RedTails"),
    "miami": (None, None, "Squall"),
    "michigan-state": (None, None, "Hoplites"),
    "michigan": (None, None, "Skunk Bears"),
    "minnesota": (None, None, "Groundhogs"),
    "mississippi-st": (None, None, "Bullmastiffs"),
    "missouri-state": (None, None, "Brown Bears"),
    "missouri": (None, None, "Mules"),
    "mtsu": (None, None, "Blue Bandits"),
    "navy": ("Naval", "Naval Maritime Academy", "Deckhands"),
    "nc-state": (None, None, "Howlers"),
    "ndsu": (None, None, "Herd"),
    "nebraska": (None, None, "Shuckers"),
    "nevada": (None, None, "Silver Pack"),
    "new-mexico-st": (None, None, "Ranchers"),
    "new-mexico": (None, None, "Wolves"),
    "niu": (None, None, "Snow Dogs"),
    "north-carolina": (None, None, "Pine Tars"),
    "north-texas": (None, None, "Emeralds"),
    "northwestern": (None, None, "Lakecats"),
    "notre-dame": ("North Dome", "University of North Dome", "Fighting Clovers"),
    "ohio-state": (None, None, "Chestnuts"),
    "ohio": (None, None, "Ocelots"),
    "oklahoma-state": (None, None, "Wranglers"),
    "oklahoma": (None, None, "Land Runners"),
    "old-dominion": (None, None, "Regents"),
    "ole-miss": ("Olde Miss", "University of Olde Mississippi", "Gamblers"),
    "oregon-state": (None, None, "Otters"),
    "oregon": (None, None, "Mallards"),
    "penn-state": (None, None, "Mountain Lions"),
    "pittsburgh": (None, None, "Steelcats"),
    "purdue": ("Purdale", "Purdale University", "Ironworkers"),
    "rice": ("Riceland", "Riceland University", "Barn Owls"),
    "rutgers": ("Rutledge", "Rutledge University", "Crimson Lancers"),
    "sac-state": (None, None, "Wasps"),
    "sam-houston": ("Sam Hill", "Sam Hill State University", "Bearcubs"),
    "san-diego-st": (None, None, "Condors"),
    "san-jose-state": (None, None, "Centurions"),
    "smu": (None, "Southern Metroplex University", "Colts"),
    "south-alabama": (None, None, "Leopards"),
    "south-carolina": (None, None, "Spurs"),
    "southern-miss": (None, None, "Golden Hawks"),
    "stanford": ("Stanfield", "Stanfield University", "Redwood"),
    "syracuse": (None, None, "Tangerine"),
    "tcu": (None, "Texas City University", "Spiny Lizards"),
    "temple": ("Templeton", "Templeton University", "Screech Owls"),
    "tennessee": (None, None, "Smokies"),
    "texas-a-m": (None, None, "Farmers"),
    "texas-state": (None, None, "Ringtails"),
    "texas-tech": (None, None, "Dust Devils"),
    "texas": (None, None, "Steers"),
    "toledo": (None, None, "Missiles"),
    "troy": (None, None, "Myrmidons"),
    "tulane": ("Tullin", "Tullin University", "Green Tide"),
    "tulsa": (None, None, "Golden Gale"),
    "uab": (None, "Union Academy of Birmingham", "Dragons"),
    "ucf": (None, "United Colleges of Florida", "Paladins"),
    "ucla": (None, "Union College of Los Angeles", "Grizzlies"),
    "uconn": ("Connecticut", "Connecticut University", "Sled Dogs"),
    "ul-monroe": (None, None, "Thunderhawks"),
    "umass": ("Massachusetts", "Massachusetts University", "Militia"),
    "unlv": (None, "University of Neon Las Vegas", "Outlaws"),
    "usc": (None, "University of Sunny California", "Legionnaires"),
    "usf": (None, "University of Suncoast Florida", "Toros"),
    "utah-state": (None, None, "Ranch Hands"),
    "utah": (None, None, "Redrocks"),
    "utep": (None, "Union Tech of El Paso", "Prospectors"),
    "utsa": (None, "Union Tech of San Antonio", "Coyotes"),
    "vanderbilt": ("Vandermeer", "Vandermeer University", "Admirals"),
    "virginia-tech": (None, None, "Toms"),
    "virginia": (None, None, "Swordsmen"),
    "w-kentucky": (None, None, "Hillclimbers"),
    "w-michigan": (None, None, "Mustangs"),
    "wake-forest": ("Wake Woods", "Wake Woods University", "Holy Terrors"),
    "washington-st": (None, None, "Pumas"),
    "washington": (None, None, "Malamutes"),
    "west-virginia": (None, None, "Ridge Runners"),
    "wisconsin": (None, None, "Honey Badgers"),
    "wyoming": (None, None, "Buckaroos"),
}

# Campus towns named for the school itself.
CITIES = {"air-force": "Colorado Springs", "notre-dame": "South Bend"}

# Short names that are also everyday words or places: swapped only where they stand alone as a name, never inside a
# longer sentence ("Rice-Eccles", "Statue of Liberty").
EXACT_ONLY = {"Army", "Navy", "Duke", "Rice", "Temple", "Liberty", "Marshall"}

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
    "Biletnikoff": "Billingsley", "Butkus": "Buckley", "Thorpe": "Thornton", "Outland": "Outback",
    "Maxwell": "Maxfield", "Doak Walker": "Dash Walker", "Davey O'Brien": "Danny O'Malley", "Mackey": "Mackenzie",
    "Nagurski": "Novak", "Bednarik": "Bednar", "Lombardi": "Lombardo", "Rimington": "Rimmer",
    "Lou Groza": "Lou Garza", "Ray Guy": "Ray Gunn", "Broyles": "Boyles",
    "NFL": "PFL", "NCAA": "NCFA", "ESPN": "TV", "Nielsen": "ratings",
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

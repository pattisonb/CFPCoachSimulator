import {
  Binoculars,
  Briefcase,
  Buildings,
  CalendarBlank,
  ChartBar,
  Football,
  Handshake,
  ListNumbers,
  Newspaper,
  Ranking,
  Table,
  TreeStructure,
  Trophy,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";

// The game's sections (/play?section=), in the sidebar's order. The career ones are always listed; the league ones
// sit in the sidebar's League group, which folds away.

export interface Section {
  key: string;
  label: string;
  icon: Icon;
  /** a sentence under the title: what the section is for */
  blurb: string;
}

export const CAREER_SECTIONS = [
  {
    key: "office",
    label: "Office",
    icon: Briefcase,
    blurb: "This week's game, your plan and the program at a glance.",
  },
  { key: "recruiting", label: "Recruiting", icon: Handshake, blurb: "Spend the week's hours on your board." },
  { key: "headquarters", label: "Headquarters", icon: Buildings, blurb: "Your staff, facilities and budget." },
  { key: "prospects", label: "Prospects", icon: UsersThree, blurb: "Every recruit in the class." },
  { key: "scouting", label: "Scouting", icon: Binoculars, blurb: "Learn what your targets can really do." },
  { key: "schedule", label: "Schedule", icon: CalendarBlank, blurb: "Your games, week by week." },
  { key: "depth", label: "Depth Chart", icon: ListNumbers, blurb: "Who starts, and who's next." },
] as const satisfies readonly Section[];

export const LEAGUE_SECTIONS = [
  { key: "standings", label: "Standings", icon: Table, blurb: "Every conference's table." },
  { key: "rankings", label: "Rankings", icon: Ranking, blurb: "The AP Poll and the playoff rankings." },
  { key: "stats", label: "Stats", icon: ChartBar, blurb: "The season's leaders." },
  { key: "bracket", label: "Bracket", icon: TreeStructure, blurb: "The playoff, round by round." },
  { key: "bowls", label: "Bowls", icon: Football, blurb: "Every bowl and who's in it." },
  { key: "awards", label: "Awards", icon: Trophy, blurb: "The season's honors." },
  { key: "recap", label: "Season Recap", icon: Newspaper, blurb: "The season, told after it's done." },
] as const satisfies readonly Section[];

export type SectionKey = (typeof CAREER_SECTIONS)[number]["key"] | (typeof LEAGUE_SECTIONS)[number]["key"];

const ALL: readonly Section[] = [...CAREER_SECTIONS, ...LEAGUE_SECTIONS];

/** *tune* The section /play opens on when the address names none. */
export const DEFAULT_SECTION: SectionKey = "office";

/** The section for an address's ?section=, or the default for a missing or unknown one. */
export const sectionOf = (key: string | null): Section =>
  ALL.find((s) => s.key === key) ?? ALL.find((s) => s.key === DEFAULT_SECTION)!;

export const isLeague = (key: string) => LEAGUE_SECTIONS.some((s) => s.key === key);

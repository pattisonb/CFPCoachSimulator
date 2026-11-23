import type { Notice, NoticeKind } from "../../notices.ts";

const weeks = (n: number) => (n === 1 ? "1 week" : `${n} weeks`);
const recruit = (n: Notice) => (n.stars ? `${n.name}, a ${n.stars}-Star ${n.position},` : `${n.name} (${n.position})`);

/** Notifications: the wording. */
export const messages = {
  title: "Notifications",
  bell: (unread: number) => (unread > 0 ? `Notifications: ${unread} New` : "Notifications"),
  empty: "Nothing yet. Staff finds, commits and injuries land here as the weeks pass.",
  more: (n: number) => `+${n} More · Show All`,
  fewer: "Show Fewer",
  dismissAll: "Dismiss All",
  dismiss: "Dismiss",
  week: (w: number) => `Week ${w}`,
  heads: {
    gem: "Staff Found a Gem",
    generational: "Generational Talent Found",
    commit: "New Commit",
    decommit: "Decommitment",
    injury: "Injury",
  } as Record<NoticeKind, string>,
  line: (n: Notice): string => {
    if (n.kind === "gem") return `Your scouts flagged ${recruit(n)} as a gem.`;
    if (n.kind === "generational") return `Your scouts say ${recruit(n)} is a once-in-a-generation talent.`;
    if (n.kind === "commit") return `${recruit(n)} committed to you.`;
    if (n.kind === "decommit")
      return n.school ? `${recruit(n)} left your class for ${n.school}.` : `${recruit(n)} reopened his recruitment.`;
    return `${n.name} (${n.position}) is out ${weeks(n.weeks ?? 1)}${n.injury ? `: ${n.injury.toLowerCase()}` : ""}.`;
  },
};

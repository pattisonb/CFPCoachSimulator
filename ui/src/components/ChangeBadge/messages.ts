/** ChangeBadge: the wording. */
export const messages = {
  title: "Since You Last Looked",
  label: (n: number) => (n === 1 ? "1 change since you last looked" : `${n} changes since you last looked`),
  // what changed, each a short sentence: what it is now, then what it was
  chance: (now: string, was: string) => `Chance: ${now}. It was ${was}.`,
  place: (now: number, was: number) => `His list: you are #${now}. You were #${was}.`,
  onList: (now: number) => `His list: you are on it now, at #${now}.`,
  offList: "His list: you are off it.",
  committed: (school: string) => `He committed to ${school}.`,
  hard: (school: string) => `He is a hard commit to ${school}.`,
  signed: (school: string) => `He signed with ${school}.`,
  decommitted: (school: string) => `He decommitted from ${school}.`,
  you: "you",
  offered: (school: string) => `${school} offered him.`,
  pulled: (school: string) => `${school} pulled its offer.`,
  pushing: (school: string) => `${school} is pushing back.`,
};

export const messages = {
  kicker: "Closed Door",
  /** the door's name, by why it is shut (career_js/recruiting/part6.js blocked) */
  titles: {
    locked: "He Won't Consider You",
    finalists: "You Missed His Cut",
    signed: "He Has Signed",
  } as Record<string, string>,
  /** the short mark on a row */
  marks: {
    locked: "Closed Door",
    finalists: "Not a Finalist",
    signed: "Signed",
  } as Record<string, string>,
  /** what, if anything, opens it again */
  next: {
    locked:
      "Nothing you send him lands. The door can open if your program gets closer to what he wants: winning helps.",
    finalists: "His list is set, and he is choosing among the schools on it. Nothing you send him lands.",
    signed: "His recruitment is over.",
  } as Record<string, string>,
} as const;

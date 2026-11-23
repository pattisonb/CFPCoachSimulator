export const messages = {
  /** how he took a pitch, as the conversation and his History say it */
  names: {
    sold: "He's Sold",
    hit: "He Lights Up",
    fair: "He's Listening",
    lukewarm: "He's Lukewarm",
    quiet: "He Isn't Buying It",
    polite: "Polite Nod",
    tired: "Tired of the Calls",
  } as Record<string, string>,
  /** what it tells you: your grade on the topic against what he wants there (which the page never shows) */
  meaning: {
    sold: "Your grade there is well past what he wants. Keep pushing it.",
    hit: "Your grade there meets what he wants. It's working.",
    fair: "Your grade there is a little short of what he wants.",
    lukewarm: "Your grade there is well short of what he wants.",
    quiet: "Your grade there is far from what he wants. Pitching it costs you.",
    polite: "Not his thing. Try another angle next time.",
    tired: "Too many calls. Give him some room.",
  } as Record<string, string>,
  /** a topic's mark on a pitch button and in his file: how he took it last time (recruiting.pitch_marks) */
  marks: {
    sold: "Sold",
    hit: "Lit Up",
    fair: "Listening",
    lukewarm: "Lukewarm",
    weak: "Not Buying",
    not_his: "Not His Thing",
    no_read: "No Read",
  } as Record<string, string>,
} as const;

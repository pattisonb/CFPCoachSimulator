export const messages = {
  names: {
    sent: "Offer Sent",
    offered: "Offered",
    verbal: "Verbal Commit",
    hard: "Hard Commit",
    signed: "Signed",
  },
  /** what each one means, in the tooltip */
  means: {
    sent: "Your offer is on its way. He reads it at the week's end.",
    offered: "He has your offer.",
    verbal: "He has committed to you, but he can still change his mind.",
    hard: "He is firmly committed to you.",
    signed: "He has signed with you.",
  },
  /** committed or signed with another school */
  away: {
    verbal: "Verbal Commit Elsewhere",
    hard: "Hard Commit Elsewhere",
    signed: "Signed Elsewhere",
  },
  awayMeans: {
    verbal: "He has committed to another school, but he could still flip to you.",
    hard: "He is firmly committed to another school.",
    signed: "He has signed with another school.",
  },
} as const;

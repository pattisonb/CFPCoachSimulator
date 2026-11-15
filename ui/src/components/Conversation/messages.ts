export const messages = {
  title: { call: (name: string) => `Call with ${name}`, hc_visit: (name: string) => `In-Home Visit with ${name}` },
  where: { call: "On the Phone", hc_visit: "In His Living Room" },
  log: "The conversation",
  you: "You",
  typing: (name: string) => `${name} is typing`,

  // the three steps, in the head
  steps: ["Open", "Listen", "Pitch"],
  stepsLabel: "Where you are in the conversation",

  opening: "Your Opening",
  openingHelp: "Pick three things to sell your program with.",
  present: "Present",
  presentTip: (n: number) => `Pick ${n} things first`,
  asks: "He Asks",
  asksHelp: "Answer him. A promise you can't keep will cost you.",
  leadWith: "Your Pitch",
  leadHelp: "Lead with one thing. Hit what he cares about.",
  pitch: "Pitch",
  pickLead: "Pick what you lead with",
  promiseJob: "Promise the Job",
  promiseJobTip: "Tell him the starting job is his. It helps land him, and he'll hold you to it all season.",
  hangUp: { call: "Hang Up", hc_visit: "Step Out" },
  hangUpTip:
    "It stays open: Finish it from his panel this week. One you never finish counts for nothing, and the hours stay spent.",
  done: "Done",
  doneNote: "It counts at the week step.",
  lapsed: "That conversation lapsed: the week moved on.",
  failed: (msg: string) => `Couldn't do that: ${msg}.`,

  // on a topic card
  pull: { strong: "Strong", fair: "Fair", weak: "Weak" } as Record<string, string>,
  pullTip: (topic: string, word: string) => `Your program's case on ${topic}: ${word.toLowerCase()}.`,
  known: "He told you he cares about this.",
  cue: "He just brought this up.",
  marks: { hit: "Lit Up", weak: "Weak Case", not_his: "Not His Thing", no_read: "No Read" } as Record<string, string>,
  markTip: "How he took it last time.",
  cueLine: "His Cue",

  // how the pitch went: the big word, and a line on what it means
  reactions: {
    hit: "He Lit Up",
    polite: "Polite Nod",
    quiet: "He Went Quiet",
    tired: "Tired of the Calls",
    guarded: "Poker Face",
  } as Record<string, string>,
  meaning: {
    hit: "That's one of his. Keep pushing it.",
    polite: "Not his thing. Try another angle next time.",
    quiet: "He cares about it, but your case there is weak.",
    tired: "Too many calls. Give him some room.",
    guarded: "He kept his cards close this time.",
  } as Record<string, string>,
  learned: (topic: string) => `He told you he cares about ${topic}.`,

  // your answers to his question (scenes.py ANSWER_LABELS, ANSWER_COPY)
  answerLabels: { straight: "Tell Him Straight", promise: "Make Him a Promise", deflect: "Sidestep It" } as Record<
    string,
    string
  >,
  answerCopy: {
    roster: {
      straight: "He's the starter today. You'd compete, and the best man plays.",
      promise: "The job's yours.",
      deflect: "Let's talk about what you'd bring.",
    },
    recruit: {
      straight: "I offered him too. One of you starts; I want it to be you.",
      promise: "You're the one I want.",
      deflect: "Let's talk about what you'd bring.",
    },
  } as Record<string, Record<string, string>>,
} as const;

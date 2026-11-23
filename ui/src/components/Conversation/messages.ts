export const messages = {
  title: { call: (name: string) => `Call With ${name}`, hc_visit: (name: string) => `In-Home Visit With ${name}` },
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
  presentTip: (n: number) => `Pick ${n} ${n === 1 ? "thing" : "things"} first.`,
  asks: "He Asks",
  asksHelp: "Answer him. A promise you can't keep will cost you.",
  leadWith: "Your Pitch",
  leadHelp: "Lead with one thing. He weighs your grade on it against what he wants.",
  pitch: "Pitch",
  pickLead: "Pick what you lead with.",
  promiseJob: "Promise the Job",
  promiseJobTip: "Tell him the starting job is his. It helps land him, and he'll hold you to it all season.",
  hangUp: { call: "Hang Up", hc_visit: "Step Out" },
  hangUpTip:
    "It stays open: finish it from his panel this week. One you never finish counts for nothing, and the energy stays spent.",
  done: "Done",
  doneNote: "It counts at the week step.",
  lapsed: "That conversation lapsed: the week moved on.",
  failed: (msg: string) => `Couldn't do that: ${msg}.`,

  // on a topic card
  pullTip: (topic: string, grade: string) => `Your program's grade on ${topic}: ${grade}.`,
  known: "He told you he cares about this.",
  markTip: (word: string) => `How he took it last time: ${word}.`,
  cueLine: "His Cue",

  learned: (topic: string) => `He told you he cares about ${topic}.`,

  // your answers to his question (scenes.js ANSWER_LABELS, ANSWER_COPY)
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

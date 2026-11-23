export const messages = {
  // (the file is a "skin" in the code; the player reads "roster file": the player's ask, "dont use Skin here")
  load: "Load Rosters",
  reading: "Reading the Rosters…",
  remove: "Remove Rosters",
  on: (name: string) => `Rosters: ${name}`,
  tipTitle: "Roster Files",
  tip: "A roster file gives the game other names and rosters. It stays in this browser. Careers started on one are kept apart from the others, and are still there when it is loaded again.",
  onTip: "Every name and roster comes from this file. Its careers are the ones under Load Season while it is on.",
  removeTip:
    "Take the roster file off and go back to the game's own names. Its careers are kept, and are back when it is loaded again.",
  // (the reason is the game's own sentence, its period dropped so there is one)
  failed: (why: string) => `The roster file could not be used and was taken off: ${why.replace(/\.$/, "")}.`,
  stale:
    "This roster file was made for an earlier version of the game. It still works, with the rosters it was made with. A new one will match this version.",
  missed: "This roster file is older than the game: a few names keep the game's own. A new one will have them.",
} as const;

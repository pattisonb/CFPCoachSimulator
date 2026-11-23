export const messages = {
  load: "Load a Skin",
  reading: "Reading the Skin…",
  remove: "Remove Skin",
  on: (name: string) => `Skin: ${name}`,
  tipTitle: "Skins",
  tip: "A skin is a file that gives the game other names and rosters. It stays in this browser. Careers started on a skin are kept apart from the others, and are still there when the skin is loaded again.",
  onTip: "Every name and roster comes from this skin. Its careers are the ones under Load Season while it is on.",
  removeTip:
    "Take the skin off and go back to the game's own names. Its careers are kept, and are back when it is loaded again.",
  // (the reason is the game's own sentence, its period dropped so there is one)
  failed: (why: string) => `The skin could not be used and was taken off: ${why.replace(/\.$/, "")}.`,
  stale:
    "This skin was made for an earlier version of the game. It still works, with the rosters it was made with. A new one will match this version.",
  missed: "This skin is older than the game: a few names keep the game's own. A new one will have them.",
} as const;

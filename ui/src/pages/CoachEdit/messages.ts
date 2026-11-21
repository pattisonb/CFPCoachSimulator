export const messages = {
  back: "Back to Play",
  title: "Create Your Coach",
  intro: "Pick a face and a name, then save your coach.",
  forTeam: (team: string) => `Coaching ${team}`,

  preview: "Your coach",
  randomize: "Randomize",
  save: "Save Coach",
  /** opened for a team: save the coach and enter the game */
  confirm: "Confirm and Play",
  saving: "Saving…",
  starting: "Starting…",
  startError: (msg: string) => `Couldn't start the season: ${msg}.`,
  saved: (name: string) => `Saved ${name}.`,
  saveError: (msg: string) => `Couldn't save the coach: ${msg}.`,
  needName: "Give your coach a first and last name to go on.",

  firstName: "First Name",
  lastName: "Last Name",
  age: "Age",
  hometown: "Hometown",

  // (the game's own sentence, its period dropped so there is one; the dev server is asked after only where there is one)
  loadError: (msg: string) =>
    `Can't reach the game: ${msg.replace(/\.$/, "")}.${import.meta.env.DEV ? " Is the dev server running?" : ""}`,
} as const;

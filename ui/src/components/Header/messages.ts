export const messages = {
  brand: "Pocket College Football",
  homeLabel: "Pocket College Football Home",
  navLabel: "Sections",
  // Your Coach (coach/edit) and Custom Programs (program/edit) are steps inside Play, not pages of their own: see ui/PLAN.md
  nav: [{ key: "play", label: "Play", href: "" }], // href: under the app's root (router.ts ROOT)
  toDark: "Switch to Dark Mode",
  toLight: "Switch to Light Mode",
} as const;

export type NavKey = (typeof messages.nav)[number]["key"];

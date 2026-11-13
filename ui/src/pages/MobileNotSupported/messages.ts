import { MIN_WIDTH } from "../../viewport.ts";

export const messages = {
  brand: "Pocket College Football",
  title: "Mobile Not Supported",
  body: "Pocket College Football needs a bigger screen for now. Open it on a tablet, laptop or desktop.",
  needs: `Needs a window at least ${MIN_WIDTH} px wide.`,
} as const;

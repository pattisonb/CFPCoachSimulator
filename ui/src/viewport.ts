import { useEffect, useState } from "react";

/** *tune* The narrowest window the game supports; anything narrower (phones) gets the Mobile Not Supported page. */
export const MIN_WIDTH = 768;

/** True while the window is narrower than MIN_WIDTH. Follows resizes and rotation. */
export function useTooNarrow(): boolean {
  const query = `(width < ${MIN_WIDTH}px)`;
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setNarrow(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

/** True while a media query matches (a layout that changes its columns, not just its styles). Follows resizes. */
export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setHit(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return hit;
}

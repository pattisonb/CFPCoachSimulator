import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

// A small router: the address bar's path picks the page. Paths are under ROOT, the folder the app was opened
// from, so the app also works from a sub-path.

/** *tune* Every page's path, relative to ROOT. */
export const ROUTES = {
  play: "",
  game: "play",
  coachEdit: "coach/edit",
  programEdit: "program/edit",
  playerEdit: "player/edit",
  teamSelect: "select", // the helmet team select, a trial of a second look for Play's team pick
} as const;
export type Route = keyof typeof ROUTES;

const routeOf = (path: string): Route => {
  const clean = path.replace(/\/+$/, "");
  const hit = (Object.keys(ROUTES) as Route[]).find((r) => ROUTES[r] && clean.endsWith(`/${ROUTES[r]}`));
  return hit ?? "play";
};

/** The app's folder, from the address it was opened at (the page's own path taken off). */
export const ROOT = location.pathname
  .replace(new RegExp(`(${Object.values(ROUTES).filter(Boolean).join("|")})/?$`), "")
  .replace(/[^/]*$/, "");

export const hrefFor = (route: Route, params?: Record<string, string>) =>
  ROOT + ROUTES[route] + (params ? `?${new URLSearchParams(params)}` : "");

const listeners = new Set<() => void>();

/** *tune* How long a page change waits for its transition to start before it happens without one. */
const SWAP_FALLBACK_MS = 400;

/**
 * Show the new page inside a view transition when the browser has them and motion is welcome; otherwise at once.
 * React has to draw the new page inside the transition's callback, hence flushSync.
 */
function transition(update: () => void) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("startViewTransition" in document) || reduce) {
    update();
    return;
  }
  // the page changes exactly once: inside the transition, or, when the browser paints no frame to start it
  // (a hidden tab, a stalled renderer), after SWAP_FALLBACK_MS without the animation
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    flushSync(update);
  };
  document.startViewTransition(swap);
  setTimeout(swap, SWAP_FALLBACK_MS);
}

const notify = () => listeners.forEach((l) => l());

/** Go to a page without reloading. */
export function navigate(route: Route, params?: Record<string, string>) {
  history.pushState(null, "", hrefFor(route, params));
  transition(() => {
    notify();
    window.scrollTo(0, 0);
  });
}

/** Rewrite the current page's address (its query) without a new history entry or a redraw. */
export function replaceParams(route: Route, params?: Record<string, string>) {
  history.replaceState(null, "", hrefFor(route, params));
}

// Back and Forward animate like navigate
window.addEventListener("popstate", () => transition(notify));

/** The page the address shows, and its query parameters. Follows Back and Forward. */
export function useRoute(): { route: Route; params: URLSearchParams } {
  const read = () => ({ route: routeOf(location.pathname), params: new URLSearchParams(location.search) });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}

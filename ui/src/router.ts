import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./api.ts";

// A small router: the address bar's path picks the page. Paths are under ROOT, the folder the app was opened
// from, so the app also works from a sub-path.

/** *tune* Every page's path, relative to ROOT. */
export const ROUTES = {
  play: "",
  game: "play",
  coachEdit: "coach/edit",
  programEdit: "program/edit",
  playerEdit: "player/edit",
} as const;
export type Route = keyof typeof ROUTES;

const routeOf = (path: string): Route => {
  const clean = path.replace(/\/+$/, "");
  const hit = (Object.keys(ROUTES) as Route[]).find((r) => ROUTES[r] && clean.endsWith(`/${ROUTES[r]}`));
  return hit ?? "play";
};

// A career's address reads as folders: dynasty/<school>/<section>[/<tab>] ("dynasty/app-state/recruiting/prospects").
// The school's name stands for the career's id; this browser keeps which is which (a second career at one school gets
// "-<the id's first six>"), and a name it has not seen is looked up among the saved careers. The older
// play?id=…&section=… still opens, and is rewritten to the new shape.
const DYNASTY = "dynasty";
const NAMES_KEY = "cfp.dynasties";

/** The app's folder, from the address it was opened at (the page's own path taken off). */
export const ROOT = location.pathname
  .replace(new RegExp(`(${DYNASTY}/.*|${Object.values(ROUTES).filter(Boolean).join("|")})/?$`), "")
  .replace(/[^/]*$/, "");

/** name in the address -> career id */
const names: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
})();
const nameOf = (id: string) => Object.keys(names).find((n) => names[n] === id) ?? id;

/** Note a career's school, so its address can name it; returns the name the address uses. */
export function rememberDynasty(id: string, team: string): string {
  const known = Object.keys(names).find((n) => names[n] === id);
  if (known) return known;
  const name = !names[team] ? team : `${team}-${id.slice(0, 6)}`;
  names[name] = id;
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    /* a private window: the names last this visit */
  }
  return name;
}

/** The page and its parameters, whichever shape the address has. A dynasty's name not known yet is left as `dynasty`. */
function parse(): { route: Route; params: URLSearchParams } {
  const params = new URLSearchParams(location.search);
  const rel = location.pathname.slice(ROOT.length).replace(/\/+$/, "");
  if (rel === DYNASTY || rel.startsWith(`${DYNASTY}/`)) {
    const [, name = "", section, tab] = rel.split("/").map(decodeURIComponent);
    const id = names[name] ?? (/^[0-9a-f]{8,}$/.test(name) ? name : null);
    if (id) params.set("id", id);
    else if (name) params.set("dynasty", name);
    if (section) params.set("section", section);
    if (tab) params.set("tab", tab);
    return { route: "game", params };
  }
  return { route: routeOf(location.pathname), params };
}

/** The current address's parameters (a dynasty's folders read as id, section and tab). */
export const currentParams = () => parse().params;

export const hrefFor = (route: Route, params?: Record<string, string>) => {
  if (route === "game" && params?.id) {
    const { id, section, tab, dynasty: _name, ...rest } = params;
    const path = [DYNASTY, nameOf(id), ...(section ? [section, ...(tab ? [tab] : [])] : [])].map(encodeURIComponent);
    if (tab && !section) rest.tab = tab;
    const query = new URLSearchParams(rest).toString();
    return ROOT + path.join("/") + (query ? `?${query}` : "");
  }
  return ROOT + ROUTES[route] + (params ? `?${new URLSearchParams(params)}` : "");
};

const lookups = new Map<string, Promise<void>>();
/**
 * A dynasty named in the address that this browser has not seen: found among the saved careers (the first at that
 * school). One lookup a name, shared by everyone who asks while it runs.
 */
function resolveDynasty(name: string): Promise<void> {
  let job = lookups.get(name);
  if (!job) {
    job = api<{ seasons?: { id: string; team: string }[] }>("/api/seasons").then((d) => {
      for (const s of d.seasons ?? []) rememberDynasty(s.id, s.team);
      if (!names[name]) {
        const hit = (d.seasons ?? []).find((s) => s.team === name);
        if (hit) names[name] = hit.id;
      }
    });
    lookups.set(name, job);
  }
  return job;
}

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
  // a newer page change skips this one's animation, and the browser says so by rejecting its promises: that is
  // expected, not an error (the stress run's find: an unhandled rejection for every quick second click)
  const t = document.startViewTransition(swap);
  for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => {});
  setTimeout(swap, SWAP_FALLBACK_MS);
}

const notify = () => listeners.forEach((l) => l());

/**
 * Go to a page without reloading. `instant` skips the page-change animation, so the new address is the page's before
 * the caller's next line (starting the next season draws the game afresh in the same breath).
 */
export function navigate(route: Route, params?: Record<string, string>, instant = false) {
  history.pushState(null, "", hrefFor(route, params));
  if (instant) {
    notify();
    window.scrollTo(0, 0);
    return;
  }
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
  const read = parse;
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  // a dynasty this browser has not opened before (a pasted link): look its name up, then read the address again
  const unknown = state.route === "game" && !state.params.get("id") ? state.params.get("dynasty") : null;
  useEffect(() => {
    if (!unknown) return;
    let on = true;
    resolveDynasty(unknown)
      .then(() => {
        if (!on) return;
        // no career at that school: the main menu, not an empty game
        if (!parse().params.get("id")) history.replaceState(null, "", ROOT);
        setState(read());
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [unknown]);
  return state;
}

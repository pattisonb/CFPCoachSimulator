import { useEffect, useRef } from "react";
import { contrast, inkOn } from "./colors.ts";

// The browser tab: the dynasty's name, and the sim's progress while you are on another tab. The title reads "Toledo
// Dynasty"; while a sim runs it leads with the progress and your record ("42% · 4-1 · Wk 5 · Toledo Dynasty") and the
// icon wears a progress ring in your color, so a tab in the background still tells you where the sim is. When it ends
// the tab says so ("Done · 9-3 · …", a full green ring; "Sim Failed" and red on an error) until you come back to it.

const BASE_TITLE = "Pocket College Football";
/** *tune* How long "Done" stays on the tab once you are looking at it, in ms. */
const DONE_MS = 2500;
const DONE_COLOR = "#2e9e5b";
const FAIL_COLOR = "#d9403c";

interface Record {
  wins: number;
  losses: number;
}

export interface TabSim {
  /** a sim is running */
  running: boolean;
  /** how far along it is, 0 to 1 */
  progress: number;
  /** the week it has reached, as the calendar names it ("Week 5") */
  week: string | null;
  /** the last sim ended in an error */
  failed: boolean;
}

let links: HTMLLinkElement[] | null = null;
let hrefs: [string | null, string | null][] = [];
let img: HTMLImageElement | null = null;
let canvas: HTMLCanvasElement | null = null;

function iconLinks() {
  if (!links) {
    links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='icon']"));
    hrefs = links.map((l) => [l.getAttribute("href"), l.getAttribute("type")]);
  }
  return links;
}

/** the icon in your team's colors (an SVG as a data URL) while a career is open; null: the game's own */
let teamIcon: string | null = null;

function iconReset() {
  links?.forEach((l, i) => {
    const [href, type] = teamIcon ? [teamIcon, "image/svg+xml"] : hrefs[i];
    if (href) l.setAttribute("href", href);
    if (type) l.setAttribute("type", type);
    else l.removeAttribute("type");
  });
}

// the icon's own colors (public/favicon.svg): its tile, the ball, the laces
const ICON_TILE = /#131a2e/gi;
const ICON_BALL = /#f5b942/gi;
const ICON_LACE = /#ffffff/gi;
/** *tune* The ball is your secondary color when it stands this far from the tile's (contrast ratio); else black or white. */
const ICON_CONTRAST = 1.8;
let iconSource: Promise<string> | null = null;

/** The game's icon redrawn in a team's colors: the tile its primary, the ball its secondary, the laces whichever reads. */
async function iconFor(primary: string, secondary: string): Promise<string | null> {
  const svg = (hrefs.find(([h]) => h && /\.svg$/.test(h)) ?? [])[0];
  if (!svg) return null;
  iconSource ??= fetch(svg).then((r) => (r.ok ? r.text() : Promise.reject(new Error("no icon"))));
  const text = await iconSource;
  const ball = contrast(primary, secondary) >= ICON_CONTRAST ? secondary : inkOn(primary);
  // the tile's color is also the ball's seam, so each is swapped through a placeholder
  const out = text
    .replace(ICON_TILE, "%TILE%")
    .replace(ICON_BALL, "%BALL%")
    .replace(ICON_LACE, inkOn(ball) === "#fff" ? "#ffffff" : "#111111")
    .replace(/%TILE%/g, primary)
    .replace(/%BALL%/g, ball);
  return `data:image/svg+xml,${encodeURIComponent(out)}`;
}

/** The icon with a ring round it: `p` of the way round, in `color`. */
function iconRing(p: number, color: string) {
  const all = iconLinks();
  if (!all.length) return;
  const draw = () => {
    canvas ??= document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 64, 64);
    if (img?.complete && img.naturalWidth) g.drawImage(img, 0, 0, 64, 64);
    g.lineWidth = 9;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.beginPath();
    g.arc(32, 32, 26.5, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = color;
    g.beginPath();
    g.arc(32, 32, 26.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, Math.min(1, p)));
    g.stroke();
    const url = canvas.toDataURL("image/png");
    for (const l of all) {
      l.setAttribute("href", url);
      l.setAttribute("type", "image/png");
    }
  };
  const src = teamIcon ?? (hrefs.find(([h]) => h && /\.svg$/.test(h)) ?? hrefs[0])?.[0] ?? "";
  if (!img || img.dataset.src !== src) {
    img = new Image();
    img.dataset.src = src;
    img.onload = draw;
    img.src = src;
  }
  draw();
}

const setTitle = (text: string) => {
  if (document.title !== text) document.title = text;
};

/**
 * Keeps the browser tab's title and icon in step with the career on screen. `team`: your school's name (nothing
 * while the career loads); `record`: yours, as the sim has it; `color`: your team's, for the ring; `colors`: its
 * primary and secondary as hex, which the icon itself is redrawn in while the career is open.
 */
export function useTab(
  team: string | null,
  record: Record | null,
  sim: TabSim,
  color: string,
  colors?: { primary: string; secondary: string } | null,
) {
  const waiting = useRef(false);
  const was = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const dynasty = team ? `${team} Dynasty` : BASE_TITLE;
  const rec = record ? `${record.wins}-${record.losses}` : "";

  useEffect(() => {
    const back = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", back);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        waiting.current = false;
        iconReset();
        setTitle(dynasty);
      }, DONE_MS);
    };
    if (sim.running) {
      waiting.current = false;
      window.clearTimeout(timer.current);
      const pct = Math.min(99, Math.max(0, Math.round(sim.progress * 100)));
      const week = sim.week ? sim.week.replace(/^Week /, "Wk ") : "";
      setTitle([`${pct}%`, rec, week, dynasty].filter(Boolean).join(" · "));
      iconRing(sim.progress, color);
    } else if (was.current) {
      // the sim has just ended: say so until you have seen it
      setTitle([sim.failed ? "Sim Failed" : "Done", rec, dynasty].filter(Boolean).join(" · "));
      iconRing(1, sim.failed ? FAIL_COLOR : DONE_COLOR);
      waiting.current = true;
      if (document.hidden) document.addEventListener("visibilitychange", back);
      else back();
    } else if (!waiting.current) {
      setTitle(dynasty);
    }
    was.current = sim.running;
    return () => document.removeEventListener("visibilitychange", back);
  }, [dynasty, rec, sim.running, sim.progress, sim.week, sim.failed, color]);

  // the icon in your colors while the career is open (a ring drawn during a sim goes over this one)
  const primary = colors?.primary;
  const secondary = colors?.secondary;
  useEffect(() => {
    if (!primary || !secondary || !/^#[0-9a-f]{3,8}$/i.test(primary) || !/^#[0-9a-f]{3,8}$/i.test(secondary)) return;
    let on = true;
    iconLinks();
    iconFor(primary, secondary)
      .then((url) => {
        if (!on || !url) return;
        teamIcon = url;
        if (!was.current && !waiting.current) iconReset();
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [primary, secondary]);

  // leaving the career: the tab is the game's again
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      teamIcon = null;
      iconReset();
      setTitle(BASE_TITLE);
    },
    [],
  );
}

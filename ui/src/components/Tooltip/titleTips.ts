import "./index.css";

// Every `title` on the page shown as the game's own tooltip (the Tooltip component's ink label) instead of the
// browser's. One listener for the whole app: pointing at (or tabbing to) anything with a title lifts the title off the
// element for as long as the tip is up, so the browser's own never shows, and puts it back after. Nothing has to opt
// in, so a title added anywhere later gets the same tooltip.

/** *tune* The tip's widest, and the gap kept from the window's edge (Tooltip/index.tsx uses the same). */
const MAX_WIDTH = 260;
const EDGE = MAX_WIDTH / 2 + 8;
/** *tune* Nearer the window's top than this, the tip shows under its target. */
const FLIP_UNDER = 90;

/**
 * Where a tooltip must be drawn to be seen: inside the open window its target is in (a modal is drawn over the whole
 * page, body included), else on the page.
 */
export const tipLayer = (el: Element | null | undefined): HTMLElement =>
  el?.closest<HTMLElement>("dialog[open]") ?? document.body;

let installed = false;

/** Turn on the game's tooltip for every `title` in the app. Call once, at startup. */
export function installTitleTips() {
  if (installed) return;
  installed = true;
  let tip: HTMLElement | null = null;
  let owner: HTMLElement | null = null;
  let held = "";

  const hide = () => {
    tip?.remove();
    tip = null;
    // the title goes back, unless the page gave the element a new one meanwhile
    if (owner?.isConnected && held && !owner.hasAttribute("title")) owner.setAttribute("title", held);
    owner = null;
    held = "";
  };

  const show = (el: HTMLElement) => {
    if (el === owner) return;
    hide();
    const text = el.getAttribute("title")?.trim();
    if (!text) return;
    owner = el;
    held = text;
    el.removeAttribute("title");
    // an icon-only control was named by its title: keep it named while the title is off
    if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", text);

    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    const left = Math.min(Math.max(mid, EDGE), Math.max(EDGE, window.innerWidth - EDGE));
    const under = r.top < FLIP_UNDER;
    tip = document.createElement("span");
    tip.className = `tooltip__tip${under ? " tooltip__tip--under" : ""}`;
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    tip.style.left = `${left}px`;
    tip.style.top = `${under ? r.bottom : r.top}px`;
    tip.style.maxWidth = `${MAX_WIDTH}px`;
    tip.style.setProperty("--nudge", `${mid - left}px`);
    tipLayer(el).appendChild(tip);
  };

  const find = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[title]") : null);
  document.addEventListener("pointerover", (e) => {
    if (owner && e.target instanceof Node && owner.contains(e.target)) return;
    const el = find(e.target);
    if (el) show(el);
    else hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = find(e.target);
    if (el) show(el);
    else hide();
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}

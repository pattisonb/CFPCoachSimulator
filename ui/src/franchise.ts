import data from "pocket-faces/data";
import { api } from "./api.ts";
import { lookOf } from "./faces.ts";

// Play It on the Field: a roster link to Pocket Franchise's practice field (docs/PLAY_ON_THE_FIELD.md; the reader is
// sprite-test/lib/game/roster-link.ts). Two teams' depth charts and current skills, as raw DEFLATE + base64url in
// the link's fragment, so nothing is uploaded: it opens in the player's own browser and goes nowhere else.

/** *tune* Where Pocket Franchise lives; VITE_POCKET_FRANCHISE_URL points it elsewhere (http://localhost:3000). */
export const FRANCHISE_URL: string =
  (import.meta.env.VITE_POCKET_FRANCHISE_URL as string | undefined) ?? "https://pocket-franchise.vercel.app";

/** A player as the server sends him: the link's fields, plus what his face is drawn from */
type LinkPlayer = Record<string, unknown> & { slug: string; pos: string; _position?: string; _look?: unknown };
/** A team as GET /api/season/{id}/playlink/{slug} sends it (the link's Team) */
type LinkTeam = Record<string, unknown> & { players: LinkPlayer[] };

const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const SKIN = new Map(data.skinTones.map((t) => [t.id, [hex(t.skin), hex(t.skinShadow)]]));

/**
 * Each player's look, as this app draws him (the depth chart's face: Edit Player Look's, else rolled from his slug
 * and position): `face`, the pocket-faces face, for the field to draw when it reads one, and `skin`, his skin tone and
 * its shade, which it reads today. The server's `_position` and `_look` stay out of the link.
 */
function withLooks(team: LinkTeam): LinkTeam {
  return {
    ...team,
    players: team.players.map(({ _position, _look, ...p }) => {
      const face = lookOf(_look, p.slug, _position ?? p.pos);
      const skin = SKIN.get(face.skinTone);
      return { ...p, face, ...(skin ? { skin } : {}) };
    }),
  };
}

/** The JSON, raw-deflated and base64url'd (no padding), as the reader expects. */
async function pack(link: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(link));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < packed.length; i += 0x8000) bin += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class PopupBlocked extends Error {}

/**
 * Open the practice field with `offense` (you play its quarterback) against `defense`. Call it straight from a
 * click: the tab opens at once, while the click still counts (a pop-up blocker allows that), and is pointed at the
 * field when both teams have loaded. Throws PopupBlocked when the browser refused the tab.
 */
export async function playOnTheField(seasonId: string, offense: string, defense: string | null): Promise<void> {
  const tab = window.open("", "_blank");
  if (!tab) throw new PopupBlocked();
  try {
    const [o, d] = await Promise.all([
      api<LinkTeam>(`/api/season/${seasonId}/playlink/${offense}`),
      defense ? api<LinkTeam>(`/api/season/${seasonId}/playlink/${defense}`) : Promise.resolve(null),
    ]);
    const payload = await pack(
      d ? { v: 1, offense: withLooks(o), defense: withLooks(d) } : { v: 1, offense: withLooks(o) },
    );
    tab.opener = null;
    tab.location.href = `${FRANCHISE_URL}/play#roster=${payload}`;
  } catch (err) {
    tab.close();
    throw err;
  }
}

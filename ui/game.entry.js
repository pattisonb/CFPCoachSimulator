// The game as one script for the browser's workers (public/worker.js, public/sim-worker.js): the whole game
// (app_js/game.js) and the gzip a career's save file needs, bundled by tools/build_site.mjs (and by the dev server,
// vite.config.ts) as `game.js`, which sets the global `Game`.
import { gzipSync, Gunzip } from "fflate";

export * from "../app_js/game.js";

const CHUNK = 1 << 16;

/** The two functions `career.zip` asks of a host (career_js/career.js), answering at once. */
export const zip = {
  gzip: (bytes) => gzipSync(bytes, { level: 6 }),
  // unpacked a piece at a time, so a file that would unpack past `most` bytes is refused before it has
  gunzip(bytes, most) {
    const parts = [];
    let size = 0;
    const un = new Gunzip((part) => {
      size += part.length;
      if (size > most) throw new Error("the file unpacks to more than is allowed");
      parts.push(part);
    });
    for (let at = 0; at < bytes.length || at === 0; at += CHUNK) un.push(bytes.subarray(at, at + CHUNK), at + CHUNK >= bytes.length);
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  },
};

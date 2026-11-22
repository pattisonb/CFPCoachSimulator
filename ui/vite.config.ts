import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_ROOT = fileURLToPath(new URL(".", import.meta.url));
const GAME_CACHE = `${UI_ROOT}node_modules/.cache/cfp-game`; // the dev server's game script and data pack
const GAME_DIRS = ["engine_js", "sim_js", "teamdata_js", "career_js", "app_js"]; // the game's code (tools/build_site.mjs JS_DIRS)
// what lets the game share a week's games with its helper workers over shared memory (vercel.json sends the same two)
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// `npm run dev` serves the game the worker loads (public/worker.js), as the published site has it but with the real
// rosters: `game.js`, the whole game as one script, made again when a file of the game changes (the page reloads),
// and the data pack, made by the game itself when a source file has changed since the last one (tools/build_site.mjs
// dev_pack; some fifteen seconds, the first time). Nothing is written outside node_modules/.cache.
function gameFiles(): Plugin {
  type Tools = {
    bundle_game: (ui: string, outfile: string, minify?: boolean) => void;
    dev_pack: (cache: string) => string;
  };
  const script = `${GAME_CACHE}/game.js`;
  let stale = true;
  return {
    name: "cfp-game-files",
    apply: "serve",
    async configureServer(server) {
      // (read here, not at the top: the published site's build runs this file from a copy with no tools/ beside it)
      const build: Tools = await import(pathToFileURL(`${REPO_ROOT}tools/build_site.mjs`).href);
      mkdirSync(GAME_CACHE, { recursive: true });
      const pack = build.dev_pack(GAME_CACHE); // before the first page asks, so its load does not wait on it
      const dirs = GAME_DIRS.map((d) => `${REPO_ROOT}${d}/`);
      server.watcher.add([...dirs, `${UI_ROOT}game.entry.js`]);
      server.watcher.on("all", (_event, file) => {
        const f = file.replaceAll("\\", "/");
        if (!f.endsWith(".js") || !(f.endsWith("ui/game.entry.js") || dirs.some((d) => f.startsWith(d)))) return;
        stale = true;
        server.ws.send({ type: "full-reload" });
      });
      const send = (res: import("node:http").ServerResponse, file: string, type: string) => {
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Length": statSync(file).size,
          "Cache-Control": "no-store",
          ...ISOLATION,
        });
        createReadStream(file).pipe(res);
      };
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        try {
          if (path === "/game.js") {
            if (stale || !existsSync(script)) {
              stale = false;
              build.bundle_game(UI_ROOT, script, false);
            }
            send(res, script, "text/javascript");
          } else if (path === "/game-data.br") {
            send(res, pack, "application/octet-stream"); // (not packed: it never leaves this computer)
          } else next();
        } catch (e) {
          console.error(e);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(String(e));
        }
      });
    },
  };
}

// base "./" keeps every URL relative, so the build works under a sub-path.
export default defineConfig({
  plugins: [react(), gameFiles()],
  base: "./",
  // pocket-faces lives in this repository (../pocket-faces) and is read as source: nothing to install or build,
  // and an edit there shows up at once (tsconfig.json "paths" says the same to the type checker)
  resolve: {
    alias: [
      { find: /^pocket-faces\/data$/, replacement: `${REPO_ROOT}pocket-faces/src/data.ts` },
      { find: /^pocket-faces$/, replacement: `${REPO_ROOT}pocket-faces/src/index.ts` },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // the face art is most of the download (about 700 kB, 90 kB gzipped): its own file, cached apart from the app
      output: { manualChunks: (id) => (id.includes("/pocket-faces/") ? "faces" : undefined) },
    },
    chunkSizeWarningLimit: 800, // *tune* the faces chunk is the biggest, by design
  },
  server: {
    port: 5173,
    fs: { allow: [REPO_ROOT] },
    headers: ISOLATION,
  },
  preview: { headers: ISOLATION },
});

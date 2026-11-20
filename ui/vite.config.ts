import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const GAME_PORT = 8000; // the Python dev server (tools/dev_server.py)
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// true when something already answers on the port
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

// `npm run dev` also starts the game's API, unless one is already running.
function gameServer(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "cfp-game-server",
    apply: "serve",
    async configureServer() {
      if (await portInUse(GAME_PORT)) {
        console.log(`  Game API: already running on port ${GAME_PORT}`);
        return;
      }
      const python = process.platform === "win32" ? "python" : "python3";
      child = spawn(python, ["tools/dev_server.py", "--port", String(GAME_PORT)], { cwd: REPO_ROOT, stdio: "inherit" });
      child.on("error", (e) => console.error(`  Game API failed to start (${python}): ${e.message}`));
      const stop = () => {
        child?.kill();
        child = null;
      };
      process.once("exit", stop);
      process.once("SIGINT", () => {
        stop();
        process.exit(0);
      });
      process.once("SIGTERM", () => {
        stop();
        process.exit(0);
      });
    },
  };
}

// base "./" keeps every URL relative, so the build works under the GitHub Pages sub-path.
// In dev, /api goes to the Python dev server.
export default defineConfig({
  plugins: [react(), gameServer()],
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
    proxy: { "/api": `http://127.0.0.1:${GAME_PORT}` },
  },
});

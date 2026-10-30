/* Player portraits for the depth chart: sprite-test's locker room portrait (commit c5bb8fc) through
   tools/portraits/entry.ts, built by tools/build_portraits.mjs. Do not edit: rebuild it.
   window.CFPPortraits = { portrait, portraitCanvas, CROPS } */
(function () {
"use strict";
const SRC_ROOT = "sprite-test";
const defs = {
"CFPCoachSimulator/tools/portraits/entry": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CROPS = void 0;
exports.portrait = portrait;
exports.portraitCanvas = portraitCanvas;
const customize_1 = require("@/lib/game/customize");
const look_1 = require("@/lib/game/look");
const portrait_1 = require("@/lib/game/portrait");
const recolor_1 = require("@/lib/game/recolor");
exports.CROPS = {
    head: { top: 0, bottom: 18, width: 23 },
    hair: { top: -6, bottom: 20, width: 23 },
    bust: { top: 0, bottom: 31, width: 23 },
};
const BASE_ROWS = 31;
function buildFor(weight) {
    if (weight >= 285)
        return "large";
    if (weight >= 240)
        return "large-muscular";
    if (weight >= 205)
        return "muscular";
    return "lean";
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => {
    const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
};
const isHex = (s) => !!s && /^#[0-9a-f]{6}$/i.test(s);
function portrait(p, team = {}) {
    const base = (0, recolor_1.teamPalette)(customize_1.PARTS_META, customize_1.DEFAULT_TEAM, true, true);
    const ref = base.colors;
    const colors = { ...ref };
    const tone = (key, hex) => {
        colors[key] = ref[key] && ref[key].length > 1 ? [hex, (0, recolor_1.deriveShade)(hex, ref[key][0], ref[key][1])] : [hex];
    };
    const jersey = isHex(team.primary) ? team.primary : ref.jersey[0];
    const number = [team.accent, team.secondary, "#ffffff", "#111111"].filter(isHex).sort((a, b) => contrast(b, jersey) - contrast(a, jersey))[0];
    tone("jersey", jersey);
    tone("sleeves", jersey);
    tone("number", number);
    tone("helmet", jersey);
    if (isHex(team.secondary))
        tone("helmetDecal", team.secondary);
    const look = (0, look_1.randomLook)((0, look_1.seeded)(p.seed), { helmet: false });
    const weight = p.weight ?? look.body.weight;
    const body = { build: buildFor(weight), height: p.height ?? look.body.height, weight };
    const palette = (0, look_1.withLook)({ colors, showNumber: p.number != null, showStripe: true }, { ...look, body });
    return (0, portrait_1.buildPortrait)(palette, { number: p.number });
}
function portraitCanvas(p, team = {}, crop = "bust", scale = 1) {
    const img = portrait(p, team);
    const { top, bottom, width } = exports.CROPS[crop];
    const h = bottom - top;
    const out = document.createElement("canvas");
    out.width = width * scale;
    out.height = h * scale;
    const ctx = out.getContext("2d");
    if (!ctx)
        return out;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, (portrait_1.PORTRAIT_W - width) / 2, img.height - BASE_ROWS + top, width, h, 0, 0, width * scale, h * scale);
    return out;
}
},
"sprite-test/lib/game/ball": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_WOBBLE = exports.WOBBLE_LABELS = exports.WOBBLE_LEVELS = exports.BALL_SPIN_FPS = void 0;
exports.buildBallSprites = buildBallSprites;
exports.spinFrame = spinFrame;
exports.makeWobble = makeWobble;
exports.wobbleLevel = wobbleLevel;
exports.throwWobble = throwWobble;
exports.ballTilt = ballTilt;
exports.drawBall = drawBall;
exports.ballScale = ballScale;
exports.wobbleStars = wobbleStars;
const recolor_1 = require("./recolor");
const SPIN_FRAMES = [
    [
        "..XXXX..",
        ".XAAAAX.",
        "XAAWGAAX",
        ".XBBBBX.",
        "..XXXX..",
    ],
    [
        "..XXXX..",
        ".XAAAAX.",
        "XAAAAAAX",
        ".XBGWBX.",
        "..XXXX..",
    ],
    [
        "..XXXX..",
        ".XAAAAX.",
        "XAAAAAAX",
        ".XBBBBX.",
        "..XXXX..",
    ],
    [
        "..XXXX..",
        ".XAAGWX.",
        "XAAAAAAX",
        ".XBBBBX.",
        "..XXXX..",
    ],
];
exports.BALL_SPIN_FPS = 14;
function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rasterize(rows, colors) {
    const h = rows.length;
    const w = rows[0].length;
    const img = new ImageData(w, h);
    rows.forEach((row, y) => {
        for (let x = 0; x < w; x += 1) {
            const c = colors[row[x]];
            if (!c)
                continue;
            img.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
        }
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.putImageData(img, 0, 0);
    return canvas;
}
function buildBallSprites(palette) {
    const leather = palette.colors.ball?.[0] ?? "#763e17";
    const colors = {
        X: [20, 12, 8],
        A: hexToRgb(leather),
        B: hexToRgb((0, recolor_1.deriveShade)(leather, "#763e17", "#4a260e")),
        W: [236, 236, 236],
        G: [150, 150, 150],
    };
    return SPIN_FRAMES.map((rows) => rasterize(rows, colors));
}
function spinFrame(sprites, seconds) {
    return sprites[Math.floor(seconds * exports.BALL_SPIN_FPS) % sprites.length];
}
exports.WOBBLE_LEVELS = ["spiral", "slight", "noticeable"];
exports.WOBBLE_LABELS = { spiral: "Perfect spiral", slight: "Slight wobble", noticeable: "Noticeable wobble" };
exports.NO_WOBBLE = { level: "spiral", amp: 0, hz: 0, phase: 0 };
const DEG = Math.PI / 180;
function makeWobble(level, rnd = Math.random) {
    const deg = level === "spiral" ? 0.5 + rnd() : level === "slight" ? 12 + rnd() * 4 : 28 + rnd() * 8;
    const hz = level === "noticeable" ? 1.4 + rnd() * 0.5 : 2 + rnd() * 0.8;
    return { level, amp: deg * DEG, hz, phase: rnd() * Math.PI * 2 };
}
function wobbleLevel(quality, rnd = Math.random) {
    const q = Math.min(1, Math.max(0, quality));
    if (rnd() < 0.15 + 0.7 * q)
        return "spiral";
    return rnd() < 0.7 - 0.55 * q ? "noticeable" : "slight";
}
function throwWobble(quality, rnd = Math.random) {
    return makeWobble(wobbleLevel(quality, rnd), rnd);
}
function ballTilt(w, seconds, vx, vy) {
    let along = vx === 0 && vy === 0 ? 0 : Math.atan2(vy, vx);
    if (along > Math.PI / 2)
        along -= Math.PI;
    if (along < -Math.PI / 2)
        along += Math.PI;
    along = Math.max(-25 * DEG, Math.min(25 * DEG, along * 0.5));
    const ease = Math.min(1, seconds / 0.12);
    const a = 2 * Math.PI * w.hz * seconds + w.phase;
    return along + (w.amp * ease * (Math.sin(a) + 0.3 * Math.sin(1.7 * a + w.phase))) / 1.3;
}
function drawBall(ctx, img, x, y, tilt = 0, scale = 1) {
    if (Math.abs(tilt) < 0.5 * DEG && scale === 1) {
        ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
        return;
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(tilt);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
}
function ballScale(z) {
    return 1 + 0.3 * Math.min(1, Math.max(0, z) / 140);
}
function wobbleStars(w) {
    const deg = w.amp / DEG;
    if (w.level === "spiral")
        return 5;
    if (w.level === "slight")
        return deg < 14 ? 4 : 3;
    return deg < 32 ? 2 : 1;
}
},
"sprite-test/lib/game/build-ratings": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weightCols = exports.heightRows = exports.armFactor = exports.armQuality = exports.ratingQuality = exports.releaseFactor = exports.speedFactor = exports.BUILD_LIMITS = exports.DEFAULT_BUILD = void 0;
exports.loadBuild = loadBuild;
exports.saveBuild = saveBuild;
exports.reshape = reshape;
exports.DEFAULT_BUILD = { speed: 75, release: 75, arm: 75 };
exports.BUILD_LIMITS = { rating: [40, 99] };
const KEY = "practice-player-build-v1";
const d = (r) => (r - 75) / 25;
const speedFactor = (b) => 1 + 0.28 * d(b.speed);
exports.speedFactor = speedFactor;
const releaseFactor = (b) => 1 + 0.35 * d(b.release);
exports.releaseFactor = releaseFactor;
const ratingQuality = (r) => r >= 50 ? Math.min(1, 0.5 + (0.5 * (r - 50)) / 49) : Math.max(0, 0.5 - 0.03 * (50 - r));
exports.ratingQuality = ratingQuality;
exports.armQuality = exports.ratingQuality;
const armFactor = (b) => 1 + 0.3 * d(b.arm);
exports.armFactor = armFactor;
const heightRows = (inches) => Math.max(-2, Math.min(2, Math.round((inches - 74) / 2.5)));
exports.heightRows = heightRows;
const weightCols = (pounds) => Math.max(-2, Math.min(3, Math.round((pounds - 225) / 25)));
exports.weightCols = weightCols;
function loadBuild() {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw)
            return { ...exports.DEFAULT_BUILD };
        const p = JSON.parse(raw);
        const clamp = (v, [lo, hi], dflt) => (typeof v === "number" ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt);
        return {
            speed: clamp(p.speed, exports.BUILD_LIMITS.rating, exports.DEFAULT_BUILD.speed),
            release: clamp(p.release, exports.BUILD_LIMITS.rating, exports.DEFAULT_BUILD.release),
            arm: clamp(p.arm, exports.BUILD_LIMITS.rating, exports.DEFAULT_BUILD.arm),
        };
    }
    catch {
        return { ...exports.DEFAULT_BUILD };
    }
}
function saveBuild(b) {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(b));
    }
    catch { }
}
function reshape(src, ax, rows, cols) {
    const W = src.width, H = src.height;
    const head = Math.round(H * 0.27);
    const at = (x, y) => (y * W + x) * 4;
    const lo = Math.round(W * 0.38), hi = Math.round(W * 0.62);
    const sites = cols === 0 ? [] : [lo, hi].slice(0, Math.min(2, Math.abs(cols) >= 2 ? 2 : 1));
    const perSite = sites.length ? Math.abs(cols) / sites.length : 0;
    const W2 = W + cols;
    const wide = new ImageData(Math.max(1, W2), H);
    const headShift = Math.round(cols / 2);
    for (let y = 0; y < H; y += 1) {
        if (y < head) {
            for (let x = 0; x < W; x += 1) {
                const nx = x + headShift;
                if (nx >= 0 && nx < W2)
                    wide.data.set(src.data.subarray(at(x, y), at(x, y) + 4), (y * W2 + nx) * 4);
            }
            continue;
        }
        let nx = 0;
        for (let x = 0; x < W && nx < W2; x += 1) {
            const site = sites.indexOf(x);
            const extra = site < 0 ? 0 : Math.round(perSite * (site + 1)) - Math.round(perSite * site);
            if (cols < 0 && site >= 0)
                continue;
            const px = src.data.subarray(at(x, y), at(x, y) + 4);
            wide.data.set(px, (y * W2 + nx) * 4);
            nx += 1;
            if (cols > 0)
                for (let k = 0; k < extra && nx < W2; k += 1) {
                    wide.data.set(px, (y * W2 + nx) * 4);
                    nx += 1;
                }
        }
    }
    const H2 = H + rows;
    const out = new ImageData(Math.max(1, W2), Math.max(1, H2));
    const span = Math.max(1, H - 3 - head);
    const picks = Array.from({ length: Math.abs(rows) }, (_, i) => head + Math.round(((i + 1) * span) / (Math.abs(rows) + 1)));
    let ny = 0;
    for (let y = 0; y < H && ny < H2; y += 1) {
        const row = wide.data.subarray(y * W2 * 4, (y + 1) * W2 * 4);
        if (rows < 0 && picks.includes(y))
            continue;
        out.data.set(row, ny * W2 * 4);
        ny += 1;
        if (rows > 0 && picks.includes(y) && ny < H2) {
            out.data.set(row, ny * W2 * 4);
            ny += 1;
        }
    }
    if (rows !== 0 || cols !== 0)
        closeOutline(src, out);
    return { img: out, ax: ax + headShift };
}
function closeOutline(src, img) {
    const edge = (d) => {
        const out = [];
        const { width: w, height: h, data } = d;
        const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
        for (let y = 0; y < h; y += 1)
            for (let x = 0; x < w; x += 1) {
                if (solid(x, y) && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)))
                    out.push((y * w + x) * 4);
            }
        return out;
    };
    const counts = new Map();
    const srcEdge = edge(src);
    for (const i of srcEdge) {
        const c = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2];
        counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let outline = -1, most = 0;
    for (const [c, n] of counts)
        if (n > most) {
            most = n;
            outline = c;
        }
    if (outline < 0 || most < srcEdge.length * 0.85)
        return;
    const { width: w, height: h, data } = img;
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
    const isOutline = (x, y) => {
        const i = (y * w + x) * 4;
        return ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) === outline;
    };
    const fill = [];
    for (let y = 0; y < h; y += 1)
        for (let x = 0; x < w; x += 1) {
            if (solid(x, y))
                continue;
            const exposed = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => solid(nx, ny) && !isOutline(nx, ny));
            if (exposed)
                fill.push((y * w + x) * 4);
        }
    for (const i of fill)
        data.set([(outline >> 16) & 255, (outline >> 8) & 255, outline & 255, 255], i);
}
},
"sprite-test/lib/game/characters/rb-portrait.json": function (module, exports, require) {
module.exports = {"raw":["#dc3c08","#fe580e","#ffffff","#c2cdc7","#f6344f","#d04445","#b92e05","#ee240c","#39221a","#151312","#3c3533","#a5111f","#253baa","#132496","#ae2129","#1d1d1d","#160b00","#b70926","#860117","#ef3d4d","#e03c43","#9c2e3b","#3d4770","#313548","#175740","#000666","#071977","#16151d","#2d2b3e","#202020","#363636","#4a4665","#24222f","#282828","#decc05","#171513","#e1e1e1","#c0c0c0","#313131","#cccccc","#2737be","#94909b","#0c1013","#0080c6","#03679e","#827d88","#625d69","#27242c","#3e3a43","#23211e","#0c1826","#767367","#1b120b","#3377b9","#0f487f","#3c353d","#c6c9ea","#d9c291","#a1a4ca","#7a7d9b","#000000"],"hair":[{"x":8,"y":1,"rows":["...AAAAA...",".AAAAAAAAA.","AAAAAAAAAAA","AA.......AA","A.........A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":6,"y":-3,"rows":[".......A.IA.....","......A.IAI.....",".....IAAAI......",".....AAAAA......",".....UUUUU......","...IAIAIAIAI....","..IAIAIAIAIAI...",".AAIAIAIAIAIAA..",".AA.........AA..",".A...........A..",".A...........A..","..............A.","..............I.","...............A","................",".A...........AI.",".I............AA","IA..........AI..","A............A.."],"field":"afro"},{"x":8,"y":2,"rows":["..AAAAAAA..",".A.......A.","A.........A","A.........A","A.........A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":0,"rows":["...UU.U.U..","..UUUUUUUU.","UUUUUUUUUUU","UAAAAAAAAAU","AA.......AA","A.........A","A.........A","U.........U","U.........U","U.........U","U.........U"],"field":"short"},{"x":8,"y":2,"rows":["..AIIAAAAA.",".AAAAIIAAAA","A..AAAAAIIA","A......AAAI","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..IIIIIAA..",".IIIIIAAAI.","I.~~IAAAAAI","I........AA","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AAAAAAAAA.","AAAAAAAAAAA","A..AAAAA..A","A.........A","U.........U","U.........U","U.........U"],"field":"short"},{"x":8,"y":1,"rows":["..IAAIAAI..",".AAIAIAIAA.","AAAAIAIAAAA","AAA~~~~~AAA","A~~.....~~A","A.........A","I.........I","I.........I","I.........I"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AAAAAAAIA.","AAAAAAAIAAA","AAAAAAI..AA","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AAAAAAAAA.","AAAAAAAAAAA","A...AAA...A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":0,"rows":[".aaAaaa.a..","aaAAAaaaAa.",".AAaAAaAaaa","aAAA.....aa","A.AAA.....A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":2,"rows":["..AAAAAAA..",".A~~~~~~~A.","A~.......~A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":9,"y":1,"rows":["..AAaaA..",".aaAAAAA.","aAAaaAA.A","A.AAA...A","A.......A","A.......A","A.......A","A.......A","A.......A"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AUUUUUUUA.","A.........A","A.........A","A.........A","A.........A","U.........U","U.........U","U.........U"],"field":"short"},{"x":6,"y":1,"rows":["...UUAUAUAUU...","..UAAUAUAUAAU..",".UAAIIIIIIIAAU.","UAAIaaaaaaaIAAU","UAIaAAAAAAAaIUA","AUa.........aUA","AAU.........AAA","A.a.........a.A","a.............a","a.............a","aA...........Aa",".aA.........Aa.","..a.........a.."],"field":"short"},{"x":6,"y":1,"rows":["....AA.AAAIA....","...AIAAIIIIAA...","..AIaIaaaaAIAA..",".AIaZZZZZZaAIA..",".IaZZZZUZZZaAIA.",".IZZZZZZZZZZaAI.","AIZZ.......ZZAI.","AIZ.........ZAI.","AI...........IA.","AI...........IA.","AIa.........aIA.","AIa.........aIA.","AIa.........aIA.","AIaa.......aaIA.","AIaa.......aaIA.",".AIa.......aa.IA","...a.......a..IA"],"field":"short"},{"x":5,"y":1,"rows":["...AIIAA.AAIII....","..AIAAAA~AAAAAI...",".AIAAIIA.AIIIAAI..",".IAAIAAA~AAAAIAAI.",".IAI~~~~.~~~~AIAI.",".IAI.........AIA.I",".IAI..........AI..","I..I...........I..","................I.","..A...........A...","..A...........A...",".A.A.........A....",".A.A..........A..."],"field":"short"},{"x":5,"y":0,"rows":["....I.I.I.I.I....","..AIAIAIAIAIAI...",".AIAAAAAAAAAAAI..","IAAAAAAAAAAAAAAA.","AIAAA........AAIA","IAAA.........AAAI","AAAA..........AAA","IAA...........IAI","AAA............AA","IAA............AA","AAA............A.",".AAA.........AAA.","..IA.........AI..","...I.........I..."],"field":"short"},{"x":8,"y":1,"rows":["..IAAIAII..",".IAAAAIAIA.","IAAAAAAIAAA","IAA......AA","AA........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":0,"rows":[".A.AA......",".IAAAIAAA..",".AIIAAIAAA.","AAAAIAAIIAA","A.AAAA.AAAA","I.........I","I.........I","I.........I","I.........I"],"field":"short"},{"x":8,"y":1,"rows":["A.AUA.AAUA.","AAUAUAAUAUA","AUAAAAUAAAA","AA..A..A.AA","A.........A","U.........U","U.........U","U.........U"],"field":"short"},{"x":8,"y":1,"rows":["..AIAUAIA..",".AIAUAUAIA.","AIAIAAAIAIA","A.........A","U.........U","U.........U","U.........U","U.........U"],"field":"short"},{"x":8,"y":0,"rows":["..AAAAAAA..",".AIAIAIAIA.","AI..III..IA","I.........I","A.........A","I.........I","I.........I","y.........y","y.........y"],"field":"short"},{"x":8,"y":1,"rows":["..IIAAAII..",".AyyyAAAAA.","Ay...yyyyyA","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":4,"y":1,"rows":[".....AAAAAAAAA.....","....AAIIIUUIIAA....","...AAIIIIIUIIIAA...","..AAAIIIIIIIIIAAA..","..AAAIAAAAAAAIAAA..","..AAAA.......AAAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.",".AAAA.........AAAA.","A.AAAA.......AAAAAA","A.AAAA.......AAAAAA",".A.AAA.......AAA..A",".A..AA.......A.A..."],"field":"short"},{"x":8,"y":0,"rows":["...UUUUU...",".UUUUUUUUU.","UUUAAAAAUUU","AAAAAAAAAAA","II.......II","U.........U","U.........U"],"field":"short"},{"x":7,"y":-1,"rows":["......U.U...","..UUUUUUUU..",".UUAUAUUUAUU","UAUAAUAAUAUA",".AAAAAAAAAAA",".AAA~~~~~AAA",".A~~.....~~A",".~.........~"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".A~AAAAA~A.","AA.~~~~~.AA","AA.......AA","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":9,"y":1,"rows":["..AAAAA..",".A.....A.","A.......A","A.......A","I.......I","I.......I","I.......I"],"field":"short"},{"x":7,"y":-1,"rows":["..AAAAAAAAA..",".AAAAAAAAAAA.","AAAIAIAIAIAAA","AAIAIAIAIAIAA","AIA~~~~~~~AIA",".A~.......~A.",".A.........A.",".I.........I.",".I.........I."],"field":"short"},{"x":8,"y":2,"rows":["..AIAIAIA..",".AIAAIAAIA.",".A.......A.","A.........A","I.........I","I.........I","I.........I"],"field":"short"},{"x":9,"y":-8,"rows":["....A....","..A.AI...","AIAIAIAI.",".AIAIAI..","AAAAAA.I.","..IIAII..",".AAAAAA..","A..AIA.A.","..AIAIA.A","..IAAAI..",".AAIIIAA.","AAAAAAAAA","AA~~~~~AA","A.......A"],"field":"curly"},{"x":6,"y":2,"rows":["....AAAAAAA...","...AAAAAAAAA..","..AAUUIIIIUAA.","..AIIIIIIIIIA.","..AIIAAAAAIIA.","..AAA~~~~~AAA.","..AA.......AA.","...A.......A..","..A........A..",".AA.........A.",".AA.........AA",".A...........A","A............A","A............A",".A...........A",".A..........A."],"field":"short"},{"x":8,"y":2,"rows":["..AAAAAAA..",".AAIIIIIAA.","AAI.....IAA","AI.......IA","AI.......IA","A.........A","U.........U","U.........U","U.........U"],"field":"short"},{"x":8,"y":-1,"rows":["....AIA....","...AIAIA...","....aaa....","..aaaaaaa..",".AAIAIAIAA.","AAIAIAIAIAA","AA.......AA","A.........A","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..AAIAIAA..",".IAIAIAIAI.","IA~~~~~~~AI","AI.......IA","A~.......~A","A.........A","A.........A","~.........~"],"field":"short"},{"x":7,"y":0,"rows":["..AAAAAAA....",".AAIAIAIAAI..",".AAAAAIAIAAI.","AAAAAAAAAAIA.","AIAA~~~~~~AIA","IAA~......AAI","AI~.......~IA",".A.........A.",".I.........I."],"field":"short"},{"x":4,"y":-1,"rows":["....A..............",".....AA.AA.A.A.....","..AAAAAAIIIIIII.A..","...AIAAAAAAAAAAIA..","..AIAAIIIIIIIIAAI..","..IAAIAAAAAAAAIAAA.",".AAAI~~~~~~~~~AIAA.",".AAAI.........AIA.A",".AAAI..........AA..","AAA.I...........A..","A.A.............AA.","..AA...........AA..",".A.A...........A...","..A.A.........A....","....A.............."],"field":"short"},{"x":8,"y":1,"rows":["...AAAAA...","..AUUUAAAA.",".AAAAAAUAAA","AA.AAAAAUUA","A......AAAU","A.........A","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..AIIAAAII..",".IAAAIIAAAI.","IA~AAAAAIIAI","A~...~~AAAI.","A.......~AA.","A........~A.","I.........I."],"field":"short"},{"x":7,"y":0,"rows":["....AAAAA....","...AAUAAAAA..","..AAUAUAAAUA.",".AAUA~~AAUAAA","AUUA~..~~~UAA","UAAU......UAA","AUU........AA","UA.........AA",".A.........A."],"field":"short"},{"x":8,"y":1,"rows":["..AAAAA.A...",".AAIIIIAIA..",".AIAAAAAIIA.","AIA.....AIIA","AA.......AA.","A.........A.","A.........A.","A.........A."],"field":"short"},{"x":7,"y":1,"rows":["...AIAIAAI...","..AAAAAIAAI..",".AAAAAIAAAAI.",".AAA.I.IAIAA.","AAA......AAAA","AA........AAA","AA.........AA",".A.........A.",".A.........A.",".A.........A."],"field":"short"},{"x":8,"y":2,"rows":["..AAAAAAA..",".AAAAAA..A.","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AAZAZAZAA.","AAZAZAZAZAA","AZ~~~~~~~ZA","A.........A","A.........A","Z.........Z","Z.........Z"],"field":"short"},{"x":8,"y":0,"rows":["....II.A.A.",".AAIIIIIA.A","AAAAIIIAAAA","IAA.....AAI","I.........I"],"field":"short"},{"x":8,"y":0,"rows":["..AA.AA.AA.",".AAAAAAAAAA","AAAAAAAAAAA","AAA~~~~~AAA","A~~.....~~A"],"field":"short"},{"x":7,"y":0,"rows":["..A.UA.U.A.U.",".UAAUAAAUAUAA","AAUAAUAAAAUAU","AUAAAAAAAAAAA","AAA~~~~~~~AAA",".A~.......~A.",".A.........A.",".A.........A.",".U.........U.",".U.........U."],"field":"short"},{"x":8,"y":1,"rows":["..AAAIIIA..",".AIIIAAAAA.","A....AI.AIA","A...AI.AI.A","I.........I","I.........I","I.........I"],"field":"short"},{"x":5,"y":2,"rows":["....aaAAaAAaa..","...aAAaaAaaaaa.","..aAaaAaaAAaaA.",".AaAaA~~~~~AaaA",".AaAa~.....~AaA",".AaA~.......~aA",".AaA.........aA",".AaA.........aA",".AaA.........aA",".AaA.........aA",".AaA.........aA",".AaA.........aA","AaAaA.......aaA","AaAaA.......aA.",".aAaA.......aA.",".aA.A......aaA.",".aA.A......a.A.",".aA........a...","..A............"],"field":"long"},{"x":8,"y":0,"rows":["..AIIIIIA..",".AAAIIIAAA.","AAyyAAAyyAA","Ay..yyy..yA","y.........y","y.........y","y.........y"],"field":"short"},{"x":8,"y":0,"rows":["..A.A.A.A..",".AAAAAAAAA.","AAAAUAAAAAA","AAAAAAAAAAA","AA~~~~~~~AA","A.........A"],"field":"short"},{"x":7,"y":1,"rows":["..AAAAAAAI..",".AAAAIAIAAI.",".AIAIAIAIAAI","AAA~~~~~~AAI","AA~......~AA","AA.........A",".A.........A",".A.........A"],"field":"short"},{"x":5,"y":0,"rows":[".....AAAA.AA.....","....AAAIAAAIA....","...AAIAIAAIAIA...","..AAI~~I~~AIAIA..",".AAI~..I~.AIIAIA.",".AII.......IAIAA.","AIAI.......I~IIAA","AIAI.........IAIA","AAA~.........IAIA","AIA..........~AI.",".A.............A.",".A.............A.","..A...........IAA",".AAA.........AAAA",".A.A.........AA.A","...A..........A.."],"field":"short"},{"x":7,"y":-5,"rows":["......A......","....A.AI.....","..AIAIAIAI...","...AUAIAI..II","..AAAUAIAII..",".IA.IAAAIA...","U...AIUIAIA..","...AAAAUAA.A.","..AA~~AI~AA.A","..A~..~I~~A..","..~.....U.~..","........U...."],"field":"curly"},{"x":5,"y":2,"rows":[".....AIA.AIA.....","....AAAIAIIAA....","...AIAIA~AAIAA...","..AIA~A..IA~AIA..",".AIAAAA.IAIA~AIA.",".IAI~AA.A.AI~IAA.","AAIAA~A.I.I.IAIAA",".AAA~.......A.AA.","..A.........I.IAA",".A..........A.A.."],"field":"short"},{"x":8,"y":2,"rows":["..AAIAAAAA.",".AAIAIAIAAA","AA~AIAIAIAA","A~.~~~~AAAA","A......~~~A","A.........A","I.........I"],"field":"short"},{"x":8,"y":0,"rows":["...AAAAA...","..AAIAIIAA.",".AAAAIAAIAA","AA~.A.~AAIA","A~.....~~AA","A........~A","A.........A","A.........A","A.........A"],"field":"short"},{"x":8,"y":0,"rows":["...AIAIAI..","..AAAIAIAI.",".AAAIAIAIAI","AA~.....~IA","A~.......~A","A.........A","A.........A","A.........A","A.........A"],"field":"short"},{"x":6,"y":0,"rows":["......A.AAA......","...AAAAAAAAA.....","..AAAAAAAAAAA....",".AAA~.....~AAA...",".AA~.......~AA...",".A~.........~A...",".A...........A...",".A...........A...",".................",".................",".................",".............AA..",".A...........AAI.","A............AA.I","............AAAA.","............AAAA.","............AAA.A","............A.A..","............A...."],"field":"long"},{"x":8,"y":-2,"rows":["....A.I.I.I..","..A.IAIAII...","...AAIAIA.I..","..AAAAAAII.I.",".AAAAAAAAAI..",".A~.....~AAII","AA.......AA..","A~.......~AI.","A.........A.I","A.........AI.","............I"],"field":"curly"},{"x":8,"y":1,"rows":["..AIAIAIA..",".AIAIAIAIA.","AI~~...~~IA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":8,"y":1,"rows":["..AAAIAIA..",".AAAAAIAIA.","Ay.......yA","A.........A","y.........y"],"field":"short"},{"x":7,"y":0,"rows":["....AAAA.....","..AAAAIAAAA..",".AAAIAIAAIAA.",".AIAAIIAIAIAA","AIAy...~IIAAA","AAy......~IIA","AIy.......~AA","AA.........IA",".A.........A.",".A.........A."],"field":"short"},{"x":7,"y":-1,"rows":[".........A.A.","...AAA.AAIA..","..AAAAAAIAIAA","..AAAIAIAIAA.",".AAAIAIyyyIAA",".AAy......yAA","AAy........AA","AA.........AA","AA.........AA",".A.........A.",".A.........A."],"field":"short"},{"x":9,"y":2,"rows":["..IAAAA..",".AAIIAAA.","A~.....~A","A.......A","A.......A","~.......~","~.......~"],"field":"short"},{"x":8,"y":1,"rows":["...I.I.....","..AAAAIAIAA",".AAIAIAIAI.","AAIAIIIAIAA","AAA~.A~AAAA",".A~.....~A.",".I.......I.",".~.......~.",".~.......~."],"field":"short"},{"x":4,"y":1,"rows":["......AIIAIIA.....","....AIIAAIAAAAA...","...AAAAIAAIIAAIA..","...AIAI~~~~~IAIA..","...AAA~.....~III..","..IAI~.......~IAI.","..IAA.........IIA.","..IAI.........IAI.","..AIA.........IIA.",".AIAI.........IAIA",".AAIA.........IIAA",".AIAI.........IAIA",".IAIA.........AIAI",".IIAA.........AIAA","AAAIA.........AIAI","AAIIA.........IAIA","A.AAA.........IAA.","A.IAA.........AAIA","...AA.........A.AA","....A.........A.A.",".....A............"],"field":"long"},{"x":8,"y":1,"rows":["...AAAAA...","..A~~~~~A..",".A~.....~A.","A.........A","A.........A","~.........y"],"field":"short"},{"x":6,"y":1,"rows":["....AAA.AAA.....","...AAAAAAIAA....","..AIAI~~~AIAA...",".AIA~A...U~AIA..",".AAAU~...UAUAA..",".AU~U....U.UIAA.","AAUAU......AAIA.","AAU~.......A.AU.",".A.........A.AAA","AA...........A.A","AU...........A.U","U............A.A","U............A..",".............AA.",".............A.."],"field":"short"},{"x":6,"y":1,"rows":["...AAAAA.AA....","..AAAAAAAAAAA..",".AAAAAAAAAAAAA.","AAAAAAAAAAAAAAA","AAAAAAAAAAAAAA.","AAAA~~~~~~~AAAA",".AA~.......~AA.","A.A.........A..","..I.........I..","..I.........I..","...............","A.............A","...............",".A............."],"field":"short"},{"x":8,"y":2,"rows":["..AIIAAAII..",".IAAAIIAAAI.","IA~AAAAAIIAI","A~...~~AAAI.","A.......~AA.","A........~A.","I.........I."],"field":"short"},{"x":4,"y":0,"rows":["....A..............",".....AA.AA.A.A.....","..AAAAAAIIIIIII.A..","...AIAAAAAAAAAAIA..","..AIAAIIIIIIIIAAI..","..IAAIAAAAAAAAIAAA.",".AAAI~~~~~~~~~AIAA.",".AAAI.........AIA.A",".AAAI..........AA..","AAA.I...........A..","A.A.............AA.","..AA...........AA..",".A.A...........A...","..AAA.........AAA..","...AA..........A..."],"field":"short"},{"x":5,"y":1,"rows":["....AA.AAIA.A....","...AAAAIIIIAIA.A.","..AIAAAAAAAAAAIA.",".AIAAIIIIIIIIAAI.",".IAA~~~~~~~~~IAAA","IAAI.........AIAA","AAII.........AIA.",".AA~.........~AA.","AAA...........AAA",".A.............A."],"field":"short"},{"x":7,"y":1,"rows":["......UUUA...","..UAAUUUAUAA.",".UAAUAUUAUUAA","AAAUAUUUUAUUA","AAAAAAAU..AAA",".A.........A.",".A.........A.",".A.........A.",".A.........A."],"field":"short"},{"x":7,"y":2,"rows":["...IAAAAA....","..IAIAIAIAI..",".IA~~~~~~~AI.",".A~.......~A.","AI.........I.",".A.........A.","IA.........AI","AA.........AA"],"field":"short"},{"x":7,"y":2,"rows":["...A.A.AAA...","..AIAAAAAIA..",".AIAIAIAIAIA.",".IAIAIAIAIAI.","AAI~~~~~~~IAA","AA~.......~AA","AA.........AA",".A.........A."],"field":"short"},{"x":8,"y":2,"rows":["..IAAIAAI..",".AAIAIAIAA.","AAAAIAIAAAA","AA~~~~~~~AA","AA.......AA","A~.......~A","A.........A","y.........~"],"field":"short"},{"x":6,"y":2,"rows":["....AAA.AII....","...IAIIAIAAI...","..IAIAIAAAAAI..",".IAAy.....yAAI.",".IAA.......AII.",".AAy.......yAI.",".IA.........IA.",".AA.........AI.","..A.........A..","..y.........y..","...............","Aa...........A.",".AA.........AAa","Aaa.........aaA","A.a.........aa.","..a............"],"field":"short"},{"x":4,"y":1,"rows":["....A..............",".....AA.AA.A.A.....","..AAAAAAIIIIIII.A..","...AIAAAAAAAAAAIA..","..AIAIAAAAAAAAIAI..","..IAI~~~~~~~~~AAAA.",".AAAI.........AIAA.",".AAAI..........IA.A",".AAA...........AA..","AAA.............A..","A.A.............AA.","..A.............AA.",".AAA...........AA..","..AAA.............."],"field":"short"},{"x":7,"y":2,"rows":[".......AAAA..","..AAAAAAAAAA.",".AAIAIAIAIAAA","AAAAAAAAIIIAA","AA~.......~IA","AA.........AA",".A.........A.",".A.........A.",".A.........A.",".~.........~."],"field":"short"},{"x":7,"y":2,"rows":["..AAAAAAAAA..",".AAAAAAAAAAA.","AAAIAIAIAIAAA","AAIAIAI~~AIAA","AIA~~....~AIA",".A~.......~A.",".A.........A.",".I.........I."],"field":"short"},{"x":4,"y":1,"rows":["..........AAAA.....",".....AAAAAAIAAA....","....AAIIIAIAIAIA...","...AAAAAAAAIAIAAA..","..AAAAAAAAAAAAAAA..","..AAAA.......AAIAA.",".AIAA.........AIAA.",".AAIA.........AAIA.",".AIAA.........AAIAA",".IAA...........IAA.",".IAA...........AIAA",".AIA...........IAAA","AIAAA.........AAIA.","..AAA.........AAAAA","...AA.........AA..."],"field":"short"},{"x":4,"y":1,"rows":["........AA.A.......",".....AAIIAIIAA.....","....AIIAAIAAAAA....","...AIAAIAAIIAAI....","..IAIAI~~~~~IAAI...","..IAIA~.....~IAIA..","..IAI~.......~AIA..","..IAI.........AIA..",".AIAI.........AIA..",".AIAI.........AIAA.",".AIAA.........AIAA.",".AAAI.........AIAI.",".AIAA.........AAAI.",".IAIAA.......AAIAA.",".AAAAA.......AAAAIA","AIAIAA.......AIAAAA","AAAA.A......AAAIA.A","A.AI.A......A.IAA.A","..AA........A.A.A..","...I..............."],"field":"long"},{"x":8,"y":3,"rows":["..AAAIIIA..",".AIIIIAAAA.","AA...IIIIAA","A.......I.A","I.........I","I.........I","A.........A"],"field":"short"},{"x":6,"y":1,"rows":["...IAIAIAIAI...","..IAIAIAIAIAI..",".IAIAAAAAAAIAI.",".AAAAAAAAAAAAA.","AIAAyyyyyyyAAIA","IAAy.......yAAI","AAy.........yAA","IA...........AI","Ay...........yA"],"field":"short"},{"x":3,"y":1,"rows":["......IAIA.AAA.......",".....IAAAAAAIAIA.....","....IAIAA~~~AIAIAI...","...IAAA~....~AAAIAI..","..IAIAA......AAAAAAA.",".IAIAA~......A~AIA.AA",".AIAAA.........AAIA..","AIA.A~.........~AAI..","AAA.A...........AAAA.","AA.IA...........A.AA.","...AA...........A..A.","..IAAA.........AAI...","..AA............AAI..",".................AA.."],"field":"short"},{"x":3,"y":2,"rows":["........AAAAAA...","......AAAAAAAAA..","....UAAAAAAAAAAA.","...UAUA~.....~AA.","..U.UA~.......~AA",".U.UA~.........~A","..UAA...........A",".UUAA...........A","U.AA.............",".UIA.............",".UUA.............","U.UAA............","U.UUA............","..U.AA...........","..U.UA...........",".....A..........."],"field":"short"},{"x":8,"y":3,"rows":["..AAAAAAA..",".AAIIIIIAA.","AAAAAAAAAAA","AAA~...~AAA","A~.......~A","~.........~"],"field":"short"},{"x":10,"y":2,"rows":["..~~~..","~~~~~~~"],"field":"short"},{"x":7,"y":1,"rows":["....AAAAA.....","...A~~~~~A....","..A~.....~A...",".A.........A..",".A.........A..",".~.........y..","..............","..............",".............A","A.............","............A.",".............A"],"field":"short"},{"x":5,"y":1,"rows":["......AA~AA......","....AAII~IIAA....","...AAAIA~IIAAA...","..AIAI~~.~~IAII..","..AIA~.....~IAI..",".IAI~.......~AIA.",".IAI.........AIA.",".IAI.........AIA.",".IAI.........AIA.","AIAI.........AIAA","AIAA.........AIAA","AAAI.........AIAI","AIAA.........AAAI","IAIAA.......AAIAA","AAAAA.......AAAAI","IAIAA.......AIAAA","AAAAA......AAAIAA","AAI.A......A.IAAA","..A........A.A.A."],"field":"long"},{"x":5,"y":-2,"rows":["........A........",".......A.IAA.....","......IAAAAAAA...","......AAAAAAA....","....IAIAAAAAI....","...IAIAAAAAIAI...","...AAAAAAAAAIA...","..AA~......~AIA..",".AA.........~AIA.","A.A..........AI.A","..~..........~I..",".............~I..","..............A..","..............AI.","..I............I.",".I.............A.","................I","................A"],"field":"curly"},{"x":7,"y":1,"rows":["...AIAIAIA...","..AIAIAIAIA..",".AIAAAAAAAIA.","AAAAAAAAAAAAA","IAAyyyyyyyAAI","AAy.......yAA","Ay.........yA","A...........A","y...........y"],"field":"short"},{"x":5,"y":2,"rows":[".....aAA.AAa.....","...aAAaaAaaAAa...","..aAaaAaaaAaaAa..","..aAaA~~~~~AaAa..",".AaAa~.....~aAaA.",".AaA~.......~AaA.",".AaA.........AaA.",".AaA.........AaA.",".AIA.........AIA.",".IAI.........IAI.",".AIA.........AIA.",".IUI.........IUI.","UUIU.........UIUU","UUUUU.......UIUUU","UUUUU.......UUUUU","UUUUU.......UUUUU","UUUUU.......UUUUU","UUU.U.......U.UUU","U.U...........U.U","..U...........U..","..U...........U.."],"field":"long"},{"x":5,"y":1,"rows":[".....AAaZaAA......","....AAaaZAaAA.....","...AaZZZZZZZaA....","..AaZ~....~ZZaA...","..Aa~.......ZaA...","..Aa.........ZaA..",".aA~.........~aA..",".aA...........aA..",".aA...........AA..",".aA...........AA..",".aA...........Aa..",".aA...........Aa..",".AA~.........~AA..",".AAZ.........ZAa..",".AAZ.........ZAA..",".AaaZ.......ZZaAA.",".AAaZ.......ZaaAA.",".Aaa.........a.Aa.","Aa.a.........a.A.a","a..a...........a.."],"field":"long"},{"x":3,"y":1,"rows":["......IAIA.AAA.......",".....IAAAAAAIAIA.....","....IAIAA~~AAIAIAI...","...IAAA~...~AAAAIAI..","..IAIAA.....AAAAAIAI.",".IAIAA~.....~AAAIAII.",".AIAAA........~AAIAII","AIAIA~.........~AAIAI","AAIAA...........AAAIA","AAAIA...........AAAAA",".AIAA...........AIAIA",".AIAAA.........AAAIA.","..AAAA.........AAAIA.","...AAA.........AAAAA.",".....A.........AA.A.."],"field":"short"},{"x":4,"y":1,"rows":["......IIIIIII.......",".....IAAUUUAAI......","....AAIIIUIIIAA.....","....AIAAAAAAAIA.....","....AA~.....~AA.....","....A~.......~A.....","....~.........~.....","....................","....................","................A...","...I...........AAI..","..IA...........AIII.",".IAIA.........AAAI.I","I.IAA.........AIAAI.",".AAIA.........AIAIA.",".AA.I..........AI.A.",".I.................."],"field":"short"},{"x":8,"y":0,"rows":["...AAAAA...",".AAIIAIAA..","AAIAAy~~AA.","AIA~~...~AA","AA~~.....~A","A~........A","A.........A","A.........A","~.........~"],"field":"short"},{"x":8,"y":-3,"rows":["....aaa....","...aIAIa...","..aIAIAIa..","..aAIAIAa..","...aaaaa...","..aAaAaAa..",".AAIAIAIAA.","AAIAIAIAIAA","AA.......AA","A~.......~A","A.........A","~.........~"],"field":"curly"},{"x":5,"y":0,"rows":["..AAAAAAAAAA...",".AAAAAIAIAAAAA.",".AAAAIAIAIAAIAA","AAAAAAAAAAAAAA.","AIAAAA~~~~~~AAA","AAIAA~......AAA",".IAA~.......~AA",".AIA.........A.","..AA.........A.","...~.........~."],"field":"short"},{"x":8,"y":-3,"rows":[".....A.....",".....I..III","..AA.AIAI..","..AIAAAIAII","...AIAIAIA.","..AAAIAIA..",".AA~~~~~AA.","A~.......~A"],"field":"curly"},{"x":7,"y":2,"rows":["..AAAAAAAAA..",".AAAAAAAAAAA.","AAAIAIAIAIAAA","AAI~~~~~~~IAA","AI~.......~IA",".A.........A.",".~.........~."],"field":"short"},{"x":8,"y":1,"rows":["..AIAIAIA..",".IIIIIIIII.","AAAAAAAAAAA","AyyyyyyyyyA","A.........A","A.........A","y.........y"],"field":"short"},{"x":7,"y":1,"rows":["...AIAIAAI...","..AAAAAIAAI..",".AAAAAIAAAAI.",".AAAyyyyyAAA.","AAA.......AAA","AIy.......yIA","IA.........AI",".I.........I.",".A.........A.",".y.........y."],"field":"short"},{"x":8,"y":2,"rows":["....~~~....","..~~~~~~~..",".~~.....~~.","~.........~","~.........~"],"field":"short"},{"x":5,"y":1,"rows":["......AAAAAA......","....AAIIAIIAAA....","...AAAIAAIIAAAA...","..AII~~...~~IAI...","..AI........~II...","..AI.........IIA..","..AI.........IIA..","..AI.........AIA..","..AI.........AIA..","..AI.........AIAA.",".IAA.........AIAA.",".AAI.........AIAI.",".IAA.........AAAI.",".AIA.........AIAA.","AAAA.........AAAI.","IAIA.........IAAA.","A.AA.........AIAA.","..I..........IAAAA",".............A.A.A",".............A...."],"field":"long"},{"x":3,"y":-1,"rows":["......AAAAAAAAA......","....AAAIAIAIAIAAA....","...AAAIAIAIAIAIAIA...","..AIAIAAAAAAAIAIAIA..",".AIAIAIAA~~AAAAAIAAA.",".AAIAAA~....~AAAAIAA.",".AIAIA~......~AAIAIA.","AIAIAA........~AAIAAA","AAIAAA.........AAAIAA","AAAIA~.........~AIAAA","AAIAA...........AAIAA",".AAAA...........AAAA.","..AAAA.........AAAAA.","...AAA.........AAAA..",".....A.........AA...."],"field":"short"},{"x":3,"y":0,"rows":["........AAAAA........","......AAAAAAAAA......",".....AAAAAAAAAAA.....","....AAA~.....~AAA....","....AA~.......~AA....","....A~.........~A....","...AA...........AA...","..AAA...........AAA..",".AA.~...........~.IA.",".IA...............AA.","AAIA.............AIAA",".IAIA............AAA.","AAIAA...........AAIAA","AIAAAA.........AAAAIA","A.AAAA.........AAAA.A",".AAAAA.........AAAAA.",".A.AAA.........AAA.A."],"field":"short"},{"x":7,"y":1,"rows":["...AIAIAAI...","..AAAAAIAAI..",".AAAAAIAAAAI.",".AAAyyAyAAAA.","AAA.....A.AAA","AIy.......yIA","IA.........AI",".I.........I.",".A.........A.",".y.........y."],"field":"short"},{"x":5,"y":2,"rows":[".....aAA.AAa.....","...aAAaaAaaAAa...","..aAaaAaaaAaaAa..","..aAaA~~~~~AaAa..",".AaAa~.....~aAaA.",".AAA~.......~AAA.",".AaA.........AaA.","IIAI.........IAII","UAIA.........AIAU","UIUI.........IUIU","UUUU.........UUUU","UUUU.........UUUU","UUUI.........IUUU","U.UAI.......IAU.U","..UAI.......IAU..","..UI.........IU.."],"field":"short"},{"x":5,"y":1,"rows":["...A..............","....AA.AA.A.A.....",".AAAAAAIIIIIII.A..","..AIAAAAAAAAAAIA..",".AIAIAAAAAAAAIAI..",".IAI~~~~~~~~~AAAA.","AAA~.........~IAA.","AAA...........IA.A","AAA...........AA..",".A.............A..",".A.............A.."],"field":"short"},{"x":7,"y":0,"rows":[".....AAA.....","..AIAAAAAAA..",".AIIIAAAAAIA.",".IAIAIAAAIAI.","IAy.yAAAy.yAA","AI.........IA","IA.........AI","AI.........IA",".A.........A."],"field":"short"},{"x":4,"y":0,"rows":["......AAA..........",".....AAIAAAAA......","....AAIIIAIIAAA....","....AAAIAAIIAAAA...","...AII~~...~~IAI...","...AI........~IIA..","..AAI.........IIA..","..AAI.........IIA..","..AA...........IAA.","..AA...........IAA.",".AA.............AA.",".AA.............AA.",".IAIA.........AIAI.",".IAAA.........AAAI.",".AAIA.........AIAA.",".IAAA.........AAAIA","AAAAI.........IAAAA","AAAIA.........AIAAA","AAAAI.........IAAAA","A.AAA.........A.AAA","..A.A.........A..A.","..A................"],"field":"long"},{"x":5,"y":-1,"rows":["....AAAAAAAAA....","..AAAIAIAIAIAAA..",".AAAAAIAIAIAIAIA.",".AAAAAAAAAAAAIAA.","AAAAAAAAAAAAAAIAA","AIAAA~~~~~~~AAAIA","AAI~.........~AAA",".IA...........AA.",".AI...........AA.","..A...........A.."],"field":"short"},{"x":7,"y":1,"rows":["...ZAZAZAA....","..AAZAZAZAAA..",".AZAZZAZAZAAA.",".AZAyyAyAZZA.A","AAZ.....AyZAZ.","ZAy.....A.yAZ.","ZA......y..ZA.",".Z.........Z.A",".y.........y.."],"field":"short"},{"x":2,"y":1,"rows":["........AA.AAAIA.......",".......AIAAIIIIAA......","......AIaIaaaaAIAA.....",".....AIa~~~~~~aIIA.....",".....Ia~......~IAIA....",".....IA........IIAI....","....AI~........IAII....","....AI~........~IAI....","....AI~.........AIA....","....AI~.........~IA....","....AIa.........aIA....","...IAIa.........aIAI...","...IAIa.........aIAI...","...IAIaa.......aaIAI...","..IAAIaa.......aaAAI...","..IAIAIa.......aaAIAI..","..AAIIAa.......aAIAAI..",".IAIAIA.........A.A.AA.","IA.IA.............IA.A.","..A.A..............A..A"],"field":"long"},{"x":8,"y":3,"rows":["..AIIIAAA..",".AAAAIIIIA.","AAIIII~..AA","A~.......~A","I.........I","I.........I","A.........A","~.........~"],"field":"short"},{"x":5,"y":1,"rows":["....IAIA.AAA.....","...IAAAAAAIAIA...","..IAIAA~~~AIAIA..",".IAAA~....~AAAIA.",".AIAA......AAAAAA","AIAA~......A~AIA.","IAAA.........AAI.","AAA~.........~AAI","A.A...........AAA","..A...........A.A","..A...........A..","..AA.........AAI.",".AAA..........AAI",".AA............AA"],"field":"short"},{"x":7,"y":0,"rows":["....AA.A.....","...AAAAAIA...","..AIAIAIAIA..",".AIAAAAAAAIA.",".IA~~~~~~~AI.","AA~.......~AA","AI.........IA","AA.........AA",".A.........A.",".A.........A.",".~.........~."],"field":"short"},{"x":8,"y":3,"rows":["..IAIAIAI..",".AAIAIAIAA.","AAAAAAAAAAA","AA~.....~AA","A~.......~A","~.........~"],"field":"short"},{"x":7,"y":0,"rows":["....AIAIA....","..IAIAIAIAI..",".IAAAAAAAAAI.","AAAAAAAAAAAAA","AAAIAIAIAIAAA","AAI~~~~~~~IAA","AI~.......~IA",".A.........A.",".~.........~."],"field":"short"},{"x":7,"y":-2,"rows":[".......AAA...","......AIIUA..",".....AUIUIUA.",".....AIUIUIA.","...AAAAAAIAA.","..AAIAIAIAA..",".IAIAIAIAIAI.",".AI.......IA.","AI~.......~IA","AI.........IA","A~.........~A","A...........A"],"field":"curly"},{"x":8,"y":0,"rows":["..AAIAIAI..",".AAAAIAIAI.","AAAAIAI~~~I","AA~.....~IA","A~.......~A","~.........~"],"field":"short"},{"x":8,"y":2,"rows":["..IIIIIIIA.",".IAIAIAIAIA","IA~AIAIAIAA","A~..~~~~AAA","A........~A","~.........~"],"field":"short"},{"x":6,"y":3,"rows":["...AAaaAaaAA...","..Aaa~...~aaA..",".aAa~.....~aAa.",".AI~.......~aA.","AIA~.......~aIA","AAA.........aAA","AIA.........AAA","IAA.........AAI","AIA.........AIA","aAa.........aAa","aIa.........aIa","IAA.........AAI","aIAA.......AAI.","aAAA.......AAAa",".aA.........Aa.",".aa.........aa."],"field":"long"},{"x":7,"y":0,"rows":["...IAAA......","..IAIAIAII...",".IAIAIAAAAI..",".AAAAAAAAAAA.","AAAAAyyyyyAA.","AAA.A.....yAA","AIy........IA","IA.........AI",".A.........A.",".y.........y."],"field":"short"},{"x":7,"y":-1,"rows":["...AIAIAI....","..AIAIAIAIA..",".AIAAAAAAAIA.","IIAAAAAAAAAII","IAAA~~~~~AAAI","AA~I.....~~AA","A.~A........A","..I~.........","..A.........."],"field":"short"},{"x":6,"y":1,"rows":["....AAI~IAI....","..AIAIAyAIAIA..",".IAAAIy.yAIAIA.","AAAIAy...AAIAIA","AIAI.....AyIAIA","AIAy.....A.yAIA","AIA......y..IAA","AIA.........IAA","A.I.........I.A","A.y.........y.A"],"field":"short"},{"x":6,"y":0,"rows":["....UU.........","...UIUAAAAIU...","..AIUAAAAAAIU..","..AAI~~~~~~UIU.",".UAIA~~~~~~IAI.","UAAAI......~IA.","AI~IA.......AI.","IA.AI.......IA.","AI.~A.......AI.",".A..~.......~AI"],"field":"short"},{"x":6,"y":-2,"rows":["....AAA.A.AA...","..IAAAIAIAAAI..",".IAIAIAIAIAIAI.","IAIAAAAAAAAAIAI","AAAAAAAAAAAAAAA","AAAAAAAAAAAAAAA",".AAAIAIAIAIAAA.",".AAI~~~~~~~IAA.",".AI~.......~IA.","..A.........A..","..~.........~.."],"field":"curly"},{"x":5,"y":-3,"rows":["..........A.AA...",".....AAA.AAAAAA..","...IAAAIAIAAAIA..","..IAIAIAIAIAIAI..",".IAIAAAAAAAAAIAI.",".AAAAAAAAAAAAAAAA","AAAAAAAAAAAAAAAA.","A.AAAIAIAIAIAAA..","..AAI~~~~~~~IAA..",".AAI~.......~IAA.","A..A.........A...","..AA.........A...","..A~.........~..."],"field":"afro"},{"x":3,"y":9,"rows":["....A~.........~A....","....A~.........~A....","....AA.........AA....","...IAI.........IAI...","...AAA.........AAA...","...IAI.........IAI...","..UIIA.........AIU...","..UUUI.........IUUU..","..UIUU.........UUIU..",".UIUIU.........UUIUU.","UUIUU...........UU.U.","..U.I............I..U"],"field":"long"},{"x":6,"y":2,"rows":["....AAAAAAA......","...AAaaAaaAA.....","..AAa~...~aaA....",".aAa~.....~aAa...",".AI~.......~aA...","AIA~.......~aaA..","AAA.........aaA..","AIA.........AAa..","IAA.........AaAI.","AIA.........IUaU.","aIa.........aIIUI","IUI.........IUIIU","IIA.........AII.I","IUIA.......AIUI.I","IIIA.......AIIII.",".UI.........IUI..",".Ia.........aI..."],"field":"long"},{"x":5,"y":-2,"rows":[".....A.........","....AAAA.A.....","....AIUAAA.AAA.","...AAAAAAAUAU..","..AAIUAAAAAAAU.",".AAIUAAAAAAAAAA","AAAIA~~~~~~~AAA","AUAAI~......~A.","A..IA..........","...AI..........","...~A..........","....~.........."],"field":"curly"},{"x":6,"y":0,"rows":["....AAAAA......","..AAAAAAAAI....",".AAAAAIAIAAI...",".AAIAIAIAIAAI..",".AIA~~~~~~~AI..","AIA~......~~AA.","AAI.........IA.","AIA.........AA.","AAI.........I.A","A.A.........~.I","..~...........A","A..............","AI...........A.","IAA.........AIA",".IA.........IAA",".AA.........AIA","..A.........AA."],"field":"short"},{"x":8,"y":4,"rows":["..IAIAIAI..",".AAAAAAAAA.","AA~.....~AA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":5,"y":0,"rows":[".....AAAyAAA.....","....AAAIAAAIA....","...AAIIIAAIAIA...","..AAI~I~~~AIAIA..",".AAI~.I....I~AIA.",".AII..A....I.IAA.","AIAI..I....I.IIAA","AIA~.........IAIA","AAA..........~AIA","AIA...........AI.",".A.............A.",".A.............A.","..A...........IAA",".AAA.........AAAA",".A.A.........AA.A","...A..........A.."],"field":"short"},{"x":8,"y":2,"rows":["..AI.IAI....",".AIAIAIAIA..",".IAIAIAIAIA.","IAAAAAAAAAI.","AA~.....~AA.","A~.......~A.","A.........A.","~.........~.","~.........~.","............","............","A.........A.","I.........A.","A..........A"],"field":"short"},{"x":5,"y":-2,"rows":[".......A.......","....A.A..A.....","AAI.IAIA.I.....","..AIIAIIAIAIA..","AIIAIAIAIIAIAA.",".AAIA~~~~~~~IA.","...A~.......~I.","...~.........~.","...~.........~.","...............","...............","...............","...............","..AA...........","..AI.........A.","..IA.........AI",".IAIA........IA",".IIAI........A.","I.AAI........I.","..A.I........I.","....I.........."],"field":"long"},{"x":4,"y":1,"rows":["........AA.A.......",".....AAIIAIIAA.....","....AIIAAIAAAAA....","...AIAAIAAIIAAI....","..IAIAI~~~~~IAAI...","..IAIA~.....~IAIA..","..IAI~.......~AII..","..IAI.........AIA..",".IIAI.........AII..",".AIAI.........~IAI.",".IIIA..........IAA.","AIUAI..........IAIA","IAIAA.........AUAIA","AIUIA.........AIIUI","IUIUA.........AUUIA","AIAIA.........IUIAI","AAIA..........AIA.A","A.AI..........IAI.A","..AA..........A.A..","...I..............."],"field":"long"},{"x":6,"y":3,"rows":["....AIAA.....","...AIAIAIAI..","..AIAAAAAAAA.","..AA~.....~AA","..A~.......~A","..A.........A","..~.........~",".............",".............",".............","A............","A.A.........A",".AA.........A",".A..........."],"field":"short"},{"x":5,"y":0,"rows":[".....IAA.AAIA...","....AAIAAAIAIA..","....AIAIAAAIAI..","...AAAIAAyyyIAA.","...AAy......yAA.","..AAy........AA.","..AA.........AA.","..AA.........AA.","..yA.........Ay.","IA.A.........A.A",".A.y.........y.I","IAAA.........AII","..IA.........AI.",".IAA.........IAI","..I...........A."],"field":"short"},{"x":4,"y":4,"rows":[".....AIAIAIAIA...","....AIAAAAAAAIA..","...AIA~A~..~AAIA.","...IA~.A....A~AI.","...AA..~....~.AA.","..AA~.........~AA","..AA...........AA","..A~...........~I",".AA.............A",".AI.............I","A.AIA.........AIA","...AA.........AA.","...A...........I."],"field":"short"},{"x":3,"y":0,"rows":["....AI......II...........","...AIAIAIAIAAAIA.........",".....IAAAAAAIAAIAI.......","....IAIAA~~~AIAAIAI......","...IAAA~....~AAAAAAA.....","..IAIAA......AAA...AI....",".IAIAA~......A~A...AA....",".AI.AA.........AA...I....","AI..A~.........~A...AI...","IA..A...........A....A...","AI...................AI..","AA....................AI.",".A.....................A.",".AA....................IA","..IAI..................AI","...IAI.................AA","....IA...................","....AI...................","....AAA..................",".....AA.................."],"field":"long"},{"x":4,"y":2,"rows":[".....AaAaaAaaa.....","....AAaAAaAaAaa....","...AAa~~~~~~~Aaa...","...Aa~.......~Aa...","..Aa~.........~Aa..","..aa~.........~aA..","..aa...........aa..","..a~...........~A..","..a.............a..","..a.............aA.",".AaA...........AaA.",".AAa...........aAA.",".AaAa.........aAaA.","AAAaA.........AaAAA","A.aaA.........Aaa.A","..a.A.........AAa..","....A.........A...."],"field":"long"},{"x":7,"y":1,"rows":["...AIAIAII...","..AIAIAIAII..",".AAAAAAAIAIA.",".AAyyyyyyyAA.","AAy.......yAA","AI.........IA","IA.........AI",".I.........I.",".y.........y."],"field":"short"},{"x":7,"y":-1,"rows":["...AAIAIAI...","..AAIAIAAIA..",".IAAAIAIAIAI.",".AIyy~A~yyIA.","AIy...y...yIA","AA.........AA","AI.........IA","Ay.........yA","y...........y"],"field":"short"},{"x":5,"y":-2,"rows":["....A..........","....A.A........","AAI.IAIAAIA....","..AIIAIIAIAIA..","AIIAIAIAIIAIAAA",".AAIA~~~~~~~IA.","..AA~.......~IA",".AA~.........~A","..A~.........~A","..A...........A","..~...........~"],"field":"curly"},{"x":4,"y":0,"rows":["........AAA..........",".....AAIAAAAA........","....AAIIIAIIAAA......","....AAAIAAIIAAAA.....","...AII~~...~IIAI.....","...AI~......~IIIA....","..AAI........IIIA....","..AAI........~IIA....","..IA~.........IIAA...",".AIA~.........IIAA...",".AA.~.........IIAA...",".AA...........IIAA...",".IAIA.........AIAI...","AIAAA.........AAAIA..","AAAIA.........AIAAA..","AIAAA.........AAAIA..","...AI.........IAAAA..","..............AIAAAA.","..............IAAAAA.","..............A.AAAA.","..............A.AAAAA","................A.A.A","................A...."],"field":"long"},{"x":8,"y":-1,"rows":["..AaAaaa...",".AaAaAaaa..","AaAAAaAaAa.","aAAaAAaAaaa","aA~.....~aa","A~.......~A","A.........A","A.........A","y.........y","y.........y"],"field":"short"},{"x":4,"y":0,"rows":["......UAUAAUA......",".....AUAUAAUUA.....","....AAUUUAUUAUA....","...AAU~~~~~~~AUA...","...AU~.......~AU...","..AUU.........UAA..","..UAU.........UUA..","..UA~.........UAU..","..AA..........~AU..",".AU.............U..",".AA.............A..",".UA.............UA.","UAUA...........UAUA",".UAAA.........AAAA.","U.A.A.........AA.A.","....A..........A..."],"field":"short"},{"x":7,"y":-1,"rows":["......I......","..A..IA.A....",".AIAIAIAIAIA.","AIAIAIAIAIAIA","IAAAAAAAAAAAI","AAAIAIAIAIAAA","AAI~~~~~~~IAA","AI~.......~IA",".A.........A.",".~.........~."],"field":"short"},{"x":6,"y":1,"rows":["....AAIAIAI....","..AIAIAyAIAIA..",".IAAAIy.yAIAIA.",".AAIAy...yAyAI.","AIAI......IyAAA","AIAy......A.AIA","IAA.......I.IAA","AIA.......A.AIA","IAI.........IAI","AIy.........AIA",".A..........yAA",".I...........I.","I.A.........A.I","..A.........A.."],"field":"short"},{"x":5,"y":2,"rows":[".....AAA~AAA.....","....AAIAIAIAA....","...AAI~~~~AIAA...","..AIA~....A~AIA..","..AA~.~...~A~AA..",".AAI~.......~IAA.",".AIA.........AIA.",".AA...........AA.","AAA...........AAA","A...............A","A...............A","A...............A"],"field":"short"},{"x":8,"y":1,"rows":["..AIAIAII..",".AIAIAIAII.","AAAAAAAIAIA","AAyyyyyyyAA","Ay.......yA","I.........I","y.........y","y.........y"],"field":"short"},{"x":7,"y":1,"rows":["....AIAIA....","..IAIAIAIAI..",".IAAAAAAAAAI.","AAAIAIAIAIAAA","IAI~~~~~~~IAI","AI~.......~IA","IA.........AI","A~.........~A","A...........A"],"field":"short"},{"x":8,"y":2,"rows":["....AAA....","..AIAIAIA..",".AI~~~~~IA.","A~.......~A","~.........~"],"field":"short"},{"x":5,"y":2,"rows":[".....AAAA.II.....","....IAIIAIAAI....","...IAIAAIAIAAI...","..IAAyyyy..yAAI..","..IAI.......AII..",".AAI.........AIA.",".AIA.........IAI.",".IAI.........AIAI","I.AA.........AA.A","A..y.........y..A",".................",".Aa...........A..","..A...........Aa.",".Aaa.........aaA.",".A.a.........aa..","...a............."],"field":"short"},{"x":3,"y":1,"rows":["........A.....AI......","......AAIIAIIAA.......",".....AIIAAIAAAAA......","....AIAAIAAIIAAIA.....","...IAIA~~~~~~~AAIA....","..AIAI~.......~AAIA...","..IAII.........AIAIA..",".AAAA~.........~AIAI..",".AIAI...........AAIAI.",".AAAA...........AIAIA.",".AIAA...........AAAAI.","IAAAI...........AIAIAI","IAIAA...........AAAIAI","AIAIA...........AIAAAA","IAAAA...........AAAIAI","AIAIAA.........AIAAAA.","AAAAAA.........AAIA.A.","A.AI............IAA.A.","..AA............A.A...","...I.................."],"field":"long"},{"x":2,"y":1,"rows":["........AA.AAAIA.......",".......AIAAIIIIAA......","......AIaIaaaaAIAA.....",".....AIa~~~~~~aIIA.....",".....Ia~......~IAIA....",".....IA........IIAI....","....AI~........IAII....","....AI~........~IAI....","....AI~.........AIA....","....AI~.........~IA....","....AI...........IA....","...IAI...........IAI...","...IAIa.........aIAI...","...IAIa.........aIAI...","..IAAIa.........aAAI...","..IAIAI.........aAIAI..","..AAIIA.........AIAAI..",".IAIAIA.........A.A.AA.","IA.IA.............IA.A.","..A.A..............A..A"],"field":"long"},{"x":6,"y":1,"rows":["....AIA.IAI....","...AIAIAAIAA...","..AIAI~~~AIAA..",".AIA~A...I~IAA.",".IA~A~...A.AIA.",".AA.I....I.IAIA","AIA.A.......AAI","AA...........IA","AI...........AI","A.............A","A.............I","I..............","A.............."],"field":"short"},{"x":2,"y":1,"rows":[".........A.....AI.......",".......AAIIAIIAA........",".....AAIIAAIAAAIIA......","...AIIIAAIAAIIAAIIIA....","..AIIAIA~~A~~~~AAIIIA...",".AIAIAI~.......~AAIAIA..","..AIAII.........AIAIAIA.",".AAAAA~.........~AIAIAAA","AAAIAI...........AAIAIAA",".AAAAA...........AIAIAA.","A.AIA.............AAAIAA",".IAAA.............IAIAI.",".IAIAA...........AAAIAI.","AAIAIA...........AIAAA..","..AAAA...........AAAI.A.","..A.IA...........IA.A...","......A.........A......."],"field":"short"},{"x":6,"y":-2,"rows":["....AIAAAIA....","..AAAAIAIAAAA..","AIAIIIIIAIAIIA.",".AIAIAIAIAIAAAA","AIAIyyyyyyyIAIA","IAIy.......yIA.",".AA.........AA.","..A.........A..","..A.........A..","..y.........y.."],"field":"curly"},{"x":6,"y":1,"rows":["...AaAaAaAaA...","..AaAAAaAAAaA..",".AaAaaaaaaaAaA.",".aAa~~~~~~~aAa.",".AaA.......AaA.",".aA~.......~Aa.","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa",".aA.........Aa.",".Aa.........aA.","..A.........A.."],"field":"short"},{"x":5,"y":1,"rows":[".....AZ..AZA.......","....AaaaaaaaAZ.....","..AAaAAAUAAAaAZ....","..AaAaaAAAaaAaAZ...",".ZAaaAAAAAAAaaAA...",".AZaAaaaaaaaAaAZA..",".ZAaa~~~~~~~aaAZA..","..Za~.......~aAZA..","...~.........~AZA..","..............AZA..","..............AZAZ.","..Z...........ZAAA.","..AZ..........AZAZ.",".AZZ.........AZZZA.",".ZA..........ZAZAZ.",".AZ..........AZ.ZAZ","ZaA..........ZA..Aa","IZ..........aAZ..aI","aa..........Ia...aa","............aI.....","...........aI......","...........Ia......","...........aI......"],"field":"long"},{"x":5,"y":2,"rows":[".....AII.IIA.....","...AIIAAIAAIIA...","..AIAAIAAAIAAIA..","..AIA~~~~~~~AIA..",".IAI~.......~IAI.",".IAI.........IAI.",".AAI.........IAA.","..AA.........AA..",".................",".................",".................","..AA.........AA..",".AAI.........IAA.",".III.........AII.","IIAI.........IAII","IAIA.........AIAI","AIA...........AIA","IAI...........IAI","A.A...........A.A","..I...........I..","..A...........A.."],"field":"long"},{"x":4,"y":2,"rows":["......IAAAAAI......",".....IAaaAIAAI.....","....IAa~..~I~aI....","...aAa~....A~aAa...","...AI~.....~A~IA...","..AIA~......I~AIA..","..AAA.......A.aAa..","..AIA.........AIA..","..IAA.........aAaA.","..AIA.........AIAa.","..aAa.........aAaA.","..AIA.........AIAa.","..aAa.........aAaA.",".aAIAa.......aAIAa.",".aaAaA.......AaAaAa","aa.IA.........AIA.A","...Aa.........aA..."],"field":"long"},{"x":4,"y":1,"rows":[".....IAIA.AAA......","....IAAAAAAIAIA....","...IAIAA~~~AIAIA...","..IAAA~....~AIAIA..",".AAIAA......A~IAIA.",".AIAA~......A.AIAA.","AIAIA.......~.AAIAA","AAIA~.........~AAAA","AIAI...........AIAA","AAIA...........IAAA","AIAA...........AAAA","AAIAI.........AIAAA","A.AAA.........IAI.A","..A.I.........A.A..","....A.........A...."],"field":"short"},{"x":5,"y":1,"rows":[".....AAA.AAA.....","....AAIIAAIAA....","....AIAAIAAIA....","...AIAAIIIAAIA...","..AIAAI~~~IAAIA..","..AAIA~...~AIAIA.",".AAIA~.....~AAA.A",".AIAA.......AIA..",".IAI~.......AIAA.",".AIA.........AIA.",".IA..........AIAA","IAI..........IAIA","AIAA.........AIAA","IAIA.........IAIA","AAAA.........AI.A","A.AA.........AA.."],"field":"short"},{"x":3,"y":1,"rows":[".......AA.AAAIA......","......AIAAIIIIAA.....",".....AIaIaaaaAIAA....","....AIa~~~~~~aIIA....","....Ia~......~IAIA...","....IA........IIAI...","...AI~........IAII...","...AI~........~IAII..","...IA~.........AAII..","...I.............IA..","..IA.............AAI.","..IA.............A.AI","..AAI...........IAA..",".IAIAa.........aAI...","IA.IAa.........aAI...","..A.AI.........IA....",".....A.........A.....",".....A.........A....."],"field":"long"},{"x":7,"y":0,"rows":["...AII.IUIAA.","..AAIUIAIUIAA",".AAIAIUIUIAA.",".AIAIUIyyyIAA","AAAy......yIA","IUy........UI","UI.........IU",".A.........A.",".A.........A."],"field":"short"},{"x":7,"y":1,"rows":["..A..IA.A....",".AIAIAIAIAIA.","AIAIAIAIAIAIA","IAAAAAAAAAAAI","AAI~~~~~~~IAA","AI~.......~IA",".A.........A.",".~.........~."],"field":"short"},{"x":5,"y":1,"rows":[".....AAIAIAI....","...AIAIAIAIAIA..","..IAAAyyyyyIAIA.","..AAIy.....yIAI.",".AIIy.......yIAA",".AIU.........UIA",".IAI.........IAA",".AIU.........UIA",".IAI.........IAI",".AIy.........AIA",".AA..........yAA",".AI...........IA",".IAI.........IAI","IAIA.........AIA","..AI.........IA.",".A.A.........A.."],"field":"short"},{"x":8,"y":0,"rows":["...IAIAI...",".AIAIAIAIA.","AIAZAZAZAIA","ZZZZZZZZIZZ","ZZ~....~AZZ","Z~......I~Z","~.........~"],"field":"short"},{"x":6,"y":4,"rows":["...AIAIAIAIA...","..AIAAAAAAAIAA.",".AIA~A~..~AAIAA","AIA~.A....A~AI.",".AA..~....~.AAA",".A~.........~A."],"field":"short"},{"x":7,"y":0,"rows":["...IAIA......","..IAAAIAII...",".IAAAIAIAII..","IAAyyyAAIAAI.","AIA....yyyAA.","IAy.......yAI","AI.........IA","IA.........AI",".A.........A.",".y.........y."],"field":"short"},{"x":6,"y":2,"rows":["...IAIAAIAAA...","..IIAIIAIAIAA..",".IIA~~~~~~~IAA.",".IA~.......~IA.","IA~.........~IA","AA~.........~AI","AA...........AA","A~...........~I","A.............A","...............",".I...........I.",".IA.........AI.",".AI.........IA.",".IA.........AI.","IAA.........AAI",".IA.........IA.","I.A.........A.I"],"field":"long"},{"x":8,"y":0,"rows":["..IAAIAII..",".IAAIAIIAI.","AAA~~yAAIAI","AI~...~~AIA","I~.......~I","A.........A","I.........I","A.........A","~.........~"],"field":"short"},{"x":4,"y":-2,"rows":["....AIAAA.A.AIA...","..IAIAAAIAIAIAIAI.",".IAIAIAIAIAIAIAIAI",".AIAIAAAAAAAIAIAI.",".IAIAAAAAAAAAAAIAI",".AIAAAIAIAIAIAAAI.",".IAAAI~~~~~~~IAAAI","IAIAA~.......~AAIA","AIAAI.........IAAI",".AAAA.........AAA.","..A.~.........~.A."],"field":"curly"},{"x":6,"y":-2,"rows":["....AIAAAIA....","..IAIAIAIAAAA..",".IUIIIIIAIAIIA.","IUIAIAIAIAIAAAA","IIAIyyyyyyyIAIA",".AIy.......yIA.",".AA.........AA.","..A.........A..","..A.........A..","..y.........y.."],"field":"curly"},{"x":5,"y":1,"rows":[".....ZZZZZZZ.....","....ZZZZZZZZZ....","...AZZZZZZZZAZ...","..AZZ~.....~ZAA..","..AZ~.......~ZA..","..AZ.........ZA..","..AZ.........ZA..","..AZ.........ZI..","..AZ.........ZAA.",".IAZ.........ZIA.",".IAZ.........ZAI.",".AAZ.........ZAI.",".AIZ~.......~ZIA.",".AIZZ.......ZZAIA",".IAIZ.......ZAIAI",".AIAZZ.....ZZAAIA","AIAIAZ.....ZAZIIA","IAIAZ.......Z.IAI","IIA.A.......A.I.A",".A..A.........A.."],"field":"long"},{"x":8,"y":0,"rows":["...UUUUU...",".UUUUUUUUU.","UUUUUUUUUUU","UAAAAAAAAAU","AA~.....~AA","A~.......~A","~.........~"],"field":"short"},{"x":5,"y":3,"rows":["......IA.AI.....",".....IAIAIAI....","....IAAAAAAAI...","...IA~.....~AI..","...A~.......~A..","...~.........~..","................","................","................","................","................","...A.........A..",".AI..........I.A","I.............I."],"field":"short"},{"x":5,"y":1,"rows":[".....AIA.IAI......","...AAIAIAAIAAA....","..AAIAIUUUAIAAA...","..AIAAUUUUIUIAAA..",".AIAIUUUUUAIAIA.A.","AAAAUUUUUUIUIAIA..",".AIA......A.AIAIA.","AIAI~.......IAIA..","IAIA.........IAIA.",".IA...........IAIA","AAI...........AIA.",".IA............AI.",".A.............A.."],"field":"short"},{"x":6,"y":3,"rows":[".....IAA......","....IAIAIAI...","...IAAAAAAAI..","..IA~.....~AI.","..A~.......~A.","..A.........A.","..~.........~.","..~.........~.","..............","..............","..............","..............",".A..........A.","AIA.........IA"],"field":"short"},{"x":6,"y":2,"rows":["....aAAaAAa....","..aAAaaAaaAAa..",".aAaaAaaaAaaAa.",".aAaA~~~~~AaAa.","AAAa~.....~aAAA","AaA~.......~AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","IAI.........IAI","AIA.........AIA","IUI.........IUI","UIU.........UIU","IUI.........IUI","UUU.........UUU","U.U.........U.U"],"field":"long"},{"x":3,"y":0,"rows":["......AAAUUUUU....",".....AAAUAAUUUU...","....AAAUAAAAAAA...","....AIU~.....~A...","...AIAU.......~...","...AAU~...........","...AIU............","...IAU............","..AAIU............","..AIAU............","..AAIU............","..AIAU............","..AAIU.........U..","..AIAU.........UU.",".AIAIU.........U.U",".AAIAU.........U.U","AA.AIA.........UU.","A.AI.A............","..A..A............"],"field":"long"},{"x":7,"y":0,"rows":[".....IAI.....","....III.I.II.","...IAIAIAI...","..AAIAIAIAA..",".IAIAIAIAIAI.",".AI.......IA.","AI~.......~IA","AI.........IA","A~.........~A","A...........A"],"field":"short"},{"x":8,"y":0,"rows":["..aAaAaA.A.",".aAaAaAaAa.","AaaAAAAAaaA","aa~......~a","A~........A","A.........A","y.........y"],"field":"short"},{"x":8,"y":-1,"rows":["..IAAaAaA..",".IAaAAaAaA.","IAIAaaaaAIA","AIAIAAaAIAI","A~.II.I.~~A","I.........I","I.........I","y.........y"],"field":"short"},{"x":8,"y":3,"rows":["..AaAaAaa..",".AaAaAaAaa.","AAAaAAAAAaA","aa.......Aa","a~.......~A","a.........a","~.........~"],"field":"short"},{"x":4,"y":2,"rows":["....AIIIIIIII......","...IIIUUUUUUUI.....","...IIUIIUUUIIUA....","..AIIIUUUUUUUIIA...","..IAIUIIIIIIIUIIA..",".AAIII~~~~~~~IIAA..",".AIAA~.......~AIAI.",".IAI~.........~IAA.",".AII...........IAA.",".IAI...........IAIA",".AIA...........AIAI","AIAI...........IAIA","IAAAI.........IAAAI","AIAIA.........AIAIA",".AAAI.........IAAAI",".IAIA.........AIAIA","IA.AI.........IA.AI",".I.IA.........AA.I."],"field":"long"},{"x":4,"y":1,"rows":["......IIIIIII......","....IIUUUUUUUII....","...IUUIIUUUIIUUI...","...IIIUUUUUUUIII...","...IUUIIIIIIIUUI...","..IIII~~~~~~~IIII..","..IAA~.......~IIA..","..IAI.........IAI..","..AIA.........IIA..",".AIAI.........IAIA.",".AAIA.........IIAI.",".AIAI.........IAIA.",".IAIA.........AIII.",".IIAI.........IAIA.","AIAIA.........AIAIA","AAIII.........IAIAA","AIAIA.........AIAIA","AAIAI.........IIIAA","AIAIA.........AIAIA","AAIAI.........IAIAA",".AA.A..........A.I."],"field":"long"},{"x":6,"y":2,"rows":["...AAI.IAIAA...","..AAIAIAIAIAA..",".AAIAIAIAIAIAA.",".AIA~.....~AIA.","AIA~.......~AIA","AAI.........IAA","AIA.........AIA","I...........AAI","A...........~IA","I............AI","AA...........IA","IAA.........IAI",".IA~.......~AIA","AAI..........A."],"field":"short"},{"x":5,"y":1,"rows":["....AI..AIAI.....","...AIIIIIIIIIA...","..IIIUUUUUUUIAA..","..IIUIIUUUIIUAA..",".AIIIUUUUUUUIIAA.",".IAIUIIIIIIIUIIA.","AAIII~~~~~~~IIAAA","AIAA~.......~AIAI","IAI~.........~IAA","AII...........IAA","IAI...........IAI","AIA...........AIA","IAI...........IAI","AIA...........AIA","IAI...........IAI",".IA...........AI."],"field":"short"},{"x":4,"y":-2,"rows":["......U............",".A..UUUUUA.A.A.A.A.","..AUAUAUAUAUAUAUA.A","UAUAUAUAUAUAUAUAUA.",".UAUAUAAAAAAAAAAAUA","..UAUAAAAAAAAAAAUA.","...UAA~~~~~~~AAUA..","...AA~.......~AA...","....A.........A....","....~.........~...."],"field":"curly"},{"x":5,"y":1,"rows":["............AIA..","....IAIA..IAI....","..AIAIAIAIAIAAAA.","AA.AIAAAAAAAIAA..","..AIA~A~..~AAIAA.",".AIA~.A....A~AI.A","..AA..~....~.AAA.",".AA~.........~A..","A.A...........AA.","..A...........A.A"],"field":"short"},{"x":6,"y":0,"rows":["......AAAZ.....","A..AZAZAZAAA...",".AAAAZAZAZAAA..","..AZAZZAZAZAAA.","AAAZAyyAyAZZAZA",".AAZ.....AyZAA.","AZAy.....A.yAZA",".ZA......y..ZA.",".AZ.........ZZA","..y.........y.."],"field":"short"},{"x":6,"y":0,"rows":["....AII.IUIA...","...AAIUIAIUIA..","..AAIAIUIUIAA..","..AIyyyIUIAIAA.",".AAA.......yIA.",".IUy........UI.",".UI.........IU.","..A.........A..","...............","...............",".............A.","UI...........AU","IA...........AI","UIA.........AI.",".AA.........A.."],"field":"short"},{"x":3,"y":1,"rows":[".......AAA.AAA......",".....IAIAI~IAIAA....","....IAIAIA~AIAIAA...","...IAI~~~~.~~~~IAA..","...IIA.........AIAI.","..IIA...........IA.I",".A.II...........AI..","I...A...........A...","....................","....................",".................A..","...A................","...A................"],"field":"short"},{"x":5,"y":2,"rows":[".....AII.IIA.......","...AIIAAIAAIIA.....","..AIAAIAAAIAAIA....","..AI~~~~~~~~~IA....","..AI.........IA....","..A~.........~A....","..A...........A....","..~...........~....","...................","...................","...................","..AA.........AA....",".AAI.........IAA...",".III.........AII...","IIAI.........IAII..","IAIA.........AIAIA.","A.A...........AIAAA","..I...........I.I.."],"field":"long"},{"x":8,"y":2,"rows":["..~~~~~~~..",".~.......~.","~.........~","~.........~","~.........~","~.........~"],"field":"short"},{"x":6,"y":2,"rows":[".....IAIAI.....","...IAaIAIAAI...","..IA~.....~aI..",".aA~.......~Aa.",".AI.........IA.","AI~.........~IA","aA~.........~Aa","AI...........IA","aA...........Aa","AI...........IA","aA...........Aa","AIA.........AIA","aAa.........aAa","AIA.........AIA","aAa.........aAa","AIA.........AIA",".Aa.........aA."],"field":"long"},{"x":9,"y":1,"rows":["..AAAAA..",".A~~~~~A.","A~.....~A"],"field":"short"},{"x":7,"y":2,"rows":["....IIAII....","..IIAAIAAII..",".IAAIAAAIAAI.","AI~~~~~~~~~IA","A~.........~A","A...........A",".............",".............",".............",".............",".............",".............","...........I.",".I.........A.","AI..........A"],"field":"short"},{"x":6,"y":1,"rows":["....AAIAIAA....","..AIAIAIAIAIA..",".AIAIAIAIAIAIA.","AIAI~~~~~~~IAIA","AAI~.......~IAA","AIA.........AIA",".A~.........~A.",".A...........A."],"field":"short"},{"x":3,"y":-3,"rows":["...A.....A........","....AIAI..A.A.A...","......AAIAIAIAI.II",".IAIAAAAAAAAAIAI..","...AIAIAIAAAIAIAI.",".IAIAAAIAIAIAIAI.I","IA.AAAIAIAIAIAIAI.","..AIAAA~~~~~~~AAA.","..IAIA~.......~A..","..AI..............","...I.............."],"field":"afro"},{"x":7,"y":0,"rows":["...aaaaaaa...","..AIAaaAaAa..",".AIAIAAaAIAA.","IA~..I.I.~~AI","II.........IA","IA.........AI","Ay.........yA","I...........I","A...........A"],"field":"short"},{"x":7,"y":0,"rows":["...AaAAaAa...","..AaAaaAaAa..",".AaAaAAaAaAA.","aA~..a.aa~~Aa","Aa.........aA","aA.........Aa","Ay.........yA"],"field":"short"},{"x":8,"y":0,"rows":["..IAAAIAI..",".IAAIIAIAI.","IAAIAAIAIAI","AI~.....~AA","I~.......~I","~.........~","~.........~"],"field":"short"},{"x":4,"y":2,"rows":[".......IAIAI........",".....IAaIAIAAI......","....IA~.....~aI.....","...aA~.......~Aa....","...AI.........IA....","..AI~.........~IA...","..aA~.........~Aa...","..AI...........IA...","..aA...........Aa...","..AI...........IA...","..aA...........Aaa..","..AIA.........AIAa..",".aaAa.........aAIa..",".aAIA.........AIAIa.",".AIAa.........aAIAa.",".IAIA.........AIAIA.","aAIAa.........aAIAI.","A.AIa.........aIA.Aa","..a.a.........a.a..a"],"field":"long"},{"x":7,"y":2,"rows":["....AaAaA....","..~A~A~A~A~..",".aAaAaAaAaAA.","aA~~~~~~~~~Aa","a~.........~a","a...........a","a...........a",".............",".............",".............",".............",".............",".............",".A...........","aA..........."],"field":"short"},{"x":4,"y":1,"rows":["......aaaaaaa......",".....aIIIUIIIa.....","....aIaaIIIaaIa....","....aaIIIIIIIaa....","...aIIaaaaaaaIIa...","...aaa~~~~~~~aaa...","...ZZ~.......~AA...","....A.........A....","....Z.........A.I..","....A.........A.A..","....Z.........A.I..","...IA.........AIAI.","...AZ.........ZAIA.","..AAA.........AZAI.","..IAZ.........ZAIAI",".IAZA.........AAAII","IAIAZ.........ZAZAI","IIAZA.........AZAZI",".IZ.Z..........Z.A."],"field":"long"},{"x":6,"y":1,"rows":["....AIA.IAI....","...AIUIAAUAA...","..AIII~~~AIUA..",".AIAU~...I~IIA.",".IAI~....A.AUA.",".AAU.......IIIA","AIA~........AAI","AAI..........IA",".I............I","AA............A","AI............A","IA............A","AAA..........IA","..I.........AU."],"field":"short"},{"x":8,"y":2,"rows":["...AaAaA...",".~A~A~A~A~.","aAaA~A~AaAA","A~~~~~~~~~A","~.........~"],"field":"short"},{"x":5,"y":3,"rows":["....AAaaAaaAA.....","...Aaa~...~aaA....","..aAa~.....~aAa...","..UI~.......~aA...",".AUA~.......~UIA..",".AIA.........UAA..","AAUA.........IAI..","UIAA.........AAUa.","UA.A.........AIUa.","Ia.a.........a.aaI","Aa.a.........a.IaI","aUAA.........AAUa.",".aUA.........AIaa.","aaAA.........AAa..","U.aA.........Aa...","..aa.........aa..."],"field":"long"},{"x":6,"y":1,"rows":["....aAa.aaa....","..AaAaA~AaAaA..",".AaAaAa~aAaAaA.","AaA~~~~.~~A~AaA","AAa.......~AaAa","Aa~........a~Aa","AA.........A.aA","Aa...........Aa","a.............A","A.............a","a.............A","A.............a","a.............a"],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAyAIAIA..",".AIAIAy..yyAAI.",".IAyAy.....IAA.","AAAyI......yAIA","AIA.A.......AIA","AAI.I.......AAI","AIA.A.......AIA","IAI.........IAI","AIA.........yIA","AAy..........AA","AI...........IA",".A...........A.",".AA.........AA.","..A.........A.."],"field":"short"},{"x":5,"y":-5,"rows":[".....A..A........",".....AA.A.A......","...A..AAAI..A....","....AIAIAIAI.....",".....AIAIAIA.II..","....AAAIAIAII....","...IAAIAAAI.AA...","..I.AAAIAIAI..A..","....IAAAAAAAA....","...IAA~~~~~AAI...","...AA~....~~AAI..","..AI~.......~IA..","..IA.........AIA.",".IA~.........~AI.",".AA...........AA.",".IA...........AI.",".AA...........AAA",".IA...........AI.","AAI...........IAI",".IAA.........AA.A",".AIA.........AIA.","..AA.........AA..","..AA.........AAA.","...A.........A..."],"field":"long"},{"x":8,"y":4,"rows":["..IAIAIAI..",".IAIAAAAAI.","IA~.....~AU","A~.......~U","A.........I","~.........~"],"field":"short"},{"x":6,"y":2,"rows":["....aIAIAIa....","..aIAaIAIAAIa..",".aIAa~~~~~aaIa.",".aAA~.....~aAa.","aAIa.......aIAa","AIaa.......aAIA","aAIa.......aIAa","AIAa.......aAIA","aAIa.......aIAa","AIAa........aIA","IAIa........aAI","AIA.........AIA","IAI.........aAI","AIA.........AIA","I.a.........a.I"],"field":"short"},{"x":4,"y":-2,"rows":[".......A..A.A......","....IAAAIAIAIAI....","...IAIAIAIAIAIAIA..","..IAIAAAAAAAIAIAIA.",".IAIAAAAAAAAAAAIA..","..IAAAIAIAIAIAAAIA.",".IAAAI~~~~~~~IAAAIA","IAIAA~.......~AAIAI",".IAAI.........IAAI.","IAAAA.........AAAAI",".IAA~.........~AAAA",".A.~...........~.A.",".A...............AA","..A..............A.","..AA............AAA","...AA..........AA.."],"field":"curly"},{"x":7,"y":-1,"rows":["....aaAIA....","..aaaAAaAa...",".aAaAaaAaAa..",".AaAIIAaAIAA.","aAA.I.....~AI","Aa.A.......IA","IA.........AI","A~.........~A","I...........I","A...........A"],"field":"short"},{"x":3,"y":-1,"rows":[".........IUIU...........",".......IIUIAAU..........","......IAAIAAAIU.........",".....IAIAIAAUAIU........","....IAI~~~~~~UAIU.......","...IUI~......~UAIU......","...UII........IUIAU.....","..IIAI........~IUIAI....",".IUIAI.........IIUA.....",".UIA.~.........IAIIA....","UIAI...........IIUAIA...",".UAA...........AUAUA.A..",".IAI...........IAUAUA...",".UIAA..........AIAUAI...","UIAIAA.........IAIAUA...","IAIAAA.........IAAAAUA..","UA.IAA.........AAIAIAI..","I...AA.........IAAAAUAI.",".................IAIAUA.",".................A.A.A.A","...................I.I.."],"field":"long"},{"x":5,"y":0,"rows":[".......IIII......","......IAAAII.....","....IIAAaaaAI....","...IAaaaaaaaAI...","..IAa~....~aaAI..","..IA~.......aAI..","..IA.........aAI.",".AI~.........~aI.",".AI...........AA.",".AI...........aA.",".AI...........AA.",".AI...........AA.",".AI...........IA.",".II~.........~AI.",".AIa.........aIA.",".IIa.........aII.",".IAA.........aAAI",".AIA.........AAIA","AIA...........AAA"],"field":"long"},{"x":6,"y":-5,"rows":["....II.I......","....UUII.A....","..AIIAUAIIIA..","..IUIUIUIAII..",".IUIAIUIAIAUIA",".IIAAAIAIUIIU.","IAIAAIAAUIAAAI",".IAAAAIAIAIAAU","..AIAAAAAAAAA.",".AIAA~~~~~AAIA",".AAA~.....~AAA",".II~.......~IA",".AA.........AA","..A.........A.","..A.........A.","..~.........~."],"field":"curly"},{"x":6,"y":2,"rows":["....I.II.II.....",".IIIAAIIIIII.I..","..IIAIAAIAIAIA..",".IIAIAAAAAAIAI..","AIAI~~~~~~~AIAI.","IAA~.......~AIA.","AIA.........AA.A",".AA.........AA..",".A...........A.."],"field":"short"},{"x":6,"y":-5,"rows":[".......A.......",".....A.AI......","...AIAIAIAI....","....AUAIAI..II.","...AAAUAIAII...","..IA.IAAAIA....",".U...AIUIAIA...","....AAAAUAA.A..","...AA~~AI~AA.A.","...A~..~I~~A...","...~.....U.~...",".........U.....","...............","...............","...............","...............","...............","...............","...............",".A...........A.",".IA.........AI.",".AA.........AAI","AIA.........AIA","I.............I"],"field":"long"},{"x":5,"y":1,"rows":["....IA...IAA.....","...IAAAAIAIAIA...","..IAIAA~~~AIAIA..",".IAAA~....~AIAIA.",".AIAA......IAAAAA",".IAA~......A~AIAA",".AIA.......~AAAIA",".IA~........I~AAA","IAI.........A.AI.","AIA...........IA.","IAA...........AI.","AIAI.........AIA.","IAAA.........IAI.","AIAI.........AAA.",".AAA.........AAI.",".IAA.........AAAI",".A.A.........I..A"],"field":"short"},{"x":8,"y":-1,"rows":["IIAIAIAIA..",".AIIIAIAIA.","AIAAIAAAAAA","IA~~~yy~~IA","A~.......~A","I.........I","A.........A","I.........I","~.........~"],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIIIA...","..AIAIAAIIAIA..",".AAIAIIAIAIAIA.",".AIA~~~~~~~IAA.","AIAI.......AIAA","AAI~.......~AIA","AIA.........IAI",".AI.........AIA",".IA.........IAI",".AA.........AIA","AIA.........AAI","AA~.........AIA","AI..........AAI",".A..........AAA",".IA.........AI.",".A..........A.A","..A..........A."],"field":"short"},{"x":7,"y":-1,"rows":["...AAIAIII...","..AIAIIAAAI..",".AIAAAAIIAAI.",".AAIAIIAIIAA.","IAI~.~AIAAAAI","II~....~IA~AI","AI.........IA","IA.........AI","Ay.........yA",".y.........y."],"field":"short"},{"x":8,"y":2,"rows":["....AAA....","..AIAIAIA..",".AI~~~~~IA.","A~.......~A","A.........A","~.........~","~.........~"],"field":"short"},{"x":8,"y":0,"rows":["......I....","...IIAA....","..I.IAAI...","...IAIA....","..IAIAIAI..",".IAIAAAAAI.","IA~.....~AI","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":3,"y":-1,"rows":["...........A.A.......",".....IAAAIAIAIAI.....","....IAIAIAIAIAIAIA...","...IAIAAAAAAAIAIAIA..","..IAIAIAIAIAIAIAIAAA.","AAIAAAA~~~~~~~AIAAIAA",".IAIAA~.......~AAIAI.",".AIAA~.........~AAIAA","AIAIA...........AAAI.","..IAA...........AAIA.","..A.~...........~.A..","..I...............IA."],"field":"short"},{"x":4,"y":1,"rows":[".....IAAI.IAA......","....IAAIAIAIAIA....","...IAIAA~~~AIAIA...","..IAAA~....~AIAIA..","..AIAI......IAAAAA.","..IAAA......A~AIAA.","..AI~I......~AAAIA.","..IA.A.......I~AAA.",".IAI.........A.AIA.",".AIA............AA.","AIA.............IA.","AAI.............AA.",".IAA...........AI.A",".AIAA.........AAA..","..A.A.........AA..."],"field":"short"},{"x":3,"y":-1,"rows":["...........A.A.......",".....IAAAIAIAIAI.....","....IAIAIAIAIAIAIA...","...IAIAAAAAAAIAIAIA..","..IAIAIAIAIAIAIAIAAA.","AAIAAAAA~AA~A~AIAAIAA",".IAIAA~A.A.A..~AAIAI.",".AIAA~..A...A..~AAIAA","AIAIA..A........AAAI.","..IAA...........AAIA.","..A.~...........~.A..","..I...............IA."],"field":"short"},{"x":6,"y":1,"rows":["....IAIyIAA....","..AIAIAyAIAIA..",".AIAIAy.yAAAAI.",".IAyAy...yAyAA.","AAAyI.....AyAIA","AIA.........AIA","AAI.........AAI","AIy.........yIA","IA...........AI","..............A"],"field":"short"},{"x":7,"y":0,"rows":["...IIIIII....","..IIAAIIAI...",".IAAIIAAAAIA.",".IAIAAIIAIAA.","IAIAII~..~IAA","IA~.......~AA","AA.........AA","Ay.........yA",".y.........y."],"field":"short"},{"x":4,"y":-6,"rows":[".........UU........","....I.IIUIUU.......",".....IUUIIUAU......","....AIIAUUIIIAI....",".....AIAIIUAUI.....",".....IAIAIAIAUI....","...IIAAAIAIAI.....U","..IAIAAIAAAIAIAIUU.","...IAAAAIAIAIAIUI..","..IIAIAAAAAAAUII.I.",".IIAIAA~~~~~AAUI...",".U.AAA~.....~AAUI..",".I.II~.......~IA.I.","I..AA.........AA.U.","....A.........A..I.","....A.........A....","....~.........~...."],"field":"afro"},{"x":4,"y":0,"rows":["..........II........",".....I.IAIAIAI......","....IAIAAAAAIAI.....","...IAAAAAaAaAIAII...","..IAAaaaaaaaaaaAII..","I.IAaa~~~~~~~aaaA.I.","IIAaa~.......~aAIAII",".IAaa.........~aAIA.",".AAa~..........aaAIA","IAaA...........aAIAI","IIAa...........AaAIA",".AaA...........AAaA.",".IAa............aAI.","AAI.............AaA.",".IA.............aAI.",".AIa...........aAI..","..Aaa.........aaIAI.",".AAaa.........aaA.A.","...Aa.........aA....","....a.........a....."],"field":"long"},{"x":6,"y":-3,"rows":["....III.II..........","...IAAIAIAI.........",".IIAAIAAIIAIAII.....","IIAIAAAAAAAAAIAII...","IAIAAAAAAAIAIAAAAII.","IIAIAAAAAAAIAAA..AAI",".IIAA.....AAIAAI....","...A......IAAIAAII..","...........IAAIAAII.","...........IIAI..AI.","............II......"],"field":"afro"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAAAIAIA..",".AIAIAIyyAAAAI.",".IAIAyA..IyIAA.","AAAAI.I..A.AAIA","AIAIA.A..I.AAIA","AAIAI.I..A.AAAI","AIA.A.......AIA","IAI.........IAI","AIA.........yIA","AAy..........AA","AI...........IA",".A...........A.",".AA.........AA.","..A.........A.."],"field":"short"},{"x":7,"y":3,"rows":["....IAIAI....","..AIAIAIAI.I.","IAIAAAAAAAIAI",".AA~.....~AI.","IA~.......~AI","AA.........AA","A~.........~A"],"field":"short"},{"x":5,"y":-1,"rows":[".......AA.A......",".....AIAIAAAA....","....AIAIAIIIIA...","...AIAIAIAAAAIA..","..AIAIA~~~~~IAA..",".AIAI~......~IAA.",".AAI~........IIA.","AAII.........~AIA","AIAI..........AIA","AIAI..........AAA","AIA~..........AIA","AA.............AA","AA.............A.",".AI...........AA.",".AAA.........AAAA","..AA.........AA..","..A.............."],"field":"short"},{"x":6,"y":1,"rows":[".....I.........","...AI..I.II....","..IIAAIIIIIIA..",".AIIAIAAIAIAIA.",".IIAIAAAAAAIAI.","IIAI~~~~~~~AIAI","IAA~.......~AIA","AIA.........AAI","IAA.........AIA","IIA.........AAI",".IA.........~A.","..~.........~..","...............","...............",".A...........A.","..A.........AA.","............A.."],"field":"short"},{"x":5,"y":0,"rows":[".....aaa.AaA.....","...AIAAIaaaAA....","..AIAAIAIaIAIA...","..IAIAA~~~AIAIA..",".IAaA~.....~IAIa.",".aIAa.......AaAa.",".Aaa~.......~AIa.",".aa~.........aAI.","..a..........~A..",".................",".................",".................",".................","..A...........I..",".aIA.........aAI.","aIAA.........aaAI","..a..........aAI."],"field":"short"},{"x":4,"y":1,"rows":["....AA...AAAA......",".....AAAAAAIAII....","....AAAIAIIUIU.....",".AAAAAI~A~~IUIIU...","...AIAA.A..U~IUIU..","...AA~A~A..~U~IU.U.",".AAAI~A......~UIU.I","A.AIA.........IUI..","..AA...........IU..","..AA...........II..","..A.............I..",".AA.............A.."],"field":"short"},{"x":8,"y":2,"rows":["..IAIAIAI..",".IAIAIAIAI.","IAIAAAAAIAI","Ay~~~~~~~yA","I.........I","~.........~","~.........~"],"field":"short"},{"x":6,"y":2,"rows":["....AIAAAIAI....","...AIAIAIAIAAAA.","..AIAAAAAAAIAA..",".AIA~A~..A~~IAAA","AIA~A~...~A.AI..",".AA.......~.AAA.",".A~.........~A.A",".A...........A..",".A...........A.."],"field":"short"},{"x":4,"y":2,"rows":[".....AAIAIAIAA.....","....AIIAIIIAIIA....","...AAAA~~~~~AAIA...","...AIA~.....~AII...","..AAA~.......~AIU..","..IA~.........~AU..","..IA...........IIU.",".IAA...........AIU.",".A.~...........~.UU",".A...............UI",".A...............UU","IAU.............IUI","IIUAA.........IIUUA","IUAIA.........IUIUA","IUAAI.........IIAUI","IUIIA.........IUAUI","I.IAA.........AAIII","...II..........I.I.","...I...........I..."],"field":"long"},{"x":5,"y":0,"rows":[".........A.A......","...AA.IAIAIAI.A...","..AIAAAIAIAIAI....",".AAAIAAIAIAIIIAI..","..AIAIIIAIAIAAIAA.",".AIAIAAAAAAAAIAI..",".IAI~~~~~~~~~AIAI.","AAAA.........AAIA.","AIAI..........IAIA",".AA...........AAA.",".AA...........AA..","..A...........AAA.","...............A.."],"field":"short"},{"x":8,"y":1,"rows":["..AIAIAII..",".AIAIAIAII.","AAAAAAAIAIA","AAyyyyyyyAA","Ay.......yA","I.........I","A.........A","I.........I","y.........y"],"field":"short"},{"x":4,"y":1,"rows":["......AAIAIAI.....","....AIAIAAAIAIA...","...IAAAAyy.yIAIA..","...AAIyI....yIAI..","..AIAA.A.....AAAA.","..AIAA.I.....yAIA.","..IAAA.A......IAA.","..AIAy........AIA.","..IAI.........IAI.",".AAIy.........AIA.",".AAA..........yAA.",".AAI...........IAA","A.AA...........AA.","..AAA.........AAA.","..A.A.........A.A."],"field":"short"},{"x":5,"y":-1,"rows":[".....I....A......","......A.IAAA.....","..I..AAIAIAIA....","...AIAIAIAIAIAA..","..AIAIAIAIAIAIA..",".AIAI~~~~~~~IAIA.","AAAI~.......~IAI.",".AIA.........AIAI","A.A~.........~A.A","..A...........A.."],"field":"short"},{"x":8,"y":3,"rows":["..AIIIAAA..",".AAAAIIIIA.","AAIIII~.~AA","A~I~.....~A","I.........I","I.........I","A.........A"],"field":"short"},{"x":7,"y":3,"rows":["......IAA......","..AIAIAIAIA....",".AIAIAAAAAIA...","AIA~.....~AIA..","AA~.......~AA..",".A.........A...",".~.........~...","...............","...............","...............",".............I.","............AA.",".............IA","..............I","..............A"],"field":"short"},{"x":7,"y":0,"rows":["...A..A......","....A.AAAA...","...AAAAIAIA..","..AAIAIAIAIA.",".AAIAIAIAIAIA","IAIAAAAAAAIAI",".AA~.....~AI.","IA~.......~AI","AA.........AA","A~.........~A",".~.........~."],"field":"short"},{"x":5,"y":3,"rows":["....AIZZZZZZZ....","...ZIZZZZZZZAZ...","..ZAIA~~~~~ZZIZ..","..IAZI.....~ZAI..",".AAZA.......~ZAI.",".AIA.........AAA.",".IZA.........IZI.","IZAI.........AAZI","AIZI.........IZIA","IZAA.........AAAI","AIZI.........IZIA",".AAA.........AIZ.",".IZI.........IZI.","..IA.........AI..","..AZ.........ZA.."],"field":"short"},{"x":7,"y":2,"rows":["...AaAA..a..","..AaAAaAAAa.",".AaAaaAaaAA.",".AaaAaaaAaaA",".Aa~~~~~~~aA",".A~.......~A",".~.........~",".~.........~","............","............","............","............","............",".A..........","a..........a"],"field":"short"},{"x":4,"y":1,"rows":["......AIAaAAA.......",".....AIAIaIAIA......","....AIaaaAAaAIA.....","....IA~....~aAI.....","...AI~.......aAI....","...II........~AI....","..AIA.........AIA...","..AIA.........AIA...","..AII.........III...","..AIA.........AII...","..AII.........AIA...","..AIA.........IIA...","..IIA.........III...","..III.........AIA...",".AIIA.........AIIA..",".IIAA.........AAII..",".AIIA.........AAII..",".AIAA.........A.IAI.",".IA.A.........A.I.A.","IA..A...........A..I"],"field":"long"},{"x":6,"y":0,"rows":["....AII.IUIA...","...AAIUIAIUIA..",".AAAIAIUIUIAAA.","..AIyyyIUIAIAA.",".AAA.......yIAA","AIUy........UIA","IUI.........IUI","AIA.........AIA","IAA.........AAI","A.............A","I.............I",".I...........AU",".AA.........AAI","AIA.........AI.",".AA.........A.."],"field":"short"},{"x":7,"y":0,"rows":["...AAAIAIIA..",".AIAAIAIIAIA.","AIAI~~yAAIAIA","IAI~.....~~AI","AI~.......~IA","A...........I","I...........I","A...........A"],"field":"short"},{"x":8,"y":3,"rows":["..IAIAIAI..",".IAIAIAIAI.","AAAAIAIAAAA","AA.......AA","AI.......IA","A~.......~A","~.........~"],"field":"short"},{"x":6,"y":2,"rows":[".....Aa.aA.....","...AaZA~AaaA...","..Aa~....~AZA..",".Aa~......~AaA.",".aA........~Aa.","aA~.........ZAa","Aa~.........~aA","aA...........Aa","Aa...........aA","A.............A"],"field":"short"},{"x":8,"y":1,"rows":["...I.I.IA..","..IAIAIAIA.",".AaIAaAIAIA","AaAaaAIAIA.","aaaAaaaAaaa","Aa~IA~~a~aA","a~.......~a","A.........A","~.........~"],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AAIAIAIAA.","AA~~~~~~~AA","A~.......~A","~.........~"],"field":"short"},{"x":7,"y":4,"rows":["...IAIAIAI....","..IAIAAAAAI...",".IA~.....~AI..",".A~.......~AA.","AA.........A.A",".~.........~..","A...........A.",".............A"],"field":"short"},{"x":5,"y":0,"rows":[".........A.A......","...AA.IAIAIAI.A...","..AIAAAIAIAIAI....",".AAAIAAIAIAIIIAI..","..AIAIIIAIAIAAIAA.",".AIAIAAAAAAAAIAI..",".IAI~~~~~~~~~AIAI.","AAAA.........AAIA.","AIAI..........IAIA",".AA...........AA.."],"field":"short"},{"x":5,"y":-7,"rows":[".......A...IA.","AAIAI..AA.IA..","...IAI.AA.AI..","....AAAAIAI...","..AIAIAIAIA...","....AAAAIAI...","...AI.AIAI....","..AI..IAIA....",".....IAAAIA...","....IAAAAAAI..","...IAA~~~~~AI.","...AI~.....~AA","..AI~.......~A","..IA.........~","..AI.........~","..IA..........","..AI..........","..IA..........","..AI..........","..IA..........","...I.........."],"field":"curly"},{"x":5,"y":4,"rows":[".....IAIAIAI.....","....IAAAAAAAI....","...IA~.....~AI...","..AA~.......~AA..","..AA.........AA..","..A~.........~A..","..A~.........~A..",".AA...........A..",".A...............","A..............A.","................A","..A...........A..","..A...........A.."],"field":"short"},{"x":7,"y":-1,"rows":["...AAIAIAA...",".AIIIIIAIAII.","AIAIAIAIAIAAA","IAIyyyyyyyIAI","AIy.......yIA","AA.........AA",".A.........A.",".A.........A.",".y.........y."],"field":"short"},{"x":6,"y":1,"rows":["....aAa.aAa....","...AAaAaAIIA...","..AIAIIAIAaIA..","..IAIAIaAaAaI..",".IAayyyyyyyAAI.",".IaA.......aIAA",".Aa.........AI.",".IA.........IA.",".Aa.........AI.",".AA.........aA.","..y.........y..","...............","...............","...............","Aa...........A.",".Aa.........aAa","AaA.........AaA","..a.........aI.","..A............"],"field":"long"},{"x":7,"y":2,"rows":["...aaaAUA........","..aaaaaAaAU......",".aaaaaaaAaaAU....",".aa~....~AaAaA...","aa~......~AaAUA..","a~........~AaAUA.","a..........aAaA..","~..........~aAaA.","............AUA.U",".............aaA.",".............aAa.","............aaU.U","............aAU.A","...........aa.A..","...........aU.U..","...........a....."],"field":"short"},{"x":7,"y":-3,"rows":["........U....",".AU.AUA.A.A..","A.UAUAUAUAUA.",".AAAAAAAAAAAA","AAUAAAUAAAUAA","AAAUAUAUAUAAA","AAAAAAAAAAAAA",".AA~~~~~~~AA.",".A~.......~A.",".A.........A.",".~.........~."],"field":"curly"},{"x":4,"y":3,"rows":["......aAaAaAa......","....AaAaAaAaAaA....","...aAa~~~~~~~aAa...","..AaA~.......~AaA..","..Aa~.........~aA..",".aAa...........aAa.",".aAa...........aAa.",".IA.............AI.",".UI.............IU.",".IU.............UI.",".UI.............IU.",".UU.A..........AUU.",".UU.A..........IUU.",".UU.IA.........AUU.",".UU.IA..........UU.",".UU..I.......a..UU.",".UU..A.......a..UU.",".U...............U.","U.................U"],"field":"long"},{"x":8,"y":3,"rows":["..AAAIIIA..",".AIIIIAAAA.","AA~..~IIIAA","A~.......~A","I.........I","I.........I","A.........A"],"field":"short"},{"x":5,"y":1,"rows":[".....AAIAIAI.....","..AAIAIAyAIAIA...",".AIAAyy..yAIAIA..","A.AAI.....yAyAI..",".AIAy......IyAAA.",".AIA.......yAAIA.","AIAA........IIAAA","AAIA........AAIAA","AIAI.........IAIA","IAIA.........AIAI","AIAI.........IAIA","IAIA.........AIAI","A.AI.........IA.A","..AA.........AA..","...A.........A..."],"field":"short"},{"x":6,"y":1,"rows":["....AAA.AAA....","...AAAAAAIAA...","..AIAI~~~AIAA..",".AIA~A...U~AIU.",".AAAU~...UAUAA.",".AU~U....U.UIAU","AAUAU......UAIA",".AU~.........AU"],"field":"short"},{"x":8,"y":2,"rows":["..~.....~..",".~.......~.","~.........~","~.........~","~.........~","~.........~"],"field":"short"},{"x":5,"y":1,"rows":[".....IAIyIAA.....","...AIAIAyAIAIA...","..AIAIAy.yAAAAI..","..IAyAy...yAyAA..",".AAAyI.....AyAIA.",".AIA.........AIA.",".AAI.........AAI.",".AIy.........yIA.","AIA...........AI.",".A.............A.",".A.............A.",".A.............A.","A.A...........A.A","..AA.........AA..","...A.........A..."],"field":"short"},{"x":7,"y":3,"rows":["...AIA.AIAI.....","..AIAIAIAIAIA...",".AIAIAAAIAIA.I..",".IA~.....~AIA.I.","IA~.......~AIA..","AI.........AAIA.","I~.........~I.I.","A...........A..I","I...........AA.."],"field":"short"},{"x":2,"y":2,"rows":["........aIAIAIa........",".......IAaIAIAAI.......","......IAa~....~aI......",".....aAa~......aAa.....",".....AI~.......~IA.....","....AIa.........aIA....","....aA...........Aa....","....AI...........IA....","....aA...........Aa....","...AAI...........IAA...","..AAIA~..........~IaA..",".A.AAI~..........~AA.A.","...AIAA.........AAIa.A.","..AIAIA.........AIAI.A.","..AAIAa.........AAIAIA.",".A..AIa.........AIAAA.A","A...a.a.........A.a.Aa."],"field":"long"},{"x":8,"y":1,"rows":["....~~~....","..~~...~~..",".~.......~.","~.........~"],"field":"short"},{"x":8,"y":3,"rows":["....AIA....","..IAIAIAI..",".IAAAAAAAI.","IA~.....~AI","AA.......AA","A~.......~A","~.........~"],"field":"short"},{"x":3,"y":-1,"rows":[".......AAA.AA.A......","....A.AIAIAIAIA.A....","...AAAIAIAIAIAIAIA...","..AIAIAAAAAAAIAIAIA..",".AIAIAIAAAAAAAAAIAAA.","..AIAAA~.....~AAAIA..",".AIAIA~.......~AIAIA.","AIAIAA.........AAIAAA",".AIAAA.........AAAIAA","AAAIAA.........AAIAA.",".AIA.~.........~.AIAA",".AAA.~.........~.AAA.","..AA.~.........~.AAA.","...AA...........AAA..","....AA.........AA....",".....A.........A....."],"field":"short"},{"x":8,"y":0,"rows":["..IAIAIAI..",".IAAAIAIAI.","IAAIAAI..AI","AI~......~A","I~.......~I","A.........A","A.........A"],"field":"short"},{"x":3,"y":-3,"rows":[".......A...AA.A.......","....AA..A.AA.A........",".....IAAAIAIAIAI......",".AA.IAIAIAIAIAIAIA....","...IAIAAAAAAAIAIAIA...",".AIAIAAAAAAAAAAAIA.A..","...IAAAIAIAIAIAAAIA...","..IAAAIA~~~~A~IAAAIA..","AIAIAA~A.....A~AAIAIA.","..IAAI.........IAAIA..",".IAAAA.........AAAAIA.","A.IAA~.........~AAAA..","..AA~...........~AAAA.",".AAA.............AAA.A",".A.A.............AA.A.","...AA............AAA..","..A.AA..........AA....","................A.A..."],"field":"afro"},{"x":4,"y":-2,"rows":["........A...A......","..IA.A.A..IA..A....","AI.IAIAI.IA.AI..AA.","..A.IAIAAAIAIAIAA..","....AIAIAAAIAIAI...","..IAIAAAAAAAAAAAIA.",".IA.AAAAAAAAAIAA..A",".A.AAA~~....~AIAA..","..AIA~.......~AI.A.",".AAAA.........AAA.A","A.AA~.........~A...",".A.A...........AA..","...A...........A.A."],"field":"curly"},{"x":4,"y":3,"rows":[".....IAIA.AIA....","..AAIAIAIAIAIAAA.",".AI.AIAIAAAIAIA.I","I..AIA~.....~AI..","..AIA~.......~AI.",".AIAA.........IA.",".I.I~.........~I.","I..A...........A.","..AA...........I."],"field":"short"},{"x":6,"y":0,"rows":[".....AA........",".A.AAAAA.AA....","..AAAAAIAAAAA..",".IAIAAAAIAAAIA.","AAIAIAAAAAAAAIA","AAAAAIAAIAAAAA.",".AAA~~A~AI~AAA.",".IA~.A..A..~AA.","..A.........A..","..y.........y..","..y.........y.."],"field":"short"},{"x":1,"y":1,"rows":[".........AIA.AIA.........","........AIUIUIUIA........",".......AUIAUIUIIUA.......","......AUIA~....~AUA......",".....AAIA~......AIAA.....",".....AIU~.......~UIA.....","....AIUA.........AUIA....","....IAIA.........AIAI....","....UAUA.........AUIAA...","....IAIA.........AIAIU...","...AUIUA.........AUIAI...","...AIUIA.........AIUAUA..","...AIIUI.........IUIIAA..","...AIUIA.........AIUAUA..","...IAIUI.........IUIUIA..","...UAUIA.........AIUIAI..","...IAIUI.........IUIUIAA.","..IUIUIA.........AIUIUIA.","..UIAIUA.........AUIIIAI.",".IAI.A.A.........A.AAIIA.","A..A...............A.A.A.","....................A.A.A"],"field":"long"},{"x":6,"y":-2,"rows":[".......A........","....IAI.A.......","..AIAIAIAI......","...AIAIAAA......","...IAAAAAIAI..I.","..IAIAAAAAIAII..","I.AIAAAAAAAAA..I",".AIA~.....~AIAI.",".IA~.......~AI..",".IA.........AI..",".I~.........~I..",".~...........~.."],"field":"curly"},{"x":5,"y":3,"rows":["....AAIAIAIA....","...AI~A~~~AAI...","..AI~I....I~AA..",".A.A.A.....I~I..","..I~I......A~IA.",".AA.A.......IAIA","A.IA........AIA.","..AA.........AI.","..A..........IA.",".I...........A.I",".A.Z.........Z.A","A..Z.........Z.I","..ZZ.........Z..","..Z...........Z.","..Z...........Z."],"field":"short"},{"x":4,"y":-2,"rows":[".......AA..A.......",".....AAAAAAAAA..A..",".A.AAAIAIAIAIAAA...","..AIAAAIAIAIAIAIA..",".AIAAAAAAAAAAAIAIA.",".IAAAAAAAAAAAAAIAA.","AAIAAA~~~~~~~AAAIAA","AAAI~.........~AAI.",".AIA...........AIAA","AAAI...........AAIA",".AA.............AA.","..A.............A..","..A.............A..","...A...........A..."],"field":"curly"},{"x":6,"y":2,"rows":["....AA.AAAA.....","...AAAAAAAAA....","..AA~A~A~~~AA...",".AA~.A..A..~AAA.","AAA.........A...",".A~.........~A..","AA...........AA.","AA...........AA.",".A...........A.A",".A...........AA."],"field":"short"},{"x":6,"y":3,"rows":["......AIA.....","....IAIAIAIA..","...IAAAAAAAIA.","..IA~.....~AI.",".AAA.......AA.","A.A~.......~A.","A.~.........~.","..............","..............","A.............","A.............","AA...........A",".AA.........A.","..A..........."],"field":"short"},{"x":5,"y":0,"rows":[".........AAIA....",".....AIAAAIAIA...","....AIAIAAAIAI...","...AAAIAAyyyIAI..","...AAy......yIA..","..AAy........AI..","..AI.........AA..","..AA.........AA..","..yI.........Iy..","...A.........A...","...y.........y...","IA.............A.",".IA...........AIA","IAAA.........AIA.","..IA.........AA..",".IAA.........IAI.","..IA.........AA.."],"field":"short"},{"x":8,"y":0,"rows":["...aaAIa...",".AaAIAIaaA.","AIAAaaAaAaA","IAaIAAaAIAA","AA.......~A","a.........I","~.........~"],"field":"short"},{"x":6,"y":0,"rows":[".....AA........",".A.AAAAA.AA....","..AAAAAIAAAAA..",".IAIAAAAIAAAIA.","AAIAIAAAAAAAAIA","AAAAAIAAIAAAAA.",".AAA~~~~~~~AAA.",".IA~.......~AA.","..A.........A..","..y.........y..","..y.........y.."],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AIAAAAAIA.","AIAIAAAIAIA","Iy.......yI","I.........I","U.........U","U.........U"],"field":"short"},{"x":8,"y":3,"rows":["...IAIAI...","..IAIAIAI..",".AAAAAAAAA.",".A~.....~A.","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":6,"y":0,"rows":["....AAA.AAA........","..AAAAAAIAIAA......",".AAAAAAIAIAIAA.....",".AAA~.....~AIA.....","AAA~.......~AIA....","AA~.........~AA....","AA...........AA....",".A...........A.....","...................","...................","...................",".............AA....",".A...........IAI...","A............AIAI..","............AIAIAI.","............IAIIAAI","............IAAAI.I","............I.A.A..","............I......"],"field":"long"},{"x":5,"y":-2,"rows":["......I..........","......A..........","..A.AAIAIA.AI.I..","IAIAAAAAAAAIAIAAA","..AAIAIAAAIAIAIA.",".AIAAIAIAIAIAIAIA","..IIA~~~~~~~AIA..","...A~.......~A.A.","...A.........A...","...~.........~..."],"field":"curly"},{"x":6,"y":-1,"rows":[".AAA.A...AAA..","..AAAAAAAAAAA.",".AAAAAAAAAAAAA","A.AaAAAAAAAaA.","..aAA~~~~~AAaA","..AA.......AA.","..A~.......~A.","..A.........A.","..~.........~."],"field":"short"},{"x":2,"y":1,"rows":[".......AIAAAAAIA.....","......AIAAA~AAAIA....",".....AIAA~~~~~AAIA...","....AAAI~.....~IAIA..","....IAI~.......~IAI..","....AIA.........AIA..","...AIAI.........IAAA.","...IAIA.........AIAI.","...A.AI.........IA.AI","..AI.IA.........AI.IA","..IA.AI.........IA.AI","..AI.IA.........AI.IA","..IAAAI.........IAAAI","..AIAIA.........AAAIA",".AA.I.A.........I.IA.","A...A.A.........A.AI.","...................AA"],"field":"short"},{"x":4,"y":1,"rows":["......ZZaZZZZ......",".....aZaZaZaZa.....","....aZ~~~~~~~Za....","....Z~.......~Z....","....~.........~....","...................","...................","...................","...................","...................","...................","................A..","...AZ.........ZA...","...AA.........AA...","...ZA.........AZA..","..ZAZ.........ZAZ..","..AZA.........AZAZ.","..ZZZ.........ZZZA.",".ZZZ...........Z.Z.",".AZA...........A.AZ","A.AZ...........ZA.A","..A.............A.."],"field":"long"},{"x":3,"y":1,"rows":["........aIaa.a.......","......IaIaIaIaI......",".....Ia~~~~~~~aI.....","....aa~.......~aa....","....A~.........IA....","...AI..........AI....","....A...........Aa...","...aI...........Ia...","...IA...........AI...","...A............IA...","...I............AI...","...AIA.........AIA...","..aAII.........IIAa..","..aAAI.........IAIA..","..AAIA.........AIAA..",".aAIAI.........IAIAA.",".A.AAA........AAAAIA.","A.AAA.........A.A.A.A","..IAIA........A.I.IA.",".I.IA.A.........AI.I.","...I.............I..."],"field":"long"},{"x":5,"y":1,"rows":[".....AAAAAIA.....","...IAIAIAIAIAI...","..IAIAIA~AIAIAI..",".IAI~I~~.~~~~IAI.","AAI~.A.......~IA.",".AI~A........~AI.",".IA.I.........IAA",".AA............I.",".I.............A.",".A.............I."],"field":"short"},{"x":7,"y":0,"rows":["..A.AAA.A....","..AAAAAAAAA.A",".AAA~~~~~AAA.","AAA~.....~AAA",".A.........A.",".A.........A.",".~.........y."],"field":"short"},{"x":4,"y":2,"rows":["......AIAIAIA.......","....AIAaIAIAAIA.....","...AIA~~~~~~~aIA....","...aA~.......~Aa....","..AAI.........IAA...","..AIa.........aIA...","..aAa.........aAa...","..AIA.........AIA...","..aAa.........aAa...","..AIA.........AIA...","..aAa.........aAaa..","..AIA.........AIAa..",".aaAa.........aAIa..",".aAIA.........AIAIa.",".AIAa.........aAIAa.",".IAIA.........AIAIA.","aAIAa.........aAIAI.","A.AIa.........aIA.Aa","..a.a.........a.a..a"],"field":"long"},{"x":8,"y":-1,"rows":["..AAIAIAI..",".AAIAIAAAA.","IAAAIAyyyAI","AIy~A~...IA","Iy..y....yI","A.........A","y.........y","y.........y"],"field":"short"},{"x":7,"y":-1,"rows":[".....A.......",".A..IAIA.....","..AAAAIAIA.A.",".AAAIAIAAIAA.",".AIAAIIAIAIA.","AIAA~~A~IIAAA","AAyA.A..A~II.","AIy.......~AA",".A.........I.",".A.........A.",".A.........A."],"field":"short"},{"x":5,"y":3,"rows":[".....AA.AAA.....","....AIAIAIAIAAA.","...AIAAAAAAAIA..","..AIA~.....~AIA.",".AAA~.......~AAA",".AAA.........AAA","A.A~.........~AA","..A~.........~AA",".AA...........AA",".A.............A"],"field":"short"},{"x":6,"y":3,"rows":["....AIAIAIA....","..AAIAIAIAIAI..",".IAIAAAAAAAIAI.",".AAA~.....~AIAA","AIA~.......~AI.",".AA.........AA.","AA~.........~AA","AA...........AA"],"field":"short"},{"x":5,"y":3,"rows":[".....AA.AAA......","....AIAIAIAIA....","...AIAAAAAAAIA...","...IA~A..A.~AI...","..AA~.A...A.~AA..","..AA.A....A..IA..","..A~.I.....A.~I..","..A~I......I.~AA.",".AA.A.......A.IA.",".AAI........II.I.","AA.A.........AIA.",".IAI.........IAI.",".AI...........IA.",".IA...........AI.",".AII.........IIA.",".IAI.........AAI.",".A.A.........A.AA",".A.A.........A.A.","A...............A"],"field":"long"},{"x":4,"y":1,"rows":["......IAIAIAA......","....AIAIAAAIAIA....","...AIAIAy.yAAAAIA..","...IAy.A...yAyAA...","..AAAy......AyAIA..",".AAIA.........AIAA.","..AAI.........AAIA.",".AAIy.........yIA.A",".AIA...........AI..","A.A.............AA.","..A.............A..","..A.............A..",".A.A...........A.A."],"field":"short"},{"x":7,"y":2,"rows":[".IAIIAAAAAA...","..IAAIAIIAIA..",".IAAAAAIAIAIA.","IAAy....AyAAIA","IIA.......IAI.","IA.........IAA","AI.........AI.","IA.........AA.",".A.........A..",".y.........y..","..............",".............A","A...........A.","aa.........aaA",".a.........a.A"],"field":"short"},{"x":7,"y":0,"rows":["......AAA....","..AIAIAIAAA..",".AIAIAAAIAIA.",".IAy.....yAI.","IAy.......yAI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AA.........AA",".A.........A."],"field":"short"},{"x":7,"y":0,"rows":["....AAAAA....","..AAAIAIAAA..",".AIAIAIAIAIA.",".IA~~~~~~~AIA",".A~.......~A.","AA.........~A","AA..........A","A~..........A",".............",".............",".............","A...........A","AA...........",".A..........."],"field":"short"},{"x":1,"y":2,"rows":[".........AIAIAIAA........",".......AIAaIAIAAIA.......","......AIa~....~aAIA......",".....AaA~......~aAaA.....",".....aA~........~IAa.....","....aAI..........aIAa....","....Aaa...........AaA....","....IA............IAaa...","....Aa............AaAI...","...AIA............IAaA...","...aAIA...........AIa....","...aAAIA.........AIAA....","....AIAa.........aAIaI...","....aAIA.........AIAIA...","...IaIAa.........aAIAaA..","...AaAIA.........AIAIAa..","..AIAIAa.........aAIAIAa.","..IAaAIa.........aIAAAaA.",".AaA.a.a.........a.aaAAa.","a..a...............a.a.a.","....................a.a.a"],"field":"long"},{"x":7,"y":-2,"rows":["...AAAA....I.","..AAUIIA.II..","..AUIUIUIUI..","..AIUIUIAIUI.","...IAAAAAAI..",".AAAIAIAIAAA.","AAAIAIAIAIAIA","AAI.......IAA","AI~.......~IA","AI.........IA",".A.........A.",".A.........A."],"field":"curly"},{"x":7,"y":0,"rows":["...AAIAIA...",".AIAAAIAIA..","AIA~....~AAA","AA~.......AA","AA........~A",".A.........A",".A.........A",".A.........A",".~.........~"],"field":"short"},{"x":4,"y":1,"rows":[".......AIAIA.......",".....AAAAIAAAA.....","....AAAIAAIIAAI....","...AIAI~~~~~IAAA...","...IAI~.....~IAI...","..IAI~.......~IAI..","..IAI.........III..","..IAI.........IAA..","..AIA.........IAI..",".IAIA.........IAII.",".AAIA.........IAAI.","IAIAA.........IAIAI","IAIAA.........AIIAI","IAIAA.........AAIAI","IAAIA.........IAIAA",".IAAA.........AIIA.","..AAA.........AAA.."],"field":"short"},{"x":4,"y":-1,"rows":["...............AA...","...II.....AA.AA.....",".....A.AAA.AAA......",".IAIAIAIAAAAAAIAAA..","...AAIAIAIAIAIAI....","..IAIAAAAAAAAAAAIA..",".A.AAA~.....~AIAI.I.","..AIA~.......~AIAA..",".AIAA.........AAIIA.","IAAA~.........~IAAA.",".IAA...........AIIAA","AAAA...........AAI..","II...............AI.","IA...............IA.","AI...............A..",".AA.............AIA.",".A.AA.........AAIA..","...IA.........AI..A.","..IAI.........IAA...","..A.I.........I.A..."],"field":"long"},{"x":3,"y":1,"rows":["......AA.AAIA.A......","....AAAAAIIIIAIA.A...","..AAAIAAAAAAAAAAIA...","...AIAAIIIIIAIIAAIA..",".AAIAA~~~~~~A~~IAAAA.",".AIAAI.........AIAAAA","AAAAII.........AIAAA.","AAAAA~.........~AAA..",".AAAA...........AAAAA","..AA.............AAA.","..A...............A..","..A...............A..","...A.............A...",".....A.........AAA...","...............AA...."],"field":"short"},{"x":8,"y":2,"rows":["..AAAAAAA..",".AAAAAAAAA.","AAAAAAAAAAA","AA~~...~~AA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":8,"y":1,"rows":["....~~~....","..~~...~~..",".~.......~.","~.........~","~.........~","~.........~"],"field":"short"},{"x":4,"y":1,"rows":["......AA.A.........",".....AIAIAAAA......","....AIAIAIAIAA.....","...AIA~~~~~~~AA....","...AA~.......~AA...","..AA~.........~A...","..AA...........A...","..AA...........A...",".AA................","..A.............A..","..A.............A..","..AA...........AA..","..AAA.........AAU..","..AUA.........AUA..","..UAA.........UAUA.",".AAUA.........AAAAA","AAUAU.........UAUA.","..AUA.........A.AU."],"field":"long"},{"x":8,"y":-1,"rows":["...A.......","A..AA.A.A.A",".AIAIAIAIA.","AIAIAIAIAIA","AAAAAAAAAAA","A~.......~A","A.........A","A.........A","A.........A","~.........~"],"field":"short"},{"x":5,"y":0,"rows":[".....AA..........","....AIAAAAAIA....","...AIAAAAAAAIA...","..AIAA~~~~~AAIA..",".AAAI~.....~IAIA.",".UAI~.......~IAI.","UIIA.........AIA.","IUAI.........IAAA","UIIA.........AIAI","IUAI.........IAIA","UIIA.........AIA.","IUAI.........IAI.","U.IA.........AIAI","I.AI.........IAIA","UIIA.........AAAI","IUAA.........IAIA","IIAA.........AUAI",".UAA.........UIAA",".I.A.........IUA."],"field":"long"},{"x":6,"y":2,"rows":["...aaaaaaaaa.....","..aaaaaaaaaaa....",".aaaa~...~aaaa...",".aaa~.....~aaaa..","aaI~.......~UaA..","aIA~.......~AaUA.","aaU.........UAAU.","aUA.........AUaAU","aAU.........aAU.A","AUA.........AUA..","AAa.........aAUA.","AUAa.......aAUAU.","AAAa.......aAAA..",".UA.........AUA..",".Aa.........aA..."],"field":"short"},{"x":6,"y":2,"rows":["...A....A......","....AIAIAIA.A..","..AAIAIAIAIAI..","AIAIAAAAAAAIAI.",".AAA~.....~AIAA","AIA~.......~AI.",".AA.........AA.","AA~.........~AA","AA...........AA",".A...........A."],"field":"short"},{"x":8,"y":-1,"rows":["...IAIAIAII",".AIAIAIIIA.","AAAAAAIAAIA","AI~~yy~~~AI","A~.......~A","I.........I","A.........A","I.........I","~.........~"],"field":"short"},{"x":3,"y":1,"rows":["......AA.AAIA.A..A..","....AAAAAIIIIAIAA...","..AAAIAIAAAAAAAAIA..","...AIAIAAIAIAIAAAIA.","..AIAI~~~~~~~~~IAAA.",".AIAIA.........AIIAA","AAAIAI.........AIAIA",".AIAA~.........~AAA.",".AAIA...........AAAA","..AA.............AAA",".AAA.............AA.","..AA.............AA.","...A.............A..","..AAA...........AA..","...A.A.........AA...","...............A...."],"field":"short"},{"x":7,"y":3,"rows":["..IAIA.AIAI..",".IAIAAIAAIAI.",".AIAAIAIAAIA.","AIA.......AIA","AA~.......~AA","AI.........AA","A~.........~A","A...........A","A...........A"],"field":"short"},{"x":3,"y":1,"rows":[".....AIAIA.AAAA.......","...AAIAAAAAAIAIAA.....","..A.IAIAA~~~AIAIAI....","...IAAA~.....~AAIAI...","..IAIAA.......AAAIAI..",".IAIAA~.......~AIAII..",".AIAAA.........AAIAII.","AIAIA~.........~AAIAIA","AAIAA...........AAAIA.","AAAIA...........AAAAA.",".AIAA...........AIAIA.",".AIAAA.........AAAIA..","..AAAA.........AAAIAA.",".A.AAA.........AAAAA..",".....A.........AA.A..."],"field":"short"},{"x":5,"y":0,"rows":[".......A..........","....AIAIAIAA......","...AIAIAAAIAIA....","..AIAIAy.yAAAAI...","..IAyAy...yAyAAI..",".AAAyI.....AyAIAI.",".AI.A.......AAIAA.",".IAIA.......AAAIIA","AAIA.........AIA.I","AIAA.........AAI.A","AAI...........AA..",".IA...........AAA.",".AIA..........IAA.",".AAA..........AAA.","..I.A........IA.A.","..A.A........A...."],"field":"short"},{"x":3,"y":-2,"rows":["..........AI.........","..........IA..AI.....","......AIA.AA.AIA.....","..IAIAIAIAIAAIA......","..AAAIAAAAAAIAIAIA...","...AIAIA~~~~~IAIAIA..","...IAAA~.....~AAIAIAA","..IAIAA.......AAAAAAA",".IAIAA~.......~AIA...",".AIAAA.........AAIA..","AIA.A~.........~AAI..","AAA.A...........AAAA.","AA.IA...........A.AAA","...AA...........A..AA","..IAAA.........AAI...","..AA............AAI..",".................AA.."],"field":"curly"},{"x":5,"y":2,"rows":[".....IAIAIAI.....","...AIAIAaAIAIA...","..AIAI~...~IaIA..","..IAI~.....~IAI..",".AAI~.......~IAA.",".AIA~.......~AIA.",".aAa.........aAa.",".AIA.........AIA.",".aAa.........aAa.",".AIA.........AIA.",".aAa.........aAa.",".AIA.........AIA.","aaAa.........aAa.","aAIA.........AIA.",".aAa.........aAaa",".AIA.........AIA.","..Aa.........aA.."],"field":"long"},{"x":5,"y":4,"rows":[".....IAIAIAI.....","....IAAAAAAAI....","...IA~.....~AI...","..IA~.......~AI..","..IA.........AI..",".IA~.........~AI.","I.~...........~.I"],"field":"short"},{"x":5,"y":4,"rows":[".....IAIAIAI.....","....IAAAAAAAI....","...IA~.....~AI...","..AA~.......~AA..",".AAA.........AA..","..A~.........~AA.","..A~.........~AA.",".AA...........A.A",".A............A..","A..............A.","A...............A","..A...........A..","..A..........AA..","..A..........A...","...A........A...."],"field":"long"},{"x":5,"y":2,"rows":[".....AIA.AIA.....","....AAAIAIIAA....","...AIAIA~AAIAA...","..AIUIA..IA~AIA..",".AIUIAA...IA~AIA.",".IAUAI....AI~IAA.","AAIUIA....I.IAIAA",".AAUA.....A.AAAI.","AAIUI.....A.IAIAA","AAAUA.....A.AAAIU","AAIU......A..AUAU","AAAA.........IUAU","AAIA.........AIAA",".AAA.........AAAA",".AUA.........AUAA",".AAA.........AAA.",".A.A.........A.A.",".A...........A..."],"field":"long"},{"x":5,"y":2,"rows":["....aAAAAAAAa....","...aIAaaAaaAIA...","..aIAa~...~aaIA..","..aAa~.....~aAaA.",".aAI~.......~IAA.",".AIA~.......~AaI.",".AAI.........IAA.",".AIA.........AIa.",".aAI.........aAI.",".AIA.........AIA.",".IIA.........AIU.","aIUIA.......AIUIa","AIIUA.......AUIIA","I.UI.........IUII","U.Ia.........aIIa","I..............aI","................a"],"field":"long"},{"x":8,"y":2,"rows":["...AaAaA...","..A~A~A~A..",".aaA~~~AaA.","aA~~~~~~~Aa","a~.......~a","a.........a","~.........~"],"field":"short"},{"x":6,"y":1,"rows":["...A.AA.A......","..AAAIAIAIA.A..",".AAAIAIAIAIAIA.",".IAIAAAAAAAIAI.","AAAAAAAAAAAAIAA","AIAA~.....~AAIA",".AI~.......~IA.","AIA.........AIA","AA~.........~AA",".I...........IA"],"field":"short"},{"x":6,"y":2,"rows":["...ZZZZZZZZZ...","..ZAZZZZZZAZZ..",".ZAZZ~...~AZAZ.",".AZA~.....ZAZA.","AZA~......~ZZZA","ZAZ~.......AZAZ","AZA........~AZA","ZZZ.........ZAZ","AZA.........ZZA","ZZ...........AZ","AZ...........ZA",".A...........A."],"field":"short"},{"x":5,"y":1,"rows":[".....IAIAIAA.....","....IAIAAAIAI....","...IAyA....yAI...","..IAy.A.....yAI..","..AI.A.......IA..","..IA.A.......AIA.","..AIA........IAA.","..I.A.........I.A",".AA.A.........A.A",".A..A.........I.A","..A............A.",".A.A...........A.",".A.A..........A..","A..A...........A."],"field":"short"},{"x":7,"y":2,"rows":["...A..UAUA...","..AAAUAUAUAA.",".AUAUAUAUAUAA","AZAUAUAUAUAUZ","ZAA.......UAA",".Z~.......~A.","ZA.........ZA","AZ.........AZ",".............",".............",".............",".............","ZZ.........ZA",".A.........A."],"field":"short"},{"x":7,"y":1,"rows":["....AAAAI....","..AIAIAIAIA..",".AIAAAAAAAIA.","AIA~~~~~~~AIA","AA~.......~AA","AI.........IA","AA.........AA",".A.........A.",".~.........~."],"field":"short"},{"x":6,"y":1,"rows":["....AIA.AAA.....","...AAAAAAIAI....","..AIA~~~~~IAI...",".AAA~.....~IAI..",".IAI.......AAA..","IAA~.......IAIA.","AIA........AAAI.","IA~........A~AAA","AI..........AAI.","IA...........IA.","AA...........AI.","IAI.........AIA.","A.A.........I.I.","A.I.........A..A","............AA.."],"field":"short"},{"x":7,"y":-1,"rows":["....AIUIU....","..AAUAIUIUA..",".AIUIUAIUIAA.","AIAIUIA~.~AI.","AAIUI~....~AI","AI.........IA","AA.........AI",".I.........I.",".A.........A.",".I.........I."],"field":"short"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAAA~.....~AAAI..",".AAIA~.......~AIAA.","AAIAA.........AAIAA",".IAAA.........AAAIA","AAIAA.........AAIA.",".AA.~.........~.AAA",".AA.~.........~.AA.","..A.............AA.","..A.............A..","....A.........A...."],"field":"short"},{"x":7,"y":0,"rows":["..AAIIAA.A...",".AAIIIAIAIA..",".AAAAIIA~.IA.","AAAII~.....AA","I~.AAA~....~I","A...........A","I...........I","A...........A","A...........A",".............",".............",".............",".............",".A.........A.",".A.........A."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA.....","..AIAIAAAIAIA...",".AIAIAIyyAAAAIA.",".IAIAyA..IyIAA..","AAAAI.I..A.AAIA.","AIAIA.A..I.AAIA.","AAIAI.I..A.AAAI.","AIA.A.......AIA.","IAI.........IAI.","AIA.........yIA.","IAy..........AI.","AI...........IAA",".AA.........AAI.","AIA.........AI..","..A.........AA.."],"field":"short"},{"x":7,"y":1,"rows":[".A..AAAAA....","..AAAAAAAAA..",".AAAIAIAIAAA.","AIAIAIAIAIAIA",".AI~~...~~IAA","AI~.......~IA","AA.........AA",".I.........I.",".A.........A."],"field":"short"},{"x":5,"y":0,"rows":["......AAAAA......","....AIAIAIAAA....","...AIAIAAAIAIA...","...IAyA...AyAIA..","..IAy.A...A.yAI..","..AI.A.....A.IA..","..IA.A.....A.AIA.","..AI.........IAA.","..I...........I.A",".AA...........A.A",".A............I.A","..A............A.",".A.A...........A.",".A.A..........A..","A..A...........A."],"field":"short"},{"x":5,"y":2,"rows":[".....A.A.AAA......","....AIAIAIAIA.....","...AAAIAI~IAIA....","...A~.......~AA...","..AA.........AIA..",".A.A.........~I.A.","A..~.........~I...","..............IA..","................A.",".................A","..................","...............A..","..A...............",".............A...."],"field":"short"},{"x":5,"y":2,"rows":[".....AZaZaZA.....","....ZZAaAaAZZ....","...Aa~~~~~~~aA...","...a~.......~a...","...A.........A...","..Aa.........aA..","..ZZ.........ZZ..","...~.........~...",".................",".................",".Z.............Z.",".aZ...........Za.",".ZaA.........AaZ.",".AAA.........aAA.","aAaA.........AZAa","AZAa.........aAaA","aAa...........aAa","AaA...........AaA","a.a...........a.a"],"field":"long"},{"x":5,"y":2,"rows":[".....IaAaAaI.....","....aaIAIAIaa....","...IA~~~~~~~AI...","...A~.......~A...","..AI.........IA..","..IA.........AI..",".Aaa.........IaA.",".AaA.........AaA.",".I.~.........~.I.",".A.............A.",".I.............I.",".A.............A.",".aAa.........aAa.",".IIa.........aII.","AIAa.........aAIA","IaIa.........aIAI","AIAa.........aAIA","IAI...........IAI","A.A...........A.A"],"field":"long"},{"x":7,"y":-1,"rows":["....IAAAI....","..AAAIAIAAA..",".AIIIIIAIAII.","AIAIAIAIAIAAA","IAIyyyyyyyIAI","AIy.......yIA","AA.........AA",".A.........A.",".A.........A.",".y.........y."],"field":"short"},{"x":7,"y":-5,"rows":["....AA.A.A....","...AIAIAI.....","..AIAAAAAI....",".AAAIAIAIAA...","..AIAAAAAAA...","...AIAIAIA....","..AIAIAIAIA...","..AAAAAAAAA...",".AA~.....~AA..",".A~.......~A..",".~.........~..",".~.........~..","..............","..............","..............","..............","..............",".A.........A..",".A.........AA.","A...........A.","A............A"],"field":"curly"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAAA~.....~AAAI..",".AAIA~.......~AIAA.","AAIA~.........~AIAA",".IAA...........AAI.","..IA...........AI.."],"field":"short"},{"x":8,"y":0,"rows":["..UIUIUIA...",".UIAIAIAAA.A","UIA~~~~~AAA.","AA~.....~AAA","A.........A.","A.........A.","~.........y."],"field":"short"},{"x":5,"y":-1,"rows":[".....AAA.AA.A....","..A.AIAIAIAIA.A..",".AAAIAIAIAIAIAIA.",".AAIAAAAAAAIAIAA.","AAIAIAAAAAAAAAIAA",".IAAA~.....~AAAI.","AAIA~.......~AIAA","AIA~.........~AIA","IAA...........AAI",".IA...........AIA","..A............A.","..A............A."],"field":"short"},{"x":8,"y":-1,"rows":["..AAUAU....",".AAUAUAUA..","AAAAAAUAAA.","AAyyAAAyyAA","Ay..yyy..yA","A.........A","A.........A","y.........y"],"field":"short"},{"x":5,"y":2,"rows":[".....AIAIAIA......","...AIAAIAIAAIA....","..AIAIa~~~~~aIA...","..aAIA~.....~Aa...",".AAIAa.......IAA..",".AIaIa.......aIA..",".aAaAa.......aAa..",".AIAI~.......AIAa.",".aAaA........aAaa.",".AIAI........AIAa.","aaAaa........aAaa.","aAIAa........AIAa.","AAAA~........AAIa.","AAUA.........AUAIa","AUAA.........AAUAa","UAUA.........AUAIA",".UAA.........AAU.I",".A.A.........A.A.."],"field":"long"},{"x":5,"y":1,"rows":[".....IAIAIAA.....","...AIAIAAAIAIA...","..AIAy...yAAAAI..","..IAy.....yAyAA..",".AAAy......AyAIA.",".AIA........AAIA.",".AAI........AAAI.","AAIy.........yIAA","AIA...........AIA","AA............AAA","AA............AAA",".AA...........AA.",".AAA.........AAA.","AAAA.........AAA.","..AA.........AA..","...A.........A..."],"field":"short"},{"x":5,"y":5,"rows":[".....~~~~~~~....","....A.......A...","...A~.......~A..","...A.........A..","................","................","..AA............","..AI.........A..","..IA.........AI.",".IAIA........IA.",".IIAI........AAA","I.AAI........IAA","..A.I...........","....I..........."],"field":"long"},{"x":5,"y":2,"rows":[".....Aaa.aaA.....","...ZAaAZaZAaAZ...","..ZAZAaZZZaAZAZ..",".AAIAa~~~~~aAIAA.",".IaAa~.....~aAaI.",".UAIA.......AIAU.","UIIUI.......IUIIU","IUAIU.......UIAUI","UIIU.........UIIU","IUAI.........IAUI","UA.U.........U.AU",".A.I.........I.A."],"field":"short"},{"x":6,"y":0,"rows":["...AAAAAAAA...","..AIAIAIAIAA..","AAAAIAIAIAIIA.","AIAIAAAAAAAAA.","AAIA~~~~~~~AAA",".IA~.......~AA",".AA.........AA",".IA.........A.","..A.........A.","..~.........~."],"field":"short"},{"x":8,"y":-1,"rows":["..AAAAAA...",".IAIUIAIA..","IUIUIUIUIA.","AIUIUIUIUAA","A~.......~A","A.........A","I.........I","y.........y","y.........y"],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA....","...IAIAAAIAI...","..IAyA.A..IAI..",".IAy.I.I..AyAI.",".AI.I..A..I.IA.",".IA.A..I..A.AIA",".AI....A..I.IAA",".I...........IA","AA...........AA","A............IA","AA............A","A.A..........AA","..A..........A.","..A............"],"field":"short"},{"x":8,"y":3,"rows":["...IAIAI...",".AIAIAIAIA.","AAAAAAAAAAA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":5,"y":2,"rows":[".....AAA.AAA......","....AAaaAAaAAA....","...AAa~...~aAAA...","..aAa~.....~aAa...",".AAI~.......~aAA..",".AIA~.......~aIA..",".AAA.........IAAA.","aAIA.........AIaA.","AIAA.........IAAA.","IAIA.........AIaI.","AaAa.........IAAAa","IAIA.........AIaIA","AaAA.........AAAAa","IAIAA.......AAIAIA","AAAAA.......AAAAA.","I.IA.........AIAI.","A.Aa.........aA.A.","I.I...........I..."],"field":"long"},{"x":7,"y":3,"rows":["....IAA........","...IAIAIAI.....","..IAAAAAAAI....",".IA~.....~AI...",".A~.......~A...",".A.........A...",".~.........~...",".~.........~...","...............","...............","...............","...............","...............",".A.............",".I.............","IA.........A...","AA.........IA..","............AI.",".............AI",".............I.",".............A."],"field":"long"},{"x":8,"y":0,"rows":["..AAAA.....",".IAIAAIII..","IAIAAAAIAI.","AIAIAAIAIAI","AAAAAyyyyAA","Iy.......yA","A.........I","I.........A","I.........I","y.........y"],"field":"short"},{"x":6,"y":1,"rows":["....AAIAIAI....","..AIAIAAAIAIA..",".IAAAAyy.yIAIA.",".AAIyI....yIAI.",".IAA.A.....AAA.","AIAAA......yAIA","IAAAA.......IAA","AIAA........AIA","IAIA........IAI","AIyA........AIA","AA.A........yAA","AI...........IA","AA...........AA","AAA.........AAA","AAA.........AAA",".AA.........AA."],"field":"short"},{"x":3,"y":1,"rows":["......AIAIIIAIA....",".....AAAIIIIIAIA...","....AIAIIIUIIAAIA..","...AIAIIIIIIIIAAIA.","...IAAIIIIIIIIIAAA.","...AIAI~~~~~~~IAIAI","..AIAI~.......~IAAA","..IAAA.........AIAI","..AIAI.........IA.A","...AIA.........AI.I","...IAI.........IA.A","..IAIA.........AI.I","..AAAI.........IA.A","..IAAA.........AIII","..AAAI.........IAIA",".AIAIA.........AAAI",".IAAAI.........IAI.",".AIAIA.........A.A.","AIA..A.........I.I.","AA...............A."],"field":"long"},{"x":6,"y":1,"rows":["........a......","...aaAAaAAa....","..aAAaaAaaAAa..",".aAaaAaaaAaaAa.",".aAaA~~~~~AaAa.","AaAa~.....~aAaA","AaA~.......~AaA","AaA.........AaA","AaA.........AaA","A.............A","I.............I","A.............A","IA...........AI","AIA.........AIU","IAI.........IAI","UIA.........AIU","UUI.........IUU","UUU.........UUU","UU...........U."],"field":"long"},{"x":7,"y":-1,"rows":["....A..AA....","..AIUIAIIAA..",".AIUIAIUIAAA.","AAAIUIUIAIAA.","AAIyyyIUI~IAA","AIy......yAAA","IU........yUI","UI.........IU",".A.........A.",".A.........A."],"field":"short"},{"x":9,"y":-2,"rows":["...AaUaA...",".AaAUAUAU..","..AaAUAaAU.",".AUAaAaAaAA",".aAUaaAaAa.","..aAaAaaaAA",".~~...~~aAa","~.......~aa","..........A","..........a"],"field":"curly"},{"x":6,"y":1,"rows":["...AIAI~IAAA....","..AIAIA~AIAIA...","..IAyA...AyAIA..",".IAy.A...A.yAI..",".AI.A.....A.IA..",".IA.A.....A.AIA.","AAI.........IAA.",".I...........I..","AA...........AA.","A............IAA",".A...........A..",".AA...........A.",".AA..........A..","A.............A."],"field":"short"},{"x":8,"y":3,"rows":["..AAAAAAA..",".AAAAAAAAA.","AA~~...~~AA","A~.......~A","~.........~"],"field":"short"},{"x":8,"y":0,"rows":["..AAAA.....",".IAIAAIII..","IAIAAAAIAI.","AIAIAAIAIAI","AAy.....yAA","Iy.......yA","A.........I","I.........A","I.........I","y.........y"],"field":"short"},{"x":8,"y":0,"rows":[".....IIA...","..AAIIAIA..",".AAIAAAAAA.","AIAAIIAIAIA","I~.......~I","~.........~","~.........~","~.........~"],"field":"short"},{"x":6,"y":2,"rows":["....AaA.AAA.....","...AIAIAIAIA....","..AAAIAI~IAIA...",".aA~a......~AA..","aAA.........AIA.","aaA.........~IaA",".a~.........~I.a","aa...........Iaa","a.............aA","a.............a.","...............a","................",".............a.."],"field":"short"},{"x":8,"y":0,"rows":["...AAAAA.....","..AAAAAAA....",".AA~~~~~AA...",".A.......A...","~.........~..",".............",".............","...........A.","............A",".............",".............",".............","..........A.."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA.....","..AIAIAAAIAIA...",".AIAIAyyAAAAAI..",".IAIAA..AIAIAA..","AAAAIA..AAIAAIA.","AIAIA....IAIAIA.","AAIAI....A.AIAIA","AIA.A.......AIA.","IAI.........IAI.","AIA.........yIA.","IAy..........AI.","AI...........IAA",".AA.........AAI.",".IA.........AI..","..A.........AA.."],"field":"short"},{"x":6,"y":0,"rows":[".....AAAA......","...AAIAAAAAA...","..AAAAAAAIAIA..",".AAIAA~~~AIAIA.",".AAAA~...~AIAI.",".IAIA.....AAAA.","IAAA~.....~IAIA","AIAA.......AAAI","IAA........AAAA","AIA.........AAI","IAA.........AIA","AAA.........AAI","IAI.........AIA","A.A.........I.I","..I.........A.."],"field":"short"},{"x":6,"y":0,"rows":["......AAA.......","....AAAAAIA.....","...AAIAAAAAA....","..AAIAIAIAIAA...","..A~...IAI.~A...",".AI...I.I...IA..","AII.........AIAI","IA~.........~AIA","AIA..........IAA","AA............A.","A.............A.","A.............A.",".A...........A.."],"field":"short"},{"x":7,"y":0,"rows":["...AAAAA.....","..AAAIIIAAA..","AAAAIAAAAIAA.","IAIAAIIIIAIAA","AIAy~AAAIIAAA","IAy....~AAIIA","AIy.......~AI","AA.........IA","AA.........AA",".A.........A."],"field":"short"},{"x":6,"y":2,"rows":["...AAaA.AAA....",".AAAIAIAIAIAA..","..AA~~~~~~~IAA.",".aA~.......~AA.","aAA.........AIA","a.A.........~.a","..~.........~.."],"field":"short"},{"x":7,"y":1,"rows":["....AAAAA....","..AAAIAIAAA..",".AIAIAIAIAIA.","AIAIAIAIAIAIA","AAI~~...~~IAA","AI~.......~IA","AA.........AA",".A.........A.",".~.........~.",".~.........~."],"field":"short"},{"x":6,"y":1,"rows":["....AIA.AAA.....","...AAAAAAIAI....","..AIA~~~~~IAI...",".AAA~.....~IAI..",".IAI.......AAA..","IAA~.......~AIA.","AIA.........AAI.","IAA.........AAAA","AIA.........AAI.","IAA.........AIA.","AA...........AI.","IA...........IA.","A............A..","A............AA."],"field":"short"},{"x":3,"y":-4,"rows":["......A..............",".......A...AA.A......","....AA.AA.AA.A.......",".....IAAAIAIAIAI.....",".AA.IAIAIAIAIAIAIA...","...IAIAAAAAAAIAIAIA..",".AIAIAAAAAAAAAAAIA.A.","...IAAAIAIAIAIAAAIA..","..IAAAIA~~A~A~IAAAIA.","AIAIAA~I..A..I~AAIAIA","..IAAI.......I.IAAIA.",".IAAAA.........AAAAIA","A.IAA~.........~AAAA.",".I..~...........~..AA"],"field":"afro"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAAA~.....~AAAI..",".AAIA~.......~AIAA.","AAIA...........AIAA",".IAA...........AAIA","AAIA...........AIA.",".AA.............AAA","..A.............AA."],"field":"short"},{"x":5,"y":3,"rows":["........AAAA.....","....AIAIAIAIAAA..","...AIAAAAAAAAA...","..AIA~A..AA~AAAA.","..IA~A....AA~AI..",".AIA.........AIA.",".IA~.........~AI.","I.A...........A.I"],"field":"short"},{"x":6,"y":0,"rows":[".....UUUUU.....","..UUUUUUUUUUU..",".UUUAUUUUAUUUU.",".UUAAAAAAAAAUAU","AAA~.......~AA.",".A~.........~AA",".A~.........~A.",".A...........A.",".A...........A."],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AA~~~~~AA.","A~.......~A","~.........~"],"field":"short"},{"x":6,"y":3,"rows":[".....AAAAA.....","...AIAIAIAIA...","..AIAIAAAIAIA..",".AIAI.....IAIA.",".IA~A.....A~AI.",".IA.I.....I.AI.","IA~.........~AI","IA...........AI",".A...........A."],"field":"short"},{"x":5,"y":0,"rows":[".......A...........","....AIAIAIAA.......",".A.AIAIAAAIAIA.....","..AIAIAy.yAAAAI....","..IAyAy.....AAAI...",".AAAyI......yAIAI..",".AIA.A.......AIAA..",".IAIA........AAII..","AAIAA........AIA...","AIAA.........AAI...","AAIA.........AAAA..",".IAA.........AAAAA.",".AIA.........AIAA.A",".AAA.........AAA...","A.IA.........IAAA..","..AA.........AAA...",".A.A..........A.A.."],"field":"short"},{"x":7,"y":1,"rows":["....AaA.A....","...AZAZaZA...","..ZZAaAZaZZ..",".Aa~~~~~~~aA.",".a~.......~a.",".A.........A.",".A.........A.","Aa.........aA","ZZ.........ZZ",".~.........~."],"field":"short"},{"x":7,"y":0,"rows":["......AAA....","..AIAIAIAAA..",".AIAIAAAIAIA.",".IAy.....yAI.","IAy.......yAI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AI.........IA","IA.........AI","AA.........AA",".A.........A."],"field":"long"},{"x":5,"y":1,"rows":[".....AIAAAAA......","...AAAAAAAIAIA....",".AAAIA~~~~~IAIA...","..AAA~.....~IAI...",".AIAI.......AAAA..",".IAA~........AIA..","AAIA.........AAIA.","AIA~.........~AAA.","AA.............IA.","AI.............AA.",".A.............I.A","AIAA..........AA.A",".AAA..........AI..",".A.I..........A.A.",".A.A..........A.A.","..A............A..",".A..............A."],"field":"short"},{"x":6,"y":0,"rows":["..AA.......AA..",".AIIIAIAIAAIIA.",".IAIAIAAAIAIAI.","AAIAy.....yAIAI","AIAy.......yAIA","IA...........AA","AA..........AAI","AI..........AIA","IAA.........IAA","AAI.........AAI","AIA.........AIA","IAA.........IAA","AAI.........AAI","AIA.........AIA","IA..........IAA","AA...........AI","AIA.........AIA",".AA.........IA.",".AI.........AA.",".IA.........AI.","..A.........I.."],"field":"long"},{"x":6,"y":-1,"rows":["..I.IIIA.A.A.A.",".IAIAIAIAIAIAI.","IAIAIAIAIAIAIAI","AIAIAAAAAAAAAAA",".AIAAAAAAAAAAA.",".IAA~~~~~~~AAI.","..A~.......~A..","..A.........A..","..~.........~.."],"field":"short"},{"x":7,"y":-2,"rows":["....I...........",".....I..........",".....AAA........","....AAA.A.......",".I.IAIAIAAII....","..IAIAIAIAIAA...",".AAAAAAAAAAAA...",".AA.......AIAA..","AA~.......~AIAI.",".A.........A.A.I",".~.........~.A..",".............A..",".............I..",".............I.."],"field":"curly"},{"x":6,"y":3,"rows":["....AAAAAAA..","...AAAAAAAAA.","..AA~~...~~AA","..A~.......~A","..~.........~",".............",".............",".............",".............",".............",".............",".AA..........","AAA..........","A.A..........","..A..........","..A.........."],"field":"long"},{"x":8,"y":-1,"rows":["I.IIII.I.I.",".IIIAIIIII.","IAIAIAIAIAI","AIAIAIAIAII","IAAAAAAAAAA","AA~~~~~~~AA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":8,"y":0,"rows":["...AAAAA...","..AAIAIIAA.",".AAIAIAAIAA","AA~.A.~AAIA","I~.....~~AI","A........~A","I.........I","A.........A","A.........A","~.........~"],"field":"short"},{"x":6,"y":-3,"rows":["...............IUU..",".........II...IU....",".......AIAAIUIU.....","..AAA.AAAAIAIAIU....","IAIAAAAAAIAIAIUI..UU","..AIAIAAAAAAIUIUUU..",".II.IAAAAAAAAIUII...","...AAA~~~AAAAUIIUUU.","...A~.....~AAAAUI...",".AA~.......~AIUI....","..A.........AAIUUU..","..A.........AIUI....","..~.........~..U....","................U..."],"field":"afro"},{"x":3,"y":2,"rows":[".......IaAaAaI.......","......aaIAIAIaa......",".....IA~~~~~~~AI.....",".....A~.......~A.....","....AI.........IA....","....IA.........AI....","...aaa.........aaa...","...A.a.........a.A...","..Aa.~.........~.aA..","..aA.~.........~.Aa..","..Aaa...........aaA..",".AIAaa.........aaAI..",".IAIAa.........aAIAA.",".AIIIA.........AIAIA.","..AIAa.........aAIAI.","..IAIA.........AIIIAI",".IIIAa.........aAIAIA","IAIAI...........IAIII","A.IIA...........AIAIA","..I.I...........I.I.I"],"field":"long"},{"x":5,"y":-6,"rows":[".....AI........","......AIAAAAII.",".....AAAIAI...I","....AIAIAUAI...",".....AIAIIUA...","....AAAIAUAI...","....IAIAIAIA...","....AAAAAAA....",".IAAAAAAAAAA.A.","....AA~~~~~AA..","...AA~.....~AA.","..AA~.......~AA",".A.A.........A.",".A.~.........~.","A..............","I..............","I.............."],"field":"afro"},{"x":6,"y":-1,"rows":["....AAA.AA.A....",".A.AIAIAIAIA.A..",".AAIAIAIAIAIAIA.","AAIAAAAAAAIAIAA.","AIAIAAAAAAAAAIAA","IAAA~.....~AAAI.",".IA~.......~AI..","IA~.........~AI.",".A...........AA.",".A...........A.."],"field":"short"},{"x":4,"y":2,"rows":["......IUIUIUI.......","....IUIAUIUIIUI.....","...IUIA~~~~~AAUI....","...AIA.......AIA....","..IIU~.......~UII...","..IUA.........AUI...",".AAIA.........AIAA..",".A.UI.........AIIA..",".A.IA.........~.A...",".A.UI.........~.IA..",".UAIA...........AA..","..UII..........UIA..",".AAUA.........AIUA..",".AIUI.........IUIUA.",".IUIA.........AIUIA.",".UIUI.........IUIUI.","AIUIA.........AIUIU.","IIIUA.........AUIAIA","I.AUA.........AAA.AA","U.I.AA........A.A..A","..U..A........A....."],"field":"long"},{"x":4,"y":1,"rows":["......AIAAAAA......","....AAAAAAAIAIA....","..AAAIA~~~~~IAIA...","...AAA~.....~IAI...","..AIAA.......AAAA..","..IA.A.......AAIA..",".AAI.A.......A~AIA.",".AIA.A.......A.AAA.",".AA............AIA.",".AI............AAA.","A.A............AI.A","A.IA...........AA.A","...A............A..","..A.............A.."],"field":"short"},{"x":4,"y":2,"rows":["......IAI.III.....","....AIIIIIIIIIA...","...AIIIIIIAIIIIA..","..AAI~...AA..~IIA.",".AAII....AA...III.",".AAAI....A....~IAI","..AA~.........~I.A",".AAA...........IAA",".A..............AI",".A..............A.",".A...............A","A.................","..AA...........AA.","..A.............A."],"field":"short"},{"x":6,"y":0,"rows":[".....AAAAA.....","...AIAIAIAAA...","..AIAIAAAIAIA..",".AIAy.....yAIA.",".IAy.......yAI.","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAA.........AAI","A.A.........A.A"],"field":"long"},{"x":6,"y":1,"rows":["...AIAI.IAAA...","..AIUIUyUIUIA..",".AIUIyyyyyIUIA.",".IUI.......IUI.","AUI.........IUA","AIA.........AIA","AUI.........IUA","AI...........IA","AA...........AA","A............IA","AA............A","A.............A","A...........A.A","............A.A","............A..",".............A."],"field":"short"},{"x":5,"y":0,"rows":["......IIAaAI...",".....IAIaaAII..","....IAIa..aaAI.","....AIa....~aI.","...IIa......~AI","...Aaa.......aA","...Ia........aI","..AAa........AA","..AIa........~a","..AIa.........a","..AIa.........a","..IAa........aa","..IAa.......aAa","..AAa.......AaA","..IAA.......aAI","..IAa........AA",".IIA...........",".AI............","A.I............"],"field":"long"},{"x":5,"y":0,"rows":["......aA.AA......","....IaIaaAIIA....","...IaIa~aaAAIA...","..IAAa...~aAAIA..","..AIa~.....aAIA..",".IAIa.......aAIA.",".AIa~a......aAII.",".AIa........aaIA.",".IIa........~aAI.",".IAa.........IaA.",".Aaa.........IaI.",".Ia~.........aaA.",".Ia..........IaA.",".IaI.........aaI.","AIAI~.......~aaIA","AIAIa.......aAaAA","AAIIa........IaIA","AIAI.........AIIA","aIAA..........AIA","aAa............AI","..a.............."],"field":"long"},{"x":7,"y":-4,"rows":["....AIA......","...AIAII.....","...IAIAII....","...AIAAAI....","...AAAAAI....","....IIII.....","...AIAIAIA...","..IAAAAAIAI..",".IAAAAyAyAAI.",".AAy.....yAA.",".Iy.......yI.",".I.........I.",".U.........UA","AU.........U.",".............","............A",".............",".............","..........A..","...........A.","...........A."],"field":"curly"},{"x":6,"y":0,"rows":["........A.AA......","......AAAAAIA.....","....AAIAIAIAIA....","...IA~.~AAAIAIA...","..IA~...~AAAIAIA..",".IAA.....~AAAAAI..",".AA~......AAAAIAI.",".IA.......~AAAAIA.","IAA........AAAAAIA","AIA........AAAAIAA","IA.........~AAAAIA","AA..........AAAAAA","IA..........AAAAAA","AA..........AAAAA.","AAA~.......~AAAAA.","AAAA.......AAAA.A.","A.AA.......AA.A..."],"field":"short"},{"x":6,"y":-3,"rows":["......A........","....AIAAAIA....","..AAAAIAIAAAA..",".IAIIIIIAIAIIA.","AAIAIAIAIAIAAA.","AIAIyyyyyyyIAIA",".AIy.......yIA.",".AA.........AA.","..A.........A.."],"field":"afro"},{"x":5,"y":3,"rows":[".....AAA.A.A......","....AAIAAIAIAA....","...AIAIAAAAAIAI...","..AIAA~...~AAIA...",".IAAA.......AAAI..","AIAA.........AAA..","AAA~.........~AII.","A.A~.........~AAI.",".IA...........AIAI","IA.............A.A","AA.............A..",".A.............AA.","..A...........AA..","..AA.........AA...","..A..........A...."],"field":"short"},{"x":7,"y":4,"rows":["....AIAIA......","..IAAAAAAAI....",".IA.......AI...","IA.........AI..","AA.........AA..","A~.........~A..","...............","...............","...............","...............",".A..........A..","I..........A.A.","I..........I...",".I..........I..",".............AA"],"field":"long"},{"x":6,"y":0,"rows":["....AAAAAAA....","...AAAIAIAAA...","..AIAIAIAIAIA..",".AIAIAAAAAIAIA.","AAAAAAAAAAAAAA.",".IA~.......~AIA","AAI.........IAA","AIA.........AIA","AA~.........~AA",".A...........A."],"field":"short"},{"x":7,"y":4,"rows":["...AaA.AaA...","..Aaa~~~aaA..",".Aa~.....~aA.","Aa~.......~aA","A~.........~A","a...........a","~...........~",".............",".............",".............",".............",".a.........a.",".A.........A.",".U.........U.",".U.........U."],"field":"long"},{"x":7,"y":1,"rows":["......UUAZa..","..UAUAUAaAZU.",".UAUAUAaZZaAU","aAaAUAUA~AUUA","ZaAUAUAU.~AAA",".Za.UAU...~a.",".a.........a.",".Z.........Z."],"field":"short"},{"x":8,"y":3,"rows":["..AaAIAIA..",".aaAIAIAIA.","aa~~...~~aA","a~.......~a","a.........a","~.........~","~.........~"],"field":"short"},{"x":6,"y":0,"rows":[".....AAAAA.....","...AIAIAIAAA...","..AIAIAAAIAIA..",".AIAI.....yAIA.",".IAyA......yAI.",".AI.I.......IA.","AIA.A.......AIA","IAI.I.......IAI","AIAI........AIA","IAIA........IAI","AIAI........AIA","IAIA........IAI","AIAI.........IA","IAIA........IAI","AIAI.........IA","IAA.........AAI","AAA.........AAA","A.A.........A.A"],"field":"short"},{"x":5,"y":1,"rows":[".....AIA.IAI.....","....AAAAAAUAI....","...AIA~~~~~UAI...","..AAA~.....~UIA..","..IAI.......IAI..",".AAI~.......UIAI.",".AIA.........UIA.",".AAI.........IAI.",".AIA.........UIA.",".AAI.........IAI.",".AAA.........AIA.",".IAI.........IAI.","AAIA.........AIAA","AIAI.........IAIA",".AIAA.......AAIA.","A.AAA.......AAA.A"],"field":"short"},{"x":8,"y":0,"rows":["...AIAIA...",".IAIAIAIIA.","IAIAIAIAIIA","AAAAAAAIAII","IAyyyyyyyIA","Ay.......yA","I.........I","A.........A","y.........y"],"field":"short"},{"x":8,"y":0,"rows":["..aAaAaAA..",".aAaAaaaaA.","aAaAaAAaAaA","aA~~A~A.~Aa","A~.......~A","a.........a","A.........A","a.........a","~.........~"],"field":"short"},{"x":5,"y":1,"rows":[".....AAIAIAI.....","...AIAIAyAIAIA...","..IAAAy..yAIAIA..","..AAIA....yAyAI..",".AIAII.....IyIAA.",".AIAyA.....U.UIU.",".IAA.I.....I.IAA.",".AIA.......U.UIU.",".IAI.........IAI.",".IIy.........UIA.",".UA..........yIA.",".II...........UA.",".IAA.........AIA.","A..A.........A..A",".............A..."],"field":"short"},{"x":6,"y":1,"rows":["....AIAaAIA.....",".AaAaAaAIAIAI...","AaAaAIAIyIaIaAA.",".AIAIyIA.AyAIa.A","aIaIA.A..I.IaAa.","IAIAI.I..A.aIAI.","aaA.A.A..I.I.aA.",".Aa.a........A..","Aay.........yaA.","..y.........y..."],"field":"short"},{"x":7,"y":1,"rows":["...IAIAIAI..","..IA~~~~~AA.",".IA~.....~AA",".A~........A","AI.........A","I~.........y","A...........","I...........","A...........","I...........","A..........."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA.....","..AIAIAIAIAIA...",".AIAIAyAyAAAAI..",".IAyAy.I.yAyAA..","AAAyI..AI.AyAIAA","AIA.A...A...AIA.","AAI.....I...AAI.","AIy.........yIA.","IA...........AI.","A.............A."],"field":"short"},{"x":6,"y":2,"rows":["....IAAAAAI....","...IAAAAIAAI...","..IAA~....AAI..",".AAA~.....~AAA.",".AI~.......~IA.","AIA~.......~AIA","AAA.........AAA","AIA.........AIA","IAA.........AAA","AIA.........AIA","AAA.........AAA","AIA.........AIA","AAA.........AAA","AIA.........AIA","IAA.........AAI","IIA.........AII","UIA.........AIU","IUI.........IUI","UIU.........UIU",".UI.........IU."],"field":"long"},{"x":6,"y":-1,"rows":["..I.IIII.I.I.I.",".IAIAIAIAIAIAI.","IAIAIAIAIAIAIAI","AaAIAIAaAIAIAaA",".AaAaAaaaAAAaA.",".IaA~~~~~~~aaI.","..A~.......~A..","..A.........A..","..~.........~.."],"field":"short"},{"x":9,"y":3,"rows":["..y...y..",".y.....y.","y.......y"],"field":"bald"},{"x":8,"y":1,"rows":["...~~~~~...","..~.....~..",".~.......~.","~.........~","~.........~","~.........~","~.........~"],"field":"short"},{"x":9,"y":1,"rows":["...~~~...",".~.....~.","~.......~","~.......~","~.......~"],"field":"short"},{"x":6,"y":-1,"rows":["........A.....","..A..AIAIA....","...IAIAIAIAI.A","..IAAAAAAAAAI.","AAAAAIAAAIAAAA",".AAAIA.~IAIAAA",".AAAAI..~~~IAA",".AIAI......~IA","..A.........A.","..~.........~."],"field":"short"},{"x":6,"y":2,"rows":["...A....A......","....AIAIAIA.A..","..AAIAIAIAIAI..","AIAIAAAAAAAIAI.",".AAA~..A..~AIAA","AIAA....A..AAI.",".AA~.......~AA.",".AA.........AA.",".AA.........AA.","..A.........A.."],"field":"short"},{"x":8,"y":0,"rows":["..AAA.IUI..",".AaAaaAIUI.","AaIA~~aAIUI","AIUI...~AIA","aAA......Aa","A~........A","a.........a","a.........a"],"field":"short"},{"x":6,"y":1,"rows":["....AIA.IAIA.....","...AAAAAAIAIAIA..","..AIA~~~~~IAIAIA.",".AAA~.....~IAIAAI",".IAI.......AIAI.A","IAA~.......~AIA..","AIA.........IAAA.","IAA.........AIAI.","AIA.........A.AI.","IAI.........I.IA.","AAAI........A.AI.","IA.A........I.IA.","A..I........AIA..","I...........IAAA.",".A..............."],"field":"short"},{"x":7,"y":-1,"rows":["......AA....","..AAA.AAA...","...IAIAIAI..","..AAIAIAIAA.",".AI~A~~~A~IA",".A~AA...AA~A",".A.A.....A.A",".~.........~",".~.........~","............","............","............","............",".A..........",".A..........","A..........."],"field":"short"},{"x":8,"y":-1,"rows":["...aAaAa...","..aAZaAAZ..",".aAZAZaAAZ.","ayyy...yyyZ","Ay.......yA","a.........a","A.........A","y.........y"],"field":"short"},{"x":7,"y":0,"rows":[".....AaI.....","..AIAaAaIIA..",".AIAaAIAIAaA.",".IAIAIAIAIAa.","IAaAyy....yAI","AIy........aA","IA.........AI","AI.........aA","IA.........AI",".I.........I."],"field":"short"},{"x":5,"y":2,"rows":[".....AAAAAII.....","....AAAAAAAIAA...","...IA~....~AUIA..","..AAA......~AIA..","..AA~.......AUIA.",".AAA~.......~IUI.",".AIA.........UIIA","AIUI.........IUAA","AAIA.........UIIA","IIUI.........IUAI","A.IA.........UIIA","I.UI.........IUA.","A.IA.........AIIA","I.UI.........IU.I","...A.........A..A"],"field":"short"},{"x":3,"y":-2,"rows":["....AAA........A......",".....IAA.A.IAIAI......","..A.IAIAIAIAIAIAIA....","...IAIAAAAAAAIAIA.....","..IAIAAAAAAAAAAAIAA...","..AIAAAIAIAIAIAAAIAA..",".AIAIAI~~~~~~~IAIAIAIA","AIAIAA~.......~AAIAIA.",".AIAAI.........IAAIIIA","AIAIAA.........AAAAIA.","AAIAA~.........~AAAAIA","A.A.~...........~.AAA.","..A...............AA..","..A...............A...","...A.............AAA..","...AA...........AAA...","....AA.........AAA....","....A...........A....."],"field":"curly"},{"x":6,"y":0,"rows":[".....IA.AaA......","...IAIIAIAIAI....","..IAIAAyAIAIAI...",".IAIaAy.yAIAIAI..",".AIAaI...yAaAIAI.",".IAa.A....IAIAI.A","AIAI.I.....aAIA.A","IAI........AIAA..","aAA.........aAIA.","AAI.........AIAI.","AIy..........AIA.","A.y..........A.A.","a............a.a.",".............a..."],"field":"short"},{"x":4,"y":1,"rows":[".....IAIAIIAIA.....","....IAAAAIAIAIA....","...IAI~.....~AIA...","...AI~.......~AI...","..AIA.........AAA..","..IAA.........AIA..","..AIA.........AAI..","..IAA.........AIAI.","..AIA.........AAIA.",".AIAA.........AIA.A","..AA...........AIA.",".AIA...........IAA.","A.AAA.........AA..A","..A.A.........AAA..","....A.........A....","....A.........A...."],"field":"short"},{"x":3,"y":0,"rows":[".......AaA.AI.......",".....IAIAIAIIAI.....","....IAIAIAAAAIAI....","...IAIAIAy.yAaIAI...","..IAIAaAy....aAIA...",".A.IAIAI......aAII..","...AIAa.......IAUA..","..AAAIA........IAIU.","..AIUa.........UAUI.",".UIAIA.........UAU.U",".UAUA..........UIU..","UUAUA..........UIU..",".AaUU..........UIU..",".AUUU..........IIUI.","..UAUA.........IUI..","..UAUA.........IIUI.","..U.AU.........IUII.","..A..U.........I.I.."],"field":"short"},{"x":6,"y":0,"rows":["........AAA....","....AAAAAAAA...","..AAAAAAAIAIA..","...AA~~~~~IAIA.","..AA~.....~IAA.","..AA.......AA.A",".AAI.......IAA.","..AA.......AA.A",".AA.........A..",".IA.........A..",".A~.........~..",".I.............",".A.............","A.............."],"field":"short"},{"x":7,"y":2,"rows":["...A.A.AAA...","..AIAAAAAIA..",".AIAIAIAIAIA.",".IAIAIAIAIAI.","AAI~~~~~~~IAA","AI~.......~IA","AA.........AA","AA.........AA",".A.........A.",".~.........~."],"field":"short"},{"x":5,"y":0,"rows":[".....A...........","...AAAIAAIAIAA...","....AIAIAAIAA....",".AAAIAI~I~AIAAA..","..AIA~A.A.I~IAIA.",".AIAI.I.I.A.AIA.A","..AIA...A...IAIA.",".AIA.........AAI.",".AA...........IA.","AAI...........AI.",".A.............A.",".A.............I.",".IA...........AA.",".AA...........A..","..A............A."],"field":"short"},{"x":5,"y":1,"rows":["..AAAAAA..........","....IAIAAAIAI.....","..AIAIAIAIAIAAAA..","AA.AIAAAAAAAIAA...","..AI~.......~IAA..",".AI~.........~IAA.",".AA...........AA.A","AAA...........AA..","A.A...........AA..","...............A..","..................",".A................",".A................"],"field":"short"},{"x":8,"y":-2,"rows":[".aaAA..I.I.","aAIAAaIAI..","aIAIAIAIAIA","aAaAaAaAIA.",".aaaaaaaAAA",".aaAaAaAaa.","aaAaAaAaAaA","aA~.....~Aa","A~.......~A","A.........A","a.........a","a.........a"],"field":"curly"},{"x":4,"y":1,"rows":["......AAA.AAA.....",".....AaIAIAIaA....","....aIAaIAIAAIa...","...aIAaA~~~AaaIa..","...aAAA.....AaAa..","..aAIa~.....~aIAa.","..AIaa.......aAIA.","..aAIa.......aIAa.","..AIAa.......aAIA.","..aAIa.......aIAa.","..AIAa.......AaIA.",".AIAIa.......AaAIA",".AAIA.........AIAA",".AIAI.........aAIA",".AAIA.........AIAA",".AIaa.........aAIA",".AA............AAA","AA.............A.A","A..............A.."],"field":"long"},{"x":4,"y":1,"rows":[".....IAIA.AAA.......","....IAAAAAAIAIA.....","...IAIAAA~AAIAIAI...","..IAAA~A..~AAAAIAI..",".IAIAA.A...AAAAAIA..","IAIAA~A....~AAAIAII.","AIAAA........~AAIAI.","IAIA~.........~AAIAI","AIAA...........AAAIA","AAIA...........AAAAA",".IAA...........AIAI.",".AAAA.........AAAIA.","..AAA.........AAA.A.","....A.........A....."],"field":"short"},{"x":5,"y":0,"rows":["........AAA......","......AIAIAAA....","....IAIAAAIAIA...","...IAy.....yAI...","...Ay.......yAI..","..AI.........IA..","..IA.........AIA.","..AI.........IAI.","...y.........y.A.","...............I.","...............A.","..A...........AIA","..IA.........AIAI",".IAI.........IAIA",".AIA.........AIAI",".IAA.........IAIA","IAIA.........AIAI","AIA...........AIA","IA.............AI","A...............A"],"field":"long"},{"x":5,"y":4,"rows":[".....IAIAIAI.....","....IAIAAAAAI....","...IA.......AI...","...A.........A...","..AA.........AA..","..A~.........~A..","..A...........A..",".A.............A.","...A.........A...","..A...........AA.","AA..............A"],"field":"short"},{"x":4,"y":2,"rows":["...AA.AII.IIA....","..A.AIIAAIAAIIA..","..AAIAAIAAAIAAIA.","...AIA~~~~~I~AIA.","..IAI~......I~IAI","..IAI.......I.IAI","..AAI.......I.IAA","...AA........IAA.",".............I...",".............I...",".............I...","...AA........IAA.","..AAI........IIA.","..III........IAI.",".I.AI.........IA.",".I.IA.........AI.","A..A...........A.","...I...........I.","...A...........A."],"field":"long"},{"x":6,"y":1,"rows":[".....AAAAIA....","...AIAIAIAIA...","..AIAAAAAAAIA..",".AIA~~~~~~~AIA.",".AA~.......~AA.","AAI.........IAA","AAA.........AAA","AAA.........AAA","A.~.........~.A","A.............A","A.............A",".A...........A.",".A...........A."],"field":"short"},{"x":8,"y":1,"rows":["..AAAAAAA..",".AA~~~~~AA.","A~.......~A","~.........~","~.........~","~.........~","~.........~"],"field":"short"},{"x":7,"y":3,"rows":["....AA.AA...","...IAIAIAI..","..A~.....~A.",".A~.......~A",".A.........A",".A.........A",".~.........~","............","............","............","............",".A.........A",".A.........A","A..........."],"field":"short"},{"x":8,"y":3,"rows":["....AIA....","..IAIAIAI..",".IAAAAAAAI.","IA~.....~AI","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":8,"y":3,"rows":["..AAAIAAA..",".AI~~~~~IA.","AIAAAAAAAIA","I~.......~I","A.........A","A.........A","~.........~"],"field":"short"},{"x":5,"y":1,"rows":[".....IAIyIAA.....","...AIAIAAAIAIA...","..AIAIAy.yAAAAI..",".AIAyAy...yAyAA..",".AAAyI.....AyAIA.","A.IA.........AIA.","..AI.........AAI.","..Iy.........yIAI","...............I.",".A.............A.",".A..............A","A.............A..","..............A..","...............A."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAIAIAIA..",".AIAy.....yAAI.",".IAy.......yIA.","AAAy.......yAIA","AIA.........AIA","AAI.........AAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","AAA.........AAA","AIA.........AIA",".AA.........AA.",".A...........A."],"field":"short"},{"x":3,"y":-1,"rows":[".......AAA.AA.A......","....A.AIAIAIAIA.A....","...AAAIAIAIAIAIAIA...","..AIAIAAAAAAAIAIAIA..",".AIAIAIAAAAAAAAAIAAA.","..AIAAA~.....~AAAIA..",".AIAIA~.......~AIAIA.","AIAIA...........AIAAA",".AIAA...........AAIAA","AAAIA...........AIAA.",".AIA.............AIAA",".AAA.............AAA.","..AA.............AAA.","...AA...........AAA.."],"field":"short"},{"x":5,"y":0,"rows":["....AA.A..A......","...AAAAIAIAA.A...",".AAAIAIAIAIAIAAA.","..AIAAAAAAAAAIA..",".AIAA~~~~~~~AAIA.","AAAA~.......~AAAA",".AAA.........AAA.","..A~.........~A..",".AA...........AA."],"field":"short"},{"x":4,"y":3,"rows":[".....IAAI~IAAI.....","...AIA~....~IAI....","..AIA~......~IAI...","..AAI........~IAA..",".AAI~.........AIA..",".AIA~.........~AIA.",".AAI...........IAA.",".AIA...........AIA.","..A.............AI.","..I.............IA.","..AI...........AAI.",".AIAA..........AI..",".IAAA.........AAA..",".AIAA.........AAIA.",".IAAA.........AAAIA","..IAA..........AI.A",".AAA...........AAA.","AI.A............AA.",".................A."],"field":"long"},{"x":6,"y":2,"rows":["....IAIAIAI....","..AIAIAaAIAIA..",".AIAI~...~IaIA.",".IAI~.....~IAI.","AAI~.......~IAA","AIA~.......~AIA","aAa.........aAa","AIA.........AIA","aAa.........aAa","AI..........AIA","aA..........aAa","AIA..........IA","aAa..........Aa","AIA.........AIA","aAa.........aAa","AIA.........AIA","aAa.........aAa","AIA.........AIA","AAa.........aAA",".AA.........AA."],"field":"long"},{"x":9,"y":3,"rows":["..yyyyy..",".y.....y.","y.......y","y.......y"],"field":"short"},{"x":8,"y":3,"rows":["..AIUIUIA..",".AAAIAIUIA.","aA~~...~~IA","A~.......~A","I.........I","U.........U","~.........~"],"field":"short"},{"x":8,"y":1,"rows":["...AIUIA...",".AA~...~AA.","AA~.....~AA","A~.......~A","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":8,"y":0,"rows":["..IAIAIAI..",".AAaAaAaAA.","AA.......AA","A.........A","ay.......ya","Ay.......yA","a.........a","a.........a"],"field":"short"},{"x":6,"y":-1,"rows":["........AIII.....","......AAIUUUI....","....AAUIUIIIUI...","...AIU...~UAIA...","..AI......~UIAA..","..A~.......IAIA..",".AI........IAUA..",".AI........~IIAA.",".AI.........UAIA.",".AA.........IAIA.","AAI.........IAIA.","AAA.........AAAA.","AA...........AAIA","AAA.........AIAIA","A.AA.......AAIAIA","A.AA.......AAIAAA",".AAA.......AAAA.A","..A........AAIA..","..A........A.A...",".............A..."],"field":"long"},{"x":6,"y":-1,"rows":["....IUUIUUI....","...IUII~UIUI...","..UUIUU.yUIUI..",".UUIUIy...~IAA.",".UIUI~.....~IA.","UIA~........UIA","UIA.........UIA","UAI.........IAA","AAI.........IAA","A.I.........I.A","AI..........IIA","AU..........IIA","AII.........IUA","IAU.........IAA",".AUA.......AUAA",".AIA.......AUA.",".AUA.......AIA.",".AAA.......AAA.","A.AA.......A..A","..A.........A.."],"field":"long"},{"x":3,"y":-2,"rows":[".........aaaA.......",".......AaaAaaAI.....","......aaaaaAaaAI....",".....AAa..~aaAAI....","....IAI....~AaIAI...","....AI......IAaIA...","...Iaa.......IAIA...","...IA~.......IIAIA..","..AIa.........IAIA..","..AIa.........IAAI..","..IAa..........AIAI.","..IIa..........IAIA.","..IAa..........IAAI.",".AIIaA.........aAIAA",".AIAIa.........aIAIA",".AaIAaA.......AaaIAI","AAAaIAa.......aaAaI.",".AaIaIa.......aAAaAI","A.AAIA.........IAAIA","..A.AAA........IIAI.","....I.I........I.I.."],"field":"long"},{"x":8,"y":3,"rows":["...AaAIAI..","..aaAIAIAI.",".a~~...~~Aa","a~.......~a","A.........A","~.........~","~.........~"],"field":"short"},{"x":8,"y":0,"rows":["..IAIAIAI..",".AAaAaAaAA.","II.......II","I.........I","U.........U","I.........I","A.........A"],"field":"short"},{"x":6,"y":-2,"rows":[".......I........",".....IIA........",".....AAII.......","...IIAIAIAA.....","..AIAIAIAIAIA...",".AIAIAy.yAAAAI..",".IAy.......yAA..","AAAy.......yAIAA","AIA.........AIA.","AAI.........AAI.","AIy.........yIAI","IA...........AI.","A.............A.","A.............A.",".A...........A.."],"field":"curly"},{"x":9,"y":1,"rows":["..AAAAA..",".A~~~~~A.","A~.....~A","~.......~","~.......~"],"field":"short"},{"x":8,"y":3,"rows":["...IA.AI...","..IAIAIAI..",".IAAAAAAAI.","IA~.....~AI","A~.......~A","~.........~"],"field":"short"},{"x":5,"y":2,"rows":[".....AIA.AIA.....","....AAAIAIIAA....","...AIAIA~AAIAA...","..AIA~A...A~AIA..",".AIAIAI...IA~AIA.",".IAI~IA...AI~IAA.","AAIAA~A...I.IAIAA",".AAA~.........AA.",".AA............AA",".A..............."],"field":"short"},{"x":5,"y":4,"rows":[".....IAIAIAI....","....IAAAAAAAI...","...IA~.....~AI..","..AA~.......~AA.","..AA.........AA.","..A~.........~AA",".AA~.........~AA",".AA...........AA",".AA...........AA",".AA...........AA","A.A...........AA","A.A...........AA","...A.........A.A"],"field":"short"},{"x":5,"y":2,"rows":[".....AIIAIIA.....","...AIIAAIAAIIA...","..AIAAIAAAIAAIA..","..AI~~~~~~~~~IA..","..A~.........~A..","..A...........A..","..~...........~..",".................",".................",".................",".................",".................","..............A..",".............AI..","..AI.........IAI.",".AIA.........AIA.","A.AA.........AAIA","A.I...........I.I"],"field":"long"},{"x":6,"y":4,"rows":[".....AIAIA.....","...IAAAAAAAI...","..IA.......AI..","..A~.......~A..","..~.........~..","..~.........~..","..~.........~..","...............","...............","...............",".AA.........A.A","A.A.........I..","A.A.........A..",".A...........A.",".A.............","A.............."],"field":"long"},{"x":5,"y":1,"rows":["....IAIA.AAA.....","...IAAAAAAIAIA...","..IAIAI~~~AIAIA..",".IAAAI....~AAAIA.",".AIAAA.....AAAAAA","AIAI~I.....A~AIA.","IAIA.A.......AAI.","AAA~.........~AAI","A.I...........AAA","A.A...........A.A",".AA...........AAA",".IAA..........AI.",".AA...........AA.","..A............A.","...A............."],"field":"short"},{"x":5,"y":-3,"rows":["....A.....A.AA....",".....AAA.AAAAAA...","...IAAAIAIAAAIA...","..IAIAIAIAIAIAI...",".IAIAAAAAAAAAIAI..",".AAAAAAAAAAAAAAAA.","AAAAAIAIAIAIAAAA..","A.AAI~~~~~~~IAAAA.","..AI~.......~IA..A",".AA...........A...","A...............A."],"field":"afro"},{"x":3,"y":1,"rows":["......IAIA.AAA......",".....IAAAAAAIAIA....","....IAIAA~~~AIAIA...","...IAAA~A...~AAAIA..","...AIAA......AAAAIA.","..AIAA~......A~AIAI.","..IAIA.......~AAAIAI",".IAIA~........A~AAIA",".AIAI.........A.AIAI","AIAIA...........IAAA",".AAAA...........AIAI",".I.IAI.........AIA.A",".A.AAA.........IAI.A","...A.I.........A.A..",".....A.........A...."],"field":"short"},{"x":5,"y":3,"rows":["......A.........","....AIAIAIAIA...","...AIAAAAAAAIA..","..AI~.......~IA.","..IA.........AI.","..AA.........AAA",".AA~.........~AA",".AA...........AA",".A~...........~I","A..............A","................","..IA.........AI.","..AA.........AA.","..A...........I."],"field":"short"},{"x":5,"y":2,"rows":[".....AII.IIA.......","...AIIAAIAAIIA.....","..AIAAIAAAIAAIA....","..AIA~~~~~~~AIA....",".IAI~.......~IAI...",".IAI.........IAI...","..A~.........~A....","..A...........AAA..","...................","...................","...................","..A...........AAA..","..A...........A..AA",".IUI.........AII...",".UUI.........IAI...","IUIA.........AIAI..","AUAA.........AAIA..","IUI...........IAI..","A.A...........A.A..","..I...........I....","..A...........A...."],"field":"long"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAAA~A.A.A~AAAI..",".AAIA~A.AA...~AIAA.","AAIAA.........AAIAA",".IAA...........AAIA","AAIA...........AIA.",".AA.............AAA",".AA.............AA.","..A.............AA.","..A.............A..","....A.........A...."],"field":"short"},{"x":5,"y":2,"rows":[".....AIAIAIA.....","...AIAaI~IAAIA...","..AIA~~~~~~~aIA..","..aA~.......~Aa..",".AAI.........IAA.",".AIa.........aIA.",".aAa.........aAa.",".AIA.........AIA.","aaAa.........aAa.","aAIA.........AIAa","aaAa.........aAIa","IAIA.........AIAI","AIAa.........aAIA",".AIa.........aIA.",".a.a.........a.a."],"field":"short"},{"x":5,"y":1,"rows":["......AAAAAA......","....AAIIAIAIAA....","...AAAAAIAIAIAA...","..AAI~~...~~AII...","..AI........~AI...","..AA.........IAA..",".AAI.........AIA..",".AIA.........AAA..",".AAI.........AIA..",".A...........AAAA.",".I...........AIAA.","AAA..........AIAI.","AIAA.........AAAIA","AIIA.........AIIAI","AAAA.........AAAI.","IIIA.........IAIA.","AIAA.........AIIA.","A.IA.........IAAAA","..AA.........A.A.I","..A..........A...."],"field":"long"},{"x":7,"y":4,"rows":["...IAIAIAI...","..IAAAAAAAI..",".IA~.....~AI.",".A~.......~A.","AI.........IA","I~.........~I","A~.........~A"],"field":"short"},{"x":7,"y":2,"rows":["...IAIAIAI...","..IAAAAAAAI..",".AAAAAAAAAAA.","IAAyyyyyyyAAI","AAy.......yAA","Ay.........yA","A...........A","y...........y"],"field":"short"},{"x":5,"y":1,"rows":["......AAAAAA......","....AIAIAIAIAI....","...AIAAAAAAAIAI...","..AIA~~...~~AIA...","..IA........~AI...","..AI.........AAA..",".AAA.........AAA..",".AIA.........AAA..",".AIA.........AAA..",".IIA.........AIAA.",".AIA.........AIIA.",".IAA.........AIAA.","AAIA.........AAIA.","AIAA.........AIAAA","AAIA.........AAAA.","AIAA.........AIAA.","A.IA.........AAA..","..A...........A..."],"field":"long"},{"x":6,"y":1,"rows":["....AAI~IAI....","..AAAIAyAIAAA..",".AAIyIyyyAyIAA.","AAIyAy...yAyIAA","AIAyA.....AAAIA","AAAAy.....yAIAA","AIAA.......AAIA","AAAA.......AIAA","AIAy.......yAIA","AAI.........IAA","AIA.........AIA",".AI.........IA.",".A...........A."],"field":"short"},{"x":7,"y":3,"rows":["...AIAA......","..AIAIAIAI...",".AIAAAAAIAI..","AIA~.....~AI.","IA~.......~A.","AA.........A.","I~.........~.","A............","I............","A............","I............","AI.........A.","IA..........I",".I..........A",".A.........AI",".A.........A."],"field":"long"},{"x":5,"y":2,"rows":[".....AII.IIU.....","...AIIAAIAAUUU...","..AIAAIAAAIUUUU..","..AAAI~~~~~UUUU..",".IAIA~.....~UUUU.",".IIA~.......~UUU.",".IAI.........UUU.","IAIA.........UUUU","AIAI.........UUUU","IAIA.........UUUU","AIAI.........UUUU","IAIA.........UUUU","AIAI.........UUUU","AAIA.........UUUU",".AAI.........UU.U","A.AA.........UU..","..A...........U.."],"field":"long"},{"x":5,"y":2,"rows":[".....ZZZ.ZZZ.....","...ZZZZZZZZZZZ...","..ZZZZZZZZZZZZZ..",".ZZAZZ~~Z~~ZZZZZ.",".ZZZZ~..ZZ.~ZZZZ.",".IZAZ....Z..ZAZA.","IAAIA....Z..AIAAI","AIZA........IAZIA","IAAI.........IAAI","AIZ...........ZIA","IA.............AI","AI.............IA",".A.............A.",".A.............A."],"field":"short"},{"x":6,"y":1,"rows":["....AA.AA.AA...","...AAAAAAAAAA..","..AAAAAAAAAAAA.","..AAA~~~~~~AAA.","...A~......AAA.","AAA~.......~A..","............A..","...............","...............","...............","...............","...............","..............A","............A..","............A..",".............A."],"field":"short"},{"x":4,"y":1,"rows":["......AIA..........",".....AAAIAIIAA.....","....AIAAAIAAAIA....","...AIAI~~~~~AAI....","..AAAA~.....AAAA...","..AAA~.......AAAA..","..IAI........AAII..","..AAA........AIIA..",".IIAI.........AII..",".AIAI.........AIAI.",".IIIA.........AIAA.","AIUAI.........AIAIA","IAIAA.........AUAIA","AIUIA.........AIIUI","IUIUI.........AUUIA","AIAIA.........IUIAI","IAIAI.........AIAIA","AIAIA.........IAIAI","I.AA..........A.A.A","...I..........I.I.."],"field":"long"},{"x":5,"y":-3,"rows":["......AaaI.......","...aAAIAaAIIIA...",".aaAIAAIAIAIAIa..","aAIAaIAaAAIAIIAa.",".aAIAIaAaIAIAAaAa","aAIAIyyyyyyyIAIaA",".aAIy.......yIAa.",".AaA.........AaA.","..aA.........Aa..","..aa.........aa..","...y.........y..."],"field":"afro"},{"x":3,"y":0,"rows":["......UAA...A........",".......AAAAAAAA......",".....UAIAUIAIUUUUU...","..UAAAAIIIAIAIUUU....","...AUUUAUAIUIAIUUU...","..AUUUAAUAAAUAAAAAU..",".UAAAAUAAUAAUUAAUAUU.",".UUIAIAA.A..A.AAIUAU.","UUUAIA.........AAIUA.",".UUIA...........AUUUU",".UUA.............AUU.",".AUA.............UUU.","..AI.............AAU.",".AIA............UUA..","..UUA...........UAUA.","...UA...........AU..."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAIAIAIA..",".AIAIAyyyAAAAI.",".IAyAy...yAyAA.","AAAyI.....AyAIA","AIA.A.....A.AIA","AAI........AAAI","AIy........AyIA","IA..........AAI","A...........A.A"],"field":"short"},{"x":5,"y":1,"rows":[".....IIAaAII......","....IIAAaIAII.....","...IAaaaaaaaAI....","..IAa~....~aaAI...","..Aa~.......aAIA..",".AaA.........aAI..",".aA~.........~aIA.",".aa...........aaI.",".A.............aa.",".A.............aa.",".A.............aA.",".Ia...........aAA.",".Ia~.........~aAI.",".IAa.........aAAI.","IAIa.........aIAI.","IIAAa.......aaAIA.","IAIAa.......aAAAII","IIAA.........A.IAI","IA.A.........A.I.A","A..A...........A.."],"field":"long"},{"x":5,"y":2,"rows":[".....AIAIAIA......","...AIAaIaIAAIA....","..AIA~~~~~~aaIA...","..aA~......aaAaI..",".AAI.......~aIAI..",".AIA........aaIAI.",".aAI........aaAIa.",".AIA........~AIA.a","aaAa.........aAa..","aAIA.........AIAa.","aaAa.........aAIa.","IAIA.........AIAI.","AIAa.........aAIA.","aAIA.........AIA..",".aAa.........aAa..",".AIa.........aIa..",".aA...........A...","..a...........a...","..a...........a..."],"field":"long"},{"x":6,"y":4,"rows":["....IAIAIAI...","...IAAAAAAAI..","..IA~.....~AI.",".IA~.......~AI",".AI.........IA",".I~.........AI",".A~.........IA","AI..........AA","A...........IA","A...........AA","............IA","..A..........I",".A...........A","............I."],"field":"short"},{"x":4,"y":4,"rows":["......IAIAIAI.....",".....IAAAAAAAI....","....IA~.....~AI...","...IAA.......AAI..","..AAI~.......~IA..",".AAAA.........AAA.","..AAI.........IAA.","..AIA.........AIIA",".AAII.........IIA.",".AIIA.........AII.","A.AIA.........IIA.","...AA.........AA.I","..AAA.........AI..","....A.........A.A.","....A.........A..."],"field":"long"},{"x":4,"y":2,"rows":["......I....IU.....",".....IAAAAAAI.....","....AAAAAAAAAA....","...AAA~.....~AA...","..AAA~.......~A...","..AA~.........~A..",".UAA..............",".UAA...........IU.",".UA..............U","UIA..............U","UUA...............",".UAA..............",".UUA..............",".U.AA.............",".U.UA.............","....A............."],"field":"short"},{"x":5,"y":2,"rows":["....IAIAAIAAA...","...IIAIIAIAIAA..","..IIA~~~~~~~IAA.","..IA~.......~IA.",".IA~.........~IA",".AI~.........~UI",".IA...........IA",".AI...........UI",".IA...........UA",".AI...........UI",".IA...........UI",".I............UI",".A.............A",".IA..........A.I","IA.A.........A.A",".I.A.........A.A","I..A..........A.","...............A"],"field":"long"},{"x":4,"y":-2,"rows":[".......AA..A.......",".....AAAAAAAAA..A..",".A.AAAIAIAIAIAAA...","..AIAAAIAIAIAIAIA..",".AIAAAAAAAAAAAIAIA.",".IAAAAAAAAAAAAAIAA.","AAIAAA~~~~~~~AAAIAA","AAAI~.........~AAI.",".AIA...........AIAA","AAAI...........AAIA",".AAA...........AAA.","..A.............A.."],"field":"curly"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAIAIAIA..",".AIAIAyyyAAAAI.",".IAyAy...yAyAA.","AAAyI.....AyAIA","AIA.A.....A.AIA","AAI........AAAI","AIy........AyIA","IA..........AAI","A...........A.A","...............",".A...........A.",".A...........A.",".A...........A.",".A...........A."],"field":"short"},{"x":3,"y":1,"rows":["....AAIAIA.AAA.......","..AIAIAAAAAAIAIAAA...",".AIAIAIAA~~~AIAIA.AA.","...IAAAA....~AAAIA..A","..IAIAA......AAAAAA..",".IAIAA~......A~AIAAA.",".A.AAA.........AAIAA.","A.AAA~.........~A.IA.",".AAAA...........AA.A.",".AAA..............A..","A.AA...............A.","..IA.................","..A.................."],"field":"short"},{"x":8,"y":3,"rows":["...AA.AA...","..IAIAIAI..",".A~.....~A.","A~.......~A","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":4,"y":1,"rows":[".....IAIA.AAA......","....IAAAAAAIAIA....","...IAIAA~~~AIAIA...","..IAAAA....~AIAIA..",".AAIAA......A~IAIA.",".AIAA~......A.AIAA.","AIAIA.......~.AAIAA","AAIA~.........~AAAA","AIAI...........AIAA","AAIA...........IAAA","AIAA...........AAAA","AAIAI.........AIAAA","A.AAA.........IAI.A","..A.I.........A.A..","....A.........A...."],"field":"short"},{"x":8,"y":3,"rows":["...IAIAI...","..IAIAIAI..",".A~.....~A.","A~.......~A","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":4,"y":4,"rows":[".....AIaAaAaAA...","....AIaAaaaaAIa..","...AIAa.....AAIa.","...IaI.......IaI.","...AIA.......AIA.","..AIA.........AIA","..AAA.........AAI","..AI...........IA",".AIA...........aI",".AAI...........aA","A.AA...........AI","..I...........a.A","....A.........a..","...I...........a."],"field":"short"},{"x":4,"y":-4,"rows":[".........A.......",".......A.A.A.....","......AIAIA.AIA..","....AAIAIAIAI....","......AIAAAIAA...","........AAAA..A..","......AIAIAIA....",".....AIAI~~~IA...","....AAAI.....IA..","....I.IA......A..","...IA.A.......AA.","..AA..A..........",".A.A...........A.","A.AA...........A.","..AAA..........A.",".AAAA.........AA.",".A.AA.........AA.",".A..A.........A.A"],"field":"afro"},{"x":4,"y":3,"rows":["......AAAA..AA.....","...AAAIAIAIAIAAA...","....AIAAAAAAAIAAA..","...AIA~....~AAIAAA.","..AIA~......A~AIA.A",".AAAA.........AAAA.","A.AA~.........~AAA.",".AAA...........AAAA","AAA~...........~IA.",".AA.............A..",".AI.............I..","A.AIA.........AIA..","...AA.........AA...","...A...........I..."],"field":"short"},{"x":8,"y":3,"rows":["...AA.AA....","..IAIAIAI...",".A~.....~A..","A~.......~A.","A~.......~A.","A.........A.","~.........~.","............","............","............","............","............","............","A.........A.","...........A"],"field":"short"},{"x":6,"y":1,"rows":["....AAAAAAA....","...AA~~~~~AA...","..AA~.....~AA..",".AA.........AA.",".AA.........AA.",".A~.........yA.",".A...........AA","A.............A","A.............A","A.............A","AA...........AA",".AA.........AAA","A.A.........A.A",".AA...........A",".A..........AA."],"field":"short"},{"x":2,"y":0,"rows":[".....AAA.............","...IAIAIAIA.AAA......","..IAIAIAAAAAAIAIA....","AIAAAIAIAA~~~AIAIA...","...AIAAA~....A~AAIA..","..AIAIAA.....A.AAAA..",".AIAIAA~.....~A~AIAA.","..AIAAA.......A.AAIA.",".A.A.A~.......A.~AAI.","...A.A...........AAAA",".....A...........AAAA",".....A...........AA.A","....AAA.........AAA..","...AA.A.........AAA..",".....AA.........A.A..","....A.A.........A...."],"field":"short"},{"x":5,"y":1,"rows":[".....AAIAIAI.....","...AIAIAyAIAIA...","..IAAAy..yAIAIA..",".AAAIy....yAAAIA.",".AIAA......IAAAAA",".AIAy......yIAIA.","AIAA........AIAAA","AAIA........IAIAA","AIAI.........IAIA","IAIA.........AIAI","AIAI.........IAIA","IAIA.........AIAI","A.AI.........IAAA","A.AA.........AA.A",".AAA.........AAA.","..AA.........AA.."],"field":"short"},{"x":7,"y":3,"rows":["....IAIAI....","..AIAIAIAI.I.","IAIAAAAAAAIAI",".AA~.....~AI.","IA~.......~AI","AA.........AA","A~.........~A","A...........A"],"field":"short"},{"x":5,"y":1,"rows":[".....IAIAIAA.....","...AIAIAIAIAIA...","..AIAIAyyyAAAAI..","..IAIAy...yAIAA..",".AAAII.....AIAIA.",".AIAIA.....AIAIA.",".AAI.I.....I.AAI.","AAIA.........AIA.",".IAA.........AAI.",".A.A.........A.A.",".I.............I.",".I.............I.","I...............I"],"field":"short"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAA~.......~AAI..",".AAI~.........~IAA.","AAIA...........AIAA",".IAA...........AAI.","..IA...........AI..","...A...........A..."],"field":"short"},{"x":8,"y":1,"rows":["...IAIAI...",".AIAIAIAIA.","AZAZAZAZAZA","Z~.......~Z","~.........~","~.........~"],"field":"short"},{"x":6,"y":2,"rows":["....aAAaAAa....","..aAAaaAaaAAa..",".aAaaAaaaAaaAa.",".aAaA~~~~~AaAa.","AAAa~.....~aAAA","AaA~.......~AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","aAa.........aAa","AaA.........AaA","IAI.........IAI","AIA.........AIA","IUI.........IUI",".I...........IU","..............I"],"field":"long"},{"x":5,"y":0,"rows":["......IIIIII.....",".....AAIAIAAII...","...IIAIAIAAIIII..","..IIAA~IIAIAAIAI.",".IIAA~...IA~AAIA.","IIAA~.......IIAAI","IAIA........~AIAA",".IA~.........~AAA",".AAA..........AA.","AAA............A.","AA.............AA","AA.............AA",".AA...........AA.","..A...........A.."],"field":"short"},{"x":8,"y":-1,"rows":["..IIIIIII..",".AAIAIAIAI.","AAIAIAIAIAA","AyyAAIy.yAA","I........yI","A.........A","I.........I","A.........A"],"field":"short"},{"x":7,"y":-3,"rows":["......AAIAIA....","....AAAIUIUIA...","...AIAIUIAIAAA..","...IAIUIAIAIAA..","....AAIUIUIA....","...AAAAAAIAIA...","..AAIAIAIAAAIA..",".IUIAIAIAIUI..AA",".AI......~IA....","AI~.......~IA...","AI.........IA...","A~.........~A...","A...........A..."],"field":"afro"},{"x":8,"y":1,"rows":["....~~~....","..~~~~~~~..",".~~.~~~.~~.","~.........~","~.........~","~.........~"],"field":"short"},{"x":5,"y":0,"rows":["....A....A........","....A...A.........",".....AAAAAA.A.....","...AAAIAIAIAAA.A..","AAAIAIAIAIAIAIA...",".AIAIAAAAAAAIAAA..","AAAIA~.....~AIAAA.",".AIA~.......~AI..A","..AA.........AA...","..A~.........~A...",".A.~.........~...."],"field":"short"},{"x":5,"y":-1,"rows":["......AAA........","....AAIAIAAAA....","...AAIAIAAAIAA...","..AAIAIIAAIAIAA..",".AAAA~~..~AIAAAA.",".AIA~......IIAIA.",".AAI..........AA.","AAI...........IAA","AAA...........AAA","AAA...........AAA","IA.............AI",".A.............A.",".A.............A.","AIA...........AAA","AAA...........AA.",".AA...........AAA","..............A.."],"field":"short"},{"x":8,"y":0,"rows":["..AIIAIAI..",".AIaAIAIaA.","aaA~~yaaAaA","aA~...~~aAa","A~.......~A","a.........a","A.........A","a.........a","~.........~"],"field":"short"},{"x":6,"y":2,"rows":["...IAIAAIAAA...","..IIAIIAIAIAA..",".IIA~~~~~~~IAA.",".IA~.......~IA.","IA~.........~IA","AA~.........~AI","AA...........AA","AA...........AI","A.............A","..............A","..............A",".I...........I.","..I.........IA.","............A..","...............","............IA.","............A.I"],"field":"long"},{"x":7,"y":0,"rows":["......AIAI...","...IIAIAAAI..","..IIAIAIAAAI.",".IAAIAAyyyAAI",".AAyyy....AIA","IAy.......yAI","AI.........IA","IA.........AI",".A.........A.",".y.........y."],"field":"short"},{"x":6,"y":-1,"rows":[".....Aa..a.....","..I.AaAaAI.I.I.",".AaAaAIAIAIAaI.","AaAIAIAIAIAIAaA",".AaAaAaaaAAAaA.",".IaA~~~~~~~aaI.","..A~.......~A..","..A.........A..","..~.........~.."],"field":"short"},{"x":4,"y":2,"rows":["........AA.A.......",".....AAaAIAaa......","....AaaAaAIAIAA....","...AAIA~~~~~AIAI...","..AaIA~.....~AIA...","..AAA~.......~aaA..","..AaA.........aAa..",".AIa~.........~AA..",".IA.............aA.",".AA.............aa.","IAI.............aAa","AIA.............aAI","IAIa...........aaII","IIAa...........aaAI","IAIa...........aAIA","AIAa...........AaAI","IAaA...........aAaa",".Aaa............aA.","...A............A.."],"field":"long"},{"x":5,"y":-1,"rows":["...........A......",".....IAA.AAIA.....","..AAAAIAIAIAIAAA..",".A.AAIAIAIAIAIA.A.","...AAAIAAAAAIAAA..","..AAA~.....~AAA...","..AA~.......~AAA..",".AAA.........AAAA.",".AAA.........AA..A",".AAA.........AA...","IA.A.........A.A..",".A.~.........~.IA.","IA.............A..","..I...........AAA.",".IAA.........IAI..","..IA.........AA..."],"field":"short"},{"x":7,"y":0,"rows":["....AAAAA....","..AIAIAIAIA..",".AI.yIIIy.IA.",".Iy.......yI.","AA.........AA","AI.........IA","AI.........IA","AA.........AA",".y.........y."],"field":"short"},{"x":5,"y":2,"rows":["....A....A........",".....AIAIAIA.A....","...AAIAIAIAIAI....",".AIAIAAAAAAAIAI...","..AAA~....A~AIAA..",".AIAA....A..AAI...",".AAA~.......~IAI..","IAIA.........AIA..",".IAA.........AAIA.",".A.A.........A.AIA","AI.............AA.",".A.............AI.",".AA...........AI..","..AA.........AAAA.","..AA.........AAA..","..AA.........AA..."],"field":"short"},{"x":4,"y":1,"rows":["......IAIAAII.A.....","...AAIAIAAIAAI......","....IAAAAAAAIAI.....","...AIA~.....~AAA....","...AA~.......~IA....","...AA.........AA....","..AAA.........AAA...","..AAA.........IIA...","..A.............A...","..I.............A...","..I.............IA..","..AA...........AIA..","..AIA.........AIA.A.","..AII.........IAIA.A",".AIAI.........AIAI.A",".AAIA.........AAIAA.","AAIAI.........IIIA..","AIAIA..........IAIA.",".IIA...........I.A..","A.A............A...."],"field":"long"},{"x":4,"y":1,"rows":[".....IAIAAAAA......","....IAAAAAAIAIA....","...IAIAA~~~AIAIAA..","..IAAA~....~AIAIAA.","..AIAA......A~IAI.A",".AIAA~......A.AIAA.",".IAIA.......~.AAIA.",".AIA~.........~AAI.","AIAI...........AIAA","AAIA...........IAIA","AIAA...........AAAA","AAIAI.........AIAIA","AAAAA.........IAIAA",".AIAI.........AAAA.",".AAAA.........AAIA.","A.AAA.........AAAAA","...A...........A.A."],"field":"short"},{"x":5,"y":1,"rows":[".....AAAAAAAA....","....AIAAIUIUII...","...AIAIAAIAIUUI..","..AIA~.....~AUU..","..IA~.......~AUI.","..AI.........~UU.",".AIU..........IU.",".IUU..........AUI",".UU~..........AUU",".U.............UI","UU.............UU","UUA............UI","UUUA..........AUU","IUUA..........AUI",".UIA..........AUU",".AIA..........AAI","..AA..........AAA","...A...........A."],"field":"long"},{"x":8,"y":3,"rows":["..aAaAIAI..",".aaIAaAIAa.","aA~.....~Aa","A~.......~A","a.........a","A.........A","~.........~"],"field":"short"},{"x":6,"y":3,"rows":[".....IAI.A.....","...AIAIAIUIA...","..AUAAIUAIUIA..",".AUI~......AIA.","AIA~.......~AU.",".AI.........IAI","AI~.........~AA",".I...........I.",".A...........A."],"field":"short"},{"x":8,"y":-1,"rows":["...AIAIA...",".AAIAIAIAI.","AAAAIAIAIAI","IAy.yIAIAAA","Ay...yyy.yI","I.........A","A.........I","y.........y"],"field":"short"},{"x":4,"y":1,"rows":["........AA.A.......",".....AAIAIAIAA.....","....AAAAIAIIAI.....","...AAAI~~~~~IAI....","...AAA~.....~IAI...","...AI~.......~AI...","...AA.........AI...","..IAI.........AIA..","..IAI.........AII..",".AIAI.........~IA..",".IIIA..........IAA.",".IUAI..........IAI.",".AIAA.........AUAI.","AIUIA.........AIIUI","IUIUA.........AUUIA","AIAIA.........IUIAI","AAIA..........AIA.A","A.AI..........IAI.A","..AA..........A.A..","...I..............."],"field":"long"},{"x":4,"y":1,"rows":["........AA.A.......",".....UAUAUAUAa.....","....UAUAUAUUUA.....","...UAUA~~~~~AUA....","...AUA~.....~AUA...","...UU~.......~Aa...","...AU.........aA...","..AUA.........AUa..","..UAa.........aUA..",".aAUA.........AUa..",".AUAa.........aAaa.",".AIaA.........aAaA.",".aAaa.........AUaA.","aAIAa.........aAAUA","AIAIa.........aUUAa","aAaAa.........AUAaA","aaAa..........aAaaa","aaaAa.........AaA.a",".aaa..........a.aa.","aa.A...........a..a","..a.a...........a.."],"field":"long"},{"x":5,"y":1,"rows":["...A..............","....AA.AA.A.A.....",".AIAIAAIAIAIAI.A..","..AIAAAAIAAAIAIA..",".AIAI~.....~AIAI..",".IAI~.......~AAAA.","IAA~.........~IAA.","AIA...........IA.A","AAA...........AA..",".A.............AA.","AA.............A..",".A.............A.."],"field":"short"},{"x":7,"y":1,"rows":["...UUUAAAA...","..UUUUUAAAAA.",".UUUUUAAAAAUA",".UUAUyUAUAUU.","AUAU.U.AUyAUU","AAyU....U.yAA","AA......y..AU",".A.........A.",".y.........y."],"field":"short"},{"x":4,"y":4,"rows":["......II..III.......",".....IIAAIAAII......","....IIA~...~AII.....","...AIA~.....~AIA....","...IU~.......~AI....","..IAA~.......~AAI...","..IAI.........IAI...","..IAA.........AAA...",".AIAI.........IAIA..",".AAAU.........AAUA..",".AIAI.........IAUI..",".AAIA.........AAUI..",".AIUI.........IAUU..",".IAUU.........UAAU..","AAIIU.........UIAUA.","AIAU...........UA.A.",".A.I............I..A"],"field":"long"},{"x":8,"y":3,"rows":["...IAA.....","..IAIAIAI..",".IAAAAAAAI.","IA~.....~AI","A~.......~A","A.........A","~.........~","~.........~"],"field":"short"},{"x":7,"y":3,"rows":["....IA.AI.......","...IAIAIAI......","..IAAAAAAAI.....",".IA~.....~AI....","AA~.......~A....",".A.........I....",".A.........I....","............I...",".............A..",".............I..",".............AA.","...............A"],"field":"short"},{"x":8,"y":3,"rows":["...AA.AA......","..IAIAIAI.....",".A~.....~A....","A~.......~A...","A~.......~A...","A.........A...","~.........~...","..............","..............","..............","..............","...........A..","............AA"],"field":"short"},{"x":7,"y":0,"rows":["...AAAAAAA......","..AAAAAAAAA.....",".AAAAAAAAAAA....","AAA~.....~AAA...","AA~.......~AA...",".A.........A....",".~.........~....",".~.........~....","................","................","................","................","A...........AA..","AA.........AAAA.",".A.........AAA.A","...........AAAA.","...........AAA.A"],"field":"short"},{"x":3,"y":1,"rows":["......IAIIAIAIA....",".....AIAIAIIAIAA...",".....IA~~~~~~~IA...",".....A~.......~I...",".....~.........~...",".....~.........~...","...................","...................","...................","...................","....AA.............","....AI.........A...","...AIA.........AI..","..AIAI.........IAIA",".AAIA...........A..",".AI................","AA................."],"field":"short"},{"x":6,"y":0,"rows":["......AAAA.....","...AIAIAIAAA...","..AIAIAyAIAIA..",".AIAy.....yAIA.",".IAy.......yAI.","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","IAI.........IAI","AIA.........AIA","AAI.........IAI","A.A.........A.A","..I.........I.."],"field":"short"},{"x":3,"y":3,"rows":[".......AIAA.AA..","......AIAIAIAIA.",".....AIAAAAAAAA.",".....AA~.....~AA",".....A~.......~A",".....A.........A",".....~.........~","................","................","................","...A............","..AA............","..A.A...........",".AIAA...........","AIAIA...........","IA.............."],"field":"long"},{"x":6,"y":0,"rows":["....AAA.AAA.......","..AAIAAAIAIAA.....",".AAIAIAIAIAIAA....",".AIA~.....~AIA....","AIA~.......~AIA...","AA~.........~AA...","AI...........IA...",".A...........A....","..................","..................","..................","..................","............AIA...","............AAIA..","............AIAIA.","..A.........AAIAIA",".AA.........AAA..."],"field":"short"},{"x":5,"y":2,"rows":[".....aaa.aAa......","....aaaaaAaAaA....","...aAa~...~aAaA...","..aAa~.....~aAa...",".AAI~.......~aAA..",".aIa~.......~aIa..",".aAa.........IAaA.","aaIa.........AIaA.","AIA...........AaA.","IaI...........IaI.","AaA...........AAAa","IAI...........Ia.A",".a.............A.a",".A.............A.."],"field":"short"},{"x":8,"y":2,"rows":["..AAIAI.I..",".AAIAIAIAI.","AA~AIAIAIAI","A~...~~AAIA","A.......~~A","A.........A","I.........I","~.........~"],"field":"short"},{"x":5,"y":-2,"rows":[".....AAAAAAA.....","....AIUIUIUIA....","....AIIUIUIUA....","......AAAAAA.....","....AAIAIAIAA....","...AIIUIUIUIIAA..","..AII..UIU..II.A.",".AAI~.......~IA..","A.AI.........IAAA",".AAI.........IAA.","AAA~.........~AA.",".A.............AA",".A.............A.",".A.............AA",".AA............A.","..A...........A..",".A.............A.","..A.............."],"field":"curly"},{"x":8,"y":-5,"rows":[".....I......",".....AIIUIA.","..AIAIIAIAAA",".A..UAUIIA.I","...AUAIAIIA.","...IAIAAA...",".AAAIUIAIA..","..IAAAAAA.A.",".AA~...~AA..","AA~.....~AA.","A~.......~A.","~.........~.","~.........~."],"field":"curly"},{"x":6,"y":3,"rows":[".....AA.AA...","....IAIAIAI..","...AAAAAAAAA.","..AA.......AA","..A~.......~A","..A.........A","..~.........~",".............",".............",".A...........","AA...........",".A...........","AAA..........",".AA..........","..A.........."],"field":"short"},{"x":8,"y":3,"rows":["...AA.AA.....","..IAIAIAI....",".A~.....~A...","A~.......~A..","A~.......~A..","A.........A..","~.........~..",".............",".............",".............",".............","..........AA.","..........A.A","..........AA.","A..........AA","..........A.."],"field":"long"},{"x":3,"y":2,"rows":[".......IIIIIII......","......IUIUIAAII.....",".....III~I.A~AAI....","....AUAU.U.A.~AIA...","....II~I.I.I..~AI...","...IUU~.IU.U..~AAI..","...UII..A..A...AAI..","..IIUI....A....IAA..",".UAUIA.........IAIA.",".IAIUI.........UAAA.","I.AAIA.........IAIAA","..AIUI.........UAAIA","..IAIA.........IAIAA","..UIUI.........UAAIA","..IAIA.........IAIA.","..A.UI.........IAAA.","..A.IA.........AA..A"],"field":"long"},{"x":4,"y":-1,"rows":[".............AA.....","............A.......","...A..AIA.IAIA......","....AAIAIAAIAAA.....","...AAIA~~~~~IAAA....","...AIA~.....~IAIA...","..AIA~.......~IAI...",".AIAA.........AIAA..","A.AIA.........AAI.A.","..AA...........IAA.A",".AAI...........AIA..","A.AA............A...","..AA............IA..","..IA............A...","..A................."],"field":"short"},{"x":8,"y":1,"rows":["...IAIAI...","..IAIAIAI..",".AAAAAAIAI.","AAyyyyyyyAA","Ay.......yA","I.........I","y.........y","y.........y"],"field":"short"},{"x":6,"y":1,"rows":["....AUA.AUU....","...UUAAAAUAU...","..UIUI~~~~IUU..",".UUAUA....~UIU.",".AUAU~.....UAU.","UAU~U......UIAU","AAU........U.IU","UAU~.........AU","A.............A"],"field":"short"},{"x":5,"y":2,"rows":["..........A......",".....AIAIAIA.....","....AIAIAIAIA....","...AIAAAAAAAIA...","...IA~.....~AI...","...A~.......~A...","...A.........A...","...~.........~...","...~.........~...",".................",".................",".................",".............U...","..A..........I.U.",".UIA.........UU..",".U.U..........U..",".UUU.........U.U.","U.UI.........UU.U","..UA..........UU."],"field":"long"},{"x":4,"y":1,"rows":["......IIIIIII......","....AIUUUUUUUAI....","...IIAIIUUUIIAIA...","...IAIUUUUUUUIIA...","...IIUIIIIIIIUAI...","..IAII~~~~~~~IIAI..","..IIA~.......~IIA..","..IAI.........IAI..","..AIA.........IIA..",".AIAI.........IAIA.",".AAIA.........IIAI.",".AIAI.........IAIA.",".IAIA.........AIII.",".IIAI.........IAIA.","AIAIA.........AIAIA","AAIII.........IAIAA","AIAIA.........AIAIA","AAIAI.........IIIAA","AIAIA.........AIAIA","AAIAI.........IAIAA",".AA.A..........A.I."],"field":"long"},{"x":8,"y":2,"rows":["........AA.","..AA.A.IAA.",".AIAIAIAIAA",".AAAAIAAAA.","AA~.....~AA","A~.......~A","A.........A","~.........~"],"field":"short"},{"x":5,"y":3,"rows":["......IAIAI......","....AIAIAIAI.I...","..IAIAAAAAAAIAI..","...AA~.....~AI...","..IA~.......~AI..","..AA.........AA..",".AA~.........~AA.",".AA...........AA.","AA.............A.",".A..............A",".................","..A..............",".A..............."],"field":"short"},{"x":6,"y":4,"rows":["....IAIAIAI....","...IAAAAAAAI...","..IA~.....~AI..",".AA~.......~AA.",".AI.........IA.","AI~.........~IA","AA~.........~AA","AA~.........~AA","...............","...............","...............","...............","............A..","............AA.","............AAA",".............AA",".............A."],"field":"long"},{"x":6,"y":3,"rows":[".....AA.AAA....","...AIAIAIAIA...","..AA~~...~~AA..",".AA~.......~AA.",".AA~.......~AA.","AA~.........~AI","IA...........IA","UA...........AI","IA...........IU","UA............I","IA............U","UAA............",".I.............",".U............."],"field":"short"},{"x":6,"y":1,"rows":["AAI.II..A........",".AAIAAIAIAI.AA...","..AAAIAIAIAAA....","IAAAIAIAIAIAIAA..",".IAIAAAAAAAIAIAA.","..AA~.....~AI.IA.",".IA~.......~AI.IA",".AI.........AA.AI","AI~.........~A.IA",".A~.........~A.A.","..~.........~....","..~.........~...."],"field":"short"},{"x":4,"y":-4,"rows":[".......AAA......",".....AAAIAA.A...","......AIAIAI....","....AAIAIAIAIA..",".....AAIAAAIAA..",".....AIAIAAAIAAA","....AIA~~~~~AAA.","...AAA~.....~AAA","..AAA.........AA","AA..A.........A.","....~.........~.","....~.........~."],"field":"afro"},{"x":5,"y":3,"rows":[".....AIA.AIA....","....AIAIAIAIA...","...AIAAAAAAAIA..","...IA~.....~AIA.","...A~.......~A.A","...A.........I.A","...A.........IA.","..AA.........AI.",".A.............A","A..............."],"field":"short"},{"x":7,"y":0,"rows":[".....AAAA......","...AAAAAAAAA...","..IAIAIAIAI....",".IAIAIAIAIAI...",".AAAAAAAAAIAI..","AA~......~AIAI.","A.........~AIA.","A..........AAIA","~..........~IAI","............A..","............I..",".............A.",".............A.","...............","............A..","...........AA..","...........A.A."],"field":"short"},{"x":6,"y":2,"rows":["...UAUUUUUU....","..UUIAAIAAIIA..",".UUAAIAAAIAAIU.",".UUAI~~~~~IAIU.","UUIA~.....~AIUU","UUI~.......~IAU","UAI.........IAU","UA...........AI","U.............I","U.............U","...............","...............",".A...........A.",".A...........A."],"field":"short"},{"x":4,"y":0,"rows":["......AAAA.........","....AIIIIAAII......","...IIIUUUUAIUI.....","...IIUIIUIIAIUA....","..AIIIUUUUUIAIIA...","..IAIUIIIIIIAUIIA..",".AAIII~~~~~~~AIAA..",".AIAA~.......AAIAI.",".IAI~........I~IIA.",".AIA.........A.IAA.",".AAA.........AUAIA.",".AIA..........UAAIA",".AUI..........UAIAI","AAUA..........AIAIA","AIUIA.........IAAAU","AAUAA.........AIAIA",".IUIA.........UAAAU",".AUUA.........AUAUA","AI.UA.........UA.AI",".A.AA.........AA.I."],"field":"long"},{"x":5,"y":1,"rows":["......IAAAII.....","....IIAAAIIAI....","...IAaaAaAaIAI...","..IAa~....~aIAI..","..IA~.......aAI..",".IAA.........aAI.",".Ia~.........~aII","IAA...........AA.","IIA...........AIA","IA.............a.",".I.............AI","IA.............I.",".Ia...........aA.","IAA...........AI.",".IAa.........aaAI",".AIA.........aAI.",".IAa.........AaA."],"field":"short"},{"x":3,"y":0,"rows":["....AI..AAAAII..........","...AIAIAIAIAAAIA........","..AI.IAAAAAAIAAIAI......",".AI.IAIAA~~~AIAAIAI.....",".AAIAAA~....~AAIAAAA....","..IAIA~.......AAAAAAI...",".IAIAA........~IA.AAA...",".AIAAA.........AAA.AI...","AI.IA~.........IAA.AAI..","IA.AA..........AA.AAIAA.","AI.I...........I..AIA.IA","AA.AI..........A..IA...I",".A.AAI.........I..AIA..A",".AAA.A.........A..I..IAI","..IA.............AA.IA..","...I.I.........A.AA..I..","....IA.........AAA......","...AAI..........AA......","....AAA........AA.......",".....AA........A........"],"field":"long"},{"x":7,"y":0,"rows":[".....III.....","..IIIIIIIII..",".AIAIAIAIAIA.",".IAIAIAIAIAI.","AAy.yAAAy.yAA","AI.........IA","AA.........AA","AI.........IA",".A.........A."],"field":"short"},{"x":5,"y":0,"rows":[".....AAA..AA.....","...AAAIAAIAIAIA..","....AIAIAAIAAA...",".AAAIAI~~IAIAAA..","..AIA~A..AI~IAIA.",".AIAI.I...A.AIA.A","..AIA.....A.IAIA.",".AIA.......A.AAI.",".AA...........IA.","AAI...........AI.",".I.............AA","IA.............IA","I.A...........AAA","..AA.........AA.A","..A..........A.A."],"field":"short"},{"x":4,"y":-1,"rows":["......I.I...........",".....IAAAA..AIAIAI..","...AAAIAIAIAIAAA....",".AAAAIAIAAAIAIAAA...","A.AIAAyy...yyAIA....",".AAAAy.......yAIA...","..AIA.........AAAA..",".AAAA.........AAAIA.","AAAIA.........AIAAA.",".AIAA.........IAIAAA",".IA.A.........A.AA.A","AAI.............AI..",".IA.............IA..",".AIA...........IAA..",".A.IA.........IA.A..","...AI.........AA....","....A.........A....."],"field":"short"},{"x":7,"y":-5,"rows":[".....A.a.....","....A..aA....",".a..aAaA.....","..aaAaAaA....","..aAaaaaa....",".aaaAaAaAa...","..aAaAaAaAa..",".aAaaa~aaaAa.","aAa~.....~aAa","Aa~.......~aA","a~.........~a","A~.........~A","a...........a","A...........A","a...........a"],"field":"curly"},{"x":3,"y":1,"rows":[".......AAA.AAA......",".....IAIAI~IAIAA....","....IAIAIA~AIAIAA...","...IAIA~~~.~~~AIAA..","...IIA.........AIAI.","..IIA...........IA.I",".A.II...........AI..","I..AA...........AAA.","...A.............A.A","..AA.............IA.",".AAI.............AI.",".A.A.............AA.","..AIA...........AIAA","...AAA..........IAI.","..AIAA..........AI.A",".A.AIA..........AAA.","....A............A.."],"field":"short"},{"x":3,"y":1,"rows":[".......aAA.Aaa.......",".....aaAaaAAaaaa.....","....aAAa~...~aAaa....","...aaAa~.....~aAaa...","..aAAI~.......~aAAa..","..AAIA~.......~aIAA..",".AAIAA.........IAIAA.","..IAIA.........AIAI..",".AAIAA.........IAIAA.",".AIAIA.........AIAIA.","A.AaAa.........aAAA.A",".AIAaa.........aaAIA.",".AAaAa.........aAAA..","..I.aa.........aaAIA.","....Aa.........aa.A..",".....a.........a....."],"field":"short"},{"x":5,"y":-2,"rows":[".....I...A........",".....AI.I...A.....","..AIAIAAAI.A..A...",".A..IAIAAAAAIA....","...AAIAIAIAIA..A..",".AIAAAIAIAIAIAI...","A.AIAIAIAIAIAIAI..",".AI.IAIAAAIAAAAAI.",".I.I~I......~IA..A","...A.A.......A.A..","...IA........I.A..","...AI........A....","...~A........~....","....A............."],"field":"curly"},{"x":6,"y":4,"rows":[".....AIAIA....","...IAAAAAAAI..","..IA.......AI.","..A~.......~A.",".A~.........~A",".A~.........~A",".A~.........~A","..............","..............","..............","A............A","A.A.........IA","A.A.........AA",".A...........A","AA..........A.","A.A.........A.",".............A"],"field":"long"},{"x":5,"y":1,"rows":[".....IAIAIAA....","...AIAIAIAIAIA..","..AIAIAIyAAAAAI.","..IAIAyA.AyAIAA.",".IAIII.I.A.IIAIA",".AIAIA.A...AIAIA",".IAIAI.A...I.AAI","AAIAI......A.AIA",".IAAA........AAI",".A.A.........AIA",".I.A.........AAI",".I.A.........AII","..............A.","..............I.","...A..........A.","...A............"],"field":"short"},{"x":7,"y":3,"rows":["....IAIAI....","..AIAIAIAIA..",".AIAAAAAAAIA.",".I~.......~I.","AI.........IA","A~.........~A","I...........I","A...........A"],"field":"short"},{"x":6,"y":-1,"rows":[".......IIII....","....IIAAAAIA...","...IAIAIAIAIA..","...AIAIAAAIAA..","..AIAIAAyAyAA..","..AAA.A.A.AyA..","..Ay........A..","..I.........I..","..A.........A..","..y.........y..","...............","..............A",".A...........AI","AAA.........AIA",".IA.........AA.",".AA.........IA.","..A.........A.."],"field":"short"},{"x":5,"y":1,"rows":[".....AIA.AAA.....","....AAAAAAAAA....","...AIA~~~~~AAA...","..AAA~.....~AIA..","..IAI.......IAI..",".AAI~.......AIAI.",".AIA.........AIA.",".AAI.........IAI.","AA...........AIAA","A............IAIA","A............UIAA","I............IAIA","A.I..........UIUI","I.AI.........IAIA","U.IA.........AIUI","I.AA.........IAIA","..AA.........AI.I","..............I.."],"field":"long"},{"x":5,"y":1,"rows":["......AA.A.A....","....AIAIAIAIA...","...AIAAAAAAAIA..","..AIA~~~~~~~AIA.","..AA~.......~AA.","..AI.........IA.","..AA.........AA.","...A.........A..","...~.........~..","................","................","................",".............IA.","...A.........AI.","..AI..........AI","..UA.........A.A",".I...........IAI","U............AI."],"field":"long"},{"x":4,"y":1,"rows":["......IAIA.AA......","..AAAIAIAIAIAIA....","...AIAIAIyAAAAAI...","..AIAIAyA.AyAIAAA..",".AIAIIIAI.A.IIAIA..","A.AIAIA.A.A.AIAIAA.",".AIAIA......I.AAIA.",".AAIA..........IAA.",".AIAA..........AIAA",".IA.A...........AA.",".AI.............IA.","A.I.............I.A","..A............AAA.","..A.A.........A.A..","....A.........A...."],"field":"short"},{"x":4,"y":1,"rows":["......IAIAIAA......","....AIAIAIAIAIA....","...AIAIAy.yAAAAIA..","...IAyAy...yAyAA...","..AAAyA......yAIA..",".AAII.........AIA..","..AAy.........yAI..","..AI...........IA..","..IA...........AI..",".AA.............AA.",".A...............A.",".A.A...........A..A","A..A...........A...","....A.........AA...","...............A..."],"field":"short"},{"x":5,"y":1,"rows":["......AAAAIA.....","....AIAIAIAIA....","...AIAIIIIIAIA...","..AIIAIUUUIIIIA..",".AAIAIIIUIIIAIAA.",".AAIAIIIIIIIAIAA.","AAAAI.......IAAA.","AAAA.........AAAA",".A.A.........A.A.",".A...........A.A.","AA.............A.",".AA............A.",".AA............A.",".A.............A.",".A............A.."],"field":"short"},{"x":7,"y":3,"rows":["....IAI.IA...","..AIAIAIAIA..",".AIAIAIAAAIA.",".IAAAI~~A~AI.","IA~~I....A~AI","AA.A......AAA","A~.........~A","A...........A","A...........A"],"field":"short"},{"x":4,"y":1,"rows":["......AUAaAaA.......","....UAUAUaaAaAA.....","...UAUyyAUyyAUAA....","...AUy......yAUA....","..Aaay.......yAUA...",".AaAa.........AAU...",".aaay.........UAA...","..aAy.........AUUA..","..Aa..........AaAU..",".AUa..........aAaA..",".UAa..........yaAaA.","UAaa..........yaaAU.","AUAa...........aAaA.","UAaAa.........aaaA.A","AaAaa.........aaAa..",".AaAa.........aaaaa.",".aa............a.a..",".a.a............a..."],"field":"long"},{"x":4,"y":-2,"rows":[".......AA..A.......",".....AAAAAAAAA..A..",".A.AAAIAIAIAIAAA...","..AIAAAIAIAIAIAIA..",".AIAAAAAAAAAAAIAIA.",".IAIAAA~~~A~AAAIAA.","AAIAA~.....AA~AAIAA","AIAA~.......A.~AAI.",".AIA...........AIAA","AAAA...........AAAA","AA...............AA","AA...............AA",".A...............A.",".AA.............AA.","..AA...........AA..","...A...........A..."],"field":"curly"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAAAAAAAAAIAA.","..IAAA~AA.A.AAAAI..",".AAIA~.A...A.AAIAA.","AAIAAA....A.A.AAIAA",".IAAA.....A...AAAIA","AAIAA.........AAIA.",".AA.~.........~.AAA",".AA.~.........~.AA.","A.A.............AAA","..AA...........AA..",".A.AA.........AA...","....A.........A.A.."],"field":"short"},{"x":7,"y":0,"rows":["...AIIAIUI...","..AAIUIAIUI..",".AAIAIUIUIAA.",".AIAIUIyyyIAA","AAAy......yIA","IUy........UI","UI.........IU",".A.........A.",".A.........A."],"field":"short"},{"x":5,"y":1,"rows":[".....AII.IIA.....","....AIAAIAAIA....","...AIAIAAAIAIA...","...AI~~~~~~~IA...","...A~.......~A...","...~.........~...","...~.........~...","...~.........~...",".................",".................",".................",".I.............A.",".IAA.........AIA.",".AII.........IAU.","AIAI.........AUI.","IUIU.........AIUI","U.U...........I.U"],"field":"short"},{"x":7,"y":3,"rows":["....AAIAA....","..AIAIAIAIA..",".AIAAAAAAAIA.",".IA~.....~AI.","AA~.......~AA","AA.........AA","A~.........~A","A...........A"],"field":"short"},{"x":4,"y":1,"rows":[".......AAAAAA.......",".....AAIIAIAIAA.....","....AAAAAIAIAIAA....","...AAI~~...~~AIIA...","...AI~.......~AIA...","..IAA.........IAA...","..AAI.........AIAA..",".AAIA.........AAAA..",".AAAI.........AIAI..","AIA.............AAI.",".II.............AII.",".AA.............AAA.",".AAA...........AAIA.",".AAIA.........AAAAA.",".AAAA.........AIAI.I","IIAIA.........IAIA..",".AAAA.........AIAA..",".A.AA.........IAAA..","...AA.........A.A.A.","...A..........A....."],"field":"long"},{"x":3,"y":0,"rows":[".......A...AA.A.....","....A.AA.AAIAAA.A...","....AAAAAIIIIAIAA.A.","..AAAIAIAAAAAAAAIA..","...AIAIAAIAIAIAAAIAA","AIAIAI~~.~.~.~~IAAA.",".AIAII.........AIIAA","AAAIA~.........~IAIA",".AIAA~.........~AAA.",".AAIA...........AAAA","..AAA...........AAAA",".AAA.............AA.","..AA.............AA.","...A.............A..","..AAA...........AAA.","...AAA.........AA...","...A.A.........A.A.."],"field":"short"},{"x":7,"y":-1,"rows":["....A.A..A.A.","...AAIAAAIA..",".AAAAAAAIAIAA","..AIAIAIAIAA.",".AIy.y.yyyIAA",".Iy.......yIA","AA.........AA","AI.........IA","AA.........AA",".A.........A.",".A.........A."],"field":"short"},{"x":5,"y":2,"rows":["....AIIIAIIIA.....","...AIIAAIIAIAI....","..AAA~.....~AII...","..AI~.......~IA...",".IIU~.......~AII..",".IUI.........AUI..",".III.........UIII.","AIUI.........IUAI.","IU.............II.","UI.............AU.","IA.............IIA","UI.............A.I",".A...........A.I.A",".I...........A.I..","...............A.."],"field":"short"},{"x":3,"y":0,"rows":["........AAA.........","......AIAIAIAA......",".....AIAIAAAIAIA....","....AIAIAy.yAAAAI...","...AIAyAy...yAyAAI..","..AAAAyI.....AyAIAI.",".AAAI.A.......AAIAAA",".A.IAIA.......AAAII.","A.AAIA.........AIAAI","..AIAA.........AAIAA",".AAAI...........AAA.","..AIA...........AAA.","..AAI...........IA.A","..AAAA.........AAA..","..A.I...........A...","....A..............."],"field":"short"},{"x":5,"y":-6,"rows":[".....A...........","...A.A.I.A.......","..AAAAI..AI......","...IAIAIAIAIA....","..AAIAIAAAAAIAI..","AA.AAAAAAIAIAAAI.","..A..AIAIAIAIA..A",".A..AIAIAIAIAIA..",".A.AA~.....~AAIA.","...I~.......~IA..","...A.........A.A.","...I.........I...","...~.........~..."],"field":"afro"},{"x":7,"y":-3,"rows":["..A.AAA.AI...",".AIAIAIAIAI..",".IAIAIAIAIAI.","AAIAAAAAIAIAI","AAAAAAAAAAAIA","AIAyyyyAAyAAA","IAy.......yAI","AIy.......yIA","AA.........AA",".A.........A.",".A.........A.",".y.........y."],"field":"curly"},{"x":4,"y":0,"rows":[".......A..A.A.......","....AA.IAIAIAI.A....",".A.AIAAAIAIAIAI.....","..AAAIAAAAAAAIAAI...","...AIAIAIAIAIAAIAA..",".AAIAIAAAAAAAAIAI...","..IAI~~~~~~~~~AIAIA.",".AAA~.........~AIA..",".AIA~.........~IAIA.","A.A.~.........~.AA.A","..A.............A...",".A...............A.."],"field":"short"},{"x":7,"y":1,"rows":["....UAUAU.U..","..UAAUAUAAA.A",".UAAUAUAUAUA.","AAAU.I...UAAA","UAU.U....~UA.","AUUU......AUA","UA.........AU","AU.........UA","AA.........AA",".A.........A."],"field":"short"},{"x":6,"y":3,"rows":["....AI..AIA....","...AIAIAIAIA...","..AIAA~~~AAIA..","..IA~.....~AA..",".AA~.......~AA.",".A~.........~A.",".A~.........~A.",".A~.........~A.","..~.........~..","...............","...............",".A.............","A.A.........I..","..A.........AA.","..A..........AA","..A............"],"field":"long"},{"x":5,"y":4,"rows":["....AIAIAIAIA..","...AIAIAAAAAIA.","...IA~.....~AI.","..AA~.......~AA","..AA.........AA","..A~.........~A","..A...........A","...............","...............","...............",".A.............","AAA...........A","..A...........A"],"field":"short"},{"x":5,"y":4,"rows":[".....IAIAIAI....","....IAAAAAAAI...","...IA~.....~AI..","..IA~.......~AI.","..AI.........IA.","..I~.........~IA",".IA~.........~AI",".A.............A",".I.............I","IA.............A","A..............I","I..A.........A.A","...A............"],"field":"short"},{"x":4,"y":3,"rows":["......AAAIAAA.....","....AAIAIAIAIAA...","...AAIAIAAAIAIAA..","...AIA~.....~AIA..","...IA~.......~AI..","..IAI.........IAA.","..AI~.........~IA.","..IA...........AA.","..AA...........IA.","..IA...........AA.","..AA...........IA.",".AIA...........AI.",".IAA...........IAI",".AIA...........AIA",".IAA...........AAA","IAIA...........AIA","A.AAA.........AIAI","I.I.I.........I.IA","A.A.A.........A.AA","I...A...........IA",".A...............A",".A...............A"],"field":"long"},{"x":4,"y":1,"rows":["......IAIAIAA.....","....AIAIAIAIAIA...","...AIAIAyyyAAAAI..","...IAyAy...yAyAA..","..AAAyI.....AyAIA.","..AII.........AIAA",".AAAy.........yAIA",".AAI...........IAA","A.I.............I.","..A.............AA","..A.............AA","..A............A.A",".A..A.........A...","....A..........A.."],"field":"short"},{"x":7,"y":0,"rows":["....IA..A....",".I.IAIAII.I.I","IAIAIIIIIIIA.",".AAAAAAAAIAAI","IAI~.....~AA.",".I~.......~I.",".I.........I.",".~.........~."],"field":"short"},{"x":3,"y":-2,"rows":[".......A....A........","....A...A..A..A......",".....IAAAIAIAIAI.....","....IAIAIAIAIAIAIA...","...IAIIAAAAAAIAIAIA..","..IAIAIAIAIAIAIAIAAA.","AAIAAAAA~AA~A~AIAAIAA",".IAIAA~..A....~AAIAI.",".AIAA~.........~AAIAA","AIAIA...........AAAI.","..IAA...........AAIA.","..AAA...........AAA..","..IA.............AIA.","...A.............A..."],"field":"curly"},{"x":8,"y":2,"rows":["...AAaAA...",".AaAaAaAaA.","AaA~~~~~AaA","a~.......~a","~.........~"],"field":"short"},{"x":4,"y":3,"rows":["......AaaAAaA.......",".....AaAaaAAaA......","....IaA~~~~~AAI.....","...IAA~.....~AAI....","...AI~.......~IA....","..AIA.........UIA...","..IUA.........IAIA..","..AIA.........AIA...","..IAI.........IAI...","..AAA..........IU...","..IAI..........AI...",".AAAA.........AIUU..",".AIAI.........AAIU..",".IAIAA.......AAIUI..",".AIUIA.......AIAIU..",".IUIAA.......AAIAI..","IUIA...........AIAI.",".IUI...........IIUII","I.IU...........I.I..",".I.U...........U..I."],"field":"long"},{"x":5,"y":1,"rows":["......IA.AIA....",".....IAIAIAIA...","....IAAAAAAAI...","...IA~~~~~~~AI..","..AA~.......~AA.","..AI.........IA.",".AIA.........AIA",".IAI.........AAI",".A.~.........~.A",".I.............I",".A.............A",".I.............I","AAI...........IA",".IAA.........AAI","AAIA.........AIA","AIAA.........AAI",".AIA.........AIA"],"field":"short"},{"x":5,"y":3,"rows":[".....AI..AIA......","....AIAIAIAIAI....","...AI~~...~~IAI...","..AIA.......AIA...",".AIA~.......~AIA..",".AA~.........~AI..",".AI~.........~AA..","..A...........AI..","IA.............A..","...............A..","...............AA.",".A...............A",".............I...."],"field":"short"},{"x":4,"y":2,"rows":[".................A.","..A...AIAI..AA.IA..","...AIAIAIAIAIAIAIA.","....AIAAAAAAAIAIA..",".AIAIA~AA~A~AAIAAA.","..AIA~......A~AIA.A",".AAAA.........AAIA.","A.AA~.........~AAIA",".AAA...........AAAA","AAA~...........~IA.",".IA.............AAA",".AI.............IAA","AIA.............AI.","..AA...........AI..",".................A."],"field":"short"},{"x":3,"y":1,"rows":[".......AIA.AAA.....","......AAAAAAIAI....",".....AIA~~~~~IAIA..","...AAAI~.....~AAIA.","..A.IA~.......~AA.A","..AIAA.........AIA.",".A.AIA.........AAI.",".A.IA~.........~AAA",".AAAI...........AIA",".A.IA...........IAA","A..AA...........AIA","...IAI.........AIA.","...A.A.........IAI.","...A.I.........AA.A","...A.A.........AA..",".....A.........A..."],"field":"short"},{"x":6,"y":1,"rows":["....IAIAIAA....","..AIAIAIAIAIA..",".AIAIAyyyAAAAI.",".IAyAy...yAyAA.","AAAyI.....AyAIA","AIA.A.....A.AIA","AAI.........AAI","AIy.........yIA","IA...........AI","A.............A","...............",".A...........A.",".............A.","..A.........A.."],"field":"short"},{"x":8,"y":-2,"rows":["....A.A.....","..IAIAIAIA..",".AAIAAAIAAA.",".AIAIAAAIA.A","AI~~.~.~~AA.","A~.......~A.","A.........A.","~.........~.","~.........~."],"field":"curly"},{"x":8,"y":2,"rows":["...AIAIA...","..AIAIAIA..",".AIAIAIAIA.","AAAIAIAAAAA","A~.~~..~.~A","A.........A","~.........~"],"field":"short"},{"x":6,"y":-1,"rows":["....AAA.AA.A...",".A.AIAIAIAIA.A.","AIAIAIAIAIAIAIA","IAIAIAAAIAIAIA.","AIAAAAAAAAAAAIA",".AA~.......~AA.","AIA.........AIA","AA~.........~AA",".A...........A.",".I...........I."],"field":"short"},{"x":5,"y":1,"rows":[".....IAIAIAI.....","...AIAIAIAIAIA...","..AIAIyyyyAIAIA..","..IAyA....yAyAI..",".AAAyI.....IyAAA.",".AIAA......A.AIA.",".AAI.........yAI.",".AIy..........IAA","AIA...........AIA","IA.............AI","A...............A","I.A...........A.I","..IA.........AI..","..A...........A..","..I...........I.."],"field":"short"},{"x":6,"y":-1,"rows":["....AAA.AA.A...",".A.AIAIAIAIA.A.",".IAIAIAIAIAIAIA","IAIAIAAAIAIAIA.","AIAAAAAAAAAAAIA",".AA~.......~AA.","AIA.........AIA","AA~.........~AA",".A...........A.",".I...........I."],"field":"short"},{"x":4,"y":3,"rows":[".......IAUUU......",".....AIUIAIAIA....","....AIAAAAAAAIA...","....IA~.....~AI...","....A~.......~A...","....A.........A...","....~.........~...","....~.........~...","..................","..................","..................","..................","...A...........A..","...AA.........AI..","...IA.........IAI.","...AI.........AIA.","..AIA.........IAUA","UAAAU..........AAU",".U.UU...........UU"],"field":"long"},{"x":6,"y":-3,"rows":[".....A.A.IA..","....AZAAZAIA.","....ZAIZAZZI.","...AZIAZaAA..","...ZIAIAZIaA.","..AIAZZIZAZ.I",".IZZI..A..~Z.",".AZ~A......~Z","A.Z.........Z","I.~.........~","I.~.........~"],"field":"curly"},{"x":4,"y":4,"rows":["......II..III.......",".....IIAAIAAII......","....IIA~...~AII.....","...AIA~.....~AIA....","...IU~.......~AI....","..IAA~.......~AAI...","..IAI.........IAI...","..IAA.........AAI...",".AIAI.........IAAI..",".AAAA.........AAIA..",".AIAI.........IAAI..",".AAIA.........AAAA..",".AIAI.........IAAI..",".IAIA.........AAAAI.","IAIAI.........IAAAI.","UIAAA.........AAA.U.",".U.I..........I.I..U","...U..........U.U..."],"field":"long"},{"x":6,"y":0,"rows":["......AA.A.....","...AAAAAAAAA.A.","..AAIAIAIAIAA..","AAAIAIAAAIAIAAA",".AIA~~~~~~~AIA.",".AA~.......~AA.","AAI.........IAA",".AA.........AA.","..A.........A..","..~.........~.."],"field":"short"},{"x":3,"y":-2,"rows":["........A..A.A.A.....",".........A.A.AA......","...A.IAAAIAIAIAIA....","...AIAIAIAIAIAIAIA.A.",".AAIAIAAAAAAAIAIAIA..","..IAIAIAIAIAIAIAIAAA.","AAIAAAA~~~~~~~AIAAIAA",".IAIAA~.......~AAIAI.",".AIAA~.........~AAIAA","AIAIA...........AAAI.","..IAA...........AAI..","....~...........~...."],"field":"curly"},{"x":5,"y":0,"rows":[".....AAAAAA.A....","..A.AAAIAAAAAA...","..AAAAIAIAAAIAA..",".AIAIAAIAIAAAIAA.",".AAIAIAAIAIAIAIA.","AAAAIAIAAIAAAIAAA","AAAAA~.A...~AAAAA",".AIA~.......~AAA.","..AA.........AA..",".A.A.........A...","...y.........y..."],"field":"short"},{"x":6,"y":3,"rows":[".....AA~AA...","...A~AA~AA~A.","..AA~~...~~AA","..A~.......~A","..~.........~",".............",".............",".............",".............",".............",".............",".A...........","A............","AA..........A"],"field":"short"},{"x":8,"y":1,"rows":["....~~~....","..~~~~~~~..",".~..~~~..~.","~.........~","~.........~","~.........~"],"field":"short"},{"x":7,"y":0,"rows":["...IAIA......","..IAAAIAII...",".IAAAIAIAII..","IAAyy...yyAI.","AIy.......yA.","IA.........AI","AI.........IA","IA.........AI",".A.........A.",".y.........y."],"field":"short"},{"x":5,"y":3,"rows":["......AAAAA......","....AIAIAIAIA....","...AIAIAAAIAIA...","..AIAI.....IAIA..",".AIA~A.....A~AI..",".AIA.I.....I.AI..",".IA~.........~AI.","A.A...........AI.","A.A...........A.A","................A",".................",".................",".A...............","A..A.........A...","...A............."],"field":"short"},{"x":5,"y":4,"rows":[".....IAIAIAI......","...AIAAAAAIAIA....","..AIA~...IA~AIA...","..IA~.....I.~AI...",".IAA......A..AAI..",".AA~......A..~IA..",".IA...........AIA.","..~...........~.A.","................A.","A...............A.","................A.","..............A..A","..............IA.."],"field":"short"},{"x":5,"y":0,"rows":[".......AA.........",".....IAIAIAA......","...AIAIAIAIAIA....",".AAIAIAIyAAAAAIA..","..IAIAyA.AyAIAA.A.",".IAIII.I.A..IAIA..",".AIAIA.A.A..IAIA..",".IAIAI.A...A.AAIA.","AAIAI........AAA.A",".IA.A........A.I..",".A..A........A.A..","...............A..","..................","...A..............","..A..............."],"field":"short"},{"x":5,"y":3,"rows":["......IAAUA......","....AIAIUUUIA....","...AIAAAAAAAIA...","...IA~.....~AI...","...A~.......~A...","..AI.........AA..","..IA.........UA..","..AI.........AA..","..IA.........UA..",".AAA.........AUA.",".AAU.........UAA.",".AUA.........AUA.","AUAU.........AUU.","AAUU.........AUA.","AUAU.........AUU.","U.AU..........UUU"],"field":"long"},{"x":8,"y":1,"rows":["..AIAIAIA..",".AIAIAIAIA.","A~.......~A","I.........I","~.........~","~.........~","~.........~"],"field":"short"},{"x":4,"y":2,"rows":["......UII.III......","....IUIUAIAIAIA....","...IUUUIIAIAIAIA...","...UUUI~~~~~AIAI...","..UIUU~.....~AIAI..","..UUUU.......IAAA..",".UUIU.........IAIA.",".UUUU.........AIAI.","UUUUU.........IAAAA","UUUUU.........AAAIA","U.UUU.........I.I.A","..UUU.........A.A.A","..IUA..........AI..","..AU..........AIA..","..IAA.........AA...","...IA.........A...."],"field":"short"},{"x":7,"y":3,"rows":["..I.IAA.AAI..",".IAIAIAIAIAI.","IAIAIAAAIAIAI",".IA~.....~AI.","IA~.......~AI",".A.........A.",".~.........~."],"field":"short"},{"x":6,"y":0,"rows":[".....IAIAI.....","...AIAIAIAIA...","..AIAIAIAIAIA..",".AIAIAAAAAIAIA.","AAA~~.....~~AA.",".IA.........AIA","AA~.........~AA","AI~.........~IA","AA...........AA",".A...........A."],"field":"short"},{"x":7,"y":3,"rows":["....AA.AA...","...I~I~I~I..","..A~.....~A.",".A~.......~A",".A.........A",".~.........~","............","............","............","............","............","............","............",".A..........",".A.........A","A..........."],"field":"long"},{"x":5,"y":1,"rows":[".......AA........",".....IAIAIAI.....","....IAAAAAAAI....","...IA~~~~~~~AI...","...A~.......~A...","...I.........I...","...A.........A...","...A.........A...","...~.........~...",".................",".................",".................","..A...........A..","..IA.........AI..",".IAI.........IAI.",".AIA.........AIA.","U.AI.........IAI.",".UIA.........AIU.",".I.............II"],"field":"long"},{"x":5,"y":3,"rows":[".....I~I~I~I....","....A~.....~A...","...A~.......~A..","...A.........A..","...~.........~..","................","................","................","................","................","................","................","...A............","..A..........A..","AA............A.","...............A"],"field":"long"},{"x":4,"y":2,"rows":[".......IAIAI.......",".....IAaIAIAAI.....","....IA~~~~~~~aI....","...aA~.......~Aa...","...AI.........IA...","..AI~.........~IA..","..aA~.........~Aa..","..AI...........IA..","..aA...........Aa..","..AI............Aa.",".AaA............aA.",".IAI............Aa.",".AaA...........AaA.",".IAI...........IAa.","IAaA...........AaAa","a.Aa...........aA.A","...a...........a..."],"field":"long"},{"x":7,"y":1,"rows":["...ZAZ.ZAA....","..ZAZAIAIAI...",".ZAIAZAIAIAI..","ZAIUA.IAIUIAI.","AIUI~..IAIUIA.","ZAIA....IAIUUI","AIA......AAAZZ","ZA~.........ZA"],"field":"short"},{"x":7,"y":0,"rows":[".....AAAAA...","..AAIAIAIAA..",".AAIAIAIAIAA.","AAIAAAAAAAIAA","AIA~~~~~A~AIA","AA~.......~AA","AI.........IA","AA.........AA",".A.........A.",".~.........~."],"field":"short"},{"x":4,"y":-1,"rows":["......AAA.AA.A.....","...A.AIAIAIAIA.A...","..AAAIAIAIAIAIAIA..","..AAIAAAAAAAIAIAA..",".AAIAIAIAIAAAAAIAA.","..IAAA~~AA~.~AAAI..",".AAIA~.......~AIAA.","AAIAA.........AAIAA",".IAA...........AAIA","AAIA...........AIA.",".AA.............AAA",".AA.............AA.","..A.............AA.","..A.............A..","...A...........A..."],"field":"short"},{"x":7,"y":1,"rows":["...AaA.Aaa...","..AaAaAaAaA..",".AaAyyyyyAaA.","Aaya.....ayaA","aAyA.....AyAa","Aa.......a.aA","ay.........Aa","A..........yA","a...........a",".............",".............",".............","...........a."],"field":"short"},{"x":5,"y":4,"rows":["......AIAIA....","....IAAAAAAAI..","...IA~~...~~AI.","..IA~.......~A.","..AI.........IA","..I~.........~I",".IA~.........~A",".AA...........A",".I............A","AA............."],"field":"short"},{"x":5,"y":1,"rows":["......AIAIA.......",".....AIAIAIAA.....","....AIAAAAAIAI....","..IAIAAIAIAAIAI...",".IAIAAI~~~IAAIAI..",".AAAIA~...~IAAIA..","AAAIA~.....~IAAIA.","AAIAA.......AIAAI.","AIAI~.......IAIAAI","AAIA.........IAA.A","AIA..........AIA.I","IAI..........IAAAA","AIAA.........AIAAI","IAAA.........IAIA.","AAIA.........AIAA.","AAAA.........AAA..","A.IA..........IA..","..A...........A..."],"field":"long"},{"x":6,"y":1,"rows":["....IUIAIAA.....","...IUIAAAIAI....","..IUy....AyAI...",".IAI.....A.yAI..",".AIU......A.IA..","AIU.......A.AIU.","IAI.......A.IAA.","AIU.......A..IAU","IUA........A.AIA","AIA..........IAU","AAA..........AA.","A.A.........AIU.","............IA..","............AIA.","............A..."],"field":"short"},{"x":4,"y":1,"rows":[".......AAIAII......",".....IAAIAIAAI.....","...IIAaaAaAaAAI....","..IIAa~....~aIAII..",".IIAa~.......aAI...",".IAaa.........aAI..",".Aaa~.........~aAII",".IAa...........AAI.",".AIA...........aIAI","IIA.............aA.",".IA.............aa.","..IA...........aAI.",".IaA...........AI..","...aa.........aaA..","....A.........aA...","...Aa.........Aa..."],"field":"short"},{"x":5,"y":0,"rows":[".....AA...AAI....","....AIAIAIAI.I...","...AIAIAIAIAIA...","..AIAIyyyyyAAIA..",".AIAI.......IAIA.",".AAAy.......yAAI.","IAIA.........AIAI","AAAI.........AAIA","IAIA.........AIAI","AIAA.........AAIA",".A.A.........A.A.",".I.............I.",".I.............I."],"field":"short"},{"x":4,"y":-1,"rows":["......AIA.AI.I.....","...A.AIAIAIAIA.A...","..AIAIAIAIAIAIAIA..","..IAIAAAaAaAIAIAI..",".AAIAaaaAaAaZaAIAA.","..IAaZ~.....~ZaAI..",".AAaZ~.......~ZaAa.","AAaZa.........aAaAa",".aAZ...........aAaA","AAaZ...........ZZA.",".a.~...........~.aA",".A...............Z.",".................a.","..a.............a..","...Z...........Z..."],"field":"short"},{"x":7,"y":1,"rows":[".....IA......","...UIU.UA....","..U..A.IIAIA.","II.UIIAUAI..I","..UAIAAAUAI..",".IA~.....~AI.",".A~.......~I.",".A.........AU",".~.........~I","A...........U"],"field":"short"},{"x":6,"y":1,"rows":["....IAI.IAA.....","..AIAIAIAIAIA...",".AIAIAyyyAIAAI..",".IAyAy...yAyAA..","AAAyI.....IyAIA.","AIA.A.....A.AIA.","AAIA......I.AAI.","AIAA......A.AIA.","IAA.........AAI.","AI..........A.A.","IA............I.","AA...........IA.","IAA.........AA.A","A.A.........AI..","I.A.........IA..","..A.........A..."],"field":"short"},{"x":5,"y":0,"rows":[".......A..........","...A.aAaaaAa.A....","..aaaaaaaAaAaA....",".aaaaaAaAyAaAaaA..",".aaAaAyAa.ayaAa.A.","AaAaAa.a..A.Aaaa..",".AaAaA.A..a.aAaAa.","Aaaa.a.a..A.Ayaa.A","..aa.a.......yaA..","Aaay..........aaA.",".A.y...........A..","A...............A."],"field":"short"},{"x":8,"y":0,"rows":["..aAZaAAZ..",".aAZAZaAAZ.","aay.....yaZ","Ay.......yA","a.........a","A.........A","y.........y"],"field":"short"},{"x":4,"y":0,"rows":[".......A.A..A.....","...AA.IAIAIAA..A..","....AIAIAIAIAIA...","..AAIAIAAAIAIAAIA.","...IAyAy..AyAyAA..","..AAAyI...I.IyAIA.",".AAIA.A...A.A.AIA.","A.AAIA......I.AAIA",".AAIAA......A.AIAA",".AIAA.........AAI.","..AI..........A.AA",".A..............I."],"field":"short"},{"x":6,"y":0,"rows":[".....IIA.I.....","...AAAAIAIAI.I.","..AAIAIAIAIAI..",".IAIAIAIAIAIAIA","IAIA~~IA~I~AIAI",".AA~....I..~AA.","IAI.........IAA",".AA.........AA.",".AA.........AA.","..A.........A.."],"field":"short"},{"x":3,"y":0,"rows":["........A..A.A.......","....AA.IAIAAAA.IAA...","..IAIAIAAAIAIAIA.....","....AIAIAIyAAAAAAIA..","...AIAIAyA.AyAIAIA.A.","..AIAIAI.I.A.IAAAIA..",".AIAAAIA...A.AIAAAIA.",".IAAAIA......I.IAIA..","IAAAIA..........IAAA.","AAAAAA..........AIAAA","A.AA.A...........AA..","..IA.............IAAA","AA.I.............I.A.",".....................",".....A.........AAA...",".....A..............."],"field":"short"},{"x":5,"y":0,"rows":["......A..AI.......","...A.IA.AI.AA.A...","....AAIAIAAAIA....",".AAIAIAIAIAIAIA...","..IAIAIAIAIAIAIAA.","AIAIA~.....~AIAI..",".AAA~.......~AIAI.","AIA~.........~AAA.","IAA...........IAIA","AAA...........AAA.",".A.............AA.","AA.............A..",".A.............A.."],"field":"short"},{"x":6,"y":0,"rows":[".....AA........",".A.AAAIA.AA....","..AAAIAIAAAIA..",".IAIAAAAIAIAIA.","AAIAIAAAAIAIAIA","AAAAAIAAAAAAIA.",".AIA~..~AIAAAA.",".AA~......~AIA.","..A........~A..","..A.........A..","..A.........A.."],"field":"short"},{"x":5,"y":-5,"rows":[".....AA.......",".A..AUUAA.....","..AaAAaUaA....",".AUAUAUAUAaA..",".UAUAUAUAaAaU.","AAUAaAaAaAUAAU",".AaAaaAaaUAaaa","..AaaaaAaAaAa.",".A.aAaaaaaaaaa","A..Aa~.....~aA","...a~.......~a","...A.........A","...a.........a","...~.........~","...~.........~","...~.........~"],"field":"curly"},{"x":7,"y":3,"rows":["....IAAAI.....","..AIAIAIAIA...",".AIAA~~~AAIA..",".IA~.....~AA..","AA~.......~AA.","A~.........~A.","A~.........~A.","A~.........~A.",".~.........~..","..............","..............","A...........A.","IA.........IA.","AI.........AI.","IA.........IAA","AA.........A.A"],"field":"long"},{"x":5,"y":3,"rows":["......IAIAI.......","....AIAIAIAIA.....","...AIAAAAAAAIA....","...IA~.....~AI....","...A~.......~AA...","..UA.........AA...","..AA.........UA...",".AU..........AU...",".UA..........UAA..",".AA..........AUA..",".UAU.........UAU..","UAUA.........AUA..","AUAU.........UUU..","UAUU.........AUAU.","AUAU.........UUUU.","UUUU.........AUUU.","U.UU.........UUUUU","U.U..........U.UUU"],"field":"long"},{"x":5,"y":3,"rows":["......IAIAI.......",".....IAIAIAI......","....IA~~~~~AI.....","...IA~.....~AI....","...A~.......~A....","..IA.........AA...","..AA.........IA...","..IA.........AI...",".IAI.........IA...",".AIA.........AIA..",".IAI.........IAI..","IAIA.........AIA..","AIAI.........IAI..","IAIU.........AIAI.","AIAI.........UAIA.","UAUU.........AUAIA","UIUU.........UUUAI","U.UU.........UUUIA","U.U..........U.U.A"],"field":"long"},{"x":8,"y":-2,"rows":[".....AUI...","....UAIAI..","...IAIAAAA.","...AIUIAI..","AAIAAAAAA.A",".AA~...~AA.","AA~.....~AA","A~.......~A","~.........~","~.........~"],"field":"curly"},{"x":7,"y":4,"rows":["....AIAIA.....","..IAIAAAAAI...",".IA~~~~~~~AI..",".A~.......~A..","AA.........AA.","A~.........~A.","A...........A.","A...........A.","A............A"],"field":"short"},{"x":6,"y":0,"rows":[".....AAA.A.....","...AAAAAAAAA...","..AAIAIAIAIAA..",".AAIAIAAAIAIAA.",".AIA~.....~AIAA","AAA~.......~AA.",".AI.........IA.","..A.........A..","..~.........~.."],"field":"short"},{"x":4,"y":4,"rows":["......II..III......",".....IIAAIAAII.....","....IIA~...~AII....","...AIA~.....~AIA...","...IU~.......~AI...","..IAA~.......~AAI..","..IAI.........IAI..","..IAA.........AAI..",".AAAI.........IUAI.",".AIAA.........AIIA.",".AUII.........IUAA.",".AIUA.........AIAI.",".IUII.........IUAU.",".AIUA.........UIAII","IIUII.........IAIUI","UIIUA.........AIU.U",".U.I..........I.I.U","...U..........U.UI."],"field":"long"},{"x":4,"y":-1,"rows":[".....AAA...AAA.A....","...AAAIAIAIAIAAA....",".AAAUIUIUIUIUIUIA...","..AUIUIAIAIAIUIUAA..",".AAIUIAAUAUAAIAIUAA.","..IUAA~....A~AAAIA..",".AAIA~......A~AIAAA.","AAIA~.........~AIAAA",".IAA~.........~AAI..",".AIA...........AIAA.","A.A~...........~AA..",".AA.............A.A."],"field":"short"},{"x":7,"y":2,"rows":[".A.A.A.AAA...","..AIAAAAAIA..",".AIAIAIAIAIA.","AIAIAIAIAIAIA","AAI~A~~~~~IAA","AA~A......~AA",".A.........A.",".A.........A.",".~.........~.",".~.........~."],"field":"short"},{"x":8,"y":2,"rows":["...I~I~I...","..II~I~II..",".A~.....~A.","A~.......~A","A.........A","~.........~","~.........~","~.........~","...........","...........","...........","...........","...........","A..........","A.........A",".A........A"],"field":"short"},{"x":6,"y":-1,"rows":[".....A.A..A...","...AIUIAIIAA..","..AIUIAIUIAIAA",".AIAIUIUyyIAI.","AAAIUy....yIAA",".AIIU.....yIAA",".IUI.......yUI",".UIy........IU",".AA.........AA","..A.........A.","..............","..............","..............","..A.........A."],"field":"short"},{"x":4,"y":2,"rows":["......AIAIAIA.......","....AIAaIAIAAIA.....","...AIA~~~~~~~aIA....","...aA~.......~Aa....","..AAI.........IAA...","..AIa.........aIA...","..aAa.........aAa...","..AIA.........AIA...","..aAa.........aAa...","..AIA.........AIA...","..aAa.........aAaa..","..AI..........AIAa..",".aaA..........aAIa..",".aAI..........AIAIa.",".AIA..........aAIAa.",".IAIA.........AIAIA.","aAIAa.........aAIAI.","AaAIa.........aIA.Aa","aaa.a.........a.a.aa","a.a................a","a..................a"],"field":"long"},{"x":3,"y":-4,"rows":["......A..............",".......A...AA.A......","....AA.AA.AA.A...A...",".....IAAAIAIAIAIA....",".AA.IAIAIAIAIAIAIA...","...IAIAAAAAAAIAIAIA..",".AIAIAAAAAAAAAAAIA.A.","...IAAAIAIAIAIAAAIA..","..IAAAI~.~.~.~IAAAIA.","AIAIAA~.......~AAIAIA","..IAAI.........IAAIA.",".IAAAA.........AAAAIA","A.IAA~.........~AAAA.",".I.A~...........~.AAA","..................A..","...................A."],"field":"afro"},{"x":7,"y":0,"rows":[".....III.....","..IIIIIIIII..",".AIAIAIAIAIA.",".IAIAIAIAIAI.","AAAy.....yAAA","AIA.......AIA","AAy.......yAA","AI.........IA",".A.........A."],"field":"short"},{"x":4,"y":2,"rows":["......IAIAIAI.......",".....IAIAIAIAI......","....IAa~...~aAI.....","...aAa~.....~aAa....","...AI~.......~IA....","..AIA~.......~AIA...","..AAA.........aAa...","..AIA.........AIA...","..IAA..........AaA..","..AIA..........IAa..",".AaAa..........AaA..","..AIA.........AIAa..",".AaAa.........aAaA..",".aAIAa.......aAIAaA.",".aaAaA.......AaAaAa.","aa.IA.........AIAAAA",".A.A...........A.A..","...A...........A...."],"field":"long"}],"headband":[{"x":8,"y":3,"rows":["..ĀĀĀĀĀĀĀ..",".ĀāāāāāĂĂĀ.","ĀāĀĀĀĀĀĀăāĀ","ĀĀāāāāāāāĀĀ","ĀāĀĀĀĀĀĀĀāĀ","ĀĀ.......ĀĀ","Ā.........Ā"]},{"x":8,"y":3,"rows":["..ĀĀĀĀĀĀĀ..",".ĀāāĂĂāāāĀ.","ĀāĀĀĀăĀĀĀāĀ","ĀĀāāāāāāāĀĀ","ĀāĀĀĀĀĀĀĀāĀ","ĀĀ.......ĀĀ","Ā.........Ā"]},{"x":8,"y":4,"rows":["..ĄĄĄĄĄĄĄ..",".ĄąąĂąĂąąĄ.","ąąĄĄĄĂĄĄĄąą","ąĄąąąąąąąĄą","ąą.......ąą","ą.........ą"]},{"x":8,"y":3,"rows":["..ĆĆĆĆĆĆĆ..",".ĆćććĈćććĆ.","ĆćĆĆĆĆĆĆĆćĆ","ĆĆ.......ĆĆ","Ć.........Ć"]},{"x":8,"y":3,"rows":["..ĉĉĉĉĉĉĉ..",".ĉĊĊĊĊċċĊĉ.","ĉĊĉĉĉĉĉĉĉĊĉ","ĉĉ.......ĉĉ","ĉ.........ĉ"]},{"x":8,"y":0,"rows":["..ČČČČČČČ..",".ČččĎĎĂččČ.","ččČČČĂČČČčč","čČčččččččČč","čč.......čč","č.........č"]},{"x":8,"y":0,"rows":["..ďďďďďďď..",".ďĐĐĎĎĂĐĐď.","ĐĐďďďĂďďďĐĐ","ĐďĐĐĐĐĐĐĐďĐ","ĐĐ~.....~ĐĐ","Đ~.......~Đ","~.........~"]},{"x":8,"y":0,"rows":["..đđđđđđđ..",".đĒĒččĂĒĒđ.","ĒĒđđđĂđđđĒĒ","ĒđĒĒĒĒĒĒĒđĒ","ĒĒ.......ĒĒ","Ē.........Ē"]},{"x":8,"y":3,"rows":["..ĂĂĂĂĂĂĂ..",".ĂĂĂēĂēĂĂĂ.","ĂĂĂĂĂēĂĂĂĂĂ","ĂĂĂĂĂĂĂĂĂĂĂ","ĂĂ.......ĂĂ","Ă.........Ă"]},{"x":8,"y":3,"rows":["..ĔĔĔĔĔĔĔ..",".ĔĕĕĂĕĂĕĕĔ.","ĔĕĔĔĔĂĔĔĔĕĔ","ĕĔ.......Ĕĕ","Ĕ.........Ĕ"]},{"x":8,"y":4,"rows":["..ĖĖĖĖĖĖĖ..",".ĖėėĂĘĂėėĖ.","ėėĖĖĖĖĖĖĖėė","ėĖėėėėėėėĖė","ėė.......ėė","ė.........ė"]},{"x":8,"y":1,"rows":[".ęęęęęęęęę.","ęęĚĚĚĚĚĚĂęę","ęĚęęęęęęęĚę","ęę.......ęę","ę.........ę"]},{"x":8,"y":1,"rows":["..ěěěěěěě..",".ěĜěĜĜĜěĜě.","ěĜěěěěěěěĜě","ěěĜěĜĜĜěĜěě","ěĜěěěěěěěĜě","ěě.......ěě","ě.........ě"]},{"x":6,"y":2,"rows":["...ĝĐĝĝĝĝĝĐĝ...","..ĝĝĐĝĝĝĝĝĐĝĝ..",".ĝĝĞĐĞēĂēĞĐĞĝĝ.",".ĝĞĝĐĝĂēĂĝĐĝĞĝ.","ĝĞĝĐĐĝĝĝĝĝĐĐĝĞĝ","ĝĝĐĝ~~~~~~~ĝĐĝĝ","ĝĝĝ~.......~ĝĝĝ","ĝĞĐ.........ĐĞĝ","ĝĝĐ.........Đĝĝ",".ĝĐ.........Đĝ.",".ĝĐ.........Đĝ.",".ĝĝ~.......~ĝĝ.",".Đĝ~.......~ĝĐ.","..ĐĐ.......ĐĐ..","..ĐĝĐ.~~~.ĐĝĐ..","...ĝĝĐĐĐĐĐĝĝ...",".....ĝĝĝĝĝ.....",".......ĝ......."]},{"x":8,"y":0,"rows":["..ğğğĂğğğ..",".ğĠĠğğğĠĠğ.","ĠĠğğğğğğğĠĠ","ĠğĠĠĠĠĠĠĠğĠ","ĠĠ~~~~~~~ĠĠ","Ġ~.......~Ġ"]},{"x":8,"y":-1,"rows":["..ĠĠĠĠĠĠĠ..",".ĠğğğğğğğĠ.","ĠğĠĠĂğĠĠğğĠ","ĠĠğğğğğğğĠĠ","ĠğĠĠĠĠĠĠĠğĠ","ĠĠ~~~~~~~ĠĠ","Ġ~.......~Ġ"]},{"x":7,"y":-1,"rows":["...ġġġġġġġ...","..ġĞĞĞĞĞĞĞġ..",".ġĞġġĞĢĞġġĞġ.","ġĞġĞĞĞĞĞĞĞġĞġ","ġĞĞġġġġġġġĞġġ","ġĞġ~~~~~~~ġĞġ","ġġ~.......~ġġ","ġ...........ġ"]},{"x":8,"y":1,"rows":["..ġġġġġġġ..",".ġĞĞĞĞĞĞĞġ.","ġĞġġĞĂĞġġĞġ","ġġĞĞĞĞĞĞĞġġ","ġĞġġġġġġġĞġ","ġġ~~~~~~~ġġ","ġ~.......~ġ"]},{"x":7,"y":3,"rows":["...ĂĂĂĂĂĂĂ...","..ĂĂĂģĂģĂĂĂ..",".ĂĤĂĂĂģģĂĂĤĂ.","ĥĤĂĂĂĂĂĂĂĂĂĤĥ","Ĥ...........Ĥ"]},{"x":8,"y":3,"rows":["..ĝĝĝĝĝĝĝ..",".ĝĦĦĦħĦĦĦĝ.","ĝĦĝĝĝĝĝĝĝĦĝ","ĝĝ.......ĝĝ","ĝ.........ĝ"]},{"x":8,"y":3,"rows":["..ĉĉĉĉĉĉĉ..",".ĉĊĊĊĊīīĊĉ.","ĉĊĉĉĉĉĉĉĉĊĉ","ĉĉ.......ĉĉ","ĉ.........ĉ"]},{"x":8,"y":1,"rows":["..ěěěěěěě..",".ěĜěĜīīěĜě.","ěĜěěīěěěěĜě","ěěĜěĜĜĜěĜěě","ěĜěěěěěěěĜě","ěě.......ěě","ě.........ě"]},{"x":8,"y":2,"rows":["..ĜěěěěĜĜ..",".ěěěěěěěěĜ.","ěěĜěĜĜĜěĜěě","ěĜěěěěěěěĜě","ěě.......ěě","ě.........ě"]},{"x":7,"y":3,"rows":["..ĤĤĂĂĂĂĂĤĤ..",".ĤĂĂĂĂĂĂĂĂĂĤ.","ĥĤĤĂĂĂĂĂĂĂĤĤĥ","ĤĂĂĂĂĂĂĂĂĂĂĂĤ","ĥĤ.........Ĥĥ"]},{"x":8,"y":4,"rows":["..īīīīīīī..",".īĬĬīīīĬĬī.","ĬĬīīīīīīīĬĬ","ĬīĬĬĬĬĬĬĬīĬ","ĬĬ.......ĬĬ","Ĭ.........Ĭ"]}],"ears":[{"x":7,"y":8,"rows":["k...........k","K...........K","k...........k"]},{"x":7,"y":8,"rows":["k...........k","K...........K","K...........K","k...........k"]},{"x":6,"y":8,"rows":["kk...........kk","kK...........Kk","kK...........Kk",".k...........k."]},{"x":8,"y":8,"rows":["k.........k","K.........K","k.........k"]},{"x":8,"y":8,"rows":["k.........k","K.........K","K.........K","k.........k"]},{"x":7,"y":8,"rows":["kk.........kk","kK.........Kk","kK.........Kk",".k.........k."]}],"glasses":[{"x":7,"y":8,"rows":["ĨĨĨĨĨĨĨĨĨĨĨĨĨ","..Ĩ..Ĩ.Ĩ..Ĩ..","..ĨĨĨ...ĨĨĨ.."]},{"x":7,"y":8,"rows":["ĩĪĪĪĪĪ.ĪĪĪĪĪĩ","..Ī..ĪĪĪ..Ī..","..Ī..Ī.Ī..Ī..","..ĪĪĪ...ĪĪĪ.."]},{"x":7,"y":8,"rows":["ĭĮĭĭĭĭ.ĭĭĭĭĮĭ",".ĭ...ĭĮĭ...ĭ.",".ĭ..ĭ...ĭ..ĭ.","..ĭĭ.....ĭĭ.."]},{"x":7,"y":8,"rows":["ĮĭĭĭĭĭĮĭĭĭĭĭĮ",".ĭ...ĭ.ĭ...ĭ.",".Į...Į.Į...Į.","..ĮĭĮ...ĮĭĮ.."]},{"x":7,"y":8,"rows":["ĮĭĭĭĭĭĮĭĭĭĭĭĮ",".ĭ...Į.Į...ĭ.","..ĭĭĭ...ĭĭĭ.."]},{"x":7,"y":8,"rows":["įİİİİİįİİİİİį",".İ...İ.İ...İ.",".į...į.į...į.","..įİį...įİį.."]},{"x":7,"y":8,"rows":["ĮıııııııııııĮ",".ı^^^ı.ı^^^ı.","..^^^...^^^.."]}],"brows":[{"x":10,"y":8,"rows":["BBB.BBB"]},{"x":10,"y":7,"rows":["BB...BB","..B.B.."]},{"x":9,"y":7,"rows":[".BB...BB.","B..B.B..B"]},{"x":9,"y":7,"rows":[".BB...BB.","BB.B.B.BB"]},{"x":10,"y":8,"rows":["BB...BB"]},{"x":9,"y":8,"rows":["BBBB.BBBB"]},{"x":9,"y":7,"rows":[".BB...BB.","B.......B"]},{"x":10,"y":6,"rows":["BB...BB",".BB.BB."]},{"x":9,"y":8,"rows":[".BBB.BBB.","B.......B"]},{"x":9,"y":7,"rows":["BBB...BBB","...B.B..."]},{"x":9,"y":7,"rows":[".yBB.BBy.","BBBB.BBBB"]},{"x":9,"y":7,"rows":["BBB...BBB","B..B.B..B"]},{"x":11,"y":7,"rows":["BB.BB"]},{"x":9,"y":7,"rows":[".BBB.BBB.","B.......B"]},{"x":10,"y":7,"rows":["BB...BB"]},{"x":10,"y":8,"rows":["yy...yy"]}],"paint":[{"x":10,"y":11,"rows":["ĲĲ...ĲĲ"]},{"x":9,"y":11,"rows":["ĲĲ.....ĲĲ"]},{"x":9,"y":11,"rows":["ĲĲĲ...ĲĲĲ","ĲĲ.....ĲĲ"]},{"x":10,"y":10,"rows":["..ĲĲĲ..","ĲĲ...ĲĲ"]}],"eyes":[{"x":10,"y":9,"rows":["Wĳ...ĳW"]},{"x":10,"y":9,"rows":["WĴ...ĴW"]},{"x":10,"y":9,"rows":["Wĵ...ĵW"]},{"x":10,"y":9,"rows":["WĶ...ĶW","WĶ...ĶW"]},{"x":9,"y":9,"rows":["WĲĲ...ĲĲW"]},{"x":10,"y":9,"rows":["WĲW.WĲW"]},{"x":10,"y":9,"rows":["WĲW.WĲW","WĲW.WĲW"]},{"x":10,"y":9,"rows":["WĲW.WĲW","WĲ...ĲW"]},{"x":10,"y":8,"rows":["~~...~~","Wķ...ķW"]}],"details":[{"x":11,"y":5,"rows":[".^.^.","^.^.^",".^.^."]},{"x":12,"y":5,"rows":[".^.","^.^"]},{"x":12,"y":5,"rows":["~.~",".~."]},{"x":11,"y":4,"rows":[".^.^.","^.^.^",".^.^."]},{"x":12,"y":5,"rows":["~~~"]},{"x":8,"y":5,"rows":["....^.^....","...^.^.^...","....^.^....","...........","...........","...........",".^.......^.","^.^.....^.^",".^.......^."]},{"x":10,"y":5,"rows":["..^.^.",".^.^.^","..^.^.","......","......","......","......","......","......","^....."]}],"head":[{"x":8,"y":2,"rows":["..kkkkkkk..",".kkkkkkkkk.",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":8,"y":3,"rows":["..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":9,"y":3,"rows":[".kkkkkkk.","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk",".kkkkkkk.","..KkkkK..","...KKK..."]},{"x":8,"y":2,"rows":["..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","..kkkkkkk..","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":8,"y":2,"rows":["..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":8,"y":2,"rows":["....kkk....","..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","..kkkkkkk..","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":8,"y":2,"rows":["....kkk....","..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":8,"y":2,"rows":["....kkk....","..kkkkkkk..",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","..kkkkkkk..","...KkkkK...","....KKK...."]},{"x":9,"y":3,"rows":["..kkkkk..",".kkkkkkk.","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk",".kkkkkkk.",".kkkkkkk.","..KkkkK..","...KKK..."]},{"x":8,"y":3,"rows":["...kkkkk...","..kkkkkkk..",".kkkkkkkkk.",".kkkkkkkkk.",".kkkkkkkkk.",".kkkkkkkkk.","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk","kkkkkkkkkkk",".kkkkkkkkk.",".kkkkkkkkk.","...KkkkK...","....KKK...."]},{"x":9,"y":2,"rows":["..kkkkk..",".kkkkkkk.","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk","kkkkkkkkk",".kkkkkkk.","..KkkkK..","...KKK..."]}],"mouth":[{"x":12,"y":14,"rows":["LLL"]},{"x":11,"y":13,"rows":["L...L",".LLL."]},{"x":12,"y":13,"rows":["...L","LLL."]},{"x":11,"y":13,"rows":["LWWWL",".LLL."]},{"x":13,"y":13,"rows":["..L","LL."]},{"x":13,"y":14,"rows":["LL"]},{"x":12,"y":13,"rows":["WWWL","LLL."]},{"x":12,"y":13,"rows":["LLL","LLL"]},{"x":11,"y":13,"rows":["lWWWl",".lll."]}],"nose":[{"x":12,"y":11,"rows":["K.K",".K."]},{"x":12,"y":10,"rows":[".K.",".K.","K.K"]},{"x":12,"y":12,"rows":["K.K"]},{"x":12,"y":11,"rows":["K.K","KK."]},{"x":13,"y":12,"rows":["K"]}],"beard":[{"x":8,"y":10,"rows":["A.........A","A.........A","AZ.......ZA","AAZ.ZZZ.ZAA",".AAZ...ZAA.",".ZAZAZAZAZ.","..ZAZZZAZ..","...ZZAZZ..."]},{"x":11,"y":16,"rows":["A...A",".AAA."]},{"x":9,"y":12,"rows":["..AAAAA..",".A.....A.",".A.....A.","~AA~A~AA~",".AAAAAAA.","..AAAAA.."]},{"x":8,"y":11,"rows":["A.........A","AA.....A.AA","AAA.AAA.AAA","AAAA...AAAA",".AAAAAAAAA.",".AAAAAAAAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":11,"rows":["A.........A","AA.......AA","AAA.AAA.AAA","AAAA...AAAA","AAAA...AAAA",".AAAAAAAAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":10,"rows":["U.........U","U.........U","U.........U","UU..AAA..UU",".U.A...A.U.",".UUAAAAAUU.","..UAAAAAU..","...AAAAA..."]},{"x":8,"y":11,"rows":["A.........A","A.........A",".A..AAA..A.",".A.A...A.A.","..A.....A..","...A...A...","....AAA...."]},{"x":9,"y":12,"rows":["I.......I","A..III..A","AAI...IAA",".AAI.IAA.","..AAAAA..","...AAA..."]},{"x":9,"y":15,"rows":["~.......~",".~.....~.","..AAAAA..","...AAA..."]},{"x":11,"y":13,"rows":[".AAA.",".....",".....","A...A",".AAA."]},{"x":8,"y":9,"rows":["A.........A","A.........A","A.........A","A.........A","Aa..AAA..aA",".AaA...AaA.",".aAa...aAa.","..aAaAaAa..","...aAaAa...","....aaa...."]},{"x":10,"y":15,"rows":["~.....~",".AIAIA.","..AIA.."]},{"x":11,"y":13,"rows":[".AAA.","A...A","A...A",".AAA."]},{"x":8,"y":9,"rows":["I.........I","A.........A","A.........A","AI.......IA","AA.AAAAA.AA",".AA.....AA.",".AIA.I.AIA.","..AIAAAIA..","...AAAAA..."]},{"x":12,"y":13,"rows":["AAA","...","...","AAA"]},{"x":10,"y":14,"rows":["A.....A","AA...AA",".AAAAA.","..AAA.."]},{"x":8,"y":11,"rows":["I.........A","II.......IA","IAI.III.IAI","AIAI...IAIA",".AIA...AIA.",".IAAAAAAA..","...AAAAA..."]},{"x":8,"y":7,"rows":["I.........I","I.........I","I.........I","I.........I","I.........I","I..AAAAA..I","IIA.....AII",".IA.....AI.","..AA.A.AA..","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":12,"rows":["A.........A","A.........A",".A.......A.",".AA.....AA.","..AA...AA..","...AAAAA..."]},{"x":8,"y":11,"rows":["A.........A","A.........A","A.........A","AA.......AA",".AA..A..AA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":11,"rows":["A.........A","A..AAAAA..A",".A.......A.",".AA.....AA.","..AA...AA..","...AAAAA...","....AAA...."]},{"x":12,"y":16,"rows":["AIA","IAI"]},{"x":6,"y":12,"rows":[".A...........A.",".AA..aaaaa..AA.","aAAAaA...AaAAAa","aAAAAAAAAAAAAAa","aaAAAAAAAAAAAaa",".aaAaAaAaAaAaa.","..aaAaAaAaAaa..","..aaaAaAaAaaa..","...aaaaaaaaa..."]},{"x":8,"y":12,"rows":["I.........I","A.........A","AA.......AA",".AA.....AA.",".AAIAIAIAA.","..AAAAAAA.."]},{"x":8,"y":9,"rows":["~.........~","A.........A","I.........I","A.........A","I~.......~I","AI~.....~IA",".AIA...AIA.","..AIAIAIA..","...AAAAA..."]},{"x":8,"y":11,"rows":["y.........y","I.........I","Ay.UIIIU.yA","IAy.....yAI",".IAIyyyIAA.","..IAAAAAA..","....AAA...."]},{"x":9,"y":11,"rows":["A.......A","A.AAAAA.A","AA.....AA","AA.....AA","AAA...AAA",".AAAAAAA.","...AAA..."]},{"x":8,"y":12,"rows":["AA.......AA","AAA.....AAA","AAA.....AAA",".AAA...AAA.","..AAAAAAA..","....AAA...."]},{"x":9,"y":11,"rows":["A.......A","A.IIIII.A","I.......I","AIA...AIA",".AIAIAIA.","..AIAIA..","...AAA..."]},{"x":8,"y":9,"rows":["U.........U","U.........U","A.........A","AA.UUUUU.AA","AAU.....UAA",".AA.UUU.AA.",".AAA...AAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":11,"rows":["A.........A","A..y~~~y..A","A~.......~A","AA~.....~AA",".AAA...AAA.","..AAAAAAA..","...AAAAA..."]},{"x":9,"y":11,"rows":["A.......A","A.AAAAA.A","A.......A","AA.....AA","AAA.A.AAA",".AAAAAAA.","..AAAAA.."]},{"x":8,"y":11,"rows":["U.........U","A~.AAAAA.~A","UAU.....UAU","AUA~...~AUA","AAUA~~~AUAA",".AAAAAAAAA.","...AAAAA..."]},{"x":8,"y":10,"rows":["a.........a","A.........A","a.........a","A..yy.yy..A","aAy.....yAa","AaA..y..AaA",".AaAaAaAaA.","..AaAaAaA..","...aaaaA..."]},{"x":8,"y":10,"rows":["U.........U","I.........I","A.........A","AI.II.II.IA","AAI.....IAA",".AIA...AIA.",".AAAIIIAAA.","..AAAIAAA..","...AAAAA..."]},{"x":9,"y":13,"rows":["y.AAAAA.y","A.......A","A.......A",".Ay...yA.","..AAAAA..","...AAA..."]},{"x":9,"y":13,"rows":["..~~~~~..",".........","~.......~","A~.....~A","AAA~A~AAA",".AAAAAAA.","..AAAAA.."]},{"x":7,"y":12,"rows":[".~.........~.",".A..~~~~~..A.","AA.........AA","AA~.......~AA","AAA~..~..~AAA","AAAAA~A~AAAAA",".AAAAAAAAAAA.","..AAAAAAAAA..","....AAAAA...."]},{"x":9,"y":13,"rows":["..IIIII..",".........","~.......~","A~.....~A","AAA~A~AAA",".AAAAAAA.","..AAAAA.."]},{"x":8,"y":14,"rows":["~.........~","A..AAAAA..A","a~A.....A~a","AaA.....AaA",".AaA~~~AaA.","..AaAaAaA..","...aaaaa..."]},{"x":8,"y":12,"rows":["A.........A","A..IIIII..A","Ay.......yA",".AA.....AA.",".AAy...yAA.","..AAAyAAA..","...AAAAA..."]},{"x":9,"y":13,"rows":["..~~~~~..",".~.....~.","~A.....A~",".AA~A~AA.",".AAAAAAA.","..AAAAA..","...AAA..."]},{"x":8,"y":12,"rows":["~.........~","~.........~","A..~~~~~..A","A.~.....~.A","A~A.....A~A",".AAA~A~AAA.","..AAAAAAA..","...AAAAA...","....AAA...."]},{"x":7,"y":11,"rows":[".A.........A.",".I.........I.","AI.........IA","AA.........AA","AIA.IAAAI.AIA","AAIAI...IAIAA","AAAIA...AIAAA",".AIAIAIAIAIA.","..AIAIIIAIA..",".....AAA....."]},{"x":8,"y":12,"rows":["~.........~","~.........~","A.........A","A..IIIII..A","Ay.......yA",".AA.....AA.",".AAy...yAA.","..AAAyAAA..","...AAAAA..."]},{"x":9,"y":15,"rows":["..AA~AA..",".........","~.......~",".~.....~.","..AAAAA..","...AAA..."]},{"x":8,"y":15,"rows":["A..IIIII..A","AI.......IA",".AIA...AIA.","..AIAIAIA..","...AIAIA...","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A.........A","A~.......~A",".A~.....~A.","..A~...~A..","...AAAAA...","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","~..~AAA~..A","A~~.....~~A",".A~.....~A.","..A~...~A..","...AAAAA...","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","~..UUUUU..A","A~.......~A",".A~.....~A.","..A~...~A..","...AAAAA...","....AAA...."]},{"x":8,"y":13,"rows":["~.........~","~.........~","A.........A","A..~~~~~..A","A~.......~A","AA~.....~AA",".AAA...AAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..~~~~~..A","A.~.....~.A","A~A.....A~A",".AAA~A~AAA.","..AAAAAAA..","...AAAAA..."]},{"x":10,"y":19,"rows":["~.....~",".A~~~A.","..AAA.."]},{"x":9,"y":15,"rows":["..~~~~~..",".........","~.......~",".~.....~.","..AAAAA..","...AAA..."]},{"x":8,"y":15,"rows":["~.........~","A..~~~~~..A","A~.......~A","AA.......AA",".AA~...~AA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":12,"rows":["y.........y","A..yAAAy..A","Ay.......yA",".AA..y..AA.",".AAyyAyyAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..~~~~~..A","A~~.....~~A","AAA.....AAA","AAAA~A~AAAA","AAAAIAIAAAA",".AAIAIAIAA.","...AAAAA..."]},{"x":8,"y":16,"rows":["...~AAA~...","..A.....A..","A~A~...~A~A",".AAA~~~AAA.","..AAAAAAA..","....AAA...."]},{"x":9,"y":16,"rows":["..~AAA~..",".........","~.......~",".A~...~A.","..AAAAA..","...AAA..."]},{"x":8,"y":16,"rows":["...~AAA~...","A~A.....A~A","AAA~...~AAA",".AAA~~~AAA.","..AAAAAAA..","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","I..IIIII..I","A~I.....I~A","AAI.~I~.IAA",".AAII~IIAA.","..AAAAAAA..","...AAAAA..."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI..~A~A~..IA","AA~.A...A.~AA","AIA~.....~AIA","IAIAA~.~AAIAI",".IAIAIAIAIAI.","..IAAAAAAAI..","....AIAIA...."]},{"x":8,"y":16,"rows":["...~~~~~...","...........","A~A~...~A~A",".AAA~~~AAA.","..AAAAAAA..","....AAA...."]},{"x":9,"y":15,"rows":["~.......~",".A~...~A.",".AAAAAAA.","..AAAAA.."]},{"x":8,"y":15,"rows":["~..AIAIA..~","A.A.....A.A","AAIA.~.AIAA",".AAIAIAIAA.","..AAIAIAA..","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..~~~~~..A","A.~.....~.A","A~A.....A~A",".AAU~A~UAA.","..AUUUUUA..","...AAAAA..."]},{"x":10,"y":18,"rows":["~.....~","A~...~A","AAAAAAA",".AAAAA."]},{"x":8,"y":15,"rows":["~.........~","A..~~~~~..A","A~.~...~.~A","AA~~~~~~~AA",".AA~~~~~AA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":15,"rows":["...~~~~~...","~.........~",".~.......~.",".~~.....~~.","..AA~~~AA..","....AAA...."]},{"x":9,"y":15,"rows":["..~~~~~..",".........","~.......~",".~.....~.","..~~~~~..","...~~~..."]},{"x":8,"y":15,"rows":["...~~~~~...","~..~...~..~",".~~~.~.~~~.","..~~~~~~~..","...~~~~~..."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI.........IA","AA.........AA","AIA~IAAAI~AIA","AAIAI...IAIAA","AAAIA...AIAAA","IAIAIAIAIAIAI","AIAIAIAIAIAIA",".AIAIAIAIAIA.","...AAAAAAA..."]},{"x":9,"y":17,"rows":["~.......~","~.......~",".~.....~.","..A~~~A..","...AAA..."]},{"x":8,"y":12,"rows":["~.........~","~.........~","~.........~","~.........~","A.........A","AA~.....~AA",".AA~.~.~AA.",".AAIAIAIAA.","..AAIAIAA..","....AAA...."]},{"x":8,"y":15,"rows":["y.........y","y.........y","y.........y",".y.......y.","..y.....y..","...AyyyA...","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..AA~AA..A","A~A.....A~A","A~A~...~A~A",".AAA~.~AAA.","..AAAAAAA..","...AAAAA..."]},{"x":9,"y":16,"rows":["..Aa~aA..","~A.....A~","~A~...~A~","AaA~.~AaA",".AaAAAaA.","..aaaaa.."]},{"x":8,"y":14,"rows":["~.........~","A..~~~~~..A","A~.......~A",".~.......~.","..~A~~~A~..","....AAA...."]},{"x":8,"y":15,"rows":["~.........~","I..~~.~~..I","I~.......~I","AI.......IA",".AAy...yAA.","..AIyyyIA..","...AIAIA..."]},{"x":8,"y":14,"rows":["~..~~~~~..~","A.~.....~.A","A~A.~A~.A~A","IAI..~..IAI","AIAA...AAIA",".AIAAAAAIA.",".IAIAIAIAI.","..IAIAIAI.."]},{"x":8,"y":15,"rows":["~.........~","I..~~.~~..I","I.I.....I.I","AI~.....~IA","IAAy...yAAI",".IAIyyyIAI.",".AIAIAIAIA.","..AAAAAAA.."]},{"x":7,"y":12,"rows":[".~.........~.",".I.........I.","IA.........AI","AIA~IAAAI~AIA","IAIA.....AIAI","AIAI.....IAIA","IAIA~~~~~AIAI",".IAIAIAIAIAI.","..IAIAIAIAI..","....AAAAA...."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI..~~~~~..IA","AA~.~...~.~AA","AIA~.....~AIA","IAIAA~.~AAIAI",".IAIAIAIAIAI.","..IAAAAAAAI..","....AIAIA...."]},{"x":8,"y":11,"rows":["y.........y","A.........A","a..AAyAA..a","AyA.....AyA","aAy.....yAa","AaA.....AaA",".AaAaAaAaA.","..AaAaAaA..","...aaaaA..."]},{"x":7,"y":15,"rows":["~...........~","A...........A","I~.........~I","AI.........IA",".AI~.....~IA.","..AIAIAIAIA..","....AAAAA...."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI..~~~~~..IA","AA.~.....~.AA","AIAI.~A~.IAIA","IAIA..~..AIAI",".IAIAIAIAIAI.","..IAAAAAAAI..","....AIAIA...."]},{"x":8,"y":10,"rows":["~.........~","I.........I","A.........A","AI.IA.AI.IA","IAI~...~IAI","AIAA...AAIA","IAIAIIIAIAI","AIAIAIAIAIA","AAIAAAAAIAA",".AAA...AAA.",".AI.....IA.","..A.....A.."]},{"x":9,"y":15,"rows":["~.~~~~~.~","~.~...~.~","~~~.~.~~~",".~~~~~~~.","..~~~~~.."]},{"x":9,"y":18,"rows":["~.......~","A~.....~A","aAaAaAaAa","AaAaAaAaA",".AaAaAaA."]},{"x":10,"y":13,"rows":[".~~~~~.","~.....~","A.....A","AI~I~IA",".AIAIA.","..AAA.."]},{"x":8,"y":15,"rows":["...~~~~~...","~.~.....~.~","I~A.~A~.A~I",".IA.....AI.",".AIAAAAAIA.","..AIAIAIA.."]},{"x":8,"y":14,"rows":["...~~~~~...","~.~.....~.~","A~A.....A~A",".AIA~A~AIA.","..AIAIAIA..","...AAAAA..."]},{"x":8,"y":16,"rows":["~.........~","A.........A","A~.......~A",".AA~...~AA.","..AIAIAIA..","...AIAIA...","....AAA...."]},{"x":10,"y":15,"rows":["y.....y",".AIAIA.","..AIA.."]},{"x":7,"y":14,"rows":[".~.........~.","A~.........~A","AA..AA~AA..AA","AA~A.....A~AA",".IAA.~~~.AAI.",".AIA~.A.~AIA.","..AIAIAIAIA..","...AIAAAIA..."]},{"x":8,"y":16,"rows":["~..~~~~~..~",".~.......~.",".~~.....~~.","..AA~~~AA..","....AAA...."]},{"x":8,"y":15,"rows":["~.........~","I.........I","I.........I","AI.......IA","IAA~...~AAI",".IAI~.~IAI.",".AIAIAIAIA.","..AAAAAAA.."]},{"x":8,"y":16,"rows":["~..IA~AI..~","A~.......~A","AA~.....~II",".AAI~.~I~~.","..IAIAIAI..","...AAIAA..."]},{"x":8,"y":13,"rows":["y.........y","Iy.......yI",".Ay.....yA.",".IAy.y.yAI.","..IAIAIAI..","...AAAAA..."]},{"x":8,"y":15,"rows":[".~.~~~~~.~.","~~.~...~.~~","~~~~...~~~~",".~~~.~.~~~.","..~~~~~~~..","...~~~~~..."]},{"x":8,"y":15,"rows":["~.........~","~..~~.~~..~","A.~.....~.A","A~A.....A~A",".AIA~A~AIA.","..AIAIAIA..","..AAIAIAA..","...AAAAA..."]},{"x":8,"y":15,"rows":["~..~~~~~..~","~.........~",".~.......~.","..~~.~.~~..","...~~~~~..."]},{"x":8,"y":15,"rows":["y..yyyyy..y","y.........y",".yy.....yy.","..yy.y.yy..","...yyyyy..."]},{"x":9,"y":17,"rows":["~.......~","A~.....~A",".A~...~A.","..aAaAa..","...aAa..."]},{"x":8,"y":15,"rows":["~.........~","~.........~",".~.......~.","..~~.~.~~..","...~~~~~..."]},{"x":9,"y":11,"rows":["y.......y","A.......A","a.AAyAA.a","AA.....AA","Ay.....yA","aA.....Aa","AaAaAaAaA",".AaAaAaA.","..aaaaA.."]},{"x":7,"y":14,"rows":[".~.........~.","A~.........~A","AA..AA~AA..AA","AA~A.....A~AA",".IAA.....AAI.",".AIA~...~AIA.","..AIAIAIAIA..","...AIAAAIA..."]},{"x":9,"y":13,"rows":["..~~~~~..",".~.....~.",".A.....A.","yAIyIyIAy","..AIAIA..","...AAA..."]},{"x":8,"y":16,"rows":["~.........~","A~.......~A",".A~.....~A.","..AA~~~AA..","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","A..IAIAI..A","a.I.....I.a",".aA.....Aa.",".AaA...AaA.","..AIAIAIA..","...AIAIA..."]},{"x":11,"y":16,"rows":["AaAaA",".AaA."]},{"x":9,"y":14,"rows":["...~~~...","~...~...~",".~AIAIA~.","...AIA..."]},{"x":10,"y":13,"rows":[".~~.~~.","~.....~","~.....~","A~.~.~A",".A~.~A.","..AAA.."]},{"x":8,"y":15,"rows":["...AA~AA...","~.........~","~~.......~~",".~~.~.~.~~.","..~AAAAA~.."]},{"x":8,"y":12,"rows":["a.........a","a..yy.yy..a","A.........A","aA.......Aa","AaA.....AaA",".AaAaAaAaA.","..AaAaAaA..","...AaAaA..."]},{"x":8,"y":12,"rows":["y.........y","I..yAAAy..I","Iy.......yI",".Iy..y..yI.",".AIy...yIA.","..AIAIAIA..","...AAAAA..."]},{"x":8,"y":16,"rows":["...AA~AA...","~.~.....~.~","A.A.~~~.A.A","A~A~.A.~A~A",".AIAIAIAIA.","..AIAAAIA.."]},{"x":8,"y":15,"rows":["y..yyyyy..y","y.........y",".y.......y.",".yy.....yy.","..yyyyyyy..","...yyyyy..."]},{"x":11,"y":14,"rows":["..~..",".A~A.","aaAaa",".AaA."]},{"x":8,"y":15,"rows":["y..yyyyy..y","yyy.....yyy",".yy.....yy.","..yyyyyyy..","...yyyyy..."]},{"x":8,"y":11,"rows":["~.........~","A.........A","I..~~~~~..I","A.~.....~.A","IAI.~A~.IAI","AIA..~..AIA","IAIAIAIAIAI",".IAAAAAAAI.","...AIAIA..."]},{"x":10,"y":14,"rows":["...~...","~.....~",".AAIAA.","..IAI.."]},{"x":10,"y":13,"rows":[".~~.~~.","~.....~","~.....~","A~...~A","~AAAAA~",".~AAA~."]},{"x":9,"y":13,"rows":["...AAA...","..~...~..","~.~.~.~.~","~~A~.~A~~",".~AAAAA~.","..~AAA~.."]},{"x":9,"y":19,"rows":["~.~...~.~",".~A~~~A~.","..AAAAA.."]},{"x":8,"y":11,"rows":["~.........~","A.........A","I..~~~~~..I","A.~.....~.A","IAI.~A~.IAI","AIA.....AIA","IAIAIAIAIAI",".IAAAAAAAI.","...AIAIA..."]},{"x":7,"y":13,"rows":[".~.........~.",".~.........~.","AI.........IA","AA.~.....~.AA","AIAI.....IAIA",".AIAI~~~IAIA.",".AAIAIAIAIAA.","..AAIAIAIAA..","....AAAAA...."]},{"x":9,"y":17,"rows":["~.......~",".~.....~.","..~~~~~..","...~~~..."]},{"x":8,"y":12,"rows":["y.........y","A..AayaA..A","a.A.....A.a","AaA.yyy.AaA",".AaAaAaAaA.","..AaAaAaA..","...aaaaA..."]},{"x":8,"y":15,"rows":["~.........~","~..IA~AI..~","A~.~...~.~A","AA~A...A~II","AAAI~.~IAAA",".AIAIAIAIA.","..AAAIAAA.."]},{"x":9,"y":13,"rows":["..yAyAy..","y.y...y.y","IyA.y.AyI","AIAIAIAIA","AAIAIAIAA","..AAAAA.."]},{"x":8,"y":14,"rows":["y.........y","yy.yyyyy.yy","yyy.....yyy",".yy..y..yy.","..yyyyyyy..","...yyyyy..."]},{"x":8,"y":15,"rows":["~.........~","~..IA~AI..~","A~.~...~.~A","AA~A...A~II","AAAI~.~IAAA",".AIAIAIAIA.","..AAAIAAA..","...AAAAA..."]},{"x":8,"y":12,"rows":["y.........y","A.........A","Ay.......yA",".Ay.....yA.",".AA.....AA.","..A..y..A..","...AAAAA..."]},{"x":9,"y":17,"rows":["y.......y",".yy...yy.","..yyyyy.."]},{"x":8,"y":16,"rows":["~..AA~AA..~","~~A.....A~~","A~A~...~A~A",".AAA~~~AAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":12,"rows":["y.........y","I.........I","Ay.......yA","IAy.....yAI",".IAIyyyIAA.","..IAAAAAA..","....AAA...."]},{"x":8,"y":10,"rows":["y.........y","I.........I","A.........A","I..yI.Iy..I","AIy.....yIA","IAI..y..IAI","AIAy.I.yAIA","AAIAIAIAIAA",".AAIAIAIAA.","..AIAIAIA..","....AIA...."]},{"x":8,"y":15,"rows":["y..yyyyy..y","Ayy.....yyA","AAy.....yAA",".AAyyyyyAA.","..AIAyAIA..","...AIAIA..."]},{"x":8,"y":16,"rows":["~.........~","~.........~",".~~.....~~.","..AA~~~AA..","....AAA...."]},{"x":8,"y":12,"rows":["y.........y","A..yyyyy..A","Ay.......yA",".A.......A.",".IAy...yAI.","..IAIyIAI..","...IAAAI..."]},{"x":8,"y":13,"rows":["~.........~","~.........~","~.........~","~~.......~~","A~.......~A",".A~.....~A.","..AA~~~AA..","...AAAAA...","....AAA...."]},{"x":8,"y":12,"rows":["I.........I","Ay.yyyyy.yA","AAyy...yyAA",".AI.yyy.IA.",".AAy.y.yAA.","..IUUAUUI..","...UIAIU..."]},{"x":8,"y":13,"rows":["y...UIU...y","A..UIUIU..A",".IyI...IyI.",".AIUyyyUIA.","..AI.y.IA..","...AAIAA...","....IAI...."]},{"x":8,"y":14,"rows":["~..~~~~~..~","A.~.....~.A","A~A.~A~.A~A","AIUI.~.IUIA",".AIAAAAAIA.",".IAIAIUIAI.","..IUIAIUI.."]},{"x":8,"y":12,"rows":["A.........A","Ay..aya..yA","IA.a...a.AI",".IAaAaAaAI.",".IAAaAaAAI.","..AUIUIUA..","...IUIUI..."]},{"x":9,"y":15,"rows":["~.~~~~~.~","~.~...~.~",".~.....~.",".~~.~.~~.","..~~~~~.."]},{"x":9,"y":13,"rows":["..yAAAy..","y.y...y.y","Ayy.y.yyA",".AyyIyyA.",".IAIAIAI.","..AAIAA.."]},{"x":8,"y":15,"rows":["~.........~","~..~~~~~..~","A~~.....~~A","AA~..~..~II",".AAI~~~IAA.","..IAIAIAI..","...AAIAA..."]},{"x":7,"y":12,"rows":["I~.........~I","II.........II","II.........II","II..~~.~~..II","II~I.....I~II","AIII.....IIIA","IAIA~~~~~AIAI",".AAIAIAIAIAA.","..AAAAAAAAA..","....AAAAA...."]},{"x":11,"y":15,"rows":["..~..","~~~~~",".AaA."]},{"x":8,"y":11,"rows":["~.........~","A.........A","I..~~~~~..I","A.~.....~.A","IAI.~A~.IAI","AIA..~..AIA",".AIAIAIAIA.",".IAAAAAAAI.","..AAIAIAA..","....AAA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..AA~AA..A","A~A.....A~A","AAA.....AAA",".AAA...AAA.","..AAAAAAA..","...AAAAA..."]},{"x":8,"y":14,"rows":["~.........~","A..~~~~~..A","A.........A",".~.......~.",".~A.....A~.","..~AA~AA~..","...AAAAA..."]},{"x":9,"y":15,"rows":[".A.....A.","yAIyIyIAy","..AIAIA..","...AAA..."]},{"x":8,"y":15,"rows":["~.........~","~..~~~~~..~","A.........A","A~A~...~A~A",".AIA~~~AIA.","..AIAAAIA..","....AAA...."]},{"x":10,"y":16,"rows":[".yyyyy.","y.....y","y.yyy.y","yyyyyyy","yyyyyyy",".yyyyy."]},{"x":9,"y":9,"rows":["..~...~..",".........",".........",".........",".........","~.~...~.~",".~~~~~~~.",".~~~~~~~.","..~~~~~..","...~~~..."]},{"x":8,"y":14,"rows":["y.........y","Ay.AaAaA.yA","aAy.....yAa",".aAy.y.yAa.","..aaAaAaa..","...AaAaA..."]},{"x":9,"y":13,"rows":["..~~~~~..","..~...~..","~.~...~.~",".A~.~.~A.","..AUIUA..","...AAA..."]},{"x":10,"y":13,"rows":[".~~.~~.","~.....~","~.....~","A~.~.~A",".AUIUA.","..AAA.."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI.........IA","AA~.~...~.~AA",".IA~I.~.I~AI.",".AIAA...AAIA.","..AIAIAIAIA..","..IAAAAAAAI..","....AIAIA...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..IA~AI..A","I~~.....~~I","AIA.~~~.AIA","AAIAIAIAIAA","AAAIAAAIAAA",".AAAAAAAAA.","...AAAAA..."]},{"x":8,"y":12,"rows":["y.........y","y..IAyAI..y","yy.......yy","Ayy..y..yyA",".AAyyyyyAA.","..AAIAIAA..","...AAAAA..."]},{"x":7,"y":10,"rows":[".y.........y.",".I.........I.",".A.........A.","AI..IA.AI..IA","aAyI.....IyAa","AIAI..A..IAIA","aAIAyAIAyAIAa","AaAIAIAIAIAaA",".AaAIaIaIAaA.","...aaAaAaa...",".....aaa....."]},{"x":10,"y":13,"rows":[".~~.~~.","~.....~","~.....~","I~.~.~I","AIAIAIA",".AAAAA."]},{"x":10,"y":16,"rows":["~..~..~","AA~A~AA","ZAZAZAZ",".ZAZAZ."]},{"x":8,"y":14,"rows":["~.........~","A..AAAAA..A","a~A.....A~a","AaA.....AaA","aAaA~~~AaAa",".aAaAaAaAa.","..aaaaaaa.."]},{"x":8,"y":11,"rows":["~.........~","A.........A","I..~~~~~..I","A~.~...~.~A","IA~.....~AI","AIAA~.~AAIA","aAaAIAIAaAa",".aaaAaAaaa.","...aaaaa..."]},{"x":10,"y":17,"rows":["yAIAIAy",".yAAAy."]},{"x":8,"y":12,"rows":["~.........~","~.........~","~.........~","~~.......~~",".~A~...~A~.","..AAIAIAA..","...IAIAI..."]},{"x":8,"y":14,"rows":["~.........~","I..II~II..I","A~I.....I~A","AAA..I..AAA","AAIAIAIAIAA",".AAIAIAIAA.","..AAAAAAA.."]},{"x":8,"y":14,"rows":["~.........~","~.........~","A..AA~AA..A","A~A.....A~A","AAI.....IAA","AAAA~A~AAAA",".AIAIAIAIA.",".AAIAIAIAA.","..AAAAAAA.."]},{"x":8,"y":15,"rows":["~..~~~~~..~","~~.......~~","~~~.....~~~",".~~~.~.~~~.","..~~~~~~~..","...~~~~~..."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI..~~~~~..IA","AA.........AA","AI~.......~IA","IAA~.....~AAI",".IAAA~~~AAAI.","..IAAAAAAAI..","....AIAIA...."]},{"x":8,"y":12,"rows":["~.........~","~.........~","A..~~~~~..A","A.~.....~.A","A~A.....A~A","AAIA...AIAA",".AAIAIAIAA.","..AAIAIAA..","....AAA...."]},{"x":8,"y":11,"rows":["y.........y","A.........A","a..yy.yy..a","Ay.......yA","aAy.....yAa","AaAy.y.yAaA",".AaAaAaAaA.","..AaAaAaA..","...AaAaA...","....aaa...."]},{"x":8,"y":14,"rows":["~.........~","~.........~","~..~~~~~..~","~~.......~~",".~~.....~~.","..~~...~~..","...~~~~~...","....~~~...."]},{"x":7,"y":13,"rows":["A...~~~~~...A","A~..~...~..~A","AIA~.....~AIA","AAIA~...~AIAA",".aAaA~.~AaAa.","..aaaAaAaaa..","....aaaaa...."]},{"x":10,"y":13,"rows":[".~~~~~.","~.....~","A..~..A","AI~.~IA","AAIAIAA",".AAIAA.","..AAA.."]},{"x":9,"y":13,"rows":["..~~.~~..",".~.....~.",".~.....~.","~A~.~.~A~",".~A~A~A~.","..IAIAI..","...AAA..."]},{"x":7,"y":13,"rows":["A...........A",".Ay..yIy..yA.",".IAy..y..yAI.","..IA.AIA.AA..","...IAIAIAA...",".....AIA....."]},{"x":8,"y":12,"rows":["y.........y","A..AAyAA..A","A.A.....A.A","a.y.....y.a","AaA.....AaA",".AaAaAaAaA.","..AaAaAaA..","...aaaaA..."]},{"x":8,"y":14,"rows":["~.........~","A..~~~~~..A","A~.......~A",".~.......~.","..~.~~~.~..","...AAAAA..."]},{"x":8,"y":15,"rows":["~.........~","~..~~~~~..~","A.........A",".A~.....~A.",".AA.~~~.AA.","..AIAAAIA..","...AAAAA..."]},{"x":8,"y":13,"rows":["~.........~","~...~~~...~","I..~...~..I","A~.I~~~I.~A",".A~A~A~A~A.","..AIAIAIA..","...AIAIA...","....AAA...."]},{"x":8,"y":15,"rows":["y..yyyyy..y","yy.......yy",".yy..y..yy.","..yyyyyyy..","...yyyyy..."]},{"x":8,"y":14,"rows":["y.........y","A..yy.yy..A","ay.......ya",".ay.....ya.",".Aay...yaA.","..AIAIAIA..","...AIAIA..."]},{"x":7,"y":11,"rows":[".~.........~.",".A.........A.","AI..~~~~~..IA","AA~.~...~.~AA","AAA~A.~.A~AAA","AAIAI...IAIAA",".AAIAIAIAIAA.","..AAIAIAIAA..","....AAAAA...."]}],"piercing":[{"x":19,"y":12,"rows":["ĸ"]},{"x":7,"y":12,"rows":["ĸ...........ĸ"]},{"x":7,"y":12,"rows":["Ĺ...........Ĺ"]},{"x":12,"y":13,"rows":["ĸ"]},{"x":7,"y":12,"rows":["ĸ"]},{"x":19,"y":12,"rows":["Ĺ"]},{"x":7,"y":12,"rows":["Ĺ"]},{"x":7,"y":11,"rows":["........ĺ....","ĸ...........ĸ"]},{"x":7,"y":12,"rows":["ĸ.......ĺ...ĸ","ĺ...........ĺ","ĸ...........ĸ"]},{"x":13,"y":13,"rows":["Ļ"]},{"x":7,"y":12,"rows":["ĸ...........ĸ","ĺ...........ĺ"]},{"x":7,"y":12,"rows":["ĸ...........ĸ","............ĺ"]},{"x":19,"y":12,"rows":["ĸ","ĺ"]},{"x":7,"y":12,"rows":["ĸ","ĺ"]},{"x":7,"y":12,"rows":["ļ...........ļ"]},{"x":18,"y":12,"rows":["ĸ"]},{"x":8,"y":12,"rows":["ļ.........ļ"]},{"x":8,"y":12,"rows":["ĸ","ĸ"]},{"x":8,"y":12,"rows":["Ĺ.........Ĺ"]},{"x":8,"y":12,"rows":["ĸ.........ĸ"]},{"x":15,"y":11,"rows":["ĺ"]},{"x":11,"y":11,"rows":["ĺ"]},{"x":7,"y":12,"rows":["....ĺ........","ĺ...........ĺ"]}],"mustache":[{"x":11,"y":13,"rows":[".AAA.","A...A"]},{"x":12,"y":13,"rows":["AAA"]},{"x":11,"y":13,"rows":["AA.AA"]},{"x":11,"y":12,"rows":["AAAAA"]},{"x":11,"y":12,"rows":["AAAAA","I...I"]},{"x":11,"y":12,"rows":["~~~~~"]},{"x":11,"y":12,"rows":["~~.~~"]},{"x":10,"y":12,"rows":[".AAAAA.","~.....~",".......","..~~~.."]},{"x":11,"y":12,"rows":[".~.~.","~...~"]},{"x":11,"y":13,"rows":[".~~~.","~...~"]},{"x":11,"y":12,"rows":["~AAA~","I...I","~...~","~...~"]},{"x":12,"y":13,"rows":["~~~"]},{"x":10,"y":12,"rows":[".AAAAA.","~.....~"]},{"x":11,"y":12,"rows":["AA~AA","I...I","~...~"]},{"x":10,"y":12,"rows":[".AayaA.","y.....y","...y..."]}]};
},
"sprite-test/lib/game/characters/retro-heads.json": function (module, exports, require) {
module.exports = {"styles":[{"id":"bald","label":"Bald","image":"/sprites/retro/heads/bald.png"},{"id":"buzz","label":"Buzz","image":"/sprites/retro/heads/buzz.png"},{"id":"short","label":"Short","image":"/sprites/retro/heads/short.png"},{"id":"flattop","label":"Flattop","image":"/sprites/retro/heads/flattop.png"},{"id":"curly","label":"Curly","image":"/sprites/retro/heads/curly.png"},{"id":"spiky","label":"Spiky","image":"/sprites/retro/heads/spiky.png"},{"id":"afro","label":"Afro","image":"/sprites/retro/heads/afro.png"},{"id":"long","label":"Long","image":"/sprites/retro/heads/long.png"},{"id":"mohawk","label":"Mohawk","image":"/sprites/retro/heads/mohawk.png"},{"id":"sidepart","label":"Side part","image":"/sprites/retro/heads/sidepart.png"},{"id":"slick","label":"Slicked back","image":"/sprites/retro/heads/slick.png"},{"id":"cornrows","label":"Cornrows","image":"/sprites/retro/heads/cornrows.png"},{"id":"dreads","label":"Dreads","image":"/sprites/retro/heads/dreads.png"},{"id":"manbun","label":"Man bun","image":"/sprites/retro/heads/manbun.png"},{"id":"mullet","label":"Mullet","image":"/sprites/retro/heads/mullet.png"},{"id":"curtains","label":"Curtains","image":"/sprites/retro/heads/curtains.png"},{"id":"bowl","label":"Bowl cut","image":"/sprites/retro/heads/bowl.png"}],"facial":"/sprites/retro/heads/facial.png"};
},
"sprite-test/lib/game/characters/retro-helmets.json": function (module, exports, require) {
module.exports = {"regular":["..........OOOOOOo..........","........OOiiiHHHhoo........","......OOwiiiiHHHHhhoo......",".....OwwiiiiHHHHHHhhho.....",".....OiiiiiHHHHHHhhhho.....",".....OHiiHHHHHHHHhhhho.....",".....OHHHHHHHHHHhhhhho.....",".....OHHHHHHHHHhhhhhho.....",".....Ohhhooooooooohhho.....",".....oHHo.........ohho.....",".....opHo.........ohpo.....",".....oHHo.........ohho.....",".....oHHo.........ohho.....",".....oHHo.........ohho.....","......oHo.........oho......",".......oo.........oo.......","..........................."],"speed":["..........OOOOOOo..........","........OOwiiHHHhoo........",".......OwiiiiHHHHhho.......","......OwpiiiHHHHHhpho......","......OiiiiHHHHHHhhho......",".....OHpiHHHHHHHHhhpho.....",".....OHHHHHHHHHHhhhhho.....",".....OHHHHHHHHhhhhhhho.....",".....Ohhhooooooooohhho.....",".....oHHo.........ohho.....",".....oHHo.........ohho.....","....oHHHo.........ohhho....","....oHHHo.........ohhho....","....oHHHo.........ohhho....","....oHHHo.........ohhho....",".....oHHo.........ohho.....","......ooo.........ooo......"],"bubble":[".........OOOOOOOoo.........","......OOOiiiiHHHHhOoo......",".....OwwiiiiiHHHHHhhho.....","....OwiiiiiiHHHHHHhhhho....","....OiiiiiiHHHHHHHhhhho....","....OHiiiHHHHHHHHhhhhho....","....OHHHHHHHHHHHhhhhhho....","....OHHHHHHHHHHhhhhhhho....","....ohhhhooooooooohhhho....",".....oHHo.........ohho.....",".....opHo.........ohpo.....","......oHo.........oho......","......oHo.........oho......",".......oo.........oo.......","........o.........o........","...........................","..........................."],"angular":[".......OOOOOOOOOOOoo.......","......OwwHHHHHHHHHhho......",".....OHHHHHHHHHHHHhhho.....",".....OHHHHHHHHHHHHhhho.....",".....OHHHHHHHHHHHHhhho.....",".....OHHHHHHHHHHHHhhho.....",".....OHHHHHHHHHHHHhhho.....",".....OHHHHHHHHhhhhhhho.....",".....Ohhhooooooooohhho.....",".....oHHo.........ohho.....",".....opHo.........ohpo.....",".....oHHo.........ohho.....","......oHo.........oho......",".......oo.........oo.......","........o.........o........","...........................","..........................."],"leather":["..........OOOOOOo..........",".........OHHHhHHho.........",".........OHHHHHHho.........","........OHHHHhHHhho........","........OHHHHHHHhho........","........OHHHHhHhhho........","........OHHHHHHhhho........","........OHHHHhhhhho........","........Ooooooooooo........",".......oo.........oo.......","......oHo.........oho......","......oHo.........oho......","......oHo.........oho......",".......oo.........oo.......","........o.........o........","...........................","..........................."]};
},
"sprite-test/lib/game/characters/retro-parts.json": function (module, exports, require) {
module.exports = {"image":"/sprites/retro/parts.png","ball":{"x":274,"y":47,"w":6,"h":4},"parts":[{"id":1,"key":"helmet","label":"Helmet","dualTone":false},{"id":2,"key":"helmetDecal","label":"Helmet decal","dualTone":false},{"id":3,"key":"facemask","label":"Facemask","dualTone":false},{"id":4,"key":"jersey","label":"Jersey","dualTone":false},{"id":5,"key":"sleeves","label":"Sleeves","dualTone":true},{"id":6,"key":"sockFront","label":"Sock (front leg)","dualTone":false},{"id":7,"key":"number","label":"Number","dualTone":true},{"id":8,"key":"pants","label":"Pants (front / back)","dualTone":true},{"id":9,"key":"pantStripe","label":"Pant stripe","dualTone":false},{"id":10,"key":"sockBack","label":"Sock (back leg)","dualTone":true},{"id":11,"key":"shoes","label":"Shoes","dualTone":true},{"id":12,"key":"skin","label":"Skin (face & arms)","dualTone":true},{"id":13,"key":"eyes","label":"Eyes","dualTone":false},{"id":14,"key":"ball","label":"Ball","dualTone":false}],"teams":{"Denver":{"helmet":["#0c2340"],"helmetDecal":["#ffffff"],"facemask":["#bdbdbd"],"jersey":["#fc4c02"],"sleeves":["#fc4c02","#c52000"],"sockFront":["#0c2340"],"number":["#ffffff","#bdbdbd"],"pants":["#ffffff","#bdbdbd"],"pantStripe":["#0c2340"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#05062d"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]},"Green Bay":{"helmet":["#ffb81c"],"helmetDecal":["#183029"],"facemask":["#bdbdbd"],"jersey":["#183029"],"sleeves":["#ffb81c","#d99d18"],"sockFront":["#183029"],"number":["#ffffff","#bdbdbd"],"pants":["#ffb81c","#d99d18"],"pantStripe":["#183029"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#09120f"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]},"Kansas City":{"helmet":["#df1818"],"helmetDecal":["#ffffff"],"facemask":["#bdbdbd"],"jersey":["#ffffff"],"sleeves":["#df1818","#ad122b"],"sockFront":["#ffc300"],"number":["#000000","#000000"],"pants":["#df1818","#ad122b"],"pantStripe":["#ffffff"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#c58701"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]},"Minnesota":{"helmet":["#582c83"],"helmetDecal":["#ffffff"],"facemask":["#bdbdbd"],"jersey":["#582c83"],"sleeves":["#ffc72c","#d99d18"],"sockFront":["#582c83"],"number":["#ffc72c","#d99d18"],"pants":["#ffffff","#bdbdbd"],"pantStripe":["#582c83"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#05062d"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]},"New York Giants":{"helmet":["#0c2340"],"helmetDecal":["#ffffff"],"facemask":["#bdbdbd"],"jersey":["#ffffff"],"sleeves":["#df1818","#ad122b"],"sockFront":["#0c2340"],"number":["#000000","#000000"],"pants":["#df1818","#ad122b"],"pantStripe":["#0c2340"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#05062d"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]},"Pittsburg":{"helmet":["#191919"],"helmetDecal":["#ffffff"],"facemask":["#bdbdbd"],"jersey":["#000000"],"sleeves":["#ffd200","#c0a007"],"sockFront":["#000000"],"number":["#ffffff","#bdbdbd"],"pants":["#ffd200","#c0a007"],"pantStripe":["#000000"],"sockBack":["#ffffff","#bdbdbd"],"shoes":["#000000","#000000"],"skin":["#e8a778","#c78663"],"eyes":["#000000"],"ball":["#763e17"]}}};
},
"sprite-test/lib/game/characters/retro-portrait.json": function (module, exports, require) {
module.exports = {"base":["...........................","...........................",".........kkkkkkkkk.........","........KkkkkkkkkkK........","........KkkQQQQQkkK........","........KkkkQQQkkkK........","........KkkkkkkkkkK........","........KkBBBkBBBkK........","........KekkkkkkkeK........","........KWEEkKkEEWK........","........KkkkkKkkkkK........","........KkkkKKKkkkK........","........KkkkkkkkkkK........","........KkkkkLkkkkK........",".........KkkkkkkkK.........","..........KkkkkkK..........","...........KKKKK...........","....JJJ....KkkkK....JJJ....","...JJJJJSkkkkkkkkkSJJJJJ...","..SSJJJJSSSkkkkkSSSJJJJSS..","..SSSJJJJSSSSkSSSSJJJJSSS..","...JSJJJJJJSSSSSJJJJJJSJ...","...kJJJJJJJJJJJJJJJJJJJk...","...kkKJJJJJJJJJJJJJJJKkk...","..kkkK.JJJJJJJJJJJJJ.Kkkk..","..kkkK.JJJJJJJJJJJJJ.Kkkk..","..kkkK.JJJJJJJJJJJJJ.Kkkk..",".kkkK..JJJJJJjJJJJJJ..Kkkk.",".kkkK...JJJJjjjJJJJ...Kkkk.",".kkK....JJJJjjjJJJJ....Kkk.",".kkK....JJJJjjjJJJJ....Kkk."],"facial":["...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................",".........b.......b.........",".........b.mmmmm.b.........",".........bb.....bb.........",".........bbbgggbbb.........","..........bbgggbb..........","...........bbbbb...........","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","...........................","..........................."],"hair":{"bald":[],"buzz":["...........................","...........................",".........AAAAAAAAA.........","........AAAAAAAAAAA........","........A.........A........"],"short":["...........................",".........AAAAAAAAA.........","........AAAIIAAAAAA........","........AAAAAAAAAAA........","........AA.......AA........","........A.........A........"],"flattop":[".........A.A.A.A.A.........","........AAAAAAAAAAA........","........AAAIAAAAAAA........","........AAAAAAAAAAA........","........A.........A........","........A.........A........","........A.........A........"],"curly":["........A.AIA.AIA.A........",".......AAAAAAAAAAAAA.......",".......AaAAIAAAaAAIA.......",".......AAAAAAAAAAAAA.......",".......AA.........AA.......",".......A...........A......."],"spiky":[".........A..I..A..I........","........AAAAAAAAAAA........","........AAAIAAAAIAA........","........AAAAAAAAAAA........","........A.........A........"],"afro":["........AAAAIIAAAAA........",".......AAAAAIAAAAAAA.......","......AAAAAAAAAAAAAAA......","......AAaAAAAAAAAaAAA......","......AA...........AA......","......AA...........AA......","......AA...........AA......",".......A...........A.......",".......A...........A......."],"long":["...........................",".........AAAAAAAAA.........","........AAAIIAAAAAA........","........AAAAAAAAAAA........",".......AAA.......AAA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......AA.........AA.......",".......Aa.........aA.......",".......Aa.........aA.......",".......Aa.........aA.......","........a.........a........","........a.........a........"],"mohawk":["............AIA............","............AIA............","............AAA............",".............A............."],"sidepart":["...........................",".........AA.AAAAAA.........","........AAA.IAAAAAA........","........AAAAAAAAAAA........","........AA.......AA........","........A.........A........"],"slick":["...........................",".........AAAAAAAAA.........","........AIIIIIIIIIA........","........AAIAAAAAIAA........","........AA.......AA........","........AA.......AA........","........A.........A........"],"cornrows":["...........................",".........AIAIAIAIA.........","........AAIAIAIAIAA........","........AIAIAIAIAIA........","........A.........A........"],"dreads":["........A.A.A.A.A.A........",".......AAAAAAAAAAAAA.......",".......AIAAIAAIAAIAA.......",".......AAAAAAAAAAAAA.......",".......AA.........AA.......","......AaA.........AaA......","......AaA.........AaA......","......AaA.........AaA......","......aaa.........aaa......","......AaA.........AaA......","......AaA.........AaA......","......AaA.........AaA......","......aaa.........aaa......","......AaA.........AaA......","......AaA.........AaA......","......AaA.........AaA......","......aaa.........aaa......","......AaA.........AaA......"],"manbun":["............AAA............","...........AIAAA...........","........AAAAAAAAAAA........","........AIIAAAAAIIA........","........AA.......AA........","........A.........A........"],"mullet":["...........................",".........AAAAAAAAA.........","........AAAIAAAAAAA........","........AAAAAAAAAAA........","........AA.......AA........","........A.........A........","........A.........A........","........A.........A........","........A.........A........","........A.........A........","........A.........A........","........A.........A........","........A.........A........",".......AA.........AA.......",".......AAA.......AAA.......","........AAA.....AAA........",".........AA.....AA........."],"curtains":["...........................",".........AAAAAAAAA.........","........AAAAA.AAAAA........","........AAIA...AIAA........","........AAA.....AAA........","........AA.......AA........","........AA.......AA........","........A.........A........"],"bowl":["...........................",".........AAAAAAAAA.........","........AAAIIAAAAAA........","........AAAAAAAAAAA........","........AAAAAAAAAAA........","........AIAAAAAAAIA........","........AA.......AA........","........A.........A........"]},"faces":{"classic":{},"square":{"14":"........KkkkkkkkkkK........","15":"........KkkkkkkkkkK........","16":"........KKKKKKKKKKK........"},"narrow":{"10":"........_KkkkKkkkK_........","11":"........_KkkKKKkkK_........","12":"........_KkkkkkkkK_........","13":"........_KkkkLkkkK_........","14":"........._KkkkkkK_........."},"heavy":{"6":"........KkBBBkBBBkK........","7":"........KkBBBBBBBkK........","8":"........KeKKkkkKKeK........"},"round":{"14":"........KkkkkkkkkkK........","15":".........KkkkkkkkK.........","16":"..........KKKKKKK.........."},"weathered":{"8":"........KeekkkkkeeK........","11":"........KkKkKKKkKkK........","12":"........KkKkkkkkKkK........"}},"extras":{"none":{},"eyeblack":{"11":".........EE.....EE........."},"glasses":{"8":".........EEE...EEE.........","9":"........E...EEE...E........","10":".........EEE...EEE........."},"shades":{"8":"........EEEEE.EEEEE........","9":"........EEEEEEEEEEE........","10":"........EEEEE.EEEEE........"}}};
},
"sprite-test/lib/game/customize": function (module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.overall = exports.POSITION_CORE = exports.RATING_KEYS = exports.POSITIONS = exports.SKIN_PRESETS = exports.EDITABLE_PARTS = exports.DEFAULT_TEAM = exports.PARTS_META = void 0;
exports.defaultPalette = defaultPalette;
exports.loadCustomPalette = loadCustomPalette;
exports.saveCustomPalette = saveCustomPalette;
exports.defaultPlayer = defaultPlayer;
exports.loadCustomPlayer = loadCustomPlayer;
exports.saveCustomPlayer = saveCustomPlayer;
const retro_parts_json_1 = __importDefault(require("./characters/retro-parts.json"));
const heads_1 = require("./heads");
const badges_1 = require("../sim/badges");
const attributes_1 = require("../sim/attributes");
const roster_1 = require("../sim/roster");
Object.defineProperty(exports, "POSITION_CORE", { enumerable: true, get: function () { return roster_1.POSITION_CORE; } });
Object.defineProperty(exports, "overall", { enumerable: true, get: function () { return roster_1.overall; } });
const roster_2 = require("./roster");
Object.defineProperty(exports, "RATING_KEYS", { enumerable: true, get: function () { return roster_2.RATING_KEYS; } });
const recolor_1 = require("./recolor");
exports.PARTS_META = retro_parts_json_1.default;
exports.DEFAULT_TEAM = "Minnesota";
const STORAGE_KEY = "retro-custom-palette-v2";
exports.EDITABLE_PARTS = [
    "helmet",
    "helmetDecal",
    "facemask",
    "jersey",
    "sleeves",
    "number",
    "pants",
    "pantStripe",
    "sockFront",
    "sockBack",
    "shoes",
    "skin",
    "eyes",
];
exports.SKIN_PRESETS = [
    { name: "Porcelain", tones: ["#f6dcc8", "#d9b79b"] },
    { name: "Fair", tones: ["#f1c9a5", "#d4a67f"] },
    { name: "Light", tones: ["#e8a778", "#c78663"] },
    { name: "Medium", tones: ["#d08b5b", "#a96b43"] },
    { name: "Tan", tones: ["#b97a4b", "#8f5a34"] },
    { name: "Brown", tones: ["#8d5524", "#6a3d19"] },
    { name: "Dark brown", tones: ["#6b4426", "#4a2c17"] },
    { name: "Deep", tones: ["#4e3220", "#342012"] },
];
function defaultPalette() {
    return { ...(0, recolor_1.teamPalette)(exports.PARTS_META, exports.DEFAULT_TEAM, false), head: { ...heads_1.DEFAULT_HEAD }, body: { ...recolor_1.DEFAULT_BODY } };
}
function loadCustomPalette() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return defaultPalette();
        const parsed = JSON.parse(raw);
        const base = defaultPalette();
        if (parsed.colors && typeof parsed.colors === "object") {
            for (const [k, v] of Object.entries(parsed.colors)) {
                if (Array.isArray(v) && v.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)))
                    base.colors[k] = v;
            }
        }
        base.showNumber = Boolean(parsed.showNumber);
        base.showStripe = parsed.showStripe !== false;
        base.ballOutline = parsed.ballOutline !== false;
        base.numberFont = parsed.numberFont === "rounded" ? "rounded" : "block";
        base.qbModel = parsed.qbModel === "chunky" ? "chunky" : "retro";
        const b = parsed.body;
        base.body = { ...recolor_1.DEFAULT_BODY };
        if (b && typeof b === "object") {
            if (recolor_1.BUILDS.some((x) => x.id === b.build))
                base.body.build = b.build;
            if (typeof b.height === "number")
                base.body.height = Math.max(64, Math.min(82, Math.round(b.height)));
            if (typeof b.weight === "number")
                base.body.weight = Math.max(150, Math.min(380, Math.round(b.weight)));
        }
        const h = parsed.head;
        if (h && typeof h === "object") {
            const style = typeof h.style === "string" && (h.style === "helmet" || heads_1.HEADS_META.styles.some((s) => s.id === h.style) || (0, heads_1.rbHairIndex)(h.style) !== null) ? h.style : "helmet";
            const hair = typeof h.hair === "string" && /^#[0-9a-f]{6}$/i.test(h.hair) ? h.hair : heads_1.DEFAULT_HEAD.hair;
            const facialHair = heads_1.FACIAL_HAIR.some((f) => f.id === h.facialHair) ? h.facialHair : "none";
            const helmet = heads_1.HELMET_SHELLS.some((x) => x.id === h.helmet) ? h.helmet : "regular";
            const facemask = heads_1.FACEMASKS.some((x) => x.id === h.facemask) ? h.facemask : "double";
            const face = heads_1.FACE_SHAPES.some((x) => x.id === h.face) ? h.face : "classic";
            const extra = heads_1.FACE_EXTRAS.some((x) => x.id === h.extra) ? h.extra : "none";
            const visor = heads_1.VISORS.some((x) => x.id === h.visor) ? h.visor : "none";
            const stripe = heads_1.HELMET_STRIPES.some((x) => x.id === h.stripe) ? h.stripe : "classic";
            const rb = {};
            if (h.rb && typeof h.rb === "object") {
                for (const k of heads_1.RB_KINDS) {
                    const v = h.rb[k];
                    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < heads_1.RB_PORTRAIT[k].length)
                        rb[k] = v;
                }
            }
            base.head = { style, hair, facialHair, helmet, facemask, face, extra, visor, stripe, rb };
        }
        else {
            base.head = { ...heads_1.DEFAULT_HEAD };
        }
        return base;
    }
    catch {
        return defaultPalette();
    }
}
function saveCustomPalette(p) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    }
    catch {
    }
}
const PLAYER_KEY = "retro-custom-player-v1";
exports.POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"];
function defaultPlayer() {
    return (0, attributes_1.withAttributes)({ id: "custom", name: "Your Player", number: 7, position: "QB", attributes: {}, ratings: {}, badges: [] }, (0, attributes_1.averageAttributes)("QB"));
}
function loadCustomPlayer() {
    const base = defaultPlayer();
    try {
        const raw = window.localStorage.getItem(PLAYER_KEY);
        if (!raw)
            return base;
        const p = JSON.parse(raw);
        if (typeof p.name === "string" && p.name.trim())
            base.name = p.name.slice(0, 32);
        if (typeof p.number === "number" && p.number >= 0 && p.number <= 99)
            base.number = Math.round(p.number);
        if (exports.POSITIONS.includes(p.position))
            base.position = p.position;
        const avg = (0, attributes_1.averageAttributes)(base.position);
        const attributes = (0, attributes_1.parseAttributes)(p.attributes, avg) ?? (p.ratings && typeof p.ratings === "object" ? (0, attributes_1.attributesFromRatings)(base.position, p.ratings) : avg);
        Object.assign(base, (0, attributes_1.withAttributes)(base, attributes));
        if (Array.isArray(p.badges))
            base.badges = p.badges.filter((b) => typeof b === "string" && b in badges_1.BADGES && badges_1.BADGES[b].positions.includes(base.position));
        return base;
    }
    catch {
        return base;
    }
}
function saveCustomPlayer(p) {
    try {
        window.localStorage.setItem(PLAYER_KEY, JSON.stringify((0, attributes_1.forSaving)(p)));
    }
    catch {
    }
}
},
"sprite-test/lib/game/defense": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_TAGS = exports.COVER_COLORS = exports.COVER_TAGS = exports.DEFAULT_DEFENSE = exports.SHELLS = void 0;
exports.coverTraits = coverTraits;
exports.alignSafety = alignSafety;
exports.zone = zone;
exports.alignDefender = alignDefender;
exports.cover = cover;
exports.readThrow = readThrow;
exports.contestCatch = contestCatch;
exports.defenderReach = defenderReach;
exports.defenderPlay = defenderPlay;
const build_ratings_1 = require("./build-ratings");
const pass_1 = require("./pass");
exports.SHELLS = [{ id: "cover1", label: "Cover 1" }, { id: "cover2", label: "Cover 2" }];
exports.DEFAULT_DEFENSE = { speed: 50, man: 50, ball: 50, leverage: "inside", shell: "cover1", rush: true };
exports.COVER_TAGS = {
    set: "", pedal: "PEDAL", drive: "DRIVE", turn: "TURN", inPhase: "IN PHASE", trail: "TRAIL", beaten: "BEATEN", ball: "BALL!", zone: "DEEP",
    robber: "ROBBER", half: "DEEP HALF", middle: "DEEP MIDDLE",
};
exports.COVER_COLORS = {
    set: "#fff", pedal: "#c9d3ff", drive: "#ffd34d", turn: "#ffd34d", inPhase: "#ff6b6b", trail: "#ffb05a", beaten: "#7dffa0", ball: "#ff6b6b", zone: "#c9d3ff",
    robber: "#9fe8ff", half: "#9fe8ff", middle: "#9fe8ff",
};
const YD = 14;
const ACCEL = 300;
function coverTraits(s) {
    const man = (0, build_ratings_1.ratingQuality)(s.man);
    const ball = (0, build_ratings_1.ratingQuality)(s.ball);
    const speed = (0, build_ratings_1.ratingQuality)(s.speed);
    return {
        react: 0.4 - 0.25 * man,
        hips: 0.35 - 0.23 * man,
        speed: 0.9 + 0.2 * speed,
        findBall: 1.0 - 0.6 * ball,
        ball,
        man,
    };
}
const STEADY_OVER = 0.25;
const STEADY_COS = Math.cos((15 * Math.PI) / 180);
const LEVERAGE = 0.7 * YD;
const CLOSE = 2.5;
const GIVE = 0.5;
const DRIVE = 5 * YD;
const TURN_AT = 2.5 * YD;
const DRIVE_COMMIT = 0.25;
exports.ROLE_TAGS = { cb: "CB", nickel: "NB", lb: "LB", fs: "FS", ss: "SS" };
const ROLES = {
    cb: { off: 7, speed: 1 },
    nickel: { off: 5, speed: 0.99 },
    lb: { off: 5, fromLine: true, speed: 0.93 },
    fs: { off: 13, fromLine: true, speed: 0.98 },
    ss: { off: 13, fromLine: true, speed: 0.97 },
};
function alignSafety(role, shell, dir, los, middleY, strong, baseSpeed, skills) {
    const r = ROLES[role];
    const half = role === "ss" ? strong : -strong;
    const job = shell === "cover2" ? "half" : role === "fs" ? "middle" : "robber";
    const robber = job === "robber";
    const y = shell === "cover2" ? middleY + half * 6 * YD : robber ? middleY + strong * 6 * YD : middleY;
    const x = los + dir * (robber ? 8 : r.off) * YD;
    return {
        x, y, vx: 0, vy: 0,
        man: -1, job, half, looks: [], dir, side: 1, manStart: los, cushion: 0, turned: false, drove: 0, phase: "set", turning: 0, seen: [], ballAt: null, skills,
        role, base: baseSpeed * r.speed,
    };
}
const OVER_TOP = 3.5 * YD;
const LEAD = 0.8;
const TURN_DEEP = 8 * YD;
const DEEP_MIN = 12 * YD;
const ROB_DEPTH = 9 * YD;
const ROB_WIDE = 9 * YD;
function zone(d, men, t, los, middleY, fieldH, pass, dt) {
    const tr = coverTraits(d.skills);
    const top = d.base * tr.speed;
    const looks = (d.looks ??= []);
    looks.push({ t, men: men.map((m) => ({ ...m })) });
    while (looks.length > 2 && looks[1].t <= t - tr.react)
        looks.shift();
    const seen = looks[0].men;
    const depthOf = (m) => (m.x - los) * d.dir;
    let want;
    let cap = top;
    if (pass && !pass.done && d.ballAt !== null && t >= d.ballAt) {
        d.phase = "ball";
        const left = Math.max(0.1, pass.arrive - pass.t);
        want = { vx: (pass.to.x - d.x) / left, vy: (pass.to.y - d.y) / left };
        cap = top * 1.08;
    }
    else if (d.job === "robber") {
        d.phase = "robber";
        const under = seen.filter((m) => depthOf(m) > 3 * YD && depthOf(m) < 15 * YD && Math.abs(m.y - middleY) < ROB_WIDE + 3 * YD)
            .sort((a, b) => Math.abs(a.y - middleY) - Math.abs(b.y - middleY))[0];
        const y = under ? Math.max(middleY - ROB_WIDE, Math.min(middleY + ROB_WIDE, under.y + under.vy * 0.3)) : middleY;
        cap = top * 0.85;
        want = toward(d, { x: los + d.dir * ROB_DEPTH, y }, cap);
    }
    else {
        const landmark = d.job === "half" ? middleY + (d.half ?? 1) * 9 * YD : middleY;
        const mine = d.job === "half" ? seen.filter((m) => (m.y - middleY) * (d.half ?? 1) > -3 * YD) : seen;
        const deep = mine.filter((m) => depthOf(m) > 6 * YD).sort((a, b) => depthOf(b) - depthOf(a))[0];
        const depth = Math.max(DEEP_MIN, deep ? depthOf(deep) + Math.max(0, deep.vx * d.dir) * LEAD + OVER_TOP : DEEP_MIN);
        const y = deep ? landmark + (deep.y - landmark) * (d.job === "half" ? 0.6 : 0.35) : landmark;
        d.phase = d.job === "half" ? "half" : "middle";
        const closing = deep ? depthOf(d) - depthOf(deep) < TURN_DEEP : false;
        cap = closing ? top : top * 0.8;
        want = toward(d, { x: los + d.dir * Math.min(depth, 48 * YD), y: Math.max(3 * YD, Math.min(fieldH - 3 * YD, y)) }, cap);
    }
    const mag = Math.hypot(want.vx, want.vy);
    if (mag > cap) {
        want.vx *= cap / mag;
        want.vy *= cap / mag;
    }
    const dvx = want.vx - d.vx;
    const dvy = want.vy - d.vy;
    const dv = Math.hypot(dvx, dvy);
    const k = dv > 0 ? Math.min(1, (ACCEL * dt) / dv) : 0;
    d.vx += dvx * k;
    d.vy += dvy * k;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
}
function alignDefender(role, man, index, dir, los, middleY, baseSpeed, skills) {
    const r = ROLES[role];
    const inside = man.y < middleY ? 1 : -1;
    const side = skills.leverage === "outside" ? -inside : inside;
    const x = r.fromLine ? los + dir * r.off * YD : man.x + dir * r.off * YD;
    return {
        x, y: man.y + side * YD, vx: 0, vy: 0,
        man: index, dir, side, manStart: man.x, cushion: (x - man.x) * dir, turned: false, drove: 0, phase: "set", turning: 0, seen: [], ballAt: null, skills,
        role, base: baseSpeed * r.speed,
    };
}
function cover(d, m, t, los, pass, dt) {
    const tr = coverTraits(d.skills);
    d.seen.push({ t, x: m.x, y: m.y, vx: m.vx, vy: m.vy });
    while (d.seen.length > 2 && d.seen[1].t <= t - tr.react - STEADY_OVER)
        d.seen.shift();
    const s = d.seen.find((q) => q.t >= t - tr.react) ?? d.seen[d.seen.length - 1];
    const before = d.seen[0];
    const top = d.base * tr.speed;
    let want;
    let cap = top;
    if (m.blocks) {
        d.phase = "zone";
        want = toward(d, { x: los + d.dir * 12 * YD, y: d.y }, top * 0.6);
    }
    else if (pass && !pass.done && d.ballAt !== null && t >= d.ballAt && (d.phase === "ball" || Math.hypot(m.x - d.x, m.y - d.y) < 1.4 * YD || (pass.to.x - d.x) * d.dir < 0)) {
        d.phase = "ball";
        const left = Math.max(0.1, pass.arrive - pass.t);
        const gx = d.x - pass.to.x;
        const gy = d.y - pass.to.y;
        const g = Math.hypot(gx, gy) || 1;
        const spot = { x: pass.to.x + (gx / g) * Math.min(g, 0.7 * YD), y: pass.to.y + (gy / g) * Math.min(g, 0.7 * YD) };
        want = { vx: (spot.x - d.x) / left, vy: (spot.y - d.y) / left };
        cap = (pass.to.x - d.x) * d.dir > 0 ? top * 1.12 : top * 0.92;
    }
    else {
        const vertical = s.vx * d.dir > m.speed * 0.45;
        const driving = (!vertical && s.t > 0.5) || d.drove >= DRIVE_COMMIT;
        if (driving && s.t > 0.7)
            d.drove += dt;
        if (driving)
            d.cushion = Math.max(0, d.cushion - DRIVE * dt);
        const came = Math.max(0, (s.x - d.manStart) * d.dir);
        const cushion = Math.max(0, d.cushion - came * GIVE);
        if (!d.turned && cushion <= TURN_AT) {
            d.turned = true;
            d.turning = driving ? 0 : tr.hips;
        }
        if (d.turning > 0)
            d.turning -= dt;
        cap = driving ? top * 0.9 : !d.turned ? top * 0.55 : d.turning > 0 ? top * 0.45 : top;
        const sv = Math.hypot(s.vx, s.vy);
        const bv = Math.hypot(before.vx, before.vy);
        const steady = sv > m.speed * 0.5 && bv > m.speed * 0.5 && (s.vx * before.vx + s.vy * before.vy) / (sv * bv) > STEADY_COS;
        const read = steady ? tr.react * tr.man * tr.man : 0;
        const spot = { x: s.x + s.vx * read + d.dir * cushion, y: s.y + s.vy * read + d.side * LEVERAGE };
        want = { vx: s.vx + (spot.x - d.x) * CLOSE, vy: s.vy + (spot.y - d.y) * CLOSE };
        const sep = Math.hypot(m.x - d.x, m.y - d.y);
        d.phase = driving && sep >= 1.3 * YD ? "drive" : !d.turned ? "pedal" : d.turning > 0 ? "turn" : s.vx * d.dir < -0.2 * m.speed ? "drive" : sep < 1.3 * YD ? "inPhase" : sep < 2.5 * YD ? "trail" : "beaten";
    }
    const mag = Math.hypot(want.vx, want.vy);
    if (mag > cap) {
        want.vx *= cap / mag;
        want.vy *= cap / mag;
    }
    const dvx = want.vx - d.vx;
    const dvy = want.vy - d.vy;
    const dv = Math.hypot(dvx, dvy);
    const k = dv > 0 ? Math.min(1, (ACCEL * dt) / dv) : 0;
    d.vx += dvx * k;
    d.vy += dvy * k;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
}
function toward(d, p, top, carryX = 0, match) {
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const dist = Math.hypot(dx, dy);
    const base = match ?? { vx: carryX, vy: 0 };
    const close = Math.min(top, dist * 2.5);
    return dist < 0.5 ? base : { vx: base.vx + (dx / dist) * close, vy: base.vy + (dy / dist) * close };
}
function readThrow(d, t) {
    if (d.ballAt === null)
        d.ballAt = t + coverTraits(d.skills).findBall;
}
function contestCatch(sep, d, rnd = Math.random, shielded = false, hands = 0.5) {
    if (!d)
        return "caught";
    const b = coverTraits(d.skills).ball;
    const k = 1.4 - 0.8 * hands;
    if (shielded)
        sep += 0.6 * YD;
    if (sep < 0.75 * YD) {
        const r = rnd();
        if (r < (0.015 + 0.045 * b) * k)
            return "intercepted";
        if (r < (0.45 + 0.3 * b) * k)
            return "broken";
        return "contested";
    }
    if (sep < 1.6 * YD) {
        const close = (1.6 * YD - sep) / (0.85 * YD);
        return rnd() < (0.15 + 0.35 * b) * close * k ? "broken" : "contested";
    }
    return "caught";
}
function defenderReach(d, ball) {
    return d.phase === "ball" && ball.vz < 0 && ball.z <= pass_1.HANDS_Z + 4 && ball.z >= 4 && Math.abs(ball.x - d.x) <= pass_1.REACH.x && Math.abs(ball.y - d.y) <= pass_1.REACH.y;
}
function defenderPlay(d, rnd = Math.random) {
    return rnd() < 0.07 + 0.15 * coverTraits(d.skills).ball ? "intercepted" : "broken";
}
},
"sprite-test/lib/game/heads": function (module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEAD_CODE = exports.DEFAULT_HEAD = exports.HAIR_PRESETS = exports.FACIAL_HAIR = exports.HEADS_META = exports.FACEMASKS = exports.HELMET_SHELLS = exports.FACE_EXTRAS = exports.FACE_SHAPES = exports.VISORS = exports.HELMET_STRIPES = exports.RB_HAIR_PREFIX = exports.RB_FACE_KINDS = exports.RB_PORTRAIT = exports.RB_KINDS = void 0;
exports.rbHairIndex = rbHairIndex;
exports.fieldStyle = fieldStyle;
exports.fieldFacialHair = fieldFacialHair;
exports.facialZones = facialZones;
const retro_heads_json_1 = __importDefault(require("./characters/retro-heads.json"));
const rb_portrait_json_1 = __importDefault(require("./characters/rb-portrait.json"));
exports.RB_KINDS = ["head", "eyes", "brows", "nose", "mouth", "ears", "details", "beard", "mustache", "headband", "glasses", "paint", "piercing"];
exports.RB_PORTRAIT = rb_portrait_json_1.default;
exports.RB_FACE_KINDS = ["eyes", "brows", "nose", "mouth", "ears"];
exports.RB_HAIR_PREFIX = "rb:";
function rbHairIndex(style) {
    if (!style.startsWith(exports.RB_HAIR_PREFIX))
        return null;
    const n = Number(style.slice(exports.RB_HAIR_PREFIX.length));
    return Number.isInteger(n) && n >= 0 && n < exports.RB_PORTRAIT.hair.length ? n : null;
}
function fieldStyle(style) {
    const i = rbHairIndex(style);
    return i === null ? style : exports.RB_PORTRAIT.hair[i].field ?? "short";
}
function fieldFacialHair(head) {
    if (head.facialHair !== "none")
        return head.facialHair;
    if (head.rb?.beard !== undefined)
        return "beard";
    if (head.rb?.mustache !== undefined)
        return "mustache";
    return "none";
}
exports.HELMET_STRIPES = [
    { id: "none", label: "None" }, { id: "single", label: "Pin" }, { id: "classic", label: "Classic" },
    { id: "wide", label: "Wide" }, { id: "double", label: "Double" }, { id: "triple", label: "Triple" },
];
exports.VISORS = [
    { id: "none", label: "None" }, { id: "smoke", label: "Smoke" }, { id: "gold", label: "Gold" }, { id: "mirror", label: "Mirror" },
];
exports.FACE_SHAPES = [
    { id: "classic", label: "Classic" }, { id: "square", label: "Square jaw" }, { id: "narrow", label: "Narrow" },
    { id: "heavy", label: "Heavy brow" }, { id: "round", label: "Round" }, { id: "weathered", label: "Weathered" },
];
exports.FACE_EXTRAS = [
    { id: "none", label: "None" }, { id: "eyeblack", label: "Eye black" }, { id: "glasses", label: "Glasses" }, { id: "shades", label: "Shades" },
];
exports.HELMET_SHELLS = [
    { id: "regular", label: "Classic" },
    { id: "speed", label: "Speed" },
    { id: "bubble", label: "Bubble" },
    { id: "angular", label: "Angular" },
    { id: "leather", label: "Leather" },
];
exports.FACEMASKS = [
    { id: "single", label: "Single bar" },
    { id: "double", label: "Double bar" },
    { id: "qb", label: "Quarterback" },
    { id: "cage", label: "Lineman cage" },
    { id: "bulldog", label: "Bulldog" },
];
exports.HEADS_META = retro_heads_json_1.default;
exports.FACIAL_HAIR = [
    { id: "none", label: "Clean" },
    { id: "mustache", label: "Moustache" },
    { id: "goatee", label: "Goatee" },
    { id: "beard", label: "Beard" },
];
exports.HAIR_PRESETS = [
    { name: "Black", color: "#1a1a1a" },
    { name: "Dark brown", color: "#3b2314" },
    { name: "Brown", color: "#6b4423" },
    { name: "Auburn", color: "#8b3a1e" },
    { name: "Blonde", color: "#d9b35a" },
    { name: "Red", color: "#b5431f" },
    { name: "Grey", color: "#9a9a9a" },
    { name: "White", color: "#e8e8e8" },
];
exports.DEFAULT_HEAD = { style: "helmet", hair: "#3b2314", facialHair: "none", helmet: "regular", facemask: "double", face: "classic", extra: "none", visor: "none", stripe: "classic" };
exports.HEAD_CODE = {
    none: 0, hair: 1, skin: 2, skinShade: 3, clear: 4, mustache: 5, goatee: 6, beard: 7,
    eye: 8, eyeWhite: 9, lips: 10, brow: 11, hairHighlight: 12,
};
function facialZones(f) {
    switch (f) {
        case "mustache": return [exports.HEAD_CODE.mustache];
        case "goatee": return [exports.HEAD_CODE.mustache, exports.HEAD_CODE.goatee];
        case "beard": return [exports.HEAD_CODE.mustache, exports.HEAD_CODE.goatee, exports.HEAD_CODE.beard];
        default: return [];
    }
}
},
"sprite-test/lib/game/look": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomLook = randomLook;
exports.seeded = seeded;
exports.bareHead = bareHead;
exports.withLook = withLook;
exports.rosterLook = rosterLook;
exports.lookOf = lookOf;
const customize_1 = require("./customize");
const heads_1 = require("./heads");
const recolor_1 = require("./recolor");
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
function randomRb(rnd) {
    const rb = {};
    const maybe = (k, p) => { if (rnd() < p)
        rb[k] = Math.floor(rnd() * heads_1.RB_PORTRAIT[k].length); };
    maybe("head", 0.35);
    if (rb.head !== undefined)
        for (const k of heads_1.RB_FACE_KINDS)
            maybe(k, 1);
    maybe("beard", 0.2);
    if (rb.beard === undefined)
        maybe("mustache", 0.1);
    maybe("headband", 0.08);
    maybe("glasses", 0.06);
    maybe("piercing", 0.06);
    return rb;
}
function randomLook(rnd = Math.random, opts = {}) {
    const build = pick(recolor_1.BUILDS, rnd);
    const helmet = rnd() < 0.6 && opts.helmet !== false;
    return {
        skin: [...pick(customize_1.SKIN_PRESETS, rnd).tones],
        numberFont: rnd() < 0.5 ? "block" : "rounded",
        head: {
            style: helmet ? "helmet" : rnd() < 0.8 ? `${heads_1.RB_HAIR_PREFIX}${Math.floor(rnd() * heads_1.RB_PORTRAIT.hair.length)}` : pick(heads_1.HEADS_META.styles, rnd).id,
            hair: pick(heads_1.HAIR_PRESETS, rnd).color,
            facialHair: pick(heads_1.FACIAL_HAIR, rnd).id,
            helmet: pick(heads_1.HELMET_SHELLS, rnd).id,
            facemask: pick(heads_1.FACEMASKS, rnd).id,
            face: pick(heads_1.FACE_SHAPES, rnd).id,
            extra: rnd() < 0.7 ? "none" : pick(heads_1.FACE_EXTRAS, rnd).id,
            visor: rnd() < 0.75 ? "none" : pick(heads_1.VISORS, rnd).id,
            stripe: pick(heads_1.HELMET_STRIPES, rnd).id,
            rb: randomRb(rnd),
        },
        body: { build: build.id, height: 68 + Math.floor(rnd() * 12), weight: build.typicalWeight + Math.round((rnd() - 0.5) * 40 / 5) * 5 },
    };
}
function seeded(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++)
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return () => {
        h = (h + 0x6d2b79f5) | 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function bareHead(p, seed = "bare") {
    const head = p.head;
    if (head && head.style !== "helmet")
        return p;
    const rolled = randomLook(seeded(seed), { helmet: false }).head;
    return { ...p, head: { ...rolled, ...head, style: rolled.style } };
}
function withLook(uniform, look) {
    return { ...uniform, colors: { ...uniform.colors, skin: look.skin }, head: look.head, numberFont: look.numberFont, body: look.body ?? uniform.body };
}
function rosterLook(p) {
    if (p.look)
        return p.look;
    const { skin, head, numberFont } = randomLook(seeded(`${p.name}#${p.number}`), { helmet: false });
    return { skin, head, numberFont };
}
function lookOf(p) {
    const bare = bareHead(p);
    return { skin: [...(bare.colors.skin ?? ["#e8a778", "#c78663"])], head: bare.head, numberFont: bare.numberFont ?? "block" };
}
},
"sprite-test/lib/game/pass": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLD = exports.LOOK = exports.SPREAD = exports.SPEED = exports.GRAVITY = exports.HANDS_Z = exports.REACH = exports.DEFAULT_RECEIVERS = void 0;
exports.receiverTraits = receiverTraits;
exports.runAhead = runAhead;
exports.planPass = planPass;
exports.runStep = runStep;
exports.inReach = inReach;
exports.missReason = missReason;
const build_ratings_1 = require("./build-ratings");
exports.DEFAULT_RECEIVERS = { speed: 50, route: 50, hands: 50 };
function receiverTraits(s) {
    const sp = (0, build_ratings_1.ratingQuality)(s.speed);
    const ro = (0, build_ratings_1.ratingQuality)(s.route);
    return {
        speed: 0.9 + 0.2 * sp,
        agility: 0.8 + 0.4 * ro,
        hands: (0, build_ratings_1.ratingQuality)(s.hands),
    };
}
const BURST = 300;
const TURN = 320;
exports.REACH = { x: 8, y: 9 };
exports.HANDS_Z = 22;
exports.GRAVITY = 230;
const GEAR = 1.1;
const STEP = 1 / 30;
const MAX_HANG = 1.7;
exports.SPEED = { spiral: 1, slight: 0.86, noticeable: 0.76 };
exports.SPREAD = { spiral: 3, slight: 14, noticeable: 24 };
exports.LOOK = { spiral: 0.9, slight: 0.7, noticeable: 0.55 };
exports.HOLD = { spiral: 0.98, slight: 0.88, noticeable: 0.7 };
const SIDE_ROOM = 3 * 14;
function runAhead(r, t) {
    const c = { ...r, route: r.route };
    for (let s = 0; s < t; s += STEP)
        runStep(c, null, Math.min(STEP, t - s));
    return { x: c.x, y: c.y };
}
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const INSIDE = { x: 14, y: 12 };
function planPass(from, r, speed, w, rnd = Math.random, bounds, shot, hang) {
    const maxHang = shot?.maxHang ?? hang ?? MAX_HANG;
    let fast = speed;
    let t = Math.hypot(r.x - from.x, r.y - from.y) / speed;
    for (let i = 0; i < 8; i += 1) {
        const p = runAhead(r, t);
        const d = Math.hypot(p.x - from.x, p.y - from.y);
        fast = Math.max(speed, d / maxHang);
        t = d / fast;
    }
    let ahead = runAhead(r, t);
    if (shot && shot.lead > 0) {
        const next = runAhead(r, t + 0.25);
        const dx = next.x - ahead.x;
        const dy = next.y - ahead.y;
        const m = Math.hypot(dx, dy);
        if (m > 0.5) {
            const k = shot.lead * Math.min(1, m / (r.speed * 0.25)) * Math.min(1, Math.max(0, t - 0.5));
            ahead = { x: ahead.x + (dx / m) * k, y: ahead.y + (dy / m) * k };
        }
    }
    const lead = bounds
        ? { x: Math.min(bounds.x1 - INSIDE.x, Math.max(bounds.x0 + INSIDE.x, ahead.x)), y: Math.min(bounds.y1 - INSIDE.y, Math.max(bounds.y0 + INSIDE.y, ahead.y)) }
        : ahead;
    let to;
    let arrive;
    if (shot) {
        const d = Math.hypot(lead.x - from.x, lead.y - from.y) || 1;
        const ux = (lead.x - from.x) / d;
        const uy = (lead.y - from.y) / d;
        to = { x: lead.x + ux * shot.along - uy * shot.side, y: lead.y + uy * shot.along + ux * shot.side };
        arrive = Math.max(0.25, Math.hypot(to.x - from.x, to.y - from.y) / (fast * shot.pace));
    }
    else {
        const s = exports.SPREAD[w.level];
        to = { x: lead.x + gauss(rnd) * s, y: lead.y + gauss(rnd) * s * 0.6 };
        arrive = Math.max(0.25, Math.hypot(to.x - from.x, to.y - from.y) / (fast * exports.SPEED[w.level]));
    }
    return {
        to, arrive, look: Math.max(0.2, arrive - exports.LOOK[w.level] - (shot?.lookMore ?? 0)),
        vx: (to.x - from.x) / arrive, vy: (to.y - from.y) / arrive, vz: (exports.HANDS_Z - from.z + 0.5 * exports.GRAVITY * arrive * arrive) / arrive,
        t: 0, done: false, secure: rnd() < Math.min(0.995, exports.HOLD[w.level] * (0.9 + 0.2 * (r.hands ?? 0.5))), gear: shot?.gear ?? GEAR,
    };
}
function runOn(r, top) {
    let h = r.heading ?? { x: r.dir, y: 0 };
    const f = r.field;
    const room = SIDE_ROOM * (1 + Math.abs(h.y));
    if (f && ((h.y < 0 && r.y - f.y0 < room) || (h.y > 0 && f.y1 - r.y < room))) {
        h = { x: r.dir, y: 0 };
        r.heading = h;
    }
    if (r.deepest !== undefined && (r.x - r.deepest) * r.dir >= 0) {
        const mid = f ? (f.y0 + f.y1) / 2 : r.y;
        r.end = "stop";
        r.route = [{ x: r.x - r.dir * 5 * 14, y: r.y + Math.sign(mid - r.y) * 2 * 14 }];
        r.leg = 0;
        r.jog = 0.75;
        r.phase = "open";
        return { vx: r.vx * 0.6, vy: r.vy * 0.6 };
    }
    r.phase = "on";
    return { vx: h.x * top, vy: h.y * top };
}
function runStep(r, pass, dt) {
    let want;
    const agile = r.agility ?? 1;
    let accel = BURST * agile;
    if (pass && !pass.done && pass.t >= pass.look) {
        accel = TURN * agile;
        r.phase = "ball";
        const left = pass.arrive - pass.t;
        if (left < 0.1) {
            want = { vx: r.vx, vy: r.vy };
        }
        else {
            want = { vx: (pass.to.x - r.x) / left, vy: (pass.to.y - r.y) / left };
            const m = Math.hypot(want.vx, want.vy);
            const top = r.speed * pass.gear;
            if (m > top) {
                want.vx *= top / m;
                want.vy *= top / m;
            }
        }
    }
    else {
        const n = r.route.length;
        const runsOn = r.end === "run";
        while (r.leg < n && Math.hypot(r.route[r.leg].x - r.x, r.route[r.leg].y - r.y) < 4 && (r.leg < n - 1 || runsOn)) {
            if (r.leg === n - 1) {
                const a = r.route[n - 1];
                const b = n > 1 ? r.route[n - 2] : r.from ?? { x: a.x - r.dir, y: a.y };
                let hx = a.x - b.x;
                const hy = a.y - b.y;
                if (hx * r.dir < 0)
                    hx = 0;
                const m = Math.hypot(hx, hy);
                r.heading = m > 0.5 ? { x: hx / m, y: hy / m } : { x: r.dir, y: 0 };
            }
            r.leg += 1;
        }
        const top = r.speed * (r.jog ?? 1);
        if (r.leg >= n) {
            want = runOn(r, top);
        }
        else {
            const p = r.route[r.leg];
            const dx = p.x - r.x;
            const dy = p.y - r.y;
            const d = Math.hypot(dx, dy);
            const last = r.leg >= n - 1;
            const v = last && !runsOn ? Math.min(top, Math.sqrt(2 * BURST * agile * 0.6 * d)) : top;
            want = d < 1 ? { vx: 0, vy: 0 } : { vx: (dx / d) * v, vy: (dy / d) * v };
            if (r.phase !== "open")
                r.phase = last && !runsOn && d < 8 ? "settled" : "route";
        }
    }
    const dvx = want.vx - r.vx;
    const dvy = want.vy - r.vy;
    const dv = Math.hypot(dvx, dvy);
    const k = dv > 0 ? Math.min(1, (accel * dt) / dv) : 0;
    r.vx += dvx * k;
    r.vy += dvy * k;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
}
function inReach(r, ball) {
    return ball.vz < 0 && ball.z <= exports.HANDS_Z + 2 && ball.z >= 4 && Math.abs(ball.x - r.x) <= exports.REACH.x && Math.abs(ball.y - r.y) <= exports.REACH.y;
}
function missReason(r, ball) {
    const v = Math.hypot(r.vx, r.vy);
    const hx = v > 20 ? r.vx / v : r.dir;
    const hy = v > 20 ? r.vy / v : 0;
    const ahead = (ball.x - r.x) * hx + (ball.y - r.y) * hy;
    if (ahead > exports.REACH.x)
        return "OVERTHROWN";
    if (ahead < -exports.REACH.x)
        return "UNDERTHROWN";
    return "OFF TARGET";
}
},
"sprite-test/lib/game/portrait": function (module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEIGHT_ROWS_MAX = exports.PORTRAIT_STYLES = exports.PORTRAIT_HEADROOM = exports.PORTRAIT_H = exports.PORTRAIT_W = void 0;
exports.heightDelta = heightDelta;
exports.heightRows = heightRows;
exports.bodyRows = bodyRows;
exports.portraitOverflow = portraitOverflow;
exports.portraitRows = portraitRows;
exports.digitPixels = digitPixels;
exports.numberPixels = numberPixels;
exports.buildPortrait = buildPortrait;
const retro_helmets_json_1 = __importDefault(require("./characters/retro-helmets.json"));
const retro_portrait_json_1 = __importDefault(require("./characters/retro-portrait.json"));
const heads_1 = require("./heads");
const recolor_1 = require("./recolor");
exports.PORTRAIT_W = 27;
exports.PORTRAIT_H = 31;
exports.PORTRAIT_HEADROOM = Math.max(0, ...heads_1.RB_PORTRAIT.hair.map((p) => -p.y));
const GRIDS = retro_portrait_json_1.default;
exports.PORTRAIT_STYLES = Object.keys(GRIDS.hair);
const HELMETS = retro_helmets_json_1.default;
const STRIPES = {
    none: { D: [], T: [] },
    single: { D: [13], T: [] },
    classic: { D: [12, 13, 14], T: [11, 15] },
    wide: { D: [11, 12, 13, 14, 15], T: [10, 16] },
    double: { D: [11, 15], T: [] },
    triple: { D: [11, 13, 15], T: [] },
};
const BAR = "......oFFFFFFFFFFFFFo......";
const SHADE = ".........qqqqqqqqq.........";
const NONE = "...........................";
const FACEMASKS_GRID = {
    single: [NONE, NONE, BAR, SHADE, NONE, NONE],
    double: [NONE, BAR, SHADE, BAR, SHADE, NONE],
    qb: [NONE, BAR, ".........qqqqFqqqq.........", BAR, ".............F.............", NONE],
    cage: [BAR, "..........F.....F..........", BAR, "..........F.....F..........", BAR, NONE],
    bulldog: [NONE, BAR, ".........F...F...F.........", BAR, ".........F...F...F.........", ".......oFFFFFFFFFFFo......."],
};
const FACEMASK_TOP = 10;
const VISOR_ROWS = [".........VvVVVVVVV.........", ".........VVVVVVVVV........."];
const VISOR_COLORS = {
    smoke: ["#1b2230", "#4a5670"],
    gold: ["#c99419", "#ffe9a0"],
    mirror: ["#3f8fb8", "#e6f6ff"],
};
const ZONE_CHAR = { 5: "m", 6: "g", 7: "b" };
function mix(a, b, t) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    const ch = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
    return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
}
function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const NECK_TOP = 16;
const BUILD_SHAPE = {
    lean: { chest: 0, body: 0, belly: 0, arms: 0, defined: true },
    muscular: { chest: 4, body: 2, belly: 2, arms: 1, defined: true },
    "large-muscular": { chest: 6, body: 4, belly: 4, arms: 2, defined: true },
    large: { chest: 2, body: 0, belly: 0, arms: 0, defined: false },
};
function widenCenter(row, n) {
    const c = Math.floor(row.length / 2);
    if (n <= 0 || row[c] === ".")
        return row;
    const leading = row.length - row.replace(/^\.+/, "").length;
    const trailing = row.length - row.replace(/\.+$/, "").length;
    const side = Math.min(Math.floor(n / 2), leading, trailing);
    if (side <= 0)
        return row;
    const out = row.slice(0, c) + row[c].repeat(side * 2) + row.slice(c);
    return out.slice(side, side + row.length);
}
function fatten(row, n) {
    const chars = row.split("");
    const l = chars.indexOf("J");
    const r = chars.lastIndexOf("J");
    if (l < 0)
        return row;
    for (let i = 1; i <= n; i += 1) {
        if (l - i >= 0)
            chars[l - i] = "J";
        if (r + i < chars.length)
            chars[r + i] = "J";
    }
    const firstArm = chars.findIndex((ch) => ch === "k" || ch === "K");
    if (firstArm > 0 && firstArm < l - n) {
        for (let x = Math.max(0, firstArm - n); x < firstArm; x += 1)
            chars[x] = "k";
        chars[l - n - 1] = "K";
    }
    const lastArm = chars.length - 1 - [...chars].reverse().findIndex((ch) => ch === "k" || ch === "K");
    if (lastArm > r + n && lastArm < chars.length) {
        for (let x = lastArm + 1; x <= Math.min(chars.length - 1, lastArm + n); x += 1)
            chars[x] = "k";
        chars[r + n + 1] = "K";
    }
    return chars.join("");
}
function widenRow(row, n) {
    if (n <= 0)
        return row;
    const l = row.indexOf("J");
    const r = row.lastIndexOf("J");
    if (l < 0 || r <= l + 1)
        return row;
    const leading = row.length - row.replace(/^\.+/, "").length;
    const trailing = row.length - row.replace(/\.+$/, "").length;
    const side = Math.min(Math.floor(n / 2), leading, trailing);
    if (side <= 0)
        return row;
    const left = row.slice(0, l + 1) + row[l + 1].repeat(side);
    const middle = row.slice(l + 1, r);
    const right = row[r - 1].repeat(side) + row.slice(r);
    return (left + middle + right).slice(side, side + row.length);
}
function thickenArms(row, n) {
    let out = row;
    for (let i = 0; i < n; i += 1) {
        const chars = out.split("");
        const gapL = chars.findIndex((ch, x) => ch === "." && x > 0 && chars[x - 1] === "K" && chars.slice(x + 1).find((c) => c !== ".") === "J");
        if (gapL > 0) {
            chars[gapL] = "K";
            chars[gapL - 1] = "k";
        }
        const rev = [...chars].reverse();
        const gapR = rev.findIndex((ch, x) => ch === "." && x > 0 && rev[x - 1] === "K" && rev.slice(x + 1).find((c) => c !== ".") === "J");
        if (gapR > 0) {
            rev[gapR] = "K";
            rev[gapR - 1] = "k";
        }
        out = rev.reverse().join("");
    }
    return out;
}
exports.HEIGHT_ROWS_MAX = 3;
const ADD_ROWS = [16, 23, 26];
const REMOVE_ROWS = [16, 24, 27];
function heightDelta(heightInches) {
    return Math.max(-exports.HEIGHT_ROWS_MAX, Math.min(exports.HEIGHT_ROWS_MAX, Math.round((heightInches - 73) / 3)));
}
function heightRows(rows, heightInches) {
    const delta = heightDelta(heightInches);
    const dup = new Set(ADD_ROWS.slice(0, Math.max(0, delta)));
    const drop = new Set(REMOVE_ROWS.slice(0, Math.max(0, -delta)));
    const out = [];
    const map = [];
    rows.forEach((row, y) => {
        if (drop.has(y)) {
            map.push(-1);
            return;
        }
        map.push(out.length);
        out.push(row);
        if (dup.has(y))
            out.push(row);
    });
    return { rows: out, map };
}
function bodyRows(body) {
    const shape = BUILD_SHAPE[body.build];
    const typical = recolor_1.BUILDS.find((b) => b.id === body.build)?.typicalWeight ?? 200;
    const wd = Math.max(-2, Math.min(4, Math.round((body.weight - typical) / 25) * 2));
    const template = GRIDS.base.slice(NECK_TOP);
    let rows = [...template];
    const shoulderRow = NECK_TOP + 1;
    const fat = body.build === "large";
    rows = rows.map((row, i) => {
        const y = NECK_TOP + i;
        let n = y <= 23 ? shape.chest : y <= 26 ? shape.body : shape.belly;
        if (y >= 22)
            n += wd;
        let out = widenRow(row, n);
        if (fat) {
            if (y <= 20)
                out = widenCenter(out, 2);
            if (y >= 24)
                out = fatten(out, y <= 25 ? 1 : y <= 27 ? 2 : 3 + Math.max(0, Math.floor(wd / 2)));
        }
        else if (y >= 24) {
            out = thickenArms(out, shape.arms + (wd >= 2 ? 1 : 0));
        }
        if (!shape.defined)
            out = out.replace(/j/g, "J");
        return out;
    });
    return { rows, shoulderRow };
}
const FACE = "kKqQWEeBLl";
const SHADE_OF = { k: "K", Q: "k", K: "q", q: "q", A: "a", a: "Z", I: "A", U: "I" };
const LIGHT_OF = { K: "k", q: "K", k: "Q" };
function paintPart(grid, part, only) {
    if (!part)
        return;
    part.rows.forEach((row, py) => {
        const y = part.y + py;
        if (y < 0 || y >= grid.length)
            return;
        [...row].forEach((ch, px) => {
            const x = part.x + px;
            if (ch === "." || x < 0 || x >= exports.PORTRAIT_W)
                return;
            const under = grid[y][x];
            if (only && !only.includes(under))
                return;
            if (ch === "~") {
                if (under !== ".")
                    grid[y][x] = SHADE_OF[under] ?? under;
                return;
            }
            if (ch === "^") {
                if (under !== ".")
                    grid[y][x] = LIGHT_OF[under] ?? under;
                return;
            }
            if (ch === "y") {
                if (under !== ".")
                    grid[y][x] = "a";
                return;
            }
            grid[y][x] = ch;
        });
    });
}
function rbPart(head, kind) {
    const i = head.rb?.[kind];
    if (i === undefined && head.rb?.head !== undefined && heads_1.RB_FACE_KINDS.includes(kind))
        return heads_1.RB_PORTRAIT[kind][0];
    return i === undefined ? undefined : heads_1.RB_PORTRAIT[kind][i];
}
function portraitOverflow(palette) {
    const head = palette.head ?? heads_1.DEFAULT_HEAD;
    if (head.style === "helmet")
        return [];
    const i = (0, heads_1.rbHairIndex)(head.style);
    const parts = [i === null ? undefined : heads_1.RB_PORTRAIT.hair[i], rbPart(head, "headband")].filter((p) => !!p);
    const top = Math.min(0, ...parts.map((p) => p.y));
    if (top >= 0)
        return [];
    const grid = Array.from({ length: -top }, () => Array(exports.PORTRAIT_W).fill("."));
    for (const p of parts)
        paintPart(grid, { ...p, y: p.y - top });
    return grid.map((r) => r.join(""));
}
function portraitRows(palette) {
    const head = palette.head ?? heads_1.DEFAULT_HEAD;
    const styleKey = head.style === "helmet" ? "short" : head.style;
    const rbHair = (0, heads_1.rbHairIndex)(head.style);
    const hair = rbHair !== null ? [] : GRIDS.hair[styleKey] ?? GRIDS.hair.short ?? [];
    const rbHead = head.rb?.head !== undefined;
    const zones = new Set((0, heads_1.facialZones)(head.facialHair).map((z) => ZONE_CHAR[z]));
    const helmet = head.style === "helmet" ? HELMETS[head.helmet ?? "regular"] ?? HELMETS.regular : null;
    const stripe = STRIPES[head.stripe ?? "classic"] ?? STRIPES.classic;
    const mask = head.style === "helmet" ? FACEMASKS_GRID[head.facemask ?? "double"] : null;
    const { rows: frame } = bodyRows(palette.body ?? recolor_1.DEFAULT_BODY);
    const shape = rbHead ? {} : GRIDS.faces?.[head.face ?? "classic"] ?? {};
    const extra = GRIDS.extras?.[head.extra ?? "none"] ?? {};
    const base = GRIDS.base.map((row, y) => {
        const r = y >= NECK_TOP ? frame[y - NECK_TOP] ?? row : row;
        const over = shape[String(y)];
        return over ? r.split("").map((ch, x) => (over[x] && over[x] !== "." ? over[x] : ch)).join("") : r;
    });
    const visor = head.style === "helmet" && head.visor && head.visor !== "none" ? VISOR_ROWS : null;
    const grid = base.map((r) => r.split(""));
    if (rbHead) {
        for (let y = 0; y < NECK_TOP; y += 1)
            for (let x = 0; x < exports.PORTRAIT_W; x += 1)
                if (FACE.includes(grid[y][x]))
                    grid[y][x] = ".";
        for (const kind of ["head", "ears", "details", "eyes", "brows", "nose", "mouth"])
            paintPart(grid, rbPart(head, kind));
    }
    paintPart(grid, rbPart(head, "paint"), FACE);
    paintPart(grid, rbPart(head, "beard"));
    paintPart(grid, rbPart(head, "mustache"));
    paintPart(grid, rbPart(head, "piercing"));
    const face = grid.map((r) => r.join(""));
    const top = grid.map((r) => r.map(() => "."));
    if (head.style !== "helmet") {
        if (rbHair !== null)
            paintPart(top, heads_1.RB_PORTRAIT.hair[rbHair]);
        paintPart(top, rbPart(head, "headband"));
    }
    paintPart(top, rbPart(head, "glasses"));
    return face.map((row, y) => row.split("").map((ch, x) => {
        const m = mask?.[y - FACEMASK_TOP]?.[x];
        if (m && m !== "." && (m !== "q" || "kKqQWEeBL".includes(ch)))
            return m;
        const v = visor?.[y - 9]?.[x];
        if (v && v !== ".")
            return v;
        const hm = helmet?.[y]?.[x];
        if (hm && hm !== ".") {
            if (y < 9 && "Hhi".includes(hm)) {
                if (stripe.D.includes(x))
                    return hm === "h" ? "d" : "D";
                if (stripe.T.includes(x))
                    return hm === "h" ? "t" : "T";
            }
            return hm;
        }
        const t = top[y][x];
        if (t !== ".")
            return t;
        const h = hair[y]?.[x];
        if (h && h !== ".")
            return h;
        const e = extra[String(y)]?.[x];
        if (e && e !== "." && "kKqQWEeB".includes(ch))
            return e;
        if (ch === "_")
            return ".";
        const z = GRIDS.facial[y]?.[x];
        if (z && z !== "." && zones.has(z) && "kKqQlL".includes(ch))
            return "A";
        return ch;
    }).join(""));
}
const DIGITS = {
    block: [
        ["1111", "1001", "1001", "1001", "1001", "1111"],
        ["0110", "0010", "0010", "0010", "0010", "0111"],
        ["1111", "0001", "1111", "1000", "1000", "1111"],
        ["1111", "0001", "0111", "0001", "0001", "1111"],
        ["1001", "1001", "1111", "0001", "0001", "0001"],
        ["1111", "1000", "1111", "0001", "0001", "1111"],
        ["1111", "1000", "1111", "1001", "1001", "1111"],
        ["1111", "0001", "0001", "0010", "0010", "0010"],
        ["1111", "1001", "1111", "1001", "1001", "1111"],
        ["1111", "1001", "1111", "0001", "0001", "1111"],
    ],
    rounded: [
        ["0110", "1001", "1001", "1001", "1001", "0110"],
        ["0010", "0110", "0010", "0010", "0010", "0010"],
        ["0110", "1001", "0001", "0010", "0100", "1111"],
        ["1110", "0001", "0110", "0001", "0001", "1110"],
        ["0010", "0110", "1010", "1111", "0010", "0010"],
        ["1111", "1000", "1110", "0001", "0001", "1110"],
        ["0110", "1000", "1110", "1001", "1001", "0110"],
        ["1111", "0001", "0010", "0100", "0100", "0100"],
        ["0110", "1001", "0110", "1001", "1001", "0110"],
        ["0110", "1001", "0111", "0001", "0001", "0110"],
    ],
};
const DIGIT_W = 4;
const NUMBER_ROW = 23;
function digitPixels(n, font) {
    const text = String(Math.max(0, Math.min(99, Math.round(n))));
    const pixels = [];
    [...text].forEach((ch, i) => {
        DIGITS[font][Number(ch)].forEach((row, gy) => [...row].forEach((bit, gx) => { if (bit === "1")
            pixels.push({ x: i * (DIGIT_W + 1) + gx, y: gy }); }));
    });
    return { pixels, width: text.length * DIGIT_W + (text.length - 1) };
}
function numberPixels(n, font, top = NUMBER_ROW) {
    const text = String(Math.max(0, Math.min(99, Math.round(n))));
    const width = text.length * DIGIT_W + (text.length - 1);
    const left = Math.floor(exports.PORTRAIT_W / 2) - Math.floor(width / 2);
    const out = [];
    [...text].forEach((ch, i) => {
        const glyph = DIGITS[font][Number(ch)];
        glyph.forEach((row, gy) => {
            [...row].forEach((bit, gx) => {
                if (bit === "1")
                    out.push({ x: left + i * (DIGIT_W + 1) + gx, y: top + gy });
            });
        });
    });
    return out;
}
function buildPortrait(palette, opts = {}) {
    const body = palette.body ?? recolor_1.DEFAULT_BODY;
    const c = palette.colors;
    const pick = (key, i = 0, fallback = "#ff00ff") => c[key]?.[i] ?? c[key]?.[0] ?? fallback;
    const head = palette.head ?? heads_1.DEFAULT_HEAD;
    const skin = pick("skin", 0, "#e8a778");
    const shade = pick("skin", 1, "#c78663");
    const colors = {
        k: hexToRgb(skin),
        K: hexToRgb(shade),
        q: hexToRgb((0, recolor_1.lighten)(shade, -0.1)),
        Q: hexToRgb((0, recolor_1.lighten)(skin, 0.07)),
        A: hexToRgb(head.hair),
        a: hexToRgb((0, recolor_1.lighten)(head.hair, -0.08)),
        I: hexToRgb((0, recolor_1.lighten)(head.hair, 0.12)),
        B: hexToRgb((0, recolor_1.lighten)(head.hair, -0.04)),
        W: [242, 242, 242],
        E: hexToRgb(pick("eyes", 0, "#111111")),
        e: hexToRgb((0, recolor_1.lighten)(shade, -0.16)),
        L: hexToRgb(mix(skin, "#c86a8a", 0.55)),
        l: hexToRgb((0, recolor_1.lighten)(shade, -0.2)),
        J: hexToRgb(pick("jersey")),
        j: hexToRgb((0, recolor_1.lighten)(pick("jersey"), -0.06)),
        S: hexToRgb(pick("sleeves")),
        H: hexToRgb(pick("helmet", 0, "#ffffff")),
        h: hexToRgb(mix((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), -0.2), "#1a2a5a", 0.12)),
        i: hexToRgb((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), 0.16)),
        D: hexToRgb(pick("helmetDecal", 0, "#003087")),
        p: hexToRgb((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), -0.4)),
        o: hexToRgb(mix((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), -0.62), "#0b0d16", 0.55)),
        O: hexToRgb((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), -0.42)),
        d: hexToRgb((0, recolor_1.lighten)(pick("helmetDecal", 0, "#003087"), -0.18)),
        t: hexToRgb((0, recolor_1.lighten)(pick("helmetTrim", 0, pick("sleeves")), -0.18)),
        T: hexToRgb(pick("helmetTrim", 0, pick("sleeves"))),
        w: hexToRgb(mix((0, recolor_1.lighten)(pick("helmet", 0, "#ffffff"), 0.4), "#ffffff", 0.6)),
        V: hexToRgb(VISOR_COLORS[(head.visor ?? "none") === "none" ? "smoke" : head.visor][0]),
        v: hexToRgb(VISOR_COLORS[(head.visor ?? "none") === "none" ? "smoke" : head.visor][1]),
        F: hexToRgb(pick("facemask", 0, "#9e9e9e")),
        f: hexToRgb((0, recolor_1.lighten)(pick("facemask", 0, "#9e9e9e"), -0.22)),
        Z: hexToRgb((0, recolor_1.lighten)(head.hair, -0.16)),
        U: hexToRgb((0, recolor_1.lighten)(head.hair, 0.22)),
    };
    heads_1.RB_PORTRAIT.raw.forEach((hex, i) => { colors[String.fromCharCode(0x100 + i)] = hexToRgb(hex); });
    const height = heightRows(portraitRows(palette), body.height);
    const over = portraitOverflow(palette);
    const rows = [...over, ...height.rows];
    const map = height.map.map((y) => (y < 0 ? y : y + over.length));
    const H = rows.length;
    const img = new ImageData(exports.PORTRAIT_W, H);
    rows.forEach((row, y) => {
        for (let x = 0; x < exports.PORTRAIT_W; x += 1) {
            const rgb = colors[row[x]];
            if (!rgb)
                continue;
            img.data.set([rgb[0], rgb[1], rgb[2], 255], (y * exports.PORTRAIT_W + x) * 4);
        }
    });
    if (opts.number !== undefined) {
        const num = hexToRgb(pick("number", 0, "#ffffff"));
        const top = map[NUMBER_ROW] >= 0 ? map[NUMBER_ROW] : map[NUMBER_ROW + 1];
        for (const { x, y } of numberPixels(opts.number, palette.numberFont ?? "block", top)) {
            const ch = rows[y]?.[x];
            if (ch === "J" || ch === "j")
                img.data.set([num[0], num[1], num[2], 255], (y * exports.PORTRAIT_W + x) * 4);
        }
    }
    const canvas = document.createElement("canvas");
    canvas.width = exports.PORTRAIT_W;
    canvas.height = H;
    canvas.getContext("2d")?.putImageData(img, 0, 0);
    return canvas;
}
},
"sprite-test/lib/game/recolor": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NUMBER_FONTS = exports.DEFAULT_BODY = exports.BUILDS = void 0;
exports.teamPalette = teamPalette;
exports.loadPartsImage = loadPartsImage;
exports.recolor = recolor;
exports.cropImageData = cropImageData;
exports.recolorRect = recolorRect;
exports.rgbToHsl = rgbToHsl;
exports.hslToHex = hslToHex;
exports.lighten = lighten;
exports.deriveShade = deriveShade;
const heads_1 = require("./heads");
exports.BUILDS = [
    { id: "lean", label: "Lean", typicalWeight: 200 },
    { id: "muscular", label: "Muscular", typicalWeight: 225 },
    { id: "large-muscular", label: "Large muscular", typicalWeight: 255 },
    { id: "large", label: "Large", typicalWeight: 315 },
];
exports.DEFAULT_BODY = { build: "lean", height: 73, weight: 200 };
exports.NUMBER_FONTS = [
    { id: "block", label: "Block" },
    { id: "rounded", label: "Rounded" },
];
function teamPalette(meta, team, showNumber = false, showStripe = true) {
    const src = meta.teams[team];
    if (!src)
        throw new Error(`no team palette "${team}"`);
    const colors = {};
    for (const [k, tones] of Object.entries(src))
        colors[k] = tones.map((t) => t ?? "#ff00ff");
    return { colors, showNumber, showStripe };
}
const partsCache = new Map();
function loadPartsImage(url) {
    let p = partsCache.get(url);
    if (!p) {
        p = (async () => {
            const img = new Image();
            img.decoding = "async";
            img.src = url;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (!ctx)
                throw new Error("2D canvas not supported");
            ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height);
        })();
        partsCache.set(url, p);
    }
    return p;
}
function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function recolor(parts, meta, palette, heads) {
    const byId = [];
    for (const p of meta.parts)
        byId[p.id] = p.key;
    const jersey = hexToRgb(palette.colors.jersey?.[0] ?? "#ffffff");
    const pants = hexToRgb(palette.colors.pants?.[0] ?? "#ffffff");
    const lut = new Map();
    const tone = (key, shade) => {
        const k = `${key}/${shade}`;
        let v = lut.get(k);
        if (!v) {
            const tones = palette.colors[key] ?? [];
            v = hexToRgb(tones[shade] ?? tones[0] ?? "#ff00ff");
            lut.set(k, v);
        }
        return v;
    };
    const out = new ImageData(parts.width, parts.height);
    const src = parts.data;
    const dst = out.data;
    const W = parts.width;
    const ballId = meta.parts.find((p) => p.key === "ball")?.id ?? -1;
    for (let i = 0; i < src.length; i += 4) {
        if (src[i + 3] === 0)
            continue;
        const key = byId[src[i]];
        if (!key)
            continue;
        const rgb = key === "number" && !palette.showNumber ? jersey
            : key === "pantStripe" && !palette.showStripe ? pants
                : tone(key, src[i + 1]);
        dst[i] = rgb[0];
        dst[i + 1] = rgb[1];
        dst[i + 2] = rgb[2];
        dst[i + 3] = 255;
    }
    if (heads && palette.head && palette.head.style !== "helmet") {
        const hair = hexToRgb(palette.head.hair);
        const highlight = hexToRgb(lighten(palette.head.hair, 0.14));
        const skin = tone("skin", 0);
        const skinShade = tone("skin", 1);
        const lips = hexToRgb(lighten(palette.colors.skin?.[1] ?? "#c78663", -0.12));
        const eye = tone("eyes", 0);
        const eyeWhite = [242, 242, 242];
        const zones = (0, heads_1.facialZones)((0, heads_1.fieldFacialHair)(palette.head));
        const L = heads.style.data;
        const F = heads.facial.data;
        const paint = (i, rgb) => {
            dst[i] = rgb[0];
            dst[i + 1] = rgb[1];
            dst[i + 2] = rgb[2];
            dst[i + 3] = 255;
        };
        for (let i = 0; i < L.length; i += 4) {
            const code = L[i];
            switch (code) {
                case heads_1.HEAD_CODE.hair:
                    paint(i, hair);
                    break;
                case heads_1.HEAD_CODE.hairHighlight:
                    paint(i, highlight);
                    break;
                case heads_1.HEAD_CODE.brow:
                    paint(i, hair);
                    break;
                case heads_1.HEAD_CODE.skin:
                    paint(i, skin);
                    break;
                case heads_1.HEAD_CODE.skinShade:
                    paint(i, skinShade);
                    break;
                case heads_1.HEAD_CODE.eye:
                    paint(i, eye);
                    break;
                case heads_1.HEAD_CODE.eyeWhite:
                    paint(i, eyeWhite);
                    break;
                case heads_1.HEAD_CODE.lips:
                    paint(i, lips);
                    break;
                case heads_1.HEAD_CODE.clear:
                    dst[i + 3] = 0;
                    break;
            }
            if (zones.includes(F[i]))
                paint(i, hair);
        }
    }
    if (palette.ballOutline !== false && ballId >= 0) {
        const n = src.length / 4;
        for (let p = 0; p < n; p += 1) {
            if (src[p * 4 + 3] === 0 || src[p * 4] !== ballId)
                continue;
            const x = p % W;
            const neighbours = [p - W, p + W, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1];
            for (const q of neighbours) {
                if (q < 0 || q >= n)
                    continue;
                if (src[q * 4 + 3] !== 0 && src[q * 4] === ballId)
                    continue;
                const o = q * 4;
                dst[o] = 20;
                dst[o + 1] = 12;
                dst[o + 2] = 8;
                dst[o + 3] = 255;
            }
        }
    }
    const c = document.createElement("canvas");
    c.width = parts.width;
    c.height = parts.height;
    c.getContext("2d")?.putImageData(out, 0, 0);
    return c;
}
function cropImageData(img, x, y, w, h) {
    const out = new ImageData(w, h);
    for (let row = 0; row < h; row += 1) {
        const src = ((y + row) * img.width + x) * 4;
        out.data.set(img.data.subarray(src, src + w * 4), row * w * 4);
    }
    return out;
}
function recolorRect(parts, meta, palette, rect, heads) {
    const p = cropImageData(parts, rect.x, rect.y, rect.w, rect.h);
    const h = heads
        ? { style: cropImageData(heads.style, rect.x, rect.y, rect.w, rect.h), facial: cropImageData(heads.facial, rect.x, rect.y, rect.w, rect.h) }
        : undefined;
    return recolor(p, meta, palette, h);
}
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r)
        h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return [h / 6, s, l];
}
function hslToHex(h, s, l) {
    const f = (n) => {
        const k = (n + h * 12) % 12;
        const a = s * Math.min(l, 1 - l);
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}
function lighten(hex, delta) {
    const [h, s, l] = rgbToHsl(...hexToRgb(hex));
    return hslToHex(h, s, Math.min(1, Math.max(0, l + delta)));
}
function deriveShade(base, refBase, refShade) {
    const [, , lb] = rgbToHsl(...hexToRgb(refBase));
    const [, , ls] = rgbToHsl(...hexToRgb(refShade));
    const [h, s, l] = rgbToHsl(...hexToRgb(base));
    const delta = ls - lb;
    let nl = l + (Math.abs(delta) < 0.04 ? -0.12 : delta);
    if (nl < 0)
        nl = Math.min(0.15, l + 0.12);
    if (nl > 1)
        nl = Math.max(0.85, l - 0.12);
    return hslToHex(h, s, nl);
}
},
"sprite-test/lib/game/roster": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFENSE_RATING = exports.RECEIVER_RATING = exports.defenseSkillsOf = exports.receiverSkillsOf = exports.feetInches = exports.PERSONAS = exports.slotInfo = exports.positionTag = exports.DEFENSE_SLOTS = exports.SLOTS = exports.FRONT_SLOTS = exports.SAFETY_SLOTS = exports.LINE_SLOTS = exports.ROUTE_SLOTS = exports.RATING_KEYS = void 0;
exports.rollBody = rollBody;
exports.rollFor = rollFor;
exports.randomRoster = randomRoster;
exports.fieldRatings = fieldRatings;
exports.loadRoster = loadRoster;
exports.saveRoster = saveRoster;
const attributes_1 = require("../sim/attributes");
const roster_1 = require("../sim/roster");
exports.RATING_KEYS = [
    "speed", "agility", "strength", "awareness", "hands", "routeRunning", "throwAccuracy", "throwPower",
    "passBlock", "runBlock", "passRush", "runDefense", "coverage", "ballSkills", "tackling", "vision", "elusiveness",
];
exports.ROUTE_SLOTS = ["se", "fl", "slot", "te", "back"];
exports.LINE_SLOTS = ["lt", "lg", "c", "rg", "rt"];
exports.SAFETY_SLOTS = ["fs", "ss"];
exports.FRONT_SLOTS = ["wde", "nt", "dt", "sde"];
exports.SLOTS = [
    { slot: "qb", position: "QB", label: "Quarterback", side: "offense" },
    { slot: "se", position: "WR", label: "Split end", side: "offense" },
    { slot: "fl", position: "WR", label: "Flanker", side: "offense" },
    { slot: "slot", position: "WR", label: "Slot", side: "offense" },
    { slot: "te", position: "TE", label: "Tight end", side: "offense" },
    { slot: "back", position: "RB", label: "Running back", side: "offense" },
    { slot: "lt", position: "OL", label: "Left tackle", side: "offense" },
    { slot: "lg", position: "OL", label: "Left guard", side: "offense" },
    { slot: "c", position: "OL", label: "Centre", side: "offense" },
    { slot: "rg", position: "OL", label: "Right guard", side: "offense" },
    { slot: "rt", position: "OL", label: "Right tackle", side: "offense" },
    { slot: "d-se", position: "CB", label: "Corner (on the split end)", side: "defense" },
    { slot: "d-fl", position: "CB", label: "Corner (on the flanker)", side: "defense" },
    { slot: "d-slot", position: "CB", label: "Nickel (on the slot)", side: "defense" },
    { slot: "d-te", position: "LB", label: "Linebacker (on the tight end)", side: "defense" },
    { slot: "d-back", position: "LB", label: "Linebacker (on the back)", side: "defense" },
    { slot: "wde", position: "DL", label: "Defensive end (weak side)", side: "defense" },
    { slot: "nt", position: "DL", label: "Nose tackle", side: "defense" },
    { slot: "dt", position: "DL", label: "Defensive tackle (three-technique)", side: "defense" },
    { slot: "sde", position: "DL", label: "Defensive end (strong side)", side: "defense" },
    { slot: "fs", position: "S", label: "Free safety", side: "defense" },
    { slot: "ss", position: "S", label: "Strong safety", side: "defense" },
];
exports.DEFENSE_SLOTS = exports.SLOTS.filter((s) => s.side === "defense").map((s) => s.slot);
const positionTag = (slot, p) => slot === "d-slot" ? "NB" : slot === "fs" ? "FS" : slot === "ss" ? "SS" : slot === "wde" || slot === "sde" ? "DE" : slot === "nt" ? "NT" : slot === "dt" ? "DT" : p.position;
exports.positionTag = positionTag;
const slotInfo = (slot) => exports.SLOTS.find((s) => s.slot === slot);
exports.slotInfo = slotInfo;
exports.PERSONAS = {
    QB: { builds: ["muscular", "lean"], height: [73, 78], weight: [210, 235], numbers: [7] },
    WR: { builds: ["lean"], height: [70, 76], weight: [180, 215], numbers: [...range(10, 19), ...range(80, 89), 1, 3, 4, 5, 8] },
    TE: { builds: ["large-muscular"], height: [76, 79], weight: [245, 265], numbers: [...range(80, 89), 44, 46, 47, 48, 49] },
    RB: { builds: ["muscular"], height: [68, 72], weight: [200, 225], numbers: [...range(20, 39), 0, 2] },
    OL: { builds: ["large"], height: [76, 80], weight: [300, 335], numbers: range(60, 79) },
    DL: { builds: ["large", "large-muscular"], height: [74, 78], weight: [270, 320], numbers: [...range(90, 99), ...range(70, 79)] },
    LB: { builds: ["large-muscular", "muscular"], height: [73, 76], weight: [230, 250], numbers: [...range(50, 59), ...range(40, 49)] },
    CB: { builds: ["lean"], height: [69, 73], weight: [180, 200], numbers: [...range(20, 39), 1, 2, 3, 5] },
    S: { builds: ["lean", "muscular"], height: [71, 74], weight: [195, 215], numbers: [...range(20, 49)] },
};
function range(a, b) {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
function rollBody(position, rnd = Math.random) {
    const p = exports.PERSONAS[position];
    const height = p.height[0] + Math.floor(rnd() * (p.height[1] - p.height[0] + 1));
    const t = (height - p.height[0]) / Math.max(1, p.height[1] - p.height[0]);
    const w = p.weight[0] + (p.weight[1] - p.weight[0]) * Math.min(1, Math.max(0, 0.6 * t + 0.4 * rnd()));
    return { build: pick(p.builds, rnd), height, weight: Math.round(w / 5) * 5 };
}
function rollNumber(position, used, rnd) {
    const free = exports.PERSONAS[position].numbers.filter((n) => !used.has(n));
    const n = free.length ? pick(free, rnd) : exports.PERSONAS[position].numbers[0];
    used.add(n);
    return n;
}
const feetInches = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
exports.feetInches = feetInches;
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
function rollFor(slot, rnd = Math.random) {
    const a = (0, attributes_1.rollAttributes)((0, exports.slotInfo)(slot).position, rnd);
    if (slot === "c")
        a.long_snap = Math.max(0, Math.min(99, Math.round(38 + rnd() * 30)));
    return a;
}
function randomRoster(rnd = Math.random) {
    const used = { offense: new Set(), defense: new Set() };
    const out = {};
    for (const s of exports.SLOTS) {
        const number = rollNumber(s.position, used[s.side], rnd);
        const name = `${pick(roster_1.FIRST_NAMES, rnd)} ${pick(roster_1.LAST_NAMES, rnd)}`;
        const body = rollBody(s.position, rnd);
        out[s.slot] = (0, attributes_1.withAttributes)({ id: `practice-${s.slot}`, name, number, position: s.position, attributes: {}, ratings: {}, badges: [], body }, rollFor(s.slot, rnd));
    }
    return out;
}
const receiverSkillsOf = (p) => ({ speed: p.ratings.speed, route: p.ratings.routeRunning, hands: p.ratings.hands });
exports.receiverSkillsOf = receiverSkillsOf;
const defenseSkillsOf = (p, leverage) => ({ speed: p.ratings.speed, man: p.ratings.coverage, ball: p.ratings.ballSkills, leverage });
exports.defenseSkillsOf = defenseSkillsOf;
exports.RECEIVER_RATING = { speed: "speed", route: "routeRunning", hands: "hands" };
exports.DEFENSE_RATING = { speed: "speed", man: "coverage", ball: "ballSkills" };
function fieldRatings(slot) {
    if (exports.FRONT_SLOTS.includes(slot))
        return ["passRush", "strength", "speed"];
    if (exports.LINE_SLOTS.includes(slot))
        return ["passBlock", "strength"];
    if ((0, exports.slotInfo)(slot).side === "defense")
        return Object.values(exports.DEFENSE_RATING);
    if (exports.ROUTE_SLOTS.includes(slot))
        return Object.values(exports.RECEIVER_RATING);
    return [];
}
const KEY = "practice-roster-v3";
const KEY_V2 = "practice-roster-v2";
const BUILD_IDS = ["lean", "muscular", "large-muscular", "large"];
function loadRoster() {
    const fresh = randomRoster();
    try {
        const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(KEY_V2);
        if (!raw) {
            saveRoster(fresh);
            return fresh;
        }
        const saved = JSON.parse(raw);
        for (const s of exports.SLOTS) {
            const p = saved[s.slot];
            if (!p || typeof p !== "object")
                continue;
            const base = fresh[s.slot];
            const attributes = (0, attributes_1.parseAttributes)(p.attributes, base.attributes)
                ?? (p.ratings && typeof p.ratings === "object" ? (0, attributes_1.attributesFromRatings)(s.position, p.ratings, base.attributes) : base.attributes);
            fresh[s.slot] = (0, attributes_1.withAttributes)({
                ...base,
                name: typeof p.name === "string" && p.name.trim() ? p.name.slice(0, 32) : base.name,
                number: typeof p.number === "number" && p.number >= 0 && p.number <= 99 ? Math.round(p.number) : base.number,
                body: {
                    build: BUILD_IDS.includes(p.body?.build) ? p.body.build : base.body.build,
                    height: typeof p.body?.height === "number" ? Math.max(66, Math.min(82, Math.round(p.body.height))) : base.body.height,
                    weight: typeof p.body?.weight === "number" ? Math.max(160, Math.min(360, Math.round(p.body.weight))) : base.body.weight,
                },
                badges: [],
                look: parseCardLook(p.look),
            }, attributes);
        }
        saveRoster(fresh);
    }
    catch { }
    return fresh;
}
function saveRoster(r) {
    const out = Object.fromEntries(Object.entries(r).map(([slot, p]) => [slot, (0, attributes_1.forSaving)(p)]));
    try {
        window.localStorage.setItem(KEY, JSON.stringify(out));
    }
    catch { }
}
function parseCardLook(v) {
    const l = v;
    if (!l || typeof l !== "object" || !Array.isArray(l.skin) || !l.skin.every((c) => typeof c === "string"))
        return undefined;
    if (!l.head || typeof l.head !== "object" || typeof l.head.style !== "string" || typeof l.head.hair !== "string")
        return undefined;
    return { skin: l.skin, head: l.head, numberFont: l.numberFont === "rounded" ? "rounded" : "block" };
}
},
"sprite-test/lib/sim/attributes": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAttribute = exports.RATING_FROM = exports.toAttribute = exports.toRating = exports.POSITION_KEYS = exports.ATTRIBUTE_GROUPS = exports.ATTRIBUTE_INFO = exports.ATTRIBUTES = void 0;
exports.rollAttributes = rollAttributes;
exports.averageAttributes = averageAttributes;
exports.overallOf = overallOf;
exports.ratingsFrom = ratingsFrom;
exports.withAttributes = withAttributes;
exports.setRating = setRating;
exports.attributesFromRatings = attributesFromRatings;
exports.parseAttributes = parseAttributes;
exports.forSaving = forSaving;
exports.ATTRIBUTES = [
    "acceleration", "agility", "awareness", "bc_vision", "block_shedding", "break_sack", "break_tackle", "carrying",
    "catch_in_traffic", "catching", "change_of_direction", "deep_route_running", "finesse_moves", "hit_power",
    "impact_blocking", "injury", "juke_move", "jumping", "kick_accuracy", "kick_power", "kick_return", "lead_block",
    "long_snap", "man_coverage", "medium_route_running", "pass_block", "pass_block_finesse", "pass_block_power",
    "play_action", "play_recognition", "power_moves", "press", "pursuit", "release", "run_block", "run_block_finesse",
    "run_block_power", "short_route_running", "spectacular_catch", "speed", "spin_move", "stamina", "stiff_arm",
    "strength", "tackle", "throw_accuracy_deep", "throw_accuracy_mid", "throw_accuracy_short", "throw_on_the_run",
    "throw_power", "throw_under_pressure", "toughness", "trucking", "zone_coverage",
];
exports.ATTRIBUTE_INFO = {
    speed: { name: "Speed", abbr: "SPD" }, acceleration: { name: "Acceleration", abbr: "ACC" }, agility: { name: "Agility", abbr: "AGI" },
    change_of_direction: { name: "Change of direction", abbr: "COD" }, strength: { name: "Strength", abbr: "STR" }, jumping: { name: "Jumping", abbr: "JMP" },
    stamina: { name: "Stamina", abbr: "STA" }, toughness: { name: "Toughness", abbr: "TGH" }, injury: { name: "Injury", abbr: "INJ" },
    awareness: { name: "Awareness", abbr: "AWR" }, play_recognition: { name: "Play recognition", abbr: "PRC" },
    throw_power: { name: "Throw power", abbr: "THP" }, throw_accuracy_short: { name: "Short accuracy", abbr: "SAC" },
    throw_accuracy_mid: { name: "Medium accuracy", abbr: "MAC" }, throw_accuracy_deep: { name: "Deep accuracy", abbr: "DAC" },
    throw_on_the_run: { name: "Throw on the run", abbr: "TOR" }, throw_under_pressure: { name: "Throw under pressure", abbr: "TUP" },
    play_action: { name: "Play action", abbr: "PAC" }, break_sack: { name: "Break sack", abbr: "BSK" },
    carrying: { name: "Carrying", abbr: "CAR" }, bc_vision: { name: "Ball carrier vision", abbr: "BCV" }, break_tackle: { name: "Break tackle", abbr: "BTK" },
    trucking: { name: "Trucking", abbr: "TRK" }, stiff_arm: { name: "Stiff arm", abbr: "SFA" }, juke_move: { name: "Juke move", abbr: "JKM" },
    spin_move: { name: "Spin move", abbr: "SPM" }, kick_return: { name: "Kick return", abbr: "KR" },
    catching: { name: "Catching", abbr: "CTH" }, catch_in_traffic: { name: "Catch in traffic", abbr: "CIT" }, spectacular_catch: { name: "Spectacular catch", abbr: "SPC" },
    short_route_running: { name: "Short route running", abbr: "SRR" }, medium_route_running: { name: "Medium route running", abbr: "MRR" },
    deep_route_running: { name: "Deep route running", abbr: "DRR" }, release: { name: "Release", abbr: "RLS" },
    pass_block: { name: "Pass block", abbr: "PBK" }, pass_block_power: { name: "Pass block power", abbr: "PBP" }, pass_block_finesse: { name: "Pass block finesse", abbr: "PBF" },
    run_block: { name: "Run block", abbr: "RBK" }, run_block_power: { name: "Run block power", abbr: "RBP" }, run_block_finesse: { name: "Run block finesse", abbr: "RBF" },
    impact_blocking: { name: "Impact blocking", abbr: "IBL" }, lead_block: { name: "Lead block", abbr: "LBK" },
    block_shedding: { name: "Block shedding", abbr: "BSH" }, power_moves: { name: "Power moves", abbr: "PMV" }, finesse_moves: { name: "Finesse moves", abbr: "FMV" },
    pursuit: { name: "Pursuit", abbr: "PUR" }, hit_power: { name: "Hit power", abbr: "POW" }, tackle: { name: "Tackle", abbr: "TAK" },
    man_coverage: { name: "Man coverage", abbr: "MCV" }, zone_coverage: { name: "Zone coverage", abbr: "ZCV" }, press: { name: "Press", abbr: "PRS" },
    kick_power: { name: "Kick power", abbr: "KPW" }, kick_accuracy: { name: "Kick accuracy", abbr: "KAC" }, long_snap: { name: "Long snap", abbr: "LSN" },
};
exports.ATTRIBUTE_GROUPS = [
    { id: "physical", label: "Physical", keys: ["speed", "acceleration", "agility", "change_of_direction", "strength", "jumping", "stamina", "toughness", "injury"] },
    { id: "mental", label: "Mental", keys: ["awareness", "play_recognition"] },
    { id: "passing", label: "Passing", keys: ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "throw_under_pressure", "play_action", "break_sack"] },
    { id: "carrying", label: "Ball carrier", keys: ["carrying", "bc_vision", "break_tackle", "trucking", "stiff_arm", "juke_move", "spin_move", "kick_return"] },
    { id: "receiving", label: "Receiving", keys: ["catching", "catch_in_traffic", "spectacular_catch", "short_route_running", "medium_route_running", "deep_route_running", "release"] },
    { id: "blocking", label: "Blocking", keys: ["pass_block", "pass_block_power", "pass_block_finesse", "run_block", "run_block_power", "run_block_finesse", "impact_blocking", "lead_block"] },
    { id: "defense", label: "Rush and tackling", keys: ["block_shedding", "power_moves", "finesse_moves", "pursuit", "hit_power", "tackle"] },
    { id: "coverage", label: "Coverage", keys: ["man_coverage", "zone_coverage", "press"] },
    { id: "kicking", label: "Kicking", keys: ["kick_power", "kick_accuracy", "long_snap"] },
];
exports.POSITION_KEYS = {
    QB: ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "throw_under_pressure", "play_action", "awareness"],
    RB: ["speed", "acceleration", "bc_vision", "break_tackle", "juke_move", "trucking", "carrying", "catching"],
    WR: ["speed", "acceleration", "catching", "catch_in_traffic", "short_route_running", "medium_route_running", "deep_route_running", "release"],
    TE: ["catching", "catch_in_traffic", "short_route_running", "medium_route_running", "run_block", "pass_block", "strength", "speed"],
    OL: ["pass_block", "pass_block_power", "pass_block_finesse", "run_block", "run_block_power", "run_block_finesse", "strength", "awareness"],
    DL: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "speed", "acceleration"],
    LB: ["tackle", "pursuit", "hit_power", "play_recognition", "zone_coverage", "man_coverage", "block_shedding", "speed"],
    CB: ["man_coverage", "zone_coverage", "press", "speed", "acceleration", "agility", "play_recognition", "catching"],
    S: ["zone_coverage", "man_coverage", "tackle", "hit_power", "pursuit", "play_recognition", "speed", "catching"],
};
const JOB = [50, 13];
const wide = (mean) => [mean, 17];
const some = (mean) => [mean, 12];
const OTHER = [16, 8];
const NOT_HIS = [12, 9];
const OUTLIER_BELOW = 30;
const OUTLIER_CHANCE = 1 / 30;
const OUTLIER = [55, 9];
const POS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"];
const BODY = {
    speed: [45, 62, 64, 48, 20, 40, 52, 66, 60],
    acceleration: [47, 66, 64, 48, 28, 46, 55, 66, 60],
    agility: [48, 64, 62, 42, 22, 35, 48, 64, 56],
    change_of_direction: [44, 62, 60, 38, 18, 32, 45, 63, 54],
    strength: [40, 52, 32, 60, 72, 72, 60, 30, 42],
    jumping: [38, 48, 62, 52, 18, 35, 48, 62, 58],
};
const OFFENSE = ["QB", "RB", "WR", "TE", "OL"];
const PROFILES = Object.fromEntries(POS.map((pos, i) => {
    const r = {};
    const offense = OFFENSE.includes(pos);
    for (const k of exports.ATTRIBUTES)
        r[k] = NOT_HIS;
    for (const [k, by] of Object.entries(BODY))
        r[k] = [by[i], 9];
    r.stamina = some(55);
    r.toughness = some(55);
    r.injury = some(55);
    r.awareness = JOB;
    r.play_recognition = offense ? some(30) : JOB;
    for (const k of ["block_shedding", "power_moves", "finesse_moves", "pursuit", "hit_power", "tackle", "man_coverage", "zone_coverage", "press"])
        if (offense)
            r[k] = OTHER;
    for (const k of ["carrying", "bc_vision", "break_tackle", "trucking", "stiff_arm", "juke_move", "spin_move", "catching", "catch_in_traffic", "spectacular_catch",
        "short_route_running", "medium_route_running", "deep_route_running", "release", "pass_block", "pass_block_power", "pass_block_finesse", "run_block",
        "run_block_power", "run_block_finesse", "impact_blocking", "lead_block"])
        if (!offense)
            r[k] = OTHER;
    r.carrying = offense ? some(30) : OTHER;
    r.kick_return = some(20);
    r.long_snap = [6, 5];
    return [pos, r];
}));
function set(pos, rolls) {
    Object.assign(PROFILES[pos], rolls);
}
const QB_THROWS = ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "throw_under_pressure", "play_action", "break_sack"];
set("QB", { ...Object.fromEntries(QB_THROWS.map((k) => [k, JOB])), carrying: some(42), bc_vision: some(35), juke_move: some(30), break_tackle: some(25),
    catching: [20, 9], short_route_running: [10, 6], medium_route_running: [8, 6], deep_route_running: [8, 6], release: [10, 6], pass_block: [10, 7] });
set("RB", { carrying: JOB, bc_vision: JOB, break_tackle: JOB, trucking: wide(45), stiff_arm: wide(42), juke_move: JOB, spin_move: wide(42), kick_return: wide(40),
    catching: wide(45), catch_in_traffic: some(35), spectacular_catch: some(28), short_route_running: some(40), medium_route_running: some(30), deep_route_running: [20, 9], release: some(28),
    pass_block: wide(40), pass_block_power: wide(38), pass_block_finesse: wide(36), run_block: some(25), lead_block: some(30), impact_blocking: some(30), break_sack: [8, 6],
    tackle: [26, 9], pursuit: [26, 9] });
set("WR", { catching: JOB, catch_in_traffic: JOB, spectacular_catch: JOB, short_route_running: JOB, medium_route_running: JOB, deep_route_running: JOB, release: JOB,
    carrying: some(42), bc_vision: wide(40), juke_move: some(46), spin_move: some(36), break_tackle: some(32), trucking: [22, 9], stiff_arm: some(28), kick_return: wide(40),
    run_block: some(30), run_block_finesse: some(28), run_block_power: [20, 9], impact_blocking: [20, 9], pass_block: [15, 8], tackle: [28, 9], pursuit: [28, 9] });
set("TE", { catching: JOB, catch_in_traffic: JOB, spectacular_catch: some(38), short_route_running: JOB, medium_route_running: some(44), deep_route_running: some(32), release: some(42),
    run_block: wide(50), run_block_power: wide(50), run_block_finesse: wide(46), pass_block: wide(42), pass_block_power: wide(42), pass_block_finesse: wide(38), impact_blocking: wide(46), lead_block: wide(38),
    carrying: some(38), break_tackle: some(40), trucking: some(42), stiff_arm: some(36), bc_vision: some(30), juke_move: [18, 9], tackle: [24, 9] });
set("OL", { pass_block: JOB, pass_block_power: JOB, pass_block_finesse: JOB, run_block: JOB, run_block_power: JOB, run_block_finesse: JOB, impact_blocking: JOB, lead_block: some(32),
    carrying: [10, 7], catching: [10, 7], long_snap: [24, 14] });
set("DL", { block_shedding: JOB, power_moves: JOB, finesse_moves: JOB, pursuit: some(42), hit_power: some(45), tackle: JOB, man_coverage: [12, 8], zone_coverage: [16, 9], press: [10, 7] });
set("LB", { tackle: JOB, pursuit: JOB, hit_power: JOB, block_shedding: some(42), power_moves: wide(32), finesse_moves: wide(32), zone_coverage: JOB, man_coverage: wide(42), press: some(20), catching: [30, 10] });
set("CB", { man_coverage: JOB, zone_coverage: JOB, press: JOB, tackle: some(40), pursuit: some(48), hit_power: some(35), block_shedding: some(25), catching: some(42),
    catch_in_traffic: some(30), spectacular_catch: some(30), kick_return: wide(38), carrying: some(28), juke_move: some(30), bc_vision: some(25) });
set("S", { zone_coverage: JOB, man_coverage: wide(45), press: some(35), tackle: JOB, pursuit: JOB, hit_power: JOB, block_shedding: some(35), catching: some(40),
    catch_in_traffic: some(30), spectacular_catch: some(28), kick_return: wide(30), carrying: some(24), juke_move: some(26) });
function normal(rnd) {
    const u = Math.max(1e-12, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
const TALENT_JOB = 0.85;
const TALENT_BODY = 0.35;
function draw([mean, sd], rnd, talent = 0, share = 0) {
    return mean + sd * (share * talent + Math.sqrt(1 - share * share) * normal(rnd));
}
const clampAttr = (v) => Math.max(0, Math.min(99, Math.round(v)));
function rollAttributes(position, rnd = Math.random, level = 0) {
    const out = {};
    const talent = normal(rnd);
    for (const k of exports.ATTRIBUTES) {
        const roll = PROFILES[position][k];
        const built = roll[0] >= 40;
        const share = !built ? 0 : k in BODY ? TALENT_BODY : TALENT_JOB;
        const v = roll[0] < OUTLIER_BELOW && rnd() < OUTLIER_CHANCE ? draw(OUTLIER, rnd) : draw(roll, rnd, talent, share) + (built ? level : 0);
        out[k] = clampAttr(v);
    }
    return out;
}
function averageAttributes(position) {
    return Object.fromEntries(exports.ATTRIBUTES.map((k) => [k, PROFILES[position][k][0]]));
}
function overallOf(p) {
    const keys = exports.POSITION_KEYS[p.position];
    return clampAttr(keys.reduce((a, k) => a + p.attributes[k] - PROFILES[p.position][k][0] + 50, 0) / keys.length);
}
const toRating = (a) => (a >= 50 ? 75 + ((a - 50) * 24) / 49 : 40 + a * 0.7);
exports.toRating = toRating;
const toAttribute = (r) => clampAttr(r >= 75 ? 50 + ((r - 75) * 49) / 24 : (r - 40) / 0.7);
exports.toAttribute = toAttribute;
exports.RATING_FROM = {
    speed: { keys: ["speed"] },
    agility: { keys: ["agility"] },
    strength: { keys: ["strength"] },
    awareness: { keys: ["awareness"] },
    hands: { keys: ["catching", "catch_in_traffic"] },
    routeRunning: { keys: ["short_route_running", "medium_route_running", "deep_route_running"] },
    throwAccuracy: { keys: ["throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep"] },
    throwPower: { keys: ["throw_power"] },
    passBlock: { keys: ["pass_block", "pass_block_power", "pass_block_finesse"] },
    runBlock: { keys: ["run_block", "run_block_power", "run_block_finesse"] },
    passRush: { keys: ["power_moves", "finesse_moves"], best: true },
    runDefense: { keys: ["block_shedding", "pursuit"] },
    coverage: { keys: ["man_coverage", "zone_coverage"] },
    ballSkills: { keys: ["play_recognition"] },
    tackling: { keys: ["tackle"] },
    vision: { keys: ["bc_vision"] },
    elusiveness: { keys: ["juke_move", "spin_move", "change_of_direction"] },
};
const RATING_KEYS = Object.keys(exports.RATING_FROM);
const asRated = (position, k, v) => (k in BODY ? v - PROFILES[position][k][0] + 50 : v);
const fromRated = (position, k, v) => clampAttr(k in BODY ? v + PROFILES[position][k][0] - 50 : v);
function ratingsFrom(a, position) {
    const out = {};
    for (const k of RATING_KEYS) {
        const { keys, best } = exports.RATING_FROM[k];
        const vs = keys.map((x) => asRated(position, x, a[x]));
        const v = best ? (2 * Math.max(...vs) + Math.min(...vs)) / 3 : vs.reduce((s, x) => s + x, 0) / vs.length;
        out[k] = Math.max(40, Math.min(99, Math.round((0, exports.toRating)(v))));
    }
    return out;
}
function withAttributes(p, attributes) {
    return { ...p, attributes, ratings: ratingsFrom(attributes, p.position) };
}
const setAttribute = (p, k, v) => withAttributes(p, { ...p.attributes, [k]: clampAttr(v) });
exports.setAttribute = setAttribute;
function setRating(p, k, v) {
    const a = { ...p.attributes };
    for (const x of exports.RATING_FROM[k].keys)
        a[x] = fromRated(p.position, x, (0, exports.toAttribute)(v));
    return withAttributes(p, a);
}
function attributesFromRatings(position, ratings, base = averageAttributes(position)) {
    const a = { ...base };
    for (const k of RATING_KEYS) {
        const v = ratings[k];
        if (typeof v === "number" && Number.isFinite(v))
            for (const x of exports.RATING_FROM[k].keys)
                a[x] = fromRated(position, x, (0, exports.toAttribute)(Math.max(40, Math.min(99, v))));
    }
    return a;
}
function parseAttributes(raw, base) {
    if (!raw || typeof raw !== "object")
        return null;
    const r = raw;
    return Object.fromEntries(exports.ATTRIBUTES.map((k) => [k, typeof r[k] === "number" && Number.isFinite(r[k]) ? clampAttr(r[k]) : base[k]]));
}
function forSaving(p) {
    const { ratings: _ratings, ...rest } = p;
    void _ratings;
    return rest;
}
},
"sprite-test/lib/sim/badges": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasBadge = exports.BADGES = void 0;
exports.BADGES = {
    "pocket-presence": { id: "pocket-presence", name: "Pocket Presence", positions: ["QB"], description: "Takes far fewer sacks when pressured." },
    cannon: { id: "cannon", name: "Cannon", positions: ["QB"], description: "Deep throws are more accurate." },
    surgeon: { id: "surgeon", name: "Surgeon", positions: ["QB"], description: "Quick and intermediate throws are more accurate." },
    "deep-threat": { id: "deep-threat", name: "Deep Threat", positions: ["WR", "TE"], description: "Extra separation on go, post and corner routes." },
    "sure-hands": { id: "sure-hands", name: "Sure Hands", positions: ["WR", "TE", "RB"], description: "Half as many drops; better in traffic." },
    "yac-monster": { id: "yac-monster", name: "YAC Monster", positions: ["WR", "TE", "RB"], description: "More yards after the catch." },
    "route-technician": { id: "route-technician", name: "Route Technician", positions: ["WR", "TE"], description: "Extra separation against man coverage." },
    bruiser: { id: "bruiser", name: "Bruiser", positions: ["RB"], description: "Rarely loses yards; falls forward." },
    elusive: { id: "elusive", name: "Elusive", positions: ["RB", "WR"], description: "More long runs and broken tackles." },
    anchor: { id: "anchor", name: "Anchor", positions: ["OL"], description: "Gives up pressure less often." },
    "road-grader": { id: "road-grader", name: "Road Grader", positions: ["OL", "TE"], description: "Opens bigger running lanes." },
    "edge-rusher": { id: "edge-rusher", name: "Edge Rusher", positions: ["DL", "LB"], description: "Wins pass-rush reps faster." },
    "run-stuffer": { id: "run-stuffer", name: "Run Stuffer", positions: ["DL", "LB"], description: "More runs stopped for little or nothing." },
    shutdown: { id: "shutdown", name: "Shutdown", positions: ["CB", "S"], description: "Allows less separation." },
    "ball-hawk": { id: "ball-hawk", name: "Ball Hawk", positions: ["CB", "S", "LB"], description: "Turns tight-window throws into interceptions." },
    enforcer: { id: "enforcer", name: "Enforcer", positions: ["S", "LB"], description: "Fewer yards after the catch allowed." },
};
const hasBadge = (badges, id) => badges.includes(id);
exports.hasBadge = hasBadge;
},
"sprite-test/lib/sim/rng": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clamp = exports.logit = exports.sigmoid = exports.Rng = void 0;
exports.hash = hash;
class Rng {
    constructor(seed) {
        this.a = (typeof seed === "string" ? hash(seed) : seed) >>> 0;
    }
    next() {
        this.a = (this.a + 0x6d2b79f5) >>> 0;
        let t = this.a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    chance(p) {
        return this.next() < p;
    }
    range(lo, hi) {
        return lo + (hi - lo) * this.next();
    }
    int(lo, hi) {
        return Math.floor(this.range(lo, hi + 1));
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }
    normal(mean = 0, sd = 1) {
        const u = Math.max(1e-12, this.next());
        const v = this.next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    lognormal(median, sigma) {
        return median * Math.exp(this.normal(0, sigma));
    }
    exponential(rate) {
        return -Math.log(Math.max(1e-12, this.next())) / rate;
    }
    weighted(weights) {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = this.next() * total;
        for (let i = 0; i < weights.length; i += 1) {
            r -= weights[i];
            if (r <= 0)
                return i;
        }
        return weights.length - 1;
    }
}
exports.Rng = Rng;
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1)
        h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
exports.sigmoid = sigmoid;
const logit = (p) => Math.log(p / (1 - p));
exports.logit = logit;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
exports.clamp = clamp;
},
"sprite-test/lib/sim/roster": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overall = exports.RATING_LABEL = exports.d = exports.avg = exports.starter = exports.byPosition = exports.POSITION_CORE = exports.LAST_NAMES = exports.FIRST_NAMES = void 0;
exports.makeTeam = makeTeam;
const badges_1 = require("./badges");
const attributes_1 = require("./attributes");
const rng_1 = require("./rng");
exports.FIRST_NAMES = ["Marcus", "DeAndre", "Tyler", "Jalen", "Chris", "Darius", "Josh", "Malik", "Trent", "Kyle", "Isaiah", "Caleb", "Jordan", "Devin", "Aaron", "Xavier", "Brandon", "Elijah", "Nate", "Cam", "Trey", "Jaylen", "Micah", "Zach", "Dante", "Reggie", "Tariq", "Kenny"];
exports.LAST_NAMES = ["Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Robinson", "Clark", "Lewis", "Walker", "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson", "Carter"];
exports.POSITION_CORE = {
    QB: ["throwAccuracy", "throwPower", "awareness", "agility"],
    RB: ["speed", "agility", "vision", "elusiveness", "hands", "strength"],
    WR: ["speed", "routeRunning", "hands", "agility", "awareness"],
    TE: ["hands", "routeRunning", "runBlock", "strength", "speed"],
    OL: ["passBlock", "runBlock", "strength", "awareness"],
    DL: ["passRush", "runDefense", "strength", "speed"],
    LB: ["tackling", "runDefense", "coverage", "speed", "awareness"],
    CB: ["coverage", "speed", "ballSkills", "agility"],
    S: ["coverage", "tackling", "ballSkills", "speed", "awareness"],
};
const DEPTH = [["QB", 1], ["RB", 1], ["WR", 3], ["TE", 1], ["OL", 5], ["DL", 4], ["LB", 3], ["CB", 2], ["S", 2]];
function makeTeam(id, name, abbr, level = 75, seed = id) {
    const rng = new rng_1.Rng(`${seed}:roster`);
    const players = [];
    const numbers = new Set();
    for (const [pos, count] of DEPTH) {
        for (let i = 0; i < count; i += 1) {
            const attributes = (0, attributes_1.rollAttributes)(pos, () => rng.next(), (0, attributes_1.toAttribute)(level) - 50);
            const ratings = (0, attributes_1.ratingsFrom)(attributes, pos);
            let num = rng.int(1, 99);
            while (numbers.has(num))
                num = rng.int(1, 99);
            numbers.add(num);
            const badges = [];
            const eligible = (Object.values(badges_1.BADGES)).filter((b) => b.positions.includes(pos));
            const core = exports.POSITION_CORE[pos].reduce((a, k) => a + ratings[k], 0) / exports.POSITION_CORE[pos].length;
            if (eligible.length && rng.chance(clamp((core - 68) / 30, 0.05, 0.85)))
                badges.push(rng.pick(eligible).id);
            if (eligible.length > 1 && core > 84 && rng.chance(0.4)) {
                const second = rng.pick(eligible).id;
                if (!badges.includes(second))
                    badges.push(second);
            }
            players.push({ id: `${id}-${pos}${i + 1}`, name: `${rng.pick(exports.FIRST_NAMES)} ${rng.pick(exports.LAST_NAMES)}`, number: num, position: pos, attributes, ratings, badges });
        }
    }
    return { id, name, abbr, players };
}
const byPosition = (team, pos) => team.players.filter((p) => p.position === pos);
exports.byPosition = byPosition;
const starter = (team, pos, i = 0) => (0, exports.byPosition)(team, pos)[i];
exports.starter = starter;
const avg = (players, key) => players.reduce((a, p) => a + p.ratings[key], 0) / Math.max(1, players.length);
exports.avg = avg;
const d = (rating) => (rating - 75) / 25;
exports.d = d;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
exports.RATING_LABEL = {
    speed: "SPD", agility: "AGI", strength: "STR", awareness: "AWR", hands: "HND", routeRunning: "RTE", throwAccuracy: "ACC", throwPower: "POW",
    passBlock: "PBK", runBlock: "RBK", passRush: "PRS", runDefense: "RDF", coverage: "COV", ballSkills: "BSK", tackling: "TAK", vision: "VIS", elusiveness: "ELU",
};
var attributes_2 = require("./attributes");
Object.defineProperty(exports, "overall", { enumerable: true, get: function () { return attributes_2.overallOf; } });
},
"sprite-test/lib/sim/types": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
}
};
const cache = {};
function dirname(p) { return p.slice(0, p.lastIndexOf("/")); }
function join(dir, spec) {
  const parts = dir ? dir.split("/") : [];
  for (const s of spec.split("/")) { if (s === "..") parts.pop(); else if (s !== ".") parts.push(s); }
  return parts.join("/");
}
function load(id) {
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} };
  defs[id](module, module.exports, (spec) => {
    const base = spec.startsWith("@/") ? SRC_ROOT + "/" + spec.slice(2) : join(dirname(id), spec);
    return load(defs[base] ? base : base + "/index");
  });
  return module.exports;
}
window.CFPPortraits = load("CFPCoachSimulator/tools/portraits/entry");
})();

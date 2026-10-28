// US map: Albers USA projection (lower 48 + Alaska and Hawaii insets, 975 x 610) and an SVG renderer.
// The projection matches tools/make_us_map.py, which drew the outlines in us-states.js.
(function () {
  const K = 1070;
  const SVGNS = "http://www.w3.org/2000/svg";
  const rad = (d) => (d * Math.PI) / 180;

  // Conic equal area projector: [lat, lon] degrees -> [x, y] screen.
  function conic(parallels, rotate, center, scale, translate) {
    const p0 = rad(parallels[0]), p1 = rad(parallels[1]);
    const n = (Math.sin(p0) + Math.sin(p1)) / 2;
    const c = Math.cos(p0) ** 2 + 2 * n * Math.sin(p0);
    const r0 = Math.sqrt(c) / n;
    const raw = (lam, phi) => {
      const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
      return [r * Math.sin(n * lam), r0 - r * Math.cos(n * lam)];
    };
    const [cx, cy] = raw(rad(center[0]), rad(center[1]));
    return (lat, lon) => {
      const [x, y] = raw(rad(lon + rotate), rad(lat));
      return [translate[0] + scale * (x - cx), translate[1] - scale * (y - cy)];
    };
  }

  const lower48 = conic([29.5, 45.5], 96, [-0.6, 38.7], K, [487.5, 305]);
  const alaska = conic([55, 65], 154, [-2, 58.5], 0.35 * K, [487.5 - 0.307 * K, 305 + 0.201 * K]);
  const hawaii = conic([8, 18], 157, [-3, 19.9], K, [487.5 - 0.205 * K, 305 + 0.212 * K]);

  function project(ll) {
    if (!ll) return null;
    let [lat, lon] = ll;
    if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) return null;
    if (lon > 0) lon -= 360;   // the Aleutians sit east of the antimeridian
    if (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154) return hawaii(lat, lon);
    if (lat >= 50 && lon < -129) return alaska(lat, lon);
    if (lat < 24 || lat > 50 || lon < -126 || lon > -66) return null;   // outside the three regions
    return lower48(lat, lon);
  }

  const centroids = {};
  function centroid(code) {
    if (centroids[code]) return centroids[code];
    const d = window.US_STATES && window.US_STATES.paths[code];
    if (!d) return null;
    const n = d.match(/-?\d+\.?\d*/g).map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
    return (centroids[code] = [(x0 + x1) / 2, (y0 + y1) / 2]);
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // opts: {areas: {name: [states]}, staffed: {name: staff_name}, dots: [{id, home, tone, ring, big, label}],
  //        selectedState, onDot(id), onState(code), teamColor}
  function render(opts) {
    opts = opts || {};
    const S = window.US_STATES;
    const svg = el("svg", { viewBox: S.viewBox, class: "us-map", role: "img", "aria-label": "Map of recruiting areas" });
    const areaOf = {};
    const areas = opts.areas || {}, staffed = opts.staffed || {};
    const gAreas = el("g", { class: "us-areas" }, svg);
    const drawn = new Set();
    for (const name of Object.keys(areas)) {
      const g = el("g", { class: "us-area", "data-area": name }, gAreas);
      const fill = staffed[name] ? "var(--us-staffed, #cfe3d4)" : "var(--us-open, #e7e5df)";
      for (const code of areas[name]) {
        if (!S.paths[code] || drawn.has(code)) continue;
        drawn.add(code);
        areaOf[code] = name;
        const p = el("path", { d: S.paths[code], "data-state": code, fill, stroke: "var(--us-line, #fff)", "stroke-width": 0.8 }, g);
        if (staffed[name]) el("title", {}, p).textContent = name + " (" + staffed[name] + ")";
        else el("title", {}, p).textContent = name;
      }
    }
    const gRest = el("g", { class: "us-rest" }, svg);
    for (const code of Object.keys(S.paths)) {
      if (drawn.has(code)) continue;
      el("path", { d: S.paths[code], "data-state": code, fill: "var(--us-none, #f3f2ee)", stroke: "var(--us-line, #fff)", "stroke-width": 0.8 }, gRest);
    }
    svg.querySelectorAll("path[data-state]").forEach((p) => {
      const code = p.getAttribute("data-state");
      if (code === opts.selectedState) {
        p.classList.add("selected");
        p.setAttribute("stroke", opts.teamColor || "#333");
        p.setAttribute("stroke-width", 2);
      }
      if (opts.onState) {
        p.style.cursor = "pointer";
        p.addEventListener("click", () => opts.onState(code));
      }
    });
    const gDots = el("g", { class: "us-dots" }, svg);
    for (const d of opts.dots || []) {
      const pt = project(d.home);
      if (!pt) continue;
      const r = d.big ? 6 : 4;
      if (d.ring) el("circle", { cx: pt[0], cy: pt[1], r: r + 3, fill: "none", stroke: opts.teamColor || "#333", "stroke-width": 2, class: "us-ring" }, gDots);
      const c = el("circle", { cx: pt[0], cy: pt[1], r, class: "us-dot " + (d.tone || ""), "data-id": d.id }, gDots);
      if (d.label) el("title", {}, c).textContent = d.label;
      if (opts.onDot) {
        c.style.cursor = "pointer";
        c.addEventListener("click", (e) => { e.stopPropagation(); opts.onDot(d.id); });
      }
    }
    return svg;
  }

  window.USMap = { project, centroid, render };
})();

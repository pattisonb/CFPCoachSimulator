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

  const NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
    DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
    KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming" };

  // a state's bounding box [x, y, w, h] in canvas units (the outline's own points)
  const boxes = {};
  function stateBox(code) {
    if (boxes[code]) return boxes[code];
    const d = window.US_STATES && window.US_STATES.paths[code];
    if (!d) return null;
    const n = d.match(/-?\d+\.?\d*/g).map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
    return (boxes[code] = [x0, y0, x1 - x0, y1 - y0]);
  }

  // ----- zoom: the svg's viewBox is the camera. A box is [x, y, w, h] in canvas units. -----
  const MAX_ZOOM = 8, PAD = 0.08, ANIM_MS = 200, LABEL_AT = 0.4;
  // what a map remembers between redraws (the board redraws itself on every state tap), by opts.zoomKey
  const memory = {};
  const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // opts: {areas: {name: [states]}, staffed: {name: staff_name}, dots: [{id, home, xy (a ready [x, y], wins over home), tone, ring, big, label}],
  //        selectedState, onDot(id), onState(code), teamColor}
  function render(opts) {
    opts = opts || {};
    const S = window.US_STATES;
    const svg = el("svg", { viewBox: S.viewBox, class: "us-map", role: "group", tabindex: "0",
      "aria-label": "Map of recruiting areas. Plus and minus zoom, arrows pan, Escape shows the whole country" });
    const counts = opts.counts || {};
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
        const p = el("path", { d: S.paths[code], "data-state": code, class: "us-state", fill, stroke: "var(--us-line, #fff)", "stroke-width": 0.8 }, g);
        if (staffed[name]) el("title", {}, p).textContent = name + " (" + staffed[name] + ")";
        else el("title", {}, p).textContent = name;
      }
    }
    const gRest = el("g", { class: "us-rest" }, svg);
    for (const code of Object.keys(S.paths)) {
      if (drawn.has(code)) continue;
      el("path", { d: S.paths[code], "data-state": code, class: "us-state", fill: "var(--us-none, #f3f2ee)", stroke: "var(--us-line, #fff)", "stroke-width": 0.8 }, gRest);
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
        const n = counts[code] || 0;
        p.setAttribute("tabindex", "0");
        p.setAttribute("role", "button");
        p.setAttribute("aria-label", `${NAMES[code] || code}: ${n} ${n === 1 ? "prospect" : "prospects"}`);
        // the second click of a double-click is the zoom's, not a second toggle of the filter
        p.addEventListener("click", (e) => { if (e.detail > 1 || zoom.swallow()) return; zoom.pick(code); });
        // after a double-click the filter matches the zoom: a state the first click cleared is picked again
        p.addEventListener("dblclick", () => { if (zoom.selected() !== code) zoom.pick(code); else zoom.zoomToState(code); });
        p.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          zoom.pick(code);
        });
      }
    });
    // the selected state's thick outline is painted last among the states, so its neighbors never cover it
    const picked = svg.querySelector("path.selected");
    if (picked) el("g", { class: "us-selected" }, svg).appendChild(picked);
    const gDots = el("g", { class: "us-dots" }, svg);
    for (const d of opts.dots || []) {
      const pt = d.xy || project(d.home);
      if (!pt) continue;
      const r = d.big ? 6 : 4;
      if (d.ring) el("circle", { cx: pt[0], cy: pt[1], r: r + 3, fill: "none", stroke: opts.teamColor || "#333", "stroke-width": 2, class: "us-ring", "data-r": r + 3 }, gDots);
      const c = el("circle", { cx: pt[0], cy: pt[1], r, class: "us-dot " + (d.tone || ""), "data-id": d.id, "data-r": r }, gDots);
      if (d.name) c.dataset.name = d.name;
      if (d.label) el("title", {}, c).textContent = d.label;
      if (opts.onDot) {
        c.style.cursor = "pointer";
        c.addEventListener("click", (e) => { e.stopPropagation(); opts.onDot(d.id); });
      }
    }
    const zoom = zoomer(svg, gDots, opts);
    svg.zoom = zoom;
    return svg;
  }

  // The camera: zoomTo(box), zoomToState(code), zoomToStates(codes), reset(); the wheel, pinch, drag and keys.
  // Dots and rings keep their screen size at any zoom; past LABEL_AT of the full width every dot in view shows its name.
  function zoomer(svg, gDots, opts) {
    const S = window.US_STATES;
    const FULL = S.viewBox.split(/[\s,]+/).map(Number);
    const [FX, FY, FW, FH] = FULL;
    const mem = opts.zoomKey ? (memory[opts.zoomKey] || (memory[opts.zoomKey] = { box: FULL, state: null, region: null, focus: null })) : { box: FULL, state: null, region: null, focus: null };
    let cur = FULL, anim = 0, swallowClick = false;

    // the box as the element shows it (the frame's aspect, centered: preserveAspectRatio meet)
    function shown(b) {
      const [x, y, w, h] = b;
      const s = Math.max(w / FW, h / FH);
      return [x + w / 2 - (s * FW) / 2, y + h / 2 - (s * FH) / 2, s * FW, s * FH];
    }
    // keep the shown frame between 1x and MAX_ZOOM and inside the canvas; the box moves with it
    function clamp(b) {
      let [x, y, w, h] = b;
      let v = shown(b);
      const grow = Math.min(Math.max(v[2], FW / MAX_ZOOM), FW) / v[2];
      if (grow !== 1) { const cx = x + w / 2, cy = y + h / 2; w *= grow; h *= grow; x = cx - w / 2; y = cy - h / 2; v = shown([x, y, w, h]); }
      const dx = Math.min(Math.max(v[0], FX), FX + FW - v[2]) - v[0];
      const dy = Math.min(Math.max(v[1], FY), FY + FH - v[3]) - v[1];
      return [x + dx, y + dy, w, h];
    }
    const isFull = (b) => b.every((n, i) => Math.abs(n - FULL[i]) < 0.01);
    const scaleOf = (b) => Math.min(FW / b[2], FH / b[3]);      // 1 at the whole map
    // screen pixels per canvas unit at 1x (a fallback while the map is not on the page)
    const basePx = () => (svg.clientWidth || 760) / FW;

    // set(box): the camera moves and the labels are laid out now; set(box, "anim"): one frame of an animation (sizes only,
    // the labels hidden until its last frame); set(box, "live"): a wheel tick, drag or pinch move (sizes only, the
    // labels laid out once ~80 ms after the last one)
    let settleT = 0;
    function set(b, mode) {
      cur = isFull(b) ? FULL : b;
      mem.box = cur;
      svg.setAttribute("viewBox", cur === FULL ? S.viewBox : cur.map((n) => +n.toFixed(2)).join(" "));
      sizes();
      clearTimeout(settleT);
      if (!mode) { svg.classList.remove("moving"); layout(); return; }
      svg.classList.add("moving");
      if (mode === "live") settleT = setTimeout(() => requestAnimationFrame(() => { svg.classList.remove("moving"); layout(); }), 80);
    }
    const sized = [...gDots.querySelectorAll("circle[data-r]")];
    const rings = sized.filter((c) => c.classList.contains("us-ring"));
    function sizes() {
      const k = scaleOf(cur);
      svg.classList.toggle("zoomed", k > 1.001);
      for (const c of sized) c.setAttribute("r", +(c.dataset.r / k).toFixed(3));
      for (const c of rings) c.setAttribute("stroke-width", +(2 / k).toFixed(3));
    }
    function layout() {
      const k = scaleOf(cur);
      for (const t of gDots.querySelectorAll(".us-label, .us-leader")) t.remove();
      if (cur[2] >= LABEL_AT * FW) return;
      const px = basePx() * k;              // screen pixels per canvas unit now
      const [vx, vy, vw, vh] = shown(cur);
      const size = 11 / px, gap = 3 / px, lh = size * 1.3;
      const inView = [...gDots.querySelectorAll("circle.us-dot")].filter((c) => {
        const x = +c.getAttribute("cx"), y = +c.getAttribute("cy");
        return c.dataset.name && x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
      }).sort((a, b) => a.getAttribute("cy") - b.getAttribute("cy") || a.getAttribute("cx") - b.getAttribute("cx"));
      // a city's cluster of dots would print its names on top of each other: a label that would cover another
      // tries a line or a few above or below, on the right then the left, with a thin leader back to its dot;
      // one with no room left stays hidden (its dot keeps the hover title) until a closer zoom spreads them out
      const placed = [];
      const free = (x, y, w) => placed.every((q) => x + w <= q[0] || q[0] + q[2] <= x || y + lh <= q[1] || q[1] + lh <= y);
      const SLOTS = [0, 1, -1, 2, -2, 3, -3, 4, -4];
      for (const c of inView) {
        const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"), r = +c.getAttribute("r");
        const w = c.dataset.name.length * size * 0.6;
        let at = null;
        for (const side of [1, -1]) {
          for (const n of SLOTS) {
            const x = side > 0 ? cx + r + gap : cx - r - gap - w, y = cy + n * lh;
            if (x >= vx && x + w <= vx + vw && y - lh / 2 >= vy && y + lh / 2 <= vy + vh && free(x, y - lh / 2, w)) { at = [x, y, side]; break; }
          }
          if (at) break;
        }
        const [x, y, side] = at || [cx + r + gap, cy, 1];
        if (at) placed.push([x, y - lh / 2, w]);
        if (at && y !== cy) el("line", { x1: cx, y1: cy, x2: side > 0 ? x - gap / 2 : x + w + gap / 2, y2: y, class: "us-leader", "stroke-width": +(1 / px).toFixed(3) }, gDots);
        const t = el("text", { x, y, class: "us-label" + (at ? "" : " crowded"), "data-id": c.dataset.id, "font-size": +size.toFixed(3),
          "stroke-width": +(3 / px).toFixed(3), "dominant-baseline": "central" }, gDots);
        t.textContent = c.dataset.name;
      }
    }
    function animateTo(b) {
      cancelAnimationFrame(anim);
      const from = cur, to = isFull(b) ? FULL : b;
      if (reduced() || typeof requestAnimationFrame !== "function") return set(to);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ANIM_MS), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        if (t >= 1) return set(to);
        set(from.map((n, i) => n + (to[i] - n) * e), "anim");
        anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }
    const padded = (b) => { const [x, y, w, h] = b, p = Math.max(w, h) * PAD; return [x - p, y - p, w + 2 * p, h + 2 * p]; };
    function union(codes) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of codes) {
        const b = stateBox(c);
        if (!b) continue;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
      }
      return x0 === Infinity ? null : [x0, y0, x1 - x0, y1 - y0];
    }
    const changed = () => { if (opts.onZoom) opts.onZoom({ region: mem.region, zoomed: cur !== FULL }); };

    function zoomTo(box) { if (box) animateTo(clamp(box)); }
    function zoomToState(code) { const b = stateBox(code); if (b) { mem.region = null; zoomTo(padded(b)); changed(); } }
    function zoomToStates(codes, region) { const b = union(codes || []); if (b) { mem.region = region || null; zoomTo(padded(b)); changed(); } }
    function reset() { mem.region = null; animateTo(FULL); changed(); }
    // zoom by a factor around a canvas point (the center by default); instant, for the wheel, pinch and keys
    function zoomBy(f, at) {
      const v = shown(cur);
      const [ux, uy] = at || [v[0] + v[2] / 2, v[1] + v[3] / 2];
      const w = Math.min(Math.max(v[2] / f, FW / MAX_ZOOM), FW), r = w / v[2];
      cancelAnimationFrame(anim);
      set(clamp([ux - (ux - v[0]) * r, uy - (uy - v[1]) * r, w, v[3] * r]), "live");
    }
    function panBy(dx, dy) { const v = shown(cur); cancelAnimationFrame(anim); set(clamp([v[0] + dx, v[1] + dy, v[2], v[3]]), "live"); }
    // a screen point to canvas units
    function toCanvas(cx, cy) {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return [p.x, p.y];
    }
    const unitPx = () => { const m = svg.getScreenCTM(); return (m && m.a) || basePx(); };

    // a state picked (click, Enter): the caller's filter toggles and the map follows it; without one, just zoom
    function pick(code) {
      mem.focus = code;
      if (opts.onState) opts.onState(code);
      else if (mem.state === code) { mem.state = null; reset(); }
      else { mem.state = code; zoomToState(code); }
    }
    // Escape, "Whole country": clear the state filter (if any) and show the whole map
    function home() {
      if (opts.onReset) opts.onReset();
      else reset();
    }

    svg.addEventListener("wheel", (e) => {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      if (f < 1 && cur === FULL) return;         // nothing to zoom out of: the page scrolls
      e.preventDefault();
      zoomBy(f, toCanvas(e.clientX, e.clientY));
      mem.region = null; changed();
    }, { passive: false });

    // drag pans, two pointers pinch; a drag that moved is not a click
    const ptrs = new Map();
    let last = null, moved = 0;
    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      last = null; moved = 0;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId);
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const ps = [...ptrs.values()];
      if (ps.length >= 2) {
        const [a, b] = ps, d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last && last.d) {
          const at = toCanvas(mid[0], mid[1]);
          if (at) zoomBy(d / last.d, at);
          const u = unitPx();
          panBy(-(mid[0] - last.mid[0]) / u, -(mid[1] - last.mid[1]) / u);
          moved = 99;
        }
        last = { d, mid };
        return;
      }
      moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
      if (moved < 5 || cur === FULL) return;
      if (!svg.classList.contains("dragging")) { svg.classList.add("dragging"); try { svg.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } }
      const u = unitPx();
      panBy(-(e.clientX - prev[0]) / u, -(e.clientY - prev[1]) / u);
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      last = null;
      if (svg.classList.contains("dragging") || moved >= 5) { swallowClick = moved >= 5; svg.classList.remove("dragging"); if (swallowClick) changed(); }
      if (!ptrs.size) setTimeout(() => { swallowClick = false; }, 0);
    };
    // two fingers on the map are the map's pinch, not a page scroll (one finger at 1x still scrolls the page)
    svg.addEventListener("touchstart", (e) => { if (e.touches.length >= 2 && e.cancelable) e.preventDefault(); }, { passive: false });
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    // a click that ends a drag picks nothing
    svg.addEventListener("click", (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);

    svg.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;      // browser zoom, back and forward stay the browser's
      const v = shown(cur);
      if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.5);
      else if (e.key === "ArrowLeft") panBy(-v[2] * 0.1, 0);
      else if (e.key === "ArrowRight") panBy(v[2] * 0.1, 0);
      else if (e.key === "ArrowUp") panBy(0, -v[3] * 0.1);
      else if (e.key === "ArrowDown") panBy(0, v[3] * 0.1);
      else if (e.key === "Escape") {
        if (cur === FULL && !mem.state && !opts.selectedState) return;      // nothing to undo: let Escape reach the page
        home();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });

    // where this map starts: where the last one was, then toward the state filter it now shows (or away from the one it lost)
    const sel = opts.selectedState || null;
    set(clamp(mem.box || FULL));
    if (sel && mem.state !== sel) { mem.region = null; const b = stateBox(sel); if (b) animateTo(clamp(padded(b))); }
    else if (!sel && mem.state) { mem.region = null; animateTo(FULL); }
    mem.state = sel;
    // the state picked last gets the focus back once the redrawn map is on the page
    if (mem.focus) {
      const code = mem.focus;
      mem.focus = null;
      requestAnimationFrame(() => {
        const p = svg.isConnected && svg.querySelector(`path[data-state="${code}"]`);
        if (p) p.focus({ preventScroll: true });
      });
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(() => { if (cur !== FULL && !svg.classList.contains("moving")) layout(); }).observe(svg);

    return { zoomTo, zoomToState, zoomToStates, reset, home, pick, region: () => mem.region, swallow: () => swallowClick,
      selected: () => (opts.onState ? opts.selectedState || null : mem.state) };
  }

  window.USMap = { project, centroid, stateBox, render };
})();

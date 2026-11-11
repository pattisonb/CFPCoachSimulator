/* The recruit profile's shared pieces (web/profile.css): the hero header, the card grid, the Scouting Report, the
   Attributes bars, Looks & Uncertainty, the Scout's Summary and the traits card. The recruiting board's pane, the
   Prospect Profile popup (web/recruiting.js) and the Scouting Center (web/scouting.js) draw him with these, so the
   three read alike. Everything shown comes from what the viewer's staff know (prospects.report on the server, the
   traits view); nothing here reads a true grade. window.CFP.pv = { pips, card, grid, hero, attrRows, attributesCard,
   reportCard, summaryCard, uncertaintyCard, traitsCard, traitRows }. Loaded after ui.js, before recruiting.js. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const REPORT_LOOKS = 3;
  const NOT_KNOWN = "Not Known Yet";
  const ATTRS = [["athleticism", "Athleticism"], ["football_iq", "Football IQ"], ["technique", "Technique"], ["size_strength", "Size / Strength"], ["coachability", "Coachability"]];
  const fmtLooks = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));
  const range = (w) => (!w ? "" : w[0] === w[1] ? w[0] : `${w[0]} – ${w[1]}`);
  const titleCase = (k) => String(k).split(/[_\s]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

  // the looks as three pips filled in halves ("1.5 of 3 Looks" for a screen reader)
  function pips(looks, n = REPORT_LOOKS, label) {
    const x = Math.max(0, Math.min(n, Number(looks) || 0));
    return el("span", { class: "pv-pips", role: "img", "aria-label": label || `${fmtLooks(x)} of ${n} looks` },
      Array.from({ length: n }, (_, i) => el("i", { class: x >= i + 1 ? "f" : x > i ? "h" : "" })));
  }
  // a card: its kicker (Title Case), an optional ⓘ and a right-hand note, then its body. opts.wide spans the grid's row.
  function card(kicker, body, opts = {}) {
    const head = el("div", { class: "card-bar pv-card-head" }, [el("h3", { class: "pv-kick", text: kicker }), opts.sub ? el("span", { class: "muted small pv-kick-sub", text: opts.sub }) : null,
      opts.tip ? window.CFP.ui.tip(opts.tip, kicker) : null, opts.right ? el("span", { class: "pv-card-right" }, [].concat(opts.right)) : null]);
    return el("section", { class: `pv-card ${opts.wide ? "pv-wide" : ""} ${opts.cls || ""}`.trim(), "data-key": opts.key || kicker, "aria-label": kicker }, [head, ...[].concat(body)]);
  }
  // the cards in two columns (one on a narrow pane); a wide card takes the whole row, and so does a lone last card
  function grid(cards, cls) {
    const list = cards.filter(Boolean);
    const narrow = list.filter((c) => !c.classList.contains("pv-wide"));
    if (narrow.length % 2 === 1) narrow[narrow.length - 1].classList.add("pv-wide");
    return el("div", { class: `pv-grid ${cls || ""}`.trim() }, list);
  }

  // the header: avatar, a tag chip, the name (a node: the pane's name button), stars, Pos · Archetype | Height | Weight,
  // Hometown · Class of 2027; on the right the stats in one bordered strip (kicker / value / sub, with inner dividers) and
  // a badge (Your Chance or Potential) with a bar only when there is a chance to show (fill null: no bar)
  function hero(d) {
    const posLine = d.pos ? el("span", { class: "pv-posline" }, [el("b", { class: "pv-pos", text: d.pos }),
      d.arch ? el("span", { class: "pv-sep", "aria-hidden": "true", text: "·" }) : null, d.arch ? el("span", { class: "pv-arch", text: d.arch }) : null]) : null;
    const line = [posLine, d.height ? el("span", { text: d.height }) : null, d.weight ? el("span", { text: d.weight }) : null].filter(Boolean);
    const stats = (d.stats || []).filter(Boolean).map((x) => el("div", { class: "pv-stat", "data-stat": x.key || x.label }, [
      el("div", { class: "pv-kick", text: x.label }), el("div", { class: `pv-stat-v ${x.tone || ""}`, text: x.value }), x.sub ? el("div", { class: "pv-stat-s muted", text: x.sub }) : null]));
    const strip = stats.length ? el("div", { class: "pv-strip", role: "group", "aria-label": "Rankings" }, stats) : null;
    const b = d.badge;
    const badge = b ? el("div", { class: `pv-badge ${b.tone || ""}`, "data-key": "badge" }, [el("div", { class: "pv-kick", text: b.kicker }), el("div", { class: "pv-badge-v", text: b.value }),
      b.sub ? el("div", { class: "pv-badge-s", text: b.sub }) : null,
      b.fill != null ? el("div", { class: "pv-thin", role: "img", "aria-label": `${b.kicker}: ${b.value}` }, [el("i", { style: `width:${Math.round(100 * Math.max(0, Math.min(1, b.fill)))}%` })]) : null]) : null;
    return el("div", { class: "pv-hero" }, [
      el("div", { class: "pv-who" }, [d.back || null, d.avatar, el("div", { class: "pv-id" }, [
        d.tag || null, d.nameNode, el("div", { class: "pv-line" }, [d.stars ? el("span", { class: "go-stars", text: d.stars, "aria-label": d.starsLabel || null }) : null,
          ...line.flatMap((n, i) => (i ? [el("span", { class: "pv-sep", "aria-hidden": "true", text: "|" }), n] : [n]))]),
        d.place ? el("div", { class: "muted pv-place", text: d.place }) : null])]),
      el("div", { class: "pv-right" }, [strip, badge])]);
  }

  // one bar: the read's range as a light band, its midpoint as the fill, in the read's tone
  function bar(a) {
    if (!a) return el("div", { class: "pv-bar empty" });
    const lo = Math.max(0, a.lo), hi = Math.min(100, a.hi);
    return el("div", { class: `pv-bar ${a.tone}`, role: "img", "aria-label": range(a.words) }, [
      hi > lo ? el("i", { class: "pv-band", style: `left:${lo}%;width:${hi - lo}%` }) : null, el("i", { class: "pv-fill", style: `width:${Math.max(2, a.mid)}%` })]);
  }
  // the Attributes rows: label, bar, words ("Solid – Strong"); before a look the bars are empty and read "Not Scouted"
  function attrRows(report) {
    const by = Object.fromEntries(((report && report.attributes) || []).map((a) => [a.group, a]));
    return el("div", { class: "pv-attrs" }, ATTRS.map(([g, label]) => {
      const a = by[g];
      return el("div", { class: "pv-attr", "data-group": g }, [el("span", { class: "pv-attr-k", text: (a && a.label) || label }), bar(a),
        el("span", { class: `pv-attr-w ${a ? "" : "muted"}`, text: a ? range(a.words) : "Not Scouted" })]);
    }));
  }
  function attributesCard(report, opts = {}) {
    const rows = attrRows(report);
    if (opts.tips) opts.tips(rows);
    return card("Attributes", [rows], { sub: "(Scouted Range)", key: "attributes", cls: "pv-attributes", wide: opts.wide });
  }
  // Strengths and Areas to Develop, each a list or "None Stand Out"
  function lists(report) {
    const list = (title, xs, mark, cls) => el("div", { class: `pv-list ${cls}` }, [el("div", { class: "pv-kick", text: title }),
      xs && xs.length ? el("ul", {}, xs.map((t) => el("li", {}, [el("span", { class: "pv-mark", "aria-hidden": "true", text: mark }), t]))) : el("p", { class: "muted pv-none", text: "None Stand Out" })]);
    return [list("Strengths", report.strengths, "+", "pv-plus"), list("Areas to Develop", report.develop, "–", "pv-minus")];
  }
  // the Scouting Report: looks pips and count in the head, "Potential: Elite", the verdict, the two lists, then a foot line
  // (the comp once his report is complete, or what the next look does) and any extra nodes (a Send button)
  function reportCard(report, opts = {}) {
    const looks = Math.min(REPORT_LOOKS, Number(opts.looks) || 0);
    const right = [pips(looks), el("span", { class: "muted pv-looks", text: `${fmtLooks(looks)} of ${REPORT_LOOKS} Looks` })];
    const body = report ? [
      el("div", { class: `pv-potential ${opts.potentialTone || "good"}`, "data-group": "potential" }, [el("span", { text: "Potential: " }), el("b", { text: report.headline })]),
      el("p", { class: "pv-verdict", text: report.verdict }), el("div", { class: "pv-cols" }, lists(report))]
      : [el("p", { class: "pv-verdict muted pv-unscouted", text: "Send a scout to read him." })];
    if (opts.foot) body.push(opts.foot);
    if (opts.extra) body.push(...[].concat(opts.extra).filter(Boolean));
    return card("Scouting Report", body, { tip: opts.tip, right, key: "report", cls: "pv-report", wide: opts.wide });
  }
  // the Scout's Summary (the board's Overview): the verdict, Strengths, Areas to Develop in three columns, full width
  function summaryCard(report, opts = {}) {
    const body = report ? el("div", { class: "pv-summary" }, [el("p", { class: "pv-verdict", text: report.verdict }), ...lists(report)])
      : el("p", { class: "muted pv-verdict pv-unscouted", text: "Send a scout to read him." });
    return card("Scout's Summary", [body, ...(opts.extra || [])], { wide: true, key: "summary", cls: "pv-summary-card" });
  }
  // Looks & Uncertainty: per attribute a pip meter (three for a sure read, one for a wide one) and Low / Medium / High,
  // flowing in columns across the card; then any extra blocks (This Week's looks, flags, the comp)
  const PIPS_FOR = { Low: 3, Medium: 2, High: 1 };
  function uncertaintyCard(report, extra, opts = {}) {
    const by = Object.fromEntries(((report && report.attributes) || []).map((a) => [a.group, a]));
    const rows = el("div", { class: "pv-unc" }, ATTRS.map(([g, label]) => {
      const u = by[g] && by[g].uncertainty;
      return el("div", { class: "pv-unc-row", "data-group": g }, [el("span", { class: "pv-attr-k", text: label }),
        pips(u ? PIPS_FOR[u] : 0, 3, u ? `${label}: ${u} uncertainty` : `${label}: not scouted`), el("span", { class: "muted pv-unc-w", text: u || "Not Scouted" })]);
    }));
    return card("Looks & Uncertainty", [rows, ...[].concat(extra || []).filter(Boolean)], { wide: opts.wide !== false, key: "uncertainty", cls: "pv-uncertainty",
      tip: "Each look narrows a read: three dots is a confident read (Low uncertainty), one a wide one (High)." });
  }

  // the traits, from whatever the traits view carries: Who Decides with what that person Cares About, Personality, His Story,
  // Commit Style, then any other trait the server adds (its label from TRAIT_LABELS or its key). A trait not known yet reads
  // "Not Known Yet" with how it is revealed (hints, from the server). notes: a known trait's sentence (his story's tip).
  const TRAIT_LABELS = { decider: "Who Decides", personality: "Personality", story: "His Story", commit_style: "Commit Style", twist: "Twist" };
  const TRAIT_ORDER = ["decider", "cares", "personality", "story", "commit_style"];
  const META = /_(key|detail|topic|hint|line|tip|label|known)$|^has_/;     // fields about a trait, not traits (has_style: he has one at all)
  function traitRows(traits, hints, opts = {}) {
    const tr = traits || {}, hint = hints || {};
    const names = opts.pitchNames || {};
    // a trait the server says he does not have (has_<x> false, e.g. no commit style) is no row at all
    const keys = Object.keys(tr).filter((k) => !META.test(k) && typeof tr[k] !== "boolean" && !(k === "commit_style" && tr.has_style === false));
    const order = [...TRAIT_ORDER.filter((k) => k === "cares" || keys.includes(k)), ...keys.filter((k) => !TRAIT_ORDER.includes(k))];
    return order.flatMap((k) => {
      if (k === "cares") {
        const known = tr.decider_topic ? names[tr.decider_topic] || titleCase(tr.decider_topic)
          : tr.decider && (opts.priorities || []).length ? opts.priorities.map((t) => names[t] || titleCase(t)).join(", ") : null;
        const h = known ? null : tr.decider ? "A call tells you what he cares about." : hint.decider || null;
        const row = traitRow("cares", "Cares About", known, null, h);
        if (!(opts.priorities || []).length || !opts.caseWord) return row;
        // his known priorities beside your program's case on each (School Grades Phase 2: what he wants next to your grade)
        const wants = el("div", { class: "pv-row go-wants-row", "data-trait": "wants" }, [el("span", { class: "pv-row-k go-trait-label", text: "What He Wants" }),
          el("span", { class: "pv-row-v go-wants" }, opts.priorities.map((t) => { const w = opts.caseWord(t); return el("span", { class: "go-want" }, [
            el("b", { text: names[t] || titleCase(t) }), w ? el("span", { class: `go-tag ${w === "Strong" ? "good" : w === "Weak" ? "bad" : ""}`, title: `Your program's case on ${(names[t] || t).toLowerCase()}`, text: w }) : null]); }))]);
        return [row, wants];
      }
      const v = tr[k];
      const val = v == null ? null : typeof v === "string" ? v : v.label || String(v);
      const detail = tr[`${k}_detail`] || null;
      return traitRow(k, TRAIT_LABELS[k] || titleCase(k), val, detail, val ? (opts.notes || {})[k] || null : hint[k] || null);
    });
    function traitRow(key, label, val, detail, note) {
      return el("div", { class: "pv-row go-trait", "data-trait": key }, [el("span", { class: "pv-row-k go-trait-label", text: label }),
        el("span", { class: "pv-row-v" }, [el("b", { class: `go-trait-val ${val ? "" : "muted"}`, text: val ? `${val}${detail ? ` · ${detail}` : ""}` : NOT_KNOWN }),
          note ? el("span", { class: `pv-hint muted ${val ? "pv-note" : ""}`, text: note }) : null])]);
    }
  }
  function traitsCard(traits, hints, opts = {}) {
    return card(opts.title || "His Profile", [el("div", { class: "pv-rows go-traits", "data-key": "traits" }, traitRows(traits, hints, opts)), ...[].concat(opts.extra || []).filter(Boolean)],
      { key: "traits", cls: "pv-traits", wide: opts.wide });
  }

  window.CFP.pv = { pips, card, grid, hero, bar, attrRows, attributesCard, reportCard, summaryCard, uncertaintyCard, traitsCard, traitRows, range, fmtLooks, NOT_KNOWN };
})();

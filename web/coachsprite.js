/* The coach portrait: an SVG head and shoulders from a coach's look options (coaches.LOOK)
   in a team's colors. Used by the Your coach page and the season page header. */
(function () {
  // ----- the sprite -------------------------------------------------------------------------
  // An SVG head-and-shoulders portrait from the look options and a team's colors.
  function sprite(look, colors) {
    const L = look || {};
    const skin = L.skin || "#e0b48f", hair = L.hair_color || "#4a3020";
    const primary = (colors && colors.primary) || "#2f6db3", secondary = (colors && colors.secondary) || "#ffffff";
    const shade = "rgba(0,0,0,0.12)";
    const parts = [];
    parts.push(`<circle cx="100" cy="100" r="96" fill="${primary}" opacity="0.16"/>`);
    // shoulders and outfit
    const body = `M28 230 C30 175 60 160 100 160 C140 160 170 175 172 230 Z`;
    parts.push(`<path d="${body}" fill="${L.outfit === "suit" ? "#22262e" : primary}"/>`);
    if (L.outfit === "polo") {
      parts.push(`<path d="M78 162 L100 190 L122 162 L112 160 L100 176 L88 160 Z" fill="${secondary}"/>`);
      parts.push(`<circle cx="100" cy="196" r="2.5" fill="${secondary}"/><circle cx="100" cy="206" r="2.5" fill="${secondary}"/>`);
    } else if (L.outfit === "quarter-zip") {
      parts.push(`<path d="M84 160 L100 168 L116 160 L116 170 L100 178 L84 170 Z" fill="${secondary}"/>`);
      parts.push(`<line x1="100" y1="176" x2="100" y2="214" stroke="${secondary}" stroke-width="3"/>`);
    } else if (L.outfit === "hoodie") {
      parts.push(`<path d="M62 168 C70 150 130 150 138 168 C126 176 74 176 62 168 Z" fill="${shade}"/>`);
      parts.push(`<line x1="92" y1="174" x2="90" y2="204" stroke="${secondary}" stroke-width="3"/><line x1="108" y1="174" x2="110" y2="204" stroke="${secondary}" stroke-width="3"/>`);
    } else if (L.outfit === "suit") {
      parts.push(`<path d="M84 160 L100 200 L116 160 Z" fill="#ffffff"/>`);
      parts.push(`<path d="M96 168 L104 168 L106 200 L100 210 L94 200 Z" fill="${primary}"/>`);
      parts.push(`<path d="M84 160 L100 200 L76 188 Z M116 160 L100 200 L124 188 Z" fill="#2c313b"/>`);
    }
    // neck, ears, head
    parts.push(`<rect x="88" y="140" width="24" height="26" rx="8" fill="${skin}"/>`);
    parts.push(`<rect x="88" y="150" width="24" height="10" fill="${shade}"/>`);
    parts.push(`<ellipse cx="60" cy="104" rx="8" ry="12" fill="${skin}"/><ellipse cx="140" cy="104" rx="8" ry="12" fill="${skin}"/>`);
    parts.push(`<ellipse cx="100" cy="100" rx="40" ry="48" fill="${skin}"/>`);
    // hair
    const h = L.hair;
    if (h === "short") parts.push(`<path d="M60 96 C58 60 80 50 100 50 C122 50 142 60 140 96 C136 80 124 68 100 68 C76 68 64 80 60 96 Z" fill="${hair}"/>`);
    if (h === "buzz") parts.push(`<path d="M62 92 C62 62 82 54 100 54 C118 54 138 62 138 92 C132 74 118 66 100 66 C82 66 68 74 62 92 Z" fill="${hair}" opacity="0.75"/>`);
    if (h === "side part") parts.push(`<path d="M60 98 C56 58 84 48 104 50 C128 52 144 66 140 98 C136 78 126 66 112 64 L86 72 C74 76 64 84 60 98 Z" fill="${hair}"/><path d="M86 72 L112 64" stroke="${shade}" stroke-width="2"/>`);
    if (h === "curly") for (const [x, y] of [[66, 80], [76, 64], [92, 56], [108, 56], [124, 64], [134, 80], [84, 66], [116, 66], [100, 62]]) parts.push(`<circle cx="${x}" cy="${y}" r="11" fill="${hair}"/>`);
    if (h === "long") parts.push(`<path d="M58 120 C50 60 80 48 100 48 C122 48 150 60 142 120 C140 100 138 86 126 74 C110 66 90 66 74 74 C62 86 60 100 58 120 Z" fill="${hair}"/>`);
    // face (a bald coach's brows are dark brown, everyone else's match his hair)
    const brow = h === "bald" ? "#3b2a20" : hair;
    parts.push(`<path d="M80 92 Q88 87 96 92" stroke="${brow}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    parts.push(`<path d="M104 92 Q112 87 120 92" stroke="${brow}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    parts.push(`<circle cx="88" cy="102" r="3.4" fill="#1d2433"/><circle cx="112" cy="102" r="3.4" fill="#1d2433"/>`);
    parts.push(`<path d="M100 104 Q96 116 101 118" stroke="${shade}" stroke-width="2.4" fill="none"/>`);
    parts.push(`<path d="M88 128 Q100 136 112 128" stroke="#8a4b3b" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    // facial hair
    const fh = L.facial_hair;
    if (fh === "stubble") parts.push(`<path d="M64 112 C66 140 84 150 100 150 C116 150 134 140 136 112 C130 132 116 140 100 140 C84 140 70 132 64 112 Z" fill="${hair}" opacity="0.28"/>`);
    if (fh === "mustache" || fh === "goatee" || fh === "beard") parts.push(`<path d="M84 124 Q100 116 116 124 Q100 122 84 124 Z" fill="${hair}" stroke="${hair}" stroke-width="4" stroke-linejoin="round"/>`);
    if (fh === "goatee") parts.push(`<path d="M92 136 Q100 150 108 136 Q100 140 92 136 Z" fill="${hair}" stroke="${hair}" stroke-width="3"/>`);
    if (fh === "beard") parts.push(`<path d="M62 106 C62 144 84 152 100 152 C116 152 138 144 138 106 C134 128 122 134 112 132 Q100 138 88 132 C78 134 66 128 62 106 Z" fill="${hair}"/>`);
    // glasses
    const g = L.glasses;
    if (g === "round") parts.push(`<circle cx="88" cy="102" r="10" fill="none" stroke="#1d2433" stroke-width="2.5"/><circle cx="112" cy="102" r="10" fill="none" stroke="#1d2433" stroke-width="2.5"/><path d="M98 102 L102 102" stroke="#1d2433" stroke-width="2.5"/>`);
    if (g === "square") parts.push(`<rect x="77" y="94" width="22" height="16" rx="3" fill="none" stroke="#1d2433" stroke-width="2.5"/><rect x="101" y="94" width="22" height="16" rx="3" fill="none" stroke="#1d2433" stroke-width="2.5"/>`);
    if (g === "sunglasses") parts.push(`<path d="M74 96 L126 96 L124 108 Q112 116 102 106 L98 106 Q88 116 76 108 Z" fill="#14171d"/>`);
    // headwear
    const hw = L.headwear;
    if (hw === "cap") {
      parts.push(`<path d="M58 88 C58 54 80 44 100 44 C120 44 142 54 142 88 Z" fill="${primary}"/>`);
      parts.push(`<path d="M56 88 L150 88 Q160 92 148 98 L56 94 Z" fill="${primary}" stroke="${shade}" stroke-width="1"/>`);
      parts.push(`<circle cx="100" cy="66" r="9" fill="${secondary}"/>`);
    } else if (hw === "visor") {
      parts.push(`<path d="M60 80 L140 80 L140 88 L60 88 Z" fill="${primary}"/><path d="M58 88 L152 88 Q160 92 150 98 L58 94 Z" fill="${primary}"/>`);
    } else if (hw === "headset") {
      parts.push(`<path d="M56 104 C54 52 146 52 144 104" stroke="#2a2f38" stroke-width="6" fill="none"/>`);
      parts.push(`<rect x="48" y="94" width="14" height="24" rx="6" fill="#2a2f38"/><rect x="138" y="94" width="14" height="24" rx="6" fill="#2a2f38"/>`);
      parts.push(`<path d="M55 116 Q60 136 84 132" stroke="#2a2f38" stroke-width="3" fill="none"/><circle cx="86" cy="132" r="4" fill="#2a2f38"/>`);
    }
    return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Coach portrait">${parts.join("")}</svg>`;
  }
  window.CoachSprite = sprite;
})();

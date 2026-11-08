/* Vercel Web Analytics: page views on the Vercel site only. window.va queues events until Vercel's script
   (served by Vercel at _vercel/insights/script.js once Web Analytics is on in the dashboard) loads and sends them.
   The script loads by a relative address (every URL in the site is relative) and only where Vercel serves it:
   not on the old GitHub Pages address or the local dev server, which have no such file. */
(function () {
  "use strict";
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".github.io") || location.protocol === "file:") return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "./_vercel/insights/script.js";
  document.head.appendChild(s);
})();

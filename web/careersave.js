/* A Coach Career as a file: Download career saves everything (every game's box score) as a
   .ccsave to keep or open on another device, and Load career opens one again. The game keeps
   its own saves (in the browser's storage when the site runs there, on disk under data/ with
   tools/dev_server.py); these are the copies you hold.
   window.CareerSave: download(id), upload(file), both through window.CFP.game.fetch. */
(function () {
  async function download(id) {
    const res = await window.CFP.game.fetch(`/api/season/${id}/export?full=true`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `coach-career-${id}.ccsave` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function upload(file) {
    const res = await window.CFP.game.fetch("/api/season/import", { method: "POST", headers: { "Content-Type": "application/gzip" }, body: file });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  window.CareerSave = { download, upload };
})();

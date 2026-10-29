/* Coach Career saves kept in this browser (IndexedDB), so a career survives the free server
   forgetting it on a restart: after every save the page keeps the career's state (your games'
   box scores ride in it; other games' do not), and when the server no longer has it the page
   uploads it back (the server keeps whichever copy is newer). Download career saves everything.
   window.CareerSave: backup(summary), restore(id), list(), remove(id), download(id), upload(file). */
(function () {
  const DB = "cfp-careers", STORE = "saves";

  function db() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  const get = (id) => tx("readonly", (s) => s.get(id));
  const list = () => tx("readonly", (s) => s.getAll()).then((rows) => rows || []);
  const remove = (id) => tx("readwrite", (s) => s.delete(id));

  // Keep the career's latest export, fetched only when the server saved something new.
  async function backup(summary) {
    const c = summary && summary.career;
    if (!c) return;
    try {
      const have = await get(summary.id);
      if (have && have.saved_at === c.saved_at && have.saved_week === c.saved_week) return;
      const res = await fetch(`/api/season/${summary.id}/export`);
      if (!res.ok) return;
      const blob = await res.blob();
      await tx("readwrite", (s) => s.put({ id: summary.id, blob, team_name: summary.team_name, saved_week: c.saved_week,
                                           saved_at: c.saved_at, record: summary.record }));
    } catch (e) { /* private window or storage blocked: the career still plays, it just is not kept here */ }
  }

  async function sendBlob(blob) {
    const res = await fetch("/api/season/import", { method: "POST", headers: { "Content-Type": "application/gzip", "X-CFP-Browser": (window.CFP && window.CFP.browserId) ? window.CFP.browserId() : "" }, body: blob });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  // Upload this browser's copy of a career the server has forgotten; null when there is none.
  async function restore(id) {
    let have;
    try { have = await get(id); } catch (e) { return null; }
    return have ? sendBlob(have.blob) : null;
  }

  async function download(id) {
    const res = await fetch(`/api/season/${id}/export?full=true`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `coach-career-${id}.ccsave` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const upload = (file) => sendBlob(file);

  window.CareerSave = { backup, restore, list, remove, download, upload };
})();

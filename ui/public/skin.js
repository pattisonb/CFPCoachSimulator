/* Skins: a file the player loads to give the published game other names (ui/src/skin.ts loads one, worker.js and the
   page's own start use it). The published site carries lookalike names (tools/generic); a skin (tools/make_skin.mjs
   makes one) holds the names and the rosters to show instead, and lives in this browser only (IndexedDB).

   This file is the part every side shares, as a plain script that sets `Skin`: the page (index.html, before the app),
   the game's worker (importScripts) and Node (the build and the tests import it for the same code).

   A skin changes two things. Data: files the game reads (worker.js). Words inside the site's own scripts (game.js and
   the app): the build publishes, beside each script, a list of the spots where a name stands (`*.names.json`: where,
   how long, what kind of spot and a 16-bit mark of the name that belongs there, never the name), and `apply` puts the
   skin's name in each spot.

   A skin is a file from outside and must not be able to run code. What `apply` guarantees:
     - it writes only at the spots the site itself lists, each of them inside a string (or a property's name), which
       the build found by reading the script as a program, not by searching its text;
     - what it writes is plain name text (`plain`): no backslash, backtick, dollar sign, brace, angle bracket or line
       break, at most 120 characters; a quote is written with a backslash before it, and a property's name is written
       as a quoted string (JSON.stringify). So nothing a skin holds can end the string it is written into. */
(function (root) {
  "use strict";

  var FORMAT = 1;                  // the skin file's format: a file of another format is refused
  var DB = "cfp-skin", STORE = "parts";      // IndexedDB: "meta", "words", "files", "sources", "cache"
  var FLAG = "cfp.skin";           // localStorage: {id, name} of the skin that is on (the page reads it before anything loads)
  var FAILED = "cfp.skin.failed";  // localStorage: why the last skin was taken off by the game itself, said once
  var WORD_MAX = 120;

  /** FNV-1a over a text's UTF-16 units, as an unsigned 32-bit number. */
  function hash(text, seed) {
    var h = seed === undefined ? 0x811c9dc5 : seed;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** The 16-bit mark of a name: which of a lookalike's names belongs in a spot. */
  function tag(name) { var h = hash(name); return ((h >>> 16) ^ h) & 0xffff; }

  // What a name may not hold: anything that could end or escape the string it is written into, or a line break.
  var UNSAFE = /[\\`${}<>\u0000-\u001f\u007f\u2028\u2029]/;
  function plain(name) { return typeof name === "string" && name.length > 0 && name.length <= WORD_MAX && !UNSAFE.test(name); }

  /** The skin's words as a lookup: lookalike -> the names it may stand for. Anything that is not plain text is left out. */
  function lookup(words) {
    var map = new Map();
    if (!words || typeof words !== "object") return map;
    var keys = Object.keys(words);
    for (var i = 0; i < keys.length; i++) {
      var list = words[keys[i]];
      if (!Array.isArray(list)) continue;
      var kept = list.filter(plain);
      if (kept.length) map.set(keys[i], kept);
    }
    return map;
  }

  /**
   * A script's text with the skin's names written into the spots the site lists for it. `names`: the script's
   * `*.names.json` ({format, length, hash, spots: [[at, length, mark, kind], ...], imports: [[at, length], ...]});
   * `words`: `lookup(skin.words)`; `base`: where the script was loaded from (its `./` imports are written out in full,
   * since the result is not loaded from there). Returns {text, done, missed}; a spot with no name of its mark in the
   * skin keeps the site's own. Throws when the list is not this script's.
   */
  function apply(text, names, words, base) {
    if (!names || names.format !== FORMAT || !Array.isArray(names.spots)) throw new Error("the list of names is not one this game reads");
    if (names.length !== text.length || names.hash !== hash(text)) throw new Error("the list of names is for another version of the script");
    var edits = [], i, s;
    for (i = 0; i < names.spots.length; i++) {
      s = names.spots[i];
      edits.push([s[0] | 0, s[1] | 0, s[2] | 0, String(s[3])]);
    }
    var imports = Array.isArray(names.imports) ? names.imports : [];
    for (i = 0; i < imports.length; i++) edits.push([imports[i][0] | 0, imports[i][1] | 0, 0, "i"]);
    edits.sort(function (a, b) { return a[0] - b[0]; });
    var out = [], at = 0, end = 0, done = 0, missed = 0;
    for (i = 0; i < edits.length; i++) {
      var from = edits[i][0], len = edits[i][1], mark = edits[i][2], kind = edits[i][3];
      if (from < end || len <= 0 || from + len > text.length) throw new Error("the list of names is damaged");
      end = from + len;
      var raw = text.substr(from, len), put = null;
      if (kind === "i") {
        if (base) put = new URL(raw, base).href;
      } else {
        var dot = kind === "b" && raw.charAt(0) === ".";
        var shown = kind === "s" ? raw.replace(/\\(['"])/g, "$1") : dot ? raw.slice(1) : raw;
        var list = words.get(shown), name = null;
        if (list) for (var k = 0; k < list.length; k++) if (tag(list[k]) === mark) { name = list[k]; break; }
        if (name === null || !plain(name)) missed++;
        else {
          done++;
          if (kind === "s") put = name.replace(/['"]/g, "\\$&");
          else if (kind === "k") put = JSON.stringify(name);
          else if (kind === "b") put = "[" + JSON.stringify(name) + "]";
        }
      }
      if (put === null) continue;
      out.push(text.slice(at, from), put);
      at = from + len;
    }
    out.push(text.slice(at));
    return { text: out.join(""), done: done, missed: missed };
  }

  /**
   * The game's data under a skin. `order`: the site's own data, as its paths were unpacked; `io`: {get, put, drop}
   * over the game's files; `meta`: the skin's; `files`: the skin's own files; `mark`: of the game's script. After it
   * the game's files are the ones the skin lists (`meta.pack`), less the ones the game makes itself
   * (`meta.generated`: the caller makes them from the skin's rosters, or has them kept under `key`). Returns
   * {stale: the site's data has changed since the skin was made, key: what the made files are kept under, which
   * changes when the site's own made files do}.
   */
  function dress(order, io, meta, files, mark) {
    var generated = new Set(meta.generated), pack = new Set(meta.pack), i, path;
    var base = hash(""), key = hash([FORMAT, meta.id, meta.made && meta.made.at, mark].join("|"));
    for (i = 0; i < order.length; i++) {
      path = order[i];
      if (generated.has(path)) key = hash(io.get(path), hash(path, key));
      else base = hash(io.get(path), hash(path, base));
    }
    for (i = 0; i < order.length; i++) if (!pack.has(order[i]) || generated.has(order[i])) io.drop(order[i]);
    var names = Object.keys(files);
    for (i = 0; i < names.length; i++) if (pack.has(names[i]) && !generated.has(names[i])) io.put(names[i], files[names[i]]);
    return { stale: base !== meta.base, key: key };
  }

  // ---- what this browser keeps ----------------------------------------------------------------------------------

  /** The skin that is on, as the page's flag says: {id, name} or null. */
  function flag() {
    try {
      var v = JSON.parse(root.localStorage.getItem(FLAG) || "null");
      return v && typeof v.id === "string" && typeof v.name === "string" ? v : null;
    } catch (e) { return null; }
  }

  function open() {
    return new Promise(function (resolve, reject) {
      var req = root.indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("the roster file is held by another page")); };
    });
  }

  /** The kept parts named, as {part: value} (a part that is not kept is undefined). */
  function read(parts) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly"), from = tx.objectStore(STORE), out = {};
        parts.forEach(function (p) { from.get(p).onsuccess = function (e) { out[p] = e.target.result; }; });
        tx.oncomplete = function () { db.close(); resolve(out); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error("the roster file could not be read")); };
      });
    });
  }

  /** Keep the parts given ({part: value}; a value of undefined removes the part), each in a transaction of its own. */
  function write(parts) {
    return open().then(function (db) {
      var names = Object.keys(parts);
      var one = function (p) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readwrite"), to = tx.objectStore(STORE);
          if (parts[p] === undefined) to.delete(p); else to.put(parts[p], p);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () { reject(tx.error || new Error("the roster file could not be kept")); };
        });
      };
      return names.reduce(function (before, p) { return before.then(function () { return one(p); }); }, Promise.resolve())
        .then(function () { db.close(); }, function (err) { db.close(); throw err; });
    });
  }

  /** Forget the skin (its careers stay where they are). */
  function clear() { return write({ meta: undefined, words: undefined, files: undefined, sources: undefined, cache: undefined }); }

  // ---- the page's start -----------------------------------------------------------------------------------------

  /**
   * Start the app (the build writes this call into index.html in place of the app's own script tag): as it is, or,
   * with a skin on, with the skin's names written into it first. Anything that goes wrong before the app runs starts
   * it as it is.
   */
  function boot(entry, names) {
    var url = new URL(entry, document.baseURI).href;
    var asIs = function () { return import(url); };
    if (!flag()) return asIs();        // (a module: it runs once the page has been read, like the script tag it stands for)
    var skinned = Promise.all([
      read(["words"]),
      fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }),
      fetch(new URL(names, document.baseURI).href, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
    ]).then(function (got) {
      if (!got[0].words) throw new Error("no roster file is kept");
      var made = apply(got[1], got[2], lookup(got[0].words), url);
      root.__skinApp = { done: made.done, missed: made.missed };
      return URL.createObjectURL(new Blob([made.text], { type: "text/javascript" }));
    });
    return skinned.then(function (blob) {
      return import(blob).catch(function (err) {
        if (err instanceof SyntaxError) { console.warn("skin:", err); return asIs(); }     // nothing of it ran
        throw err;
      });
    }, function (err) { console.warn("skin:", err); return asIs(); });
  }

  root.Skin = { FORMAT: FORMAT, DB: DB, FLAG: FLAG, FAILED: FAILED, WORD_MAX: WORD_MAX, hash: hash, tag: tag, plain: plain, lookup: lookup, apply: apply, dress: dress,
    flag: flag, read: read, write: write, clear: clear, boot: boot };
})(typeof self !== "undefined" ? self : globalThis);

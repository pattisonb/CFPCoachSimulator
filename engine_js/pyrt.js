// What the game's Python relies on, done the same way here, so the JavaScript engine plays every game the Python one
// does, number for number: Python's `random` (the Mersenne Twister, its seeding and the methods the engine calls),
// its rounding (halves to the even neighbor), and a few built-ins whose JavaScript namesakes differ.
// tests/test_engine_js.py holds this file to Python's own answers.

// ---- random ---------------------------------------------------------------------------------------------------------
const N = 624, M = 397, UPPER = 0x80000000, LOWER = 0x7fffffff, MATRIX_A = 0x9908b0df;
const TWO_PI = 2.0 * Math.PI;
const LOG4 = Math.log(4.0);
const SG_MAGICCONST = 1.0 + Math.log(4.5);

function bitLength(n) {
  let k = 0;
  while (n > 0) { n = Math.floor(n / 2); k++; }
  return k;
}

const _encoder = new TextEncoder();
const utf8 = (s) => _encoder.encode(s);

// SHA-512 (for seeding from text, as Python's random does), on pairs of 32-bit halves.
const _K = new Uint32Array([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538,
  0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118, 0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
  0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235,
  0xc19bf174, 0xcf692694, 0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5, 0x983e5152, 0xee66dfab,
  0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
  0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70, 0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed,
  0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218,
  0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8, 0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
  0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373,
  0x682e6ff3, 0xd6b2b8a3, 0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b, 0xca273ece, 0xea26619c,
  0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
  0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b, 0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc,
  0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817]);
const _W = new Uint32Array(160);

export function sha512(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179]);
  const len = bytes.length;
  const total = (Math.floor((len + 17) / 128) + ((len + 17) % 128 ? 1 : 0)) * 128;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;                                   // (texts here are far under 2^53 bits)
  m[total - 1] = bits & 0xff; m[total - 2] = (bits >>> 8) & 0xff; m[total - 3] = (bits >>> 16) & 0xff; m[total - 4] = (bits >>> 24) & 0xff;
  m[total - 5] = Math.floor(bits / 4294967296) & 0xff;
  const W = _W;
  for (let off = 0; off < total; off += 128) {
    for (let i = 0; i < 32; i++) W[i] = ((m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 80; i++) {
      const h15 = W[2 * (i - 15)], l15 = W[2 * (i - 15) + 1], h2 = W[2 * (i - 2)], l2 = W[2 * (i - 2) + 1];
      // s0 = rotr1 ^ rotr8 ^ shr7 ; s1 = rotr19 ^ rotr61 ^ shr6
      const s0h = ((h15 >>> 1) | (l15 << 31)) ^ ((h15 >>> 8) | (l15 << 24)) ^ (h15 >>> 7);
      const s0l = ((l15 >>> 1) | (h15 << 31)) ^ ((l15 >>> 8) | (h15 << 24)) ^ ((l15 >>> 7) | (h15 << 25));
      const s1h = ((h2 >>> 19) | (l2 << 13)) ^ ((l2 >>> 29) | (h2 << 3)) ^ (h2 >>> 6);
      const s1l = ((l2 >>> 19) | (h2 << 13)) ^ ((h2 >>> 29) | (l2 << 3)) ^ ((l2 >>> 6) | (h2 << 26));
      let lo = (W[2 * (i - 16) + 1] >>> 0) + (s0l >>> 0) + (W[2 * (i - 7) + 1] >>> 0) + (s1l >>> 0);
      const hi = (W[2 * (i - 16)] >>> 0) + (s0h >>> 0) + (W[2 * (i - 7)] >>> 0) + (s1h >>> 0) + Math.floor(lo / 4294967296);
      W[2 * i] = hi >>> 0; W[2 * i + 1] = lo >>> 0;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let i = 0; i < 80; i++) {
      // S1 = rotr14 ^ rotr18 ^ rotr41 ; ch = (e & f) ^ (~e & g)
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
      let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + _K[2 * i + 1] + W[2 * i + 1];
      const t1h = ((hh >>> 0) + (S1h >>> 0) + (chh >>> 0) + _K[2 * i] + W[2 * i] + Math.floor(t1l / 4294967296)) >>> 0;
      t1l >>>= 0;
      // S0 = rotr28 ^ rotr34 ^ rotr39 ; maj = (a & b) ^ (a & c) ^ (b & c)
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      let t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = ((S0h >>> 0) + (mjh >>> 0) + Math.floor(t2l / 4294967296)) >>> 0;
      t2l >>>= 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      let nl = (dl >>> 0) + t1l;
      eh = ((dh >>> 0) + t1h + Math.floor(nl / 4294967296)) >>> 0; el = nl >>> 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      nl = t1l + t2l;
      ah = (t1h + t2h + Math.floor(nl / 4294967296)) >>> 0; al = nl >>> 0;
    }
    const add = (i, h, l) => { const lo = H[i + 1] + (l >>> 0); H[i] = (H[i] + (h >>> 0) + Math.floor(lo / 4294967296)) >>> 0; H[i + 1] = lo >>> 0; };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 0xff; out[4 * i + 2] = (H[i] >>> 8) & 0xff; out[4 * i + 3] = H[i] & 0xff; }
  return out;
}

/** Python's random.Random: the same numbers from the same seed. */
export class Random {
  constructor(seed = 0) {
    this.mt = new Uint32Array(N);
    this.index = N + 1;
    this.gaussNext = null;
    this.seed(seed);
  }

  _initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = N;
  }

  _initByArray(key) {
    const mt = this.mt;
    this._initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  /**
   * random.seed(a). A whole number: its absolute value, 32 bits at a time. Text (the season and recruiting code seed
   * with it: Random("auto-11-smu-3")): its UTF-8 bytes followed by their SHA-512, read as one big number, as Python does.
   */
  seed(a) {
    const key = [];
    if (typeof a === "string") {
      const text = utf8(a), digest = sha512(text);
      const bytes = new Uint8Array(text.length + 64);
      bytes.set(text);
      bytes.set(digest, text.length);
      let first = 0;
      while (first < bytes.length - 1 && bytes[first] === 0) first++;         // a number has no leading zeros
      for (let end = bytes.length; end > first; end -= 4) {                   // least significant 32 bits first
        let w = 0;
        for (let i = Math.max(first, end - 4); i < end; i++) w = w * 256 + bytes[i];
        key.push(w);
      }
      while (key.length > 1 && key[key.length - 1] === 0) key.pop();
    } else {
      if (!Number.isInteger(a)) throw new Error(`Random.seed: a whole number or text is expected, got ${a}`);
      let v = Math.abs(a);
      if (v === 0) key.push(0);
      while (v > 0) { key.push(v % 4294967296); v = Math.floor(v / 4294967296); }
    }
    this._initByArray(key);
    this.gaussNext = null;
  }

  _uint32() {
    const mt = this.mt;
    if (this.index >= N) {
      let kk = 0, y;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): a float in [0, 1) with 53 bits. */
  random() {
    const a = this._uint32() >>> 5, b = this._uint32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  _randbelow(n) {
    if (n <= 0) throw new Error("_randbelow: n must be positive");
    const k = bitLength(n);          // n is never past 32 bits here
    let r = this._uint32() >>> (32 - k);
    while (r >= n) r = this._uint32() >>> (32 - k);
    return r;
  }

  /** random.randint(a, b): a whole number from a to b, both included. */
  randint(a, b) { return a + this._randbelow(b - a + 1); }

  /** random.randrange(start, stop). */
  randrange(start, stop) {
    if (stop === undefined) return this._randbelow(start);
    return start + this._randbelow(stop - start);
  }

  /** random.shuffle(x): in place. */
  shuffle(x) {
    for (let i = x.length - 1; i >= 1; i--) {
      const j = this._randbelow(i + 1);
      const t = x[i]; x[i] = x[j]; x[j] = t;
    }
  }

  /** random.sample(population, k): k different items, in the order Python picks them. */
  sample(population, k) {
    const n = population.length;
    if (!(0 <= k && k <= n)) throw new Error("sample: larger than the population or negative");
    const result = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += Math.pow(4, Math.ceil(Math.log(k * 3) / Math.log(4)));
    if (n <= setsize) {
      const pool = Array.from(population);
      for (let i = 0; i < k; i++) {
        const j = this._randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set();
      for (let i = 0; i < k; i++) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result[i] = population[j];
      }
    }
    return result;
  }

  /** random.choice(seq). */
  choice(seq) {
    if (!seq.length) throw new Error("choice: an empty sequence");
    return seq[this._randbelow(seq.length)];
  }

  /** random.uniform(a, b). */
  uniform(a, b) { return a + (b - a) * this.random(); }

  /** random.choices(population, weights=None, *, cum_weights=None, k=1): a list of k picks. */
  choices(population, { weights = null, cumWeights = null, k = 1 } = {}) {
    const n = population.length;
    const out = [];
    if (cumWeights === null) {
      if (weights === null) {
        for (let i = 0; i < k; i++) out.push(population[Math.floor(this.random() * n)]);
        return out;
      }
      cumWeights = [];
      let acc = 0;
      for (let i = 0; i < weights.length; i++) { acc = i === 0 ? weights[0] : acc + weights[i]; cumWeights.push(acc); }
    }
    if (cumWeights.length !== n) throw new Error("choices: the number of weights does not match the population");
    const total = cumWeights[n - 1] + 0.0;
    if (!(total > 0.0)) throw new Error("choices: total of weights must be greater than zero");
    if (!Number.isFinite(total)) throw new Error("choices: total of weights must be finite");
    const hi = n - 1;
    for (let i = 0; i < k; i++) {
      const x = this.random() * total;
      let lo = 0, top = hi;           // bisect_right(cum_weights, x, 0, hi)
      while (lo < top) {
        const mid = (lo + top) >> 1;
        if (x < cumWeights[mid]) top = mid; else lo = mid + 1;
      }
      out.push(population[lo]);
    }
    return out;
  }

  /** random.gauss(mu, sigma): the pair's second half is kept for the next call, as Python keeps it. */
  gauss(mu = 0.0, sigma = 1.0) {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * TWO_PI;
      const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }

  /** random.gammavariate(alpha, beta). */
  gammavariate(alpha, beta) {
    if (alpha <= 0.0 || beta <= 0.0) throw new Error("gammavariate: alpha and beta must be > 0.0");
    if (alpha > 1.0) {
      const ainv = Math.sqrt(2.0 * alpha - 1.0), bbb = alpha - LOG4, ccc = alpha + ainv;
      for (;;) {
        const u1 = this.random();
        if (!(1e-7 < u1 && u1 < 0.9999999)) continue;
        const u2 = 1.0 - this.random();
        const v = Math.log(u1 / (1.0 - u1)) / ainv;
        const x = alpha * Math.exp(v);
        const z = u1 * u1 * u2;
        const r = bbb + ccc * v - x;
        if (r + SG_MAGICCONST - 4.5 * z >= 0.0 || r >= Math.log(z)) return x * beta;
      }
    }
    if (alpha === 1.0) return -Math.log(1.0 - this.random()) * beta;
    let x;
    for (;;) {
      const u = this.random();
      const b = (Math.E + alpha) / Math.E;
      const p = b * u;
      x = p <= 1.0 ? Math.pow(p, 1.0 / alpha) : -Math.log((b - p) / alpha);
      const u1 = this.random();
      if (p > 1.0) { if (u1 <= Math.pow(x, alpha - 1.0)) break; }
      else if (u1 <= Math.exp(-x)) break;
    }
    return x * beta;
  }
}

/** The module-level generator (`import random`): engine code calls random.random(), random.seed(...) on this one. */
export const random = new Random(0);

// ---- numbers ----------------------------------------------------------------------------------------------------------

/**
 * Python's round(x) and round(x, ndigits): to the nearest, a half to the even neighbor. round(x) gives a whole
 * number; round(x, n) the float nearest the rounded decimal, as Python's does (it rounds the number's exact decimal
 * expansion, so 2.675 is 2.67: the float sits just under the half).
 */
export function round(x, ndigits) {
  if (ndigits === undefined || ndigits === null) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    if (d !== 0.5) throw new Error(`round: cannot convert ${x} to a whole number`);     // NaN or an infinity
    return f % 2 === 0 ? f : f + 1;
  }
  if (!Number.isFinite(x) || x === 0) return x;
  if (ndigits < 0) {
    const p = Math.pow(10, -ndigits);
    return round(x / p) * p;
  }
  // the exact decimal expansion (a double's is finite), then one decimal rounding of it
  const neg = x < 0;
  const exact = Math.abs(x).toFixed(Math.min(100, ndigits + 60));
  const dot = exact.indexOf(".");
  const head = exact.slice(0, dot + 1 + ndigits), tail = exact.slice(dot + 1 + ndigits);
  let up;
  if (tail[0] > "5") up = true;
  else if (tail[0] < "5") up = false;
  else if (/[1-9]/.test(tail.slice(1))) up = true;
  else up = (head.charCodeAt(head.length - 1 - (ndigits === 0 ? 1 : 0)) - 48) % 2 === 1;      // an exact half: to even
  let digits = head.replace(".", "").split("").map(Number);
  if (up) {
    let i = digits.length - 1;
    for (; i >= 0; i--) { if (digits[i] === 9) digits[i] = 0; else { digits[i]++; break; } }
    if (i < 0) digits.unshift(1);
  }
  const whole = digits.length - ndigits;
  const text = digits.slice(0, whole).join("") + (ndigits ? "." + digits.slice(whole).join("") : "");
  const out = Number(text);
  return neg ? -out : out;
}

/** Python's int(x) for a number: toward zero. */
export const int = (x) => Math.trunc(x);

/** Python's a // b (floor division) and a % b (the sign of b). */
export const floordiv = (a, b) => Math.floor(a / b);
export const mod = (a, b) => { const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; };

/** Python's sum(iterable, start=0): left to right. */
export function sum(xs, start = 0) {
  let acc = start;
  for (const x of xs) acc += x;
  return acc;
}

/**
 * Python's ordering of two sort keys: numbers, strings, booleans, or lists of them (tuples), compared item by item.
 * For Array.prototype.sort, which is stable as Python's sort is: `xs.sort((a, b) => cmp(key(a), key(b)))`.
 */
export function cmp(a, b) {
  if (Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sorted(xs, key=..., reverse=...): a new list, stable; `reverse` keeps equal items in their first order, as Python does. */
export function sorted(xs, key = (x) => x, reverse = false) {
  const keyed = Array.from(xs, (x) => [key(x), x]);
  keyed.sort(reverse ? (p, q) => cmp(q[0], p[0]) : (p, q) => cmp(p[0], q[0]));
  return keyed.map((p) => p[1]);
}

/** max(xs, key=...) and min(xs, key=...): the first of equals, as Python's. */
export function maxBy(xs, key = (x) => x) {
  let best, bestKey, any = false;
  for (const x of xs) {
    const k = key(x);
    if (!any || cmp(k, bestKey) > 0) { best = x; bestKey = k; any = true; }
  }
  if (!any) throw new Error("max: an empty sequence");
  return best;
}
export function minBy(xs, key = (x) => x) {
  let best, bestKey, any = false;
  for (const x of xs) {
    const k = key(x);
    if (!any || cmp(k, bestKey) < 0) { best = x; bestKey = k; any = true; }
  }
  if (!any) throw new Error("min: an empty sequence");
  return best;
}

/** Python's str.title() for the engine's plain words ("false start" -> "False Start"). */
export const title = (s) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** range(n) / range(a, b). */
export function range(a, b) {
  if (b === undefined) { b = a; a = 0; }
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

// ---- dicts and values ---------------------------------------------------------------------------------------------------

/** dict.get(key, default): the stored value when the key is there (a stored null stays null), else the default. */
// (The engine's dicts are plain data whose values are never undefined and whose keys are never an Object method's
// name, so "the key is there" is "its value is not undefined": far quicker than asking hasOwnProperty every time.)
export function get(o, k, d = null) {
  const v = o[k];
  return v === undefined ? d : v;
}

/** getattr(obj, name, default): the attribute when the object has it, else the default. */
export const getattr = (o, name, d) => (o[name] === undefined ? d : o[name]);

/** isinstance(v, (int, float)): a number, or a boolean (Python's bool is an int). */
export const isNumber = (v) => typeof v === "number" || typeof v === "boolean";

/** Python's truth of a value: empty lists, dicts, sets and strings are false, as are 0, None and False. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object" && v.constructor === Object) return Object.keys(v).length > 0;
  return true;
}

/** f"{x:.{n}f}": fixed decimals, rounded as Python formats (the nearest decimal, an exact half to even). */
export const fmt = (x, n) => round(x, n).toFixed(n);

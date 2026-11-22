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

  /** random.seed(a) for a whole number (the engine seeds with nothing else): its absolute value, 32 bits at a time. */
  seed(a) {
    if (!Number.isInteger(a)) throw new Error(`Random.seed: a whole number is expected, got ${a}`);
    let v = Math.abs(a);
    const key = [];
    if (v === 0) key.push(0);
    while (v > 0) { key.push(v % 4294967296); v = Math.floor(v / 4294967296); }
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
    if (!Number.isFinite(x)) throw new Error(`round: cannot convert ${x} to a whole number`);
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
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
export const get = (o, k, d = null) => (o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d);

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

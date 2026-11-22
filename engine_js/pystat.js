// Python's `statistics` as the game uses it, with Python's exactness: `mean` and `pstdev` there work in exact
// fractions and round once at the end, so a plain floating-point sum can land one digit off. These do the same
// (whole-number arithmetic on the doubles' exact values), so a position's average height is the number Python had.

const _buf = new DataView(new ArrayBuffer(8));

/** A finite double as [mantissa, exponent] with value = mantissa * 2^exponent exactly (BigInt mantissa). */
function exact(x) {
  if (!Number.isFinite(x)) throw new Error(`statistics: ${x} is not a finite number`);
  if (Number.isInteger(x) && Math.abs(x) <= Number.MAX_SAFE_INTEGER) return [BigInt(x), 0];
  _buf.setFloat64(0, x);
  const hi = _buf.getUint32(0), lo = _buf.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e !== 0) m |= 1n << 52n;
  return [hi >>> 31 ? -m : m, (e === 0 ? 1 : e) - 1075];
}

/** The exact sum of doubles as a fraction [numerator, denominator] (denominator a power of two). */
function exact_sum(xs) {
  let lowest = 0;
  const parts = [];
  for (const x of xs) { const p = exact(x); parts.push(p); if (p[1] < lowest) lowest = p[1]; }
  let total = 0n;
  for (const [m, e] of parts) total += m << BigInt(e - lowest);
  return [total, 1n << BigInt(-lowest)];
}

const bit_length = (n) => (n < 0n ? -n : n).toString(2).length - (n === 0n ? 1 : 0);

/** n / d (BigInts, d > 0) as the nearest double, a tie to the even one: Python's int / int. */
export function ratio(n, d) {
  if (n === 0n) return 0;
  const neg = n < 0n;
  if (neg) n = -n;
  // scale so the quotient has 55 bits or more, then round to 53 by hand (the remainder is the sticky bit)
  let shift = 55 - (bit_length(n) - bit_length(d));
  if (shift < 0) shift = 0;
  let q = (n << BigInt(shift)) / d;
  const sticky = (n << BigInt(shift)) % d !== 0n;
  let extra = bit_length(q) - 53;
  if (extra > 0) {
    const half = 1n << BigInt(extra - 1), rem = q & ((1n << BigInt(extra)) - 1n);
    q >>= BigInt(extra);
    if (rem > half || (rem === half && (sticky || (q & 1n)))) q += 1n;
  } else extra = 0;
  const out = Number(q) * Math.pow(2, extra - shift);
  return neg ? -out : out;
}

function isqrt(n) {
  if (n < 2n) return n;
  let x = 1n << BigInt((bit_length(n) + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** Python's statistics._float_sqrt_of_frac: the square root of n / m, correctly rounded. */
function sqrt_of_frac(n, m) {
  const q = Math.floor((bit_length(n) - bit_length(m) - 109) / 2);
  const rto = (a, b) => { const r = isqrt(a / b); return r | (r * r * b !== a ? 1n : 0n); };
  if (q >= 0) return ratio(rto(n, m << BigInt(2 * q)) << BigInt(q), 1n);
  return ratio(rto(n << BigInt(-2 * q), m), 1n << BigInt(-q));
}

/** statistics.mean(data). */
export function mean(xs) {
  const data = Array.from(xs);
  if (!data.length) throw new Error("mean requires at least one data point");
  const [n, d] = exact_sum(data);
  return ratio(n, d * BigInt(data.length));
}

/** statistics.fmean(data): math.fsum(data) / n. */
export function fmean(xs) {
  const data = Array.from(xs);
  if (!data.length) throw new Error("fmean requires at least one data point");
  const [n, d] = exact_sum(data);
  return ratio(n, d) / data.length;
}

/** statistics.median(data). */
export function median(xs) {
  const data = Array.from(xs).sort((a, b) => a - b);
  const n = data.length;
  if (!n) throw new Error("no median for empty data");
  return n % 2 === 1 ? data[n >> 1] : (data[n / 2 - 1] + data[n / 2]) / 2;
}

/** statistics.pstdev(data): the population standard deviation. */
export function pstdev(xs) {
  const data = Array.from(xs);
  const n = BigInt(data.length);
  if (!data.length) throw new Error("pstdev requires at least one data point");
  // with every value as a whole number over one power of two D: variance = (n * sum(a^2) - sum(a)^2) / (n^2 * D^2)
  let lowest = 0;
  const parts = data.map(exact);
  for (const p of parts) if (p[1] < lowest) lowest = p[1];
  let s = 0n, ss = 0n;
  for (const [m, e] of parts) { const a = m << BigInt(e - lowest); s += a; ss += a * a; }
  const D = 1n << BigInt(-lowest);
  const num = n * ss - s * s, den = n * n * D * D;
  if (num === 0n) return 0;
  return sqrt_of_frac(num, den);
}

// Earned Autonomy: core statistics. Pure functions, no dependencies.
// Runs unchanged in the browser (ES module) and in Node (node --test).
//
// 1. Certify:  Learn-then-Test (Angelopoulos, Bates, Candes, Jordan, Lei 2021) with
//    fixed-sequence testing over a confidence-threshold grid that is fixed in advance
//    from a separate planning window. Each hypothesis H_j: "selective risk at threshold
//    lambda_j exceeds the cap eps" is tested with an exact binomial p-value. The
//    certified threshold is the last one rejected before the first failure, so with
//    probability >= 1 - delta its selective risk is <= eps (family-wise error <= delta).
// 2. Plan:     how many more reviews until the next grid point can be certified.
// 3. Monitor:  a betting e-process (Waudby-Smith & Ramdas 2023) on audited hands-free
//    tasks. Under "risk <= eps" it is a nonnegative supermartingale, so by Ville's
//    inequality the chance it ever crosses 1/alpha is <= alpha. Crossing => revert.

// ---------- special functions ----------
const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7];

export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBinomPmf(i, n, p) {
  if (p <= 0) return i === 0 ? 0 : -Infinity;
  if (p >= 1) return i === n ? 0 : -Infinity;
  return lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log1p(-p);
}

/** P(X <= k) for X ~ Binomial(n, p). Exact summation in log space. */
export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let m = -Infinity;
  const logs = new Array(k + 1);
  for (let i = 0; i <= k; i++) { logs[i] = logBinomPmf(i, n, p); if (logs[i] > m) m = logs[i]; }
  if (m === -Infinity) return 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logs[i] - m);
  return Math.min(1, Math.exp(m) * s);
}

/** One-sided (1 - delta) Clopper-Pearson upper bound on a binomial rate. */
export function cpUpper(k, n, delta) {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  let lo = k / n, hi = 1;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (binomCdf(k, n, mid) > delta) lo = mid; else hi = mid;
  }
  return hi;
}

// ---------- grid ----------
/**
 * Threshold grid fixed from the planning window's confidences only (labels unused):
 * lambda_j is the confidence above which a fraction coverages[j] of planning tasks fall.
 * Returned in descending lambda order (most conservative first), deduplicated.
 */
export function buildGrid(planConf, coverages) {
  const s = Float64Array.from(planConf).sort().reverse();
  const N = s.length;
  const out = [];
  for (const q of [...coverages].sort((a, b) => a - b)) {
    const idx = Math.min(N - 1, Math.max(0, Math.ceil(q * N) - 1));
    const lam = s[idx];
    if (!out.length || lam < out[out.length - 1].lambda) out.push({ lambda: lam, planCoverage: q });
  }
  return out;
}

// ---------- certification ----------
function sortedView(conf, loss) {
  const idx = Array.from(conf, (_, i) => i).sort((a, b) => conf[b] - conf[a]);
  const c = new Float64Array(idx.length), cum = new Int32Array(idx.length + 1);
  for (let r = 0; r < idx.length; r++) { c[r] = conf[idx[r]]; cum[r + 1] = cum[r] + (loss[idx[r]] ? 1 : 0); }
  return { c, cum, N: idx.length };
}
/** number of entries with conf >= lam in a descending array */
function countAtLeast(c, lam) {
  let lo = 0, hi = c.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] >= lam) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Fixed-sequence Learn-then-Test.
 * @param conf  calibration confidences
 * @param loss  calibration losses (0/1): would a reviewer have dismissed or materially changed it
 * @param grid  output of buildGrid (descending lambda)
 * @returns {curve, certifiedIndex, threshold, coverage, n, k, risk, ucb}
 */
export function certify(conf, loss, grid, { eps, delta }) {
  const { c, cum, N } = sortedView(conf, loss);
  const curve = [];
  let certifiedIndex = -1, stopped = false;
  grid.forEach((g, j) => {
    const n = countAtLeast(c, g.lambda);
    const k = cum[n];
    const pValue = n > 0 ? binomCdf(k, n, eps) : 1;
    const pass = pValue <= delta;
    const tested = !stopped;
    if (tested && pass) certifiedIndex = j;
    if (tested && !pass) stopped = true;
    curve.push({ j, lambda: g.lambda, n, k, coverage: N ? n / N : 0, risk: n ? k / n : 0,
      ucb: cpUpper(k, n, delta), pValue, pass, tested, certified: false });
  });
  if (certifiedIndex >= 0) curve[certifiedIndex].certified = true;
  const best = certifiedIndex >= 0 ? curve[certifiedIndex] : null;
  return {
    N, curve, certifiedIndex,
    threshold: best ? best.lambda : Infinity,
    coverage: best ? best.coverage : 0,
    n: best ? best.n : 0, k: best ? best.k : 0,
    risk: best ? best.risk : 0, ucb: best ? best.ucb : null,
    firstFailure: curve.find(p => p.tested && !p.pass) || null,
  };
}

/** Realized coverage and selective risk of a fixed threshold on any task set. */
export function evaluate(conf, loss, lambda) {
  let n = 0, k = 0;
  for (let i = 0; i < conf.length; i++) if (conf[i] >= lambda) { n++; if (loss[i]) k++; }
  return { n, k, N: conf.length, coverage: conf.length ? n / conf.length : 0, risk: n ? k / n : 0 };
}

// ---------- planning ----------
/** Smallest n such that observing rate r on n tasks rejects "risk > eps" at level delta. */
export function reviewsToCertify(r, eps, delta) {
  if (!(r < eps)) return Infinity;
  const ok = n => binomCdf(Math.ceil(r * n), n, eps) <= delta; // conservative: round the expected count up
  let hi = 16;
  while (!ok(hi)) { hi *= 2; if (hi > 5e6) return Infinity; }
  let lo = Math.max(1, hi >> 1);
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid + 1; }
  return hi;
}

/**
 * For each untested/failed grid point after the certified one, estimate how many more
 * reviewed tasks (all coverage levels, since review mode reviews everything) are needed,
 * assuming its observed rate holds. Returns [{lambda, coverage, risk, extraReviews, weeks}]
 */
export function planUnlocks(cert, { eps, delta, weeklyReviews }, limit = 3) {
  const out = [];
  for (const p of cert.curve.slice(cert.certifiedIndex + 1)) {
    const need = reviewsToCertify(p.risk, eps, delta);
    const totalNeeded = Number.isFinite(need) ? Math.ceil(need / Math.max(p.coverage, 1e-9)) : Infinity;
    const extra = Number.isFinite(totalNeeded) ? Math.max(0, totalNeeded - cert.N) : Infinity;
    out.push({ lambda: p.lambda, coverage: p.coverage, risk: p.risk, needSelected: need,
      extraReviews: extra, weeks: Number.isFinite(extra) ? extra / weeklyReviews : Infinity });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- monitoring ----------
/**
 * Betting e-process for H0: risk <= eps on a stream of 0/1 audit outcomes (time order).
 * K_t = prod (1 + lambda_i (X_i - eps)). Bets are predictable (they use only past outcomes):
 * lambda_t = clip((m - eps) / (eps (1 - eps)), 0, cap / eps), the binary Kelly bet at the
 * exponentially weighted mean m of past outcomes (prior m = eps, so no bet until evidence).
 * Because lambda_t >= 0 and E[X - eps] <= 0 under H0, K is a nonnegative supermartingale and
 * P(sup_t K_t >= 1/alpha) <= alpha (Ville). Returns K after each outcome and the first alarm index.
 */
export function eProcess(xs, eps, { alpha = 0.05, halfLife = 30, cap = 0.5 } = {}) {
  const w = Math.pow(0.5, 1 / halfLife);
  let m = eps, K = 1, alarm = -1;
  const series = new Float64Array(xs.length), bets = new Float64Array(xs.length);
  for (let t = 0; t < xs.length; t++) {
    const d = m - eps;
    const lam = d > 0 ? Math.min(d / (eps * (1 - eps)), cap / eps) : 0;
    const x = xs[t] ? 1 : 0;
    K *= 1 + lam * (x - eps);
    series[t] = K; bets[t] = lam;
    if (alarm < 0 && K >= 1 / alpha) alarm = t;
    m = w * m + (1 - w) * x;
  }
  return { series, bets, alarm, threshold: 1 / alpha };
}

/** Upper-tail binomial p-value P(X >= k | n, eps). */
export function binomUpperTail(k, n, eps) { return k <= 0 ? 1 : 1 - binomCdf(k - 1, n, eps); }

/**
 * Baseline: a weekly batch check (what a dashboard review would do). At the end of each
 * week, test that week's audited hands-free tasks; alarm on the first week with p <= delta.
 * items: [{t (minutes since epoch of window), x}] sorted by t; weekMinutes: 10080.
 */
export function weeklyCheck(items, eps, delta, startT, weekMinutes = 10080) {
  const weeks = new Map();
  for (const it of items) {
    const w = Math.floor((it.t - startT) / weekMinutes);
    const a = weeks.get(w) || { n: 0, k: 0 }; a.n++; a.k += it.x ? 1 : 0; weeks.set(w, a);
  }
  const keys = [...weeks.keys()].sort((a, b) => a - b);
  for (const w of keys) {
    const { n, k } = weeks.get(w);
    if (binomUpperTail(k, n, eps) <= delta) return { week: w, alarmT: startT + (w + 1) * weekMinutes, n, k };
  }
  return null;
}

/**
 * Simulation used for the Monitor tab's "what if" numbers (seeded, so reproducible):
 *  - falseAlarm: share of simulated years (52 weeks at riskBefore <= eps) in which each
 *    method ever fires. The weekly check tests every week at level alpha, so its yearly
 *    false-alarm rate compounds; the e-process is anytime-valid.
 *  - delay: median days from a drift (riskBefore -> riskAfter) to the alarm, at perDay audits.
 */
export function simulateMonitor({ riskBefore, riskAfter, perDay, eps, alpha = 0.05, halfLife = 30, sims = 400, seed = 11, horizonDays = 120 }) {
  const R = rng(seed);
  const draw = p => (R() < p ? 1 : 0);
  // binomial draws for daily counts (perDay may be fractional)
  const dayCount = () => { const base = Math.floor(perDay); return base + (R() < perDay - base ? 1 : 0); };
  let faE = 0, faW = 0;
  for (let s = 0; s < sims; s++) {
    const xs = [], wk = [];
    for (let d = 0; d < 364; d++) { const c = dayCount(); for (let i = 0; i < c; i++) { xs.push(draw(riskBefore)); wk.push(Math.floor(d / 7)); } }
    if (eProcess(xs, eps, { alpha, halfLife }).alarm >= 0) faE++;
    const agg = new Map(); xs.forEach((x, i) => { const a = agg.get(wk[i]) || [0, 0]; a[0]++; a[1] += x; agg.set(wk[i], a); });
    for (const [n, k] of agg.values()) if (binomUpperTail(k, n, eps) <= alpha) { faW++; break; }
  }
  const delaysE = [], delaysW = [];
  for (let s = 0; s < sims; s++) {
    const xs = [], day = [];
    for (let d = 0; d < horizonDays; d++) { const c = dayCount(); for (let i = 0; i < c; i++) { xs.push(draw(riskAfter)); day.push(d + R()); } }
    const a = eProcess(xs, eps, { alpha, halfLife }).alarm;
    delaysE.push(a >= 0 ? day[a] : Infinity);
    let w = Infinity; const agg = new Map();
    xs.forEach((x, i) => { const k = Math.floor(day[i] / 7); const g = agg.get(k) || [0, 0]; g[0]++; g[1] += x; agg.set(k, g); });
    for (const k of [...agg.keys()].sort((a, b) => a - b)) { const [n, kk] = agg.get(k); if (binomUpperTail(kk, n, eps) <= alpha) { w = (k + 1) * 7; break; } }
    delaysW.push(w);
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { falseAlarmE: faE / sims, falseAlarmW: faW / sims, medianDelayE: med(delaysE), medianDelayW: med(delaysW) };
}

// ---------- utilities ----------
/** mulberry32 seeded PRNG */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Bernoulli audit sample: keep each item with probability rate. */
export function auditSample(n, rate, seed) {
  const r = rng(seed); const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = r() < rate ? 1 : 0;
  return keep;
}

export function toCSV(rows, columns) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(c => esc(c.label)).join(','),
    ...rows.map(r => columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}

export const LOSS_RULES = {
  material: code => code >= 2,          // dismissed or materially changed
  strict: code => code >= 1,            // any change, including stylistic edits
};

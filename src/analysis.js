// Job-level analysis shared by the app (browser) and scripts/report.mjs (Node).
import { buildGrid, certify, evaluate, planUnlocks, eProcess, weeklyCheck, auditSample, simulateMonitor, LOSS_RULES } from './autonomy.js';

export const WEEK = 10080;
export const GRID_COVERAGES = Array.from({ length: 16 }, (_, i) => +(0.20 + 0.05 * i).toFixed(2)); // 20%..95%
export const DEFAULTS = { eps: 0.02, delta: 0.05, rule: 'material', audit: 1, alpha: 0.05, rawThreshold: 0.9 };

/** Split a job's rows into windows by week index. `excluded` = Set of pattern ids always kept in review. */
export function windows(job, meta, { windowShift = 0, excluded = new Set() } = {}) {
  const { planning, calibration, shadow } = meta.windows;
  const lo = w => w * WEEK;
  const slice = (a, b) => {
    const idx = [];
    for (let i = 0; i < job.n; i++) { const t = job.cols.t[i]; if (t >= lo(a) && t < lo(b) && !excluded.has(job.cols.g[i])) idx.push(i); }
    return idx;
  };
  return {
    planning: slice(planning[0] + windowShift, planning[1] + windowShift),
    calibration: slice(calibration[0] + windowShift, calibration[1] + windowShift),
    shadow: windowShift === 0 ? slice(shadow[0], shadow[1]) : [],
    weeks: { planning: planning.map(w => w + windowShift), calibration: calibration.map(w => w + windowShift), shadow },
  };
}

export function analyzeJob(job, meta, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const loss = LOSS_RULES[o.rule];
  const excluded = o.excluded || new Set();
  const W = windows(job, meta, { windowShift: o.windowShift || 0, excluded });
  const conf = i => job.cols.c[i] / 1000;
  const L = i => (loss(job.cols.y[i]) ? 1 : 0);
  const planConf = W.planning.map(conf);
  const grid = buildGrid(planConf, GRID_COVERAGES);
  const cc = W.calibration.map(conf), cl = W.calibration.map(L);
  const cert = certify(cc, cl, grid, { eps: o.eps, delta: o.delta });
  const calWeeks = W.weeks.calibration[1] - W.weeks.calibration[0];
  const weeklyReviews = W.calibration.length / calWeeks;
  const unlocks = planUnlocks(cert, { eps: o.eps, delta: o.delta, weeklyReviews });

  // the uncertified baseline most tools ship: a fixed raw-confidence cutoff
  const raw = evaluate(cc, cl, o.rawThreshold);

  // shadow run (held-out weeks): reviews stayed on, so every would-be hands-free task has a label
  let shadow = null;
  if (W.shadow.length) {
    const sc = W.shadow.map(conf), sl = W.shadow.map(L);
    const driftT = job.drift ? meta.driftWeek * WEEK : Infinity;
    const pre = W.shadow.filter(i => job.cols.t[i] < driftT), post = W.shadow.filter(i => job.cols.t[i] >= driftT);
    const all = evaluate(sc, sl, cert.threshold);
    const preE = evaluate(pre.map(conf), pre.map(L), cert.threshold);
    const postE = post.length ? evaluate(post.map(conf), post.map(L), cert.threshold) : null;
    const rawPre = evaluate(pre.map(conf), pre.map(L), o.rawThreshold);
    // weekly table
    const weekly = [];
    for (let w = W.weeks.shadow[0]; w < W.weeks.shadow[1]; w++) {
      const ids = W.shadow.filter(i => Math.floor(job.cols.t[i] / WEEK) === w);
      weekly.push({ week: w, total: ids.length, ...evaluate(ids.map(conf), ids.map(L), cert.threshold) });
    }
    // monitor: audited hands-free tasks in time order
    const auto = W.shadow.filter(i => conf(i) >= cert.threshold);
    const keep = auditSample(auto.length, o.audit, 7 + Math.round(o.audit * 1000));
    const audited = auto.filter((_, j) => keep[j]);
    const xs = audited.map(L);
    const ep = eProcess(xs, o.eps, { alpha: o.alpha });
    const items = audited.map(i => ({ t: job.cols.t[i], x: L(i), i }));
    const weeklyAlarm = weeklyCheck(items, o.eps, o.alpha, W.weeks.shadow[0] * WEEK);
    shadow = {
      n: W.shadow.length, all, pre: preE, post: postE, rawPre, weekly,
      monitor: {
        audited: audited.length, autoCount: auto.length,
        series: Array.from(ep.series), t: audited.map(i => job.cols.t[i]), x: xs,
        alarmIndex: ep.alarm, alarmT: ep.alarm >= 0 ? job.cols.t[audited[ep.alarm]] : null,
        threshold: ep.threshold, weekly: weeklyAlarm, driftT: Number.isFinite(driftT) ? driftT : null,
        // bad hands-free outcomes between the drift and each alarm (what reached customers)
        badBeforeAlarm: Number.isFinite(driftT) ? auto.filter(i => job.cols.t[i] >= driftT && (ep.alarm < 0 || job.cols.t[i] <= job.cols.t[audited[ep.alarm]]) && L(i)).length : null,
        badBeforeWeekly: Number.isFinite(driftT) ? auto.filter(i => job.cols.t[i] >= driftT && (!weeklyAlarm || job.cols.t[i] < weeklyAlarm.alarmT) && L(i)).length : null,
      },
    };
  }

  // per-pattern table on the calibration window
  const patterns = job.patterns.map((name, g) => {
    const ids = W.calibration.filter(i => job.cols.g[i] === g);
    const ex = excluded.has(g);
    const allIds = ex ? windows(job, meta, { windowShift: o.windowShift || 0 }).calibration.filter(i => job.cols.g[i] === g) : ids;
    const cs = allIds.map(conf).sort((a, b) => a - b);
    const changes = allIds.reduce((s, i) => s + L(i), 0);
    const autoIds = ex ? [] : allIds.filter(i => conf(i) >= cert.threshold);
    const autoLoss = autoIds.reduce((s, i) => s + L(i), 0);
    return { g, name, excluded: ex, n: allIds.length, changes, changeRate: allIds.length ? changes / allIds.length : 0,
      medianConf: cs.length ? cs[Math.floor(cs.length / 2)] : 0,
      autoN: autoIds.length, autoShare: allIds.length ? autoIds.length / allIds.length : 0,
      autoLoss, riskShare: cert.k ? autoLoss / cert.k : 0 };
  });

  return { opts: o, W, grid, cert, unlocks, raw, shadow, patterns, weeklyReviews, calWeeks };
}

/**
 * Monitor what-if table: for each audit rate, simulated median days to alarm after a jump from
 * the calibration risk to the shadow run's post-drift risk, and yearly false-alarm rates.
 */
export const AUDIT_RATES = [1, 0.5, 0.25, 0.1];
export function monitorTable(a, rates = AUDIT_RATES) {
  const s = a.shadow; if (!s || !s.post) return [];
  const autoPerDay = s.monitor.autoCount / 28;
  return rates.map(rate => {
    const r = simulateMonitor({ riskBefore: a.cert.risk, riskAfter: s.post.risk, perDay: autoPerDay * rate, eps: a.opts.eps, alpha: a.opts.alpha, sims: 300, seed: 11 });
    return { rate, perDay: +(autoPerDay * rate).toFixed(1), medianDaysE: +r.medianDelayE.toFixed(1), medianDaysW: r.medianDelayW, falseAlarmE: r.falseAlarmE, falseAlarmW: r.falseAlarmW };
  });
}

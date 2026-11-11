import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lgamma, binomCdf, cpUpper, buildGrid, certify, evaluate, reviewsToCertify, eProcess,
  weeklyCheck, rng, toCSV, auditSample, simulateMonitor, driftAttribution,
} from '../src/autonomy.js';
import { analyzeJob, windows, GRID_COVERAGES } from '../src/analysis.js';
import { JOBS, sampleTask, randnOf, pickOf } from '../src/model.js';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/acme.json', root)));
const results = JSON.parse(readFileSync(new URL('results/results.json', root)));
const pct = x => +(100 * x).toFixed(2);

test('lgamma and binomial CDF match closed forms', () => {
  assert.ok(Math.abs(lgamma(10) - Math.log(362880)) < 1e-9);
  assert.ok(Math.abs(lgamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-9);
  // Bin(5, 0.3): P(X<=2) = 0.83692
  assert.ok(Math.abs(binomCdf(2, 5, 0.3) - 0.83692) < 1e-5);
  assert.equal(binomCdf(5, 5, 0.3), 1);
  assert.equal(binomCdf(-1, 5, 0.3), 0);
});

test('Clopper-Pearson upper bound: known value and monotonicity', () => {
  // k = 0: (1 - p)^n = delta  =>  p = 1 - delta^(1/n)
  assert.ok(Math.abs(cpUpper(0, 100, 0.05) - (1 - Math.pow(0.05, 1 / 100))) < 1e-9);
  assert.ok(cpUpper(3, 100, 0.05) > cpUpper(2, 100, 0.05));
  assert.ok(cpUpper(3, 200, 0.05) < cpUpper(3, 100, 0.05));
  assert.ok(cpUpper(3, 100, 0.01) > cpUpper(3, 100, 0.05));
  assert.equal(cpUpper(0, 0, 0.05), 1);
});

test('Clopper-Pearson bound covers the true rate at least 1 - delta of the time (randomized)', () => {
  const R = rng(42); let cover = 0; const T = 3000;
  for (let t = 0; t < T; t++) {
    const p = 0.002 + 0.1 * R(), n = 20 + Math.floor(R() * 400);
    let k = 0; for (let i = 0; i < n; i++) if (R() < p) k++;
    if (p <= cpUpper(k, n, 0.1)) cover++;
  }
  assert.ok(cover / T >= 0.9 - 0.01, `coverage ${cover / T}`);
});

test('grid is fixed from planning confidences only, descending, at the requested coverages', () => {
  const R = rng(3); const conf = Array.from({ length: 1000 }, () => R());
  const g = buildGrid(conf, GRID_COVERAGES);
  for (let i = 1; i < g.length; i++) assert.ok(g[i].lambda < g[i - 1].lambda);
  for (const p of g) assert.ok(Math.abs(evaluate(conf, conf.map(() => 0), p.lambda).coverage - p.planCoverage) < 0.002);
});

test('fixed-sequence testing stops at the first failure, even if later thresholds would pass', () => {
  // top bucket is bad, the middle is clean: a valid fixed sequence must certify nothing
  const conf = [], loss = [];
  for (let i = 0; i < 300; i++) { conf.push(0.99); loss.push(i < 30 ? 1 : 0); }
  for (let i = 0; i < 3000; i++) { conf.push(0.8); loss.push(0); }
  const grid = [{ lambda: 0.99 }, { lambda: 0.8 }];
  const c = certify(conf, loss, grid, { eps: 0.02, delta: 0.05 });
  assert.equal(c.certifiedIndex, -1);
  assert.equal(c.curve[1].tested, false);
  assert.equal(c.curve[1].risk < 0.02, true);
  // pass <=> Clopper-Pearson bound <= eps (same test, two views)
  const a = analyzeJob(data.jobs.email, data.meta, {});
  for (const p of a.cert.curve) assert.equal(p.pass, p.ucb <= 0.02 + 1e-9);
});

test('certificate validity: across simulated teams, true risk exceeds the cap at most ~delta of the time', () => {
  // Draw fresh planning + calibration windows from the generative model, certify, and look up the
  // true selective risk at the certified threshold from a large reference sample.
  const J = JOBS.email, eps = 0.02, delta = 0.05;
  const R0 = rng(777), rn0 = randnOf(R0), pk0 = pickOf(R0);
  const ref = Array.from({ length: 200000 }, () => sampleTask(R0, J, 5, rn0, pk0)).sort((a, b) => b.c - a.c);
  const cumP = new Float64Array(ref.length + 1); ref.forEach((t, i) => { cumP[i + 1] = cumP[i] + t.p; });
  const trueRisk = lam => { let n = 0; while (n < ref.length && ref[n].c / 1000 >= lam) n++; return n ? cumP[n] / n : 0; };
  let violations = 0, certified = 0; const S = 120;
  for (let s = 0; s < S; s++) {
    const R = rng(1000 + s), rn = randnOf(R), pk = pickOf(R);
    const plan = Array.from({ length: 3 * 380 }, () => sampleTask(R, J, 5, rn, pk));
    const cal = Array.from({ length: 9 * 380 }, () => sampleTask(R, J, 5, rn, pk));
    const grid = buildGrid(plan.map(t => t.c / 1000), GRID_COVERAGES);
    const c = certify(cal.map(t => t.c / 1000), cal.map(t => (t.y >= 2 ? 1 : 0)), grid, { eps, delta });
    if (c.certifiedIndex >= 0) { certified++; if (trueRisk(c.threshold) > eps) violations++; }
  }
  assert.ok(certified > S * 0.5, `certified ${certified}`);
  assert.ok(violations / S <= delta + 0.04, `violation rate ${violations / S}`);
});

test('reviews-to-certify planner returns a sample size that certifies, and Infinity when impossible', () => {
  const n = reviewsToCertify(0.01, 0.02, 0.05);
  assert.ok(Number.isFinite(n));
  assert.ok(binomCdf(Math.floor(0.01 * n), n, 0.02) <= 0.05);
  assert.ok(n > 300 && n < 2000, `n=${n}`);
  assert.equal(reviewsToCertify(0.02, 0.02, 0.05), Infinity);
  assert.ok(reviewsToCertify(0.005, 0.02, 0.05) < n);
});

test('e-process: false-alarm rate under H0 stays below alpha (randomized, risk exactly at the cap)', () => {
  const R = rng(9); let alarms = 0; const S = 400;
  for (let s = 0; s < S; s++) {
    const xs = Array.from({ length: 3000 }, () => (R() < 0.02 ? 1 : 0));
    if (eProcess(xs, 0.02, { alpha: 0.05 }).alarm >= 0) alarms++;
  }
  assert.ok(alarms / S <= 0.05 + 0.02, `false alarms ${alarms / S}`);
});

test('e-process: detects a 3x risk jump, and bets are predictable (never use the current outcome)', () => {
  const R = rng(10); let found = 0;
  for (let s = 0; s < 100; s++) {
    const xs = Array.from({ length: 1500 }, () => (R() < 0.06 ? 1 : 0));
    if (eProcess(xs, 0.02).alarm >= 0) found++;
  }
  assert.ok(found >= 95, `detected ${found}/100`);
  const xs = Array.from({ length: 400 }, (_, i) => (i % 9 === 0 ? 1 : 0));
  const a = eProcess(xs, 0.02);
  for (const t of [50, 200, 399]) {
    const ys = xs.slice(); ys[t] = 1 - ys[t];
    assert.equal(eProcess(ys, 0.02).bets[t], a.bets[t]);
  }
});

test('weekly check and audit sampling behave as specified', () => {
  const items = [];
  for (let w = 0; w < 4; w++) for (let i = 0; i < 100; i++) items.push({ t: w * 10080 + i, x: w === 2 && i < 10 ? 1 : 0 });
  const r = weeklyCheck(items, 0.02, 0.05, 0);
  assert.equal(r.week, 2); assert.equal(r.alarmT, 3 * 10080);
  const keep = auditSample(20000, 0.25, 5);
  const share = keep.reduce((a, b) => a + b, 0) / keep.length;
  assert.ok(Math.abs(share - 0.25) < 0.01);
  assert.deepEqual(auditSample(50, 0.3, 1), auditSample(50, 0.3, 1));
});

test('anytime-valid monitor raises far fewer false alarms than a weekly check over a simulated year', () => {
  const r = simulateMonitor({ riskBefore: 0.014, riskAfter: 0.065, perDay: 6.4, eps: 0.02, sims: 200, seed: 3 });
  assert.ok(r.falseAlarmE <= 0.05, `e ${r.falseAlarmE}`);
  assert.ok(r.falseAlarmW > r.falseAlarmE + 0.05, `weekly ${r.falseAlarmW}`);
  assert.ok(Number.isFinite(r.medianDelayE));
});

test('windows are disjoint and ordered (planning < calibration < shadow)', () => {
  const job = data.jobs.email; const W = windows(job, data.meta);
  const max = a => Math.max(...a.map(i => job.cols.t[i])), min = a => Math.min(...a.map(i => job.cols.t[i]));
  assert.ok(max(W.planning) < min(W.calibration));
  assert.ok(max(W.calibration) < min(W.shadow));
  assert.equal(W.planning.length + W.calibration.length + W.shadow.length, job.n);
});

test('headline numbers in results/results.json match a fresh analysis of the committed data', () => {
  const a = analyzeJob(data.jobs.email, data.meta, {});
  const r = results.jobs.email;
  assert.equal(r.handsFreePct, pct(a.cert.coverage));
  assert.equal(r.certifiedBoundPct, pct(a.cert.ucb));
  assert.ok(r.certifiedBoundPct <= 2);
  assert.equal(r.shadow.postDrift.riskPct, pct(a.shadow.post.risk));
  assert.equal(r.monitor.audit100.daysAfterDrift, +((a.shadow.monitor.alarmT - a.shadow.monitor.driftT) / 1440).toFixed(1));
  assert.ok(r.monitor.audit100.daysAfterDrift > 0 && r.monitor.audit100.daysAfterDrift < 7);
  assert.ok(r.rawCutoff90.riskPct > 2, 'the uncertified 0.90 cutoff breaks the cap');
  const c = analyzeJob(data.jobs.cashapp, data.meta, {});
  assert.equal(results.jobs.cashapp.handsFreePct, pct(c.cert.coverage));
  assert.equal(results.jobs.promise.handsFreePct, 0, 'payment promises cannot be certified at 2% yet');
});

test('generator is deterministic: regenerating reproduces the committed data byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ea-'));
  try {
    const out = join(dir, 'acme.json');
    execFileSync(process.execPath, [new URL('scripts/generate.mjs', root).pathname, out]);
    assert.equal(readFileSync(out, 'utf8'), readFileSync(new URL('data/acme.json', root), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CSV export escapes commas, quotes and newlines', () => {
  const csv = toCSV([{ a: 'Wright, Davis and Perez', b: 'said "hi"', c: 'x\ny' }],
    [{ key: 'a', label: 'Customer' }, { key: 'b', label: 'Note' }, { label: 'Multi', get: r => r.c }]);
  assert.equal(csv, 'Customer,Note,Multi\n"Wright, Davis and Perez","said ""hi""","x\ny"');
});

test('drift attribution splits the risk change exactly into mix and rate, and finds the drifted pattern', () => {
  const R = rng(21);
  const mk = (n, mixG1, r0, r1) => Array.from({ length: n }, () => { const g = R() < mixG1 ? 1 : 0; return { g, x: R() < (g ? r1 : r0) ? 1 : 0 }; });
  const at = driftAttribution(mk(60000, 0.02, 0.01, 0.4), mk(60000, 0.15, 0.01, 0.4));
  assert.ok(Math.abs(at.mix + at.rate - at.total) < 1e-12);
  assert.ok(Math.abs(at.byPattern.reduce((s, p) => s + p.total, 0) - at.total) < 1e-12);
  assert.equal(at.byPattern[0].g, 1);
  assert.ok(at.mix > 4 * Math.abs(at.rate), 'pure mix shift is attributed to mix');
  const a = analyzeJob(data.jobs.email, data.meta, {});
  assert.equal(a.shadow.monitor.attribution.byPattern[0].g, data.jobs.email.drift.pattern);
});

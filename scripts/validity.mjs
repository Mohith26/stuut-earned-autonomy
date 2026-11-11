// node scripts/validity.mjs [sims]: how often does a certificate overstate safety? (model ground truth)
import { buildGrid, certify, rng } from '../src/autonomy.js';
import { GRID_COVERAGES } from '../src/analysis.js';
import { JOBS, sampleTask, randnOf, pickOf } from '../src/model.js';
const S = +(process.argv[2] || 300), eps = 0.02, delta = 0.05;
for (const key of ['email', 'cashapp', 'promise']) {
  const J = JOBS[key], weekly = { email: 380, cashapp: 820, promise: 300 }[key];
  const R0 = rng(777), rn0 = randnOf(R0), pk0 = pickOf(R0);
  const ref = Array.from({ length: 300000 }, () => sampleTask(R0, J, 5, rn0, pk0)).sort((a, b) => b.c - a.c);
  const cumP = new Float64Array(ref.length + 1); ref.forEach((t, i) => { cumP[i + 1] = cumP[i] + t.p; });
  const truth = lam => { let lo = 0, hi = ref.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ref[m].c / 1000 >= lam) lo = m + 1; else hi = m; } return lo ? cumP[lo] / lo : 0; };
  let cert = 0, viol = 0, cov = 0;
  for (let s = 0; s < S; s++) {
    const R = rng(5000 + s), rn = randnOf(R), pk = pickOf(R);
    const plan = Array.from({ length: 3 * weekly }, () => sampleTask(R, J, 5, rn, pk));
    const cal = Array.from({ length: 9 * weekly }, () => sampleTask(R, J, 5, rn, pk));
    const c = certify(cal.map(t => t.c / 1000), cal.map(t => (t.y >= 2 ? 1 : 0)), buildGrid(plan.map(t => t.c / 1000), GRID_COVERAGES), { eps, delta });
    if (c.certifiedIndex >= 0) { cert++; cov += c.coverage; if (truth(c.threshold) > eps) viol++; }
  }
  console.log(`${key}: certified ${cert}/${S}, mean hands-free ${(100 * cov / Math.max(cert, 1)).toFixed(1)}%, true risk above cap in ${viol}/${S} = ${(100 * viol / S).toFixed(1)}% (target <= ${100 * delta}%)`);
}

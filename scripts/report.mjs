// node scripts/report.mjs  ->  results/results.json (every headline number in the README and email)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analyzeJob, WEEK, monitorTable } from '../src/analysis.js';
import { JOBS, trueSelectiveRisk } from '../src/model.js';
import { rng } from '../src/autonomy.js';

const data = JSON.parse(readFileSync(new URL('../data/acme.json', import.meta.url)));
const start = Date.parse(data.meta.startUTC) - 4 * 3600e3; // wall-clock origin
const wall = t => new Date(start + t * 60e3).toISOString().slice(0, 16).replace('T', ' ');
const pct = x => +(100 * x).toFixed(2);

const out = { generated: new Date(0).toISOString(), seed: data.meta.seed, defaults: { eps: 0.02, delta: 0.05, rule: 'material' }, jobs: {} };
for (const job of Object.values(data.jobs)) {
  const a = analyzeJob(job, data.meta, {});
  const s = a.shadow, m = s.monitor;
  const tenPct = analyzeJob(job, data.meta, { audit: 0.1 }).shadow.monitor;
  const r = {
    label: job.label,
    calibrationReviews: a.cert.N,
    threshold: +a.cert.threshold.toFixed(3),
    handsFreePct: pct(a.cert.coverage),
    observedRiskPct: pct(a.cert.risk),
    certifiedBoundPct: a.cert.ucb == null ? null : pct(a.cert.ucb),
    k: a.cert.k, n: a.cert.n,
    rawCutoff90: { handsFreePct: pct(a.raw.coverage), riskPct: pct(a.raw.risk) },
    shadow: {
      tasks: s.n, handsFreePct: pct(s.all.coverage),
      preDrift: { n: s.pre.n, k: s.pre.k, riskPct: pct(s.pre.risk) },
      postDrift: s.post ? { n: s.post.n, k: s.post.k, riskPct: pct(s.post.risk) } : null,
      rawCutoff90PreDrift: { handsFreePct: pct(s.rawPre.coverage), riskPct: pct(s.rawPre.risk) },
    },
    monitor: {
      audit100: { alarm: m.alarmT == null ? null : wall(m.alarmT), daysAfterDrift: m.alarmT != null && m.driftT != null ? +((m.alarmT - m.driftT) / 1440).toFixed(1) : null,
        weeklyCheckAlarm: m.weekly ? wall(m.weekly.alarmT) : null, badBeforeAlarm: m.badBeforeAlarm, badBeforeWeekly: m.badBeforeWeekly,
        attribution: m.attribution ? { riskBeforePct: pct(m.attribution.riskBefore), riskAfterPct: pct(m.attribution.riskAfter), mixPts: +(100 * m.attribution.mix).toFixed(2), ratePts: +(100 * m.attribution.rate).toFixed(2), topPattern: job.patterns[m.attribution.byPattern[0].g], topPatternPts: +(100 * m.attribution.byPattern[0].total).toFixed(2) } : null },
      audit10: { audited: tenPct.audited, alarm: tenPct.alarmT == null ? null : wall(tenPct.alarmT), daysAfterDrift: tenPct.alarmT != null && tenPct.driftT != null ? +((tenPct.alarmT - tenPct.driftT) / 1440).toFixed(1) : null,
        weeklyCheckAlarm: tenPct.weekly ? wall(tenPct.weekly.alarmT) : null },
    },
    unlocks: a.unlocks.map(u => ({ handsFreePct: pct(u.coverage), riskPct: pct(u.risk), extraReviews: Number.isFinite(u.extraReviews) ? u.extraReviews : null, weeks: Number.isFinite(u.weeks) ? +u.weeks.toFixed(1) : null })),
    reviewsSavedPerWeek: Math.round(a.cert.coverage * a.weeklyReviews),
    simulationTruthPct: Number.isFinite(a.cert.threshold) ? pct(trueSelectiveRisk(rng(1), JOBS[job.key], 5, a.cert.threshold, 400000).risk) : null,
  };
  if (job.drift) r.monitorTable = monitorTable(a).map(x => ({ ...x, falseAlarmE: pct(x.falseAlarmE), falseAlarmW: pct(x.falseAlarmW) }));
  // re-certification on the latest 9 weeks (includes the drift) for the email job
  if (job.drift) {
    const re = analyzeJob(job, data.meta, { windowShift: 4 });
    r.recertifyLatest = { threshold: Number.isFinite(re.cert.threshold) ? +re.cert.threshold.toFixed(3) : null, handsFreePct: pct(re.cert.coverage), certifiedBoundPct: re.cert.ucb == null ? null : pct(re.cert.ucb) };
    const ex = analyzeJob(job, data.meta, { windowShift: 4, excluded: new Set([job.drift.pattern]) });
    r.recertifyLatestExcludingDriftPattern = { pattern: job.patterns[job.drift.pattern], threshold: +ex.cert.threshold.toFixed(3), handsFreePctOfAll: pct(ex.cert.n / re.cert.N), certifiedBoundPct: pct(ex.cert.ucb) };
  }
  out.jobs[job.key] = r;
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/results.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));

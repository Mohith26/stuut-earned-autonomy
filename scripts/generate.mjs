// Seeded synthetic review history for one Stuut customer team ("Acme Inc").
// node scripts/generate.mjs [out.json]  ->  data/acme.json
//
// Structure follows Stuut's own description of its review step (stuut.ai/dev-blog/
// turning-human-review-into-improvements, Oct 14 2026): per job, a reviewer sends as
// drafted / edits / dismisses (emails), acknowledges / completes by hand / clears
// (payment promises); cases fall into stable named patterns. Volumes ("thousands of
// review decisions every week" across jobs) and pattern names are modeled on that post;
// rates and confidences are synthetic.
import { writeFileSync, mkdirSync } from 'node:fs';
import { rng } from '../src/autonomy.js';
import { JOBS, DRIFT_WEEK, sampleTask, randnOf, pickOf } from '../src/model.js';

export const SEED = 20261111;
const R = rng(SEED);
const randn = randnOf(R);
const pick = pickOf(R);

const START = Date.UTC(2026, 6, 20, 4, 0); // Mon Jul 20 2026 00:00 America/New_York (EDT, UTC-4)
const WEEKS = 16;
// DRIFT_WEEK (src/model.js) = 14: Mon Oct 26 2026, the ERP sync for Acme moves from hourly to nightly

const SUR = ['Wright','Davis','Perez','Lowe','Briggs','Vega','Miller','Harmon','Curry','Gomez','Lane','Wise','Peterson','Herrera','Nguyen','Brooks','Kim','Ortiz','Reed','Foster','Hayes','Bishop','Coleman','Grant','Ward','Patel','Shah','Moreno','Hughes','Price','Sutton','Banks','Lam','Fischer','Novak','Romero','Keller','Duran','Hale','Pierce','Marsh','Boyd','Chen','Rivas','Tate','Holt','Frost','Nash'];
const SUF = ['Inc','LLC','Group','Supply Co.','Industrial','Holdings','Partners','Distribution','Logistics','Manufacturing'];
const customers = [];
const seen = new Set();
while (customers.length < 240) {
  const a = SUR[Math.floor(R() * SUR.length)], b = SUR[Math.floor(R() * SUR.length)], c = SUR[Math.floor(R() * SUR.length)];
  const form = R();
  const name = form < 0.34 ? `${a}, ${b} and ${c}` : form < 0.62 ? `${a} ${SUF[Math.floor(R() * SUF.length)]}` : form < 0.8 ? `${a}-${b}` : `${a} & ${b} ${SUF[Math.floor(R() * SUF.length)]}`;
  if (a === b || b === c || seen.has(name)) continue;
  seen.add(name); customers.push(name);
}
const custWeights = customers.map((_, i) => 1 / Math.pow(i + 3, 0.85));
const reviewers = ['Theresa Peterson', 'Dennis Davis', 'Allison Wise', 'Matthew Herrera', 'Linda Gomez', 'Brad Lane'];

const lognormal = (median, sigma) => median * Math.exp(sigma * randn());
const HEX = '0123456789ABCDEF';
const invoiceId = ci => customers[ci].replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() + '-' + Array.from({ length: 6 }, () => HEX[Math.floor(R() * 16)]).join('');

function minuteInWeek() {
  // business-hours weighted timestamp within a week (America/New_York wall clock minutes)
  const day = R() < 0.93 ? Math.floor(R() * 5) : 5 + Math.floor(R() * 2);
  const hour = day < 5 ? 7 + Math.min(12, Math.floor(Math.abs(randn()) * 3.2 + R() * 8)) : 9 + Math.floor(R() * 8);
  return day * 1440 + hour * 60 + Math.floor(R() * 60);
}

const out = {
  meta: {
    org: 'Acme Inc', seed: SEED, generated: 'scripts/generate.mjs', tz: 'America/New_York',
    startUTC: new Date(START).toISOString(), weeks: WEEKS,
    windows: { planning: [0, 3], calibration: [3, 12], shadow: [12, 16] },
    driftWeek: DRIFT_WEEK,
    driftNote: 'From Mon Oct 26 2026 the customer ERP sync moved from hourly to nightly, so more payments land after the agent drafts a reply.',
  },
  customers, reviewers, jobs: {},
};

for (const [key, J] of Object.entries(JOBS)) {
  const cols = { t: [], g: [], c: [], y: [], cu: [], amt: [], inv: [], rv: [] };
  const rows = [];
  for (let w = 0; w < WEEKS; w++) {
    const vol = Math.round(J.weekly * (0.9 + 0.2 * R()));
    for (let i = 0; i < vol; i++) {
      const { g, c, y } = sampleTask(R, J, w, randn, pick);
      const ci = pick(custWeights);
      rows.push({ t: w * 10080 + minuteInWeek(), g, c, y, cu: ci,
        amt: Math.round(lognormal(J.amountMedian, 0.9) * 100), inv: invoiceId(ci), rv: Math.floor(R() * reviewers.length) });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  for (const r of rows) for (const k of Object.keys(cols)) cols[k].push(r[k]);
  out.jobs[key] = { key, label: J.label, short: J.short, weekly: J.weekly, actions: J.actions,
    patterns: J.patterns.map(p => p[0]), drift: J.drift ? { pattern: J.drift.pattern } : null, n: rows.length, cols };
}

const target = process.argv[2] || new URL('../data/acme.json', import.meta.url);
if (!process.argv[2]) mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(target, JSON.stringify(out));
console.log(Object.values(out.jobs).map(j => `${j.key}: ${j.n}`).join(', '));

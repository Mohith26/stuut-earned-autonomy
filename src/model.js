// Generative model of review outcomes (shared by scripts/generate.mjs, scripts/report.mjs and tests).
// Each task: pattern g ~ mix; latent change probability p = sigmoid(logit(rate_g) + 0.9 z);
// agent confidence = sigmoid(0.75 * -logit(p) + bias_g + 0.55 z2)  (informative but overconfident,
// and very overconfident on patterns the agent cannot see, e.g. a payment reported after it ran);
// reviewer outcome: change with probability p (dismissal share d_g), else 8% stylistic edits.
export const sigmoid = x => 1 / (1 + Math.exp(-x));
export const logit = p => Math.log(p / (1 - p));
export function randnOf(R) { return () => { let u = 0; while (u === 0) u = R(); const v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }
export function pickOf(R) { return w => { const u = R() * w.reduce((a, b) => a + b, 0); let s = 0; for (let i = 0; i < w.length; i++) { s += w[i]; if (u < s) return i; } return w.length - 1; }; }
export const DRIFT_WEEK = 14;

// pattern: [name, base change rate, mix, overconfidence bias, share of changes that are dismissals]
export const JOBS = {
  email: {
    label: 'Replying to emails', short: 'Email replies', weekly: 380, amountMedian: 4200,
    actions: ['Sent as drafted', 'Edited (style only)', 'Edited (material)', 'Dismissed'],
    patterns: [
      ['Invoice copy requested, document on file', 0.012, 0.20, 0.3, 0.3],
      ['Balance or statement request', 0.010, 0.17, 0.3, 0.3],
      ['Remittance details sent by customer', 0.025, 0.11, 0.3, 0.4],
      ['Payment status question, data current', 0.015, 0.12, 0.3, 0.3],
      ['W-9 or vendor form request', 0.040, 0.06, 0.3, 0.3],
      ['Portal or payment-link access issue', 0.070, 0.07, 0.2, 0.3],
      ['Invoice copy requested, document not yet in system', 0.380, 0.05, 0.1, 0.5],
      ['Payment reported after the agent ran', 0.450, 0.015, 2.9, 0.6],
      ['Dispute or short-pay raised in reply', 0.220, 0.055, 0.1, 0.3],
      ['Routine automatic reply', 0.300, 0.06, 0.5, 0.9],
      ['Request for a call or meeting', 0.120, 0.04, 0.2, 0.3],
      ['Pricing or PO mismatch question', 0.180, 0.05, 0.1, 0.3],
    ],
    drift: { pattern: 7, mix: 0.16 },
  },
  promise: {
    label: 'Capturing payment promises', short: 'Payment promises', weekly: 300, amountMedian: 5600,
    actions: ['Acknowledged', 'Acknowledged after note edit', 'Completed by hand', 'Cleared'],
    patterns: [
      ['Clear date and amount stated', 0.020, 0.38, 0.3, 0.3],
      ['Date stated, amount implied by invoice list', 0.050, 0.18, 0.3, 0.3],
      ['Relative date ("end of next week")', 0.090, 0.12, 0.4, 0.2],
      ['Partial payment promised', 0.100, 0.08, 0.2, 0.2],
      ['Payment already sent, not a promise', 0.550, 0.06, 0.6, 0.8],
      ['Conditional promise pending approval', 0.250, 0.07, 0.2, 0.5],
      ['Promise covers several invoices, one ambiguous', 0.160, 0.06, 0.3, 0.2],
      ['Stated date padded by the agent', 0.300, 0.05, 1.2, 0.1],
    ],
  },
  cashapp: {
    label: 'Applying payments', short: 'Cash App', weekly: 820, amountMedian: 6800,
    actions: ['Posted as proposed', 'Posted after memo edit', 'Re-allocated', 'Unapplied'],
    patterns: [
      ['Exact remittance match, single invoice', 0.003, 0.42, 0.3, 0.3],
      ['Multi-invoice payment with remittance', 0.012, 0.17, 0.3, 0.3],
      ['Remittance in email, matched by amount', 0.030, 0.10, 0.3, 0.3],
      ['Short-pay with deduction code', 0.080, 0.08, 0.3, 0.2],
      ['No remittance, matched by invoice combination', 0.100, 0.07, 0.5, 0.3],
      ['Overpayment or credit memo', 0.120, 0.05, 0.2, 0.5],
      ['Parent and child entity mismatch', 0.200, 0.04, 0.3, 0.4],
      ['Foreign currency payment', 0.070, 0.04, 0.2, 0.3],
      ['Duplicate payment suspected', 0.350, 0.03, 0.2, 0.7],
    ],
  },
};


export function mixFor(J, week) {
  let mix = J.patterns.map(p => p[2]);
  if (J.drift && week >= DRIFT_WEEK) { mix = mix.slice(); mix[J.drift.pattern] = J.drift.mix; }
  return mix;
}

/** Draw one task's (pattern, confidence, outcome code, true change probability). */
export function sampleTask(R, J, week, randn = randnOf(R), pick = pickOf(R)) {
  const g = pick(mixFor(J, week));
  const [, rate, , bias, dismissShare] = J.patterns[g];
  const p = sigmoid(logit(rate) + 0.9 * randn());
  const conf = sigmoid(0.75 * -logit(p) + bias + 0.55 * randn());
  const u = R();
  const y = u < p ? (R() < dismissShare ? 3 : 2) : (R() < 0.08 ? 1 : 0);
  return { g, c: Math.min(999, Math.max(1, Math.round(conf * 1000))), y, p };
}

/** Ground-truth selective risk of a threshold, by Monte Carlo from the model (for tests/README). */
export function trueSelectiveRisk(R, J, week, lambda, draws = 200000, material = true) {
  const randn = randnOf(R), pick = pickOf(R);
  let n = 0, s = 0;
  for (let i = 0; i < draws; i++) {
    const t = sampleTask(R, J, week, randn, pick);
    if (t.c / 1000 >= lambda) { n++; s += material ? t.p * 1 : t.p + (1 - t.p) * 0.08; }
  }
  return { n, risk: n ? s / n : 0, coverage: n / draws };
}

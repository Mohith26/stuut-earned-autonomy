// Earned Autonomy: Control Center > Autonomy (unofficial concept demo for Stuut)
import { analyzeJob, monitorTable, WEEK } from './src/analysis.js';
import { toCSV } from './src/autonomy.js';
import { describe } from './src/text.js';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view'), overlay = $('#overlay');
const STORE = 'stuut-earned-autonomy:v1';
const JOB_ORDER = ['email', 'promise', 'cashapp'];
const TABS = ['certificate', 'patterns', 'monitor', 'history'];

const S = {
  data: null, tab: 'certificate', job: 'email', eps: 0.02, conf: 0.95, rule: 'material', audit: 1,
  window: 'issued', pattern: null, drawerFilter: 'all', drawerPage: 0, search: '', sort: { key: 'n', dir: -1 },
  menu: false, dialog: null,
  saved: { enabled: {}, excluded: {}, events: [] },
};
try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s) S.saved = { enabled: {}, excluded: {}, events: [], ...s }; } catch { /* ignore */ }
const persist = () => localStorage.setItem(STORE, JSON.stringify(S.saved));

// ---------- formatting ----------
const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
const int = n => n.toLocaleString('en-US');
const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORIGIN = Date.UTC(2026, 6, 20); // Mon Jul 20 2026, wall clock America/New_York
const wall = t => new Date(ORIGIN + t * 60e3);
const two = n => String(n).padStart(2, '0');
const fmtDT = t => { const d = wall(t); return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}/${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = t => { const d = wall(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const fmtWeekRange = ([a, b]) => `${fmtD(a * WEEK)} – ${fmtD(b * WEEK - 1)}`;
const nowStamp = () => { const d = new Date(); return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const icons = () => window.lucide && window.lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });

// ---------- analysis cache ----------
const cache = new Map();
function excludedSet(job) { return new Set(S.saved.excluded[job] || []); }
function A(jobKey = S.job, over = {}) {
  const ex = over.excluded || excludedSet(jobKey);
  const opts = { eps: S.eps, delta: +(1 - S.conf).toFixed(3), rule: S.rule, audit: S.audit, windowShift: S.window === 'latest' ? 4 : 0, excluded: ex, ...over };
  const key = JSON.stringify({ jobKey, ...opts, excluded: [...ex].sort() });
  if (!cache.has(key)) cache.set(key, analyzeJob(S.data.jobs[jobKey], S.data.meta, opts));
  return cache.get(key);
}
// shadow run / monitor always replays the certificate issued at the end of the original window
const Aissued = (jobKey = S.job) => A(jobKey, { windowShift: 0, excluded: new Set() });

// ---------- URL state ----------
function readHash() {
  const [path, q] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '').split('/').filter(Boolean);
  if (parts[0] === 'control-center' && parts[1] === 'autonomy' && TABS.includes(parts[2])) S.tab = parts[2];
  const p = new URLSearchParams(q || '');
  if (JOB_ORDER.includes(p.get('job'))) S.job = p.get('job');
  if (p.get('cap') && [1, 2, 3, 5].includes(+p.get('cap'))) S.eps = +p.get('cap') / 100;
  if (p.get('conf') && [90, 95, 99].includes(+p.get('conf'))) S.conf = +p.get('conf') / 100;
  if (['material', 'strict'].includes(p.get('rule'))) S.rule = p.get('rule');
  if (p.get('audit') && [100, 50, 25, 10].includes(+p.get('audit'))) S.audit = +p.get('audit') / 100;
  if (['issued', 'latest'].includes(p.get('window'))) S.window = p.get('window');
  S.pattern = p.has('pattern') ? +p.get('pattern') : null;
}
function writeHash() {
  const p = new URLSearchParams({ job: S.job, cap: Math.round(S.eps * 100), conf: Math.round(S.conf * 100), rule: S.rule, audit: Math.round(S.audit * 100), window: S.window });
  if (S.pattern != null) p.set('pattern', S.pattern);
  history.replaceState(null, '', `#/control-center/autonomy/${S.tab}?${p}`);
}

// ---------- events / history ----------
function logEvent(e) { S.saved.events.unshift({ ts: nowStamp(), ...e }); persist(); }
function seededEvents() {
  const out = [];
  for (const k of JOB_ORDER) {
    const a = Aissued(k), job = S.data.jobs[k];
    const endCal = S.data.meta.windows.calibration[1] * WEEK - 1;
    if (a.cert.certifiedIndex >= 0) {
      out.push({ t: endCal, actor: 'System', kind: 'system', html: `<b>System</b> issued a certificate for <a>${esc(job.label)}</a>: ${pct(a.cert.coverage)} hands-free at confidence ≥ ${a.cert.threshold.toFixed(3)}, risk bound ${pct(a.cert.ucb, 2)}`, more: 'View details' });
      out.push({ t: endCal + 1, actor: 'System', kind: 'system', html: `<b>System</b> started a shadow run for <a>${esc(job.label)}</a> (reviews stay on)` });
    } else {
      out.push({ t: endCal, actor: 'System', kind: 'system', html: `<b>System</b> could not certify <a>${esc(job.label)}</a> at a ${pct(S.eps, 0)} cap yet (${int(a.cert.N)} reviews)` });
    }
    const m = a.shadow && a.shadow.monitor;
    if (m && m.alarmT != null) out.push({ t: m.alarmT, actor: 'Agent', kind: 'agent', html: `<b>Monitor</b> found hands-free risk above ${pct(S.eps, 0)} for <a>${esc(job.label)}</a> (e-value ${m.series[m.alarmIndex].toFixed(1)} ≥ ${m.threshold}); autonomy would have reverted to review`, more: 'View details' });
  }
  return out.sort((a, b) => b.t - a.t);
}

// ---------- charts ----------
function riskChart(a, W = 760) {
  const H = 290, m = { l: 44, r: 16, t: 14, b: 36 };
  const pts = a.cert.curve;
  const yMax = Math.ceil(Math.max(S.eps * 2, a.raw.risk * 1.15, Math.min(S.eps * 2.5, Math.max(...pts.filter(p => p.tested).map(p => p.ucb)))) * 200) / 200;
  const x = c => m.l + c * (W - m.l - m.r), y = r => m.t + (1 - Math.min(r, yMax * 1.04) / yMax) * (H - m.t - m.b);
  const grid = [], ticks = [];
  for (let i = 0; i <= 5; i++) { const r = yMax * i / 5; grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(r)}" y2="${y(r)}"/>`); ticks.push(`<text x="${m.l - 8}" y="${y(r) + 4}" text-anchor="end">${(r * 100).toFixed(r * 100 % 1 ? 1 : 0)}%</text>`); }
  for (let i = 0; i <= 10; i++) ticks.push(`<text x="${x(i / 10)}" y="${H - 12}" text-anchor="middle">${i * 10}%</text>`);
  const band = pts.map(p => `${x(p.coverage)},${y(p.ucb)}`).join(' ') + ' ' + [...pts].reverse().map(p => `${x(p.coverage)},${y(p.risk)}`).join(' ');
  const line = pts.map(p => `${x(p.coverage)},${y(p.risk)}`).join(' ');
  const uline = pts.map(p => `${x(p.coverage)},${y(p.ucb)}`).join(' ');
  const dots = pts.map((p, i) => {
    const fill = p.certified ? 'var(--stuut-blue-700)' : p.tested && p.pass ? 'var(--stuut-blue-500)' : '#fff';
    const stroke = p.tested ? (p.pass ? 'var(--stuut-blue-500)' : 'var(--destructive)') : 'var(--neutral-400)';
    return `<circle data-pt="${i}" cx="${x(p.coverage)}" cy="${y(p.risk)}" r="${p.certified ? 6.5 : 4.5}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" style="cursor:pointer"/>`;
  }).join('');
  const c = a.cert.certifiedIndex >= 0 ? pts[a.cert.certifiedIndex] : null;
  const certLbl = c ? `<line x1="${x(c.coverage)}" x2="${x(c.coverage)}" y1="${y(c.risk) + 8}" y2="${H - m.b}" stroke="var(--stuut-blue-700)" stroke-dasharray="2 3"/>
    <g transform="translate(${Math.min(x(c.coverage) + 12, W - 200)},${y(c.risk) + 10})"><rect width="184" height="22" rx="6" fill="#fff" stroke="var(--border)"/><text x="10" y="15" style="fill:var(--foreground);font-weight:600">Certified · ${pct(c.coverage)} hands-free</text></g>` : '';
  const raw = `<g data-raw="1" style="cursor:pointer"><rect x="${x(a.raw.coverage) - 6}" y="${y(a.raw.risk) - 6}" width="12" height="12" transform="rotate(45 ${x(a.raw.coverage)} ${y(a.raw.risk)})" fill="#fff" stroke="var(--stuut-red-300)" stroke-width="2"/>
    <text x="${x(a.raw.coverage) + (a.raw.coverage > 0.55 ? -12 : 12)}" y="${y(a.raw.risk) + 4}" text-anchor="${a.raw.coverage > 0.55 ? 'end' : 'start'}" style="fill:var(--stuut-red-300);font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:4px">Confidence ≥ 0.90, uncertified</text></g>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Risk of hands-free work versus share handled without review"><defs><clipPath id="plotclip"><rect x="${m.l - 8}" y="${m.t - 8}" width="${W - m.l - m.r + 16}" height="${H - m.t - m.b + 8}"/></clipPath></defs>
    <g class="grid">${grid.join('')}</g>${ticks.join('')}
    <text x="${m.l}" y="${H - 0}" style="fill:var(--neutral-600)">Share handled without review →</text>
    <g clip-path="url(#plotclip)"><polygon points="${band}" fill="var(--stuut-blue-tint-strong)" opacity=".75"/>
    <polyline points="${uline}" fill="none" stroke="var(--stuut-blue-900)" stroke-width="1.2" stroke-dasharray="4 3"/>
    <polyline points="${line}" fill="none" stroke="var(--stuut-blue-500)" stroke-width="2"/></g>
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(S.eps)}" y2="${y(S.eps)}" stroke="var(--destructive)" stroke-width="1.2" stroke-dasharray="6 4"/>
    <text x="${m.l + 6}" y="${y(S.eps) - 6}" style="fill:var(--destructive);font-weight:600">Risk cap ${pct(S.eps, 0)}</text>
    ${certLbl}${raw}<g clip-path="url(#plotclip)">${dots}</g></svg>`;
}

function timeChart({ series, yLog, yMax, yMin = 0, threshold, thresholdLabel, markers, t0, t1, height = 170, fmtY, color = 'var(--stuut-blue-500)', step = false, aria, W = 760 }) {
  const H = height, m = { l: 46, r: 18, t: 12, b: 26 };
  const x = t => m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r);
  const ly = v => yLog ? Math.log10(Math.max(v, yMin)) : v;
  const y = v => m.t + (1 - (ly(v) - ly(yMin)) / (ly(yMax) - ly(yMin))) * (H - m.t - m.b);
  const ticksY = yLog ? [0.1, 1, 10, 100, 1000].filter(v => v >= yMin && v <= yMax) : Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);
  const grid = ticksY.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const lbl = ticksY.map(v => `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtY(v)}</text>`).join('');
  const days = []; for (let t = Math.ceil(t0 / 1440) * 1440; t <= t1; t += 1440 * 7) days.push(`<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${fmtD(t)}</text>`);
  let d = '';
  series.forEach((p, i) => { const X = x(p.t).toFixed(1), Y = y(Math.min(p.v, yMax)).toFixed(1); if (i === 0) d += `M${X},${Y}`; else { if (step) d += `H${X}`; d += `L${X},${Y}`; } });
  const th = threshold != null ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="var(--destructive)" stroke-dasharray="6 4"/><text x="${m.l + 6}" y="${y(threshold) - 5}" style="fill:var(--destructive);font-weight:600">${thresholdLabel}</text>` : '';
  const mk = (markers || []).map(k => `<line x1="${x(k.t)}" x2="${x(k.t)}" y1="${m.t}" y2="${H - m.b}" stroke="${k.color}" stroke-dasharray="${k.dash || '3 3'}"/><text x="${x(k.t) + (k.anchor === 'end' ? -6 : 6)}" y="${m.t + 12 + (k.dy || 0)}" text-anchor="${k.anchor || 'start'}" style="fill:${k.color};font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:4px">${k.label}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}"><g class="grid">${grid}</g>${lbl}${days}${th}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>${mk}</svg>`;
}

const CHARTS = new Map();
function chartSlot(id, fn) { CHARTS.set(id, fn); return `<div data-chart="${id}"></div>`; }
function fillCharts() {
  document.querySelectorAll('[data-chart]').forEach(el => {
    const W = Math.max(420, Math.round(el.clientWidth));
    const fn = el.dataset.chart === 'risk' ? (w => riskChart(A(), w)) : CHARTS.get(el.dataset.chart);
    if (fn) el.innerHTML = fn(W);
  });
}
window.addEventListener('resize', () => S.data && fillCharts());

// ---------- shared header ----------
function jobChips() {
  return JOB_ORDER.map((k, i) => {
    const j = S.data.jobs[k], on = S.saved.enabled[k];
    return `<button class="chip ${k === S.job ? 'on' : ''}" data-job="${k}" title="${esc(j.label)} (${i + 1})">${esc(j.label)} <span class="n num">${int(j.n)}</span>${on ? '<span class="pill ok" style="margin-left:2px">On</span>' : ''}</button>`;
  }).join('');
}
function controls() {
  return `<div class="toolbar">${jobChips()}</div><div class="toolbar">
    <span class="select"><label for="cap">Risk cap</label><select id="cap" data-ctl="cap">${[1, 2, 3, 5].map(v => `<option value="${v}" ${Math.round(S.eps * 100) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></span>
    <span class="select"><label for="conf">Confidence</label><select id="conf" data-ctl="conf">${[90, 95, 99].map(v => `<option value="${v}" ${Math.round(S.conf * 100) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></span>
    <label class="toggle" title="Count wording-only edits as errors too"><input type="checkbox" data-ctl="rule" ${S.rule === 'strict' ? 'checked' : ''}/><span class="track"></span>Count style edits</label></div>`;
}
function head(title, sub) {
  const a = A(), job = S.data.jobs[S.job], on = S.saved.enabled[S.job];
  const can = a.cert.certifiedIndex >= 0;
  return `<div class="page-head"><div><h2>${title}</h2><p>${sub}</p></div><div class="actions">
    <div class="rel"><button class="btn" data-act="menu" aria-haspopup="menu" aria-expanded="${S.menu}"><i data-lucide="download"></i>Export<i data-lucide="chevron-down"></i></button>
    ${S.menu ? `<div class="menu" role="menu"><button data-export="cert" role="menuitem"><i data-lucide="file-json"></i>Certificate (JSON)</button><button data-export="patterns" role="menuitem"><i data-lucide="table"></i>Patterns (CSV)</button><button data-export="cases" role="menuitem"><i data-lucide="list"></i>Reviewed cases (CSV)</button><button data-export="monitor" role="menuitem"><i data-lucide="activity"></i>Monitor log (CSV)</button></div>` : ''}</div>
    ${on ? `<button class="btn danger" data-act="disable"><i data-lucide="pause"></i>Turn off for ${esc(job.short)}</button>`
      : `<button class="btn dark" data-act="enable" ${can ? '' : 'disabled title="Nothing certified at this cap yet"'}><i data-lucide="shield-check"></i>Turn on autonomy</button>`}
  </div></div>`;
}
const windowLabel = a => `${fmtWeekRange(a.W.weeks.calibration)} · ${int(a.cert.N)} reviews`;

// ---------- certificate tab ----------
function viewCertificate() {
  const a = A(), job = S.data.jobs[S.job], ai = Aissued();
  const ex = excludedSet(S.job), on = S.saved.enabled[S.job];
  const totalCal = ex.size ? A(S.job, { excluded: new Set() }).cert.N : a.cert.N;
  const c = a.cert, ok = c.certifiedIndex >= 0;
  const handsFree = ok ? c.n / totalCal : 0;
  let banner = '';
  const mon = ai.shadow && ai.shadow.monitor;
  if (on) banner = `<div class="banner ok"><i data-lucide="circle-check"></i><div class="grow"><b>Autonomy is on for ${esc(job.label)}</b> since ${esc(on.since)}: Stuut acts without review when its confidence is ≥ ${on.threshold.toFixed(3)}. ${pct(on.audit, 0)} of hands-free work is still sampled for review, and the monitor reverts to review if risk rises above ${pct(on.eps, 0)}.</div></div>`;
  else if (S.window === 'issued' && mon && mon.alarmT != null) banner = `<div class="banner warn"><i data-lucide="triangle-alert"></i><div class="grow"><b>The shadow run caught drift.</b> On ${fmtDT(mon.alarmT)} the monitor found hands-free risk above ${pct(S.eps, 0)}; errors rose after ${fmtD(mon.driftT)}, when Acme's ERP sync moved from hourly to nightly. Re-certify on the latest weeks before turning this on.</div><button class="btn" data-act="recert"><i data-lucide="refresh-cw"></i>Re-certify on latest 9 weeks</button></div>`;
  else if (!ok) {
    const f = c.firstFailure;
    let worst = null;
    if (f) {
      const W = a.W.calibration.filter(i => job.cols.c[i] / 1000 >= f.lambda); const cnt = new Map();
      for (const i of W) { const g = job.cols.g[i], e = cnt.get(g) || [0, 0]; e[0]++; if (job.cols.y[i] >= (S.rule === 'strict' ? 1 : 2)) e[1]++; cnt.set(g, e); }
      worst = [...cnt.entries()].filter(([, [n, k]]) => k >= 3 && k / n >= 3 * S.eps).map(([g, [n, k]]) => [g, k, n]).sort((p, q) => q[1] - p[1])[0] || null;
    }
    banner = `<div class="banner bad"><i data-lucide="octagon-x"></i><div class="grow"><b>Nothing certifies at a ${pct(S.eps, 0)} cap on this window.</b> The most confident ${pct(f ? f.coverage : 0)} of ${esc(job.short.toLowerCase())} already had ${f ? f.k : 0} changes in ${f ? int(f.n) : 0} (bound ${f ? pct(f.ucb, 2) : '–'}), so the fixed sequence stops at its first step.${worst ? ` Largest source: <b>${esc(job.patterns[worst[0]])}</b> (${worst[1]} of ${f.k} changes, ${pct(worst[1] / worst[2], 0)} of its confident cases).` : ' No single pattern stands out; more reviews will tighten the bound (see Unlock).'}</div>${worst && !ex.has(worst[0]) ? `<button class="btn" data-exclude="${worst[0]}"><i data-lucide="user-check"></i>Always review this pattern</button>` : ''}</div>`;
  } else banner = `<div class="banner"><i data-lucide="info"></i><div class="grow">Stuut can handle <b>${pct(handsFree)}</b> of ${esc(job.short.toLowerCase())} without review. With ${pct(S.conf, 0)} confidence, at most ${pct(S.eps, 0)} of those would have been ${S.rule === 'strict' ? 'changed in any way' : 'dismissed or materially changed'} by a reviewer.${ex.size ? ' <span class="pill warn">Provisional: pattern exclusions chosen on this window</span>' : ''}</div></div>`;

  const sh = ai.shadow;
  const unl = a.unlocks.map(u => `<div class="unlock"><div class="big num">${pct(u.coverage * c.N / totalCal, 0)}</div><div class="txt">${Number.isFinite(u.extraReviews) && u.weeks <= 52
      ? `About <b>${int(Math.max(1, u.extraReviews))}</b> more reviews<span>${u.weeks < 1 ? 'under a week' : `≈ ${u.weeks.toFixed(1)} weeks`} at ${int(Math.round(a.weeklyReviews))} reviews/week · observed ${pct(u.risk, 2)}</span>`
      : `Not reachable at a ${pct(S.eps, 0)} cap<span>observed ${pct(u.risk, 2)} ${u.risk >= S.eps ? 'is above the cap' : 'is too close to the cap'}</span>`}</div></div>`).join('') || '<div class="unlock"><div class="txt">Every grid step is already certified.</div></div>';

  return `${head('Autonomy', `Let Stuut act without review where its record is certified · ${esc(job.label)}`)}${controls()}${banner}
  <div class="kpis">
    <div class="kpi"><div class="label">Hands-free share</div><div class="value num">${ok ? pct(handsFree) : '0%'}</div><div class="foot">${ok ? `${int(c.n)} of ${int(totalCal)} reviewed in window` : 'nothing certified yet'}</div></div>
    <div class="kpi"><div class="label">Certified risk bound <span class="pill ${ok ? 'ok' : 'muted'}">≤ ${pct(S.eps, 0)}</span></div><div class="value num">${ok ? pct(c.ucb, 2) : '–'}</div><div class="foot">${ok ? `observed ${pct(c.risk, 2)} (${c.k} of ${int(c.n)}) · ${pct(S.conf, 0)} confidence` : `at a ${pct(S.eps, 0)} cap`}</div></div>
    ${S.window === 'latest' ? `<div class="kpi"><div class="label">Shadow run, held out</div><div class="value num">–</div><div class="foot">window ends today; the monitor validates it once on</div></div>` : `<div class="kpi"><div class="label">Shadow run, held out${job.drift ? ' <span class="pill muted">before drift</span>' : ''}</div><div class="value num">${sh && sh.pre.n ? pct(sh.pre.risk, 2) : '–'}</div><div class="foot">${sh && sh.pre.n ? `${sh.pre.k} of ${int(sh.pre.n)} hands-free · ${job.drift ? `${fmtD(S.data.meta.windows.shadow[0] * WEEK)} – ${fmtD(S.data.meta.driftWeek * WEEK - 1)}` : fmtWeekRange(S.data.meta.windows.shadow)}` : 'no certified threshold to replay'}</div></div>`}
    <div class="kpi"><div class="label">Reviews saved per week</div><div class="value num">${ok ? int(Math.round(c.coverage * a.weeklyReviews)) : '0'}</div><div class="foot">at ${int(Math.round(a.weeklyReviews))} reviews/week in window</div></div>
  </div>
  <div class="grid2">
    <div class="card"><div class="card-head"><div><h3>Risk vs. hands-free share</h3><div class="card-sub">Each point is a confidence threshold fixed in advance from ${fmtWeekRange(a.W.weeks.planning)}; tested in order on ${windowLabel(a)}</div></div>
      <div class="legend"><span><i style="background:var(--stuut-blue-500)"></i>Observed</span><span><i style="background:var(--stuut-blue-tint-strong)"></i>${pct(S.conf, 0)} upper bound</span><span><i style="background:#fff;border:1.5px solid var(--destructive)"></i>Failed</span></div></div>
      <div data-chart="risk"></div>
      <details class="method"><summary>How the certificate is computed</summary>Thresholds are fixed from earlier weeks' confidence scores (no outcomes used), then tested from the most conservative down. Each test asks whether the share of hands-free work a reviewer would have ${S.rule === 'strict' ? 'changed' : 'dismissed or materially changed'} could exceed ${pct(S.eps, 0)}, using an exact binomial test. The first failure stops the sequence, which keeps the overall chance of certifying an unsafe threshold below ${pct(1 - S.conf, 0)} (Learn then Test, fixed-sequence). The uncertified diamond is a plain confidence cutoff of 0.90 for comparison: ${pct(a.raw.coverage)} hands-free at ${pct(a.raw.risk, 2)} observed risk.</details>
    </div>
    <div class="card"><h3>Unlock more autonomy</h3><div class="card-sub">Next thresholds in the sequence, if their observed rate holds</div>${unl}
      <div class="method" style="border-top:1px solid var(--row-border);padding-top:10px">Window <b style="color:var(--foreground)">${S.window === 'latest' ? 'Latest 9 weeks' : 'Issued Oct 11'}</b> · ${windowLabel(a)}${S.window === 'latest' ? ` · <a href="#" data-act="window-issued">back to issued</a>` : ` · <a href="#" data-act="recert">use latest</a>`}</div></div>
  </div>`;
}

// ---------- patterns tab ----------
function patternRows(a) {
  let rows = a.patterns.slice();
  const q = S.search.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
  const k = S.sort.key, d = S.sort.dir;
  rows.sort((p, r) => (typeof p[k] === 'string' ? p[k].localeCompare(r[k]) : p[k] - r[k]) * d);
  return rows;
}
function viewPatterns() {
  const a = A(), job = S.data.jobs[S.job];
  const rows = patternRows(a);
  const th = (key, label, cls = '') => `<th class="sort ${cls}" data-sort="${key}">${label}<span class="arr">${S.sort.key === key ? (S.sort.dir < 0 ? '↓' : '↑') : '↕'}</span></th>`;
  const maxShare = Math.max(...a.patterns.map(p => p.riskShare), 0.0001);
  const body = rows.length ? rows.map(r => `<tr class="click ${S.pattern === r.g ? 'sel' : ''}" data-pattern="${r.g}" tabindex="0">
      <td><span class="linkish">${esc(r.name)}</span>${job.drift && job.drift.pattern === r.g ? ' <span class="pill warn">Drifted</span>' : ''}</td>
      <td class="r num">${int(r.n)}</td>
      <td class="r num">${pct(r.changeRate)}</td>
      <td class="r num">${r.medianConf.toFixed(3)}</td>
      <td class="r num">${r.excluded ? '<span class="pill muted">Always review</span>' : pct(r.autoShare, 0)}</td>
      <td class="num">${r.excluded ? '<span class="muted">–</span>' : `${r.autoLoss} <span class="bar"><i style="width:${(100 * r.riskShare / maxShare).toFixed(0)}%"></i></span>`}</td>
      <td class="r"><label class="toggle" title="Always route this pattern to review"><input type="checkbox" data-exclude-toggle="${r.g}" ${r.excluded ? 'checked' : ''} aria-label="Always review ${esc(r.name)}"/><span class="track"></span></label></td></tr>`).join('')
    : `<tr><td colspan="7"><div class="empty"><b>No patterns match "${esc(S.search)}"</b>Try a shorter search.</div></td></tr>`;
  return `${head('Patterns', `Named case groups from the review loop, with how much of each the certificate would hand off · ${esc(job.label)}`)}${controls()}
    <div class="toolbar"><div class="search"><i data-lucide="search"></i><input id="psearch" placeholder="Search patterns" value="${esc(S.search)}" aria-label="Search patterns"/></div><span class="muted" style="color:var(--muted-foreground);font-size:13px">${windowLabel(a)}${excludedSet(S.job).size ? ' · <span class="pill warn">Provisional: exclusions chosen on this window</span>' : ''}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${th('name', 'Pattern', 'pcol')}${th('n', 'Reviews', 'r')}${th('changeRate', 'Changed', 'r')}${th('medianConf', 'Median conf.', 'r')}${th('autoShare', 'Hands-free', 'r')}${th('autoLoss', 'Hands-free errors')}<th class="r">Always review</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="pager"><span class="num">1 - ${rows.length} of ${a.patterns.length}</span></div>`;
}

function drawer() {
  if (S.pattern == null || !S.data.jobs[S.job].patterns[S.pattern]) return '';
  const a = A(), job = S.data.jobs[S.job], g = S.pattern;
  const thr = a.cert.threshold, loss = y => (S.rule === 'strict' ? y >= 1 : y >= 2);
  let ids = a.W.calibration.concat(a.W.shadow).filter(i => job.cols.g[i] === g);
  if (excludedSet(S.job).has(g)) ids = A(S.job, { excluded: new Set() }).W.calibration.filter(i => job.cols.g[i] === g);
  const counts = { all: ids.length, changed: ids.filter(i => loss(job.cols.y[i])).length, auto: ids.filter(i => job.cols.c[i] / 1000 >= thr).length };
  if (S.drawerFilter === 'changed') ids = ids.filter(i => loss(job.cols.y[i]));
  if (S.drawerFilter === 'auto') ids = ids.filter(i => job.cols.c[i] / 1000 >= thr);
  ids.sort((p, q) => job.cols.t[q] - job.cols.t[p]);
  const per = 50, pages = Math.max(1, Math.ceil(ids.length / per)), page = Math.min(S.drawerPage, pages - 1);
  const slice = ids.slice(page * per, page * per + per);
  const act = y => `<span class="pill ${y >= 3 ? 'bad' : y === 2 ? 'warn' : y === 1 ? 'muted' : 'ok'}">${esc(job.actions[y])}</span>`;
  const rows = slice.map(i => {
    const f = { inv: job.cols.inv[i], amt: money(job.cols.amt[i]) };
    const conf = job.cols.c[i] / 1000;
    return `<tr><td class="num muted" style="white-space:nowrap">${fmtDT(job.cols.t[i])}</td><td><span class="linkish">${esc(S.data.customers[job.cols.cu[i]])}</span><div class="case-desc">${esc(describe(S.job, g, job.cols.y[i], f))}</div></td>
      <td class="r num">${conf.toFixed(3)}${conf >= thr ? '<div><span class="pill blue">Hands-free</span></div>' : ''}</td><td>${act(job.cols.y[i])}</td><td class="muted" style="white-space:nowrap">${esc(S.data.reviewers[job.cols.rv[i]])}</td></tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty"><b>No cases in this view</b>Switch the filter above.</div></td></tr>`;
  const p = a.patterns[g];
  return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(job.patterns[g])}">
    <header><div><h3>${esc(job.patterns[g])}</h3><p>${esc(job.label)} · ${int(p.n)} reviews in the certificate window, ${int(counts.all)} including the shadow run · changed ${pct(p.changeRate)} in window · median confidence ${p.medianConf.toFixed(3)}</p></div><button class="x" data-act="close" aria-label="Close"><i data-lucide="x"></i></button></header>
    <div class="body"><div class="toolbar"><button class="chip ${S.drawerFilter === 'all' ? 'on' : ''}" data-df="all">All <span class="n">${int(counts.all)}</span></button><button class="chip ${S.drawerFilter === 'changed' ? 'on' : ''}" data-df="changed">Changed by reviewer <span class="n">${int(counts.changed)}</span></button><button class="chip ${S.drawerFilter === 'auto' ? 'on' : ''}" data-df="auto">Would be hands-free <span class="n">${int(counts.auto)}</span></button><span class="spacer"></span><button class="btn" data-export="cases"><i data-lucide="download"></i>CSV</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Case</th><th class="r">Confidence</th><th>Reviewer action</th><th>Reviewer</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pager"><span class="num">${ids.length ? page * per + 1 : 0} - ${Math.min(ids.length, page * per + per)} of ${int(ids.length)}</span><span class="sepv"></span><button data-page="0" ${page === 0 ? 'disabled' : ''} aria-label="First page"><i data-lucide="chevrons-left"></i></button><button data-page="${page - 1}" ${page === 0 ? 'disabled' : ''} aria-label="Previous page"><i data-lucide="chevron-left"></i></button><button data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''} aria-label="Next page"><i data-lucide="chevron-right"></i></button></div></div></aside>`;
}

// ---------- monitor tab ----------
function viewMonitor() {
  const a = Aissued(), job = S.data.jobs[S.job], sh = a.shadow;
  if (!sh || a.cert.certifiedIndex < 0) {
    return `${head('Shadow run & monitor', `Replay of the issued certificate on held-out weeks · ${esc(job.label)}`)}${controls()}
      <div class="card"><div class="empty"><b>No certified threshold to replay for ${esc(job.label)}</b>At a ${pct(S.eps, 0)} cap the certificate issued on ${fmtD(S.data.meta.windows.calibration[1] * WEEK - 1)} hands off nothing, so there is nothing to monitor. Try a higher cap.</div></div>`;
  }
  const m = sh.monitor, t0 = S.data.meta.windows.shadow[0] * WEEK, t1 = S.data.meta.windows.shadow[1] * WEEK;
  const thr = a.cert.threshold, loss = y => (S.rule === 'strict' ? y >= 1 : y >= 2);
  // rolling 7-day realized risk among ALL hands-free shadow tasks
  const auto = a.W.shadow.filter(i => job.cols.c[i] / 1000 >= thr);
  const roll = [];
  for (let t = t0 + 1440 * 2; t <= t1; t += 360) {
    const w = auto.filter(i => job.cols.t[i] <= t && job.cols.t[i] > t - 10080);
    if (w.length >= 20) roll.push({ t, v: w.filter(i => loss(job.cols.y[i])).length / w.length });
  }
  const ev = m.series.map((v, i) => ({ t: m.t[i], v }));
  const markers = [];
  if (m.driftT != null) markers.push({ t: m.driftT, color: 'var(--warning-muted-foreground)', label: `${fmtD(m.driftT)} · ERP sync moved to nightly`, anchor: 'end' });
  if (m.alarmT != null) markers.push({ t: m.alarmT, color: 'var(--destructive)', label: `Revert ${fmtDT(m.alarmT).slice(0, 5)} ${fmtDT(m.alarmT).slice(11)}`, dy: 16 });
  if (m.weekly) markers.push({ t: m.weekly.alarmT, color: 'var(--neutral-500)', label: 'Weekly check', dy: 32, dash: '2 4' });
  const weekly = sh.weekly.map(w => {
    const st = m.alarmT != null && m.alarmT < (w.week + 1) * WEEK ? (m.alarmT < w.week * WEEK ? '<span class="pill muted">In review</span>' : '<span class="pill bad">Reverted</span>') : w.risk <= S.eps ? '<span class="pill ok">Within cap</span>' : '<span class="pill warn">Above cap</span>';
    return `<tr><td class="num" style="white-space:nowrap">${fmtWeekRange([w.week, w.week + 1])}</td><td class="r num">${int(w.total)}</td><td class="r num">${int(w.n)} <span class="muted">(${pct(w.coverage, 0)})</span></td><td class="r num">${w.k}</td><td class="r num">${pct(w.risk, 2)}</td><td>${st}</td></tr>`;
  }).join('');
  const tbl = sh.post ? monitorTable(a) : [];
  const daysAfter = m.alarmT != null && m.driftT != null ? ((m.alarmT - m.driftT) / 1440).toFixed(1) : null;
  const summary = job.drift
    ? (m.alarmT != null
      ? `<div class="banner bad"><i data-lucide="siren"></i><div class="grow"><b>Reverted to review ${daysAfter} days after the drift began</b> (${fmtDT(m.alarmT)}). ${m.badBeforeAlarm} replies went out hands-free with errors before the revert; a weekly check ${m.weekly ? `would have fired ${fmtDT(m.weekly.alarmT)}, after ${m.badBeforeWeekly}` : 'would not have fired in this window'}.</div></div>`
      : `<div class="banner warn"><i data-lucide="hourglass"></i><div class="grow"><b>No revert yet at a ${pct(S.audit, 0)} audit rate.</b> ${int(m.audited)} hands-free tasks were audited in the shadow run; the post-drift risk was ${pct(sh.post.risk, 2)}. See the table below for how long each audit rate needs.</div></div>`)
    : `<div class="banner ok"><i data-lucide="circle-check"></i><div class="grow"><b>No alarms.</b> ${int(m.audited)} audited hands-free tasks over four held-out weeks; realized risk ${pct(sh.all.risk, 2)} against a ${pct(S.eps, 0)} cap.</div></div>`;
  return `${head('Shadow run & monitor', `The certificate issued ${fmtD(S.data.meta.windows.calibration[1] * WEEK - 1)} (confidence ≥ ${thr.toFixed(3)}), replayed on ${fmtWeekRange(S.data.meta.windows.shadow)} with reviews still on · ${esc(job.label)}`)}${controls()}
    <div class="toolbar"><span style="font-size:13.5px;font-weight:500">Audit rate</span><div class="seg" role="group" aria-label="Audit rate">${[1, 0.5, 0.25, 0.1].map(r => `<button class="${S.audit === r ? 'on' : ''}" data-audit="${r}">${pct(r, 0)}</button>`).join('')}</div><span style="color:var(--muted-foreground);font-size:13px">share of hands-free work still sent to a reviewer · ${int(m.audited)} audited of ${int(m.autoCount)}</span></div>
    ${summary}
    <div class="card"><div class="mon-grid"><div><h3>Monitor evidence (e-value)</h3><div class="card-sub">Grows when audited hands-free work fails more often than ${pct(S.eps, 0)}; crossing ${m.threshold} reverts to review. While risk stays within the cap, the chance of ever crossing is at most ${pct(1 / m.threshold, 0)}.</div>
      ${chartSlot('ev', W => timeChart({ W, series: [{ t: t0, v: 1 }, ...ev], yLog: true, yMin: 0.1, yMax: 1000, threshold: m.threshold, thresholdLabel: `Revert at ${m.threshold}`, markers, t0, t1, fmtY: v => v >= 1 ? String(v) : v.toFixed(1), step: true, aria: 'Monitor e-value over time' }))}</div>
      <div><h3>Hands-free error rate, trailing 7 days</h3><div class="card-sub">All shadow-run tasks at or above the threshold (reviews stayed on)</div>
      ${chartSlot('roll', W => timeChart({ W, series: roll, yMax: Math.max(0.1, Math.ceil(Math.max(...roll.map(r => r.v), 0) * 50) / 50), threshold: S.eps, thresholdLabel: `Cap ${pct(S.eps, 0)}`, markers: markers.slice(0, 2), t0, t1, fmtY: v => `${(v * 100).toFixed(0)}%`, color: 'var(--stuut-blue-700)', aria: 'Trailing seven-day hands-free error rate' }))}</div></div></div>
    ${m.attribution ? attributionCard(m.attribution, job) : ''}
    <div class="grid2b"><div class="card"><h3>What audit rate do you need?</h3><div class="card-sub">${sh.post ? `Simulated: hands-free risk jumps from ${pct(a.cert.risk, 2)} to ${pct(sh.post.risk, 2)}, as in this drift. Median over 300 drifts; false alarms over 300 quiet years.` : 'No drift in this job.'}</div>
      ${tbl.length ? `<table class="tbl"><thead><tr><th>Audit rate</th><th class="r">Audits / day</th><th class="r">Days to revert</th><th class="r">Weekly check</th><th class="r">False alarms / yr</th><th class="r">Weekly check</th></tr></thead><tbody>${tbl.map(r => `<tr class="${S.audit === r.rate ? 'sel' : ''}"><td>${pct(r.rate, 0)}</td><td class="r num">${r.perDay}</td><td class="r num"><b>${r.medianDaysE.toFixed(1)}</b></td><td class="r num muted">${r.medianDaysW}</td><td class="r num"><b>${pct(r.falseAlarmE, 1)}</b></td><td class="r num muted">${pct(r.falseAlarmW, 0)}</td></tr>`).join('')}</tbody></table>
      <div class="method">The weekly check is a binomial test on each week's audits at the same level. It is often as fast, but it tests every week, so its false alarms add up; every false alarm sends the whole job back to review.</div>` : '<div class="empty" style="padding:20px 0">Nothing to simulate for this job.</div>'}
      ${job.drift ? `<div style="margin-top:12px"><button class="btn" data-act="recert"><i data-lucide="refresh-cw"></i>Re-certify on latest 9 weeks</button></div>` : ''}</div>
    <div class="card"><h3>Shadow run by week</h3><div class="card-sub">Every would-be hands-free task still has a reviewer outcome</div>
      <table class="tbl"><thead><tr><th style="width:150px">Week</th><th class="r">Tasks</th><th class="r">Would be hands-free</th><th class="r">Changed by reviewer</th><th class="r">Hands-free error rate</th><th>Status</th></tr></thead><tbody>${weekly}</tbody></table></div></div>`;
}

function attributionCard(at, job) {
  const top = at.byPattern.filter(p => p.total > 0).slice(0, 4);
  const max = Math.max(...top.map(p => p.total), 1e-9);
  const ex = excludedSet(job.key);
  return `<div class="card" style="margin-top:12px"><div class="card-head"><div><h3>Why it fired</h3><div class="card-sub">Hands-free error went from ${pct(at.riskBefore, 2)} (certificate window) to ${pct(at.riskAfter, 2)} (audits in the 7 days before the revert). Split exactly into more of a risky pattern (mix, ${(at.mix * 100).toFixed(2)} pts) and patterns getting worse (rate, ${(at.rate * 100).toFixed(2)} pts).</div></div></div>
    <table class="tbl"><thead><tr><th class="pcol">Pattern</th><th class="r">Share of hands-free</th><th class="r">Error rate</th><th>Contribution</th><th class="r"></th></tr></thead><tbody>
    ${top.map(p => `<tr><td><span class="linkish">${esc(job.patterns[p.g])}</span></td><td class="r num">${pct(p.wB, 1)} → <b>${pct(p.wA, 1)}</b></td><td class="r num">${pct(p.rB, 1)} → <b>${pct(p.rA, 1)}</b></td>
      <td class="num" style="white-space:nowrap">+${(p.total * 100).toFixed(2)} pts <span class="bar" style="width:90px"><i style="width:${(100 * p.total / max).toFixed(0)}%;background:${p.mix >= p.rate ? 'var(--stuut-red-300)' : 'var(--stuut-blue-500)'}"></i></span> <span class="muted">${p.mix >= p.rate ? 'mix' : 'rate'}</span></td>
      <td class="r">${ex.has(p.g) ? '<span class="pill muted">Always review</span>' : `<button class="btn" data-exclude-recert="${p.g}">Always review</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- history tab ----------
function viewHistory() {
  const seeded = seededEvents().map(e => ({ ts: fmtDT(e.t) + ':00', ...e }));
  const all = [...S.saved.events.map(e => ({ ...e, ts: e.ts + ':00' })), ...seeded];
  const ico = e => e.kind === 'person' ? `<div class="ico person">${esc(e.actor.split(' ').map(s => s[0]).join(''))}</div>` : e.kind === 'agent' ? '<div class="ico"><i data-lucide="bot"></i></div>' : '<div class="ico"><i data-lucide="settings"></i></div>';
  return `${head('History', 'Every certificate, change and revert, recorded like the Audit Log')}
    <div class="banner"><i data-lucide="info"></i><div class="grow">History covers Autonomy events for all jobs. Actions you take here are saved in this browser.</div>${S.saved.events.length ? '<button class="btn" data-act="reset">Reset demo</button>' : ''}</div>
    <div class="tbl-wrap log"><div class="row" style="font-size:13.5px;color:var(--neutral-600);padding:11px 14px"><span class="date">Date</span><span>Description</span></div>
    ${all.map(e => `<div class="row"><span class="date">${esc(e.ts)}</span>${ico(e)}<span class="desc">${e.html}</span>${e.more ? `<span class="more">${e.more}</span>` : ''}</div>`).join('')}</div>
    <div class="pager"><span class="num">1 - ${all.length} of ${all.length}</span></div>`;
}

// ---------- dialogs ----------
function dialogHtml() {
  if (!S.dialog) return '';
  if (S.dialog === 'enable') {
    const a = A(), job = S.data.jobs[S.job];
    const totalCal = excludedSet(S.job).size ? A(S.job, { excluded: new Set() }).cert.N : a.cert.N;
    return `<div class="scrim" data-act="close-dialog"></div><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h3 id="dlgT">Turn on autonomy for ${esc(job.label)}?</h3>
      <p>Stuut will act without review when its confidence is at or above the certified threshold. Everything else stays in review.</p>
      <dl><dt>Threshold</dt><dd class="num">confidence ≥ ${a.cert.threshold.toFixed(3)}</dd><dt>Hands-free share</dt><dd class="num">${pct(a.cert.n / totalCal)}</dd><dt>Certified risk bound</dt><dd class="num">${pct(a.cert.ucb, 2)} (cap ${pct(S.eps, 0)}, ${pct(S.conf, 0)} confidence)</dd><dt>Always in review</dt><dd>${excludedSet(S.job).size ? [...excludedSet(S.job)].map(g => esc(job.patterns[g])).join('; ') : 'none'}</dd>
      <dt>Audit sample</dt><dd><div class="seg">${[0.5, 0.25, 0.1].map(r => `<button class="${(S.dialogAudit || 0.25) === r ? 'on' : ''}" data-daudit="${r}">${pct(r, 0)}</button>`).join('')}</div></dd></dl>
      <p style="color:var(--muted-foreground);font-size:12.5px;margin-top:10px">If audited work shows risk above the cap, the monitor reverts this job to review automatically and logs it in History.</p>
      <div class="row"><button class="btn" data-act="close-dialog">Cancel</button><button class="btn dark" data-act="confirm-enable"><i data-lucide="shield-check"></i>Turn on</button></div></div>`;
  }
  if (S.dialog === 'help') {
    const k = [['1 · 2 · 3', 'Switch job'], ['c · p · m · h', 'Certificate · Patterns · Monitor · History'], ['/', 'Search patterns'], ['e', 'Export certificate (JSON)'], ['Esc', 'Close panel'], ['?', 'This help']];
    return `<div class="scrim" data-act="close-dialog"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3><dl>${k.map(([a, b]) => `<dt><kbd>${a}</kbd></dt><dd style="font-weight:500">${b}</dd>`).join('')}</dl><div class="row"><button class="btn" data-act="close-dialog">Close</button></div></div>`;
  }
  return '';
}

// ---------- render ----------
function render() {
  if (!S.data) return;
  document.querySelectorAll('.tabs button[data-tab]').forEach(b => { const on = b.dataset.tab === S.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  const v = { certificate: viewCertificate, patterns: viewPatterns, monitor: viewMonitor, history: viewHistory }[S.tab];
  const focusSearch = document.activeElement && document.activeElement.id === 'psearch';
  const caret = focusSearch ? document.activeElement.selectionStart : null;
  CHARTS.clear();
  view.innerHTML = v();
  fillCharts();
  overlay.innerHTML = (S.tab === 'patterns' ? drawer() : '') + dialogHtml();
  if (focusSearch) { const el = $('#psearch'); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
  writeHash(); icons();
}

// ---------- exports ----------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function doExport(kind) {
  const a = A(), job = S.data.jobs[S.job];
  if (kind === 'cert') {
    const c = a.cert;
    download(`stuut-autonomy-certificate-${S.job}.json`, JSON.stringify({
      job: job.label, org: S.data.meta.org, window: fmtWeekRange(a.W.weeks.calibration), riskCap: S.eps, confidence: S.conf,
      lossRule: S.rule === 'strict' ? 'any reviewer change' : 'dismissed or materially changed', method: 'Learn then Test, fixed-sequence, exact binomial',
      certified: c.certifiedIndex >= 0, threshold: Number.isFinite(c.threshold) ? c.threshold : null, handsFreeShare: c.coverage, observedRisk: c.risk, riskBound: c.ucb, n: c.n, k: c.k, reviews: c.N,
      alwaysReview: [...excludedSet(S.job)].map(g => job.patterns[g]),
      grid: c.curve.map(p => ({ threshold: p.lambda, handsFreeShare: +p.coverage.toFixed(4), n: p.n, k: p.k, riskBound: +p.ucb.toFixed(5), pValue: +p.pValue.toExponential(3), tested: p.tested, pass: p.pass })),
    }, null, 2), 'application/json');
  } else if (kind === 'patterns') {
    download(`stuut-autonomy-patterns-${S.job}.csv`, toCSV(a.patterns, [
      { key: 'name', label: 'Pattern' }, { key: 'n', label: 'Reviews' }, { label: 'Changed by reviewer', get: r => r.changeRate.toFixed(4) },
      { label: 'Median confidence', get: r => r.medianConf.toFixed(3) }, { label: 'Hands-free share', get: r => r.autoShare.toFixed(4) }, { key: 'autoLoss', label: 'Errors in hands-free' }, { label: 'Always review', get: r => (r.excluded ? 'yes' : 'no') }]), 'text/csv');
  } else if (kind === 'cases') {
    const g = S.pattern;
    let ids = a.W.calibration.concat(a.W.shadow);
    if (g != null) ids = ids.filter(i => job.cols.g[i] === g);
    download(`stuut-autonomy-cases-${S.job}${g != null ? '-p' + g : ''}.csv`, toCSV(ids, [
      { label: 'Date', get: i => fmtDT(job.cols.t[i]) }, { label: 'Customer', get: i => S.data.customers[job.cols.cu[i]] }, { label: 'Invoice', get: i => job.cols.inv[i] },
      { label: 'Amount', get: i => (job.cols.amt[i] / 100).toFixed(2) }, { label: 'Pattern', get: i => job.patterns[job.cols.g[i]] }, { label: 'Confidence', get: i => (job.cols.c[i] / 1000).toFixed(3) },
      { label: 'Hands-free', get: i => (job.cols.c[i] / 1000 >= a.cert.threshold ? 'yes' : 'no') }, { label: 'Reviewer action', get: i => job.actions[job.cols.y[i]] }, { label: 'Reviewer', get: i => S.data.reviewers[job.cols.rv[i]] }]), 'text/csv');
  } else if (kind === 'monitor') {
    const m = Aissued().shadow && Aissued().shadow.monitor;
    if (!m) return toast('Nothing to export: no certified threshold for this job');
    download(`stuut-autonomy-monitor-${S.job}.csv`, toCSV(m.series.map((v, i) => i), [
      { label: 'Date', get: i => fmtDT(m.t[i]) }, { label: 'Audit outcome (1 = changed)', get: i => m.x[i] }, { label: 'E-value', get: i => m.series[i].toFixed(4) }, { label: 'Alarm', get: i => (i === m.alarmIndex ? 'revert' : '') }]), 'text/csv');
  }
  S.menu = false; render(); toast('Export downloaded');
}
let toastTimer;
function toast(msg) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); } el.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 2200); }

// ---------- interactions ----------
function setJob(k) { if (S.job !== k) { S.job = k; S.pattern = null; S.drawerPage = 0; render(); } }
function toggleExclude(g) {
  const cur = new Set(S.saved.excluded[S.job] || []);
  const name = S.data.jobs[S.job].patterns[g];
  if (cur.has(g)) { cur.delete(g); logEvent({ actor: 'Theresa Peterson', kind: 'person', html: `<b>Theresa Peterson</b> allowed <a>${esc(name)}</a> back into hands-free for ${esc(S.data.jobs[S.job].label)}` }); }
  else { cur.add(g); logEvent({ actor: 'Theresa Peterson', kind: 'person', html: `<b>Theresa Peterson</b> set <a>${esc(name)}</a> to always go to review for ${esc(S.data.jobs[S.job].label)}` }); }
  S.saved.excluded[S.job] = [...cur]; persist(); render();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-job],[data-act],[data-export],[data-sort],[data-pattern],[data-df],[data-page],[data-audit],[data-daudit],[data-exclude],[data-exclude-recert],[data-pt],[data-raw]');
  if (S.menu && !(t && (t.dataset.act === 'menu' || t.dataset.export))) { S.menu = false; render(); }
  if (!t) return;
  if (t.closest('[data-exclude-toggle]')) return;
  const d = t.dataset;
  if (d.tab) { S.tab = d.tab; S.pattern = null; render(); }
  else if (d.job) setJob(d.job);
  else if (d.export) doExport(d.export);
  else if (d.sort) { S.sort = { key: d.sort, dir: S.sort.key === d.sort ? -S.sort.dir : (d.sort === 'name' ? 1 : -1) }; render(); }
  else if (d.pattern != null && d.pattern !== undefined && t.tagName === 'TR') { if (e.target.closest('.toggle')) return; S.pattern = +d.pattern; S.drawerFilter = 'all'; S.drawerPage = 0; render(); }
  else if (d.df) { S.drawerFilter = d.df; S.drawerPage = 0; render(); }
  else if (d.page) { S.drawerPage = Math.max(0, +d.page); render(); }
  else if (d.audit) { S.audit = +d.audit; render(); }
  else if (d.daudit) { S.dialogAudit = +d.daudit; render(); }
  else if (d.exclude) toggleExclude(+d.exclude);
  else if (d.excludeRecert) { S.window = 'latest'; S.tab = 'certificate'; toggleExclude(+d.excludeRecert); toast('Pattern set to always review; re-certified on the latest 9 weeks'); }
  else if (d.act) {
    e.preventDefault();
    const job = S.data.jobs[S.job];
    switch (d.act) {
      case 'menu': S.menu = !S.menu; render(); break;
      case 'close': S.pattern = null; render(); break;
      case 'close-dialog': S.dialog = null; render(); break;
      case 'enable': S.dialog = 'enable'; S.dialogAudit = 0.25; render(); break;
      case 'confirm-enable': {
        const a = A();
        S.saved.enabled[S.job] = { threshold: a.cert.threshold, eps: S.eps, conf: S.conf, audit: S.dialogAudit || 0.25, since: nowStamp() };
        logEvent({ actor: 'Theresa Peterson', kind: 'person', html: `<b>Theresa Peterson</b> turned on autonomy for <a>${esc(job.label)}</a> at confidence ≥ ${a.cert.threshold.toFixed(3)} (${pct(a.cert.coverage)} hands-free, bound ${pct(a.cert.ucb, 2)}, ${pct(S.dialogAudit || 0.25, 0)} audits)`, more: 'View details' });
        persist(); S.dialog = null; render(); toast(`Autonomy on for ${job.short}`); break;
      }
      case 'disable':
        delete S.saved.enabled[S.job];
        logEvent({ actor: 'Theresa Peterson', kind: 'person', html: `<b>Theresa Peterson</b> turned off autonomy for <a>${esc(job.label)}</a>; all work goes to review` });
        persist(); render(); toast(`Autonomy off for ${job.short}`); break;
      case 'recert':
        S.window = 'latest'; S.tab = 'certificate';
        logEvent({ actor: 'System', kind: 'system', html: `<b>System</b> re-certified <a>${esc(job.label)}</a> on the latest 9 weeks (${fmtWeekRange(A().W.weeks.calibration)}): ${A().cert.certifiedIndex >= 0 ? `${pct(A().cert.coverage)} hands-free` : 'nothing certifies at this cap'}` });
        render(); break;
      case 'window-issued': S.window = 'issued'; render(); break;
      case 'reset': S.saved = { enabled: {}, excluded: {}, events: [] }; persist(); S.window = 'issued'; render(); toast('Demo reset'); break;
    }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.excludeToggle != null) { toggleExclude(+t.dataset.excludeToggle); return; }
  if (t.dataset.ctl === 'cap') S.eps = +t.value / 100;
  else if (t.dataset.ctl === 'conf') S.conf = +t.value / 100;
  else if (t.dataset.ctl === 'rule') S.rule = t.checked ? 'strict' : 'material';
  else return;
  render();
});
document.addEventListener('input', e => { if (e.target.id === 'psearch') { S.search = e.target.value; render(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-pattern]')) { S.pattern = +e.target.dataset.pattern; render(); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === 'Escape') { if (S.dialog) S.dialog = null; else if (S.pattern != null) S.pattern = null; else if (typing) document.activeElement.blur(); S.menu = false; render(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !S.data) return;
  const k = e.key;
  if (['1', '2', '3'].includes(k)) setJob(JOB_ORDER[+k - 1]);
  else if (k === 'c' || k === 'p' || k === 'm' || k === 'h') { S.tab = { c: 'certificate', p: 'patterns', m: 'monitor', h: 'history' }[k]; S.pattern = null; render(); }
  else if (k === '/') { e.preventDefault(); S.tab = 'patterns'; render(); $('#psearch') && $('#psearch').focus(); }
  else if (k === 'e') doExport('cert');
  else if (k === '?') { S.dialog = 'help'; render(); }
});

// chart tooltips
const tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; document.body.appendChild(tip);
document.addEventListener('mousemove', e => {
  const el = e.target.closest && e.target.closest('[data-pt],[data-raw]');
  if (!el || !S.data || S.tab !== 'certificate') { tip.style.display = 'none'; return; }
  const a = A();
  if (el.dataset.raw) tip.innerHTML = `<b>Confidence ≥ 0.90 (no certificate)</b><div><span class="k">Hands-free</span> ${pct(a.raw.coverage)}</div><div><span class="k">Observed risk</span> ${pct(a.raw.risk, 2)} (${a.raw.k} of ${int(a.raw.n)})</div>`;
  else {
    const p = a.cert.curve[+el.dataset.pt];
    tip.innerHTML = `<b>Confidence ≥ ${p.lambda.toFixed(3)}</b><div><span class="k">Hands-free</span> ${pct(p.coverage)} (${int(p.n)})</div><div><span class="k">Observed</span> ${pct(p.risk, 2)} · <span class="k">bound</span> ${pct(p.ucb, 2)}</div><div><span class="k">Test</span> ${p.tested ? (p.pass ? '<span style="color:var(--success)">passed</span>' : '<span style="color:var(--destructive)">failed: sequence stops</span>') : 'not reached'} · p = ${p.pValue < 1e-4 ? p.pValue.toExponential(1) : p.pValue.toFixed(4)}</div>`;
  }
  tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
});

window.addEventListener('hashchange', () => { readHash(); render(); });

// ---------- boot ----------
async function boot() {
  readHash();
  try {
    const r = await fetch('data/acme.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.data = await r.json();
    const lastWeek = S.data.meta.windows.shadow[1] - 1;
    let pending = 0;
    for (const k of JOB_ORDER) { const a = Aissued(k), j = S.data.jobs[k]; for (let i = 0; i < j.n; i++) if (Math.floor(j.cols.t[i] / WEEK) === lastWeek && !(j.cols.c[i] / 1000 >= a.cert.threshold)) pending++; }
    $('#taskCount').textContent = int(pending);
    render();
  } catch (err) {
    view.innerHTML = `<div class="card" style="margin-top:20px"><div class="empty"><b>Couldn't load the review history</b>${esc(err.message)}. <a href="#" id="retry">Try again</a></div></div>`;
    $('#retry').addEventListener('click', ev => { ev.preventDefault(); boot(); });
  }
  icons();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
window.addEventListener('load', icons);

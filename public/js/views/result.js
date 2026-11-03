import { h, svg, mount, spinner, modal, rich, tile, fmtMarks, fmtNum, fmtDateTime, fmtSeconds, fmtDuration } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, showError } from './shell.js';
import { toast } from '../dom.js';

const REASON = { manual: 'Submitted by you', timeout: 'Time ran out', violations: 'Auto-submitted after rule violations', admin: 'Submitted by the exam controller' };

const STATUS_CHIP = {
  correct: ['chip chip-ok', 'Correct'],
  wrong: ['chip chip-danger', 'Wrong'],
  partial: ['chip chip-warn', 'Partly correct'],
  unattempted: ['chip', 'Not attempted'],
  bonus: ['chip chip-lilac', 'Dropped, full marks'],
};

const answerText = (q, a) => {
  if (a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length)) return 'No answer';
  if (q.type === 'NUMERICAL') return Array.isArray(a) ? a.join(' or ') : String(a);
  const ids = [].concat(a);
  return ids
    .map((id) => {
      const o = q.options?.find((x) => x.id === id);
      return o ? `${id.toUpperCase()}. ${o.text}` : id.toUpperCase();
    })
    .join(', ');
};

function ring(score, max) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / (max || 1)));
  const arc = svg('circle', {
    cx: 90, cy: 90, r, fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round',
    stroke: 'var(--st-a-bg)', 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: 'rotate(-90 90 90)',
    style: 'transition: stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)',
  });
  requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', String(c * (1 - frac)))));
  return svg(
    'svg',
    { viewBox: '0 0 180 180', class: 'score-ring', role: 'img', 'aria-label': `Score ${fmtMarks(score)} out of ${max}` },
    svg('circle', { cx: 90, cy: 90, r, fill: 'none', 'stroke-width': 14, stroke: 'var(--line)' }),
    arc,
    svg('text', { x: 90, y: 92, 'text-anchor': 'middle', class: 'ring-num' }, fmtMarks(score)),
    svg('text', { x: 90, y: 118, 'text-anchor': 'middle', class: 'ring-of' }, `out of ${max}`),
  );
}

function histogramChart(hist, mine) {
  const W = 560, H = 190, pad = 22;
  const bins = hist.bins;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const bw = (W - pad * 2) / bins.length;
  const myBin = bins.findIndex((b, i) => mine >= b.from && (mine < b.to || i === bins.length - 1));
  const bars = bins.map((b, i) => {
    const bh = (b.count / maxC) * (H - 50);
    const rect = svg('rect', {
      x: pad + i * bw + 2, y: H - 28 - bh, width: Math.max(2, bw - 4), height: Math.max(bh, 1), rx: 5,
      fill: i === myBin ? 'var(--amber)' : 'var(--st-m-bg)', opacity: i === myBin ? 1 : 0.55,
    });
    rect.append(svg('title', null, `${Math.round(b.from)} to ${Math.round(b.to)} marks: ${b.count} candidates`));
    return rect;
  });
  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'hist', role: 'img', 'aria-label': 'Distribution of cohort scores with your band highlighted' },
    svg('line', { x1: pad, x2: W - pad, y1: H - 28, y2: H - 28, stroke: 'var(--line)', 'stroke-width': 1.5 }),
    ...bars,
    svg('text', { x: pad, y: H - 8, class: 'axis' }, String(Math.round(hist.lo))),
    svg('text', { x: W - pad, y: H - 8, class: 'axis', 'text-anchor': 'end' }, String(hist.hi)),
    myBin >= 0 ? svg('text', { x: pad + myBin * bw + bw / 2, y: 14, class: 'axis you', 'text-anchor': 'middle' }, 'You') : null,
  );
}

function sectionCard(s) {
  const pct = s.max ? Math.max(0, (s.marks / s.max) * 100) : 0;
  return h(
    'article',
    { class: 'sec-card' },
    h('h3', null, s.name),
    h('div', { class: 'sec-score' }, h('span', { class: 'num' }, fmtMarks(s.marks)), h('span', { class: 'muted' }, ` / ${s.max}`)),
    h('div', { class: 'bar', role: 'presentation' }, h('span', { style: { width: `${pct}%` } })),
    h('div', { class: 'sec-meta' },
      h('span', { class: 'chip chip-ok' }, `${s.correct} correct`),
      h('span', { class: 'chip chip-danger' }, `${s.wrong} wrong`),
      h('span', { class: 'chip' }, `${s.attempted} attempted`)),
    s.percentile != null ? h('p', { class: 'muted small' }, `${fmtNum(s.percentile, 2)} percentile`) : null,
  );
}

function challengeDialog(attemptId, q, onDone) {
  let claim = q.type === 'NUMERICAL' ? '' : null;
  const reason = h('textarea', { class: 'textarea', rows: 4, maxlength: 500, placeholder: 'Explain why the published key is wrong (10 to 500 characters).' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const input =
    q.type === 'NUMERICAL'
      ? h('input', { class: 'input', type: 'text', inputmode: 'decimal', 'aria-label': 'Your answer', oninput: (e) => (claim = e.target.value.trim()) })
      : h('div', { class: 'claim-opts' }, q.options.map((o) =>
          h('label', { class: 'check' }, h('input', { type: q.type === 'MSQ' ? 'checkbox' : 'radio', name: 'claim', value: o.id, onchange: (e) => {
            if (q.type === 'MSQ') {
              const set = new Set(claim || []);
              if (e.target.checked) set.add(o.id);
              else set.delete(o.id);
              claim = [...set];
            } else claim = o.id;
          } }), h('span', null, `${o.id.toUpperCase()}. `, rich(o.text)))));
  const submit = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    err.hidden = true;
    submit.disabled = true;
    try {
      await post(`/attempts/${attemptId}/challenges`, { questionId: q.id, claim, reason: reason.value });
      m.close();
      toast('Challenge sent for review.', 'ok');
      onDone();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      submit.disabled = false;
    }
  } }, 'Send challenge');
  const m = modal({
    title: `Challenge ${q.section} Q${q.no}`,
    body: h('div', { class: 'challenge-form' }, h('p', { class: 'muted' }, rich(q.text)), h('div', { class: 'field' }, h('span', { class: 'label' }, 'The answer you believe is correct'), input), h('div', { class: 'field' }, h('label', null, 'Your reasoning'), reason), err),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), submit],
  });
}

function questionCard(r, attemptId, canChallenge, reload) {
  const [cls, label] = STATUS_CHIP[r.status] || STATUS_CHIP.unattempted;
  const ch = r.challenge;
  return h(
    'article',
    { class: 'rq', dataset: { status: r.status } },
    h('header', null,
      h('strong', null, `${r.section} · Q${r.no}`),
      h('span', { class: cls }, label),
      h('span', { class: 'chip' }, `${r.marks > 0 ? '+' : ''}${fmtMarks(r.marks)} of ${r.maxMarks}`),
      h('span', { class: 'chip' }, fmtSeconds(Math.round(r.timeMs / 1000)))),
    h('p', { class: 'rq-text' }, rich(r.text)),
    h('dl', { class: 'rq-ans' },
      h('dt', null, 'Your answer'), h('dd', null, answerText(r, r.yourAnswer)),
      h('dt', null, 'Correct answer'), h('dd', null, r.dropped ? 'Question dropped, everyone gets full marks' : answerText(r, r.correctAnswer))),
    r.explanation ? h('details', { class: 'rq-exp' }, h('summary', null, 'Explanation'), h('p', null, rich(r.explanation))) : null,
    h('footer', null,
      ch ? h('span', { class: 'chip chip-lilac' }, `Challenge ${ch.status}`) : canChallenge && !r.dropped
        ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => challengeDialog(attemptId, r, reload) }, 'Challenge this key')
        : null),
  );
}

export async function resultView({ root, params, user }) {
  document.title = 'Your result | Pariksha';
  const attemptId = params[0];
  mount(root, appHeader(user), h('main', { class: 'page' }, spinner('Loading your result')));
  let d;
  try {
    d = await get(`/attempts/${attemptId}/result`);
  } catch (e) {
    showError(e);
    mount(root, appHeader(user), h('main', { class: 'page' }, h('div', { class: 'empty' }, h('strong', null, 'Result not available'), h('p', null, e.message), h('a', { class: 'btn', href: '#/dashboard' }, 'Back to your exams'))));
    return;
  }

  const head = h('div', { class: 'page-head' },
    h('a', { class: 'btn btn-ghost btn-sm return-dashboard', href: '#/dashboard' }, '← Return to dashboard'),
    h('h1', null, d.exam.title),
    h('p', { class: 'muted' }, `${d.candidate.name} · Application no. ${d.candidate.applicationNo} · ${REASON[d.attempt.submitReason] || 'Submitted'} on ${fmtDateTime(d.attempt.submittedAt)}`));

  if (!d.published) {
    mount(root, appHeader(user), h('main', { class: 'page', id: 'main' }, head,
      h('section', { class: 'panel' }, h('h2', null, 'Your paper is in'), h('p', { class: 'muted' }, `You attempted ${d.attemptedCount} of ${d.questionCount} questions. The score card appears here as soon as results are published.`))));
    return;
  }

  let filter = 'all';
  const list = h('div', { class: 'rq-list' });
  const pills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Filter questions' });
  const draw = () => {
    const rows = d.questions.filter((q) => filter === 'all' || q.status === filter);
    list.replaceChildren(...(rows.length ? rows.map((q) => questionCard(q, attemptId, d.challengeOpen, () => location.reload())) : [h('div', { class: 'empty' }, 'No questions in this view.')]));
    pills.replaceChildren(...[['all', 'All'], ['correct', 'Correct'], ['wrong', 'Wrong'], ['unattempted', 'Not attempted']].map(([k, l]) =>
      h('button', { class: 'pill', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; draw(); } },
        `${l} (${k === 'all' ? d.questions.length : d.questions.filter((q) => q.status === k).length})`)));
  };
  draw();

  mount(root, appHeader(user), h('main', { class: 'page', id: 'main' },
    head,
    h('section', { class: 'hero panel', 'aria-label': 'Score summary' },
      ring(d.score.total, d.score.max),
      h('dl', { class: 'hero-stats' },
        h('div', null, h('dt', null, 'Percentile'), h('dd', null, fmtNum(d.percentile, 2))),
        h('div', null, h('dt', null, 'Rank'), h('dd', null, `${d.rank}`, h('small', null, ` of ${d.cohort.n}`))),
        h('div', null, h('dt', null, 'Cohort average'), h('dd', null, fmtMarks(Math.round(d.cohort.mean * 100) / 100))),
        h('div', null, h('dt', null, 'Attempted'), h('dd', null, `${d.attemptedCount}`, h('small', null, ` of ${d.questionCount}`))),
        h('div', null, h('dt', null, 'Time allowed'), h('dd', null, fmtDuration(d.exam.durationMin))),
        d.attempt.violations ? h('div', null, h('dt', null, 'Rule violations'), h('dd', null, String(d.attempt.violations))) : null)),
    h('section', { class: 'sec-grid', 'aria-label': 'Section scores' }, d.sections.map(sectionCard)),
    h('section', { class: 'panel' }, h('h2', null, 'How the cohort scored'), h('p', { class: 'muted small' }, `Median ${fmtMarks(Math.round(d.cohort.median * 100) / 100)} · Top score ${fmtMarks(d.cohort.max)} · ${d.cohort.n} candidates`), histogramChart(d.cohort.histogram, d.score.total)),
    h('section', { class: 'review', 'aria-labelledby': 'rev-h' },
      h('div', { class: 'review-head' }, h('h2', { id: 'rev-h' }, 'Question review'), pills),
      d.challengeOpen ? h('p', { class: 'muted small' }, 'Think the published key is wrong? You can challenge it below while the window is open.') : null,
      list),
  ));
}

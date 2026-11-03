import { h, mount, spinner, modal, confirmDialog, toast, rich, fmtMarks, fmtNum, fmtClock, fmtDateTime, fmtDuration } from '../dom.js';
import { get, post, patch, del } from '../api.js';
import { store } from '../store.js';
import { appHeader, showError } from './shell.js';

const TABS = [
  ['live', 'Control room'],
  ['exams', 'Exams'],
  ['candidates', 'Candidates'],
  ['announcements', 'Announcements'],
  ['challenges', 'Challenges'],
  ['audit', 'Audit log'],
];

const table = (head, rows, empty = 'Nothing here yet.') =>
  rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))), h('tbody', null, rows)))
    : h('div', { class: 'empty' }, empty);

const stat = (label, value, tone) => h('div', { class: 'stat', dataset: { tone } }, h('span', { class: 'stat-n' }, fmtNum(value)), h('span', { class: 'muted small' }, label));

const answerLabel = (q, a) => (q?.type === 'NUMERICAL' ? [].concat(a).join(' or ') : [].concat(a).map((x) => String(x).toUpperCase()).join(', '));

// ------------------------------------------------------------------ control room
async function liveTab(box, setCleanup) {
  const [ov, lv] = await Promise.all([get('/admin/overview'), get('/admin/live')]);
  const stats = h('div', { class: 'stats' });
  const live = h('div');
  const drawStats = (o) => stats.replaceChildren(stat('Candidates', o.candidates), stat('Exams', o.exams), stat('Writing now', o.inProgress, 'live'), stat('Submitted', o.submitted), stat('Open challenges', o.pendingChallenges, o.pendingChallenges ? 'warn' : ''));
  const drawLive = ({ live: rows }) =>
    live.replaceChildren(
      table(['Candidate', 'Exam', 'Time left', 'Answered', 'Violations', 'Last seen', ''], rows.map((r) =>
        h('tr', null,
          h('td', null, h('strong', null, r.candidate), h('div', { class: 'muted small' }, r.applicationNo)),
          h('td', null, r.exam),
          h('td', { class: 'num' }, fmtClock(r.remainingMs), r.extraMin ? h('span', { class: 'chip chip-lilac', style: { marginLeft: '6px' } }, `+${r.extraMin}m`) : null),
          h('td', null, `${r.answered} / ${r.total}`),
          h('td', null, r.violations ? h('span', { class: 'chip chip-danger' }, r.violations) : '0'),
          h('td', null, r.lastSeenSecondsAgo > 45 ? h('span', { class: 'chip chip-warn' }, `${r.lastSeenSecondsAgo}s ago`) : 'now'),
          h('td', { class: 'right nowrap' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => extend(r) }, 'Add time'), ' ',
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
              if (await confirmDialog({ title: 'Submit this paper?', message: `${r.candidate}'s answers so far will be submitted now.`, confirmLabel: 'Submit paper', danger: true })) {
                try { await post(`/admin/attempts/${r.attemptId}/submit`); toast('Paper submitted.', 'ok'); refresh(); } catch (e) { showError(e); }
              }
            } }, 'Force submit')))),
        'Nobody is writing an exam right now.'),
    );
  async function refresh() {
    try {
      const [o, l] = await Promise.all([get('/admin/overview'), get('/admin/live')]);
      drawStats(o);
      drawLive(l);
    } catch { /* the next tick retries */ }
  }
  function extend(r) {
    const mins = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: 10, autofocus: true });
    const why = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'Reason, for example power cut at the centre' });
    const m = modal({
      title: `Add time for ${r.candidate}`,
      body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', null, 'Minutes to add (1 to 60)'), mins), h('div', { class: 'field' }, h('label', null, 'Reason (kept in the audit log)'), why)),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await post(`/admin/attempts/${r.attemptId}/extend`, { minutes: Number(mins.value), reason: why.value }); m.close(); toast('Time added.', 'ok'); refresh(); } catch (e) { showError(e); }
      } }, 'Add time')],
    });
  }
  drawStats(ov);
  drawLive(lv);
  const timer = setInterval(refresh, 5000);
  setCleanup(() => clearInterval(timer));
  mount(box, stats, h('section', { class: 'stack' }, h('div', { class: 'row' }, h('h2', null, 'Live monitor'), h('span', { class: 'chip chip-ok' }, 'Refreshes every 5 seconds')), live));
}

// ------------------------------------------------------------------ exams
async function analyticsDialog(examId) {
  let a;
  try { a = await get(`/admin/exams/${examId}/analytics`); } catch (e) { return showError(e); }
  const maxC = Math.max(1, ...a.histogram.bins.map((b) => b.count));
  const m = modal({
    title: `${a.exam.title}: analytics`,
    wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'stats' }, stat('Submitted', a.cohort.n), h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, fmtMarks(Math.round(a.cohort.mean * 10) / 10)), h('span', { class: 'muted small' }, 'Mean')), h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, fmtMarks(a.cohort.max)), h('span', { class: 'muted small' }, 'Top score')), stat('Candidates flagged', a.flagged, a.flagged ? 'warn' : '')),
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Score distribution' }, a.histogram.bins.map((b) => h('div', { class: 'bars-col', title: `${Math.round(b.from)} to ${Math.round(b.to)}: ${b.count}` }, h('span', { style: { height: `${(b.count / maxC) * 100}%` } }), h('small', null, Math.round(b.from))))),
      h('h3', null, 'Hardest questions first'),
      table(['Question', 'Attempted', 'Correct of attempted', 'Avg time'], a.questions.slice().sort((x, y) => x.correctPct - y.correctPct).slice(0, 8).map((q) =>
        h('tr', null, h('td', null, h('strong', null, `${q.section} Q${q.no}`), h('div', { class: 'muted small' }, q.text)), h('td', null, `${Math.round(q.attemptedPct)}%`), h('td', null, `${Math.round(q.correctPct)}%`), h('td', null, `${q.avgTimeSec}s`)))),
      h('h3', null, 'Top 15'),
      table(['Rank', 'Candidate', 'Marks', 'Percentile'], a.top.map((t) => h('tr', null, h('td', null, t.rank), h('td', null, t.name, h('div', { class: 'muted small' }, t.applicationNo)), h('td', null, fmtMarks(t.total)), h('td', null, fmtNum(t.percentile, 2)))))),
    actions: [h('a', { class: 'btn btn-ghost', href: `/api/admin/exams/${examId}/results.csv` }, 'Download results CSV'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

async function importDialog(reload) {
  let template = '';
  try { template = JSON.stringify(await get('/admin/exam-template'), null, 2); } catch { /* optional */ }
  const area = h('textarea', { class: 'textarea mono', rows: 16, spellcheck: 'false', value: template });
  area.value = template;
  const errs = h('ul', { class: 'form-error', role: 'alert', hidden: true });
  const m = modal({
    title: 'Import an exam',
    wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Paste an exam as JSON: sections, questions (MCQ, MSQ or NUMERICAL), answer keys and the marking scheme. The sample below is a working template.'), area, errs),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      errs.hidden = true;
      let body;
      try { body = JSON.parse(area.value); } catch { errs.replaceChildren(h('li', null, 'That is not valid JSON.')); errs.hidden = false; return; }
      try { await post('/admin/exams', body); m.close(); toast('Exam imported.', 'ok'); reload(); } catch (e) {
        const list = e.data?.details || [e.message];
        errs.replaceChildren(...list.slice(0, 8).map((x) => h('li', null, typeof x === 'string' ? x : JSON.stringify(x))));
        errs.hidden = false;
      }
    } }, 'Import exam')],
  });
}

async function examsTab(box) {
  const render = async () => {
    const { exams } = await get('/admin/exams');
    const toggle = (e, field, label) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: e[field], onchange: async (ev) => {
      try { await patch(`/admin/exams/${e.id}`, { [field]: ev.target.checked }); toast(`${label} ${ev.target.checked ? 'on' : 'off'}.`, 'ok'); } catch (er) { ev.target.checked = !ev.target.checked; showError(er); }
    } }), h('span', null, label));
    mount(box, h('div', { class: 'row' }, h('h2', null, 'Exams'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => importDialog(render) }, 'Import exam')),
      table(['Exam', 'Paper', 'Attempts', 'Settings', ''], exams.map((e) =>
        h('tr', null,
          h('td', null, h('strong', null, e.title), h('div', { class: 'muted small' }, `${e.code} · opens ${fmtDateTime(e.window.start)}`)),
          h('td', null, `${e.questionCount} questions`, h('div', { class: 'muted small' }, `${e.maxMarks} marks · ${fmtDuration(e.durationMin)}`)),
          h('td', null, `${e.submitted} submitted`, h('div', { class: 'muted small' }, `${e.inProgress} in progress`)),
          h('td', null, h('div', { class: 'stack-sm' }, toggle(e, 'resultsPublished', 'Results published'), toggle(e, 'challengeOpen', 'Challenges open'))),
          h('td', { class: 'right nowrap' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => analyticsDialog(e.id) }, 'Analytics'), ' ',
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: e.attempts > 0, title: e.attempts ? 'Exams with attempts cannot be deleted' : '', onclick: async () => {
              if (await confirmDialog({ title: 'Delete this exam?', message: e.title, confirmLabel: 'Delete', danger: true })) { try { await del(`/admin/exams/${e.id}`); render(); } catch (er) { showError(er); } }
            } }, 'Delete'))))));
  };
  await render();
}

// ------------------------------------------------------------------ candidates
function credentialsDialog(title, rows) {
  const csv = ['Name,Application number,Roll number,Password', ...rows.map((r) => [r.name, r.applicationNo, r.rollNo || '', r.password].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n');
  const m = modal({
    title,
    wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'form-notice' }, 'Passwords are shown only once. Download or copy them now.'), table(['Name', 'Application no.', 'Password'], rows.map((r) => h('tr', null, h('td', null, r.name || '-'), h('td', { class: 'num' }, r.applicationNo), h('td', { class: 'num' }, h('code', null, r.password)))))),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Close'), h('a', { class: 'btn btn-primary', href: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`, download: 'credentials.csv' }, 'Download CSV')],
  });
}

async function candidatesTab(box) {
  const body = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or application number', 'aria-label': 'Search candidates' });
  let t;
  async function load() {
    const { candidates, syntheticCount } = await get(`/admin/candidates?q=${encodeURIComponent(search.value)}`);
    body.replaceChildren(
      table(['Candidate', 'Roll no.', 'Centre', 'Attempts', ''], candidates.map((c) =>
        h('tr', null, h('td', null, h('strong', null, c.name), h('div', { class: 'muted small num' }, c.applicationNo)), h('td', null, c.rollNo || '-'), h('td', null, c.centre || '-'), h('td', null, c.attempts),
          h('td', { class: 'right' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
            if (!(await confirmDialog({ title: 'Reset password?', message: `${c.name} will be signed out and given a new password.`, confirmLabel: 'Reset' }))) return;
            try { const r = await post(`/admin/candidates/${c.id}/reset-password`); credentialsDialog('New password', [{ name: c.name, ...r, rollNo: c.rollNo }]); } catch (e) { showError(e); }
          } }, 'Reset password')))), 'No candidates match.'),
      syntheticCount ? h('p', { class: 'muted small' }, `${syntheticCount} sample candidates are hidden. They exist only so the analytics have a cohort to compare against.`) : null);
  }
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(showError), 250); });
  const bulk = () => {
    const count = h('input', { class: 'input', type: 'number', min: 1, max: 500, value: 5, autofocus: true });
    const centre = h('input', { class: 'input', type: 'text', maxlength: 60, placeholder: 'Pariksha Online Centre' });
    const names = h('textarea', { class: 'textarea', rows: 5, placeholder: 'Optional: one name per line' });
    const m = modal({
      title: 'Create candidates',
      body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', null, 'How many (1 to 500)'), count), h('div', { class: 'field' }, h('label', null, 'Centre'), centre), h('div', { class: 'field' }, h('label', null, 'Names'), names)),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try {
          const r = await post('/admin/candidates/bulk', { count: Number(count.value), centre: centre.value || undefined, names: names.value.split('\n').map((s) => s.trim()).filter(Boolean) });
          m.close(); credentialsDialog(`${r.created.length} candidates created`, r.created); load();
        } catch (e) { showError(e); }
      } }, 'Create')],
    });
  };
  mount(box, h('div', { class: 'row' }, h('h2', null, 'Candidates'), h('button', { class: 'btn btn-primary', type: 'button', onclick: bulk }, 'Create candidates')), search, body);
  await load();
}

// ------------------------------------------------------------------ challenges
async function announcementsTab(box) {
  const { announcements } = await get('/admin/announcements');
  const title = h('input', { class: 'input', required: true, maxlength: 120, placeholder: 'Notice title' });
  const type = h('select', { class: 'input' }, ...['general', 'exam', 'result', 'admit_card', 'urgent'].map((value) => h('option', { value }, ({ general: 'General announcement', exam: 'Exam update', result: 'Result announcement', admit_card: 'Admit card update', urgent: 'Important notice' })[value])));
  const message = h('textarea', { class: 'input', required: true, maxlength: 2000, rows: 4, placeholder: 'Write the announcement for candidates…' });
  const rows = h('div', { class: 'admin-announcement-list' });

  const draw = () => {
    rows.replaceChildren(...announcements.map((item) => h('article', { class: 'admin-announcement' },
      h('div', null, h('strong', null, item.title), h('p', { class: 'muted' }, item.message), h('span', { class: 'small muted' }, `${item.published ? 'Published' : 'Draft'} · ${fmtDateTime(item.createdAt)}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
          try { await patch(`/admin/announcements/${item.id}`, { published: !item.published }); item.published = !item.published; draw(); toast(item.published ? 'Announcement published.' : 'Announcement moved to draft.', 'ok'); } catch (error) { showError(error); }
        } }, item.published ? 'Unpublish' : 'Publish'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
          if (!confirm(`Delete “${item.title}”?`)) return;
          try { await del(`/admin/announcements/${item.id}`); announcements.splice(announcements.indexOf(item), 1); draw(); toast('Announcement deleted.', 'ok'); } catch (error) { showError(error); }
        } }, 'Delete')))));
    if (!announcements.length) rows.replaceChildren(h('div', { class: 'empty' }, h('strong', null, 'No announcements'), h('p', null, 'Create the first candidate notice above.')));
  };
  draw();

  const form = h('form', { class: 'panel admin-announcement-form', onsubmit: async (event) => {
    event.preventDefault();
    try {
      const { announcement } = await post('/admin/announcements', { title: title.value, message: message.value, type: type.value, audience: 'candidates', published: true });
      announcements.unshift(announcement); title.value = ''; message.value = ''; type.value = 'general'; draw(); toast('Announcement published.', 'ok');
    } catch (error) { showError(error); }
  } }, h('h2', null, 'New announcement'), h('div', { class: 'field' }, h('label', null, 'Notice type'), type), h('div', { class: 'field' }, h('label', null, 'Title'), title), h('div', { class: 'field' }, h('label', null, 'Message'), message), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Publish announcement'));
  mount(box, h('div', { class: 'stack' }, form, h('h2', null, 'Published notices'), rows));
}

async function challengesTab(box) {
  const render = async () => {
    const { challenges } = await get('/admin/challenges');
    const decide = async (c, decision) => {
      try { await post(`/admin/challenges/${c.id}/resolve`, { decision }); toast(`Challenge ${decision === 'reject' ? 'rejected' : 'resolved'}. Scores were recalculated.`, 'ok'); render(); } catch (e) { showError(e); }
    };
    mount(box, h('h2', null, 'Answer-key challenges'), h('p', { class: 'muted' }, 'Accepting or dropping a question changes the key for everyone, closes every pending challenge on it and re-scores all submitted papers.'),
      challenges.length ? h('div', { class: 'stack' }, challenges.map((c) =>
        h('article', { class: 'panel challenge' },
          h('div', { class: 'row' }, h('strong', null, `${c.exam} · ${c.question?.section || ''}`), h('span', { class: `chip ${c.status === 'pending' ? 'chip-warn' : ''}` }, c.status)),
          c.question ? h('p', { class: 'muted' }, rich(c.question.text)) : null,
          h('dl', { class: 'rq-ans' }, h('dt', null, 'Published key'), h('dd', null, c.question ? answerLabel(c.question, c.question.answer) : '-'), h('dt', null, `${c.candidate} claims`), h('dd', null, answerLabel(c.question, c.claim))),
          h('p', null, `“${c.reason}”`),
          c.status === 'pending' ? h('div', { class: 'row-actions' },
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => decide(c, 'accept') }, 'Accept their answer'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => decide(c, 'drop') }, 'Drop question'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => decide(c, 'reject') }, 'Reject')) : null)))
        : h('div', { class: 'empty' }, 'No challenges have been raised.'));
  };
  await render();
}

// ------------------------------------------------------------------ audit
async function auditTab(box) {
  const { audit } = await get('/admin/audit');
  mount(box, h('h2', null, 'Audit log'), h('p', { class: 'muted' }, 'The last 100 administrative actions.'),
    table(['When', 'Who', 'Action', 'Detail'], audit.map((a) => h('tr', null, h('td', { class: 'nowrap' }, fmtDateTime(a.at)), h('td', null, a.by), h('td', null, h('code', null, a.action)), h('td', { class: 'muted' }, a.detail))), 'No actions recorded yet.'));
}


// ------------------------------------------------------------------ account
function passwordDialog(onDone) {
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', autofocus: true });
  const nxt = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const m = modal({
    title: 'Change your password',
    body: h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', null, 'Current password'), cur), h('div', { class: 'field' }, h('label', null, 'New password (8 characters or more)'), nxt), err),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Later'), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try { await post('/auth/change-password', { current: cur.value, next: nxt.value }); m.close(); toast('Password changed.', 'ok'); onDone(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    } }, 'Change password')],
  });
}

const TAB_FN = { live: liveTab, exams: examsTab, candidates: candidatesTab, announcements: announcementsTab, challenges: challengesTab, audit: auditTab };

export async function adminView({ root, params, user }) {
  document.title = 'Control room | Pariksha';
  const tab = TAB_FN[params[0]] ? params[0] : 'live';
  let cleanup = null;
  const box = h('section', { class: 'admin-body stack' }, spinner('Loading'));
  mount(root, appHeader(user, { home: '#/admin' }), h('main', { class: 'page admin', id: 'main' },
    user.mustChangePassword ? h('div', { class: 'form-notice' }, 'You are still using the default admin password. ', h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => passwordDialog(() => { store.user.mustChangePassword = false; location.reload(); }) }, 'Change it now')) : null,
    h('div', { class: 'page-head' }, h('h1', null, 'Control room'), h('p', { class: 'muted' }, 'Run exams, watch them live, publish results and settle challenges.')),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(([k, l]) => h('a', { class: 'tab', href: `#/admin/${k}`, 'aria-current': k === tab ? 'page' : null }, l))),
    box));
  try {
    await TAB_FN[tab](box, (fn) => { cleanup = fn; });
  } catch (e) {
    showError(e);
    mount(box, h('div', { class: 'empty' }, h('strong', null, 'This section did not load'), h('p', null, e.message)));
  }
  return () => cleanup?.();
}

import { h, mount, spinner, modal, toast, rich, brand, initials, fmtClock, fmtMarks, tile, STATUS_LABEL } from '../dom.js';
import { del, get, post, put } from '../api.js';
import { navigate } from '../store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minus = (n) => `−${Math.abs(n)}`;
const hasAnswer = (a) => a !== null && a !== undefined && a !== '' && !(Array.isArray(a) && a.length === 0);
const cleanNum = (s) => (typeof s === 'string' && /\d/.test(s) ? s : null);
const TYPE_LABEL = { MCQ: 'One correct option', MSQ: 'One or more correct options', NUMERICAL: 'Numerical value' };
const ORDER = ['notvisited', 'unanswered', 'answered', 'marked', 'answeredmarked'];

export async function examView({ root, params }) {
  const [attemptId] = params;
  document.title = 'Exam in progress | Pariksha';
  mount(root, spinner('Opening your paper'));

  let data;
  try {
    data = await get(`/attempts/${attemptId}`);
  } catch (e) {
    toast(e.message, 'error');
    navigate('#/dashboard');
    return;
  }
  if (data.attempt.status === 'submitted') {
    navigate(`#/result/${attemptId}`);
    return;
  }

  const { paper, exam, candidate } = data;
  const responses = data.responses || {};
  const flat = paper.sections.flatMap((section, si) => section.questions.map((q, qi) => ({ q, si, qi, section })));
  const byId = new Map(flat.map((f) => [f.q.id, f.q]));
  const lastPos = {};
  const bookmarkedIds = new Set(data.bookmarkedQuestionIds || []);

  let pos = 0;
  let enteredAt = performance.now();
  let remainingAtSync = data.attempt.remainingMs;
  let syncPerf = performance.now();
  let violations = data.attempt.violations || 0;
  let alive = true;
  let finishing = false;
  let numericCommit = null;
  let gateEl = null;

  // ------------------------------------------------------------ lifecycle bookkeeping
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const every = (fn, ms) => {
    const t = setInterval(fn, ms);
    cleanups.push(() => clearInterval(t));
  };

  const resp = (qid) => (responses[qid] ||= { a: null, m: false, v: false, t: 0 });
  const present = (q, r) => (q.type === 'NUMERICAL' ? cleanNum(r.a) !== null : hasAnswer(r.a));
  function statusOf(q) {
    const r = responses[q.id];
    if (!r || !r.v) return 'notvisited';
    const has = present(q, r);
    if (r.m) return has ? 'answeredmarked' : 'marked';
    return has ? 'answered' : 'unanswered';
  }
  const countsFor = (section) => {
    const c = Object.fromEntries(ORDER.map((k) => [k, 0]));
    for (const q of section.questions) c[statusOf(q)]++;
    return c;
  };

  // ------------------------------------------------------------ clock
  const remaining = () => Math.max(0, remainingAtSync - (performance.now() - syncPerf));
  const syncClock = (ms) => {
    if (Number.isFinite(ms)) {
      remainingAtSync = ms;
      syncPerf = performance.now();
    }
  };
  const total = exam.durationMin * 60000;
  const lowAt = Math.min(10 * 60000, total * 0.2);
  const criticalAt = Math.min(60000, total * 0.1);

  // ------------------------------------------------------------ autosave queue
  const pending = new Map();
  let inFlight = false;
  let flushTimer = null;
  let retryTimer = null;
  let failures = 0;
  let saveState = 'saved';

  const saveLabel = { saved: 'All answers saved', saving: 'Saving', offline: 'Offline. Retrying, your answers are kept on this page.' };
  const saveEl = h('span', { class: 'save-state', dataset: { state: 'saved' }, role: 'status' }, saveLabel.saved);
  function setSaveState(s) {
    if (s === saveState) return;
    saveState = s;
    saveEl.dataset.state = s;
    saveEl.textContent = saveLabel[s];
  }

  function queue(qid, patch) {
    const p = pending.get(qid) || { t: 0 };
    for (const k of ['a', 'm', 'v']) if (k in patch) p[k] = patch[k];
    if (patch.t) p.t += patch.t;
    pending.set(qid, p);
    setSaveState('saving');
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 150);
  }

  function mergeBack(qid, p) {
    const cur = pending.get(qid);
    if (!cur) return void pending.set(qid, p);
    for (const k of ['a', 'm', 'v']) if (k in p && !(k in cur)) cur[k] = p[k];
    cur.t += p.t || 0;
  }

  async function flush() {
    if (inFlight || !alive) return;
    if (!pending.size) return setSaveState('saved');
    inFlight = true;
    const batch = [...pending.entries()];
    pending.clear();
    for (let i = 0; i < batch.length; i++) {
      const [qid, p] = batch[i];
      const body = {};
      if ('a' in p) body.a = p.a;
      if ('m' in p) body.m = p.m;
      if (p.v) body.v = true;
      if (p.t) body.t = p.t;
      try {
        const r = await put(`/attempts/${attemptId}/responses/${qid}`, body);
        syncClock(r.remainingMs);
        failures = 0;
      } catch (e) {
        if (e.code === 'time_over') {
          inFlight = false;
          return timeIsOver();
        }
        if (e.status === 400 || e.status === 404) continue; // rejected for good, do not retry
        if (e.status === 401) {
          inFlight = false;
          return; // the app returns to the sign-in screen
        }
        for (const [q2, p2] of batch.slice(i)) mergeBack(q2, p2);
        failures++;
        inFlight = false;
        setSaveState('offline');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, Math.min(10000, 2000 * failures));
        return;
      }
    }
    inFlight = false;
    if (pending.size) flush();
    else setSaveState('saved');
  }

  async function flushAll(limitMs = 6000) {
    const until = Date.now() + limitMs;
    while ((pending.size || inFlight) && Date.now() < until) {
      if (!inFlight) await flush();
      else await sleep(80);
      if (saveState === 'offline' && failures > 1) break;
    }
  }

  // ------------------------------------------------------------ DOM skeleton
  const timerValue = h('span', { class: 'timer-value' }, fmtClock(remaining()));
  const timerEl = h('div', { class: 'timer', role: 'timer', dataset: { level: 'ok' }, 'aria-label': 'Time left' }, h('span', { class: 'timer-label' }, 'Time left'), timerValue);
  const warnChip = h('span', { class: 'chip chip-danger', hidden: true });
  const tabsEl = h('nav', { class: 'exam-tabs', role: 'tablist', 'aria-label': 'Sections' });
  const qPanel = h('main', { class: 'q-panel', id: 'main', tabindex: '-1', 'aria-live': 'off' });
  const side = h('aside', { class: 'side', 'aria-label': 'Question palette' });
  const sideScrim = h('div', { class: 'side-scrim', onclick: () => closeDrawer() });
  const btnBack = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => goTo(pos - 1) }, 'Back');
  const btnNext = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => goTo(pos + 1) }, 'Next');
  const btnBookmark = h('button', { class: 'btn btn-ghost bookmark-button', type: 'button' }, 'Bookmark question');

  async function toggleBookmark() {
    const qid = flat[pos].q.id;
    btnBookmark.disabled = true;
    try {
      if (bookmarkedIds.has(qid)) {
        await del(`/attempts/${attemptId}/bookmarks/${qid}`);
        bookmarkedIds.delete(qid);
        toast('Question removed from bookmarks.');
      } else {
        await put(`/attempts/${attemptId}/bookmarks/${qid}`);
        bookmarkedIds.add(qid);
        toast('Question saved for review.');
      }
      refreshBookmark();
    } catch (e) {
      toast(e.message || 'Could not update bookmark.', 'error');
    } finally {
      btnBookmark.disabled = false;
    }
  }

  function refreshBookmark() {
    const bookmarked = bookmarkedIds.has(flat[pos]?.q.id);
    btnBookmark.classList.toggle('is-bookmarked', bookmarked);
    btnBookmark.setAttribute('aria-pressed', String(bookmarked));
    btnBookmark.textContent = bookmarked ? 'Bookmarked' : 'Bookmark question';
  }
  btnBookmark.addEventListener('click', toggleBookmark);

  const toggle = h('button', { class: 'btn btn-ghost btn-sm palette-toggle', type: 'button', 'aria-expanded': 'false', onclick: () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    sideScrim.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  } }, 'Palette');
  function closeDrawer() {
    side.classList.remove('open');
    sideScrim.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  mount(
    root,
    h(
      'div',
      { class: 'exam' },
      h('header', { class: 'exam-top' }, brand('#/exam/' + attemptId), h('div', { class: 'exam-title' }, h('strong', null, exam.title), h('span', null, exam.code || 'Computer-based test')), warnChip, saveEl, timerEl, toggle),
      tabsEl,
      h('div', { class: 'exam-body' }, qPanel, side),
      h(
        'footer',
        { class: 'exam-foot' },
        h('div', { class: 'foot-group' }, btnBookmark, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => markAndNext() }, 'Mark for review & next'), h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => clearResponse() }, 'Clear response')),
        h('div', { class: 'foot-group' }, btnBack, btnNext, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => saveAndNext() }, 'Save & next')),
      ),
      sideScrim,
    ),
  );
  // The brand link is just decoration during the exam.
  root.querySelector('.exam-top .brand').addEventListener('click', (e) => e.preventDefault());

  // ------------------------------------------------------------ rendering
  function renderTabs() {
    const cur = flat[pos].si;
    tabsEl.replaceChildren(
      ...paper.sections.map((s, si) => {
        const c = countsFor(s);
        const done = c.answered + c.answeredmarked;
        return h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(si === cur), onclick: () => {
          const target = lastPos[si] ?? flat.findIndex((f) => f.si === si);
          goTo(target);
        } }, s.name, h('small', null, `${done}/${s.questions.length}`));
      }),
    );
  }

  function renderSide() {
    const { section, si } = flat[pos];
    const c = countsFor(section);
    const tiles = flat
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.si === si)
      .map(({ f, i }) =>
        h('button', { class: 'tile', type: 'button', dataset: { status: statusOf(f.q) }, 'aria-current': String(i === pos), 'aria-label': `Question ${f.q.no}, ${STATUS_LABEL[statusOf(f.q)].toLowerCase()}`, onclick: () => goTo(i) }, String(f.q.no)),
      );
    side.replaceChildren(
      h('div', { class: 'side-cand' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(candidate.name)), h('div', null, h('strong', null, candidate.name), h('span', { class: 'muted small' }, candidate.rollNo || candidate.applicationNo))),
      h('div', { class: 'side-legend' }, ORDER.map((k) => h('div', { class: 'lg' }, tile(k, ''), h('span', null, h('b', null, c[k]), ' ', STATUS_LABEL[k])))),
      h('section', null, h('h3', null, section.name), h('div', { class: 'palette' }, tiles)),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openSubmit() }, 'Submit exam'),
    );
  }

  function renderFoot() {
    btnBack.disabled = pos === 0;
    btnNext.disabled = pos === flat.length - 1;
  }

  const refresh = () => {
    renderTabs();
    renderSide();
    renderFoot();
  };

  function setAnswer(q, a) {
    const r = resp(q.id);
    r.a = a;
    r.v = true;
    queue(q.id, { a: q.type === 'NUMERICAL' ? cleanNum(a) : a, v: true });
    refresh();
  }

  function renderQuestion() {
    const { q, section, qi } = flat[pos];
    const r = resp(q.id);
    numericCommit = null;

    const marks = [h('span', { class: 'chip chip-ok' }, `Correct +${fmtMarks(q.marks.correct)}`), q.marks.wrong < 0 ? h('span', { class: 'chip chip-danger' }, `Wrong ${minus(q.marks.wrong)}`) : h('span', { class: 'chip' }, 'No negative marking')];
    let answer;

    if (q.type === 'NUMERICAL') {
      const input = h('input', { class: 'numeric', id: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', maxlength: '12', value: r.a ?? '' });
      let lastGood = input.value;
      let t = null;
      const commit = () => {
        clearTimeout(t);
        t = null;
        const clean = cleanNum(input.value);
        const had = cleanNum(r.a);
        r.a = input.value === '' ? null : input.value;
        if (clean !== had || pending.size === 0) queue(q.id, { a: clean, v: true });
      };
      numericCommit = () => {
        if (t) commit();
      };
      input.addEventListener('input', () => {
        if (!/^-?\d*\.?\d*$/.test(input.value)) {
          input.value = lastGood;
          return;
        }
        lastGood = input.value;
        r.a = input.value === '' ? null : input.value;
        r.v = true;
        renderSide();
        renderTabs();
        clearTimeout(t);
        t = setTimeout(commit, 500);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveAndNext();
        }
      });
      const key = (label, fn, cls = '') => h('button', { class: `key ${cls}`, type: 'button', onclick: () => { fn(); input.dispatchEvent(new Event('input')); input.focus(); } }, label);
      const keypad = h(
        'div',
        { class: 'keypad', role: 'group', 'aria-label': 'On-screen keypad' },
        ...['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) => key(d, () => (input.value += d))),
        key('.', () => { if (!input.value.includes('.')) input.value += input.value === '' || input.value === '-' ? '0.' : '.'; }),
        key('0', () => (input.value += '0')),
        key('−/+', () => (input.value = input.value.startsWith('-') ? input.value.slice(1) : '-' + input.value)),
        key('Delete last', () => (input.value = input.value.slice(0, -1))),
        key('Clear', () => (input.value = ''), 'key-wide'),
      );
      answer = h('div', { class: 'numeric-wrap' }, h('div', null, h('label', { for: 'num' }, 'Your answer'), input, h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Type the value or use the keypad. Round only if the question asks you to.')), keypad);
      queueMicrotask(() => input.focus({ preventScroll: true }));
    } else {
      const multi = q.type === 'MSQ';
      const picked = new Set(multi ? r.a || [] : r.a ? [r.a] : []);
      const labels = q.options.map((o) => {
        const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'opt', value: o.id, checked: picked.has(o.id) });
        const label = h('label', { class: 'opt', dataset: { selected: String(picked.has(o.id)), multi: String(multi) } }, input, h('span', { class: 'letter', 'aria-hidden': 'true' }, o.id.toUpperCase()), h('span', null, rich(o.text)));
        input.addEventListener('change', () => {
          if (multi) {
            const now = labels.filter((l) => l.querySelector('input').checked).map((l) => l.querySelector('input').value);
            labels.forEach((l) => (l.dataset.selected = String(l.querySelector('input').checked)));
            setAnswer(q, now.length ? now : null);
          } else {
            labels.forEach((l) => (l.dataset.selected = String(l.querySelector('input').checked)));
            setAnswer(q, o.id);
          }
        });
        return label;
      });
      answer = h('fieldset', { class: 'opts' }, h('legend', { class: 'sr-only' }, multi ? 'Choose all options that apply' : 'Choose one option'), labels);
    }

    qPanel.replaceChildren(
      h('div', { class: 'q-head' }, h('div', null, h('h2', null, `Question ${q.no}`), h('p', { class: 'muted small' }, `${section.name}, ${qi + 1} of ${section.questions.length}. ${TYPE_LABEL[q.type]}.`)), h('div', { class: 'q-chips' }, marks)),
      h('p', { class: 'q-text' }, rich(q.text)),
      answer,
      h('p', { class: 'shortcuts' }, q.type === 'NUMERICAL' ? 'Press Enter to save and go to the next question.' : 'Shortcuts: 1 to ' + q.options.length + ' choose an option, N save and next, M mark for review, X clear, arrow keys move between questions.'),
    );
    qPanel.scrollTop = 0;
  }

  // ------------------------------------------------------------ navigation and actions
  function leaveQuestion() {
    numericCommit?.();
    const q = flat[pos].q;
    const dt = Math.round(performance.now() - enteredAt);
    if (dt > 0) {
      resp(q.id).t += dt;
      queue(q.id, { t: dt });
    }
    enteredAt = performance.now();
  }

  function enter() {
    const q = flat[pos].q;
    lastPos[flat[pos].si] = pos;
    const r = resp(q.id);
    if (!r.v) {
      r.v = true;
      queue(q.id, { v: true });
    }
    enteredAt = performance.now();
    renderQuestion();
    refresh();
    refreshBookmark();
    closeDrawer();
  }

  function goTo(np) {
    if (np < 0 || np >= flat.length || finishing) return;
    leaveQuestion();
    pos = np;
    enter();
  }

  function forward() {
    if (pos < flat.length - 1) goTo(pos + 1);
    else {
      leaveQuestion();
      refresh();
      toast('That was the last question. Review the palette, then submit when you are ready.');
    }
  }

  function saveAndNext() {
    const q = flat[pos].q;
    const r = resp(q.id);
    numericCommit?.();
    if (r.m) {
      r.m = false;
      queue(q.id, { m: false });
    }
    forward();
  }

  function markAndNext() {
    const q = flat[pos].q;
    const r = resp(q.id);
    numericCommit?.();
    r.m = true;
    queue(q.id, { m: true });
    forward();
  }

  function clearResponse() {
    const q = flat[pos].q;
    const r = resp(q.id);
    r.a = null;
    r.m = false;
    queue(q.id, { a: null, m: false });
    renderQuestion();
    refresh();
  }

  // ------------------------------------------------------------ gate (full-screen and warnings)
  function showGate({ title, message, button, onClick }) {
    hideGate();
    gateEl = h(
      'div',
      { class: 'gate', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-t' },
      h('div', { class: 'gate-box' }, h('h2', { id: 'gate-t' }, title), h('p', { class: 'muted' }, message), h('div', null, h('button', { class: 'btn btn-primary', type: 'button', onclick: onClick }, button))),
    );
    document.body.append(gateEl);
    gateEl.querySelector('button').focus();
  }
  function hideGate() {
    gateEl?.remove();
    gateEl = null;
  }

  const fsSupported = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
  let wasFull = !!document.fullscreenElement;
  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      toast('Your browser would not enter full-screen. You can continue, but keep this tab in front.', 'warn');
      hideGate();
    }
  };

  async function recordEvent(type) {
    if (finishing || !alive) return;
    try {
      const r = await post(`/attempts/${attemptId}/events`, { type });
      violations = r.violations ?? violations;
      updateWarn();
      if (r.autoSubmitted) {
        toast('Your paper was submitted because the warning limit was reached.', 'warn', 8000);
        finishing = true;
        navigate(`#/result/${attemptId}`);
      }
    } catch {
      /* the event is advisory; a lost one is not worth interrupting the exam */
    }
  }

  function updateWarn() {
    warnChip.hidden = violations === 0;
    warnChip.textContent = exam.maxViolations ? `Warnings ${violations} of ${exam.maxViolations}` : `Warnings ${violations}`;
  }

  const warnText = () =>
    exam.maxViolations ? ` You have ${Math.max(0, exam.maxViolations - violations)} warning${exam.maxViolations - violations === 1 ? '' : 's'} left before your paper is submitted automatically.` : ' This has been recorded for the invigilator.';

  on(document, 'fullscreenchange', () => {
    if (document.fullscreenElement) {
      wasFull = true;
      hideGate();
    } else if (wasFull && !finishing) {
      recordEvent('fullscreen_exit');
      showGate({ title: 'You left full-screen', message: 'Return to full-screen to keep going. The timer is still running.' + warnText(), button: 'Return to full-screen', onClick: enterFullscreen });
    }
  });
  on(document, 'visibilitychange', () => {
    if (document.hidden && !finishing) {
      recordEvent('tab_hidden');
      flush();
    } else if (!document.hidden && !finishing) {
      toast('Leaving the exam tab is recorded.' + warnText(), 'warn', 5000);
    }
  });
  for (const type of ['copy', 'cut', 'contextmenu']) on(qPanel, type, (e) => e.preventDefault());
  on(window, 'online', () => flush());
  window.onbeforeunload = (e) => {
    if (finishing) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  };
  cleanups.push(() => (window.onbeforeunload = null));

  // ------------------------------------------------------------ submit
  function openSubmit() {
    leaveQuestion();
    flush();
    const rows = paper.sections.map((s) => {
      const c = countsFor(s);
      return h('tr', null, h('td', null, s.name), h('td', null, c.answered + c.answeredmarked), h('td', null, c.unanswered), h('td', null, c.marked), h('td', null, c.notvisited));
    });
    const unanswered = flat.filter(({ q }) => !present(q, resp(q.id))).length;
    const sub = h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: async () => {
      sub.disabled = true;
      sub.textContent = 'Submitting';
      const ok = await submitFinal();
      if (!ok) {
        sub.disabled = false;
        sub.textContent = 'Submit exam';
      } else m.close('done');
    } }, 'Submit exam');
    const m = modal({
      title: 'Submit your exam?',
      wide: true,
      body: h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        h('p', { class: 'muted' }, unanswered ? `${unanswered} question${unanswered === 1 ? ' has' : 's have'} no answer. You cannot return to the paper after you submit.` : 'Every question has an answer. You cannot return to the paper after you submit.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table summary' }, h('thead', null, h('tr', null, h('th', null, 'Section'), h('th', null, 'Answered'), h('th', null, 'Not answered'), h('th', null, 'Marked only'), h('th', null, 'Not visited'))), h('tbody', null, rows))),
      ),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close('back') }, 'Back to exam'), sub],
    });
  }

  async function submitFinal() {
    finishing = true;
    await flushAll();
    try {
      await post(`/attempts/${attemptId}/submit`);
    } catch (e) {
      if (e.status !== 409) {
        finishing = false;
        toast(e.message, 'error');
        return false;
      }
    }
    leaveToResult();
    return true;
  }

  function leaveToResult() {
    finishing = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    navigate(`#/result/${attemptId}`);
  }

  async function timeIsOver() {
    if (finishing && !alive) return;
    finishing = true;
    hideGate();
    toast('Time is up. Your paper has been submitted.', 'warn', 6000);
    for (let i = 0; i < 4; i++) {
      try {
        await post(`/attempts/${attemptId}/submit`);
        break;
      } catch (e) {
        if (e.status === 409 || e.status === 404) break;
        await sleep(1500);
      }
    }
    leaveToResult();
  }

  // ------------------------------------------------------------ timer, heartbeat, keyboard
  let lastSec = -1;
  const warned = { low: false, critical: false };
  function tick() {
    const rem = remaining();
    const sec = Math.ceil(rem / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      timerValue.textContent = fmtClock(rem);
      const level = rem <= criticalAt ? 'critical' : rem <= lowAt ? 'low' : 'ok';
      if (timerEl.dataset.level !== level) timerEl.dataset.level = level;
      if (level === 'low' && !warned.low) {
        warned.low = true;
        toast(`${Math.ceil(rem / 60000)} minutes left.`, 'warn');
      }
      if (level === 'critical' && !warned.critical) {
        warned.critical = true;
        toast('One minute left. Your paper submits automatically at zero.', 'warn', 6000);
      }
    }
    if (rem <= 0 && !finishing) timeIsOver();
  }
  every(tick, 250);

  every(async () => {
    if (finishing) return;
    try {
      const r = await post(`/attempts/${attemptId}/heartbeat`);
      if (r.status === 'submitted') return leaveToResult();
      syncClock(r.remainingMs);
    } catch {
      /* offline: the local clock keeps running and the queue retries on its own */
    }
  }, 15000);

  on(document, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || finishing || gateEl || document.querySelector('.scrim')) return;
    const t = e.target;
    if ((t.tagName === 'INPUT' && t.type === 'text') || t.tagName === 'TEXTAREA') return;
    const { q } = flat[pos];
    const k = e.key.toLowerCase();
    const n = '123456'.indexOf(k);
    if (q.options && n >= 0 && n < q.options.length) {
      e.preventDefault();
      const id = q.options[n].id;
      const r = resp(q.id);
      if (q.type === 'MSQ') {
        const set = new Set(r.a || []);
        set.has(id) ? set.delete(id) : set.add(id);
        setAnswer(q, set.size ? [...set].sort() : null);
      } else setAnswer(q, id);
      renderQuestion();
    } else if (k === 'n') saveAndNext();
    else if (k === 'm') markAndNext();
    else if (k === 'x') clearResponse();
    else if (e.key === 'ArrowRight') goTo(pos + 1);
    else if (e.key === 'ArrowLeft') goTo(pos - 1);
  });

  // ------------------------------------------------------------ go
  updateWarn();
  enter();
  if (fsSupported && !document.fullscreenElement) {
    showGate({
      title: 'Enter full-screen to continue',
      message: 'The exam runs in full-screen so nothing else is in view. Your timer is already running.',
      button: 'Enter full-screen',
      onClick: enterFullscreen,
    });
  }

  return () => {
    alive = false;
    clearTimeout(flushTimer);
    clearTimeout(retryTimer);
    cleanups.forEach((fn) => fn());
    hideGate();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
}


import { h, svg, mount, spinner, modal, firstName, fmtDate, fmtDateTime, fmtDuration } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, showError } from './shell.js';

function windowChip(e) {
  if (e.windowState === 'upcoming') {
    return h('span', { class: 'chip chip-warn' }, `Opens ${fmtDateTime(e.window.start)}`);
  }

  if (e.windowState === 'closed') {
    return h('span', { class: 'chip chip-danger' }, 'Closed');
  }

  return h('span', { class: 'chip' }, `Open until ${fmtDate(e.window.end)}`);
}


// --- SVG Barcode Generator ---
function barcodeSvg(code) {
  const str = String(code || '261000000001');
  const bars = [];
  let x = 12;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const w1 = (c % 3) + 1;
    const w2 = ((c >> 1) % 2) + 1;
    const w3 = ((c >> 2) % 3) + 1;
    bars.push(svg('rect', { x, y: 2, width: w1, height: 34, fill: '#163d72' }));
    x += w1 + 2;
    bars.push(svg('rect', { x, y: 2, width: w2, height: 34, fill: '#163d72' }));
    x += w2 + 1;
    bars.push(svg('rect', { x, y: 2, width: w3, height: 34, fill: '#163d72' }));
    x += w3 + 2;
  }
  return svg('svg', { viewBox: `0 0 ${x + 12} 52`, width: '100%', height: '48', 'aria-hidden': 'true' },
    ...bars,
    svg('text', { x: (x + 12) / 2, y: 48, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'monospace', 'font-weight': 'bold', fill: '#163d72' }, str)
  );
}

// --- Official Admit Card Generator ---
export function createAdmitCardElement(user, e) {
  const row = (label, value) =>
    h('div', { class: 'admit-detail' },
      h('span', null, label),
      h('strong', null, value || 'Not assigned')
    );

  const rollNumber = user.rollNo || `26${(user.centre || 'DL01').slice(0, 4).toUpperCase()}${(user.applicationNo || '100001').slice(-6)}`;
  const examDate = fmtDate(e.window.start);
  const startTime = new Date(e.window.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const reportingTime = new Date(e.window.start - 90 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const gateClosingTime = new Date(e.window.start - 30 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const photo = h(
    'div',
    { class: 'admit-photo', style: { overflow: 'hidden', padding: 0 } },
    user.photoURL
      ? h('img', { src: user.photoURL, alt: user.name, style: { width: '100%', height: '100%', objectFit: 'cover' } })
      : h('div', { style: { display: 'grid', placeContent: 'center', height: '100%', textAlign: 'center', padding: '6px' } },
          h('strong', null, 'CANDIDATE PHOTO'),
          h('span', { class: 'muted small' }, 'Affix passport photo')
        )
  );

  const barcodeBox = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #cbdcf1', background: '#f8fafc', padding: '6px' } },
    barcodeSvg(user.applicationNo || rollNumber)
  );

  return h(
    'article',
    { class: 'admit-print-card' },

    h('div', { class: 'admit-topline' },
      h('span', null, 'NATIONAL TESTING PORTAL · COMPUTER BASED TEST (CBT)'),
      h('span', null, 'PROVISIONAL ADMIT CARD')
    ),

    h('header', { class: 'admit-heading' },
      h('div', { class: 'admit-brand-mark' }, 'P'),
      h('div', null,
        h('h1', null, 'PARIKSHA PORTAL'),
        h('p', null, 'Ministry of Education · Government of India'),
        h('strong', null, 'ADMIT CARD / HALL TICKET')
      )
    ),

    h('div', { class: 'admit-exam-title' },
      h('span', null, e.code ? `EXAM CODE: ${e.code}` : 'OFFICIAL EXAMINATION'),
      h('h2', null, e.title),
      h('p', null, `Computer Based Examination · Duration: ${fmtDuration(e.durationMin)}`)
    ),

    h('div', { class: 'admit-body' },

      h('section', { class: 'admit-candidate' },
        h('div', { class: 'admit-grid' },
          row('Candidate Name', user.name),
          row('Application Number', user.applicationNo),
          row('Roll Number', rollNumber),
          row('Examination Centre', user.centre || 'National CBT Test Centre - Lab 1'),
          row('Date of Examination', examDate),
          row('Shift / Exam Time', `${startTime} (${fmtDuration(e.durationMin)})`),
          row('Reporting Time', reportingTime),
          row('Gate Closing Time', gateClosingTime)
        ),
        h('div', { class: 'admit-photo-area' },
          photo,
          barcodeBox
        )
      ),

      h('section', { class: 'admit-section' },
        h('h3', null, 'CANDIDATE UNDERTAKING & SELF DECLARATION'),
        h('p', { class: 'muted small', style: { margin: '0 0 10px', fontSize: '11px', lineHeight: '1.5' } },
          'I hereby declare that I am the genuine candidate appearing for this examination. All details provided are true and verified. I have read and agree to comply with all examination regulations.'
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', paddingTop: '6px' } },
          h('div', { style: { border: '1px dashed #94a3b8', height: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '6px', textAlign: 'center', fontSize: '10px', color: '#64748b' } },
            'Candidate Left Thumb Impression (Before reaching centre)'
          ),
          h('div', { style: { border: '1px dashed #94a3b8', height: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '6px', textAlign: 'center', fontSize: '10px', color: '#64748b' } },
            'Candidate Signature (In presence of Invigilator)'
          ),
          h('div', { style: { border: '1px dashed #94a3b8', height: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '6px', textAlign: 'center', fontSize: '10px', color: '#64748b' } },
            'Invigilator Signature (Verified & Attested)'
          )
        )
      ),

      h('section', { class: 'admit-section' },
        h('h3', null, 'IMPORTANT INSTRUCTIONS FOR CANDIDATES'),
        h('ol', { class: 'admit-instructions' },
          h('li', null, 'Candidates must report at the examination centre strictly at the designated Reporting Time. No entry is permitted after Gate Closing Time.'),
          h('li', null, 'Bring a clear printed copy of this Admit Card along with an original valid Government Photo ID (Aadhaar, Passport, PAN Card, Voter ID, or Driving License).'),
          h('li', null, 'Mobile phones, smartwatches, bluetooth devices, calculators, and personal papers are strictly prohibited inside the examination hall.'),
          h('li', null, 'Rough sheets and pen will be provided at the centre. All rough sheets must be deposited in the drop-box before leaving.')
        )
      ),

      h('footer', { class: 'admit-footer' },
        h('strong', null, 'SECURITY NOTICE:'),
        h('p', null,
          'This Admit Card is electronically generated and tamper-evident. Falsification, impersonation, or tampering is a punishable offence under the Public Examinations Act.'
        )
      )
    )
  );
}

function admitCard(user, e) {
  const card = createAdmitCardElement(user, e);

  const m = modal({
    title: 'Examination Admit Card',
    body: card,
    wide: true,
    actions: [
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: () => m.close()
      }, 'Close'),

      h('a', {
        class: 'btn btn-ghost',
        href: `#/admit-card/${e.id}`,
        target: '_blank'
      }, 'Open Full Page'),

      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          const restore = () => {
            document.body.classList.remove('admit-print-mode');
          };
          document.body.classList.add('admit-print-mode');
          window.addEventListener('afterprint', restore, { once: true });
          window.print();
        }
      }, 'Print / Save PDF')
    ]
  });
}


function examRow(user, e) {
  const live = e.status === 'in_progress';
  const submitted = e.status === 'submitted';
  const actions = [];

 actions.push(
  h(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: () => admitCard(user, e)
    },
    'Admit card'
  )
);

  if (live) {
    actions.push(
      h(
        'a',
        {
          class: 'btn btn-primary',
          href: `#/exam/${e.attemptId}`
        },
        'Resume exam'
      )
    );
  } else if (submitted) {

    if (e.resultsPublished) {
      actions.push(
        h(
          'a',
          {
            class: 'btn btn-ghost',
            href: `#/result/${e.attemptId}`
          },
          'View result'
        )
      );
    } else {
      actions.push(
        h(
          'span',
          {
            class: 'chip chip-lilac'
          },
          'Result not published yet'
        )
      );
    }

    // Reattempt is allowed only while the exam window is open.
    if (e.windowState === 'open') {
      actions.push(
        h(
          'a',
          {
            class: 'btn btn-primary',
            href: `#/instructions/${e.id}`
          },
          'Reattempt exam'
        )
      );
    } else if (e.windowState === 'upcoming') {
      actions.push(
        h('span', { class: 'chip chip-warn' }, `Reattempt opens ${fmtDateTime(e.window.start)}`)
      );
    } else {
      actions.push(
        h('span', { class: 'chip chip-danger' }, 'Reattempt unavailable')
      );
    }

  } else if (e.windowState === 'open') {
    actions.push(
      h(
        'a',
        {
          class: 'btn btn-primary',
          href: `#/instructions/${e.id}`
        },
        'Start exam'
      )
    );
  }

  return h(
    'article',
    {
      class: 'exam-row',
      dataset: {
        live: String(live)
      }
    },
    h(
      'div',
      null,
      h('h3', null, e.title),

      e.description
        ? h('p', { class: 'muted', style: { marginTop: '6px' } }, e.description)
        : null,

      h(
        'div',
        { class: 'exam-meta' },

        live
          ? h('span', { class: 'chip chip-warn' }, 'In progress')
          : null,

        submitted
          ? h('span', { class: 'chip chip-ok' }, 'Submitted')
          : null,

        h('span', { class: 'chip' }, fmtDuration(e.durationMin)),
        h('span', { class: 'chip' }, `${e.questionCount} questions`),
        h('span', { class: 'chip' }, `${e.maxMarks} marks`),

        !live && !submitted
          ? windowChip(e)
          : null
      )
    ),

    h('div', { class: 'exam-actions' }, actions)
  );
}

function relativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(ms);
}

function dayLabel(timestamp) {
  if (!timestamp) return 'recently';

  return new Date(timestamp).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// ----------------------------------------------------------------
// Streak card
// ----------------------------------------------------------------

function streakCardFor(streak) {
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build a date→active map from the backend's week array.
  const activeByDate = new Map();
  if (streak.week) {
    for (const w of streak.week) activeByDate.set(w.date, w.active);
  }

  const todayStr = streak.today;

  const orderedWeek = weekDays.map((label) => {
    const todayWday = new Date().getDay(); // 0=Sun .. 6=Sat
    const todayPos = todayWday === 0 ? 6 : todayWday - 1; // position in Mon-Sun array
    const dayOffset = weekDays.indexOf(label) - todayPos;
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const dateStr =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');

    return {
      label,
      date: dateStr,
      active: activeByDate.has(dateStr) ? activeByDate.get(dateStr) : false,
      isToday: dateStr === todayStr,
    };
  });

  const milestone =
    streak.milestone !== null
      ? h('div', { class: 'streak-milestone' },
          h('span', { class: 'streak-milestone-mark' }, '🎉'),
          h('span', null, `${streak.milestone} day streak!`))
      : null;

  const todayStatus = streak.todayActive
    ? h('div', { class: 'streak-today-active' },
        h('span', { class: 'streak-today-mark' }, '✓'),
        h('span', null, "Today's goal completed"))
    : h('div', { class: 'streak-today-inactive' },
        h('span', { class: 'streak-today-mark' }, '○'),
        h('span', null, "Keep your streak alive today"));

  const cta = streak.todayActive
    ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Keep going')
    : h('a', { class: 'btn btn-primary btn-sm', href: '#/practice' }, 'Start Practice');

  return h(
    'section',
    { class: 'streak-card', 'aria-label': 'Study streak' },
    h(
      'div',
      { class: 'streak-head' },
      h('div', { class: 'streak-count' }, `🔥 ${streak.currentStreak}`),
      h('div', { class: 'streak-best' }, `Best: ${streak.longestStreak}`)
    ),
    h('h2', { class: 'streak-title' }, `${streak.currentStreak} Day Streak`),
    milestone,
    h('p', { class: 'streak-copy' }, streak.copy),
    h(
      'div',
      { class: 'streak-week' },
      orderedWeek.map((d) =>
        h('button', {
          class: `streak-day ${d.active ? 'active' : ''} ${d.isToday ? 'today' : ''}`,
          type: 'button',
          'aria-pressed': String(d.active),
          title: `${d.label}: ${d.active ? 'Studied' : 'Not studied'}`,
        },
        h('span', { class: 'streak-day-mark' }, d.active ? '✓' : '○'),
        h('span', { class: 'streak-day-label' }, d.label))
      )
    ),
    todayStatus,
    h('div', { class: 'streak-actions' }, cta)
  );
}

function scrollToExams() {
  const el = document.getElementById('exams-section');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function continueCardFor({ unfinished, completed }) {
  if (unfinished.length) {
    const e = unfinished[0];
    const ip = e.inProgress || {};
    const subjects = (e.sections || []).map((s) => s.name).join(' · ');
    return h(
      'section',
      { class: 'continue-card', 'aria-label': 'Continue your preparation' },
      h(
        'div',
        { class: 'continue-head' },
        h('h2', null, 'Continue your preparation'),
        unfinished.length > 1
          ? h(
              'button',
              {
                class: 'continue-link',
                type: 'button',
                onclick: scrollToExams,
              },
              'View all unfinished exams →'
            )
          : null
      ),
      h('h3', { class: 'continue-title' }, e.title),
      subjects ? h('p', { class: 'muted continue-subjects' }, subjects) : null,
      h(
        'div',
        { class: 'continue-progress-row' },
        h('span', null, `${ip.answeredCount ?? 0} / ${ip.totalQuestions ?? e.questionCount} questions completed`),
        h('span', { class: 'continue-pct' }, `${ip.progress ?? 0}%`)
      ),
      h(
        'div',
        { class: 'progress-track', role: 'progressbar', 'aria-valuenow': String(ip.progress ?? 0), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('span', { class: 'progress-fill', style: { width: `${ip.progress ?? 0}%` } })
      ),
      h('p', { class: 'muted continue-meta' }, `Last active: ${relativeTime(ip.lastActiveAt)}`),
      h(
        'div',
        { class: 'continue-actions' },
        h('a', { class: 'btn btn-primary', href: `#/exam/${ip.attemptId}` }, 'Resume Exam')
      )
    );
  }

  if (completed.length) {
    const e = completed[0];
    const a = e.analysis || {};
    const timeTakenMin =
      a.startedAt && a.submittedAt
        ? Math.max(1, Math.round((a.submittedAt - a.startedAt) / 60000))
        : null;
    return h(
      'section',
      { class: 'continue-card', 'aria-label': 'Your latest attempt' },
      h('h2', null, 'Your latest attempt'),
      h('h3', { class: 'continue-title' }, e.title),
      h(
        'div',
        { class: 'continue-stats' },
        h('div', { class: 'continue-stat' }, h('span', null, 'Score'), h('strong', null, `${a.score ?? 0} / ${a.maxScore ?? e.maxMarks}`)),
        h('div', { class: 'continue-stat' }, h('span', null, 'Accuracy'), h('strong', null, `${a.accuracy ?? 0}%`)),
        h('div', { class: 'continue-stat' }, h('span', null, 'Time taken'), h('strong', null, timeTakenMin ? `${timeTakenMin} min` : '—'))
      ),
      h('p', { class: 'muted continue-meta' }, `Submitted ${dayLabel(a.submittedAt)}`),
      h(
        'div',
        { class: 'continue-actions' },
        h('a', { class: 'btn btn-primary', href: `#/result/${e.attemptId}` }, 'View Analysis')
      )
    );
  }

  return h(
    'section',
    { class: 'continue-card continue-card-empty', 'aria-label': 'Start your preparation' },
    h('h2', null, 'Start your preparation 🚀'),
    h('p', { class: 'muted' }, "You haven't attempted an exam yet. Take your first mock test and start tracking your progress."),
    h(
      'div',
      { class: 'continue-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: scrollToExams }, 'Explore Exams')
    )
  );
}

export async function dashboardView({ root, user }) {
  document.title = 'Your exams | Pariksha';

  mount(
    root,
    appHeader(user),
    h(
      'main',
      { class: 'page' },
      spinner('Loading your progress...')
    )
  );

  let data;
  let streak;

  try {
    const [examsRes, streakRes] = await Promise.all([
      get('/exams'),
      get('/streak').catch(() => null),
    ]);
    data = examsRes;
    streak = streakRes;
  } catch (e) {
    showError(e);

    mount(
      root,
      appHeader(user),
      h(
        'main',
        { class: 'page' },
        h(
          'div',
          { class: 'empty' },
          h('strong', null, 'Your exams did not load'),
          h('p', null, e.message),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => location.reload()
            },
            'Try again'
          )
        )
      )
    );

    return;
  }

  const open = data.exams.filter((e) => e.status !== 'submitted');
  const done = data.exams.filter((e) => e.status === 'submitted');

  const unfinished = data.exams
    .filter((e) => e.status === 'in_progress')
    .sort((a, b) => (b.inProgress?.lastActiveAt || 0) - (a.inProgress?.lastActiveAt || 0));

  const completed = data.exams
    .filter((e) => e.status === 'submitted' && e.analysis)
    .sort((a, b) => (b.analysis?.submittedAt || 0) - (a.analysis?.submittedAt || 0));

  const live = data.exams.find((e) => e.status === 'in_progress');

  mount(
    root,
    appHeader(user),
    h(
      'main',
      { class: 'page', id: 'main' },

      h(
        'div',
        { class: 'page-head' },
        h('h1', null, `Hi, ${firstName(user.name)}.`),
        h(
          'p',
          { class: 'muted' },
          live
            ? 'You have an exam in progress. Pick up where you left off.'
            : open.length
              ? 'Pick an exam when you are ready. The clock starts only after you begin.'
              : 'You have finished every available exam.'
        ),
        h('a', { class: 'btn btn-primary', href: '#/practice' }, 'Practice questions')
      ),

      streak ? streakCardFor(streak) : null,

      continueCardFor({ unfinished, completed }),

      open.length
        ? h(
            'section',
            {
              class: 'exam-list',
              id: 'exams-section',
              'aria-label': 'Available exams'
            },
            open.map((e) => examRow(user, e))
          )
        : h(
            'div',
            { class: 'empty', id: 'exams-section' },
            h('strong', null, 'No exams to take right now'),
            h('p', null, 'New exams appear here when your centre adds them.')
          ),

      done.length
        ? h(
            'section',
            {
              class: 'exam-list',
              'aria-labelledby': 'done-h'
            },
            h('h2', { id: 'done-h' }, 'Finished'),
            done.map((e) => examRow(user, e))
          )
        : null
    )
  );
}

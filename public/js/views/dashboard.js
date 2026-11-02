
import { h, mount, spinner, modal, firstName, fmtDate, fmtDateTime, fmtDuration } from '../dom.js';
import { get } from '../api.js';
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

function admitCard(user, e) {
  const row = (k, v) => [
    h('dt', null, k),
    h('dd', null, v)
  ];

  const m = modal({
    title: 'Admit card',
    body: h(
      'div',
      { class: 'admit' },
      h(
        'dl',
        null,
        row('Candidate', user.name),
        row('Application number', user.applicationNo),
        row('Roll number', user.rollNo || '-'),
        row('Centre', user.centre || '-'),
        row('Exam', e.title),
        row('Duration', fmtDuration(e.durationMin)),
        row('Available', `${fmtDateTime(e.window.start)} to ${fmtDateTime(e.window.end)}`)
      ),
      h(
        'ul',
        {
          class: 'muted small',
          style: {
            margin: 0,
            paddingLeft: '1.1rem',
            display: 'grid',
            gap: '6px'
          }
        },
        h('li', null, 'Sign in with your own application number. Signing in elsewhere ends your current session.'),
        h('li', null, 'Use a laptop or desktop in a quiet room with a stable connection.'),
        h('li', null, 'Keep the exam in full-screen. Leaving it is recorded.')
      )
    ),
    actions: [
      h(
        'button',
        {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: () => m.close()
        },
        'Close'
      ),
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => window.print()
        },
        'Print admit card'
      )
    ]
  });
}

function examRow(user, e) {
  const live = e.status === 'in_progress';
  const submitted = e.status === 'submitted';
  const actions = [];

  if (!submitted) {
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
  }

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

export async function dashboardView({ root, user }) {
  document.title = 'Your exams | Pariksha';

  mount(
    root,
    appHeader(user),
    h(
      'main',
      { class: 'page' },
      spinner('Loading your exams')
    )
  );

  let data;

  try {
    data = await get('/exams');
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
        )
      ),

      open.length
        ? h(
            'section',
            {
              class: 'exam-list',
              'aria-label': 'Available exams'
            },
            open.map((e) => examRow(user, e))
          )
        : h(
            'div',
            { class: 'empty' },
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

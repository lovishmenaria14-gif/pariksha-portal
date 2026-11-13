
import {
  h,
  mount,
  spinner,
  fmtDateTime,
  fmtDuration,
  modal
} from '../dom.js';

import { get } from '../api.js';
import { appHeader, showError } from './shell.js';

const DAY = 24 * 60 * 60 * 1000;

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const validDate = (value) => {
  if (value === null || value === undefined || value === '') return null;

  const timestamp = Number(value);
  const date = new Date(
    Number.isFinite(timestamp) ? timestamp : value
  );

  return Number.isFinite(date.getTime()) ? date : null;
};

const statusLabel = (exam) => {
  if (exam.status === 'in_progress') return 'In progress';
  if (exam.status === 'submitted') return 'Submitted';
  if (exam.windowState === 'upcoming') return 'Upcoming';
  if (exam.windowState === 'closed') return 'Closed';
  return 'Open';
};

const statusClass = (exam) => {
  if (exam.status === 'in_progress') return 'chip-warn';
  if (exam.status === 'submitted') return 'chip-ok';
  if (exam.windowState === 'upcoming') return 'chip-warn';
  if (exam.windowState === 'closed') return 'chip-danger';
  return 'chip-lilac';
};

function examAction(exam) {
  if (exam.status === 'in_progress' && exam.attemptId) {
    return h('a', {
      class: 'btn btn-primary btn-sm',
      href: `#/exam/${encodeURIComponent(exam.attemptId)}`,
    }, 'Resume exam');
  }

  if (exam.status === 'submitted') {
    if (exam.resultsPublished && exam.attemptId) {
      return h('a', {
        class: 'btn btn-ghost btn-sm',
        href: `#/result/${encodeURIComponent(exam.attemptId)}`,
      }, 'View result');
    }

    return h('span', { class: 'muted small' },
      exam.resultsPublished ? 'Result unavailable' : 'Result not published'
    );
  }

  if (exam.windowState === 'open') {
    return h('a', {
      class: 'btn btn-primary btn-sm',
      href: `#/instructions/${encodeURIComponent(exam.id)}`,
    }, 'View instructions');
  }

  return h('span', { class: 'muted small' },
    exam.windowState === 'upcoming' ? 'Not open yet' : 'Unavailable'
  );
}

function examCard(exam) {
  const start = validDate(exam.window?.start);
  const end = validDate(exam.window?.end);

  return h('article', { class: 'calendar-exam-card' },
    h('div', { class: 'calendar-exam-main' },
      h('div', { class: 'calendar-exam-heading' },
        h('div', null,
          h('h3', null, exam.title || 'Untitled examination'),
          h('p', { class: 'muted small' }, exam.code || 'Examination')
        ),
        h('span', {
          class: `chip ${statusClass(exam)}`
        }, statusLabel(exam))
      ),

      h('div', { class: 'calendar-exam-meta' },
        start && end
          ? h('span', null,
              `${fmtDateTime(start.getTime())} – ${fmtDateTime(end.getTime())}`
            )
          : h('span', null, 'Availability dates not provided'),

        h('span', null, fmtDuration(Number(exam.durationMin) || 0)),
        h('span', null, `${exam.questionCount ?? 0} questions`),
        h('span', null, `${exam.maxMarks ?? 0} marks`)
      ),

      exam.description
        ? h('p', {
            class: 'muted calendar-exam-description'
          }, exam.description)
        : null
    ),

    h('div', { class: 'calendar-exam-action' }, examAction(exam))
  );
}

// Opens a popup containing every exam available on the selected date.
function openDayExams(date, exams) {
  const dateLabel = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let dialog;

  dialog = modal({
    title: `Exams — ${dateLabel}`,

    body: h(
      'div',
      { class: 'calendar-day-modal-list' },
      ...exams.map(examCard)
    ),

    wide: true,

    actions: [
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: () => dialog.close()
      }, 'Close')
    ]
  });
}

function buildCalendar(exams, month, year, onMonthChange) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  const todayKey = dateKey(new Date());

  const monthTitle = first.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    const key = dateKey(date);
    const inMonth = date.getMonth() === month;
    const isToday = key === todayKey;

      const matching = exams.filter((exam) => {
      const start = validDate(exam.window?.start);
      const end = validDate(exam.window?.end);

      if (!start || !end) return false;

      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      ).getTime();

      const dayEnd = dayStart + DAY - 1;

      // Prevent multi-day exams (e.g. 1-month or 1-year windows) from repeating every day.
      // They will only appear on their start/opening date.
      const isMultiDay = (end.getTime() - start.getTime()) > (2 * DAY);
      if (isMultiDay) {
        return start.getTime() >= dayStart && start.getTime() <= dayEnd;
      }

      // Single-day / daily exam papers match their specific scheduled date.
      return start.getTime() <= dayEnd && end.getTime() >= dayStart;
    });

    return h('div', {
      class: [
        'calendar-day',
        inMonth ? '' : 'calendar-day-outside',
        isToday ? 'calendar-day-today' : '',
      ].filter(Boolean).join(' '),
    },

      h('span', {
        class: 'calendar-day-number'
      }, String(date.getDate())),

      h('div', { class: 'calendar-day-events' },

        ...matching.slice(0, 2).map((exam) =>
  h('button', {
    class: `calendar-event calendar-event-${exam.status === 'submitted' ? 'submitted' : exam.windowState || 'open'}`,
    type: 'button',
    title: `${exam.title}: availability period`,
    'aria-label': `View details for ${exam.title}`,
    onclick: () => openDayExams(date, [exam]),
  }, exam.title)
),

        matching.length > 2
          ? h('button', {
              class: 'calendar-more',
              type: 'button',
              onclick: () => openDayExams(date, matching)
            }, `+${matching.length - 2} more`)
          : null
      )
    );
  });

  return h('section', {
    class: 'calendar-panel',
    'aria-label': 'Monthly exam availability calendar'
  },

    h('div', { class: 'calendar-toolbar' },
      h('div', null,
        h('h2', null, monthTitle),
        h('p', { class: 'muted small' }, 'Exam availability periods')
      ),

      h('div', { class: 'calendar-controls' },
        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          'aria-label': 'Previous month',
          onclick: () => onMonthChange(-1),
        }, '←'),

        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => onMonthChange(0),
        }, 'Today'),

        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          'aria-label': 'Next month',
          onclick: () => onMonthChange(1),
        }, '→')
      )
    ),

    h('div', { class: 'calendar-grid' },
      ...weekdays.map((day) =>
        h('div', { class: 'calendar-weekday' }, day)
      ),
      ...cells
    ),

    h('div', { class: 'calendar-legend' },
      h('span', null,
        h('i', { class: 'calendar-legend-dot calendar-legend-upcoming' }),
        'Upcoming'
      ),
      h('span', null,
        h('i', { class: 'calendar-legend-dot calendar-legend-open' }),
        'Open'
      ),
      h('span', null,
        h('i', { class: 'calendar-legend-dot calendar-legend-closed' }),
        'Closed'
      )
    )
  );
}

export async function calendarView({ root, user }) {
  document.title = 'Exam Calendar | Pariksha';

  mount(root,
    appHeader(user),

    h('main', { class: 'page calendar-page' },
      h('div', { class: 'page-head' },
        h('h1', null, 'Exam Calendar'),
        h('p', { class: 'muted' },
          'View examination availability periods and plan your attempts.'
        )
      ),

      spinner('Loading exam calendar')
    )
  );

  let data;

  try {
    data = await get('/exams');
  } catch (error) {
    showError(error);

    mount(root,
      appHeader(user),

      h('main', { class: 'page calendar-page' },
        h('div', { class: 'empty' },
          h('strong', null, 'The exam calendar could not load'),
          h('p', null, error.message),

          h('button', {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => location.reload(),
          }, 'Try again')
        )
      )
    );

    return;
  }

  const exams = Array.isArray(data.exams) ? data.exams.slice() : [];

  const initial = new Date();
  let month = initial.getMonth();
  let year = initial.getFullYear();

  const page = h('main', {
    class: 'page calendar-page',
    id: 'main'
  });

  mount(root, appHeader(user), page);

  const renderContent = () => {
    const now = Date.now();

    const upcoming = exams
      .filter((exam) => {
        const end = validDate(exam.window?.end)?.getTime();

        return Number.isFinite(end) &&
          end >= now &&
          exam.status !== 'submitted';
      })
      .sort((a, b) =>
        (validDate(a.window?.start)?.getTime() ?? Infinity) -
        (validDate(b.window?.start)?.getTime() ?? Infinity)
      );

    const completed = exams.filter(
      (exam) => exam.status === 'submitted'
    );

    mount(page,

      h('div', { class: 'page-head calendar-page-head' },
        h('div', null,
          h('h1', null, 'Exam Calendar'),
          h('p', { class: 'muted' },
            'View examination availability periods and plan your attempts.'
          )
        ),

        h('a', {
          class: 'btn btn-ghost',
          href: '#/dashboard'
        }, 'Back to dashboard')
      ),

      h('div', { class: 'calendar-summary' },

        h('div', { class: 'calendar-summary-item' },
          h('span', null, 'Total exams'),
          h('strong', null, String(exams.length))
        ),

        h('div', { class: 'calendar-summary-item' },
          h('span', null, 'Upcoming / open'),
          h('strong', null, String(upcoming.length))
        ),

        h('div', { class: 'calendar-summary-item' },
          h('span', null, 'Submitted'),
          h('strong', null, String(completed.length))
        )
      ),

      buildCalendar(exams, month, year, (delta) => {
        if (delta === 0) {
          const today = new Date();
          month = today.getMonth();
          year = today.getFullYear();
        } else {
          const next = new Date(year, month + delta, 1);
          month = next.getMonth();
          year = next.getFullYear();
        }

        renderContent();
      }),

      h('section', { class: 'calendar-list-section' },
        h('div', { class: 'calendar-section-heading' },
          h('div', null,
            h('h2', null, 'Upcoming examinations'),
            h('p', { class: 'muted small' },
              'Exams that are open or will open in the future.'
            )
          )
        ),

        upcoming.length
          ? h('div', { class: 'calendar-exam-list' },
              ...upcoming.map(examCard)
            )
          : h('div', { class: 'empty' },
              h('strong', null, 'No upcoming examinations'),
              h('p', null,
                'There are no open or upcoming exam windows right now.'
              )
            )
      ),

      completed.length
        ? h('section', { class: 'calendar-list-section' },
            h('div', null,
              h('h2', null, 'Completed examinations'),
              h('p', { class: 'muted small' },
                'Examinations you have submitted.'
              )
            ),

            h('div', { class: 'calendar-exam-list' },
              ...completed.map(examCard)
            )
          )
        : null
    );
  };

  renderContent();
}

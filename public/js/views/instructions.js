
import { h, mount, spinner, tile, fmtDuration, fmtMarks } from '../dom.js';
import { get, post } from '../api.js';
import { navigate } from '../store.js';
import { appHeader, showError } from './shell.js';

const LEGEND = [
  ['notvisited', 'Not visited', 'You have not opened this question yet.'],
  ['unanswered', 'Not answered', 'You opened it but have not answered.'],
  ['answered', 'Answered', 'Your answer is saved and will be evaluated.'],
  ['marked', 'Marked for review', 'Flagged to revisit. Without an answer it is not evaluated.'],
  ['answeredmarked', 'Answered and marked', 'Flagged to revisit, with an answer. It will be evaluated.'],
];

const TYPE_LABEL = {
  MCQ: 'Multiple choice, one correct option',
  MSQ: 'Multiple choice, one or more correct options',
  NUMERICAL: 'Numerical value',
};

const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));

function markingRows(marking) {
  return marking.map((m) => {
    const parts = [`+${fmtMarks(m.correct)} for a correct answer`];

    if (m.partial) {
      parts.push(`+${m.partial} for each correct option chosen when only some are chosen`);
    }

    parts.push(
      m.wrong < 0
        ? `${minus(m.wrong)} for a wrong answer`
        : 'no penalty for a wrong answer'
    );

    parts.push('0 if left unanswered');

    return h(
      'div',
      { class: 'marking-row' },
      h('strong', null, TYPE_LABEL[m.type]),
      h(
        'span',
        {
          class: 'muted',
          style: { textAlign: 'right', maxWidth: '34ch' }
        },
        parts.join('. ') + '.'
      )
    );
  });
}

export async function instructionsView({ root, params, user }) {
  const [examId] = params;

  document.title = 'Instructions | Pariksha';

  mount(
    root,
    appHeader(user),
    h('main', { class: 'page' }, spinner())
  );

  let data;

  try {
    data = await get(`/exams/${examId}/instructions`);
  } catch (e) {
    showError(e);
    navigate('#/dashboard');
    return;
  }

  const { exam, instructions, marking, maxViolations } = data;

  // Resume an existing attempt if it is still in progress.
  if (exam.status === 'in_progress') {
    return navigate(`#/exam/${exam.attemptId}`);
  }

  // IMPORTANT:
  // Do not redirect submitted attempts to their previous result.
  // Allow the candidate to read instructions and start a fresh attempt.

  const ok = h('input', {
    type: 'checkbox',
    id: 'ack'
  });

  const begin = h(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      disabled: true
    },
    'I am ready to begin'
  );

  ok.addEventListener('change', () => {
    begin.disabled = !ok.checked || exam.windowState !== 'open';
  });

  begin.addEventListener('click', async () => {
    if (!ok.checked || exam.windowState !== 'open') return;

    // Request fullscreen before the network request.
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // The exam can still work without fullscreen.
    }

    begin.disabled = true;
    begin.textContent = 'Starting';

    try {
      // Backend creates a NEW attempt if the previous one was submitted.
      const { attemptId } = await post(`/exams/${exam.id}/start`);

      // Open the newly created attempt.
      navigate(`#/exam/${attemptId}`);
    } catch (e) {
      showError(e);
      begin.disabled = false;
      begin.textContent = 'I am ready to begin';
    }
  });

  mount(
    root,
    appHeader(user),
    h(
      'main',
      { class: 'page', id: 'main' },

      h(
        'div',
        { class: 'page-head' },
        h('h1', null, exam.title),
        h(
          'p',
          { class: 'muted' },
          `${fmtDuration(exam.durationMin)}, ${exam.questionCount} questions, ${exam.maxMarks} marks. Read this page once, then begin.`
        )
      ),

      h(
        'div',
        { class: 'instr' },

        h(
          'div',
          { style: { display: 'grid', gap: '24px' } },

          h(
            'section',
            { class: 'panel' },
            h('h2', null, 'How the exam works'),
            h(
              'ol',
              { class: 'instr-list' },
              instructions.map((t) => h('li', null, t)),
              maxViolations
                ? h(
                    'li',
                    null,
                    `Leaving full-screen or switching tabs ${maxViolations} times submits your paper automatically.`
                  )
                : null
            )
          ),

          h(
            'section',
            { class: 'panel' },
            h('h2', null, 'Marking'),
            h('div', { class: 'marking' }, markingRows(marking))
          )
        ),

        h(
          'aside',
          { style: { display: 'grid', gap: '24px' } },

          h(
            'section',
            { class: 'panel' },
            h('h2', null, 'Question palette'),
            h(
              'div',
              { class: 'legend' },
              LEGEND.map(([st, name, desc]) =>
                h(
                  'div',
                  { class: 'legend-item' },
                  tile(st, ''),
                  h(
                    'div',
                    null,
                    h('strong', null, name),
                    h('div', { class: 'muted small' }, desc)
                  )
                )
              )
            )
          ),

          h(
            'section',
            { class: 'panel' },
            h('h2', null, 'Sections'),
            h(
              'div',
              { class: 'marking' },
              exam.sections.map((s) =>
                h(
                  'div',
                  { class: 'marking-row' },
                  h('span', null, s.name),
                  h('span', { class: 'muted' }, `${s.count} questions`)
                )
              )
            )
          )
        )
      ),

      h(
        'section',
        { class: 'panel start-bar' },

        h(
          'label',
          { class: 'check', for: 'ack' },
          ok,
          h('span', null, 'I have read and understood these instructions.')
        ),

        h(
          'div',
          { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },

          h(
            'a',
            {
              class: 'btn btn-ghost',
              href: '#/dashboard'
            },
            'Back to exams'
          ),

          begin
        )
      )
    )
  );
} 
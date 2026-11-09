import { h, mount, spinner, fmtDateTime, svg } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, showError } from './shell.js';

export async function analysisView({ root, user }) {
  document.title = 'Performance analysis | Pariksha';
  mount(root, appHeader(user), h('main', { class: 'page' }, spinner('Loading your performance analysis')));

  let data;
  try {
    data = await get('/exams');
  } catch (error) {
    showError(error);
    return;
  }

  // Record viewing analysis as a meaningful study activity (local calendar date).
  try {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await post('/activity', { date: today, activityType: 'analysis_viewed' }).catch(() => {});
  } catch {}

  const submitted = data.exams.filter((exam) => exam.analysis);
  const avgAccuracy = submitted.length
    ? Math.round(submitted.reduce((sum, exam) => sum + exam.analysis.accuracy, 0) / submitted.length)
    : 0;
  const correct = submitted.reduce((sum, exam) => sum + exam.analysis.correct, 0);
  const wrong = submitted.reduce((sum, exam) => sum + exam.analysis.wrong, 0);
  const published = submitted.filter((exam) => exam.analysis.published);

  const answerChart = h('div', { class: 'chart-card' },
    h('div', { class: 'chart-heading' }, h('h2', null, 'Answer distribution'), h('span', { class: 'muted small' }, `${correct + wrong} answered`)),
    h('div', { class: 'answer-chart' },
      h('div', { class: 'donut', style: { '--correct': `${correct + wrong ? (correct / (correct + wrong)) * 100 : 0}%` } }, h('strong', null, `${avgAccuracy}%`), h('span', null, 'accuracy')),
      h('div', { class: 'chart-legend' },
        h('span', null, h('i', { class: 'legend-dot correct' }), `Correct ${correct}`),
        h('span', null, h('i', { class: 'legend-dot wrong' }), `Wrong ${wrong}`))));

  const maxAccuracy = Math.max(1, ...submitted.map((exam) => exam.analysis.accuracy));
  const bars = submitted.map((exam, index) => h('div', { class: 'accuracy-row' },
    h('span', { class: 'accuracy-name' }, exam.title),
    h('div', { class: 'accuracy-track', 'aria-label': `${exam.analysis.accuracy}% accuracy` }, h('span', { style: { width: `${exam.analysis.accuracy / maxAccuracy * 100}%`, '--bar-index': String(index) } })),
    h('strong', null, `${exam.analysis.accuracy}%`)));
  const accuracyChart = h('div', { class: 'chart-card' }, h('div', { class: 'chart-heading' }, h('h2', null, 'Accuracy by exam'), h('span', { class: 'muted small' }, 'Latest submitted attempts')), h('div', { class: 'accuracy-chart' }, ...bars));

  mount(root, appHeader(user), h('main', { class: 'page analysis-page', id: 'main' },
    h('div', { class: 'page-head analysis-heading' },
      svg('svg', { class: 'analysis-title-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
        svg('path', { d: 'M4 20V10' }), svg('path', { d: 'M10 20V4' }), svg('path', { d: 'M16 20v-7' }), svg('path', { d: 'M22 20V7' }), svg('path', { d: 'M2 20h20' })),
      h('div', null,
        h('span', { class: 'eyebrow' }, 'PERFORMANCE OVERVIEW'),
        h('h1', null, 'Performance analysis'),
        h('p', { class: 'muted' }, 'Track progress, accuracy and exam-wise results in one place.'))),
    submitted.length ? h('section', { class: 'analysis-content', 'aria-label': 'Performance summary' },
      h('div', { class: 'analysis-stats' },
        h('article', { class: 'analysis-stat' }, h('span', null, 'Exams submitted'), h('strong', null, String(submitted.length))),
        h('article', { class: 'analysis-stat' }, h('span', null, 'Average accuracy'), h('strong', null, `${avgAccuracy}%`)),
        h('article', { class: 'analysis-stat' }, h('span', null, 'Correct / Wrong'), h('strong', null, `${correct} / ${wrong}`)),
        h('article', { class: 'analysis-stat' }, h('span', null, 'Published results'), h('strong', null, `${published.length}/${submitted.length}`))),
      h('div', { class: 'analysis-charts' }, answerChart, accuracyChart),
      h('section', { class: 'exam-analysis-list' },
        h('h2', null, 'Exam-wise analysis'),
        submitted.map((exam) => h('article', { class: 'analysis-exam' },
          h('div', { class: 'analysis-exam-name' },
            h('strong', null, exam.title),
            h('p', { class: 'muted small' }, `Submitted ${fmtDateTime(exam.analysis.submittedAt)}`)),
          h('div', { class: 'analysis-values' },
            h('span', null, 'Score', h('strong', null, exam.analysis.published ? `${exam.analysis.score ?? 0}/${exam.analysis.maxScore}` : 'Pending')),
            h('span', null, 'Accuracy', h('strong', null, `${exam.analysis.accuracy}%`)),
            h('span', null, 'Attempted', h('strong', null, `${exam.analysis.attempted}/${exam.analysis.questionCount}`)),
            h('span', null, 'Correct / Wrong', h('strong', null, `${exam.analysis.correct} / ${exam.analysis.wrong}`))),
          exam.analysis.published
            ? h('a', { class: 'btn btn-primary btn-sm', href: `#/result/${exam.attemptId}` }, 'Open result')
            : h('span', { class: 'chip chip-warn' }, 'Result pending')))))
      : h('div', { class: 'empty' }, h('strong', null, 'No submitted exams yet'), h('p', null, 'Your analysis will appear after you submit an exam.'), h('a', { class: 'btn btn-primary', href: '#/dashboard' }, 'Go to dashboard'))));
}

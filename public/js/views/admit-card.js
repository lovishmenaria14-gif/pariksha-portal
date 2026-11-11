import { h, mount, spinner } from '../dom.js';
import { get } from '../api.js';
import { createAdmitCardElement } from './dashboard.js';
import { appHeader, showError } from './shell.js';

export async function admitCardView({ root, params, user }) {
  const [examId] = params;
  document.title = 'Admit Card | Pariksha';

  mount(root, appHeader(user), h('main', { class: 'page' }, spinner('Loading your admit card…')));

  try {
    const { exams } = await get('/exams');
    const exam = exams.find((x) => x.id === examId);

    if (!exam) {
      throw new Error('Examination not found or you do not have permission to access it.');
    }

    const card = createAdmitCardElement(user, exam);

    const printBtn = h('button', {
      class: 'btn btn-primary',
      type: 'button',
      onclick: () => {
        const restore = () => document.body.classList.remove('admit-print-mode');
        document.body.classList.add('admit-print-mode');
        window.addEventListener('afterprint', restore, { once: true });
        window.print();
      }
    }, 'Print / Save PDF');

    const backBtn = h('a', {
      class: 'btn btn-ghost',
      href: '#/dashboard'
    }, 'Back to Dashboard');

    mount(
      root,
      appHeader(user),
      h('main', { class: 'page' },
        h('div', { class: 'page-head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' } },
          h('div', null,
            h('h1', null, 'Admit Card'),
            h('p', { class: 'muted' }, 'Print your official admit card for the examination centre.')
          ),
          h('div', { style: { display: 'flex', gap: '10px' } }, backBtn, printBtn)
        ),
        card
      )
    );
  } catch (error) {
    showError(error);
  }
}
import { h, mount, rich, spinner } from '../dom.js';
import { del, get } from '../api.js';
import { appHeader, showError } from './shell.js';

function optionText(q) {
  if (!Array.isArray(q.options)) return null;
  return h('ul', { class: 'bookmark-options' },
    ...q.options.map((option) => h('li', null, rich(option.text)))
  );
}

export async function bookmarksView({ root, user }) {
  document.title = 'Question bookmarks | Pariksha';
  mount(root, appHeader(user), h('main', { class: 'page' }, spinner('Loading bookmarked questions')));

  let data;
  try {
    data = await get('/bookmarks');
  } catch (e) {
    showError(e);
    mount(root, appHeader(user), h('main', { class: 'page' }, h('div', { class: 'empty' }, h('strong', null, 'Bookmarks could not be loaded'), h('p', null, e.message))));
    return;
  }

  const cards = (data.bookmarks || []).map((bookmark) => {
    const q = bookmark.question || {};
    const remove = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Remove');
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await del(`/attempts/${bookmark.attemptId}/bookmarks/${bookmark.questionId}`);
        card.remove();
        if (!list.children.length) list.replaceChildren(emptyState());
      } catch (e) {
        remove.disabled = false;
        showError(e);
      }
    });

    const card = h('article', { class: 'bookmark-card' },
      h('div', { class: 'bookmark-card-head' },
        h('div', null, h('span', { class: 'chip' }, bookmark.examCode || bookmark.examTitle), h('p', { class: 'muted small' }, bookmark.sectionName || 'Section')),
        remove),
      h('h2', null, `Question ${q.no || ''}`),
      h('p', { class: 'bookmark-question-text' }, rich(q.text || 'Question unavailable')),
      optionText(q),
      q.type === 'NUMERICAL' ? h('p', { class: 'muted small' }, 'Numerical answer question') : null
    );
    return card;
  });

  const emptyState = () => h('div', { class: 'empty' },
    h('strong', null, 'No bookmarked questions yet'),
    h('p', null, 'Use “Bookmark question” during an exam to save difficult questions here.')
  );
  const list = h('div', { class: 'bookmark-list' }, ...(cards.length ? cards : [emptyState()]));

  mount(root, appHeader(user),
    h('main', { class: 'page' },
      h('div', { class: 'page-heading' }, h('div', null, h('h1', null, 'Question bookmarks'), h('p', null, 'Review the questions you saved as difficult.'))),
      list
    )
  );
}

import { h, mount, spinner, toast, fmtDateTime } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, refreshNotificationBadge, showError } from './shell.js';

const typeLabel = { general: 'Announcement', exam: 'Exam update', result: 'Result', admit_card: 'Admit card', urgent: 'Important', support: 'Support update' };

export async function notificationsView({ root, user }) {
  document.title = 'Notifications | Pariksha';
  mount(root, appHeader(user), h('main', { class: 'page notifications-page', id: 'main' }, spinner('Loading notifications')));
  try {
    const { notifications } = await get('/notifications');
    const list = h('div', { class: 'notifications-list' });

    const render = () => {
      if (!notifications.length) {
        list.replaceChildren(h('div', { class: 'empty notifications-empty' }, h('strong', null, 'No notifications yet'), h('p', null, 'Exam notices, important updates, and support replies will appear here.')));
        return;
      }
      list.replaceChildren(...notifications.map((item) => {
        const card = h('article', { class: `notification-card ${item.isRead ? '' : 'unread'}` },
          h('div', { class: 'notification-card-head' }, h('span', { class: `notice-type notice-${item.type || 'general'}` }, typeLabel[item.type] || 'Announcement'), item.isRead ? null : h('span', { class: 'unread-dot' }, 'Unread')),
          h('h2', null, item.title),
          h('p', null, item.message),
          item.ticketId
            ? h('a', {
                class: 'btn btn-secondary btn-sm notification-action',
                href: `#/support/${encodeURIComponent(item.ticketId)}`,
              }, 'View conversation')
            : null,
          h('div', { class: 'notification-meta' }, h('span', null, fmtDateTime(item.createdAt)), h('span', null, item.createdBy || 'Examination portal')));
        return card;
      }));
    };

    const markAll = h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
      markAll.disabled = true;
      try {
        await post('/notifications/read-all');
        notifications.forEach((item) => { item.isRead = true; });
        render();
        await refreshNotificationBadge();
        toast('All notifications marked as read.', 'ok');
      } catch (error) { showError(error); }
      finally { markAll.disabled = false; }
    } }, 'Mark all as read');
    render();
    mount(root, appHeader(user), h('main', { class: 'page notifications-page', id: 'main' },
      h('div', { class: 'page-head notifications-heading' }, h('div', null, h('span', { class: 'eyebrow' }, 'KEEP UPDATED'), h('h1', null, 'Notifications'), h('p', { class: 'muted' }, 'Important notices, exam updates, and replies to your support requests.')), markAll),
      list));
  } catch (error) {
    mount(root, appHeader(user), h('main', { class: 'page notifications-page', id: 'main' }, h('div', { class: 'empty' }, h('strong', null, 'Notifications could not be loaded'), h('p', null, error.message))));
  }
}

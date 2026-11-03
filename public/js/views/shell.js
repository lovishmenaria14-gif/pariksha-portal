import { h, brand, themeButton, initials, toast, svg } from '../dom.js';
import { get, post } from '../api.js';
import { store, navigate } from '../store.js';

export async function signOut() {
  try {
    await post('/auth/logout');
  } catch {
    /* the cookie is cleared server-side when possible; either way we leave */
  }
  store.user = null;
  store.notice = '';
  navigate('#/login');
}

export function appHeader(user, { home = '#/dashboard', extra } = {}) {
  const notificationBadge = h('span', { class: 'sidebar-notification-badge', hidden: true }, '0');
  const sidebar = user.role === 'candidate'
    ? h('aside', { class: 'candidate-sidebar', 'aria-label': 'Candidate navigation' },
        h('a', { class: 'sidebar-profile', href: '#/profile', 'aria-label': 'Open candidate profile' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, user.photoURL ? h('img', { src: user.photoURL, alt: '' }) : initials(user.name)), h('div', null, h('strong', null, user.name), h('span', { class: 'muted small' }, 'View profile'))),
        h('nav', null,
          h('a', { class: location.hash === '#/dashboard' ? 'sidebar-link active' : 'sidebar-link', href: '#/dashboard' },
            svg('svg', { class: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
              svg('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }), svg('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }), svg('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }), svg('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })),
            'Dashboard'),
          h('a', { class: location.hash === '#/analysis' ? 'sidebar-link active' : 'sidebar-link', href: '#/analysis' },
            svg('svg', { class: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
              svg('path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20V7' }), svg('path', { d: 'M2 20h20' })),
            'Analysis'),
          h('a', { class: location.hash === '#/profile' ? 'sidebar-link active' : 'sidebar-link', href: '#/profile' },
            svg('svg', { class: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
              svg('circle', { cx: '12', cy: '8', r: '4' }), svg('path', { d: 'M4 21a8 8 0 0 1 16 0' })),
            'Profile'),
          h('a', { class: location.hash === '#/notifications' ? 'sidebar-link active' : 'sidebar-link', href: '#/notifications' },
            svg('svg', { class: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
              svg('path', { d: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9' }), svg('path', { d: 'M10 21h4' })),
            'Notifications', notificationBadge)))
    : null;

  if (user.role === 'candidate') {
    get('/notifications').then(({ notifications = [] }) => {
      const unread = notifications.filter((item) => !item.isRead).length;
      notificationBadge.textContent = String(unread);
      notificationBadge.hidden = unread === 0;
    }).catch(() => {});
  }

  return h(
    'div', { class: user.role === 'candidate' ? 'candidate-shell' : '' },
    sidebar,
    h('header', { class: 'topbar' },
    brand(home),
    h('div', { class: 'spacer' }),
    extra,
    h(
      user.role === 'candidate' ? 'a' : 'div',
      user.role === 'candidate'
        ? { class: 'who', href: '#/profile', title: 'View profile', 'aria-label': 'View profile' }
        : { class: 'who' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, user.photoURL ? h('img', { src: user.photoURL, alt: '' }) : initials(user.name)),
      h('span', { class: 'who-text' }, user.name),
    ),
    themeButton(),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: signOut }, 'Sign out'),
    ),
  );
}

export const showError = (e) => toast(e?.message || 'Something went wrong. Try again.', 'error');

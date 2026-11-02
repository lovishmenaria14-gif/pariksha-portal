import { h, brand, themeButton, initials, toast } from '../dom.js';
import { post } from '../api.js';
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
  return h(
    'header',
    { class: 'topbar' },
    brand(home),
    h('div', { class: 'spacer' }),
    extra,
    h(
      'div',
      { class: 'who' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(user.name)),
      h('span', { class: 'who-text' }, user.name),
    ),
    themeButton(),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: signOut }, 'Sign out'),
  );
}

export const showError = (e) => toast(e?.message || 'Something went wrong. Try again.', 'error');

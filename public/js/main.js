import { get, onAuthLost } from './api.js';
import { mount, spinner } from './dom.js';
import { store } from './store.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { instructionsView } from './views/instructions.js';
import { examView } from './views/exam.js';
import { resultView } from './views/result.js';
import { adminView } from './views/admin.js';
import { analysisView } from './views/analysis.js';
import { profileView } from './views/profile.js';
import { notificationsView } from './views/notifications.js';

const app = document.getElementById('app');

const routes = [
  { re: /^#\/login$/, view: loginView, public: true },
  { re: /^#\/dashboard$/, view: dashboardView, role: 'candidate' },
  { re: /^#\/analysis$/, view: analysisView, role: 'candidate' },
  { re: /^#\/profile$/, view: profileView, role: 'candidate' },
  { re: /^#\/notifications$/, view: notificationsView, role: 'candidate' },
  { re: /^#\/instructions\/([\w-]+)$/, view: instructionsView, role: 'candidate' },
  { re: /^#\/exam\/([\w-]+)$/, view: examView, role: 'candidate' },
  { re: /^#\/result\/([\w-]+)$/, view: resultView, role: 'candidate' },
  { re: /^#\/admin(?:\/(\w+))?$/, view: adminView, role: 'admin' },
];

const homeFor = (user) => (!user ? '#/login' : user.role === 'admin' ? '#/admin' : '#/dashboard');

let cleanup = null;
let token = 0;

async function render() {
  const mine = ++token;
  try {
    cleanup?.();
  } catch (e) {
    console.error(e);
  }
  cleanup = null;

  if (!store.booted) {
    mount(app, spinner('Getting things ready'));
    try {
      store.user = (await get('/auth/me')).user;
    } catch {
      store.user = null;
    }
    store.booted = true;
    if (mine !== token) return;
  }

  const hash = location.hash || '#/';
  const route = routes.find((r) => r.re.test(hash));
  const home = homeFor(store.user);
  if (!route) return location.replace(home);
  if (!route.public && !store.user) return location.replace('#/login');
  if (route.public && store.user) return location.replace(home);
  if (route.role && store.user.role !== route.role) return location.replace(home);

  const params = hash.match(route.re).slice(1);
  window.scrollTo(0, 0);
  const result = await route.view({ root: app, params, user: store.user });
  if (mine !== token) {
    // The person moved on while this view was still loading.
    try {
      result?.();
    } catch (e) {
      console.error(e);
    }
    return;
  }
  cleanup = typeof result === 'function' ? result : null;
}

onAuthLost((err) => {
  if (!store.user) return;
  store.user = null;
  store.notice = ['session_replaced', 'session_expired'].includes(err.code) ? err.message : 'Sign in again to continue.';
  if (location.hash === '#/login') render();
  else location.hash = '#/login';
});

window.addEventListener('hashchange', render);
render();

import { h, mount, svg, themeButton, brand, STATUS_LABEL } from '../dom.js';
import { get, post } from '../api.js';
import { googleLogin } from '../firebase-client.js';
import { store, navigate } from '../store.js';

const COLS = 8;
const ROWS = 7;
const CYCLE = ['notvisited', 'answered', 'unanswered', 'marked'];

// Deterministic starting pattern, so the field looks like a half-finished paper.
function startingStates() {
  let s = 7;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  return Array.from({ length: COLS * ROWS }, () => {
    const r = rnd();
    return r < 0.5 ? 'notvisited' : r < 0.75 ? 'answered' : r < 0.9 ? 'unanswered' : 'marked';
  });
}

function paletteField() {
  const states = startingStates();
  const tiles = states.map((st, i) => {
    const btn = h('button', { class: 'ct', type: 'button', style: { '--i': String(i) } }, String(i + 1));
    const apply = () => {
      const st2 = states[i];
      btn.dataset.st = st2 === 'notvisited' ? CYCLE[1 + (i % 3)] : st2;
      btn.dataset.rest = st2 === 'notvisited' ? '0' : '1';
      btn.style.setProperty('--rest', btn.dataset.rest);
      btn.style.setProperty('--lit', btn.dataset.rest);
      btn.setAttribute('aria-label', `Question ${i + 1}, ${STATUS_LABEL[st2].toLowerCase()}`);
    };
    apply();
    btn.addEventListener('click', () => {
      states[i] = CYCLE[(CYCLE.indexOf(states[i]) + 1) % CYCLE.length];
      apply();
    });
    return btn;
  });

  const grid = h('div', { class: 'palette-grid', style: { '--cols': String(COLS) } }, tiles);
  return { grid, tiles };
}

function eyeIcon(off) {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }),
    svg('circle', { cx: 12, cy: 12, r: 3 }),
    off ? svg('path', { d: 'M3 3l18 18' }) : null,
  );
}

export async function loginView({ root }) {
  document.title = 'Sign in | Pariksha';
  const hints = await get('/auth/hints').catch(() => ({ demo: null }));

  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const appNo = h('input', { class: 'input', id: 'appno', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, inputmode: 'text' });
  const pw = h('input', { class: 'input', id: 'pw', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const showBtn = h('button', { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-label': 'Show password', onclick: () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    showBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    showBtn.replaceChildren(eyeIcon(show));
  } }, eyeIcon(false));
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');

  const fail = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    appNo.setAttribute('aria-invalid', 'true');
    pw.setAttribute('aria-invalid', 'true');
  };

  const form = h(
    'form',
    {
      class: 'login-form',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        appNo.removeAttribute('aria-invalid');
        pw.removeAttribute('aria-invalid');
        if (!appNo.value.trim() || !pw.value) return fail('Enter your application number and password.');
        submit.disabled = true;
        submit.textContent = 'Signing in';
        try {
          const { user } = await post('/auth/login', { applicationNo: appNo.value, password: pw.value });
          store.user = user;
          store.notice = '';
          navigate(user.role === 'admin' ? '#/admin' : '#/dashboard');
        } catch (err) {
          fail(err.message);
          pw.select();
        } finally {
          submit.disabled = false;
          submit.textContent = 'Sign in';
        }
      },
    },
    store.notice ? h('div', { class: 'form-notice', role: 'status' }, store.notice) : null,
    errorBox,
    h('div', { class: 'field' }, h('label', { for: 'appno' }, 'Application number'), appNo),
    h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password'), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', alignItems: 'center' } }, pw, showBtn)),
    h('div', { class: 'login-actions' }, submit, h('button', { class: 'text-button', type: 'button', onclick: () => switchMode('forgot') }, 'Forgot password?')),
    h('div', { class: 'account-switch' }, h('span', null, 'New to Pariksha?'), h('button', { class: 'text-button', type: 'button', onclick: () => switchMode('signup') }, 'Create an account')),
  );

  const signupError = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const signupName = h('input', { class: 'input', id: 'signup-name', autocomplete: 'name', required: true });
  const signupApplicationNo = h('input', { class: 'input', id: 'signup-appno', name: 'application-no', inputmode: 'numeric', pattern: '[0-9]{12}', minlength: 12, maxlength: 12, autocomplete: 'off', required: true });
  const signupEmail = h('input', { class: 'input', id: 'signup-email', type: 'email', autocomplete: 'email', required: true });
  const signupPw = h('input', { class: 'input', id: 'signup-password', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const signupSubmit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account');
  const signupForm = h('form', {
    class: 'login-form account-form',
    novalidate: true,
    hidden: true,
    onsubmit: async (e) => {
      e.preventDefault();
      signupError.hidden = true;
      if (!signupName.value.trim() || !/^\d{12}$/.test(signupApplicationNo.value) || !signupEmail.value.trim() || signupPw.value.length < 8) {
        signupError.textContent = 'Enter your name, a 12-digit application number, email and a password of at least 8 characters.';
        signupError.hidden = false;
        return;
      }
      signupSubmit.disabled = true;
      signupSubmit.textContent = 'Creating account…';
      try {
        const { user } = await post('/auth/signup', { name: signupName.value, applicationNo: signupApplicationNo.value, email: signupEmail.value, password: signupPw.value });
        store.user = user;
        store.notice = `Your application number is ${user.applicationNo}.`;
        navigate('#/dashboard');
      } catch (err) {
        signupError.textContent = err.message;
        signupError.hidden = false;
      } finally {
        signupSubmit.disabled = false;
        signupSubmit.textContent = 'Create account';
      }
    },
  },
    h('h2', null, 'Create your account'),
    signupError,
    h('div', { class: 'field' }, h('label', { for: 'signup-name' }, 'Full name'), signupName),
    h('div', { class: 'field' }, h('label', { for: 'signup-appno' }, 'Application number (12 digits)'), signupApplicationNo),
    h('div', { class: 'field' }, h('label', { for: 'signup-email' }, 'Email address'), signupEmail),
    h('div', { class: 'field' }, h('label', { for: 'signup-password' }, 'Password'), signupPw),
    h('div', { class: 'login-actions' }, signupSubmit, h('button', { class: 'text-button', type: 'button', onclick: () => switchMode('login') }, 'Back to sign in')),
  );

  const forgotError = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const forgotApp = h('input', { class: 'input', id: 'forgot-app', autocomplete: 'username', required: true });
  const forgotEmail = h('input', { class: 'input', id: 'forgot-email', type: 'email', autocomplete: 'email', required: true });
  const forgotPw = h('input', { class: 'input', id: 'forgot-password', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const forgotSubmit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Reset password');
  const forgotForm = h('form', {
    class: 'login-form account-form',
    novalidate: true,
    hidden: true,
    onsubmit: async (e) => {
      e.preventDefault();
      forgotError.hidden = true;
      if (!forgotApp.value.trim() || !forgotEmail.value.trim() || forgotPw.value.length < 8) {
        forgotError.textContent = 'Enter all details and a new password of at least 8 characters.';
        forgotError.hidden = false;
        return;
      }
      forgotSubmit.disabled = true;
      forgotSubmit.textContent = 'Resetting…';
      try {
        await post('/auth/forgot-password', { applicationNo: forgotApp.value, email: forgotEmail.value, password: forgotPw.value });
        store.notice = 'Password reset successfully. Sign in with your new password.';
        switchMode('login');
        errorBox.textContent = store.notice;
        errorBox.hidden = false;
        errorBox.className = 'form-notice';
      } catch (err) {
        forgotError.textContent = err.message;
        forgotError.hidden = false;
      } finally {
        forgotSubmit.disabled = false;
        forgotSubmit.textContent = 'Reset password';
      }
    },
  },
    h('h2', null, 'Reset your password'),
    h('p', { class: 'muted small' }, 'Enter the application number and email used when you registered.'),
    forgotError,
    h('div', { class: 'field' }, h('label', { for: 'forgot-app' }, 'Application number'), forgotApp),
    h('div', { class: 'field' }, h('label', { for: 'forgot-email' }, 'Email address'), forgotEmail),
    h('div', { class: 'field' }, h('label', { for: 'forgot-password' }, 'New password'), forgotPw),
    h('div', { class: 'login-actions' }, forgotSubmit, h('button', { class: 'text-button', type: 'button', onclick: () => switchMode('login') }, 'Back to sign in')),
  );

  function switchMode(mode) {
    form.hidden = mode !== 'login';
    signupForm.hidden = mode !== 'signup';
    forgotForm.hidden = mode !== 'forgot';
    googleButton.hidden = mode !== 'login';
  }

const googleButton = h(
  'button',
  {
    class: 'btn btn-ghost',
    type: 'button',
    style: { width: '100%', marginTop: '14px' },
    onclick: async () => {
      errorBox.hidden = true;
      googleButton.disabled = true;
      googleButton.textContent = 'Connecting to Google...';

      try {
        const idToken = await googleLogin();

        const response = await fetch('/api/auth/google', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'pariksha',
            'Authorization': 'Bearer ' + idToken,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || data.error?.message || 'Google login failed.'
          );
        }

        store.user = data.user;
        store.notice = '';

        navigate(
          data.user.role === 'admin' ? '#/admin' : '#/dashboard'
        );
      } catch (err) {
        fail(err.message || 'Unable to sign in with Google.');
      } finally {
        googleButton.disabled = false;
        googleButton.textContent = 'Continue with Google';
      }
    },
  },
  'Continue with Google'
);
  const demo = hints.demo
    ? h(
        'div',
        { class: 'demo-box' },
        h('strong', null, 'Try the demo'),
        ...[
          ['Candidate', hints.demo.candidate],
          ['Exam controller', hints.demo.admin],
        ].map(([label, c]) =>
          h(
            'div',
            { class: 'demo-line' },
            h('span', null, `${label}: `, h('code', null, c.applicationNo), ' / ', h('code', null, c.password)),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
              appNo.value = c.applicationNo;
              pw.value = c.password;
              submit.focus();
            } }, 'Fill in'),
          ),
        ),
      )
    : null;

  const { grid, tiles } = paletteField();
  const field = h(
    'section',
    { class: 'login-field', 'aria-label': 'Interactive question palette' },
    h(
      'div',
      { class: 'palette-field' },
      grid,
      h(
        'div',
        { class: 'field-caption' },
        h('strong', null, 'Your question palette'),
        h('p', { class: 'muted small' }, 'Each state has its own colour and shape, so you can read your progress at a glance. Move across the grid, or select a tile to change its state.'),
      ),
    ),
  );

  mount(
    root,
    h(
      'main',
      { class: 'login' },
      h(
        'section',
        { class: 'login-side' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, brand('#/login'), themeButton()),
       h('header', null, h('h1', null, 'Your exam room is ready.'), h('p', { class: 'lede' }, 'Sign in with your application number to take timed mock tests in the NTA computer-based format.')),
form,
signupForm,
forgotForm,
h('div', { class: 'google-login-section' },
  h('p', { class: 'muted small' }, 'OR'),
  googleButton
),
demo,
      ),
      field,
    ),
  );

  // --- proximity light ---------------------------------------------------------
  let centers = [];
  const measure = () => {
    centers = tiles.map((t) => {
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  };
  measure();
  const radius = 150;
  let frame = 0;
  let px = -1e4;
  let py = -1e4;
  const paint = () => {
    frame = 0;
    const box = field.getBoundingClientRect();
    field.style.setProperty('--mx', `${px - box.left}px`);
    field.style.setProperty('--my', `${py - box.top}px`);
    tiles.forEach((t, i) => {
      const d = Math.hypot(centers[i].x - px, centers[i].y - py);
      const p = Math.max(0, 1 - d / radius) ** 1.6;
      const rest = Number(t.dataset.rest);
      t.style.setProperty('--lit', String(Math.max(rest, p * 0.95)));
    });
  };
  const move = (e) => {
    px = e.clientX;
    py = e.clientY;
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const leave = () => {
    px = py = -1e4;
    if (!frame) frame = requestAnimationFrame(paint);
  };
  field.addEventListener('pointermove', move);
  field.addEventListener('pointerleave', leave);
  window.addEventListener('resize', measure);
  setTimeout(measure, 600);

  appNo.focus();

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', measure);
  };
}

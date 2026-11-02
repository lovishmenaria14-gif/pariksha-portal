// Tiny DOM helpers. Everything is built with createElement/textContent, so question
// text, names and any imported content can never inject markup.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mount = (root, ...nodes) => root.replaceChildren(...nodes.flat(Infinity).filter(Boolean));

// ^{x} becomes a superscript, _{x} a subscript, and newlines become line breaks.
export function rich(text = '') {
  const frag = document.createDocumentFragment();
  const re = /\^\{([^}]*)\}|_\{([^}]*)\}|\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[0] === '\n') frag.append(document.createElement('br'));
    else {
      const el = document.createElement(m[1] !== undefined ? 'sup' : 'sub');
      el.textContent = m[1] ?? m[2];
      frag.append(el);
    }
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---------------------------------------------------------------- formatting
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export const firstName = (name = '') => name.split(/\s+/)[0] || 'there';

export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function fmtDuration(min) {
  if (min < 1) return `${Math.round(min * 60)} sec`;
  if (min < 60) return `${Math.round(min)} min`;
  const hh = Math.floor(min / 60);
  const mm = Math.round(min % 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (ms) =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const fmtNum = (n, d = 0) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtMarks = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

export function fmtSeconds(sec) {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}

// ---------------------------------------------------------------- toast and modal
export function toast(message, kind = 'info', ms = 4200) {
  const el = h('div', { class: 'toast', dataset: { kind } }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

export function modal({ title, body, actions = [], wide = false, locked = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const previous = document.activeElement;
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  const box = h(
    'div',
    { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    title ? h('h2', { id: titleId }, title) : null,
    body,
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null,
  );
  const scrim = h('div', { class: 'scrim' }, box);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    previous?.focus?.();
    onClose?.(result);
  };
  function onKey(e) {
    if (e.key === 'Escape' && !locked) {
      e.stopPropagation();
      close('dismiss');
    }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKey, true);
  if (!locked) scrim.addEventListener('mousedown', (e) => e.target === scrim && close('dismiss'));
  root.append(scrim);
  (box.querySelector('[autofocus]') || box.querySelector('input,select,textarea,button') || box).focus?.();
  return { close, box };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: h('p', { class: 'muted' }, message),
      onClose: (r) => resolve(r === true),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close(false) }, cancelLabel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', autofocus: true, onclick: () => m.close(true) }, confirmLabel),
      ],
    });
  });
}

// ---------------------------------------------------------------- theme
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'night' ? 'day' : 'night';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('pariksha-theme', next);
  } catch {
    /* private mode: the choice just will not persist */
  }
  return next;
}

export function themeButton() {
  const label = () => (document.documentElement.dataset.theme === 'night' ? 'Switch to day theme' : 'Switch to night theme');
  const btn = h(
    'button',
    {
      class: 'btn btn-quiet btn-icon',
      type: 'button',
      'aria-label': label(),
      title: label(),
      onclick: () => {
        toggleTheme();
        btn.setAttribute('aria-label', label());
        btn.title = label();
        btn.replaceChildren(themeGlyph());
      },
    },
    themeGlyph(),
  );
  return btn;
}

function themeGlyph() {
  const night = document.documentElement.dataset.theme === 'night';
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    night
      ? [svg('circle', { cx: 12, cy: 12, r: 4 }), svg('path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' })]
      : [svg('path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' })],
  );
}

export function brand(href = '#/') {
  return h(
    'a',
    { class: 'brand', href, 'aria-label': 'Pariksha home' },
    svg(
      'svg',
      { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
      svg('rect', { x: 3, y: 3, width: 11, height: 11, rx: 3, fill: 'var(--st-a-bg)' }),
      svg('rect', { x: 18, y: 3, width: 11, height: 11, rx: 5.5, fill: 'var(--st-m-bg)' }),
      svg('rect', { x: 3, y: 18, width: 11, height: 11, rx: 3, fill: 'var(--st-na-bg)' }),
      svg('rect', { x: 18, y: 18, width: 11, height: 11, rx: 3, fill: 'var(--amber)' }),
    ),
    'Pariksha',
  );
}

export const spinner = (text = 'Loading') => h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), h('span', null, text));

export function tile(status, text, extra = {}) {
  return h('span', { class: 'tile tile-sm', dataset: { status }, ...extra }, text);
}

export const STATUS_LABEL = {
  notvisited: 'Not visited',
  unanswered: 'Not answered',
  answered: 'Answered',
  marked: 'Marked for review',
  answeredmarked: 'Answered and marked for review',
};

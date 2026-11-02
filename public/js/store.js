export const store = {
  user: null,
  booted: false,
  notice: '',
};

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

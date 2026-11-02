// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('pariksha-theme');
  } catch (e) {}
  var theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night');
  document.documentElement.setAttribute('data-theme', theme);
})();

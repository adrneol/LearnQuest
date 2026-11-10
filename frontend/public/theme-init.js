/* global localStorage, window, document */
// Run before CSS and React. The same-origin script is allowed by the app CSP.
(() => {
  let preference;
  try {
    preference = localStorage.getItem('lq-theme');
  } catch {
    // A browser that blocks storage can still render the default theme.
  }
  const light = preference === 'light' ||
    (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();

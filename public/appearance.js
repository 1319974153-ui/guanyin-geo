/* Device-only appearance preference. No business state or network requests. */
(() => {
  const key = 'guanyin.appearance.nocturne';
  let theme = 'dark';
  try { if (localStorage.getItem(key) === 'light') theme = 'light'; } catch {}
  function apply() {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    const label = theme === 'dark' ? '切换为浅色外观' : '切换为深色外观';
    if (button) { button.setAttribute('aria-label', label); button.title = label; }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080c11' : '#ffffff');
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, theme); } catch {}
      apply();
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { theme = event.newValue === 'light' ? 'light' : 'dark'; apply(); }
  });
})();

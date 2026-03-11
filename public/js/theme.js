// public/js/theme.js
// ─────────────────────────────────────────────────────────────────────────────
// THEME MANAGEMENT (Dark / Light Mode)
//
// HOW IT WORKS:
// 1. We store the user's preference in localStorage (browser storage that
//    persists across sessions — survives page refresh, browser close, etc.)
// 2. We set a `data-theme` attribute on the <html> element
// 3. CSS reads that attribute and applies the correct color variables
//
// This runs BEFORE the page renders (script is in <head>) to prevent
// a "flash" of wrong theme.
// ─────────────────────────────────────────────────────────────────────────────

(function() {
  // ── INITIALIZE THEME ───────────────────────────────────────────────────────
  // Read saved preference, default to 'dark' if nothing saved
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // ── WAIT FOR DOM TO BE READY ───────────────────────────────────────────────
  // We can't interact with the toggle button until the DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return; // Toggle button might not exist on every page

    // Update the icon to match current theme
    updateToggleIcon(savedTheme, toggleBtn);

    // ── HANDLE THEME TOGGLE CLICK ───────────────────────────────────────────
    toggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme     = currentTheme === 'dark' ? 'light' : 'dark';

      // Apply new theme
      document.documentElement.setAttribute('data-theme', newTheme);

      // Save preference (survives page refresh)
      localStorage.setItem('theme', newTheme);

      // Update the icon
      updateToggleIcon(newTheme, toggleBtn);

      // If user is logged in, save their preference server-side too
      // (so it works when they switch devices)
      if (window.APP_USER) {
        saveThemePreference(newTheme);
      }
    });
  });

  /**
   * updateToggleIcon — Change the button emoji to match the current theme
   */
  function updateToggleIcon(theme, btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  /**
   * saveThemePreference — Send theme choice to the server
   * This saves it in the database so it persists across devices
   */
  async function saveThemePreference(theme) {
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });
    } catch (err) {
      // Silently fail — the preference is already saved in localStorage
      console.debug('Could not save theme to server:', err);
    }
  }
})();

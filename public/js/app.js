// public/js/app.js
// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL APP UTILITIES
//
// This file contains code that runs on EVERY page:
// - Profile dropdown toggle
// - Flash message auto-dismiss
// - Common utility functions
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ── PROFILE DROPDOWN ───────────────────────────────────────────────────────
  const profileTrigger  = document.getElementById('profile-trigger');
  const profileDropdown = document.getElementById('profile-dropdown');

  if (profileTrigger && profileDropdown) {
    profileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle('open');
    });

    // Close when clicking anywhere else on the page
    document.addEventListener('click', () => {
      profileDropdown.classList.remove('open');
    });
  }

  // ── FLASH MESSAGE AUTO-DISMISS ─────────────────────────────────────────────
  // Flash messages fade out and are removed after 4 seconds
  const flashes = document.querySelectorAll('.flash');
  flashes.forEach(flash => {
    // After animation completes (4s), remove the element from DOM
    setTimeout(() => flash.remove(), 4400);
  });

  // ── KEYBOARD SHORTCUT: ESC TO CLOSE MODAL ─────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close modal if open
      const overlay = document.getElementById('modal-overlay');
      if (overlay?.classList.contains('open')) {
        closeModal();
        return;
      }
    }
  });

  // ── MAIN TAB SWITCHING (on homepage) ──────────────────────────────────────
  // Handle URL hash (#recommendations, etc.) on page load
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById(`tab-${hash}`)) {
    const btn = document.querySelector(`[data-tab="${hash}"]`);
    if (btn) switchMainTab(hash, btn);
  }
});

/**
 * switchMainTab — Switch between Search / For You / Continue Reading tabs
 * @param {string} tabName - 'search' | 'recommendations' | 'history'
 * @param {HTMLElement} clickedBtn - The button that was clicked
 */
function switchMainTab(tabName, clickedBtn) {
  // Deactivate all tabs
  document.querySelectorAll('.main-tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(panel => panel.classList.remove('active'));

  // Activate the clicked tab
  clickedBtn.classList.add('active');
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');

  // Load data for the tab if needed
  if (tabName === 'recommendations' && window.APP_USER) {
    loadRecommendations();
  }
  if (tabName === 'history' && window.APP_USER) {
    loadReadingHistory();
  }
}

/**
 * loadRecommendations — Fetch and display personalized book recommendations
 */
async function loadRecommendations() {
  const grid = document.getElementById('rec-grid');
  if (!grid) return;

  // Don't reload if already loaded
  if (grid.dataset.loaded) return;

  grid.innerHTML = '<div class="state-msg"><div class="spinner"></div>Analyzing your reading history…</div>';

  try {
    const res  = await fetch('/api/books/user/recommendations');
    const data = await res.json();

    if (!res.ok || !data.results?.length) {
      grid.innerHTML = '<div class="state-msg">Read a few books to get personalized recommendations! 📚</div>';
      return;
    }

    grid.innerHTML = '';
    data.results.forEach((book, i) => {
      grid.appendChild(createBookCard(book, i, { showReason: true }));
    });
    grid.dataset.loaded = '1'; // Mark as loaded

  } catch (err) {
    grid.innerHTML = '<div class="state-msg">Could not load recommendations.</div>';
  }
}

/**
 * loadReadingHistory — Fetch and display "continue reading" history
 */
async function loadReadingHistory() {
  const grid = document.getElementById('history-grid');
  if (!grid) return;

  if (grid.dataset.loaded) return;

  grid.innerHTML = '<div class="state-msg"><div class="spinner"></div>Loading…</div>';

  try {
    const res  = await fetch('/api/user/history');
    const data = await res.json();

    if (!res.ok || !data.length) {
      grid.innerHTML = '<div class="state-msg">Start reading to track your history! 📖</div>';
      return;
    }

    // Filter to books that are in progress (not 100% complete)
    const inProgress = data.filter(h => h.progressPercent > 0 && h.progressPercent < 100);
    const display    = inProgress.length ? inProgress : data;

    grid.innerHTML = '';
    display.forEach((record, i) => {
      // History records are a bit different from search results — adapt them
      const bookLike = {
        id:      record.gutenbergId,
        title:   record.title,
        authors: [{ name: record.author || 'Unknown' }],
        formats: { 'image/jpeg': record.coverUrl },
        subjects: record.subjects || [],
        _progress: record.progressPercent,
        _reason:   `${record.progressPercent}% read`
      };
      grid.appendChild(createBookCard(bookLike, i, { showProgress: true }));
    });
    grid.dataset.loaded = '1';

  } catch (err) {
    grid.innerHTML = '<div class="state-msg">Could not load history.</div>';
  }
}

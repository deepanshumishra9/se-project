// public/js/dashboard.js
// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD: Reading History, Reading Goals, Stats, Reminder Settings
//
// Loads when the user clicks the "📊 Dashboard" tab.
// Makes API calls to fetch their data and renders it into the DOM.
// ─────────────────────────────────────────────────────────────────────────────

// ── STATE ──────────────────────────────────────────────────────────────────────
let dashboardLoaded  = false;   // Prevents duplicate fetches
let currentStats     = null;    // Cached stats response

// ── ENTRY POINT ────────────────────────────────────────────────────────────────
// Called by index.ejs when the Dashboard tab is clicked
async function loadDashboard() {
  if (!window.APP_USER) return;
  if (dashboardLoaded) return;
  dashboardLoaded = true;

  try {
    await Promise.all([
      fetchAndRenderStats(),
      fetchAndRenderHistory(),
      fetchAndRenderReminder()
    ]);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS & GOALS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAndRenderStats() {
  try {
    const res  = await fetch('/api/user/stats');
    const data = await res.json();
    currentStats = data;

    // ── Stat Cards ─────────────────────────────────────────────────────────
    setEl('dash-total-books',     data.totalBooks       || 0);
    setEl('dash-completed-books', data.completedBooks   || 0);
    setEl('dash-streak',          `${data.currentStreak || 0} 🔥`);
    setEl('dash-hours-read',      `${data.totalHours    || 0}h`);
    setEl('dash-minutes-today',   `${data.minutesReadToday || 0} min`);

    // ── 7-day Bar Chart ────────────────────────────────────────────────────
    renderMiniBarChart(data.last7DaysLogs || []);

    // ── Goals ──────────────────────────────────────────────────────────────
    renderGoals(data.goals || []);

  } catch (err) {
    console.error('Stats fetch error:', err);
  }
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── 7-Day Bar Chart ────────────────────────────────────────────────────────────
function renderMiniBarChart(logs) {
  const container = document.getElementById('dash-bar-chart');
  if (!container) return;

  // Build a map of date-string → minutes
  const logMap = {};
  logs.forEach(log => {
    const d = new Date(log.date);
    logMap[d.toDateString()] = log.minutesRead || 0;
  });

  // Generate last 7 days
  const days    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxMins = Math.max(1, ...Object.values(logMap));

  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d      = new Date();
    d.setDate(d.getDate() - i);
    const key    = d.toDateString();
    const mins   = logMap[key] || 0;
    const pct    = Math.round((mins / maxMins) * 100);
    const dayLabel = i === 0 ? 'Today' : days[d.getDay()];

    html += `
      <div class="bar-col">
        <div class="bar-wrap" title="${mins} min">
          <div class="bar-fill ${mins > 0 ? 'active' : ''}" style="height:${pct}%"></div>
        </div>
        <div class="bar-label">${dayLabel}</div>
        <div class="bar-mins">${mins > 0 ? mins + 'm' : ''}</div>
      </div>`;
  }
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════════════════════

const GOAL_META = {
  books_per_month: { label: 'Books this Month',  icon: '📅', unit: 'books',   period: 'monthly' },
  books_per_year:  { label: 'Books this Year',   icon: '📆', unit: 'books',   period: 'yearly'  },
  minutes_per_day: { label: 'Minutes per Day',   icon: '⏱️', unit: 'minutes', period: 'daily'   }
};

function renderGoals(goals) {
  const container = document.getElementById('dash-goals-list');
  if (!container) return;

  if (goals.length === 0) {
    container.innerHTML = `
      <div class="dash-empty">
        <div class="dash-empty-icon">🎯</div>
        <p>No reading goals yet.</p>
        <p style="font-size:.75rem;margin-top:4px">Use the form below to add one!</p>
      </div>`;
    return;
  }

  container.innerHTML = goals.map(goal => {
    const meta    = GOAL_META[goal.type] || { label: goal.type, icon: '📖', unit: '' };
    const pct     = goal.progressPercent || 0;
    const achieved = goal.achieved;

    return `
      <div class="goal-card ${achieved ? 'goal-achieved' : ''}">
        <div class="goal-card-header">
          <span class="goal-icon">${meta.icon}</span>
          <div class="goal-info">
            <div class="goal-label">${meta.label}</div>
            <div class="goal-progress-text">
              ${achieved ? '🏆 Goal Achieved!' : `${goal.current} / ${goal.target} ${meta.unit}`}
            </div>
          </div>
          <button class="goal-delete-btn" onclick="deleteGoal('${goal.id}')" title="Delete goal">✕</button>
        </div>
        <div class="goal-progress-bar-wrap">
          <div class="goal-progress-bar">
            <div class="goal-progress-fill ${achieved ? 'fill-achieved' : ''}"
                 style="width:${pct}%"></div>
          </div>
          <span class="goal-pct">${pct}%</span>
        </div>
      </div>`;
  }).join('');
}

async function createGoal(event) {
  event.preventDefault();
  const type   = document.getElementById('goal-type-select').value;
  const target = document.getElementById('goal-target-input').value;
  const period = GOAL_META[type]?.period || 'monthly';

  if (!target || parseInt(target) < 1) {
    showToast('⚠️ Please enter a valid target number.', 'warning');
    return;
  }

  try {
    const res  = await fetch('/api/user/goals', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, target: parseInt(target), period })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌ ' + (data.error || 'Failed to create goal.'), 'error'); return; }

    showToast('🎯 Goal created!', 'success');
    dashboardLoaded = false;  // Force refresh
    await fetchAndRenderStats();
    dashboardLoaded = true;
  } catch (err) {
    showToast('❌ Network error.', 'error');
  }
}

async function deleteGoal(goalId) {
  if (!confirm('Delete this goal?')) return;
  try {
    await fetch(`/api/user/goals/${goalId}`, { method: 'DELETE' });
    showToast('✓ Goal removed.', 'info');
    dashboardLoaded = false;
    await fetchAndRenderStats();
    dashboardLoaded = true;
  } catch (err) {
    showToast('❌ Failed to delete goal.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// READING HISTORY (Dashboard view)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAndRenderHistory() {
  const container = document.getElementById('dash-history-list');
  if (!container) return;

  container.innerHTML = '<div class="dash-loading"><div class="spinner"></div>Loading history…</div>';

  try {
    const res     = await fetch('/api/user/history');
    const history = await res.json();

    if (!history.length) {
      container.innerHTML = `
        <div class="dash-empty">
          <div class="dash-empty-icon">📭</div>
          <p>No reading history yet.</p>
          <p style="font-size:.75rem;margin-top:4px">Open a book to get started!</p>
        </div>`;
      return;
    }

    container.innerHTML = history.map(item => {
      const cover = item.coverUrl
        ? `<img src="${item.coverUrl}" alt="" class="hist-cover" onerror="this.style.display='none'">`
        : `<div class="hist-cover-placeholder">📚</div>`;

      const lastRead = new Date(item.lastReadAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
      });

      const prog     = item.progressPercent || 0;
      const badge    = item.completed
        ? '<span class="hist-badge hist-badge-done">✓ Completed</span>'
        : prog > 0
          ? `<span class="hist-badge hist-badge-progress">${prog}% read</span>`
          : '<span class="hist-badge hist-badge-new">New</span>';

      return `
        <div class="hist-item" id="hist-${item.gutenbergId}">
          ${cover}
          <div class="hist-details">
            <div class="hist-title">${escapeHtml(item.title)}</div>
            <div class="hist-author">by ${escapeHtml(item.author || 'Unknown')}</div>
            <div class="hist-meta">
              ${badge}
              <span class="hist-date">Last read: ${lastRead}</span>
            </div>
            <div class="hist-prog-wrap">
              <div class="hist-prog-bar">
                <div class="hist-prog-fill" style="width:${prog}%"></div>
              </div>
            </div>
          </div>
          <div class="hist-actions">
            <button class="hist-resume-btn"
              onclick="openBook(event, ${item.gutenbergId}, 'read')"
              title="Resume reading">▶ Resume</button>
            <button class="hist-del-btn"
              onclick="deleteHistoryItem(${item.gutenbergId})"
              title="Remove from history">✕</button>
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    container.innerHTML = '<div class="dash-empty">Failed to load history.</div>';
  }
}

async function deleteHistoryItem(gutenbergId) {
  if (!confirm('Remove this book from your history?')) return;
  try {
    await fetch(`/api/user/history/${gutenbergId}`, { method: 'DELETE' });
    const el = document.getElementById(`hist-${gutenbergId}`);
    if (el) el.remove();
    showToast('✓ Removed from history.', 'info');
  } catch (err) {
    showToast('❌ Failed to remove.', 'error');
  }
}

async function clearAllHistory() {
  if (!confirm('Clear ALL reading history? This cannot be undone.')) return;
  try {
    await fetch('/api/user/history', { method: 'DELETE' });
    showToast('✓ History cleared.', 'info');
    await fetchAndRenderHistory();
  } catch (err) {
    showToast('❌ Failed to clear history.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// READING REMINDER
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAndRenderReminder() {
  try {
    const res      = await fetch('/api/user/reminder');
    const reminder = await res.json();

    const timeInput    = document.getElementById('reminder-time-input');
    const enableToggle = document.getElementById('reminder-enabled');

    if (timeInput)    timeInput.value   = reminder.reminderTime || '09:00';
    if (enableToggle) enableToggle.checked = reminder.enabled !== false;
  } catch (err) {
    // silently fail
  }
}

async function saveReminder(event) {
  event.preventDefault();
  const reminderTime = document.getElementById('reminder-time-input')?.value;
  const enabled      = document.getElementById('reminder-enabled')?.checked;

  // Get browser timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  try {
    const res  = await fetch('/api/user/reminder', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reminderTime, enabled, timezone })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌ ' + data.error, 'error'); return; }
    showToast(`✅ Reminder ${enabled ? 'set for ' + reminderTime : 'disabled'}!`, 'success');
  } catch (err) {
    showToast('❌ Failed to save reminder.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * showToast — Display a non-blocking floating notification
 * @param {string} message  - Text to display
 * @param {string} type     - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - How long to show in ms (default 3500)
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = getOrCreateToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-msg">${message}</span>
                     <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

function getOrCreateToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

// Make showToast globally available so reader.js can call it on goal achievement
window.showToast = showToast;

// ── UTILITY ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

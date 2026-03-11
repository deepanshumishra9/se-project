// public/js/notifications.js
// ─────────────────────────────────────────────────────────────────────────────
// IN-APP NOTIFICATION SYSTEM
//
// This script handles the notification bell icon in the navbar.
// It polls the server every 60 seconds for new notifications and
// updates the bell badge count.
//
// Only runs when a user is logged in (checks window.APP_USER)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Only run notifications code if the user is logged in
  if (!window.APP_USER) return;

  const notifBtn      = document.getElementById('notif-btn');
  const notifBadge    = document.getElementById('notif-badge');
  const notifPanel    = document.getElementById('notif-panel');
  const notifList     = document.getElementById('notif-list');
  const notifReadAll  = document.getElementById('notif-read-all');

  // Guard: these elements only exist for logged-in users
  if (!notifBtn || !notifPanel) return;

  let isOpen = false;

  // ── TOGGLE PANEL ───────────────────────────────────────────────────────────
  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent the document click handler from closing it immediately
    isOpen = !isOpen;
    notifPanel.classList.toggle('open', isOpen);

    if (isOpen) {
      loadNotifications(); // Refresh list when opening
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (isOpen && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      isOpen = false;
      notifPanel.classList.remove('open');
    }
  });

  // ── MARK ALL READ ───────────────────────────────────────────────────────────
  notifReadAll?.addEventListener('click', async () => {
    try {
      await fetch('/api/notifications/read-all', { method: 'PATCH' });
      // Update UI: remove unread styling from all items
      document.querySelectorAll('.notif-item.unread').forEach(el => {
        el.classList.remove('unread');
        // Remove the dot indicator
        const dot = el.querySelector('.unread-dot');
        if (dot) dot.remove();
      });
      updateBadge(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  });

  // ── LOAD NOTIFICATIONS ──────────────────────────────────────────────────────
  async function loadNotifications() {
    try {
      const res  = await fetch('/api/notifications');
      const data = await res.json();

      if (!res.ok) return;

      updateBadge(data.unreadCount);
      renderNotifications(data.notifications);
    } catch (err) {
      // Don't crash the page if notifications fail
      console.debug('Notifications fetch error:', err);
    }
  }

  // ── RENDER NOTIFICATIONS ────────────────────────────────────────────────────
  function renderNotifications(notifications) {
    if (!notifList) return;

    if (!notifications || notifications.length === 0) {
      notifList.innerHTML = '<div class="notif-empty">You\'re all caught up! 🎉</div>';
      return;
    }

    // Build HTML for each notification
    notifList.innerHTML = notifications.map(n => `
      <div
        class="notif-item ${n.read ? '' : 'unread'}"
        data-id="${n.id}"
        onclick="handleNotifClick(${n.id}, ${JSON.stringify(n.link || '').replace(/"/g, '&quot;')})"
      >
        <div class="notif-item-content">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-body">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  // ── UPDATE BADGE COUNT ──────────────────────────────────────────────────────
  function updateBadge(count) {
    if (!notifBadge) return;
    if (count > 0) {
      notifBadge.style.display = 'flex';
      notifBadge.textContent   = count > 99 ? '99+' : count;
    } else {
      notifBadge.style.display = 'none';
    }
  }

  // ── INITIAL LOAD + POLLING ──────────────────────────────────────────────────
  // Load immediately when page opens
  loadNotifications();

  // Then check every 60 seconds for new notifications
  // This is called "polling" — a simple alternative to WebSockets
  setInterval(loadNotifications, 60 * 1000);
});

/**
 * handleNotifClick — Called when user clicks a notification
 * Marks it as read, then navigates to the linked page if any.
 * Made global so inline onclick can call it.
 */
async function handleNotifClick(id, link) {
  try {
    // Mark as read server-side
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });

    // Update UI
    const el = document.querySelector(`.notif-item[data-id="${id}"]`);
    if (el) el.classList.remove('unread');

    // Update badge (re-fetch count)
    const res  = await fetch('/api/notifications');
    const data = await res.json();
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent   = data.unreadCount || 0;
      badge.style.display = data.unreadCount > 0 ? 'flex' : 'none';
    }

    // Navigate if there's a link
    if (link && link !== 'null') {
      window.location.href = link;
    }
  } catch (err) {
    console.debug('Notification click error:', err);
  }
}

// ── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * timeAgo — Convert a timestamp to "2 hours ago", "yesterday", etc.
 */
function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now  = new Date();
  const diff = now - date; // milliseconds

  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);

  if (minutes < 1)  return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24)   return `${hours}h ago`;
  if (days < 7)     return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * escapeHtml — Prevent XSS attacks by escaping HTML special characters
 * IMPORTANT: Always escape user-generated content before inserting into HTML!
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

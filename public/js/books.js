// public/js/books.js
// ─────────────────────────────────────────────────────────────────────────────
// BOOK SEARCH, DISPLAY, AND MODAL LOGIC
//
// This file handles:
// 1. Searching books via the Gutenberg API (through our backend)
// 2. Creating book cards (the tiles you see in the grid)
// 3. Opening the book modal (the popup with Read/Download/Info tabs)
// 4. Bookmarking books
// ─────────────────────────────────────────────────────────────────────────────

// ── STATE VARIABLES ────────────────────────────────────────────────────────────
// These variables store the current state of the app.
// They need to survive across function calls, so we keep them at the top level.
let currentPage  = 1;
let nextUrl      = null;
let prevUrl      = null;
let currentQuery = window.APP_INITIAL_SEARCH || 'Pride and Prejudice';
let currentTopic = '';
let currentBook  = null;  // The book currently shown in the modal
let loadedBookId = null;  // Prevents re-fetching text for the same book

// booksMap: a lookup table { bookId → bookData }
// This lets us quickly find a book's data when the user clicks on it
const booksMap = {};

// ── INITIALIZATION ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Set up the Enter key for search
  document.getElementById('q')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') search();
  });

  // Set up topic chip clicks
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      // Deactivate all chips, activate the clicked one
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentTopic = chip.dataset.topic || '';
      search(); // Re-run search with the new topic filter
    });
  });

  // Close modal when pressing Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Do the initial search on page load
  search();
});

// ── SEARCH ─────────────────────────────────────────────────────────────────────
/**
 * search — Fetch books from our API and display them
 * Called when the user types a query and clicks Search or presses Enter
 */
async function search() {
  const q = document.getElementById('q')?.value.trim() || '';
  currentQuery = q;
  currentPage  = 1;

  // Build the API URL with query parameters
  const params = new URLSearchParams();
  if (q)            params.set('q', q);
  if (currentTopic) params.set('topic', currentTopic);

  await fetchBooks(`/api/books/search?${params.toString()}`);
}

/**
 * changePage — Navigate to next/previous page of results
 * @param {number} dir — +1 for next, -1 for previous
 */
async function changePage(dir) {
  const url = dir === 1 ? nextUrl : prevUrl;
  if (!url) return;

  currentPage += dir;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Convert the external Gutendex URL to our internal proxy URL
  // (We route all API calls through our backend to add auth and enrichment)
  const urlObj = new URL(url);
  const params = new URLSearchParams(urlObj.search);
  await fetchBooks(`/api/books/search?${params.toString()}`);
}

/**
 * fetchBooks — Core function: call the API and render the results
 * @param {string} url - API endpoint URL
 */
async function fetchBooks(url) {
  const grid   = document.getElementById('book-grid');
  const meta   = document.getElementById('meta-bar');
  const pagin  = document.getElementById('pagination');

  // Show loading state
  if (grid) grid.innerHTML = '<div class="state-msg"><div class="spinner"></div>Searching…</div>';
  if (meta)  meta.style.display  = 'none';
  if (pagin) pagin.style.display = 'none';

  try {
    const res  = await fetch(url);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Search failed');

    // Save pagination URLs for the prev/next buttons
    // Note: we need to extract page param and use our own API URL
    nextUrl = data.next ? buildPageUrl(currentPage + 1) : null;
    prevUrl = currentPage > 1 ? buildPageUrl(currentPage - 1) : null;

    const results = data.results || [];

    // Render all book cards
    renderBooks(results);

    // Update metadata bar
    if (meta) {
      meta.style.display = 'flex';
      document.getElementById('meta-text').innerHTML =
        `About <strong>${(data.count || 0).toLocaleString()}</strong> results for <strong>"${currentQuery}"</strong>`;
    }

    // Show pagination if there are multiple pages
    const totalPages = Math.ceil((data.count || 0) / 32);
    if (totalPages > 1 && pagin) {
      pagin.style.display = 'flex';
      document.getElementById('prev-btn').disabled = currentPage <= 1;
      document.getElementById('next-btn').disabled = !data.next;
      document.getElementById('pg-info').textContent = `Page ${currentPage} of ${totalPages}`;
    }

  } catch (err) {
    if (grid) grid.innerHTML = `<div class="state-msg">❌ ${err.message}</div>`;
  }
}

function buildPageUrl(page) {
  const params = new URLSearchParams();
  if (currentQuery) params.set('q', currentQuery);
  if (currentTopic) params.set('topic', currentTopic);
  params.set('page', page);
  return `/api/books/search?${params.toString()}`;
}

// ── RENDER BOOKS ───────────────────────────────────────────────────────────────
/**
 * renderBooks — Create card elements for each book and add to grid
 * @param {Array} books - Array of book objects from the API
 */
function renderBooks(books) {
  const grid = document.getElementById('book-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!books.length) {
    grid.innerHTML = '<div class="state-msg">No results found. Try a different search.</div>';
    return;
  }

  books.forEach((book, index) => {
    // Store in lookup table so we can find it when the user clicks
    booksMap[book.id] = book;
    const card = createBookCard(book, index);
    grid.appendChild(card);
  });
}

/**
 * createBookCard — Build a single book card DOM element
 * @param {Object} book  - Book data from API
 * @param {number} index - Position in the list (used for animation delay)
 * @param {Object} opts  - { showReason: bool, showProgress: bool }
 * @returns {HTMLElement} The card element
 */
function createBookCard(book, index = 0, opts = {}) {
  const title   = book.title || 'Untitled';
  const authors = (book.authors || []).map(a => a.name).join(', ') || 'Unknown';
  const cover   = book.formats?.['image/jpeg'] || '';
  const formats = book.formats_parsed || [];
  const id      = book.id;

  // Store in booksMap if not already there
  booksMap[id] = book;

  // ── BUILD COVER HTML ──────────────────────────────────────────────────────
  const coverHtml = cover
    ? `<img
         src="${cover}"
         alt="${escapeAttr(title)}"
         loading="lazy"
         onerror="this.outerHTML='<div class=cover-placeholder>📚<span>${escapeHtml(title).slice(0,28)}</span></div>'"
       >`
    : `<div class="cover-placeholder">📚<span>${escapeHtml(title).slice(0, 28)}</span></div>`;

  // ── FORMAT PILLS ──────────────────────────────────────────────────────────
  const formatPills = formats.map(f =>
    `<span class="fmt-pill fmt-${f.key}">${f.label}</span>`
  ).join('');

  // ── HOVER BUTTONS ─────────────────────────────────────────────────────────
  const hoverBtns = formats.length
    ? `<button class="ov-btn read" onclick="openBook(event,${id},'read')">Read</button>
       <button class="ov-btn dl"   onclick="openBook(event,${id},'download')">Download</button>`
    : `<button class="ov-btn dl" style="opacity:.4;cursor:default">No Files</button>`;

  // ── PROGRESS BAR (for history cards) ─────────────────────────────────────
  const progressBar = opts.showProgress && book._progress
    ? `<div class="card-progress-bar">
         <div class="card-progress-fill" style="width:${book._progress}%"></div>
       </div>`
    : '';

  // ── RECOMMENDATION REASON ─────────────────────────────────────────────────
  const reasonHtml = (opts.showReason || opts.showProgress) && book._reason
    ? `<div class="rec-reason">✦ ${escapeHtml(book._reason)}</div>`
    : '';

  // ── ALREADY READ BADGE ────────────────────────────────────────────────────
  const alreadyReadBadge = book.already_read
    ? '<span class="badge-read">✓ Read</span>'
    : '';

  // ── ASSEMBLE CARD ─────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'book-card';
  card.style.animationDelay = `${index * 50}ms`; // Staggered fade-in animation

  card.innerHTML = `
    <div class="cover-wrap">
      ${coverHtml}
      <span class="cover-badge ${formats.length ? 'badge-ok' : 'badge-none'}">
        ${formats.length ? '✓ Available' : 'Not Available'}
      </span>
      ${alreadyReadBadge}
      <div class="hover-overlay">${hoverBtns}</div>
      ${progressBar}
    </div>
    <div class="card-body">
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-author">by ${escapeHtml(authors)}</div>
      <div class="card-formats">${formatPills}</div>
      ${reasonHtml}
    </div>
  `;

  // Clicking the card (not the hover buttons) opens the Read tab
  card.addEventListener('click', e => {
    if (!e.target.closest('.ov-btn')) {
      openBook(e, id, 'read');
    }
  });

  return card;
}

// ── MODAL ──────────────────────────────────────────────────────────────────────

/**
 * openBook — Open the book modal and show a specific tab
 * @param {Event} e      - The click event
 * @param {number} id    - Gutenberg book ID
 * @param {string} tab   - Which tab to show: 'read' | 'download' | 'info'
 */
async function openBook(e, id, tab = 'read') {
  e.stopPropagation();

  // If we don't have the book data yet, fetch it
  let book = booksMap[id];
  if (!book) {
    try {
      const res = await fetch(`/api/books/${id}`);
      book = await res.json();
      booksMap[id] = book;
    } catch (err) {
      console.error('Failed to fetch book:', err);
      return;
    }
  }

  // Reset reader if it's a different book
  if (currentBook?.id !== id) {
    loadedBookId = null;
    document.getElementById('reader-body').innerHTML =
      '<div class="reader-loading"><div class="spinner"></div>Loading text…</div>';
  }

  currentBook = book;

  // ── POPULATE MODAL HEADER ─────────────────────────────────────────────────
  const cover   = book.formats?.['image/jpeg'] || '';
  const authors = (book.authors || []).map(a => a.name).join(', ') || 'Unknown';

  const mCover = document.getElementById('m-cover');
  if (mCover) {
    mCover.src   = cover;
    mCover.alt   = book.title;
    mCover.style.display = cover ? 'block' : 'none';
  }

  document.getElementById('m-title').textContent  = book.title || 'Untitled';
  document.getElementById('m-author').textContent = `by ${authors}`;

  // ── POPULATE TABS ─────────────────────────────────────────────────────────
  buildDownloadTab(book);
  buildInfoTab(book);

  // Check bookmark status
  await checkBookmarkStatus(id);

  // ── SHOW MODAL ────────────────────────────────────────────────────────────
  switchTabById(tab);
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden'; // Prevent background scrolling

  // Load text if opening read tab
  if (tab === 'read') {
    loadText(book);
  }
}

/**
 * closeModal — Close the modal
 */
function closeModal() {
  document.getElementById('modal-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

/**
 * handleOverlayClick — Close modal when clicking the dark backdrop
 */
function handleOverlayClick(e) {
  if (e.target.id === 'modal-overlay') closeModal();
}

/**
 * switchTab — Switch between tabs inside the modal
 * @param {string} name - Tab name
 * @param {HTMLElement} btn - The clicked tab button
 */
function switchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'read' && currentBook) {
    loadText(currentBook);
  }
}

function switchTabById(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tb-' + name)?.classList.add('active');
  document.getElementById('tab-' + name)?.classList.add('active');
}

// ── DOWNLOAD TAB ───────────────────────────────────────────────────────────────
function buildDownloadTab(book) {
  const formats  = book.formats_parsed || [];
  const dlGrid   = document.getElementById('dl-grid');
  const dlRaw    = document.getElementById('dl-raw-links');
  const buySection = document.getElementById('buy-section');
  const buyLinks = document.getElementById('buy-links');

  if (!dlGrid) return;

  if (formats.length === 0) {
    dlGrid.innerHTML = '<p style="color:var(--muted);font-size:.8rem;grid-column:1/-1">No downloadable files found for this book.</p>';

    // Show buy links when no ebook is available
    if (buySection && book.buy_links) {
      buySection.style.display = 'block';
      buyLinks.innerHTML = `
        <a href="${book.buy_links.amazon}" target="_blank" rel="noopener" class="buy-link-btn buy-link-amazon">
          📦 Find on Amazon
        </a>
        <a href="${book.buy_links.flipkart}" target="_blank" rel="noopener" class="buy-link-btn buy-link-flipkart">
          🛒 Find on Flipkart
        </a>
      `;
    }
  } else {
    if (buySection) buySection.style.display = 'none';
    dlGrid.innerHTML = formats.map(f => `
      <a class="dl-card ${f.key}" href="${f.url}" download target="_blank" rel="noopener">
        <div class="dl-card-icon">${f.icon}</div>
        <div class="dl-card-fmt">${f.label}</div>
        <div class="dl-card-desc">${f.desc}</div>
        <div class="dl-card-action">⬇ Download ${f.label}</div>
      </a>
    `).join('');
  }

  if (dlRaw) {
    dlRaw.innerHTML = formats.map(f =>
      `<div>
         <span style="opacity:.5">${f.label}: </span>
         <a href="${f.url}" target="_blank" style="color:var(--accent);word-break:break-all">${f.url}</a>
       </div>`
    ).join('');
  }
}

// ── INFO TAB ───────────────────────────────────────────────────────────────────
function buildInfoTab(book) {
  const grid = document.getElementById('info-grid');
  if (!grid) return;

  const authors = (book.authors || []).map(a => {
    let s = a.name;
    if (a.birth_year) s += ` (${a.birth_year}–${a.death_year || '?'})`;
    return s;
  }).join('<br>') || 'Unknown';

  grid.innerHTML = [
    ['Gutenberg ID',    `#${book.id}`],
    ['Downloads (30d)', (book.download_count || 0).toLocaleString()],
    ['Language',        (book.languages || []).map(l => l.toUpperCase()).join(', ') || '–'],
    ['Copyright',       book.copyright ? 'Copyrighted' : '✓ Public Domain'],
    ['Author(s)',        authors],
    ['Subjects',        (book.subjects || []).slice(0, 6).join(', ') || '–'],
    ['Bookshelves',     (book.bookshelves || []).join(', ') || '–'],
  ].map(([label, value]) => `
    <div class="detail-item">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </div>
  `).join('');
}

// ── BOOKMARK ───────────────────────────────────────────────────────────────────
async function checkBookmarkStatus(gutenbergId) {
  if (!window.APP_USER) return;
  const btn = document.getElementById('modal-bookmark-btn');
  if (!btn) return;

  try {
    const res  = await fetch('/api/user/bookmarks');
    const data = await res.json();
    const isBookmarked = Array.isArray(data) && data.some(b => b.gutenbergId === gutenbergId);
    btn.classList.toggle('bookmarked', isBookmarked);
    btn.title = isBookmarked ? 'Remove bookmark' : 'Add bookmark';
  } catch (err) {
    // Silently fail
  }
}

async function toggleBookmark() {
  if (!window.APP_USER) {
    window.location.href = '/auth/login';
    return;
  }
  if (!currentBook) return;

  const btn = document.getElementById('modal-bookmark-btn');
  const isBookmarked = btn.classList.contains('bookmarked');

  try {
    if (isBookmarked) {
      await fetch(`/api/user/bookmarks/${currentBook.id}`, { method: 'DELETE' });
      btn.classList.remove('bookmarked');
      btn.title = 'Add bookmark';
    } else {
      await fetch('/api/user/bookmarks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          gutenbergId: currentBook.id,
          title:   currentBook.title,
          author:  currentBook.authors?.[0]?.name,
          coverUrl: currentBook.formats?.['image/jpeg']
        })
      });
      btn.classList.add('bookmarked');
      btn.title = 'Remove bookmark';
    }
  } catch (err) {
    console.error('Bookmark error:', err);
  }
}

// ── STAR RATING ────────────────────────────────────────────────────────────────
async function rateBook(rating) {
  if (!window.APP_USER || !currentBook) return;

  try {
    await fetch(`/api/books/${currentBook.id}/rate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rating })
    });

    // Update star visuals
    document.querySelectorAll('.star-btn').forEach((btn, i) => {
      btn.textContent = i < rating ? '★' : '☆';
      btn.classList.toggle('filled', i < rating);
    });
  } catch (err) {
    console.error('Rating error:', err);
  }
}

// ── UTILITIES ──────────────────────────────────────────────────────────────────

/**
 * escapeHtml — Prevent XSS by encoding special HTML characters
 * Always use this when inserting user/API data into innerHTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * escapeAttr — Escape a string for use in an HTML attribute
 */
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

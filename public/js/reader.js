// public/js/reader.js
// ─────────────────────────────────────────────────────────────────────────────
// IN-APP EBOOK READER
//
// This handles everything about reading books inside the browser:
// 1. Fetching the book's text from Project Gutenberg
// 2. Cleaning up the raw text (removing headers, footers)
// 3. Rendering it as readable HTML
// 4. Tracking reading progress (scrolled %, time spent)
// 5. Saving progress to the server every 30 seconds
//
// PROJECT GUTENBERG NOTE:
// Gutenberg serves plain .txt files with this structure:
//   [Title/author info]
//   *** START OF THIS PROJECT GUTENBERG EBOOK ... ***
//   [The actual book content]
//   *** END OF THIS PROJECT GUTENBERG EBOOK ... ***
//   [Legal notices]
// We strip the header/footer and render just the content.
// ─────────────────────────────────────────────────────────────────────────────

// Track time spent reading (for habit tracking)
let readingStartTime = null;
let progressSaveTimer = null;  // Timer to save progress periodically

/**
 * loadText — Fetch and display a book's text content in the reader
 * @param {Object} book - The book object (needs book.id and book.formats)
 */
async function loadText(book) {
  // Don't reload if we're already showing this book
  if (loadedBookId === book.id) return;

  const rb = document.getElementById('reader-body');
  if (!rb) return;

  rb.innerHTML = '<div class="reader-loading"><div class="spinner"></div>Fetching from Project Gutenberg…</div>';

  // Find the best URL to fetch — prefer plain text, fall back to HTML
  const src = getBestTextUrlFromFormats(book.formats || {});

  if (!src) {
    rb.innerHTML = `
      <div class="reader-loading">
        ⚠ No readable format available.<br><br>
        <small style="color:var(--muted)">Try the Download tab to get the file.</small>
      </div>`;
    return;
  }

  try {
    // Fetch the raw text directly from Gutenberg's servers
    // NOTE: This works due to CORS being open on gutenberg.org
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    loadedBookId = book.id;

    // Render the text based on its format
    if (src.type === 'txt') {
      renderTxt(text, rb);
    } else {
      renderHtmlContent(text, rb);
    }

    // ── RESTORE READING POSITION ──────────────────────────────────────────
    // If the user has read this book before, scroll to where they left off
    const savedProgress = getSavedProgress(book.id);
    if (savedProgress > 0) {
      // Wait for render to complete, then scroll
      setTimeout(() => {
        const targetScroll = (rb.scrollHeight - rb.clientHeight) * (savedProgress / 100);
        rb.scrollTop = targetScroll;
      }, 100);
    }

    // ── APPLY USER PREFERENCES ────────────────────────────────────────────
    // Restore font/theme settings if the user has set them
    if (window.APP_USER?.preferences) {
      const prefs = window.APP_USER.preferences;
      if (prefs.readerTheme) setReaderTheme(prefs.readerTheme);
      if (prefs.fontSize)    setFontSize(prefs.fontSize);
    }

    // ── TRACK READING PROGRESS ────────────────────────────────────────────
    setupProgressTracking(book, rb);

  } catch (err) {
    console.error('Reader fetch error:', err);
    rb.innerHTML = `
      <div class="reader-loading" style="text-align:center">
        ⚠ Could not load text.<br>
        <small style="color:var(--muted);margin-top:8px;display:block">
          CORS restrictions may prevent direct loading in some cases.
          Use the Download tab instead.
        </small>
      </div>`;
  }
}

/**
 * renderTxt — Render a plain .txt book file as formatted HTML
 *
 * Gutenberg .txt files use blank lines to separate paragraphs.
 * We detect chapter headings and format them as <h2> elements.
 *
 * @param {string} raw - Raw text content from the .txt file
 * @param {HTMLElement} container - The reader body element
 */
function renderTxt(raw, container) {
  // ── STRIP GUTENBERG HEADER/FOOTER ─────────────────────────────────────────
  // These patterns mark where the actual book content starts and ends
  const startPattern = /\*{3}\s*START OF (THIS|THE) PROJECT GUTENBERG EBOOK[^\n]*\n/i;
  const endPattern   = /\*{3}\s*END OF (THIS|THE) PROJECT GUTENBERG EBOOK/i;

  let body = raw;
  const startMatch = raw.search(startPattern);
  const endMatch   = raw.search(endPattern);

  if (startMatch !== -1) {
    // Find the newline after the start marker
    body = body.slice(raw.indexOf('\n', startMatch) + 1);
  }
  if (endMatch !== -1) {
    // Re-find the end in the trimmed body
    const endInBody = body.search(endPattern);
    if (endInBody !== -1) body = body.slice(0, endInBody);
  }

  // ── SPLIT INTO PARAGRAPHS ──────────────────────────────────────────────────
  // Gutenberg uses blank lines (two newlines) to separate paragraphs
  const paragraphs = body.split(/\r?\n\r?\n+/).filter(p => p.trim());

  const htmlParts = paragraphs.map(para => {
    const text = para.trim().replace(/\r?\n/g, ' ');

    // Detect chapter headings:
    // Short lines (under 80 chars) starting with "Chapter", "Part", etc.
    if (text.length < 80 && /^(chapter|part|book|volume|section|prologue|epilogue|act\s|scene\s)/i.test(text)) {
      return `<h2>${escapeHtml(text)}</h2>`;
    }

    // Centered/decorative lines (ALL CAPS, short)
    if (text.length < 50 && text === text.toUpperCase() && /[A-Z]{2,}/.test(text)) {
      return `<h3>${escapeHtml(text)}</h3>`;
    }

    // Regular paragraph
    return `<p>${escapeHtml(text)}</p>`;
  });

  container.innerHTML = htmlParts.join('');
}

/**
 * renderHtmlContent — Render an .htm/.html book file
 * We extract just the <body> content and sanitize it.
 *
 * @param {string} raw - Raw HTML content
 * @param {HTMLElement} container - The reader body element
 */
function renderHtmlContent(raw, container) {
  // Extract just the <body> content
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let content = bodyMatch ? bodyMatch[1] : raw;

  // Sanitize: remove scripts and external stylesheets (security + style override)
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi,  '')
    .replace(/<link[^>]*>/gi, '')
    // Make external links open in new tab instead of navigating away
    .replace(/href="http[^"]*"/gi, '$& target="_blank" rel="noopener"');

  container.innerHTML = content;
}

/**
 * setupProgressTracking — Track scroll position and time spent reading
 * @param {Object} book - Current book
 * @param {HTMLElement} rb - Reader body element
 */
function setupProgressTracking(book, rb) {
  // Record when reading started
  readingStartTime = Date.now();

  // ── SCROLL PROGRESS TRACKING ───────────────────────────────────────────────
  rb.addEventListener('scroll', () => {
    // Calculate scroll percentage (0-100)
    const scrolled = rb.scrollTop;
    const total    = rb.scrollHeight - rb.clientHeight;
    const percent  = total > 0 ? Math.round((scrolled / total) * 100) : 0;

    // Update the progress bar (visual fill)
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${percent}%`;

    // Update the text label "42% read"
    const label = document.getElementById('read-progress');
    if (label) label.textContent = `${percent}% read`;

    // Save to localStorage immediately (fast, no network)
    saveProgressLocal(book.id, percent);
  });

  // ── PERIODIC SERVER SAVE ───────────────────────────────────────────────────
  // Save to the database every 30 seconds while reading
  // We don't save on every scroll because that would create too many requests
  if (window.APP_USER) {
    clearInterval(progressSaveTimer); // Clear any existing timer
    progressSaveTimer = setInterval(() => {
      saveProgressServer(book);
    }, 30 * 1000); // Every 30 seconds
  }
}

/**
 * saveProgressLocal — Save reading progress to localStorage (fast, offline-capable)
 * @param {number} bookId  - Gutenberg book ID
 * @param {number} percent - 0-100
 */
function saveProgressLocal(bookId, percent) {
  localStorage.setItem(`progress_${bookId}`, percent);
}

/**
 * getSavedProgress — Retrieve previously saved scroll position
 * @param {number} bookId
 * @returns {number} percentage (0-100)
 */
function getSavedProgress(bookId) {
  return parseInt(localStorage.getItem(`progress_${bookId}`) || '0');
}

/**
 * saveProgressServer — Save reading progress to the database
 * @param {Object} book - Current book being read
 */
async function saveProgressServer(book) {
  if (!window.APP_USER || !book) return;

  const rb      = document.getElementById('reader-body');
  const total   = rb ? rb.scrollHeight - rb.clientHeight : 0;
  const scrolled = rb ? rb.scrollTop : 0;
  const percent = total > 0 ? Math.round((scrolled / total) * 100) : 0;

  // Calculate seconds read since last save
  const secondsRead = readingStartTime
    ? Math.floor((Date.now() - readingStartTime) / 1000)
    : 0;
  readingStartTime = Date.now(); // Reset timer

  try {
    await fetch(`/api/books/${book.id}/progress`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        percent,
        secondsRead,
        title:    book.title,
        author:   book.authors?.[0]?.name,
        coverUrl: book.formats?.['image/jpeg'],
        subjects: book.subjects || []
      })
    });
  } catch (err) {
    // Silently fail — progress is still saved in localStorage
    console.debug('Server progress save failed:', err);
  }
}

// ── READER CONTROLS ────────────────────────────────────────────────────────────

/**
 * setFontSize — Change the reader text size
 * @param {string} size - CSS font-size value, e.g. "1rem"
 */
function setFontSize(size) {
  const rb = document.getElementById('reader-body');
  if (rb) rb.style.fontSize = size;
}

/**
 * setReaderFont — Change the reader font family
 * @param {string} fontFamily - CSS font-family value
 */
function setReaderFont(fontFamily) {
  const rb = document.getElementById('reader-body');
  if (!rb) return;
  rb.style.fontFamily = fontFamily;

  // Save preference server-side
  if (window.APP_USER) {
    fetch('/api/user/preferences', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fontFamily })
    }).catch(() => {}); // Ignore errors
  }
}

/**
 * setReaderTheme — Switch reader color theme
 * @param {string} theme - 'dark' | 'sepia' | 'paper'
 */
function setReaderTheme(theme) {
  const rb = document.getElementById('reader-body');
  if (!rb) return;

  // Remove all theme classes, then add the new one
  rb.classList.remove('theme-sepia', 'theme-paper');
  if (theme === 'sepia') rb.classList.add('theme-sepia');
  if (theme === 'paper') rb.classList.add('theme-paper');
  // 'dark' = no class (default styles)

  // Save preference
  if (window.APP_USER) {
    fetch('/api/user/preferences', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ readerTheme: theme })
    }).catch(() => {});
  }
}

// ── HELPER ────────────────────────────────────────────────────────────────────
/**
 * getBestTextUrlFromFormats — Same logic as server-side, but in the browser
 * Finds the best URL for inline reading (prefer .txt over .html)
 */
function getBestTextUrlFromFormats(formats) {
  for (const [mime, url] of Object.entries(formats)) {
    if (mime.startsWith('text/plain') && !url.endsWith('.zip')) {
      return { url, type: 'txt' };
    }
  }
  for (const [mime, url] of Object.entries(formats)) {
    if (mime.startsWith('text/html') && !url.includes('pageimages')) {
      return { url, type: 'html' };
    }
  }
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Save progress when the user closes/navigates away from the page
window.addEventListener('beforeunload', () => {
  if (currentBook) saveProgressServer(currentBook);
  clearInterval(progressSaveTimer);
});

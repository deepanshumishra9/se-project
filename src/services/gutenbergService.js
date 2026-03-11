// src/services/gutenbergService.js
// ─────────────────────────────────────────────────────────────────────────────
// PROJECT GUTENBERG API SERVICE
//
// This file handles ALL communication with the Gutendex API.
// Gutendex is an unofficial JSON API for Project Gutenberg's 70,000+ free books.
// API Docs: https://gutendex.com/
//
// WHY SEPARATE THIS INTO A SERVICE?
// If the API URL changes, we only update it here — not in 10 different places.
// It also makes testing easier — we can mock this service in tests.
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');

// Base URL for all API requests
const BASE_URL = 'https://gutendex.com';

// Simple in-memory cache to avoid repeating identical API calls
// Map: { url → { data, timestamp } }
// In production, you'd use Redis for this, but a Map works for demos.
const cache    = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * getCached — Helper to get/set cached API responses
 * @param {string} url - The API URL to cache
 * @param {Function} fetchFn - Async function that actually fetches the data
 */
async function getCached(url, fetchFn) {
  const cached = cache.get(url);
  const now    = Date.now();

  // Return cached data if it's still fresh
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Fetch fresh data
  const data = await fetchFn();
  cache.set(url, { data, timestamp: now });
  return data;
}

/**
 * searchBooks — Search for books by title, author, or topic
 * @param {Object} options
 * @param {string} options.query - Search term (title, author name)
 * @param {string} options.topic - Filter by topic (fiction, history, etc.)
 * @param {number} options.page  - Page number for pagination
 * @param {string} options.lang  - Language code (en, fr, es, etc.)
 * @returns {Object} { count, next, previous, results }
 */
async function searchBooks({ query = '', topic = '', page = 1, lang = 'en' } = {}) {
  // Build the query string parameters
  const params = new URLSearchParams();
  if (query) params.set('search', query);
  if (topic) params.set('topic', topic);
  if (lang)  params.set('languages', lang);
  if (page > 1) params.set('page', page);

  // Gutendex orders by download count by default — popular books first
  const url = `${BASE_URL}/books/?${params.toString()}`;

  return getCached(url, async () => {
    const response = await axios.get(url, { timeout: 10000 }); // 10 second timeout
    return response.data;
  });
}

/**
 * getBook — Fetch a single book by its Gutenberg ID
 * @param {number} id - Gutenberg book ID
 * @returns {Object} Full book data including formats, authors, subjects
 */
async function getBook(id) {
  const url = `${BASE_URL}/books/${id}`;

  return getCached(url, async () => {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  });
}

/**
 * getBooksBySubjects — Fetch books matching any of the given subjects
 * Used by the recommendation engine to find similar books.
 * @param {string[]} subjects - Array of subjects/topics
 * @param {number} limit - Max number of results
 */
async function getBooksBySubjects(subjects, limit = 20) {
  if (!subjects || subjects.length === 0) return [];

  // Take the first 2 subjects to keep the query focused
  const topic = subjects.slice(0, 2).join(',');
  const url   = `${BASE_URL}/books/?topic=${encodeURIComponent(topic)}&languages=en`;

  return getCached(url, async () => {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data.results || [];
  });
}

/**
 * extractFormats — Parse the "formats" object from a Gutenberg book
 * and return only the formats we care about (epub, pdf, txt, html)
 *
 * The API returns formats as an object like:
 * {
 *   "application/epub+zip": "https://...book.epub",
 *   "text/plain": "https://...book.txt",
 *   ...
 * }
 * @param {Object} formats - Raw formats object from API
 * @returns {Array} Array of { key, label, icon, desc, url }
 */
function extractFormats(formats = {}) {
  const FORMAT_DEFS = [
    {
      key: 'epub', mime: 'application/epub+zip',
      icon: '📖', label: 'EPUB',
      desc: 'Best for e-readers (Kindle, Kobo, Nook).'
    },
    {
      key: 'pdf', mime: 'application/pdf',
      icon: '📄', label: 'PDF',
      desc: 'Fixed layout, great for printing.'
    },
    {
      key: 'txt', mime: 'text/plain',
      icon: '📝', label: 'Plain Text',
      desc: 'Universal, lightweight, readable anywhere.'
    },
    {
      key: 'html', mime: 'text/html',
      icon: '🌐', label: 'HTML',
      desc: 'Read in any web browser.'
    },
  ];

  const found = [];
  for (const def of FORMAT_DEFS) {
    for (const [mime, url] of Object.entries(formats)) {
      // Check if this format matches and isn't a .zip archive or image file
      if (mime.startsWith(def.mime) && !url.endsWith('.zip') && !url.includes('images')) {
        found.push({ ...def, url });
        break; // Only take the first match per format type
      }
    }
  }
  return found;
}

/**
 * getBestTextUrl — Find the best URL to use for in-app reading
 * Prefers plain text (.txt) over HTML for cleaner rendering
 * @param {Object} formats - Raw formats object from API
 * @returns {{ url: string, type: 'txt'|'html' } | null}
 */
function getBestTextUrl(formats = {}) {
  // Try plain text first
  for (const [mime, url] of Object.entries(formats)) {
    if (mime.startsWith('text/plain') && !url.endsWith('.zip')) {
      return { url, type: 'txt' };
    }
  }
  // Fall back to HTML
  for (const [mime, url] of Object.entries(formats)) {
    if (mime.startsWith('text/html') && !url.includes('pageimages')) {
      return { url, type: 'html' };
    }
  }
  return null; // No readable format available
}

/**
 * generateBuyLinks — Create purchase links for Amazon and Flipkart
 * Used when a book isn't available in the Gutenberg API.
 * @param {string} title  - Book title
 * @param {string} author - Author name
 * @returns {{ amazon: string, flipkart: string }}
 */
function generateBuyLinks(title, author = '') {
  const query = encodeURIComponent(`${title} ${author}`.trim());

  return {
    amazon: `https://www.amazon.in/s?k=${query}&i=stripbooks`,
    flipkart: `https://www.flipkart.com/search?q=${query}&category=books`
  };
}

module.exports = {
  searchBooks,
  getBook,
  getBooksBySubjects,
  extractFormats,
  getBestTextUrl,
  generateBuyLinks
};

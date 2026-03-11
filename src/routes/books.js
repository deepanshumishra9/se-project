// src/routes/books.js
// ─────────────────────────────────────────────────────────────────────────────
// BOOKS API ROUTES
//
// These are JSON API endpoints called by the frontend JavaScript.
// They are NOT page routes — they don't render HTML templates.
// They return JSON data that the frontend uses to update the UI.
//
// All routes are prefixed with /api/books (set in server.js)
// ─────────────────────────────────────────────────────────────────────────────

const express   = require('express');
const { prisma } = require('../utils/db');
const {
  searchBooks,
  getBook,
  extractFormats,
  getBestTextUrl,
  generateBuyLinks
} = require('../services/gutenbergService');
const { getRecommendations }    = require('../services/recommendationService');
const { requireAuthJson }        = require('../middleware/auth');
const { notifyRecommendation }   = require('../services/notificationService');

const router = express.Router();

// ── SEARCH BOOKS ──────────────────────────────────────────────────────────────
// GET /api/books/search?q=pride+and+prejudice&topic=fiction&page=1
router.get('/search', async (req, res) => {
  try {
    const { q = '', topic = '', page = 1, lang = 'en' } = req.query;

    const data = await searchBooks({ query: q, topic, page: parseInt(page), lang });

    // If the user is logged in, mark which books they've already read
    let readIds = new Set();
    if (req.user) {
      const history = await prisma.readingHistory.findMany({
        where: { userId: req.user.id },
        select: { gutenbergId: true }
      });
      readIds = new Set(history.map(h => h.gutenbergId));
    }

    // Enrich each book with derived data before sending to frontend
    const enrichedResults = (data.results || []).map(book => ({
      ...book,
      formats_parsed: extractFormats(book.formats || {}),
      has_text:        !!getBestTextUrl(book.formats || {}),
      already_read:    readIds.has(book.id),
      buy_links:       generateBuyLinks(book.title, book.authors?.[0]?.name)
    }));

    res.json({ ...data, results: enrichedResults });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to search books. Please try again.' });
  }
});

// ── GET SINGLE BOOK ───────────────────────────────────────────────────────────
// GET /api/books/:id
router.get('/:id', async (req, res) => {
  try {
    const book = await getBook(req.params.id);

    res.json({
      ...book,
      formats_parsed: extractFormats(book.formats || {}),
      has_text:        !!getBestTextUrl(book.formats || {}),
      buy_links:       generateBuyLinks(book.title, book.authors?.[0]?.name)
    });
  } catch (err) {
    res.status(404).json({ error: 'Book not found.' });
  }
});

// ── GET RECOMMENDATIONS ───────────────────────────────────────────────────────
// GET /api/books/recommendations (requires login)
router.get('/user/recommendations', requireAuthJson, async (req, res) => {
  try {
    const recommendations = await getRecommendations(req.user.id, 12);

    // Notify the user about new recommendations (throttled — only once per day)
    if (recommendations.length > 0) {
      const lastNotif = await prisma.notification.findFirst({
        where: {
          userId: req.user.id,
          type:   'recommendation',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      });
      if (!lastNotif) {
        await notifyRecommendation(req.user.id, recommendations[0].title);
      }
    }

    res.json({ results: recommendations });
  } catch (err) {
    console.error('Recommendations error:', err);
    res.status(500).json({ error: 'Failed to get recommendations.' });
  }
});

// ── LOG READING PROGRESS ──────────────────────────────────────────────────────
// POST /api/books/:id/progress (requires login)
// Called every time the user scrolls while reading
router.post('/:id/progress', requireAuthJson, async (req, res) => {
  try {
    const { percent, secondsRead, title, author, coverUrl, subjects } = req.body;
    const gutenbergId = parseInt(req.params.id);

    // "upsert" = update if exists, create if not
    // This handles both the first time reading and subsequent sessions
    const record = await prisma.readingHistory.upsert({
      where: {
        // The composite unique key we defined in schema.prisma
        userId_gutenbergId: { userId: req.user.id, gutenbergId }
      },
      update: {
        // Update existing record
        progressPercent: Math.max(percent, 0),
        totalReadSeconds: { increment: secondsRead || 0 },
        lastReadAt: new Date(),
        completed: percent >= 90 // Mark as completed if they've read 90%+
      },
      create: {
        // Create new record (first time reading this book)
        userId: req.user.id,
        gutenbergId,
        title:   title || 'Unknown Title',
        author:  author || 'Unknown Author',
        coverUrl: coverUrl || null,
        subjects: subjects || [],
        progressPercent: Math.max(percent, 0)
      }
    });

    // Update reading goals
    await updateReadingGoals(req.user.id, secondsRead || 0, record.completed);

    res.json({ success: true, record });
  } catch (err) {
    console.error('Progress save error:', err);
    res.status(500).json({ error: 'Failed to save progress.' });
  }
});

// ── RATE A BOOK ────────────────────────────────────────────────────────────────
// POST /api/books/:id/rate (requires login)
router.post('/:id/rate', requireAuthJson, async (req, res) => {
  try {
    const { rating } = req.body;
    const gutenbergId = parseInt(req.params.id);

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const record = await prisma.readingHistory.updateMany({
      where: { userId: req.user.id, gutenbergId },
      data:  { rating: parseInt(rating) }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save rating.' });
  }
});

// ── HELPER: Update reading goals when user reads ──────────────────────────────
async function updateReadingGoals(userId, secondsRead, bookCompleted) {
  try {
    const minutesRead = Math.floor(secondsRead / 60);

    if (minutesRead > 0) {
      // Update "minutes per day" goals
      await prisma.readingGoal.updateMany({
        where: { userId, type: 'minutes_per_day' },
        data:  { current: { increment: minutesRead } }
      });
    }

    if (bookCompleted) {
      // Update "books per month/year" goals
      await prisma.readingGoal.updateMany({
        where: { userId, type: { in: ['books_per_month', 'books_per_year'] } },
        data:  { current: { increment: 1 } }
      });
    }
  } catch (err) {
    // Goal update failure shouldn't break the main reading experience
    console.error('Goal update error:', err);
  }
}

module.exports = router;

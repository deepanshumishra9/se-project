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
const { ReadingHistory, Notification, ReadingGoal, DailyReadingLog } = require('../utils/db');
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
      const history = await ReadingHistory.find({ userId: req.user.id })
        .select('gutenbergId');
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
      const lastNotif = await Notification.findOne({
        userId: req.user.id,
        type:   'recommendation',
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
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
// Called every ~30 seconds while a user is reading
router.post('/:id/progress', requireAuthJson, async (req, res) => {
  try {
    const { percent, secondsRead, title, author, coverUrl, subjects } = req.body;
    const gutenbergId = parseInt(req.params.id);
    const minutesRead = Math.floor((secondsRead || 0) / 60);

    // ── 1. Upsert ReadingHistory ───────────────────────────────────────────
    const record = await ReadingHistory.findOneAndUpdate(
      { userId: req.user.id, gutenbergId },
      {
        $max: { progressPercent: Math.max(percent, 0) },
        $inc: { totalReadSeconds: secondsRead || 0 },
        $set: {
          lastReadAt: new Date(),
          completed:  percent >= 90,
          title:      title    || 'Unknown Title',
          author:     author   || 'Unknown Author',
          coverUrl:   coverUrl || null,
          subjects:   subjects || []
        },
        $setOnInsert: { firstReadAt: new Date() }
      },
      { upsert: true, new: true }
    );

    // ── 2. Upsert DailyReadingLog (today's minutes) ───────────────────────
    if (minutesRead > 0) {
      // Get start of today in UTC
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      await DailyReadingLog.findOneAndUpdate(
        { userId: req.user.id, date: todayStart },
        {
          $inc: { minutesRead: minutesRead },
          $set: { date: todayStart }
        },
        { upsert: true }
      );
    }

    // ── 3. Update reading goals and detect achievements ────────────────────
    const goalAchieved = await updateReadingGoals(
      req.user.id,
      secondsRead || 0,
      record.completed
    );

    res.json({ success: true, record, goalAchieved });
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

    const record = await ReadingHistory.updateMany(
      { userId: req.user.id, gutenbergId },
      { $set: { rating: parseInt(rating) } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save rating.' });
  }
});

// ── HELPER: Update reading goals, return achievement info ────────────────────
async function updateReadingGoals(userId, secondsRead, bookCompleted) {
  const achieved = [];   // Collect any newly-achieved goals to notify frontend
  try {
    const minutesRead = Math.floor(secondsRead / 60);

    // Minutes-per-day goal
    if (minutesRead > 0) {
      const minuteGoals = await ReadingGoal.find({ userId, type: 'minutes_per_day' });
      for (const goal of minuteGoals) {
        const wasAchievedBefore = goal.achieved;
        goal.current += minutesRead;
        if (!wasAchievedBefore && goal.current >= goal.target) {
          goal.achieved = true;
          achieved.push({ type: goal.type, target: goal.target });
        }
        await goal.save();
      }
    }

    // Books-per-month / books-per-year goals (only when a book is completed)
    if (bookCompleted) {
      const bookGoals = await ReadingGoal.find({
        userId,
        type: { $in: ['books_per_month', 'books_per_year'] }
      });
      for (const goal of bookGoals) {
        const wasAchievedBefore = goal.achieved;
        goal.current += 1;
        if (!wasAchievedBefore && goal.current >= goal.target) {
          goal.achieved = true;
          achieved.push({ type: goal.type, target: goal.target });
        }
        await goal.save();
      }
    }
  } catch (err) {
    console.error('Goal update error:', err);
  }
  return achieved;   // Array of newly achieved goals (empty if none)
}

module.exports = router;

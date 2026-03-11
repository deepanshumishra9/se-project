// src/routes/user.js
// ─────────────────────────────────────────────────────────────────────────────
// USER PROFILE & ACTIVITY ROUTES
//
// These endpoints manage everything related to the logged-in user:
// their reading history, bookmarks, reading stats, goals, and preferences.
// All routes require authentication (requireAuthJson).
// ─────────────────────────────────────────────────────────────────────────────

const express    = require('express');
const { prisma } = require('../utils/db');
const { requireAuthJson } = require('../middleware/auth');

const router = express.Router();

// All routes in this file require authentication
// We use router.use() to apply the middleware to every route below
router.use(requireAuthJson);

// ── GET READING HISTORY ────────────────────────────────────────────────────────
// GET /api/user/history
// Returns the user's list of books they've opened/read
router.get('/history', async (req, res) => {
  try {
    const history = await prisma.readingHistory.findMany({
      where: { userId: req.user.id },
      orderBy: { lastReadAt: 'desc' } // Most recently read first
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reading history.' });
  }
});

// ── GET READING STATS ──────────────────────────────────────────────────────────
// GET /api/user/stats
// Returns aggregate statistics for the user dashboard
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    // Run multiple database queries in parallel with Promise.all
    // This is faster than running them one after another
    const [
      totalBooks,
      completedBooks,
      totalSecondsResult,
      recentActivity,
      goals
    ] = await Promise.all([
      // Total books ever opened
      prisma.readingHistory.count({ where: { userId } }),

      // Books the user finished (90%+)
      prisma.readingHistory.count({ where: { userId, completed: true } }),

      // Sum of all reading time
      // Prisma's aggregate function works like SQL's SUM()
      prisma.readingHistory.aggregate({
        where: { userId },
        _sum: { totalReadSeconds: true }
      }),

      // Last 7 days of activity (for the reading streak graph)
      prisma.readingHistory.findMany({
        where: {
          userId,
          lastReadAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        select: { lastReadAt: true, totalReadSeconds: true }
      }),

      // User's reading goals
      prisma.readingGoal.findMany({ where: { userId } })
    ]);

    const totalMinutes = Math.floor((totalSecondsResult._sum.totalReadSeconds || 0) / 60);
    const totalHours   = Math.floor(totalMinutes / 60);

    res.json({
      totalBooks,
      completedBooks,
      inProgressBooks: totalBooks - completedBooks,
      totalMinutes,
      totalHours,
      recentActivity,
      goals,
      // Reading streak: count consecutive days with reading activity
      currentStreak: calculateStreak(recentActivity)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

/**
 * calculateStreak — Count consecutive days the user has read
 * @param {Array} activity - Recent reading activity records
 * @returns {number} Number of consecutive days
 */
function calculateStreak(activity) {
  if (activity.length === 0) return 0;

  // Get unique reading dates (just the date part, not time)
  const readDates = new Set(
    activity.map(a => new Date(a.lastReadAt).toDateString())
  );

  let streak = 0;
  const today = new Date();

  // Count backwards from today
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    if (readDates.has(date.toDateString())) {
      streak++;
    } else {
      break; // Streak is broken
    }
  }
  return streak;
}

// ── BOOKMARKS ─────────────────────────────────────────────────────────────────

// GET /api/user/bookmarks — Get all saved books
router.get('/bookmarks', async (req, res) => {
  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: req.user.id },
      orderBy: { savedAt: 'desc' }
    });
    res.json(bookmarks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookmarks.' });
  }
});

// POST /api/user/bookmarks — Add a book to bookmarks
router.post('/bookmarks', async (req, res) => {
  try {
    const { gutenbergId, title, author, coverUrl } = req.body;

    if (!gutenbergId || !title) {
      return res.status(400).json({ error: 'Book ID and title are required.' });
    }

    // upsert = add if not already bookmarked (prevents duplicates)
    const bookmark = await prisma.bookmark.upsert({
      where: {
        userId_gutenbergId: { userId: req.user.id, gutenbergId: parseInt(gutenbergId) }
      },
      update: {}, // Nothing to update — just ensure it exists
      create: {
        userId:      req.user.id,
        gutenbergId: parseInt(gutenbergId),
        title,
        author:   author || null,
        coverUrl: coverUrl || null
      }
    });

    res.json({ success: true, bookmark });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save bookmark.' });
  }
});

// DELETE /api/user/bookmarks/:gutenbergId — Remove a bookmark
router.delete('/bookmarks/:gutenbergId', async (req, res) => {
  try {
    await prisma.bookmark.deleteMany({
      where: {
        userId: req.user.id,
        gutenbergId: parseInt(req.params.gutenbergId)
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove bookmark.' });
  }
});

// ── READING GOALS ─────────────────────────────────────────────────────────────

// POST /api/user/goals — Create a new reading goal
router.post('/goals', async (req, res) => {
  try {
    const { type, target, period } = req.body;

    const validTypes   = ['books_per_month', 'minutes_per_day', 'books_per_year'];
    const validPeriods = ['daily', 'monthly', 'yearly'];

    if (!validTypes.includes(type) || !validPeriods.includes(period)) {
      return res.status(400).json({ error: 'Invalid goal type or period.' });
    }

    // Delete existing goal of the same type (one goal per type)
    await prisma.readingGoal.deleteMany({
      where: { userId: req.user.id, type }
    });

    const goal = await prisma.readingGoal.create({
      data: {
        userId: req.user.id,
        type,
        target: parseInt(target),
        period
      }
    });

    res.json({ success: true, goal });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create goal.' });
  }
});

// ── USER PREFERENCES ──────────────────────────────────────────────────────────

// PATCH /api/user/preferences — Update reader preferences (theme, font, etc.)
router.patch('/preferences', async (req, res) => {
  try {
    const { theme, fontSize, fontFamily } = req.body;

    // Get current preferences and merge with new ones
    const currentPrefs = req.user.preferences || {};
    const newPrefs = {
      ...currentPrefs,
      ...(theme      && { theme }),
      ...(fontSize   && { fontSize }),
      ...(fontFamily && { fontFamily })
    };

    await prisma.user.update({
      where: { id: req.user.id },
      data:  { preferences: newPrefs }
    });

    res.json({ success: true, preferences: newPrefs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

module.exports = router;

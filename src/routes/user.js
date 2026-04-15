// src/routes/user.js
// ─────────────────────────────────────────────────────────────────────────────
// USER PROFILE & ACTIVITY ROUTES
//
// Manages all user-specific data:
//   - Reading history (with progress)
//   - Daily reading logs (minutes read per day)
//   - Reading goals (create, delete, list)
//   - Reading reminders (user-set notification time)
//   - Bookmarks
//   - User preferences
// ─────────────────────────────────────────────────────────────────────────────

const mongoose  = require('mongoose');
const express   = require('express');
const router    = express.Router();
const {
  User, ReadingHistory, Bookmark, ReadingGoal, DailyReadingLog, ReadingReminder
} = require('../utils/db');
const { requireAuthJson } = require('../middleware/auth');

// All routes in this file require authentication
router.use(requireAuthJson);

// ═══════════════════════════════════════════════════════════════════════════════
// READING HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/history
// Returns the user's list of books they've read, sorted by most recently read
router.get('/history', async (req, res) => {
  try {
    const history = await ReadingHistory.find({ userId: req.user.id })
      .sort({ lastReadAt: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reading history.' });
  }
});

// DELETE /api/user/history
// Clears ALL reading history for the logged-in user
router.delete('/history', async (req, res) => {
  try {
    await ReadingHistory.deleteMany({ userId: req.user.id });
    res.json({ success: true, message: 'Reading history cleared.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

// DELETE /api/user/history/:gutenbergId
// Removes a single book from reading history
router.delete('/history/:gutenbergId', async (req, res) => {
  try {
    await ReadingHistory.deleteMany({
      userId: req.user.id,
      gutenbergId: parseInt(req.params.gutenbergId)
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove history entry.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// READING STATS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/stats
// Returns aggregate statistics for the user dashboard
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    // Run all queries in parallel for speed
    const [
      totalBooks,
      completedBooks,
      totalSecondsResult,
      recentActivity,
      goals,
      last7DaysLogs
    ] = await Promise.all([
      // Total books ever opened
      ReadingHistory.countDocuments({ userId }),

      // Books the user finished (90%+)
      ReadingHistory.countDocuments({ userId, completed: true }),

      // Sum of all reading time across all sessions
      ReadingHistory.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, totalReadSeconds: { $sum: '$totalReadSeconds' } } }
      ]),

      // Last 7 days of activity (for streak calculation)
      ReadingHistory.find({
        userId,
        lastReadAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).select('lastReadAt totalReadSeconds'),

      // User's current reading goals
      ReadingGoal.find({ userId }),

      // Last 7 days of daily reading logs (for the heatmap)
      DailyReadingLog.find({
        userId,
        date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).sort({ date: 1 })
    ]);

    const totalReadSeconds = totalSecondsResult[0]?.totalReadSeconds || 0;
    const totalMinutes     = Math.floor(totalReadSeconds / 60);
    const totalHours       = Math.floor(totalMinutes / 60);

    // Get today's minutes from DailyReadingLog
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayLog = await DailyReadingLog.findOne({
      userId,
      date: { $gte: todayStart }
    });
    const minutesReadToday = todayLog?.minutesRead || 0;

    res.json({
      totalBooks,
      completedBooks,
      inProgressBooks: totalBooks - completedBooks,
      totalMinutes,
      totalHours,
      minutesReadToday,
      recentActivity,
      goals: goals.map(g => ({
        ...g.toJSON(),
        progressPercent: g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
      })),
      currentStreak:  calculateStreak(recentActivity),
      last7DaysLogs   // [{date, minutesRead}, ...] for bar chart
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ── HELPER: count consecutive reading days ────────────────────────────────────
function calculateStreak(activity) {
  if (!activity.length) return 0;

  const readDates = new Set(
    activity.map(a => new Date(a.lastReadAt).toDateString())
  );

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (readDates.has(d.toDateString())) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKMARKS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/bookmarks
router.get('/bookmarks', async (req, res) => {
  try {
    const bookmarks = await Bookmark.find({ userId: req.user.id })
      .sort({ savedAt: -1 });
    res.json(bookmarks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookmarks.' });
  }
});

// POST /api/user/bookmarks
router.post('/bookmarks', async (req, res) => {
  try {
    const { gutenbergId, title, author, coverUrl } = req.body;
    if (!gutenbergId || !title) {
      return res.status(400).json({ error: 'Book ID and title are required.' });
    }

    const bookmark = await Bookmark.findOneAndUpdate(
      { userId: req.user.id, gutenbergId: parseInt(gutenbergId) },
      { userId: req.user.id, gutenbergId: parseInt(gutenbergId), title, author: author || null, coverUrl: coverUrl || null },
      { upsert: true, new: true }
    );
    res.json({ success: true, bookmark });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save bookmark.' });
  }
});

// DELETE /api/user/bookmarks/:gutenbergId
router.delete('/bookmarks/:gutenbergId', async (req, res) => {
  try {
    await Bookmark.deleteMany({
      userId:      req.user.id,
      gutenbergId: parseInt(req.params.gutenbergId)
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove bookmark.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// READING GOALS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/goals — List all goals for the user
router.get('/goals', async (req, res) => {
  try {
    const goals = await ReadingGoal.find({ userId: req.user.id });
    res.json(goals.map(g => ({
      ...g.toJSON(),
      progressPercent: g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load goals.' });
  }
});

// POST /api/user/goals — Create or replace a goal of a given type
router.post('/goals', async (req, res) => {
  try {
    const { type, target, period } = req.body;

    const validTypes   = ['books_per_month', 'minutes_per_day', 'books_per_year'];
    const validPeriods = ['daily', 'monthly', 'yearly'];

    if (!validTypes.includes(type) || !validPeriods.includes(period)) {
      return res.status(400).json({ error: 'Invalid goal type or period.' });
    }
    if (!target || parseInt(target) < 1) {
      return res.status(400).json({ error: 'Target must be at least 1.' });
    }

    // One goal per type — delete existing before creating
    await ReadingGoal.deleteMany({ userId: req.user.id, type });

    const goal = await ReadingGoal.create({
      userId: req.user.id,
      type,
      target:  parseInt(target),
      period,
      current: 0,
      achieved: false
    });

    res.json({
      success: true,
      goal: { ...goal.toJSON(), progressPercent: 0 }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create goal.' });
  }
});

// DELETE /api/user/goals/:id — Remove a specific goal
router.delete('/goals/:id', async (req, res) => {
  try {
    await ReadingGoal.deleteOne({
      _id:    req.params.id,
      userId: req.user.id   // Security: ensure the goal belongs to this user
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete goal.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// READING REMINDERS (user-selected notification time)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/reminder — Get the user's current reminder setting
router.get('/reminder', async (req, res) => {
  try {
    const reminder = await ReadingReminder.findOne({ userId: req.user.id });
    res.json(reminder || { enabled: false, reminderTime: '09:00', timezone: 'UTC' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reminder.' });
  }
});

// PUT /api/user/reminder — Create or update the reminder setting
router.put('/reminder', async (req, res) => {
  try {
    const { reminderTime, enabled, timezone } = req.body;

    // Validate HH:MM format
    if (reminderTime && !/^\d{2}:\d{2}$/.test(reminderTime)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g. 09:00).' });
    }

    const reminder = await ReadingReminder.findOneAndUpdate(
      { userId: req.user.id },
      {
        reminderTime: reminderTime || '09:00',
        enabled:      enabled !== undefined ? Boolean(enabled) : true,
        timezone:     timezone  || 'UTC'
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, reminder });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save reminder.' });
  }
});

// DELETE /api/user/reminder — Disable / delete the reminder
router.delete('/reminder', async (req, res) => {
  try {
    await ReadingReminder.deleteOne({ userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reminder.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY READING LOG
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/user/daily-logs?days=30
// Returns the last N days of reading logs for chart display
router.get('/daily-logs', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await DailyReadingLog.find({
      userId: req.user.id,
      date:   { $gte: since }
    }).sort({ date: 1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load daily logs.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

// PATCH /api/user/preferences
router.patch('/preferences', async (req, res) => {
  try {
    const { theme, fontSize, fontFamily } = req.body;
    const currentPrefs = req.user.preferences || {};
    const newPrefs = {
      ...currentPrefs,
      ...(theme      && { theme }),
      ...(fontSize   && { fontSize }),
      ...(fontFamily && { fontFamily })
    };

    await User.findByIdAndUpdate(req.user.id, { $set: { preferences: newPrefs } });
    res.json({ success: true, preferences: newPrefs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

module.exports = router;

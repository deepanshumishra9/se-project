// src/routes/notifications.js
// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION API ROUTES
//
// These endpoints let the frontend:
// 1. Fetch the user's notifications (to show in the dropdown)
// 2. Mark notifications as read (when the user clicks them)
// 3. Delete notifications
// ─────────────────────────────────────────────────────────────────────────────

const express    = require('express');
const { Notification } = require('../utils/db');
const { requireAuthJson } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuthJson);

// GET /api/notifications — Get recent notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20);

    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

// PATCH /api/notifications/read-all — Mark all as read
router.patch('/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, read: false },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

// PATCH /api/notifications/:id/read — Mark single notification as read
router.patch('/:id/read', async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user.id },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

// DELETE /api/notifications/:id — Delete a notification
router.delete('/:id', async (req, res) => {
  try {
    await Notification.deleteOne({
      _id: req.params.id,
      userId: req.user.id
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

module.exports = router;

// src/models/ReadingReminder.js
// ─────────────────────────────────────────────────────────────────────────────
// Stores a user's personal daily reading reminder settings.
// Each user has at most ONE reminder document (upserted, not duplicated).
//
// The reminder fires at the user's chosen time every day via node-cron.
// The cron job re-reads this collection every day to pick up time changes.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const readingReminderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true   // One reminder setting per user
  },

  // The clock time to send the reminder, e.g. "09:00", "20:30"
  // Stored in HH:MM 24-hour format (user's local time is converted on the frontend)
  reminderTime: {
    type: String,
    required: true,
    match: /^\d{2}:\d{2}$/  // Validates "HH:MM" format
  },

  // Whether the reminder is currently active
  enabled: {
    type: Boolean,
    default: true
  },

  // Optional: user's timezone string so we can schedule correctly (e.g. "Asia/Kolkata")
  timezone: {
    type: String,
    default: 'UTC'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

readingReminderSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.model('ReadingReminder', readingReminderSchema);

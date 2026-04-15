// src/models/DailyReadingLog.js
// ─────────────────────────────────────────────────────────────────────────────
// Tracks HOW MANY MINUTES a user reads on each calendar day.
// One document per user per day (upserted — never duplicated).
// Used to display the "Minutes Read Today" stat and the 7-day activity heatmap.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const dailyReadingLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // The calendar date this log entry is for (stored as YYYY-MM-DD at midnight UTC)
  date: {
    type: Date,
    required: true
  },

  // Total minutes read on this day (incremented every time progress is saved)
  minutesRead: {
    type: Number,
    default: 0,
    min: 0
  },

  // Number of books opened on this day
  booksOpened: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// One log entry per user per day
dailyReadingLogSchema.index({ userId: 1, date: 1 }, { unique: true });

dailyReadingLogSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.model('DailyReadingLog', dailyReadingLogSchema);

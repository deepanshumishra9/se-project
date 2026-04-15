const mongoose = require('mongoose');

const readingGoalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['books_per_month', 'minutes_per_day', 'books_per_year'],
    required: true
  },
  target: {
    type: Number,
    required: true
  },
  current: {
    type: Number,
    default: 0
  },
  period: {
    type: String,
    enum: ['daily', 'monthly', 'yearly'],
    required: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  achieved: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Map _id to id
readingGoalSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

module.exports = mongoose.model('ReadingGoal', readingGoalSchema);

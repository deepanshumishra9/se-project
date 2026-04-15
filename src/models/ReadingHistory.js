const mongoose = require('mongoose');

const readingHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  gutenbergId: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  author: {
    type: String
  },
  coverUrl: {
    type: String
  },
  subjects: {
    type: [String], // Stored as array in Mongo
    default: []
  },
  progressPercent: {
    type: Number,
    default: 0
  },
  totalReadSeconds: {
    type: Number,
    default: 0
  },
  lastReadAt: {
    type: Date,
    default: Date.now
  },
  firstReadAt: {
    type: Date,
    default: Date.now
  },
  completed: {
    type: Boolean,
    default: false
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Composite unique index: one entry per user+book combination
readingHistorySchema.index({ userId: 1, gutenbergId: 1 }, { unique: true });

// Map _id to id
readingHistorySchema.virtual('id').get(function() {
  return this._id.toHexString();
});

module.exports = mongoose.model('ReadingHistory', readingHistorySchema);
